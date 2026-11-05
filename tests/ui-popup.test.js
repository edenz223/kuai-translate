import test from 'node:test';
import assert from 'node:assert/strict';
import * as popup from '../dist/src/ui/popup.js';
import {defaultSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';

test('popup page actions target only the main frame and unwrap the content response',async()=>{
  assert.equal(typeof popup.sendPageAction,'function');
  const sent=[];
  const chromeApi={tabs:{query:async()=>[{id:7,url:'https://example.com/'}],sendMessage:async(...args)=>{sent.push(args);return {ok:true,value:{active:true}};}}};
  assert.deepEqual(await popup.sendPageAction('KUAI_PAGE_TRANSLATE',chromeApi),{active:true});
  assert.deepEqual(sent,[[7,{type:'KUAI_PAGE_TRANSLATE'},{frameId:0}]]);
  chromeApi.tabs.query=async()=>[{id:7,url:'chrome://extensions'}];
  await assert.rejects(popup.sendPageAction('KUAI_PAGE_TRANSLATE',chromeApi),/普通网页/);
  assert.equal(sent.length,1);
});

test('actual popup opens page settings without subtitle controls on YouTube',async t=>{
  const h=createDocument(new URL('../public/popup.html',import.meta.url)),opened=[],sent=[];
  const previous=globalThis.chrome;
  const chromeApi={runtime:{sendMessage:async()=>({ok:true,value:defaultSettings()}),getURL:path=>'chrome-extension://kuai/'+path},tabs:{query:async()=>[{id:9,url:'https://www.youtube.com/watch?v=video123'}],create:async value=>opened.push(value),sendMessage:async(...args)=>{sent.push(args);return {ok:true,value:args[1].type==='KUAI_PAGE_STATUS'?{active:false,total:0,translated:0}:{opened:true}};}}};
  globalThis.chrome=chromeApi;t.after(()=>{globalThis.chrome=previous;});
  await popup.startPopup(h.document,chromeApi);
  assert.ok(h.node('page-settings'),'the page style entry must be visible in the popup');
  for(const id of ['subtitle-settings','subtitle-list','subtitles','subtitle-scope'])assert.equal(h.node(id),null);
  await h.node('page-settings').fire('click');
  assert.deepEqual(opened,[{url:'chrome-extension://kuai/options.html#webpage'}]);
  assert.deepEqual(sent,[[9,{type:'KUAI_PAGE_STATUS'},{frameId:0}]]);
});

test('popup initializes outside YouTube and subtitle actions remain scoped to video pages',async t=>{
  const h=createDocument(new URL('../public/popup.html',import.meta.url)),sent=[],previous=globalThis.chrome;
  const chromeApi={runtime:{sendMessage:async()=>({ok:true,value:defaultSettings()})},tabs:{query:async()=>[{id:9,url:'https://example.com/'}],sendMessage:async(...args)=>{sent.push(args);return {ok:true,value:{active:false,total:0,translated:0}};}}};
  globalThis.chrome=chromeApi;t.after(()=>{globalThis.chrome=previous;});
  await popup.startPopup(h.document,chromeApi);
  assert.equal(h.node('subtitle-list'),null);
  assert.equal(h.node('translate-page').disabled,false);
  await assert.rejects(popup.sendPageAction('KUAI_YOUTUBE_OPEN_LIST',chromeApi),/YouTube/);
  assert.deepEqual(sent,[[9,{type:'KUAI_PAGE_STATUS'},{frameId:0}]]);
});
