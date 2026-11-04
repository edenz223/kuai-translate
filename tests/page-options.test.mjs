import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../src/content/page-translator.js';
import {createInteractions} from '../src/content/interactions.js';

const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

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

test('language filtering uses the available browser detector and keeps unknown text readable',async t=>{
  const h=fixture();h.paragraph('Bonjour le monde');h.paragraph('Unclassified phrase');
  const detected=[];h.env.chrome={i18n:{detectLanguage:async text=>{detected.push(text);return text.startsWith('Bonjour')?{isReliable:true,languages:[{language:'fr',percentage:99}]}:{isReliable:false,languages:[{language:'und',percentage:100}]};}}};
  h.settings.pageOptions={neverLanguages:['fr']};const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());
  await page.translatePage();assert.equal(detected.length,2);
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Unclassified phrase']);
});

test('navigation during asynchronous language filtering never starts a stale translation request',async t=>{
  const h=fixture();h.paragraph('A paragraph waiting for language detection');let finish;
  h.env.chrome={i18n:{detectLanguage:()=>new Promise(resolve=>{finish=resolve;})}};h.settings.pageOptions={neverLanguages:['ja']};
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());const pending=page.translatePage();await settle();
  assert.equal(typeof finish,'function');h.env.location.href='https://example.org/next';finish({isReliable:true,languages:[{language:'en',percentage:99}]});
  await pending;assert.equal(h.requests.length,0);assert.equal(h.doc.querySelector('[data-kuai-page-translation]'),null);
});

test('a changed exclusion policy invalidates an in-flight page result without replacing original text',async t=>{
  const h=fixture(),p=h.paragraph('Hello');let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());const pending=page.translatePage();await settle();
  h.settings.pageOptions={neverSites:['example.org']};finish({translations:['Old result']});await pending;
  assert.equal(p.querySelector('[data-kuai-page-translation]'),null);assert.equal(p.textContent,'Hello');
});

test('an excluded inline region prevents its containing paragraph from being sent while sibling text remains eligible',async t=>{
  const h=fixture(),section=h.paragraph('Public heading','section'),privateParagraph=h.doc.createElement('p'),privateSpan=h.doc.createElement('span');
  privateParagraph.textContent='Public prefix: ';privateSpan.textContent='Private inline text';privateSpan.setAttribute('data-private','');privateParagraph.append(privateSpan);section.append(privateParagraph);h.paragraph('Public sibling');
  h.settings.pageOptions={excludeSelectors:['[data-private]']};const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());await page.translatePage();
  assert.deepEqual(h.requests.flatMap(request=>request.texts),['Public heading','Public sibling']);
  assert.equal(!!privateParagraph.querySelector('[data-kuai-page-translation]'),false);assert.equal(privateParagraph.textContent,'Public prefix: Private inline text');
});

for(const mode of ['paragraph','area'])test(`${mode} hover never sends an excluded inline descendant`,async t=>{
  const h=fixture(),area=h.paragraph('','section'),paragraph=h.doc.createElement('p'),span=h.doc.createElement('span');
  paragraph.textContent='Public prefix: ';span.textContent='Private inline text';span.setAttribute('data-private','');paragraph.append(span);area.append(paragraph);
  h.settings.hoverEnabled=true;h.settings.hoverOptions={trigger:'alt',mode,delay:50};h.settings.pageOptions={excludeSelectors:['[data-private]']};
  const interactions=createInteractions(h.dependencies).start();t.after(()=>interactions.stop());h.emit(paragraph,'mousemove',{altKey:true});h.advance(50);await settle();
  assert.equal(h.requests.length,0);assert.equal(!!h.doc.getElementById('kuai-translation-popup'),false);
});

for(const pageDisplayMode of ['bilingual','translation_only'])test(`${pageDisplayMode} dynamic filtering removes stale output and reveals newly excluded source`,async t=>{
  const h=fixture(),paragraph=h.paragraph('Hello world'),source=paragraph.firstChild;paragraph.setAttribute('lang','en');h.settings.pageDisplayMode=pageDisplayMode;h.settings.pageOptions={neverLanguages:['ja'],translateDynamic:true};
  const page=createPageTranslator(h.dependencies);t.after(()=>page.stop());await page.translatePage();assert.equal(h.requests.length,1);assert.equal(page.status().translated,1);
  source.nodeValue='こんにちは世界';paragraph.setAttribute('lang','ja');await page.translatePage({retryErrors:false});
  assert.equal(h.requests.length,1);assert.equal(!!paragraph.querySelector('[data-kuai-page-translation]'),false);
  assert.equal(paragraph.textContent,'こんにちは世界');assert.equal(source.parentNode,paragraph);assert.equal(page.status().translated,0);
});
