import test from 'node:test';
import assert from 'node:assert/strict';
import * as popup from '../dist/src/ui/popup.js';
import {startPopup} from '../dist/src/ui/popup.js';
import {defaultSettings,normalizeSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';
import {setImmediate} from 'node:timers/promises';
import {keyLabel,keyName,isMac,selectionTriggers} from '../dist/src/ui/common.js';
import {applySiteRule,siteRuleState,siteHost,inputSiteDisabled,setInputSiteDisabled} from '../dist/src/shared/site-rules.js';

test('popup page actions target only the main frame and unwrap the content response',async()=>{
  assert.equal(typeof popup.sendPageAction,'function');
  const sent=[];
  const chromeApi={tabs:{query:async()=>[{id:7,url:'https://example.com/'}],sendMessage:async(...args)=>{sent.push(args);return {ok:true,value:{active:true}};}}};
  assert.deepEqual(await popup.sendPageAction('KUAI_PAGE_TRANSLATE',chromeApi),{active:true});
  assert.deepEqual(sent,[[7,{type:'KUAI_PAGE_TRANSLATE'},{frameId:0}]]);
  chromeApi.tabs.query=async()=>[{id:7,url:'chrome://extensions'}];
  await assert.rejects(popup.sendPageAction('KUAI_PAGE_TRANSLATE',chromeApi),/普通网页/);
  assert.equal(sent.length,1);
});

test('popup initializes outside YouTube and subtitle actions remain scoped to video pages',async t=>{
  const h=createDocument(new URL('../public/popup.html',import.meta.url)),sent=[],previous=globalThis.chrome;
  const chromeApi={runtime:{sendMessage:async()=>({ok:true,value:defaultSettings()})},tabs:{query:async()=>[{id:9,url:'https://example.com/'}],sendMessage:async(...args)=>{sent.push(args);return {ok:true,value:{active:false,total:0,translated:0}};}}};
  globalThis.chrome=chromeApi;t.after(()=>{globalThis.chrome=previous;});
  await popup.startPopup(h.document,chromeApi);
  assert.equal(h.node('subtitle-list'),null);
  assert.equal(h.node('translate-page').disabled,false);
  await assert.rejects(popup.sendPageAction('KUAI_YOUTUBE_OPEN_LIST',chromeApi),/YouTube/);
  assert.deepEqual(sent,[[9,{type:'KUAI_PAGE_STATUS'},{frameId:0}]]);
});

function setup(t,{url='https://example.com/article',state={active:false,total:0,translated:0},onAction,onSave}={}) {
  const h=createDocument(new URL('../public/popup.html',import.meta.url)),sent=[],writes=[];
  let settings=defaultSettings(),pageState=state;
  const previous=globalThis.chrome,chromeApi={runtime:{sendMessage:async message=>{
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:structuredClone(settings)};
    if(message.type==='KUAI_SAVE_SETTINGS'){writes.push(message);await onSave?.(message);settings=normalizeSettings(message.settings);return {ok:true,value:structuredClone(settings)};}
    assert.fail('Unexpected background request '+message.type);
  }},tabs:{query:async()=>[{id:12,url}],sendMessage:async(id,message,options)=>{
    sent.push({id,type:message.type,options});
    if(message.type==='KUAI_PAGE_STATUS')return {ok:true,value:structuredClone(pageState)};
    if(onAction)await onAction(message.type);
    if(message.type==='KUAI_PAGE_RESTORE')pageState={active:false,total:0,translated:0};
    if(message.type==='KUAI_PAGE_TRANSLATE')pageState={active:true,total:2,translated:0};
    return {ok:true,value:structuredClone(pageState)};
  }}};
  globalThis.chrome=chromeApi;t.after(()=>{globalThis.chrome=previous;});
  return {...h,sent,writes,start:()=>startPopup(h.document,chromeApi),setPageState:value=>{pageState=value;},get settings(){return settings;},actions:()=>sent.filter(item=>item.type!=='KUAI_PAGE_STATUS')};
}

test('one popup page button restores existing paragraph translations and starts again on the next click',async t=>{
  const h=setup(t,{state:{active:false,total:3,translated:3}});await h.start();
  assert.match(h.node('translate-page-label').textContent,/恢复原文/);
  await h.node('translate-page').fire('click');
  assert.deepEqual(h.actions().map(item=>item.type),['KUAI_PAGE_RESTORE']);
  assert.match(h.node('translate-page-label').textContent,/翻译此网页/);
  await h.node('translate-page').fire('click');
  assert.deepEqual(h.actions().map(item=>item.type),['KUAI_PAGE_RESTORE','KUAI_PAGE_TRANSLATE']);
  assert.match(h.node('translate-page-label').textContent,/恢复原文/);
  assert.ok(h.sent.every(item=>item.id===12&&item.options.frameId===0));
});

test('popup coalesces repeated clicks while a page action is pending',async t=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const h=setup(t,{onAction:()=>waiting});await h.start();
  const task=h.node('translate-page').fire('click');await setImmediate();
  assert.equal(h.node('translate-page').disabled,true);
  await h.node('translate-page').fire('click');
  assert.equal(h.actions().length,1);
  release();await task;assert.equal(h.node('translate-page').disabled,false);
});

test('unsupported browser pages explain why the main action is unavailable without sending content messages',async t=>{
  const h=setup(t,{url:'chrome://extensions/'});await h.start();
  assert.equal(h.node('translate-page').disabled,true);
  assert.match(h.node('page-scope').textContent,/普通网页|浏览器/);
  await h.node('translate-page').fire('click');assert.equal(h.sent.length,0);
});

test('quick switches save display mode, selection and input without starting a translation',async t=>{
  const h=setup(t);await h.start();
  assert.equal(h.node('display-bilingual').checked,true);assert.equal(h.node('display-translation').checked,false);
  h.node('display-translation').checked=true;await h.node('display-translation').fire('change');
  assert.equal(h.node('display-bilingual').checked,false);
  h.node('selection-enabled').checked=true;await h.node('selection-enabled').fire('change');
  h.node('input-enabled').checked=false;await h.node('input-enabled').fire('change');
  assert.equal(h.settings.pageDisplayMode,'translation_only');
  assert.equal(h.settings.selectionEnabled,true);
  assert.equal(h.settings.inputOptions.enabled,false);
  assert.equal(h.actions().length,0);
});

test('site rule writes only this host and keeps auto-translate scoped to it',async t=>{
  const h=setup(t,{url:'https://news.example.com/a'});await h.start();
  assert.equal(h.node('site-host').textContent,'news.example.com');
  assert.equal(h.node('site-rule-field').hidden,false);
  assert.equal(h.node('site-rule').value,'default');
  const choose=async rule=>{h.node('site-rule').value=rule;await h.node('site-rule').fire('change');};
  await choose('always');
  assert.deepEqual(h.settings.pageOptions.alwaysSites,['news.example.com']);
  assert.equal(h.settings.pageOptions.autoTranslate,true);
  assert.equal(h.node('site-rule-note').hidden,true);
  await choose('never');
  assert.deepEqual(h.settings.pageOptions.alwaysSites,[]);assert.deepEqual(h.settings.pageOptions.neverSites,['news.example.com']);
  assert.equal(h.node('page-badge').dataset.state,'blocked');assert.equal(h.node('page-badge').hidden,false);
  await choose('default');
  assert.deepEqual(h.settings.pageOptions.neverSites,[]);
  assert.equal(h.node('site-rule').value,'default');
  assert.equal(h.node('page-badge').hidden,true);
});

test('site rule picker is hidden on browser pages and points to settings for broader patterns',async t=>{
  const h=setup(t,{url:'chrome://extensions/'});await h.start();
  assert.equal(h.node('site-rule-field').hidden,true);
  const g=setup(t,{url:'https://a.example.com/x'});g.settings.pageOptions.neverSites=['*.example.com'];await g.start();
  assert.equal(g.node('site-rule').value,'never');
  assert.equal(g.node('site-rule-note').hidden,false);
  assert.match(g.node('site-rule-text').textContent,/设置中的网站规则/);
});

test('idle popup stays quiet: no badge, no scope text and no page shortcut',async t=>{
  const h=setup(t);await h.start();
  assert.equal(h.node('page-badge').hidden,true);
  assert.equal(h.node('page-scope').textContent,'');
  assert.equal(h.node('page-shortcut'),null);
  h.node('selection-enabled').checked=true;await h.node('selection-enabled').fire('change');
  assert.equal(h.node('status').textContent,'','autosave success is silent');
  await h.node('translate-page').fire('click');
  assert.equal(h.node('status').textContent,'');
  assert.match(h.node('page-scope').textContent,/正在翻译 0 \/ 2 段/);
  assert.equal(h.node('page-badge').hidden,false);
});

test('feature rows pick triggers, the input shortcut and the translation style',async t=>{
  const h=setup(t);await h.start();
  const values=id=>h.node(id).children.map(option=>option.value);
  assert.equal(h.node('hover-trigger').value,'shift');assert.ok(!values('hover-trigger').includes('custom'));
  assert.equal(h.node('selection-trigger').value,h.settings.selectionOptions.triggerMode);
  assert.equal(h.node('input-shortcut').value,'Alt+X');
  assert.equal(h.node('input-shortcut').children[0].textContent,keyLabel('Alt+X'));
  assert.ok(!values('input-shortcut').includes('Alt+Z'),'the page shortcut is never offered');
  assert.equal(h.node('page-style').value,'border');
  const pick=async(id,value)=>{h.node(id).value=value;await h.node(id).fire('change');};
  await pick('hover-trigger','left_hold');await pick('selection-trigger','alt');await pick('input-shortcut','Alt+T');await pick('page-style','plain');
  assert.equal(h.settings.hoverOptions.trigger,'left_hold');
  assert.equal(h.settings.selectionOptions.triggerMode,'alt');
  assert.equal(h.settings.inputOptions.shortcut,'Alt+T');
  assert.equal(h.settings.pageStyle.preset,'plain');
  assert.equal(h.actions().length,0);
});

test('custom hover keys and other input shortcuts from the options page stay selectable',async t=>{
  const h=setup(t);h.settings.hoverOptions.trigger='custom';h.settings.hoverOptions.customKeys=['Control','Q'];h.settings.inputOptions.shortcut='Control+Alt+K';await h.start();
  assert.equal(h.node('hover-trigger').value,'custom');
  assert.equal(h.node('hover-trigger').children.find(option=>option.value==='custom').textContent,'Ctrl + Q');
  assert.equal(h.node('input-shortcut').value,'Control+Alt+K');
  assert.equal(h.node('paragraph-shortcut').hidden,true);
});

test('hover translation without a usable trigger asks for one in settings',async t=>{
  const h=setup(t);h.settings.hoverOptions.trigger='custom';h.settings.hoverOptions.customKeys=[];await h.start();
  assert.equal(h.node('paragraph-shortcut').hidden,false);
  assert.equal(h.node('hover-trigger').value,'custom');
});

test('a keyed service without an API key links to its configuration',async t=>{
  const h=setup(t);await h.start();
  assert.equal(h.node('provider-warning').hidden,true);
});

test('site rules leave broader patterns from the options page untouched',()=>{
  const settings=defaultSettings();settings.pageOptions.neverSites=['*.example.com'];
  const url='https://a.example.com/x';
  assert.equal(siteRuleState(settings,url),'never');
  applySiteRule(settings,url,'default');
  assert.deepEqual(settings.pageOptions.neverSites,['*.example.com']);
  assert.equal(siteRuleState(settings,url),'never');
});

test('a full rule list reports its limit and non-web pages are rejected',()=>{
  const settings=defaultSettings();
  settings.pageOptions.neverSites=Array.from({length:100},(_,index)=>`site${index}.example`);
  assert.throws(()=>applySiteRule(settings,'https://new.example/','never'),/100/);
  assert.equal(siteHost('chrome://extensions'),'');
  assert.throws(()=>applySiteRule(defaultSettings(),'chrome://extensions','never'),/普通网页/);
});

test('input site switch edits only this host and reports a broader pattern that still applies',()=>{
  const settings=defaultSettings(),url='https://mail.example.com/inbox';
  assert.equal(setInputSiteDisabled(settings,url,true),true);
  assert.deepEqual(settings.inputOptions.disabledSites,['mail.example.com']);
  assert.equal(setInputSiteDisabled(settings,url,true),true);assert.deepEqual(settings.inputOptions.disabledSites,['mail.example.com']);
  assert.equal(setInputSiteDisabled(settings,url,false),false);assert.deepEqual(settings.inputOptions.disabledSites,[]);
  settings.inputOptions.disabledSites=['*.example.com'];
  assert.equal(inputSiteDisabled(settings,url),true);
  assert.equal(setInputSiteDisabled(settings,url,false),true);assert.deepEqual(settings.inputOptions.disabledSites,['*.example.com']);
  assert.deepEqual(settings.pageOptions.neverSites,[],'page rules are separate');
  settings.inputOptions.disabledSites=Array.from({length:100},(_,index)=>`site${index}.example`);
  assert.throws(()=>setInputSiteDisabled(settings,'https://new.example/',true),/100/);
  assert.throws(()=>setInputSiteDisabled(settings,'chrome://settings/',true));
});

test('trigger choices dim with their switch and the main button takes focus',async t=>{
  const h=setup(t);await h.start();
  assert.equal(h.document.activeElement,h.node('translate-page'));
  assert.equal(h.node('hover-trigger').disabled,false);
  h.node('paragraph-enabled').checked=false;await h.node('paragraph-enabled').fire('change');
  assert.equal(h.node('hover-trigger').disabled,true);
  h.node('paragraph-enabled').checked=true;await h.node('paragraph-enabled').fire('change');
  assert.equal(h.node('hover-trigger').disabled,false);
  const g=setup(t);g.settings.selectionEnabled=false;g.settings.inputOptions.enabled=false;await g.start();
  assert.equal(g.node('selection-trigger').disabled,true);assert.equal(g.node('input-shortcut').disabled,true);
});

test('auto source names the detected page language',async t=>{
  const h=setup(t);let detect;
  const chromeApi=globalThis.chrome;chromeApi.tabs.detectLanguage=async id=>{detect=id;return 'en-US';};
  await h.start();await setImmediate();
  assert.equal(detect,12);
  assert.equal(h.node('source').children[0].textContent,'自动检测（English）');
  assert.equal(popup.languageId('zh-TW'),'zh-Hant');assert.equal(popup.languageId('zh-CN'),'zh-Hans');assert.equal(popup.languageId('und'),'');assert.equal(popup.languageId('xx'),'');
});

test('a tab without the content script offers a reload instead of a dead end',async t=>{
  const h=setup(t),chromeApi=globalThis.chrome,reloaded=[];
  chromeApi.tabs.sendMessage=async()=>{throw Error('Could not establish connection. Receiving end does not exist.');};
  chromeApi.tabs.reload=async id=>{reloaded.push(id);};
  await h.start();
  assert.match(h.node('page-scope').textContent,/刷新页面/);
  assert.equal(h.node('status').textContent,'','the message is not repeated in the status line');
  assert.equal(h.node('reload-page').hidden,false);
  assert.equal(h.node('translate-page').disabled,true);
  assert.notEqual(h.document.activeElement,h.node('translate-page'));
  await h.node('reload-page').fire('click');
  assert.deepEqual(reloaded,[12]);
});

test('key names follow the platform and both pages share one set of trigger labels',async t=>{
  assert.equal(isMac({platform:'MacIntel'}),true);assert.equal(isMac({userAgentData:{platform:'Windows'},platform:''}),false);
  assert.equal(keyLabel('Alt+X',true),'Option + X');assert.equal(keyLabel('Alt+X',false),'Alt + X');
  assert.equal(keyName('Meta',true),'Cmd');assert.equal(keyName('Meta',false),'Win');assert.equal(keyName('Control',true),'Ctrl');
  assert.deepEqual(selectionTriggers(true).find(([id])=>id==='alt'),['alt','Option']);
  const h=setup(t);await h.start();
  assert.deepEqual(h.node('selection-trigger').children.map(option=>[option.value,option.textContent]),selectionTriggers());
});

test('errors appear next to the control that caused them instead of the bottom status line',async t=>{
  let failSave=false;
  const h=setup(t,{url:'https://news.example.com/a',onSave:()=>{if(failSave)throw Error('存储空间不足');}});await h.start();
  failSave=true;
  h.node('selection-enabled').checked=true;await h.node('selection-enabled').fire('change');
  assert.equal(h.node('features-error').hidden,false);assert.match(h.node('features-error').textContent,/尚未保存/);
  assert.equal(h.node('page-error').hidden,true);
  assert.equal(h.node('status').textContent,'');
  failSave=false;
  h.node('selection-enabled').checked=true;await h.node('selection-enabled').fire('change');
  assert.equal(h.node('features-error').hidden,true);
  const full=setup(t,{url:'https://new.example/'});
  full.settings.pageOptions.neverSites=Array.from({length:100},(_,index)=>`site${index}.example`);await full.start();
  full.node('site-rule').value='never';await full.node('site-rule').fire('change');
  assert.equal(full.node('page-error').hidden,false);assert.match(full.node('page-error').textContent,/100/);
  assert.equal(full.node('site-rule').value,'default','the picker snaps back to the saved rule');
  assert.equal(full.node('status').textContent,'');
});

test('a failed page action is reported under the main button',async t=>{
  const h=setup(t,{onAction:()=>{throw Error('翻译服务暂时不可用');}});await h.start();
  await h.node('translate-page').fire('click');
  assert.match(h.node('page-scope').textContent,/翻译服务暂时不可用/);
  assert.equal(h.node('page-badge').dataset.state,'error');
  assert.equal(h.node('status').textContent,'');
});
