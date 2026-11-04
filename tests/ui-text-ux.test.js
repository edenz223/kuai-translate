import test from 'node:test';
import assert from 'node:assert/strict';
import {startTextTool} from '../src/ui/text.js';
import {defaultSettings} from '../src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';

async function setup(t) {
  const previous=globalThis.chrome,requests=[];
  globalThis.chrome={runtime:{sendMessage:async message=>{
    requests.push(message);
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:defaultSettings()};
    if(message.type==='KUAI_TRANSLATE')return {ok:true,value:{translations:message.texts.map(()=> '已完成的译文')}};
    if(message.type==='KUAI_CANCEL')return {ok:true,value:true};
    assert.fail(message.type);
  }}};t.after(()=>{globalThis.chrome=previous;});
  const h=createDocument(new URL('../public/text.html',import.meta.url));await startTextTool(h.document);
  return {...h,requests};
}

test('text actions become available only when their required content exists',async t=>{
  const h=await setup(t);
  assert.equal(h.node('translate').disabled,true);assert.equal(h.node('copy').disabled,true);assert.equal(h.node('download').disabled,true);
  h.node('input').value='A short example';await h.node('input').fire('input');
  assert.equal(h.node('translate').disabled,false);
  await h.node('translate').fire('click');
  assert.equal(h.node('output').value,'已完成的译文');assert.equal(h.node('copy').disabled,false);assert.equal(h.node('download').disabled,false);
  h.node('input').value='Edited source';await h.node('input').fire('input');
  assert.equal(h.node('output').value,'');assert.equal(h.node('copy').disabled,true);assert.equal(h.node('download').disabled,true);
  assert.doesNotMatch(h.node('status').textContent,/翻译完成/);
});

test('a failed replacement file read clears the obsolete translation and disables copying it',async t=>{
  const h=await setup(t);
  h.node('input').value='First source';await h.node('input').fire('input');await h.node('translate').fire('click');
  h.node('file').files=[{name:'next.txt',size:12,text:async()=>{throw new Error('Read failed');}}];
  await h.node('file').fire('change');
  assert.equal(h.node('input').value,'First source','a failed read must not destroy the source');
  assert.equal(h.node('output').value,'');assert.equal(h.node('copy').disabled,true);assert.equal(h.node('download').disabled,true);
  assert.match(h.node('status').textContent,/Read failed/);
});
