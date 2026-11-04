import type {Settings} from '../shared/settings.js';
import type {CaptionCue,CaptionTrack,SubtitleSession,SubtitleBridge,TranslateSubtitles,SettingsPatch} from './types.js';
export interface YouTubeControllerOptions {
 settings:Settings;subscribeSettings?:(callback:(settings:Settings)=>void)=>(()=>void);translate:TranslateSubtitles;
 updatePreferences?:(patch:SettingsPatch)=>Promise<Settings|undefined>;openOptions?:(section:'subtitles')=>unknown;
 env?:typeof globalThis;createSidebar?:typeof sidebarAPI.createController;createSelection?:typeof selectionAPI.createController;createView?:typeof createCaptionView;
}
interface YouTubeRecord {session:SubtitleSession;videoId:string;togglePending:boolean;tracks:CaptionTrack[];track?:CaptionTrack;
 pending:{id:string;trackId:string;track:CaptionTrack;timer:ReturnType<typeof setTimeout>}|null;loadedTrack:string;failedTrack:string|undefined;timelineSignature:string;domText:string;view:ReturnType<typeof createCaptionView>}
interface YouTubeDataMessage {source?:unknown;videoId?:unknown;kind?:unknown;tracks?:unknown[];selectedLanguage?:unknown;requestId?:string;trackUrl?:string;languageCode?:string;body?:unknown}
// Runtime event names include YouTube custom events and native DOM events.
type BrowserEventCallback=(event:any)=>void;
import selectionAPI from './selection.js';
import sidebarAPI from './sidebar.js';
import {parseTimedText,validateTrack,videoIdFromUrl,captionText} from './captions.js';
import {createSubtitleSession} from './session.js';
import {createCaptionView} from './overlay.js';
import {subtitleStyle,subtitleLayoutKey} from './presentation.js';
import {navigationState} from './navigation.js';
import {normalizeSubtitleTrackPreference} from '../shared/settings.js';

/** Coordinates one current YouTube player, independent of the website's UI framework. */
export function createYouTubeController({settings,subscribeSettings,translate,updatePreferences,openOptions,env=globalThis,createSidebar=sidebarAPI.createController,createSelection=selectionAPI.createController,createView=createCaptionView}:YouTubeControllerOptions) {
  const doc=env.document,records=new Map<string,YouTubeRecord>(),subscribers=new Set<()=>void>(),listeners:(()=>void)[]=[];
  let config=settings,settingsEpoch=0,started=false,stopped=false,sequence=0,requestSequence=0,poll:ReturnType<typeof setInterval>|null=null,observer:MutationObserver|null=null,scheduled:ReturnType<typeof setTimeout>|null=null,unsubscribe:(()=>void)|undefined,noticePending=false,metadata:{videoId:string;tracks:CaptionTrack[];selectedLanguage:string}|null=null,lastVideoId='',navigateUntil=0;
  let sidebar:ReturnType<typeof sidebarAPI.createController>|undefined,selection:ReturnType<typeof selectionAPI.createController>|undefined,preferenceQueue:Promise<unknown>=Promise.resolve();
  const origin=()=>new URL(env.location.href).origin;
  const post=(data:Record<string,unknown>)=>env.postMessage({source:'kuai-youtube-request',...data},origin());
  const currentRecord=()=>records.values().next().value;
  function changed() {
    if(stopped)return;
    for(const record of records.values())record.view?.render(config);
    if(noticePending)return;noticePending=true;
    queueMicrotask(()=>{noticePending=false;if(!stopped)for(const callback of [...subscribers])callback();});
  }
  const bridge:SubtitleBridge={
    getSessions:()=>Array.from(records.values(),record=>record.session),
    getState:id=>records.get(id)?.session.state,
    getConfig:()=>{const style=subtitleStyle(config);return{isEnable:config.subtitlesEnabled?'1':'0',hideTranslation:style.hideTranslation?'1':'0',styleConfig:{displayOrder:style.displayOrder},subtitleStyle:style,subtitleListOpen:config.subtitleListOpen===true};},
    saveSidebarOpen:open=>preferences({subtitleListOpen:open}),
    reportPreferenceError:error=>currentRecord()?.view.reportError?.(error),
    getLanguage:()=>config.interfaceLanguage==='auto'?env.navigator?.language:config.interfaceLanguage,
    isEnabled:session=>records.get(session.id)?.session===session&&session.isEnabled(),
    isSelectionHeld:id=>!!records.get(id)?.session.state.isSubtitleSelectionHeld,
    getMediaKey:session=>videoIdFromUrl(env.location.href)+'|'+(session.video.currentSrc||''),
    getRoots:session=>{
      const record=records.get(session.id);if(record?.session!==session)return [];
      const player=session.video.closest?.('.html5-video-player');
      return [...record.view.getRoots(),...(sidebar?.getSelectionRoots(session.id)||[]),...Array.from(player?.querySelectorAll<HTMLElement>('.ytp-caption-segment')||[])];
    },
    onHold:(session,held)=>session.hold(held),
    cancelSelection:(id,reason)=>selection?.cancel(id,reason),
    translateCues:(id,cues)=>records.get(id)?.session.translateCues(cues)??false,
    seek:(id,time)=>{const session=records.get(id)?.session;if(!session?.isEnabled())return false;selection?.cancel(id,'seek');return session.seek(time);},
    subscribe:callback=>{subscribers.add(callback);return()=>subscribers.delete(callback);},
  };
  function clearPending(record:YouTubeRecord,cancel=true){
    const pending=record.pending;if(!pending)return;
    record.pending=null;env.clearTimeout(pending.timer);
    if(cancel)post({kind:'cancel-track',requestId:pending.id,videoId:record.videoId});
  }
  function remove(record:YouTubeRecord){
    selection?.cancel(record.session.id,'session-remove');clearPending(record);
    record.session.destroy();record.view?.destroy();records.delete(record.session.id);changed();
  }
  function clear(){for(const record of [...records.values()])remove(record);}
  function chooseTrack(record:YouTubeRecord) {
    const tracks=metadata?.videoId===record.videoId?metadata.tracks:[];
    const language=config.sourceLanguage==='auto'?metadata?.selectedLanguage:config.sourceLanguage;
    const preference=normalizeSubtitleTrackPreference(config.subtitleTrackPreference),matching=preference.languageCode?tracks.filter(track=>track.languageCode===preference.languageCode):[];
    const selected=matching.find(track=>track.kind===preference.kind&&track.name.trim()===preference.name)||matching.find(track=>track.kind===preference.kind)||matching[0]||
      tracks.find(track=>track.languageCode===language)||tracks.find(track=>track.kind!=='asr')||tracks[0];
    if(record.track?.id!==selected?.id||record.track?.kind!==selected?.kind||record.track?.languageCode!==selected?.languageCode){
      // A CC language change is a new timeline, even when the video element is reused.
      selection?.cancel(record.session.id,'track');clearPending(record);
      record.loadedTrack='';record.failedTrack='';record.timelineSignature='';record.domText='';
      record.session.setCues([]);
    }
    // The logical track can keep its ID while YouTube renews its proof/signature.
    // A previous empty response must not block the newly usable URL.
    if(record.track?.id===selected?.id&&record.track?.baseUrl!==selected?.baseUrl){clearPending(record);record.failedTrack='';}
    record.tracks=tracks;record.track=selected;
    record.view.setTracks(tracks,preference.languageCode?selected?.id:'');
    return selected;
  }
  function requestTrack(record:YouTubeRecord,force=false) {
    const track=chooseTrack(record);
    if(!track||!record.session.isEnabled()||record.pending||(!force&&(record.loadedTrack===track.id||record.failedTrack===track.id)))return;
    const requestId='kuai-caption-'+(++requestSequence),id=record.videoId;
    const timer=env.setTimeout(()=>{
      if(record.pending?.id!==requestId)return;
      clearPending(record);record.failedTrack=track.id;record.session.state.errorMessage='字幕读取超时，请开启视频 CC 后重试。';changed();
    },23000);
    record.pending={id:requestId,trackId:track.id,track:{...track},timer};record.failedTrack='';
    post({kind:'fetch-track',requestId,videoId:id,url:track.baseUrl});
  }
  function installCues(record:YouTubeRecord,cues:CaptionCue[],trackId:string|undefined,{live=false}={}) {
    const signature=JSON.stringify(cues.map(cue=>[cue.start,cue.end,cue.text]));
    // The fetched track is authoritative even if fallback text was byte-for-byte identical.
    record.loadedTrack=trackId||'';record.session.state.isLiveDomCaptions=!!live;
    if(signature===record.timelineSignature){changed();return;}
    record.timelineSignature=signature;
    record.session.setCues(cues,{live});record.session.update();changed();
  }
  function fallback(record:YouTubeRecord) {
    if(record.session.state.isSubtitleSelectionHeld||record.loadedTrack)return;
    try {
      const tracks=Array.from(record.session.video.textTracks||[]),track=tracks.find(item=>item.mode==='showing')||tracks.find(item=>item.mode==='hidden');
      if(track?.cues?.length){
        const cues=Array.from(track.cues).map(cue=>({start:cue.startTime,end:cue.endTime,text:captionText((cue as VTTCue).text)}));
        installCues(record,cues,'native:'+track.language,{live:record.session.video.duration===Infinity});return;
      }
    }catch{}
    const player=record.session.video.closest?.('.html5-video-player');
    const text=Array.from(player?.querySelectorAll<HTMLElement>('.ytp-caption-segment')||[]).map(node=>node.textContent).join('\n').trim();
    if(text===record.domText)return;record.domText=text;
    if(text||record.session.state.isLiveDomCaptions){
      const time=record.session.video.currentTime;
      installCues(record,text?[{start:time,end:time+6,text}]:[],'',{live:true});
    }
  }
  function captionsOn(video:HTMLVideoElement){const button=video.closest?.('.html5-video-player')?.querySelector<HTMLElement>('.ytp-subtitles-button');return !button||button.getAttribute('aria-pressed')!=='false';}
  function preferences(patch:SettingsPatch){
    if(!updatePreferences)throw new Error('字幕设置暂不可用，请刷新页面后重试');
    const operation=preferenceQueue.catch(()=>{}).then(async()=>{
      if(stopped)throw new Error('页面已经离开，请在当前视频重试');
      const epoch=settingsEpoch,next=await updatePreferences(patch);
      // A newer broadcast already contains this save or a later change from another window.
      if(!stopped&&epoch===settingsEpoch&&next)updateSettings(next);
      return next;
    });
    preferenceQueue=operation;return operation;
  }
  function navigate(record:YouTubeRecord,direction:number){
    const state=navigationState(record.session),time=direction===-1?state.previous:state.next;
    if(time===null)return false;
    if(!bridge.seek(record.session.id,time))throw new Error('暂时无法跳转到这句字幕');
    changed();return true;
  }
  function create(video:HTMLVideoElement,id:string) {
    const session=createSubtitleSession({id:'video-'+id+'-'+(++sequence),video,settings:config,translate,onChange:changed});
    const record={session,videoId:id,togglePending:false,tracks:[],pending:null,loadedTrack:'',failedTrack:'',timelineSignature:'',domText:''} as unknown as YouTubeRecord;
    records.set(session.id,record);
    record.view=createView(session,{env,cancelSelection:bridge.cancelSelection,
      onToggle:async()=>{
        if(record.togglePending)return;
        record.togglePending=true;selection?.cancel(session.id,'toggle');
        try{
          const enable=!config.subtitlesEnabled||!captionsOn(video);
          await preferences({subtitlesEnabled:enable});
          if(stopped||records.get(session.id)!==record||record.videoId!==videoIdFromUrl(env.location.href)||!video.isConnected)return;
          const cc=video.closest?.('.html5-video-player')?.querySelector<HTMLElement>('.ytp-subtitles-button');
          if(enable&&config.subtitlesEnabled&&cc?.getAttribute('aria-pressed')==='false')cc.click();
          record.failedTrack='';sync();
        }finally{record.togglePending=false;}
      },
      onTrackChange:async trackId=>{
        const track=record.tracks.find(item=>item.id===trackId);
        if(trackId&&!track)throw new Error('这条字幕已不可用，请重新选择');
        const subtitleTrackPreference=normalizeSubtitleTrackPreference(track?{languageCode:track.languageCode,kind:track.kind,name:track.name}:undefined);
        await preferences({subtitleTrackPreference});
        if(!stopped&&records.get(session.id)===record&&record.videoId===videoIdFromUrl(env.location.href)&&video.isConnected)requestTrack(record,true);
      },
      onRetry:()=>{if(record.failedTrack||!session.state.subtitlesList.length)requestTrack(record,true);else session.retry();},
      onPreferences:async patch=>{
        const next=await preferences(patch);
        if(patch.subtitlesEnabled===true&&config.subtitlesEnabled&&!stopped&&records.get(session.id)===record&&record.videoId===videoIdFromUrl(env.location.href)&&video.isConnected){
          const cc=video.closest?.('.html5-video-player')?.querySelector<HTMLElement>('.ytp-subtitles-button');if(cc?.getAttribute('aria-pressed')==='false')cc.click();sync();
        }
        return next;
      },onOpenOptions:openOptions,onNavigate:direction=>navigate(record,direction),
    });
    session.setEnabled(captionsOn(video));session.start();changed();return record;
  }
  function pickVideo(current:HTMLVideoElement|undefined) {
    // Layout changes do not replace a connected media session or its subtitle UI.
    if(current?.isConnected&&current.closest?.('.html5-video-player'))return current;
    const candidates=Array.from(doc.querySelectorAll('video')).filter(video=>video.isConnected&&video.closest?.('.html5-video-player'));
    return candidates.map(video=>{const rect=video.getBoundingClientRect();return {video,area:Math.max(0,Math.min(rect.bottom,env.innerHeight||Infinity)-Math.max(rect.top,0))*Math.max(0,Math.min(rect.right,env.innerWidth||Infinity)-Math.max(rect.left,0))};})
      .sort((a,b)=>b.area-a.area)[0]?.video;
  }
  function sync() {
    if(stopped||Date.now()<navigateUntil)return;
    const id=videoIdFromUrl(env.location.href);
    if(id!==lastVideoId){clear();if(metadata?.videoId!==id)metadata=null;lastVideoId=id;}
    if(!id){clear();return;}
    let record:YouTubeRecord|null|undefined=currentRecord();const video=pickVideo(record?.session.video);
    if(record&&(record.session.video!==video||!record.session.video.isConnected)){remove(record);record=null;}
    if(!video)return;
    if(!record)record=create(video,id);
    record.session.setEnabled(captionsOn(video));record.view.mount();record.view.render(config);
    chooseTrack(record);fallback(record);requestTrack(record);record.session.update();
  }
  function schedule(){if(stopped||scheduled!==null)return;scheduled=env.setTimeout(()=>{scheduled=null;sync();},0);}
  function onData(event:MessageEvent<unknown>) {
    if(event.source!==(env as unknown as Window)||event.origin!==origin()||(event.data as {source?:unknown}|null)?.source!=='kuai-youtube-data')return;
    const data=event.data as YouTubeDataMessage,id=videoIdFromUrl(env.location.href);
    if(data.videoId!==id||!id)return;
    if(data.kind==='tracks'){
      if(!Array.isArray(data.tracks)||data.tracks.length>100)return;
      metadata={videoId:id,tracks:data.tracks.map(track=>validateTrack(track,id)).filter(Boolean) as CaptionTrack[],selectedLanguage:typeof data.selectedLanguage==='string'?data.selectedLanguage.slice(0,32):''};sync();return;
    }
    const record=currentRecord();if(!record||record.videoId!==id)return;
    if(data.requestId&&data.requestId!==record.pending?.id)return;
    if(data.kind==='caption-error'){
      record.failedTrack=record.pending?.trackId||record.track?.id;clearPending(record,false);
      record.session.state.errorMessage='暂时无法读取这条字幕，请开启 CC、切换字幕语言或重试。';changed();return;
    }
    if(data.kind!=='captions'||typeof data.body!=='string'||data.body.length>4_000_000)return;
    if(!data.requestId&&record.track&&data.languageCode&&data.languageCode!==record.track.languageCode)return;
    // Bind parsing to the response's own identity before pending state is cleared.
    // Passive capture must never borrow metadata from an unrelated in-flight request.
    const responseTrack=data.trackUrl?validateTrack({baseUrl:data.trackUrl},id):null;
    if(data.trackUrl&&!responseTrack)return;
    const ownTrack=data.requestId?record.pending?.track:responseTrack;
    if(responseTrack&&record.track){
      const selected=new URL(record.track.baseUrl),received=new URL(responseTrack.baseUrl);
      if(responseTrack.languageCode!==record.track.languageCode||(data.requestId?selected.searchParams.get('kind')!==received.searchParams.get('kind'):responseTrack.kind!==record.track.kind)||
        ['name','vssId','tlang'].some(key=>selected.searchParams.get(key)!==received.searchParams.get(key)))return;
    }
    const trackId=data.requestId?record.pending?.trackId:record.track?.id||responseTrack?.id||'captured';
    if(data.requestId)clearPending(record,false);
    try {
      const cues=parseTimedText(data.body,{kind:ownTrack?.kind});
      if(cues.length){
        if(!data.requestId)clearPending(record);
        record.failedTrack='';record.session.state.errorMessage='';installCues(record,cues,trackId,{live:record.session.video.duration===Infinity});return;
      }
    }catch{}
    // Empty/unreadable caption bodies can arrive before the first caption.
    // Stay silent, retain native fallback cues, and accept later captures.
    record.failedTrack=trackId;record.session.state.errorMessage='';changed();
  }
  function updateSettings(next:Settings){
    if(stopped||!next)return;
    if(subtitleLayoutKey(config)!==subtitleLayoutKey(next)||config.subtitlesEnabled&&!next.subtitlesEnabled)
      for(const record of records.values())selection?.cancel(record.session.id,'subtitle-layout');
    settingsEpoch++;config=next;for(const record of records.values()){record.session.updateSettings(next);record.view.render(config);}sync();changed();
  }
  function keydown(event:KeyboardEvent){
    if(!event.ctrlKey||!event.altKey||event.metaKey||event.shiftKey||event.isComposing||event.keyCode===229||!['ArrowLeft','ArrowRight'].includes(event.key)||doc.visibilityState==='hidden')return;
    if((event.composedPath?.()||[event.target]).some(node=>(node as HTMLElement)?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test((node as HTMLElement)?.tagName)||(node as HTMLElement)?.getAttribute?.('role')==='textbox'))return;
    const record=currentRecord();if(!record)return;
    try{if(navigate(record,event.key==='ArrowLeft'?-1:1)){event.preventDefault();event.stopPropagation();}}catch(error){record.view.reportError?.(error);}
  }
  function openSidebar(){sync();const record=currentRecord();if(!record||!sidebar)return false;sidebar.sync();return sidebar.toggle(record.session.id,true);}
  function listen(target:EventTarget,type:string,fn:BrowserEventCallback,capture=false){target.addEventListener(type,fn,capture);listeners.push(()=>target.removeEventListener(type,fn,capture));}
  function start(){
    if(started||stopped)return controller;started=true;
    if(!/(^|\.)youtube(?:-nocookie)?\.com$/i.test(new URL(env.location.href).hostname))return controller;
    try{
    sidebar=createSidebar(bridge,env);selection=createSelection(bridge,env);sidebar.start();selection.start();
    listen(env,'message',onData);listen(env,'popstate',sync);listen(env,'pageshow',sync);
    listen(env,'pagehide',event=>{if(!event.persisted)stop();});
    listen(doc,'yt-navigate-start',()=>{navigateUntil=Date.now()+1500;clear();metadata=null;lastVideoId='';});
    listen(doc,'yt-navigate-finish',()=>{navigateUntil=0;sync();post({kind:'request-tracks'});});
    listen(doc,'visibilitychange',()=>{if(doc.visibilityState!=='hidden')sync();});
    listen(doc,'keydown',keydown,true);
    if(env.MutationObserver){observer=new env.MutationObserver(schedule);observer.observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed']});}
    poll=env.setInterval(sync,1000);unsubscribe=subscribeSettings?.(updateSettings);sync();post({kind:'request-tracks'});return controller;
    }catch(error){stop();throw error;}
  }
  function stop(){if(stopped)return;stopped=true;unsubscribe?.();observer?.disconnect();if(poll!==null)env.clearInterval(poll);if(scheduled!==null)env.clearTimeout(scheduled);listeners.splice(0).forEach(dispose=>dispose());selection?.stop();sidebar?.stop();clear();subscribers.clear();}
  const controller={start,stop,sync,updateSettings,openSidebar};return controller;
}

export function startYouTube(options:YouTubeControllerOptions){return createYouTubeController(options).start();}
