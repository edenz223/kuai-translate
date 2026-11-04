import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createInteractions} from '../dist/src/content/interactions.js';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {blockText,collectBlocks} from '../dist/src/content/dom.js';

const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
const outputs=h=>h.doc.querySelectorAll('[data-kuai-page-translation]');
const result=element=>element.querySelector('[data-kuai-page-translation]');
const text=element=>result(element)?.querySelector('font')?.firstChild?.textContent;
const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';
const release=h=>h.emit(h.doc,'keyup',{key:'Alt'});
function setup(overrides={}){
  const h=fixture();h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',displayMode:'inline',delay:50,...overrides};
  return h;
}
async function hover(h,element,flags={altKey:true}){h.emit(element,'mousemove',flags);if(h.settings.hoverOptions.trigger==='alt'){h.emit(h.doc,'keydown',{key:'Alt',altKey:true});h.emit(h.doc,'keyup',{key:'Alt'});}h.advance(50);await settle();}

test('paragraph output uses the page style, translation-only mode and safe plain text',async()=>{
  const h=setup(),p=h.paragraph('Hello '),link=h.doc.createElement('a');link.textContent='world';p.append(link);
  const original=p.firstChild;let clicks=0;link.addEventListener('click',()=>clicks++);
  h.settings.pageDisplayMode='translation_only';h.settings.pageStyle={preset:'border',fontSize:125,textColor:'#123456'};
  h.respond(async()=>({translations:['<img src=x onerror=alert(1)>你好']}));
  const ui=createInteractions(h.dependencies).start();await hover(h,link);
  const output=result(p);assert.ok(output,'the translation must appear inside the source paragraph');
  assert.equal(output.tagName,'KUAI-TRANSLATOR');assert.equal(p.childNodes.at(-1),output);assert.equal(output.className,'kuai-translator-wrapper notranslate');
  assert.equal(output.firstChild.tagName,'BR');assert.equal(output.querySelector('font').getAttribute('lang'),'zh-Hans');
  assert.equal(output.querySelector('font').firstChild.nodeType,3);assert.equal(text(p),'<img src=x onerror=alert(1)>你好');assert.equal(output.querySelector('img'),null);
  assert.equal(output.getAttribute('data-state'),'success');assert.match(sheet(h),/font-size:125%/);assert.match(sheet(h),/color:#123456/);assert.match(sheet(h),/border-left:2px solid/);assert.equal(output.getAttribute('style'),null);
  assert.equal(original.parentElement.hidden,true);assert.equal(link.parentElement.hidden,true);assert.ok(p.querySelector('[data-kuai-original]'));
  h.emit(link,'click');assert.equal(clicks,1);assert.equal(blockText(p,h.env),'Hello world');
  assert.deepEqual(collectBlocks(h.doc,h.env).map(item=>item.text),['Hello world']);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);
  await hover(h,p);assert.equal(result(p),null);assert.equal(p.firstChild,original);assert.equal(link.parentNode,p);ui.stop();
});

test('legacy hover settings without a display mode render inline while selections still use the popup',async()=>{
  const h=setup();delete h.settings.hoverOptions.displayMode;const p=h.paragraph('Legacy paragraph');
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(text(p),'译：Legacy paragraph');release(h);
  await ui.translateSelection({text:'Selected words'});assert.equal(ui.getState().translation,'译：Selected words');assert.ok(h.doc.getElementById('kuai-translation-popup'));assert.equal(outputs(h).length,1);ui.stop();
});

test('area hover translates eligible source units in order into their own paragraphs',async()=>{
  const h=setup({mode:'area'}),area=h.paragraph('','section'),first=h.doc.createElement('p'),blocked=h.doc.createElement('p'),excluded=h.doc.createElement('p'),last=h.doc.createElement('p');
  first.textContent='First';blocked.textContent='Bonjour';blocked.setAttribute('lang','fr');excluded.textContent='Private';excluded.className='skip';last.textContent='Last';area.append(first,blocked,excluded,last);
  h.settings.pageOptions={neverLanguages:['fr'],excludeSelectors:['.skip']};
  const ui=createInteractions(h.dependencies).start();await hover(h,first);
  assert.deepEqual(h.requests.map(item=>item.texts),[['First','Last']]);assert.equal(text(first),'译：First');assert.equal(text(last),'译：Last');
  assert.equal(result(blocked),null);assert.equal(result(excluded),null);assert.deepEqual(outputs(h).map(output=>output.parentNode),[first,last]);assert.equal(area.children.length,4);ui.stop();
});

test('releasing the shortcut keeps a pending paragraph request and its loading output',async()=>{
  const h=setup(),p=h.paragraph('Waiting');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(result(p)?.getAttribute('data-state'),'pending');assert.ok(h.doc.querySelector('[data-kuai-page-loading]'));assert.doesNotMatch(text(p)||'',/翻译中|Translating/);
  release(h);assert.equal(result(p)?.getAttribute('data-state'),'pending');assert.deepEqual(h.cancellations,[]);finish({translations:['Ready']});await settle();assert.equal(text(p),'Ready');ui.stop();
});

test('finished paragraph translations survive movement and release, then toggle off on another key press',async()=>{
  const h=setup(),first=h.paragraph('First'),second=h.paragraph('Second');const ui=createInteractions(h.dependencies).start();
  await hover(h,first);const firstOutput=result(first);assert.ok(firstOutput);release(h);assert.equal(result(first),firstOutput);
  await hover(h,second);release(h);assert.equal(text(first),'译：First');assert.equal(text(second),'译：Second');
  await hover(h,first);assert.equal(result(first),null);assert.equal(outputs(h).length,1);assert.equal(text(second),'译：Second');assert.equal(h.requests.length,2);ui.stop();
});

test('live style changes preserve pending requests and restyle completed inline results without translating again',async()=>{
  const h=setup(),p=h.paragraph('Styled');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();
  await hover(h,p);const output=result(p);assert.ok(output);h.settings.pageStyle={preset:'blur',fontSize:150,textColor:'#334455'};ui.updateSettings();ui.refreshPresentation();
  assert.equal(result(p),output);assert.equal(h.cancellations.length,0);assert.ok(h.doc.querySelector('[data-kuai-page-loading]'));assert.match(sheet(h),/display:none!important/);
  finish({translations:['With new style']});await settle();assert.equal(text(p),'With new style');assert.match(sheet(h),/font-size:150%/);assert.match(sheet(h),/filter:blur\(4px\)/);release(h);
  h.settings.pageStyle={preset:'highlight',fontSize:115,backgroundColor:'#ddffee'};ui.refreshPresentation();
  assert.match(sheet(h),/font-size:115%/);assert.match(sheet(h),/background-color:#ddffee/);assert.doesNotMatch(sheet(h),/filter:blur/);assert.equal(h.requests.length,1);ui.stop();
});

test('pointer area translation reuses a real page entry and only sends the missing paragraph',async()=>{
  const h=setup({mode:'area',trigger:'hover'}),area=h.paragraph('','section'),first=h.doc.createElement('p'),last=h.doc.createElement('p');first.textContent='First';last.textContent='Last';area.append(first,last);
  const page=createPageTranslator(h.dependencies);await page.translateBlocks([{element:first,text:'First'}]);const existing=result(first);
  const ui=createInteractions({...h.dependencies,page}).start();await hover(h,first);assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Last']]);assert.equal(result(first),existing);assert.equal(text(last),'译：Last');ui.stop();page.stop();
});

test('clearInlineTranslations removes hover output without closing or cancelling an unrelated selection popup',async()=>{
  const h=setup(),p=h.paragraph('Hover result');const ui=createInteractions(h.dependencies).start();await hover(h,p);release(h);
  let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const selection=ui.translateSelection({text:'Selection result'});
  const popup=h.doc.getElementById('kuai-translation-popup');ui.clearInlineTranslations();assert.equal(outputs(h).length,0);assert.equal(h.doc.getElementById('kuai-translation-popup'),popup);assert.deepEqual(h.cancellations,[]);
  finish({translations:['Selected']});await selection;assert.equal(ui.getState().translation,'Selected');ui.stop();
});

for(const cause of ['changed-source','removed-source','route','provider','disabled','policy'])test('pending inline work cannot render after '+cause,async()=>{
  const h=setup(),p=h.paragraph('Pending original');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(outputs(h).length,1);
  if(cause==='changed-source')p.firstChild.nodeValue='New original';
  if(cause==='removed-source')p.remove();
  if(cause==='route')h.env.location.href='https://example.org/next';
  if(cause==='provider')h.settings.activeProviderId='google';
  if(cause==='disabled')h.settings.hoverEnabled=false;
  if(cause==='policy')h.settings.pageOptions={neverSites:['example.org']};
  if(['route','provider','disabled','policy'].includes(cause))ui.updateSettings();
  finish({translations:['Stale result']});await settle();assert.equal(result(p),null);assert.equal(outputs(h).length,0);ui.stop();
});

for(const cause of ['source','route','provider','disabled','policy'])test('completed inline output is removed after '+cause+' changes',async()=>{
  const h=setup(),p=h.paragraph('Finished original'),ui=createInteractions(h.dependencies).start();await hover(h,p);release(h);assert.equal(outputs(h).length,1);
  if(cause==='source')p.firstChild.nodeValue='New original';
  if(cause==='route')h.env.location.href='https://example.org/next';
  if(cause==='provider')h.settings.activeProviderId='google';
  if(cause==='disabled')h.settings.hoverEnabled=false;
  if(cause==='policy')h.settings.pageOptions={excludeSelectors:['p']};
  ui.updateSettings();ui.refreshPresentation();assert.equal(outputs(h).length,0);assert.equal(h.requests.length,1);ui.stop();
});

test('changed source text invalidates its cached translation before a new hover',async()=>{
  const h=setup(),p=h.paragraph('Old original'),ui=createInteractions(h.dependencies).start();await hover(h,p);const old=result(p);release(h);p.firstChild.nodeValue='New original';await hover(h,p);
  assert.equal(old.isConnected,false);assert.equal(text(p),'译：New original');assert.deepEqual(h.requests.map(item=>item.texts),[['Old original'],['New original']]);assert.equal(outputs(h).length,1);ui.stop();
});

test('replacing an area source element with identical text cancels old work and translates the new node',async()=>{
  const h=setup({mode:'area'}),area=h.paragraph('','section'),first=h.doc.createElement('p');first.textContent='Same words';area.append(first);
  const finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));const ui=createInteractions(h.dependencies).start();await hover(h,area);
  const replacement=h.doc.createElement('p');replacement.textContent='Same words';first.remove();area.append(replacement);await hover(h,area);
  assert.equal(h.requests.length,2);assert.deepEqual(h.cancellations,['request-1']);finishes[0]({translations:['Stale']});finishes[1]({translations:['Current']});await settle();assert.equal(text(replacement),'Current');assert.equal(outputs(h).length,1);ui.stop();
});

for(const policy of ['never-site','hover-site','never-language','selector','inline-selector','too-short','footer'])test('inline hover excludes '+policy+' before sending text',async()=>{
  const h=setup(),p=h.paragraph('Original text');
  if(policy==='never-site')h.settings.pageOptions={neverSites:['example.org']};
  if(policy==='hover-site')h.settings.hoverOptions.disabledSites=['example.org'];
  if(policy==='never-language'){p.setAttribute('lang','fr');h.settings.pageOptions={neverLanguages:['fr']};}
  if(policy==='selector'){p.className='skip';h.settings.pageOptions={excludeSelectors:['.skip']};}
  if(policy==='inline-selector'){const hidden=h.doc.createElement('span');hidden.className='skip';hidden.textContent=' secret';p.append(hidden);h.settings.pageOptions={excludeSelectors:['.skip']};}
  if(policy==='too-short')h.settings.pageOptions={minTextLength:100};
  if(policy==='footer'){const footer=h.doc.createElement('footer');h.doc.body.append(footer);footer.append(p);h.settings.pageOptions={translateFullPage:false};}
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(h.requests.length,0);assert.equal(outputs(h).length,0);ui.stop();
});

test('provider failures remain visible as safe inline text and a fresh hover can retry',async()=>{
  const h=setup(),p=h.paragraph('Retry source');h.respond(async()=>{throw Error('<script>provider failed</script>');});h.settings.pageStyle={preset:'blur',opacity:5};
  const ui=createInteractions(h.dependencies).start();await hover(h,p);const output=result(p);assert.ok(output);assert.equal(output.getAttribute('data-state'),'error');assert.equal(output.getAttribute('role'),'status');
  assert.equal(text(p),'<script>provider failed</script>');assert.equal(output.querySelector('script'),null);assert.doesNotMatch(sheet(h),/filter:blur/);assert.match(sheet(h),/opacity:1!important/);assert.ok(output.querySelector('button').textContent);
  release(h);h.respond(async()=>({translations:['Recovered']}));await hover(h,p);assert.equal(text(p),'Recovered');assert.equal(outputs(h).length,1);assert.equal(h.requests.length,2);ui.stop();
});

test('an empty translation fails visibly instead of replacing original text',async()=>{
  const h=setup(),p=h.paragraph('Original');h.respond(async()=>({translations:['']}));const ui=createInteractions(h.dependencies).start();await hover(h,p);
  assert.equal(result(p)?.getAttribute('data-state'),'error');assert.match(text(p),/空译文|无效/);assert.equal(p.firstChild.textContent,'Original');ui.stop();
});

test('closing a pending paragraph aborts its request without touching other completed results',async()=>{
  const h=setup(),first=h.paragraph('Finished'),last=h.paragraph('Pending'),ui=createInteractions(h.dependencies).start();await hover(h,first);release(h);
  let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await hover(h,last);await hover(h,last);assert.equal(result(last),null);assert.equal(text(first),'译：Finished');assert.deepEqual(h.cancellations,['request-2']);
  finish({translations:['Closed']});await settle();assert.equal(result(last),null);ui.stop();
});

test('legacy popup mode uses the shared inline paragraph output',async()=>{
  const h=setup({displayMode:'popup'}),p=h.paragraph('Popup source'),ui=createInteractions(h.dependencies).start();await hover(h,p);
  assert.equal(outputs(h).length,1);assert.equal(text(p),'译：Popup source');assert.equal(h.doc.getElementById('kuai-translation-popup'),null);release(h);assert.equal(text(p),'译：Popup source');ui.stop();
});

test('clear and stop cancel pending hover work, remove all inline output and leave original nodes',async()=>{
  for(const action of ['clearInlineTranslations','stop']){
    const h=setup(),first=h.paragraph('Finished'),pending=h.paragraph('Pending'),ui=createInteractions(h.dependencies).start();await hover(h,first);release(h);
    let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));await hover(h,pending);assert.equal(outputs(h).length,2);ui[action]();assert.equal(outputs(h).length,0);assert.deepEqual(h.cancellations,['request-2']);
    finish({translations:['Late']});await settle();assert.equal(outputs(h).length,0);assert.equal(first.textContent,'Finished');assert.equal(pending.textContent,'Pending');ui.stop();assert.equal(h.timerCount(),0);
  }
});

test('hovering an inline output never sends the original or generated translation again',async()=>{
  const h=setup({trigger:'hover'}),p=h.paragraph('Readable source'),ui=createInteractions(h.dependencies).start();await hover(h,p);await hover(h,result(p));assert.equal(h.requests.length,1);assert.equal(text(p),'译：Readable source');ui.stop();
});

test('Escape dismisses a selection popup while shared page output remains available to its restore action',async()=>{
  const h=setup(),p=h.paragraph('Original'),original=p.firstChild,ui=createInteractions(h.dependencies).start();await hover(h,p);release(h);assert.equal(outputs(h).length,1);
  await ui.translateSelection({text:'Selection'});h.emit(h.doc,'keydown',{key:'Escape'});assert.equal(outputs(h).length,1);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);assert.equal(p.firstChild,original);
  ui.clearInlineTranslations();assert.equal(p.textContent,'Original');ui.stop();
});

const livePolicyChanges={
  'source selector':({p})=>{p.className='skip';},
  'ancestor selector':({area})=>{area.className='skip';},
  'inline selector':({inline})=>{inline.className='skip';},
  'source language':({p})=>{p.setAttribute('lang','fr');},
  'ancestor language':({area})=>{area.setAttribute('lang','fr');},
  'footer scope':({area})=>{area.setAttribute('role','contentinfo');},
};
function livePolicySetup(overrides={}){
  const h=setup(overrides),area=h.paragraph('','section'),p=h.doc.createElement('p'),inline=h.doc.createElement('span');
  p.append('Eligible ');inline.textContent='source text';p.append(inline);area.append(p);
  h.settings.pageOptions={neverLanguages:['fr'],excludeSelectors:['.skip'],translateFullPage:false,minTextLength:5};
  return {h,area,p,inline};
}

for(const [name,change] of Object.entries(livePolicyChanges))test('live '+name+' exclusion is rechecked after delayed language detection before dispatch',async()=>{
  const context=livePolicySetup(),{h,p}=context;let detect,calls=0;
  h.env.chrome={i18n:{detectLanguage:()=>{calls++;return new Promise(resolve=>{detect=resolve;});}}};
  const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(calls,1);assert.equal(h.requests.length,0);
  change(context);detect({isReliable:true,languages:[{language:'en',percentage:100}]});await settle();
  assert.equal(h.requests.length,0);assert.equal(outputs(h).length,0);assert.equal(calls,1,'live checks must not restart language detection');ui.stop();
});

for(const [name,change] of Object.entries(livePolicyChanges))test('live '+name+' exclusion discards a pending inline response',async()=>{
  const context=livePolicySetup(),{h,area,p}=context;area.setAttribute('lang','en');let finish;
  h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(result(p)?.getAttribute('data-state'),'pending');
  change(context);finish({translations:['Forbidden stale result']});await settle();assert.equal(outputs(h).length,0);assert.equal(p.textContent,'Eligible source text');ui.stop();
});

for(const [name,change] of Object.entries(livePolicyChanges))test('live '+name+' exclusion removes a cached result during presentation refresh',async()=>{
  const context=livePolicySetup(),{h,area,p}=context;area.setAttribute('lang','en');const ui=createInteractions(h.dependencies).start();await hover(h,p);release(h);assert.equal(outputs(h).length,1);
  change(context);ui.refreshPresentation();assert.equal(outputs(h).length,0);assert.equal(p.textContent,'Eligible source text');assert.equal(h.requests.length,1);ui.stop();
});

test('every inline batch rechecks source policy before sending the next paragraph',async()=>{
  const h=setup({mode:'area'}),area=h.paragraph('','section'),paragraphs=[];
  for(let index=0;index<9;index++){const p=h.doc.createElement('p');p.textContent='Paragraph '+index;area.append(p);paragraphs.push(p);}
  h.settings.pageOptions={excludeSelectors:['.skip']};let finish;
  h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();await hover(h,paragraphs[0]);assert.equal(h.requests.length,1);assert.equal(h.requests[0].texts.length,8);
  paragraphs[8].className='skip';finish({translations:['One','Two','Three','Four','Five','Six','Seven','Eight']});await settle();
  assert.equal(h.requests.length,1);assert.equal(result(paragraphs[8]),null);assert.equal(outputs(h).length,8);ui.stop();
});

test('policy refresh does not detect language again or remove an allowed cached inline result',async()=>{
  const h=setup(),p=h.paragraph('Allowed original');h.settings.pageOptions={neverLanguages:['fr']};let calls=0;
  h.env.chrome={i18n:{detectLanguage:async()=>{calls++;return {isReliable:true,languages:[{language:'en',percentage:100}]};}}};
  const ui=createInteractions(h.dependencies).start();await hover(h,p);const output=result(p);assert.ok(output);assert.equal(calls,1);
  ui.refreshPresentation();h.emit(p,'mousemove',{altKey:true});ui.refreshPresentation();assert.equal(result(p),output);assert.equal(calls,1);assert.equal(h.requests.length,1);ui.stop();
});

test('live policy ignores owned translation spans when evaluating excluded inline descendants',async()=>{
  const h=setup(),p=h.paragraph('Plain source');h.settings.pageOptions={excludeSelectors:['span','button']};const ui=createInteractions(h.dependencies).start();
  await hover(h,p);const output=result(p);assert.ok(output);assert.equal(text(p),'译：Plain source');release(h);ui.refreshPresentation();
  assert.equal(result(p),output);assert.equal(h.requests.length,1);ui.stop();
});

test('legacy popup setting discards its pending shared response when the source becomes excluded',async()=>{
  const context=livePolicySetup({displayMode:'popup'}),{h,area,p}=context;area.setAttribute('lang','en');let finish;
  h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(result(p)?.getAttribute('data-state'),'pending');
  p.className='skip';finish({translations:['Excluded popup result']});await settle();assert.equal(result(p),null);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);assert.equal(ui.getState().translation,'');ui.stop();
});

test('a long paragraph with a legacy popup setting stops before its next request if the source becomes excluded',async()=>{
  const h=setup({displayMode:'popup'}),p=h.paragraph('Long original text '.repeat(400));h.settings.pageOptions={excludeSelectors:['.skip']};let finish;
  h.respond(()=>new Promise(resolve=>{finish=resolve;}));const ui=createInteractions(h.dependencies).start();await hover(h,p);assert.equal(h.requests.length,1);
  p.className='skip';finish({translations:h.requests[0].texts.map(()=> 'First translated part')});await settle();
  assert.equal(h.requests.length,1);assert.equal(result(p),null);assert.equal(h.doc.getElementById('kuai-translation-popup'),null);ui.stop();
});

test('bilingual wrapper starts on a new line and restores source clipping on removal',async()=>{
  const h=setup(),p=h.paragraph('Clamped source'),original=p.firstChild;
  p.setAttribute('style','-webkit-line-clamp:2;max-height:40px;height:40px');
  h.settings.pageStyle={preset:'plain'};
  const ui=createInteractions(h.dependencies).start();await hover(h,p);
  const output=result(p),inner=output.querySelector('font');
  assert.equal(output.firstChild.tagName,'BR');assert.equal(inner.className.includes('kuai-translator-inner'),true);
  assert.equal(inner.textContent,'译：Clamped source');assert.equal(inner.getAttribute('style'),null);
  assert.equal(p.getAttribute('data-kuai-page-source'),'expanded');
  assert.match(sheet(h),/-webkit-line-clamp:unset!important/);
  assert.equal(blockText(p,h.env),'Clamped source');
  ui.refreshPresentation();assert.equal(output.children.length,2);
  ui.clearInlineTranslations();assert.equal(p.firstChild,original);
  assert.equal(p.getAttribute('data-kuai-page-source'),null);
  assert.equal(p.getAttribute('style'),'-webkit-line-clamp:2;max-height:40px;height:40px');
  assert.equal(h.doc.querySelector('[data-kuai-page-style]'),null);ui.stop();
});

for(const mode of ['bilingual','translation_only'])test('mixed container hover places its own translation before the following paragraph in '+mode,async()=>{
  const h=setup(),container=h.paragraph('First comment','div'),source=container.firstChild,p=h.doc.createElement('p');
  p.textContent='Second paragraph';container.append(p);h.settings.pageDisplayMode=mode;
  let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const ui=createInteractions(h.dependencies).start();await hover(h,container);
  const output=result(container);assert.ok(output);
  assert.equal(container.childNodes.indexOf(output)+1,container.childNodes.indexOf(p),'pending output belongs before the next paragraph');
  assert.deepEqual(h.requests[0].texts,['First comment','Second paragraph']);
  finish({translations:['First translation','Second translation']});await settle();
  assert.equal(container.childNodes.indexOf(output)+1,container.childNodes.indexOf(p));
  assert.equal(output.querySelector('font').textContent,'First translation');
  ui.refreshPresentation();assert.equal(container.childNodes.indexOf(output)+1,container.childNodes.indexOf(p));
  assert.equal(result(p)?.querySelector('font').textContent,'Second translation');
  ui.clearInlineTranslations();assert.deepEqual(container.childNodes,[source,p]);ui.stop();
});

for(const mode of ['bilingual','translation_only'])test('Shift translates every paragraph inside a mixed-text HN comment selection in '+mode,async()=>{
  const h=setup({trigger:'shift',showIndicator:true}),comment=h.paragraph('First comment paragraph','div');comment.className='commtext c00';
  const paragraphs=['Second paragraph','Look at the PHP situation:','- HTTP details','- PHP details'].map(value=>{
    const p=h.doc.createElement('p');p.textContent=value;comment.append(p);return p;
  });
  h.paragraph('Another user comment','div');h.settings.pageDisplayMode=mode;
  const ui=createInteractions(h.dependencies).start();h.emit(comment,'mousemove');
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});assert.ok(h.doc.getElementById('kuai-hover-indicator'));
  h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['First comment paragraph','Second paragraph','Look at the PHP situation:','- HTTP details','- PHP details']);
  assert.equal(outputs(h).length,5);
  assert.equal(comment.childNodes.indexOf(result(comment))+1,comment.childNodes.indexOf(paragraphs[0]));
  for(const p of paragraphs)assert.equal(result(p)?.parentNode,p);
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.equal(outputs(h).length,0);assert.equal(comment.firstChild.textContent,'First comment paragraph');ui.stop();
});
