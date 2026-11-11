import {debug,debugError,isDebug} from './debug.js';
import type {NetworkDiagnostics,NetworkRecord} from './messages.js';

const encoder=new TextEncoder();
const TRUNCATED='[已截断]';
/** Match credential words, including camelCase, without hiding monkey/keyboard/author. */
function secretKey(key:string):boolean {
  const words=key.replace(/([A-Z]+)([A-Z][a-z])/g,'$1_$2').replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().split(/[^a-z0-9]+/);
  if(/^(?:(?:max|total|prompt|completion|input|output|cached|reasoning)_tokens?|token_count)$/.test(words.join('_')))return false;
  return words.some(word=>/key|token|secret|auth|password|signature/.test(word) &&
    !/^(?:monkeys?|keyboards?|authors?|authored|authoring|authority|authorities|tokenizer|tokenization|keyframes?|keynotes?|donkeys?|turkeys?|hockey)$/.test(word));
}
const mask=(value:unknown):unknown=>Array.isArray(value)?value.slice(0,200).map(mask):typeof value==='string'?value.slice(0,4)+'…':'[Redacted]';
const truncate=(value:string)=>value.length>4000?value.slice(0,4000)+`…(+${value.length-4000} 字)`:value;

function safeURL(value:string):string {
  try {
    const url=new URL(value);url.username='';url.password='';url.hash='';
    for(const key of new Set(url.searchParams.keys()))if(secretKey(key)){
      const values=url.searchParams.getAll(key);url.searchParams.delete(key);
      for(const item of values)url.searchParams.append(key,String(mask(item)));
    }
    return url.href;
  } catch { return value; }
}

function safeText(value:string):string {
  const urls:string[]=[];
  const clean=value.replace(/https?:\/\/[^\s<>"']+/gi,url=>`\u0000url${urls.push(safeURL(url))-1}\u0000`)
    .replace(/\bBearer\s+[\w.+/=-]+/gi,match=>'Bearer '+mask(match.slice(7)))
    .replace(/(?<![\w-])(["']?)([\w-]+)\1(\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;&}\]]+)/g,(match,quote,key,separator,raw)=>{
      if(!secretKey(key))return match;
      let value=raw;
      try{value=JSON.parse(raw);}catch{if(raw.startsWith("'"))value=raw.slice(1,-1);}
      return quote+key+quote+separator+JSON.stringify(mask(value));
    });
  return clean.replace(/\u0000url(\d+)\u0000/g,(_,index)=>urls[Number(index)]);
}

/** Separate from redact(): translation text, prompts and results remain inspectable.
 * Snapshot and bound the entire serialized record (UTF-8, including escaped strings).
 */
export function sanitizeNetworkRecord(record:NetworkRecord):NetworkRecord {
  let remaining=180000;
  const seen=new WeakSet<object>();
  const scalar=(value:unknown):unknown=>{
    const size=encoder.encode(JSON.stringify(value)).byteLength;
    if(size>remaining)return TRUNCATED;
    remaining-=size;return value;
  };
  const visit=(value:unknown,depth=0):any=>{
    if(typeof value==='string')return scalar(truncate(safeText(value)));
    if(value===null || typeof value==='boolean' || typeof value==='number')return scalar(value);
    if(typeof value!=='object')return null;
    if(depth>=20)return scalar('[Depth limit]');
    if(seen.has(value))return scalar('[Circular]');
    seen.add(value);remaining-=2;
    try {
      if(Array.isArray(value)){
        const result:unknown[]=[];
        for(const item of value.slice(0,200)){
          if(remaining<256)break;
          remaining--;result.push(visit(item,depth+1));
        }
        return result;
      }
      const result:Record<string,unknown>={};
      for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0,200)){
        if(!descriptor.enumerable)continue;
        // Always retain top-level fields, even after a very large body exhausts the budget.
        if(depth>0 && remaining<256)break;
        const cleanKey=truncate(key);
        const keyBytes=encoder.encode(JSON.stringify(cleanKey)).byteLength+2;
        if(depth>0 && keyBytes>remaining-256)break;
        remaining-=keyBytes;
        const item=!('value' in descriptor)?'[Accessor]':secretKey(key)?mask(descriptor.value):descriptor.value;
        Object.defineProperty(result,cleanKey,{value:remaining<256?TRUNCATED:visit(item,depth+1),enumerable:true});
      }
      return result;
    } finally {seen.delete(value);}
  };
  // Reserve the small identifying fields before inspecting potentially large payloads.
  return visit({method:record.method,url:record.url,status:record.status,ok:record.ok,
    sentBytes:record.sentBytes,receivedBytes:record.receivedBytes,durationMs:record.durationMs,
    ...(record.error?{error:record.error}:{}),query:record.query,request:record.request,response:record.response});
}

/** Query duplicates remain arrays; form bodies use the same representation. */
export function networkParameters(params:URLSearchParams):Record<string,string|string[]> {
  const result:Record<string,string|string[]>={};
  for(const key of new Set(params.keys())){
    const values=params.getAll(key);
    Object.defineProperty(result,key,{value:values.length===1?values[0]:values,enumerable:true});
  }
  return result;
}

export function networkRequest(url:string|URL,options:RequestInit):Pick<NetworkRecord,'method'|'url'|'query'|'request'|'sentBytes'> {
  let query:Record<string,string|string[]>={};
  try{query=networkParameters(new URL(url).searchParams);}catch{/* Invalid URLs are reported by fetch. */}
  const body=options.body;
  let request:unknown=null,sentBytes=0;
  if(typeof body==='string'){
    sentBytes=encoder.encode(body).byteLength;
    try{request=JSON.parse(body);}catch{
      const contentType=new Headers(options.headers).get('content-type') || '';
      request=/application\/x-www-form-urlencoded/i.test(contentType)?networkParameters(new URLSearchParams(body)):body;
    }
  }else if(body instanceof URLSearchParams){request=networkParameters(body);sentBytes=encoder.encode(String(body)).byteLength;}
  return {method:(options.method || 'GET').toUpperCase(),url:safeURL(String(url)),query,request,sentBytes};
}

export function formatNetworkRecord(record:NetworkRecord):string {
  let endpoint='[URL]';
  try{const url=new URL(record.url);endpoint=url.host+url.pathname;}catch{/* Invalid URL. */}
  return `${record.method} ${endpoint} → ${record.status} · ${record.durationMs} ms`;
}

/** Records are sanitized at collection; bypass the metadata-only debug redactor. */
export function debugNetworkRecord(record:NetworkRecord,scope='http'):void {
  if(!isDebug())return;
  console[record.ok?'info':'warn'](`[Kuai·${scope}] ${formatNetworkRecord(record)}`,record);
}

function batchRecords(scope:string,details?:NetworkDiagnostics):void {
  for(const record of details?.network || [])debugNetworkRecord(record,scope.replace(/:batch$/,':http'));
}

export function debugBatch(scope:string,message:string,result?:NetworkDiagnostics):void {
  if(!isDebug())return;
  debug(scope,message);batchRecords(scope,result);
}

export function debugBatchError(scope:string,message:string,error:unknown):void {
  if(!isDebug())return;
  const details=error && typeof error==='object'?error as NetworkDiagnostics:undefined;
  debugError(scope,message,error);batchRecords(scope,details);
}
