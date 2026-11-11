import {redactEndpoint,secretProperty} from './redaction.js';

let enabled=false;
export function setDebug(on:boolean):void{enabled=!!on;}
export function isDebug():boolean{return enabled;}
const safeText=(value:string)=>value.replace(/https?:\/\/[^\s<>"']+/gi,url=>redactEndpoint(url)||'[URL]');

/** Snapshot values so DevTools cannot later expand an unredacted reference. */
export function redact(value:unknown):unknown{
  const seen=new WeakSet<object>();
  function visit(value:unknown,depth=0):unknown{
    try{
      if(typeof value==='string')return safeText(value);
      if(value===null||typeof value!=='object')return typeof value==='function'?'[Function]':value;
      if(seen.has(value))return '[Circular]';
      if(depth>=20)return '[Depth limit]';
      seen.add(value);
      if(value instanceof URL)return redactEndpoint(value.href);
      if(value instanceof Error){
        const error=value as Error & {code?:unknown;status?:unknown};
        const result:Record<string,unknown>={name:safeText(error.name),message:safeText(error.message)};
        const code=error.code,status=error.status;
        if(typeof code==='string'||typeof code==='number')result.code=visit(code,depth+1);
        if(typeof status==='number')result.status=status;
        if(typeof error.stack==='string')result.stack=safeText(error.stack);
        if('cause' in error)result.cause=visit(error.cause,depth+1);
        return result;
      }
      const result:Record<string,unknown>|unknown[]=Array.isArray(value)?[]:{};
      for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
        if(!descriptor.enumerable)continue;
        const item=descriptor.value;
        const clean=!('value' in descriptor)?'[Accessor]':/^(systemPrompt|userPrompt)$/i.test(key)?{length:typeof item==='string'?item.length:0}:
          secretProperty.test(key)?typeof item==='string'?item.slice(0,4)+'…':'[Redacted]':visit(item,depth+1);
        Object.defineProperty(result,key,{value:clean,enumerable:true,configurable:true,writable:true});
      }
      return result;
    }catch{return '[Uninspectable]';}
  }
  return visit(value);
}

export function debug(scope:string,...args:unknown[]):void{
  if(!enabled)return;
  console.debug('[kuai:'+scope+']',...args.map(redact));
}
