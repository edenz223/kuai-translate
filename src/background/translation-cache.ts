export const TRANSLATION_CACHE_KEY='kuai.translation-cache.v1';
const MAX_ENTRIES=5000,MAX_BYTES=4*1024*1024,WRITE_DELAY_MS=1000;
const encoder=new TextEncoder();
const usable=(value:unknown):value is string=>typeof value==='string'&&!!value.replace(/[\u200b-\u200d\ufeff]/g,'').trim();

/** Only digests and translated strings reach session storage, never provider configuration. */
export async function translationCacheKey(identity:string,sourceLanguage:string,targetLanguage:string,text:string):Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([identity,sourceLanguage,targetLanguage,text])));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Map order is oldest first, including in the persisted snapshot. */
export function createTranslationCache({storage,maxEntries=MAX_ENTRIES,maxBytes=MAX_BYTES}:{storage?:chrome.storage.SessionStorageArea;maxEntries?:number;maxBytes?:number}={}) {
  const entries=new Map<string,{value:string;bytes:number}>();
  // Reserve the storage key, outer object, array brackets and UTF-8 JSON separators.
  let bytes=encoder.encode(JSON.stringify({[TRANSLATION_CACHE_KEY]:[]})).byteLength;
  let timer:ReturnType<typeof setTimeout>|undefined,dirty=false,queue:Promise<void>=Promise.resolve();
  function put(key:string,value:string) {
    const previous=entries.get(key);if(previous){bytes-=previous.bytes;entries.delete(key);}
    const size=encoder.encode(JSON.stringify([key,value])).byteLength+1;
    entries.set(key,{value,bytes:size});bytes+=size;
    while(entries.size>maxEntries || bytes>maxBytes){
      const oldest=entries.keys().next().value;if(oldest===undefined)break;
      bytes-=entries.get(oldest)!.bytes;entries.delete(oldest);
    }
  }
  function flush():Promise<void> {
    clearTimeout(timer);timer=undefined;
    if(!dirty || !storage)return queue;
    dirty=false;
    const snapshot=Array.from(entries,([key,entry])=>[key,entry.value]);
    queue=queue.then(async()=>{
      try{await storage?.set({[TRANSLATION_CACHE_KEY]:snapshot});}catch{storage=undefined;}
    });
    return queue;
  }
  function changed() {
    if(!storage)return;
    dirty=true;
    // Coalesce bursts without postponing persistence indefinitely on a busy page.
    timer??=setTimeout(()=>{void flush();},WRITE_DELAY_MS);
  }
  async function initialize() {
    if(!storage)return;
    try{
      await storage.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
      const stored=(await storage.get(TRANSLATION_CACHE_KEY))[TRANSLATION_CACHE_KEY];
      if(!Array.isArray(stored))return;
      for(const entry of stored)if(Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&/^[a-f0-9]{64}$/.test(entry[0])&&usable(entry[1]))put(entry[0],entry[1]);
    }catch{storage=undefined;}
  }
  return {initialize,flush,
    get(key:string):string|undefined {
      const entry=entries.get(key);if(!entry)return;
      // Recency is refreshed in memory only; rewriting the whole snapshot on every hit is too costly.
      entries.delete(key);entries.set(key,entry);return entry.value;
    },
    set(key:string,value:string) {if(usable(value)){put(key,value);changed();}},
  };
}
