import test from 'node:test';
import assert from 'node:assert/strict';
import dom from './helpers/content-dom.cjs';
import {createController as createSelectionController} from '../dist/src/youtube/selection.js';
import {studyFixture} from './helpers/youtube-study.mjs';
import {defaultSettings,normalizeSettings,publicSettings} from '../dist/src/shared/settings.js';
import {applyPreferencePatch} from '../dist/src/background/preferences.js';
import * as api from '../dist/src/youtube/overlay.js';

function setup(options={}){
  assert.equal(typeof api.createCaptionView,'function');
  const h=dom.fixture(),player=h.doc.createElement('div');player.className='html5-video-player';h.doc.body.append(player);
  player._rect={left:0,top:0,right:960,bottom:540,width:960,height:540};
  const video=h.doc.createElement('video'),native=h.doc.createElement('div');native.className='ytp-caption-window-container';player.append(video,native);
  const session={id:'one',video,state:{currentCaption:{original:'Hello',translation:'<img onerror=bad()>你好',status:'success'},isSubtitleSelectionHeld:false},isEnabled:()=>true};
  const patches=[],trackChanges=[],retries=[],cancellations=[];
  const view=api.createCaptionView(session,{env:h.env,onToggle(){},onTrackChange:id=>trackChanges.push(id),onRetry:()=>retries.push(true),onPreferences:patch=>patches.push(patch),cancelSelection:(...args)=>cancellations.push(args),...options});
  const box=view.host.shadowRoot.querySelector('.captions'),captures=[];
  box.setPointerCapture=id=>captures.push(['capture',id]);box.releasePointerCapture=id=>captures.push(['release',id]);
  return{h,player,native,session,view,box,patches,trackChanges,retries,cancellations,captures};
}
function nativeControls({h,player},parent=player){
  const controls=h.doc.createElement('div');controls.className='ytp-right-controls';
  const buttons=['settings','size','fullscreen'].map(name=>{
    const button=h.doc.createElement('button');button.className='ytp-'+name+'-button';button.setAttribute('aria-label',name);controls.append(button);return button;
  });parent.append(controls);return{controls,buttons};
}
function assertControlOrder(controls,expected){
  assert.equal(controls.children.length,expected.length,'native cluster child count');
  assert.equal(controls.children.every((node,index)=>node===expected[index]),true,'native cluster child order');
}
test('Kuai controls precede native settings, theater and fullscreen without changing their nodes or handlers',t=>{
  let toggles=0;const state=setup({onToggle:()=>toggles++}),{h,view,cancellations}=state;t.after(()=>view.destroy());
  const {controls,buttons}=nativeControls(state);let fullscreenClicks=0;buttons[2].addEventListener('click',()=>fullscreenClicks++);
  const attributes=buttons.map(node=>[...node.attrs]);view.mount();
  assert.equal(controls.firstChild===view.toolbar,true,'Kuai must be first inside the right control cluster');
  assertControlOrder(controls,[view.toolbar,...buttons]);assert.equal(controls.children.at(-1)===buttons[2],true,'fullscreen remains last');
  assert.deepEqual(buttons.map(node=>[...node.attrs]),attributes);h.emit(buttons[2],'click');assert.equal(fullscreenClicks,1);
  cancellations.length=0;h.emit(view.toolbar.querySelector('button'),'pointerdown');h.emit(view.toolbar.querySelector('button'),'click');
  assert.equal(toggles,1);assert.deepEqual(cancellations,[['one','toggle']]);
});
test('missing and hidden native controls use the fallback until a visible cluster reappears and teardown never remounts it',t=>{
  const state=setup(),{h,player,view,cancellations}=state;t.after(()=>view.destroy());
  assert.strictEqual(view.toolbar.parentNode,player);assert.match(view.toolbar.style.cssText,/position:absolute/);
  const {controls,buttons}=nativeControls(state);controls.hidden=true;cancellations.length=0;view.mount();
  assert.strictEqual(view.toolbar.parentNode,player);assert.deepEqual(cancellations,[]);
  controls.hidden=false;view.mount();assertControlOrder(controls,[view.toolbar,...buttons]);
  controls.hidden=true;view.mount();assert.strictEqual(view.toolbar.parentNode,player);assertControlOrder(controls,buttons);
  controls.hidden=false;view.mount();assertControlOrder(controls,[view.toolbar,...buttons]);
  controls.remove();view.mount();assert.strictEqual(view.toolbar.parentNode,player);assert.match(view.toolbar.style.cssText,/position:absolute/);
  player.append(controls);view.mount();assertControlOrder(controls,[view.toolbar,...buttons]);
  view.destroy();view.mount();view.render({});assertControlOrder(controls,buttons);assert.equal(view.toolbar.isConnected,false);assert.equal(view.host.isConnected,false);
  assert.equal(player.querySelector('[data-kuai-subtitle-settings]'),null);assert.equal(h.doc.querySelector('#kuai-subtitle-button-one'),null);
});
test('native subtitle overlay shows literal translated text while leaving the page markup unparsed',()=>{
  const {view,session,native}=setup();view.render({showOriginal:true});
  const [original,translation]=view.getRoots();assert.equal(original.textContent,'Hello');assert.equal(translation.textContent,session.state.currentCaption.translation);
  assert.equal(translation.querySelector('img'),null);assert.equal(native.style.visibility,'hidden');view.destroy();assert.equal(native.style.visibility,'');
});
test('held subtitle text keeps the same actual text node despite asynchronous changes',()=>{
  const {view,session}=setup();view.render({showOriginal:true});const translation=view.getRoots()[1],node=translation.firstChild;
  session.state.isSubtitleSelectionHeld=true;session.state.currentCaption.translation='新的翻译';view.render({showOriginal:false});
  assert.strictEqual(translation.firstChild,node);assert.equal(translation.textContent,'<img onerror=bad()>你好');
  session.state.isSubtitleSelectionHeld=false;view.render({showOriginal:false});assert.equal(translation.textContent,'新的翻译');view.destroy();
});

test('caption background drags in the configured direction and persists only its offset',t=>{
  for(const [position,start,end,want,edge]of [['top-center',100,140,110,'top'],['bottom-center',140,100,110,'bottom']]){
    const {h,view,box,patches,captures,cancellations}=setup();t.after(()=>view.destroy());
    const settings={subtitleStyle:{position,offset:70}};view.render(settings);
    const down=h.emit(box,'pointerdown',{pointerId:7,clientY:start});
    assert.equal(down.defaultPrevented,true,'only background intent takes the pointer away from native selection');
    assert.equal(box.style.cursor,'grabbing');assert.deepEqual(captures,[['capture',7]]);
    h.emit(h.env,'pointermove',{pointerId:7,clientY:end});view.render(settings);
    assert.equal(view.host.style[edge],want+'px','an ordinary render must retain the live drag offset');
    h.emit(h.env,'pointerup',{pointerId:7,clientY:end});view.render(settings);
    assert.deepEqual(patches,[{subtitleStyle:{offset:want}}]);assert.equal(view.host.style[edge],want+'px');
    assert.equal(box.style.cursor,'grab');assert.deepEqual(captures,[['capture',7],['release',7]]);
    assert.ok(cancellations.some(([id,reason])=>id==='one'&&reason==='drag'));
    view.render({subtitleStyle:{position,offset:want}});assert.equal(view.host.style[edge],want+'px');
  }
});

test('drag movement is bounded by the player height and persisted offset range',t=>{
  for(const [height,y,want]of [[540,1000,0],[540,-1000,300],[180,-1000,80]]){
    const {h,player,view,box,patches}=setup();t.after(()=>view.destroy());player._rect.height=height;player._rect.bottom=height;
    view.render({});h.emit(box,'pointerdown',{pointerId:1,clientY:100});h.emit(h.env,'pointermove',{pointerId:1,clientY:y});h.emit(h.env,'pointerup',{pointerId:1,clientY:y});
    assert.deepEqual(patches,[{subtitleStyle:{offset:want}}]);assert.equal(view.host.style.bottom,want+'px');
  }
});

test('pointer cancellation restores the offset at gesture start without saving',t=>{
  const {h,view,box,patches,captures}=setup();t.after(()=>view.destroy());view.render({subtitleStyle:{offset:90}});
  h.emit(box,'pointerdown',{pointerId:2,clientY:100});h.emit(h.env,'pointermove',{pointerId:2,clientY:50});assert.equal(view.host.style.bottom,'140px');
  h.emit(h.env,'pointercancel',{pointerId:2});view.render({subtitleStyle:{offset:90}});
  assert.equal(view.host.style.bottom,'90px');assert.equal(box.style.cursor,'grab');assert.deepEqual(patches,[]);
  assert.deepEqual(captures,[['capture',2],['release',2]]);h.emit(h.env,'pointerup',{pointerId:2,clientY:0});assert.deepEqual(patches,[]);
});

test('source tracks stay in settings while captions expose only text and error recovery',t=>{
  const {h,view,player,session,box,trackChanges,patches,retries}=setup();t.after(()=>view.destroy());
  session.state.currentCaption=null;session.isEnabled=()=>false;view.render({subtitlesEnabled:false});
  view.setTracks([{id:'en',name:'English'},{id:'fr',name:'Français',kind:'asr'}],'en');
  h.emit(view.toolbar.querySelector('[data-kuai-subtitle-settings-toggle]'),'click');
  const panel=player.querySelector('[data-kuai-subtitle-settings]'),tracks=panel.shadowRoot.querySelector('.subtitle-track');
  assert.equal(panel.hidden,false);assert.ok(tracks,'track choice must remain reachable when the caption overlay is hidden');assert.equal(tracks.disabled,false);assert.equal(tracks.value,'en');
  assert.equal(tracks.children[1].textContent,'Français · 自动字幕');tracks.value='fr';h.emit(tracks,'change');
  assert.deepEqual(trackChanges,['fr']);assert.deepEqual(patches,[],'track changes must retain the existing callback contract');
  session.isEnabled=()=>true;session.state.currentCaption={original:'Hello',translation:'你好',status:'success'};view.render({});
  assert.equal(box.querySelector('select'),null);assert.equal(box.querySelector('.drag'),null);assert.equal(box.querySelector('.tools'),null);
  assert.equal(box.querySelectorAll('button').filter(node=>!node.hidden).length,0,'successful captions have no persistent control row');
  session.state.errorMessage='字幕读取失败';view.render({});const retry=box.querySelector('button');assert.equal(retry.hidden,false);h.emit(retry,'click');assert.equal(retries.length,1);
  session.state.errorMessage='';view.render({});assert.equal(retry.hidden,true);
});

test('subtitle text gestures retain native selection defaults and real pause ownership',t=>{
  let selection;const state=setup({cancelSelection:(...args)=>selection?.cancel(...args)}),{h,view,session,box,patches}=state;t.after(()=>{selection?.stop();view.destroy();});
  const {controls,buttons}=nativeControls(state);view.mount();
  const video=session.video;Object.assign(video,{paused:false,playCount:0,pauseCount:0,pause(){this.paused=true;this.pauseCount++;},play(){this.paused=false;this.playCount++;return Promise.resolve();}});session.rule={id:'youtube'};
  view.render({});selection=createSelectionController({getSessions:()=>[session],getState:()=>session.state,getRoots:()=>view.getRoots(),isEnabled:()=>true,onHold:(_,held)=>{session.state.isSubtitleSelectionHeld=held;view.render({});}},h.env).start();
  const original=view.getRoots()[0],textNode=original.firstChild,down=h.emit(original,'pointerdown',{pointerId:8,clientY:100});
  assert.equal(down.defaultPrevented,false);assert.equal(session.state.isSubtitleSelectionHeld,true);
  h.select(original,'Hello');h.emit(h.doc,'selectionchange');assert.equal(video.pauseCount,1);
  for(let i=0;i<3;i++){view.mount();view.render({});}
  assertControlOrder(controls,[view.toolbar,...buttons]);assert.equal(session.state.isSubtitleSelectionHeld,true);assert.equal(video.playCount,0);
  h.emit(h.env,'pointermove',{pointerId:8,clientY:50});h.emit(original,'pointerup',{pointerId:8,clientY:50});h.advance(0);
  assert.equal(view.host.style.bottom,'70px');assert.deepEqual(patches,[]);assert.strictEqual(original.firstChild,textNode);
  h.setRange(textNode,0);h.emit(h.doc,'selectionchange');assert.equal(video.playCount,1,'only releasing a valid owned selection may resume playback');
  h.emit(original,'pointerdown',{pointerId:8,clientY:100});h.select(original,'Hello');h.emit(h.doc,'selectionchange');assert.equal(video.pauseCount,2);
  h.emit(box,'pointerdown',{pointerId:9,clientY:100});h.emit(h.env,'pointermove',{pointerId:9,clientY:60});h.emit(h.env,'pointercancel',{pointerId:9});
  h.setRange(textNode,0);h.emit(h.doc,'selectionchange');h.advance(0);assert.equal(video.playCount,1,'background drag cancellation must never resume a formerly owned selection');
});

test('all real controllers expose the subtitle list before any caption metadata or request succeeds',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.flush();
  assert.ok(h.mainButton()?.isConnected);assert.ok(h.listButton()?.isConnected);
  h.emit(h.listButton(),'click');await h.flush();assert.ok(h.panel()?.isConnected);assert.equal(h.panel().hidden,false);
  assert.match(h.panel().shadowRoot.querySelector('.panel-status').textContent,/字幕/);assert.equal(h.translations.length,0);
});

test('subtitle settings and sidebar can be opened before captions load and while translation is disabled',async t=>{
  const h=studyFixture({settings:{subtitlesEnabled:false},cc:false});t.after(()=>h.manager.stop());await h.flush();
  assert.ok(h.settingsButton()?.isConnected);h.emit(h.settingsButton(),'click');
  const panel=h.settingsPanel();assert.ok(panel?.isConnected);assert.equal(panel.hidden,false);assert.equal(h.captionHost().hidden,true);
  const shadow=panel.shadowRoot;assert.equal(shadow.querySelector('.subtitles-enabled').checked,false);
  assert.ok(shadow.querySelector('.subtitle-provider'));assert.ok(shadow.querySelector('.subtitle-target'));assert.ok(shadow.querySelector('.subtitle-mode'));assert.ok(shadow.querySelector('.subtitle-order'));assert.ok(shadow.querySelector('.subtitle-mask'));
  assert.equal(h.manager.openSidebar(),true);await h.flush();assert.equal(h.panel().hidden,false);assert.equal(h.translations.length,0);
});
test('player preferences save only public field patches and offer the complete subtitle options page',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.flush();assert.ok(h.settingsButton());h.emit(h.settingsButton(),'click');const shadow=h.settingsPanel().shadowRoot;
  for(const [selector,value,expected]of [
    ['.subtitle-provider','google',{subtitleProviderId:'google'}],
    ['.subtitle-target','ja',{subtitleTargetLanguage:'ja'}],
    ['.subtitle-mode','translation_only',{subtitleStyle:{displayMode:'translation_only'}}],
    ['.subtitle-order','translation_on_top',{subtitleStyle:{displayOrder:'translation_on_top'}}],
  ]){
    const control=shadow.querySelector(selector);control.value=value;h.emit(control,'change');await h.flush();assert.deepEqual(h.patches.at(-1),expected);
  }
  const mask=shadow.querySelector('.subtitle-mask');mask.checked=true;h.emit(mask,'change');await h.flush();assert.deepEqual(h.patches.at(-1),{subtitleStyle:{hideTranslation:true}});
  h.emit(shadow.querySelector('.all-subtitle-settings'),'click');await h.flush();assert.deepEqual(h.options,['subtitles']);assert.equal(h.translations.length,0);
});
test('previous and next caption controls seek the current timeline without changing paused playback',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();
  const previous=h.document.querySelector('[data-kuai-subtitle-previous]'),next=h.document.querySelector('[data-kuai-subtitle-next]');
  assert.ok(previous&&next);assert.equal(previous.disabled,true);assert.equal(next.disabled,false);
  h.emit(next,'click');await h.flush();assert.equal(h.video.currentTime,5);assert.equal(h.video.paused,true);assert.equal(h.video.playCount,0);
  h.emit(previous,'click');await h.flush();assert.equal(h.video.currentTime,0);assert.equal(h.video.playCount,0);
});
test('subtitle navigation shortcuts ignore editors and seek without starting paused playback',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();
  const editor=h.document.createElement('input');h.player.append(editor);
  h.emit(editor,'keydown',{key:'ArrowRight',ctrlKey:true,altKey:true});assert.equal(h.video.currentTime,0);
  const event=h.emit(h.document,'keydown',{key:'ArrowRight',ctrlKey:true,altKey:true});await h.flush();
  assert.equal(event.defaultPrevented,true);assert.equal(h.video.currentTime,5);assert.equal(h.video.playCount,0);
});
test('dragging top-positioned captions keeps the offset across renders and saves only the position patch',async t=>{
  const h=studyFixture({settings:{subtitleStyle:{position:'top-center',offset:70}}});t.after(()=>h.manager.stop());await h.load();
  const host=h.captionHost(),background=host.shadowRoot.querySelector('.captions');h.emit(background,'pointerdown',{clientY:100,pointerId:1});
  h.emit(h.env,'pointermove',{clientY:140,pointerId:1});h.manager.sync();assert.equal(host.style.top,'110px');
  h.emit(h.env,'pointerup',{clientY:140,pointerId:1});await h.flush();h.manager.sync();
  assert.deepEqual(h.patches.at(-1),{subtitleStyle:{offset:110}});assert.equal(host.style.top,'110px');
});

// The controlled DOM does not perform layout. These tests exercise the real
// capture/parser/session/views and check their CSS reflow contract, not pixels.
const timedCaptions=[
  ['JSON3',JSON.stringify({events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'A short\n'},{utf8:'sentence'}]}]})],
  ['WebVTT','WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nA short\nsentence'],
  ['XML','<transcript><text start="0" dur="3">A short<br/>sentence</text></transcript>'],
];

for(const [format,body]of timedCaptions)test(`${format} caption breaks remain data while overlay and sidebar allow width-based reflow`,async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());h.tracks();
  const request=h.outbound.find(item=>item.kind==='fetch-track');
  h.message({kind:'captions',requestId:request.requestId,body});await h.flush();
  assert.equal(h.session().state.subtitlesList[0].text,'A short\nsentence');
  assert.equal(h.session().state.currentCaption.original,'A short\nsentence');
  assert.deepEqual(h.translations[0].texts,['A short\nsentence']);
  assert.equal(h.manager.openSidebar(),true);await h.flush();
  for(const host of [h.captionHost(),h.panel()])for(const [selector,text]of [
    ['.original-text','A short\nsentence'],['.translation-text','译:A short\nsentence'],
  ]){
    const node=host.shadowRoot.querySelector(selector);
    assert.equal(node.textContent,text,'presentation must not rewrite source or translated text');
    assert.equal(node.style['white-space'],'normal','caption line breaks must not be forced after reflow');
    assert.equal(node.style['overflow-wrap'],'anywhere','long unbroken text must still wrap in a narrow container');
  }
  assert.equal(h.captionHost().style['max-width'],'88%');
});

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
test('remembered source language and same-language automatic kind restore on fresh controllers',async t=>{
  const store=storeFixture(t),h=await store.open();await metadata(h);await choose(h,'es:');
  assert.deepEqual(store.saved.subtitleTrackPreference,{languageCode:'es',kind:'',name:'Español'});h.manager.stop();
  const fresh=await store.open();await metadata(fresh);assert.equal(selected(fresh).value,'es:');
  assert.equal(new URL(fresh.outbound.filter(x=>x.kind==='fetch-track').at(-1).url).searchParams.get('lang'),'es');
  await choose(fresh,'en:asr');fresh.manager.stop();const automatic=await store.open();await metadata(automatic);
  assert.equal(selected(automatic).value,'en:asr');assert.equal(new URL(automatic.outbound.filter(x=>x.kind==='fetch-track').at(-1).url).searchParams.get('kind'),'asr');
  await choose(automatic,'en:');automatic.manager.stop();const manual=await store.open();await metadata(manual);assert.equal(selected(manual).value,'en:');
});
test('sidebar open and close are saved across fresh controllers without startup or playback writes',async t=>{
  const store=storeFixture(t),h=await store.open();assert.equal(store.writes.length,0);
  h.emit(h.listButton(),'click');await h.flush();assert.equal(store.saved.subtitleListOpen,true);assert.equal(h.panel().hidden,false);h.manager.stop();
  const fresh=await store.open();assert.equal(fresh.panel().hidden,false);assert.equal(fresh.video.playCount,0);assert.equal(fresh.session().state.isSubtitleSelectionHeld,false);
  assert.equal(store.writes.length,1);fresh.emit(fresh.panel().shadowRoot.querySelector('.close-panel'),'click');await fresh.flush();assert.equal(store.saved.subtitleListOpen,false);fresh.manager.stop();
  const closed=await store.open();assert.ok(!closed.panel()||closed.panel().hidden);assert.equal(store.writes.length,2);
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

test('a caption change during a drag keeps the gesture and refreshes text after release',t=>{
  const {h,view,box,session,patches}=setup();t.after(()=>view.destroy());view.render({});
  h.emit(box,'pointerdown',{pointerId:3,clientY:200});h.emit(h.env,'pointermove',{pointerId:3,clientY:160});
  session.state.currentCaption={original:'Next line',translation:'下一句',status:'success'};view.render({});
  session.state.currentCaption=null;view.render({});
  assert.equal(view.host.hidden,false,'the dragged box stays under the pointer between captions');
  assert.equal(view.getRoots()[0].textContent,'Hello');
  h.emit(h.env,'pointermove',{pointerId:3,clientY:150});assert.equal(view.host.style.bottom,'120px');
  h.emit(h.env,'pointerup',{pointerId:3,clientY:150});
  assert.deepEqual(patches,[{subtitleStyle:{offset:120}}]);assert.equal(view.host.hidden,true);
});
test('translation-only captions show the source until the translation arrives',t=>{
  const {view,session,native}=setup();t.after(()=>view.destroy());const settings={subtitleStyle:{displayMode:'translation_only'}};
  const original=view.host.shadowRoot.querySelector('.original-text');
  session.state.currentCaption={original:'Hello',translation:'',status:'translating'};view.render(settings);
  assert.equal(original.hidden,false);assert.equal(original.textContent,'Hello');assert.equal(native.style.visibility,'hidden');
  session.state.currentCaption={original:'Hello',translation:'你好',status:'success'};view.render(settings);
  assert.equal(original.hidden,true);
});

test('an English interface localizes the toolbar, captions, settings panel and runtime errors, and follows language changes',async t=>{
  const h=studyFixture({settings:{interfaceLanguage:'en'}});t.after(()=>h.manager.stop());await h.flush();
  assert.equal(h.mainButton().title,'Turn Kuai Translate subtitles on or off');
  assert.equal(h.settingsButton().getAttribute('aria-label'),'Subtitle settings');
  h.emit(h.settingsButton(),'click');const shadow=h.settingsPanel().shadowRoot;
  assert.equal(shadow.querySelector('h2').textContent,'Subtitle settings');
  assert.equal(shadow.querySelector('.subtitle-mode').getAttribute('aria-label'),'Display');
  assert.equal(shadow.querySelector('.subtitle-mode').children[1].textContent,'Translation only');
  assert.equal(shadow.querySelector('.subtitle-target').children[0].textContent,'Same as page target language');
  assert.equal(shadow.querySelector('.subtitle-track').children[0].textContent,'Auto (no captions found yet)');
  h.tracks();const request=h.outbound.filter(item=>item.kind==='fetch-track').at(-1);
  h.message({kind:'caption-error',requestId:request.requestId});await h.flush();
  assert.equal(h.session().state.errorMessage,"Couldn't load these subtitles. Switch the subtitle language or retry.");
  assert.equal(h.captionHost().shadowRoot.querySelector('.retry').textContent,'Retry');
  assert.match(h.document.querySelector('[data-kuai-subtitle-next]').title,/^Next subtitle · /);
  h.manager.updateSettings({...h.config,interfaceLanguage:'zh-CN'});await h.flush();
  assert.equal(h.mainButton().title,'开启或关闭 Kuai translate 字幕翻译');
  assert.equal(shadow.querySelector('h2').textContent,'字幕设置');assert.equal(shadow.querySelector('.subtitle-mode').children[1].textContent,'只显示译文');
  assert.equal(h.captionHost().shadowRoot.querySelector('.retry').textContent,'重试');
});
test('navigation explains whether subtitle translation or video captions are off',async t=>{
  const off=studyFixture({settings:{subtitlesEnabled:false}});t.after(()=>off.manager.stop());await off.flush();
  assert.match(off.document.querySelector('[data-kuai-subtitle-next]').title,/请先开启字幕翻译/);
  const cc=studyFixture({cc:false});t.after(()=>cc.manager.stop());await cc.flush();
  assert.match(cc.document.querySelector('[data-kuai-subtitle-next]').title,/请开启视频字幕后继续/);
});

test('previous restarts a sentence that has played for a moment and otherwise goes back one',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();
  const previous=h.document.querySelector('[data-kuai-subtitle-previous]');
  h.video.currentTime=2;h.manager.sync();await h.flush();
  assert.equal(previous.disabled,false);assert.match(previous.title,/^重播本句 · Ctrl\+Alt\+←/);
  h.emit(previous,'click');await h.flush();assert.equal(h.video.currentTime,0);
  h.video.currentTime=5.5;h.manager.sync();await h.flush();assert.match(previous.title,/^上一句字幕/);
  h.emit(previous,'click');await h.flush();assert.equal(h.video.currentTime,0);assert.equal(h.video.playCount,0);
});
test('letter shortcuts navigate, replay and loop only when chosen, and never from editors',async t=>{
  const h=studyFixture({settings:{subtitleShortcuts:'letters'}});t.after(()=>h.manager.stop());await h.load();
  const key=(key,init={})=>h.emit(h.document,'keydown',{key,...init});
  key('ArrowRight',{ctrlKey:true,altKey:true});assert.equal(h.video.currentTime,0,'the other scheme is inactive');
  assert.equal(key('d').defaultPrevented,true);await h.flush();assert.equal(h.video.currentTime,5);
  h.video.currentTime=7;key('s');await h.flush();assert.equal(h.video.currentTime,5);
  key('a');await h.flush();assert.equal(h.video.currentTime,0);
  const editor=h.document.createElement('input');h.player.append(editor);h.emit(editor,'keydown',{key:'d'});assert.equal(h.video.currentTime,0);
  key('r');await h.flush();assert.deepEqual(h.session().state.loopingCaption,{start:0,end:3});
  assert.match(h.captionHost().shadowRoot.querySelector('.status').textContent,/单句循环中/);
  h.emit(h.settingsButton(),'click');assert.equal(h.settingsPanel().shadowRoot.querySelector('.subtitle-loop').checked,true);
  key('r');await h.flush();assert.equal(h.session().state.loopingCaption,null);
  h.manager.updateSettings({...h.config,subtitleShortcuts:'off'});await h.flush();
  assert.equal(key('d').defaultPrevented,false);assert.equal(h.video.currentTime,0);
});
test('the settings panel saves the shortcut scheme, toggles the sentence loop and closes on an outside press',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();
  h.emit(h.settingsButton(),'click');const panel=h.settingsPanel(),shadow=panel.shadowRoot;
  const shortcuts=shadow.querySelector('.subtitle-shortcuts');assert.equal(shortcuts.value,'ctrl-alt');
  shortcuts.value='letters';h.emit(shortcuts,'change');await h.flush();assert.deepEqual(h.patches.at(-1),{subtitleShortcuts:'letters'});
  const loop=shadow.querySelector('.subtitle-loop');loop.checked=true;h.emit(loop,'change');await h.flush();
  assert.deepEqual(h.session().state.loopingCaption,{start:0,end:3});assert.equal(loop.checked,true);
  h.emit(shadow.querySelector('.subtitle-mode'),'pointerdown');assert.equal(panel.hidden,false,'presses inside keep it open');
  h.emit(h.video,'pointerdown');assert.equal(panel.hidden,true);
});
test('the settings panel moves left of an open subtitle list drawer',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.flush();
  const drawer=h.document.createElement('section');drawer.dataset.placement='drawer';h.player.append(drawer);
  h.emit(h.settingsButton(),'click');const panel=h.settingsPanel();
  assert.equal(panel.style.left,'12px');assert.equal(panel.style.right,'auto');
  drawer.hidden=true;h.emit(h.settingsButton(),'click');h.emit(h.settingsButton(),'click');assert.equal(panel.style.right,'12px');
});
test('a narrow player keeps only the main toolbar buttons and a pending caption shows a quiet indicator',t=>{
  const {view,player,session}=setup();t.after(()=>view.destroy());
  session.state.currentCaption={original:'Hello',translation:'',status:'pending'};player._rect.width=400;view.render({});
  const previous=view.toolbar.querySelector('[data-kuai-subtitle-previous]'),shadow=view.host.shadowRoot;
  assert.equal(previous.hidden,true);assert.equal(previous.style.display,'none');
  assert.equal(shadow.querySelector('.busy').hidden,false);assert.equal(shadow.querySelector('.status').hidden,true,'no per-caption waiting text');
  session.state.currentCaption.translation='你好';player._rect.width=960;view.render({});
  assert.equal(previous.hidden,false);assert.equal(shadow.querySelector('.busy').hidden,true);
});
test('next and previous keep a sentence loop on the sentence they move to',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();
  h.emit(h.document,'keydown',{key:'ArrowUp',ctrlKey:true,altKey:true});await h.flush();
  assert.deepEqual(h.session().state.loopingCaption,{start:0,end:3});
  h.emit(h.document.querySelector('[data-kuai-subtitle-next]'),'click');await h.flush();
  assert.equal(h.video.currentTime,5);assert.deepEqual(h.session().state.loopingCaption,{start:5,end:8});
  h.video.currentTime=7.99;h.manager.sync();await h.flush();assert.equal(h.video.currentTime,5);
  const previous=h.document.querySelector('[data-kuai-subtitle-previous]');
  h.video.currentTime=6.5;h.manager.sync();await h.flush();h.emit(previous,'click');await h.flush();
  assert.equal(h.video.currentTime,5,'previous replays the looped sentence after it has played');assert.deepEqual(h.session().state.loopingCaption,{start:5,end:8});
  h.emit(previous,'click');await h.flush();
  assert.equal(h.video.currentTime,0);assert.deepEqual(h.session().state.loopingCaption,{start:0,end:3});
});
