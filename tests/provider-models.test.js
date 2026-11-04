import test from 'node:test';
import assert from 'node:assert/strict';
import * as providers from '../dist/src/providers/index.js';
const config=type=>({id:'custom',type,apiKey:'fixture-secret',baseUrl:'https://provider.example/prefix/v1',model:''});
const discover=(provider,options)=>{assert.equal(typeof providers.listProviderModels,'function');return providers.listProviderModels(provider,options);};
for(const type of ['openai','gemini','anthropic','ollama'])test(type+' lists models without requiring a selected model',async()=>{
  const calls=[];
  const bodies={openai:{data:[{id:'z-model'},{id:'a-model'},{id:'a-model'}]},gemini:{models:[{name:'models/a-model',displayName:'A',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]},anthropic:{data:[{id:'a-model',display_name:'A'}],has_more:false},ollama:{models:[{name:'a-model'}]}};
  const result=await discover(config(type),{fetchImpl:async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(bodies[type]);}});
  assert.deepEqual(result.map(item=>item.id),type==='openai'?['a-model','z-model']:['a-model']);
  const {url,init}=calls[0],headers=new Headers(init.headers);
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');
  assert.equal(url.pathname,'/prefix/v1/'+(type==='ollama'?'api/tags':'models'));
  assert.equal(url.href.includes('fixture-secret'),false);
  assert.equal(headers.get(type==='gemini'?'x-goog-api-key':type==='anthropic'?'x-api-key':'authorization'),type==='openai'||type==='ollama'?'Bearer fixture-secret':'fixture-secret');
});
test('model discovery normalizes a full translation endpoint and follows Gemini pagination',async()=>{
  let page=0;
  const result=await discover({...config('gemini'),baseUrl:'https://provider.example/v1beta/models/old:generateContent?alt=json'}, {fetchImpl:async(url)=>{
    const target=new URL(url);assert.equal(target.pathname,'/v1beta/models');assert.equal(target.searchParams.get('alt'),'json');
    if(page++) {assert.equal(target.searchParams.get('pageToken'),'next');return Response.json({models:[{name:'models/b',supportedGenerationMethods:['generateContent']}]});}
    return Response.json({models:[{name:'models/a',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'});
  }});assert.deepEqual(result.map(item=>item.id),['a','b']);
});
test('Claude pagination uses the last ID and deduplicates models',async()=>{
  let page=0;
  const result=await discover(config('anthropic'),{fetchImpl:async(url)=>{
    if(page++){assert.equal(new URL(url).searchParams.get('after_id'),'a');return Response.json({data:[{id:'a'},{id:'b'}],has_more:false});}
    return Response.json({data:[{id:'a'}],has_more:true,last_id:'a'});
  }});assert.deepEqual(result.map(item=>item.id),['a','b']);
});
test('discovery rejects invalid config before network, but local Ollama needs no key',async()=>{
  for(const provider of [{...config('openai'),apiKey:''},{...config('openai'),baseUrl:'https://user:pass@api.example'},config('deepl')])await assert.rejects(discover(provider,{fetchImpl:()=>assert.fail('must not fetch')}),{code:'INVALID_CONFIG'});
  await discover({type:'ollama'},{fetchImpl:async(url)=>{assert.equal(new URL(url).pathname,'/api/tags');return Response.json({models:[]});}});
});
test('discovery bounds pagination and sanitizes service failures',async()=>{
  await assert.rejects(discover(config('gemini'),{fetchImpl:async()=>Response.json({models:[],nextPageToken:'repeat'})}),{code:'INVALID_RESPONSE'});
  await assert.rejects(discover(config('openai'),{fetchImpl:async()=>Response.json({secret:'fixture-secret'},{status:401})}),error=>error.code==='HTTP_401'&&!error.message.includes('fixture-secret'));
  await assert.rejects(discover(config('openai'),{fetchImpl:async()=>Response.json({wrong:[]})}),{code:'INVALID_RESPONSE'});
  await assert.rejects(discover(config('openai'),{timeoutMs:5,fetchImpl:()=>new Promise(()=>{})}),{code:'TIMEOUT'});
});
