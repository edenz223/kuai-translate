import test from 'node:test';
import assert from 'node:assert/strict';
import {debug,isDebug,redact,setDebug} from '../dist/src/shared/debug.js';

test('debug is silent by default and toggles prefixed, redacted output',t=>{
  const calls=t.mock.method(console,'debug',()=>{});
  t.after(()=>setDebug(false));
  assert.equal(isDebug(),false);debug('provider',{apiKey:'private-key'});
  assert.equal(calls.mock.callCount(),0);
  setDebug(true);assert.equal(isDebug(),true);
  debug('provider','request',{apiKey:'private-key',items:2});
  const [prefix,event,value]=calls.mock.calls[0].arguments;
  assert.equal(prefix,'[kuai:provider]');assert.equal(event,'request');
  assert.equal(value.apiKey,'priv…');assert.equal(value.items,2);
  setDebug(false);debug('provider','ignored');assert.equal(calls.mock.callCount(),1);
});

test('redaction snapshots nested secrets, prompts and URLs without changing the input',()=>{
  const url='https://user:pass@example.com/v1?apiKey=private-key&token=token-value&secret=hidden&authorization=Bearer&password=hidden&signature=signed&model=fast#secret';
  const value={apiKey:'private-key',key:'key-value',Token:'token-value',secret:'hidden',Authorization:'Bearer private',password:'password',nested:[{access_token:'access-value',url,systemPrompt:'private system words',userPrompt:'private user words'}]};
  const result=redact(value);
  for(const key of ['apiKey','key','Token','secret','Authorization','password'])assert.equal(result[key],value[key].slice(0,4)+'…');
  assert.equal(result.nested[0].access_token,'acce…');
  assert.equal(result.nested[0].url,'https://example.com/v1?model=fast');
  assert.deepEqual(result.nested[0].systemPrompt,{length:20});
  assert.deepEqual(result.nested[0].userPrompt,{length:18});
  assert.equal(value.apiKey,'private-key');assert.equal(value.nested[0].url,url);
  assert.equal(redact(new URL(url)),'https://example.com/v1?model=fast');
  assert.equal(redact('Failed at '+url),'Failed at https://example.com/v1?model=fast');
});

test('redaction handles cyclic arrays, errors, getters and hostile objects without throwing',()=>{
  const value={nested:[]};value.nested.push(value);
  assert.equal(redact(value).nested[0],'[Circular]');
  const array=[];array.push(array);assert.deepEqual(redact(array),['[Circular]']);
  const error=new TypeError('Failure at https://example.com/?token=private&ok=1');
  error.apiKey='private-key';error.systemPrompt='private prompt';
  assert.deepEqual(redact(error),{name:'TypeError',message:'Failure at https://example.com/?ok=1',stack:redact(error.stack)});
  assert.equal(redact({get secret(){throw Error('must not run');}}).secret,'[Accessor]');
  const hostile=new Proxy({},{ownKeys(){throw Error('no');}});
  assert.doesNotThrow(()=>redact(hostile));assert.equal(redact(hostile),'[Uninspectable]');
});

test('error diagnostics retain safe codes, numeric status, stacks and recursively redacted causes',async()=>{
  const {TranslationError}=await import('../dist/src/providers/errors.js');
  const url='https://user:pass@example.com/v1?token=private-token&model=fast#private-fragment';
  const cause=new Error('Request failed at '+url,{cause:{apiKey:'private-key',systemPrompt:'private prompt',url}});
  cause.code='ECONNRESET';cause.status=503;cause.stack='Error: Request failed\n    at '+url;
  const error=new TranslationError('NETWORK_ERROR','Unable to reach the service');
  error.cause=cause;error.apiKey='private-key';error.systemPrompt='private prompt';error.stack='TranslationError: Failed\n    at '+url;
  assert.deepEqual(redact(error),{
    name:'TranslationError',message:'Unable to reach the service',code:'NETWORK_ERROR',
    stack:'TranslationError: Failed\n    at https://example.com/v1?model=fast',
    cause:{name:'Error',message:'Request failed at https://example.com/v1?model=fast',code:'ECONNRESET',status:503,
      stack:'Error: Request failed\n    at https://example.com/v1?model=fast',
      cause:{apiKey:'priv…',systemPrompt:{length:14},url:'https://example.com/v1?model=fast'}},
  });
  assert.equal(error.cause,cause);assert.equal(cause.cause.apiKey,'private-key');
  error.code={apiKey:'private-key'};error.status='503';
  assert.equal('code' in redact(error),false);assert.equal('status' in redact(error),false);
  error.cause=error;assert.equal(redact(error).cause,'[Circular]');
  let chain=new Error('Root'),tail=chain;
  for(let index=0;index<21;index++){tail.cause=new Error('Nested');tail=tail.cause;}
  let result=redact(chain);for(let index=0;index<20;index++)result=result.cause;
  assert.equal(result,'[Depth limit]');
});

test('provider diagnostics report bounded metadata and outcomes while disabled requests stay silent',async t=>{
  const {translateWithProvider}=await import('../dist/src/providers/index.js');
  const calls=t.mock.method(console,'debug',()=>{});
  t.after(()=>setDebug(false));
  const provider={id:'private',type:'openai',model:'test-model',apiKey:'private-key',systemPrompt:'private-system-prompt',userPrompt:'private-user-prompt'};
  const options={texts:['private-original'],fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'["translated"]'}}]}))};
  setDebug(false);await translateWithProvider(provider,options);assert.equal(calls.mock.callCount(),0);
  setDebug(true);await translateWithProvider(provider,options);
  const success=calls.mock.calls.find(call=>call.arguments[1]==='request').arguments[2];
  assert.equal(success.id,'private');assert.equal(success.type,'openai');assert.equal(success.model,'test-model');
  assert.equal(success.items,1);assert.equal(success.characters,16);assert.equal(success.outcome,'success');assert.ok(success.durationMs>=0);
  const beforeFailure=calls.mock.callCount();
  await assert.rejects(translateWithProvider(provider,{...options,fetchImpl:async()=>new Response('',{status:429})}),{code:'HTTP_429'});
  assert.deepEqual(calls.mock.calls.slice(beforeFailure).map(call=>call.arguments.slice(0,2)),[
    ['[kuai:provider:http]','error'],['[kuai:provider]','request'],
  ]);
  const failure=calls.mock.calls.filter(call=>call.arguments[1]==='request').at(-1).arguments[2];
  assert.equal(failure.outcome,'error');assert.equal(failure.code,'HTTP_429');
  const serialized=JSON.stringify(calls.mock.calls.map(call=>call.arguments));
  for(const privateText of ['private-key','private-system-prompt','private-user-prompt','private-original'])assert.ok(!serialized.includes(privateText));
});

test('page policy logs aggregate skip reasons without source text',async t=>{
  const {filterPageBlocks}=await import('../dist/src/content/page-policy.js');
  const {defaultSettings}=await import('../dist/src/shared/settings.js');
  const {fixture}=await import('./helpers/content-dom.cjs');
  const h=fixture(),settings=defaultSettings();settings.pageOptions.minTextLength=5;settings.pageOptions.neverLanguages=['ja'];
  const short=h.paragraph('Hi'),foreign=h.paragraph('Japanese text'),accepted=h.paragraph('English private source');foreign.setAttribute('lang','ja');
  const blocks=[{element:short,text:'Hi'},{element:foreign,text:'Japanese text'},{element:accepted,text:'English private source'}];
  const calls=t.mock.method(console,'debug',()=>{});setDebug(true);t.after(()=>setDebug(false));
  assert.deepEqual(await filterPageBlocks(blocks,settings,{env:h.env}),[blocks[2]]);
  const report=calls.mock.calls.at(-1).arguments[2];
  assert.equal(report.collected,3);assert.equal(report.selected,1);assert.equal(report.skipped,2);
  assert.deepEqual(report.reasons,{'min-length':1,language:1});
  settings.pageOptions.neverSites=['*'];assert.deepEqual(filterPageBlocks(blocks,settings,{env:h.env}),[]);
  assert.equal(calls.mock.calls.at(-1).arguments[2].reasons['site-rule'],3);
  assert.ok(!JSON.stringify(calls.mock.calls.map(call=>call.arguments)).includes('English private source'));
});
