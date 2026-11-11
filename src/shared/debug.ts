import {redactEndpoint,secretProperty} from './redaction.js';

let enabled=false,verbose=false;
export function setDebug(on:boolean,details=false):void{enabled=!!on;verbose=!!details;}
export function isDebug():boolean{return enabled;}
const safeText=(value:string)=>value
  .replace(/https?:\/\/[^\s<>"']+/gi,url=>redactEndpoint(url)||'[URL]')
  .replace(/\bBearer\s+[\w.+/=-]+/gi,'Bearer [Redacted]')
  .replace(/((?:[\w-]*(?:key|token|secret|auth|password|signature|prompt)[\w-]*|original|translation|text|body)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;，；）)]+)/gi,'$1[Redacted]')
  .replace(/\b(?:sk|rk)-[\w-]{8,}|\bAIza[\w-]{20,}/g,'[Redacted]');

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
        // Native parser messages can quote settings, prompts or response text.
        const message=error instanceof SyntaxError?'语法错误（解析详情已省略）':safeText(error.message);
        const result:Record<string,unknown>={name:safeText(error.name),message};
        const code=error.code,status=error.status;
        if(typeof code==='string'||typeof code==='number')result.code=visit(code,depth+1);
        if(typeof status==='number')result.status=status;
        if(typeof error.stack==='string')result.stack=safeText(error.stack.replace(error.message,message));
        if('cause' in error)result.cause=visit(error.cause,depth+1);
        return result;
      }
      const result:Record<string,unknown>|unknown[]=Array.isArray(value)?[]:{};
      for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
        if(!descriptor.enumerable)continue;
        const item=descriptor.value;
        const clean=!('value' in descriptor)?'[Accessor]':/^(systemPrompt|userPrompt|prompt|texts?|original|translated|translations?|content|body)$/i.test(key)?{length:typeof item==='string'||Array.isArray(item)?item.length:0}:
          secretProperty.test(key)?typeof item==='string'?item.slice(0,4)+'…':'[Redacted]':visit(item,depth+1);
        Object.defineProperty(result,key,{value:clean,enumerable:true,configurable:true,writable:true});
      }
      return result;
    }catch{return '[Uninspectable]';}
  }
  return visit(value);
}

export type DebugCategory='网页'|'字幕'|'服务'|'设置'|'后台';
const colors:Record<DebugCategory,string>={'网页':'#2563eb','字幕':'#7c3aed','服务':'#0891b2','设置':'#64748b','后台':'#64748b'};

export function debugLabel(category:DebugCategory,message:string,warning=false):[string,string,string]{
  return [safeText(`[Kuai] ${warning?'✖ ':''}%c${category}%c ${message}`),
    `background:${warning?'#b45309':colors[category]};color:white;border-radius:3px;padding:1px 4px`,
    warning?'color:#b45309':'color:inherit'];
}

export function debug(category:DebugCategory,message:string,details?:unknown):void{
  if(!enabled||!verbose)return;
  console.info(...debugLabel(category,message),...(details!==undefined?[redact(details)]:[]));
}

export function debugFailure(error:unknown):string{
  const clean=redact(error),info=clean as {code?:unknown;message?:unknown}|null;
  const code=typeof info?.code==='string'||typeof info?.code==='number'?String(info.code):'UNKNOWN';
  const reason=typeof info?.message==='string'?info.message:typeof clean==='string'?clean:'未知错误';
  return safeText(code+' '+reason);
}

/** Errors stay visible even when process diagnostics are off. */
export function debugError(category:DebugCategory,message:string,error:unknown,details?:unknown):void{
  if(!enabled)return;
  console.warn(...debugLabel(category,message+'：'+debugFailure(error),true),...(details!==undefined?[redact(details)]:[]),redact(error));
}
