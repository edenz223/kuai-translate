import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings} from '../src/shared/settings.js';
let api={};try{api=await import('../src/youtube/session.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function fixture(translate=async texts=>({translations:texts.map(text=>'译:'+text)}),settings=defaultSettings()){
  assert.equal(typeof api.createSubtitleSession,'function');
  const video=new EventTarget();Object.assign(video,{isConnected:true,currentTime:1,duration:100,paused:true,ended:false,seekable:{length:0},closest:()=>null});
  const session=api.createSubtitleSession({id:'test',video,settings,translate,onChange(){}});
  session.setCues([{start:0,end:3,text:'Hello'},{start:10,end:14,text:'Next'}]);
  return{session,state:session.state,video};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
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
test('held or disabled sessions cannot dispatch visible-row requests',async()=>{
  let calls=0;const {session,state}=fixture(async texts=>{calls++;return{translations:texts};});
  session.hold(true);assert.equal(session.translateCues(state.subtitlesList),false);
  session.setEnabled(false);session.hold(false);assert.equal(session.translateCues(state.subtitlesList),false);await settle();
  assert.equal(calls,0);session.destroy();
});
test('duplicate wording advances caption time and ended video timestamps remain seekable',async()=>{
  const {session,state,video}=fixture();session.setCues([{start:0,end:3,text:'Same',translation:'相同',status:'success'},{start:10,end:14,text:'Same',translation:'相同',status:'success'}]);
  session.update();video.currentTime=12;session.update();assert.equal(state.currentCaption.start,10);
  video.ended=true;let plays=0;video.play=()=>{plays++;};assert.equal(session.seek(1),true);assert.equal(plays,0);
  session.setEnabled(false);assert.equal(session.seek(2),false);session.destroy();
});
test('disabling an in-flight session returns cancelled cues to pending so enabling can translate again',async()=>{
  let calls=0;
  const {session,state}=fixture(async texts=>{calls++;if(calls===1)return new Promise(()=>{});return{translations:texts.map(()=> '完成')};});
  session.update();await Promise.resolve();session.setEnabled(false);
  assert.equal(state.subtitlesList[0].status,'pending');
  session.setEnabled(true);await settle();assert.equal(calls,2);assert.equal(state.subtitlesList[0].translation,'完成');session.destroy();
});

test('an oversized caption becomes a visible error without blocking normal cues or retrying forever',async()=>{
  let calls=0;
  const {session,state}=fixture(async texts=>{calls++;return{translations:texts.map(()=> '完成')};});
  session.setCues([{start:0,end:4,text:'x'.repeat(40001)},{start:5,end:8,text:'Normal caption'}]);
  session.update();await settle();
  assert.equal(state.subtitlesList[0].status,'error');assert.match(state.subtitlesList[0].errorMessage,/过长|too long|40000/i);
  assert.equal(state.subtitlesList[0].text.length,40001,'source caption must not be silently truncated');
  assert.equal(state.subtitlesList[1].status,'success');assert.equal(calls,1);
  assert.equal(state.currentCaption.status,'error');
  for(let index=0;index<5;index++){session.update();await settle();}
  assert.equal(calls,1,'an oversized cue must not cause an automatic request loop');session.destroy();
});

test('a valid caption that exceeds the remaining batch capacity stays pending for the next batch',async()=>{
  let calls=0;
  const {session,state}=fixture(async texts=>{calls++;return{translations:texts.map(()=> '完成')};});
  session.setCues([{start:0,end:4,text:'a'.repeat(21000)},{start:5,end:8,text:'b'.repeat(21000)}]);
  session.update();await settle();await settle();
  assert.deepEqual(state.subtitlesList.map(cue=>cue.status),['success','success']);assert.equal(calls,2);session.destroy();
});

test('a separate subtitle target survives unrelated page-language and presentation edits without retranslating',async t=>{
  const requests=[],settings={...defaultSettings(),subtitleTargetLanguage:'ja'};
  const {session,state}=fixture(async(texts,request)=>{requests.push(request);return{translations:texts.map(()=> '日本語')};},settings);t.after(()=>session.destroy());
  session.update();await settle();assert.equal(requests[0].targetLanguage,'ja');const cues=state.subtitlesList,version=state.translateVersion;
  session.updateSettings({...settings,targetLanguage:'fr',subtitleStyle:{sourceColor:'#ff0000'}});await settle();
  assert.equal(requests.length,1);assert.equal(requests[0].signal.aborted,false);assert.equal(state.translateVersion,version);
  assert.ok(state.subtitlesList===cues);assert.equal(state.currentCaption.translation,'日本語');
});
test('following the page target and explicitly changing the subtitle target invalidate only the effective language',async t=>{
  const requests=[],settings={...defaultSettings(),subtitleTargetLanguage:'follow_page'};
  const {session,state}=fixture(async(texts,request)=>{requests.push(request.targetLanguage);return{translations:texts.map(()=>request.targetLanguage)};},settings);t.after(()=>session.destroy());
  session.update();await settle();session.updateSettings({...settings,targetLanguage:'fr'});await settle();
  session.updateSettings({...settings,targetLanguage:'fr',subtitleTargetLanguage:'de'});await settle();
  assert.deepEqual(requests,['zh-Hans','fr','de']);assert.equal(state.currentCaption.translation,'de');
});
