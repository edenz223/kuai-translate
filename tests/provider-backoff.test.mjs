import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON,withRequestLifetime} from '../dist/src/providers/http.js';
import {translateWithProvider} from '../dist/src/providers/index.js';
import {setDebug} from '../dist/src/shared/debug.js';

const busy=(status=429,header)=>new Response('Busy',{status,headers:header===undefined?{}:{'Retry-After':header}});
const signal=()=>new AbortController().signal;
for(const status of [429,503])test(status+' then success retries just the HTTP call and records each attempt',async()=>{
  let calls=0;const records=[];
  const translations=await translateWithProvider({type:'microsoft'},{texts:['Hello'],onNetwork:record=>records.push(record),fetchImpl:async()=>++calls===1?busy(status,'0'):Response.json([{translations:[{text:'你好'}]}])});
  assert.deepEqual(translations,['你好']);assert.equal(calls,2);assert.deepEqual(records.map(record=>[record.status,record.ok]),[[status,false],[200,true]]);
});
test('Retry-After seconds and HTTP dates are honored; invalid/long headers use exponential backoff',async t=>{
  t.mock.method(Date,'now',()=>Date.UTC(2026,0,1));t.mock.method(Math,'random',()=>0.5);
  for(const [header,expected] of [['2',2000],['Thu, 01 Jan 2026 00:00:04 GMT',4000],['0',0],['nonsense',1050],['-1',1050],['11',1050],['Thu, 01 Jan 2026 00:01:00 GMT',1050]]){
    let calls=0;const waits=[];
    const result=await requestJSON(async()=>++calls===1?busy(429,header):Response.json({ok:true}),'https://example.com',{},signal(),undefined,async ms=>{waits.push(ms);});
    assert.deepEqual(result,{ok:true});assert.deepEqual(waits,[expected],header);
  }
  const waits=[];let calls=0;
  await assert.rejects(requestJSON(async()=>{calls++;return busy();},'https://example.com',{},signal(),undefined,async ms=>{waits.push(ms);}),{code:'HTTP_429'});
  assert.equal(calls,3);assert.deepEqual(waits,[1050,2050]);
});
test('cancel during backoff rejects promptly and starts no further request',async()=>{
  const controller=new AbortController();let calls=0,recorded;
  const firstRecorded=new Promise(resolve=>{recorded=resolve;});
  const pending=requestJSON(async()=>{calls++;return busy(429,'10');},'https://example.com',{},controller.signal,recorded);
  await firstRecorded;await new Promise(resolve=>setImmediate(resolve));
  controller.abort();await assert.rejects(pending,{code:'CANCELLED'});assert.equal(calls,1);
});
test('other HTTP statuses are not retried',async()=>{
  let calls=0;
  await assert.rejects(requestJSON(async()=>{calls++;return busy(500);},'https://example.com',{},signal(),undefined,async()=>assert.fail('must not wait')),{code:'HTTP_500'});
  assert.equal(calls,1);
});
test('insufficient remaining lifetime returns the provider error before waiting',async t=>{
  t.mock.method(Math,'random',()=>0);
  for(const header of [undefined,'1']){
    let calls=0;const records=[];
    await assert.rejects(withRequestLifetime(active=>requestJSON(async()=>{calls++;return busy(429,header);},'https://example.com',{},active,record=>records.push(record),async()=>assert.fail('must not wait')),{timeoutMs:20}),{code:'HTTP_429'});
    assert.equal(calls,1);assert.equal(records.length,1);
  }
});
test('retries consume the original lifetime without resetting the timeout',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let calls=0;const records=[];
  const pending=withRequestLifetime(active=>requestJSON(async()=>++calls===1?busy(429,'1'):new Promise(()=>{}),'https://example.com',{},active,record=>records.push(record)),{timeoutMs:1500});
  const rejected=assert.rejects(pending,{code:'TIMEOUT'});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
  t.mock.timers.tick(500);await rejected;assert.deepEqual(records.map(record=>record.status),[429,'TIMEOUT']);
});
test('retry notices are verbose-only and include status, delay and retry number',async t=>{
  const info=t.mock.method(console,'info',()=>{});t.after(()=>setDebug(false));
  for(const verbose of [false,true]){
    setDebug(true,verbose);let calls=0;
    await requestJSON(async()=>++calls===1?busy(429,'1'):Response.json({}),'https://example.com',{},signal(),undefined,async()=>{});
    assert.equal(info.mock.callCount(),verbose?1:0);
  }
  assert.match(info.mock.calls[0].arguments[0],/服务繁忙（HTTP_429），1.0 s 后重试（第 1 次）/);
});
