import test from 'node:test';
import assert from 'node:assert/strict';
import dom,{fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createPageTriggers} from '../dist/src/content/page-triggers.js';
import {createInteractions} from '../dist/src/content/interactions.js';
import {blockText,collectBlocks,isBlock} from '../dist/src/content/dom.js';
import {createContentRuntime} from '../dist/src/content/index.js';
import * as api from '../dist/src/shared/styles.js';

const sheet=h=>h.doc.querySelector('[data-kuai-page-style]')?.textContent||'';

const output = node => node.querySelector('[data-kuai-page-translation]');

test('dominant inline text supplies the wrapper font in both layouts and display modes',async()=>{
 for(const mode of ['bilingual','translation_only'])for(const text of ['Great video','A comment with enough text to need a block translation.']){
  const h=fixture(),host=h.paragraph('','div'),attributed=h.doc.createElement('yt-attributed-string'),span=h.doc.createElement('span');
  Object.assign(host.style,{fontSize:'10px',lineHeight:'normal'});Object.assign(span.style,{fontSize:'14px',lineHeight:'20px'});span.textContent=text;attributed.append(span);host.append(attributed);h.settings.pageDisplayMode=mode;
  const before=host.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();const result=output(host);
  assert.equal(result.getAttribute('data-kuai-layout'),text==='Great video'?'inline':'block');
  for(const [property,value]of [['font-size','14px'],['line-height','20px']]){assert.equal(result.style.getPropertyValue(property),value);assert.equal(result.style.getPropertyPriority(property),'important');}
  page.refreshPresentation();assert.equal(result.style.getPropertyValue('font-size'),'14px');assert.equal(result.style.getPropertyValue('line-height'),'20px');
  assert.equal(h.doc.querySelectorAll('[data-kuai-page-style]').length,1);assert.equal(host.style.fontSize,'10px');assert.equal(span.style.fontSize,'14px');
  page.restore();assert.equal(host.outerHTML,before);
 }
});

test('direct, equal-size and host-dominant text add no wrapper font override',async()=>{
 for(const mode of ['bilingual','translation_only'])for(const kind of ['direct','equal','host-dominant']){
  const h=fixture(),host=h.paragraph(kind==='equal'?'':'Long heading text ');Object.assign(host.style,{fontSize:'16px',lineHeight:'24px'});
  if(kind!=='direct'){const child=h.doc.createElement(kind==='equal'?'span':'small');child.textContent='beta';Object.assign(child.style,{fontSize:kind==='equal'?'16px':'11px',lineHeight:'18px'});host.append(child);}
  const before=host.outerHTML;h.settings.pageDisplayMode=mode;const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(output(host).style.getPropertyValue('font-size'),'');assert.equal(output(host).style.getPropertyValue('line-height'),'');
  page.restore();assert.equal(host.outerHTML,before);
 }
});

test('dominant text sums each parent, breaks ties by first text and skips nested or unreadable text',async()=>{
 const {measureSourceLayout,pageLayout}=await import('../dist/src/content/page-layout.js');
 const h=fixture(),host=h.paragraph('Hi ','div'),first=h.doc.createElement('span'),second=h.doc.createElement('small');host.style.fontSize='16px';
 Object.assign(first.style,{fontSize:'14px',lineHeight:'20px'});Object.assign(second.style,{fontSize:'11px',lineHeight:'18px'});
 first.append('ab','cd');second.textContent='beta';host.append(first,second);
 for(const kind of ['nested','hidden']){const node=h.doc.createElement(kind==='nested'?'div':'span');node.textContent='Ignored text with many more characters';node.style.fontSize='30px';node.hidden=kind==='hidden';host.append(node);}
 let metrics=measureSourceLayout(host,h.env);assert.equal(metrics.fontSize,14);assert.equal(metrics.lineHeight,'20px');
 assert.equal(pageLayout(host,'Short','译',{...metrics,width:35,textWidth:20},h.env).layout,'block');
 second.append('x');metrics=measureSourceLayout(host,h.env);assert.equal(metrics.fontSize,11);assert.equal(metrics.lineHeight,'18px');
 const before=host.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(output(host).style.getPropertyValue('font-size'),'11px');assert.equal(output(host).style.getPropertyValue('line-height'),'18px');page.restore();assert.equal(host.outerHTML,before);
});

test('wrapper source font snapshots keep normal line-height unset and user percentages on the inner font',async()=>{
 for(const lineHeight of ['normal','20px']){
  const h=fixture(),host=h.paragraph('','div'),span=h.doc.createElement('span');host.style.fontSize='10px';Object.assign(span.style,{fontSize:'14px',lineHeight});span.textContent='Great video';host.append(span);
  h.settings.pageStyle={fontSize:125,lineHeight:1.5};const before=host.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();const result=output(host);
  assert.equal(result.style.getPropertyValue('font-size'),'14px');assert.equal(result.style.getPropertyValue('line-height'),lineHeight==='normal'?'':'20px');
  assert.match(sheet(h),/kuai-translator\[data-state=success\]>font\.kuai-translator-inner\{[^}]*font-size:125%!important/);assert.match(sheet(h),/line-height:1.5!important/);
  span.style.fontSize='18px';span.style.lineHeight='28px';page.refreshPresentation();
  assert.equal(result.style.getPropertyValue('font-size'),'14px');assert.equal(result.style.getPropertyValue('line-height'),lineHeight==='normal'?'':'20px');
  span.style.fontSize='14px';span.style.lineHeight=lineHeight;page.restore();assert.equal(host.outerHTML,before);
 }
});

test('a short inline translation at a larger source font is not mistaken for a squeezed column',async()=>{
 const h=fixture(),host=h.paragraph('','div'),span=h.doc.createElement('span');host.style.fontSize='10px';span.style.fontSize='20px';span.textContent='Great video';host.append(span);
 const create=h.doc.createElement;h.doc.createElement=tag=>{const element=create(tag);if(tag==='font')element.getBoundingClientRect=()=>({width:20,height:23});return element;};
 h.respond(async texts=>({translations:texts.map(()=>'好')}));
 const page=createPageTranslator(h.dependencies);await page.translatePage();
 assert.equal(output(host).getAttribute('data-kuai-layout'),'inline');assert.equal(output(host).hasAttribute('data-kuai-forced-block'),false);page.restore();
});

test('non-language text matches only web addresses, handles and abbreviated counts',async()=>{
 const {isNonLanguageText}=await import('../dist/src/content/dom.js');assert.equal(typeof isNonLanguageText,'function');
 for(const text of ['@imeanL9T','@Jeff-th5ob','@user.name @other','@用户·１２_名','4.8M','421K','25k','10K+','1,2M','https://a.example/x @bob 4.8M','https://a.example/x','www.example.com','<https://a.example/x>.','「@bob」','(4.8M).','+1,200.5B','-4.8 T+','4.8\u00a0M','https://a.example/x @bob 4.8 M'])assert.equal(isNonLanguageText(text),true,text);
 for(const text of ['Pinned by @jawed','4.8M views','M','K+','@','email me @ noon','Model 3M tape','OK','5 months ago','986 replies','165','17:39','','   ','!!!','!!! 4.8M','@bob/foo','@bob@example.com','@¼','4.8  M','4.8\nM','4..8M'])assert.equal(isNonLanguageText(text),false,text);
});

test('page translation skips non-language blocks and leaves numbers and times untranslated',async()=>{
 const h=fixture(),skipped=['@imeanL9T','4.8M','165','17:39'].map(text=>h.paragraph(text)),prose=h.paragraph('Great video');
 const page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].texts,['Great video']);
 for(const host of skipped)assert.equal(output(host),null);assert.ok(output(prose));page.restore();
});

test('sentences containing handles or counts remain whole translation units',async()=>{
 const h=fixture(),texts=['Pinned by @jawed','986 replies','4.8M views','5 months ago'];for(const text of texts)h.paragraph(text);
 const page=createPageTranslator(h.dependencies);await page.translatePage();assert.deepEqual(h.requests.flatMap(request=>request.texts),texts);page.restore();
});

test('a handle-labelled link stays verbatim while its sentence runs translate',async()=>{
 for(const mode of ['bilingual','translation_only']){
  const h=fixture(),host=h.paragraph('Thanks '),a=h.doc.createElement('a');a.textContent='@bob';a.setAttribute('href','/@bob');host.append(a,' for this');h.settings.pageDisplayMode=mode;
  h.respond(async texts=>({translations:texts.map(text=>text==='Thanks'?'感谢':'提供这个')}));const before=host.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Thanks','for this']);const result=output(host),translated=result.querySelector('a');
  assert.equal(result.textContent,'感谢 @bob 提供这个');assert.equal(translated.textContent,'@bob');assert.equal(translated.getAttribute('href'),'https://example.org/@bob');
  page.refreshPresentation();assert.equal(translated.textContent,'@bob');page.restore();assert.equal(host.outerHTML,before);
 }
});

test('bilingual output preserves original inline nodes/listeners and restore removes only owned output', async()=>{
 const h=fixture(), p=h.paragraph('Hello '), strong=h.doc.createElement('strong');strong.textContent='world';p.append(strong);let clicks=0;strong.addEventListener('click',()=>clicks++);
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.deepEqual(h.requests[0].texts,['Hello world']);assert.equal(output(p).textContent,'译：Hello world');assert.strictEqual(p.children[0],strong);h.emit(strong,'click');assert.equal(clicks,1);
 const siteAddition=h.doc.createElement('em');siteAddition.textContent=' updated';p.append(siteAddition);controller.restore();assert.equal(output(p),null);assert.strictEqual(p.children[1],siteAddition);assert.equal(p.textContent,'Hello world updated');
});

test('translated rows share one page stylesheet that is removed with the last row', async()=>{
 const h=fixture(),first=h.paragraph('First'),second=h.paragraph('Second');const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.ok(output(first)&&output(second));assert.equal(h.doc.querySelectorAll('[data-kuai-page-style]').length,1);assert.match(sheet(h),/kuai-translator\[data-state=success\]>font\.kuai-translator-inner\{/);
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

function clampedBlock(h){
 const parent=h.paragraph('','ytd-expander'),child=h.doc.createElement('div');parent.style.display='block';child.id='content';child.textContent='A clamped YouTube comment';child.style.webkitLineClamp='4';child.style.display='-webkit-box';parent.append(child);
 const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===child?{display:child.getAttribute('data-kuai-page-source')==='expanded'?'-webkit-box':'flow-root'}:{})});
 return {parent,child};
}

for(const mode of ['bilingual','translation_only'])test(`clamped block stays the sole translation host across passes in ${mode}`,async()=>{
 const h=fixture(),{parent,child}=clampedBlock(h);h.settings.pageDisplayMode=mode;
 const page=createPageTranslator(h.dependencies);
 for(let pass=0;pass<3;pass++){
  await page.translatePage();assert.equal(child.getAttribute('data-kuai-page-source'),'expanded');
  assert.equal(h.doc.querySelectorAll('[data-kuai-page-translation]').length,1);assert.strictEqual(output(child).parentNode,child);assert.equal(parent.children.some(node=>node.hasAttribute('data-kuai-page-translation')),false);assert.equal(h.requests.length,1);
 }
 page.restore();
});

test('translation-only clamped blocks keep identical markup across passes and restore exactly',async()=>{
 const h=fixture(),{parent}=clampedBlock(h),before=parent.outerHTML;h.settings.pageDisplayMode='translation_only';
 const page=createPageTranslator(h.dependencies);await page.translatePage();const translated=parent.outerHTML;
 await page.translatePage();assert.equal(parent.outerHTML,translated);await page.translatePage();assert.equal(parent.outerHTML,translated);
 page.restore();assert.equal(parent.outerHTML,before);
});

test('translated block hosts stay pinned across inline style flips until restore',async()=>{
 for(const mode of ['bilingual','translation_only']){
  const h=fixture(),parent=h.paragraph('','div'),child=h.doc.createElement('div');child.textContent='Nested source';parent.append(child);h.settings.pageDisplayMode=mode;
  let display='block';const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===child?{display}:{})});
  const page=createPageTranslator(h.dependencies);await page.translatePage();const translated=output(child);display='inline';assert.equal(isBlock(child,h.env),true);
  await page.translatePage();assert.equal(h.doc.querySelectorAll('[data-kuai-page-translation]').length,1);assert.strictEqual(output(child),translated);assert.strictEqual(translated.parentNode,child);assert.equal(h.requests.length,1);
  page.restore();assert.equal(isBlock(child,h.env),false);
 }
});

test('translating an inline region leaves its block identity unchanged',async()=>{
 const h=fixture(),parent=h.paragraph('Sentence '),child=h.doc.createElement('span');child.textContent='inline region';parent.append(child);
 const page=createPageTranslator(h.dependencies);await page.translateBlocks([{element:child,text:child.textContent}]);
 assert.ok(output(child));assert.equal(isBlock(child,h.env),false);page.restore();assert.equal(isBlock(child,h.env),false);
});

test('display classification covers block keywords and preserves inline and transparent boxes',()=>{
 const h=fixture(),node=h.paragraph('Label','span');
 for(const display of ['-webkit-box','table-row-group','block flex']){node.style.display=display;assert.equal(isBlock(node,h.env),true,display);}
 for(const display of ['-webkit-inline-box','inline','inline flow','inline-block','inline-table','inline flex','none','contents','ruby','ruby-base','math']){node.style.display=display;assert.equal(isBlock(node,h.env),false,display);}
});

test('atomic inline links stand alone outside prose and skip block siblings when detecting prose',()=>{
 for(const display of ['-webkit-inline-box','inline-table']){
  const h=fixture(),parent=h.paragraph('','div'),link=h.doc.createElement('a'),sibling=h.doc.createElement('span');link.style.display=display;link.textContent='Explore';parent.append(link,sibling);
  assert.equal(isBlock(link,h.env),true,display);
  sibling.textContent='Separate block';for(const blockDisplay of ['-webkit-box','table-row-group','block flex']){sibling.style.display=blockDisplay;assert.equal(isBlock(link,h.env),true,blockDisplay);}
  sibling.style.display='inline';assert.equal(isBlock(link,h.env),false,display);
 }
});

test('absolutely positioned inline boxes are translated as their own blocks', async()=>{
 const h=fixture(),card=h.paragraph('','div'),link=h.doc.createElement('a'),title=h.doc.createElement('strong'),desc=h.doc.createElement('p');
 link.setAttribute('href','/ai');title.textContent='AI tech';desc.textContent='The closest AI';link.append(title,desc);card.append(link);
 const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===link?{position:'absolute'}:{})});
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.deepEqual(h.requests.flatMap(request=>request.texts),['AI tech','The closest AI']);assert.strictEqual(output(link).parentNode,link);assert.equal(output(link).textContent,'译：AI tech');
});

test('empty overflow-hidden accessibility labels stay out of page translation', async()=>{
 const h=fixture(),p=h.paragraph('Investor relations '),label=h.doc.createElement('span');label.textContent='opens in a new window';label._rect={top:10,left:10,right:10,bottom:10,width:0,height:0};p.append(label);
 const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===label?{position:'absolute',overflow:'hidden'}:{})});
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.deepEqual(h.requests.flatMap(request=>request.texts),['Investor relations']);
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
 assert.ok(output(p)===translated);assert.strictEqual(translated.firstChild,text);assert.ok(sheet(h).includes('color:#123456!important'));assert.ok(sheet(h).includes('font-size:125%!important'));assert.equal(h.requests.length,1);assert.equal(h.cancellations.length,0);
});
test('translation-only waits for success, preserves source node identity and restores inline listeners',async()=>{
 const h=fixture(),p=h.paragraph('Hello '),source=p.firstChild,strong=h.doc.createElement('strong');strong.textContent='world';p.append(strong);let clicks=0;strong.addEventListener('click',()=>clicks++);
 h.settings.pageDisplayMode='translation_only';let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const controller=createPageTranslator(h.dependencies),pending=controller.translatePage();
 assert.equal(p.querySelector('[data-kuai-original]'),null);assert.strictEqual(source.parentNode,p);
 finish({translations:['你好世界']});await pending;
 assert.equal(p.querySelectorAll('[data-kuai-original]').length,1);assert.equal(source.nodeValue,'');assert.strictEqual(source.parentNode,p);assert.ok(strong.hasAttribute('data-kuai-original'));assert.strictEqual(strong.parentNode,p);assert.ok(sheet(h).includes('[data-kuai-original]{display:none!important}'));assert.equal(output(p).textContent,'你好世界');
 h.settings.pageDisplayMode='bilingual';controller.refreshPresentation();assert.strictEqual(p.firstChild,source);assert.strictEqual(p.children[0],strong);h.emit(strong,'click');assert.equal(clicks,1);
 controller.restore();assert.equal(p.textContent,'Hello world');assert.strictEqual(p.firstChild,source);
});
test('translation-only failure leaves original readable and nested translations remain independent',async()=>{
 const h=fixture(),outer=h.paragraph('Heading ','div'),inner=h.doc.createElement('p');inner.textContent='Nested';outer.append(inner);h.settings.pageDisplayMode='translation_only';
 const controller=createPageTranslator(h.dependencies);await controller.translatePage();
 assert.equal(outer.firstChild.nodeValue,'');assert.equal(inner.firstChild.nodeValue,'');assert.strictEqual(inner.parentNode,outer);assert.equal(output(inner).textContent,'译：Nested');
 await controller.translatePage();assert.equal(h.requests.length,1,'hidden originals remain readable to the source collector for deduplication');
 controller.restore();assert.equal(outer.textContent,'Heading Nested');assert.strictEqual(inner.parentNode,outer);
 h.respond(async()=>({translations:[]}));await controller.translatePage();assert.equal(outer.querySelector('[data-kuai-original]'),null);assert.equal(inner.querySelector('[data-kuai-original]'),null);assert.equal(output(inner).getAttribute('data-state'),'error');
});
test('removed translation nodes reattach once and restore originals when repeated wipes trip the guard',async t=>{
 const h=setup(t),p=h.paragraph('Original');h.settings.pageDisplayMode='translation_only';
 await h.triggers.translate();const translated=output(p);
 for(let wipe=1;wipe<=4;wipe++){
  translated.remove();h.mutate([{type:'childList',target:p,removedNodes:[translated],addedNodes:[]}]);await settle();
  if(wipe<=3){assert.ok(output(p)===translated);assert.equal(p.firstChild.nodeValue,'');}
 }
 assert.equal(output(p),null);assert.equal(p.querySelector('[data-kuai-original]'),null);assert.equal(p.textContent,'Original');assert.deepEqual(texts(h),['Original']);
 h.flushTimers();await settle();assert.equal(output(p),null);assert.deepEqual(texts(h),['Original']);
 await h.triggers.translate();assert.ok(output(p));assert.deepEqual(texts(h),['Original']);
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
test('automatic passes stop retranslating a block the page keeps rebuilding, while manual translate retries',async t=>{
 const h=setup(t);let card=h.paragraph('Card');card._rect=rect(20);
 await h.triggers.translate();
 const rebuild=async()=>{const next=h.paragraph('Card');next._rect=rect(20);card.remove();h.mutate([{type:'childList',target:h.doc.body,addedNodes:[next],removedNodes:[card]}]);await settle();h.flushTimers();await settle();card=next;};
 for(let round=0;round<4;round++)await rebuild();
 assert.deepEqual(texts(h),['Card']);assert.equal(output(card),null);
 await h.triggers.translate();assert.deepEqual(texts(h),['Card']);assert.ok(output(card));
});
const elapse=async(h,ms)=>{h.advance(ms);await settle();};
test('a source returning to translated text reuses cached parts without waiting to settle',async t=>{
 const h=setup(t),p=h.paragraph('Original');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();
 p.firstChild.textContent='Changed';h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,2400);
 assert.equal(output(p).textContent,'译：Changed');assert.deepEqual(texts(h),['Original','Changed']);
 p.firstChild.textContent='Original';h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,250);
 assert.equal(output(p).getAttribute('data-state'),'success');assert.equal(output(p).textContent,'译：Original');assert.equal(h.page.status().active,false);assert.equal(h.doc.querySelector('[data-kuai-page-loading]'),null);
 await elapse(h,30000);assert.deepEqual(texts(h),['Original','Changed']);assert.equal(h.timerCount(),0);
});
function watchNeighbour(h){
 const stable=h.doc.body.children.find(node=>blockText(node,h.env)==='Stable'),translated=output(stable),source=stable.firstChild.nodeType===3?stable.firstChild:stable.firstChild.firstChild;let value=source.nodeValue,reads=0,writes=0;
 Object.defineProperty(source,'nodeValue',{get(){reads++;return value;},set(next){value=next;}});const set=translated.setAttribute.bind(translated);translated.setAttribute=(...args)=>{writes++;set(...args);};
 return ()=>{assert.equal(reads,0,'an unrelated source is never read by mutation repair');assert.equal(writes,0,'an unrelated output is never presented by mutation repair');assert.strictEqual(output(stable),translated);};
}
test('same-text replacement reattaches cached translation in the mutation microtask',async t=>{
 const h=setup(t),old=h.paragraph('Original');h.paragraph('Stable');await h.triggers.translate();const unchanged=watchNeighbour(h),wrapper=h.doc.createElement('section'),p=h.doc.createElement('p');p.textContent='Original';wrapper.append(p);h.doc.body.append(wrapper);old.remove();
 h.mutate([{type:'childList',target:h.doc.body,removedNodes:[old],addedNodes:[wrapper]}]);await settle();
 assert.equal(output(p)?.getAttribute('data-state'),'success');assert.equal(output(p).textContent,'译：Original');assert.deepEqual(texts(h),['Original','Stable']);assert.equal(h.doc.querySelector('[data-kuai-page-loading]'),null);assert.equal(h.page.status().active,false);unchanged();
});
test('cached replacement repair stops self-rebuilding widgets before any trigger timer',async t=>{
 const h=setup(t);let p=h.paragraph('Original');h.paragraph('Stable');await h.triggers.translate();const unchanged=watchNeighbour(h);
 for(let wipe=1;wipe<=5;wipe++){
  const next=h.paragraph('Original');p.remove();h.mutate([{type:'childList',target:h.doc.body,removedNodes:[p],addedNodes:[next]}]);await settle();p=next;
  assert.equal(!!output(p),wipe<3);
 }
 assert.deepEqual(texts(h),['Original','Stable']);unchanged();
 await h.triggers.translate();assert.equal(output(p).textContent,'译：Original');assert.deepEqual(texts(h),['Original','Stable']);
});
test('same-text anchor replacement rebinds translated navigation without replacing the output',async t=>{
 const h=setup(t),p=h.paragraph('Read '),old=link(h,'guide','/guide');p.append(old);h.paragraph('Stable');await h.triggers.translate();const translated=output(p),a=translated.querySelector('a'),unchanged=watchNeighbour(h),next=link(h,'guide','/guide');
 p.insertBefore(next,old);old.remove();h.mutate([{type:'childList',target:p,removedNodes:[old],addedNodes:[next]}]);await settle();
 assert.ok(output(p)===translated);assert.ok(translated.querySelector('a')===a);assert.equal(h.emit(a,'click').defaultPrevented,false);unchanged();
 next.setAttribute('href','/updated');h.mutate([{type:'attributes',target:next,attributeName:'href'}]);await settle();
 assert.equal(a.getAttribute('href'),'https://example.org/updated');assert.equal(h.emit(a,'click').defaultPrevented,false);assert.deepEqual(texts(h),['Read','guide','Stable']);unchanged();
});
for(const mode of ['bilingual','translation_only'])test(`same-text child replacement repairs wiped output and bounds repeated repair in ${mode}`,async t=>{
 const h=setup(t),p=h.paragraph('Original');h.paragraph('Stable');h.settings.pageDisplayMode=mode;await h.triggers.translate();const translated=output(p),unchanged=watchNeighbour(h);
 for(let wipe=1;wipe<=5;wipe++){
  const removed=[...p.childNodes];p.replaceChildren(h.doc.createTextNode('Original'));h.mutate([{type:'childList',target:p,removedNodes:removed,addedNodes:[p.firstChild]}]);await settle();
  if(wipe<=3){assert.ok(output(p)===translated);assert.equal(output(p).textContent,'译：Original');if(mode==='translation_only')assert.equal(p.firstChild.nodeValue,'');}
  else{assert.equal(output(p),null);assert.equal(p.querySelector('[data-kuai-original]'),null);assert.equal(p.textContent,'Original');}
 }
 assert.deepEqual(texts(h),['Original','Stable']);assert.equal(h.page.status().active,false);unchanged();
 h.flushTimers();await settle();assert.equal(output(p),null);assert.deepEqual(texts(h),['Original','Stable']);
});
test('output repair gets a new loop window after a quiet second',async t=>{
 const h=setup(t),p=h.paragraph('Original');await h.triggers.translate();const translated=output(p);
 for(let wipe=0;wipe<6;wipe++){
  if(wipe===3)await elapse(h,1001);
  translated.remove();h.mutate([{type:'childList',target:p,removedNodes:[translated],addedNodes:[]}]);await settle();assert.ok(output(p)===translated);
 }
 const next=h.paragraph('Original');p.remove();h.mutate([{type:'childList',target:h.doc.body,removedNodes:[p],addedNodes:[next]}]);await settle();
 assert.equal(output(next).textContent,'译：Original');assert.deepEqual(texts(h),['Original']);
});
test('cached entries and replacement repair still respect viewport, readability, policy and validation',async t=>{
 for(const change of ['viewport','readability','policy','validation','route','visibility']){
  const h=setup(t),old=h.paragraph('Original');let valid=true;const validate=()=>valid;
  h.settings.pageOptions={excludeSelectors:['.private']};await h.page.translateBlocks([{element:old,text:'Original'}],{validate});
  const next=h.paragraph('Original');old.remove();
  if(change==='viewport')next._rect=rect(2000);else if(change==='readability')next.hidden=true;
  else if(change==='policy')next.className='private';else if(change==='validation')valid=false;
  else if(change==='route')h.env.location.href='https://example.org/next';else h.doc.visibilityState='hidden';
  h.mutate([{type:'childList',target:h.doc.body,removedNodes:[old],addedNodes:[next]}]);await settle();assert.equal(output(next),null,change);assert.deepEqual(texts(h),['Original']);
  if(!['route','visibility'].includes(change)){
   await h.page.translateBlocks([{element:next,text:'Original'}],{validate,viewportOnly:true});assert.equal(output(next),null,change);assert.deepEqual(texts(h),['Original']);
  }
 }
});
test('cached units skip repeated language detection but settings changes and restore require new translations',async t=>{
 const h=setup(t),p=h.paragraph('Original');h.settings.pageOptions={neverLanguages:['ja']};let detections=0;
 h.env.chrome={i18n:{detectLanguage:async()=>{detections++;return {isReliable:true,languages:[{language:'en',percentage:100}]};}}};
 await h.page.translateBlocks([{element:p,text:'Original'}]);await h.page.toggleBlocks([{element:p,text:'Original'}]);
 const reused=h.page.translateBlocks([{element:p,text:'Original'}]);assert.equal(output(p).getAttribute('data-state'),'success');assert.equal(h.page.status().active,false);await reused;
 assert.equal(detections,1);assert.deepEqual(texts(h),['Original']);
 h.settings.targetLanguage='fr';await h.page.translateBlocks([{element:p,text:'Original'}]);assert.equal(detections,2);assert.deepEqual(texts(h),['Original','Original']);
 h.page.restore();await h.page.translateBlocks([{element:p,text:'Original'}]);assert.equal(detections,3);assert.deepEqual(texts(h),['Original','Original','Original']);
});
test('the translation cache evicts its least recently used entry at 500 successes',async t=>{
 const h=setup(t),p=h.paragraph('Item 0');
 const show=async text=>{p.textContent=text;await h.page.translateBlocks([{element:p,text}]);await h.page.toggleBlocks([{element:p,text}]);};
 for(let item=0;item<500;item++)await show(`Item ${item}`);
 await show('Item 0');await show('Item 500');assert.equal(texts(h).length,501);
 await show('Item 0');assert.equal(texts(h).length,501,'a recent hit survives eviction');
 await show('Item 1');assert.equal(texts(h).length,502,'the oldest unused entry was evicted');
});
for(const dynamic of [true,false])test(`a 1 Hz inline timer settles once after ticking with dynamic translation ${dynamic?'on':'off'}`,async t=>{
 const h=setup(t),block=h.paragraph('','div'),label=h.doc.createElement('span'),timer=h.doc.createElement('span');block.style.display='flex';label.append('Working for ',timer);block.append(label);timer.textContent='1s';
 const stable=h.paragraph('Stable sibling');h.settings.pageOptions={translateDynamic:dynamic};await h.triggers.translate();const siblingOutput=output(stable);
 for(let tick=1;tick<=10;tick++){
  await elapse(h,tick===1?1000:750);
  if(dynamic){timer.firstChild.textContent=`${tick+1}s`;h.mutate([{type:'characterData',target:timer.firstChild}]);}
  else{const removed=[...timer.childNodes];timer.textContent=`${tick+1}s`;h.mutate([{type:'childList',target:timer,addedNodes:[timer.firstChild],removedNodes:removed}]);}
  if(tick===4){const added=h.paragraph('Brand new block');h.mutate([{type:'childList',target:h.doc.body,addedNodes:[added],removedNodes:[]}]);}
  await settle();await elapse(h,250);
  assert.equal(texts(h).filter(text=>text.startsWith('Working for')).length,1);
  assert.strictEqual(output(stable),siblingOutput);assert.equal(h.page.status().active,false);assert.equal(h.doc.querySelector('[data-kuai-page-loading]'),null);
  if(tick>=4)assert.ok(texts(h).includes('Brand new block'),'first-time blocks translate promptly');
 }
 assert.equal(texts(h).filter(text=>text==='Stable sibling').length,1);
 await elapse(h,2149);assert.equal(output(block),null);
 await elapse(h,1);assert.deepEqual(texts(h).filter(text=>text.startsWith('Working for')),['Working for 1s','Working for 11s']);assert.equal(output(block).textContent,'译：Working for 11s');
 await elapse(h,30000);assert.equal(texts(h).filter(text=>text==='Working for 11s').length,1);
});
test('streaming text sends only the final paragraph after its quiet window',async t=>{
 const h=setup(t),p=h.paragraph('Streaming');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();let text='Streaming';
 for(let chunk=0;chunk<20;chunk++){
  await elapse(h,100);text+=' more';p.firstChild.textContent=text;h.mutate([{type:'characterData',target:p.firstChild}]);await settle();
  assert.deepEqual(texts(h),['Streaming']);
 }
 await elapse(h,2399);assert.deepEqual(texts(h),['Streaming']);
 await elapse(h,1);assert.deepEqual(texts(h),['Streaming',text]);assert.equal(output(p).textContent,'译：'+text);
});
test('repeatedly wasted translations back off for a block changing every 2.5 seconds',async t=>{
 const h=setup(t),p=h.paragraph('Version zero');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();
 for(let version=1;version<=24;version++){
  await elapse(h,version===1?2500:2250);p.firstChild.textContent=`Version ${version}`;h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,250);
 }
 assert.ok(texts(h).length<=3,`bounded requests over 60s: ${texts(h).length}`);
 await elapse(h,30000);assert.equal(texts(h).filter(text=>text==='Version 24').length,1);assert.equal(output(p).textContent,'译：Version 24');
});
test('manual page and paragraph actions bypass a just-changed source settle gate',async t=>{
 for(const action of ['trigger','page','blocks','toggle']){
  const h=setup(t),p=h.paragraph('Original');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();
  p.firstChild.textContent='Changed';h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,250);assert.deepEqual(texts(h),['Original']);
  if(action==='trigger')await h.triggers.translate();else if(action==='page')await h.page.translatePage({retryErrors:true});
  else await h.page[action==='blocks'?'translateBlocks':'toggleBlocks']([{element:p,text:'Changed'}]);
  assert.deepEqual(texts(h),['Original','Changed']);assert.ok(output(p));await elapse(h,30000);assert.equal(texts(h).length,2);
 }
});
test('restore, stop and cancel clear a deferred automatic translation',async t=>{
 for(const action of ['restore','stop','cancelCurrent']){
  const h=setup(t),p=h.paragraph('Original');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();
  p.firstChild.textContent='Changed';h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,250);assert.equal(h.timerCount(),1);
  h.page[action]();await elapse(h,30000);assert.deepEqual(texts(h),['Original']);assert.equal(h.timerCount(),0);assert.equal(output(p),null);
  if(action!=='cancelCurrent'){await h.page.translatePage({retryErrors:false});assert.deepEqual(texts(h),['Original','Changed'],'restore clears source history too');}
 }
});
test('changing pending blocks share one deferred timer and ignore the wasted response',async t=>{
 const h=setup(t),first=h.paragraph('First'),second=h.paragraph('Second');h.settings.pageOptions={translateDynamic:true};let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
 const initial=h.triggers.translate();await settle();
 for(const p of [first,second]){p.firstChild.textContent+=' changed';h.mutate([{type:'characterData',target:p.firstChild}]);}await settle();await initial;await elapse(h,250);
 assert.equal(h.page.status().active,false);assert.equal(h.page.status().total,0);assert.equal(h.timerCount(),1);assert.equal(h.cancellations.length,1);
 h.respond(async values=>({translations:values.map(text=>'译：'+text)}));await elapse(h,2150);
 assert.deepEqual(h.requests.map(request=>request.texts),[['First','Second'],['First changed','Second changed']]);assert.equal(h.timerCount(),0);
 finish({translations:['Stale first','Stale second']});await settle();assert.equal(output(first).textContent,'译：First changed');assert.equal(output(second).textContent,'译：Second changed');
});
test('a deferred retry re-reads source and waits again if an unobserved change arrived',async t=>{
 const h=setup(t),p=h.paragraph('Original');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();
 p.firstChild.textContent='Changed';h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,250);
 p.firstChild.textContent='Latest';await elapse(h,2150);assert.deepEqual(texts(h),['Original']);assert.equal(h.timerCount(),1);
 await elapse(h,2399);assert.deepEqual(texts(h),['Original']);await elapse(h,1);assert.deepEqual(texts(h),['Original','Latest']);
});
test('deferred retries respect current viewport, readability, policy and route',async t=>{
 for(const change of ['viewport','readability','policy','route','visibility','removed']){
  const h=setup(t),p=h.paragraph('Original');h.settings.pageOptions={translateDynamic:true};await h.triggers.translate();
  p.firstChild.textContent='Changed';h.mutate([{type:'characterData',target:p.firstChild}]);await settle();await elapse(h,250);
  if(change==='viewport')p._rect=rect(2000);else if(change==='readability')p.hidden=true;
  else if(change==='policy')h.settings.pageOptions.neverSites=['example.org'];else if(change==='route')h.env.location.href='https://example.org/next';
  else if(change==='visibility')h.doc.visibilityState='hidden';else p.remove();
  await elapse(h,30000);assert.deepEqual(texts(h),['Original'],change);assert.equal(output(p),null);assert.equal(h.timerCount(),0);
 }
});
test('a source mutation validates only affected blocks and accumulates targets across a burst',async t=>{
 const h=setup(t),first=h.paragraph('First'),second=h.paragraph('Second'),stable=h.paragraph('Stable');await h.triggers.translate();await settle();
 const stableOutput=output(stable),source=stable.firstChild,value=source.nodeValue;let reads=0;Object.defineProperty(source,'nodeValue',{get(){reads++;return value;}});
 first.firstChild.textContent='Updated first';h.mutate([{type:'characterData',target:first.firstChild}]);
 second.firstChild.textContent='Updated second';h.mutate([{type:'characterData',target:second.firstChild}]);await settle();
 assert.equal(reads,0,'an unrelated source is never read by mutation repair');assert.strictEqual(output(stable),stableOutput);assert.equal(output(first),null);assert.equal(output(second),null);assert.deepEqual(texts(h),['First','Second','Stable']);
 h.page.refreshPresentation();assert.ok(reads>0,'explicit presentation refresh still validates every entry');
});
test('a carousel transition translates the slide it brings into view',async t=>{
 const h=setup(t),first=h.paragraph('First'),slide=h.paragraph('Slide');first._rect=rect(20);slide._rect=rect(20,1600);
 await h.triggers.translate();assert.deepEqual(texts(h),['First']);
 slide._rect=rect(20);h.emit(h.doc,'transitionend');h.flushTimers();await settle();assert.deepEqual(texts(h),['First','Slide']);
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
  assert.equal(result.textContent,'译：Original');assert.equal(source.nodeValue,'');assert.strictEqual(source.parentNode,p);
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
  assert.ok(outputLinks(p).querySelector('a'));assert.ok(a.hasAttribute('data-kuai-original'));assert.strictEqual(a.parentNode,p);assert.equal(text.nodeValue,'');assert.strictEqual(text.parentNode,p);
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
  assert.equal(outputLinks(p).querySelector('a')?.textContent,'指南');assert.equal(outputLinks(p).textContent,'阅读 指南');assert.ok(a.hasAttribute('data-kuai-original'));assert.strictEqual(a.parentNode,p);page.stop();
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

for(const mode of ['page','paragraph'])test(mode+' skips blocks holding only web addresses while retaining sentences with addresses',async t=>{
  const h=fixture(),skipped=['https://example.com/docs/getting-started?tab=readme#install','www.example.com','github.com/owner/repo','<https://example.com/a>.','http://localhost:3000/ https://example.org/b'];
  const nodes=skipped.map(text=>h.paragraph(text)),normal=h.paragraph('Read https://example.com/docs first'),name=h.paragraph('Node.js'),localized=h.paragraph('https://example.com是官方网站');
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());
  if(mode==='page')await page.translatePage();
  else await page.translateBlocks([...nodes,normal,name,localized].map(element=>({element,text:element.textContent})));
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Read https://example.com/docs first','Node.js','https://example.com是官方网站']);
  for(const [i,node] of nodes.entries()){assert.equal(node.textContent,skipped[i]);assert.equal(node.querySelector('[data-kuai-page-translation]'),null);}
});
test('a link shown as its own address keeps that address inside a translated sentence',async t=>{
  const h=fixture(),p=h.paragraph('Source: ');p.append(link(h,'https://example.org/report','https://example.org/report'),h.doc.createTextNode(' (archived)'));
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());await page.translatePage();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Source:','(archived)']);
  assert.equal(output(p).querySelector('a').textContent,'https://example.org/report');
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

test('page controls translate readable text without enabling generic button hover',async()=>{
 const {isReadable}=await import('../dist/src/content/dom.js');
 const h=fixture(),button=h.paragraph('Explore','button'),icon=h.doc.createElement('svg'),hidden=h.doc.createElement('span');
 icon.textContent='Icon';hidden.textContent='Hidden label';hidden.hidden=true;button.append(icon,hidden);
 for(const role of ['button','tab','menuitem']){const node=h.paragraph('Role '+role,'span');node.setAttribute('role',role);}
 assert.equal(isReadable(button,h.env),false);
 const page=createPageTranslator(h.dependencies);await page.translatePage();
 assert.deepEqual(h.requests.flatMap(r=>r.texts),['Explore','Role button','Role tab','Role menuitem']);
 assert.equal(output(button).getAttribute('data-kuai-layout'),'inline');assert.strictEqual(output(button).parentNode,button);page.restore();
});

test('blockified flex links and atomic pills stand alone while an inline badge stays in prose',()=>{
 const h=fixture(),toolbar=h.paragraph('','div');toolbar.style.display='flex';
 for(const text of ['Personal','Business']){const a=h.doc.createElement('a');a.textContent=text;a.style.display='block';toolbar.append(a);}
 const pills=h.paragraph('','div');for(const text of ['Download','News']){const a=h.doc.createElement('a');a.textContent=text;a.style.display='inline-flex';pills.append(a);}
 const p=h.paragraph('Read '),badge=h.doc.createElement('a');badge.style.display='inline-block';badge.textContent='Guide';p.append(badge,h.doc.createTextNode(' for details.'));
 assert.deepEqual(collectBlocks(h.doc,h.env).map(b=>b.text),['Personal','Business','Download','News','Read Guide for details.']);
});

test('visible br stays in one translation unit and forces block output; hidden br does not',async()=>{
 for(const hidden of [false,true]){
  const h=fixture(),p=h.paragraph('First','strong'),br=h.doc.createElement('br');br.hidden=hidden;p.append(br,h.doc.createTextNode(' second'));p.style.position='absolute';
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.deepEqual(h.requests.flatMap(r=>r.texts),['First second']);
  assert.equal(output(p).getAttribute('data-kuai-layout'),hidden?'inline':'block');assert.equal(output(p).querySelector('br'),null);page.restore();
 }
});

test('layout thresholds use both texts and force multiline or long narrow text into blocks',async()=>{
 const {pageLayout,measureSourceLayout}=await import('../dist/src/content/page-layout.js');
 const h=fixture(),p=h.paragraph('Short'),a=h.paragraph('Link','a'),metrics={multiline:false,width:300,fontSize:16,nowrap:false,display:'block',column:false};
 assert.equal(pageLayout(p,'Short','短文',metrics).layout,'inline');
 assert.equal(pageLayout(p,'Short','这是一段很长很长很长很长的翻译',metrics).layout,'block');
 assert.equal(pageLayout(a,'A'.repeat(40),'译',metrics).layout,'inline');assert.equal(pageLayout(a,'A'.repeat(41),'译',metrics).layout,'block');
 assert.deepEqual(pageLayout(p,'Text','译',{...metrics,multiline:true}),{layout:'block'});
 assert.deepEqual(pageLayout(p,'A long long long sentence','译',{...metrics,width:63,textWidth:60}),{layout:'block'});
 assert.deepEqual(pageLayout(p,'Text','译',{...metrics,multiline:true,width:30}),{layout:'block'});
 const createRange=h.doc.createRange;h.doc.createRange=()=>({...createRange(),selectNodeContents(){},getClientRects:()=>[{top:0,bottom:20,width:100,height:20},{top:20,bottom:40,width:50,height:20}]});
 assert.equal(measureSourceLayout(p,h.env).multiline,true);
});

test('block and flex/grid scoping restore the exact original markup',async()=>{
 for(const display of ['block','flex','grid']){
  const h=fixture(),p=h.paragraph('This paragraph has enough words for block presentation.');p.style.display=display;
  const before=p.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(output(p).getAttribute('data-kuai-layout'),'block');assert.equal(output(p).hasAttribute('data-kuai-contain'),false);
  assert.equal(p.hasAttribute('data-kuai-flex-layout'),display!=='block');
  page.restore();assert.equal(p.outerHTML,before);
 }
});

test('inline and button translation-only hide original text and spacing and restore exactly',async()=>{
 for(const tag of ['button','a','p']){
  const h=fixture(),p=h.paragraph(tag==='p'?'A paragraph long enough to require block output.':'Explore',tag);if(tag==='a')p.style.display='inline-block';const before=p.outerHTML;h.settings.pageDisplayMode='translation_only';
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.ok(output(p).hasAttribute('data-kuai-only'));assert.equal(p.firstChild.nodeValue,'');
  assert.equal(output(p).querySelector('br'),null);assert.match(sheet(h),/\[data-kuai-only\]\{margin-inline-start:0!important\}/);
  page.restore();assert.equal(p.outerHTML,before);
 }
});

test('viewport clipping respects propagated body overflow and positioned containing blocks',async()=>{
 const {isInViewport}=await import('../dist/src/content/dom.js');
 const h=fixture(),scroller=h.paragraph('','div'),fixed=h.doc.createElement('nav'),label=h.doc.createElement('button');label.textContent='Menu';scroller.append(fixed);fixed.append(label);
 h.doc.body._rect={top:100,bottom:900,left:0,right:1200,width:1200,height:800};h.doc.body.style.overflow='auto';
 scroller._rect={top:100,bottom:200,left:0,right:400,width:400,height:100};scroller.style.overflow='hidden';fixed.style.position='fixed';label._rect={top:10,bottom:40,left:10,right:60,width:50,height:30};
 const read=h.env.getComputedStyle;h.env.getComputedStyle=e=>({...read(e),overflow:e.style.overflow||'visible',position:e.style.position||'static',transform:e.style.transform||'none'});
 assert.equal(isInViewport(label,h.env),true);
 scroller.style.transform='translateZ(0)';assert.equal(isInViewport(label,h.env),false);
 scroller.style.transform='none';fixed.style.position='absolute';assert.equal(isInViewport(label,h.env),true);
 scroller.style.position='relative';assert.equal(isInViewport(label,h.env),false);
 scroller.style.overflow='visible';assert.equal(isInViewport(label,h.env),true,'body overflow propagates to viewport');
 h.doc.documentElement.style.overflow='hidden';assert.equal(isInViewport(label,h.env),false,'non-propagated body overflow clips its contents');
});

test('inline themes remove geometric decoration while retaining emphasis',()=>{
 for(const preset of ['border','background','highlight','dashed-border','blur']){
  const css=api.pageStyleRule('output',{preset},true);assert.match(css,/border-left:0!important/);assert.match(css,/padding:0!important/);assert.doesNotMatch(css,/display:inline-block|filter:blur/);
 }
 assert.match(api.pageStyleRule('output',{preset:'bold'},true),/font-weight:700/);
 assert.doesNotMatch(api.pageStyleRule('output'),/font-weight:|line-height:|font-size:/);
});

test('unchanged translations stay deduplicated without adding visible or hidden markup',async()=>{
 const h=fixture(),p=h.paragraph('Brand'),before=p.outerHTML;h.respond(async texts=>({translations:texts}));
 const page=createPageTranslator(h.dependencies);await page.translatePage();await page.translatePage();
 assert.equal(output(p),null);assert.equal(h.requests.length,1);assert.equal(p.outerHTML,before);page.restore();assert.equal(p.outerHTML,before);
});

test('an offscreen text-indent icon label is unreadable',()=>{
 const h=fixture(),p=h.paragraph('Pause','span');p.style.display='block';p.style.overflow='hidden';p.style.textIndent='-9999px';
 assert.deepEqual(collectBlocks(h.doc,h.env),[]);
});

test('inline flex controls restore preexisting scoped attributes',async()=>{
 const h=fixture(),p=h.paragraph('Explore','button');p.style.display='flex';p.style.flexDirection='column';p.setAttribute('data-kuai-inline-layout','site');const before=p.outerHTML;
 const page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(p.getAttribute('data-kuai-inline-layout'),'column');page.restore();assert.equal(p.outerHTML,before);
});

test('zero-height duplicate pseudo labels are suppressed only while laying out inline column controls',async()=>{
 const h=fixture(),p=h.paragraph('Personal','button');p.style.display='flex';p.style.flexDirection='column';const read=h.env.getComputedStyle;
 h.env.getComputedStyle=(e,pseudo)=>pseudo?{height:'0px',content:pseudo==='::after'?'"Personal"':'none'}:read(e);
 const before=p.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(p.getAttribute('data-kuai-duplicate-pseudo'),'after');
 assert.match(sheet(h),/\[data-kuai-inline-layout=column\]\{display:block!important;width:max-content!important;max-width:100%!important\}/);
 page.restore();assert.equal(p.outerHTML,before);
});

test('an inline translation stays beside text inside a control label, including translation-only',async()=>{
 for(const mode of ['bilingual','translation_only']){
  const h=fixture(),button=h.paragraph('','button'),label=h.doc.createElement('span');label.textContent='United States';label.style.display='inline-block';button.append(label);h.settings.pageDisplayMode=mode;
  const before=button.outerHTML,page=createPageTranslator(h.dependencies);await page.translatePage();
  page.refreshPresentation();page.refreshPresentation();
  assert.strictEqual(output(button).parentNode,label);assert.equal(output(button).closest('[data-kuai-original]'),null);
  if(mode==='translation_only')assert.equal(label.firstChild.nodeValue,'');
  page.restore();assert.equal(button.outerHTML,before);
 }
});

test('block translations supply intrinsic width to shrink-to-fit hosts in both display modes',async()=>{
 for(const mode of ['bilingual','translation_only']){
  const h=fixture(),p=h.paragraph('A heading long enough for block output.','h2');p.style.width='max-content';h.settings.pageDisplayMode=mode;
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(output(p).getAttribute('data-kuai-layout'),'block');
  assert.equal(output(p).hasAttribute('data-kuai-contain'),false);assert.equal(output(p).style.getPropertyValue('contain-intrinsic-inline-size'),'');
  assert.doesNotMatch(sheet(h),/contain:|contain-intrinsic|data-kuai-contain/);assert.equal(p.style.width,'max-content');page.restore();
 }
});

test('inline translations wrap without adding ellipsis, clipping or nowrap to hosts or outputs',async()=>{
 for(const display of ['inline','flex','grid']){
  const h=fixture(),p=h.paragraph('Explore','button');p.style.display=display;p.style.whiteSpace='nowrap';
  const page=createPageTranslator(h.dependencies);await page.translatePage();assert.equal(output(p).getAttribute('data-kuai-layout'),'inline');
  assert.equal(p.style.whiteSpace,'nowrap');assert.doesNotMatch(sheet(h),/white-space:nowrap|text-overflow:ellipsis|overflow:hidden|flex-shrink:/);
  assert.match(sheet(h),/\[data-kuai-layout=inline\]\{[^}]*white-space:normal!important/);page.restore();
 }
});

test('squeezed inline results fall back in one batch, stay stacked across refreshes and restore exactly',async()=>{
 const h=fixture(),hosts=['block','flex','grid'].map(display=>{
  const host=h.paragraph('Explore','button');host.style.display=display;host.style.fontSize='16px';host.style.lineHeight='20px';return host;
 });
 hosts[1].setAttribute('data-kuai-inline-layout','site-inline');hosts[1].setAttribute('data-kuai-flex-layout','site-flex');
 const before=hosts.map(host=>host.outerHTML),sources=hosts.map(host=>host.firstChild),events=[];
 const create=h.doc.createElement;let narrow=true;
 h.doc.createElement=tag=>{
  const element=create(tag),set=element.setAttribute.bind(element);
  element.setAttribute=(name,value)=>{if(name==='data-kuai-layout'&&value==='block')events.push('write');set(name,value);};
  if(tag==='font')element.getBoundingClientRect=()=>{events.push('read');return {width:narrow?(element.parentElement?.parentElement===hosts[1]?50:16):160,height:narrow?40:20};};
  return element;
 };
 h.respond(async texts=>({translations:texts.map(()=>'企业')}));
 const page=createPageTranslator(h.dependencies);await page.translatePage();
 assert.deepEqual(events,['read','read','read','write','write','write']);
 for(const [index,host]of hosts.entries()){
  assert.equal(output(host).getAttribute('data-kuai-layout'),'block');assert.strictEqual(output(host).parentNode,host);
  assert.equal(host.hasAttribute('data-kuai-flex-layout'),index!==0);assert.strictEqual(host.firstChild,sources[index]);
  assert.equal(host.hasAttribute('data-kuai-page-source'),index!==1);
 }
 assert.equal(hosts[1].getAttribute('data-kuai-inline-layout'),'site-inline');assert.equal(hosts[1].getAttribute('data-kuai-flex-layout'),'row');
 narrow=false;page.refreshPresentation();page.refreshPresentation();
 h.settings.pageDisplayMode='translation_only';page.refreshPresentation();h.settings.pageDisplayMode='bilingual';page.refreshPresentation();
 for(const host of hosts)assert.equal(output(host).getAttribute('data-kuai-layout'),'block');
 page.restore();assert.deepEqual(hosts.map(host=>host.outerHTML),before);
 assert.equal(h.doc.querySelector('[data-kuai-page-style]'),null);
 await page.translatePage();for(const host of hosts)assert.equal(output(host).getAttribute('data-kuai-layout'),'inline');
 page.restore();assert.deepEqual(hosts.map(host=>host.outerHTML),before);
});

test('stacked flex controls reserve space for a wider translation without adding both intrinsic widths',async()=>{
 const h=fixture(),host=h.paragraph('IR','button');Object.assign(host.style,{display:'flex',fontSize:'14px',lineHeight:'20px'});
 host._rect={left:10,top:10,right:60,bottom:110,width:50,height:100};const before=host.outerHTML;
 const createRange=h.doc.createRange,create=h.doc.createElement;
 h.doc.createRange=()=>{
  const range=createRange();range.getClientRects=()=>range.startContainer===host.firstChild?[{width:15,height:20,top:10,bottom:30}]:[{width:14},{width:14}];return range;
 };
 h.doc.createElement=tag=>{const element=create(tag);if(tag==='font')element._rect={width:14,height:40};return element;};
 h.respond(async()=>({translations:['以及']}));const page=createPageTranslator(h.dependencies);await page.translatePage();
 assert.equal(output(host).getAttribute('data-kuai-layout'),'block');assert.equal(output(host).getAttribute('data-kuai-forced-width'),'63');
 assert.match(sheet(h),/width:63px!important;align-content:center!important/);
 assert.match(sheet(h),/\[data-kuai-forced-block=row\]:not\(\[data-kuai-only\]\)\{width:0!important\}/);
 assert.equal(host.hasAttribute('data-kuai-page-source'),false);assert.equal(host.style.height,undefined);
 page.restore();assert.equal(host.outerHTML,before);
});

test('wide natural wrapping stays inline while later squeezing can still trigger fallback',async()=>{
 const h=fixture(),host=h.paragraph('content-visibility','a');host.style.display='inline-block';host.style.fontSize='16px';host.style.lineHeight='20px';
 const create=h.doc.createElement;let width=225,height=40;
 h.doc.createElement=tag=>{const element=create(tag);if(tag==='font')element.getBoundingClientRect=()=>({width,height});return element;};
 h.respond(async()=>({translations:['内容-可见性']}));const before=host.outerHTML;
 const page=createPageTranslator(h.dependencies);await page.translatePage();page.refreshPresentation();await Promise.resolve();
 assert.equal(output(host).getAttribute('data-kuai-layout'),'inline');
 width=16;height=20;page.refreshPresentation();await Promise.resolve();assert.equal(output(host).getAttribute('data-kuai-layout'),'inline');
 height=40;page.refreshPresentation();await Promise.resolve();assert.equal(output(host).getAttribute('data-kuai-layout'),'block');
 page.restore();assert.equal(host.outerHTML,before);
});

test('block output preserves source white-space and only expands overflow for clamped or ellipsized hosts',async()=>{
 for(const style of [{whiteSpace:'pre-wrap',overflow:'auto'},{whiteSpace:'nowrap',overflow:'hidden'},{overflow:'clip'},{overflow:'hidden',webkitLineClamp:'2'},{overflow:'hidden',textOverflow:'ellipsis'},{overflow:'visible',textOverflow:'ellipsis'}]){
  const h=fixture(),p=h.paragraph('A paragraph long enough to require a block translation.');Object.assign(p.style,style);
  p.setAttribute('data-kuai-page-overflow','site');const before=p.outerHTML;
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(output(p).getAttribute('data-kuai-layout'),'block');assert.equal(p.style.whiteSpace,style.whiteSpace);
  assert.equal(p.getAttribute('data-kuai-page-overflow'),style.webkitLineClamp||style.textOverflow==='ellipsis'&&style.overflow==='hidden'?'expanded':'site');
  assert.doesNotMatch(sheet(h),/\[data-kuai-page-source=expanded\][^{]*\{[^}]*(?:white-space|overflow:)/);
  for(const rule of sheet(h).split('}'))if(rule.includes('white-space:'))assert.ok(rule.startsWith('kuai-translator'),rule);
  page.restore();assert.equal(p.outerHTML,before);
 }
});

test('atomic siblings scan their parent once per layout cache and recompute after it ends',async()=>{
 const {isBlock,withLayoutCache}=await import('../dist/src/content/dom.js');
 const h=fixture(),parent=h.paragraph('','div'),links=[];let checks=0;
 for(let i=0;i<300;i++){
  const a=h.doc.createElement('a');a.style.display='inline-block';a.textContent='Tag '+i;parent.append(a);links.push(a);
  const matches=a.matches.bind(a);a.matches=selector=>{checks++;return matches(selector);};
 }
 withLayoutCache(()=>{for(const a of links)assert.equal(isBlock(a,h.env),true);});
 assert.ok(checks<300*4,`atomic checks should be linear, got ${checks}`);
 const prose=h.doc.createElement('span');prose.append(h.doc.createTextNode('Sentence '));parent.append(prose);
 withLayoutCache(()=>{for(const a of links)assert.equal(isBlock(a,h.env),false);});
 prose.remove();assert.equal(isBlock(links[0],h.env),true);
 parent.append('Prose');assert.equal(isBlock(links[0],h.env),false);
});

test('short clamped and ellipsized controls also release clipping without changing source whitespace',async()=>{
 for(const style of [{webkitLineClamp:'1'},{textOverflow:'ellipsis'}]){
  const h=fixture(),p=h.paragraph('Explore','button');Object.assign(p.style,{overflow:'hidden',whiteSpace:'nowrap'},style);const before=p.outerHTML;
  const page=createPageTranslator(h.dependencies);await page.translatePage();
  assert.equal(output(p).getAttribute('data-kuai-layout'),'inline');assert.equal(p.getAttribute('data-kuai-page-source'),'expanded');assert.equal(p.getAttribute('data-kuai-page-overflow'),'expanded');assert.equal(p.style.whiteSpace,'nowrap');
  page.restore();assert.equal(p.outerHTML,before);
 }
});

test('linked card paragraphs use prose thresholds and fitting while sole nested labels remain controls',async()=>{
 const {pageLayout}=await import('../dist/src/content/page-layout.js'),{isPageControl}=await import('../dist/src/content/dom.js');
 const metrics={multiline:false,width:300,fontSize:16,nowrap:false,display:'block',column:false,textWidth:290};
 for(const mode of ['bilingual','translation_only']){
  const h=fixture(),card=h.paragraph('','a'),title=h.doc.createElement('h3'),p=h.doc.createElement('p');
  title.textContent='Title';p.textContent='A description here';card.append(title,p);
  const a=h.paragraph('','a'),label=h.doc.createElement('span');label.textContent='Label';label.style.display='block';a.append(label);
  const hidden=h.doc.createElement('span');hidden.hidden=true;hidden.textContent='Ignored';a.append(hidden);
  assert.equal(isPageControl(p,p.textContent,h.env),false);assert.equal(isPageControl(label,'Label',h.env),true);
  assert.equal(pageLayout(p,p.textContent,'描述',metrics,h.env).layout,'block');
  assert.equal(pageLayout(p,'x'.repeat(17),'描述',{...metrics,textWidth:0},h.env).layout,'block');
  assert.equal(pageLayout(p,'Short','短',{...metrics,textWidth:299},h.env).layout,'block');
  assert.equal(pageLayout(label,'Label','标签',metrics,h.env).layout,'inline');
  const before=card.outerHTML,labelBefore=a.outerHTML;h.settings.pageDisplayMode=mode;
  const page=createPageTranslator(h.dependencies);await page.translatePage();page.refreshPresentation();
  assert.equal(output(p).getAttribute('data-kuai-layout'),'block');assert.strictEqual(output(p).parentNode,p);
  assert.equal(output(label).getAttribute('data-kuai-layout'),'inline');page.restore();assert.equal(card.outerHTML,before);assert.equal(a.outerHTML,labelBefore);
 }
});
