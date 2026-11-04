import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,Event} from './helpers/content-dom.cjs';
import {createInteractions} from '../dist/src/content/interactions.js';

const settle=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function field(h){const input=h.paragraph('','textarea');input.value='Keep hello tail';input.setSelectionRange(5,10);input.focus();h.respond(async()=>({translations:['你好']}));return input;}
const key=(h,input,name='x',flags={altKey:true})=>h.emit(input,'keydown',{key:name,code:/^[a-z]$/i.test(name)?'Key'+name.toUpperCase():undefined,...flags});
const popupAction=(h,attribute)=>(h.doc.getElementById('kuai-input-preview')||h.doc.getElementById('kuai-input-trigger'))?.shadowRoot.querySelector('['+attribute+']');

test('input shortcut matches exact modifiers and repeat cannot translate twice',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();
 assert.equal(key(h,input,'x',{altKey:true,ctrlKey:true}).defaultPrevented,false);assert.equal(key(h,input,'x',{altKey:true,repeat:true}).defaultPrevented,false);assert.equal(key(h,input,'x',{altKey:true,isComposing:true}).defaultPrevented,false);await settle();assert.equal(h.requests.length,0);
 assert.equal(key(h,input).defaultPrevented,true);await settle();assert.equal(input.value,'Keep 你好 tail');assert.equal(h.requests.length,1);ui.stop();
});

test('repeated main shortcut restores the last unchanged successful input edit',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();key(h,input);await settle();assert.equal(input.value,'Keep 你好 tail');key(h,input);await settle();assert.equal(input.value,'Keep hello tail');assert.equal(input.selectionStart,5);assert.equal(input.selectionEnd,10);assert.equal(h.requests.length,1);ui.stop();
});

test('dedicated restore button and shortcut restore without making a translation request',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();const restore=popupAction(h,'data-restore');assert.ok(restore);assert.equal(restore.hidden,false);h.emit(restore,'pointerdown');h.emit(restore,'click');assert.equal(input.value,'Keep hello tail');
 await ui.translateInput();assert.equal(key(h,input,'z',{ctrlKey:true,shiftKey:true}).defaultPrevented,true);assert.equal(input.value,'Keep hello tail');assert.equal(h.requests.length,2);ui.stop();
});

for(const [order,want]of [['original-translation','Keep hello\n你好 tail'],['translation-original','Keep 你好\nhello tail']])test(`input can include the original in ${order} order`,async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={includeOriginal:true,displayOrder:order};const ui=createInteractions(h.dependencies).start();await ui.translateInput();assert.equal(input.value,want);ui.stop();
});

test('preview mode applies only after an explicit Apply action',async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={autoApply:false};const ui=createInteractions(h.dependencies).start();const result=await ui.translateInput();assert.equal(result.applied,false);assert.equal(input.value,'Keep hello tail');const apply=popupAction(h,'data-apply');assert.ok(apply);assert.equal(apply.hidden,false);h.emit(apply,'pointerdown');h.emit(apply,'click');assert.equal(input.value,'Keep 你好 tail');ui.stop();
});

test('a real edit invalidates a pending snapshot even if text and caret are changed back',async()=>{
 const h=fixture(),input=field(h);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const task=ui.translateInput();input.value='Other';h.emit(input,'input');input.value='Keep hello tail';input.setSelectionRange(5,10);h.emit(input,'input');finish({translations:['你好']});const result=await task;assert.equal(result.applied,false);assert.equal(input.value,'Keep hello tail');assert.equal(ui.getState().translation,'你好');ui.stop();
});

test('composition blocks shortcut activation and invalidates an earlier pending replacement',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();h.emit(input,'compositionstart');assert.equal(key(h,input).defaultPrevented,false);await settle();assert.equal(h.requests.length,0);h.emit(input,'compositionend');
 let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const task=ui.translateInput();h.emit(input,'compositionstart');h.emit(input,'compositionend');finish({translations:['你好']});const result=await task;assert.equal(result.applied,false);assert.equal(input.value,'Keep hello tail');ui.stop();
});

for(const autocomplete of ['current-password','new-password','one-time-code','cc-number','section-checkout cc-csc'])test(`sensitive ${autocomplete} fields never send text`,async()=>{
 const h=fixture(),input=h.paragraph('','input');input.value='sensitive';input.setAttribute('autocomplete',autocomplete);input.focus();const ui=createInteractions(h.dependencies).start();await assert.rejects(ui.translateInput());assert.equal(h.requests.length,0);assert.equal(key(h,input).defaultPrevented,false);ui.stop();
});

test('disabled features and unsupported fields never consume ordinary keyboard shortcuts',async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={enabled:false};const ui=createInteractions(h.dependencies).start();assert.equal(key(h,input).defaultPrevented,false);h.settings.inputOptions.enabled=true;input.readOnly=true;assert.equal(key(h,input).defaultPrevented,false);input.readOnly=false;input.type='password';input.tagName='INPUT';assert.equal(key(h,input).defaultPrevented,false);await settle();assert.equal(h.requests.length,0);ui.stop();
});

test('focus leaving and returning invalidates pending application and restore ownership',async()=>{
 const h=fixture(),input=field(h);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const task=ui.translateInput();h.emit(input,'focusout');h.doc.body.focus();input.focus();h.emit(input,'focusin');finish({translations:['你好']});assert.equal((await task).applied,false);assert.equal(input.value,'Keep hello tail');ui.stop();
});

test('an input type changed to password while translating cannot receive the result',async()=>{
 const h=fixture(),input=h.paragraph('','input');input.value='hello';input.setSelectionRange(0,5);input.focus();let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const task=ui.translateInput();input.type='password';finish({translations:['你好']});assert.equal((await task).applied,false);assert.equal(input.value,'hello');ui.stop();
});

test('focus icon translates its current field without stealing focus or text selection',async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon:'dot'};const ui=createInteractions(h.dependencies).start();h.emit(input,'focusin');const trigger=h.doc.getElementById('kuai-input-trigger')?.shadowRoot.querySelector('button');assert.ok(trigger);assert.equal(h.emit(trigger,'pointerdown').defaultPrevented,true);h.emit(trigger,'click');await settle();assert.equal(h.requests.length,0);assert.equal(input.value,'Keep hello tail');const translate=h.doc.getElementById('kuai-input-trigger').shadowRoot.querySelector('[data-translate]');assert.ok(translate);assert.equal(translate.hidden,false);h.emit(translate,'click');await settle();assert.strictEqual(h.doc.activeElement,input);assert.equal(input.value,'Keep 你好 tail');ui.stop();
});

test('an edited input cannot be restored by the dedicated shortcut',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();input.value='New draft';h.emit(input,'input');assert.equal(key(h,input,'z',{ctrlKey:true,shiftKey:true}).defaultPrevented,false);assert.equal(input.value,'New draft');ui.stop();
});

test('safe rich text replacement preserves the existing text and inline element identities',async()=>{
 const h=fixture(),editor=h.paragraph('','div');editor.setAttribute('contenteditable','true');const strong=h.doc.createElement('strong');strong.textContent='Keep hello tail';editor.append(strong);editor.focus();const text=strong.firstChild;h.setRange(text,5,text,10);h.respond(async()=>({translations:['你好']}));const ui=createInteractions(h.dependencies).start();
 const result=await ui.translateInput();assert.equal(result.applied,true);assert.strictEqual(strong.firstChild,text);assert.equal(text.nodeValue,'Keep 你好 tail');assert.equal(strong.childNodes.length,1);ui.stop();
});

test('a rich selection spanning inline elements stays a copyable preview without flattening the editor',async()=>{
 const h=fixture(),editor=h.paragraph('','div');editor.setAttribute('contenteditable','true');const strong=h.doc.createElement('strong'),em=h.doc.createElement('em');strong.textContent='hello ';em.textContent='world';editor.append(strong,em);editor.focus();h.setRange(strong.firstChild,0,em.firstChild,5);h.respond(async()=>({translations:['你好世界']}));const ui=createInteractions(h.dependencies).start();
 const result=await ui.translateInput();assert.equal(result.applied,false);assert.equal(editor.textContent,'hello world');assert.strictEqual(editor.firstChild,strong);assert.equal(ui.getState().translation,'你好世界');ui.stop();
});

test('an edit cannot be restored on a new route even before a runtime settings notification',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();h.env.location.href='https://example.org/next';
 assert.equal(key(h,input,'z',{ctrlKey:true,shiftKey:true}).defaultPrevented,false);assert.equal(input.value,'Keep 你好 tail');ui.updateSettings();assert.equal(ui.restoreInput(),false);ui.stop();
});

test('an independent input request survives unrelated page language and presentation updates',async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={providerId:'google',sourceLanguage:'en',targetLanguage:'de'};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const task=ui.translateInput();
 h.settings.targetLanguage='fr';h.settings.pageStyle={fontSize:130};ui.updateSettings();assert.deepEqual(h.requests[0].options,{requestId:'request-1',providerId:'google',sourceLanguage:'en',targetLanguage:'de'});assert.equal(h.cancellations.length,0);finish({translations:['Hallo']});assert.equal((await task).applied,true);assert.equal(input.value,'Keep Hallo tail');ui.stop();
});

test('a shadow editor uses its own selected text and restores the same text node',async()=>{
 const h=fixture(),host=h.paragraph('','div'),shadow=host.attachShadow(),editor=h.doc.createElement('div');editor.setAttribute('contenteditable','true');editor.textContent='Keep hello tail';shadow.append(editor);const node=editor.firstChild,local=h.setRange(node,5,node,10);h.doc.selection=null;shadow.getSelection=()=>local;shadow.activeElement=editor;h.doc.activeElement=host;
 h.respond(async()=>({translations:['你好']}));const ui=createInteractions(h.dependencies).start();assert.equal((await ui.translateInput()).applied,true);assert.deepEqual(h.requests[0].texts,['hello']);assert.equal(node.nodeValue,'Keep 你好 tail');assert.equal(ui.restoreInput(),true);assert.strictEqual(editor.firstChild,node);assert.equal(node.nodeValue,'Keep hello tail');ui.stop();
});

test('a delegated beforeinput veto prevents both automatic and explicit preview replacement',async()=>{
 const h=fixture(),input=field(h);h.doc.addEventListener('beforeinput',event=>event.preventDefault());const ui=createInteractions(h.dependencies).start();assert.equal((await ui.translateInput()).applied,false);assert.equal(input.value,'Keep hello tail');
 h.settings.inputOptions={autoApply:false};ui.updateSettings();await ui.translateInput();assert.equal(ui.applyInput(),false);assert.equal(input.value,'Keep hello tail');ui.stop();
});


test('expanded dot dismisses on outside click and field change without requests',()=>{
 const h=fixture(),first=field(h),ui=createInteractions(h.dependencies).start();
 const root=()=>h.doc.getElementById('kuai-input-trigger').shadowRoot;
 const dot=()=>root().querySelector('[data-trigger]'),translate=()=>root().querySelector('[data-translate]');
 assert.equal(translate().hidden,true);h.emit(dot(),'click');assert.equal(translate().hidden,false);
 h.emit(h.doc.body,'pointerdown');assert.equal(translate().hidden,true);
 h.emit(dot(),'click');const second=h.paragraph('','textarea');second.value='other';second.focus();h.emit(second,'focusin');
 assert.equal(translate().hidden,true);assert.equal(h.requests.length,0);assert.equal(first.value,'Keep hello tail');ui.stop();
});

test('keyboard activation of the expanded translation action uses its field and target language',async()=>{
 const h=fixture(),input=field(h);h.settings.inputOptions={icon:'dot',targetLanguage:'ja'};
 const ui=createInteractions(h.dependencies).start(),root=h.doc.getElementById('kuai-input-trigger').shadowRoot;
 h.emit(root.querySelector('[data-trigger]'),'click');const action=root.querySelector('[data-translate]');
 action.focus();h.emit(action,'click');await settle();assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].options.targetLanguage,'ja');assert.equal(input.value,'Keep 你好 tail');ui.stop();
});


test('clicking the dot after translation expands the action without restoring the input',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();
 const root=h.doc.getElementById('kuai-input-trigger').shadowRoot;h.emit(root.querySelector('[data-trigger]'),'click');
 assert.equal(input.value,'Keep 你好 tail');assert.equal(root.querySelector('[data-translate]').hidden,false);assert.equal(h.requests.length,1);ui.stop();
});


test('expanded icon translates, shows a check and restores without a second request or text popup',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();
 const root=()=>h.doc.getElementById('kuai-input-trigger').shadowRoot;
 h.emit(root().querySelector('[data-trigger]'),'click');const action=root().querySelector('[data-translate]');
 assert.equal(action.getAttribute('data-state'),'idle');h.emit(action,'pointerdown');h.emit(action,'click');await settle();
 assert.equal(input.value,'Keep 你好 tail');assert.equal(action.hidden,false);assert.equal(action.getAttribute('data-state'),'translated');
 assert.equal(action.querySelector('[data-check]').hasAttribute('hidden'),false);assert.equal(root().querySelector('.feedback').hidden,true);
 h.emit(action,'pointerdown');h.emit(action,'click');await settle();
 assert.equal(input.value,'Keep hello tail');assert.equal(h.requests.length,1);assert.equal(action.getAttribute('data-state'),'idle');
 assert.equal(action.querySelector('[data-check]').hasAttribute('hidden'),true);assert.equal(action.hidden,false);assert.equal(root().querySelector('.feedback').hidden,true);ui.stop();
});

test('input edits clear the completed icon and prevent stale restoration',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();
 const root=h.doc.getElementById('kuai-input-trigger').shadowRoot;
 assert.equal(root.querySelector('[data-translate]').getAttribute('data-state'),'translated');
 input.value='new draft';h.emit(input,'input');assert.equal(root.querySelector('[data-translate]').getAttribute('data-state'),'idle');assert.equal(ui.restoreInput(),false);assert.equal(input.value,'new draft');ui.stop();
});

test('icon loading and errors remain silent and support cancel and retry',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const root=h.doc.getElementById('kuai-input-trigger').shadowRoot;
 h.emit(root.querySelector('[data-trigger]'),'click');const action=root.querySelector('[data-translate]');h.emit(action,'click');
 assert.equal(action.hidden,false);assert.equal(action.getAttribute('data-state'),'loading');assert.equal(root.querySelector('.feedback').hidden,true);
 h.emit(action,'click');finish({translations:['late']});await settle();assert.equal(input.value,'Keep hello tail');
 h.respond(async()=>{throw Error('offline');});h.emit(root.querySelector('[data-trigger]'),'click');h.emit(action,'click');await settle();
 assert.equal(action.getAttribute('data-state'),'error');assert.equal(root.querySelector('.feedback').hidden,true);
 h.respond(async()=>({translations:['done']}));h.emit(action,'click');await settle();assert.equal(input.value,'Keep done tail');assert.equal(action.getAttribute('data-state'),'translated');ui.stop();
});


for(const [start,end]of [[0,0],[0,2]])test('Alt+X restores unchanged translation after caret/selection moves '+start+':'+end,async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();key(h,input);await settle();
 input.setSelectionRange(start,end);key(h,input);await settle();
 assert.equal(input.value,'Keep hello tail');assert.equal(h.requests.length,1);assert.equal(input.selectionStart,5);assert.equal(input.selectionEnd,10);ui.stop();
});

test('Alt+X restores unchanged rich text after its selection moves',async()=>{
 const h=fixture(),editor=h.paragraph('hello','div');editor.setAttribute('contenteditable','true');editor.focus();const text=editor.firstChild;h.setRange(text,0,text,5);
 const ui=createInteractions(h.dependencies).start();key(h,editor);await settle();assert.equal(text.nodeValue,'译：hello');
 h.setRange(text,0,text,0);key(h,editor);await settle();assert.equal(text.nodeValue,'hello');assert.equal(h.requests.length,1);ui.stop();
});

test('Alt+X restoration tolerates a site changing only field styling',async()=>{
 const h=fixture(),input=field(h),observers=[];
 h.env.MutationObserver=class{constructor(callback){this.callback=callback;this.records=[];observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}takeRecords(){return this.records.splice(0);}};
 const ui=createInteractions(h.dependencies).start();key(h,input);await settle();input.setAttribute('class','translated-field');
 for(const observer of observers)if(observer.active)observer.records.push({type:'attributes',attributeName:'class',target:input});
 key(h,input);await settle();assert.equal(input.value,'Keep hello tail');assert.equal(h.requests.length,1);ui.stop();
});

test('restoration after a caret move still respects beforeinput cancellation',async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();input.setSelectionRange(0,0);
 input.addEventListener('beforeinput',event=>event.preventDefault());assert.equal(ui.restoreInput(),false);assert.equal(input.value,'Keep 你好 tail');ui.stop();
});


for(const change of ['text','readonly','password','focus'])test('restore after caret movement still rejects '+change,async()=>{
 const h=fixture(),input=field(h),ui=createInteractions(h.dependencies).start();await ui.translateInput();input.setSelectionRange(0,0);
 if(change==='text')input.value='other';if(change==='readonly')input.readOnly=true;if(change==='password'){input.tagName='INPUT';input.type='password';}if(change==='focus'){h.emit(input,'focusout');h.doc.body.focus();}
 const before=input.value;assert.equal(ui.restoreInput(),false);assert.equal(input.value,before);ui.stop();
});

test('restore cannot write to a replaced rich text node even if its markup is identical',async()=>{
 const h=fixture(),editor=h.paragraph('','div');editor.setAttribute('contenteditable','true');const strong=h.doc.createElement('strong');strong.textContent='hello';editor.append(strong);editor.focus();h.setRange(strong.firstChild,0,strong.firstChild,5);
 const ui=createInteractions(h.dependencies).start();await ui.translateInput();const replacement=h.doc.createElement('strong');replacement.textContent=strong.textContent;editor.replaceChildren(replacement);
 assert.equal(ui.restoreInput(),false);assert.equal(replacement.textContent,'译：hello');ui.stop();
});


test('rich text structural mutations still invalidate restoration even if markup is restored',async()=>{
 const h=fixture(),editor=h.paragraph('hello','div'),observers=[];editor.setAttribute('contenteditable','true');editor.focus();h.setRange(editor.firstChild,0,editor.firstChild,5);
 h.env.MutationObserver=class{constructor(){this.records=[];observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}takeRecords(){return this.records.splice(0);}};
 const ui=createInteractions(h.dependencies).start();await ui.translateInput();const text=editor.firstChild;text.remove();editor.append(text);
 for(const observer of observers)if(observer.active)observer.records.push({type:'childList',target:editor});
 assert.equal(ui.restoreInput(),false);assert.equal(editor.textContent,'译：hello');ui.stop();
});
