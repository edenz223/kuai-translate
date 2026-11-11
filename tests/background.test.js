import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackground} from '../dist/src/background/controller.js';
import {defaultSettings,SETTINGS_KEY} from '../dist/src/shared/settings.js';
import {createSettingsEditor} from '../dist/src/ui/state.js';
import {setImmediate as immediate} from 'node:timers/promises';
import {request,translate,onSettingsChanged} from '../dist/src/shared/client.js';

const extensionId='kuai-extension';
const page={id:extensionId,url:'https://example.com/article',tab:{id:4},frameId:0,documentId:'document-a'};
const options={id:extensionId,url:'chrome-extension://'+extensionId+'/options.html',documentId:'options-a'};
function event(){const callbacks=new Set();return {addListener:fn=>callbacks.add(fn),removeListener:fn=>callbacks.delete(fn),emit:(...args)=>{for(const fn of callbacks)fn(...args);},get size(){return callbacks.size;}};}
function fixture({stored=defaultSettings(),getHook,setHook,accessHook,removeMenuHook,createMenuHook,tabs={},fetchHook}={}){
  let data=structuredClone(stored);const access=[],writes=[],broadcasts=[],menus=[],menuCalls=[],menuUpdates=[],created=[],requests=[],badges=[];
  const changed=event();
  const chromeApi={
    runtime:{id:extensionId,getURL:path=>'chrome-extension://'+extensionId+'/'+path,onMessage:event(),onInstalled:event(),sendMessage:async message=>{broadcasts.push(message);}},
    storage:{onChanged:changed,local:{
      setAccessLevel:async value=>{access.push(value);await accessHook?.();},
      get:async()=>{await getHook?.();return data===undefined?{}:{[SETTINGS_KEY]:structuredClone(data)};},
      set:async values=>{const next=values[SETTINGS_KEY];writes.push(structuredClone(next));await setHook?.(next);data=structuredClone(next);changed.emit({[SETTINGS_KEY]:{newValue:data}},'local');},
    }},
    tabs:{query:async()=>[{id:4},{id:5}],sendMessage:async(tabId,message,target)=>{broadcasts.push({tabId,message,target});},onRemoved:event(),
      onActivated:event(),get:async tabId=>tabs[tabId]??{id:tabId},create:async value=>{created.push(value);}},
    webNavigation:{onCommitted:event()},commands:{onCommand:event()},
    action:{setBadgeText:async value=>{badges.push(['text',value]);},setBadgeBackgroundColor:async value=>{badges.push(['color',value]);}},
    contextMenus:{onClicked:event(),removeAll:async callback=>{menuCalls.push('remove');await removeMenuHook?.();menus.length=0;callback?.();},
      update:(id,value,callback)=>{menuUpdates.push([id,value]);callback?.();},
      create:(menu,callback)=>{menuCalls.push(menu.id);if(createMenuHook)Promise.resolve(createMenuHook(menu)).then(()=>{menus.push(menu);callback?.();});else{menus.push(menu);callback?.();}return menu.id;}},
  };
  const fetchImpl=async(url,init)=>{requests.push({url,init});const texts=JSON.parse(init.body);return Response.json(texts.map(text=>({translations:[{text:'译文:'+text}]})));};
  const controller=createBackground({chromeApi,fetchImpl:fetchHook || fetchImpl}).start();
  return {controller,chromeApi,access,writes,broadcasts,menus,menuCalls,menuUpdates,created,requests,badges,get data(){return data;}};
}
async function flush(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
test('content settings and notifications contain no key, endpoint or region; extension page may request secrets',async()=>{
  const stored=defaultSettings();stored.providers.push({id:'private',name:'Private',type:'azure',enabled:true,apiKey:'test-secret',baseUrl:'https://secret.example/path',region:'eastasia'});
  const h=fixture({stored});await h.controller.ready;
  const publicValue=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page);
  assert.equal(publicValue.ok,true);
  assert.doesNotMatch(JSON.stringify(publicValue),/test-secret|secret\.example|eastasia/);
  const privateValue=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options);
  assert.equal(privateValue.value.providers.find(p=>p.id==='private').apiKey,'test-secret');
  assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},page)).error.code,'FORBIDDEN');
  await h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:{...stored,targetLanguage:'fr'}},options);await flush();
  assert.ok(h.broadcasts.some(item=>item.message?.type==='KUAI_SETTINGS_CHANGED'));
  assert.doesNotMatch(JSON.stringify(h.broadcasts),/test-secret|secret\.example|eastasia/);h.controller.stop();
});
test('external senders and forged extension-page URLs cannot save or test providers',async()=>{
  const h=fixture();await h.controller.ready;
  for(const sender of [{...options,id:'other'}, {...page,url:'https://evil.example/?chrome-extension://kuai-extension/options.html'}, {...page,documentId:undefined},{}]){
    for(const type of ['KUAI_SAVE_SETTINGS','KUAI_TEST_PROVIDER']){
      const answer=await h.controller.handleMessage({type,settings:defaultSettings(),provider:{type:'google'}},sender);
      assert.equal(answer.ok,false);assert.equal(answer.error.code,'FORBIDDEN');
    }
  }
  assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);h.controller.stop();
});
test('content can choose only stored enabled IDs and cannot inject request credentials or URL',async()=>{
  const h=fixture();await h.controller.ready;
  const answer=await h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'hello',texts:['Hello'],providerId:'microsoft',provider:{type:'openai',baseUrl:'https://evil.example',apiKey:'fake'}},page);
  assert.deepEqual(answer,{ok:true,value:{translations:['译文:Hello'],providerId:'microsoft'}});
  assert.equal(new URL(h.requests[0].url).hostname,'edge.microsoft.com');
  assert.equal((await h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'other',texts:['Hello'],providerId:'not-saved'},page)).error.code,'INVALID_CONFIG');
  const settings=defaultSettings();settings.providers[0].enabled=false;
  await h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings},options);
  assert.equal((await h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'disabled',texts:['Hello'],providerId:'microsoft'},page)).error.code,'INVALID_CONFIG');h.controller.stop();
});
test('same request ID is document-scoped and only its owner can cancel it',async()=>{
  const h=fixture();h.controller.stop();const calls=[];
  const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:(_url,init)=>{calls.push(init.signal);return new Promise(()=>{});}}).start();await controller.ready;
  const a=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'same',texts:['One']},page);
  const pageB={...page,documentId:'document-b'};
  const b=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'same',texts:['Two']},pageB);
  await flush();assert.equal(calls.length,2);
  assert.equal((await controller.handleMessage({type:'KUAI_CANCEL',requestId:'same'},{...page,documentId:'document-c'})).value.cancelled,false);
  assert.equal(calls[0].aborted,false);assert.equal(calls[1].aborted,false);
  assert.equal((await controller.handleMessage({type:'KUAI_CANCEL',requestId:'same'},page)).value.cancelled,true);
  assert.equal((await a).error.code,'CANCELLED');assert.equal(calls[1].aborted,false);
  await controller.handleMessage({type:'KUAI_CANCEL',requestId:'same'},pageB);assert.equal((await b).error.code,'CANCELLED');controller.stop();
});
test('navigation and tab removal cancel old document jobs',async()=>{
  const h=fixture();h.controller.stop();const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:()=>new Promise(()=>{})}).start();await controller.ready;
  const first=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'nav',texts:['One']},page);await flush();
  h.chromeApi.webNavigation.onCommitted.emit({tabId:4,frameId:0,documentId:'new-document'});
  assert.equal((await first).error.code,'CANCELLED');
  const second=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'tab',texts:['Two']},page);await flush();
  h.chromeApi.tabs.onRemoved.emit(4);assert.equal((await second).error.code,'CANCELLED');controller.stop();
});
test('provider testing is available to extension pages and errors remain redacted',async()=>{
  const h=fixture();await h.controller.ready;
  const result=await h.controller.handleMessage({type:'KUAI_TEST_PROVIDER',provider:{id:'microsoft',type:'microsoft',enabled:false},text:'Hello'},options);
  assert.deepEqual(result.value.translations,['译文:Hello']);
  h.controller.stop();const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:async()=>new Response('secret-key-provider-echo',{status:401})}).start();await controller.ready;
  const error=await controller.handleMessage({type:'KUAI_TEST_PROVIDER',provider:{type:'openai',model:'manual',apiKey:'secret-key-provider-echo'},text:'Hello'},options);
  assert.equal(error.error.code,'HTTP_401');assert.equal(JSON.stringify(error).includes('secret-key-provider-echo'),false);controller.stop();
});

function customSettings(){
  const settings=defaultSettings();
  settings.providers.push({id:'custom',type:'openai',name:'Custom',enabled:true,baseUrl:'https://api.example/v1',apiKey:'old-test-key',model:'old-model'});
  return settings;
}
async function privateSettings(h){return (await h.controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value;}
function saveSnapshot(h,settings,baseSettings){return h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings,baseSettings},options);}

test('two actual UI editors save independent changes without reverting credentials from another window',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const editor=()=>createSettingsEditor({load:()=>privateSettings(h),save:async(settings,baseSettings)=>{
    const response=await saveSnapshot(h,settings,baseSettings);
    if(!response.ok)throw Object.assign(Error(response.error.message),response.error);
    return response.value;
  }});
  const first=editor(),second=editor();await first.load();await second.load();
  await first.patchProvider('custom',{apiKey:'new-test-key'});
  await second.update(settings=>{settings.targetLanguage='ja';});
  const saved=await privateSettings(h);
  assert.equal(saved.providers.find(provider=>provider.id==='custom').apiKey,'new-test-key');
  assert.equal(saved.targetLanguage,'ja');
  assert.equal(saved.providerRevision,1);
  h.controller.stop();
});
test('conflicting edits fail without writing, exposing secrets or rolling back the winning values',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const base=await privateSettings(h),first=structuredClone(base),second=structuredClone(base);
  first.providers.at(-1).apiKey='winner-secret';second.providers.at(-1).apiKey='loser-secret';
  assert.equal((await saveSnapshot(h,first,base)).ok,true);
  const conflict=await saveSnapshot(h,second,base);
  assert.equal(conflict.ok,false);assert.equal(conflict.error.code,'SETTINGS_CONFLICT');
  assert.doesNotMatch(JSON.stringify(conflict),/winner-secret|loser-secret/);
  assert.equal(h.writes.length,1);
  assert.equal((await privateSettings(h)).providers.at(-1).apiKey,'winner-secret');
  // Retrying the same winning change is idempotent, not a conflict.
  assert.equal((await saveSnapshot(h,first,base)).ok,true);
  h.controller.stop();
});

test('public preference patches reject private, unknown, malformed and disabled-provider choices',async()=>{
  const stored=customSettings();stored.providers.at(-1).enabled=false;
  const h=fixture({stored});await h.controller.ready;
  for(const patch of [
    {providers:[]},{activeProviderId:'google'},{apiKey:'never-save'},{pageStyle:{fontSize:120}},
    {subtitlesEnabled:'1'},{subtitleTargetLanguage:'auto'},{subtitleProviderId:'custom'},{subtitleProviderId:'absent'},
    {subtitleStyle:{targetFontSize:24,apiKey:'never-save'}},{subtitleStyle:{cssText:'color:red'}},
    {subtitleStyle:{fontFamily:'Arial; background:red'}},{subtitleStyle:{displayMode:'untrusted'}},{subtitleStyle:null},
  ]){
    const result=await h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch},page);
    assert.equal(result.ok,false,JSON.stringify(patch));assert.equal(result.error.code,'INVALID_PREFERENCES');
  }
  assert.equal(h.writes.length,0);h.controller.stop();
});

test('content can change only the page display mode and receives a public settings response',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const result=await h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch:{pageDisplayMode:'translation_only'}},page);
  assert.equal(result.ok,true);assert.equal(result.value.pageDisplayMode,'translation_only');
  assert.equal(result.value.providerRevision,0);assert.doesNotMatch(JSON.stringify(result),/old-test-key|api\.example/);
  assert.equal((await privateSettings(h)).providers.at(-1).apiKey,'old-test-key');
  for(const patch of [null,[],{},'translation_only',{pageDisplayMode:true},{pageDisplayMode:'other'},
    {pageDisplayMode:'bilingual',providers:[]},{pageDisplayMode:'bilingual',activeProviderId:'google'},
    {pageDisplayMode:'bilingual',pageStyle:{fontSize:120}},{pageDisplayMode:'bilingual',pageOptions:{contextMenuEnabled:false}},
    {subtitleStyle:{hideTranslation:true}},{apiKey:'never-save'}]) {
    const invalid=await h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch},page);
    assert.equal(invalid.error?.code,'INVALID_PREFERENCES',JSON.stringify(patch));
  }
  assert.equal((await h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch:{pageDisplayMode:'bilingual'},settings:defaultSettings()},page)).error?.code,'INVALID_PREFERENCES');
  assert.equal((await h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch:{pageDisplayMode:'bilingual'}},{...page,id:'foreign'})).error?.code,'FORBIDDEN');
  assert.equal(h.writes.length,1);h.controller.stop();
});

test('site menu items edit only the clicked host and are limited to web pages',async()=>{
  const h=fixture();await h.controller.ready;await flush();
  const site=h.menus.find(menu=>menu.id==='kuai.site.never');
  assert.deepEqual(site.documentUrlPatterns,['http://*/*','https://*/*']);assert.equal(site.rule,undefined);
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.site.never',pageUrl:'https://news.example.com/a',frameId:2},{id:4});await flush();
  assert.deepEqual(h.data.pageOptions.neverSites,['news.example.com']);
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.site.default',pageUrl:'https://news.example.com/b'},{id:4});await flush();
  assert.deepEqual(h.data.pageOptions.neverSites,[]);
  assert.equal(h.broadcasts.some(item=>item.tabId!==undefined&&String(item.message?.type).startsWith('KUAI_PAGE')),false,'site rules never message the page');
  h.controller.stop();
});

test('only the top document of a web tab sets its toolbar badge, and navigation clears it',async()=>{
  const h=fixture();await h.controller.ready;
  assert.deepEqual((await h.controller.handleMessage({type:'KUAI_PAGE_STATE',state:'done'},page)).value,{shown:true});
  assert.deepEqual(h.badges,[['color',{tabId:4,color:'#087e8b'}],['text',{tabId:4,text:'✓'}]]);
  h.badges.length=0;
  assert.deepEqual((await h.controller.handleMessage({type:'KUAI_PAGE_STATE',state:'working'},{...page,frameId:3})).value,{shown:false});
  assert.deepEqual((await h.controller.handleMessage({type:'KUAI_PAGE_STATE',state:'done'},options)).value,{shown:false});
  assert.equal((await h.controller.handleMessage({type:'KUAI_PAGE_STATE',state:'bogus'},page)).error.code,'INVALID_INPUT');
  assert.equal((await h.controller.handleMessage({type:'KUAI_PAGE_STATE',state:'done',text:'X'},page)).error.code,'INVALID_INPUT');
  assert.deepEqual(h.badges,[]);
  h.chromeApi.webNavigation.onCommitted.emit({tabId:4,frameId:1,documentId:'d'});
  h.chromeApi.webNavigation.onCommitted.emit({tabId:4,frameId:0,documentId:'d'});await flush();
  assert.deepEqual(h.badges,[['text',{tabId:4,text:''}]]);h.controller.stop();
});

test('keyboard commands toggle the active web tab through its top frame only',async()=>{
  const h=fixture();await h.controller.ready;
  h.chromeApi.commands.onCommand.emit('toggle-page',{id:7,url:'https://example.com/'});
  h.chromeApi.commands.onCommand.emit('toggle-display-mode',{id:7,url:'https://example.com/'});
  h.chromeApi.commands.onCommand.emit('toggle-page',{id:8,url:'chrome://extensions/'});
  h.chromeApi.commands.onCommand.emit('unknown',{id:7,url:'https://example.com/'});await flush();
  assert.deepEqual(h.broadcasts.filter(item=>item.tabId!==undefined),[
    {tabId:7,message:{type:'KUAI_PAGE_TOGGLE'},target:{frameId:0}},
    {tabId:7,message:{type:'KUAI_PAGE_DISPLAY_MODE'},target:{frameId:0}},
  ]);
  h.controller.stop();assert.equal(h.chromeApi.commands.onCommand.size,0);
});

const extensionIdDelivery='kuai-delivery';
const optionsDelivery={id:extensionIdDelivery,url:`chrome-extension://${extensionIdDelivery}/popup.html`,documentId:'popup-a'};
const pageDelivery={id:extensionIdDelivery,url:'https://example.com/article',tab:{id:4},frameId:0,documentId:'page-a'};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function eventDelivery(){
  const listeners=new Set();
  return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),
    emit(...args){for(const fn of listeners)fn(...args);},
    send(message){return new Promise(resolve=>{let pending=false;for(const fn of listeners)pending=fn(message,{id:extensionIdDelivery},resolve)===true||pending;if(!pending)resolve();});}};
}
function fixtureDelivery(t,{stored=defaultSettings(),queryHook,sendHook,writeHook,runtimeHook,url=pageDelivery.url}={}){
  let data=structuredClone(stored),controller;
  const changed=eventDelivery(),writes=[],sent=[],delivered=[],applied=new Map([[4,structuredClone(stored)]]);
  const chromeApi={
    runtime:{id:extensionIdDelivery,getURL:path=>`chrome-extension://${extensionIdDelivery}/${path}`,onMessage:eventDelivery(),onInstalled:eventDelivery(),
      sendMessage:async message=>message.type==='KUAI_SETTINGS_CHANGED'?runtimeHook?.(message):controller.handleMessage(message,optionsDelivery)},
    storage:{onChanged:changed,local:{setAccessLevel:async()=>{},get:async()=>({[SETTINGS_KEY]:structuredClone(data)}),set:async values=>{
      data=structuredClone(values[SETTINGS_KEY]);writes.push(structuredClone(data));
      changed.emit({[SETTINGS_KEY]:{newValue:structuredClone(data)}},'local');await writeHook?.(data);
    }}},
    tabs:{onRemoved:eventDelivery(),query:async query=>query.active?[{id:4,url}]:(await queryHook?.())||[{id:4}],sendMessage:async(tabId,message)=>{
      sent.push({tabId,message:structuredClone(message)});await sendHook?.(tabId,message);
      applied.set(tabId,structuredClone(message.settings));delivered.push({tabId,settings:structuredClone(message.settings)});
    }},
  };
  controller=createBackground({chromeApi}).start();t.after(()=>controller.stop());
  return {controller,chromeApi,writes,sent,delivered,applied,get stored(){return structuredClone(data);},
    save:settings=>controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings},optionsDelivery),
    externalSave(settings){data=structuredClone(settings);changed.emit({[SETTINGS_KEY]:{newValue:structuredClone(data)}},'local');}};
}

test('a persisted save does not wait for advisory discovery or delivery, and notifications stay public',async t=>{
  const query=deferred(),delivery=deferred(),stored=defaultSettings();
  stored.providers.push({id:'private',name:'Private',type:'azure',enabled:true,apiKey:'delivery-private-key',baseUrl:'https://private.example/translate',region:'eastasia'});
  const h=fixtureDelivery(t,{stored,queryHook:()=>query.promise,sendHook:()=>delivery.promise});await h.controller.ready;
  t.after(()=>{query.resolve();delivery.resolve();});
  let settled=false;const saving=h.save({...stored,targetLanguage:'ja'}).then(result=>{settled=true;return result;});
  await immediate();
  assert.equal(h.stored.targetLanguage,'ja');assert.equal(h.applied.get(4).targetLanguage,'zh-Hans');
  assert.equal(settled,true,'advisory tab discovery must not hold a persisted save');
  query.resolve();await immediate();
  assert.equal(settled,true,'advisory tab delivery must not hold a persisted save');
  assert.equal(h.applied.get(4).targetLanguage,'zh-Hans');
  delivery.resolve();const result=await saving;await immediate();
  assert.equal(result.ok,true);assert.equal(h.applied.get(4).targetLanguage,'ja');
  assert.equal(result.value.providers.at(-1).apiKey,'delivery-private-key');
  assert.doesNotMatch(JSON.stringify(h.sent),/delivery-private-key|private\.example|eastasia/);
});

test('request unwraps the common response envelope and preserves error codes',async()=>{
  assert.deepEqual(await request('KUAI_GET_SETTINGS',{}, {runtime:{sendMessage:async()=>({ok:true,value:{targetLanguage:'ja'}})}}),{targetLanguage:'ja'});
  await assert.rejects(request('KUAI_GET_SETTINGS',{}, {runtime:{sendMessage:async()=>({ok:false,error:{code:'DENIED',message:'Not allowed'}})}}),{code:'DENIED'});
});
test('local cancellation settles even when the worker translation response never arrives',async()=>{
  const old=globalThis.chrome,messages=[],controller=new AbortController();
  globalThis.chrome={runtime:{sendMessage:async message=>{messages.push(message);return message.type==='KUAI_CANCEL'?{ok:true,value:{cancelled:true}}:new Promise(()=>{});}}};
  try {
    const pending=translate(['Hello'],{requestId:'test-cancel',signal:controller.signal}).then(()=> 'success',error=>error.name);
    controller.abort();
    const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('still-waiting'),30))]);
    assert.equal(result,'AbortError');
    assert.equal(messages.find(message=>message.type==='KUAI_CANCEL').requestId,'test-cancel');
  }finally{globalThis.chrome=old;}
});
test('settings unsubscribe does not throw after the extension context is invalidated',()=>{
  const listeners=new Set(),chromeApi={runtime:{onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
  const unsubscribe=onSettingsChanged(()=>{},chromeApi);
  assert.equal(listeners.size,1);
  delete chromeApi.runtime;
  assert.doesNotThrow(unsubscribe);
});

test('translation diagnostics attach per-call payloads on success/failure only while debug is enabled',async t=>{
  const {setDebug}=await import('../dist/src/shared/debug.js');
  const info=t.mock.method(console,'info',()=>{}),warn=t.mock.method(console,'warn',()=>{}),log=t.mock.method(console,'log',()=>{});t.after(()=>setDebug(false));
  for(const debugMode of [false,true])for(const debugVerbose of [false,true])for(const status of [200,429]){
    const stored=defaultSettings();stored.debugMode=debugMode;stored.debugVerbose=debugVerbose;
    const before=[info.mock.callCount(),warn.mock.callCount()];
    const h=fixture({stored,fetchHook:async()=>status===200?Response.json([{translations:[{text:'你好'}]}]):new Response('Service busy',{status})});
    t.after(()=>h.controller.stop());await h.controller.ready;
    const answer=await h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'diagnostics',texts:['Hello']},page);
    assert.equal(answer.ok,status===200);
    if(status===200&&!debugVerbose)assert.equal(info.mock.callCount(),before[0]);
    if(status===200||!debugMode)assert.equal(warn.mock.callCount(),before[1]);
    else assert.ok(warn.mock.callCount()>before[1]);
    assert.equal(log.mock.callCount(),0);
    for(const call of info.mock.calls)assert.match(call.arguments[0],/^\[Kuai\] %c服务%c /);
    const result=answer.ok?answer.value:answer;
    assert.equal(Object.hasOwn(result,'network'),debugMode);
    if(debugMode){
      assert.equal(result.network.length,1);const [record]=result.network;
      assert.equal(record.method,'POST');assert.match(record.url,/edge.microsoft.com\/translate\/translatetext/);
      assert.equal(record.query.to,'zh-Hans');assert.deepEqual(record.request,['Hello']);
      assert.equal(record.status,status);assert.equal(record.ok,status===200);assert.equal('headers' in record,false);
      assert.deepEqual(record.response,status===200?[{translations:[{text:'你好'}]}]:'Service busy');
      assert.equal(result.providerLabel,'微软翻译');
    }else if(answer.ok)assert.deepEqual(answer,{ok:true,value:{translations:['你好'],providerId:'microsoft'}});
    else assert.deepEqual(answer,{ok:false,error:{code:'HTTP_429',message:'The translation service returned HTTP 429. Check its configuration or retry later.'}});
    h.controller.stop();
  }
});

test('overlapping translation jobs keep separate collectors, including several HTTP calls per job',async t=>{
  const {setDebug}=await import('../dist/src/shared/debug.js');
  t.mock.method(console,'info',()=>{});t.mock.method(console,'warn',()=>{});t.after(()=>setDebug(false));
  const stored=defaultSettings();stored.debugMode=true;stored.activeProviderId='google';
  const pending=new Map();
  const h=fixture({stored,fetchHook:url=>new Promise(resolve=>pending.set(new URL(url).searchParams.get('q'),resolve))});
  t.after(()=>h.controller.stop());await h.controller.ready;
  const a=h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'concurrent-a',texts:['Alpha','Beta']},page);
  const b=h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'concurrent-b',texts:['Gamma','Delta']},page);
  await flush();assert.equal(pending.size,4);
  for(const text of ['Delta','Beta','Gamma','Alpha'])pending.get(text)(Response.json([[[text+' translated',text]]]));
  const [first,second]=await Promise.all([a,b]);assert.equal(first.ok,true);assert.equal(second.ok,true);
  assert.deepEqual(first.value.network.map(record=>record.query.q).sort(),['Alpha','Beta']);
  assert.deepEqual(second.value.network.map(record=>record.query.q).sort(),['Delta','Gamma']);
  assert.deepEqual(first.value.translations,['Alpha translated','Beta translated']);
  assert.deepEqual(second.value.translations,['Gamma translated','Delta translated']);
});

test('request client preserves failure network objects for content batch logging',async()=>{
  const network=[{method:'GET',url:'https://api.example/translate',query:{q:'Hello'},request:null,status:503,ok:false,response:'Unavailable',sentBytes:0,receivedBytes:11,durationMs:10,error:{code:'HTTP_503',message:'Unavailable'}}];
  await assert.rejects(request('KUAI_TRANSLATE',{requestId:'failed',texts:['Hello']},{runtime:{sendMessage:async()=>({ok:false,error:{code:'HTTP_503',message:'Unavailable'},network,providerId:'google'})}}),error=>{
    assert.equal(error.code,'HTTP_503');assert.equal(error.providerId,'google');assert.deepEqual(error.network,network);return true;
  });
});
