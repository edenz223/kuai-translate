import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,Event} from './helpers/content-dom.cjs';
import {createInteractions} from '../src/content/interactions.js';
import {createController as createSubtitleSelection} from '../src/youtube/selection.js';

const settle=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const button=(h,name)=>h.doc.getElementById(name)?.shadowRoot?.querySelector('button');
function keyboard(h,type,key,flags={}){return h.emit(h.doc,type,{key,...flags});}

test('a real left mouse release translates once and reselecting after dismissal translates again',async()=>{
 const h=fixture(),p=h.paragraph('Actual mouse selection');h.select(p);const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mouseup',{button:0});h.flushTimers();await settle();assert.equal(h.requests.length,1);
 h.emit(p,'mouseup',{button:0});h.flushTimers();await settle();assert.equal(h.requests.length,1);
 ui.cancelCurrent();h.emit(p,'mouseup',{button:0});h.flushTimers();await settle();assert.equal(h.requests.length,2);ui.stop();
});

test('equal words in different ranges of the same text node are separate selections',async()=>{
 const h=fixture(),p=h.paragraph('word word');const ui=createInteractions(h.dependencies).start();
 h.select(p,'word',{start:0,end:4});h.emit(p,'mouseup',{button:0});h.flushTimers();await settle();
 h.select(p,'word',{start:5,end:9});h.emit(p,'mouseup',{button:0});h.flushTimers();await settle();assert.equal(h.requests.length,2);ui.stop();
});

for(const mode of ['icon','dot'])test(`${mode} selection preserves the range and waits for explicit activation`,async()=>{
 const h=fixture(),p=h.paragraph('Choose me');h.settings.selectionOptions={triggerMode:mode,triggerAction:'click'};h.select(p);
 const selected=h.doc.selection,ui=createInteractions(h.dependencies).start();h.emit(p,'mouseup',{button:0});h.flushTimers();await settle();assert.equal(h.requests.length,0);
 const activate=button(h,'kuai-selection-trigger');assert.ok(activate);const down=h.emit(activate,'pointerdown',{button:0});assert.equal(down.defaultPrevented,true);assert.strictEqual(h.doc.selection,selected);
 h.emit(activate,'click');await settle();assert.equal(h.requests.length,1);assert.strictEqual(h.doc.selection,selected);ui.stop();
});

test('selection hover activation waits for its delay and leaving the button cancels it',async()=>{
 const h=fixture(),p=h.paragraph('Delayed');h.settings.selectionOptions={triggerMode:'icon',triggerAction:'hover',delay:200};h.select(p);const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,0);const activate=button(h,'kuai-selection-trigger');assert.ok(activate);
 h.emit(activate,'mouseenter');h.advance(199);await settle();assert.equal(h.requests.length,0);h.emit(activate,'mouseleave');h.advance(1);await settle();assert.equal(h.requests.length,0);
 h.emit(activate,'mouseenter');h.advance(200);await settle();assert.equal(h.requests.length,1);ui.stop();
});

test('a selection modifier can be pressed after selection and repeated keydown is ignored',async()=>{
 const h=fixture(),p=h.paragraph('Control selection');h.settings.selectionOptions={triggerMode:'ctrl',delay:50};h.select(p);const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,0);
 keyboard(h,'keydown','Control',{ctrlKey:true});keyboard(h,'keydown','Control',{ctrlKey:true,repeat:true});h.advance(50);await settle();assert.equal(h.requests.length,1);ui.stop();
});

for(const [trigger,key,flag] of [['ctrl','Control','ctrlKey'],['shift','Shift','shiftKey'],['alt','Alt','altKey']])test(`${trigger} paragraph shortcut toggles after release under a stationary pointer`,async()=>{
 const h=fixture(),p=h.paragraph('Stationary');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger,delay:100};const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mousemove');keyboard(h,'keydown',key,{[flag]:true});h.advance(100);await settle();assert.equal(h.requests.length,0);keyboard(h,'keyup',key);await settle();assert.deepEqual(h.requests.map(r=>r.texts),[['Stationary']]);ui.stop();
});

test('custom paragraph gesture requires both keys and toggles on release',async()=>{
 const h=fixture(),p=h.paragraph('Custom keys');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'custom',customKeys:['Control','Q'],delay:100};const ui=createInteractions(h.dependencies).start();h.emit(p,'mousemove');
 keyboard(h,'keydown','Control',{ctrlKey:true});h.advance(200);await settle();assert.equal(h.requests.length,0);
 keyboard(h,'keydown','q',{ctrlKey:true});h.advance(50);keyboard(h,'keyup','q',{ctrlKey:true});h.advance(100);await settle();assert.equal(h.requests.length,1);assert.ok(p.querySelector('[data-kuai-page-translation]'));
 keyboard(h,'keydown','q',{ctrlKey:true});keyboard(h,'keyup','q',{ctrlKey:true});h.advance(100);await settle();assert.equal(h.requests.length,1);assert.equal(p.querySelector('[data-kuai-page-translation]'),null);ui.stop();
});

for(const action of ['invalid-target','Escape','blur','hidden','selection'])test(`pending hover is cancelled by ${action}`,async()=>{
 const h=fixture(),p=h.paragraph('Pending hover');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',delay:100};const ui=createInteractions(h.dependencies).start();h.emit(p,'mousemove');keyboard(h,'keydown','Alt',{altKey:true});
 if(action==='invalid-target')h.emit(h.doc.body,'mousemove',{altKey:true});
 if(action==='Escape')keyboard(h,'keydown','Escape',{altKey:true});
 if(action==='blur')h.env.dispatchEvent(new Event('blur'));
 if(action==='hidden'){h.doc.visibilityState='hidden';h.emit(h.doc,'visibilitychange');}
 if(action==='selection'){h.select(p);h.emit(h.doc,'selectionchange');}
 keyboard(h,'keyup','Alt');h.advance(1000);await settle();assert.equal(h.requests.length,0);ui.stop();
});

test('left hold waits for hold and hover delays and never fights drag selection',async()=>{
 const h=fixture(),p=h.paragraph('Left hold');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'left_hold',holdDelay:300,delay:100};const ui=createInteractions(h.dependencies).start();
 h.emit(p,'mousedown',{buttons:1});h.advance(399);await settle();assert.equal(h.requests.length,0);h.advance(1);await settle();assert.equal(h.requests.length,1);
 h.emit(p,'mouseup');ui.cancelCurrent();h.emit(p,'mousedown',{buttons:1});h.select(p);h.emit(h.doc,'selectionchange');h.advance(1000);await settle();assert.equal(h.requests.length,1);ui.stop();
});

test('selection limits and disabled sites prevent requests while independent services are honored',async()=>{
 const h=fixture(),p=h.paragraph('Hello');h.settings.selectionOptions={providerId:'google',sourceLanguage:'en',targetLanguage:'de',maxLength:4};const ui=createInteractions(h.dependencies).start();h.select(p);h.emit(p,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,0);
 h.settings.selectionOptions.maxLength=100;h.settings.selectionOptions.disabledSites=['example.org'];ui.updateSettings();h.emit(p,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,0);
 h.settings.selectionOptions.disabledSites=[];ui.updateSettings();h.emit(p,'mouseup');h.flushTimers();await settle();assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].options,{requestId:'request-1',providerId:'google',sourceLanguage:'en',targetLanguage:'de'});ui.stop();
});

test('unrelated global language changes preserve a request using independent selection settings',async()=>{
 const h=fixture();h.settings.selectionOptions={providerId:'google',sourceLanguage:'en',targetLanguage:'de'};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();const pending=ui.translateSelection({text:'Hello'});
 h.settings.targetLanguage='fr';ui.updateSettings();finish({translations:['Hallo']});await pending;assert.equal(ui.getState().translation,'Hallo');assert.equal(h.cancellations.length,0);ui.stop();
});

test('optional source word pronunciation uses only a matching installed local voice',async()=>{
 const h=fixture(),spoken=[];h.settings.selectionOptions={autoSpeak:true,sourceLanguage:'en'};h.env.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 h.env.speechSynthesis={getVoices:()=>[{name:'Remote',lang:'en-US',localService:false}],speak:utterance=>spoken.push(utterance)};const ui=createInteractions(h.dependencies).start();await ui.translateSelection({text:'hello'});assert.equal(spoken.length,0);
 const local={name:'Local',lang:'en-GB',localService:true};h.env.speechSynthesis.getVoices=()=>[local];await ui.translateSelection({text:'hello'});assert.equal(spoken.length,1);assert.strictEqual(spoken[0].voice,local);
 await ui.translateSelection({text:'two words'});assert.equal(spoken.length,1);ui.stop();
});

test('direct hover reads one paragraph without requiring a key',async()=>{
 const h=fixture(),p=h.paragraph('Direct hover');h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'hover',delay:50};const ui=createInteractions(h.dependencies).start();h.emit(p,'mousemove');h.advance(50);await settle();assert.deepEqual(h.requests.map(item=>item.texts),[['Direct hover']]);ui.stop();
});

test('area hover reads each descendant block once and applies page language and selector exclusions',async()=>{
 const h=fixture(),area=h.paragraph('Heading ','section'),first=h.doc.createElement('p'),blocked=h.doc.createElement('p'),excluded=h.doc.createElement('p'),last=h.doc.createElement('p');
 first.textContent='First';blocked.textContent='Bonjour';blocked.setAttribute('lang','fr');excluded.textContent='Private region';excluded.className='skip';last.textContent='Last';area.append(first,blocked,excluded,last);
 h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',mode:'area',displayMode:'popup',delay:50};h.settings.pageOptions={neverLanguages:['fr'],excludeSelectors:['.skip']};
 const ui=createInteractions(h.dependencies).start();h.emit(first,'mousemove');keyboard(h,'keydown','Alt',{altKey:true});keyboard(h,'keyup','Alt');h.advance(50);await settle();assert.deepEqual(h.requests.map(item=>item.texts),[['Heading','First','Last']]);ui.stop();
});

for(const cause of ['key-release','target-removed'])test('an accepted paragraph request handles '+cause+' without requiring a held key',async()=>{
 const h=fixture(),p=h.paragraph('Pending response');h.settings.hoverEnabled=true;let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();h.emit(p,'mousemove');keyboard(h,'keydown','Shift',{shiftKey:true});keyboard(h,'keyup','Shift');await settle();assert.equal(h.requests.length,1);
 if(cause==='key-release')keyboard(h,'keyup','Shift');else p.remove();finish({translations:['Ready']});await settle();
 assert.equal(p.querySelector('[data-kuai-page-translation]')?.textContent,cause==='key-release'?'Ready':undefined);assert.equal(ui.getState().translation,'');assert.equal(h.doc.getElementById('kuai-translation-popup'),null);ui.stop();
});

test('selection hover mode does not bypass its delay when the icon is clicked',async()=>{
 const h=fixture(),p=h.paragraph('Wait for hover');h.settings.selectionOptions={triggerMode:'icon',triggerAction:'hover',delay:200};h.select(p);const ui=createInteractions(h.dependencies).start();h.emit(p,'mouseup');h.flushTimers();await settle();
 const activate=button(h,'kuai-selection-trigger');h.emit(activate,'mouseenter');h.emit(activate,'click');await settle();assert.equal(h.requests.length,0);h.advance(200);await settle();assert.equal(h.requests.length,1);ui.stop();
});

test('async paragraph language detection cannot send after its shortcut toggles the pending claim off',async()=>{
 const h=fixture(),p=h.paragraph('Language pending');h.settings.hoverEnabled=true;h.settings.pageOptions={neverLanguages:['fr']};let finish;
 h.env.chrome={i18n:{detectLanguage:()=>new Promise(resolve=>{finish=resolve;})}};const ui=createInteractions(h.dependencies).start();h.emit(p,'mousemove');keyboard(h,'keydown','Shift',{shiftKey:true});keyboard(h,'keyup','Shift');await settle();assert.equal(typeof finish,'function');
 keyboard(h,'keydown','Shift',{shiftKey:true});keyboard(h,'keyup','Shift');finish({isReliable:true,languages:[{language:'en',percentage:100}]});await settle();assert.equal(h.requests.length,0);assert.equal(h.doc.getElementById('kuai-hover-indicator'),null);ui.stop();
});

test('selection activation coexists with actual subtitle pause ownership and native mouseup propagation',async()=>{
 const h=fixture(),player=h.paragraph('','div');player.className='html5-video-player';const video=h.doc.createElement('video'),host=h.doc.createElement('div');host.id='kuai-captions-window-one';host.setAttribute('data-kuai-owned','');player.append(video,host);
 const shadow=host.attachShadow(),text=h.doc.createElement('span');text.setAttribute('data-kuai-subtitle-text','true');text.textContent='Subtitle words';shadow.append(text);shadow.getSelection=()=>h.doc.selection;
 let pauses=0,plays=0;Object.assign(video,{paused:false,ended:false,seeking:false,error:null,pause(){pauses++;this.paused=true;h.emit(this,'pause',{bubbles:false});},play(){plays++;this.paused=false;h.emit(this,'play',{bubbles:false});return Promise.resolve();}});
 const session={id:'one',video,rule:{id:'youtube'}},bridge={getSessions:()=>[session],getRoots:()=>[text],getState:()=>({}),getMediaKey:()=> 'one',isEnabled:()=>true,onHold(){},subscribe:()=>()=>{}};
 h.settings.selectionOptions={triggerMode:'icon',triggerAction:'click'};const subtitles=createSubtitleSelection(bridge,h.env).start(),ui=createInteractions(h.dependencies).start();
 h.emit(text,'mousedown',{button:0,buttons:1});h.select(text);const selected=h.doc.selection;h.emit(h.doc,'selectionchange',{bubbles:false});assert.equal(pauses,1);assert.equal(video.paused,true);
 h.emit(text,'mouseup',{button:0});h.flushTimers();await settle();const activate=button(h,'kuai-selection-trigger');assert.ok(activate);assert.equal(h.requests.length,0);h.emit(activate,'pointerdown');h.emit(activate,'mousedown');h.emit(activate,'click');await settle();
 assert.equal(h.requests.length,1);assert.strictEqual(h.doc.selection,selected);assert.equal(pauses,1);assert.equal(plays,0);assert.equal(subtitles.isHeld('one'),true);
 h.doc.selection=null;h.emit(h.doc,'selectionchange',{bubbles:false});assert.equal(plays,1);ui.stop();subtitles.stop();
});
