import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, Event } from './helpers/content-dom.cjs';
import { createInteractions } from '../src/content/interactions.js';

const settle=async()=>{for(let index=0;index<8;index++)await Promise.resolve();};

test('selected text produces a visible plain-text translation and context-menu text survives a collapsed selection',async()=>{
 const h=fixture(),p=h.paragraph('Hello');h.select(p);h.respond(async()=>({translations:['<b>你好</b>']}));const ui=createInteractions(h.dependencies).start();await ui.translateSelection();assert.equal(ui.getState().translation,'<b>你好</b>');const output=h.doc.getElementById('kuai-translation-popup').shadowRoot.querySelector('[data-translation]');assert.equal(output.textContent,'<b>你好</b>');assert.equal(output.children.length,0);
 h.doc.selection=null;await ui.translateSelection({text:'Context selection'});assert.deepEqual(h.requests.at(-1).texts,['Context selection']);ui.stop();
});

test('a later selection cancels the old request and stale results cannot replace the popup',async()=>{
 const h=fixture(),p=h.paragraph('First');h.select(p);const finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));const ui=createInteractions(h.dependencies).start();const first=ui.translateSelection();h.select(p,'Second');const second=ui.translateSelection();finishes[1]({translations:['第二']});await second;finishes[0]({translations:['第一']});await first;assert.equal(ui.getState().translation,'第二');assert.deepEqual(h.cancellations,['request-1']);ui.stop();
});

test('navigation or a provider switch invalidates an in-flight popup result',async()=>{
 for(const change of ['route','provider']){const h=fixture(),p=h.paragraph('Hello');h.select(p);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const pending=ui.translateSelection();if(change==='route')h.env.location.href='https://example.org/next';else h.settings.activeProviderId='google';finish({translations:['Old']});await pending;assert.equal(ui.getState().translation,'');assert.equal(h.doc.getElementById('kuai-translation-popup'),null);ui.stop();}
});

test('automatic selection translation respects disabled settings, editable areas and its own popup',async()=>{
 const h=fixture(),p=h.paragraph('Hello');h.select(p);h.settings.selectionEnabled=false;const ui=createInteractions(h.dependencies).start();h.emit(p,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,0);
 h.settings.selectionEnabled=true;const input=h.paragraph('Draft','textarea');h.select(input);h.emit(input,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,0);
 await ui.translateSelection({text:'Manual'});const output=h.doc.getElementById('kuai-translation-popup').shadowRoot.querySelector('[data-translation]');h.select(output);h.emit(output,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,1);ui.stop();
});

test('a shadow-local subtitle selection remains available for translation',async()=>{
 const h=fixture(),host=h.paragraph('','div');host.id='kuai-captions-window-one';host.setAttribute('data-kuai-owned','');const shadow=host.attachShadow();const text=h.doc.createElement('span');text.textContent='Caption';shadow.append(text);shadow.getSelection=()=>({isCollapsed:false,rangeCount:1,anchorNode:text.firstChild,toString:()=>text.textContent,getRangeAt:()=>({getBoundingClientRect:()=>text.getBoundingClientRect()})});h.doc.selection=null;
 const ui=createInteractions(h.dependencies).start();await ui.translateSelection();assert.deepEqual(h.requests[0].texts,['Caption']);ui.stop();
});

test('explicit input translation replaces only the selected text and emits the normal edit events',async()=>{
 const h=fixture(),input=h.paragraph('','textarea');input.value='Keep hello tail';input.setSelectionRange(5,10);input.focus();h.respond(async()=>({translations:['你好']}));const events=[];input.addEventListener('beforeinput',event=>events.push(event.type));input.addEventListener('input',event=>events.push(event.type));const ui=createInteractions(h.dependencies).start();const result=await ui.translateInput();assert.deepEqual(h.requests[0].texts,['hello']);assert.equal(input.value,'Keep 你好 tail');assert.equal(result.applied,true);assert.deepEqual(events,['beforeinput','input']);ui.stop();
});

test('typing or moving the caret while input translation runs preserves the current field and shows the result for copying',async()=>{
 for(const change of ['typing','caret']){const h=fixture(),input=h.paragraph('','textarea');input.value='hello';input.setSelectionRange(0,5);input.focus();let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const pending=ui.translateInput();if(change==='typing')input.value='new draft';else input.setSelectionRange(2,2);finish({translations:['你好']});const result=await pending;assert.equal(result.applied,false);assert.equal(input.value,change==='typing'?'new draft':'hello');assert.equal(ui.getState().translation,'你好');ui.stop();}
});

test('password fields and cancelled beforeinput never get overwritten',async()=>{
 const h=fixture(),input=h.paragraph('','input');input.value='private';input.type='password';input.focus();const ui=createInteractions(h.dependencies).start();await assert.rejects(ui.translateInput(),/输入|input/i);assert.equal(h.requests.length,0);
 input.type='text';input.addEventListener('beforeinput',event=>event.preventDefault());const result=await ui.translateInput();assert.equal(result.applied,false);assert.equal(input.value,'private');ui.stop();
});

test('empty responses produce a visible error without changing the selected input',async()=>{
 const h=fixture(),input=h.paragraph('','textarea');input.value='hello';input.focus();h.respond(async()=>({translations:['']}));const ui=createInteractions(h.dependencies).start();await assert.rejects(ui.translateInput(),/空译文|无效/);assert.equal(input.value,'hello');assert.equal(ui.getState().status,'error');assert.equal(h.doc.getElementById('kuai-translation-popup'),null);assert.ok(h.doc.getElementById('kuai-input-trigger').shadowRoot.querySelector('[data-retry]'));ui.stop();
});

test('paragraph shortcut remains opt-in and ignores mouse modifier flags without a key press',async()=>{
 const h=fixture(),p=h.paragraph('Hover text'),ui=createInteractions(h.dependencies).start();
 h.emit(p,'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});h.flushTimers();await settle();assert.equal(h.requests.length,0);
 h.settings.hoverEnabled=true;ui.updateSettings();h.emit(p,'mousemove',{shiftKey:true});h.flushTimers();await settle();assert.equal(h.requests.length,0);
 h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();assert.equal(h.requests.length,1);assert.equal(p.querySelector('[data-kuai-page-translation]').textContent,'译：Hover text');ui.stop();
});

test('stop cancels requests and removes listeners, timers and owned popup UI',async()=>{
 const h=fixture(),p=h.paragraph('Hello');h.select(p);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const pending=ui.translateSelection();ui.stop();finish({translations:['Late']});await pending;h.emit(p,'mouseup');h.flushTimers();assert.equal(h.requests.length,1);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);assert.equal(h.timerCount(),0);
});
