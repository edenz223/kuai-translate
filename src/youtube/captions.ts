import type {CaptionCue,CaptionTrack,JsonCaptionEvent} from './types.js';
interface RawTrack {baseUrl?:unknown;languageCode?:unknown;kind?:unknown;name?:string|{simpleText?:string;runs?:{text?:string}[]};vssId?:unknown;id?:unknown}
import {segmentAutomaticEvents} from './asr-segmentation.js';
/** Parse caption data, never markup into the page. All returned text is rendered as textContent. */
const MAX_BODY=4_000_000;
const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',lrm:'\u200e',rlm:'\u200f'};
export function captionText(value:unknown,{trim=true}={}) {
  const text=String(value ?? '').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?[a-z][^>]*>/gi,'')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(whole:string,key:string)=>{
      if(key[0]==='#') {const code=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}
      return entities[key.toLowerCase()] ?? whole;
    }).replace(/\r/g,'');
  return trim?text.trim():text;
}
function normalized(cues:CaptionCue[],{alreadyClean=false}={}):CaptionCue[] {
  const result:CaptionCue[]=[],seen=new Set<string>();
  for(const cue of cues.sort((a,b)=>a.start-b.start)) {
    const text=alreadyClean?cue.text.trim():captionText(cue.text),key=cue.start+'|'+cue.end+'|'+text;
    if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end<=cue.start||!text||seen.has(key))continue;
    seen.add(key);result.push({start:cue.start,end:cue.end,text,translation:'',status:'pending'});
    if(result.length===50_000)break;
  }
  return result;
}
function jsonCues(data:{events?:JsonCaptionEvent[]}|null,options?:{kind?:string}) {
  if(!Array.isArray(data?.events))throw new Error('字幕 JSON 缺少 events');
  const events=data.events.filter(event=>Array.isArray(event.segs)).slice(0,60_000).sort((a,b)=>(a.tStartMs as number)-(b.tStartMs as number)),cues:CaptionCue[]=[];
  if(options?.kind==='asr')return normalized(segmentAutomaticEvents(events,value=>captionText(value,{trim:false})),{alreadyClean:true});
  events.forEach((event,index)=>{
    const start=Number(event.tStartMs)/1000;
    const end=(event.dDurationMs as number)>0?start+Number(event.dDurationMs)/1000:Number(events[index+1]?.tStartMs)/1000||start+4;
    const text=event.segs.map(segment=>typeof segment.utf8==='string'?segment.utf8:'').join('');
    const previous=cues.at(-1);
    if(event.aAppend && previous && start>=previous.start && start<=previous.end+0.5) {
      previous.text+=text;previous.end=Math.max(previous.end,end);
    } else cues.push({start,end,text});
  });
  return normalized(cues);
}
function timestamp(value:string) {
  const parts=value.replace(',','.').split(':').map(Number);
  if(parts.some(part=>!Number.isFinite(part))||parts.length<2||parts.length>3)return NaN;
  return parts.reduce((sum,part)=>sum*60+part,0);
}
function vttCues(body:string) {
  const cues:CaptionCue[]=[];
  for(const block of body.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/)) {
    const lines=block.split('\n');
    if(/^(?:WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0]))continue;
    const index=lines.findIndex(line=>line.includes('-->'));
    if(index<0)continue;
    const match=lines[index].match(/([\d:.,]+)\s+-->\s+([\d:.,]+)/);
    if(match)cues.push({start:timestamp(match[1]),end:timestamp(match[2]),text:lines.slice(index+1).join('\n')});
  }
  return normalized(cues);
}
function xmlCues(body:string) {
  const cues:CaptionCue[]=[];
  for(const match of body.matchAll(/<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(item=>[item[1],item[2]]));
    const start=match[1].toLowerCase()==='p'?Number(attrs.t)/1000:Number(attrs.start);
    const duration=match[1].toLowerCase()==='p'?Number(attrs.d)/1000:Number(attrs.dur);
    cues.push({start,end:start+duration,text:match[3]});
  }
  return normalized(cues);
}
export function parseTimedText(input:unknown,options?:{kind?:string}):CaptionCue[] {
  if(input && typeof input==='object')return jsonCues(input as {events?:JsonCaptionEvent[]},options);
  if(typeof input!=='string'||input.length>MAX_BODY)throw new Error('字幕数据无效或过大');
  const body=input.trim();
  if(!body)return [];
  if(body[0]==='{')return jsonCues(JSON.parse(body),options);
  if(/^WEBVTT|\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->/m.test(body))return vttCues(body);
  if(/<(?:transcript|timedtext)\b/i.test(body))return xmlCues(body);
  throw new Error('无法识别字幕格式');
}
export function videoIdFromUrl(value:string|URL) {
  try {
    const url=new URL(value);
    if(!/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname))return '';
    const id=url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || '';
    return /^[a-z0-9_-]{6,64}$/i.test(id)?id:'';
  } catch{return '';}
}
export function validateTrack(track:unknown,videoId:string):CaptionTrack|null {
  if(!track||typeof (track as RawTrack).baseUrl!=='string'||((track as RawTrack).baseUrl as string).length>12000)return null;
  try {
    const url=new URL((track as RawTrack).baseUrl as string);
    if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname)||url.pathname!=='/api/timedtext'||url.searchParams.get('v')!==videoId)return null;
    const languageCode=String((track as RawTrack).languageCode||url.searchParams.get('lang')||'auto').slice(0,32);
    const kind=(track as RawTrack).kind==='asr'||url.searchParams.get('kind')==='asr'?'asr':'';
    const name=typeof (track as RawTrack).name==='string'?(track as RawTrack).name:((track as RawTrack).name as Exclude<RawTrack['name'],string>)?.simpleText||((track as RawTrack).name as Exclude<RawTrack['name'],string>)?.runs?.map(run=>run.text||'').join('')||languageCode;
    return {id:String((track as RawTrack).vssId||(track as RawTrack).id||languageCode+':'+kind).slice(0,100),baseUrl:url.href,languageCode,kind,name:String(name).slice(0,160)};
  } catch{return null;}
}
