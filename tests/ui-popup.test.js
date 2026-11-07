import test from 'node:test';
import assert from 'node:assert/strict';
import * as popup from '../dist/src/ui/popup.js';
import {startPopup} from '../dist/src/ui/popup.js';
import {defaultSettings,normalizeSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';
import {setImmediate} from 'node:timers/promises';
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
  assert.equal(h.node('display-bilingual').checked,true);
  h.node('display-bilingual').checked=false;await h.node('display-bilingual').fire('change');
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
  assert.equal(h.node('site-default').checked,true);
  h.node('site-always').checked=true;await h.node('site-always').fire('change');
  assert.deepEqual(h.settings.pageOptions.alwaysSites,['news.example.com']);
  assert.equal(h.settings.pageOptions.autoTranslate,true);
  h.node('site-never').checked=true;await h.node('site-never').fire('change');
  assert.deepEqual(h.settings.pageOptions.alwaysSites,[]);assert.deepEqual(h.settings.pageOptions.neverSites,['news.example.com']);
  assert.equal(h.node('page-badge').dataset.state,'blocked');
  h.node('site-default').checked=true;await h.node('site-default').fire('change');
  assert.deepEqual(h.settings.pageOptions.neverSites,[]);
  assert.equal(h.node('site-default').checked,true);
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
