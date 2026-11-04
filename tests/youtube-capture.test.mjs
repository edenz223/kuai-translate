import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=new URL('../dist/src/youtube/capture-main.js',import.meta.url);
const track={baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en',languageCode:'en',name:{simpleText:'English'}};
function harness({withInitialResponse=false,selectedLanguage='en',fetcher,runtimeTracks=[],selectedTrack,setOption=()=>{}}={}) {
  assert.ok(fs.existsSync(file),'the actual MAIN-world caption capture must exist');
  const outputs=[],requests=[],intervals=[];
  const response={videoDetails:{videoId:'abcdef12345'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[track]}},unrelatedPrivateData:'must-not-be-copied'};
  const win=new EventTarget();win.postMessage=data=>outputs.push(data);
  const player={getPlayerResponse:()=>response,getOption:()=>selectedTrack||({languageCode:selectedLanguage}),getAudioTrack:()=>({captionTracks:runtimeTracks}),setOption};
  if(withInitialResponse)win.ytInitialPlayerResponse=response;
  const doc=new EventTarget();doc.querySelectorAll=()=>[player];
  const context={window:win,document:doc,location:{href:'https://www.youtube.com/watch?v=abcdef12345',origin:'https://www.youtube.com'},
    URL,Request,Response,AbortController,TextDecoder,Event,console,setInterval:callback=>{intervals.push(callback);return intervals.length;},clearInterval(){},setTimeout,clearTimeout,
    fetch:async(url,init)=>{requests.push(String(url));if(fetcher)return fetcher(url,init);return new Response(JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'Hi'}]}]}),{headers:{'content-type':'application/json'}});},
  };
  win.fetch=context.fetch;win.location=context.location;
  vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);
  function message(data){const event=new Event('message');Object.assign(event,{source:win,origin:context.location.origin,data:{source:'kuai-youtube-request',...data}});win.dispatchEvent(event);}
  return {outputs,requests,context,message,response,periodic:()=>intervals.forEach(callback=>callback())};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('caption discovery emits only scoped track metadata for the current video',()=>{
  const h=harness(),data=h.outputs.find(item=>item.kind==='tracks');
  assert.equal(data.videoId,'abcdef12345');assert.equal(data.tracks.length,1);
  assert.equal(JSON.stringify(h.outputs).includes('must-not-be-copied'),false);
});
test('main-world requests cannot turn caption access into arbitrary authenticated fetches',async()=>{
  const h=harness();
  for(const url of ['https://attacker.example/api/timedtext?v=abcdef12345','https://www.youtube.com/logout','https://www.youtube.com/api/timedtext?v=other-video'])h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'test',url});
  await settle();assert.equal(h.requests.length,0);
});
test('valid track reads use the original fetch and return bounded subtitle data',async()=>{
  const h=harness();h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'request-a',url:track.baseUrl});await settle();await settle();
  assert.equal(h.requests.length,1);const result=h.outputs.find(item=>item.requestId==='request-a');
  assert.equal(result.kind,'captions');assert.match(result.body,/Hi/);
});
test('a route change discards a late caption fetch response',async()=>{
  const h=harness();h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'request-late',url:track.baseUrl});
  h.context.location.href='https://www.youtube.com/watch?v=different01';await settle();await settle();
  assert.equal(h.outputs.some(item=>item.requestId==='request-late'&&item.kind==='captions'),false);
});

test('live player track language takes precedence over initial response without periodic duplicate messages',()=>{
  const h=harness({withInitialResponse:true,selectedLanguage:'es'});
  assert.deepEqual(h.outputs.filter(item=>item.kind==='tracks').map(item=>item.selectedLanguage),['es']);
  h.outputs.length=0;h.periodic();
  assert.equal(h.outputs.length,0,'unchanged discovery must not alternate live and fallback signatures');
  h.message({kind:'request-tracks'});
  assert.deepEqual(h.outputs.filter(item=>item.kind==='tracks').map(item=>item.selectedLanguage),['es']);
});

test('rapid track replacements cancel only the current matching request and immediately release its slot',async t=>{
  const pending=[];
  const h=harness({fetcher:(url,{signal})=>new Promise((resolve,reject)=>{
    pending.push({signal,resolve});signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});
  })});
  t.after(()=>{for(const request of pending)request.resolve(new Response('{"events":[]}'));});
  const request=requestId=>h.message({kind:'fetch-track',videoId:'abcdef12345',requestId,url:track.baseUrl});
  const cancel=(requestId,videoId='abcdef12345')=>h.message({kind:'cancel-track',videoId,requestId});
  request('first');request('second');assert.equal(h.requests.length,2);
  cancel('first','different01');cancel('unknown');assert.equal(pending[0].signal.aborted,false);assert.equal(pending[1].signal.aborted,false);
  cancel('first');assert.equal(pending[0].signal.aborted,true);assert.equal(pending[1].signal.aborted,false);
  request('third');assert.equal(h.requests.length,3,'cancel must release capacity before the rejected fetch settles');
  cancel('second');request('fourth');assert.equal(h.requests.length,4);
  cancel('third');cancel('fourth');await settle();
  assert.equal(h.outputs.some(item=>item.requestId&&item.kind==='captions'),false);
});

test('captured response carries its own validated URL identity through a same-language track change',async()=>{
  let finish;
  const h=harness({fetcher:()=>new Promise(resolve=>{finish=resolve;})});
  const asr=track.baseUrl+'&kind=asr&name=Automatic';
  const reading=h.context.window.fetch(asr);
  h.response.captions.playerCaptionsTracklistRenderer.captionTracks=[{...track,kind:'',name:{simpleText:'Manual'}}];h.periodic();
  finish(new Response('{"events":[]}'));await reading;await settle();await settle();
  const result=h.outputs.find(item=>item.kind==='captions');assert.equal(result.trackUrl,asr);
});


test('runtime signed caption URLs take precedence over stale response URLs',async()=>{
  const runtime={...track,baseUrl:track.baseUrl+'&pot=fresh-token'};
  const h=harness({runtimeTracks:[runtime]});
  assert.equal(h.outputs.find(item=>item.kind==='tracks').tracks[0].baseUrl,runtime.baseUrl);
  h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'runtime',url:track.baseUrl});
  await settle();await settle();
  assert.equal(new URL(h.requests[0]).searchParams.get('pot'),'fresh-token');
});
test('empty caption responses refresh the native module once and try a fresh runtime URL',async()=>{
  let reloads=0;const runtime=[];
  const h=harness({runtimeTracks:runtime,setOption:(module,key,value)=>{
    assert.deepEqual([module,key,value],['captions','reload',true]);
    reloads++;runtime.push({...track,baseUrl:track.baseUrl+'&pot=renewed'});
  },fetcher:url=>new Response(new URL(url).searchParams.has('pot')?'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"Recovered"}]}]}':'')});
  h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'refresh',url:track.baseUrl});
  await settle();await settle();await settle();
  assert.equal(reloads,1);
  assert.match(h.outputs.find(item=>item.requestId==='refresh')?.body||'',/Recovered/);
});
test('early page captures replay after the isolated controller requests metadata',async()=>{
  const h=harness();
  await h.context.window.fetch(track.baseUrl);await settle();await settle();
  h.outputs.length=0;h.message({kind:'request-tracks'});
  assert.ok(h.outputs.some(item=>item.kind==='captions'&&item.body.includes('Hi')));
  h.context.location.href='https://www.youtube.com/watch?v=different01';
  h.outputs.length=0;h.message({kind:'request-tracks'});
  assert.equal(h.outputs.some(item=>item.kind==='captions'),false);
});
test('same-language runtime tracks never replace a different automatic track',()=>{
  const h=harness({runtimeTracks:[{...track,kind:'asr',baseUrl:track.baseUrl+'&kind=asr&pot=wrong'}]});
  assert.equal(h.outputs.find(item=>item.kind==='tracks').tracks[0].baseUrl,track.baseUrl);
});

test('asynchronous native reload can publish its signed URL before recovery completes',async()=>{
  const runtime=[];let reloads=0;
  const h=harness({runtimeTracks:runtime,setOption:()=>{
    reloads++;setImmediate(()=>runtime.push({...track,baseUrl:track.baseUrl+'&pot=async-token'}));
  },fetcher:url=>new Response(new URL(url).searchParams.has('pot')?'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"Async recovery"}]}]}':'')});
  h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'async-refresh',url:track.baseUrl});
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(reloads,1);
  assert.match(h.outputs.find(item=>item.requestId==='async-refresh')?.body||'',/Async recovery/);
});

test('empty JSON caption events refresh instead of stopping recovery at a nonblank body',async()=>{
  const runtime=[];
  const h=harness({runtimeTracks:runtime,setOption:()=>runtime.push({...track,baseUrl:track.baseUrl+'&pot=json-recovery'}),
    fetcher:url=>new Response(new URL(url).searchParams.has('pot')?'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"JSON recovered"}]}]}':'{"events":[]}')});
  h.message({kind:'fetch-track',videoId:'abcdef12345',requestId:'json-refresh',url:track.baseUrl});
  await settle();await settle();await settle();
  assert.match(h.outputs.find(item=>item.requestId==='json-refresh')?.body||'',/JSON recovered/);
});
