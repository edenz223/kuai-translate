import test from 'node:test';
import assert from 'node:assert/strict';
import {studyFixture} from './helpers/youtube-study.mjs';
import {defaultSettings,normalizeSettings,publicSettings} from '../dist/src/shared/settings.js';
import {applyPreferencePatch} from '../dist/src/background/preferences.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const videoId='abcdef12345';
const track=(languageCode,kind='',name=languageCode,id=videoId)=>({baseUrl:`https://www.youtube.com/api/timedtext?v=${id}&lang=${languageCode}${kind?'&kind='+kind:''}`,languageCode,kind,name});
const trackOptions=[track('en','','English'),track('en','asr','English automatic'),track('es','','Español')];
const selected=h=>h.settingsPanel().shadowRoot.querySelector('.subtitle-track');
function storeFixture(t,initial={},saveHook){
  let saved=normalizeSettings({...defaultSettings(),...initial}),queue=Promise.resolve();const fixtures=[],writes=[];
  t.after(()=>fixtures.forEach(h=>h.manager.stop()));
  return{
    get saved(){return saved;},writes,
    patch(patch){saved=applyPreferencePatch(saved,patch);return publicSettings(saved);},
    async open(options={}){
      const h=studyFixture({settings:publicSettings(saved),...options,save:patch=>{writes.push(structuredClone(patch));const result=queue.catch(()=>{}).then(async()=>{await saveHook?.(patch);saved=applyPreferencePatch(saved,patch);return publicSettings(saved);});queue=result;return result;}});
      fixtures.push(h);await h.flush();return h;
    },
  };
}
async function metadata(h,values=trackOptions,selectedLanguage='en'){
  h.message({kind:'tracks',selectedLanguage,tracks:values});await h.flush();h.emit(h.settingsButton(),'click');
}
async function choose(h,value){selected(h).value=value;h.emit(selected(h),'change');await h.flush();}

test('toolbar off and on survive fresh controllers and agree with the settings checkbox',async t=>{
  const store=storeFixture(t),first=await store.open();
  first.emit(first.mainButton(),'click');await first.flush();
  assert.equal(store.saved.subtitlesEnabled,false);assert.equal(first.session().isEnabled(),false);
  assert.equal(first.settingsPanel().shadowRoot.querySelector('.subtitles-enabled').checked,false);first.manager.stop();
  const second=await store.open();assert.equal(second.session().isEnabled(),false);assert.equal(second.mainButton().getAttribute('aria-pressed'),'false');
  second.emit(second.mainButton(),'click');await second.flush();assert.equal(store.saved.subtitlesEnabled,true);assert.equal(second.session().isEnabled(),true);second.manager.stop();
  const third=await store.open();assert.equal(third.session().isEnabled(),true);assert.deepEqual(store.writes,[{subtitlesEnabled:false},{subtitlesEnabled:true}]);
});
test('a pending toolbar save accepts one toggle and a failed save leaves enabled state unchanged',async t=>{
  const gate=deferred(),store=storeFixture(t,{},()=>gate.promise),h=await store.open();
  h.emit(h.mainButton(),'click');h.emit(h.mainButton(),'click');await h.flush();assert.equal(store.writes.length,1);assert.equal(h.session().isEnabled(),true);
  gate.reject(new Error('remembering failed'));await h.flush();assert.equal(store.saved.subtitlesEnabled,true);assert.equal(h.session().isEnabled(),true);
  assert.equal(h.settingsPanel().hidden,false);assert.match(h.settingsPanel().shadowRoot.querySelector('.settings-status').textContent,/remembering failed/);
});
test('native CC off does not rewrite stored intent and deliberate enable survives a reload',async t=>{
  const store=storeFixture(t),h=await store.open({cc:false});assert.equal(h.session().isEnabled(),false);assert.equal(store.writes.length,0);
  h.emit(h.mainButton(),'click');await h.flush();assert.equal(h.ccButton.getAttribute('aria-pressed'),'true');assert.equal(store.saved.subtitlesEnabled,true);assert.equal(h.session().isEnabled(),true);
  h.manager.stop();const fresh=await store.open();assert.equal(fresh.session().isEnabled(),true);
});
test('remembered source language and same-language automatic kind restore on fresh controllers',async t=>{
  const store=storeFixture(t),h=await store.open();await metadata(h);await choose(h,'es:');
  assert.deepEqual(store.saved.subtitleTrackPreference,{languageCode:'es',kind:'',name:'Español'});h.manager.stop();
  const fresh=await store.open();await metadata(fresh);assert.equal(selected(fresh).value,'es:');
  assert.equal(new URL(fresh.outbound.filter(x=>x.kind==='fetch-track').at(-1).url).searchParams.get('lang'),'es');
  await choose(fresh,'en:asr');fresh.manager.stop();const automatic=await store.open();await metadata(automatic);
  assert.equal(selected(automatic).value,'en:asr');assert.equal(new URL(automatic.outbound.filter(x=>x.kind==='fetch-track').at(-1).url).searchParams.get('kind'),'asr');
  await choose(automatic,'en:');automatic.manager.stop();const manual=await store.open();await metadata(manual);assert.equal(selected(manual).value,'en:');
});
test('semantic named source choice restores across video IDs and normalized display-name whitespace',async t=>{
  const store=storeFixture(t),h=await store.open();
  const choices=[{...track('en','','First'),id:'first'},{...track('en','',' Chosen '),id:'chosen'}];
  await metadata(h,choices);await choose(h,'chosen');assert.equal(selected(h).value,'chosen');
  assert.deepEqual(store.saved.subtitleTrackPreference,{languageCode:'en',kind:'',name:'Chosen'});h.manager.stop();
  const fresh=await store.open(),nextId='different01';fresh.env.location.href='https://www.youtube.com/watch?v='+nextId;fresh.manager.sync();
  fresh.message({kind:'tracks',videoId:nextId,selectedLanguage:'en',tracks:[{...track('en','','First',nextId),id:'new-first'},{...track('en','','Chosen',nextId),id:'new-chosen'}]});await fresh.flush();
  assert.equal(selected(fresh).value,'new-chosen');assert.equal(store.writes.length,1);assert.doesNotMatch(JSON.stringify(store.saved.subtitleTrackPreference),/abcdef12345|different01|timedtext/);
});
test('unavailable track preference falls back without forgetting and automatic choice clears the preference',async t=>{
  const preferred={languageCode:'es',kind:'',name:'Español'},store=storeFixture(t,{subtitleTrackPreference:preferred});
  const missing=await store.open();await metadata(missing,[track('en')]);assert.equal(selected(missing).value,'en:');assert.deepEqual(store.saved.subtitleTrackPreference,preferred);assert.equal(store.writes.length,0);missing.manager.stop();
  const present=await store.open();await metadata(present);assert.equal(selected(present).value,'es:');
  assert.ok(Array.from(selected(present).children).some(option=>option.value===''));await choose(present,'');
  assert.deepEqual(store.saved.subtitleTrackPreference,{languageCode:'',kind:'',name:''});present.manager.stop();const follow=await store.open();await metadata(follow,trackOptions,'en');assert.equal(selected(follow).value,'');
  assert.equal(new URL(follow.outbound.filter(x=>x.kind==='fetch-track').at(-1).url).searchParams.get('lang'),'en');
});
test('a rejected source preference save retains the previous track and shows a retryable error',async t=>{
  const store=storeFixture(t,{},()=>{throw Error('track save failed');}),h=await store.open();await metadata(h);const before=selected(h).value;
  await choose(h,'es:');assert.equal(selected(h).value,before);assert.deepEqual(store.saved.subtitleTrackPreference,{languageCode:'',kind:'',name:''});
  assert.match(h.settingsPanel().shadowRoot.querySelector('.settings-status').textContent,/track save failed/);assert.equal(selected(h).disabled,false);
});
test('sidebar open and close are saved across fresh controllers without startup or playback writes',async t=>{
  const store=storeFixture(t),h=await store.open();assert.equal(store.writes.length,0);
  h.emit(h.listButton(),'click');await h.flush();assert.equal(store.saved.subtitleListOpen,true);assert.equal(h.panel().hidden,false);h.manager.stop();
  const fresh=await store.open();assert.equal(fresh.panel().hidden,false);assert.equal(fresh.video.playCount,0);assert.equal(fresh.session().state.isSubtitleSelectionHeld,false);
  assert.equal(store.writes.length,1);fresh.emit(fresh.panel().shadowRoot.querySelector('.close-panel'),'click');await fresh.flush();assert.equal(store.saved.subtitleListOpen,false);fresh.manager.stop();
  const closed=await store.open();assert.ok(!closed.panel()||closed.panel().hidden);assert.equal(store.writes.length,2);
});
test('explicit popup list opening persists and external visibility updates never echo a save',async t=>{
  const store=storeFixture(t),h=await store.open();assert.equal(h.manager.openSidebar(),true);await h.flush();assert.equal(store.saved.subtitleListOpen,true);assert.equal(store.writes.length,1);
  h.manager.updateSettings(store.patch({subtitleListOpen:false}));await h.flush();assert.equal(h.panel().hidden,true);assert.equal(store.writes.length,1);
  h.manager.updateSettings(store.patch({subtitleListOpen:true}));await h.flush();assert.equal(h.panel().hidden,false);assert.equal(store.writes.length,1);
});
test('a rejected sidebar visibility save restores the stored choice and reports the failure',async t=>{
  const store=storeFixture(t,{},()=>{throw Error('sidebar save failed');}),h=await store.open();h.emit(h.listButton(),'click');await h.flush();
  assert.equal(store.saved.subtitleListOpen,false);assert.ok(!h.panel()||h.panel().hidden);
  assert.equal(h.settingsPanel().hidden,false);assert.match(h.settingsPanel().shadowRoot.querySelector('.settings-status').textContent,/sidebar save failed/);
});
test('a stale enable result cannot click CC after a newer configuration disables translation',async t=>{
  const gate=deferred(),h=studyFixture({settings:{subtitlesEnabled:false},cc:false,save:()=>gate.promise});t.after(()=>h.manager.stop());await h.flush();
  h.emit(h.mainButton(),'click');await h.flush();h.manager.updateSettings({...h.config,subtitlesEnabled:false,subtitleTargetLanguage:'ja'});
  gate.resolve({...h.config,subtitlesEnabled:true});await h.flush();assert.equal(h.ccButton.getAttribute('aria-pressed'),'false');assert.equal(h.session().isEnabled(),false);assert.equal(h.video.playCount,0);
});
test('latest sidebar intent survives delayed earlier saves without replaying stale openness',async t=>{
  const first=deferred(),second=deferred(),store=storeFixture(t,{},patch=>patch.subtitleListOpen===true?first.promise:second.promise),h=await store.open();
  h.emit(h.listButton(),'click');h.emit(h.listButton(),'click');await h.flush();assert.equal(h.listButton().getAttribute('aria-expanded'),'false');
  assert.deepEqual(store.writes,[{subtitleListOpen:true}]);first.resolve();await h.flush();assert.deepEqual(store.writes,[{subtitleListOpen:true},{subtitleListOpen:false}]);assert.equal(store.saved.subtitleListOpen,true);assert.equal(h.listButton().getAttribute('aria-expanded'),'false');
  second.resolve();await h.flush();assert.equal(store.saved.subtitleListOpen,false);assert.equal(h.listButton().getAttribute('aria-expanded'),'false');
});
test('existing quick preferences survive fresh controller construction together',async t=>{
  const store=storeFixture(t),h=await store.open();h.emit(h.settingsButton(),'click');const shadow=h.settingsPanel().shadowRoot;
  for(const [name,value]of [['.subtitle-provider','google'],['.subtitle-target','ja'],['.subtitle-mode','translation_only'],['.subtitle-order','translation_on_top']]){
    const control=shadow.querySelector(name);control.value=value;h.emit(control,'change');await h.flush();
  }
  const mask=shadow.querySelector('.subtitle-mask');mask.checked=true;h.emit(mask,'change');await h.flush();h.manager.stop();
  const fresh=await store.open(),controls=fresh.settingsPanel().shadowRoot;
  assert.equal(controls.querySelector('.subtitle-provider').value,'google');assert.equal(controls.querySelector('.subtitle-target').value,'ja');
  assert.equal(controls.querySelector('.subtitle-mode').value,'translation_only');assert.equal(controls.querySelector('.subtitle-order').value,'translation_on_top');assert.equal(controls.querySelector('.subtitle-mask').checked,true);
});
