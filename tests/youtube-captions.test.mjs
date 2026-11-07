import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/src/youtube/captions.js';
import {readFileSync} from 'node:fs';
const parse=value=>{assert.equal(typeof api.parseTimedText,'function');return api.parseTimedText(value);};

test('JSON3 subtitles preserve text, order, timing and combined segment words',()=>{
  const cues=parse({events:[{tStartMs:2500,dDurationMs:1300,segs:[{utf8:'Second'}]},{tStartMs:0,dDurationMs:2000,segs:[{utf8:'Hello '},{utf8:'world'}]}]});
  assert.deepEqual(cues.map(cue=>[cue.start,cue.end,cue.text]),[[0,2,'Hello world'],[2.5,3.8,'Second']]);
});
test('JSON3 append events combine with the previous cue and infer missing durations',()=>{
  const cues=parse({events:[{tStartMs:0,segs:[{utf8:'Hello'}]},{tStartMs:500,aAppend:1,dDurationMs:500,segs:[{utf8:' world'}]},{tStartMs:2000,dDurationMs:1000,segs:[{utf8:'Next'}]}]});
  assert.equal(cues[0].text,'Hello world');assert.equal(cues[0].start,0);assert.ok(cues[0].end<=2);
});
test('XML subtitles decode entities and srv3 timings without treating text as HTML',()=>{
  assert.deepEqual(parse('<transcript><text start="1.2" dur="2.5">Tom &amp; Jerry &lt;3</text></transcript>').map(cue=>[cue.start,cue.end,cue.text]),[[1.2,3.7,'Tom & Jerry <3']]);
  assert.deepEqual(parse('<timedtext><body><p t="1200" d="800"><s>Hello</s><s> world</s></p></body></timedtext>').map(cue=>[cue.start,cue.end,cue.text]),[[1.2,2,'Hello world']]);
});
test('WebVTT parsing ignores notes/styles and retains multiline cue content',()=>{
  const text='WEBVTT\n\nNOTE generated\nignore me\n\nSTYLE\n::cue {color:red}\n\ncue-id\n00:00:01.000 --> 00:00:03.000 align:start\n<c.en>Hello</c>\nworld\n\n00:04.000 --> 00:05.000\nNext';
  const cues=parse(text);assert.equal(cues.length,2);assert.equal(cues[0].text,'Hello\nworld');assert.equal(cues[1].start,4);
});
test('invalid, negative and empty cues cannot produce translated empty successes',()=>{
  const cues=parse({events:[{tStartMs:-20,dDurationMs:100,segs:[{utf8:'bad'}]},{tStartMs:0,dDurationMs:100,segs:[{utf8:'  '}]},{tStartMs:100,dDurationMs:200,segs:[{utf8:'ok'}]}]});
  assert.equal(cues.length,1);assert.equal(cues[0].text,'ok');
  assert.throws(()=>parse('{broken'));assert.throws(()=>parse('not subtitles'));
});
test('track URLs are scoped to YouTube timedtext and the current video',()=>{
  parse({events:[]});
  const good={baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en',languageCode:'en',name:{simpleText:'English'}};
  assert.equal(api.validateTrack(good,'abcdef12345').languageCode,'en');
  for(const baseUrl of ['https://attacker.example/api/timedtext?v=abcdef12345','https://youtube.com/logout','http://www.youtube.com/api/timedtext?v=abcdef12345','https://youtube.com/api/timedtext?v=different01']) assert.equal(api.validateTrack({...good,baseUrl},'abcdef12345'),null);
  assert.equal(api.videoIdFromUrl('https://www.youtube.com/watch?v=abcdef12345'),'abcdef12345');
  assert.equal(api.videoIdFromUrl('https://www.youtube.com/shorts/abcdef12345'),'abcdef12345');
});

const asrFixtures=JSON.parse(readFileSync(new URL('./fixtures/youtube/asr-boundaries.json',import.meta.url),'utf8'));
for(const fixture of asrFixtures)test('ASR: '+fixture.name,()=>{
  const cues=api.parseTimedText(fixture.input,{kind:'asr'});
  assert.deepEqual(cues.map(cue=>[cue.start,cue.end,cue.text]),fixture.expected);
});
test('ASR does not split titles, initials, dotted abbreviations or decimals',()=>{
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:6000,segs:[{utf8:'Dr. A. Smith works in the U.S. and paid 3.14 dollars. Next.'}]}]},{kind:'asr'});
  assert.deepEqual(cues.map(c=>c.text),['Dr. A. Smith works in the U.S. and paid 3.14 dollars.','Next.']);
});
test('ASR punctuation-free speech stays bounded without losing or reordering words',()=>{
  const words=Array.from({length:800},(_,i)=>'word'+i),events=words.map((utf8,i)=>({tStartMs:i*400,dDurationMs:400,segs:[{utf8}]}));
  const cues=api.parseTimedText({events},{kind:'asr'});
  assert.deepEqual(cues.flatMap(c=>c.text.split(' ')),words);
  assert.ok(cues.length<100,'fragments should form phrases');
  assert.ok(cues.every(c=>c.text.length<=120&&c.end-c.start<=8.001));
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
});
test('ASR follows the reference 120-character target for long punctuation-free sentences',()=>{
  const text='The reason we decided to postpone the release was that the team needed more time to verify all the changes before making them available to users';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:7000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),text);assert.equal(cues.length,2);assert.ok(cues.every(c=>c.text.length<=120));
});

test('authored playback grouping joins the screenshot sentence without changing raw parsing',()=>{
  const first="There you'd find a bunch of particles\nwhizzing around",last='as fast as tiny bullets.';
  const input={events:[{tStartMs:259000,dDurationMs:2000,segs:[{utf8:first}]},{tStartMs:261000,dDurationMs:3000,segs:[{utf8:last}]}]};
  assert.equal(api.parseTimedText(input).length,2);
  const cues=api.parseTimedText(input,{groupPhrases:true});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[259,264,first+' '+last]]);
});

test('authored grouping preserves sentence, turn, silence and overlap boundaries',()=>{
  const cases=[
    [{start:0,end:2,text:'Already complete.'},{start:2,end:4,text:'A different sentence.'}],
    [{start:0,end:2,text:'First thought'},{start:3,end:5,text:'after a pause.'}],
    [{start:0,end:3,text:'First voice'},{start:2,end:4,text:'another voice.'}],
    [{start:0,end:2,text:'First thought'},{start:2,end:4,text:'Bob: another voice.'}],
    [{start:0,end:2,text:'First thought'},{start:2,end:4,text:'- Another voice.'}],
    [{start:0,end:2,text:'First thought'},{start:2,end:4,text:'[Music]'}],
    [{start:0,end:2,text:'Alice: First thought'},{start:2,end:4,text:'a continuation'}],
  ];
  for(const cues of cases){
    const original=structuredClone(cues);
    assert.deepEqual(api.groupAuthoredCues(cues).map(c=>[c.start,c.end,c.text]),original.map(c=>[c.start,c.end,c.text]));
    assert.deepEqual(cues,original);
  }
});

const selectTranslateCases=JSON.parse(readFileSync(new URL('./fixtures/youtube/selecttranslate-sentences.json',import.meta.url),'utf8'));
for(const fixture of selectTranslateCases.cases)test('SelectTranslate reference: '+fixture.name,()=>{
  const source='WEBVTT\n\n'+fixture.cues.map(cue=>{
    const time=seconds=>'00:'+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+'.000';
    return time(cue.start)+' --> '+time(cue.end)+'\n'+cue.text;
  }).join('\n\n');
  const cues=api.parseTimedText(source,{groupPhrases:true});
  assert.deepEqual(cues.map(c=>c.text),fixture.expected);
  assert.equal(cues[0].start,fixture.cues[0].start);assert.equal(cues.at(-1).end,fixture.cues.at(-1).end);
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
});

test('ASR replaces an overlapping growing caption window instead of repeating its prefix',()=>{
  const events=[
    {tStartMs:0,dDurationMs:3000,segs:[{utf8:'We are'}]},
    {tStartMs:1000,dDurationMs:3000,segs:[{utf8:'We are learning.'}]},
  ];
  const cues=api.parseTimedText({events},{kind:'asr'});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[0,4,'We are learning.']]);
});
