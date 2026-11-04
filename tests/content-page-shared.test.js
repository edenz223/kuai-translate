import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../src/content/page-translator.js';

const output=node=>node.querySelector('[data-kuai-page-translation]');
const blocks=(...nodes)=>nodes.map(element=>({element,text:element.firstChild.textContent}));
const settle=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function shared(h){
  const page=createPageTranslator(h.dependencies);
  assert.equal(typeof page.toggleBlocks,'function','paragraph gestures must share the page controller');
  assert.equal(typeof page.translateBlocks,'function','pointer gestures must reuse existing entries');
  return page;
}

test('paragraph toggle uses page presentation and restores the same source nodes on its second action',async()=>{
  const h=fixture(),p=h.paragraph('Original'),source=p.firstChild;h.settings.pageDisplayMode='translation_only';
  const page=shared(h);await page.toggleBlocks(blocks(p));const result=output(p);
  assert.equal(result.textContent,'译：Original');assert.equal(source.parentElement.hidden,true);
  assert.equal(page.status().translated,1);await page.toggleBlocks([{element:p,text:'Original'}]);
  assert.equal(output(p),null);assert.equal(p.firstChild,source);assert.equal(p.textContent,'Original');assert.equal(page.status().total,0);
  assert.equal(h.doc.querySelectorAll('[data-kuai-ui]').length,0,'closing the last paragraph also dismisses the page controls');
});

test('full-page translation reuses a completed paragraph output without another request',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),page=shared(h);
  await page.toggleBlocks(blocks(first));const result=output(first);await page.translatePage();
  assert.equal(output(first),result);assert.equal(output(second).textContent,'译：Second');
  assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Second']]);assert.equal(page.status().translated,2);
});

test('a page pass joins an existing paragraph request and only dispatches the remaining paragraph',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  const page=shared(h),paragraph=page.toggleBlocks(blocks(first));await settle();const result=output(first),whole=page.translatePage();await settle();
  assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Second']]);assert.equal(output(first),result);assert.equal(page.status().active,true);
  finishes[1]({translations:['Second result']});await settle();assert.equal(page.status().active,true);
  finishes[0]({translations:['First result']});await Promise.all([paragraph,whole]);
  assert.equal(page.status().translated,2);assert.equal(h.cancellations.length,0);
});

test('toggling one paragraph off in a pending page batch preserves the other paragraph request',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=shared(h),whole=page.translatePage();await settle();await page.toggleBlocks(blocks(first));
  assert.equal(output(first),null);assert.equal(output(second).getAttribute('data-state'),'pending');assert.deepEqual(h.cancellations,[]);
  finish({translations:['Removed','Kept']});await whole;assert.equal(output(first),null);assert.equal(output(second).textContent,'Kept');assert.equal(page.status().total,1);
});

test('separate paragraph requests have independent cancellation and stale output cannot return',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  const page=shared(h),one=page.toggleBlocks(blocks(first)),two=page.toggleBlocks(blocks(second));await settle();
  await page.toggleBlocks(blocks(first));assert.deepEqual(h.cancellations,['request-1']);assert.equal(page.status().active,true);
  finishes[0]({translations:['Stale first']});finishes[1]({translations:['Current second']});await Promise.all([one,two]);await settle();
  assert.equal(output(first),null);assert.equal(output(second).textContent,'Current second');assert.equal(page.status().translated,1);
});

test('repeated page requests reuse their pending entries and restore cancels every request once',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  const page=shared(h),paragraph=page.toggleBlocks(blocks(first)),whole=page.translatePage(),again=page.translatePage();await settle();
  assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Second']]);page.restore();
  await Promise.all([paragraph,whole,again]);assert.deepEqual(h.cancellations,['request-1','request-2']);assert.equal(page.status().total,0);
  finishes.forEach(finish=>finish({translations:['Late']}));await settle();assert.equal(output(first),null);assert.equal(output(second),null);
});

test('paragraph retry sends only the failed paragraph and leaves another failure available',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second');h.respond(async()=>{throw Error('Provider failed');});
  const page=shared(h);await page.translatePage();assert.equal(page.status().errors,2);
  h.respond(async texts=>({translations:texts.map(text=>'Recovered '+text)}));h.emit(output(first).querySelector('button'),'click');await settle();
  assert.deepEqual(h.requests.map(item=>item.texts),[['First','Second'],['First']]);assert.equal(output(first).firstChild.textContent,'Recovered First');
  assert.equal(output(second).getAttribute('data-state'),'error');assert.equal(page.status().errors,1);
});

test('page and pointer requests share one claim while language detection is pending',async()=>{
  const h=fixture(),p=h.paragraph('Detect once'),detections=[];h.settings.pageOptions={neverLanguages:['fr']};
  h.env.chrome={i18n:{detectLanguage:()=>new Promise(resolve=>detections.push(resolve))}};
  const page=shared(h),first=page.toggleBlocks(blocks(p)),whole=page.translatePage(),pointer=page.translateBlocks(blocks(p));
  assert.equal(detections.length,1);assert.equal(page.status().active,true);assert.equal(page.status().total,1);
  detections[0]({isReliable:true,languages:[{language:'en',percentage:100}]});await Promise.all([first,whole,pointer]);
  assert.equal(h.requests.length,1);assert.equal(output(p).textContent,'译：Detect once');
});

test('a pending language claim can be toggled off and its late filter cannot remove a newer result',async()=>{
  const h=fixture(),p=h.paragraph('Detect twice'),detections=[];h.settings.pageOptions={neverLanguages:['fr']};
  h.env.chrome={i18n:{detectLanguage:()=>new Promise(resolve=>detections.push(resolve))}};
  const page=shared(h),old=page.toggleBlocks(blocks(p));await page.toggleBlocks(blocks(p));assert.equal(page.status().total,0);
  const fresh=page.toggleBlocks(blocks(p));detections[1]({isReliable:true,languages:[{language:'en',percentage:100}]});await fresh;const result=output(p);
  detections[0]({isReliable:true,languages:[{language:'en',percentage:100}]});await old;await settle();assert.equal(output(p),result);assert.equal(h.requests.length,1);
});

for(const change of ['source','removed-source','route','provider','provider-revision','never-site','selector','language','editable'])test('shared pending entries reject a live '+change+' change',async()=>{
  const h=fixture(),p=h.paragraph('Safe source');h.settings.pageOptions={excludeSelectors:['.skip'],neverLanguages:['fr']};p.setAttribute('lang','en');
  let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const page=shared(h),work=page.toggleBlocks(blocks(p));await settle();
  if(change==='source')p.firstChild.textContent='Changed source';
  if(change==='removed-source')p.remove();
  if(change==='route')h.env.location.href='https://example.org/next';
  if(change==='provider')h.settings.activeProviderId='google';
  if(change==='provider-revision')h.settings.providerRevision=1;
  if(change==='never-site')h.settings.pageOptions.neverSites=['example.org'];
  if(change==='selector')p.className='skip';
  if(change==='language')p.setAttribute('lang','fr');
  if(change==='editable')p.setAttribute('contenteditable','true');
  finish({translations:['Stale result']});await work;assert.equal(output(p),null);assert.equal(page.status().total,0);
});

test('each later page batch rechecks live source and policy before any text is sent',async()=>{
  const h=fixture(),paragraphs=Array.from({length:10},(_,index)=>h.paragraph('Paragraph '+index));h.settings.pageOptions={excludeSelectors:['.skip']};
  let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const page=shared(h),work=page.translatePage();await settle();
  paragraphs[8].className='skip';paragraphs[9].firstChild.textContent='Changed before dispatch';finish({translations:Array(8).fill('Translated')});await work;
  assert.equal(h.requests.length,1);assert.equal(output(paragraphs[8]),null);assert.equal(output(paragraphs[9]),null);assert.equal(page.status().translated,8);
});

test('a paragraph gesture validity change invalidates its pending claim without cancelling a page-owned row',async()=>{
  const h=fixture(),first=h.paragraph('Paragraph'),second=h.paragraph('Page'),finishes=[];let valid=true;h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  const page=shared(h),one=page.toggleBlocks(blocks(first),{validate:()=>valid}),two=page.translateBlocks(blocks(second));await settle();
  valid=false;page.refreshPresentation();assert.equal(output(first),null);assert.deepEqual(h.cancellations,['request-1']);
  finishes[0]({translations:['Stale']});finishes[1]({translations:['Retained']});await Promise.all([one,two]);assert.equal(output(second).textContent,'Retained');
});

test('removing the sole owner of a page batch lets unrelated queued paragraphs proceed immediately',async()=>{
  const h=fixture(),long=h.paragraph('A'.repeat(6000)),other=h.paragraph('Other paragraph');let finish;let calls=0;
  h.respond(texts=>++calls===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({translations:texts.map(text=>'译：'+text)}));
  const page=shared(h),whole=page.translatePage();await settle();assert.equal(h.requests.length,1);
  await page.toggleBlocks(blocks(long));await settle();assert.equal(h.requests.length,2,'queued live paragraphs must not wait for a cancelled provider call');
  await whole;assert.deepEqual(h.requests[1].texts,['Other paragraph']);assert.equal(output(other).textContent,'译：Other paragraph');assert.equal(page.status().errors,0);
  finish({translations:Array(3).fill('Stale')});await settle();assert.equal(output(long),null);assert.deepEqual(h.cancellations,['request-1']);
});

for(const pending of [false,true])test('full-page ownership survives disabling the gesture that created a '+(pending?'pending':'successful')+' paragraph',async()=>{
  const h=fixture(),p=h.paragraph('Adopted paragraph');let valid=true,finish;
  if(pending)h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=shared(h),paragraph=page.toggleBlocks(blocks(p),{validate:()=>valid});if(!pending)await paragraph;
  const whole=page.translatePage();valid=false;page.refreshPresentation();assert.ok(output(p));assert.equal(h.cancellations.length,0);
  if(pending)finish({translations:['Retained result']});await Promise.all([paragraph,whole]);assert.equal(page.status().translated,1);assert.equal(h.requests.length,1);
});

test('a second area toggle removes its translations even when language detection excluded another source unit',async()=>{
  const h=fixture(),first=h.paragraph('English paragraph'),second=h.paragraph('Bonjour');h.settings.pageOptions={neverLanguages:['fr']};
  h.env.chrome={i18n:{detectLanguage:async text=>({isReliable:true,languages:[{language:text==='Bonjour'?'fr':'en',percentage:100}]})}};
  const page=shared(h),area=blocks(first,second);await page.toggleBlocks(area);assert.ok(output(first));assert.equal(output(second),null);
  await page.toggleBlocks(area);assert.equal(output(first),null);assert.equal(output(second),null);assert.equal(h.requests.length,1);assert.equal(page.status().total,0);
});
