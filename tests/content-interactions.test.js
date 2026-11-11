import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,Event} from './helpers/content-dom.cjs';
import {createInteractions} from '../dist/src/content/interactions.js';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {blockText,collectBlocks} from '../dist/src/content/dom.js';

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

test('explicit input translation replaces only the selected text and emits the normal edit events',async()=>{
 const h=fixture(),input=h.paragraph('','textarea');input.value='Keep hello tail';input.setSelectionRange(5,10);input.focus();h.respond(async()=>({translations:['你好']}));const events=[];input.addEventListener('beforeinput',event=>events.push(event.type));input.addEventListener('input',event=>events.push(event.type));const ui=createInteractions(h.dependencies).start();const result=await ui.translateInput();assert.deepEqual(h.requests[0].texts,['hello']);assert.equal(input.value,'Keep 你好 tail');assert.equal(result.applied,true);assert.deepEqual(events,['beforeinput','input']);ui.stop();
});

test('password fields and cancelled beforeinput never get overwritten',async()=>{
 const h=fixture(),input=h.paragraph('','input');input.value='private';input.type='password';input.focus();const ui=createInteractions(h.dependencies).start();await assert.rejects(ui.translateInput(),/输入|input/i);assert.equal(h.requests.length,0);
 input.type='text';input.addEventListener('beforeinput',event=>event.preventDefault());const result=await ui.translateInput();assert.equal(result.applied,false);assert.equal(input.value,'private');ui.stop();
});

test('empty responses produce a visible error without changing the selected input',async()=>{
 const h=fixture(),input=h.paragraph('','textarea');input.value='hello';input.focus();h.respond(async()=>({translations:['']}));const ui=createInteractions(h.dependencies).start();await assert.rejects(ui.translateInput(),/空译文|无效/);assert.equal(input.value,'hello');assert.equal(ui.getState().status,'error');assert.equal(h.doc.getElementById('kuai-translation-popup'),null);assert.ok(h.doc.getElementById('kuai-input-trigger').shadowRoot.querySelector('[data-retry]'));ui.stop();
});

test('stop cancels requests and removes listeners, timers and owned popup UI',async()=>{
 const h=fixture(),p=h.paragraph('Hello');h.select(p);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const pending=ui.translateSelection();ui.stop();finish({translations:['Late']});await pending;h.emit(p,'mouseup');h.flushTimers();assert.equal(h.requests.length,1);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);assert.equal(h.timerCount(),0);
});

const settleTriggers=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const button=(h,name)=>h.doc.getElementById(name)?.shadowRoot?.querySelector('button');
function keyboard(h,type,key,flags={}){return h.emit(h.doc,type,{key,...flags});}

test('a real left mouse release translates once and reselecting after dismissal translates again',async()=>{
 const h=fixture(),p=h.paragraph('Actual mouse selection');h.select(p);const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mouseup',{button:0});h.flushTimers();await settleTriggers();assert.equal(h.requests.length,1);
 h.emit(p,'mouseup',{button:0});h.flushTimers();await settleTriggers();assert.equal(h.requests.length,1);
 ui.cancelCurrent();h.emit(p,'mouseup',{button:0});h.flushTimers();await settleTriggers();assert.equal(h.requests.length,2);ui.stop();
});

for(const mode of ['icon','dot'])test(`${mode} selection preserves the range and waits for explicit activation`,async()=>{
 const h=fixture(),p=h.paragraph('Choose me');h.settings.selectionOptions={triggerMode:mode,triggerAction:'click'};h.select(p);
 const selected=h.doc.selection,ui=createInteractions(h.dependencies).start();h.emit(p,'mouseup',{button:0});h.flushTimers();await settleTriggers();assert.equal(h.requests.length,0);
 const activate=button(h,'kuai-selection-trigger');assert.ok(activate);const down=h.emit(activate,'pointerdown',{button:0});assert.equal(down.defaultPrevented,true);assert.strictEqual(h.doc.selection,selected);
 h.emit(activate,'click');await settleTriggers();assert.equal(h.requests.length,1);assert.strictEqual(h.doc.selection,selected);ui.stop();
});

test('a selection modifier can be pressed after selection and repeated keydown is ignored',async()=>{
 const h=fixture(),p=h.paragraph('Control selection');h.settings.selectionOptions={triggerMode:'ctrl',delay:50};h.select(p);const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mouseup');h.flushTimers();await settleTriggers();assert.equal(h.requests.length,0);
 keyboard(h,'keydown','Control',{ctrlKey:true});keyboard(h,'keydown','Control',{ctrlKey:true,repeat:true});h.advance(50);await settleTriggers();assert.equal(h.requests.length,1);ui.stop();
});

for(const [trigger,key,flag] of [['ctrl','Control','ctrlKey'],['shift','Shift','shiftKey'],['alt','Alt','altKey']])test(`${trigger} paragraph shortcut toggles after release under a stationary pointer`,async()=>{
 const h=fixture(),p=h.paragraph('Stationary');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger,delay:100};const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mousemove');keyboard(h,'keydown',key,{[flag]:true});h.advance(100);await settleTriggers();assert.equal(h.requests.length,0);keyboard(h,'keyup',key);await settleTriggers();assert.deepEqual(h.requests.map(r=>r.texts),[['Stationary']]);ui.stop();
});

test('left hold waits for hold and hover delays and never fights drag selection',async()=>{
 const h=fixture(),p=h.paragraph('Left hold');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'left_hold',holdDelay:300,delay:100};const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mousedown',{buttons:1});h.advance(399);await settleTriggers();assert.equal(h.requests.length,0);h.advance(1);await settleTriggers();assert.equal(h.requests.length,1);
 h.emit(p,'mouseup');ui.cancelCurrent();h.emit(p,'mousedown',{buttons:1});h.select(p);h.emit(h.doc,'selectionchange');h.advance(1000);await settleTriggers();assert.equal(h.requests.length,1);ui.stop();
});

test('selection limits and disabled sites prevent requests while independent services are honored',async()=>{
 const h=fixture(),p=h.paragraph('Hello');h.settings.selectionOptions={providerId:'google',sourceLanguage:'en',targetLanguage:'de',maxLength:4};const ui=createInteractions(h.dependencies).start();h.select(p);h.emit(p,'mouseup');h.flushTimers();await settleTriggers();assert.equal(h.requests.length,0);
 h.settings.selectionOptions.maxLength=100;h.settings.selectionOptions.disabledSites=['example.org'];ui.updateSettings();h.emit(p,'mouseup');h.flushTimers();await settleTriggers();assert.equal(h.requests.length,0);
 h.settings.selectionOptions.disabledSites=[];ui.updateSettings();h.emit(p,'mouseup');h.flushTimers();await settleTriggers();assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].options,{requestId:'request-1',providerId:'google',sourceLanguage:'en',targetLanguage:'de'});ui.stop();
});

test('direct hover reads one paragraph without requiring a key',async()=>{
 const h=fixture(),p=h.paragraph('Direct hover');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'hover',delay:50};const ui=createInteractions(h.dependencies).start();h.emit(p,'mousemove');h.advance(50);await settleTriggers();assert.deepEqual(h.requests.map(item=>item.texts),[['Direct hover']]);ui.stop();
});

test('hover resolves a docs paragraph rendered as span[data-as=p] instead of its whole article',async()=>{
 const h=fixture(),article=h.paragraph('','div'),spans=['First paragraph','Second paragraph'].map(text=>{const span=h.doc.createElement('span');span.setAttribute('data-as','p');span.textContent=text;article.append(span);return span;});
 h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'hover',delay:50};const ui=createInteractions(h.dependencies).start();h.emit(spans[1],'mousemove');h.advance(50);await settleTriggers();assert.deepEqual(h.requests.map(item=>item.texts),[['Second paragraph']]);ui.stop();
});

test('area hover reads each descendant block once and applies page language and selector exclusions',async()=>{
 const h=fixture(),area=h.paragraph('Heading ','section'),first=h.doc.createElement('p'),blocked=h.doc.createElement('p'),excluded=h.doc.createElement('p'),last=h.doc.createElement('p');
 first.textContent='First';blocked.textContent='Bonjour';blocked.setAttribute('lang','fr');excluded.textContent='Private region';excluded.className='skip';last.textContent='Last';area.append(first,blocked,excluded,last);
 h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',mode:'area',displayMode:'popup',delay:50};h.settings.pageOptions={neverLanguages:['fr'],excludeSelectors:['.skip']};
 const ui=createInteractions(h.dependencies).start();h.emit(first,'mousemove');keyboard(h,'keydown','Alt',{altKey:true});keyboard(h,'keyup','Alt');h.advance(50);await settleTriggers();assert.deepEqual(h.requests.map(item=>item.texts),[['Heading','First','Last']]);ui.stop();
});

const settleShortcut=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const output=node=>node.querySelector('[data-kuai-page-translation]');
const key=(h,type,value,flags={})=>h.emit(h.doc,type,{key:value,...flags});
async function tap(h,node){h.emit(node,'mousemove');key(h,'keydown','Alt',{altKey:true});key(h,'keyup','Alt');await settleShortcut();}
function setup(){
  const h=fixture();h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',delay:100};
  h.page=createPageTranslator(h.dependencies);h.ui=createInteractions({...h.dependencies,page:h.page}).start();
  h.stop=()=>{h.ui.stop();h.page.stop();};return h;
}

test('one Alt press starts paragraph translation on release and a second press removes it',async()=>{
  const h=setup(),p=h.paragraph('Tap once');h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});h.advance(5000);await settleShortcut();
  assert.equal(h.requests.length,0,'holding a modifier must not submit text before a possible page shortcut');
  key(h,'keyup','Alt');await settleShortcut();assert.equal(output(p)?.textContent,'译：Tap once');assert.equal(h.page.status().translated,1);
  assert.equal(h.doc.getElementById('kuai-translation-popup'),null);await tap(h,p);assert.equal(output(p),null);assert.equal(h.requests.length,1);h.stop();
});

test('key release and pointer movement do not cancel an accepted paragraph request',async()=>{
  const h=setup(),first=h.paragraph('First'),second=h.paragraph('Second');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  await tap(h,first);assert.equal(output(first)?.getAttribute('data-state'),'pending');h.emit(second,'mousemove');key(h,'keyup','Alt');
  assert.deepEqual(h.cancellations,[]);finish({translations:['Ready after release']});await settleShortcut();assert.equal(output(first).textContent,'Ready after release');h.stop();
});

test('a second key press removes pending output and cancels only its own paragraph',async()=>{
  const h=setup(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  await tap(h,first);await tap(h,second);await tap(h,first);assert.equal(output(first),null);assert.equal(output(second).getAttribute('data-state'),'pending');
  assert.deepEqual(h.cancellations,['request-1']);finishes[0]({translations:['Stale']});finishes[1]({translations:['Kept']});await settleShortcut();assert.equal(output(first),null);assert.equal(output(second).textContent,'Kept');h.stop();
});

test('custom key combinations toggle on first release and ignore repeated keydown',async()=>{
  const h=setup(),p=h.paragraph('Custom');h.settings.hoverOptions={trigger:'custom',customKeys:['Control','Q'],delay:100};h.ui.updateSettings();h.emit(p,'mousemove');
  key(h,'keydown','Control',{ctrlKey:true});key(h,'keydown','q',{ctrlKey:true});key(h,'keydown','q',{ctrlKey:true,repeat:true});assert.equal(h.requests.length,0);
  key(h,'keyup','q',{ctrlKey:true});key(h,'keyup','Control');await settleShortcut();assert.equal(output(p)?.textContent,'译：Custom');assert.equal(h.requests.length,1);h.stop();
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
  key(h,'keyup','Alt');h.advance(1000);await settleShortcut();assert.equal(h.requests.length,0);assert.equal(output(p),null);h.stop();
});

test('default Alt+X outside an editor does not translate the hovered paragraph',async()=>{
  const h=setup(),p=h.paragraph('Input shortcut');h.emit(p,'mousemove');key(h,'keydown','Alt',{altKey:true});key(h,'keydown','x',{altKey:true});key(h,'keyup','x',{altKey:true});key(h,'keyup','Alt');await settleShortcut();
  assert.equal(h.requests.length,0);assert.equal(output(p),null);h.stop();
});

const settleInline=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
const outputs=h=>h.doc.querySelectorAll('[data-kuai-page-translation]');
const result=element=>element.querySelector('[data-kuai-page-translation]');
const text=element=>result(element)?.querySelector('font')?.firstChild?.textContent;
const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';
const release=h=>h.emit(h.doc,'keyup',{key:'Alt'});
function setupInline(overrides={}){
  const h=fixture();h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',displayMode:'inline',delay:50,...overrides};
  return h;
}
async function hover(h,element,flags={altKey:true}){h.emit(element,'mousemove',flags);if(h.settings.hoverOptions.trigger==='alt'){h.emit(h.doc,'keydown',{key:'Alt',altKey:true});h.emit(h.doc,'keyup',{key:'Alt'});}h.advance(50);await settleInline();}

test('paragraph output uses the page style, translation-only mode and safe plain text',async()=>{
  const h=setupInline(),p=h.paragraph('Hello '),link=h.doc.createElement('a');link.textContent='world';p.append(link);
  const original=p.firstChild;let clicks=0;link.addEventListener('click',()=>clicks++);
  h.settings.pageDisplayMode='translation_only';h.settings.pageStyle={preset:'border',fontSize:125,textColor:'#123456'};
  h.respond(async()=>({translations:['<img src=x onerror=alert(1)>你好']}));
  const ui=createInteractions(h.dependencies).start();await hover(h,link);
  const output=result(p);assert.ok(output,'the translation must appear inside the source paragraph');
  assert.equal(output.tagName,'KUAI-TRANSLATOR');assert.equal(p.childNodes.at(-1),output);assert.equal(output.className,'kuai-translator-wrapper notranslate');
  assert.equal(output.firstChild.tagName,'FONT');assert.equal(output.querySelector('font').getAttribute('lang'),'zh-Hans');
  assert.equal(output.querySelector('font').firstChild.nodeType,3);assert.equal(text(p),'<img src=x onerror=alert(1)>你好');assert.equal(output.querySelector('img'),null);
  assert.equal(output.getAttribute('data-state'),'success');assert.match(sheet(h),/font-size:125%/);assert.match(sheet(h),/color:#123456/);assert.match(sheet(h),/border-left:2px solid/);assert.equal(output.getAttribute('style'),null);
  assert.equal(original.nodeValue,'');assert.strictEqual(original.parentNode,p);assert.ok(link.hasAttribute('data-kuai-original'));assert.strictEqual(link.parentNode,p);
  h.emit(link,'click');assert.equal(clicks,1);assert.equal(blockText(p,h.env),'Hello world');
  assert.deepEqual(collectBlocks(h.doc,h.env).map(item=>item.text),['Hello world']);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);
  await hover(h,p);assert.equal(result(p),null);assert.equal(p.firstChild,original);assert.equal(link.parentNode,p);ui.stop();
});

test('area hover translates eligible source units in order into their own paragraphs',async()=>{
  const h=setupInline({mode:'area'}),area=h.paragraph('','section'),first=h.doc.createElement('p'),blocked=h.doc.createElement('p'),excluded=h.doc.createElement('p'),last=h.doc.createElement('p');
  first.textContent='First';blocked.textContent='Bonjour';blocked.setAttribute('lang','fr');excluded.textContent='Private';excluded.className='skip';last.textContent='Last';area.append(first,blocked,excluded,last);
  h.settings.pageOptions={neverLanguages:['fr'],excludeSelectors:['.skip']};
  const ui=createInteractions(h.dependencies).start();await hover(h,first);
  assert.deepEqual(h.requests.map(item=>item.texts),[['First','Last']]);assert.equal(text(first),'译：First');assert.equal(text(last),'译：Last');
  assert.equal(result(blocked),null);assert.equal(result(excluded),null);assert.deepEqual(outputs(h).map(output=>output.parentNode),[first,last]);assert.equal(area.children.length,4);ui.stop();
});

test('releasing the shortcut keeps a pending paragraph request and its loading output',async()=>{
  const h=setupInline(),p=h.paragraph('Waiting');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(result(p)?.getAttribute('data-state'),'pending');assert.ok(h.doc.querySelector('[data-kuai-page-loading]'));assert.doesNotMatch(text(p)||'',/翻译中|Translating/);
  release(h);assert.equal(result(p)?.getAttribute('data-state'),'pending');assert.deepEqual(h.cancellations,[]);finish({translations:['Ready']});await settleInline();assert.equal(text(p),'Ready');ui.stop();
});

test('finished paragraph translations survive movement and release, then toggle off on another key press',async()=>{
  const h=setupInline(),first=h.paragraph('First'),second=h.paragraph('Second');const ui=createInteractions(h.dependencies).start();
  await hover(h,first);const firstOutput=result(first);assert.ok(firstOutput);release(h);assert.equal(result(first),firstOutput);
  await hover(h,second);release(h);assert.equal(text(first),'译：First');assert.equal(text(second),'译：Second');
  await hover(h,first);assert.equal(result(first),null);assert.equal(outputs(h).length,1);assert.equal(text(second),'译：Second');assert.equal(h.requests.length,2);ui.stop();
});

test('pointer area translation reuses a real page entry and only sends the missing paragraph',async()=>{
  const h=setupInline({mode:'area',trigger:'hover'}),area=h.paragraph('','section'),first=h.doc.createElement('p'),last=h.doc.createElement('p');first.textContent='First';last.textContent='Last';area.append(first,last);
  const page=createPageTranslator(h.dependencies);await page.translateBlocks([{element:first,text:'First'}]);const existing=result(first);
  const ui=createInteractions({...h.dependencies,page}).start();await hover(h,first);assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Last']]);assert.equal(result(first),existing);assert.equal(text(last),'译：Last');ui.stop();page.stop();
});

for(const cause of ['changed-source','removed-source','route','provider','disabled','policy'])test('pending inline work cannot render after '+cause,async()=>{
  const h=setupInline(),p=h.paragraph('Pending original');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(outputs(h).length,1);
  if(cause==='changed-source')p.firstChild.nodeValue='New original';
  if(cause==='removed-source')p.remove();
  if(cause==='route')h.env.location.href='https://example.org/next';
  if(cause==='provider')h.settings.activeProviderId='google';
  if(cause==='disabled')h.settings.hoverEnabled=false;
  if(cause==='policy')h.settings.pageOptions={neverSites:['example.org']};
  if(['route','provider','disabled','policy'].includes(cause))ui.updateSettings();
  finish({translations:['Stale result']});await settleInline();assert.equal(result(p),null);assert.equal(outputs(h).length,0);ui.stop();
});

test('provider failures remain visible as safe inline text and a fresh hover can retry',async()=>{
  const h=setupInline(),p=h.paragraph('Retry source');h.respond(async()=>{throw Error('<script>provider failed</script>');});h.settings.pageStyle={preset:'blur',opacity:5};
  const ui=createInteractions(h.dependencies).start();await hover(h,p);const output=result(p);assert.ok(output);assert.equal(output.getAttribute('data-state'),'error');assert.equal(output.getAttribute('role'),'status');
  assert.equal(text(p),'<script>provider failed</script>');assert.equal(output.querySelector('script'),null);assert.doesNotMatch(sheet(h),/filter:blur/);assert.match(sheet(h),/opacity:1!important/);assert.ok(output.querySelector('button').textContent);
  release(h);h.respond(async()=>({translations:['Recovered']}));await hover(h,p);assert.equal(text(p),'Recovered');assert.equal(outputs(h).length,1);assert.equal(h.requests.length,2);ui.stop();
});

test('closing a pending paragraph aborts its request without touching other completed results',async()=>{
  const h=setupInline(),first=h.paragraph('Finished'),last=h.paragraph('Pending'),ui=createInteractions(h.dependencies).start();await hover(h,first);release(h);
  let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await hover(h,last);await hover(h,last);assert.equal(result(last),null);assert.equal(text(first),'译：Finished');assert.deepEqual(h.cancellations,['request-2']);
  finish({translations:['Closed']});await settleInline();assert.equal(result(last),null);ui.stop();
});

test('clear and stop cancel pending hover work, remove all inline output and leave original nodes',async()=>{
  for(const action of ['clearInlineTranslations','stop']){
    const h=setupInline(),first=h.paragraph('Finished'),pending=h.paragraph('Pending'),ui=createInteractions(h.dependencies).start();await hover(h,first);release(h);
    let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await hover(h,pending);assert.equal(outputs(h).length,2);ui[action]();assert.equal(outputs(h).length,0);assert.deepEqual(h.cancellations,['request-2']);
    finish({translations:['Late']});await settleInline();assert.equal(outputs(h).length,0);assert.equal(first.textContent,'Finished');assert.equal(pending.textContent,'Pending');ui.stop();assert.equal(h.timerCount(),0);
  }
});

test('hovering an inline output never sends the original or generated translation again',async()=>{
  const h=setupInline({trigger:'hover'}),p=h.paragraph('Readable source'),ui=createInteractions(h.dependencies).start();await hover(h,p);await hover(h,result(p));assert.equal(h.requests.length,1);assert.equal(text(p),'译：Readable source');ui.stop();
});

const popup=h=>h.doc.getElementById('kuai-translation-popup');
const action=(h,name)=>popup(h)?.shadowRoot.querySelector(`[data-${name}]`);
const feedback=(h,name)=>h.doc.getElementById('kuai-input-trigger')?.shadowRoot.querySelector(`[data-${name}]`);
const settleLifetime=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function setupLifetime(){const h=fixture(),p=h.paragraph('Selected words');h.select(p);h.settings.inputOptions={icon:'dot'};return {...h,p,ui:createInteractions(h.dependencies).start()};}
function input(h){const node=h.paragraph('','textarea');node.value='hello';node.setSelectionRange(0,5);node.focus();h.emit(node,'focusin');return node;}
function deselect(h){h.doc.selection=null;h.emit(h.doc,'selectionchange');}
for(const pending of [true,false])test(`unpinned ${pending?'pending':'completed'} selection closes on deselection and ignores late output`,async()=>{
 const h=setupLifetime();let finish;h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateSelection();if(!pending){finish({translations:['Done']});await task;}deselect(h);assert.equal(!!popup(h),false);if(pending){assert.deepEqual(h.cancellations,['request-1']);finish({translations:['Late']});assert.deepEqual(await task,{cancelled:true});}assert.equal(!!popup(h),false);h.ui.stop();
});
test('pin survives deselection and replacement, keeps viewport position, and unpin without source closes',async()=>{
 const h=setupLifetime();await h.ui.translateSelection();const pin=action(h,'pin');assert.ok(pin);assert.ok(pin.querySelector('svg'));assert.notEqual(pin.textContent,'上面');assert.equal(pin.getAttribute('aria-pressed'),'false');h.emit(pin,'click');assert.equal(pin.getAttribute('aria-pressed'),'true');const host=popup(h),position=[host.style.left,host.style.top];deselect(h);assert.equal(popup(h),host);h.p._rect={left:600,bottom:300};h.select(h.p,'Next');await h.ui.translateSelection();assert.equal(popup(h),host);assert.deepEqual([host.style.left,host.style.top],position);deselect(h);h.emit(pin,'click');assert.equal(!!popup(h),false);h.ui.stop();
});
test('input and pending pinned selection own independent requests and result UI',async()=>{
 const h=setupLifetime(),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));const selection=h.ui.translateSelection();h.emit(action(h,'pin'),'click');const host=popup(h),field=input(h),task=h.ui.translateInput();deselect(h);assert.equal(popup(h),host);assert.deepEqual(h.cancellations,[]);finishes[1]({translations:['你好']});assert.equal((await task).applied,true);assert.equal(field.value,'你好');finishes[0]({translations:['Selected']});await selection;assert.equal(action(h,'translation').textContent,'Selected');h.ui.stop();
});
test('quiet input loading and success expose cancel and restore at the field without a dialog',async()=>{
 const h=setupLifetime(),field=input(h);let finish;h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateInput();assert.equal(!!popup(h),false);assert.ok(feedback(h,'cancel'));finish({translations:['你好']});await task;assert.equal(!!popup(h),false);assert.ok(feedback(h,'restore'));h.emit(feedback(h,'restore'),'click');assert.equal(field.value,'hello');h.ui.stop();
});
test('quiet error supports retry and cancellation ignores late input response',async()=>{
 const h=setupLifetime();input(h);h.respond(async()=>{throw Error('Offline');});await assert.rejects(h.ui.translateInput(),/Offline/);assert.equal(!!popup(h),false);assert.ok(feedback(h,'retry'));let finish;h.respond(()=>new Promise(resolve=>finish=resolve));h.emit(feedback(h,'retry'),'click');assert.ok(feedback(h,'cancel'));h.emit(feedback(h,'cancel'),'click');finish({translations:['Late']});await settleLifetime();assert.equal(h.ui.getState().status,'idle');assert.equal(!!popup(h),false);h.ui.stop();
});
test('unsafe input result stays copyable in field feedback without dialog or overwrite',async()=>{
 const h=setupLifetime(),field=input(h);let finish,copied;h.env.navigator.clipboard={writeText:async value=>{copied=value;}};h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateInput();field.value='changed';h.emit(field,'input');finish({translations:['你好']});assert.equal((await task).applied,false);assert.equal(!!popup(h),false);assert.equal(field.value,'changed');h.emit(feedback(h,'copy'),'click');await settleLifetime();assert.equal(copied,'你好');h.ui.stop();
});
test('dot sits inside focused field with preferred insets and follows scroll/resize without sending text',()=>{
 const h=setupLifetime(),field=input(h);field._rect={left:100,right:400,top:50,bottom:150,width:300,height:100};h.emit(field,'focusin');const host=()=>h.doc.getElementById('kuai-input-trigger');assert.equal(host().style.left,'358px');assert.equal(host().style.top,'124px');const button=host().shadowRoot.querySelector('button');assert.equal(h.emit(button,'pointerdown').defaultPrevented,true);assert.equal(h.doc.activeElement,field);assert.equal(field.selectionStart,0);field._rect={left:100,right:400,top:20,bottom:120,width:300,height:100};h.emit(h.doc,'scroll');assert.equal(host().style.top,'94px');h.env.innerWidth=300;h.emit(h.env,'resize');assert.ok(parseFloat(host().style.left)<=278);assert.equal(h.requests.length,0);h.ui.stop();
});
test('empty eligible field shows a dot without a request; readonly and sensitive fields do not',()=>{
 const h=setupLifetime(),field=input(h);field.value='';h.emit(field,'focusin');assert.ok(h.doc.getElementById('kuai-input-trigger'));assert.equal(h.requests.length,0);field.readOnly=true;h.emit(field,'focusin');assert.equal(h.doc.getElementById('kuai-input-trigger'),null);field.readOnly=false;field.setAttribute('autocomplete','one-time-code');h.emit(field,'focusin');assert.equal(h.doc.getElementById('kuai-input-trigger'),null);h.ui.stop();
});

const settleOptions=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function field(h){const input=h.paragraph('','textarea');input.value='Keep hello tail';input.setSelectionRange(5,10);input.focus();h.respond(async()=>({translations:['你好']}));return input;}
const keyOptions=(h,input,name='x',flags={altKey:true})=>h.emit(input,'keydown',{key:name,code:/^[a-z]$/i.test(name)?'Key'+name.toUpperCase():undefined,...flags});
const popupAction=(h,attribute)=>(h.doc.getElementById('kuai-input-preview')||h.doc.getElementById('kuai-input-trigger'))?.shadowRoot.querySelector('['+attribute+']');

test('input shortcut matches exact modifiers and repeat cannot translate twice',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();
 assert.equal(keyOptions(h,input,'x',{altKey:true,ctrlKey:true}).defaultPrevented,false);assert.equal(keyOptions(h,input,'x',{altKey:true,repeat:true}).defaultPrevented,false);assert.equal(keyOptions(h,input,'x',{altKey:true,isComposing:true}).defaultPrevented,false);await settleOptions();assert.equal(h.requests.length,0);
 assert.equal(keyOptions(h,input).defaultPrevented,true);await settleOptions();assert.equal(input.value,'Keep 你好 tail');assert.equal(h.requests.length,1);ui.stop();
});

test('repeated main shortcut restores the last unchanged successful input edit',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();keyOptions(h,input);await settleOptions();assert.equal(input.value,'Keep 你好 tail');keyOptions(h,input);await settleOptions();assert.equal(input.value,'Keep hello tail');assert.equal(input.selectionStart,5);assert.equal(input.selectionEnd,10);assert.equal(h.requests.length,1);ui.stop();
});

for(const [order,want]of [['original-translation','Keep hello\n你好 tail'],['translation-original','Keep 你好\nhello tail']])test(`input can include the original in ${order} order`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={includeOriginal:true,displayOrder:order};const ui=createInteractions(h.dependencies).start();await ui.translateInput();assert.equal(input.value,want);ui.stop();
});

for(const icon of ['dot','icon'])test(`${icon} preview mode applies only after an explicit Apply action`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={autoApply:false,icon};const ui=createInteractions(h.dependencies).start();h.emit(feedback(h,'trigger'),'click');h.emit(feedback(h,'translate'),'click');await settleOptions();assert.equal(input.value,'Keep hello tail');const preview=h.doc.getElementById('kuai-input-preview');assert.ok(preview);assert.equal(preview.shadowRoot.querySelector('[data-translation]').textContent,'你好');assert.equal(h.doc.getElementById('kuai-input-trigger').shadowRoot.querySelector('.feedback').hidden,false);
 const apply=popupAction(h,'data-apply');assert.ok(apply);assert.equal(apply.hidden,false);h.emit(apply,'pointerdown');h.emit(apply,'click');assert.equal(input.value,'Keep 你好 tail');h.advance(400);h.emit(feedback(h,'translate'),'click');assert.equal(input.value,'Keep hello tail');assert.equal(h.requests.length,1);ui.stop();
});

for(const autocomplete of ['current-password','new-password','one-time-code','cc-number','section-checkout cc-csc'])test(`sensitive ${autocomplete} fields never send text`,async()=>{
 const h=fixture(),input=h.paragraph('','input');input.value='sensitive';input.setAttribute('autocomplete',autocomplete);input.focus();const ui=createInteractions(h.dependencies).start();await assert.rejects(ui.translateInput());assert.equal(h.requests.length,0);assert.equal(keyOptions(h,input).defaultPrevented,false);ui.stop();
});

test('disabled features and unsupported fields never consume ordinary keyboard shortcuts',async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={enabled:false};const ui=createInteractions(h.dependencies).start();assert.equal(keyOptions(h,input).defaultPrevented,false);h.settings.inputOptions.enabled=true;input.readOnly=true;assert.equal(keyOptions(h,input).defaultPrevented,false);input.readOnly=false;input.type='password';input.tagName='INPUT';assert.equal(keyOptions(h,input).defaultPrevented,false);await settleOptions();assert.equal(h.requests.length,0);ui.stop();
});

for(const icon of ['dot','icon'])test(`${icon} entry toggles its action and preserves focus and text selection`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};const ui=createInteractions(h.dependencies).start();h.emit(input,'focusin');const trigger=feedback(h,'trigger'),translate=feedback(h,'translate');assert.ok(trigger);assert.equal(translate.hidden,true);assert.equal(trigger.getAttribute('aria-expanded'),'false');
 for(const type of ['pointerdown','mousedown'])assert.equal(h.emit(trigger,type).defaultPrevented,true);
 h.emit(trigger,'click');await settleOptions();assert.equal(h.requests.length,0);assert.equal(input.value,'Keep hello tail');assert.equal(translate.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.strictEqual(h.doc.activeElement,input);assert.equal(input.selectionStart,5);assert.equal(input.selectionEnd,10);
 h.emit(trigger,'click');assert.equal(translate.hidden,true);assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(h.requests.length,0);h.emit(trigger,'click');assert.equal(h.emit(translate,'pointerdown').defaultPrevented,true);h.emit(translate,'click');await settleOptions();assert.strictEqual(h.doc.activeElement,input);assert.equal(input.value,'Keep 你好 tail');assert.deepEqual(h.requests[0].texts,['hello']);ui.stop();
});

test('safe rich text replacement preserves the existing text and inline element identities',async()=>{
 const h=fixture(),editor=h.paragraph('','div');editor.setAttribute('contenteditable','true');const strong=h.doc.createElement('strong');strong.textContent='Keep hello tail';editor.append(strong);editor.focus();const text=strong.firstChild;h.setRange(text,5,text,10);h.respond(async()=>({translations:['你好']}));const ui=createInteractions(h.dependencies).start();
 const result=await ui.translateInput();assert.equal(result.applied,true);assert.strictEqual(strong.firstChild,text);assert.equal(text.nodeValue,'Keep 你好 tail');assert.equal(strong.childNodes.length,1);ui.stop();
});

test('a framework editor that owns the replacement applies and restores it through its own model',async()=>{
 const h=fixture(),editor=h.paragraph('','div');editor.setAttribute('contenteditable','true');editor.setAttribute('data-lexical-editor','true');const line=h.doc.createElement('p'),span=h.doc.createElement('span');span.textContent='Keep hello tail';line.append(span);editor.append(line);editor.focus();
 const text=span.firstChild,commands=[];h.doc.execCommand=(...args)=>{commands.push(args);return true;};h.setRange(text,5,text,10);
 // Like Lexical: cancel the input, then render the model change after the event.
 editor.addEventListener('beforeinput',event=>{event.preventDefault();const range=h.doc.selection.getRangeAt(0),{startOffset,endOffset}=range;queueMicrotask(()=>{text.nodeValue=text.nodeValue.slice(0,startOffset)+event.data+text.nodeValue.slice(endOffset);h.setRange(text,startOffset+event.data.length);});});
 h.respond(async()=>({translations:['你好']}));const ui=createInteractions(h.dependencies).start();
 const result=await ui.translateInput();assert.equal(result.applied,true);await Promise.resolve();assert.equal(text.nodeValue,'Keep 你好 tail');assert.deepEqual(commands,[]);
 h.flushTimers();assert.equal(ui.restoreInput(),true);await Promise.resolve();assert.equal(text.nodeValue,'Keep hello tail');ui.stop();
});

test('a delegated beforeinput veto prevents both automatic and explicit preview replacement',async()=>{
 const h=fixture(),input=field(h);h.doc.addEventListener('beforeinput',event=>event.preventDefault());const ui=createInteractions(h.dependencies).start();assert.equal((await ui.translateInput()).applied,false);assert.equal(input.value,'Keep hello tail');
 h.settings.inputOptions={autoApply:false};ui.updateSettings();await ui.translateInput();assert.equal(ui.applyInput(),false);assert.equal(input.value,'Keep hello tail');ui.stop();
});


for(const icon of ['dot','icon'])test(`expanded ${icon} translates, shows a check and restores without a second request or text popup`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};const ui=createInteractions(h.dependencies).start();
 const root=()=>h.doc.getElementById('kuai-input-trigger').shadowRoot;
 h.emit(root().querySelector('[data-trigger]'),'click');const action=root().querySelector('[data-translate]');
 assert.equal(action.getAttribute('data-state'),'idle');assert.equal(h.requests.length,0);h.emit(action,'pointerdown');h.emit(action,'click');await settleOptions();
 assert.equal(input.value,'Keep 你好 tail');assert.equal(action.hidden,false);assert.equal(action.getAttribute('data-state'),'loading');assert.equal(action.querySelector('[data-check]').hasAttribute('hidden'),true);h.advance(400);assert.equal(action.getAttribute('data-state'),'translated');
 assert.equal(action.querySelector('[data-check]').hasAttribute('hidden'),false);assert.equal(root().querySelector('.feedback').hidden,true);
 h.emit(action,'pointerdown');h.emit(action,'click');await settleOptions();
 assert.equal(input.value,'Keep hello tail');assert.equal(h.requests.length,1);assert.equal(action.getAttribute('data-state'),'idle');
 assert.equal(action.querySelector('[data-check]').hasAttribute('hidden'),true);assert.equal(action.hidden,false);assert.equal(root().querySelector('.feedback').hidden,true);ui.stop();
});

for(const icon of ['dot','icon'])test(`${icon} loading and errors remain silent and support cancel and retry`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};const ui=createInteractions(h.dependencies).start();let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const root=h.doc.getElementById('kuai-input-trigger').shadowRoot;
 h.emit(root.querySelector('[data-trigger]'),'click');const action=root.querySelector('[data-translate]');h.emit(action,'click');
 assert.equal(action.hidden,false);assert.equal(action.getAttribute('data-state'),'loading');assert.equal(root.querySelector('[data-trigger]').getAttribute('data-state'),'loading');assert.equal(root.querySelector('.feedback').hidden,true);
 h.emit(action,'click');finish({translations:['late']});await settleOptions();assert.equal(input.value,'Keep hello tail');
 h.respond(async()=>{throw Error('offline');});h.emit(root.querySelector('[data-trigger]'),'click');h.emit(action,'click');await settleOptions();
 assert.equal(action.getAttribute('data-state'),'loading');h.advance(400);assert.equal(action.getAttribute('data-state'),'error');assert.equal(root.querySelector('[data-trigger]').getAttribute('data-state'),'error');assert.equal(root.querySelector('.feedback').hidden,true);
 h.respond(async()=>({translations:['done']}));h.emit(action,'click');await settleOptions();assert.equal(input.value,'Keep done tail');h.advance(400);assert.equal(action.getAttribute('data-state'),'translated');ui.stop();
});

for(const icon of ['dot','icon'])test(`${icon} action copies an unsafe result without another request`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};let finish,copied;h.env.navigator.clipboard={writeText:async value=>{copied=value;}};h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start(),trigger=feedback(h,'trigger'),action=feedback(h,'translate');
 h.emit(trigger,'click');h.emit(action,'click');input.value='changed';h.emit(input,'input');finish({translations:['你好']});await settleOptions();h.advance(400);assert.equal(action.getAttribute('data-state'),'copy');assert.equal(h.doc.getElementById('kuai-input-trigger').shadowRoot.querySelector('.feedback').hidden,true);
 h.emit(trigger,'click');assert.equal(action.hidden,true);h.emit(trigger,'click');assert.equal(action.hidden,false);h.emit(action,'click');await settleOptions();assert.equal(copied,'你好');assert.equal(input.value,'changed');assert.equal(h.requests.length,1);ui.stop();
});

for(const icon of ['dot','icon'])test(`the collapsed ${icon} carries the request state so progress is visible without expanding`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
 const ui=createInteractions(h.dependencies).start();h.emit(input,'focusin');
 const dot=()=>h.doc.getElementById('kuai-input-trigger').shadowRoot.querySelector('[data-trigger]');
 const spinner=dot().querySelector('.spinner');assert.ok(spinner);assert.equal(spinner.getAttribute('aria-hidden'),'true');assert.equal(dot().getAttribute('data-state'),'idle');
 const task=ui.translateInput();await settleOptions();assert.equal(dot().getAttribute('data-state'),'loading');assert.equal(dot().querySelector('.spinner'),spinner);
 finish({translations:['你好']});assert.equal((await task).applied,true);assert.equal(input.value,'Keep 你好 tail');assert.equal(ui.getState().status,'success');assert.equal(dot().getAttribute('data-state'),'loading');assert.equal(h.timerCount(),1);
 h.advance(399);h.emit(h.env,'resize');assert.equal(dot().getAttribute('data-state'),'loading');assert.equal(h.timerCount(),1);h.advance(1);assert.equal(dot().getAttribute('data-state'),'translated');assert.equal(dot().querySelector('.spinner'),spinner);assert.equal(h.timerCount(),0);
 ui.stop();
});

test('slow input responses finish the visual loading state without another wait',async()=>{
 const h=fixture();field(h);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start(),dot=feedback(h,'trigger');
 const task=ui.translateInput();assert.equal(dot.getAttribute('data-state'),'loading');h.advance(450);assert.equal(h.timerCount(),0);finish({translations:['你好']});await task;
 assert.equal(dot.getAttribute('data-state'),'translated');assert.equal(h.timerCount(),0);ui.stop();
});

for(const icon of ['dot','icon'])test(`cancelling input loading via ${icon} resets it immediately and ignores late responses`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start(),dot=feedback(h,'trigger');
 const task=ui.translateInput();h.advance(100);h.emit(dot,'click');assert.equal(dot.getAttribute('data-state'),'idle');assert.equal(h.timerCount(),0);assert.deepEqual(h.cancellations,['request-1']);
 finish({translations:['Late']});assert.deepEqual(await task,{cancelled:true});h.advance(500);assert.equal(dot.getAttribute('data-state'),'idle');assert.equal(input.value,'Keep hello tail');assert.equal(h.timerCount(),0);ui.stop();
});

for(const icon of ['dot','icon'])test(`reduced motion ${icon} feedback has no minimum loading hold`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon};h.env.matchMedia=query=>({matches:query==='(prefers-reduced-motion: reduce)'});const ui=createInteractions(h.dependencies).start(),dot=feedback(h,'trigger');
 assert.equal((await ui.translateInput()).applied,true);assert.equal(input.value,'Keep 你好 tail');assert.equal(dot.getAttribute('data-state'),'translated');assert.equal(h.timerCount(),0);
 ui.restoreInput();h.respond(async()=>{throw Error('offline');});await assert.rejects(ui.translateInput(),/offline/);assert.equal(dot.getAttribute('data-state'),'error');assert.equal(h.timerCount(),0);ui.stop();
});

for(const icon of ['dot','icon'])test(`${icon} preview presence changes preserve the trigger host and reveal results during the visual hold`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={autoApply:false,icon};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start(),host=h.doc.getElementById('kuai-input-trigger'),dot=feedback(h,'trigger');
 assert.equal(h.doc.getElementById('kuai-input-preview'),null);const task=ui.translateInput();assert.equal(h.doc.getElementById('kuai-input-trigger'),host);assert.equal(dot.getAttribute('data-state'),'loading');const preview=h.doc.getElementById('kuai-input-preview');assert.ok(preview);
 finish({translations:['你好']});assert.equal((await task).applied,false);assert.equal(h.doc.getElementById('kuai-input-trigger'),host);assert.equal(h.doc.getElementById('kuai-input-preview'),preview);assert.equal(input.value,'Keep hello tail');assert.equal(ui.getState().status,'success');assert.equal(preview.shadowRoot.querySelector('[data-translation]').textContent,'你好');assert.equal(preview.shadowRoot.querySelector('[data-apply]').hidden,false);assert.equal(dot.getAttribute('data-state'),'loading');assert.doesNotMatch(host.shadowRoot.querySelector('[role="status"]').textContent,/Translating|翻译中/);
 h.advance(400);assert.equal(dot.getAttribute('data-state'),'idle');h.emit(preview.shadowRoot.querySelector('[data-close]'),'click');assert.equal(h.doc.getElementById('kuai-input-preview'),null);assert.equal(h.doc.getElementById('kuai-input-trigger'),host);assert.equal(dot.getAttribute('data-state'),'idle');ui.stop();
});

test('the icon entry keeps its inline Kuai SVG and spinner through the minimum loading hold',async()=>{
 const h=fixture();field(h);h.settings.inputOptions={icon:'icon'};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start(),button=feedback(h,'trigger'),root=h.doc.getElementById('kuai-input-trigger').shadowRoot;
 const svg=button.querySelector('svg'),spinner=button.querySelector('.spinner');assert.ok(svg);assert.ok(spinner);assert.equal(svg.getAttribute('viewBox'),'0 0 128 128');assert.equal(svg.getAttribute('width'),'22');assert.equal(svg.getAttribute('height'),'22');assert.equal(svg.getAttribute('aria-hidden'),'true');assert.equal(svg.children.length,3);assert.equal(svg.querySelector('rect').getAttribute('fill'),'#3340a6');assert.equal(svg.querySelectorAll('path')[0].getAttribute('fill'),'#ffffff');assert.equal(svg.querySelectorAll('path')[1].getAttribute('fill'),'#7de3e0');assert.equal(button.textContent,'');
 const task=ui.translateInput();assert.equal(button.textContent,'');assert.equal(button.getAttribute('data-state'),'loading');assert.equal(root.querySelector('.feedback').hidden,true);finish({translations:['你好']});await task;assert.equal(button.textContent,'');assert.equal(button.getAttribute('data-state'),'loading');assert.equal(root.querySelector('.feedback').hidden,true);
 h.advance(399);assert.equal(button.getAttribute('data-state'),'loading');h.advance(1);assert.equal(button.textContent,'');assert.equal(button.querySelector('svg'),svg);assert.equal(button.querySelector('.spinner'),spinner);assert.equal(button.getAttribute('data-state'),'translated');ui.stop();
});

test('the none option keeps its loading ellipsis and spinner without an idle trigger',async()=>{
 const h=fixture();field(h);h.settings.inputOptions={icon:'none'};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();assert.equal(h.doc.getElementById('kuai-input-trigger'),null);
 const task=ui.translateInput(),button=feedback(h,'trigger'),spinner=button.querySelector('.spinner');assert.ok(spinner);assert.equal(button.textContent,'…');finish({translations:['你好']});await task;assert.equal(button.textContent,'…');h.advance(400);assert.equal(button.textContent,'');assert.equal(button.querySelector('.spinner'),spinner);assert.equal(button.getAttribute('data-state'),'translated');ui.stop();
});

for(const cause of ['cancel','route','provider','hide','stop'])test('a pending input visual loading timer is cleared on '+cause,async()=>{
 const h=fixture();field(h);const ui=createInteractions(h.dependencies).start(),button=feedback(h,'trigger');await ui.translateInput();assert.equal(button.getAttribute('data-state'),'loading');assert.equal(h.timerCount(),1);
 if(cause==='cancel')ui.cancelCurrent();
 if(cause==='route'){h.env.location.href='https://example.org/next';ui.updateSettings();}
 if(cause==='provider'){h.settings.activeProviderId='google';ui.updateSettings();}
 if(cause==='hide')h.emit(h.env,'blur');
 if(cause==='stop')ui.stop();
 assert.equal(h.timerCount(),0);const state=button.getAttribute('data-state');h.advance(500);assert.equal(button.getAttribute('data-state'),state);if(['cancel','route','provider'].includes(cause)){assert.equal(ui.getState().status,'idle');assert.equal(feedback(h,'trigger').getAttribute('data-state'),cause==='cancel'?'translated':'idle');}ui.stop();
});

test('input errors clear the entrance class so it cannot replay when the shake ends',async()=>{
 const h=fixture();field(h);const ui=createInteractions(h.dependencies).start(),button=feedback(h,'trigger');assert.match(button.className,/ entering/);
 h.respond(async()=>{throw Error('offline');});await assert.rejects(ui.translateInput(),/offline/);assert.equal(ui.getState().status,'error');assert.equal(button.getAttribute('data-state'),'loading');assert.equal(feedback(h,'retry').hidden,false);h.advance(400);assert.equal(button.getAttribute('data-state'),'error');assert.doesNotMatch(button.className,/ entering/);
 ui.cancelCurrent();assert.equal(button.getAttribute('data-state'),'idle');assert.doesNotMatch(button.className,/ entering/);ui.stop();
});

test('the trigger entrance class is removed when its entrance animation ends',()=>{
 const h=fixture();field(h);const ui=createInteractions(h.dependencies).start(),button=feedback(h,'trigger');assert.match(button.className,/ entering/);h.emit(button,'animationend',{animationName:'kuai-appear'});assert.doesNotMatch(button.className,/ entering/);h.emit(h.env,'resize');assert.doesNotMatch(button.className,/ entering/);ui.stop();
});

const bounds=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});

test('the 22px Kuai entry uses the existing insets, shrinks in small fields and hides when clipped',()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon:'icon'};input._rect=bounds(100,50,300,100);const ui=createInteractions(h.dependencies).start(),host=h.doc.getElementById('kuai-input-trigger'),button=feedback(h,'trigger');
 assert.equal(host.style.width,'22px');assert.equal(host.style.height,'22px');assert.equal(button.style.width,'22px');assert.equal(button.style.height,'22px');assert.equal(host.style.left,'354px');assert.equal(host.style.top,'120px');assert.equal(host.style.visibility,'visible');
 input._rect=bounds(100,50,300,16);h.emit(h.env,'resize');assert.equal(host.style.width,'16px');assert.equal(host.style.height,'16px');assert.equal(host.style.top,'50px');assert.equal(host.style.visibility,'visible');
 input._rect=bounds(100,-20,300,30);h.emit(h.env,'resize');assert.equal(host.style.visibility,'hidden');assert.equal(h.requests.length,0);ui.stop();
});
function trackingFixture(){
 const h=fixture(),observers=[];h.env.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(node){this.targets.add(node);}disconnect(){this.targets.clear();}};
 h.env.visualViewport=new h.env.constructor();Object.assign(h.env.visualViewport,{offsetLeft:0,offsetTop:0,width:1200,height:800});
 return Object.assign(h,{observers,host:()=>h.doc.getElementById('kuai-input-trigger')});
}

test('input tracking observes editor and clipping containers and coalesces resize callbacks',()=>{
 const h=trackingFixture(),input=field(h),wrapper=h.paragraph('','div');wrapper.style.overflow='auto';wrapper._rect=bounds(50,20,500,300);wrapper.append(input);input._rect=bounds(100,50,300,100);
 const ui=createInteractions(h.dependencies).start(),observer=h.observers[0];assert.deepEqual([...observer.targets],[input,wrapper]);h.advance(1008);assert.equal(h.frameCount(),0);
 input._rect=bounds(100,50,400,200);observer.callback();observer.callback();assert.equal(h.frameCount(),1);assert.equal(h.host().style.left,'358px');h.advance(16);assert.equal(h.host().style.left,'458px');assert.equal(h.host().style.top,'224px');ui.stop();
});

test('the focus frame check follows moving rects and stops after one second',()=>{
 const h=fixture(),input=field(h);input._rect=bounds(100,50,150,60);const ui=createInteractions(h.dependencies).start(),host=h.doc.getElementById('kuai-input-trigger');h.advance(16);
 let layouts=0;const measure=host.getBoundingClientRect.bind(host);host.getBoundingClientRect=()=>{layouts++;return measure();};h.advance(32);assert.equal(layouts,0);
 input._rect=bounds(120,50,400,60);h.advance(16);assert.equal(host.style.left,'478px');assert.equal(layouts,1);h.advance(1000);assert.equal(h.frameCount(),0);
 input._rect=bounds(140,50,400,60);h.emit(input,'transitionend');h.emit(input,'animationend');assert.equal(h.frameCount(),1);h.advance(16);assert.equal(host.style.left,'498px');ui.stop();
});

test('input capture schedules a measurement after the page autosizes the textarea',()=>{
 const h=fixture(),input=field(h);input._rect=bounds(100,50,300,60);const ui=createInteractions(h.dependencies).start(),host=h.doc.getElementById('kuai-input-trigger');h.advance(1008);
 input.addEventListener('input',()=>{input._rect=bounds(100,50,300,180);});h.emit(input,'input');assert.equal(host.style.top,'84px');h.advance(16);assert.equal(host.style.top,'204px');ui.stop();
});

test('a tall rich editor anchors inside its visible scroll container',()=>{
 const h=trackingFixture(),wrapper=h.paragraph('','div'),input=h.doc.createElement('div');wrapper._rect=bounds(100,50,300,120);wrapper.style.overflow='auto';input.setAttribute('contenteditable','true');input._rect=bounds(100,50,300,900);wrapper.append(input);input.focus();
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.left,'358px');assert.equal(h.host().style.top,'144px');assert.equal(h.host().style.visibility,'visible');assert.ok(h.observers[0].targets.has(wrapper));ui.stop();
});

test('clipping excludes container borders and scrollbars at the rendered scale',()=>{
 for(const scale of [1,1.25]){
  const h=trackingFixture(),input=field(h),wrapper=h.paragraph('','div');wrapper.style.overflow='scroll';wrapper._rect=bounds(100,50,400*scale,120*scale);Object.assign(wrapper,{offsetWidth:400,offsetHeight:120,clientLeft:2,clientTop:2,clientWidth:381,clientHeight:101});wrapper.append(input);input._rect=bounds(100,50,400*scale,900*scale);
  const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'visible');assert.equal(h.host().style.left,(100+383*scale-42)+'px');assert.equal(h.host().style.top,(50+103*scale-26)+'px');assert.deepEqual([...h.observers[0].targets],[input,wrapper]);ui.stop();
 }
});

test('clipped inputs hide without losing their host and reappear after scrolling back',()=>{
 const h=trackingFixture(),input=field(h),wrapper=h.paragraph('','div');wrapper._rect=bounds(100,50,300,120);wrapper.style.overflow='auto';wrapper.append(input);input._rect=bounds(100,140,300,60);
 const ui=createInteractions(h.dependencies).start(),host=h.host();assert.equal(host.style.top,'144px');assert.equal(host.style.visibility,'visible');
 for(const rect of [bounds(100,160,300,60),bounds(100,180,300,60),bounds(100,-100,300,60)]){input._rect=rect;h.emit(wrapper,'scroll');h.advance(16);assert.equal(host.style.visibility,'hidden');assert.equal(h.host(),host);}
 input._rect=bounds(100,50,300,60);h.emit(wrapper,'scroll');h.advance(16);assert.equal(host.style.visibility,'visible');assert.equal(host.style.top,'84px');ui.stop();
});

test('viewport clipping hides fully offscreen inputs and uses visual viewport offsets',()=>{
 const h=trackingFixture(),input=field(h);input._rect=bounds(100,200,300,60);const ui=createInteractions(h.dependencies).start(),host=h.host();h.advance(1008);
 Object.assign(h.env.visualViewport,{offsetLeft:120,offsetTop:210,width:250,height:40});h.emit(h.env.visualViewport,'resize');h.emit(h.env.visualViewport,'scroll');assert.equal(h.frameCount(),1);h.advance(16);assert.equal(host.style.left,'328px');assert.equal(host.style.top,'224px');
 input._rect=bounds(100,900,300,60);h.emit(h.doc,'scroll');assert.equal(host.style.visibility,'hidden');input._rect=bounds(100,200,300,60);h.emit(h.doc,'scroll');assert.equal(host.style.visibility,'visible');ui.stop();
});

test('clipping follows ancestors across shadow roots and respects each overflow axis',()=>{
 const h=fixture(),wrapper=h.paragraph('','div'),shadow=wrapper.attachShadow({mode:'open'}),input=h.doc.createElement('textarea');wrapper.style.overflowY='hidden';wrapper.style.overflowX='visible';wrapper._rect=bounds(100,50,100,120);input._rect=bounds(80,50,300,900);shadow.append(input);input.focus();
 const ui=createInteractions(h.dependencies).start(),host=h.doc.getElementById('kuai-input-trigger');assert.equal(host.style.left,'338px');assert.equal(host.style.top,'144px');ui.stop();
});

for(const overflow of ['visible','hidden'])test('fixed bottom composers escape body overflow when html overflow is '+overflow,()=>{
 const h=trackingFixture(),input=field(h);h.doc.documentElement.style.overflow=overflow;h.doc.body.style.overflowX='hidden';h.doc.body.style.overflowY='auto';h.doc.body._rect=bounds(0,0,1200,200);input.style.position='fixed';input._rect=bounds(100,720,400,40);
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'visible');assert.equal(h.host().style.left,'458px');assert.equal(h.host().style.top,'734px');assert.deepEqual([...h.observers[0].targets],[input]);ui.stop();
});

for(const overflow of ['visible','hidden'])test('body overflow '+(overflow==='visible'?'propagates to the viewport':'clips in-flow inputs')+' with html overflow '+overflow,()=>{
 const h=trackingFixture(),input=field(h);h.doc.documentElement.style.overflow=overflow;h.doc.documentElement._rect=bounds(0,0,10,10);h.doc.body.style.overflowX='hidden';h.doc.body.style.overflowY='auto';h.doc.body._rect=bounds(0,0,1200,200);input._rect=bounds(100,720,400,40);
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,overflow==='visible'?'visible':'hidden');assert.deepEqual([...h.observers[0].targets],overflow==='visible'?[input]:[input,h.doc.body]);ui.stop();
});

test('fixed inputs escape tiny overflow ancestors that do not establish a containing block',()=>{
 const h=trackingFixture(),input=field(h),wrapper=h.paragraph('','div');wrapper.style.overflow='hidden';wrapper.style.position='relative';wrapper._rect=bounds(0,0,10,10);wrapper.append(input);input.style.position='fixed';input._rect=bounds(100,300,400,40);
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'visible');assert.equal(h.host().style.left,'458px');assert.equal(h.host().style.top,'314px');assert.deepEqual([...h.observers[0].targets],[input]);ui.stop();
});

for(const [property,value]of [['transform','translateX(0)'],['perspective','100px'],['filter','blur(0)'],['backdropFilter','blur(0)'],['contain','paint'],['contain','layout'],['contain','strict'],['contain','content'],['willChange','transform'],['willChange','perspective'],['willChange','filter']])test('fixed inputs are clipped by their '+property+':'+value+' containing block',()=>{
 const h=trackingFixture(),input=field(h),wrapper=h.paragraph('','div');wrapper.style.overflow='hidden';wrapper.style[property]=value;wrapper._rect=bounds(0,0,10,10);wrapper.append(input);input.style.position='fixed';input._rect=bounds(100,300,400,40);
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'hidden');assert.deepEqual([...h.observers[0].targets],[input,wrapper]);ui.stop();
});

test('absolute inputs escape non-positioned overflow wrappers before their containing block',()=>{
 const h=trackingFixture(),input=field(h),outer=h.paragraph('','div'),wrapper=h.doc.createElement('div');outer.style.position='relative';outer.style.overflow='auto';outer._rect=bounds(50,200,600,200);wrapper.style.overflow='hidden';wrapper._rect=bounds(0,0,10,10);outer.append(wrapper);wrapper.append(input);input.style.position='absolute';input._rect=bounds(100,300,400,40);
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'visible');assert.equal(h.host().style.left,'458px');assert.equal(h.host().style.top,'314px');assert.deepEqual([...h.observers[0].targets],[input,outer]);outer._rect=bounds(0,0,10,10);h.observers[0].callback();h.advance(16);assert.equal(h.host().style.visibility,'hidden');ui.stop();
});

test('clipping resumes with the containing block position and observes only active containers',()=>{
 const h=trackingFixture(),input=field(h),outer=h.paragraph('','div'),wrapper=h.doc.createElement('div');outer.style.overflow='clip';outer._rect=bounds(0,0,10,10);wrapper.style.transform='translateX(0)';wrapper._rect=bounds(50,200,600,200);outer.append(wrapper);wrapper.append(input);input.style.position='fixed';input._rect=bounds(100,300,400,40);
 const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'hidden');assert.deepEqual([...h.observers[0].targets],[input,outer]);wrapper.style.position='fixed';h.emit(h.env,'resize');assert.equal(h.host().style.visibility,'visible');assert.deepEqual([...h.observers[0].targets],[input]);ui.stop();
});

test('display contents ancestors provide neither clipping boxes nor containing blocks',()=>{
 for(const position of ['static','absolute','fixed']){
  const h=trackingFixture(),input=field(h),wrapper=h.paragraph('','div');wrapper.style.display='contents';wrapper.style.overflow='hidden';wrapper.style.position='relative';wrapper.style.transform='translateX(0)';wrapper._rect=bounds(0,0,0,0);wrapper.append(input);input.style.position=position;input._rect=bounds(100,300,400,40);
  const ui=createInteractions(h.dependencies).start();assert.equal(h.host().style.visibility,'visible');assert.equal(h.host().style.left,'458px');assert.deepEqual([...h.observers[0].targets],[input]);ui.stop();
 }
});

test('fixed host compensation corrects offsets and zoom without changing action side',()=>{
 for(const scale of [1,1.25]){
  const h=fixture(),input=field(h);input._rect=bounds(10,50,300,100);const create=h.doc.createElement;h.doc.createElement=tag=>{const node=create(tag),measure=node.getBoundingClientRect.bind(node);node.getBoundingClientRect=()=>{const rect=measure();return node.id==='kuai-input-trigger'?bounds(rect.left*scale+400,rect.top*scale-70,rect.width*scale,rect.height*scale):rect;};Object.defineProperties(node,{offsetWidth:{get:()=>parseFloat(node.style.width)||300},offsetHeight:{get:()=>parseFloat(node.style.height)||30}});return node;};
  const ui=createInteractions(h.dependencies).start(),host=h.doc.getElementById('kuai-input-trigger'),rect=host.getBoundingClientRect();assert.equal(rect.left,268);assert.equal(rect.top,124);assert.equal(feedback(h,'translate').getAttribute('data-side'),'left');ui.stop();
 }
});

test('preview and feedback follow the visible anchor and compensate fixed offsets',async()=>{
 const h=trackingFixture(),input=field(h);h.settings.inputOptions={autoApply:false,icon:'icon'};input._rect=bounds(100,150,300,100);
 const create=h.doc.createElement;h.doc.createElement=tag=>{const node=create(tag),measure=node.getBoundingClientRect.bind(node);node.getBoundingClientRect=()=>{const rect=measure();return node.id==='kuai-input-preview'||node.className==='feedback'?bounds(rect.left+80,rect.top-40,rect.width,rect.height):rect;};return node;};
 const ui=createInteractions(h.dependencies).start();await ui.translateInput();const preview=h.doc.getElementById('kuai-input-preview'),box=h.host().shadowRoot.querySelector('.feedback');assert.equal(preview.getBoundingClientRect().left,100);assert.equal(preview.getBoundingClientRect().top,258);assert.equal(box.getBoundingClientRect().top,186);
 input._rect=bounds(150,200,300,200);h.observers[0].callback();h.advance(16);assert.equal(preview.getBoundingClientRect().left,150);assert.equal(preview.getBoundingClientRect().top,408);assert.equal(box.getBoundingClientRect().top,336);ui.stop();
});

for(const cause of ['hide','stop'])test('input tracking tears down observers, listeners and queued frames on '+cause,()=>{
 const h=trackingFixture(),input=field(h);input._rect=bounds(100,50,300,100);const callbacks=[],request=h.env.requestAnimationFrame;h.env.requestAnimationFrame=fn=>{callbacks.push(fn);return request(fn);};
 const ui=createInteractions(h.dependencies).start(),host=h.host(),observer=h.observers[0];observer.callback();assert.equal(h.frameCount(),1);
 if(cause==='hide')h.emit(h.env,'blur');else ui.stop();const previous=host.style.left;assert.equal(h.host(),null);assert.equal(observer.targets.size,0);assert.equal(h.frameCount(),0);assert.equal(h.timerCount(),0);
 for(const [target,types]of [[h.doc,['transitionend','animationend']],[h.env.visualViewport,['resize','scroll']]])for(const type of types)assert.equal(target.listeners.get(type)?.length||0,0);
 input._rect=bounds(200,50,300,100);observer.callback();for(const callback of callbacks)callback();h.emit(input,'transitionend');h.emit(h.env.visualViewport,'resize');h.advance(2000);assert.equal(host.style.left,previous);assert.equal(h.frameCount(),0);assert.equal(h.timerCount(),0);ui.stop();
});

test('input tracking falls back to a cancellable timer without optional browser APIs',()=>{
 const h=fixture();field(h);delete h.env.requestAnimationFrame;delete h.env.cancelAnimationFrame;const ui=createInteractions(h.dependencies).start();assert.equal(h.timerCount(),1);h.advance(16);assert.equal(h.timerCount(),1);h.emit(h.env,'blur');assert.equal(h.timerCount(),0);h.advance(2000);assert.equal(h.doc.getElementById('kuai-input-trigger'),null);ui.stop();
});
