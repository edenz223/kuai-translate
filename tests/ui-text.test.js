import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextDocument, createTextTranslator } from '../dist/src/ui/text-model.js';

test('SRT translation changes cue text while retaining cue numbers and exact timings', async () => {
  const source='1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nWorld\r\n';
  const plan=parseTextDocument(source,'captions.srt');
  assert.deepEqual(plan.texts,['Hello','World']);
  assert.equal(plan.render(['你好','世界']),'1\r\n00:00:01,000 --> 00:00:02,500\r\n你好\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n世界\r\n');
});

test('VTT metadata and Markdown code stay unchanged while translatable text remains visible', () => {
  const vtt='WEBVTT\n\nNOTE do not translate\nmeta\n\ncue-a\n00:01.000 --> 00:02.500 align:start\nHello\n';
  const captions=parseTextDocument(vtt,'video.vtt');
  assert.deepEqual(captions.texts,['Hello']);
  assert.ok(captions.render(['你好']).includes('NOTE do not translate\nmeta'));
  assert.ok(captions.render(['你好']).includes('align:start\n你好'));
  const markdown=parseTextDocument('# Heading\n\n```js\nconst secret = 1;\n```\n- Item\n','note.md');
  assert.deepEqual(markdown.texts,['Heading','Item']);
  assert.equal(markdown.render(['标题','项目']),'# 标题\n\n```js\nconst secret = 1;\n```\n- 项目\n');
});

test('long text is fully translated in bounded batches without truncation', async () => {
  const calls=[];let id=0;
  const translator=createTextTranslator({makeRequestId:()=>String(++id),cancel:async()=>{},translate:async(texts,options)=>{calls.push({texts,options});return {translations:texts.map(text=>'['+text+']')};}});
  const source='A'.repeat(15001);
  const result=await translator.run(source,'long.txt',{});
  assert.ok(calls.every(call=>call.texts.length<=8 && call.texts.every(text=>text.length<=3000)));
  assert.equal(result.text.replace(/[\[\]]/g,''),source);
});

test('cancellation invalidates a late translation and cancels the active request', async () => {
  let finish, cancelled;
  const translator=createTextTranslator({makeRequestId:()=> 'request-a',cancel:async id=>{cancelled=id;},translate:()=>new Promise(resolve=>{finish=resolve;})});
  const task=translator.run('Hello','text.txt',{});
  await Promise.resolve();translator.stop();
  finish({translations:['迟到']});
  await assert.rejects(task,error=>error.name==='AbortError');
  assert.equal(cancelled,'request-a');
});

test('empty and mismatched output rejects the document instead of returning invisible success', async () => {
  for(const translations of [[],['   ']]) {
    const translator=createTextTranslator({makeRequestId:()=> 'a',cancel:async()=>{},translate:async()=>({translations})});
    await assert.rejects(translator.run('Hello','text.txt',{}),/译文/);
  }
  assert.throws(()=>parseTextDocument('not a timed caption','broken.srt'),/时间轴/);
});
