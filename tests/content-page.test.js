import test from 'node:test';
import assert from 'node:assert/strict';
import dom,{fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createPageTriggers} from '../dist/src/content/page-triggers.js';
import {createInteractions} from '../dist/src/content/interactions.js';
import {blockText,collectBlocks} from '../dist/src/content/dom.js';
import {createContentRuntime} from '../dist/src/content/index.js';
import * as api from '../dist/src/shared/styles.js';

const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';

const output = node => node.querySelector('[data-kuai-page-translation]');

test('bilingual output preserves original inline nodes/listeners and restore removes only owned output', async()=>{
 const h=fixture(), p=h.paragraph('Hello '), strong=h.doc.createElement('strong');strong.textContent='world';p.append(strong);let clicks=0;strong.addEventListener('click',()=>clicks++);
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.deepEqual(h.requests[0].texts,['Hello world']);assert.equal(output(p).textContent,'译：Hello world');assert.strictEqual(p.children[0],strong);h.emit(strong,'click');assert.equal(clicks,1);
 const siteAddition=h.doc.createElement('em');siteAddition.textContent=' updated';p.append(siteAddition);controller.restore();assert.equal(output(p),null);assert.strictEqual(p.children[1],siteAddition);assert.equal(p.textContent,'Hello world updated');
});

test('translated rows share one page stylesheet that is removed with the last row', async()=>{
 const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second');const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.ok(output(first)&&output(second));assert.equal(h.doc.querySelectorAll('[data-kuai-page-style]').length,1);assert.match(sheet(h),/kuai-translator\[data-state=success\]>\.kuai-translator-inner\{/);
 controller.restore();assert.equal(h.doc.querySelectorAll('[data-kuai-page-style]').length,0);
});

test('page translation sends only viewport paragraphs and excludes controls/code/hidden blocks', async()=>{
 const h=fixture();h.paragraph('First');const below=h.paragraph('Below viewport');below._rect={top:5000,left:0,right:400,bottom:5030,width:400,height:30};
 const hidden=h.paragraph('Hidden');hidden.hidden=true;h.paragraph('Secret input','textarea');h.paragraph('Code','pre');const editable=h.paragraph('Draft');editable.setAttribute('contenteditable','true');
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();assert.deepEqual(h.requests.flatMap(request=>request.texts),['First']);assert.equal(controller.status().translated,1);
});

test('inline code stays in the translated sentence while block code is excluded', async()=>{
 const h=fixture(),p=h.paragraph('Keep your first account in '),code=h.doc.createElement('code');code.textContent='~/.codex';code.style.display='inline';p.append(code,h.doc.createTextNode('. Sign in again.'));
 const block=h.paragraph('','div'),blockCode=h.doc.createElement('code');blockCode.textContent='CODEX_HOME=~/.codex-work codex login';block.append(blockCode);
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.deepEqual(h.requests.flatMap(request=>request.texts),['Keep your first account in ~/.codex. Sign in again.']);assert.equal(output(p).textContent,'译：Keep your first account in ~/.codex. Sign in again.');assert.equal(output(block),null);
});

test('nested blocks are not translated twice and provider markup is displayed as plain text', async()=>{
 const h=fixture();const outer=h.paragraph('','div'), inner=h.doc.createElement('p');inner.textContent='Nested';outer.append(inner);h.respond(async()=>({translations:['<script>bad()</script>译文']}));
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();assert.deepEqual(h.requests[0].texts,['Nested']);assert.equal(output(outer),output(inner));assert.equal(output(inner).textContent,'<script>bad()</script>译文');assert.equal(output(inner).querySelector('font').children.length,0);
});

test('empty or malformed output retains the source and displays a retryable failure', async()=>{
 for(const response of [{translations:['  ']},{translations:[]},{translations:[3]}]){
  const h=fixture(), p=h.paragraph('Keep me');h.respond(async()=>response);const controller=createPageTranslator(h.dependencies);await controller.translatePage();assert.equal(p.firstChild.textContent,'Keep me');assert.equal(output(p).getAttribute('data-state'),'error');assert.ok(output(p).querySelector('button'));assert.equal(controller.status().errors,1);
 }
});

test('restoring during a request cancels it and ignores its late success', async()=>{
 const h=fixture(), p=h.paragraph('Original');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const controller=createPageTranslator(h.dependencies);const pending=controller.translatePage();controller.restore();finish({translations:['Late']});await pending;assert.equal(output(p),null);assert.equal(h.doc.querySelector('[data-kuai-page-loading]'),null);assert.equal(p.textContent,'Original');assert.equal(h.cancellations.length,1);assert.equal(controller.status().total,0);
});

test('a changed paragraph and changed route cannot receive stale translations', async()=>{
 for(const change of ['source','route']){
  const h=fixture(), p=h.paragraph('Original');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const controller=createPageTranslator(h.dependencies);const pending=controller.translatePage();
  if(change==='source')p.firstChild.textContent='User update';else h.env.location.href='https://example.org/next';finish({translations:['Late']});await pending;assert.equal(output(p),null);assert.equal(p.textContent,change==='source'?'User update':'Original');
 }
});

test('long paragraphs are split without truncation and reassembled after bounded requests', async()=>{
 const h=fixture(), text='a'.repeat(15000), p=h.paragraph(text);h.respond(async texts=>({translations:texts.map(value=>value.toUpperCase())}));const controller=createPageTranslator(h.dependencies);await controller.translatePage();assert.equal(h.requests.flatMap(request=>request.texts).join(''),text);assert.ok(h.requests.every(request=>request.texts.length<=12&&request.texts.every(value=>value.length<=5000)&&request.texts.join('').length<=50000));assert.equal(output(p).textContent.replaceAll(' ',''),text.toUpperCase());
});

test('changing page style preserves a successful translation and does not send another request',async()=>{
 const h=fixture(),p=h.paragraph('Original'),controller=createPageTranslator(h.dependencies);await controller.translatePage();
 const translated=output(p),text=translated.firstChild;
 h.settings.pageStyle={preset:'highlight',textColor:'#123456',fontSize:125};
 assert.equal(typeof controller.refreshPresentation,'function');controller.refreshPresentation();
 assert.strictEqual(output(p),translated);assert.strictEqual(translated.firstChild,text);assert.ok(sheet(h).includes('color:#123456!important'));assert.ok(sheet(h).includes('font-size:125%!important'));assert.equal(h.requests.length,1);assert.equal(h.cancellations.length,0);
});
test('translation-only waits for success, preserves source node identity and restores inline listeners',async()=>{
 const h=fixture(),p=h.paragraph('Hello '),source=p.firstChild,strong=h.doc.createElement('strong');strong.textContent='world';p.append(strong);let clicks=0;strong.addEventListener('click',()=>clicks++);
 h.settings.pageDisplayMode='translation_only';let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const controller=createPageTranslator(h.dependencies),pending=controller.translatePage();
 assert.equal(p.querySelector('[data-kuai-original]'),null);assert.strictEqual(source.parentNode,p);
 finish({translations:['你好世界']});await pending;
 assert.equal(p.querySelectorAll('[data-kuai-original]').length,2);assert.equal(source.parentElement.hidden,true);assert.equal(strong.parentElement.hidden,true);assert.equal(output(p).textContent,'你好世界');
 h.settings.pageDisplayMode='bilingual';controller.refreshPresentation();assert.strictEqual(p.firstChild,source);assert.strictEqual(p.children[0],strong);h.emit(strong,'click');assert.equal(clicks,1);
 controller.restore();assert.equal(p.textContent,'Hello world');assert.strictEqual(p.firstChild,source);
});
test('translation-only failure leaves original readable and nested translations remain independent',async()=>{
 const h=fixture(),outer=h.paragraph('Heading ','div'),inner=h.doc.createElement('p');inner.textContent='Nested';outer.append(inner);h.settings.pageDisplayMode='translation_only';
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.ok(outer.querySelector('[data-kuai-original]'));assert.strictEqual(inner.parentNode,outer);assert.equal(output(inner).textContent,'译：Nested');
 await controller.translatePage();assert.equal(h.requests.length,1,'hidden originals remain readable to the source collector for deduplication');
 controller.restore();assert.equal(outer.textContent,'Heading Nested');assert.strictEqual(inner.parentNode,outer);
 h.respond(async()=>({translations:[]}));await controller.translatePage();assert.equal(outer.querySelector('[data-kuai-original]'),null);assert.equal(inner.querySelector('[data-kuai-original]'),null);assert.equal(output(inner).getAttribute('data-state'),'error');
});
test('removed translation nodes restore originals from a DOM mutation without another user action',async()=>{
 const h=fixture(),p=h.paragraph('Original');h.settings.pageDisplayMode='translation_only';let observe;
 h.env.MutationObserver=class{constructor(callback){observe=callback;}observe(){}disconnect(){}};
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();const translated=output(p);translated.remove();
 assert.equal(typeof observe,'function');observe([{removedNodes:[translated]}]);await Promise.resolve();
 assert.equal(p.querySelector('[data-kuai-original]'),null);assert.equal(p.textContent,'Original');assert.equal(h.requests.length,1);controller.stop();
});


function youtubeTitle(h){
 h.env.location.href='https://www.youtube.com/watch?v=abcdef12345';
 const metadata=h.paragraph('','ytd-watch-metadata'),heading=h.doc.createElement('h1'),source=h.doc.createElement('yt-formatted-string');
 heading.className='style-scope ytd-watch-metadata';heading.style.cssText='display:flex;overflow:hidden;';source.textContent='A long YouTube video title';metadata.append(heading);heading.append(source);return {heading,source};
}

test('YouTube watch title uses a stacked source and translation layout and restores cleanly',async()=>{
 const h=fixture(),{heading,source}=youtubeTitle(h),originalStyle=heading.style.cssText;
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.equal(heading.getAttribute('data-kuai-title-layout'),'stacked');
 const layout=h.doc.querySelector('[data-kuai-title-layout-style]');assert.ok(layout);assert.match(layout.textContent,/display:block!important/);assert.match(layout.textContent,/height:auto!important/);
 assert.match(layout.textContent,/h1\[data-kuai-title-layout=stacked\]>\[data-kuai-page-translation\]>br\{display:none!important\}/,'block-level title translations must not add a leading blank line');
 assert.strictEqual(heading.firstChild,source);assert.equal(output(heading).textContent,'译：A long YouTube video title');assert.equal(heading.style.cssText,originalStyle);
 controller.refreshPresentation();assert.equal(h.doc.querySelectorAll('[data-kuai-title-layout-style]').length,1);
 controller.restore();assert.equal(heading.hasAttribute('data-kuai-title-layout'),false);assert.equal(h.doc.querySelector('[data-kuai-title-layout-style]'),null);assert.strictEqual(heading.firstChild,source);assert.equal(heading.style.cssText,originalStyle);
});

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const rect=(top,left=10)=>({top,bottom:top+30,left,right:left+390,width:390,height:30});
function setup(t){
 const h=fixture(),observers=[];h.env.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
 const page=createPageTranslator(h.dependencies),triggers=createPageTriggers({...h.dependencies,page}).start();
 t.after(()=>{triggers.stop();page.stop();});return {...h,page,triggers,mutate(records){observers.filter(o=>o.active).forEach(o=>o.callback(records));}};
}
const texts=h=>h.requests.flatMap(request=>request.texts);
async function scroll(h,target=h.doc){h.emit(target,'scroll');h.flushTimers();await settle();}
test('scroll translates newly visible blocks once and leaves offscreen text unsent',async t=>{
 const h=setup(t),first=h.paragraph('First'),next=h.paragraph('Next'),later=h.paragraph('Later');first._rect=rect(20);next._rect=rect(1200);later._rect=rect(2400);
 await h.triggers.translate();assert.deepEqual(texts(h),['First']);
 first._rect=rect(-1000);next._rect=rect(100);await scroll(h);assert.deepEqual(texts(h),['First','Next']);
 await scroll(h);assert.deepEqual(texts(h),['First','Next']);assert.equal(later.querySelector('[data-kuai-page-translation]'),null);
});
test('scroll does not opt an untouched page into translation',async t=>{
 const h=setup(t);h.paragraph('First');await scroll(h);assert.equal(h.requests.length,0);
});
test('scroll during a request waits and then translates the latest viewport once',async t=>{
 const h=setup(t),next=h.paragraph('Next'),first=h.paragraph('First');next._rect=rect(1200);let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const initial=h.triggers.translate();await settle();
 next._rect=rect(20);await scroll(h);await scroll(h);assert.equal(h.requests.length,1);
 h.respond(async values=>({translations:values.map(value=>'Translated '+value)}));finish({translations:['Translated First']});await initial;h.flushTimers();await settle();
 assert.deepEqual(texts(h),['First','Next']);
});
test('hidden pages defer scrolling work until visible again',async t=>{
 const h=setup(t),first=h.paragraph('First'),next=h.paragraph('Next');next._rect=rect(1500);await h.triggers.translate();next._rect=rect(20);
 h.doc.visibilityState='hidden';h.emit(h.doc,'visibilitychange');await scroll(h);assert.deepEqual(texts(h),['First']);
 h.doc.visibilityState='visible';h.emit(h.doc,'visibilitychange');h.flushTimers();await settle();assert.deepEqual(texts(h),['First','Next']);
});
test('scroll does not retry failed blocks automatically',async t=>{
 const h=setup(t);h.paragraph('First');h.respond(async()=>{throw Error('Offline');});await h.triggers.translate();await scroll(h);assert.equal(h.requests.length,1);
});


test('explicit paragraph translation can still translate a requested offscreen block',async t=>{
 const h=setup(t),paragraph=h.paragraph('Requested paragraph');paragraph._rect=rect(2000);
 await h.page.translateBlocks([{element:paragraph,text:'Requested paragraph'}]);assert.deepEqual(texts(h),['Requested paragraph']);
});

const outputShared=node=>node.querySelector('[data-kuai-page-translation]');
const blocks=(...nodes)=>nodes.map(element=>({element,text:element.firstChild.textContent}));
const settleShared=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function shared(h){
  const page=createPageTranslator(h.dependencies);
  assert.equal(typeof page.toggleBlocks,'function','paragraph gestures must share the page controller');
  assert.equal(typeof page.translateBlocks,'function','pointer gestures must reuse existing entries');
  return page;
}

test('paragraph toggle uses page presentation and restores the same source nodes on its second action',async()=>{
  const h=fixture(),p=h.paragraph('Original'),source=p.firstChild;h.settings.pageDisplayMode='translation_only';
  const page=shared(h);await page.toggleBlocks(blocks(p));const result=outputShared(p);
  assert.equal(result.textContent,'译：Original');assert.equal(source.parentElement.hidden,true);
  assert.equal(page.status().translated,1);await page.toggleBlocks([{element:p,text:'Original'}]);
  assert.equal(outputShared(p),null);assert.equal(p.firstChild,source);assert.equal(p.textContent,'Original');assert.equal(page.status().total,0);
  assert.equal(h.doc.querySelectorAll('[data-kuai-ui]').length,0,'closing the last paragraph also dismisses the page controls');
});

test('full-page translation reuses a completed paragraph output without another request',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),page=shared(h);
  await page.toggleBlocks(blocks(first));const result=outputShared(first);await page.translatePage();
  assert.equal(outputShared(first),result);assert.equal(outputShared(second).textContent,'译：Second');
  assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Second']]);assert.equal(page.status().translated,2);
});

test('a page pass joins an existing paragraph request and only dispatches the remaining paragraph',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  const page=shared(h),paragraph=page.toggleBlocks(blocks(first));await settleShared();const result=outputShared(first),whole=page.translatePage();await settleShared();
  assert.deepEqual(h.requests.map(item=>item.texts),[['First'],['Second']]);assert.equal(outputShared(first),result);assert.equal(page.status().active,true);
  finishes[1]({translations:['Second result']});await settleShared();assert.equal(page.status().active,true);
  finishes[0]({translations:['First result']});await Promise.all([paragraph,whole]);
  assert.equal(page.status().translated,2);assert.equal(h.cancellations.length,0);
});

test('separate paragraph requests have independent cancellation and stale output cannot return',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second'),finishes=[];h.respond(()=>new Promise(resolve=>finishes.push(resolve)));
  const page=shared(h),one=page.toggleBlocks(blocks(first)),two=page.toggleBlocks(blocks(second));await settleShared();
  await page.toggleBlocks(blocks(first));assert.deepEqual(h.cancellations,['request-1']);assert.equal(page.status().active,true);
  finishes[0]({translations:['Stale first']});finishes[1]({translations:['Current second']});await Promise.all([one,two]);await settleShared();
  assert.equal(outputShared(first),null);assert.equal(outputShared(second).textContent,'Current second');assert.equal(page.status().translated,1);
});

test('paragraph retry sends only the failed paragraph and leaves another failure available',async()=>{
  const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second');h.respond(async()=>{throw Error('Provider failed');});
  const page=shared(h);await page.translatePage();assert.equal(page.status().errors,2);
  h.respond(async texts=>({translations:texts.map(text=>'Recovered '+text)}));h.emit(outputShared(first).querySelector('button'),'click');await settleShared();
  assert.deepEqual(h.requests.map(item=>item.texts),[['First','Second'],['First']]);assert.equal(outputShared(first).querySelector('font').firstChild.textContent,'Recovered First');
  assert.equal(outputShared(second).getAttribute('data-state'),'error');assert.equal(page.status().errors,1);
});

const outputLinks = node => node.children.find(child => child.hasAttribute('data-kuai-page-translation')) || null;
const settleLinks = async () => {for(let i=0;i<16;i++)await Promise.resolve();};
function link(h,text,href,attributes={}){
  const node=h.doc.createElement('a');node.textContent=text;node.setAttribute('href',href);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
  return node;
}

test('translated identical link labels retain their separate source destinations and plain neighbors',async()=>{
  const h=fixture(),p=h.paragraph('Read '),first=link(h,'guide','/first'),second=link(h,'guide','/second');
  p.append(first,h.doc.createTextNode(' and '),second,h.doc.createTextNode('.'));
  const translated={Read:'阅读',guide:'指南',and:'以及'};h.respond(async texts=>({translations:texts.map(text=>translated[text])}));
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.deepEqual(h.requests[0].texts,['Read','guide','and','guide']);
  const result=outputLinks(p),links=result.querySelectorAll('a');assert.equal(links.length,2);
  assert.deepEqual(links.map(node=>[node.textContent,node.getAttribute('href')]),[['指南','https://example.org/first'],['指南','https://example.org/second']]);
  assert.equal(result.textContent,'阅读 指南 以及 指南.');assert.equal(result.querySelector('font').firstChild.nodeType,3);
  assert.equal(first.parentNode,p);assert.equal(second.parentNode,p);page.stop();
});

test('translation-only waits for all link runs and restores the original nodes and listeners',async()=>{
  const h=fixture(),p=h.paragraph('Read '),text=p.firstChild,a=link(h,'guide','/guide');p.append(a);let clicks=0;a.addEventListener('click',()=>clicks++);
  h.settings.pageDisplayMode='translation_only';let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=createPageTranslator(h.dependencies),pending=page.translatePage();
  assert.equal(p.querySelector('[data-kuai-original]'),null);finish({translations:['阅读','指南']});await pending;
  assert.ok(outputLinks(p).querySelector('a'));assert.equal(a.parentNode.hidden,true);assert.equal(text.parentNode.hidden,true);
  const translated=outputLinks(p).querySelector('a');assert.equal(h.emit(translated,'click').defaultPrevented,false);
  page.refreshPresentation();assert.equal(h.requests.length,1);assert.equal(outputLinks(p).querySelector('a'),translated);
  page.restore();assert.equal(p.firstChild,text);assert.equal(a.parentNode,p);h.emit(a,'click');assert.equal(clicks,1);assert.equal(p.textContent,'Read guide');
});

test('native link metadata is copied locally while provider markup and active URLs remain inert',async()=>{
  const h=fixture(),p=h.paragraph(''),a=link(h,'Guide','../guide#intro',{target:'_blank',rel:'external opener',download:'',title:'Guide title','aria-label':'Read the guide',onclick:'bad()'});
  h.doc.baseURI='https://example.org/docs/part/';p.append(a,h.doc.createTextNode(' / '),link(h,'Mail','mailto:help@example.org'),h.doc.createTextNode(' / '),link(h,'Call','tel:+123'),h.doc.createTextNode(' / '),link(h,'Active','java\nscript:bad()'),h.doc.createTextNode(' / '),link(h,'HTML','data:text/html,bad'));
  h.respond(async texts=>({translations:texts.map(text=>text==='Guide'?'<script>bad()</script><a href="https://wrong.invalid">标题</a>':text)}));
  const page=createPageTranslator(h.dependencies);await page.translatePage();const result=outputLinks(p),links=result.querySelectorAll('a[href]');
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
  assert.equal(outputLinks(h.doc.body).querySelector('a')?.getAttribute('href'),'https://example.org/standalone');
  assert.ok(outputLinks(heading));assert.equal(outputLinks(heading).querySelector('a'),null);assert.equal(outputLinks(heading).closest('a'),card);assert.equal(card.getAttribute('href'),'/card');
  assert.equal(standalone.querySelector('a'),null);page.stop();
});

test('retry rebuilds link runs after a provider failure without hiding the source prematurely',async()=>{
  const h=fixture(),p=h.paragraph('Read '),a=link(h,'Guide','/guide');p.append(a);h.settings.pageDisplayMode='translation_only';h.respond(async()=>{throw Error('Temporary failure');});
  const page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(p.querySelector('[data-kuai-original]'),null);assert.equal(outputLinks(p).getAttribute('data-state'),'error');
  h.respond(async texts=>({translations:texts.map(text=>text==='Read'?'阅读':'指南')}));h.emit(outputLinks(p).querySelector('button'),'click');await settleLinks();
  assert.equal(outputLinks(p).querySelector('a')?.textContent,'指南');assert.equal(outputLinks(p).textContent,'阅读 指南');assert.equal(a.parentNode.hidden,true);page.stop();
});

const titleText='What do you think of Justin’s style?';
const settleTitle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function card(){
  const h=fixture(),article=h.paragraph('','article'),post=h.doc.createElement('shreddit-post');
  const overlay=h.doc.createElement('a'),screen=h.doc.createElement('faceplate-screen-reader-content');
  overlay.setAttribute('href','/post');overlay.setAttribute('slot','full-post-link');screen.textContent=titleText;overlay.append(screen);
  const credit=h.doc.createElement('span'),time=h.doc.createElement('time');time.textContent='11h ago';credit.append(time);
  const title=h.doc.createElement('a'),label=h.doc.createElement('span');title.setAttribute('slot','title');title.setAttribute('href','/post');label.textContent=titleText;title.append(label);
  const body=h.doc.createElement('p');body.setAttribute('slot','text-body');body.textContent='I am just curious.';post.append(overlay,credit,title,body);article.append(post);
  const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===screen?{position:'absolute',clip:'rect(0px, 0px, 0px, 0px)',clipPath:'inset(50%)'}:{})});
  h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',delay:50};
  return {h,article,post,title,label,screen,body,overlay,credit};
}
for(const mode of ['bilingual','translation_only'])test('hovering a slotted title translates it once in its own rendered slot in '+mode,async()=>{
  const {h,article,title,label}=card();h.settings.pageDisplayMode=mode;
  const ui=createInteractions(h.dependencies).start();h.emit(label,'mousemove',{altKey:true});h.emit(h.doc,'keydown',{key:'Alt',altKey:true});h.emit(h.doc,'keyup',{key:'Alt'});h.advance(50);await settleTitle();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),[titleText]);
  const outputs=article.querySelectorAll('[data-kuai-page-translation]');assert.equal(outputs.length,1);
  assert.equal(outputs[0].parentNode,title);assert.equal(outputs[0].querySelector('font').textContent,'译：'+titleText);
  assert.equal(outputs[0].querySelector('a'),null,'the original title already owns its link');
  ui.refreshPresentation();assert.equal(article.querySelectorAll('[data-kuai-page-translation]').length,1);assert.equal(h.requests.length,1);
  ui.clearInlineTranslations();assert.equal(label.parentNode,title);assert.equal(title.getAttribute('slot'),'title');ui.stop();
});
test('page collection excludes screen-reader duplicates and keeps slotted titles out of ancestor text',async()=>{
  const {h,article,title,screen}=card();
  assert.equal(blockText(article,h.env),'11h ago');
  const blocks=collectBlocks(h.doc,h.env);assert.equal(blocks.filter(block=>block.text.includes(titleText)).length,1);
  assert.equal(blocks.find(block=>block.element===title)?.text,titleText);
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(h.requests.flatMap(request=>request.texts).filter(text=>text===titleText).length,1);
  assert.equal(screen.querySelector('[data-kuai-page-translation]'),null);
  assert.ok(title.querySelector('[data-kuai-page-translation]'));page.stop();
});

for(const target of ['overlay','post','article','credit'])test('Shift over a feed card '+target+' translates title and body at their sources without time',async()=>{
  const context=card(),{h,article,title,body}=context;h.settings.hoverOptions.trigger='shift';
  const ui=createInteractions(h.dependencies).start();
  h.emit(context[target],'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settleTitle();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),[titleText,'I am just curious.']);
  assert.equal(article.querySelectorAll('[data-kuai-page-translation]').length,2);
  assert.equal(title.querySelector('kuai-translator')?.textContent,'译：'+titleText);
  assert.equal(body.querySelector('kuai-translator')?.textContent,'译：I am just curious.');
  assert.equal(article.children.some(node=>node.tagName==='KUAI-TRANSLATOR'),false);
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settleTitle();
  assert.equal(article.querySelectorAll('[data-kuai-page-translation]').length,0);assert.equal(h.requests.length,1);ui.stop();
});

test('a never-site rule blocks a manual page request before any text reaches a service',async t=>{
  const h=fixture();h.paragraph('Private page');h.settings.pageOptions={neverSites:['example.org']};
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());
  await assert.rejects(page.translatePage(),{code:'SITE_DISABLED'});
  assert.equal(h.requests.length,0);
  assert.equal(h.doc.querySelector('[data-kuai-page-translation]'),null);
});

test('page area, explicit selector and minimum length preferences filter actual source blocks',async t=>{
  const h=fixture();h.paragraph('Readable article');const footer=h.paragraph('','footer');footer.append(h.paragraph('Footer text'));
  const excluded=h.paragraph('Do not send this');excluded.className='private';h.paragraph('Hi');
  h.settings.pageOptions={translateFullPage:false,excludeSelectors:['.private'],minTextLength:5};
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());await page.translatePage();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Readable article']);
  assert.equal(excluded.querySelector('[data-kuai-page-translation]'),null);
});

test('never-language rules skip declared source languages while translating other paragraphs',async t=>{
  const h=fixture(),english=h.paragraph('Hello world'),japanese=h.paragraph('こんにちは世界');
  english.setAttribute('lang','en');japanese.setAttribute('lang','ja');h.settings.pageOptions={neverLanguages:['ja']};
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());await page.translatePage();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Hello world']);
  assert.equal(japanese.querySelector('[data-kuai-page-translation]'),null);
});

test('an excluded inline region prevents its containing paragraph from being sent while sibling text remains eligible',async t=>{
  const h=fixture(),section=h.paragraph('Public heading','section'),privateParagraph=h.doc.createElement('p'),privateSpan=h.doc.createElement('span');
  privateParagraph.textContent='Public prefix: ';privateSpan.textContent='Private inline text';privateSpan.setAttribute('data-private','');privateParagraph.append(privateSpan);section.append(privateParagraph);h.paragraph('Public sibling');
  h.settings.pageOptions={excludeSelectors:['[data-private]']};const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());await page.translatePage();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Public heading','Public sibling']);
  assert.equal(!!privateParagraph.querySelector('[data-kuai-page-translation]'),false);assert.equal(privateParagraph.textContent,'Public prefix: Private inline text');
});

for(const mode of ['page','paragraph'])test(mode+' skips numeric-only blocks while retaining sentences with numbers',async t=>{
  const h=fixture(),skipped=['123','2026-11-04','2026/11/04','04.11.2026','12:30','99.5%','￥1,234.50','１２３','١٢٣','—'];
  const nodes=skipped.map(text=>h.paragraph(text)),normal=h.paragraph('Updated on 2026-11-04'),localized=h.paragraph('2026年11月4日');
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());
  if(mode==='page')await page.translatePage();
  else await page.translateBlocks([...nodes,normal,localized].map(element=>({element,text:element.textContent})));
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Updated on 2026-11-04','2026年11月4日']);
  for(const [i,node] of nodes.entries()){assert.equal(node.textContent,skipped[i]);assert.equal(node.querySelector('[data-kuai-page-translation]'),null);}
});

function setupBadge({top}={}){
  const h=fixture(),listeners=new Set(),subscribers=new Set(),reports=[];let persisted;
  h.env.chrome={runtime:{id:'kuai-id',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
  if(top!==undefined)h.env.top=top;
  const client={getSettings:async()=>structuredClone(persisted||h.settings),translate:h.dependencies.translate,cancel:h.dependencies.cancel,makeRequestId:h.dependencies.makeRequestId,
    onSettingsChanged:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);},reportPageState:async state=>{reports.push(state);return {shown:true};}};
  const runtime=createContentRuntime({env:h.env,client,startYouTube:()=>({stop(){}})});
  const message=type=>new Promise(resolve=>{for(const listener of listeners)if(listener({type},{id:'kuai-id'},resolve)===true)return;resolve(undefined);});
  const notify=async next=>{persisted=structuredClone(next);subscribers.forEach(fn=>fn(next));await settleBadge();};
  return {...h,runtime,message,reports,notify};
}
async function settleBadge(){for(let i=0;i<20;i++)await Promise.resolve();}

test('the toolbar badge follows page translation and restore with one report per state change',async()=>{
  const h=setupBadge();h.paragraph('Hello');h.paragraph('World');await h.runtime.start();
  assert.deepEqual(h.reports,[],'an idle fresh document needs no report');
  await h.message('KUAI_PAGE_TRANSLATE');await settleBadge();
  assert.deepEqual(h.reports,['working','done']);
  await h.message('KUAI_PAGE_RESTORE');await settleBadge();
  assert.deepEqual(h.reports,['working','done','idle']);h.runtime.stop();
});

test('subframes never report the toolbar badge',async()=>{
  const h=setupBadge({top:{}});h.paragraph('Hello');await h.runtime.start();
  await h.message('KUAI_PAGE_TRANSLATE');await settleBadge();
  assert.deepEqual(h.reports,[]);h.runtime.stop();
});

function setupStyles(name){assert.equal(typeof api[name],'function');const h=dom.fixture();return {h,node:h.paragraph('Readable translation')};}

test('page presentation changes existing translated text without replacing its text node',()=>{
  const {node}=setupStyles('applyPageStyle'),text=node.firstChild;
  api.applyPageStyle(node,{preset:'background',textColor:'#102030',fontSize:130,fontWeight:700,backgroundColor:'#ddeeff'});
  assert.equal(node.style.color,'#102030');assert.equal(node.style['font-size'],'130%');assert.equal(node.style['background-color'],'#ddeeff');
  api.applyPageStyle(node,{preset:'plain'});
  assert.equal(node.style['background-color'],'transparent');assert.equal(node.style['border-left'],'0');assert.strictEqual(node.firstChild,text);
});
test('source and translated subtitle styles have independent font, weight, color and stroke',()=>{
  const {node}=setupStyles('applySubtitleTextStyle'),text=node.firstChild;
  const style={sourceFontSize:18,targetFontSize:32,sourceWeight:300,targetWeight:800,sourceColor:'#112233',targetColor:'#ffeedd',sourceStroke:'none',targetStroke:'shadow45'};
  api.applySubtitleTextStyle(node,style,'source');assert.equal(node.style['font-size'],'18px');assert.equal(node.style['text-shadow'],'none');
  api.applySubtitleTextStyle(node,style,'target');assert.equal(node.style['font-size'],'32px');assert.equal(node.style['font-weight'],'800');assert.equal(node.style.color,'#ffeedd');assert.match(node.style['text-shadow'],/2px 2px/);assert.strictEqual(node.firstChild,text);
});
test('subtitle background and six-position changes remove stale positioning',()=>{
  const {node}=setupStyles('applySubtitleBoxStyle');api.applySubtitleBoxStyle(node,{backgroundMode:'panel',backgroundColor:'#102030',backgroundOpacity:25});assert.equal(node.style['background-color'],'rgba(16, 32, 48, 0.25)');
  assert.equal(typeof api.applySubtitlePositionStyle,'function');
  api.applySubtitlePositionStyle(node,{position:'top-right',offset:24,maxWidth:72});assert.equal(node.style.top,'24px');assert.equal(node.style.right,'3%');assert.equal(node.style.left,'auto');assert.equal(node.style.bottom,'auto');
  api.applySubtitlePositionStyle(node,{position:'bottom-center',offset:80});assert.equal(node.style.bottom,'80px');assert.equal(node.style.top,'auto');assert.equal(node.style.left,'50%');assert.equal(node.style.right,'auto');assert.equal(node.style.transform,'translateX(-50%)');
});
