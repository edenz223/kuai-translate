import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON,withRequestLifetime,MAX_RESPONSE_BYTES} from '../dist/src/providers/http.js';
import {sanitizeNetworkRecord,debugBatch,debugBatchError} from '../dist/src/shared/network-log.js';
import {setDebug} from '../dist/src/shared/debug.js';

const base={method:'POST',url:'https://api.example/translate',query:{},request:null,status:200,ok:true,response:null,sentBytes:0,receivedBytes:0,durationMs:180};
const call=(fetchImpl,url='https://api.example/translate',options={},signal=new AbortController().signal)=>{
  const records=[];
  return {records,promise:requestJSON(fetchImpl,url,options,signal,record=>records.push(record))};
};

test('HTTP success records full URL, repeated query, JSON params/results, byte sizes, without request headers',async()=>{
  const url='https://user:pass@api.example/translate?token=private-token&q=Hello&text=one&text=two&monkey=banana#fragment';
  const request={texts:['Hello'],content:'Original',messages:[{role:'user',content:'Translate this'}],apiKey:'private-key',nested:{access_token:'private-access',keyboard:'letters',author:'Alice'}};
  const response={translations:['你好'],messages:[{content:'Visible result'}],auth:'private-auth'};
  const h=call(async()=>Response.json(response),url,{method:'POST',headers:{Authorization:'Bearer private-header','X-API-Key':'header-secret'},body:JSON.stringify(request)});
  assert.deepEqual(await h.promise,response);assert.equal(h.records.length,1);
  const record=h.records[0],parsed=new URL(record.url);
  assert.equal(record.method,'POST');assert.equal(parsed.username,'');assert.equal(parsed.password,'');assert.equal(parsed.hash,'');
  assert.equal(parsed.searchParams.get('token'),'priv…');assert.equal(parsed.searchParams.get('q'),'Hello');
  assert.deepEqual(record.query,{q:'Hello',text:['one','two'],token:'priv…',monkey:'banana'});
  assert.deepEqual(record.request,{...request,apiKey:'priv…',nested:{access_token:'priv…',keyboard:'letters',author:'Alice'}});
  assert.deepEqual(record.response,{...response,auth:'priv…'});assert.equal(record.status,200);assert.equal(record.ok,true);
  assert.equal(record.sentBytes,Buffer.byteLength(JSON.stringify(request)));assert.equal(record.receivedBytes,Buffer.byteLength(JSON.stringify(response)));
  assert.ok(record.durationMs>=0);assert.equal('error' in record,false);
  assert.doesNotMatch(JSON.stringify(record),/private-|header-secret|user:pass|fragment|Authorization|X-API-Key/);
  assert.equal('headers' in record,false);
  response.translations[0]='Changed';request.texts[0]='Changed';
  assert.equal(record.response.translations[0],'你好');assert.equal(record.request.texts[0],'Hello');
});

for(const [name,status,body,code] of [
  ['HTTP error',429,'{"error":"Try later","token":"private-token","text":"Visible error"}','HTTP_429'],
  ['invalid JSON',200,'not JSON; text=Visible; token=private-token','INVALID_RESPONSE'],
])test(`${name} records URL, query, request, status and parsed or raw response`,async()=>{
  const h=call(async()=>new Response(body,{status}),'https://api.example/translate?api_key=private-key&q=Hello',{method:'POST',body:'{"text":"Hello"}'});
  await assert.rejects(h.promise,{code});const [record]=h.records;
  assert.equal(record.status,status);assert.equal(record.ok,false);assert.equal(record.error.code,code);assert.match(record.error.message,/translation service/);
  assert.equal(new URL(record.url).searchParams.get('api_key'),'priv…');assert.deepEqual(record.query,{api_key:'priv…',q:'Hello'});
  assert.deepEqual(record.request,{text:'Hello'});assert.match(JSON.stringify(record.response),/Visible/);
  if(code==='HTTP_429')assert.deepEqual(record.response,{error:'Try later',token:'priv…',text:'Visible error'});
  else assert.equal(typeof record.response,'string');
  assert.equal(record.receivedBytes,Buffer.byteLength(body));assert.doesNotMatch(JSON.stringify(record.response),/private-token/);
});

test('credential matching handles lowercase compound keys without hiding harmless names or token counts',()=>{
  const record=sanitizeNetworkRecord({...base,query:{mytoken:'private-token',secretkey:'private-key',signature:'private-signature',auth:'private-auth',password:'private-pass',token:['first-token','second-token']},request:{text:'Visible text',texts:['Visible'],content:'Visible content',messages:[{content:'Visible message'}],translations:['Visible result'],monkey:'banana',keyboard:'letters',author:'Alice',tokenizer:'words',max_tokens:4000,total_tokens:12,token_count:2}});
  assert.deepEqual(record.query,{mytoken:'priv…',secretkey:'priv…',signature:'priv…',auth:'priv…',password:'priv…',token:['firs…','seco…']});
  assert.deepEqual(record.request,{text:'Visible text',texts:['Visible'],content:'Visible content',messages:[{content:'Visible message'}],translations:['Visible result'],monkey:'banana',keyboard:'letters',author:'Alice',tokenizer:'words',max_tokens:4000,total_tokens:12,token_count:2});
});

test('form params become objects, plain strings stay strings, GET has null request',async()=>{
  for(const body of ['text=Hello&text=World&password=private-password',new URLSearchParams('text=Hello&text=World&password=private-password')]){
    const h=call(async()=>Response.json({}),undefined,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    await h.promise;assert.deepEqual(h.records[0].request,{text:['Hello','World'],password:'priv…'});
    assert.equal(h.records[0].sentBytes,Buffer.byteLength(String(body)));
  }
  const plain=call(async()=>Response.json({}),undefined,{body:'Plain text'});await plain.promise;assert.equal(plain.records[0].request,'Plain text');
  const get=call(async()=>Response.json({}));await get.promise;assert.equal(get.records[0].request,null);assert.equal(get.records[0].sentBytes,0);
});

test('network records truncate strings, cap arrays and stay below 200 KB even with escaped/multibyte payloads',()=>{
  const record=sanitizeNetworkRecord({...base,request:{text:'字'.repeat(4100),texts:Array.from({length:300},(_,i)=>String(i))},response:{content:'x'.repeat(5000)}});
  assert.equal(record.request.text,'字'.repeat(4000)+'…(+100 字)');assert.equal(record.request.texts.length,200);
  assert.equal(record.response.content,'x'.repeat(4000)+'…(+1000 字)');
  const huge=sanitizeNetworkRecord({...base,request:Array.from({length:300},()=>({text:'字\u0000'.repeat(3000)})),response:Array.from({length:300},()=>({text:'word'.repeat(2000)}))});
  assert.ok(Buffer.byteLength(JSON.stringify(huge))<200*1024);assert.equal(huge.status,200);assert.equal(huge.ok,true);
  for(const key of Object.keys(base))assert.ok(key in huge,key);
});

test('too-large responses retain readable prefix and HTTP status; declared oversized bodies are cancelled',async()=>{
  const h=call(async()=>new Response('x'.repeat(MAX_RESPONSE_BYTES+1)));
  await assert.rejects(h.promise,{code:'RESPONSE_TOO_LARGE'});
  assert.equal(h.records.length,1);assert.equal(h.records[0].status,200);assert.equal(h.records[0].ok,false);
  assert.equal(h.records[0].receivedBytes,MAX_RESPONSE_BYTES+1);assert.match(h.records[0].response,/^x{4000}…\(\+\d+ 字\)$/);
  let cancelled=false;
  const oversized=call(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Length':String(MAX_RESPONSE_BYTES+1)}}));
  await assert.rejects(oversized.promise,{code:'RESPONSE_TOO_LARGE'});assert.equal(cancelled,true);assert.equal(oversized.records[0].response,null);
});

test('network failure, stalled timeout, pre-cancel and mid-body cancel each record exactly once',async()=>{
  const failed=call(async()=>{throw Error('private transport details');});await assert.rejects(failed.promise,{code:'NETWORK_ERROR'});
  assert.equal(failed.records[0].status,'NETWORK_ERROR');assert.equal(failed.records[0].response,null);
  const timed=[];
  await assert.rejects(withRequestLifetime(signal=>requestJSON(()=>new Promise(()=>{}),'https://api.example/slow',{},signal,record=>timed.push(record)),{timeoutMs:10}),{code:'TIMEOUT'});
  assert.equal(timed.length,1);assert.equal(timed[0].status,'TIMEOUT');assert.equal(timed[0].error.code,'TIMEOUT');
  const before=new AbortController();before.abort();let fetched=false;
  const pre=call(async()=>{fetched=true;return Response.json({});},undefined,{},before.signal);
  await assert.rejects(pre.promise,{code:'CANCELLED'});assert.equal(fetched,false);assert.equal(pre.records.length,1);assert.equal(pre.records[0].status,'CANCELLED');
  const mid=new AbortController();let reached;
  const reading=new Promise(resolve=>{reached=resolve;});
  const partial=call(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('partial response'));reached();}})),undefined,{},mid.signal);
  await reading;await new Promise(resolve=>setImmediate(resolve));mid.abort();
  await assert.rejects(partial.promise,{code:'CANCELLED'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(partial.records.length,1);assert.equal(partial.records[0].status,200);assert.equal(partial.records[0].error.code,'CANCELLED');assert.equal(partial.records[0].response,'partial response');
});

function capture(t){
  const calls=[];
  for(const method of ['info','warn','groupCollapsed','log','groupEnd','table'])t.mock.method(console,method,(...args)=>calls.push([method,...args]));
  t.after(()=>setDebug(false));return calls;
}
const summary={count:8,providerId:'microsoft',durationMs:420};

test('one collapsed group per batch contains exactly URL, body/query params and result per request',t=>{
  const calls=capture(t);setDebug(true);
  const post=sanitizeNetworkRecord({...base,url:'https://api.example/translate?apiKey=private-key',query:{apiKey:'private-key'},request:{text:'Hello',apiKey:'private-key'},response:{translations:['你好'],token:'private-token'}});
  const get=sanitizeNetworkRecord({...base,method:'GET',url:'https://api.example/translate?q=Hello',query:{q:'Hello'},response:['你好']});
  debugBatch('字幕',summary,{network:[post,get]});
  assert.deepEqual(calls.map(call=>call[0]),['groupCollapsed','log','log','groupEnd']);
  assert.equal(calls[0][1],'[Kuai] %c字幕%c 8 条 · microsoft · 420 ms');
  assert.match(calls[0][2],/background:#[a-f0-9]+;color:white/);assert.equal(calls[0][3],'color:inherit');
  assert.deepEqual(calls.slice(1,3),[['log',{url:post.url,params:post.request,result:post.response}],['log',{url:get.url,params:get.query,result:get.response}]]);
  for(const call of calls.slice(1,3)){assert.equal(call.length,2);assert.deepEqual(Object.keys(call[1]),['url','params','result']);}
  assert.doesNotMatch(JSON.stringify(calls),/private-|headers|sentBytes|receivedBytes|durationMs/);
  calls.length=0;debugBatch('网页',{count:12,providerId:'openai',durationMs:1234},{network:[post]});
  assert.equal(calls[0][1],'[Kuai] %c网页%c 12 段 · openai · 1.2 s');
});

test('failed group warns in its summary, retains readable results, and never adds error metadata lines',t=>{
  const calls=capture(t);setDebug(true);
  const records=[sanitizeNetworkRecord({...base,status:429,ok:false,response:'服务繁忙',error:{code:'HTTP_429',message:'服务繁忙'}}),
    sanitizeNetworkRecord({...base,status:'NETWORK_ERROR',ok:false,error:{code:'NETWORK_ERROR',message:'无法连接'}})];
  debugBatchError('网页',{count:12,providerId:'fallback',durationMs:95},Object.assign(Error('服务繁忙 https://user:pass@api.example/?token=private-token'),{code:'HTTP_429',providerId:'openai',network:records}));
  assert.deepEqual(calls.map(call=>call[0]),['groupCollapsed','log','log','groupEnd']);
  assert.equal(calls[0][1],'[Kuai] ✖ %c网页%c 12 段 · openai · HTTP_429 服务繁忙 https://api.example/ · 95 ms');
  assert.match(calls[0][2],/background:#b45309/);assert.equal(calls[0][3],'color:#b45309');
  assert.equal(calls[1][1].result,'服务繁忙');assert.deepEqual(calls[2][1].result,{code:'NETWORK_ERROR',message:'无法连接'});
  assert.doesNotMatch(JSON.stringify(calls),/private-token|user:pass|headers/);
});

test('without records only a summary is printed, and debug off suppresses all batch output',t=>{
  const calls=capture(t);setDebug(true);
  debugBatch('字幕',summary);debugBatch('字幕',summary,{network:[]});
  debugBatchError('网页',summary,Object.assign(Error('服务繁忙'),{code:'HTTP_429'}));
  assert.deepEqual(calls.map(call=>call[0]),['info','info','warn']);
  assert.match(calls[2][1],/HTTP_429 服务繁忙/);assert.match(calls[2][2],/background:#b45309/);
  calls.length=0;debugBatchError('网页',summary,undefined);assert.match(calls[0][1],/✖.*UNKNOWN/);
  calls.length=0;debugBatch('网页',summary,{providerId:'b4bc4e46-9c4d-4c07-8d1d-d2540dcafd6d',providerLabel:'Gemini · gemini-flash-lite-latest'});
  assert.match(calls[0][1],/· Gemini · gemini-flash-lite-latest ·/);assert.doesNotMatch(calls[0][1],/b4bc4e46/);
  setDebug(false,true);calls.length=0;debugBatch('字幕',summary,{network:[base]});debugBatchError('网页',summary,{network:[base]});assert.deepEqual(calls,[]);
});

test('HTTP layer collects records without printing success or failure request lines in the worker',async t=>{
  const calls=capture(t);setDebug(true,true);
  const good=call(async()=>Response.json({text:'Visible'}));await good.promise;
  const bad=call(async()=>new Response('Unavailable',{status:503}));await assert.rejects(bad.promise,{code:'HTTP_503'});
  assert.equal(good.records.length,1);assert.equal(bad.records.length,1);assert.deepEqual(calls,[]);
});

for(const kind of ['page','youtube'])test(`${kind} runtime prints a single group on success or failure with relayed records`,async t=>{
  const calls=capture(t);setDebug(true);
  const good=sanitizeNetworkRecord({...base,request:{texts:['Hello']},response:{translations:['你好']}});
  const bad=sanitizeNetworkRecord({...base,status:429,ok:false,response:'Busy',error:{code:'HTTP_429',message:'Busy'}});
  let failed=false;
  const translate=async texts=>{
    if(failed)throw Object.assign(Error('Busy'),{code:'HTTP_429',providerId:'google',network:[good,bad]});
    return {translations:texts.map(()=>'你好'),providerId:'google',network:[good]};
  };
  let run;
  if(kind==='page'){
    const {createPageTranslator}=await import('../dist/src/content/page-translator.js');
    const {fixture}=await import('./helpers/content-dom.cjs');
    const h=fixture();h.respond(translate);
    const page=createPageTranslator(h.dependencies);t.after(()=>page.restore());
    run=async()=>{const node=h.paragraph(failed?'Another English paragraph':'Hello English paragraph');await page.translateBlocks([{element:node,text:node.textContent}]);};
  }else{
    const {createSubtitleSession}=await import('../dist/src/youtube/session.js');
    const {defaultSettings}=await import('../dist/src/shared/settings.js');
    const video=Object.assign(new EventTarget(),{isConnected:true,currentTime:1,duration:100,paused:true,seeking:false,seekable:{length:0},closest:()=>null});
    const session=createSubtitleSession({id:'network',video,settings:defaultSettings(),translate});t.after(()=>session.destroy());
    run=async()=>{session.setCues([{start:0,end:3,text:'Hello'}]);await session.translateCues(session.state.subtitlesList);};
  }
  await run();
  assert.deepEqual(calls.map(call=>call[0]),['groupCollapsed','log','groupEnd']);
  assert.match(calls[0][1],/1 [段条] · google · \d+ ms$/);
  assert.deepEqual(calls[1],['log',{url:good.url,params:good.request,result:good.response}]);
  failed=true;calls.length=0;await run();
  assert.deepEqual(calls.map(call=>call[0]),['groupCollapsed','log','log','groupEnd']);
  assert.match(calls[0][1],/✖.*1 [段条] · google · HTTP_429 Busy · \d+ ms$/);
  assert.match(calls[0][2],/background:#b45309/);
  assert.deepEqual(calls[2],['log',{url:bad.url,params:bad.query,result:bad.response}]);
});
