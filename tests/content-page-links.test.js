import test from 'node:test';
const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createPageTriggers} from '../dist/src/content/page-triggers.js';

const output = node => node.children.find(child => child.hasAttribute('data-kuai-page-translation')) || null;
const settle = async () => {for(let i=0;i<16;i++)await Promise.resolve();};
function link(h,text,href,attributes={}){
  const node=h.doc.createElement('a');node.textContent=text;node.setAttribute('href',href);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
  return node;
}
function observerBoundary(h){
  const observers=[];
  h.env.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.options=options;}disconnect(){this.disconnected=true;}};
  return records=>{for(const observer of observers)if(!observer.disconnected)observer.callback(records.filter(record=>record.type!=='attributes'||observer.options.attributeFilter?.includes(record.attributeName)));};
}

test('translated identical link labels retain their separate source destinations and plain neighbors',async()=>{
  const h=fixture(),p=h.paragraph('Read '),first=link(h,'guide','/first'),second=link(h,'guide','/second');
  p.append(first,h.doc.createTextNode(' and '),second,h.doc.createTextNode('.'));
  const translated={Read:'阅读',guide:'指南',and:'以及'};h.respond(async texts=>({translations:texts.map(text=>translated[text])}));
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.deepEqual(h.requests[0].texts,['Read','guide','and','guide']);
  const result=output(p),links=result.querySelectorAll('a');assert.equal(links.length,2);
  assert.deepEqual(links.map(node=>[node.textContent,node.getAttribute('href')]),[['指南','https://example.org/first'],['指南','https://example.org/second']]);
  assert.equal(result.textContent,'阅读 指南 以及 指南.');assert.equal(result.querySelector('font').firstChild.nodeType,3);
  assert.equal(first.parentNode,p);assert.equal(second.parentNode,p);page.stop();
});

test('nested emphasis and source whitespace keep one complete translated link label',async()=>{
  const h=fixture(),p=h.paragraph('  Before\n'),a=link(h,'  a  ','/guide'),strong=h.doc.createElement('strong');strong.textContent='good';a.append(strong,h.doc.createTextNode('\tguide  '));p.append(a,h.doc.createTextNode('   —\n '),link(h,'other','/other'));
  h.respond(async texts=>({translations:texts.map(text=>({'Before':'前面','a good guide':'好指南','other':'其他'}[text]))}));
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.deepEqual(h.requests[0].texts,['Before','a good guide','other']);
  assert.equal(output(p).textContent,'前面 好指南 — 其他');assert.equal(output(p).querySelectorAll('a')[0].textContent,'好指南');
  assert.equal(strong.parentNode,a);page.stop();
});

test('translation-only waits for all link runs and restores the original nodes and listeners',async()=>{
  const h=fixture(),p=h.paragraph('Read '),text=p.firstChild,a=link(h,'guide','/guide');p.append(a);let clicks=0;a.addEventListener('click',()=>clicks++);
  h.settings.pageDisplayMode='translation_only';let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=createPageTranslator(h.dependencies),pending=page.translatePage();
  assert.equal(p.querySelector('[data-kuai-original]'),null);finish({translations:['阅读','指南']});await pending;
  assert.ok(output(p).querySelector('a'));assert.equal(a.parentNode.hidden,true);assert.equal(text.parentNode.hidden,true);
  const translated=output(p).querySelector('a');assert.equal(h.emit(translated,'click').defaultPrevented,false);
  page.refreshPresentation();assert.equal(h.requests.length,1);assert.equal(output(p).querySelector('a'),translated);
  page.restore();assert.equal(p.firstChild,text);assert.equal(a.parentNode,p);h.emit(a,'click');assert.equal(clicks,1);assert.equal(p.textContent,'Read guide');
});

test('native link metadata is copied locally while provider markup and active URLs remain inert',async()=>{
  const h=fixture(),p=h.paragraph(''),a=link(h,'Guide','../guide#intro',{target:'_blank',rel:'external opener',download:'',title:'Guide title','aria-label':'Read the guide',onclick:'bad()'});
  h.doc.baseURI='https://example.org/docs/part/';p.append(a,h.doc.createTextNode(' / '),link(h,'Mail','mailto:help@example.org'),h.doc.createTextNode(' / '),link(h,'Call','tel:+123'),h.doc.createTextNode(' / '),link(h,'Active','java\nscript:bad()'),h.doc.createTextNode(' / '),link(h,'HTML','data:text/html,bad'));
  h.respond(async texts=>({translations:texts.map(text=>text==='Guide'?'<script>bad()</script><a href="https://wrong.invalid">标题</a>':text)}));
  const page=createPageTranslator(h.dependencies);await page.translatePage();const result=output(p),links=result.querySelectorAll('a[href]');
  assert.equal(links.length,3);assert.equal(links[0].getAttribute('href'),'https://example.org/docs/guide#intro');
  assert.equal(links[0].getAttribute('target'),'_blank');assert.match(links[0].getAttribute('rel'),/\bnoopener\b/);assert.doesNotMatch(links[0].getAttribute('rel'),/\bopener\b/);
  assert.equal(links[0].getAttribute('download'),'');assert.equal(links[0].getAttribute('title'),'Guide title');assert.equal(links[0].getAttribute('aria-label'),'Read the guide');assert.equal(links[0].hasAttribute('onclick'),false);
  assert.equal(links[0].children.length,0);assert.equal(result.querySelector('script'),null);assert.match(links[0].textContent,/<script>/);
  assert.deepEqual(links.slice(1).map(node=>node.getAttribute('href')),['mailto:help@example.org','tel:+123']);
  assert.ok(h.requests.flatMap(request=>request.texts).every(text=>!text.includes('example.org')&&!text.includes('java')&&!text.includes('data:')));page.stop();
});

test('standalone and inherited card links do not produce nested or wrong-destination anchors',async()=>{
  const h=fixture(),standalone=link(h,'Standalone','/standalone'),card=link(h,'','/card'),heading=h.doc.createElement('h2');heading.textContent='Card heading';card.append(heading);h.doc.body.append(standalone,card);
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(output(h.doc.body).querySelector('a')?.getAttribute('href'),'https://example.org/standalone');
  assert.ok(output(heading));assert.equal(output(heading).querySelector('a'),null);assert.equal(output(heading).closest('a'),card);assert.equal(card.getAttribute('href'),'/card');
  assert.equal(standalone.querySelector('a'),null);page.stop();
});

test('pending link translations use the current destination without sending URLs or retranslating',async()=>{
  const h=fixture(),p=h.paragraph(''),a=link(h,'Guide','/old');p.append(a);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=createPageTranslator(h.dependencies),pending=page.translatePage();a.setAttribute('href','/new');finish({translations:['指南']});await pending;
  assert.equal(output(p).querySelector('a')?.getAttribute('href'),'https://example.org/new');assert.deepEqual(h.requests[0].texts,['Guide']);assert.equal(h.requests.length,1);page.stop();
});

test('replacing a source link with identical text invalidates a pending result',async()=>{
  const h=fixture(),p=h.paragraph(''),a=link(h,'Guide','/old');p.append(a);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=createPageTranslator(h.dependencies),pending=page.translatePage(),replacement=link(h,'Guide','/replacement');p.insertBefore(replacement,a);a.remove();finish({translations:['旧指南']});await pending;
  assert.equal(!!output(p),false);assert.equal(page.status().total,0);assert.equal(replacement.parentNode,p);page.stop();
});

test('source link and base-URL attributes refresh output locally while retaining selected text nodes',async()=>{
  const h=fixture(),notify=observerBoundary(h),p=h.paragraph(''),a=link(h,'Guide','guide',{target:'_self'});p.append(a);h.doc.baseURI='https://example.org/first/';
  const page=createPageTranslator(h.dependencies);await page.translatePage();const translated=output(p).querySelector('a');assert.ok(translated);const text=translated.firstChild;
  a.setAttribute('href','next');a.setAttribute('target','_blank');notify([{type:'attributes',target:a,attributeName:'href'},{type:'attributes',target:a,attributeName:'target'}]);await settle();
  assert.equal(output(p).querySelector('a'),translated);assert.equal(translated.firstChild,text);assert.equal(translated.getAttribute('href'),'https://example.org/first/next');assert.equal(translated.getAttribute('target'),'_blank');
  const base=h.doc.createElement('base');h.doc.documentElement.append(base);h.doc.baseURI='https://example.org/second/';notify([{type:'attributes',target:base,attributeName:'href'}]);await settle();
  assert.equal(translated.getAttribute('href'),'https://example.org/second/next');
  a.setAttribute('href','javascript:bad()');notify([{type:'attributes',target:a,attributeName:'href'}]);await settle();assert.equal(output(p).querySelector('a[href]'),null);assert.equal(output(p).textContent,'译：Guide');
  assert.equal(h.requests.length,1);page.stop();
});

test('native activation refreshes destination and blocks a stale source before observer delivery',async()=>{
  const h=fixture(),p=h.paragraph(''),a=link(h,'Guide','/old');p.append(a);const page=createPageTranslator(h.dependencies);await page.translatePage();const translated=output(p).querySelector('a');assert.ok(translated);
  a.setAttribute('href','#new');assert.equal(h.emit(translated,'click').defaultPrevented,false);assert.equal(translated.getAttribute('href'),'https://example.org/article#new');
  const replacement=link(h,'Guide','/replacement');p.insertBefore(replacement,a);a.remove();assert.equal(h.emit(translated,'auxclick',{button:1}).defaultPrevented,true);assert.equal(!!output(p),false);page.stop();
});

test('adding a link around unchanged source text invalidates an earlier plain result',async()=>{
  const h=fixture(),p=h.paragraph('Guide'),source=p.firstChild,page=createPageTranslator(h.dependencies);await page.translatePage();
  const a=link(h,'','/guide');p.insertBefore(a,source);a.append(source);page.refreshPresentation();assert.equal(!!output(p),false);
  await page.translatePage();assert.equal(output(p).querySelector('a')?.getAttribute('href'),'https://example.org/guide');assert.equal(h.requests.length,2);page.stop();
});

test('style and display-mode refresh preserve translated anchor and text identity',async()=>{
  const h=fixture(),p=h.paragraph(''),a=link(h,'Guide','/guide');p.append(a);const page=createPageTranslator(h.dependencies);await page.translatePage();const translated=output(p).querySelector('a');assert.ok(translated);const text=translated.firstChild;
  h.settings.pageStyle={preset:'highlight',fontSize:125};h.settings.pageDisplayMode='translation_only';page.refreshPresentation();
  assert.equal(output(p).querySelector('a'),translated);assert.equal(translated.firstChild,text);assert.ok(sheet(h).includes('font-size:125%!important'));assert.equal(h.requests.length,1);
  h.settings.pageDisplayMode='bilingual';page.refreshPresentation();assert.equal(output(p).querySelector('a'),translated);assert.equal(a.parentNode,p);page.stop();
});

test('long translated labels keep one link across bounded chunks and paragraph/full-page sharing',async()=>{
  const h=fixture(),p=h.paragraph('Before '),source='a'.repeat(7000),a=link(h,source,'/long');p.append(a,h.doc.createTextNode(' after'));h.respond(async texts=>({translations:texts.map(text=>text.toUpperCase())}));
  const page=createPageTranslator(h.dependencies);await page.translateBlocks([{element:p,text:'Before '+source+' after'}]);const result=output(p);assert.equal(result.querySelectorAll('a').length,1);
  assert.equal(result.querySelector('a')?.textContent.replaceAll(' ',''),'A'.repeat(7000));assert.equal(result.querySelector('a')?.getAttribute('href'),'https://example.org/long');assert.equal(result.textContent.replaceAll(' ',''),'BEFORE'+'A'.repeat(7000)+'AFTER');
  const count=h.requests.length;assert.ok(count>1);assert.ok(h.requests.every(request=>request.texts.length<=8&&request.texts.join('').length<=6000));await page.translatePage();assert.equal(output(p),result);assert.equal(h.requests.length,count);page.stop();
});

test('cancelling a long linked paragraph releases its batch and keeps another linked paragraph',async()=>{
  const h=fixture(),first=h.paragraph(''),long=link(h,'a'.repeat(7000),'/long'),other=h.paragraph(''),short=link(h,'Keep','/keep');first.append(long);other.append(short);let late;h.respond(texts=>h.requests.length===1?new Promise(resolve=>{late=resolve;}):Promise.resolve({translations:texts.map(text=>'译：'+text)}));
  const page=createPageTranslator(h.dependencies),pending=page.translatePage();await settle();await page.toggleBlocks([{element:first,text:'a'.repeat(7000)}]);await pending;
  assert.equal(!!output(first),false);assert.equal(output(other).querySelector('a')?.getAttribute('href'),'https://example.org/keep');assert.equal(output(other).textContent,'译：Keep');assert.deepEqual(h.cancellations,['request-1']);
  late({translations:Array(3).fill('Late')});await settle();assert.equal(!!output(first),false);page.stop();
});

test('retry rebuilds link runs after a provider failure without hiding the source prematurely',async()=>{
  const h=fixture(),p=h.paragraph('Read '),a=link(h,'Guide','/guide');p.append(a);h.settings.pageDisplayMode='translation_only';h.respond(async()=>{throw Error('Temporary failure');});
  const page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(p.querySelector('[data-kuai-original]'),null);assert.equal(output(p).getAttribute('data-state'),'error');
  h.respond(async texts=>({translations:texts.map(text=>text==='Read'?'阅读':'指南')}));h.emit(output(p).querySelector('button'),'click');await settle();
  assert.equal(output(p).querySelector('a')?.textContent,'指南');assert.equal(output(p).textContent,'阅读 指南');assert.equal(a.parentNode.hidden,true);page.stop();
});

test('dynamic link attributes update locally and removal follows the current unlinked source plan',async()=>{
  const h=fixture(),notify=observerBoundary(h),p=h.paragraph('Read '),a=link(h,'Guide','/old');p.append(a);h.settings.pageOptions={translateDynamic:true};
  const page=createPageTranslator(h.dependencies),triggers=createPageTriggers({...h.dependencies,page}).start();await triggers.translate();
  a.setAttribute('href','/new');notify([{type:'attributes',target:a,attributeName:'href'}]);await settle();h.advance(250);await settle();
  assert.equal(output(p).querySelector('a')?.getAttribute('href'),'https://example.org/new');assert.equal(h.requests.length,1);
  a.removeAttribute('href');notify([{type:'attributes',target:a,attributeName:'href'}]);await settle();h.advance(250);await settle();
  assert.equal(output(p).querySelector('a'),null);assert.equal(output(p).textContent,'译：Read Guide');assert.equal(h.requests.length,2);triggers.stop();page.stop();
});

test('excluded and nested block text does not enter a linked paragraph request',async()=>{
  const h=fixture(),p=h.paragraph('Read '),a=link(h,'Secret','/secret');a.className='private';p.append(a);const outer=h.paragraph('Outer '),nested=h.doc.createElement('p');nested.append(link(h,'Inner','/inner'));outer.append(nested);h.settings.pageOptions={excludeSelectors:['.private']};
  const page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(!!output(p),false);assert.deepEqual(h.requests.flatMap(request=>request.texts),['Outer','Inner']);assert.equal(output(nested).querySelector('a')?.getAttribute('href'),'https://example.org/inner');page.stop();
});


for(const decoration of ['none','underline'])test('translated links follow source '+decoration+' decoration without changing navigation',async()=>{
 const h=fixture(),p=h.paragraph('Read '),a=link(h,'Guide','/guide');p.append(a);const computed=h.env.getComputedStyle;
 let sourceDecoration=decoration;h.env.getComputedStyle=node=>({...computed(node),textDecorationLine:node===a?sourceDecoration:'none'});
 const page=createPageTranslator(h.dependencies);await page.translatePage();const translated=output(p).querySelector('a'),text=translated.firstChild;
 assert.equal(translated.style['text-decoration-line'],decoration);assert.equal(translated.getAttribute('href'),'https://example.org/guide');
 sourceDecoration=decoration==='none'?'underline':'none';page.refreshPresentation();assert.equal(translated.style['text-decoration-line'],sourceDecoration);assert.strictEqual(translated.firstChild,text);assert.equal(h.requests.length,1);page.stop();
});

test('translated links preserve distinct source colors and refresh them without retranslating',async()=>{
  const h=fixture(),p=h.paragraph('He said '),red=link(h,'OpenAI','/openai'),blue=link(h,'Hugging Face','/hugging-face');
  p.append(red,h.doc.createTextNode(' and '),blue);
  const computed=h.env.getComputedStyle;let redColor='rgb(220, 0, 0)';
  h.env.getComputedStyle=node=>({...computed(node),color:node===red?redColor:node===blue?'rgb(0, 0, 200)':'rgb(0, 0, 0)'});
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  const [first,second]=output(p).querySelectorAll('a'),text=first.firstChild;
  assert.equal(first.style.color,'rgb(220, 0, 0)');assert.equal(second.style.color,'rgb(0, 0, 200)');
  assert.equal(first.getAttribute('href'),'https://example.org/openai');
  redColor='rgb(180, 0, 0)';h.settings.pageDisplayMode='translation_only';page.refreshPresentation();
  assert.equal(first.style.color,'rgb(180, 0, 0)');assert.equal(first.firstChild,text);assert.equal(h.requests.length,1);page.stop();
});
