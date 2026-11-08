import test from 'node:test';
import assert from 'node:assert/strict';
import dom from './helpers/content-dom.cjs';
import {defaultSettings} from '../dist/src/shared/settings.js';
import fs from 'node:fs';
import vm from 'node:vm';
import * as sessionApi from '../dist/src/youtube/session.js';
import * as api from '../dist/src/youtube/index.js';

function setup(){
  assert.equal(typeof api.createYouTubeController,'function');
  const h=dom.fixture();h.env.location={href:'https://www.youtube.com/watch?v=abcdef12345',origin:'https://www.youtube.com'};
  h.env.setInterval=()=>1;h.env.clearInterval=()=>{};const outbound=[];h.env.postMessage=data=>outbound.push(data);
  const player=h.doc.createElement('div');player.className='html5-video-player';h.doc.body.append(player);
  const video=h.doc.createElement('video');Object.assign(video,{currentTime:1,duration:60,paused:true,ended:false,currentSrc:'blob:test',seekable:{length:0}});player.append(video);
  let bridge;const cancellations=[];
  const manager=api.createYouTubeController({env:h.env,settings:defaultSettings(),translate:async texts=>({translations:texts.map(text=>'译:'+text)}),
    createSidebar:value=>{bridge=value;return{start(){},stop(){},sync(){},getSelectionRoots:()=>[]};},
    createSelection:()=>({start(){},stop(){},sync(){},cancel:(...args)=>cancellations.push(args)}),
  }).start();
  const message=data=>h.emit(h.env,'message',{source:h.env,origin:h.env.location.origin,data:{source:'kuai-youtube-data',...data}});
  return{h,video,player,manager,bridge,outbound,message,cancellations};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const track=languageCode=>({baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang='+languageCode,languageCode,name:languageCode});
const tracks=(h,selectedLanguage)=>h.message({kind:'tracks',videoId:'abcdef12345',selectedLanguage,tracks:[track('en'),track('es')]});
const caption=(h,requestId,text)=>h.message({kind:'captions',videoId:'abcdef12345',requestId,body:JSON.stringify({events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:text}]}]})});
const requests=h=>h.outbound.filter(item=>item.kind==='fetch-track');
const nativeCues=(h,text)=>{h.video.textTracks=[{mode:'showing',language:'en',cues:[{startTime:0,endTime:3,text}]}];};
test('native YouTube runtime connects captured tracks to translated overlay and the sidebar bridge',async()=>{
  const h=setup();h.message({kind:'tracks',videoId:'abcdef12345',selectedLanguage:'en',tracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en',languageCode:'en',name:'English'}]});
  const request=h.outbound.find(item=>item.kind==='fetch-track');assert.ok(request);
  h.message({kind:'captions',videoId:'abcdef12345',requestId:request.requestId,languageCode:'en',body:JSON.stringify({events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'Hello'}]}]})});
  await settle();const [session]=h.bridge.getSessions();assert.equal(h.bridge.getState(session.id).currentCaption.translation,'译:Hello');
  assert.equal(h.bridge.getRoots(session).some(root=>root.textContent==='译:Hello'),true);h.manager.stop();assert.equal(h.bridge.getSessions().length,0);
});
test('old route caption messages and foreign page messages cannot populate a new timeline',()=>{
  const h=setup(),[session]=h.bridge.getSessions();
  const data={source:'kuai-youtube-data',kind:'captions',videoId:'different01',body:'WEBVTT\n\n00:00.000 --> 00:05.000\nWrong'};
  h.message(data);h.h.emit(h.h.env,'message',{source:{},origin:h.h.env.location.origin,data:{...data,videoId:'abcdef12345'}});
  assert.equal(h.bridge.getState(session.id).subtitlesList.length,0);h.manager.stop();
});
test('changing the selected CC track invalidates a pending response before it can replace the new timeline',async()=>{
  const h=setup();tracks(h,'en');const first=requests(h).at(-1);h.cancellations.length=0;
  tracks(h,'es');const second=requests(h).at(-1);
  assert.equal(requests(h).length,2);assert.equal(new URL(second.url).searchParams.get('lang'),'es');
  const cancelled=h.outbound.findIndex(item=>item.kind==='cancel-track'&&item.requestId===first.requestId);
  assert.ok(cancelled>=0,'the old MAIN-world fetch must release its request slot');
  assert.ok(cancelled<h.outbound.indexOf(second));
  assert.equal(h.cancellations.at(-1)?.[1],'track');
  caption(h,first.requestId,'Late English');await settle();
  const state=h.bridge.getSessions()[0].state;assert.equal(state.subtitlesList.length,0);assert.equal(state.currentCaption,null);
  caption(h,second.requestId,'Hola');await settle();assert.equal(state.currentCaption.original,'Hola');assert.equal(state.currentCaption.translation,'译:Hola');h.manager.stop();
});
test('retrying a failed caption track refetches it even when native fallback cues are already visible',async()=>{
  const h=setup();tracks(h,'en');const first=requests(h).at(-1);nativeCues(h,'Native fallback');h.manager.sync();await settle();
  const state=h.bridge.getSessions()[0].state;assert.equal(state.currentCaption.original,'Native fallback');
  h.message({kind:'caption-error',videoId:'abcdef12345',requestId:first.requestId});assert.ok(state.errorMessage);
  const host=h.h.doc.getElementById('kuai-captions-window-'+h.bridge.getSessions()[0].id),retry=host.shadowRoot.querySelectorAll('button').at(-1);
  h.h.emit(retry,'click');const second=requests(h).at(-1);
  assert.equal(requests(h).length,2);assert.notEqual(second.requestId,first.requestId);assert.equal(new URL(second.url).searchParams.get('lang'),'en');
  caption(h,second.requestId,'Remote transcript');await settle();assert.equal(state.currentCaption.original,'Remote transcript');assert.equal(state.errorMessage,'');h.manager.stop();
});

const fragmented=JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'We are'}]},{tStartMs:1000,dDurationMs:2000,segs:[{utf8:' learning.'}]}]});
test('requested ASR and authored metadata both feed a phrase-level playback timeline',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[{...track('en'),kind:'asr'}]});
  h.message({kind:'captions',videoId:'abcdef12345',requestId:requests(h).at(-1).requestId,body:fragmented});await settle();
  const state=h.bridge.getSessions()[0].state;
  assert.deepEqual(state.subtitlesList.map(c=>c.text),['We are learning.']);
  assert.equal(state.currentCaption.original,'We are learning.');
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[track('en')]});
  h.message({kind:'captions',videoId:'abcdef12345',requestId:requests(h).at(-1).requestId,body:fragmented});await settle();
  assert.deepEqual(state.subtitlesList.map(c=>c.text),['We are learning.']);
});
test('late passive ASR response cannot overwrite a same-language manual track',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  const automatic={...track('en'),baseUrl:track('en').baseUrl+'&kind=asr',kind:'asr'};
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[automatic]});const old=requests(h).at(-1);
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[track('en')]});
  h.message({kind:'captions',videoId:'abcdef12345',requestId:requests(h).at(-1).requestId,body:fragmented});await settle();
  const state=h.bridge.getSessions()[0].state,original=state.subtitlesList;
  h.message({kind:'captions',videoId:'abcdef12345',requestId:old.requestId,body:fragmented});
  h.message({kind:'captions',videoId:'abcdef12345',languageCode:'en',trackUrl:automatic.baseUrl,body:fragmented.replace('We are','Stale words')});
  assert.strictEqual(state.subtitlesList,original);
});


for(const [name,body]of [['empty JSON',JSON.stringify({events:[]})],['blank response',''],['unreadable response','{broken-json']])test('caption track '+name+' stays invisible and later captions can recover',async()=>{
 const h=setup();tracks(h,'en');const request=requests(h).at(-1),session=h.bridge.getSessions()[0];
 h.message({kind:'captions',videoId:'abcdef12345',requestId:request.requestId,body});await settle();
 const host=h.h.doc.getElementById('kuai-captions-window-'+session.id);
 assert.equal(session.state.errorMessage,'');assert.equal(session.state.currentCaption,null);assert.equal(host.hidden,true);
 h.manager.sync();assert.equal(requests(h).length,1,'an empty response must not cause a refetch loop');
 caption(h,undefined,'Captions arrived');await settle();assert.equal(session.state.currentCaption.original,'Captions arrived');assert.equal(host.hidden,false);h.manager.stop();
});

const file=new URL('../dist/src/youtube/capture-main.js',import.meta.url);
const trackCapture={baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en',languageCode:'en',name:{simpleText:'English'}};
function harness({withInitialResponse=false,selectedLanguage='en',fetcher,runtimeTracks=[],selectedTrack,setOption=()=>{}}={}) {
  assert.ok(fs.existsSync(file),'the actual MAIN-world caption capture must exist');
  const outputs=[],requests=[],intervals=[];
  const response={videoDetails:{videoId:'abcdef12345'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[trackCapture]}},unrelatedPrivateData:'must-not-be-copied'};
  const win=new EventTarget();win.postMessage=data=>outputs.push(data);
  const player={getPlayerResponse:()=>response,getOption:()=>selectedTrack||({languageCode:selectedLanguage}),getAudioTrack:()=>({captionTracks:runtimeTracks}),setOption};
  if(withInitialResponse)win.ytInitialPlayerResponse=response;
  const doc=new EventTarget();doc.querySelectorAll=()=>[player];
  const context={window:win,document:doc,location:{href:'https://www.youtube.com/watch?v=abcdef12345',origin:'https://www.youtube.com'},
    URL,Request,Response,AbortController,TextDecoder,Event,console,setInterval:callback=>{intervals.push(callback);return intervals.length;},clearInterval(){},setTimeout,clearTimeout,
    fetch:async(url,init)=>{requests.push(String(url));if(fetcher)return fetcher(url,init);return new Response(JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'Hi'}]}]}),{headers:{'content-type':'application/json'}});},
  };
  win.fetch=context.fetch;win.location=context.location;
  vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);
  function message(data){const event=new Event('message');Object.assign(event,{source:win,origin:context.location.origin,data:{source:'kuai-youtube-request',...data}});win.dispatchEvent(event);}
  return {outputs,requests,context,message,response,periodic:()=>intervals.forEach(callback=>callback())};
}
test('caption discovery emits only scoped track metadata for the current video',()=>{
  const h=harness(),data=h.outputs.find(item=>item.kind==='tracks');
  assert.equal(data.videoId,'abcdef12345');assert.equal(data.tracks.length,1);
  assert.equal(JSON.stringify(h.outputs).includes('must-not-be-copied'),false);
});
test('main-world requests cannot turn caption access into arbitrary authenticated fetches',async()=>{
  const h=harness();
  for(const url of ['https://attacker.example/api/timedtext?v=abcdef12345','https://www.youtube.com/logout','https://www.youtube.com/api/timedtext?v=other-video'])h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'test',url});
  await settle();assert.equal(h.requests.length,0);
});
test('valid track reads use the original fetch and return bounded subtitle data',async()=>{
  const h=harness();h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'request-a',url:trackCapture.baseUrl});await settle();await settle();
  assert.equal(h.requests.length,1);const result=h.outputs.find(item=>item.requestId==='request-a');
  assert.equal(result.kind,'captions');assert.match(result.body,/Hi/);
});
test('a route change discards a late caption fetch response',async()=>{
  const h=harness();h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'request-late',url:trackCapture.baseUrl});
  h.context.location.href='https://www.youtube.com/watch?v=different01';await settle();await settle();
  assert.equal(h.outputs.some(item=>item.requestId==='request-late'&&item.kind==='captions'),false);
});

test('rapid track replacements cancel only the current matching request and immediately release its slot',async t=>{
  const pending=[];
  const h=harness({fetcher:(url,{signal})=>new Promise((resolve,reject)=>{
    pending.push({signal,resolve});signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});
  })});
  t.after(()=>{for(const request of pending)request.resolve(new Response('{"events":[]}'));});
  const request=requestId=>h.message({kind:'fetch-track',videoId:'abcdef12345',requestId,url:trackCapture.baseUrl});
  const cancel=(requestId,videoId='abcdef12345')=>h.message({kind:'cancel-track',videoId,requestId});
  request('first');request('second');assert.equal(h.requests.length,2);
  cancel('first','different01');cancel('unknown');assert.equal(pending[0].signal.aborted,false);assert.equal(pending[1].signal.aborted,false);
  cancel('first');assert.equal(pending[0].signal.aborted,true);assert.equal(pending[1].signal.aborted,false);
  request('third');assert.equal(h.requests.length,3,'cancel must release capacity before the rejected fetch settles');
  cancel('second');request('fourth');assert.equal(h.requests.length,4);
  cancel('third');cancel('fourth');await settle();
  assert.equal(h.outputs.some(item=>item.requestId&&item.kind==='captions'),false);
});
test('empty caption responses refresh the native module once and try a fresh runtime URL',async()=>{
  let reloads=0;const runtime=[];
  const h=harness({runtimeTracks:runtime,setOption:(module,key,value)=>{
    assert.deepEqual([module,key,value],['captions','reload',true]);
    reloads++;runtime.push({...trackCapture,baseUrl:trackCapture.baseUrl+'&pot=renewed'});
  },fetcher:url=>new Response(new URL(url).searchParams.has('pot')?'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"Recovered"}]}]}':'')});
  h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'refresh',url:trackCapture.baseUrl});
  await settle();await settle();await settle();
  assert.equal(reloads,1);
  assert.match(h.outputs.find(item=>item.requestId==='refresh')?.body||'',/Recovered/);
});

function fixture(translate=async texts=>({translations:texts.map(text=>'译:'+text)}),settings=defaultSettings()){
  assert.equal(typeof sessionApi.createSubtitleSession,'function');
  const video=new EventTarget();Object.assign(video,{isConnected:true,currentTime:1,duration:100,paused:true,ended:false,seekable:{length:0},closest:()=>null});
  const session=sessionApi.createSubtitleSession({id:'test',video,settings,translate,onChange(){}});
  session.setCues([{start:0,end:3,text:'Hello'},{start:10,end:14,text:'Next'}]);
  return{session,state:session.state,video};
}
test('the native session renders current original and valid translated output',async()=>{
  const {session,state}=fixture();session.update();await settle();
  assert.equal(state.currentCaption.original,'Hello');assert.equal(state.currentCaption.translation,'译:Hello');
  assert.equal(state.subtitlesList[0].status,'success');session.destroy();
});
test('holding captions preserves a copy while in-flight results and provider resets complete',async()=>{
  let resolve;const {session,state}=fixture(()=>new Promise(done=>{resolve=done;}));session.update();await Promise.resolve();
  session.hold(true);const original=state.selectionCaptionSnapshot.original;
  resolve({translations:['你好','下一句']});await settle();
  assert.equal(state.selectionCaptionSnapshot.original,original);assert.equal(state.selectionCaptionSnapshot.translation,'');
  session.updateSettings({...defaultSettings(),targetLanguage:'ja'});
  assert.equal(state.isSubtitleSelectionHeld,true);assert.equal(state.selectionCaptionSnapshot.original,original);
  session.destroy();assert.equal(state.isSubtitleSelectionHeld,false);
});
test('replaced timelines ignore old responses and stale cue references cannot issue requests',async()=>{
  let resolve,calls=0;const {session,state}=fixture(()=>{calls++;return new Promise(done=>{resolve=done;});});
  const old=state.subtitlesList[0];session.update();await Promise.resolve();
  session.setCues([{start:30,end:35,text:'New video cue'}]);
  resolve({translations:['old','old']});await settle();
  assert.equal(state.subtitlesList[0].translation,'');assert.equal(session.translateCues([old]),false);assert.equal(calls,1);session.destroy();
});
test('empty or unequal translations remain visible errors and do not retry forever',async()=>{
  let calls=0;const {session,state}=fixture(async()=>{calls++;return{translations:['']};});
  session.update();await settle();session.update();await settle();
  assert.equal(state.subtitlesList[0].status,'error');assert.ok(state.currentCaption.errorMessage);assert.equal(calls,1);session.destroy();
});
test('disabling an in-flight session returns cancelled cues to pending so enabling can translate again',async()=>{
  let calls=0;
  const {session,state}=fixture(async texts=>{calls++;if(calls===1)return new Promise(()=>{});return{translations:texts.map(()=> '完成')};});
  session.update();await Promise.resolve();session.setEnabled(false);
  assert.equal(state.subtitlesList[0].status,'pending');
  session.setEnabled(true);await settle();assert.equal(calls,2);assert.equal(state.subtitlesList[0].translation,'完成');session.destroy();
});

test('a separate subtitle target survives unrelated page-language and presentation edits without retranslating',async t=>{
  const requests=[],settings={...defaultSettings(),subtitleTargetLanguage:'ja'};
  const {session,state}=fixture(async(texts,request)=>{requests.push(request);return{translations:texts.map(()=> '日本語')};},settings);t.after(()=>session.destroy());
  session.update();await settle();assert.equal(requests[0].targetLanguage,'ja');const cues=state.subtitlesList,version=state.translateVersion;
  session.updateSettings({...settings,targetLanguage:'fr',subtitleStyle:{sourceColor:'#ff0000'}});await settle();
  assert.equal(requests.length,1);assert.equal(requests[0].signal.aborted,false);assert.equal(state.translateVersion,version);
  assert.ok(state.subtitlesList===cues);assert.equal(state.currentCaption.translation,'日本語');
});

test('overlapping cues are shown and translated together',async t=>{
  const {session,state,video}=fixture();t.after(()=>session.destroy());
  session.setCues([{start:0,end:10,text:'Lyrics line'},{start:2,end:5,text:'Speaker line'}]);video.currentTime=3;session.update();await settle();
  assert.equal(state.currentCaption.original,'Lyrics line\nSpeaker line');
  assert.equal(state.currentCaption.translation,'译:Lyrics line\n译:Speaker line');
  video.currentTime=6;session.update();assert.equal(state.currentCaption.original,'Lyrics line');
});

function liveSession(translate){
  const video=new EventTarget();Object.assign(video,{isConnected:true,currentTime:1,duration:Infinity,paused:true,ended:false,seekable:{length:0},closest:()=>null});
  const session=sessionApi.createSubtitleSession({id:'live',video,settings:defaultSettings(),translate});
  const live=text=>{session.setCues([{start:0,end:7,text}],{live:true});session.update();};
  return{session,state:session.state,live};
}
test('rolling live DOM captions translate after the text settles instead of once per change',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const calls=[],{session,state,live}=liveSession(async texts=>{calls.push(texts);return{translations:texts.map(text=>'译:'+text)};});t.after(()=>session.destroy());
  live('We');await settle();t.mock.timers.tick(200);live('We are');await settle();t.mock.timers.tick(200);live('We are live');await settle();
  assert.equal(calls.length,0,'words that are still arriving must not each become a request');
  t.mock.timers.tick(700);await settle();
  assert.deepEqual(calls,[['We are live']]);assert.equal(state.currentCaption.translation,'译:We are live');
  live('We are live today');await settle();
  assert.equal(state.currentCaption.translation,'译:We are live','the previous translation stays while the continued line waits');assert.equal(calls.length,1);
  for(let index=1;index<=20;index++){t.mock.timers.tick(200);live('We are live today'+' and more'.repeat(index));await settle();}
  assert.equal(calls.length,2,'continuous speech is still translated once per maximum wait');
});
test('a rolling live line keeps its in-flight translation and shows it on the continued text',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const signals=[],resolvers=[];
  const {session,state,live}=liveSession((texts,{signal})=>{signals.push(signal);return new Promise(done=>resolvers.push(()=>done({translations:texts.map(text=>'译:'+text)})));});t.after(()=>session.destroy());
  live('Hello there');t.mock.timers.tick(700);await settle();assert.equal(signals.length,1);
  live('Hello there friends');await settle();assert.equal(signals[0].aborted,false);
  resolvers[0]();await settle();
  assert.equal(state.currentCaption.original,'Hello there friends');assert.equal(state.currentCaption.translation,'译:Hello there');
  t.mock.timers.tick(700);await settle();assert.equal(signals.length,2);
  resolvers[1]();await settle();assert.equal(state.currentCaption.translation,'译:Hello there friends');
});

test('a caption captured before track metadata is kept when that metadata names the same track',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  h.message({kind:'captions',videoId:'abcdef12345',languageCode:'en',trackUrl:track('en').baseUrl+'&pot=token',body:fragmented});await settle();
  const state=h.bridge.getSessions()[0].state,timeline=state.subtitlesList;
  assert.equal(state.currentCaption.translation,'译:We are learning.');
  tracks(h,'en');await settle();
  assert.equal(requests(h).length,0,'the captured timeline must not be cleared and refetched');
  assert.strictEqual(state.subtitlesList,timeline);assert.equal(state.currentCaption.translation,'译:We are learning.');
  tracks(h,'es');assert.equal(requests(h).length,1,'a different track still replaces the captured one');
});
test('a requested track that comes back empty is reported to the list and can be retried there',async t=>{
  const h=setup();t.after(()=>h.manager.stop());tracks(h,'en');const first=requests(h).at(-1),session=h.bridge.getSessions()[0];
  h.message({kind:'captions',videoId:'abcdef12345',requestId:first.requestId,body:''});await settle();
  assert.equal(session.state.timelineFailed,true);assert.equal(session.state.errorMessage,'','the video overlay stays quiet');
  h.bridge.retryTimeline(session.id);const second=requests(h).at(-1);
  assert.notEqual(second.requestId,first.requestId);assert.equal(session.state.timelineFailed,false);
  caption(h,second.requestId,'Recovered');await settle();assert.equal(session.state.currentCaption.original,'Recovered');assert.equal(session.state.timelineFailed,false);
});

test('one timeline status drives the list, navigation and settings surfaces',async()=>{
  const {timelineStatus}=await import('../dist/src/youtube/status.js');
  const video={duration:60},cue={start:0,end:1,text:'Hi'};
  const status=(state,options={})=>timelineStatus({enabled:true,subtitlesEnabled:true,state,video,...options});
  assert.equal(status(undefined,{enabled:false,subtitlesEnabled:false}),'disabled');
  assert.equal(status(undefined,{enabled:false}),'captions-off');
  assert.equal(status({subtitlesList:[]}),'loading');
  assert.equal(status({subtitlesList:[],timelineFailed:true}),'failed');
  assert.equal(status({subtitlesList:[cue],isLiveDomCaptions:true,timelineFailed:true}),'failed');
  assert.equal(status({subtitlesList:[cue],isLiveDomCaptions:true}),'live');
  assert.equal(status({subtitlesList:[cue]},{video:{duration:Infinity}}),'live');
  assert.equal(status({subtitlesList:[cue],timelineFailed:true}),'ready','a loaded timeline outranks an older failure');
});
test('session translation errors follow the interface language',async t=>{
  const video=new EventTarget();Object.assign(video,{isConnected:true,currentTime:1,duration:100,paused:true,ended:false,seekable:{length:0},closest:()=>null});
  const session=sessionApi.createSubtitleSession({id:'en',video,settings:defaultSettings(),getLanguage:()=>'en',translate:async()=>({translations:['']})});t.after(()=>session.destroy());
  session.setCues([{start:0,end:3,text:'Hello'}]);session.update();await settle();
  assert.equal(session.state.currentCaption.errorMessage,'The translation came back empty or incomplete. Please retry.');
});
