import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,Event} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createPageTriggers} from '../dist/src/content/page-triggers.js';
import {createInteractions} from '../dist/src/content/interactions.js';

const settle=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const output=node=>node.querySelector('[data-kuai-page-translation]');
const key=(h,type,value,flags={})=>h.emit(h.doc,type,{key:value,...flags});
async function tap(h,node){h.emit(node,'mousemove');key(h,'keydown','Alt',{altKey:true});key(h,'keyup','Alt');await settle();}
function setup(){
  const h=fixture();h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',delay:100};
  h.page=createPageTranslator(h.dependencies);h.ui=createInteractions({...h.dependencies,page:h.page}).start();
  h.stop=()=>{h.ui.stop();h.page.stop();};return h;
}

test('one Alt press starts paragraph translation on release and a second press removes it',async()=>{
  const h=setup(),p=h.paragraph('Tap once');h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});h.advance(5000);await settle();
  assert.equal(h.requests.length,0,'holding a modifier must not submit text before a possible page shortcut');
  key(h,'keyup','Alt');await settle();assert.equal(output(p)?.textContent,'译：Tap once');assert.equal(h.page.status().translated,1);
  assert.equal(h.doc.getElementById('kuai-translation-popup'),null);await tap(h,p);assert.equal(output(p),null);assert.equal(h.requests.length,1);h.stop();
});

test('key release and pointer movement do not cancel an accepted paragraph request',async()=>{
  const h=setup(),first=h.paragraph('First'),second=h.paragraph('Second');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  await tap(h,first);assert.equal(output(first)?.getAttribute('data-state'),'pending');h.emit(second,'mousemove');key(h,'keyup','Alt');
  assert.deepEqual(h.cancellations,[]);finish({translations:['Ready after release']});await settle();assert.equal(output(first).textContent,'Ready after release');h.stop();
});

test('a second key press removes pending output and cancels only its own paragraph',async()=>{
  const h=setup(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  await tap(h,first);await tap(h,second);await tap(h,first);assert.equal(output(first),null);assert.equal(output(second).getAttribute('data-state'),'pending');
  assert.deepEqual(h.cancellations,['request-1']);finishes[0]({translations:['Stale']});finishes[1]({translations:['Kept']});await settle();assert.equal(output(first),null);assert.equal(output(second).textContent,'Kept');h.stop();
});

for(const chord of ['z','x'])test('Alt+'+chord.toUpperCase()+' never activates a paragraph gesture, even after a long modifier hold',async()=>{
  const h=setup(),p=h.paragraph('Page shortcut');if(chord==='x')h.settings.pageOptions={displayModeShortcut:'Alt+X'};const triggers=createPageTriggers({document:h.doc,env:h.env,getSettings:()=>h.settings,page:h.page,changeDisplayMode:async value=>{h.settings.pageDisplayMode=value;}}).start();
  h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});h.advance(5000);await settle();assert.equal(h.requests.length,0);
  key(h,'keydown',chord,{altKey:true});key(h,'keyup',chord,{altKey:true});key(h,'keyup','Alt');await settle();
  assert.equal(h.requests.length,1);assert.equal(h.page.status().translated,1);assert.equal(output(p)?.getAttribute('data-state'),'success');
  assert.equal(h.doc.getElementById('kuai-hover-indicator'),null);
  if(chord==='x')assert.equal(h.settings.pageDisplayMode,'translation_only');
  triggers.stop();h.stop();
});

test('unrelated modifier chords do not become paragraph toggles on a later Alt release',async()=>{
  const h=setup(),p=h.paragraph('Not Alt alone');h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});key(h,'keydown','q',{altKey:true});key(h,'keyup','q',{altKey:true});key(h,'keyup','Alt');await settle();
  assert.equal(h.requests.length,0);await tap(h,p);assert.equal(output(p)?.textContent,'译：Not Alt alone');h.stop();
});

test('a held modifier arriving only through mouse flags cannot trigger a paragraph toggle',async()=>{
  const h=setup(),p=h.paragraph('Real key event required');h.emit(p,'mousemove',{altKey:true});h.advance(1000);key(h,'keyup','Alt');await settle();assert.equal(h.requests.length,0);h.stop();
});

test('custom key combinations toggle on first release and ignore repeated keydown',async()=>{
  const h=setup(),p=h.paragraph('Custom');h.settings.hoverOptions={trigger:'custom',customKeys:['Control','Q'],delay:100};h.ui.updateSettings();h.emit(p,'mousemove');
  key(h,'keydown','Control',{ctrlKey:true});key(h,'keydown','q',{ctrlKey:true});key(h,'keydown','q',{ctrlKey:true,repeat:true});assert.equal(h.requests.length,0);
  key(h,'keyup','q',{ctrlKey:true});key(h,'keyup','Control');await settle();assert.equal(output(p)?.textContent,'译：Custom');assert.equal(h.requests.length,1);h.stop();
});

for(const guard of ['editable-target','editable-focus','IME','229','selection','repeated-only','prevented','blur','hidden','Escape','pointer-selection'])test('paragraph shortcut respects '+guard+' protection',async()=>{
  const h=setup(),p=h.paragraph('Protected'),input=h.paragraph('','textarea');h.emit(p,'mousemove');
  if(guard==='editable-target')p.setAttribute('contenteditable','true');
  if(guard==='editable-focus')input.focus();
  if(guard==='selection'){h.select(p);h.settings.selectionOptions={triggerMode:'icon'};}
  const extra=guard==='IME'?{isComposing:true}:guard==='229'?{keyCode:229}:guard==='repeated-only'?{repeat:true}:guard==='prevented'?{defaultPrevented:true}:{};
  key(h,'keydown','Alt',{altKey:true,...extra});
  if(guard==='blur')h.env.dispatchEvent(new Event('blur'));
  if(guard==='hidden'){h.doc.visibilityState='hidden';h.emit(h.doc,'visibilitychange');}
  if(guard==='Escape')key(h,'keydown','Escape',{altKey:true});
  if(guard==='pointer-selection'){h.emit(p,'mousedown',{buttons:1,altKey:true});h.select(p);h.emit(h.doc,'selectionchange');}
  key(h,'keyup','Alt');h.advance(1000);await settle();assert.equal(h.requests.length,0);assert.equal(output(p),null);h.stop();
});

test('selection modifier activation keeps the paragraph controller idle',async()=>{
  const h=setup(),p=h.paragraph('Selected words');h.settings.selectionOptions={triggerMode:'alt',delay:0};h.select(p);h.emit(p,'mousemove');
  key(h,'keydown','Alt',{altKey:true});key(h,'keyup','Alt');h.flushTimers();await settle();
  assert.equal(h.requests.length,1);assert.equal(h.ui.getState().translation,'译：Selected words');assert.equal(h.page.status().total,0);h.stop();
});

test('pointer hover uses the shared registry without toggling an existing page result off',async()=>{
  const h=setup(),p=h.paragraph('Shared result');h.settings.hoverOptions={trigger:'hover',delay:50};h.ui.updateSettings();await h.page.translatePage();const originalOutput=output(p);
  h.emit(p,'mousemove');h.advance(50);await settle();assert.equal(output(p),originalOutput);assert.equal(h.requests.length,1);h.stop();
});

test('default Alt+X outside an editor does not translate the hovered paragraph',async()=>{
  const h=setup(),p=h.paragraph('Input shortcut');h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});key(h,'keydown','x',{altKey:true});key(h,'keyup','x',{altKey:true});key(h,'keyup','Alt');await settle();
  assert.equal(h.requests.length,0);assert.equal(output(p),null);h.stop();
});

test('ordinary pointer movement does not rescan every translated page paragraph',async()=>{
  const h=setup(),first=h.paragraph('First'),other=h.paragraph('Unrelated');await h.page.translatePage();
  let unrelatedReads=0;const computed=h.env.getComputedStyle;h.env.getComputedStyle=element=>{if(element===other)unrelatedReads++;return computed(element);};
  h.emit(first,'mousemove');h.emit(first,'mousemove');assert.equal(unrelatedReads,0,'a stationary page should not be rescanned on every pointer event');assert.equal(h.requests.length,1);h.stop();
});

test('an armed paragraph indicator stays visible while the pointer moves inside the same paragraph',async()=>{
  const h=setup(),p=h.paragraph('Indicated paragraph'),inline=h.doc.createElement('strong');inline.textContent=' inline';p.append(inline);h.settings.hoverOptions.showIndicator=true;
  h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});const indicator=h.doc.getElementById('kuai-hover-indicator');assert.ok(indicator);
  h.emit(inline,'mousemove',{altKey:true});assert.equal(h.doc.getElementById('kuai-hover-indicator'),indicator);assert.equal(h.requests.length,0);
  key(h,'keyup','Alt');await settle();assert.equal(h.doc.getElementById('kuai-hover-indicator'),null);assert.ok(output(p));h.stop();
});

test('paragraph chord protection preserves an editor listener vetoing its input shortcut',async()=>{
  const h=setup(),p=h.paragraph('Hovered'),input=h.paragraph('','textarea');input.value='Private editor';input.focus();h.emit(p,'mousemove');
  input.addEventListener('keydown',event=>event.preventDefault());h.emit(input,'keydown',{key:'x',altKey:true});await settle();
  assert.equal(h.requests.length,0);assert.equal(input.value,'Private editor');h.stop();
});
