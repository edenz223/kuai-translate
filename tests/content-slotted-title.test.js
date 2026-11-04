import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createInteractions} from '../dist/src/content/interactions.js';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {blockText,collectBlocks} from '../dist/src/content/dom.js';

const titleText='What do you think of Justin’s style?';
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
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
  const ui=createInteractions(h.dependencies).start();h.emit(label,'mousemove',{altKey:true});h.emit(h.doc,'keydown',{key:'Alt',altKey:true});h.emit(h.doc,'keyup',{key:'Alt'});h.advance(50);await settle();
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
for(const clipping of [{position:'absolute',clip:'rect(1px, 1px, 1px, 1px)'},{clipPath:'inset(50%)'}])test('fully clipped accessibility text is excluded: '+JSON.stringify(clipping),()=>{
  const h=fixture(),p=h.paragraph('Visible '),hidden=h.doc.createElement('span');hidden.textContent='duplicate';p.append(hidden);
  const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===hidden?clipping:{})});
  assert.equal(blockText(p,h.env),'Visible');
});

test('an inactive legacy clip property on static text does not hide visible source',()=>{
  const h=fixture(),p=h.paragraph('Visible '),span=h.doc.createElement('span');span.textContent='content';p.append(span);
  const computed=h.env.getComputedStyle;h.env.getComputedStyle=node=>({...computed(node),...(node===span?{position:'static',clip:'rect(0px, 0px, 0px, 0px)'}:{})});
  assert.equal(blockText(p,h.env),'Visible content');
});

for(const target of ['overlay','post','article','credit'])test('Shift over a feed card '+target+' translates title and body at their sources without time',async()=>{
  const context=card(),{h,article,title,body}=context;h.settings.hoverOptions.trigger='shift';
  const ui=createInteractions(h.dependencies).start();
  h.emit(context[target],'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),[titleText,'I am just curious.']);
  assert.equal(article.querySelectorAll('[data-kuai-page-translation]').length,2);
  assert.equal(title.querySelector('kuai-translator')?.textContent,'译：'+titleText);
  assert.equal(body.querySelector('kuai-translator')?.textContent,'译：I am just curious.');
  assert.equal(article.children.some(node=>node.tagName==='KUAI-TRANSLATOR'),false);
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.equal(article.querySelectorAll('[data-kuai-page-translation]').length,0);assert.equal(h.requests.length,1);ui.stop();
});
test('Shift on the body paragraph still translates only that paragraph',async()=>{
  const {h,title,body}=card();h.settings.hoverOptions.trigger='shift';
  const ui=createInteractions(h.dependencies).start();h.emit(body,'mousemove');
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['I am just curious.']);
  assert.equal(title.querySelector('kuai-translator'),null);assert.ok(body.querySelector('kuai-translator'));ui.stop();
});

test('Shift on a body slot wrapper with nested paragraphs resolves the card content',async()=>{
  const {h,post,body,title}=card(),wrapper=h.doc.createElement('div');wrapper.setAttribute('slot','text-body');
  body.removeAttribute('slot');post.insertBefore(wrapper,body);wrapper.append(body);h.settings.hoverOptions.trigger='shift';
  const ui=createInteractions(h.dependencies).start();h.emit(wrapper,'mousemove');
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),[titleText,'I am just curious.']);
  assert.ok(title.querySelector('kuai-translator'));assert.ok(body.querySelector('kuai-translator'));ui.stop();
});

test('card gestures inspect the current card without scanning unrelated feed entries',async()=>{
  const {h,overlay,title}=card(),outside=h.paragraph('Unrelated feed entry');h.settings.hoverOptions.trigger='shift';
  const computed=h.env.getComputedStyle;let outsideReads=0;h.env.getComputedStyle=node=>{if(node===outside)outsideReads++;return computed(node);};
  const ui=createInteractions(h.dependencies).start();h.emit(overlay,'mousemove');
  h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();
  assert.ok(title.querySelector('kuai-translator'));assert.equal(outsideReads,0);ui.stop();
});
