import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,Event} from './helpers/content-dom.cjs';
import {createContentRuntime} from '../dist/src/content/index.js';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setImmediate as immediate} from 'node:timers/promises';
import {defaultSettings} from '../dist/src/shared/settings.js';

const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';

function setup(options={}){
 const h=fixture(),listeners=new Set(),subscribers=new Set(),youtubeCalls=[],youtubeSettings=[];let youtubeStops=0,persisted;
 h.env.chrome={runtime:{id:'kuai-id',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
 const client={getSettings:async()=>structuredClone(persisted||h.settings),translate:h.dependencies.translate,cancel:h.dependencies.cancel,makeRequestId:h.dependencies.makeRequestId,onSettingsChanged:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);}};
 const runtime=createContentRuntime({env:h.env,client,startYouTube:args=>{youtubeCalls.push(args);if(options.launch)return options.launch(args);const off=args.subscribeSettings(next=>youtubeSettings.push(next));return {stop(){youtubeStops++;off();}};}});
 const message=(type,payload={},sender={id:'kuai-id'})=>new Promise(resolve=>{for(const listener of listeners)if(listener({type,...payload},sender,resolve)===true)return;resolve(undefined);});
 return {...h,client,runtime,message,listeners,subscribers,youtubeCalls,youtubeSettings,get youtubeStops(){return youtubeStops;},save:next=>{persisted=structuredClone(next);},notify:async next=>{persisted=structuredClone(next);subscribers.forEach(fn=>fn(next));await settle();}};
}

test('runtime registers page messages, starts YouTube once, and returns immediate page progress envelopes',async()=>{
 const h=setup();h.paragraph('Hello');await Promise.all([h.runtime.start(),h.runtime.start()]);assert.equal(h.youtubeCalls.length,1);assert.equal(h.listeners.size,1);
 const response=await h.message('KUAI_PAGE_TRANSLATE');assert.equal(response.ok,true);for(let index=0;index<8;index++)await Promise.resolve();const status=await h.message('KUAI_PAGE_STATUS');assert.equal(status.value.translated,1);assert.equal(status.value.isTranslated,true);assert.equal((await h.message('KUAI_PAGE_RESTORE')).value.total,0);h.runtime.stop();assert.equal(h.listeners.size,0);assert.equal(h.youtubeStops,1);
});

test('settings update cancels old page work, clears stale UI and informs the YouTube bridge',async()=>{
 const h=setup(),p=h.paragraph('Hello');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await h.notify({...h.settings,activeProviderId:'google'});finish({translations:['Old']});for(let index=0;index<8;index++)await Promise.resolve();assert.equal(p.querySelector('[data-kuai-page-translation]'),null);assert.equal(h.youtubeSettings.length,1);assert.equal(h.youtubeSettings[0].activeProviderId,'google');assert.equal(h.cancellations.length,1);h.runtime.stop();
});

test('context-menu text is translated without a live selection and foreign senders are ignored',async()=>{
 const h=setup();await h.runtime.start();assert.equal(await h.message('KUAI_PAGE_TRANSLATE',{}, {id:'other-extension'}),undefined);const response=await h.message('KUAI_SELECTION_TRANSLATE',{text:'Context text'});assert.equal(response.ok,true);assert.deepEqual(h.requests[0].texts,['Context text']);h.runtime.stop();
});

test('route changes invalidate page output and late responses, while BFCache retains working listeners',async()=>{
 const h=setup(),p=h.paragraph('Hello');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');h.env.location.href='https://example.org/new';h.env.dispatchEvent(new Event('popstate'));finish({translations:['Old']});for(let index=0;index<8;index++)await Promise.resolve();assert.equal(p.querySelector('[data-kuai-page-translation]'),null);h.env.dispatchEvent(new Event('pagehide',{persisted:true}));assert.equal(h.listeners.size,1);h.env.dispatchEvent(new Event('pageshow',{persisted:true}));assert.equal((await h.message('KUAI_PAGE_STATUS')).ok,true);h.runtime.stop();
});

test('presentation-only notifications restyle translated content without clearing it or making requests',async()=>{
 const h=setup(),p=h.paragraph('Hello');await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');for(let i=0;i<10;i++)await Promise.resolve();
 const output=p.querySelector('[data-kuai-page-translation]'),node=output.firstChild;
 await h.notify({...h.settings,pageStyle:{textColor:'#123456',fontSize:140}});
 assert.strictEqual(p.querySelector('[data-kuai-page-translation]'),output);assert.strictEqual(output.firstChild,node);assert.ok(sheet(h).includes('color:#123456!important'));assert.equal(h.requests.length,1);assert.equal(h.cancellations.length,0);h.runtime.stop();
});

async function settle(){for(let i=0;i<24;i++)await Promise.resolve();}
function mutations(h){
 const observers=[];h.env.MutationObserver=class {constructor(callback){this.callback=callback;this.active=false;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
 return records=>{for(const observer of observers)if(observer.active)observer.callback(records);};
}

test('opted-in page language rules start translation and a manual restore stays restored until navigation',async()=>{
 const h=setup();h.settings.pageOptions={autoTranslate:true,alwaysLanguages:['en']};h.doc.documentElement.setAttribute('lang','en');const p=h.paragraph('Article');
 await h.runtime.start();h.flushTimers();await settle();assert.equal(h.requests.length,1);
 await h.message('KUAI_PAGE_RESTORE');await h.notify({...h.settings,pageStyle:{fontSize:120}});h.flushTimers();await settle();
 assert.equal(h.requests.length,1);assert.equal(!!p.querySelector('[data-kuai-page-translation]'),false);
 h.env.location.href='https://example.org/next';h.env.dispatchEvent(new Event('popstate'));h.flushTimers();await settle();
 assert.equal(h.requests.length,2);h.runtime.stop();
});

test('page shortcuts toggle translation exactly and leave editors, IME and repeated keys alone',async()=>{
 const h=setup(),p=h.paragraph('Hello');await h.runtime.start();
 const first=h.emit(p,'keydown',{key:'z',code:'KeyZ',altKey:true});await settle();assert.equal(first.defaultPrevented,true);assert.equal(h.requests.length,1);
 h.emit(p,'keydown',{key:'z',code:'KeyZ',altKey:true,repeat:true});await settle();assert.equal(!!p.querySelector('[data-kuai-page-translation]'),true);
 h.emit(p,'keydown',{key:'z',code:'KeyZ',altKey:true});await settle();assert.equal(!!p.querySelector('[data-kuai-page-translation]'),false);
 const input=h.paragraph('','textarea');input.focus();
 for(const event of [h.emit(input,'keydown',{key:'z',altKey:true}),h.emit(p,'keydown',{key:'z',altKey:true,isComposing:true}),h.emit(p,'keydown',{key:'z',altKey:true,ctrlKey:true})])assert.equal(event.defaultPrevented,false);
 assert.equal(h.requests.length,1);h.runtime.stop();
});

test('the display-mode shortcut uses a narrow preference patch and applies the saved mode before first translation',async()=>{
 const h=setup(),p=h.paragraph('Hello'),patches=[];h.settings.pageOptions={displayModeShortcut:'Alt+M'};
 h.client.updatePagePreferences=async patch=>{patches.push(patch);const next={...h.settings,...patch};h.save(next);return next;};
 await h.runtime.start();h.emit(p,'keydown',{key:'m',altKey:true});await settle();
 assert.deepEqual(patches,[{pageDisplayMode:'translation_only'}]);assert.equal(h.requests.length,1);
 assert.equal(p.firstChild.nodeValue,'');assert.equal(p.querySelector('[data-kuai-original]'),null);h.runtime.stop();
});

test('opted-in dynamic translation sends only added source and ignores owned output mutations',async()=>{
 const h=setup(),emit=mutations(h),first=h.paragraph('First');h.settings.pageOptions={translateDynamic:true};
 await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();
 const added=h.paragraph('Second');emit([{type:'childList',target:h.doc.body,addedNodes:[added],removedNodes:[]}]);h.flushTimers();await settle();
 assert.deepEqual(h.requests.map(request=>request.texts),[['First'],['Second']]);
 const output=first.querySelector('[data-kuai-page-translation]');emit([{type:'childList',target:first,addedNodes:[output],removedNodes:[]}]);h.flushTimers();await settle();assert.equal(h.requests.length,2);
 await h.message('KUAI_PAGE_RESTORE');const later=h.paragraph('Third');emit([{type:'childList',target:h.doc.body,addedNodes:[later],removedNodes:[]}]);h.flushTimers();await settle();assert.equal(h.requests.length,2);h.runtime.stop();
});

test('automatic translation respects opt-in, deny precedence and already-target-language pages',async()=>{
 for(const scenario of [
  {options:{autoTranslate:false,alwaysSites:['example.org']},lang:'en'},
  {options:{autoTranslate:true,alwaysSites:['example.org'],neverSites:['example.org']},lang:'en'},
  {options:{autoTranslate:true,alwaysSites:['example.org'],neverLanguages:['en']},lang:'en'},
  {options:{autoTranslate:true},lang:'zh-Hans'},
 ]){
  const h=setup();h.settings.pageOptions=scenario.options;h.doc.documentElement.setAttribute('lang',scenario.lang);h.paragraph('Content');
  await h.runtime.start();h.flushTimers();await settle();assert.equal(h.requests.length,0);h.runtime.stop();
 }
});

function run(failures,scenario={}) {
  const path=fileURLToPath(new URL('../public/content-loader.ts',import.meta.url));
  const program=`
    import vm from 'node:vm';import fs from 'node:fs';import ts from 'typescript';
    const scenario=${JSON.stringify(scenario)};
    let attempts=0,imports=0,nextTimer=0,pagehidden=false;const timers=new Map(),delays=[],warnings=[],listeners=new Map(),cleared=[];
    const context=vm.createContext({chrome:{runtime:{getURL:()=> 'chrome-extension://kuai/src/content/index.js'}},console:{warn:(...args)=>warnings.push(args.join(' '))},
      setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,fn);delays.push(delay);return id;},clearTimeout:id=>{if(timers.delete(id))cleared.push(id);},
      addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)});
    const module=new vm.SyntheticModule(['start'],function(){this.setExport('start',async()=>{attempts++;if(attempts<=${failures}){const error=new Error('private-details-must-not-log');error.code=scenario.errorCode||'TEMPORARY';throw error;}return {ready:true};});},{context});
    await module.link(()=>{});await module.evaluate();
    const script=new vm.Script(ts.transpileModule(fs.readFileSync(${JSON.stringify(path)},'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{importModuleDynamically:async()=>{imports++;return module;}});
    script.runInContext(context);script.runInContext(context);
    for(let i=0;i<20;i++){
      await new Promise(setImmediate);
      if(scenario.pagehideDuringRetry&&!pagehidden&&timers.size){pagehidden=true;for(const fn of [...(listeners.get('pagehide')||[])])fn({persisted:!!scenario.persisted});}
      const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1]();}
    }
    if(context.__kuaiContentLoading)await context.__kuaiContentLoading;
    console.log(JSON.stringify({attempts,imports,delays,warnings,hasLoading:!!context.__kuaiContentLoading,pendingTimers:timers.size,cleared:cleared.length,pagehideListeners:listeners.get('pagehide')?.size||0}));
  `;
  const result=spawnSync(process.execPath,['--no-warnings','--experimental-vm-modules','--input-type=module','-e',program],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('actual classic content loader retries a transient startup failure and deduplicates injections',()=>{
  const result=run(1);assert.equal(result.attempts,2);assert.equal(result.imports,1);assert.equal(result.hasLoading,true);assert.deepEqual(result.delays,[250]);assert.equal(result.pagehideListeners,0);
});
test('classic bootstrap stops after a bounded retry budget without logging private error messages',()=>{
  const result=run(10);assert.equal(result.attempts,4);assert.deepEqual(result.delays,[250,1000,3000]);assert.equal(result.hasLoading,false);assert.equal(result.warnings.length,1);assert.ok(!result.warnings.join('').includes('private-details'));assert.equal(result.pagehideListeners,0);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function setupSync(t){
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
  const h=setupSync(t),paragraph=h.paragraph('Hello');await h.runtime.start();
  await h.message('KUAI_PAGE_TRANSLATE');await immediate();assert.ok(paragraph.querySelector('[data-kuai-page-translation]'));
  h.store({...defaultSettings(),targetLanguage:'ja'});
  const result=await h.message('KUAI_PAGE_STATUS');
  assert.equal(result.ok,true);assert.equal(result.value.total,0);assert.equal(h.settings.targetLanguage,'ja');
});

test('stop rejects a pending action promptly and ignores its later settings response',async t=>{
  const h=setupSync(t),read=deferred();h.paragraph('Hello');await h.runtime.start();t.after(()=>read.resolve(defaultSettings()));
  h.client.getSettings=()=>read.promise;
  let response;const pending=h.message('KUAI_PAGE_TRANSLATE').then(value=>{response=value;});await immediate();
  h.runtime.stop();await immediate();
  assert.equal(response?.error?.code,'CONTENT_STOPPED');await pending;
  read.resolve({...defaultSettings(),targetLanguage:'ja'});await immediate();
  assert.equal(h.runtime.status().phase,'stopped');assert.equal(h.requests.length,0);assert.equal(h.subscribers.size,0);
});

test('content logging follows initial settings and refreshed settings-change broadcasts',async t=>{
 const {debug,isDebug,setDebug}=await import('../dist/src/shared/debug.js');
 const calls=t.mock.method(console,'debug',()=>{}),h=setup();
 h.settings.debugMode=true;
 t.after(()=>{h.runtime.stop();setDebug(false);});
 await h.runtime.start();assert.equal(isDebug(),true);
 debug('content:test','initial');assert.ok(calls.mock.calls.some(call=>call.arguments[1]==='initial'));
 await h.notify({...h.settings,debugMode:false});assert.equal(isDebug(),false);
 const count=calls.mock.callCount();debug('content:test','disabled');assert.equal(calls.mock.callCount(),count);
 await h.notify({...h.settings,debugMode:true});assert.equal(isDebug(),true);
 debug('content:test','enabled');assert.ok(calls.mock.calls.some(call=>call.arguments[1]==='enabled'));
});
