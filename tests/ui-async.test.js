import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/ui/state.js';
import {startTextTool} from '../src/ui/text.js';
import {startOptions} from '../src/ui/options.js';
import {defaultSettings} from '../src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};};
const documentBoundary=(page='text')=>createDocument(new URL('../public/'+page+'.html',import.meta.url));

test('connection results are invalidated when another provider is selected or edited',async()=>{
  assert.equal(typeof state.createProviderTester,'function');
  const first=deferred(),second=deferred(),states=[],cancelled=[];let id=0;
  const tester=state.createProviderTester({request:(_type,payload)=>payload.provider.id==='a'?first.promise:second.promise,makeRequestId:()=>String(++id),cancel:async value=>cancelled.push(value),onState:value=>states.push(value)});
  const a=tester.test({id:'a'});tester.invalidate();const b=tester.test({id:'b'});
  first.resolve({translations:['A result']});await a;
  assert.equal(states.at(-1).status,'pending');assert.equal(states.at(-1).providerId,'b');
  second.resolve({translations:['B result']});await b;
  assert.equal(states.at(-1).status,'success');assert.deepEqual(states.at(-1).result.translations,['B result']);
  assert.ok(cancelled.includes('1'));
});

test('actual options controls invalidate a connection result after selecting or editing its provider',async t=>{
  const previousChrome=globalThis.chrome,checks=[],cancelled=[];
  const settings=defaultSettings();
  for(const id of ['custom-a','custom-b'])settings.providers.push({id,type:'openai',name:id,enabled:true,baseUrl:'',apiKey:'fixture-only',model:'fixture-model',region:'',temperature:null});
  globalThis.chrome={runtime:{sendMessage:async message=>{
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:settings};
    if(message.type==='KUAI_SAVE_SETTINGS')return {ok:true,value:message.settings};
    if(message.type==='KUAI_CANCEL'){cancelled.push(message.requestId);return {ok:true,value:true};}
    if(message.type==='KUAI_TEST_PROVIDER'){const result=deferred();checks.push({message,result});return result.promise;}
    assert.fail('Unexpected message '+message.type);
  }}};
  t.after(()=>{globalThis.chrome=previousChrome;});
  const h=documentBoundary('options');await startOptions(h.document);
  assert.equal(h.node('provider-name').readOnly,true,'built-in names are fixed by normalization and must not promise editable names');
  await h.node('provider-list').children[4].fire('click');
  assert.equal(h.node('provider-name').readOnly,false);
  const first=h.node('test-provider').fire('click');
  assert.equal(h.node('test-provider').disabled,true);
  await h.node('provider-list').children[5].fire('click');
  checks[0].result.resolve({ok:true,value:{translations:['Old selected service']}});await first;
  assert.equal(h.node('test-status').textContent,'');assert.equal(h.node('test-provider').disabled,false);
  const second=h.node('test-provider').fire('click');
  h.node('provider-model').value='new-model';await h.node('provider-model').fire('input');
  checks[1].result.resolve({ok:true,value:{translations:['Old provider draft']}});await second;
  assert.equal(h.node('test-status').textContent,'');assert.equal(h.node('test-provider').disabled,false);
  assert.deepEqual(cancelled,checks.slice(0,2).map(({message})=>message.requestId));
  const third=h.node('test-provider').fire('click');
  checks[2].result.resolve({ok:true,value:{translations:['Current result']}});await third;
  assert.equal(h.node('test-status').textContent,'连接成功：Current result');
});

test('a late local file read cannot overwrite a newer file in the actual text page controller',async t=>{
  const previousChrome=globalThis.chrome,previousAdd=globalThis.addEventListener;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,value:defaultSettings()})}};globalThis.addEventListener=()=>{};
  t.after(()=>{globalThis.chrome=previousChrome;globalThis.addEventListener=previousAdd;});
  const h=documentBoundary();await startTextTool(h.document);
  const first=deferred(),file=h.node('file');
  file.files=[{name:'a.txt',size:5,text:()=>first.promise}];const a=file.fire('change');
  assert.equal(h.node('translate').disabled,true,'translation must wait for the selected file to finish reading');
  file.files=[{name:'b.txt',size:5,text:async()=> 'B source'}];await file.fire('change');
  first.resolve('A late source');await a;
  assert.equal(h.node('input').value,'B source');
});

test('editing the original while a file reads keeps the user text',async t=>{
  const previousChrome=globalThis.chrome,previousAdd=globalThis.addEventListener;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,value:defaultSettings()})}};globalThis.addEventListener=()=>{};
  t.after(()=>{globalThis.chrome=previousChrome;globalThis.addEventListener=previousAdd;});
  const h=documentBoundary();await startTextTool(h.document);
  const pending=deferred(),file=h.node('file');file.files=[{name:'a.txt',size:5,text:()=>pending.promise}];const task=file.fire('change');
  h.node('input').value='User edit';await h.node('input').fire('input');
  pending.resolve('Late file');await task;
  assert.equal(h.node('input').value,'User edit');assert.equal(h.node('translate').disabled,false);
});
