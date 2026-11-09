import test from 'node:test';
import assert from 'node:assert/strict';
import * as providers from '../dist/src/providers/index.js';
import {translateWithProvider, validateProvider} from '../dist/src/providers/index.js';
import {defaultSettings, normalizeSettings} from '../dist/src/shared/settings.js';

function responder(payloads) {
  const calls=[];
  return {calls,fetchImpl:async (url,options={})=>{
    calls.push({url:new URL(url),options,body:options.body ? JSON.parse(options.body) : undefined});
    const payload=typeof payloads==='function' ? payloads(calls.at(-1),calls.length-1) : payloads;
    return payload instanceof Response ? payload : Response.json(payload);
  }};
}
const inputs={texts:['Hello','Goodbye'],sourceLanguage:'auto',targetLanguage:'zh-Hans'};
const result=['你好','再见'];
const config=type=>({id:'custom-'+type,type,enabled:true,apiKey:'unit-test-private-key',model:'manual-model',baseUrl:'https://provider.example/v1',region:'eastasia'});

test('Microsoft free sends a string array without credentials and preserves response order',async()=>{
  const h=responder(result.map(text=>({translations:[{text}]})));
  assert.deepEqual(await translateWithProvider({id:'microsoft',type:'microsoft'}, {...inputs,...h}),result);
  assert.equal(h.calls[0].url.hostname,'edge.microsoft.com');
  assert.deepEqual(h.calls[0].body,inputs.texts);
  assert.equal(h.calls[0].url.searchParams.get('to'),'zh-Hans');
  assert.equal(h.calls[0].url.searchParams.has('from'),false);
  assert.equal(h.calls[0].options.credentials,'omit');
  assert.equal(new Headers(h.calls[0].options.headers).has('Authorization'),false);
});
test('Google free translates separate inputs through the public web endpoint without a shared key',async()=>{
  const h=responder((call)=>[[[call.url.searchParams.get('q')==='Hello'?'你好':'再见','source']]]);
  assert.deepEqual(await translateWithProvider({type:'google'},{...inputs,...h}),result);
  assert.equal(h.calls.length,2);
  for(const call of h.calls){
    assert.equal(call.url.hostname,'translate.googleapis.com');
    assert.equal(call.url.pathname,'/translate_a/single');
    assert.equal(call.url.searchParams.get('tl'),'zh-CN');
    assert.equal(call.url.searchParams.has('key'),false);
    assert.equal(new Headers(call.options.headers).has('x-goog-api-key'),false);
  }
});
test('Transmart free sends plaintext list and validates the returned translation list',async()=>{
  const h=responder({auto_translation:result});
  assert.deepEqual(await translateWithProvider({type:'transmart'},{...inputs,...h}),result);
  assert.deepEqual(h.calls[0].body.source,{lang:'auto',text_list:inputs.texts});
  assert.equal(h.calls[0].body.target.lang,'zh');
  assert.equal(h.calls[0].body.header.fn,'auto_translation');
  assert.ok(h.calls[0].body.header.client_key.startsWith('tencent_transmart_crx_'));
});
test('Yandex free passes every input in order and does not require an API key',async()=>{
  const h=responder({code:200,text:result});
  assert.deepEqual(await translateWithProvider({type:'yandex'},{...inputs,...h}),result);
  assert.deepEqual(h.calls[0].url.searchParams.getAll('text'),inputs.texts);
  assert.equal(h.calls[0].url.searchParams.get('lang'),'zh');
  assert.equal(h.calls[0].url.searchParams.has('key'),false);
});

for(const type of ['openai','gemini','anthropic','ollama']){
  test(type+' uses its native API, accepts a manual model and parses indexed JSON output',async()=>{
    const answer=JSON.stringify(result);
    const payload={openai:{choices:[{message:{content:answer}}]},gemini:{candidates:[{content:{parts:[{text:answer}]}}]},anthropic:{content:[{type:'text',text:answer}]},ollama:{message:{content:answer}}}[type];
    const h=responder(payload), provider=config(type);
    assert.deepEqual(await translateWithProvider(provider,{...inputs,...h}),result);
    const call=h.calls[0], headers=new Headers(call.options.headers);
    assert.equal(call.url.hostname,'provider.example');
    assert.equal(call.url.href.includes(provider.apiKey),false);
    assert.equal(JSON.stringify(call.body).includes(provider.apiKey),false);
    assert.equal(call.options.redirect,'error');
    if(type==='gemini'){
      assert.ok(call.url.pathname.endsWith('/models/manual-model:generateContent'));
      assert.equal(headers.get('x-goog-api-key'),provider.apiKey);
    }else{
      assert.equal(call.body.model,provider.model);
      if(type==='anthropic')assert.equal(headers.get('x-api-key'),provider.apiKey);
      else assert.equal(headers.get('Authorization'),'Bearer '+provider.apiKey);
    }
    if(type==='ollama')assert.equal(call.body.stream,false);
    if(type==='openai')assert.ok(call.url.pathname.endsWith('/chat/completions'));
  });
}
test('Azure uses its own key/region, objects and custom-resource endpoint without duplicating paths',async()=>{
  const provider={...config('azure'),baseUrl:'https://resource.cognitiveservices.azure.com'};
  const h=responder(result.map(text=>({translations:[{text}]})));
  assert.deepEqual(await translateWithProvider(provider,{...inputs,...h}),result);
  assert.equal(h.calls[0].url.pathname,'/translator/text/v3.0/translate');
  assert.deepEqual(h.calls[0].body,[{Text:'Hello'},{Text:'Goodbye'}]);
  assert.equal(new Headers(h.calls[0].options.headers).get('Ocp-Apim-Subscription-Region'),'eastasia');
  provider.baseUrl='https://own.example/prefix/translate?api-version=old';
  await translateWithProvider(provider,{...inputs,...h});
  assert.equal(h.calls[1].url.pathname,'/prefix/translate');
  assert.equal(h.calls[1].url.searchParams.get('api-version'),'3.0');
});
test('DeepL uses its explicit key and automatic language detection',async()=>{
  const h=responder({translations:result.map(text=>({text}))});
  assert.deepEqual(await translateWithProvider({...config('deepl'),baseUrl:'https://api-free.deepl.com'},{...inputs,...h}),result);
  assert.equal(h.calls[0].url.pathname,'/v2/translate');
  assert.equal(h.calls[0].body.target_lang,'ZH');
  assert.equal('source_lang' in h.calls[0].body,false);
  assert.equal(new Headers(h.calls[0].options.headers).get('Authorization'),'DeepL-Auth-Key unit-test-private-key');
});
test('LLM fences are accepted but unequal output is not silently split or guessed',async()=>{
  const h=responder({choices:[{message:{content:'```json\n["你好","再见"]\n```'}}]});
  assert.deepEqual(await translateWithProvider(config('openai'),{...inputs,...h}),result);
  const bad=responder({choices:[{message:{content:'[]'}}]});
  await assert.rejects(translateWithProvider(config('openai'),{...inputs,...bad}),{code:'INVALID_RESPONSE'});
  assert.equal(bad.calls.length,3);
});
test('a model answer that merges inputs is re-requested in smaller batches',async()=>{
  const texts=['The problem is it got','no recognition.','Then Gemini shipped.'];
  const translations={'The problem is it got':'问题是它','no recognition.':'没有得到认可。','Then Gemini shipped.':'随后 Gemini 发布。'};
  const h=responder(call=>{
    const sent=JSON.parse(call.body.contents[0].parts[0].text);
    const answer=sent.length===3?['问题是它没有得到认可。','随后 Gemini 发布。']:sent.map(text=>translations[text]);
    return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer)}]}}]};
  });
  assert.deepEqual(await translateWithProvider(config('gemini'),{...inputs,texts,...h}),Object.values(translations));
  assert.deepEqual(h.calls.map(call=>JSON.parse(call.body.contents[0].parts[0].text).length),[3,2,1]);
  assert.deepEqual(h.calls[0].body.generationConfig.responseSchema,{type:'ARRAY',items:{type:'STRING'},minItems:3,maxItems:3});
  const offline=responder(()=>new Response('',{status:503}));
  await assert.rejects(translateWithProvider(config('gemini'),{...inputs,...offline}),{code:'HTTP_503'});
  assert.equal(offline.calls.length,1);
});
test('empty and malformed response bodies produce safe visible errors',async()=>{
  const h=responder(new Response('not-json-private-key',{status:200}));
  await assert.rejects(translateWithProvider(config('azure'),{...inputs,...h}),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes('private-key'));
});
test('provider HTTP errors expose status but not response, endpoint or API key',async()=>{
  const h=responder(new Response('unit-test-private-key https://secret.example',{status:401}));
  await assert.rejects(translateWithProvider(config('openai'),{...inputs,...h}),error=>error.code==='HTTP_401'&&/401/.test(error.message)&&!error.message.includes('private-key')&&!error.message.includes('secret.example'));
});
test('input, endpoint and model validation rejects before any network request',async()=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error('not reached');};
  for(const provider of [{type:'unknown'}, {...config('openai'),model:''},{...config('azure'),apiKey:''},{...config('openai'),baseUrl:'javascript:alert(1)'},{...config('openai'),baseUrl:'https://user:password@api.example'}]){
    await assert.rejects(translateWithProvider(provider,{...inputs,fetchImpl}),{code:'INVALID_CONFIG'});
  }
  for(const texts of [[],[null],[' '],['a'.repeat(5001)],Array(65).fill('a')])await assert.rejects(translateWithProvider({type:'google'},{texts,targetLanguage:'en',fetchImpl}),{code:'INVALID_INPUT'});
  assert.equal(calls,0);
});
test('timeout settles even when the fetch boundary ignores abort',async()=>{
  await assert.rejects(translateWithProvider({type:'microsoft'},{...inputs,fetchImpl:()=>new Promise(()=>{}),timeoutMs:10}),{code:'TIMEOUT'});
});
test('caller cancellation aborts the actual fetch and returns CANCELLED',async()=>{
  const controller=new AbortController();let actualSignal;
  const promise=translateWithProvider({type:'microsoft'},{...inputs,signal:controller.signal,fetchImpl:(_url,options)=>{actualSignal=options.signal;return new Promise(()=>{});}});
  controller.abort();
  await assert.rejects(promise,{code:'CANCELLED'});
  assert.equal(actualSignal.aborted,true);
});
test('large HTTP response is bounded before parsing',async()=>{
  const h=responder(new Response('x',{headers:{'content-length':'99999999'}}));
  await assert.rejects(translateWithProvider({type:'google'},{texts:['Hello'],targetLanguage:'en',...h}),{code:'RESPONSE_TOO_LARGE'});
});

const configModels=type=>({id:'custom',type,apiKey:'fixture-secret',baseUrl:'https://provider.example/prefix/v1',model:''});
const discover=(provider,options)=>{assert.equal(typeof providers.listProviderModels,'function');return providers.listProviderModels(provider,options);};
for(const type of ['openai','gemini','anthropic','ollama'])test(type+' lists models without requiring a selected model',async()=>{
  const calls=[];
  const bodies={openai:{data:[{id:'z-model'},{id:'a-model'},{id:'a-model'}]},gemini:{models:[{name:'models/a-model',displayName:'A',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]},anthropic:{data:[{id:'a-model',display_name:'A'}],has_more:false},ollama:{models:[{name:'a-model'}]}};
  const result=await discover(configModels(type),{fetchImpl:async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(bodies[type]);}});
  assert.deepEqual(result.map(item=>item.id),type==='openai'?['a-model','z-model']:['a-model']);
  const {url,init}=calls[0],headers=new Headers(init.headers);
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');
  assert.equal(url.pathname,'/prefix/v1/'+(type==='ollama'?'api/tags':'models'));
  assert.equal(url.href.includes('fixture-secret'),false);
  assert.equal(headers.get(type==='gemini'?'x-goog-api-key':type==='anthropic'?'x-api-key':'authorization'),type==='openai'||type==='ollama'?'Bearer fixture-secret':'fixture-secret');
});
test('model discovery normalizes a full translation endpoint and follows Gemini pagination',async()=>{
  let page=0;
  const result=await discover({...configModels('gemini'),baseUrl:'https://provider.example/v1beta/models/old:generateContent?alt=json'}, {fetchImpl:async(url)=>{
    const target=new URL(url);assert.equal(target.pathname,'/v1beta/models');assert.equal(target.searchParams.get('alt'),'json');
    if(page++) {assert.equal(target.searchParams.get('pageToken'),'next');return Response.json({models:[{name:'models/b',supportedGenerationMethods:['generateContent']}]});}
    return Response.json({models:[{name:'models/a',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'});
  }});assert.deepEqual(result.map(item=>item.id),['a','b']);
});
test('discovery rejects invalid config before network, but local Ollama needs no key',async()=>{
  for(const provider of [{...configModels('openai'),apiKey:''},{...configModels('openai'),baseUrl:'https://user:pass@api.example'},configModels('deepl')])await assert.rejects(discover(provider,{fetchImpl:()=>assert.fail('must not fetch')}),{code:'INVALID_CONFIG'});
  await discover({type:'ollama'},{fetchImpl:async(url)=>{assert.equal(new URL(url).pathname,'/api/tags');return Response.json({models:[]});}});
});
test('custom system and user prompts replace the built-in wording but keep the JSON contract',async()=>{
  const payload={choices:[{message:{content:'["你好"]'}}]};
  const settings=defaultSettings();settings.providers.push({...config('openai'),systemPrompt:'Translate {{from}} to {{ to }} formally.',userPrompt:'Strings ({{count}}): {{text}}'});
  const h=responder(payload);
  assert.deepEqual(await translateWithProvider(normalizeSettings(settings).providers.at(-1),{texts:['Hello'],targetLanguage:'zh-Hans',...h}),['你好']);
  const [system,user]=h.calls[0].body.messages;
  assert.match(system.content,/^Translate its detected language to zh-Hans formally\.\n\nReturn only a JSON array of 1 translated strings/);
  assert.equal(user.content,'Strings ({{count}}): ["Hello"]');
  const appended=responder({content:[{type:'text',text:'["こんにちは"]'}]});
  await translateWithProvider({...config('anthropic'),userPrompt:'Keep $& and $1 literal.'},{texts:['Hello'],targetLanguage:'ja',...appended});
  assert.match(appended.calls[0].body.system,/^Translate each input string/);
  assert.equal(appended.calls[0].body.messages[0].content,'Keep $& and $1 literal.\n\n["Hello"]');
  const blank=responder(payload);
  await translateWithProvider({...config('openai'),systemPrompt:'  ',userPrompt:''},{texts:['Hello'],targetLanguage:'ja',...blank});
  assert.equal(blank.calls[0].body.messages[1].content,'["Hello"]');
  assert.throws(()=>validateProvider({...config('openai'),systemPrompt:'x'.repeat(8001)}),{code:'INVALID_CONFIG'});
});
