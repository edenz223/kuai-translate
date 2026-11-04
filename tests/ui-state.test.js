import test from 'node:test';
import assert from 'node:assert/strict';
import * as stateModule from '../src/ui/state.js';
import {fillSelect} from '../src/ui/common.js';
const {createSettingsEditor,bindProviderFields}=stateModule;

const initial = () => ({providers:[{id:'custom',type:'openai',name:'My API',enabled:true,apiKey:'',model:'old'}],activeProviderId:'custom'});
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; };

test('rapid model and key edits save in order without stale responses overwriting the form', async () => {
  const first=deferred(), calls=[];
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>{calls.push(structuredClone(value)); if(calls.length===1)await first.promise;return value;}});
  await editor.load();
  const a=editor.patchProvider('custom',{model:'manual-model-not-in-a-catalog'});
  const b=editor.patchProvider('custom',{apiKey:'local-test-secret'});
  await Promise.resolve();
  assert.equal(calls.length,1);
  assert.equal(editor.get().providers[0].apiKey,'local-test-secret');
  first.resolve();await Promise.all([a,b]);
  assert.equal(calls.length,2);
  assert.equal(calls[1].providers[0].model,'manual-model-not-in-a-catalog');
  assert.equal(calls[1].providers[0].apiKey,'local-test-secret');
  assert.equal(editor.get().providers[0].apiKey,'local-test-secret');
});

test('a failed save retains editable values and the next save can succeed', async () => {
  let count=0;
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>{if(++count===1)throw Error('Storage unavailable');return value;}});
  await editor.load();
  await assert.rejects(editor.patchProvider('custom',{model:'new-model'}),/Storage unavailable/);
  assert.equal(editor.get().providers[0].model,'new-model');
  await assert.rejects(editor.flush(),/Storage unavailable/,'a popup action must not continue with stale saved settings');
  await editor.retry();
  assert.equal(count,2);
  assert.equal(editor.status().error,null);
});

test('provider add, edit and remove preserve independent instances', async () => {
  let index=0;
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>value,idFactory:()=>`instance-${++index}`});
  await editor.load();
  const id=await editor.addProvider('openai');
  await editor.patchProvider(id,{name:'Second',model:'custom-second'});
  assert.equal(editor.get().providers[0].model,'old');
  assert.equal(editor.get().providers[1].model,'custom-second');
  await editor.removeProvider(id);
  assert.equal(editor.get().providers.length,1);
});

test('actual provider field bindings preserve manual models, empty key edits and booleans', async () => {
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>value}); await editor.load();
  const field=()=>({value:'',checked:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},removeEventListener(type){delete this.listeners[type];}});
  const fields={model:field(),apiKey:field(),enabled:field(),temperature:field()};
  const dispose=bindProviderFields({fields,editor,getId:()=> 'custom',onError:assert.fail});
  fields.model.value='any-model/2026';fields.model.listeners.input();
  fields.apiKey.value='';fields.apiKey.listeners.input();
  fields.enabled.checked=false;fields.enabled.listeners.change();
  fields.temperature.value='0';fields.temperature.listeners.input();
  await editor.flush();
  const provider=editor.get().providers[0];
  assert.equal(provider.model,'any-model/2026');assert.equal(provider.apiKey,'');
  assert.equal(provider.enabled,false);assert.equal(provider.temperature,0);
  dispose();assert.deepEqual(fields.model.listeners,{});
});

test('rendering saved numeric values does not erase an active decimal edit',()=>{
  assert.equal(typeof stateModule.syncProviderFields,'function');
  const fields={temperature:{value:'0.'},model:{value:'old'},enabled:{checked:false}};
  stateModule.syncProviderFields({fields,provider:{temperature:0,model:'new',enabled:true},activeElement:fields.temperature});
  assert.equal(fields.temperature.value,'0.');assert.equal(fields.model.value,'new');assert.equal(fields.enabled.checked,true);
  stateModule.syncProviderFields({fields,provider:{temperature:0.7,model:'new',enabled:true}});
  assert.equal(fields.temperature.value,'0.7');
});

test('imported language codes absent from the short menu remain selectable',()=>{
  const document={createElement:()=>({})},select={dataset:{},replaceChildren(...nodes){this.options=nodes;}};
  fillSelect(document,select,[['en','English']],'uk');
  assert.equal(select.value,'uk');assert.ok(select.options.some(option=>option.value==='uk'));
});

test('queued saves describe changes against adjacent drafts without treating untouched fields as edits',async()=>{
  const gate=deferred(),calls=[];
  const editor=createSettingsEditor({load:async()=>initial(),save:async(snapshot,base)=>{calls.push({snapshot,base});if(calls.length===1)await gate.promise;return snapshot;}});
  await editor.load();
  const first=editor.patchProvider('custom',{model:'edited-model'}),second=editor.patchProvider('custom',{name:'Edited name'});
  gate.resolve();await Promise.all([first,second]);
  assert.equal(calls[0].base.providers[0].model,'old');
  assert.equal(calls[1].base.providers[0].model,'edited-model');
  assert.equal(calls[1].snapshot.providers[0].apiKey,calls[1].base.providers[0].apiKey);
});

test('a transient earlier failure carries its unsaved changes into the next queued base',async()=>{
  const calls=[];
  const editor=createSettingsEditor({load:async()=>initial(),save:async(snapshot,base)=>{calls.push({snapshot,base});if(calls.length===1)throw Error('Temporary');return snapshot;}});
  await editor.load();
  const first=editor.patchProvider('custom',{model:'edited-model'}),second=editor.patchProvider('custom',{name:'Edited name'});
  await assert.rejects(first,/Temporary/);await second;
  assert.equal(calls[1].base.providers[0].model,'old');
  assert.equal(calls[1].snapshot.providers[0].model,'edited-model');
});

test('conflicts retain the draft and stop queued overwrites until explicit reload',async()=>{
  let writes=0;
  const editor=createSettingsEditor({load:async()=>initial(),save:async()=>{writes++;throw Object.assign(Error('Changed in another page'),{code:'SETTINGS_CONFLICT'});}});
  await editor.load();
  const first=editor.patchProvider('custom',{model:'edited-model'}),second=editor.patchProvider('custom',{name:'Edited name'});
  await assert.rejects(first,{code:'SETTINGS_CONFLICT'});await assert.rejects(second,{code:'SETTINGS_CONFLICT'});
  assert.equal(writes,1);assert.equal(editor.get().providers[0].model,'edited-model');
  await editor.reload();assert.equal(editor.get().providers[0].model,'old');assert.equal(editor.status().error,null);
});
