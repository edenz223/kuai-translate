import type {Settings} from '../shared/settings.js';
import type {SubtitleSession,SubtitleState,CaptionCue,TranslateSubtitles} from './types.js';
import {subtitleWords} from './i18n.js';
interface TranslationJob {revision:number;controller:AbortController;promise?:Promise<void>}
// Live DOM captions change word by word. Translate once the text settles, or at
// least once per wait while speech keeps rolling, instead of once per change.
const LIVE_SETTLE_MS=700,LIVE_MAX_WAIT_MS=3000,OVERLAP_SCAN=8;
const lastLine=(text:string)=>text.split('\n').map(line=>line.trim()).filter(Boolean).at(-1)||'';
const continuesText=(previous:string,next:string)=>{const line=lastLine(previous);return !!line&&(next.startsWith(previous)||next.includes(line));};
/** Framework-independent subtitle state and translation scheduling. */
export function createSubtitleSession({id,video,settings,translate,onChange=()=>{},getLanguage=()=>undefined}:{id:string;video:HTMLVideoElement;settings:Settings;translate:TranslateSubtitles;onChange?:(session:SubtitleSession)=>void;getLanguage?:()=>string|undefined}):SubtitleSession {
  let config=settings,enabled=true,destroyed=false,running:TranslationJob|null=null,revision=0,timer:ReturnType<typeof setInterval>|null=null,queued=false;
  let liveChangedAt=0,livePendingSince:number|null=null,liveTimer:ReturnType<typeof setTimeout>|null=null,liveSource:{text:string;translation:string}|null=null;
  const state:SubtitleState={videoId:id,subtitlesList:[],currentCaption:null,selectionCaptionSnapshot:null,isSubtitleSelectionHeld:false,translateVersion:0,isLiveDomCaptions:false,timelineFailed:false,errorMessage:''};
  const available=()=>!destroyed&&enabled&&config.subtitlesEnabled&&video.isConnected&&!video.closest?.('.ad-showing, .ad-interrupting');
  const notify=()=>onChange(session);
  const providerId=()=>config.subtitleProviderId==='follow_page'?config.activeProviderId:config.subtitleProviderId;
  const targetLanguage=()=>config.subtitleTargetLanguage&&config.subtitleTargetLanguage!=='follow_page'?config.subtitleTargetLanguage:config.targetLanguage;
  function invalidate() {
    revision++;state.translateVersion++;
    running?.controller.abort();running=null;
    for(const cue of state.subtitlesList)if(cue.status==='translating')cue.status='pending';
  }
  function scheduleUpdate() {
    if(queued||destroyed)return;queued=true;
    queueMicrotask(()=>{queued=false;if(!destroyed)update();});
  }
  function liveWaiting() {
    if(!state.isLiveDomCaptions||livePendingSince===null)return false;
    const now=Date.now(),wait=Math.min(LIVE_SETTLE_MS-(now-liveChangedAt),LIVE_MAX_WAIT_MS-(now-livePendingSince));
    if(wait<=0)return false;
    if(liveTimer!==null)clearTimeout(liveTimer);
    liveTimer=setTimeout(()=>{liveTimer=null;if(!destroyed)update();},wait);
    return true;
  }
  function update() {
    if(destroyed||state.isSubtitleSelectionHeld)return;
    if(!available()) {if(state.currentCaption){state.currentCaption=null;notify();}return;}
    const time=video.currentTime;
    let low=0,high=state.subtitlesList.length;
    while(low<high){const mid=(low+high)>>>1;if(state.subtitlesList[mid].start<=time)low=mid+1;else high=mid;}
    // Overlapping authored cues (simultaneous speakers, lyrics) stay visible together.
    const active:CaptionCue[]=[];let first=Math.max(0,low-1);
    for(let index=low-1;index>=0&&index>=low-OVERLAP_SCAN;index--){const item=state.subtitlesList[index];if(time<item.end){active.unshift(item);first=index;}}
    const next=active.length?{start:active[0].start,end:Math.min(...active.map(item=>item.end)),original:active.map(item=>item.text).join('\n'),
      translation:active.map(item=>item.translation||'').filter(Boolean).join('\n'),
      status:active.find(item=>item.status==='translating')?.status||active.find(item=>item.status==='error')?.status||active[0].status,
      errorMessage:active.map(item=>item.errorMessage||'').find(Boolean)||''}:null;
    if(JSON.stringify(next)!==JSON.stringify(state.currentCaption)){state.currentCaption=next;notify();}
    if(!running && !video.seeking && !liveWaiting()) {
      const pending=[];
      for(let index=first;index<state.subtitlesList.length;index++){
        const item=state.subtitlesList[index];if(item.start>time+15)break;
        if(item.end>time&&item.status==='pending')pending.push(item);
        if(pending.length===8)break;
      }
      if(pending.length)translateCues(pending);
    }
  }
  function translateCues(candidates:CaptionCue[]):false|Promise<void> {
    if(!available()||state.isSubtitleSelectionHeld||running||!Array.isArray(candidates))return false;
    const membership=new Set(state.subtitlesList),cues:CaptionCue[]=[];let size=0,rejected=false;
    for(const cue of new Set(candidates)) {
      if(!membership.has(cue)||!cue.text||cue.status!=='pending')continue;
      if(cue.text.length>40000){
        cue.status='error';cue.errorMessage=subtitleWords(getLanguage()).cueTooLong;rejected=true;continue;
      }
      if(cues.length>=8||size+cue.text.length>40000)break;
      cues.push(cue);size+=cue.text.length;
    }
    if(rejected){notify();scheduleUpdate();}
    if(!cues.length)return false;
    const fragments:string[]=[],mapping:[number,number][]=[];
    for(const cue of cues){
      const start=fragments.length;
      for(let offset=0;offset<cue.text.length;){let end=Math.min(offset+3000,cue.text.length);if(end<cue.text.length&&/[\uD800-\uDBFF]/.test(cue.text[end-1]))end--;fragments.push(cue.text.slice(offset,end));offset=end;}
      mapping.push([start,fragments.length]);cue.status='translating';cue.errorMessage='';
    }
    const job:TranslationJob={revision,controller:new AbortController()};running=job;if(state.isLiveDomCaptions)livePendingSince=null;notify();
    job.promise=Promise.resolve().then(()=>translate(fragments,{providerId:providerId(),sourceLanguage:config.sourceLanguage,targetLanguage:targetLanguage(),signal:job.controller.signal})).then(result=>{
      if(destroyed||job.revision!==revision||job.controller.signal.aborted)return;
      const values=result?.translations;
      if(!Array.isArray(values)||values.length!==fragments.length||values.some(value=>typeof value!=='string'||!value.trim()))throw new Error(subtitleWords(getLanguage()).emptyTranslation);
      cues.forEach((cue,index)=>{cue.translation=values.slice(...mapping[index]).join('');cue.status='success';});
      if(state.isLiveDomCaptions){const latest=cues.at(-1)!;liveSource={text:latest.text,translation:latest.translation!};carryLive(state.subtitlesList);}
    }).catch(error=>{
      if(destroyed||job.revision!==revision||job.controller.signal.aborted)return;
      cues.forEach(cue=>{cue.status='error';cue.errorMessage=error?.message||subtitleWords(getLanguage()).translationFailed;});
    }).finally(()=>{
      if(running===job)running=null;
      if(!destroyed&&job.revision===revision){notify();scheduleUpdate();}
    });
    return job.promise;
  }
  // Rolling text keeps the latest translation visible until its own translation lands.
  function carryLive(cues:CaptionCue[]) {
    if(!liveSource)return;
    for(const cue of cues){
      if(cue.translation||cue.status!=='pending'||!continuesText(liveSource.text,cue.text))continue;
      cue.translation=liveSource.translation;if(cue.text===liveSource.text)cue.status='success';
    }
  }
  function setCues(cues:CaptionCue[],{live=false}={}) {
    // A changing live line must not abort the request for the words before it.
    const rolling=!!live&&state.isLiveDomCaptions;
    if(rolling){liveChangedAt=Date.now();livePendingSince??=liveChangedAt;}
    else{invalidate();liveSource=null;livePendingSince=live?Date.now():null;liveChangedAt=livePendingSince||0;}
    state.isLiveDomCaptions=!!live;
    state.subtitlesList=(cues||[]).filter(cue=>Number.isFinite(cue.start)&&Number.isFinite(cue.end)&&cue.start>=0&&cue.end>cue.start&&typeof cue.text==='string'&&cue.text.trim()).map(cue=>({...cue,translation:cue.translation||'',status:cue.status||'pending'})).sort((a,b)=>a.start-b.start);
    if(rolling)carryLive(state.subtitlesList);
    state.errorMessage='';if(!state.isSubtitleSelectionHeld)state.currentCaption=null;notify();
  }
  function hold(value:boolean) {
    if(state.isSubtitleSelectionHeld===!!value)return;
    if(value){state.selectionCaptionSnapshot=state.currentCaption?{...state.currentCaption}:null;state.isSubtitleSelectionHeld=true;}
    else{state.isSubtitleSelectionHeld=false;state.selectionCaptionSnapshot=null;scheduleUpdate();}
    notify();
  }
  function updateSettings(next:Settings) {
    const before=[providerId(),config.sourceLanguage,targetLanguage(),config.providerRevision,JSON.stringify(config.providers)];
    config=next;
    const after=[providerId(),config.sourceLanguage,targetLanguage(),config.providerRevision,JSON.stringify(config.providers)];
    if(before.some((value,index)=>value!==after[index])) {
      invalidate();for(const cue of state.subtitlesList){cue.translation='';cue.status='pending';cue.errorMessage='';}
    }
    if(!available()){hold(false);invalidate();}
    notify();scheduleUpdate();
  }
  function setEnabled(value:boolean) {
    if(enabled===!!value)return;
    enabled=!!value;session.synchronizer.isSyncEnabled=enabled;
    if(!enabled){invalidate();hold(false);}notify();scheduleUpdate();
  }
  function seek(time:number) {
    if(!available()||!Number.isFinite(time)||time<0||!Number.isFinite(video.duration)||time>=video.duration)return false;
    if(video.seekable?.length){let found=false;for(let index=0;index<video.seekable.length;index++)if(time>=video.seekable.start(index)&&time<video.seekable.end(index))found=true;if(!found)return false;}
    try{video.currentTime=time;update();return true;}catch{return false;}
  }
  function tick(){update();}
  function play(){clearInterval(timer!);timer=setInterval(tick,150);update();}
  function pause(){clearInterval(timer!);timer=null;update();}
  function start(){for(const type of ['timeupdate','seeked','loadedmetadata'])video.addEventListener(type,tick);video.addEventListener('play',play);video.addEventListener('pause',pause);video.addEventListener('ended',pause);if(!video.paused)play();else update();return session;}
  function retry(){for(const cue of state.subtitlesList)if(cue.status==='error'){cue.status='pending';cue.errorMessage='';}notify();update();}
  function destroy(){destroyed=true;invalidate();clearInterval(timer!);if(liveTimer!==null)clearTimeout(liveTimer);for(const type of ['timeupdate','seeked','loadedmetadata'])video.removeEventListener(type,tick);video.removeEventListener('play',play);video.removeEventListener('pause',pause);video.removeEventListener('ended',pause);state.isSubtitleSelectionHeld=false;state.selectionCaptionSnapshot=null;}
  const session:SubtitleSession={id,video,rule:{id:'youtube'},state,start,destroy,update,setCues,hold,updateSettings,setEnabled,seek,translateCues,retry,isEnabled:available,synchronizer:{isSyncEnabled:true,update,triggerTranslation:translateCues}};
  return session;
}
