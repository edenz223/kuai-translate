interface CaptureRawTrack {baseUrl?:unknown;url?:unknown;languageCode?:unknown;kind?:unknown;vssId?:unknown;name?:{simpleText?:unknown;runs?:{text?:unknown}[]}}
interface CapturePlayerResponse {videoDetails?:{videoId?:string;isLive?:boolean};captions?:{playerCaptionsTracklistRenderer?:{captionTracks?:CaptureRawTrack[]}}}
interface CapturePlayer extends Element {getPlayerResponse?:()=>unknown;getOption?:(module:string,key:string)=>CaptureRawTrack;getAudioTrack?:()=>{captionTracks?:CaptureRawTrack[]};setOption?:(module:string,key:string,value:unknown)=>void}
interface CaptureRequest {source?:unknown;kind?:string;requestId?:string;videoId?:string;url?:unknown}
interface Window {__kuaiCaptionCapture?:boolean;ytInitialPlayerResponse?:unknown}
/* Runs only on YouTube in MAIN world. Reads caption data; has no extension API or provider secrets. */
(() => {
  'use strict';
  if(window.__kuaiCaptionCapture)return;
  window.__kuaiCaptionCapture=true;
  const nativeFetch=window.fetch.bind(window),MAX=4_000_000,active=new Map<string,AbortController>();
  let lastSignature='';
  const captures=new Map<string,{videoId:string;languageCode:string;trackUrl:string;body:string}>();
  function remember(url:URL,body:string){
    if(!body.trim()||!timedURL(url.href))return;
    const data={videoId:videoId(),languageCode:url.searchParams.get('lang')||'',trackUrl:url.href,body};
    captures.delete(url.href);captures.set(url.href,data);
    while(captures.size>4)captures.delete(captures.keys().next().value!);
    emit({kind:'captions',...data});
  }
  function hasCaptionText(body:string){
    if(!body.trim())return false;
    if(body.trimStart().startsWith('{'))try{
      const data=JSON.parse(body);
      return Array.isArray(data.events)&&data.events.some((event:{segs?:{utf8?:unknown}[]})=>Array.isArray(event?.segs)&&event.segs.some(segment=>typeof segment?.utf8==='string'&&segment.utf8.trim()));
    }catch{return false;}
    return /(?:^WEBVTT|-->)/m.test(body)||/<(?:text|p)\b[^>]*>[\s\S]*?[^>\s][\s\S]*?<\/(?:text|p)>/i.test(body);
  }
  function players(){return Array.from(document.querySelectorAll<CapturePlayer>('.html5-video-player'));}
  function runtimeTracks(){
    return players().flatMap(player=>{try{
      const response=player.getPlayerResponse?.() as CapturePlayerResponse|undefined;
      if(response?.videoDetails?.videoId&&response.videoDetails.videoId!==videoId())return [];
      return (player.getAudioTrack?.()?.captionTracks||[]).slice(0,100).map(track=>({...track,baseUrl:track.baseUrl||track.url}));
    }catch{return [];}});
  }
  function sameTrack(a:URL,b:URL){return ['v','lang','kind','name','tlang'].every(key=>(a.searchParams.get(key)||'')===(b.searchParams.get(key)||''));}
  function videoId(){try{const url=new URL(location.href);return url.searchParams.get('v')||url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]||'';}catch{return '';}}
  function emit(data:Record<string,unknown>){window.postMessage({source:'kuai-youtube-data',...data},location.origin);}
  function timedURL(value:unknown,id=videoId()) {
    try {const url=new URL(value as string,location.href);return url.protocol==='https:'&&!url.username&&!url.password&&/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname)&&url.pathname==='/api/timedtext'&&url.searchParams.get('v')===id?url:null;}catch{return null;}
  }
  function tracksFrom(response:unknown,force=false,selectedLanguage='') {
    const id=(response as CapturePlayerResponse|null)?.videoDetails?.videoId,raw=(response as CapturePlayerResponse|null)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if(!id||id!==videoId()||!Array.isArray(raw))return false;
    const runtime=runtimeTracks();
    const tracks=raw.slice(0,100).map(track=>{
      const base=timedURL(track.baseUrl,id);
      const live=runtime.find(item=>{const url=timedURL(item.baseUrl,id);return base&&url&&sameTrack(base,url)&&(!track.vssId||!item.vssId||track.vssId===item.vssId);});
      return live?{...track,baseUrl:live.baseUrl}:track;
    }).filter(track=>timedURL(track.baseUrl,id)).map(track=>({
      baseUrl:track.baseUrl,languageCode:String(track.languageCode||'auto').slice(0,32),kind:track.kind==='asr'?'asr':'',
      vssId:String(track.vssId||'').slice(0,100),name:String(track.name?.simpleText||track.name?.runs?.map(run=>run.text||'').join('')||track.languageCode||'').slice(0,160),
    }));
    publish(id,tracks,selectedLanguage,(response as CapturePlayerResponse).videoDetails?.isLive===true,force);
    return true;
  }
  function publish(id:string,tracks:unknown[],selectedLanguage:string,live:boolean,force:boolean) {
    const signature=JSON.stringify([id,tracks,selectedLanguage,live]);
    if(force||signature!==lastSignature){lastSignature=signature;emit({kind:'tracks',videoId:id,tracks,selectedLanguage,live});}
  }
  function discover(force=false) {
    if(document.visibilityState==='hidden'&&!force)return;
    let bare:CapturePlayerResponse|undefined;
    const read=(response:unknown,selectedLanguage='')=>{
      if(tracksFrom(response,force,selectedLanguage))return true;
      const id=(response as CapturePlayerResponse|null)?.videoDetails?.videoId;
      if(id&&id===videoId())bare=response as CapturePlayerResponse;
      return false;
    };
    for(const player of document.querySelectorAll<CapturePlayer>('.html5-video-player')){
      // The live player owns the current track selection. Initial page data is only a fallback.
      try{if(read(player.getPlayerResponse?.(),String(player.getOption?.('captions','track')?.languageCode||'')))return;}catch{}
    }
    try{if(read(window.ytInitialPlayerResponse))return;}catch{}
    // The player answered for this video without listing any caption track.
    if(bare)publish(videoId(),[],'',bare.videoDetails?.isLive===true,force);
  }
  async function readBounded(response:Response,signal?:AbortSignal) {
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
  async function capture(response:Response,value:string) {
    let url;try{url=new URL(value as string,location.href);}catch{return;}
    if(!/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname))return;
    try {
      if(timedURL(url.href)){
        const id=url.searchParams.get('v'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try {const body=await readBounded(response.clone(),controller.signal);if(id===videoId())remember(url,body);}finally{clearTimeout(timer);}
      } else if(url.pathname==='/youtubei/v1/player'){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{tracksFrom(JSON.parse(await readBounded(response.clone(),controller.signal)));}finally{clearTimeout(timer);}
      }
    } catch { /* The page's original response is untouched even when capture fails. */ }
  }
  window.fetch=async function(input,init){
    const response=await nativeFetch(input,init),url=typeof input==='string'?input:(input as Request)?.url||String(input);
    void capture(response,url);return response;
  };
  if(typeof XMLHttpRequest!=='undefined') {
    const originalOpen=XMLHttpRequest.prototype.open as (this:XMLHttpRequest,method:string,url:string|URL,...args:unknown[])=>void,originalSend=XMLHttpRequest.prototype.send,urls=new WeakMap<XMLHttpRequest,string>();
    XMLHttpRequest.prototype.open=function(method:string,url:string|URL,...args:unknown[]){urls.set(this,String(url));return originalOpen.call(this,method,url,...args);};
    XMLHttpRequest.prototype.send=function(...args){
      this.addEventListener('load',()=>{
        try {
          const url=new URL(this.responseURL||urls.get(this)!,location.href);
          if(timedURL(url.href)){
            const body=this.responseType==='json'?JSON.stringify(this.response):this.responseText;
            if(typeof body==='string'&&body.length<=MAX)remember(url,body);
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
    const data=event.data as CaptureRequest;
    if(data.kind==='request-tracks'){discover(true);for(const capture of captures.values())if(capture.videoId===videoId())emit({kind:'captions',...capture});return;}
    if(!['fetch-track','cancel-track'].includes(data.kind!)||typeof data.requestId!=='string'||data.requestId.length>100||data.videoId!==videoId())return;
    if(data.kind==='cancel-track'){
      const controller=active.get(data.requestId!);
      if(controller){active.delete(data.requestId!);controller.abort();}
      return;
    }
    const url=timedURL(data.url,data.videoId);
    if(!url||active.has(data.requestId!)||active.size>=2)return;
    url.searchParams.set('fmt','json3');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);active.set(data.requestId!,controller);
    try {
      const attempted=new Set<string>();
      let body='',received=url;
      // Runtime/captured URLs may include fresh proof tokens absent from page metadata.
      for(let pass=0;pass<2;pass++){
        const candidates=[...Array.from(captures.values()).reverse().filter(item=>item.videoId===data.videoId).map(item=>item.trackUrl),...runtimeTracks().map(item=>item.baseUrl),url.href];
        for(const value of candidates){
          const candidate=timedURL(value,data.videoId);
          if(!candidate||!sameTrack(url,candidate))continue;
          candidate.searchParams.set('fmt','json3');
          if(attempted.has(candidate.href))continue;attempted.add(candidate.href);
          if(controller.signal.aborted||data.videoId!==videoId())throw new Error('Stale caption request');
          const response=await nativeFetch(candidate.href,{credentials:'include',signal:controller.signal});
          if(!response.ok){if(response.status===429)throw new Error('Caption rate limited');continue;}
          body=await readBounded(response,controller.signal);received=candidate;
          if(hasCaptionText(body))break;
        }
        if(hasCaptionText(body))break;
        if(pass===0){
          const before=JSON.stringify(runtimeTracks());
          for(const player of players())try{player.setOption?.('captions','reload',true);}catch{}
          // Native reload is asynchronous; allow its token-bearing request to arrive.
          if(before===JSON.stringify(runtimeTracks()))await new Promise<void>((resolve,reject)=>{
            const cancel=()=>{clearTimeout(wait);reject(new Error('Caption request cancelled'));};
            const wait=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},500);
            if(controller.signal.aborted)cancel();else controller.signal.addEventListener('abort',cancel,{once:true});
          });
        }
      }
      if(data.videoId===videoId()&&active.get(data.requestId!)===controller&&!controller.signal.aborted)emit({kind:'captions',videoId:data.videoId,requestId:data.requestId,languageCode:received.searchParams.get('lang')||'',trackUrl:received.href,body});
    }catch{if(data.videoId===videoId()&&active.get(data.requestId!)===controller)emit({kind:'caption-error',videoId:data.videoId,requestId:data.requestId});}
    finally{clearTimeout(timer);if(active.get(data.requestId!)===controller)active.delete(data.requestId!);}
  });
  document.addEventListener('yt-navigate-start',()=>{lastSignature='';captures.clear();for(const controller of active.values())controller.abort();active.clear();});
  document.addEventListener('yt-navigate-finish',()=>discover(true));
  window.addEventListener('pageshow',()=>discover(true));
  setInterval(()=>discover(),2000);
  discover(true);
})();
