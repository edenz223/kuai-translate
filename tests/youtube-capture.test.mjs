import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=new URL('../dist/src/youtube/capture-main.js',import.meta.url);
const track={baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en',languageCode:'en',name:{simpleText:'English'}};
function harness({withInitialResponse=false,selectedLanguage='en',fetcher}={}) {
  assert.ok(fs.existsSync(file),'the actual MAIN-world caption capture must exist');
  const outputs=[],requests=[],intervals=[];
  const response={videoDetails:{videoId:'abcdef12345'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[track]}},unrelatedPrivateData:'must-not-be-copied'};
  const win=new EventTarget();win.postMessage=data=>outputs.push(data);
  const player={getPlayerResponse:()=>response,getOption:()=>({languageCode:selectedLanguage})};
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
