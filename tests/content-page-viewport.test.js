import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../src/content/page-translator.js';
import {createPageTriggers} from '../src/content/page-triggers.js';
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const rect=(top,left=10)=>({top,bottom:top+30,left,right:left+390,width:390,height:30});
function setup(t){
 const h=fixture(),observers=[];h.env.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
 const page=createPageTranslator(h.dependencies),triggers=createPageTriggers({...h.dependencies,page}).start();
 t.after(()=>{triggers.stop();page.stop();});return {...h,page,triggers,mutate(records){observers.filter(o=>o.active).forEach(o=>o.callback(records));}};
}
const texts=h=>h.requests.flatMap(request=>request.texts);
async function scroll(h,target=h.doc){h.emit(target,'scroll');h.flushTimers();await settle();}

test('page and paragraph translation create no floating progress toolbar',async t=>{
 const h=setup(t),p=h.paragraph('First');await h.triggers.translate();assert.equal(h.doc.querySelector('[data-kuai-ui]'),null);
 h.page.restore();await h.page.translateBlocks([{element:p,text:'First'}]);assert.equal(h.doc.querySelector('[data-kuai-ui]'),null);
 h.page.reportError(Error('Offline'));assert.equal(h.doc.querySelector('[data-kuai-ui]'),null);
});
test('scroll translates newly visible blocks once and leaves offscreen text unsent',async t=>{
 const h=setup(t),first=h.paragraph('First'),next=h.paragraph('Next'),later=h.paragraph('Later');first._rect=rect(20);next._rect=rect(1200);later._rect=rect(2400);
 await h.triggers.translate();assert.deepEqual(texts(h),['First']);
 first._rect=rect(-1000);next._rect=rect(100);await scroll(h);assert.deepEqual(texts(h),['First','Next']);
 await scroll(h);assert.deepEqual(texts(h),['First','Next']);assert.equal(later.querySelector('[data-kuai-page-translation]'),null);
});
test('scroll does not opt an untouched page into translation',async t=>{
 const h=setup(t);h.paragraph('First');await scroll(h);assert.equal(h.requests.length,0);
});
for(const action of ['restore','cancel','stop','routeChanged'])test(action+' prevents queued scroll work',async t=>{
 const h=setup(t),p=h.paragraph('First'),next=h.paragraph('Next');next._rect=rect(1200);await h.triggers.translate();
 next._rect=rect(20);h.emit(h.doc,'scroll');h.triggers[action]();h.flushTimers();await settle();assert.deepEqual(texts(h),['First']);
});
test('scroll during a request waits and then translates the latest viewport once',async t=>{
 const h=setup(t),next=h.paragraph('Next'),first=h.paragraph('First');next._rect=rect(1200);let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const initial=h.triggers.translate();await settle();
 next._rect=rect(20);await scroll(h);await scroll(h);assert.equal(h.requests.length,1);
 h.respond(async values=>({translations:values.map(value=>'Translated '+value)}));finish({translations:['Translated First']});await initial;h.flushTimers();await settle();
 assert.deepEqual(texts(h),['First','Next']);
});
test('empty initial viewport still allows translation after scrolling',async t=>{
 const h=setup(t),next=h.paragraph('Next');next._rect=rect(1200);await h.triggers.translate();assert.equal(h.requests.length,0);
 next._rect=rect(20);await scroll(h);assert.deepEqual(texts(h),['Next']);
});
test('newly appended visible blocks translate after opt-in without sending appended offscreen text',async t=>{
 const h=setup(t);h.paragraph('First');await h.triggers.translate();const visible=h.paragraph('Visible addition'),below=h.paragraph('Offscreen addition');below._rect=rect(2000);
 h.mutate([{type:'childList',target:h.doc.body,addedNodes:[visible,below],removedNodes:[]}]);h.flushTimers();await settle();assert.deepEqual(texts(h),['First','Visible addition']);
});
test('hidden pages defer scrolling work until visible again',async t=>{
 const h=setup(t),first=h.paragraph('First'),next=h.paragraph('Next');next._rect=rect(1500);await h.triggers.translate();next._rect=rect(20);
 h.doc.visibilityState='hidden';h.emit(h.doc,'visibilitychange');await scroll(h);assert.deepEqual(texts(h),['First']);
 h.doc.visibilityState='visible';h.emit(h.doc,'visibilitychange');h.flushTimers();await settle();assert.deepEqual(texts(h),['First','Next']);
});
test('scroll does not retry failed blocks automatically',async t=>{
 const h=setup(t);h.paragraph('First');h.respond(async()=>{throw Error('Offline');});await h.triggers.translate();await scroll(h);assert.equal(h.requests.length,1);
});
test('nested scroll containers translate only the unclipped visible portion',async t=>{
 const h=setup(t),container=h.paragraph('','div'),inside=h.doc.createElement('p'),clipped=h.doc.createElement('p');inside.textContent='Inside';clipped.textContent='Clipped';container.append(inside,clipped);
 container._rect={top:100,bottom:300,left:10,right:410,width:400,height:200};inside._rect=rect(120);clipped._rect=rect(400);
 const computed=h.env.getComputedStyle;h.env.getComputedStyle=element=>({...computed(element),overflowY:element===container?'auto':'visible'});
 await h.triggers.translate();assert.deepEqual(texts(h),['Inside']);clipped._rect=rect(200);await scroll(h,container);assert.deepEqual(texts(h),['Inside','Clipped']);
});


test('scroll and dynamic content share one request queue instead of overlapping',async t=>{
 const h=setup(t);h.settings.pageOptions={translateDynamic:true};h.paragraph('First');await h.triggers.translate();
 const next=h.paragraph('Next');next._rect=rect(20);h.emit(h.doc,'scroll');
 h.mutate([{type:'childList',target:h.doc.body,addedNodes:[next],removedNodes:[]}]);let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));h.advance(120);await settle();assert.equal(h.requests.length,2);
 const later=h.paragraph('Later');h.mutate([{type:'childList',target:h.doc.body,addedNodes:[later],removedNodes:[]}]);
 h.advance(250);await settle();assert.equal(h.requests.length,2,'new visible content waits for the pending viewport request');
 h.respond(async values=>({translations:values.map(value=>'Translated '+value)}));finish({translations:['Translated Next']});await settle();h.flushTimers();await settle();
 assert.deepEqual(texts(h),['First','Next','Later']);
});


test('scrolling away drops unsent old-screen batches before requesting the current screen',async t=>{
 const h=setup(t),old=Array.from({length:9},(_,i)=>h.paragraph('Old '+i)),next=h.paragraph('Current screen');next._rect=rect(2000);let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const initial=h.triggers.translate();await settle();assert.equal(h.requests[0].texts.length,8);
 old.forEach(node=>{node._rect=rect(-100);});next._rect=rect(20);await scroll(h);
 h.respond(async values=>({translations:values.map(value=>'Translated '+value)}));finish({translations:Array(8).fill('Translated')});await initial;h.flushTimers();await settle();
 assert.deepEqual(texts(h),[...old.slice(0,8).map((_,i)=>'Old '+i),'Current screen']);assert.equal(old[8].querySelector('[data-kuai-page-translation]'),null);
});


test('explicit paragraph translation can still translate a requested offscreen block',async t=>{
 const h=setup(t),paragraph=h.paragraph('Requested paragraph');paragraph._rect=rect(2000);
 await h.page.translateBlocks([{element:paragraph,text:'Requested paragraph'}]);assert.deepEqual(texts(h),['Requested paragraph']);
});
