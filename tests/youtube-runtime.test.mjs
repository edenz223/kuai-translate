import test from 'node:test';
import assert from 'node:assert/strict';
import dom from './helpers/content-dom.cjs';
import {defaultSettings} from '../src/shared/settings.js';
let api={};try{api=await import('../src/youtube/index.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
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
test('runtime bridge cancels owned selection before timestamp assignment and keeps paused state',()=>{
  const h=setup(),[session]=h.bridge.getSessions();let time=1;
  Object.defineProperty(h.video,'currentTime',{get:()=>time,set:value=>{assert.equal(h.cancellations.at(-1)[1],'seek');time=value;}});
  assert.equal(h.bridge.seek(session.id,12),true);assert.equal(time,12);assert.equal(h.video.paused,true);h.manager.stop();
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
test('an identical remote timeline promotes live DOM fallback without replacing translated text nodes',async()=>{
  const h=setup(),segment=h.h.doc.createElement('span');segment.className='ytp-caption-segment';segment.textContent='123';h.player.append(segment);
  tracks(h,'en');const first=requests(h).at(-1);await settle();
  const [session]=h.bridge.getSessions(),state=session.state,source=state.subtitlesList;
  assert.equal(state.isLiveDomCaptions,true);
  const translation=h.bridge.getRoots(session).find(node=>node.textContent==='译:123'),textNode=translation.firstChild;
  h.message({kind:'captions',videoId:'abcdef12345',requestId:first.requestId,body:JSON.stringify({events:[{tStartMs:1000,dDurationMs:6000,segs:[{utf8:'123'}]}]})});
  await settle();h.manager.sync();h.manager.sync();
  assert.equal(requests(h).length,1);assert.equal(state.isLiveDomCaptions,false);
  assert.strictEqual(state.subtitlesList,source);assert.strictEqual(translation.firstChild,textNode);assert.equal(state.currentCaption.translation,'译:123');h.manager.stop();
});

const fragmented=JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'We are'}]},{tStartMs:1000,dDurationMs:2000,segs:[{utf8:' learning.'}]}]});
test('requested ASR metadata normalizes the shared timeline while authored metadata preserves cues',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[{...track('en'),kind:'asr'}]});
  h.message({kind:'captions',videoId:'abcdef12345',requestId:requests(h).at(-1).requestId,body:fragmented});await settle();
  const state=h.bridge.getSessions()[0].state;
  assert.deepEqual(state.subtitlesList.map(c=>c.text),['We are learning.']);
  assert.equal(state.currentCaption.original,'We are learning.');
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[track('en')]});
  h.message({kind:'captions',videoId:'abcdef12345',requestId:requests(h).at(-1).requestId,body:fragmented});await settle();
  assert.deepEqual(state.subtitlesList.map(c=>c.text),['We are','learning.']);
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
test('passive ASR response uses its validated URL without inheriting pending track metadata',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  h.message({kind:'captions',videoId:'abcdef12345',languageCode:'en',trackUrl:track('en').baseUrl+'&kind=asr',body:fragmented});await settle();
  assert.deepEqual(h.bridge.getSessions()[0].state.subtitlesList.map(c=>c.text),['We are learning.']);
});

test('explicit requested ASR kind is retained when its own response URL has no kind parameter',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[{...track('en'),kind:'asr'}]});
  h.message({kind:'captions',videoId:'abcdef12345',requestId:requests(h).at(-1).requestId,trackUrl:track('en').baseUrl+'&fmt=json3',body:fragmented});await settle();
  assert.deepEqual(h.bridge.getSessions()[0].state.subtitlesList.map(c=>c.text),['We are learning.']);
});

test('a reused track id with changed ASR kind cancels and replaces the previous request',async t=>{
  const h=setup();t.after(()=>h.manager.stop());
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[{...track('en'),vssId:'.en',kind:'asr'}]});const old=requests(h).at(-1);
  h.message({kind:'tracks',videoId:'abcdef12345',tracks:[{...track('en'),vssId:'.en'}]});const replacement=requests(h).at(-1);
  assert.notEqual(replacement.requestId,old.requestId);
  h.message({kind:'captions',videoId:'abcdef12345',requestId:old.requestId,body:fragmented});
  assert.equal(h.bridge.getSessions()[0].state.subtitlesList.length,0);
  h.message({kind:'captions',videoId:'abcdef12345',requestId:replacement.requestId,body:fragmented});await settle();
  assert.deepEqual(h.bridge.getSessions()[0].state.subtitlesList.map(c=>c.text),['We are','learning.']);
});


for(const [name,body]of [['empty JSON',JSON.stringify({events:[]})],['blank response',''],['unreadable response','{broken-json']])test('caption track '+name+' stays invisible and later captions can recover',async()=>{
 const h=setup();tracks(h,'en');const request=requests(h).at(-1),session=h.bridge.getSessions()[0];
 h.message({kind:'captions',videoId:'abcdef12345',requestId:request.requestId,body});await settle();
 const host=h.h.doc.getElementById('kuai-captions-window-'+session.id);
 assert.equal(session.state.errorMessage,'');assert.equal(session.state.currentCaption,null);assert.equal(host.hidden,true);
 h.manager.sync();assert.equal(requests(h).length,1,'an empty response must not cause a refetch loop');
 caption(h,undefined,'Captions arrived');await settle();assert.equal(session.state.currentCaption.original,'Captions arrived');assert.equal(host.hidden,false);h.manager.stop();
});

test('an empty fetched track keeps available native captions without the unreadable-text message',async()=>{
 const h=setup();tracks(h,'en');const request=requests(h).at(-1);nativeCues(h,'Native captions');h.manager.sync();await settle();
 h.message({kind:'captions',videoId:'abcdef12345',requestId:request.requestId,body:JSON.stringify({events:[]})});await settle();
 const state=h.bridge.getSessions()[0].state;assert.equal(state.errorMessage,'');assert.equal(state.currentCaption.original,'Native captions');h.manager.stop();
});
