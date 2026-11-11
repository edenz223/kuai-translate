import test from 'node:test';
import assert from 'node:assert/strict';
import {debug,debugError,isDebug,redact,setDebug} from '../dist/src/shared/debug.js';

test('debug toggles default-visible Chinese messages and optional redacted snapshots',t=>{
  const info=t.mock.method(console,'info',()=>{}),warn=t.mock.method(console,'warn',()=>{}),verbose=t.mock.method(console,'debug',()=>{});
  t.after(()=>setDebug(false));
  const error=Object.assign(new Error('Too many requests'),{code:'HTTP_429'});
  assert.equal(isDebug(),false);debug('provider','翻译请求成功：2 条',{apiKey:'private-key'});debugError('provider','翻译请求失败',error);
  assert.equal(info.mock.callCount(),0);assert.equal(warn.mock.callCount(),0);
  setDebug(true);assert.equal(isDebug(),true);
  debug('provider','翻译请求成功：2 条 / 16 字 · 418 ms',{apiKey:'private-key',items:2});
  const [message,value]=info.mock.calls[0].arguments;
  assert.equal(message,'[Kuai·provider] 翻译请求成功：2 条 / 16 字 · 418 ms');
  assert.equal(value.apiKey,'priv…');assert.equal(value.items,2);
  debug('page:batch','翻译批次完成：2 段 · 418 ms');assert.equal(info.mock.calls[1].arguments.length,1);
  debugError('provider','翻译请求失败',error);
  assert.equal(warn.mock.calls[0].arguments[0],'[Kuai·provider] 翻译请求失败：HTTP_429 Too many requests');
  assert.deepEqual(warn.mock.calls[0].arguments[1],redact(error));
  setDebug(false);debug('provider','忽略');debugError('provider','忽略',error);
  assert.equal(info.mock.callCount(),2);assert.equal(warn.mock.callCount(),1);assert.equal(verbose.mock.callCount(),0);
});

test('both message strings and expanded errors sanitize URLs and inline credentials',t=>{
  const info=t.mock.method(console,'info',()=>{}),warn=t.mock.method(console,'warn',()=>{});
  setDebug(true);t.after(()=>setDebug(false));
  const unsafe='https://user:pass@example.com/v1?token=private-token&model=fast#private-fragment Authorization: Bearer private-bearer apiKey="private-key" password=private-password sk-privateabcdef';
  debug('provider','请求成功：2 条 '+unsafe,{url:unsafe});
  const error=Object.assign(new Error('Request failed at '+unsafe),{code:'HTTP_429'});
  debugError('provider','翻译请求失败：2 条 '+unsafe,error);
  const message=warn.mock.calls[0].arguments[0];
  assert.match(message,/HTTP_429 Request failed at https:\/\/example.com\/v1\?model=fast/);
  assert.equal(warn.mock.calls[0].arguments.at(-1).message,redact(error).message);
  const serialized=JSON.stringify([...info.mock.calls,...warn.mock.calls].map(call=>call.arguments));
  for(const secret of ['user:pass','private-token','private-fragment','private-bearer','private-key','private-password','sk-privateabcdef'])assert.ok(!serialized.includes(secret),secret);
  // Parser exceptions must not echo response or settings contents, even in stacks/causes.
  const parserError=new SyntaxError('Unexpected token in private-original private-prompt private-translation');
  debugError('provider:json','解析翻译响应失败',parserError);
  assert.ok(!JSON.stringify(warn.mock.calls.at(-1).arguments).includes('private-'));
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
  for(const key of ['prompt','text','texts','original','translated','translation','translations','content','body'])assert.deepEqual(redact({[key]:'private-content'})[key],{length:15});
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

test('provider diagnostics report readable counts, outcomes, models and retries without text',async t=>{
  const {translateWithProvider,listProviderModels}=await import('../dist/src/providers/index.js');
  const info=t.mock.method(console,'info',()=>{}),warn=t.mock.method(console,'warn',()=>{});
  t.after(()=>setDebug(false));
  const provider={id:'private',type:'openai',model:'test-model',apiKey:'private-key',systemPrompt:'private-system-prompt',userPrompt:'private-user-prompt'};
  const options={texts:['private-original'],fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'["private-translation"]'}}]}))};
  setDebug(false);await translateWithProvider(provider,options);assert.equal(info.mock.callCount(),0);assert.equal(warn.mock.callCount(),0);
  setDebug(true);await translateWithProvider(provider,options);
  const [message,success]=info.mock.calls.find(call=>call.arguments[0].startsWith('[Kuai·provider]')).arguments;
  assert.match(message,/^\[Kuai·provider\] 翻译请求成功：openai · test-model · 1 条 \/ 16 字 · \d+ ms$/);
  assert.equal(success.id,'private');assert.equal(success.type,'openai');assert.equal(success.model,'test-model');
  assert.equal(success.items,1);assert.equal(success.characters,16);assert.equal(success.outcome,'success');assert.ok(success.durationMs>=0);
  await assert.rejects(translateWithProvider(provider,{...options,fetchImpl:async()=>new Response('',{status:429})}),{code:'HTTP_429'});
  assert.equal(warn.mock.callCount(),2);
  assert.match(warn.mock.calls[0].arguments[0],/^\[Kuai·http\] POST api.openai.com\/v1\/chat\/completions → 429 · \d+ ms$/);
  const [failed,failure,error]=warn.mock.calls[1].arguments;
  assert.match(failed,/翻译请求失败：openai · test-model · 1 条 \/ 16 字 · \d+ ms：HTTP_429 The translation service returned HTTP 429/);
  assert.equal(failure.outcome,'error');assert.ok(failure.durationMs>=0);assert.equal(error.code,'HTTP_429');
  await listProviderModels(provider,{fetchImpl:async()=>new Response('{"data":[{"id":"fast"},{"id":"small"}]}')});
  assert.match(info.mock.calls.at(-1).arguments[0],/获取模型列表成功：openai · test-model · 2 个模型 · \d+ ms/);
  assert.equal(info.mock.calls.at(-1).arguments[1].models,2);
  await assert.rejects(listProviderModels(provider,{fetchImpl:async()=>new Response('',{status:503})}),{code:'HTTP_503'});
  assert.match(warn.mock.calls.at(-1).arguments[0],/获取模型列表失败：.*HTTP_503/);
  await translateWithProvider(provider,{texts:['private-original','private-original'],fetchImpl:options.fetchImpl});
  const retry=info.mock.calls.find(call=>call.arguments[0].includes('拆分重试'));
  assert.match(retry.arguments[0],/模型响应不完整，拆分重试：2 条 → 2 批 \(INVALID_RESPONSE\)/);
  assert.equal(retry.arguments[1].items,2);
  await assert.rejects(translateWithProvider(provider,{...options,fetchImpl:async()=>new Response('private-response-text')}),{code:'INVALID_RESPONSE'});
  const serialized=JSON.stringify([...info.mock.calls,...warn.mock.calls].filter(call=>!call.arguments[0].startsWith('[Kuai·http]')).map(call=>call.arguments));
  for(const privateText of ['private-key','private-system-prompt','private-user-prompt','private-original','private-translation','private-response-text'])assert.ok(!serialized.includes(privateText),privateText);
});

test('page policy logs Chinese aggregate skip reasons without source text',async t=>{
  const {filterPageBlocks,reportPageCollection}=await import('../dist/src/content/page-policy.js');
  const {defaultSettings}=await import('../dist/src/shared/settings.js');
  const {fixture}=await import('./helpers/content-dom.cjs');
  const h=fixture(),settings=defaultSettings();settings.pageOptions.minTextLength=5;settings.pageOptions.neverLanguages=['ja'];
  const short=h.paragraph('Hi'),foreign=h.paragraph('Japanese text'),accepted=h.paragraph('English private source');foreign.setAttribute('lang','ja');
  const blocks=[{element:short,text:'Hi'},{element:foreign,text:'Japanese text'},{element:accepted,text:'English private source'}];
  const calls=t.mock.method(console,'info',()=>{});setDebug(true);t.after(()=>setDebug(false));
  assert.deepEqual(await filterPageBlocks(blocks,settings,{env:h.env}),[blocks[2]]);
  const [message,report]=calls.mock.calls.at(-1).arguments;
  assert.equal(message,'[Kuai·page:policy] 翻译前复核：候选 3 段，翻译 1 段，跳过 2 段（长度不足 1、不翻译的语言 1）');
  assert.equal(report.collected,3);assert.equal(report.selected,1);assert.equal(report.skipped,2);
  assert.deepEqual(report.reasons,{'min-length':1,language:1});
  const before=calls.mock.callCount();await filterPageBlocks([blocks[2]],settings,{env:h.env});
  assert.equal(calls.mock.callCount(),before);
  settings.pageOptions.neverSites=['*'];assert.deepEqual(filterPageBlocks(blocks,settings,{env:h.env}),[]);
  assert.equal(calls.mock.calls.at(-1).arguments[1].reasons['site-rule'],3);
  assert.equal(calls.mock.calls.at(-1).arguments[0],'[Kuai·page:policy] 当前网址命中不翻译规则，跳过整页翻译');
  reportPageCollection('page:collect',7,0,{'non-language-or-detached':1,'page-area':1,selector:1,'site-rule':1,'duplicate-or-invalid':1,unreadable:1,'source-changed':1});
  assert.match(calls.mock.calls.at(-1).arguments[0],/非文本或已移除 1、页脚区域 1、排除选择器 1、网址规则 1、重复或无效 1、不可见 1、原文已变化 1/);
  assert.ok(!JSON.stringify(calls.mock.calls.map(call=>call.arguments)).includes('English private source'));
});

test('content page batches log paragraph counts and timing, never request or result text',async t=>{
  const {createPageTranslator}=await import('../dist/src/content/page-translator.js');
  const {fixture}=await import('./helpers/content-dom.cjs');
  const info=t.mock.method(console,'info',()=>{}),warn=t.mock.method(console,'warn',()=>{}),h=fixture();
  const page=createPageTranslator(h.dependencies);t.after(()=>{page.restore();setDebug(false);});
  h.respond(async texts=>({translations:texts.map(()=>'private-translation')}));
  h.paragraph('private-original first');h.paragraph('private-original second');
  setDebug(true);await page.translatePage();
  const batches=info.mock.calls.filter(call=>call.arguments[0].startsWith('[Kuai·page:batch]'));
  assert.equal(batches.length,1);
  assert.match(batches[0].arguments[0],/^\[Kuai·page:batch\] 翻译批次完成：2 段 · \d+ ms$/);
  assert.equal(batches[0].arguments.length,1);
  h.respond(async()=>{throw Object.assign(new Error('Request failed at https://user:pass@example.com/?token=private-token&ok=1'),{code:'HTTP_429'});});
  const failed=h.paragraph('private-original third');
  await page.translateBlocks([{element:failed,text:failed.textContent}]);
  const failures=warn.mock.calls.filter(call=>call.arguments[0].startsWith('[Kuai·page:batch]'));
  assert.equal(failures.length,1);
  assert.match(failures[0].arguments[0],/翻译批次失败：1 段 · \d+ ms：HTTP_429 Request failed at https:\/\/example.com\/\?ok=1/);
  assert.equal(failures[0].arguments.at(-1).code,'HTTP_429');
  const serialized=JSON.stringify([...info.mock.calls,...warn.mock.calls].map(call=>call.arguments));
  for(const text of ['private-original','private-translation','private-token','user:pass'])assert.ok(!serialized.includes(text),text);
  setDebug(false);const counts=[info.mock.callCount(),warn.mock.callCount()];
  const silent=h.paragraph('private-original silent');await page.translateBlocks([{element:silent,text:silent.textContent}]);
  assert.deepEqual([info.mock.callCount(),warn.mock.callCount()],counts);
});

test('one paragraph toggle logs its collection once, not once per internal recheck',async t=>{
  const {createPageTranslator}=await import('../dist/src/content/page-translator.js');
  const {fixture}=await import('./helpers/content-dom.cjs');
  const info=t.mock.method(console,'info',()=>{}),h=fixture();
  const page=createPageTranslator(h.dependencies);t.after(()=>{page.restore();setDebug(false);});
  h.respond(async texts=>({translations:texts.map(()=>'translated')}));
  const paragraph=h.paragraph('A paragraph to toggle');
  setDebug(true);await page.toggleBlocks([{element:paragraph,text:paragraph.textContent}]);
  const lines=info.mock.calls.map(call=>call.arguments[0]).filter(line=>/^\[Kuai·page:(collect|policy)\]/.test(line));
  assert.deepEqual(lines,['[Kuai·page:collect] 网页收集：候选 1 段，翻译 1 段，跳过 0 段']);
});

test('YouTube cue loading, batches and explicit navigation diagnostics stay text-free',async t=>{
  const {createSubtitleSession}=await import('../dist/src/youtube/session.js');
  const {navigationState}=await import('../dist/src/youtube/navigation.js');
  const {parseTimedText}=await import('../dist/src/youtube/captions.js');
  const {defaultSettings}=await import('../dist/src/shared/settings.js');
  const info=t.mock.method(console,'info',()=>{}),warn=t.mock.method(console,'warn',()=>{});
  const video=Object.assign(new EventTarget(),{isConnected:true,currentTime:1,duration:100,paused:true,seeking:false,seekable:{length:0},closest:()=>null});
  let fail=false;
  const session=createSubtitleSession({id:'debug',video,settings:defaultSettings(),translate:async texts=>{
    if(fail)throw Object.assign(new Error('Too many requests'),{code:'HTTP_429'});
    return {translations:texts.map(()=>'private-translation')};
  }});
  t.after(()=>{session.destroy();setDebug(false);});setDebug(true);
  const cues=parseTimedText({events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'private-caption'}]}]},{groupPhrases:true});
  assert.match(info.mock.calls.at(-1).arguments[0],/字幕合并：原始 1 条 → 1 句（人工字幕）/);
  session.setCues([...cues,{start:4,end:3,text:'private-invalid'}]);
  assert.match(info.mock.calls.at(-1).arguments[0],/字幕载入：接收 2 条，有效 1 条$/);
  await session.translateCues(session.state.subtitlesList);
  assert.match(info.mock.calls.at(-1).arguments[0],/字幕翻译批次完成：1 条 · \d+ ms$/);
  assert.equal(info.mock.calls.at(-1).arguments.length,1);
  fail=true;session.setCues(cues);await session.translateCues(session.state.subtitlesList);
  assert.equal(warn.mock.callCount(),1);
  assert.match(warn.mock.calls[0].arguments[0],/字幕翻译批次失败：1 条 · \d+ ms：HTTP_429 Too many requests/);
  session.setCues(cues,{live:true});
  assert.match(info.mock.calls.at(-1).arguments[0],/字幕载入：接收 1 条，有效 1 条（直播）/);
  const before=info.mock.callCount();
  for(let i=0;i<10;i++)navigationState(session);
  assert.equal(info.mock.callCount(),before,'render/timer queries must not emit navigation logs');
  navigationState(session,{diagnostic:true});
  assert.match(info.mock.calls.at(-1).arguments[0],/字幕导航不可用：live，共 1 条/);
  const serialized=JSON.stringify([...info.mock.calls,...warn.mock.calls].map(call=>call.arguments));
  for(const text of ['private-caption','private-translation','private-invalid'])assert.ok(!serialized.includes(text),text);
  setDebug(false);const counts=[info.mock.callCount(),warn.mock.callCount()];
  session.setCues(cues);await session.translateCues(session.state.subtitlesList);
  assert.deepEqual([info.mock.callCount(),warn.mock.callCount()],counts);
});
