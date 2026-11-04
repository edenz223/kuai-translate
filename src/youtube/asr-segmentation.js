/** Local JSON3 ASR grouping. Authored tracks never pass through this helper.
 * Segment offsets anchor timing. Within an untimed segment, character position
 * estimates timing; it is not a claim about word-level audio alignment.
 */
const MAX_CHARS=120,MIN_CHARS=12,MAX_SECONDS=8,PAUSE_SECONDS=0.8;
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const units=/\s*(?:\[[^\]\n]+\]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[。！？、，；：]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}。！？、，；：]+)/gu;
const speaker=/^(?:>>\s*|[\p{L}][\p{L} .'-]{0,35}:\s)/u;
const sound=/^(?:\[[^\]]+\]|[♪♫].*)$/u;
function join(left,right) {
  if(!left)return right.trimStart();
  if(!right)return left;
  if(/\s$/.test(left)||/^\s/.test(right)||/^[,.;:!?。！？、，；：)\]”’]/u.test(right)||cjk.test(left.at(-1))||cjk.test(right[0]))return left+right;
  return left+' '+right;
}
function sentenceEnd(text) {
  const tail=text.trim().replace(/["'”’）)\]]+$/u,'');
  if(/[!?。！？…]$/u.test(tail))return true;
  if(!tail.endsWith('.'))return false;
  const word=tail.split(/\s+/).at(-1);
  // Conservative: retain ambiguous abbreviations; a pause/length bound can still end them.
  return !/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$/i.test(word)&&! /^(?:[A-Za-z]\.)+$/.test(word);
}
const continuesNumber=(left,right)=>/\d[,.，]?$/.test(left)&&/^[,.，]?\d/.test(right);
// Fill missing boundaries between monotonic valid anchors in source order.
// Conflicting/backwards offsets are ignored, never used to sort away source text.
function segmentTimes(segments,start,end) {
  const anchors=[{index:0,time:start}],explicit=new Set();
  for(let index=0;index<segments.length;index++){
    const raw=segments[index].tOffsetMs,offset=Number(raw),time=start+offset/1000;
    if(raw===undefined||!Number.isFinite(offset)||offset<0||time>=end||time<anchors.at(-1).time)continue;
    if(index===0)anchors[0]={index,time};else anchors.push({index,time});
    explicit.add(index);
  }
  anchors.push({index:segments.length,time:end});
  const times=[];
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
function phraseCues(tokens) {
  if(!tokens.length)return [];
  const fragments=[],offsets=[0];let tail='';
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index],fragment=index===0?token.text.trimStart():tokens[index-1].eventIndex===token.eventIndex?token.text:join(tail,token.text).slice(tail.length);
    fragments.push(fragment);offsets.push(offsets.at(-1)+fragment.length);tail=fragment.slice(-1)||tail;
  }
  const text=fragments.join(''),cues=[],numberCuts=new Set(),groupCuts=new Set();
  // Read the actual phrase around a boundary: punctuation can be its own token.
  // Three-digit space groups are a strong preference, not an unbounded lock:
  // spoken counts such as 100 101 102 have the same syntax as grouped numbers.
  const markCuts=(pattern,set)=>{
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
  const safeBoundary=index=>!numberCuts.has(index);
  const penalty=index=>{
    if(groupCuts.has(index))return 1000;
    const left=fragments[index-1].trimEnd().replace(/["'”’）)\]]+$/u,'');
    return /[,;:，；：、—–-]$/u.test(left)?0:tokens[index-1].eventIndex!==tokens[index].eventIndex?25:50;
  };
  for(let from=0;from<tokens.length;){
    const start=tokens[from].start,origin=offsets[from],remaining=text.length-origin;
    const duration=tokens.at(-1).end-start,pieces=Math.max(Math.ceil(remaining/MAX_CHARS),Math.ceil(duration/MAX_SECONDS));
    let to=tokens.length;
    if(pieces>1){
      const target=remaining/pieces;let best=-1,bestScore=Infinity,fallback=-1;
      for(let index=from+1;index<tokens.length;index++){
        if(tokens[index].start<=start||tokens[index-1].end<=start||!safeBoundary(index))continue;
        const length=offsets[index]-origin,seconds=tokens[index-1].end-start;
        if(length>MAX_CHARS||seconds>MAX_SECONDS){
          // A true indivisible word/number may exceed a soft target.
          if(fallback<0)fallback=index;
          break;
        }
        fallback=index;
        if(length<MIN_CHARS||remaining-length<MIN_CHARS)continue;
        const score=Math.abs(length-target)+penalty(index);
        if(score<bestScore){best=index;bestScore=score;}
      }
      to=best>=0?best:fallback>=0?fallback:tokens.length;
    }
    let end=start;
    for(let index=from;index<to;index++)end=Math.max(end,tokens[index].end);
    if(end>start)cues.push({start,end,text:text.slice(offsets[from],offsets[to]).trim()});
    from=to;
  }
  return cues;
}
export function segmentAutomaticEvents(events,clean) {
  const parts=[],timedParts=new Map();let previousEvent=null;
  for(let eventIndex=0;eventIndex<events.length;eventIndex++) {
    const event=events[eventIndex],start=Number(event.tStartMs)/1000;
    const next=Number(events[eventIndex+1]?.tStartMs)/1000;
    const end=Number(event.dDurationMs)>0?start+Number(event.dDurationMs)/1000:next>start?next:start+4;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)continue;
    let segments=event.segs.filter(segment=>typeof segment.utf8==='string').map(segment=>({...segment,utf8:clean(segment.utf8)}));
    const hasOffsets=segments.some(segment=>segment.tOffsetMs!==undefined);
    const full=segments.map(segment=>segment.utf8).join('').trim();
    if(!full)continue;
    const window=String(event.wWinId??'');
    // Exact repeated *lines* in overlapping rolling windows, never fuzzy word removal.
    const lines=full.split('\n').map(line=>line.trim()).filter(Boolean);
    if(!hasOffsets&&!previousEvent?.hasOffsets&&previousEvent&&start<previousEvent.end&&window===previousEvent.window&&lines.length>1&&previousEvent.lines.length>1) {
      let overlap=Math.min(lines.length,previousEvent.lines.length);
      while(overlap&&previousEvent.lines.slice(-overlap).join('\n')!==lines.slice(0,overlap).join('\n'))overlap--;
      if(overlap)segments=[{utf8:lines.slice(overlap).join('\n')}];
    }
    previousEvent={lines,end,window,hasOffsets};
    // Whitespace-only segments carry lexical boundaries even though they have no words.
    const lexical=[];let prefix='';
    for(const segment of segments){
      if(/^\s*$/.test(segment.utf8)){
        if(lexical.length)lexical.at(-1).utf8+=segment.utf8;else prefix+=segment.utf8;
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
      const part={text:segment.utf8.match(/^\s*/)[0]+text+segment.utf8.match(/\s*$/)[0],start:segmentStart,end:Math.max(segmentStart,segmentEnd),eventEnd:end,eventIndex};
      parts.push(part);if(anchored)timedParts.set(key,part);
    }
  }
  // Stable chronological order retains segment ordering at equal offsets.
  parts.sort((a,b)=>a.start-b.start);
  const ordered=[];
  for(const part of parts){
    const previous=ordered.at(-1);
    if(previous?.start===part.start){previous.text=previous.eventIndex===part.eventIndex?previous.text+part.text:join(previous.text,part.text);previous.end=Math.max(previous.end,part.end);}
    else ordered.push({...part});
  }
  for(let index=0;index<ordered.length-1;index++)ordered[index].end=Math.min(ordered[index].end,ordered[index+1].start);
  const tokens=[];
  for(const part of ordered) {
    const isolated=sound.test(part.text.trim()),label=speaker.test(part.text.trimStart());
    const matches=isolated?[{0:part.text,index:0}]:[...part.text.matchAll(units)];
    for(let index=0;index<matches.length;index++) {
      const match=matches[index],finish=index+1<matches.length?matches[index+1].index:part.text.length;
      const token={text:match[0]+(index===matches.length-1?part.text.match(/\s*$/)[0]:''),start:part.start+(part.end-part.start)*match.index/part.text.length,end:part.start+(part.end-part.start)*finish/part.text.length,
        boundaryBefore:(index===0&&(isolated||label))||sound.test(match[0].trim())||(/\n/.test(match[0])&&speaker.test(part.text.slice(match.index).trimStart())),boundaryAfter:isolated||sound.test(match[0].trim()),eventIndex:part.eventIndex,part};
      const prior=tokens.at(-1);
      if(prior&&prior.eventIndex===token.eventIndex&&prior.part!==part&&/[\p{L}\p{N}]$/u.test(prior.text)&&/^[\p{L}\p{N}]/u.test(token.text)&&!cjk.test(prior.text.at(-1))&&!cjk.test(token.text[0])){
        prior.text+=token.text;prior.end=token.end;prior.boundaryAfter=token.boundaryAfter;
      }else tokens.push(token);
    }
  }
  // Rolling display durations can extend beyond the next spoken segment.
  for(let index=0;index<tokens.length-1;index++)if(tokens[index+1].start>tokens[index].start)tokens[index].end=Math.min(tokens[index].end,tokens[index+1].start);
  const cues=[];let phrase=[],end=0;
  const flush=()=>{for(const cue of phraseCues(phrase))cues.push(cue);phrase=[];end=0;};
  for(let index=0;index<tokens.length;index++) {
    const token=tokens[index],next=tokens[index+1];
    if(phrase.length&&token.start>phrase[0].start&&(token.boundaryBefore||token.start-end>=PAUSE_SECONDS))flush();
    phrase.push(token);end=Math.max(end,token.end);
    const splitNumber=next&&next.eventIndex===token.eventIndex&&!/\s$/.test(token.text)&&!/^\s/.test(next.text)&&continuesNumber(token.text,next.text);
    if(token.boundaryAfter||(sentenceEnd(token.text)&&!splitNumber))flush();
  }
  flush();
  return cues;
}
