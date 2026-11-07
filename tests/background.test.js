import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../dist/src/background/controller.js';
import { defaultSettings, SETTINGS_KEY } from '../dist/src/shared/settings.js';
import { createSettingsEditor } from '../dist/src/ui/state.js';

const extensionId='kuai-extension';
const page={id:extensionId,url:'https://example.com/article',tab:{id:4},frameId:0,documentId:'document-a'};
const options={id:extensionId,url:'chrome-extension://'+extensionId+'/options.html',documentId:'options-a'};
function event(){const callbacks=new Set();return {addListener:fn=>callbacks.add(fn),removeListener:fn=>callbacks.delete(fn),emit:(...args)=>{for(const fn of callbacks)fn(...args);},get size(){return callbacks.size;}};}
function fixture({stored=defaultSettings(),getHook,setHook,accessHook,removeMenuHook,createMenuHook}={}){
  let data=structuredClone(stored);const access=[],writes=[],broadcasts=[],menus=[],menuCalls=[],requests=[],badges=[];
  const changed=event();
  const chromeApi={
    runtime:{id:extensionId,getURL:path=>'chrome-extension://'+extensionId+'/'+path,onMessage:event(),onInstalled:event(),sendMessage:async message=>{broadcasts.push(message);}},
    storage:{onChanged:changed,local:{
      setAccessLevel:async value=>{access.push(value);await accessHook?.();},
      get:async()=>{await getHook?.();return data===undefined?{}:{[SETTINGS_KEY]:structuredClone(data)};},
      set:async values=>{const next=values[SETTINGS_KEY];writes.push(structuredClone(next));await setHook?.(next);data=structuredClone(next);changed.emit({[SETTINGS_KEY]:{newValue:data}},'local');},
    }},
    tabs:{query:async()=>[{id:4},{id:5}],sendMessage:async(tabId,message,target)=>{broadcasts.push({tabId,message,target});},onRemoved:event()},
    webNavigation:{onCommitted:event()},commands:{onCommand:event()},
    action:{setBadgeText:async value=>{badges.push(['text',value]);},setBadgeBackgroundColor:async value=>{badges.push(['color',value]);}},
    contextMenus:{onClicked:event(),removeAll:async callback=>{menuCalls.push('remove');await removeMenuHook?.();menus.length=0;callback?.();},
      create:(menu,callback)=>{menuCalls.push(menu.id);if(createMenuHook)Promise.resolve(createMenuHook(menu)).then(()=>{menus.push(menu);callback?.();});else{menus.push(menu);callback?.();}return menu.id;}},
  };
  const fetchImpl=async(url,init)=>{requests.push({url,init});const texts=JSON.parse(init.body);return Response.json(texts.map(text=>({translations:[{text:'译文:'+text}]})));};
  const controller=createBackground({chromeApi,fetchImpl}).start();
  return {controller,chromeApi,access,writes,broadcasts,menus,menuCalls,requests,badges,get data(){return data;}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function flush(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}

test('listener registration is synchronous while all messages wait for private storage initialization',async()=>{
  const gate=deferred(), h=fixture({accessHook:()=>gate.promise});
  assert.equal(h.chromeApi.runtime.onMessage.size,1);
  let settled=false;const pending=h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page).then(value=>{settled=true;return value;});
  await Promise.resolve();assert.equal(settled,false);
  gate.resolve();assert.equal((await pending).ok,true);
  assert.deepEqual(h.access,[{accessLevel:'TRUSTED_CONTEXTS'}]);h.controller.stop();
});
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
test('serialized saves preserve arrival order even when the first storage write is delayed',async()=>{
  const gate=deferred();let active=0,maximum=0,write=0;
  const h=fixture({setHook:async()=>{maximum=Math.max(maximum,++active);if(++write===1)await gate.promise;active--;}});await h.controller.ready;
  const first={...defaultSettings(),targetLanguage:'fr'},second={...defaultSettings(),targetLanguage:'de'};
  const one=h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:first},options);
  const two=h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:second},options);
  await flush();assert.equal(h.writes.length,1);gate.resolve();
  assert.equal((await one).ok,true);assert.equal((await two).ok,true);
  assert.equal(maximum,1);assert.equal(h.data.targetLanguage,'de');h.controller.stop();
});
test('editing an incomplete provider can be saved while execution rejects it before fetch',async()=>{
  const settings=defaultSettings();settings.providers.push({id:'draft',type:'openai',name:'Draft',enabled:true,apiKey:'',model:'',baseUrl:''});settings.activeProviderId='draft';
  const h=fixture();await h.controller.ready;
  assert.equal((await h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings},options)).ok,true);
  const result=await h.controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'draft',texts:['Hello']},page);
  assert.equal(result.error.code,'INVALID_CONFIG');assert.equal(h.requests.length,0);h.controller.stop();
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
test('duplicate request ID in one document cannot replace the job awaiting cancellation',async()=>{
  const h=fixture();h.controller.stop();const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:()=>new Promise(()=>{})}).start();await controller.ready;
  const first=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'dup',texts:['One']},page);await flush();
  assert.equal((await controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'dup',texts:['Two']},page)).error.code,'DUPLICATE_REQUEST');
  await controller.handleMessage({type:'KUAI_CANCEL',requestId:'dup'},page);assert.equal((await first).error.code,'CANCELLED');controller.stop();
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
test('context menu listeners survive startup and forward explicit selection to its frame',async()=>{
  const stored=defaultSettings();stored.selectionEnabled=true;const h=fixture({stored});await h.controller.ready;await flush();
  assert.equal(h.menus.length,7);
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.selection',selectionText:'Selected text',frameId:3},{id:4});await flush();
  const call=h.broadcasts.find(item=>item.message?.type==='KUAI_SELECTION_TRANSLATE');
  assert.deepEqual(call,{tabId:4,message:{type:'KUAI_SELECTION_TRANSLATE',text:'Selected text'},target:{frameId:3}});
  h.controller.stop();assert.equal(h.chromeApi.runtime.onMessage.size,0);assert.equal(h.chromeApi.contextMenus.onClicked.size,0);
});
test('private storage failure blocks operations instead of falling back to exposed credentials',async()=>{
  const h=fixture({accessHook:()=>{throw Error('cannot secure');}});
  const result=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options);
  assert.equal(result.ok,false);assert.equal(result.error.code,'STORAGE_UNAVAILABLE');h.controller.stop();
});
test('a failed storage initialization can retry and still restrict access before the next settings read',async()=>{
  let attempt=0;const order=[];
  const h=fixture({accessHook:()=>{order.push('access-'+(++attempt));if(attempt===1)throw Error('temporary access failure');},getHook:()=>{order.push('read');}});
  const first=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page);
  assert.equal(first.ok,false);assert.equal(first.error.code,'STORAGE_UNAVAILABLE');assert.deepEqual(order,['access-1']);
  const second=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page);
  assert.equal(second.ok,true);assert.equal(second.value.activeProviderId,'microsoft');
  assert.deepEqual(order,['access-1','access-2','read']);
  assert.deepEqual(h.access,[{accessLevel:'TRUSTED_CONTEXTS'},{accessLevel:'TRUSTED_CONTEXTS'}]);
  h.controller.stop();
});
test('delayed older storage read cannot overwrite a newer settings notification',async()=>{
  const h=fixture();await h.controller.ready;await flush();
  const old=deferred(), first={...defaultSettings(),targetLanguage:'fr'}, second={...defaultSettings(),targetLanguage:'de'};
  let reads=0;
  h.chromeApi.storage.local.get=async()=>++reads===1 ? old.promise : {[SETTINGS_KEY]:second};
  h.chromeApi.storage.onChanged.emit({[SETTINGS_KEY]:{newValue:first}},'local');await flush();
  h.chromeApi.storage.onChanged.emit({[SETTINGS_KEY]:{newValue:second}},'local');await flush();
  old.resolve({[SETTINGS_KEY]:first});await flush();
  const result=await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},page);
  assert.equal(result.value.targetLanguage,'de');h.controller.stop();
});
test('storage is restricted during startup even when context menus are unavailable',async()=>{
  const h=fixture();await h.controller.ready;h.controller.stop();h.access.length=0;
  delete h.chromeApi.contextMenus;
  const controller=createBackground({chromeApi:h.chromeApi}).start();await flush();
  assert.deepEqual(h.access,[{accessLevel:'TRUSTED_CONTEXTS'}]);controller.stop();
});
test('credential-only edits advance a server-owned public revision without exposing the credential',async()=>{
  const stored=defaultSettings();stored.providers.push({id:'private',type:'azure',name:'Private',enabled:true,apiKey:'first-private-key'});
  const h=fixture({stored});await h.controller.ready;await flush();
  const initial=(await h.controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value;
  const changed=structuredClone(initial);changed.providers.at(-1).apiKey='replacement-private-key';changed.providerRevision=999999;
  const saved=await h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:changed},options);await flush();
  assert.equal(saved.value.providerRevision,(initial.providerRevision||0)+1);
  const notice=h.broadcasts.filter(item=>item.message?.type==='KUAI_SETTINGS_CHANGED').at(-1).message;
  assert.equal(notice.settings.providerRevision,saved.value.providerRevision);
  assert.doesNotMatch(JSON.stringify(notice),/first-private-key|replacement-private-key/);
  const unchanged=await h.controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:{...saved.value,providerRevision:777777,targetLanguage:'fr'}},options);
  assert.equal(unchanged.value.providerRevision,saved.value.providerRevision);
  h.controller.stop();
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
test('atomic merges preserve independent provider fields and newly added IDs inside the write queue',async()=>{
  const gate=deferred();let writes=0;
  const h=fixture({stored:customSettings(),setHook:()=>++writes===1?gate.promise:undefined});await h.controller.ready;
  const base=await privateSettings(h),first=structuredClone(base),second=structuredClone(base);
  first.providers.at(-1).apiKey='new-test-key';
  first.providers.push({...first.providers.at(-1),id:'new-provider',name:'New'});
  second.providers.at(-1).model='new-model';second.targetLanguage='fr';
  const a=saveSnapshot(h,first,base),b=saveSnapshot(h,second,base);await flush();gate.resolve();
  assert.equal((await a).ok,true);assert.equal((await b).ok,true);
  const saved=await privateSettings(h),custom=saved.providers.find(provider=>provider.id==='custom');
  assert.equal(custom.apiKey,'new-test-key');assert.equal(custom.model,'new-model');
  assert.equal(saved.targetLanguage,'fr');assert.ok(saved.providers.some(provider=>provider.id==='new-provider'));
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
test('a stale window cannot revive a deleted provider or delete another window\'s edited provider',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const base=await privateSettings(h),removed=structuredClone(base),renamed=structuredClone(base);
  removed.providers=removed.providers.filter(provider=>provider.id!=='custom');renamed.providers.at(-1).name='Changed elsewhere';
  assert.equal((await saveSnapshot(h,renamed,base)).ok,true);
  assert.equal((await saveSnapshot(h,removed,base)).error?.code,'SETTINGS_CONFLICT');
  const current=await privateSettings(h),nowRemoved=structuredClone(current);
  nowRemoved.providers=nowRemoved.providers.filter(provider=>provider.id!=='custom');
  assert.equal((await saveSnapshot(h,nowRemoved,current)).ok,true);
  assert.equal((await saveSnapshot(h,{...base,targetLanguage:'de'},base)).ok,true);
  assert.equal((await privateSettings(h)).providers.some(provider=>provider.id==='custom'),false);
  assert.equal((await saveSnapshot(h,renamed,base)).error?.code,'SETTINGS_CONFLICT');
  h.controller.stop();
});
test('concurrent endpoint changes cannot silently inherit credentials changed in another window',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const base=await privateSettings(h),keyChange=structuredClone(base),endpointChange=structuredClone(base);
  keyChange.providers.at(-1).apiKey='rotated-private-key';endpointChange.providers.at(-1).baseUrl='https://other-recipient.example/v1';
  assert.equal((await saveSnapshot(h,keyChange,base)).ok,true);
  assert.equal((await saveSnapshot(h,endpointChange,base)).error?.code,'SETTINGS_CONFLICT');
  assert.equal((await privateSettings(h)).providers.at(-1).baseUrl,'https://api.example/v1');
  h.controller.stop();
});

test('content can atomically update permitted subtitle preferences and receives only public settings',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const previousSourceSize=(await privateSettings(h)).subtitleStyle.sourceFontSize;
  const result=await h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch:{subtitleProviderId:'custom',subtitleTargetLanguage:'ja',subtitleStyle:{targetFontSize:32,hideTranslation:true}}},page);
  assert.equal(result.ok,true);
  assert.equal(result.value.subtitleProviderId,'custom');assert.equal(result.value.subtitleTargetLanguage,'ja');
  assert.equal(result.value.subtitleStyle.targetFontSize,32);assert.equal(result.value.subtitleStyle.hideTranslation,true);
  assert.equal(result.value.subtitleStyle.sourceFontSize,previousSourceSize);assert.equal(result.value.providerRevision,0);
  assert.doesNotMatch(JSON.stringify(result),/old-test-key|api\.example/);
  assert.equal((await privateSettings(h)).providers.at(-1).apiKey,'old-test-key');h.controller.stop();
});

test('remembered video choices survive an actual background restart without leaking provider credentials',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;
  const patch={subtitlesEnabled:false,subtitleListOpen:true,subtitleTrackPreference:{languageCode:'en',kind:'asr',name:'English automatic'}};
  const saved=await h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch},page);assert.equal(saved.ok,true);
  assert.equal(h.data.subtitlesEnabled,false);assert.equal(h.data.subtitleListOpen,true);assert.deepEqual(h.data.subtitleTrackPreference,patch.subtitleTrackPreference);
  assert.doesNotMatch(JSON.stringify(saved),/old-test-key|api\.example/);h.controller.stop();
  const next=createBackground({chromeApi:h.chromeApi}).start();try{
    await next.ready;const publicValue=await next.handleMessage({type:'KUAI_GET_SETTINGS'},page),privateValue=await next.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options);
    assert.equal(publicValue.value.subtitlesEnabled,false);assert.equal(publicValue.value.subtitleListOpen,true);assert.deepEqual(publicValue.value.subtitleTrackPreference,patch.subtitleTrackPreference);
    assert.equal(privateValue.value.providers.at(-1).apiKey,'old-test-key');assert.doesNotMatch(JSON.stringify(publicValue),/old-test-key|api\.example/);
  }finally{next.stop();}
});

test('video preference patches reject malformed visibility and track metadata without a storage write',async()=>{
  const h=fixture();await h.controller.ready;
  for(const patch of [{subtitleListOpen:'true'},{subtitleListOpen:1},{subtitleTrackPreference:null},{subtitleTrackPreference:[]},
    {subtitleTrackPreference:{}},{subtitleTrackPreference:{languageCode:'en',kind:'asr',name:'English',url:'https://youtube.com/api/timedtext'}},
    {subtitleTrackPreference:{languageCode:'en',kind:'unknown',name:''}},{subtitleTrackPreference:{languageCode:'bad language',kind:'',name:''}},
    {subtitleTrackPreference:{languageCode:'en',kind:'',name:'x'.repeat(201)}},{subtitleTrackPreference:{languageCode:'',kind:'asr',name:'English'}},
    {subtitleTrackPreference:{languageCode:'en',kind:'',name:1}}]){
    const result=await h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch},page);assert.equal(result.error?.code,'INVALID_PREFERENCES',JSON.stringify(patch));
  }
  assert.equal(h.writes.length,0);h.controller.stop();
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

test('independent partial player styles merge with the latest record inside the write queue',async()=>{
  const gate=deferred();let writes=0;
  const h=fixture({setHook:()=>++writes===1?gate.promise:undefined});await h.controller.ready;
  const first=h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch:{subtitleStyle:{sourceFontSize:28}}},page);
  const second=h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch:{subtitleStyle:{targetColor:'#00ff00'}}},page);
  await flush();gate.resolve();assert.equal((await first).ok,true);assert.equal((await second).ok,true);
  const saved=await privateSettings(h);assert.equal(saved.subtitleStyle.sourceFontSize,28);assert.equal(saved.subtitleStyle.targetColor,'#00ff00');
  h.controller.stop();
});

test('a provider disabled by an earlier queued write cannot be selected through a stale public patch',async()=>{
  const gate=deferred();let writes=0;
  const h=fixture({stored:customSettings(),setHook:()=>++writes===1?gate.promise:undefined});await h.controller.ready;
  const base=await privateSettings(h),changed=structuredClone(base);changed.providers.at(-1).enabled=false;
  const save=saveSnapshot(h,changed,base);
  const patch=h.controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch:{subtitleProviderId:'custom'}},page);
  await flush();gate.resolve();assert.equal((await save).ok,true);assert.equal((await patch).error?.code,'INVALID_PREFERENCES');
  assert.equal(h.writes.length,1);h.controller.stop();
});

test('full settings saves merge separate nested style fields and report only genuine field conflicts',async()=>{
  const h=fixture();await h.controller.ready;
  const base=await privateSettings(h),first=structuredClone(base),second=structuredClone(base),conflicting=structuredClone(base);
  first.subtitleStyle.targetFontSize=32;first.pageStyle.textColor='#aabbcc';
  second.subtitleStyle.targetColor='#123456';second.pageStyle.fontSize=130;
  conflicting.subtitleStyle.targetFontSize=48;
  assert.equal((await saveSnapshot(h,first,base)).ok,true);assert.equal((await saveSnapshot(h,second,base)).ok,true);
  const saved=await privateSettings(h);
  assert.equal(saved.subtitleStyle.targetFontSize,32);assert.equal(saved.subtitleStyle.targetColor,'#123456');
  assert.equal(saved.pageStyle.textColor,'#aabbcc');assert.equal(saved.pageStyle.fontSize,130);
  assert.equal((await saveSnapshot(h,conflicting,base)).error?.code,'SETTINGS_CONFLICT');h.controller.stop();
});

test('style, display mode, order and learning mask changes do not abort running translations',async()=>{
  const h=fixture();await h.controller.ready;h.controller.stop();let signal;
  const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:(_url,init)=>{signal=init.signal;return new Promise(()=>{});}}).start();await controller.ready;
  const job=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'style-safe',texts:['Hello']},page);await flush();
  const base=(await controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value;
  const changed=structuredClone(base);changed.pageDisplayMode='translation_only';changed.pageStyle.fontSize=125;
  changed.subtitleStyle.displayMode='translation_only';changed.subtitleStyle.displayOrder='translation_on_top';changed.subtitleStyle.hideTranslation=true;
  assert.equal((await controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:changed,baseSettings:base},options)).ok,true);await flush();
  assert.equal(signal.aborted,false);
  assert.equal((await controller.handleMessage({type:'KUAI_UPDATE_PREFERENCES',patch:{subtitleStyle:{targetFontSize:30}}},page)).ok,true);await flush();
  assert.equal(signal.aborted,false);
  const current=(await controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value;
  await controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:{...current,targetLanguage:'ja'},baseSettings:current},options);
  assert.equal((await job).error?.code,'CANCELLED');controller.stop();
});

for(const [field,nextValue] of [['targetLanguage','fr'],['sourceLanguage','de'],['activeProviderId','google']]){
  test('changing default '+field+' preserves explicit independent subtitle requests but cancels jobs following that default',async()=>{
    const h=fixture();await h.controller.ready;h.controller.stop();const signals=new Map();
    const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:(_url,init)=>{signals.set(JSON.parse(init.body)[0],init.signal);return new Promise(()=>{});}}).start();await controller.ready;
    const caption=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'caption-explicit',texts:['Caption'],providerId:'microsoft',sourceLanguage:'en',targetLanguage:'ja'},page);
    const following=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'page-following',texts:['Page']},page);await flush();
    const base=(await controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value;
    assert.equal((await controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:{...base,[field]:nextValue},baseSettings:base},options)).ok,true);await flush();
    assert.equal(signals.get('Caption').aborted,false);
    assert.equal(signals.get('Page').aborted,true);assert.equal((await following).error?.code,'CANCELLED');
    await controller.handleMessage({type:'KUAI_CANCEL',requestId:'caption-explicit'},page);await caption;controller.stop();
  });
}

test('cosmetic provider edits and unrelated credentials do not cancel a request for another service',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;h.controller.stop();let signal;
  const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:(_url,init)=>{signal=init.signal;return new Promise(()=>{});}}).start();await controller.ready;
  const job=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'unrelated',texts:['Hello'],providerId:'microsoft'},page);await flush();
  const base=(await controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value,changed=structuredClone(base);
  changed.providers.at(-1).name='Renamed';changed.providers.at(-1).apiKey='another-key';
  await controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:changed,baseSettings:base},options);await flush();
  assert.equal(signal.aborted,false);
  await controller.handleMessage({type:'KUAI_CANCEL',requestId:'unrelated'},page);await job;controller.stop();
});

for(const [field,nextValue] of [['apiKey','replacement-key'],['model','replacement-model'],['enabled',false]]){
test('changing a stored provider '+field+' cancels only its jobs while selections and languages are unchanged',async()=>{
  const h=fixture({stored:customSettings()});await h.controller.ready;h.controller.stop();const signals=new Map();
  const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:(url,init)=>{signals.set(new URL(url).hostname,init.signal);return new Promise(()=>{});}}).start();await controller.ready;
  const microsoft=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'keep-free',texts:['Hello'],providerId:'microsoft'},page);
  const custom=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'old-key',texts:['Hello'],providerId:'custom'},page);await flush();
  const base=(await controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},options)).value,changed=structuredClone(base);
  changed.providers.at(-1)[field]=nextValue;
  await controller.handleMessage({type:'KUAI_SAVE_SETTINGS',settings:changed,baseSettings:base},options);await flush();
  assert.equal((await custom).error?.code,'CANCELLED');assert.equal(signals.get('api.example').aborted,true);
  assert.equal(signals.get('edge.microsoft.com').aborted,false);
  await controller.handleMessage({type:'KUAI_CANCEL',requestId:'keep-free'},page);await microsoft;controller.stop();
});
}

test('feature option links can only open the five fixed extension settings sections',async()=>{
  const h=fixture();await h.controller.ready;const opened=[];h.chromeApi.tabs.create=async value=>{opened.push(value);return {id:9};};
  for(const section of ['webpage','selection','input','hover','subtitles']){
    const result=await h.controller.handleMessage({type:'KUAI_OPEN_OPTIONS',section},page);
    assert.equal(result.ok,true);assert.deepEqual(result.value,{opened:true,section});
  }
  assert.deepEqual(opened.map(item=>item.url),['webpage','selection','input','hover','subtitles'].map(section=>'chrome-extension://kuai-extension/options.html#'+section));
  for(const message of [{type:'KUAI_OPEN_OPTIONS',section:'https://evil.example'},{type:'KUAI_OPEN_OPTIONS',section:'subtitles',url:'https://evil.example'}])
    assert.equal((await h.controller.handleMessage(message,page)).ok,false);
  assert.equal(opened.length,5);h.controller.stop();
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

test('a queued page display patch overlays the current full settings instead of an earlier snapshot',async()=>{
  const gate=deferred();let writes=0;const h=fixture({stored:customSettings(),setHook:()=>++writes===1?gate.promise:undefined});await h.controller.ready;
  const base=await privateSettings(h),draft=structuredClone(base);draft.targetLanguage='ja';draft.selectionOptions.delay=700;
  const first=saveSnapshot(h,draft,base);
  const second=h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch:{pageDisplayMode:'translation_only'}},page);
  await flush();assert.equal(h.writes.length,1);gate.resolve();
  assert.equal((await first).ok,true);assert.equal((await second).ok,true);
  const current=await privateSettings(h);assert.equal(current.targetLanguage,'ja');assert.equal(current.selectionOptions.delay,700);
  assert.equal(current.pageDisplayMode,'translation_only');assert.equal(current.providers.at(-1).apiKey,'old-test-key');h.controller.stop();
});

test('page display preference updates preserve in-flight translation jobs',async()=>{
  const h=fixture();await h.controller.ready;h.controller.stop();let signal;
  const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:(_url,init)=>{signal=init.signal;return new Promise(()=>{});}}).start();await controller.ready;
  const job=controller.handleMessage({type:'KUAI_TRANSLATE',requestId:'page-style',texts:['Hello']},page);await flush();
  try {
    assert.equal((await controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch:{pageDisplayMode:'translation_only'}},page)).ok,true);
    assert.equal(signal.aborted,false);
  }finally{await controller.handleMessage({type:'KUAI_CANCEL',requestId:'page-style'},page);await job;controller.stop();}
});

test('initial menu visibility waits for stored global and feature preferences',async()=>{
  const gate=deferred(),stored=defaultSettings();stored.selectionEnabled=false;stored.inputOptions.enabled=false;
  const h=fixture({stored,accessHook:()=>gate.promise});await flush();assert.deepEqual(h.menuCalls,[]);
  gate.resolve();await h.controller.ready;await flush();
  assert.deepEqual(h.menus.map(menu=>menu.id),['kuai.page','kuai.restore','kuai.site.always','kuai.site.never','kuai.site.default']);h.controller.stop();
  stored.pageOptions.contextMenuEnabled=false;
  const hidden=fixture({stored});await hidden.controller.ready;await flush();assert.deepEqual(hidden.menus,[]);hidden.controller.stop();
});

test('menus rebuild only for relevant preference changes and preserve independent feature switches',async()=>{
  const h=fixture();await h.controller.ready;await flush();
  let current=await privateSettings(h);const firstCount=h.menuCalls.length;
  current.pageStyle.fontSize=120;current.targetLanguage='ja';await saveSnapshot(h,current);await flush();
  h.chromeApi.runtime.onInstalled.emit();await flush();assert.equal(h.menuCalls.length,firstCount);
  current=await privateSettings(h);current.selectionEnabled=false;await saveSnapshot(h,current);await flush();
  assert.deepEqual(h.menus.map(menu=>menu.id),['kuai.page','kuai.restore','kuai.input','kuai.site.always','kuai.site.never','kuai.site.default']);
  current=await privateSettings(h);current.inputOptions.enabled=false;await saveSnapshot(h,current);await flush();
  assert.deepEqual(h.menus.map(menu=>menu.id),['kuai.page','kuai.restore','kuai.site.always','kuai.site.never','kuai.site.default']);
  current=await privateSettings(h);current.pageOptions.contextMenuEnabled=false;await saveSnapshot(h,current);await flush();assert.deepEqual(h.menus,[]);
  current=await privateSettings(h);current.pageOptions.contextMenuEnabled=true;await saveSnapshot(h,current);await flush();
  assert.deepEqual(h.menus.map(menu=>menu.id),['kuai.page','kuai.restore','kuai.site.always','kuai.site.never','kuai.site.default']);h.controller.stop();
});

test('a preference change while menu removal waits cannot publish obsolete menu items',async()=>{
  const gate=deferred(),h=fixture({removeMenuHook:()=>gate.promise});await h.controller.ready;await flush();
  const current=await privateSettings(h);current.pageOptions.contextMenuEnabled=false;
  await saveSnapshot(h,current);gate.resolve();await flush();
  assert.deepEqual(h.menus,[]);assert.equal(h.menuCalls.some(call=>call.startsWith('kuai.')),false);h.controller.stop();
});

test('menu creation callbacks are serialized and a mid-create preference change wins the final menu state',async()=>{
  const gate=deferred();let creates=0;
  const h=fixture({createMenuHook:()=>++creates===1?gate.promise:undefined});await h.controller.ready;await flush();
  try {
    assert.equal(creates,1);
    const current=await privateSettings(h);current.pageOptions.contextMenuEnabled=false;await saveSnapshot(h,current);
    gate.resolve();await flush();assert.deepEqual(h.menus,[]);assert.equal(creates,1);
  }finally{gate.resolve();h.controller.stop();}
});

test('stopping while menu removal waits prevents all later creates',async()=>{
  const gate=deferred(),h=fixture({removeMenuHook:()=>gate.promise});await h.controller.ready;await flush();
  h.controller.stop();gate.resolve();await flush();
  assert.deepEqual(h.menus,[]);assert.equal(h.menuCalls.some(call=>call.startsWith('kuai.')),false);
});

test('late menu clicks wait for queued settings and recheck the current global and feature switches',async()=>{
  const gate=deferred();let writes=0;const h=fixture({setHook:()=>++writes===1?gate.promise:undefined});await h.controller.ready;await flush();
  const current=await privateSettings(h);current.selectionEnabled=false;current.inputOptions.enabled=false;
  const save=saveSnapshot(h,current);await flush();
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.selection',selectionText:'Do not send',frameId:2},{id:4});
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.input',frameId:2},{id:4});await flush();
  const forwarded=()=>h.broadcasts.filter(item=>['KUAI_SELECTION_TRANSLATE','KUAI_INPUT_TRANSLATE','KUAI_PAGE_TRANSLATE'].includes(item.message?.type));
  assert.equal(forwarded().length,0);gate.resolve();await save;await flush();assert.equal(forwarded().length,0);
  const disabled=await privateSettings(h);disabled.pageOptions.contextMenuEnabled=false;await saveSnapshot(h,disabled);
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.page'},{id:4});await flush();assert.equal(forwarded().length,0);h.controller.stop();
});

test('a worker stopped during initialization cannot forward a queued menu click or save a page patch',async()=>{
  const gate=deferred(),h=fixture({accessHook:()=>gate.promise});
  h.chromeApi.contextMenus.onClicked.emit({menuItemId:'kuai.selection',selectionText:'Old text'},{id:4});
  const pending=h.controller.handleMessage({type:'KUAI_UPDATE_PAGE_PREFERENCES',patch:{pageDisplayMode:'translation_only'}},page);
  h.controller.stop();gate.resolve();const response=await pending;await flush();
  assert.equal(response.error?.code,'CANCELLED');assert.equal(h.writes.length,0);
  assert.equal(h.broadcasts.some(item=>item.message?.type==='KUAI_SELECTION_TRANSLATE'),false);
});

test('opaque content frames require HTTP origin evidence and never become trusted extension pages',async()=>{
  const h=fixture();await h.controller.ready;
  for(const url of ['blob:https://example.com/uuid','data:text/html,<p>Hello</p>','filesystem:https://example.com/temporary/page.html']){
    const sender={...page,url,origin:'https://example.com'};
    assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},sender)).ok,true);
    assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS',includeSecrets:true},sender)).error?.code,'FORBIDDEN');
    const inherited={...sender,origin:'null',tab:{id:4,url:'https://example.com/article'}};
    assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},inherited)).ok,true);
  }
  for(const sender of [
    {...page,url:'data:text/html,x',origin:'null'},
    {...page,url:'blob:chrome-extension://kuai-extension/uuid',origin:'https://example.com'},
    {...page,url:options.url,origin:'https://example.com'},
    {...page,url:'data:text/html,x',origin:'https://example.com',documentId:''},
    {...page,url:'data:text/html,x',origin:'https://example.com',tab:{id:-1}},
  ])assert.equal((await h.controller.handleMessage({type:'KUAI_GET_SETTINGS'},sender)).error?.code,'FORBIDDEN');
  h.controller.stop();
});

test('model discovery is restricted to extension pages and cancellation owns its request',async()=>{
  const h=fixture();await h.controller.ready;h.controller.stop();
  let calls=0,aborted=false;
  const controller=createBackground({chromeApi:h.chromeApi,fetchImpl:async(_url,init)=>{
    calls++;
    if(calls===1)return Response.json({data:[{id:'available'}]});
    init.signal.addEventListener('abort',()=>{aborted=true;});
    return new Promise(()=>{});
  }});
  const message={type:'KUAI_LIST_MODELS',requestId:'models',provider:{id:'draft',type:'openai',apiKey:'fixture-key',model:''}};
  assert.equal((await controller.handleMessage(message,page)).error.code,'FORBIDDEN');
  assert.equal(calls,0);
  assert.deepEqual((await controller.handleMessage(message,options)).value,[{id:'available',name:'available'}]);
  const pending=controller.handleMessage(message,options);await flush();
  assert.equal((await controller.handleMessage({type:'KUAI_CANCEL',requestId:'models'},page)).value.cancelled,false);
  assert.equal((await controller.handleMessage({type:'KUAI_CANCEL',requestId:'models'},options)).value.cancelled,true);
  assert.equal((await pending).error.code,'CANCELLED');assert.equal(aborted,true);
  assert.equal(h.writes.length,0);controller.stop();
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
