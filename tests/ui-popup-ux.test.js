import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {startPopup} from '../dist/src/ui/popup.js';
import {defaultSettings,normalizeSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';

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

test('popup rechecks the page before toggling so a stale status cannot reverse the intended action',async t=>{
  const h=setup(t);await h.start();
  h.setPageState({active:true,total:1,translated:0});
  await h.node('translate-page').fire('click');
  assert.deepEqual(h.actions().map(item=>item.type),['KUAI_PAGE_RESTORE']);
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

test('paragraph shortcut can be enabled from the popup without starting a translation or changing its configuration',async t=>{
  const h=setup(t);await h.start();
  const field=h.node('paragraph-enabled');assert.ok(field,'the popup exposes the paragraph shortcut switch');
  field.checked=true;await field.fire('change');await setImmediate();
  assert.equal(h.settings.hoverEnabled,true);assert.equal(h.settings.hoverOptions.trigger,'shift');
  assert.equal(h.settings.activeProviderId,'microsoft');assert.equal(h.actions().length,0);
  assert.equal(h.writes.length,1);assert.ok(h.writes[0].baseSettings);
});

test('popup freezes settings while it flushes an earlier save and dispatches the requested page action',async t=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const translatedWith=[];
  const h=setup(t,{onSave:()=>waiting,onAction:type=>{if(type==='KUAI_PAGE_TRANSLATE')translatedWith.push([h.settings.activeProviderId,h.settings.targetLanguage]);}});await h.start();
  h.node('provider').value='google';const saving=h.node('provider').fire('change');await setImmediate();
  const task=h.node('translate-page').fire('click');await setImmediate();
  assert.equal(h.actions().length,0,'the action waits for the earlier settings write');
  for(const id of ['provider','target','paragraph-enabled'])assert.equal(h.node(id).disabled,true,id+' must not admit a later unsaved choice during this action');
  release();await saving;await task;
  assert.deepEqual(translatedWith,[['google','zh-Hans']]);
  for(const id of ['provider','target','paragraph-enabled'])assert.equal(h.node(id).disabled,false);
});

test('unsupported browser pages explain why the main action is unavailable without sending content messages',async t=>{
  const h=setup(t,{url:'chrome://extensions/'});await h.start();
  assert.equal(h.node('translate-page').disabled,true);
  assert.match(h.node('page-scope').textContent,/普通网页|浏览器/);
  await h.node('translate-page').fire('click');assert.equal(h.sent.length,0);
});

test('a page with only failed paragraphs reports failure rather than claiming translations exist',async t=>{
  const h=setup(t,{state:{active:false,total:3,translated:0,errors:3,error:'Provider limit reached'}});await h.start();
  assert.match(h.node('page-scope').textContent,/3.*失败/);
  assert.match(h.node('page-scope').textContent,/Provider limit reached/);
  assert.doesNotMatch(h.node('page-scope').textContent,/有 3 段译文/);
  assert.equal(h.node('page-scope').classList.contains('error'),true);
  await h.node('translate-page').fire('click');
  assert.equal(h.node('page-scope').classList.contains('error'),false);
});

for(const code of ['SETTINGS_CONFLICT','STORAGE_ERROR'])test('popup explains unsaved settings and a recovery path for '+code,async t=>{
  const h=setup(t,{onSave:()=>{throw Object.assign(new Error('Storage rejected this edit'),{code});}});await h.start();
  h.node('provider').value='google';await h.node('provider').fire('change');
  assert.equal(h.settings.activeProviderId,'microsoft');
  assert.match(h.node('status').textContent,/未保存/);assert.match(h.node('status').textContent,/重新打开/);
  assert.equal(h.node('translate-page').disabled,true,'unsaved choices must not launch a page translation');
  assert.equal(h.actions().length,0);
});

test('a successful retrying settings edit removes the earlier save error and unlocks translation',async t=>{
  let first=true;const h=setup(t,{onSave:()=>{if(first){first=false;throw new Error('Temporary storage failure');}}});await h.start();
  h.node('provider').value='google';await h.node('provider').fire('change');
  assert.equal(h.node('status').classList.contains('error'),true);
  h.node('target').value='en';await h.node('target').fire('change');
  assert.equal(h.settings.targetLanguage,'en');assert.equal(h.settings.activeProviderId,'google');
  assert.equal(h.node('status').classList.contains('error'),false);assert.doesNotMatch(h.node('status').textContent,/未保存|failure/);
  assert.equal(h.node('translate-page').disabled,false);
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

test('language pair swaps only after an explicit source language is chosen',async t=>{
  const h=setup(t);await h.start();
  assert.equal(h.node('swap-languages').disabled,true,'auto-detect cannot become a target');
  h.node('source').value='en';await h.node('source').fire('change');
  assert.equal(h.node('swap-languages').disabled,false);
  await h.node('swap-languages').fire('click');
  assert.equal(h.settings.sourceLanguage,'zh-Hans');assert.equal(h.settings.targetLanguage,'en');
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

test('page badge and progress follow the page translation state',async t=>{
  const h=setup(t,{state:{active:true,total:4,translated:1}});await h.start();
  assert.equal(h.node('page-badge').dataset.state,'working');
  assert.equal(h.node('page-progress').hidden,false);
  assert.equal(h.node('page-progress-bar').style.width,'25%');
});

test('a keyed service without an API key links to its configuration',async t=>{
  const h=setup(t);await h.start();
  assert.equal(h.node('provider-warning').hidden,true);
});
