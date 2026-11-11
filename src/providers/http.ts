import {debug,isDebug} from '../shared/debug.js';
import {networkRequest,sanitizeNetworkRecord} from '../shared/network-log.js';
import type {NetworkRecord} from '../shared/messages.js';
export type NetworkObserver = (record:NetworkRecord)=>void;
import { failure, TranslationError } from './errors.js';

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RETRIES=2,MAX_RETRY_AFTER_MS=10000;
const deadlines=new WeakMap<AbortSignal,number>(),retryAfter=new WeakMap<TranslationError,number>();
const abortReason=(signal:AbortSignal)=>signal.reason instanceof TranslationError?signal.reason:failure('CANCELLED','Translation was cancelled.');

function wait(ms:number,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(abortReason(signal));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
}

/** Covers connection, body reading and parsing; a stalled transport cannot hang a job. */
export async function withRequestLifetime<T>(run:(signal:AbortSignal)=>Promise<T>, { signal, timeoutMs = 30000 }: {signal?:AbortSignal;timeoutMs?:number} = {}):Promise<T> {
  const controller = new AbortController();
  let rejectCancelled!: (error:Error)=>void, timer:ReturnType<typeof setTimeout>;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const abort = () => {
    const error=failure('CANCELLED', 'Translation was cancelled.');
    controller.abort(error);
    rejectCancelled(error);
  };
  const timedOut = () => {
    const error=failure('TIMEOUT', 'The translation service timed out. Please retry.');
    controller.abort(error);
    rejectCancelled(error);
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const lifetime=Math.max(1, Math.min(Number(timeoutMs) || 30000, 60000));
  deadlines.set(controller.signal,Date.now()+lifetime);
  timer = setTimeout(timedOut, lifetime);
  try {
    if (signal?.aborted) return await cancelled;
    return await Promise.race([run(controller.signal), cancelled]);
  } catch (error) {
    if (error instanceof TranslationError) throw error;
    if (signal?.aborted) throw failure('CANCELLED', 'Translation was cancelled.');
    throw failure('NETWORK_ERROR', 'Unable to reach the translation service. Check the connection and endpoint.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Stop remaining members of a parallel batch after any failure.
    controller.abort();
    deadlines.delete(controller.signal);
  }
}

/** Retry one HTTP call within its enclosing lifetime; every attempt owns a network record. */
export async function requestJSON(fetchImpl:typeof fetch, url:string|URL, options:RequestInit, signal:AbortSignal, onNetwork?:NetworkObserver,sleep=wait):Promise<any> {
  for(let retry=0;;retry++){
    try{return await requestAttempt(fetchImpl,url,options,signal,onNetwork);}
    catch(error){
      if(signal.aborted)throw abortReason(signal);
      if(!(error instanceof TranslationError) || !['HTTP_429','HTTP_503'].includes(error.code) || retry>=MAX_RETRIES)throw error;
      const delay=retryAfter.get(error) ?? 1000*2**retry+Math.random()*100;
      // Preserve the provider error when there is no budget left to wait and retry.
      if(delay>=((deadlines.get(signal) ?? Infinity)-Date.now()))throw error;
      debug('服务',`服务繁忙（${error.code}），${(delay/1000).toFixed(1)} s 后重试（第 ${retry+1} 次）`);
      await sleep(delay,signal);
      if(signal.aborted)throw abortReason(signal);
    }
  }
}

async function requestAttempt(fetchImpl:typeof fetch, url:string|URL, options:RequestInit, signal:AbortSignal, onNetwork?:NetworkObserver):Promise<any> {
  const started=Date.now(),recording=isDebug() || !!onNetwork;
  const record:NetworkRecord={
    ...(recording?networkRequest(url,options):{method:'GET',url:'',query:{},request:null,sentBytes:0}),
    status:'NETWORK_ERROR',ok:false,response:null,receivedBytes:0,durationMs:0,
  };
  let finished=false,rejectAbort!:(error:Error)=>void;
  const finish=(error?:TranslationError)=>{
    if(finished)return;
    finished=true;
    if(!recording)return;
    record.durationMs=Math.max(0,Date.now()-started);
    record.ok=!error;
    if(error){
      if(typeof record.status!=='number')record.status=error.code;
      record.error={code:error.code,message:error.message};
    }
    // Snapshot synchronously: aborted transports may settle after the job returns.
    const snapshot=sanitizeNetworkRecord(record);
    onNetwork?.(snapshot);
  };
  const cancelled=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{
    const error=signal.reason instanceof TranslationError?signal.reason:failure('CANCELLED','Translation was cancelled.');
    finish(error);rejectAbort(error);
  };
  signal.addEventListener('abort',abort,{once:true});
  async function read():Promise<any> {
    if(signal.aborted)throw signal.reason;
    const response = await fetchImpl(String(url), {
      ...options, signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if(signal.aborted){response.body?.cancel?.().catch(()=>{});throw signal.reason;}
    record.status=Number(response.status) || 0;
    const httpError=response.ok?undefined:failure('HTTP_' + record.status, `The translation service returned HTTP ${record.status}. Check its configuration or retry later.`);
    if(httpError){
      const header=response.headers?.get('retry-after')?.trim();
      if(header){
        const delay=/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:/[a-z]{3}/i.test(header)?Date.parse(header)-Date.now():NaN;
        if(Number.isFinite(delay)&&delay<=MAX_RETRY_AFTER_MS)retryAfter.set(httpError,Math.max(0,delay));
      }
    }
    const tooLarge=()=>httpError || failure('RESPONSE_TOO_LARGE', 'The translation response was too large. Use a smaller batch.');
    // Without diagnostics, preserve the existing HTTP-error fast path.
    if(httpError && !recording){response.body?.cancel?.().catch(()=>{});throw httpError;}
    if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) {
      response.body?.cancel?.().catch(() => {});throw tooLarge();
    }
    let body = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      const cancelReader = () => { reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancelReader, { once: true });
      if (signal.aborted) cancelReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if(signal.aborted)throw signal.reason;
          if (done) break;
          record.receivedBytes += value.byteLength;
          // Keep any readable prefix for oversized/error/aborted responses.
          const available=Math.max(0,MAX_RESPONSE_BYTES-(record.receivedBytes-value.byteLength));
          body += decoder.decode(value.subarray(0,available), { stream: true });
          if(recording)record.response=body;
          if (record.receivedBytes > MAX_RESPONSE_BYTES) throw tooLarge();
        }
        body += decoder.decode();
      } catch (error) {
        reader.cancel().catch(() => {});throw error;
      } finally { signal.removeEventListener('abort', cancelReader); reader.releaseLock(); }
    } else {
      body = await response.text();
      record.receivedBytes=new TextEncoder().encode(body).byteLength;
      if(recording)record.response=body;
      if (record.receivedBytes > MAX_RESPONSE_BYTES)throw tooLarge();
    }
    if(recording)record.response=body;
    if(signal.aborted)throw signal.reason;
    if(httpError){
      if(recording){try{record.response=JSON.parse(body);}catch{/* Keep the readable response text. */}}
      throw httpError;
    }
    let result;
    try {result=JSON.parse(body);}
    catch {throw failure('INVALID_RESPONSE', 'The translation service did not return valid JSON.');}
    if(recording)record.response=result;
    return result;
  }
  try {
    if(signal.aborted)abort();
    const result=await Promise.race([read(),cancelled]);
    finish();return result;
  } catch(error) {
    const failed=error instanceof TranslationError?error:signal.aborted?failure('CANCELLED','Translation was cancelled.'):failure('NETWORK_ERROR','Unable to reach the translation service. Check the connection and endpoint.');
    finish(failed);throw failed;
  } finally { signal.removeEventListener('abort',abort); }
}
