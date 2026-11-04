import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createContentRuntime} from '../src/content/index.js';
import {defaultSettings} from '../src/shared/settings.js';
import {fixture,Event} from './helpers/content-dom.cjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function setup(t){
  const h=fixture(),listeners=new Set(),subscribers=new Set(),updates=[],opened=[];
  let stored=defaultSettings(),current;
  h.env.chrome={runtime:{id:'kuai-sync',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
  const client={...h.dependencies,getSettings:async()=>structuredClone(stored),onSettingsChanged:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);}};
  const runtime=createContentRuntime({env:h.env,client,startYouTube:({settings,subscribeSettings})=>{
    current=settings;const off=subscribeSettings(next=>{current=next;updates.push(next);});
    return {stop:off,openSidebar(){opened.push(current);return {opened:true};}};
  }});
  t.after(()=>runtime.stop());
  const message=type=>new Promise(resolve=>{for(const listener of listeners)if(listener({type},{id:'kuai-sync'},resolve)===true)return;resolve();});
  return {...h,client,runtime,message,updates,opened,subscribers,
    store:next=>{stored=structuredClone(next);},notify:next=>subscribers.forEach(fn=>fn(next)),get settings(){return current;}};
}

test('page status pulls authoritative settings and restores output invalidated without a notification',async t=>{
  const h=setup(t),paragraph=h.paragraph('Hello');await h.runtime.start();
  await h.message('KUAI_PAGE_TRANSLATE');await setImmediate();assert.ok(paragraph.querySelector('[data-kuai-page-translation]'));
  h.store({...defaultSettings(),targetLanguage:'ja'});
  const result=await h.message('KUAI_PAGE_STATUS');
  assert.equal(result.ok,true);assert.equal(result.value.total,0);assert.equal(h.settings.targetLanguage,'ja');
});

test('an older action read cannot dispatch until a newer invalidation read finishes',async t=>{
  const h=setup(t),first=deferred(),second=deferred();h.paragraph('Hello');await h.runtime.start();
  t.after(()=>{first.resolve(defaultSettings());second.resolve(defaultSettings());});
  let reads=0;h.client.getSettings=()=>++reads===1?first.promise:second.promise;
  const translating=h.message('KUAI_PAGE_TRANSLATE');await setImmediate();
  assert.equal(reads,1);h.notify({...defaultSettings(),targetLanguage:'de'});await setImmediate();assert.equal(reads,2);
  first.resolve({...defaultSettings(),targetLanguage:'fr'});await setImmediate();
  assert.equal(h.requests.length,0);assert.equal(h.settings.targetLanguage,'zh-Hans');
  second.resolve({...defaultSettings(),targetLanguage:'ja'});const result=await translating;await setImmediate();
  assert.equal(result.ok,true);assert.equal(h.requests[0].options.targetLanguage,'ja');assert.equal(h.settings.targetLanguage,'ja');
});

test('a superseded unresolved read cannot hold an action after a newer authoritative result arrives',async t=>{
  const h=setup(t),old=deferred();h.paragraph('Hello');await h.runtime.start();t.after(()=>old.resolve(defaultSettings()));
  let reads=0;h.client.getSettings=()=>++reads===1?old.promise:Promise.resolve({...defaultSettings(),targetLanguage:'ja'});
  let result;const translating=h.message('KUAI_PAGE_TRANSLATE').then(value=>{result=value;});await setImmediate();
  assert.equal(reads,1);h.notify({...defaultSettings(),targetLanguage:'de'});await setImmediate();
  assert.equal(result?.ok,true,'the older action follows the newer read without awaiting its obsolete response');
  await translating;assert.equal(h.requests[0].options.targetLanguage,'ja');
  old.resolve({...defaultSettings(),targetLanguage:'fr'});await setImmediate();
  assert.equal(h.settings.targetLanguage,'ja');assert.equal(h.runtime.status().translated,1);assert.equal(h.requests.length,1);
});

test('a late obsolete read failure cannot replace a newer success or publish an error',async t=>{
  const h=setup(t),old=deferred();await h.runtime.start();t.after(()=>old.resolve(defaultSettings()));
  let reads=0;h.client.getSettings=()=>++reads===1?old.promise:Promise.resolve({...defaultSettings(),targetLanguage:'ja'});
  h.notify(defaultSettings());await setImmediate();assert.equal(reads,1);
  assert.equal((await h.message('KUAI_PAGE_STATUS')).ok,true);
  old.reject(Error('Obsolete private read failure'));await setImmediate();
  assert.equal(h.settings.targetLanguage,'ja');assert.equal(h.runtime.status().error,undefined);
});

test('a newer failed read blocks an older action even if its obsolete read succeeds later',async t=>{
  const h=setup(t),old=deferred();h.paragraph('Hello');await h.runtime.start();t.after(()=>old.resolve(defaultSettings()));
  let reads=0;h.client.getSettings=()=>++reads===1?old.promise:Promise.reject(Error('Current read failed'));
  let response;const translating=h.message('KUAI_PAGE_TRANSLATE').then(value=>{response=value;});await setImmediate();
  assert.equal(reads,1);h.notify(defaultSettings());await setImmediate();
  assert.equal(response?.error?.code,'SETTINGS_UNAVAILABLE');await translating;
  old.resolve({...defaultSettings(),targetLanguage:'fr'});await setImmediate();assert.equal(h.requests.length,0);
});

for(const type of ['KUAI_PAGE_STATUS','KUAI_PAGE_TRANSLATE','KUAI_SELECTION_TRANSLATE','KUAI_INPUT_TRANSLATE','KUAI_YOUTUBE_OPEN_LIST']){
  test(type+' exposes a current settings-read failure without performing its action',async t=>{
    const h=setup(t);h.paragraph('Hello');await h.runtime.start();
    h.client.getSettings=async()=>{throw Error('Private transport detail');};
    const result=await h.message(type);
    assert.equal(result.ok,false);assert.equal(result.error.code,'SETTINGS_UNAVAILABLE');assert.match(result.error.message,/设置/);
    assert.doesNotMatch(JSON.stringify(result),/Private transport detail/);
    assert.equal(h.requests.length,0);assert.equal(h.opened.length,0);assert.match(h.runtime.status().error,/设置/);
    h.client.getSettings=async()=>({...defaultSettings(),targetLanguage:'ja'});
    assert.equal((await h.message('KUAI_PAGE_STATUS')).ok,true);assert.equal(h.runtime.status().error,undefined);
  });
}

test('restore stays available during a settings read and cancels an action waiting on that read',async t=>{
  const h=setup(t),read=deferred();h.paragraph('Hello');await h.runtime.start();t.after(()=>read.resolve(defaultSettings()));
  await h.message('KUAI_PAGE_TRANSLATE');await setImmediate();assert.equal(h.runtime.status().translated,1);
  h.client.getSettings=()=>read.promise;
  let response;const pending=h.message('KUAI_PAGE_TRANSLATE').then(value=>{response=value;});await setImmediate();
  const restored=await h.message('KUAI_PAGE_RESTORE');await setImmediate();
  assert.equal(restored.ok,true);assert.equal(restored.value.total,0);assert.equal(response?.error?.code,'CANCELLED');
  await pending;read.resolve({...defaultSettings(),targetLanguage:'ja'});await setImmediate();
  assert.equal(h.runtime.status().total,0);assert.equal(h.requests.length,1);
});

for(const intent of ['keyboard restore','extension restore','extension restore while translating']){
  test(intent+' cancels an external action waiting for authoritative settings',async t=>{
    const h=setup(t),read=deferred(),provider=deferred(),paragraph=h.paragraph('Hello');
    t.after(()=>{read.resolve(defaultSettings());provider.resolve({translations:['Late result']});});
    if(intent==='extension restore while translating')h.respond(()=>provider.promise);
    await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await setImmediate();assert.equal(h.requests.length,1);
    h.client.getSettings=()=>read.promise;
    let response;const pending=h.message('KUAI_PAGE_TRANSLATE').then(value=>{response=value;});await setImmediate();
    if(intent==='keyboard restore')h.emit(paragraph,'keydown',{key:'z',code:'KeyZ',altKey:true});
    else await h.message('KUAI_PAGE_RESTORE');
    await setImmediate();assert.equal(response?.error?.code,'CANCELLED');await pending;
    read.resolve({...defaultSettings(),targetLanguage:'ja'});provider.resolve({translations:['Late result']});await setImmediate();
    assert.equal(h.requests.length,1);assert.equal(h.runtime.status().translated,0);
  });
}

for(const transition of ['popstate','yt-navigate-start','persisted pagehide']){
  test(transition+' cancels an action waiting on a settings read before it can affect another page session',async t=>{
    const h=setup(t),read=deferred();h.paragraph('Hello');await h.runtime.start();t.after(()=>read.resolve(defaultSettings()));
    h.client.getSettings=()=>read.promise;
    let response;const pending=h.message('KUAI_PAGE_TRANSLATE').then(value=>{response=value;});await setImmediate();
    assert.equal(h.requests.length,0);
    if(transition==='popstate'){h.env.location.href='https://example.org/next';h.env.dispatchEvent(new Event('popstate'));}
    else if(transition==='yt-navigate-start')h.doc.dispatchEvent(new Event('yt-navigate-start'));
    else h.env.dispatchEvent(new Event('pagehide',{persisted:true}));
    await setImmediate();assert.equal(response?.error?.code,'CANCELLED');await pending;
    read.resolve({...defaultSettings(),targetLanguage:'ja'});await setImmediate();
    assert.equal(h.requests.length,0);assert.equal(h.runtime.status().total,0);assert.equal(h.runtime.status().phase,'ready');
  });
}

test('stop rejects a pending action promptly and ignores its later settings response',async t=>{
  const h=setup(t),read=deferred();h.paragraph('Hello');await h.runtime.start();t.after(()=>read.resolve(defaultSettings()));
  h.client.getSettings=()=>read.promise;
  let response;const pending=h.message('KUAI_PAGE_TRANSLATE').then(value=>{response=value;});await setImmediate();
  h.runtime.stop();await setImmediate();
  assert.equal(response?.error?.code,'CONTENT_STOPPED');await pending;
  read.resolve({...defaultSettings(),targetLanguage:'ja'});await setImmediate();
  assert.equal(h.runtime.status().phase,'stopped');assert.equal(h.requests.length,0);assert.equal(h.subscribers.size,0);
});
