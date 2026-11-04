import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createInteractions} from '../src/content/interactions.js';
const popup=h=>h.doc.getElementById('kuai-translation-popup');
const action=(h,name)=>popup(h)?.shadowRoot.querySelector(`[data-${name}]`);
const feedback=(h,name)=>h.doc.getElementById('kuai-input-trigger')?.shadowRoot.querySelector(`[data-${name}]`);
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function setup(){const h=fixture(),p=h.paragraph('Selected words');h.select(p);h.settings.inputOptions={icon:'dot'};return {...h,p,ui:createInteractions(h.dependencies).start()};}
function input(h){const node=h.paragraph('','textarea');node.value='hello';node.setSelectionRange(0,5);node.focus();h.emit(node,'focusin');return node;}
function deselect(h){h.doc.selection=null;h.emit(h.doc,'selectionchange');}
for(const pending of [true,false])test(`unpinned ${pending?'pending':'completed'} selection closes on deselection and ignores late output`,async()=>{
 const h=setup();let finish;h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateSelection();if(!pending){finish({translations:['Done']});await task;}deselect(h);assert.equal(!!popup(h),false);if(pending){assert.deepEqual(h.cancellations,['request-1']);finish({translations:['Late']});assert.deepEqual(await task,{cancelled:true});}assert.equal(!!popup(h),false);h.ui.stop();
});
test('pin survives deselection and replacement, keeps viewport position, and unpin without source closes',async()=>{
 const h=setup();await h.ui.translateSelection();const pin=action(h,'pin');assert.ok(pin);assert.ok(pin.querySelector('svg'));assert.notEqual(pin.textContent,'上面');assert.equal(pin.getAttribute('aria-pressed'),'false');h.emit(pin,'click');assert.equal(pin.getAttribute('aria-pressed'),'true');const host=popup(h),position=[host.style.left,host.style.top];deselect(h);assert.equal(popup(h),host);h.p._rect={left:600,bottom:300};h.select(h.p,'Next');await h.ui.translateSelection();assert.equal(popup(h),host);assert.deepEqual([host.style.left,host.style.top],position);deselect(h);h.emit(pin,'click');assert.equal(!!popup(h),false);h.ui.stop();
});
test('translation text selection and copy keep the unpinned card alive',async()=>{
 const h=setup();let copied;h.env.navigator.clipboard={writeText:async text=>{copied=text;}};await h.ui.translateSelection();const host=popup(h),output=action(h,'translation');const textNode=output.firstChild;h.select(output);h.emit(h.doc,'selectionchange');assert.equal(output.firstChild===textNode,true);assert.equal(textNode.isConnected,true);assert.equal(popup(h),host);const copy=action(h,'copy');assert.ok(copy);h.emit(copy,'pointerdown');h.emit(copy,'click');await settle();assert.equal(copied,'译：Selected words');assert.equal(popup(h),host);h.ui.stop();
});
test('pin header drag and keyboard movement clamp and stop on pointer cancel or blur',async()=>{
 const h=setup();await h.ui.translateSelection();h.emit(action(h,'pin'),'click');const host=popup(h),header=host.shadowRoot.querySelector('header');h.emit(header,'pointerdown',{clientX:30,clientY:60,pointerId:4});h.emit(h.doc,'pointermove',{clientX:160,clientY:180,pointerId:4});assert.equal(host.style.left,'142px');h.emit(h.doc,'pointercancel',{pointerId:4});h.emit(h.doc,'pointermove',{clientX:300,clientY:400,pointerId:4});assert.equal(host.style.left,'142px');h.emit(header,'keydown',{key:'ArrowRight'});assert.equal(host.style.left,'152px');h.env.innerWidth=250;h.env.innerHeight=180;h.emit(h.env,'resize');assert.equal(host.style.left,'12px');h.emit(header,'pointerdown',{clientX:0,clientY:0,pointerId:5});h.emit(h.env,'blur');h.emit(h.doc,'pointermove',{clientX:20,clientY:20,pointerId:5});assert.equal(host.style.left,'12px');h.ui.stop();
});
test('buttons and translation text never initiate header drag',async()=>{
 const h=setup();await h.ui.translateSelection();h.emit(action(h,'pin'),'click');const host=popup(h),before=[host.style.left,host.style.top];for(const node of [action(h,'pin'),action(h,'translation')]){h.emit(node,'pointerdown',{clientX:0,clientY:0,pointerId:2});h.emit(h.doc,'pointermove',{clientX:90,clientY:90,pointerId:2});assert.deepEqual([host.style.left,host.style.top],before);}h.ui.stop();
});
test('input and pending pinned selection own independent requests and result UI',async()=>{
 const h=setup(),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));const selection=h.ui.translateSelection();h.emit(action(h,'pin'),'click');const host=popup(h),field=input(h),task=h.ui.translateInput();deselect(h);assert.equal(popup(h),host);assert.deepEqual(h.cancellations,[]);finishes[1]({translations:['你好']});assert.equal((await task).applied,true);assert.equal(field.value,'你好');finishes[0]({translations:['Selected']});await selection;assert.equal(action(h,'translation').textContent,'Selected');h.ui.stop();
});
test('deselection cancels selection alone while input finishes safely',async()=>{
 const h=setup(),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));const selection=h.ui.translateSelection(),field=input(h),task=h.ui.translateInput();deselect(h);assert.deepEqual(h.cancellations,['request-1']);finishes[1]({translations:['你好']});assert.equal((await task).applied,true);assert.equal(field.value,'你好');finishes[0]({translations:['Late']});await selection;h.ui.stop();
});
test('quiet input loading and success expose cancel and restore at the field without a dialog',async()=>{
 const h=setup(),field=input(h);let finish;h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateInput();assert.equal(!!popup(h),false);assert.ok(feedback(h,'cancel'));finish({translations:['你好']});await task;assert.equal(!!popup(h),false);assert.ok(feedback(h,'restore'));h.emit(feedback(h,'restore'),'click');assert.equal(field.value,'hello');h.ui.stop();
});
test('quiet error supports retry and cancellation ignores late input response',async()=>{
 const h=setup();input(h);h.respond(async()=>{throw Error('Offline');});await assert.rejects(h.ui.translateInput(),/Offline/);assert.equal(!!popup(h),false);assert.ok(feedback(h,'retry'));let finish;h.respond(()=>new Promise(resolve=>finish=resolve));h.emit(feedback(h,'retry'),'click');assert.ok(feedback(h,'cancel'));h.emit(feedback(h,'cancel'),'click');finish({translations:['Late']});await settle();assert.equal(h.ui.getState().status,'idle');assert.equal(!!popup(h),false);h.ui.stop();
});
test('unsafe input result stays copyable in field feedback without dialog or overwrite',async()=>{
 const h=setup(),field=input(h);let finish,copied;h.env.navigator.clipboard={writeText:async value=>{copied=value;}};h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateInput();field.value='changed';h.emit(field,'input');finish({translations:['你好']});assert.equal((await task).applied,false);assert.equal(!!popup(h),false);assert.equal(field.value,'changed');h.emit(feedback(h,'copy'),'click');await settle();assert.equal(copied,'你好');h.ui.stop();
});
test('dot sits inside focused field with preferred insets and follows scroll/resize without sending text',()=>{
 const h=setup(),field=input(h);field._rect={left:100,right:400,top:50,bottom:150,width:300,height:100};h.emit(field,'focusin');const host=()=>h.doc.getElementById('kuai-input-trigger');assert.equal(host().style.left,'358px');assert.equal(host().style.top,'124px');const button=host().shadowRoot.querySelector('button');assert.equal(h.emit(button,'pointerdown').defaultPrevented,true);assert.equal(h.doc.activeElement,field);assert.equal(field.selectionStart,0);field._rect={left:100,right:400,top:20,bottom:120,width:300,height:100};h.emit(h.doc,'scroll');assert.equal(host().style.top,'94px');h.env.innerWidth=300;h.emit(h.env,'resize');assert.ok(parseFloat(host().style.left)<=278);assert.equal(h.requests.length,0);h.ui.stop();
});
for(const change of ['route','settings'])test(`pinned card is invalidated by ${change}`,async()=>{
 const h=setup();await h.ui.translateSelection();h.emit(action(h,'pin'),'click');if(change==='route')h.env.location.href+='?next';else h.settings.selectionEnabled=false;h.ui.updateSettings();assert.equal(!!popup(h),false);h.ui.stop();
});

test('small fields keep the dot within field and viewport bounds',()=>{
 const h=setup(),field=input(h);field._rect={left:10,top:10,right:22,bottom:22,width:12,height:12};h.emit(field,'focusin');const host=h.doc.getElementById('kuai-input-trigger'),button=host.shadowRoot.querySelector('button');assert.ok(parseFloat(host.style.left)+parseFloat(button.style.width)<=22);assert.ok(parseFloat(host.style.top)+parseFloat(button.style.height)<=22);h.ui.stop();
});
test('closing selection card cancels its request while pending input remains independent',async()=>{
 const h=setup(),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));const selection=h.ui.translateSelection();const field=input(h),task=h.ui.translateInput();const close=popup(h).shadowRoot.querySelector('header').children.at(-1);h.emit(close,'click');assert.deepEqual(h.cancellations,['request-1']);finishes[1]({translations:['你好']});assert.equal((await task).applied,true);assert.equal(field.value,'你好');finishes[0]({translations:['Late']});await selection;h.ui.stop();
});
test('explicit input preview and pinned selection remain separate and usable',async()=>{
 const h=setup();await h.ui.translateSelection();h.emit(action(h,'pin'),'click');const host=popup(h),field=input(h);h.settings.inputOptions.autoApply=false;h.ui.updateSettings();await h.ui.translateInput();assert.equal(popup(h),host);const preview=h.doc.getElementById('kuai-input-preview');assert.ok(preview);assert.equal(field.value,'hello');h.emit(preview.shadowRoot.querySelector('[data-apply]'),'click');assert.equal(field.value,'译：hello');assert.equal(popup(h),host);h.ui.stop();
});
test('empty eligible field shows a dot without a request; readonly and sensitive fields do not',()=>{
 const h=setup(),field=input(h);field.value='';h.emit(field,'focusin');assert.ok(h.doc.getElementById('kuai-input-trigger'));assert.equal(h.requests.length,0);field.readOnly=true;h.emit(field,'focusin');assert.equal(h.doc.getElementById('kuai-input-trigger'),null);field.readOnly=false;field.setAttribute('autocomplete','one-time-code');h.emit(field,'focusin');assert.equal(h.doc.getElementById('kuai-input-trigger'),null);h.ui.stop();
});

test('decorative title region starts pinned drag and stop releases all movement listeners',async()=>{
 const h=setup();await h.ui.translateSelection();h.emit(action(h,'pin'),'click');const host=popup(h),title=host.shadowRoot.querySelector('header').querySelector('span');h.emit(title,'pointerdown',{clientX:0,clientY:0,pointerId:3});h.emit(h.doc,'pointermove',{clientX:40,clientY:30,pointerId:3});assert.equal(host.style.left,'52px');h.ui.stop();h.emit(h.doc,'pointermove',{clientX:90,clientY:80,pointerId:3});assert.equal(host.style.left,'52px');assert.equal(host.isConnected,false);
});
for(const change of ['route','settings'])test(`input ${change} invalidation cancels quietly and rejects a late replacement`,async()=>{
 const h=setup(),field=input(h);let finish;h.respond(()=>new Promise(resolve=>finish=resolve));const task=h.ui.translateInput();if(change==='route')h.env.location.href+='?next';else h.settings.inputOptions.enabled=false;h.ui.updateSettings();assert.deepEqual(h.cancellations,['request-1']);finish({translations:['Late']});assert.deepEqual(await task,{cancelled:true});assert.equal(field.value,'hello');assert.equal(!!popup(h),false);h.ui.stop();
});
test('unpin with valid source keeps card and closing clears the pin for a later selection',async()=>{
 const h=setup();await h.ui.translateSelection();h.emit(action(h,'pin'),'click');h.emit(action(h,'pin'),'click');assert.ok(popup(h));assert.equal(action(h,'pin').getAttribute('aria-pressed'),'false');h.emit(action(h,'pin'),'click');const close=popup(h).shadowRoot.querySelector('header').children.at(-1);h.emit(close,'click');await h.ui.translateSelection();assert.equal(action(h,'pin').getAttribute('aria-pressed'),'false');deselect(h);assert.equal(!!popup(h),false);h.ui.stop();
});

function nativeFocus(h,from,to,host=null){
 h.doc.activeElement=h.doc.body;h.emit(from,'focusout',{relatedTarget:host||to});
 h.doc.activeElement=host||to;if(host)host.shadowRoot.activeElement=to;
 h.emit(to,'focusin',{relatedTarget:from});h.flushTimers();
}
test('native focus transitions retain preview text and controls while invalidating unsafe Apply',async()=>{
 const h=setup(),field=input(h);h.settings.inputOptions.autoApply=false;let copied;h.env.navigator.clipboard={writeText:async text=>{copied=text;}};await h.ui.translateInput();const preview=h.doc.getElementById('kuai-input-preview'),copy=preview.shadowRoot.querySelector('[data-copy]'),apply=preview.shadowRoot.querySelector('[data-apply]'),output=preview.shadowRoot.querySelector('[data-translation]'),text=output.firstChild;
 nativeFocus(h,field,copy,preview);assert.equal(copy.isConnected,true);assert.equal(preview.isConnected,true);assert.equal(apply.disabled,true);assert.equal(h.ui.applyInput(),false);assert.equal(field.value,'hello');h.emit(copy,'click');await settle();assert.equal(copied,'译：hello');assert.equal(output.firstChild===text,true);
 h.emit(output,'pointerdown');h.doc.activeElement=h.doc.body;h.emit(copy,'focusout',{relatedTarget:null});h.select(output);h.flushTimers();assert.equal(preview.isConnected,true);assert.equal(text.isConnected,true);assert.equal(field.value,'hello');h.ui.stop();
});
test('native focus into quiet Retry retains control and explicitly retries a fresh field snapshot',async()=>{
 const h=setup(),field=input(h);h.respond(async()=>{throw Error('offline');});await assert.rejects(h.ui.translateInput());const host=h.doc.getElementById('kuai-input-trigger'),retry=feedback(h,'retry');nativeFocus(h,field,retry,host);assert.equal(retry.isConnected,true);field.value='fresh';field.setSelectionRange(0,5);h.respond(async()=>({translations:['新的']}));h.emit(retry,'click');await settle();assert.equal(h.requests[1].texts[0],'fresh');assert.equal(field.value,'新的');assert.equal(!!popup(h),false);h.ui.stop();
});
test('native focus into Restore retains feedback but cannot restore after focus invalidated its guard',async()=>{
 const h=setup(),field=input(h);h.env.navigator.clipboard={writeText:async()=>{}};await h.ui.translateInput();const host=h.doc.getElementById('kuai-input-trigger'),restore=feedback(h,'restore');nativeFocus(h,field,restore,host);assert.equal(restore.isConnected,true);assert.equal(restore.disabled,true);assert.equal(h.ui.restoreInput(),false);assert.equal(field.value,'译：hello');assert.equal(feedback(h,'copy').hidden,false);h.ui.stop();
});
for(const [name,rect,viewport]of [
 ['top-left',{left:0,top:0,right:100,bottom:30,width:100,height:30},{width:320,height:200}],
 ['bottom-right',{left:270,top:170,right:320,bottom:200,width:50,height:30},{width:320,height:200}],
 ['narrow',{left:0,top:0,right:12,bottom:12,width:12,height:12},{width:90,height:80}],
])test('silent retry icon fits '+name+' viewport without a text popup',async()=>{
 const h=setup(),field=input(h);Object.assign(h.env,{innerWidth:viewport.width,innerHeight:viewport.height});field._rect=rect;
 h.respond(async()=>{throw Error('offline');});await assert.rejects(h.ui.translateInput());
 const host=h.doc.getElementById('kuai-input-trigger'),box=host.shadowRoot.querySelector('.feedback');
 h.emit(feedback(h,'trigger'),'click');h.emit(h.env,'resize');const action=feedback(h,'translate');
 assert.equal(box.hidden,true);assert.equal(action.hidden,false);assert.equal(action.getAttribute('data-state'),'error');
 const left=parseFloat(host.style.left),actionLeft=action.style.left==='auto'?left-33:left+Math.min(18,rect.width)+5;
 assert.ok(actionLeft>=0);assert.ok(actionLeft+28<=viewport.width);assert.equal(!!popup(h),false);h.ui.stop();
});

test('loading dot in a second field cancels its current request without restarting or applying late output',async()=>{
 const h=setup(),first=input(h);await h.ui.translateInput();const second=h.paragraph('','textarea');second.value='second';second.setSelectionRange(0,6);nativeFocus(h,first,second);const host=h.doc.getElementById('kuai-input-trigger'),dot=host.shadowRoot.querySelector('[data-trigger]');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));h.emit(dot,'pointerdown');h.emit(dot,'click');assert.equal(h.requests.length,1);h.emit(feedback(h,'translate'),'click');assert.equal(h.requests.length,2);assert.equal(h.ui.getState().status,'loading');assert.equal(dot.textContent,'');assert.equal(feedback(h,'translate').getAttribute('data-state'),'loading');assert.equal(h.doc.getElementById('kuai-input-trigger')===host,true);h.emit(dot,'pointerdown');h.emit(dot,'click');assert.equal(h.requests.length,2);assert.deepEqual(h.cancellations,['request-2']);assert.equal(h.ui.getState().status,'idle');finish({translations:['late']});await settle();assert.equal(second.value,'second');assert.equal(first.value,'译：hello');assert.equal(h.ui.getState().status,'idle');assert.equal(!!popup(h),false);h.ui.stop();
});
