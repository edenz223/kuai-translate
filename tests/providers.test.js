import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWithProvider, validateProvider } from '../dist/src/providers/index.js';
import { defaultSettings, normalizeSettings } from '../dist/src/shared/settings.js';

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
test('DeepLX and local Ollama permit explicitly configured keyless service',async()=>{
  const h=responder(call=>({code:200,data:call.body.text==='Hello'?'你好':'再见'}));
  assert.deepEqual(await translateWithProvider({type:'deeplx',baseUrl:'http://localhost:1188'},{...inputs,...h}),result);
  assert.equal(h.calls[0].url.pathname,'/translate');
  assert.equal(new Headers(h.calls[0].options.headers).has('Authorization'),false);
  const local=responder({message:{content:'你好'}});
  assert.deepEqual(await translateWithProvider({type:'ollama',model:'my-local-model'},{texts:['Hello'],targetLanguage:'zh-Hans',...local}),['你好']);
  assert.equal(local.calls[0].url.hostname,'localhost');
});

for(const [label,payload] of [['empty',[]],['empty text',[{translations:[{text:'  '}]}]],['mismatched',[{translations:[{text:'你好'}]}]],['malformed',{error:{message:'secret-from-provider'}}]]){
  test(label+' Microsoft response is an explicit error without automatic fallback',async()=>{
    const h=responder(payload);
    await assert.rejects(translateWithProvider({type:'microsoft'},{...inputs,...h}),error=>error.code==='INVALID_RESPONSE' && !error.message.includes('secret-from-provider'));
    assert.equal(h.calls.length,1);
  });
}
test('LLM fences are accepted but unequal output is not silently split or guessed',async()=>{
  const h=responder({choices:[{message:{content:'```json\n["你好","再见"]\n```'}}]});
  assert.deepEqual(await translateWithProvider(config('openai'),{...inputs,...h}),result);
  const bad=responder({choices:[{message:{content:'first\nsecond'}}]});
  await assert.rejects(translateWithProvider(config('openai'),{...inputs,...bad}),{code:'INVALID_RESPONSE'});
});
for(const [type,reasons,completeReason] of [
  ['openai',['length','content_filter','tool_calls'],'stop'],
  ['gemini',['MAX_TOKENS','SAFETY','RECITATION'],'STOP'],
  ['anthropic',['max_tokens','refusal','pause_turn','tool_use'],'end_turn'],
  ['ollama',['length','tool_calls'],'stop'],
]){
  test(type+' rejects explicitly incomplete results even when their text looks usable',async()=>{
    const payload=(reason,text)=>({
      openai:{choices:[{finish_reason:reason,message:{role:'assistant',content:text}}]},
      gemini:{candidates:[{finishReason:reason,content:{role:'model',parts:[{text}]}}]},
      anthropic:{type:'message',role:'assistant',stop_reason:reason,content:[{type:'text',text}]},
      ollama:{done:true,done_reason:reason,message:{role:'assistant',content:text}},
    })[type];
    for(const reason of reasons)for(const text of ['partial translation','["partial translation"]']) {
      const h=responder(payload(reason,text));
      await assert.rejects(translateWithProvider(config(type),{texts:['Hello'],targetLanguage:'zh-Hans',...h}),{code:'INCOMPLETE_RESPONSE'});
      assert.equal(h.calls.length,1,'incomplete output must not trigger a retry or fallback');
    }
    for(const reason of [undefined,completeReason]) {
      const h=responder(payload(reason,'["你好"]'));
      assert.deepEqual(await translateWithProvider(config(type),{texts:['Hello'],targetLanguage:'zh-Hans',...h}),['你好']);
    }
  });
}
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
test('timeout cancels a stalled response body reader',async()=>{
  let cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(translateWithProvider({type:'microsoft'},{...inputs,timeoutMs:10,fetchImpl:async()=>new Response(body)}),{code:'TIMEOUT'});
  assert.equal(cancelled,true);
});
test('an invisible zero-width-only translation is rejected',async()=>{
  const h=responder([{translations:[{text:'\u200b\u200c'}]}]);
  await assert.rejects(translateWithProvider({type:'microsoft'},{texts:['Hello'],targetLanguage:'zh-Hans',...h}),{code:'INVALID_RESPONSE'});
});
test('complete custom endpoints and optional temperature are preserved',()=>{
  assert.equal(validateProvider({...config('openai'),baseUrl:'https://api.example/v1/chat/completions',temperature:0}).temperature,0);
});
test('clearing temperature in saved settings omits the optional field from all AI request bodies',async()=>{
  for(const type of ['openai','gemini','anthropic','ollama']) {
    const settings=defaultSettings();settings.providers.push({...config(type),temperature:null});
    const provider=normalizeSettings(settings).providers.at(-1);
    const payload={openai:{choices:[{message:{content:'["你好"]'}}]},gemini:{candidates:[{content:{parts:[{text:'["你好"]'}]}}]},anthropic:{content:[{type:'text',text:'["你好"]'}]},ollama:{message:{content:'["你好"]'}}}[type];
    const h=responder(payload);
    assert.deepEqual(await translateWithProvider(provider,{texts:['Hello'],targetLanguage:'zh-Hans',...h}),['你好']);
    assert.equal(JSON.stringify(h.calls[0].body).includes('"temperature"'),false,type+' should use the service default');
  }
});
