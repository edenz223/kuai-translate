import test from 'node:test';
import assert from 'node:assert/strict';
import {request,translate} from '../dist/src/shared/client.js';
import * as client from '../dist/src/shared/client.js';
import {createBackground} from '../dist/src/background/controller.js';
import {defaultSettings,SETTINGS_KEY} from '../dist/src/shared/settings.js';
test('request unwraps the common response envelope and preserves error codes',async()=>{
  assert.deepEqual(await request('KUAI_GET_SETTINGS',{}, {runtime:{sendMessage:async()=>({ok:true,value:{targetLanguage:'ja'}})}}),{targetLanguage:'ja'});
  await assert.rejects(request('KUAI_GET_SETTINGS',{}, {runtime:{sendMessage:async()=>({ok:false,error:{code:'DENIED',message:'Not allowed'}})}}),{code:'DENIED'});
});
test('local cancellation settles even when the worker translation response never arrives',async()=>{
  const old=globalThis.chrome,messages=[],controller=new AbortController();
  globalThis.chrome={runtime:{sendMessage:async message=>{messages.push(message);return message.type==='KUAI_CANCEL'?{ok:true,value:{cancelled:true}}:new Promise(()=>{});}}};
  try {
    const pending=translate(['Hello'],{requestId:'test-cancel',signal:controller.signal}).then(()=> 'success',error=>error.name);
    controller.abort();
    const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('still-waiting'),30))]);
    assert.equal(result,'AbortError');
    assert.equal(messages.find(message=>message.type==='KUAI_CANCEL').requestId,'test-cancel');
  }finally{globalThis.chrome=old;}
});
test('content preference and options clients use the restricted actual background contracts',async()=>{
  assert.equal(typeof client.updatePreferences,'function');assert.equal(typeof client.openOptions,'function');
  const old=globalThis.chrome,opened=[];let saved=defaultSettings();
  saved.providers.push({id:'private',type:'openai',enabled:true,apiKey:'private-test-key',baseUrl:'https://private.example/v1',model:'m'});
  const chromeApi={runtime:{id:'kuai-id',getURL:path=>'chrome-extension://kuai-id/'+path,sendMessage:async()=>{}},
    storage:{local:{setAccessLevel:async()=>{},get:async()=>({[SETTINGS_KEY]:saved}),set:async values=>{saved=values[SETTINGS_KEY];}}},
    tabs:{query:async()=>[],sendMessage:async()=>{},create:async value=>{opened.push(value);}}};
  const background=createBackground({chromeApi});
  const sender={id:'kuai-id',url:'https://example.com/watch',origin:'https://example.com',tab:{id:2},frameId:0,documentId:'document-1'};
  globalThis.chrome={runtime:{sendMessage:message=>background.handleMessage(message,sender)}};
  try {
    const value=await client.updatePreferences({subtitleStyle:{targetFontSize:30},subtitleTargetLanguage:'ja'});
    assert.equal(value.subtitleStyle.targetFontSize,30);assert.equal(value.subtitleTargetLanguage,'ja');
    assert.doesNotMatch(JSON.stringify(value),/private-test-key|private\.example/);
    await assert.rejects(client.updatePreferences({apiKey:'forbidden'}),{code:'INVALID_PREFERENCES'});
    assert.deepEqual(await client.openOptions('subtitles'),{opened:true,section:'subtitles'});
    assert.deepEqual(opened,[{url:'chrome-extension://kuai-id/options.html#subtitles'}]);
    await assert.rejects(client.openOptions('https://evil.example'),{code:'INVALID_INPUT'});
  }finally{background.stop();globalThis.chrome=old;}
});

test('page preference client reaches only the narrow actual background patch route',async()=>{
  assert.equal(typeof client.updatePagePreferences,'function');
  const old=globalThis.chrome;let saved=defaultSettings();
  const chromeApi={runtime:{id:'kuai-id',getURL:path=>'chrome-extension://kuai-id/'+path,sendMessage:async()=>{}},
    storage:{local:{setAccessLevel:async()=>{},get:async()=>({[SETTINGS_KEY]:saved}),set:async values=>{saved=values[SETTINGS_KEY];}}},
    tabs:{query:async()=>[],sendMessage:async()=>{}}};
  const background=createBackground({chromeApi}),sender={id:'kuai-id',url:'https://example.com/article',tab:{id:2},frameId:0,documentId:'document-1'};
  globalThis.chrome={runtime:{sendMessage:message=>background.handleMessage(message,sender)}};
  try {
    const result=await client.updatePagePreferences({pageDisplayMode:'translation_only'});
    assert.equal(result.pageDisplayMode,'translation_only');assert.equal(saved.pageDisplayMode,'translation_only');
    await assert.rejects(client.updatePagePreferences({pageDisplayMode:'bilingual',apiKey:'no'}),{code:'INVALID_PREFERENCES'});
    assert.equal(saved.pageDisplayMode,'translation_only');
  }finally{background.stop();globalThis.chrome=old;}
});
