import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/content-dom.cjs';
import { createPageTranslator } from '../src/content/page-translator.js';

const output = node => node.querySelector('[data-kuai-page-translation]');

test('bilingual output preserves original inline nodes/listeners and restore removes only owned output', async()=>{
 const h=fixture(), p=h.paragraph('Hello '), strong=h.doc.createElement('strong');strong.textContent='world';p.append(strong);let clicks=0;strong.addEventListener('click',()=>clicks++);
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.deepEqual(h.requests[0].texts,['Hello world']);assert.equal(output(p).textContent,'译：Hello world');assert.strictEqual(p.children[0],strong);h.emit(strong,'click');assert.equal(clicks,1);
 const siteAddition=h.doc.createElement('em');siteAddition.textContent=' updated';p.append(siteAddition);controller.restore();assert.equal(output(p),null);assert.strictEqual(p.children[1],siteAddition);assert.equal(p.textContent,'Hello world updated');
});

test('page translation sends only viewport paragraphs and excludes controls/code/hidden blocks', async()=>{
 const h=fixture();h.paragraph('First');const below=h.paragraph('Below viewport');below._rect={top:5000,left:0,right:400,bottom:5030,width:400,height:30};
 const hidden=h.paragraph('Hidden');hidden.hidden=true;h.paragraph('Secret input','textarea');h.paragraph('Code','pre');const editable=h.paragraph('Draft');editable.setAttribute('contenteditable','true');
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();assert.deepEqual(h.requests.flatMap(request=>request.texts),['First']);assert.equal(controller.status().translated,1);
});

test('nested blocks are not translated twice and provider markup is displayed as plain text', async()=>{
 const h=fixture();const outer=h.paragraph('','div'), inner=h.doc.createElement('p');inner.textContent='Nested';outer.append(inner);h.respond(async()=>({translations:['<script>bad()</script>译文']}));
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();assert.deepEqual(h.requests[0].texts,['Nested']);assert.equal(output(outer),output(inner));assert.equal(output(inner).textContent,'<script>bad()</script>译文');assert.equal(output(inner).children.length,0);
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

test('stopping preserves completed translations and marks remaining work cancelled without automatic retries', async()=>{
 const h=fixture();for(let index=0;index<12;index++)h.paragraph('Paragraph '+index);let finish;let calls=0;h.respond(texts=>++calls===1?Promise.resolve({translations:texts.map(value=>'译：'+value)}):new Promise(resolve=>{finish=resolve;}));const controller=createPageTranslator(h.dependencies);const pending=controller.translatePage();for(let pass=0;pass<8&&!finish;pass++)await Promise.resolve();controller.cancelCurrent();finish({translations:Array(4).fill('Late')});await pending;assert.equal(controller.status().active,false);assert.equal(controller.status().cancelled,true);assert.equal(controller.status().translated,8);assert.equal(h.requests.length,2);
});

test('changing page style preserves a successful translation and does not send another request',async()=>{
 const h=fixture(),p=h.paragraph('Original'),controller=createPageTranslator(h.dependencies);await controller.translatePage();
 const translated=output(p),text=translated.firstChild;
 h.settings.pageStyle={preset:'highlight',textColor:'#123456',fontSize:125};
 assert.equal(typeof controller.refreshPresentation,'function');controller.refreshPresentation();
 assert.strictEqual(output(p),translated);assert.strictEqual(translated.firstChild,text);assert.equal(translated.style.color,'#123456');assert.equal(translated.style['font-size'],'125%');assert.equal(h.requests.length,1);assert.equal(h.cancellations.length,0);
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
test('restoring translation-only preserves site changes made inside hidden originals',async()=>{
 const h=fixture(),p=h.paragraph('Original'),source=p.firstChild;h.settings.pageDisplayMode='translation_only';const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.ok(p.querySelector('[data-kuai-original]'));source.textContent='Updated by site';const addition=h.doc.createElement('em');addition.textContent=' extra';p.append(addition);
 controller.restore();assert.strictEqual(p.firstChild,source);assert.strictEqual(p.children[0],addition);assert.equal(p.textContent,'Updated by site extra');
});
test('a site removing translated output makes the hidden original readable again',async()=>{
 const h=fixture(),p=h.paragraph('Original');h.settings.pageDisplayMode='translation_only';const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 output(p).remove();controller.refreshPresentation();assert.equal(p.querySelector('[data-kuai-original]'),null);assert.equal(p.textContent,'Original');assert.equal(controller.status().translated,0);
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
 assert.strictEqual(heading.firstChild,source);assert.equal(output(heading).textContent,'译：A long YouTube video title');assert.equal(heading.style.cssText,originalStyle);
 controller.refreshPresentation();assert.equal(h.doc.querySelectorAll('[data-kuai-title-layout-style]').length,1);
 controller.restore();assert.equal(heading.hasAttribute('data-kuai-title-layout'),false);assert.equal(h.doc.querySelector('[data-kuai-title-layout-style]'),null);assert.strictEqual(heading.firstChild,source);assert.equal(heading.style.cssText,originalStyle);
});

test('YouTube title stacking also applies to paragraph translation and translation-only mode',async()=>{
 const h=fixture(),{heading,source}=youtubeTitle(h);h.settings.pageDisplayMode='translation_only';const controller=createPageTranslator(h.dependencies);
 await controller.translateBlocks([{element:heading,text:source.textContent}]);assert.equal(heading.getAttribute('data-kuai-title-layout'),'stacked');assert.ok(output(heading));
 h.settings.pageDisplayMode='bilingual';controller.refreshPresentation();assert.equal(heading.contains(source),true);controller.restore();assert.strictEqual(heading.firstChild,source);
});

test('ordinary headings do not receive YouTube-specific layout changes',async()=>{
 const h=fixture(),heading=h.paragraph('Ordinary heading','h1');const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.equal(heading.hasAttribute('data-kuai-title-layout'),false);assert.equal(h.doc.querySelector('[data-kuai-title-layout-style]'),null);controller.restore();
});


for(const mode of ['bilingual','translation_only'])test('pending '+mode+' translation uses an outside spinner after the original',async()=>{
 const h=fixture(),p=h.paragraph('Original text'),source=p.firstChild;h.settings.pageDisplayMode=mode;h.settings.pageStyle={preset:'border'};let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const page=createPageTranslator(h.dependencies),work=page.translatePage(),pending=output(p);
 assert.equal(p.textContent,'Original text');assert.strictEqual(p.firstChild,source);assert.equal(source.parentNode,p);
 assert.match(pending.style.cssText,/display:none!important/);
 const spinner=h.doc.querySelector('[data-kuai-page-loading]');assert.ok(spinner);assert.ok(spinner.shadowRoot);assert.equal(pending.getAttribute('aria-busy'),'true');
 finish({translations:['Translated text']});await work;assert.equal(h.doc.querySelector('[data-kuai-page-loading]'),null);assert.equal(output(p).textContent,'Translated text');assert.match(output(p).style.cssText,/display:block!important/);page.stop();
});


test('pending YouTube title spinner stays outside layout without adding a flex column',async()=>{
 const h=fixture(),{heading,source}=youtubeTitle(h);let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
 const page=createPageTranslator(h.dependencies),work=page.translatePage(),pending=output(heading);
 assert.equal(pending.parentNode,heading);assert.match(pending.style.cssText,/display:none!important/);assert.equal(h.doc.querySelector('[data-kuai-page-loading]').parentNode,h.doc.documentElement);assert.equal(heading.hasAttribute('data-kuai-title-layout'),false);
 finish({translations:['Translated title']});await work;assert.equal(output(heading).parentNode,heading);assert.equal(heading.getAttribute('data-kuai-title-layout'),'stacked');page.stop();
});


test('loading in a direct-text flex container uses an outside overlay and follows scroll',async()=>{
 const h=fixture(),p=h.paragraph('Flex title','h1'),source=p.firstChild;let finish;p.style.cssText='display:flex;gap:20px;justify-content:space-between';
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const page=createPageTranslator(h.dependencies),work=page.translatePage();
 const spinner=h.doc.querySelector('[data-kuai-page-loading]');assert.equal(spinner.parentNode,h.doc.documentElement);assert.match(output(p).style.cssText,/display:none!important/);assert.strictEqual(p.firstChild,source);
 p._rect={left:10,top:90,right:440,bottom:120,width:430,height:30};h.emit(h.doc,'scroll');assert.equal(spinner.style.left,'444px');assert.equal(spinner.style.top,'107px');
 finish({translations:['Translated']});await work;assert.equal(h.doc.querySelector('[data-kuai-page-loading]'),null);page.stop();
});


test('loading overlay stays hidden when the text end is clipped by a scroll container',async()=>{
 const h=fixture(),container=h.paragraph('','div'),p=h.doc.createElement('p');p.textContent='Long text';container.append(p);
 container._rect={left:0,top:50,right:500,bottom:200,width:500,height:150};p._rect={left:10,top:60,right:480,bottom:500,width:470,height:440};
 const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),overflowY:node===container?'auto':'visible'});
 let bottom=400,finish;const createRange=h.doc.createRange;h.doc.createRange=()=>{const range=createRange();range.getClientRects=()=>[{left:10,top:bottom-20,right:100,bottom,width:90,height:20}];return range;};
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));const page=createPageTranslator(h.dependencies),work=page.translatePage(),spinner=h.doc.querySelector('[data-kuai-page-loading]');
 assert.equal(spinner.style.display,'none');bottom=180;h.emit(container,'scroll');assert.equal(spinner.style.display,'block');
 finish({translations:['Translated']});await work;page.stop();
});
