/** The only content-to-background transport. No provider credential is sent by content. */
export function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() || 'kuai-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
}

export async function request(type, payload={}, chromeApi=globalThis.chrome) {
  if (!chromeApi?.runtime?.sendMessage) throw new Error('扩展未连接，请重新加载扩展并刷新页面');
  const response=await chromeApi.runtime.sendMessage({...payload,type});
  if (!response || response.ok!==true) {
    const error=new Error(response?.error?.message || '扩展没有返回有效结果，请重试');
    error.code=response?.error?.code || 'NO_RESPONSE';throw error;
  }
  return response.value;
}

export const getSettings = (includeSecrets=false) => request('KUAI_GET_SETTINGS',{includeSecrets});
export const cancel = requestId => request('KUAI_CANCEL',{requestId});
export const updatePreferences = patch => request('KUAI_UPDATE_PREFERENCES',{patch});
export const updatePagePreferences = patch => request('KUAI_UPDATE_PAGE_PREFERENCES',{patch});
export const openOptions = section => request('KUAI_OPEN_OPTIONS',{section});

export async function translate(texts, options={}) {
  const {signal,requestId=makeRequestId(),providerId,sourceLanguage,targetLanguage}=options;
  const aborted=()=>new DOMException('Translation cancelled','AbortError');
  if (signal?.aborted) throw aborted();
  let rejectAbort;
  const abortedResult=new Promise((resolve,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{cancel(requestId).catch(()=>{});rejectAbort(aborted());};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    const result=await Promise.race([request('KUAI_TRANSLATE',{requestId,texts,providerId,sourceLanguage,targetLanguage}),abortedResult]);
    if (signal?.aborted) throw aborted();
    return result;
  } finally { signal?.removeEventListener('abort',onAbort); }
}

export function onSettingsChanged(callback, chromeApi=globalThis.chrome) {
  const listener=message=>{if(message?.type==='KUAI_SETTINGS_CHANGED' && message.settings) callback(message.settings);};
  chromeApi.runtime.onMessage.addListener(listener);
  return ()=>chromeApi.runtime.onMessage.removeListener(listener);
}
