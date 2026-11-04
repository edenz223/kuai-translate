import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createBackground} from '../dist/src/background/controller.js';
import {createContentRuntime} from '../dist/src/content/index.js';
import {onSettingsChanged} from '../dist/src/shared/client.js';
import {defaultSettings,SETTINGS_KEY} from '../dist/src/shared/settings.js';
import {startPopup} from '../dist/src/ui/popup.js';
import {fixture as contentDocument} from './helpers/content-dom.cjs';
import {createDocument} from './helpers/ui-document.cjs';

const extensionId='kuai-delivery';
const options={id:extensionId,url:`chrome-extension://${extensionId}/popup.html`,documentId:'popup-a'};
const page={id:extensionId,url:'https://example.com/article',tab:{id:4},frameId:0,documentId:'page-a'};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function event(){
  const listeners=new Set();
  return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),
    emit(...args){for(const fn of listeners)fn(...args);},
    send(message){return new Promise(resolve=>{let pending=false;for(const fn of listeners)pending=fn(message,{id:extensionId},resolve)===true||pending;if(!pending)resolve();});}};
}
function fixture(t,{stored=defaultSettings(),queryHook,sendHook,writeHook,runtimeHook,url=page.url}={}){
  let data=structuredClone(stored),controller;
  const changed=event(),writes=[],sent=[],delivered=[],applied=new Map([[4,structuredClone(stored)]]);
  const chromeApi={
    runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,onMessage:event(),onInstalled:event(),
      sendMessage:async message=>message.type==='KUAI_SETTINGS_CHANGED'?runtimeHook?.(message):controller.handleMessage(message,options)},
    storage:{onChanged:changed,local:{setAccessLevel:async()=>{},get:async()=>({[SETTINGS_KEY]:structuredClone(data)}),set:async values=>{
      data=structuredClone(values[SETTINGS_KEY]);writes.push(structuredClone(data));
      changed.emit({[SETTINGS_KEY]:{newValue:structuredClone(data)}},'local');await writeHook?.(data);
    }}},
    tabs:{onRemoved:event(),query:async query=>query.active?[{id:4,url}]:(await queryHook?.())||[{id:4}],sendMessage:async(tabId,message)=>{
      sent.push({tabId,message:structuredClone(message)});await sendHook?.(tabId,message);
      applied.set(tabId,structuredClone(message.settings));delivered.push({tabId,settings:structuredClone(message.settings)});
    }},
  };
  controller=createBackground({chromeApi}).start();t.after(()=>controller.stop());
  return {controller,chromeApi,writes,sent,delivered,applied,get stored(){return structuredClone(data);},
    save:settings=>controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings},options),
    externalSave(settings){data=structuredClone(settings);changed.emit({[SETTINGS_KEY]:{newValue:structuredClone(data)}},'local');}};
}

test('a persisted save does not wait for advisory discovery or delivery, and notifications stay public',async t=>{
  const query=deferred(),delivery=deferred(),stored=defaultSettings();
  stored.providers.push({id:'private',name:'Private',type:'azure',enabled:true,apiKey:'delivery-private-key',baseUrl:'https://private.example/translate',region:'eastasia'});
  const h=fixture(t,{stored,queryHook:()=>query.promise,sendHook:()=>delivery.promise});await h.controller.ready;
  t.after(()=>{query.resolve();delivery.resolve();});
  let settled=false;const saving=h.save({...stored,targetLanguage:'ja'}).then(result=>{settled=true;return result;});
  await setImmediate();
  assert.equal(h.stored.targetLanguage,'ja');assert.equal(h.applied.get(4).targetLanguage,'zh-Hans');
  assert.equal(settled,true,'advisory tab discovery must not hold a persisted save');
  query.resolve();await setImmediate();
  assert.equal(settled,true,'advisory tab delivery must not hold a persisted save');
  assert.equal(h.applied.get(4).targetLanguage,'zh-Hans');
  delivery.resolve();const result=await saving;await setImmediate();
  assert.equal(result.ok,true);assert.equal(h.applied.get(4).targetLanguage,'ja');
  assert.equal(result.value.providers.at(-1).apiKey,'delivery-private-key');
  assert.doesNotMatch(JSON.stringify(h.sent),/delivery-private-key|private\.example|eastasia/);
});

test('an unrelated receiver that never settles cannot block saves or newer notifications',async t=>{
  const delivery=deferred(),h=fixture(t,{queryHook:()=>[{id:4},{id:99}],sendHook:id=>id===99?delivery.promise:undefined});
  await h.controller.ready;t.after(()=>delivery.resolve());
  const results=[];
  const first=h.save({...defaultSettings(),targetLanguage:'ja'}).then(result=>{results.push(result);return result;});
  const second=h.save({...defaultSettings(),targetLanguage:'de'}).then(result=>{results.push(result);return result;});
  await setImmediate();
  assert.equal(results.length,2,'both saves finish while tab 99 remains unresponsive');
  assert.ok(results.every(result=>result.ok));await first;await second;
  assert.deepEqual(h.delivered.filter(item=>item.tabId===4).map(item=>item.settings.targetLanguage),['ja','de']);
  assert.equal(h.stored.targetLanguage,'de');assert.equal(h.applied.get(4).targetLanguage,'de');
  assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page)).value.targetLanguage,'de');
  assert.equal((await h.controller.handleMessage({type:'KUAI_CANCEL',requestId:'absent'},page)).ok,true);
});

test('a storage notification before write completion does not duplicate delivery or delay the save',async t=>{
  const query=deferred(),write=deferred(),h=fixture(t,{queryHook:()=>query.promise,writeHook:()=>write.promise});
  await h.controller.ready;t.after(()=>{query.resolve();write.resolve();});
  let settled=false;const saving=h.save({...defaultSettings(),targetLanguage:'ja'}).then(result=>{settled=true;return result;});
  await setImmediate();
  assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page)).value.targetLanguage,'ja');
  write.resolve();await setImmediate();
  assert.equal(settled,true,'an identical publish remains advisory');
  query.resolve();assert.equal((await saving).ok,true);await setImmediate();
  assert.deepEqual(h.delivered.map(item=>item.settings.targetLanguage),['ja']);
});

test('a late obsolete storage notification cannot restore output made with authoritative newer settings',async t=>{
  const query=deferred();let queries=0;
  const h=fixture(t,{queryHook:()=>++queries===1?query.promise:undefined});await h.controller.ready;t.after(()=>query.resolve());
  const content=await attachContent(t,h),paragraph=content.paragraph('Hello');
  for(const targetLanguage of ['ja','de','fr']){h.externalSave({...defaultSettings(),targetLanguage});await setImmediate();}
  assert.equal((await h.chromeApi.tabs.sendMessage(4,{type:'KUAI_PAGE_TRANSLATE'})).ok,true);await setImmediate();
  const output=paragraph.querySelector('[data-kuai-page-translation]');assert.ok(output);
  assert.equal(content.requests[0].options.targetLanguage,'fr');
  query.resolve();await setImmediate();
  assert.deepEqual(h.delivered.map(item=>item.settings.targetLanguage),['de','fr','ja']);
  assert.equal(content.settings.targetLanguage,'fr');assert.equal(content.runtime.status().translated,1);
  assert.strictEqual(paragraph.querySelector('[data-kuai-page-translation]'),output);assert.equal(content.requests.length,1);
  assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page)).value.targetLanguage,'fr');
});

test('closed and ignored tabs cannot fail a persisted save or prevent delivery to another tab',async t=>{
  const h=fixture(t,{queryHook:()=>[{id:4},{id:5},{id:6},{id:-1},{id:'7'},{}],
    runtimeHook:()=>{throw Error('No open extension page');},
    sendHook:tabId=>{if(tabId===4)throw Error('Tab closed');if(tabId===5)return Promise.reject(Error('No receiving end'));}});
  await h.controller.ready;const result=await h.save({...defaultSettings(),targetLanguage:'ja'});await setImmediate();
  assert.equal(result.ok,true);assert.equal(h.stored.targetLanguage,'ja');assert.equal(h.applied.get(6)?.targetLanguage,'ja');
  assert.deepEqual(h.sent.map(item=>item.tabId),[4,5,6]);
});

test('a failed broadcast query does not let a page action use settings older than its successful save',async t=>{
  const h=fixture(t,{queryHook:()=>{throw Error('Tabs unavailable');}});await h.controller.ready;
  const content=await attachContent(t,h);content.paragraph('Hello');
  assert.equal((await h.save({...defaultSettings(),targetLanguage:'ja'})).ok,true);
  assert.equal(content.settings.targetLanguage,'zh-Hans');
  assert.equal((await h.chromeApi.tabs.sendMessage(4,{type:'KUAI_PAGE_TRANSLATE'})).ok,true);await setImmediate();
  assert.equal(content.requests[0].options.targetLanguage,'ja');assert.equal(content.settings.targetLanguage,'ja');
});

test('stopping after a persisted save suppresses its delayed advisory delivery and rejects later writes',async t=>{
  const query=deferred(),h=fixture(t,{queryHook:()=>query.promise});await h.controller.ready;t.after(()=>query.resolve());
  let saved;const first=h.save({...defaultSettings(),targetLanguage:'ja'}).then(result=>{saved=result;});
  await setImmediate();assert.equal(saved?.ok,true);h.controller.stop();query.resolve();await first;await setImmediate();
  assert.equal((await h.save({...defaultSettings(),targetLanguage:'de'})).error?.code,'CANCELLED');
  assert.equal(h.writes.length,1);assert.equal(h.sent.length,0);
});

async function attachContent(t,h,{onOpenList}={}){
  const content=contentDocument(),messages=event();let current;
  content.env.chrome={runtime:{id:extensionId,onMessage:messages}};
  const client={...content.dependencies,
    getSettings:async()=>{const response=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page);if(!response.ok)throw Object.assign(Error(response.error.message),response.error);return response.value;},
    onSettingsChanged:callback=>onSettingsChanged(callback,content.env.chrome),
    updatePagePreferences:async patch=>{const result=await h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch},page);assert.equal(result.ok,true);return result.value;},
  };
  const runtime=createContentRuntime({env:content.env,client,startYouTube:({settings,subscribeSettings})=>{
    current=settings;const off=subscribeSettings(next=>{current=next;});
    return {stop:off,openSidebar:()=>onOpenList?.(current)||{opened:true}};
  }});
  const broadcast=h.chromeApi.tabs.sendMessage;
  h.chromeApi.tabs.sendMessage=async(tabId,message)=>{
    if(tabId!==4)return broadcast(tabId,message);
    if(message.type==='KUAI_SETTINGS_CHANGED')await broadcast(tabId,message);
    return messages.send(message);
  };
  t.after(()=>runtime.stop());await runtime.start();
  return {...content,runtime,client,get settings(){return current;}};
}

test('content-originated preference saves leave messages available and the next status synchronizes settings',async t=>{
  const h=fixture(t);await h.controller.ready;const content=await attachContent(t,h);
  const result=await content.client.updatePagePreferences({pageDisplayMode:'translation_only'});
  assert.equal(result.pageDisplayMode,'translation_only');
  assert.equal((await h.chromeApi.tabs.sendMessage(4,{type:'KUAI_PAGE_STATUS'})).ok,true);
  assert.equal(content.settings.pageDisplayMode,'translation_only');
});

test('the actual popup synchronizes saved settings before translating even while broadcast discovery waits',async t=>{
  const query=deferred(),read=deferred(),h=fixture(t,{queryHook:()=>query.promise});await h.controller.ready;t.after(()=>{query.resolve();read.resolve();});
  const content=await attachContent(t,h),paragraph=content.paragraph('Hello');
  const popup=createDocument(new URL('../public/popup.html',import.meta.url)),previous=globalThis.chrome;
  globalThis.chrome=h.chromeApi;t.after(()=>{globalThis.chrome=previous;});await startPopup(popup.document,h.chromeApi);
  const getSettings=content.client.getSettings;content.client.getSettings=async()=>{await read.promise;return getSettings();};
  popup.node('target').value='ja';const saving=popup.node('target').fire('change');await setImmediate();
  const translating=popup.node('translate-page').fire('click');await setImmediate();
  assert.equal(h.stored.targetLanguage,'ja');assert.equal(content.settings.targetLanguage,'zh-Hans');
  assert.equal(content.requests.length,0,'the popup must not translate before content applies the saved target');
  read.resolve();await setImmediate();assert.equal(content.requests.length,1);await saving;await translating;
  assert.equal(content.requests.length,1);assert.equal(content.requests[0].options.targetLanguage,'ja');
  assert.equal(content.runtime.status().translated,1);assert.ok(paragraph.querySelector('[data-kuai-page-translation]'));
  assert.match(popup.node('translate-page').textContent,/恢复原文/);
  query.resolve();await setImmediate();assert.equal(content.runtime.status().translated,1);
});

test('the popup subtitle-list action sees the newly enabled state after delayed settings delivery',async t=>{
  const query=deferred(),read=deferred(),stored=defaultSettings();stored.subtitlesEnabled=false;
  const h=fixture(t,{stored,queryHook:()=>query.promise,url:'https://www.youtube.com/watch?v=abcdefghijk'});await h.controller.ready;t.after(()=>{query.resolve();read.resolve();});
  const opened=[],content=await attachContent(t,h,{onOpenList:settings=>{opened.push(settings.subtitlesEnabled);return {opened:settings.subtitlesEnabled};}});
  const popup=createDocument(new URL('../public/popup.html',import.meta.url)),previous=globalThis.chrome;
  globalThis.chrome=h.chromeApi;t.after(()=>{globalThis.chrome=previous;});await startPopup(popup.document,h.chromeApi);
  const getSettings=content.client.getSettings;content.client.getSettings=async()=>{await read.promise;return getSettings();};
  popup.node('subtitles').checked=true;const saving=popup.node('subtitles').fire('change');await setImmediate();
  const opening=popup.node('subtitle-list').fire('click');await setImmediate();
  assert.equal(h.stored.subtitlesEnabled,true);assert.equal(content.settings.subtitlesEnabled,false);assert.deepEqual(opened,[]);
  read.resolve();await setImmediate();assert.deepEqual(opened,[true]);await saving;await opening;
  assert.deepEqual(opened,[true]);assert.equal(popup.node('status').classList.contains('error'),false);
});

test('the popup exposes a failed authoritative read and does not dispatch translation until retry succeeds',async t=>{
  const h=fixture(t,{queryHook:()=>{throw Error('No broadcast tabs');}});await h.controller.ready;
  const content=await attachContent(t,h);content.paragraph('Hello');
  const popup=createDocument(new URL('../public/popup.html',import.meta.url)),previous=globalThis.chrome;
  globalThis.chrome=h.chromeApi;t.after(()=>{globalThis.chrome=previous;});await startPopup(popup.document,h.chromeApi);
  const getSettings=content.client.getSettings;content.client.getSettings=async()=>{throw Error('Private read failure');};
  popup.node('target').value='ja';await popup.node('target').fire('change');
  await popup.node('translate-page').fire('click');await setImmediate();
  assert.equal(h.stored.targetLanguage,'ja');assert.equal(content.requests.length,0);
  assert.equal(popup.node('status').classList.contains('error'),true);assert.match(popup.node('status').textContent,/设置/);
  content.client.getSettings=getSettings;await popup.node('translate-page').fire('click');await setImmediate();
  assert.equal(content.requests[0].options.targetLanguage,'ja');assert.equal(popup.node('status').classList.contains('error'),false);
});
