import test from 'node:test';
import assert from 'node:assert/strict';
import {studyFixture,rect} from './helpers/youtube-study.mjs';

test('all real controllers expose the subtitle list before any caption metadata or request succeeds',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.flush();
  assert.ok(h.mainButton()?.isConnected);assert.ok(h.listButton()?.isConnected);
  h.emit(h.listButton(),'click');await h.flush();assert.ok(h.panel()?.isConnected);assert.equal(h.panel().hidden,false);
  assert.match(h.panel().shadowRoot.querySelector('.panel-status').textContent,/字幕/);assert.equal(h.translations.length,0);
});
test('temporarily zero-sized and offscreen players retain their timeline, controls and open sidebar',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();h.emit(h.listButton(),'click');await h.flush();
  const session=h.session(),main=h.mainButton(),panel=h.panel(),cues=session.state.subtitlesList;
  for(const box of [rect(0,0,0,0),rect(0,-600,960,540)]){
    h.video._rect=box;h.manager.sync();await h.flush();
    assert.ok(h.session()===session,'connected session must survive temporary layout changes');assert.ok(session.state.subtitlesList===cues);
    assert.ok(main.isConnected);assert.ok(h.panel()===panel);assert.equal(panel.hidden,false);
  }
});
test('an identified player can mount its entry while video dimensions are still zero',async t=>{
  const h=studyFixture({rect:rect(0,0,0,0)});t.after(()=>h.manager.stop());await h.flush();
  assert.ok(h.mainButton()?.isConnected);assert.ok(h.listButton()?.isConnected);assert.equal(h.translations.length,0);
});
test('a partial player-view startup failure releases actual controller listeners before it is retried',()=>{
  let h;assert.throws(()=>studyFixture({onHarness:value=>{h=value;},createView:()=>{throw new Error('view unavailable');}}),/view unavailable/);
  assert.equal(h.env.listeners.get('message')?.size||0,0);assert.equal(h.document.listeners.get('selectionchange')?.size||0,0);
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
test('a rejected preference save stays visible in the independent settings panel',async t=>{
  const h=studyFixture({save:async()=>{throw new Error('无法保存，请重试');}});t.after(()=>h.manager.stop());await h.flush();assert.ok(h.settingsButton());h.emit(h.settingsButton(),'click');
  const shadow=h.settingsPanel().shadowRoot,control=shadow.querySelector('.subtitle-provider');control.value='google';h.emit(control,'change');await h.flush();
  assert.equal(h.settingsPanel().hidden,false);assert.match(shadow.querySelector('.settings-status').textContent,/无法保存/);assert.equal(control.disabled,false);
});
test('video display customization keeps the reading list bilingual and independently styled while sharing its learning mask',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();assert.equal(typeof h.manager.openSidebar,'function');assert.equal(h.manager.openSidebar(),true);await h.flush();
  const original=h.captionHost().shadowRoot.querySelector('.original-text'),translation=h.captionHost().shadowRoot.querySelector('.translation-text');
  const node=translation.firstChild,cues=h.session().state.subtitlesList,requestCount=h.translations.length;
  const rowOriginal=h.panel().shadowRoot.querySelector('.original-text'),rowTranslation=h.panel().shadowRoot.querySelector('.translation-text');
  const rowNodes=[rowOriginal.firstChild,rowTranslation.firstChild],properties=['color','font-size','font-weight','font-family','text-shadow'];
  const readingStyles=()=>[rowOriginal,rowTranslation].map(element=>properties.map(property=>element.style[property]));
  const before=readingStyles();
  h.manager.updateSettings({...h.config,subtitleStyle:{...h.config.subtitleStyle,sourceColor:'#ff0000',targetColor:'#00ff00',sourceFontSize:40,targetFontSize:42,displayMode:'translation_only',displayOrder:'translation_on_top',hideTranslation:true}});await h.flush();
  assert.equal(original.style.color,'#ff0000');assert.equal(translation.style.color,'#00ff00');assert.equal(original.hidden,true);
  assert.deepEqual(readingStyles(),before);assert.equal(rowOriginal.hidden,false);assert.equal(rowTranslation.hidden,false);
  assert.ok(Number(rowTranslation.style.order||0)>=Number(rowOriginal.style.order||0));assert.deepEqual([rowOriginal.firstChild,rowTranslation.firstChild],rowNodes);
  assert.equal(translation.style.order,'-1');assert.match(translation.style.filter,/blur/);assert.match(rowTranslation.style.filter,/blur/);
  h.emit(rowTranslation,'focus');assert.equal(rowTranslation.style.filter,'none');h.emit(rowTranslation,'blur');assert.match(rowTranslation.style.filter,/blur/);
  h.emit(translation,'mouseenter');assert.equal(translation.style.filter,'none');h.emit(translation,'mouseleave');assert.match(translation.style.filter,/blur/);
  assert.ok(translation.firstChild===node);assert.ok(h.session().state.subtitlesList===cues);assert.equal(h.translations.length,requestCount);
});
test('layout preferences cancel an owned subtitle pause before hiding text and never resume playback',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();
  const original=h.captionHost().shadowRoot.querySelector('.original-text'),textNode=original.firstChild;
  h.video.paused=false;h.document.selection={isCollapsed:false,rangeCount:1,anchorNode:textNode,focusNode:textNode,toString:()=>original.textContent,getRangeAt:()=>({startContainer:textNode,endContainer:textNode,startOffset:0,endOffset:5})};
  h.emit(h.document,'selectionchange');assert.equal(h.video.pauseCount,1);assert.equal(h.session().state.isSubtitleSelectionHeld,true);
  h.manager.updateSettings({...h.config,subtitleStyle:{...h.config.subtitleStyle,displayMode:'translation_only'}});await h.flush();
  assert.equal(h.session().state.isSubtitleSelectionHeld,false);assert.equal(original.hidden,true);assert.ok(original.firstChild===textNode);
  h.document.selection={isCollapsed:true,toString:()=>''};h.emit(h.document,'selectionchange');assert.equal(h.video.playCount,0);
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
test('a late enable preference response cannot click CC on a replacement video session',async t=>{
  let resolve;const h=studyFixture({settings:{subtitlesEnabled:false},cc:false,save:()=>new Promise(done=>{resolve=done;})});t.after(()=>h.manager.stop());await h.flush();
  const old=h.session();h.emit(h.mainButton(),'click');
  h.env.location.href='https://www.youtube.com/watch?v=different01';h.manager.sync();await h.flush();assert.notEqual(h.session().id,old.id);
  resolve({...h.config,subtitlesEnabled:true});await h.flush();
  assert.equal(h.ccButton.getAttribute('aria-pressed'),'false');assert.equal(h.session().isEnabled(),false);assert.equal(h.video.playCount,0);
});
test('the player preference toggle can re-enable translation disabled from the toolbar',async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());await h.load();h.emit(h.mainButton(),'click');await h.flush();assert.equal(h.session().isEnabled(),false);
  h.emit(h.settingsButton(),'click');const enabled=h.settingsPanel().shadowRoot.querySelector('.subtitles-enabled');
  enabled.checked=false;h.emit(enabled,'change');await h.flush();enabled.checked=true;h.emit(enabled,'change');await h.flush();
  assert.equal(h.session().isEnabled(),true);assert.equal(h.mainButton().getAttribute('aria-pressed'),'true');
});
