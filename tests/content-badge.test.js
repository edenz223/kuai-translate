import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/content-dom.cjs';
import { createContentRuntime } from '../dist/src/content/index.js';

function setup({top}={}){
  const h=fixture(),listeners=new Set(),subscribers=new Set(),reports=[];let persisted;
  h.env.chrome={runtime:{id:'kuai-id',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
  if(top!==undefined)h.env.top=top;
  const client={getSettings:async()=>structuredClone(persisted||h.settings),translate:h.dependencies.translate,cancel:h.dependencies.cancel,makeRequestId:h.dependencies.makeRequestId,
    onSettingsChanged:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);},reportPageState:async state=>{reports.push(state);return {shown:true};}};
  const runtime=createContentRuntime({env:h.env,client,startYouTube:()=>({stop(){}})});
  const message=type=>new Promise(resolve=>{for(const listener of listeners)if(listener({type},{id:'kuai-id'},resolve)===true)return;resolve(undefined);});
  const notify=async next=>{persisted=structuredClone(next);subscribers.forEach(fn=>fn(next));await settle();};
  return {...h,runtime,message,reports,notify};
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}

test('the toolbar badge follows page translation and restore with one report per state change',async()=>{
  const h=setup();h.paragraph('Hello');h.paragraph('World');await h.runtime.start();
  assert.deepEqual(h.reports,[],'an idle fresh document needs no report');
  await h.message('KUAI_PAGE_TRANSLATE');await settle();
  assert.deepEqual(h.reports,['working','done']);
  await h.message('KUAI_PAGE_RESTORE');await settle();
  assert.deepEqual(h.reports,['working','done','idle']);h.runtime.stop();
});

test('page toggle message translates and then restores like the page shortcut',async()=>{
  const h=setup();h.paragraph('Hello');await h.runtime.start();
  assert.equal((await h.message('KUAI_PAGE_TOGGLE')).ok,true);await settle();
  assert.equal((await h.message('KUAI_PAGE_STATUS')).value.translated,1);
  await h.message('KUAI_PAGE_TOGGLE');await settle();
  assert.equal((await h.message('KUAI_PAGE_STATUS')).value.total,0);
  assert.deepEqual(h.reports,['working','done','idle']);h.runtime.stop();
});

test('a never-translate site shows a blocked badge after the rule is saved',async()=>{
  const h=setup();await h.runtime.start();
  const host=new URL(h.env.location.href).hostname;
  await h.notify({...h.settings,pageOptions:{...h.settings.pageOptions,neverSites:[host]}});
  assert.deepEqual(h.reports,['blocked']);h.runtime.stop();
});

test('subframes never report the toolbar badge',async()=>{
  const h=setup({top:{}});h.paragraph('Hello');await h.runtime.start();
  await h.message('KUAI_PAGE_TRANSLATE');await settle();
  assert.deepEqual(h.reports,[]);h.runtime.stop();
});
