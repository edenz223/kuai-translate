import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createPageTriggers} from '../dist/src/content/page-triggers.js';
import {blockText,collectBlocks,isPageReadable} from '../dist/src/content/dom.js';
import {hideOriginal,restoreOriginal} from '../dist/src/content/originals.js';
import {hideText,restoreText,sourceText,originalMutationFilter} from '../dist/src/content/source-text.js';

const output=node=>node.querySelector('kuai-translator');
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(t,mode){
 const h=fixture(),observers=[];h.settings.pageDisplayMode=mode;
 h.env.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
 const page=createPageTranslator(h.dependencies),triggers=createPageTriggers({...h.dependencies,page,changeDisplayMode:mode=>{h.settings.pageDisplayMode=mode;}}).start();
 t.after(()=>{triggers.stop();page.stop();});
 return {...h,page,triggers,mutate(records){for(const observer of observers.filter(o=>o.active))observer.callback(records);}};
}
function retain(root){const retained=new Map();const visit=node=>{for(const child of node.childNodes){retained.set(child,node);visit(child);}};visit(root);return retained;}
function frameworkProbe(h,retained){
 for(const [node,parent]of retained){
  assert.strictEqual(node.parentNode,parent,'framework-owned parent is unchanged');
  const probe=h.doc.createTextNode('probe'),next=parent.childNodes[parent.childNodes.indexOf(node)+1]||null;
  assert.doesNotThrow(()=>parent.insertBefore(probe,node));parent.removeChild(probe);
  assert.doesNotThrow(()=>parent.removeChild(node));parent.insertBefore(node,next);
 }
}
for(const mode of ['bilingual','translation_only'])test(`framework references survive translation, toggles, repair, source update and restore in ${mode}`,async t=>{
 const h=setup(t,mode),p=h.paragraph('First '),first=p.firstChild;
 p.append(h.doc.createTextNode('second '));
 for(const tag of ['strong','code','a','br']){const inline=h.doc.createElement(tag);if(tag!=='br')inline.textContent=tag+' text ';if(tag==='code')inline.style.display='inline';if(tag==='a')inline.setAttribute('href','/guide');p.append(inline);}
 const outer=h.paragraph('Outer ','div'),nested=h.doc.createElement('p');nested.textContent='Nested text';outer.append(nested);
 const retained=retain(h.doc.body),before=h.doc.body.outerHTML;
 await h.triggers.translate();frameworkProbe(h,retained);assert.equal(blockText(p,h.env),'First second strong text code text a text');
 assert.equal(collectBlocks(h.doc,h.env).find(b=>b.element===p).text,'First second strong text code text a text');
 const requests=h.requests.length;await h.page.translatePage();assert.equal(h.requests.length,requests);
 for(let index=0;index<2;index++){const previous=h.settings.pageDisplayMode;await h.triggers.mode();assert.notEqual(h.settings.pageDisplayMode,previous);frameworkProbe(h,retained);}
 h.settings.pageDisplayMode='translation_only';h.page.refreshPresentation();frameworkProbe(h,retained);
 const result=output(p);result.remove();h.mutate([{type:'childList',target:p,addedNodes:[],removedNodes:[result]}]);await settle();
 assert.strictEqual(output(p),result);assert.equal(first.nodeValue,'');frameworkProbe(h,retained);
 const oldValue=first.nodeValue;first.nodeValue='Framework updated ';
 h.mutate([{type:'characterData',target:first,oldValue}]);await settle();
 assert.equal(first.nodeValue,'Framework updated ');assert.equal(output(p),null);frameworkProbe(h,retained);
 await h.page.translatePage();assert.equal(first.nodeValue,'');assert.match(blockText(p,h.env),/^Framework updated/);frameworkProbe(h,retained);
 h.triggers.restore();assert.equal(first.nodeValue,'Framework updated ');frameworkProbe(h,retained);
 assert.equal(h.doc.querySelector('[data-kuai-original]'),null);assert.equal(output(p),null);
 first.nodeValue='First ';assert.equal(h.doc.body.outerHTML,before,'exact source markup is restored');
});

test('restore preserves a newer site value before observers run, including empty text',async()=>{
 for(const value of ['New framework value','']){
  const h=fixture(),p=h.paragraph('Original'),text=p.firstChild;h.settings.pageDisplayMode='translation_only';
  const page=createPageTranslator(h.dependencies);await page.translatePage();text.nodeValue=value;
  if(value==='')originalMutationFilter()([{type:'characterData',target:text,oldValue:''}]);
  page.restore();assert.equal(text.nodeValue,value);assert.strictEqual(text.parentNode,p);assert.equal(p.querySelector('[data-kuai-original]'),null);
 }
});

test('unchanged source is restored exactly and preexisting original attributes are left alone',async()=>{
 const h=fixture(),p=h.paragraph('  Exact\ntext\t '),text=p.firstChild,span=h.doc.createElement('span');span.textContent='Site marker';span.setAttribute('data-kuai-original','site');p.append(span);
 h.settings.pageDisplayMode='translation_only';const before=p.outerHTML,page=createPageTranslator(h.dependencies);
 await page.translatePage();assert.equal(text.nodeValue,'');page.refreshPresentation();assert.equal(blockText(p,h.env),'Exact text Site marker');
 page.restore();assert.equal(p.outerHTML,before);assert.equal(span.getAttribute('data-kuai-original'),'site');
});

test('same-source inline replacement and added source are hidden idempotently without moving nodes',async t=>{
 const h=setup(t,'translation_only'),p=h.paragraph('Read '),old=h.doc.createElement('a');old.textContent='guide';old.setAttribute('href','/old');p.append(old);
 await h.triggers.translate();const next=h.doc.createElement('a');next.textContent='guide';next.setAttribute('href','/new');p.insertBefore(next,old);p.removeChild(old);
 h.mutate([{type:'childList',target:p,addedNodes:[next],removedNodes:[old]}]);await settle();
 assert.equal(old.hasAttribute('data-kuai-original'),false);assert.ok(next.hasAttribute('data-kuai-original'));assert.strictEqual(next.parentNode,p);assert.equal(output(p).querySelector('a').getAttribute('href'),'https://example.org/new');
 const added=h.doc.createTextNode(' Added text');p.append(added);h.mutate([{type:'childList',target:p,addedNodes:[added],removedNodes:[]}]);await settle();
 await h.page.translatePage();assert.equal(added.nodeValue,'');assert.strictEqual(added.parentNode,p);assert.match(blockText(p,h.env),/Added text$/);
 h.page.restore();assert.equal(p.textContent,'Read guide Added text');assert.equal(h.doc.querySelector('[data-kuai-original]'),null);
});

test('our characterData writes do not schedule dynamic passes or presentation repair',async t=>{
 const h=setup(t,'translation_only'),p=h.paragraph('Original'),text=p.firstChild,records=[];let value=text.nodeValue;
 Object.defineProperty(text,'nodeValue',{get:()=>value,set:next=>{records.push({type:'characterData',target:text,oldValue:value});value=next;}});
 await h.triggers.translate();const result=output(p),set=result.setAttribute.bind(result);let writes=0;result.setAttribute=(...args)=>{writes++;set(...args);};
 h.mutate(records.splice(0));await settle();assert.equal(writes,0);assert.equal(h.timerCount(),0);assert.equal(h.requests.length,1);
 h.settings.pageDisplayMode='bilingual';h.page.refreshPresentation();writes=0;h.mutate(records.splice(0));await settle();
 assert.equal(writes,0);assert.equal(h.timerCount(),0);assert.equal(text.nodeValue,'Original');
});

test('write filters distinguish hide/restore batches and a site clearing a hidden text',()=>{
 const h=fixture(),p=h.paragraph('Original'),text=p.firstChild,records=[];let value=text.nodeValue;
 Object.defineProperty(text,'nodeValue',{get:()=>value,set:next=>{records.push({type:'characterData',target:text,oldValue:value});value=next;}});
 const first=originalMutationFilter(),second=originalMutationFilter();
 hideText(text);restoreText(text);hideText(text);
 assert.equal(first(records).size,3);assert.equal(second(records).size,3);records.length=0;
 text.nodeValue='';assert.equal(first(records).size,0);assert.equal(sourceText(text),'');restoreText(text);assert.equal(text.nodeValue,'');
});

test('page translation never empties editor text or marks editable inline originals',async()=>{
 const h=fixture(),nodes=[];
 for(const [tag,attribute,value]of [['input'],['textarea'],['select'],['div','contenteditable','true'],['div','role','textbox'],['span','contenteditable','plaintext-only']]){
  const root=h.paragraph('',tag);if(attribute)root.setAttribute(attribute,value);
  const child=h.doc.createElement('span');child.textContent='Editable source';root.append(child);nodes.push(root,child);
 }
 h.paragraph('Readable source');h.settings.pageDisplayMode='translation_only';const before=nodes.map(node=>node.outerHTML),page=createPageTranslator(h.dependencies);
 await page.translatePage();for(const [index,node]of nodes.entries()){assert.equal(isPageReadable(node,h.env,{allowOriginal:true}),false);assert.equal(node.outerHTML,before[index]);}
 assert.deepEqual(h.requests.flatMap(request=>request.texts),['Readable source']);page.restore();
});

test('marked inline code stays a readable source when its computed display becomes none',async()=>{
 const h=fixture(),p=h.paragraph('Run '),code=h.doc.createElement('code');code.style.display='inline';code.textContent='example';p.append(code);
 const computed=h.env.getComputedStyle;h.env.getComputedStyle=element=>({...computed(element),...(element.hasAttribute('data-kuai-original')?{display:'none'}:{})});
 h.settings.pageDisplayMode='translation_only';const page=createPageTranslator(h.dependencies);await page.translatePage();
 assert.ok(code.hasAttribute('data-kuai-original'));assert.equal(blockText(p,h.env),'Run example');await page.translatePage();assert.equal(h.requests.length,1);
 code.setAttribute('contenteditable','true');page.refreshPresentation();assert.equal(output(p),null);assert.equal(p.textContent,'Run example');assert.equal(code.hasAttribute('data-kuai-original'),false);page.restore();
});

test('a site update followed by hiding in the same task retains the newer source',()=>{
 const h=fixture(),p=h.paragraph('Original'),text=p.firstChild,records=[];let value=text.nodeValue;
 Object.defineProperty(text,'nodeValue',{get:()=>value,set:next=>{records.push({type:'characterData',target:text,oldValue:value});value=next;}});
 const filter=originalMutationFilter();text.nodeValue='New source';hideText(text);
 assert.equal(filter(records).size,1);assert.equal(sourceText(text),'New source');restoreText(text);assert.equal(text.nodeValue,'New source');
});

test('moving owned output out of and back into an inline label preserves hiding and source identity',()=>{
 const h=fixture(),p=h.paragraph(''),label=h.doc.createElement('span'),text=h.doc.createTextNode('Label'),result=h.doc.createElement('kuai-translator');
 result.setAttribute('data-kuai-owned','');result.textContent='译文';label.append(text,result);p.append(label);
 const entry={element:p,output:result,originals:[]};hideOriginal(entry,h.doc,h.env);assert.equal(text.nodeValue,'');assert.equal(label.hasAttribute('data-kuai-original'),false);
 p.append(result);hideOriginal(entry,h.doc,h.env);assert.ok(label.hasAttribute('data-kuai-original'));assert.equal(blockText(p,h.env),'Label');assert.strictEqual(text.parentNode,label);
 label.append(result);hideOriginal(entry,h.doc,h.env);assert.equal(label.hasAttribute('data-kuai-original'),false);assert.equal(text.nodeValue,'');assert.equal(blockText(p,h.env),'Label');
 restoreOriginal(entry);assert.equal(text.nodeValue,'Label');assert.equal(label.hasAttribute('data-kuai-original'),false);assert.strictEqual(text.parentNode,label);
});

test('a site resetting then clearing a hidden node in the same batch wins over restore',()=>{
 const h=fixture(),p=h.paragraph('Original'),text=p.firstChild,records=[];let value=text.nodeValue;
 Object.defineProperty(text,'nodeValue',{get:()=>value,set:next=>{records.push({type:'characterData',target:text,oldValue:value});value=next;}});
 const filter=originalMutationFilter();hideText(text);text.nodeValue='Original';text.nodeValue='';
 assert.equal(filter(records).size,1);assert.equal(sourceText(text),'');restoreText(text);assert.equal(text.nodeValue,'');
});
