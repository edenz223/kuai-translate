import test from 'node:test';
const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';
import assert from 'node:assert/strict';
import { fixture, Event } from './helpers/content-dom.cjs';
import { createContentRuntime } from '../dist/src/content/index.js';

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
test('style changes during a page request neither cancel it nor lose its eventual result',async()=>{
 const h=setup(),p=h.paragraph('Hello');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');
 await h.notify({...h.settings,pageStyle:{textColor:'#654321'},subtitleStyle:{hideTranslation:true}});assert.equal(h.cancellations.length,0);
 finish({translations:['你好']});for(let i=0;i<12;i++)await Promise.resolve();const output=p.querySelector('[data-kuai-page-translation]');assert.equal(output.textContent,'你好');assert.ok(sheet(h).includes('color:#654321!important'));h.runtime.stop();
});
test('a transient initial settings failure can be retried on the same runtime without duplicate listeners',async()=>{
 const h=setup();let attempts=0;h.client.getSettings=async()=>{if(++attempts===1)throw Error('temporary');return h.settings;};
 await assert.rejects(h.runtime.start());await h.runtime.start();assert.equal(attempts,2);assert.equal(h.listeners.size,1);assert.equal((await h.message('KUAI_PAGE_STATUS')).ok,true);h.runtime.stop();
});
test('optional YouTube initialization failure keeps page translation working and can retry list opening',async()=>{
 let attempts=0,opened=0;const h=setup({launch:()=>{if(++attempts===1)throw Error('view unavailable');return {openSidebar:()=>{opened++;return {opened:true};},stop(){}};}});h.paragraph('Hello');
 await h.runtime.start();assert.equal(h.listeners.size,1);assert.equal((await h.message('KUAI_PAGE_TRANSLATE')).ok,true);
 for(let i=0;i<10;i++)await Promise.resolve();assert.equal((await h.message('KUAI_PAGE_STATUS')).value.translated,1);
 const result=await h.message('KUAI_YOUTUBE_OPEN_LIST');assert.equal(result.ok,true);assert.equal(result.value.opened,true);assert.equal(attempts,2);assert.equal(opened,1);h.runtime.stop();
});
test('a settings rejection arriving after stop preserves the disposed phase and cannot revive the runtime',async()=>{
 const h=setup();let rejectSettings;
 h.client.getSettings=()=>new Promise((resolve,reject)=>{rejectSettings=reject;});
 const pending=h.runtime.start();for(let i=0;i<5&&!rejectSettings;i++)await Promise.resolve();
 assert.equal(typeof rejectSettings,'function');h.runtime.stop();rejectSettings(Error('late private failure'));
 await assert.rejects(pending,{code:'CONTENT_STOPPED'});
 assert.equal(h.runtime.status().phase,'stopped');assert.equal(h.listeners.size,0);assert.equal(h.subscribers.size,0);
 await assert.rejects(h.runtime.start(),{code:'CONTENT_STOPPED'});
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
 assert.equal(!!p.querySelector('[data-kuai-original]'),true);h.runtime.stop();
});

test('opted-in dynamic translation sends only added source and ignores owned output mutations',async()=>{
 const h=setup(),emit=mutations(h),first=h.paragraph('First');h.settings.pageOptions={translateDynamic:true};
 await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();
 const added=h.paragraph('Second');emit([{type:'childList',target:h.doc.body,addedNodes:[added],removedNodes:[]}]);h.flushTimers();await settle();
 assert.deepEqual(h.requests.map(request=>request.texts),[['First'],['Second']]);
 const output=first.querySelector('[data-kuai-page-translation]');emit([{type:'childList',target:first,addedNodes:[output],removedNodes:[]}]);h.flushTimers();await settle();assert.equal(h.requests.length,2);
 await h.message('KUAI_PAGE_RESTORE');const later=h.paragraph('Third');emit([{type:'childList',target:h.doc.body,addedNodes:[later],removedNodes:[]}]);h.flushTimers();await settle();assert.equal(h.requests.length,2);h.runtime.stop();
});

test('dynamic source edits inside a hidden original are translated while output text edits are ignored',async()=>{
 const h=setup(),emit=mutations(h),p=h.paragraph('First');h.settings.pageOptions={translateDynamic:true};h.settings.pageDisplayMode='translation_only';
 await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();
 const original=p.querySelector('[data-kuai-original]').firstChild;original.nodeValue='Updated source';
 emit([{type:'characterData',target:original,addedNodes:[],removedNodes:[]}]);h.flushTimers();await settle();
 assert.deepEqual(h.requests.map(request=>request.texts),[['First'],['Updated source']]);
 const translated=p.querySelector('[data-kuai-page-translation]').firstChild;emit([{type:'characterData',target:translated,addedNodes:[],removedNodes:[]}]);h.flushTimers();await settle();
 assert.equal(h.requests.length,2);h.runtime.stop();
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

test('stopping during pending automatic language detection cannot revive page work',async()=>{
 const h=setup();h.settings.pageOptions={autoTranslate:true,alwaysLanguages:['en']};h.paragraph('Waiting');let resolve;
 h.env.chrome.i18n={detectLanguage:()=>new Promise(finish=>{resolve=finish;})};await h.runtime.start();h.flushTimers();await settle();
 assert.equal(typeof resolve,'function');h.runtime.stop();resolve({isReliable:true,languages:[{language:'en',percentage:100}]});await settle();h.flushTimers();
 assert.equal(h.requests.length,0);assert.equal(h.runtime.status().phase,'stopped');
});

test('an in-flight dynamic page follows an updated target after the superseded request settles',async()=>{
 const h=setup();h.settings.pageOptions={translateDynamic:true};h.paragraph('First');const pending=[];
 h.respond(()=>new Promise(resolve=>pending.push(resolve)));await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();
 await h.notify({...h.settings,targetLanguage:'ja'});pending[0]({translations:['Old result']});await settle();h.flushTimers();await settle();
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].options.targetLanguage,'ja');pending[1]({translations:['新しい訳文']});await settle();h.runtime.stop();
});

async function paragraphTap(h,p){h.emit(p,'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();}
const pageOutput=p=>p.querySelector('[data-kuai-page-translation]');

test('runtime refreshes paragraph output styles without clearing text or sending another request',async t=>{
 const h=setup(),p=h.paragraph('Hover source');h.settings.hoverEnabled=true;h.settings.hoverOptions={displayMode:'inline',delay:50};t.after(()=>h.runtime.stop());await h.runtime.start();
 await paragraphTap(h,p);const output=pageOutput(p);assert.ok(output);assert.equal((await h.message('KUAI_PAGE_STATUS')).value.translated,1);
 await h.notify({...h.settings,pageStyle:{preset:'highlight',textColor:'#123456',fontSize:130}});
 assert.strictEqual(pageOutput(p),output);assert.ok(sheet(h).includes('color:#123456!important'));assert.ok(sheet(h).includes('font-size:130%!important'));assert.equal(h.requests.length,1);assert.equal(h.cancellations.length,0);
});

test('a full page pass keeps prior paragraph output and never resends its source',async t=>{
 const h=setup(),p=h.paragraph('Shared paragraph'),source=p.firstChild;h.settings.hoverEnabled=true;t.after(()=>h.runtime.stop());await h.runtime.start();
 await paragraphTap(h,p);const output=pageOutput(p);assert.ok(output);
 await h.message('KUAI_PAGE_TRANSLATE');await settle();assert.equal(pageOutput(p),output);assert.equal(p.querySelectorAll('[data-kuai-page-translation]').length,1);assert.strictEqual(p.firstChild,source);
 assert.deepEqual(h.requests.map(request=>request.texts),[['Shared paragraph']]);
});

for(const pending of [false,true])test(`pointer hover reuses a ${pending?'pending':'completed'} page entry without cancelling page work`,async t=>{
 const h=setup(),p=h.paragraph('Shared paragraph');let finish;h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'hover',delay:50};t.after(()=>h.runtime.stop());if(pending)h.respond(()=>new Promise(resolve=>{finish=resolve;}));await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();
 const output=pageOutput(p);h.emit(p,'mousemove');h.advance(50);await settle();assert.equal(h.requests.length,1);assert.equal(h.cancellations.length,0);
 if(pending){finish({translations:['Shared result']});await settle();}
 assert.strictEqual(pageOutput(p),output);assert.equal((await h.message('KUAI_PAGE_STATUS')).value.translated,1);
});

test('page restore clears paragraph results while preserving a separately running input translation',async t=>{
 const h=setup(),p=h.paragraph('Hover source');h.settings.hoverEnabled=true;t.after(()=>h.runtime.stop());await h.runtime.start();await paragraphTap(h,p);assert.ok(pageOutput(p));
 const input=h.paragraph('','textarea');input.value='Draft';input.focus();let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const inputJob=h.message('KUAI_INPUT_TRANSLATE');await settle();assert.equal(typeof finish,'function');
 await h.message('KUAI_PAGE_RESTORE');assert.equal(pageOutput(p),null);assert.equal(h.cancellations.length,0);
 finish({translations:['草稿']});assert.equal((await inputJob).ok,true);assert.equal(input.value,'草稿');
});

test('a paragraph shortcut retries a failed page entry without duplicating its result row',async t=>{
 const h=setup(),p=h.paragraph('Retry source');h.settings.hoverEnabled=true;t.after(()=>h.runtime.stop());h.respond(async()=>{throw Error('Service unavailable');});await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();assert.equal((await h.message('KUAI_PAGE_STATUS')).value.errors,1);
 h.respond(async texts=>({translations:texts.map(()=> 'Recovered result')}));await paragraphTap(h,p);
 assert.equal(pageOutput(p)?.textContent,'Recovered result');assert.equal(p.querySelectorAll('[data-kuai-page-translation]').length,1);assert.equal(h.requests.length,2);assert.equal((await h.message('KUAI_PAGE_STATUS')).value.errors,0);
});

test('a page pass shares its asynchronous language claim with pointer translation',async t=>{
 const h=setup(),p=h.paragraph('Shared preparation'),detections=[];h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'hover',delay:50};h.settings.pageOptions={neverLanguages:['fr']};
 h.env.chrome.i18n={detectLanguage:()=>new Promise(resolve=>detections.push(resolve))};t.after(()=>h.runtime.stop());await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();assert.equal(detections.length,1);
 h.emit(p,'mousemove');h.advance(50);await settle();assert.equal(detections.length,1);assert.equal(h.requests.length,0);assert.equal((await h.message('KUAI_PAGE_STATUS')).value.total,1);
 detections[0]({isReliable:true,languages:[{language:'en',percentage:99}]});await settle();assert.equal(h.requests.length,1);assert.equal(p.querySelectorAll('[data-kuai-page-translation]').length,1);
});

test('restoring a preparing page releases its claim and its late filter cannot clear a new paragraph result',async t=>{
 const h=setup(),p=h.paragraph('Released preparation'),detections=[];h.settings.hoverEnabled=true;h.settings.pageOptions={neverLanguages:['fr']};
 h.env.chrome.i18n={detectLanguage:()=>new Promise(resolve=>detections.push(resolve))};t.after(()=>h.runtime.stop());await h.runtime.start();await h.message('KUAI_PAGE_TRANSLATE');await settle();await h.message('KUAI_PAGE_RESTORE');
 await paragraphTap(h,p);detections[1]({isReliable:true,languages:[{language:'en',percentage:99}]});await settle();const output=pageOutput(p);assert.ok(output);
 detections[0]({isReliable:true,languages:[{language:'en',percentage:99}]});await settle();assert.strictEqual(pageOutput(p),output);assert.equal(h.requests.length,1);
});

test('runtime exposes pending paragraph status and full-page restore prevents its late completion',async t=>{
 const h=setup(),p=h.paragraph('Pending paragraph');h.settings.hoverEnabled=true;let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));t.after(()=>h.runtime.stop());await h.runtime.start();await paragraphTap(h,p);
 const status=(await h.message('KUAI_PAGE_STATUS')).value;assert.equal(status.active,true);assert.equal(status.total,1);assert.equal(status.translated,0);
 const restored=await h.message('KUAI_PAGE_RESTORE');assert.equal(restored.value.total,0);assert.equal(restored.value.active,false);assert.deepEqual(h.cancellations,['request-1']);
 finish({translations:['Late']});await settle();assert.equal(pageOutput(p),null);
});

test('full-page restore also releases a paragraph shortcut that has not reached keyup',async t=>{
 const h=setup(),p=h.paragraph('Restore while armed');h.settings.hoverEnabled=true;t.after(()=>h.runtime.stop());await h.runtime.start();
 h.emit(p,'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});await h.message('KUAI_PAGE_RESTORE');h.emit(h.doc,'keyup',{key:'Shift'});await settle();
 assert.equal(h.requests.length,0);assert.equal(pageOutput(p),null);
});
