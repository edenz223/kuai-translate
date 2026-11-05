import type {CaptionCue,JsonSegment,JsonCaptionEvent} from './types.js';
import {joinCaptionFragments as join,endsCaptionSentence as sentenceEnd} from './phrase-boundaries.js';
interface Part {text:string;start:number;end:number;eventEnd:number;eventIndex:number}
interface Token {text:string;start:number;end:number;eventIndex:number;boundaryBefore:boolean;boundaryAfter:boolean;part:Part}
/** Local JSON3 ASR grouping. Authored tracks never pass through this helper.
 * Segment offsets anchor timing. Within an untimed segment, character position
 * estimates timing; it is not a claim about word-level audio alignment.
 */
const MAX_CHARS=120,MIN_CHARS=12,PAUSE_SECONDS=0.8;
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const units=/\s*(?:\[[^\]\n]+\]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[。！？、，；：]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}。！？、，；：]+)/gu;
const speaker=/^(?:>>\s*|[\p{L}][\p{L} .'-]{0,35}:\s)/u;
const sound=/^(?:\[[^\]]+\]|[♪♫].*)$/u;
// Fill missing boundaries between monotonic valid anchors in source order.
// Conflicting/backwards offsets are ignored, never used to sort away source text.
function segmentTimes(segments:JsonSegment[],start:number,end:number) {
  const anchors=[{index:0,time:start}],explicit=new Set<number>();
  for(let index=0;index<segments.length;index++){
    const raw=segments[index].tOffsetMs,offset=Number(raw),time=start+offset/1000;
    if(raw===undefined||!Number.isFinite(offset)||offset<0||time>=end||time<anchors.at(-1)!.time)continue;
    if(index===0)anchors[0]={index,time};else anchors.push({index,time});
    explicit.add(index);
  }
  anchors.push({index:segments.length,time:end});
  const times:number[]=[];
  for(let anchor=0;anchor<anchors.length-1;anchor++){
    const from=anchors[anchor],to=anchors[anchor+1];
    let total=0,position=0;
    for(let index=from.index;index<to.index;index++)total+=Math.max(1,segments[index].utf8.length);
    for(let index=from.index;index<to.index;index++){
      times[index]=from.time+(to.time-from.time)*position/total;
      position+=Math.max(1,segments[index].utf8.length);
    }
  }
  times[segments.length]=end;return {times,explicit};
}
// Balance an entire phrase before choosing a cut. A greedy character limit
// misses earlier commas and leaves a short final fragment. Keep original token
// strings and their timing; no substring cut may split a source word.
function phraseCues(tokens:Token[]):CaptionCue[] {
  if(!tokens.length)return [];
  const fragments:string[]=[],offsets=[0];let tail='';
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index],fragment=index===0?token.text.trimStart():tokens[index-1].eventIndex===token.eventIndex?token.text:join(tail,token.text).slice(tail.length);
    fragments.push(fragment);offsets.push(offsets.at(-1)!+fragment.length);tail=(tail+fragment).slice(-64);
  }
  const text=fragments.join(''),cues:CaptionCue[]=[],numberCuts=new Set<number>(),groupCuts=new Set<number>();
  // Read the actual phrase around a boundary: punctuation can be its own token.
  // Three-digit space groups are a strong preference, not an unbounded lock:
  // spoken counts such as 100 101 102 have the same syntax as grouped numbers.
  const markCuts=(pattern:RegExp,set:Set<number>)=>{
    let boundary=1;
    for(const match of text.matchAll(pattern)){
      while(boundary<offsets.length&&offsets[boundary]<=match.index)boundary++;
      while(boundary<offsets.length&&offsets[boundary]<match.index+match[0].length)set.add(boundary++);
    }
  };
  // A number has one decimal separator or three-digit thousands groups;
  // arbitrary comma-separated one-/two-digit lists remain clause boundaries.
  markCuts(/(?<!\d)(?:\d{1,3}(?:[,.，]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+)(?!\d)/gu,numberCuts);
  markCuts(/(?<!\d)\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)/gu,groupCuts);
  const wordEnds=new Set<number>();
  if(cjk.test(text)&&typeof Intl.Segmenter==='function'){
    for(const word of new Intl.Segmenter(undefined,{granularity:'word'}).segment(text))wordEnds.add(word.index+word.segment.length);
  }
  const safeBoundary=(index:number)=>{
    if(numberCuts.has(index))return false;
    const left=fragments[index-1],right=fragments[index];
    if(/^[,.;:!?。！？、，；：)\]”’]/u.test(right.trimStart()))return false;
    return !wordEnds.size||!cjk.test(left.at(-1)!)||!cjk.test(right[0])||wordEnds.has(offsets[index]);
  };
  const penalty=(index:number)=>{
    if(groupCuts.has(index))return 1000;
    const left=fragments[index-1].trimEnd().replace(/["'”’）)\]]+$/u,'');
    return /[,;:，；：、—–-]$/u.test(left)?0:tokens[index-1].eventIndex!==tokens[index].eventIndex?25:50;
  };
  const leadingSpace=(index:number)=>fragments[index]?.match(/^\s*/u)![0].length||0;
  const begin=(index:number)=>offsets[index]+leadingSpace(index);
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'sentence'}):null;
  let from=0;
  function emit(to:number){
    const start=tokens[from].start;let end=start;
    for(let index=from;index<to;index++)end=Math.max(end,tokens[index].end);
    const value=text.slice(offsets[from],offsets[to]).trim();
    if(value&&end>start)cues.push({start,end,text:value});
    from=to;
  }
  function chooseCut(to:number){
    const origin=begin(from),length=offsets[to]-origin,max=Math.min(length-MIN_CHARS,MAX_CHARS);
    const target=length/Math.ceil(length/MAX_CHARS);let best=-1,bestScore=Infinity;
    for(let index=from+1;index<to;index++){
      const size=begin(index)-origin;
      if(size>max)break;
      if(size<MIN_CHARS||tokens[index].start<=tokens[from].start||!safeBoundary(index))continue;
      const score=Math.abs(size-target)+penalty(index);
      if(score<bestScore){best=index;bestScore=score;}
    }
    return best;
  }
  function emitSentence(to:number){
    while(offsets[to]-begin(from)>MAX_CHARS){
      const cut=chooseCut(to);if(cut<0)break;emit(cut);
    }
    if(to>from)emit(to);
  }
  function tokenBoundary(position:number,to:number){
    let low=from+1,high=to;
    while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<position)low=mid+1;else high=mid;}
    return low;
  }
  // SelectTranslate's GXe buffers unfinished tails, segments complete sentences
  // with Intl.Segmenter, and balances only sentences longer than 120 characters.
  // Process at original event boundaries so short completed source cues keep
  // their own timing instead of being merged with the following sentence.
  for(let to=1;to<=tokens.length;to++){
    if(to<tokens.length&&tokens[to-1].eventIndex===tokens[to].eventIndex)continue;
    if(from===to)continue;
    const origin=begin(from),buffer=text.slice(origin,offsets[to]);
    const sentences=segmenter?[...segmenter.segment(buffer.replace(/[\r\n]/gu,' '))]:[{segment:buffer,index:0}];
    const completed=sentenceEnd(buffer)?sentences.length:Math.max(0,sentences.length-1);
    let accumulated=0;
    for(let index=0;index<completed;index++){
      const sentence=sentences[index];accumulated+=sentence.segment.length;
      if(accumulated<MIN_CHARS&&index!==completed-1)continue;
      const position=origin+sentence.index+sentence.segment.trimEnd().length;
      const boundary=tokenBoundary(position,to);
      if(boundary<=from||boundary<tokens.length&&!safeBoundary(boundary))continue;
      emitSentence(boundary);accumulated=0;
    }
    while(from<to&&offsets[to]-begin(from)>MAX_CHARS*2){
      const cut=chooseCut(to);if(cut<0)break;emit(cut);
    }
  }
  if(from<tokens.length)emitSentence(tokens.length);
  return cues;
}
export function segmentAutomaticEvents(events:JsonCaptionEvent[],clean:(text:string)=>string):CaptionCue[] {
  const parts:Part[]=[],timedParts=new Map<string,Part>();let previousEvent:{lines:string[];start:number;end:number;window:string;hasOffsets:boolean;text:string;partStart:number}|null=null;
  for(let eventIndex=0;eventIndex<events.length;eventIndex++) {
    const event=events[eventIndex];let start=Number(event.tStartMs)/1000;
    const next=Number(events[eventIndex+1]?.tStartMs)/1000;
    const end=Number(event.dDurationMs)>0?start+Number(event.dDurationMs)/1000:next>start?next:start+4;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)continue;
    let segments=event.segs.filter(segment=>typeof segment.utf8==='string').map(segment=>({...segment,utf8:clean(segment.utf8)}));
    const hasOffsets=segments.some(segment=>segment.tOffsetMs!==undefined);
    const full=segments.map(segment=>segment.utf8).join('').trim();
    if(!full)continue;
    const window=String(event.wWinId??'');
    const normalized=full.replace(/\s+/gu,' ');let replacedWindow=false;
    // SelectTranslate collapses progressive windows before sentence grouping.
    // Require an actual overlap, same window and a strictly growing word prefix;
    // equal repeated speech and explicitly timed segments remain untouched.
    if(previousEvent&&!hasOffsets&&!previousEvent.hasOffsets&&!event.aAppend&&
      start<previousEvent.end&&window===previousEvent.window&&
      normalized.length>previousEvent.text.length&&normalized.startsWith(previousEvent.text)&&
      /[ ,.，]/u.test(normalized[previousEvent.text.length])){
      parts.splice(previousEvent.partStart);start=previousEvent.start;replacedWindow=true;
    }

    // Exact repeated *lines* in overlapping rolling windows, never fuzzy word removal.
    const lines=full.split('\n').map(line=>line.trim()).filter(Boolean);
    if(!replacedWindow&&!hasOffsets&&!previousEvent?.hasOffsets&&previousEvent&&start<previousEvent.end&&window===previousEvent.window&&lines.length>1&&previousEvent.lines.length>1) {
      let overlap=Math.min(lines.length,previousEvent.lines.length);
      while(overlap&&previousEvent.lines.slice(-overlap).join('\n')!==lines.slice(0,overlap).join('\n'))overlap--;
      if(overlap)segments=[{utf8:lines.slice(overlap).join('\n')}];
    }
    previousEvent={lines,start,end,window,hasOffsets,text:normalized,partStart:parts.length};
    // Whitespace-only segments carry lexical boundaries even though they have no words.
    const lexical:JsonSegment[]=[];let prefix='';
    for(const segment of segments){
      if(/^\s*$/.test(segment.utf8)){
        if(lexical.length)lexical.at(-1)!.utf8+=segment.utf8;else prefix+=segment.utf8;
      }else{lexical.push({...segment,utf8:prefix+segment.utf8});prefix='';}
    }
    segments=lexical;
    const {times,explicit}=segmentTimes(segments,start,end);
    for(let index=0;index<segments.length;index++) {
      const segment=segments[index],text=segment.utf8.trim();
      const anchored=explicit.has(index),segmentStart=times[index],segmentEnd=times[index+1];
      if(!text)continue;
      // Dedupe only the same explicitly timed text in an overlapping event of the same window.
      const key=JSON.stringify([window,segmentStart,text]),prior=anchored?timedParts.get(key):null;
      if(prior&&prior.eventIndex!==eventIndex&&prior.eventEnd>start){prior.end=Math.max(prior.end,segmentEnd);continue;}
      const part={text:segment.utf8.match(/^\s*/)![0]+text+segment.utf8.match(/\s*$/)![0],start:segmentStart,end:Math.max(segmentStart,segmentEnd),eventEnd:end,eventIndex};
      parts.push(part);if(anchored)timedParts.set(key,part);
    }
  }
  return segmentParts(parts);
}

/** Apply the same sentence grouping to already decoded, ordered authored cues. */
export function segmentCaptionCues(cues:readonly CaptionCue[]):CaptionCue[]{
  return segmentParts(cues.map((cue,eventIndex)=>({text:cue.text,start:cue.start,end:cue.end,eventEnd:cue.end,eventIndex})));
}
function segmentParts(parts:Part[]):CaptionCue[]{
  // Stable chronological order retains segment ordering at equal offsets.
  parts.sort((a,b)=>a.start-b.start);
  const ordered:Part[]=[];
  for(const part of parts){
    const previous=ordered.at(-1);
    if(previous?.start===part.start){previous.text=previous.eventIndex===part.eventIndex?previous.text+part.text:join(previous.text,part.text);previous.end=Math.max(previous.end,part.end);}
    else ordered.push({...part});
  }
  for(let index=0;index<ordered.length-1;index++)ordered[index].end=Math.min(ordered[index].end,ordered[index+1].start);
  const tokens:Token[]=[],sentenceTokenizer=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'sentence'}):null;
  for(const part of ordered) {
    const isolated=sound.test(part.text.trim()),label=speaker.test(part.text.trimStart());
    const matches:{0:string;index:number}[]=[];
    if(isolated)matches.push({0:part.text,index:0});
    else{
      // Preserve real sentence endpoints even without separating whitespace:
      // lexical tokenization alone would keep "question!Another" in one token.
      const sentences=sentenceTokenizer?sentenceTokenizer.segment(part.text.replace(/[\r\n]/gu,' ')):[{index:0,segment:part.text}];
      for(const sentence of sentences){
        const source=part.text.slice(sentence.index,sentence.index+sentence.segment.length);
        for(const match of source.matchAll(units)){
          const index=sentence.index+match.index,previous=matches.at(-1);
          const end=previous?previous.index+previous[0].length:index;
          const whitespace=part.text.slice(end,index);
          // Intl assigns the separating space to the previous sentence. Keep
          // that source whitespace even though lexical matching omits its tail.
          matches.push(previous&&/^\s+$/u.test(whitespace)?{0:whitespace+match[0],index:end}:{0:match[0],index});
        }
      }
    }
    for(let index=0;index<matches.length;index++) {
      const match=matches[index],finish=index+1<matches.length?matches[index+1].index:part.text.length;
      const token={text:match[0]+(index===matches.length-1?part.text.match(/\s*$/)![0]:''),start:part.start+(part.end-part.start)*match.index/part.text.length,end:part.start+(part.end-part.start)*finish/part.text.length,
        boundaryBefore:(index===0&&(isolated||label))||sound.test(match[0].trim())||(/\n/.test(match[0])&&speaker.test(part.text.slice(match.index).trimStart())),boundaryAfter:isolated||sound.test(match[0].trim()),eventIndex:part.eventIndex,part};
      const prior=tokens.at(-1);
      if(prior&&prior.eventIndex===token.eventIndex&&prior.part!==part&&/[\p{L}\p{N}]$/u.test(prior.text)&&/^[\p{L}\p{N}]/u.test(token.text)&&!cjk.test(prior.text.at(-1)!)&&!cjk.test(token.text[0])){
        prior.text+=token.text;prior.end=token.end;prior.boundaryAfter=token.boundaryAfter;
      }else tokens.push(token);
    }
  }
  // Rolling display durations can extend beyond the next spoken segment.
  for(let index=0;index<tokens.length-1;index++)if(tokens[index+1].start>tokens[index].start)tokens[index].end=Math.min(tokens[index].end,tokens[index+1].start);
  const cues:CaptionCue[]=[];let phrase:Token[]=[],end=0;
  const flush=()=>{for(const cue of phraseCues(phrase))cues.push(cue);phrase=[];end=0;};
  for(let index=0;index<tokens.length;index++) {
    const token=tokens[index];
    if(phrase.length&&token.start>phrase[0].start&&(token.boundaryBefore||token.start-end>=PAUSE_SECONDS))flush();
    phrase.push(token);end=Math.max(end,token.end);
    if(token.boundaryAfter)flush();
  }
  flush();
  return cues;
}
