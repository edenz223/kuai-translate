/** Framework-independent subtitle state and translation scheduling. */
export function createSubtitleSession({id,video,settings,translate,onChange=()=>{}}) {
  let config=settings,enabled=true,destroyed=false,running=null,revision=0,timer=null,queued=false;
  const state={videoId:id,subtitlesList:[],currentCaption:null,selectionCaptionSnapshot:null,isSubtitleSelectionHeld:false,translateVersion:0,isLiveDomCaptions:false,errorMessage:''};
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
  function update() {
    if(destroyed||state.isSubtitleSelectionHeld)return;
    if(!available()) {if(state.currentCaption){state.currentCaption=null;notify();}return;}
    const time=video.currentTime;
    let low=0,high=state.subtitlesList.length;
    while(low<high){const mid=(low+high)>>>1;if(state.subtitlesList[mid].start<=time)low=mid+1;else high=mid;}
    const cue=state.subtitlesList[low-1],active=cue&&time<cue.end?cue:null;
    const next=active?{start:active.start,end:active.end,original:active.text,translation:active.translation||'',status:active.status,errorMessage:active.errorMessage||''}:null;
    if(JSON.stringify(next)!==JSON.stringify(state.currentCaption)){state.currentCaption=next;notify();}
    if(!running && !video.seeking) {
      const pending=[];
      for(let index=Math.max(0,low-1);index<state.subtitlesList.length;index++){
        const item=state.subtitlesList[index];if(item.start>time+15)break;
        if(item.end>time&&item.status==='pending')pending.push(item);
        if(pending.length===8)break;
      }
      if(pending.length)translateCues(pending);
    }
  }
  function translateCues(candidates) {
    if(!available()||state.isSubtitleSelectionHeld||running||!Array.isArray(candidates))return false;
    const membership=new Set(state.subtitlesList),cues=[];let size=0,rejected=false;
    for(const cue of new Set(candidates)) {
      if(!membership.has(cue)||!cue.text||cue.status!=='pending')continue;
      if(cue.text.length>40000){
        cue.status='error';cue.errorMessage='这句字幕过长（超过 40000 字符），未发送翻译请求。';rejected=true;continue;
      }
      if(cues.length>=8||size+cue.text.length>40000)break;
      cues.push(cue);size+=cue.text.length;
    }
    if(rejected){notify();scheduleUpdate();}
    if(!cues.length)return false;
    const fragments=[],mapping=[];
    for(const cue of cues){
      const start=fragments.length;
      for(let offset=0;offset<cue.text.length;){let end=Math.min(offset+3000,cue.text.length);if(end<cue.text.length&&/[\uD800-\uDBFF]/.test(cue.text[end-1]))end--;fragments.push(cue.text.slice(offset,end));offset=end;}
      mapping.push([start,fragments.length]);cue.status='translating';cue.errorMessage='';
    }
    const job={revision,controller:new AbortController()};running=job;notify();
    job.promise=Promise.resolve().then(()=>translate(fragments,{providerId:providerId(),sourceLanguage:config.sourceLanguage,targetLanguage:targetLanguage(),signal:job.controller.signal})).then(result=>{
      if(destroyed||job.revision!==revision||job.controller.signal.aborted)return;
      const values=result?.translations;
      if(!Array.isArray(values)||values.length!==fragments.length||values.some(value=>typeof value!=='string'||!value.trim()))throw new Error('翻译返回为空或数量不匹配，请重试');
      cues.forEach((cue,index)=>{cue.translation=values.slice(...mapping[index]).join('');cue.status='success';});
    }).catch(error=>{
      if(destroyed||job.revision!==revision||job.controller.signal.aborted)return;
      cues.forEach(cue=>{cue.status='error';cue.errorMessage=error?.message||'字幕翻译失败，请重试';});
    }).finally(()=>{
      if(running===job)running=null;
      if(!destroyed&&job.revision===revision){notify();scheduleUpdate();}
    });
    return job.promise;
  }
  function setCues(cues,{live=false}={}) {
    invalidate();state.isLiveDomCaptions=!!live;
    state.subtitlesList=(cues||[]).filter(cue=>Number.isFinite(cue.start)&&Number.isFinite(cue.end)&&cue.start>=0&&cue.end>cue.start&&typeof cue.text==='string'&&cue.text.trim()).map(cue=>({...cue,translation:cue.translation||'',status:cue.status||'pending'})).sort((a,b)=>a.start-b.start);
    state.errorMessage='';if(!state.isSubtitleSelectionHeld)state.currentCaption=null;notify();
  }
  function hold(value) {
    if(state.isSubtitleSelectionHeld===!!value)return;
    if(value){state.selectionCaptionSnapshot=state.currentCaption?{...state.currentCaption}:null;state.isSubtitleSelectionHeld=true;}
    else{state.isSubtitleSelectionHeld=false;state.selectionCaptionSnapshot=null;scheduleUpdate();}
    notify();
  }
  function updateSettings(next) {
    const before=[providerId(),config.sourceLanguage,targetLanguage(),config.providerRevision,JSON.stringify(config.providers)];
    config=next;
    const after=[providerId(),config.sourceLanguage,targetLanguage(),config.providerRevision,JSON.stringify(config.providers)];
    if(before.some((value,index)=>value!==after[index])) {
      invalidate();for(const cue of state.subtitlesList){cue.translation='';cue.status='pending';cue.errorMessage='';}
    }
    if(!available()){hold(false);invalidate();}
    notify();scheduleUpdate();
  }
  function setEnabled(value) {
    if(enabled===!!value)return;
    enabled=!!value;session.synchronizer.isSyncEnabled=enabled;
    if(!enabled){invalidate();hold(false);}notify();scheduleUpdate();
  }
  function seek(time) {
    if(!available()||!Number.isFinite(time)||time<0||!Number.isFinite(video.duration)||time>=video.duration)return false;
    if(video.seekable?.length){let found=false;for(let index=0;index<video.seekable.length;index++)if(time>=video.seekable.start(index)&&time<video.seekable.end(index))found=true;if(!found)return false;}
    try{video.currentTime=time;update();return true;}catch{return false;}
  }
  function tick(){update();}
  function play(){clearInterval(timer);timer=setInterval(tick,150);update();}
  function pause(){clearInterval(timer);timer=null;update();}
  function start(){for(const type of ['timeupdate','seeked','loadedmetadata'])video.addEventListener(type,tick);video.addEventListener('play',play);video.addEventListener('pause',pause);video.addEventListener('ended',pause);if(!video.paused)play();else update();return session;}
  function retry(){for(const cue of state.subtitlesList)if(cue.status==='error'){cue.status='pending';cue.errorMessage='';}notify();update();}
  function destroy(){destroyed=true;invalidate();clearInterval(timer);for(const type of ['timeupdate','seeked','loadedmetadata'])video.removeEventListener(type,tick);video.removeEventListener('play',play);video.removeEventListener('pause',pause);video.removeEventListener('ended',pause);state.isSubtitleSelectionHeld=false;state.selectionCaptionSnapshot=null;}
  const session={id,video,rule:{id:'youtube'},state,start,destroy,update,setCues,hold,updateSettings,setEnabled,seek,translateCues,retry,isEnabled:available,synchronizer:{isSyncEnabled:true,update,triggerTranslation:translateCues}};
  return session;
}
