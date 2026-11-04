import test from 'node:test';
import assert from 'node:assert/strict';
import dom from './helpers/content-dom.cjs';
import {createController as createSelectionController} from '../dist/src/youtube/selection.js';
let api={};try{api=await import('../dist/src/youtube/overlay.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
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
test('same-parent toolbar drift is repaired once while stable mounts produce no child mutations or selection cancellations',t=>{
  const state=setup(),{view,cancellations}=state;t.after(()=>view.destroy());const {controls,buttons}=nativeControls(state);
  controls.insertBefore(view.toolbar,controls.firstChild);cancellations.length=0;
  const insertBefore=controls.insertBefore.bind(controls),appendChild=controls.appendChild.bind(controls);let placements=0;
  controls.insertBefore=(...args)=>{placements++;return insertBefore(...args);};controls.appendChild=(...args)=>{placements++;return appendChild(...args);};
  for(let i=0;i<4;i++){view.mount();view.render({});}
  assert.equal(placements,0);assert.deepEqual(cancellations,[]);
  controls.append(view.toolbar);placements=0;view.mount();
  assertControlOrder(controls,[view.toolbar,...buttons]);assert.equal(placements,1);assert.deepEqual(cancellations,[['one','controls-relocated']]);
  placements=0;cancellations.length=0;view.mount();view.render({});assert.equal(placements,0);assert.deepEqual(cancellations,[]);
  controls.insertBefore(buttons[0],view.toolbar);placements=0;view.mount();
  assertControlOrder(controls,[view.toolbar,...buttons]);assert.equal(placements,1);assert.deepEqual(cancellations,[['one','controls-relocated']]);
});
test('replaced controls and regular or fullscreen control hosts retain one toolbar before their native buttons',t=>{
  const state=setup(),{h,player,view,cancellations}=state;t.after(()=>view.destroy());const first=nativeControls(state);view.mount();
  const fullscreenHost=h.doc.createElement('div');player.append(fullscreenHost);first.controls.remove();
  const replacement=nativeControls(state,fullscreenHost);cancellations.length=0;view.mount();
  assertControlOrder(replacement.controls,[view.toolbar,...replacement.buttons]);assert.equal(first.controls.contains(view.toolbar),false);
  assert.deepEqual(cancellations,[['one','controls-relocated']]);
  player.append(replacement.controls);cancellations.length=0;view.mount();view.render({});
  assertControlOrder(replacement.controls,[view.toolbar,...replacement.buttons]);assert.deepEqual(cancellations,[],'moving the enclosing native cluster must not move the toolbar again');
  const next=nativeControls(state);replacement.controls.remove();view.mount();
  assertControlOrder(next.controls,[view.toolbar,...next.buttons]);assert.equal(player.querySelectorAll('#kuai-subtitle-button-one').length,1);
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
test('CSS hidden control clusters use fallback while opacity auto-hide retains native placement',t=>{
  const state=setup(),{player,view,cancellations}=state;t.after(()=>view.destroy());const {controls,buttons}=nativeControls(state);
  for(const visibility of ['hidden','collapse']){
    controls.style.visibility=visibility;view.mount();assert.equal(view.toolbar.parentNode===player,true,visibility+' must retain accessible fallback');
    assertControlOrder(controls,buttons);
  }
  controls.style.visibility='visible';controls.style.opacity='0';view.mount();assertControlOrder(controls,[view.toolbar,...buttons]);
  cancellations.length=0;controls.style.opacity='1';view.mount();controls.style.opacity='0';view.mount();
  assertControlOrder(controls,[view.toolbar,...buttons]);assert.deepEqual(cancellations,[],'native opacity animations must not relocate controls');
});
test('a visible replacement cluster is preferred over earlier hidden native controls',t=>{
  const state=setup(),{view}=state;t.after(()=>view.destroy());const old=nativeControls(state),visible=nativeControls(state);
  old.controls.hidden=true;view.mount();assertControlOrder(visible.controls,[view.toolbar,...visible.buttons]);assertControlOrder(old.controls,old.buttons);
  old.controls.hidden=false;old.controls.style.visibility='hidden';view.mount();assertControlOrder(visible.controls,[view.toolbar,...visible.buttons]);
  old.controls.style.visibility='visible';view.mount();assertControlOrder(old.controls,[view.toolbar,...old.buttons]);assertControlOrder(visible.controls,visible.buttons);
});
test('drift repair cancels a real held selection and moves once through synchronous onHold rendering',t=>{
  let selection;const cancellations=[],state=setup({cancelSelection:(...args)=>{cancellations.push(args);selection?.cancel(...args);}}),{h,view,session}=state;
  t.after(()=>{selection?.stop();view.destroy();});const {controls,buttons}=nativeControls(state);view.mount();
  const video=session.video;Object.assign(video,{paused:false,playCount:0,pauseCount:0,pause(){this.paused=true;this.pauseCount++;},play(){this.paused=false;this.playCount++;return Promise.resolve();}});session.rule={id:'youtube'};
  view.render({});selection=createSelectionController({getSessions:()=>[session],getState:()=>session.state,getRoots:()=>view.getRoots(),isEnabled:()=>true,onHold:(_,held)=>{session.state.isSubtitleSelectionHeld=held;view.render({});}},h.env).start();
  const original=view.getRoots()[0];h.emit(original,'pointerdown',{pointerId:8,clientY:100});h.select(original,'Hello');h.emit(h.doc,'selectionchange');
  assert.equal(session.state.isSubtitleSelectionHeld,true);assert.equal(video.pauseCount,1);
  controls.append(view.toolbar);const insertBefore=controls.insertBefore.bind(controls);let moves=0;
  controls.insertBefore=(...args)=>{moves++;return insertBefore(...args);};cancellations.length=0;view.mount();
  assert.equal(moves,1,'synchronous selection release must not repeat the native DOM move');assert.deepEqual(cancellations,[['one','controls-relocated']]);
  assertControlOrder(controls,[view.toolbar,...buttons]);assert.equal(session.state.isSubtitleSelectionHeld,false);assert.equal(video.playCount,0);
  h.setRange(original.firstChild,0);h.emit(h.doc,'selectionchange');h.advance(0);view.mount();
  assert.equal(video.playCount,0,'relocation revokes selection pause ownership');assert.equal(moves,1);assert.deepEqual(cancellations,[['one','controls-relocated']]);
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
test('reflowable multiline subtitles retain selected text nodes through stable and held renders',()=>{
  const {view,session}=setup();
  session.state.currentCaption.original='A short\nsentence';session.state.currentCaption.translation='一句\n短字幕';
  view.render({});const [original,translation]=view.getRoots(),sourceNode=original.firstChild,targetNode=translation.firstChild;
  view.render({});assert.strictEqual(original.firstChild,sourceNode);assert.strictEqual(translation.firstChild,targetNode);
  assert.equal(original.style['white-space'],'normal');assert.equal(translation.style['white-space'],'normal');
  session.state.isSubtitleSelectionHeld=true;session.state.currentCaption.translation='稍后\n返回的译文';view.render({});
  assert.strictEqual(original.firstChild,sourceNode);assert.strictEqual(translation.firstChild,targetNode);
  assert.equal(original.textContent,'A short\nsentence');assert.equal(translation.textContent,'一句\n短字幕');
  session.state.isSubtitleSelectionHeld=false;view.render({});assert.equal(translation.textContent,'稍后\n返回的译文');view.destroy();
});
test('stable rendering does not retrigger the observed pressed-state attribute',()=>{
  const {view}=setup();view.render({showOriginal:true});
  const button=view.toolbar.querySelector('button'),setAttribute=button.setAttribute.bind(button);let pressedWrites=0;
  button.setAttribute=(name,value)=>{if(name==='aria-pressed')pressedWrites++;setAttribute(name,value);};
  for(let i=0;i<5;i++)view.render({showOriginal:true});
  assert.equal(pressedWrites,0,'an unchanged attribute must not schedule another observer render');view.destroy();
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

test('a background click without movement never rewrites the saved offset in a small player',t=>{
  const {h,player,view,box,patches}=setup();t.after(()=>view.destroy());player._rect.height=120;player._rect.bottom=120;view.render({});
  h.emit(box,'pointerdown',{pointerId:1,clientY:100});h.emit(h.env,'pointermove',{pointerId:1,clientY:100});h.emit(h.env,'pointerup',{pointerId:1,clientY:100});
  assert.deepEqual(patches,[]);assert.equal(view.host.style.bottom,'70px');
});

test('text and retry controls preserve their defaults instead of initiating a background drag',t=>{
  const {h,view,box,session,patches,captures,retries}=setup();t.after(()=>view.destroy());session.state.currentCaption.errorMessage='Try again';view.render({});
  const original=view.getRoots()[0],retry=box.querySelectorAll('button').at(-1);original.focus();
  for(const target of [original,original.firstChild,box.querySelector('.status'),retry]){
    const down=h.emit(target,'pointerdown',{pointerId:1,clientY:100});
    assert.equal(down.defaultPrevented,false);h.emit(h.env,'pointermove',{pointerId:1,clientY:40});h.emit(h.env,'pointerup',{pointerId:1,clientY:40});
  }
  assert.deepEqual(patches,[]);assert.deepEqual(captures,[]);assert.strictEqual(h.doc.activeElement,original);
  h.emit(retry,'click');assert.equal(retries.length,1);
});

test('each caption line keeps a draggable background around its selectable text',t=>{
  const {h,view,box,patches}=setup();t.after(()=>view.destroy());view.render({});
  for(const selector of ['.original-line','.translation-line']){
    const line=box.querySelector(selector);assert.ok(line,'the text must not consume the entire background row');
    h.emit(line,'pointerdown',{pointerId:1,clientY:100});h.emit(h.env,'pointermove',{pointerId:1,clientY:80});h.emit(h.env,'pointerup',{pointerId:1,clientY:80});
  }
  assert.deepEqual(patches,[{subtitleStyle:{offset:90}},{subtitleStyle:{offset:110}}]);
  view.render({subtitleStyle:{displayMode:'translation_only',displayOrder:'translation_on_top'}});
  assert.equal(box.querySelector('.original-line').hidden,true);assert.equal(box.querySelector('.translation-line').hidden,false);
  assert.equal(box.querySelector('.translation-line').style.order,'-1');assert.equal(view.getRoots().length,1);
});

test('secondary pointers and modified background presses do not begin a drag',t=>{
  const {h,view,box,patches,captures}=setup();t.after(()=>view.destroy());view.render({});
  for(const extra of [{button:2},{isPrimary:false},{shiftKey:true},{altKey:true},{ctrlKey:true},{metaKey:true}]){
    const down=h.emit(box,'pointerdown',{pointerId:1,clientY:100,...extra});assert.equal(down.defaultPrevented,false);
    h.emit(h.env,'pointermove',{pointerId:1,clientY:40});h.emit(h.env,'pointerup',{pointerId:1,clientY:40});
  }
  assert.deepEqual(patches,[]);assert.deepEqual(captures,[]);
});

test('unrelated pointers cannot move, replace or finish an owned background drag',t=>{
  const {h,view,box,patches,captures}=setup();t.after(()=>view.destroy());view.render({});
  h.emit(box,'pointerdown',{pointerId:4,clientY:100});
  h.emit(box,'pointerdown',{pointerId:9,clientY:10});h.emit(h.env,'pointermove',{pointerId:9,clientY:0});
  h.emit(h.env,'pointercancel',{pointerId:9});h.emit(h.env,'pointerup',{pointerId:9,clientY:0});
  assert.equal(view.host.style.bottom,'70px');assert.deepEqual(patches,[]);assert.deepEqual(captures,[['capture',4]]);
  h.emit(h.env,'pointermove',{pointerId:4,clientY:60});h.emit(h.env,'pointerup',{pointerId:4,clientY:60});
  assert.deepEqual(patches,[{subtitleStyle:{offset:110}}]);assert.deepEqual(captures,[['capture',4],['release',4]]);
});

test('pointer cancellation restores the offset at gesture start without saving',t=>{
  const {h,view,box,patches,captures}=setup();t.after(()=>view.destroy());view.render({subtitleStyle:{offset:90}});
  h.emit(box,'pointerdown',{pointerId:2,clientY:100});h.emit(h.env,'pointermove',{pointerId:2,clientY:50});assert.equal(view.host.style.bottom,'140px');
  h.emit(h.env,'pointercancel',{pointerId:2});view.render({subtitleStyle:{offset:90}});
  assert.equal(view.host.style.bottom,'90px');assert.equal(box.style.cursor,'grab');assert.deepEqual(patches,[]);
  assert.deepEqual(captures,[['capture',2],['release',2]]);h.emit(h.env,'pointerup',{pointerId:2,clientY:0});assert.deepEqual(patches,[]);
});

test('canceling a later drag keeps the preceding offset while its save is still pending',t=>{
  const {h,view,box,patches}=setup();t.after(()=>view.destroy());view.render({});
  h.emit(box,'pointerdown',{pointerId:1,clientY:100});h.emit(h.env,'pointermove',{pointerId:1,clientY:60});h.emit(h.env,'pointerup',{pointerId:1,clientY:60});
  h.emit(box,'pointerdown',{pointerId:1,clientY:100});h.emit(h.env,'pointermove',{pointerId:1,clientY:30});h.emit(h.env,'pointercancel',{pointerId:1});view.render({});
  assert.equal(view.host.style.bottom,'110px');assert.deepEqual(patches,[{subtitleStyle:{offset:110}}]);
});

test('a completed background drag consumes its player click without swallowing the next gesture',t=>{
  const {h,player,view,box}=setup();t.after(()=>view.destroy());view.render({});let playerClicks=0;player.addEventListener('click',()=>playerClicks++);
  h.emit(box,'pointerdown',{pointerId:3,clientY:100});h.emit(h.env,'pointermove',{pointerId:3,clientY:60});h.emit(h.env,'pointerup',{pointerId:3,clientY:60});
  h.emit(player,'click',{pointerId:9,detail:1});assert.equal(playerClicks,1,'another pointer cannot consume the original gesture blocker');
  const click=h.emit(player,'click',{pointerId:3,detail:1});assert.equal(click.defaultPrevented,true);assert.equal(playerClicks,1);
  h.emit(player,'pointerdown',{pointerId:3,clientY:100});h.emit(player,'click',{pointerId:3,detail:1});assert.equal(playerClicks,2);
  h.emit(player,'click',{detail:0});assert.equal(playerClicks,3,'keyboard activation remains available');
});

test('lost capture, layout changes, new cues and teardown cannot commit an obsolete drag',t=>{
  for(const reason of ['capture','layout','cue','disabled','resize','detached','relocated','destroy']){
    const {h,player,view,box,session,patches,captures}=setup();t.after(()=>view.destroy());view.render({});
    h.emit(box,'pointerdown',{pointerId:5,clientY:100});h.emit(h.env,'pointermove',{pointerId:5,clientY:60});assert.equal(view.host.style.bottom,'110px');
    if(reason==='capture')h.emit(box,'lostpointercapture',{pointerId:5});
    if(reason==='layout')view.render({subtitleStyle:{offset:25}});
    if(reason==='cue'){session.state.currentCaption={original:'Next cue',translation:'下一句',start:5,end:8,status:'success'};view.render({});}
    if(reason==='disabled'){session.isEnabled=()=>false;view.render({});}
    if(reason==='resize'){player._rect.height=300;player._rect.bottom=300;h.emit(h.env,'pointermove',{pointerId:5,clientY:20});}
    if(reason==='detached'){session.video.remove();h.emit(h.env,'pointermove',{pointerId:5,clientY:20});}
    if(reason==='relocated'){h.doc.body.append(session.video);h.emit(h.env,'pointermove',{pointerId:5,clientY:20});}
    if(reason==='destroy')view.destroy();
    h.emit(h.env,'pointerup',{pointerId:5,clientY:0});
    assert.deepEqual(patches,[],reason);assert.equal(view.host.style.bottom,reason==='layout'?'25px':'70px',reason);
    assert.equal(box.style.cursor,'grab',reason);assert.deepEqual(captures,[['capture',5],['release',5]],reason);
  }
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

test('track choices refresh labels and availability while preserving the selected track',async t=>{
  const {view,player}=setup();t.after(()=>view.destroy());view.render({});
  const tracks=player.querySelector('[data-kuai-subtitle-settings]').shadowRoot.querySelector('.subtitle-track');
  assert.ok(tracks);assert.equal(tracks.disabled,true);
  view.setTracks([{id:'en',name:'English'}],'en');assert.equal(tracks.disabled,false);assert.equal(tracks.value,'en');assert.ok(Array.from(tracks.children).some(option=>option.value===''),'automatic choice remains reachable with one track');
  view.setTracks([{id:'en',name:'English'},{id:'ja',name:'日本語'}],'ja');assert.equal(tracks.disabled,false);assert.equal(tracks.value,'ja');
  view.setTracks([{id:'en',name:'English'},{id:'ja',name:'日本語',kind:'asr'}],'ja');assert.equal(tracks.children[1].textContent,'日本語 · 自动字幕');
  view.setTracks([],null);assert.equal(tracks.disabled,true);assert.equal(tracks.value,'');
});

test('a rejected track change stays visible in settings and permits another attempt',async t=>{
  const {h,view,player}=setup({onTrackChange:async()=>{throw new Error('字幕语言切换失败');}});t.after(()=>view.destroy());view.render({});
  view.setTracks([{id:'en',name:'English'},{id:'ja',name:'日本語'}],'en');h.emit(view.toolbar.querySelector('[data-kuai-subtitle-settings-toggle]'),'click');
  const panel=player.querySelector('[data-kuai-subtitle-settings]'),tracks=panel.shadowRoot.querySelector('.subtitle-track');assert.ok(tracks);
  tracks.value='ja';h.emit(tracks,'change');await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(panel.hidden,false);assert.match(panel.shadowRoot.querySelector('.settings-status').textContent,/切换失败/);assert.equal(tracks.disabled,false);assert.equal(tracks.value,'en');
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
