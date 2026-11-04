/* Runs only on YouTube in MAIN world. Reads caption data; has no extension API or provider secrets. */
(() => {
  'use strict';
  if(window.__kuaiCaptionCapture)return;
  window.__kuaiCaptionCapture=true;
  const nativeFetch=window.fetch.bind(window),MAX=4_000_000,active=new Map();
  let lastSignature='';
  function videoId(){try{const url=new URL(location.href);return url.searchParams.get('v')||url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]||'';}catch{return '';}}
  function emit(data){window.postMessage({source:'kuai-youtube-data',...data},location.origin);}
  function timedURL(value,id=videoId()) {
    try {const url=new URL(value,location.href);return url.protocol==='https:'&&!url.username&&!url.password&&/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname)&&url.pathname==='/api/timedtext'&&url.searchParams.get('v')===id?url:null;}catch{return null;}
  }
  function tracksFrom(response,force=false,selectedLanguage='') {
    const id=response?.videoDetails?.videoId,raw=response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if(!id||id!==videoId()||!Array.isArray(raw))return false;
    const tracks=raw.slice(0,100).filter(track=>timedURL(track.baseUrl,id)).map(track=>({
      baseUrl:track.baseUrl,languageCode:String(track.languageCode||'auto').slice(0,32),kind:track.kind==='asr'?'asr':'',
      vssId:String(track.vssId||'').slice(0,100),name:String(track.name?.simpleText||track.name?.runs?.map(run=>run.text||'').join('')||track.languageCode||'').slice(0,160),
    }));
    const signature=JSON.stringify([id,tracks,selectedLanguage]);
    if(force||signature!==lastSignature){lastSignature=signature;emit({kind:'tracks',videoId:id,tracks,selectedLanguage});}
    return true;
  }
  function discover(force=false) {
    if(document.visibilityState==='hidden'&&!force)return;
    for(const player of document.querySelectorAll('.html5-video-player')){
      // The live player owns the current track selection. Initial page data is only a fallback.
      try{if(tracksFrom(player.getPlayerResponse?.(),force,player.getOption?.('captions','track')?.languageCode||''))return;}catch{}
    }
    try{tracksFrom(window.ytInitialPlayerResponse,force);}catch{}
  }
  async function readBounded(response,signal) {
    if(Number(response.headers?.get('content-length'))>MAX)throw new Error('Caption body too large');
    if(!response.body?.getReader){const value=await response.text();if(value.length>MAX)throw new Error('Caption body too large');return value;}
    const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,body='';
    const abort=()=>{Promise.resolve(reader.cancel()).catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try{
      while(true){if(signal?.aborted)throw new Error('Caption request cancelled');const part=await reader.read();if(signal?.aborted)throw new Error('Caption request cancelled');if(part.done)break;size+=part.value.byteLength;if(size>MAX){await reader.cancel();throw new Error('Caption body too large');}body+=decoder.decode(part.value,{stream:true});}
      return body+decoder.decode();
    }finally{signal?.removeEventListener('abort',abort);reader.releaseLock?.();}
  }
  async function capture(response,value) {
    let url;try{url=new URL(value,location.href);}catch{return;}
    if(!/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname))return;
    try {
      if(timedURL(url.href)){
        const id=url.searchParams.get('v'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try {const body=await readBounded(response.clone(),controller.signal);if(id===videoId())emit({kind:'captions',videoId:id,languageCode:url.searchParams.get('lang')||'',trackUrl:url.href,body});}finally{clearTimeout(timer);}
      } else if(url.pathname==='/youtubei/v1/player'){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{tracksFrom(JSON.parse(await readBounded(response.clone(),controller.signal)));}finally{clearTimeout(timer);}
      }
    } catch { /* The page's original response is untouched even when capture fails. */ }
  }
  window.fetch=async function(input,init){
    const response=await nativeFetch(input,init),url=typeof input==='string'?input:input?.url||String(input);
    void capture(response,url);return response;
  };
  if(typeof XMLHttpRequest!=='undefined') {
    const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send,urls=new WeakMap();
    XMLHttpRequest.prototype.open=function(method,url,...args){urls.set(this,String(url));return originalOpen.call(this,method,url,...args);};
    XMLHttpRequest.prototype.send=function(...args){
      this.addEventListener('load',()=>{
        try {
          const url=new URL(this.responseURL||urls.get(this),location.href);
          if(timedURL(url.href)){
            const body=this.responseType==='json'?JSON.stringify(this.response):this.responseText;
            if(typeof body==='string'&&body.length<=MAX)emit({kind:'captions',videoId:url.searchParams.get('v'),languageCode:url.searchParams.get('lang')||'',trackUrl:url.href,body});
          }else if(/(^|\.)youtube\.com$/i.test(url.hostname)&&url.pathname==='/youtubei/v1/player'){
            const value=this.responseType==='json'?this.response:this.responseText.length<=MAX?JSON.parse(this.responseText):null;tracksFrom(value);
          }
        }catch{}
      },{once:true});
      return originalSend.apply(this,args);
    };
  }
  window.addEventListener('message',async event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.source!=='kuai-youtube-request')return;
    const data=event.data;
    if(data.kind==='request-tracks'){discover(true);return;}
    if(!['fetch-track','cancel-track'].includes(data.kind)||typeof data.requestId!=='string'||data.requestId.length>100||data.videoId!==videoId())return;
    if(data.kind==='cancel-track'){
      const controller=active.get(data.requestId);
      if(controller){active.delete(data.requestId);controller.abort();}
      return;
    }
    const url=timedURL(data.url,data.videoId);
    if(!url||active.has(data.requestId)||active.size>=2)return;
    url.searchParams.set('fmt','json3');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);active.set(data.requestId,controller);
    try {
      const response=await nativeFetch(url.href,{credentials:'include',signal:controller.signal});
      if(!response.ok)throw new Error('Caption HTTP error');
      const body=await readBounded(response,controller.signal);
      if(data.videoId===videoId()&&active.get(data.requestId)===controller&&!controller.signal.aborted)emit({kind:'captions',videoId:data.videoId,requestId:data.requestId,languageCode:url.searchParams.get('lang')||'',trackUrl:url.href,body});
    }catch{if(data.videoId===videoId()&&active.get(data.requestId)===controller)emit({kind:'caption-error',videoId:data.videoId,requestId:data.requestId});}
    finally{clearTimeout(timer);if(active.get(data.requestId)===controller)active.delete(data.requestId);}
  });
  document.addEventListener('yt-navigate-start',()=>{lastSignature='';for(const controller of active.values())controller.abort();active.clear();});
  document.addEventListener('yt-navigate-finish',()=>discover(true));
  window.addEventListener('pageshow',()=>discover(true));
  setInterval(()=>discover(),2000);
  discover(true);
})();
