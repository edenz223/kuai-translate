import test from 'node:test';
import assert from 'node:assert/strict';
let api={};try{api=await import('../dist/src/youtube/captions.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
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

const {readFileSync}=await import('node:fs');
const asrFixtures=JSON.parse(readFileSync(new URL('./fixtures/youtube/asr-boundaries.json',import.meta.url),'utf8'));
for(const fixture of asrFixtures)test('ASR: '+fixture.name,()=>{
  const cues=api.parseTimedText(fixture.input,{kind:'asr'});
  assert.deepEqual(cues.map(cue=>[cue.start,cue.end,cue.text]),fixture.expected);
});
test('authored JSON3 retains its separate events, line breaks and durations even with segment offsets',()=>{
  const input={events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'Dr. Smith\npaid 3.14.',tOffsetMs:0}]},{tStartMs:1000,dDurationMs:3000,segs:[{utf8:'Next line.',tOffsetMs:0}]}]};
  assert.deepEqual(api.parseTimedText(input).map(c=>[c.start,c.end,c.text]),[[0,3,'Dr. Smith\npaid 3.14.'],[1,4,'Next line.']]);
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
test('ASR keeps repeated speech at different times and music/speaker boundaries',()=>{
  const events=['go go','go go','[Music]','Alice: Hello','Bob: Hi'].map((utf8,i)=>({tStartMs:i*1000,dDurationMs:1000,segs:[{utf8}]}));
  assert.deepEqual(api.parseTimedText({events},{kind:'asr'}).map(c=>c.text),['go go go go','[Music]','Alice: Hello','Bob: Hi']);
});
test('validated ASR URL metadata identifies automatic tracks when explicit kind is absent',()=>{
  assert.equal(api.validateTrack({baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en&kind=asr'},'abcdef12345').kind,'asr');
});

test('ASR overlapping long event windows retain unique words in monotonic speech order',()=>{
  const input={events:[{tStartMs:0,dDurationMs:6000,segs:[{utf8:'First words.'}]},{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Next words.'}]}]};
  const cues=api.parseTimedText(input,{kind:'asr'});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[0,1,'First words.'],[1,3,'Next words.']]);
});
test('ASR equal-offset distinct segments retain every word without overlapping sentences',()=>{
  const input={events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'Hello.',tOffsetMs:0},{utf8:' Next sentence.',tOffsetMs:0}]}]};
  const cues=api.parseTimedText(input,{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),'Hello. Next sentence.');
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
});
test('ASR overlapping rolling lines drop only exact suffix-prefix lines',()=>{
  const input={events:[{tStartMs:0,dDurationMs:2000,wWinId:1,segs:[{utf8:'first line\nsecond line'}]},{tStartMs:1000,dDurationMs:2000,wWinId:1,segs:[{utf8:'second line\nthird line.'}]}]};
  assert.equal(api.parseTimedText(input,{kind:'asr'}).map(c=>c.text).join(' ').replace(/\s+/g,' '),'first line second line third line.');
});

test('ASR segment boundaries cannot add spaces inside a source word or lose authored segment whitespace',()=>{
  const input={events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'Inter',tOffsetMs:0},{utf8:'national  text.',tOffsetMs:500}]}]};
  assert.equal(api.parseTimedText(input,{kind:'asr'})[0].text,'International  text.');
});
test('ASR segment overlap never deduplicates different windows or different timestamps',()=>{
  const input={events:[{tStartMs:0,dDurationMs:2000,wWinId:1,segs:[{utf8:'go',tOffsetMs:0}]},{tStartMs:0,dDurationMs:2000,wWinId:2,segs:[{utf8:'go',tOffsetMs:0}]},{tStartMs:2000,dDurationMs:1000,wWinId:1,segs:[{utf8:'go',tOffsetMs:0}]}]};
  assert.equal(api.parseTimedText(input,{kind:'asr'}).map(c=>c.text).join(' '),'go go go');
});

test('ASR keeps speaker turns and music labels separated inside a multiline event',()=>{
  const input={events:[{tStartMs:0,dDurationMs:5000,segs:[{utf8:'Alice: Hello\nBob: Hi\n[Soft music]\nThanks.'}]}]};
  assert.deepEqual(api.parseTimedText(input,{kind:'asr'}).map(c=>c.text),['Alice: Hello','Bob: Hi','[Soft music]','Thanks.']);
});

test('ASR preserves whitespace-only segments between words',()=>{
  const input={events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'Hello'},{utf8:' '},{utf8:'world.'}]}]};
  assert.equal(api.parseTimedText(input,{kind:'asr'})[0].text,'Hello world.');
});
test('ASR timed multiline repetition at distinct anchors is actual repeated speech',()=>{
  const input={events:[{tStartMs:0,dDurationMs:4000,wWinId:1,segs:[{utf8:'Go\nGo',tOffsetMs:0}]},{tStartMs:2000,dDurationMs:4000,wWinId:1,segs:[{utf8:'Go\nGo',tOffsetMs:0}]}]};
  assert.deepEqual(api.parseTimedText(input,{kind:'asr'}).flatMap(c=>c.text.split(/\s+/)),['Go','Go','Go','Go']);
});
test('ASR partial offsets retain source order and text around a late anchor',()=>{
  const input={events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:'The first sentence.',tOffsetMs:8000},{utf8:' The second sentence.'}]}]};
  const cues=api.parseTimedText(input,{kind:'asr'});
  assert.deepEqual(cues.map(c=>c.text),['The first sentence.','The second sentence.']);
  assert.equal(cues[0].start,8);assert.equal(cues.at(-1).end,10);
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
});
test('ASR decodes escaped literal markup once just like authored captions',()=>{
  const input={events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'Use &lt;token&gt; here.'}]}]};
  assert.equal(api.parseTimedText(input,{kind:'asr'})[0].text,'Use <token> here.');
  assert.equal(api.parseTimedText(input)[0].text,'Use <token> here.');
});
test('ASR length targets cannot split a lexical word across timed segments',()=>{
  const input={events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:'Inter',tOffsetMs:0},{utf8:'national',tOffsetMs:9000}]}]};
  assert.deepEqual(api.parseTimedText(input,{kind:'asr'}).map(c=>[c.start,c.end,c.text]),[[0,10,'International']]);
});

test('ASR preserves decoded whitespace-only segments and normalizes real formatting once',()=>{
  for(const separator of ['&nbsp;','&#32;',' ']){
    const input={events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'<b>Hello</b>',tOffsetMs:0},{utf8:separator,tOffsetMs:500},{utf8:'world &amp; all.',tOffsetMs:1000}]}]};
    assert.equal(api.parseTimedText(input,{kind:'asr'})[0].text,'Hello world & all.');
  }
});
test('ASR contradictory offsets retain source text in positive monotonic intervals',()=>{
  const input={events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:'first ',tOffsetMs:8000},{utf8:'second ',tOffsetMs:2000},{utf8:'third.'}]}]};
  const cues=api.parseTimedText(input,{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),'first second third.');
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
});
test('ASR character and duration targets both respect one word spanning timed segments',()=>{
  const first='a'.repeat(100),second='b'.repeat(100);
  const input={events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:first,tOffsetMs:0},{utf8:second,tOffsetMs:9000}]}]};
  assert.deepEqual(api.parseTimedText(input,{kind:'asr'}).map(c=>[c.start,c.end,c.text]),[[0,10,first+second]]);
});


test('ASR balances a punctuation-free sentence instead of leaving a short trailing cue',()=>{
  const text='one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:7000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.length,2);assert.equal(cues.map(c=>c.text).join(' '),text);
  assert.ok(cues.every(c=>c.text.length>=60&&c.text.length<=120),'both phrases should carry a useful balanced share');
  assert.ok(Math.abs(cues[0].text.length-cues[1].text.length)<=16);
  assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,7);
  assert.ok(cues[0].end<=cues[1].start);
});
test('ASR prefers a nearby source-cue boundary over arbitrary word spacing',()=>{
  const first='Careful readers keep the source words together';
  const second='while a second fragment explains why balanced phrases are more comfortable to follow.';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:first}]},{tStartMs:2000,dDurationMs:4000,segs:[{utf8:second}]}]},{kind:'asr'});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[0,2,first],[2,6,second]]);
});
test('ASR sees the complete natural phrase across uneven source events',()=>{
  const first='After reading about this online and troubleshooting it a few times,';
  const second='I realized that this wasn’t even a Graphene issue but more of an Android issue itself.';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:200,segs:[{utf8:'After'}]},{tStartMs:200,dDurationMs:6800,segs:[{utf8:' reading about this online and troubleshooting it a few times, '+second}]}]},{kind:'asr'});
  assert.deepEqual(cues.map(c=>c.text),[first,second]);
  assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,7);
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
});
test('ASR clause balancing does not break a number across JSON segment boundaries',()=>{
  const first='The team carefully checked all the estimates and recorded 1,';
  const second='000 entries before reviewing the remaining notes with their colleagues and confirming the final report.';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:7000,segs:[{utf8:first,tOffsetMs:0},{utf8:second,tOffsetMs:3000}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),first+second);
  assert.ok(cues.some(c=>c.text.includes('1,000')),'numeric punctuation is not a clause boundary');
  assert.ok(cues.every(c=>c.text.length<=120));
});
test('ASR balances long CJK speech at a clause mark without adding spaces',()=>{
  const first='先检查原文中的重要信息'.repeat(5)+'；';
  const second='再核对译文是否完整准确'.repeat(6)+'。';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:6000,segs:[{utf8:first+second}]}]},{kind:'asr'});
  assert.deepEqual(cues.map(c=>c.text),[first,second]);
  assert.equal(cues.map(c=>c.text).join(''),first+second);
});
test('ASR decimal punctuation split across timed segments is not a sentence break',()=>{
  const first='The team carefully checked all the estimates and recorded 3.';
  const second='14 units before reviewing the remaining notes with their colleagues and confirming the final report.';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:7000,segs:[{utf8:first,tOffsetMs:0},{utf8:second,tOffsetMs:3000}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),first+second);
  assert.ok(cues.some(c=>c.text.includes('3.14')));
});
test('ASR retains numeric sentence-like text according to native sentence segmentation',()=>{
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:5000,segs:[{utf8:'The count is 3. 14 people came later.'}]}]},{kind:'asr'});
  assert.deepEqual(cues.map(c=>c.text),['The count is 3. 14 people came later.']);
});
test('ASR large punctuation-free phrases stay text-bounded without argument-stack overflow',()=>{
  const text='甲'.repeat(150000);
  const body=JSON.stringify({events:[{tStartMs:0,dDurationMs:1500000000,segs:[{utf8:text}]}]});
  const cues=api.parseTimedText(body,{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(''),text);assert.ok(cues.every(c=>c.text.length<=120));
  assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,1500000);
});
test('ASR parser retains its global cue count cap',()=>{
  const events=Array.from({length:50001},(_,index)=>({tStartMs:index*100,dDurationMs:100,segs:[{utf8:'Hello.'}]}));
  const cues=api.parseTimedText({events},{kind:'asr'});
  assert.equal(cues.length,50000);assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,5000);
});
test('ASR ordinary spoken counting remains bounded without losing numeric words',()=>{
  for(const first of [1,100]){
    const words=Array.from({length:60},(_,index)=>String(index+first)),text=words.join(' ');
    const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:12000,segs:[{utf8:text}]}]},{kind:'asr'});
    assert.deepEqual(cues.flatMap(c=>c.text.split(' ')),words);
    assert.ok(cues.length>1);
    assert.ok(cues.every(c=>c.text.length<=120&&c.end-c.start<=8.001));
    assert.ok(cues.every((c,index)=>c.end>c.start&&(!index||c.start>=cues[index-1].end)));
    assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,12);
  }
});
test('ASR keeps a fullwidth-comma number intact when its comma is a separate token',()=>{
  for(const number of ['1，000','1，000，000','1,000.50','1.000,50']){
    const text='The team carefully checked all the estimates and recorded '+number+' entries before reviewing the remaining notes with their colleagues and confirming the final report.';
    const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:12000,segs:[{utf8:text}]}]},{kind:'asr'});
    assert.equal(cues.map(c=>c.text).join(' '),text);
    assert.ok(cues.some(c=>c.text.includes(number)));
    assert.ok(cues.every(c=>c.text.length<=120&&c.end-c.start<=8.001));
    assert.ok(cues.every((c,index)=>c.end>c.start&&(!index||c.start>=cues[index-1].end)));
  }
});
test('ASR retains valid spaced digit grouping while balancing neighboring words',()=>{
  const prefix='Many readers check the available details carefully before recording a total of ';
  const suffix=' records and making sure that the resulting translation preserves every detail.';
  for(const number of ['1 000','1\u00a0000','1\u202f000','1 000 000.50']){
    const text=prefix+number+suffix,cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:12000,segs:[{utf8:text}]}]},{kind:'asr'});
    assert.equal(cues.map(c=>c.text).join(' '),text);
    assert.ok(cues.some(c=>c.text.includes(number)));
  }
});
test('ASR fullwidth-comma counting selects clause boundaries instead of one numeric lock',()=>{
  const text=Array.from({length:60},(_,index)=>String(index+1)).join('，');
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:12000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(''),text);assert.ok(cues.length>1);
  assert.ok(cues.every(c=>c.text.length<=120&&c.end-c.start<=8.001));
  assert.ok(cues.every((c,index)=>c.end>c.start&&(!index||c.start>=cues[index-1].end)));
  assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,12);
});

test('ASR retains a slow short sentence instead of splitting its subject from its predicate',()=>{
  const text='What I want you to remember is that the result depends on how carefully you check the data';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[0,10,text]]);
});
test('ASR follows the reference 120-character target for long punctuation-free sentences',()=>{
  const text='The reason we decided to postpone the release was that the team needed more time to verify all the changes before making them available to users';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:7000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),text);assert.equal(cues.length,2);assert.ok(cues.every(c=>c.text.length<=120));
});
test('ASR long clauses beyond the reference limit remain bounded without losing text',()=>{
  const first='After carefully reviewing the source material and checking every reported issue with the people who originally collected the data,';
  const second='we decided to repeat the experiment using a separate set of measurements.';
  assert.ok(first.length>120&&first.length<=160);
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:9000,segs:[{utf8:first+' '+second}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),first+' '+second);assert.ok(cues.every(c=>c.text.length<=120));
});
test('ASR long English speech follows reference lexical cut limits without losing words',()=>{
  const text='The team examined every reported issue and collected useful measurements in order to understand what had happened and prepare a clear explanation for everyone involved';
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:14000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),text);assert.ok(cues.length>1);
  assert.ok(cues.every(c=>c.text.length<=120));
});
test('ASR forced Chinese cuts retain complete lexical words',()=>{
  const text='数据'.repeat(91);
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:14000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(''),text);assert.ok(cues.length>1);
  assert.ok(cues.every(c=>/^(数据)+$/.test(c.text)));
  assert.ok(cues.every(c=>c.text.length<=160&&c.end-c.start<=10.001));
});

test('ASR soft extensions remain bounded across long speech with repeated clause markers',()=>{
  const text=Array.from({length:80},()=> 'We examine the data carefully because the result matters to every person on the team').join(' ');
  const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:180000,segs:[{utf8:text}]}]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' '),text);assert.ok(cues.length>1);
  assert.ok(cues.every(c=>c.text.length<=160&&c.end-c.start<=10.001));
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
  assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,180);
});

test('ASR short phrases are never split solely because they last eighteen seconds',()=>{
  for(const text of ['in order to','in order to finish','as well as the result']){
    const cues=api.parseTimedText({events:[{tStartMs:0,dDurationMs:18000,segs:[{utf8:text}]}]},{kind:'asr'});
    assert.equal(cues.map(c=>c.text).join(' '),text);
    assert.equal(cues.length,1);assert.equal(cues[0].start,0);assert.equal(cues[0].end,18);
    assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||c.start>=cues[i-1].end)));
  }
});

test('authored playback grouping joins the screenshot sentence without changing raw parsing',()=>{
  const first="There you'd find a bunch of particles\nwhizzing around",last='as fast as tiny bullets.';
  const input={events:[{tStartMs:259000,dDurationMs:2000,segs:[{utf8:first}]},{tStartMs:261000,dDurationMs:3000,segs:[{utf8:last}]}]};
  assert.equal(api.parseTimedText(input).length,2);
  const cues=api.parseTimedText(input,{groupPhrases:true});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[259,264,first+' '+last]]);
});
test('authored phrase grouping applies to fetched VTT and XML captions too',()=>{
  const vtt='WEBVTT\n\n00:00.000 --> 00:02.000\nThere are particles\n\n00:02.000 --> 00:04.000\nmoving very quickly.';
  const xml='<transcript><text start="0" dur="2">There are particles</text><text start="2" dur="2">moving very quickly.</text></transcript>';
  for(const source of [vtt,xml])assert.deepEqual(api.parseTimedText(source,{groupPhrases:true}).map(c=>[c.start,c.end,c.text]),[[0,4,'There are particles moving very quickly.']]);
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
test('authored grouping keeps abbreviations and CJK adjacency while clearing stale translations',()=>{
  const source=[{start:0,end:1,text:'Dr.',translation:'old',status:'success'},{start:1,end:2,text:'Smith works here.'}];
  assert.deepEqual(api.groupAuthoredCues(source).map(c=>[c.text,c.translation,c.status]),[['Dr. Smith works here.','','pending']]);
  assert.equal(source[0].text,'Dr.');
  assert.deepEqual(api.groupAuthoredCues([{start:0,end:1,text:'我们正在'},{start:1,end:3,text:'检查数据。'}]).map(c=>c.text),['我们正在检查数据。']);
});

test('authored Korean cue joins retain the word separator',()=>{
  const cues=api.groupAuthoredCues([{start:0,end:2,text:'우리는 데이터를'},{start:2,end:4,text:'분석합니다.'}]);
  assert.deepEqual(cues.map(c=>c.text),['우리는 데이터를 분석합니다.']);
});
test('VTT voice annotations keep speaker turns separate during playback grouping',()=>{
  const source='WEBVTT\n\n00:00.000 --> 00:02.000\n<v Alice>I was thinking\n\n00:02.000 --> 00:04.000\n<v Bob>That will not work.';
  const cues=api.parseTimedText(source,{groupPhrases:true});
  assert.deepEqual(cues.map(c=>[c.start,c.end,c.text]),[[0,2,'I was thinking'],[2,4,'That will not work.']]);
  const sameVoice=api.parseTimedText(source.replace('<v Bob>','<v Alice>'),{groupPhrases:true});
  assert.deepEqual(sameVoice.map(c=>c.text),['I was thinking That will not work.']);
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
test('ASR growing-window cleanup does not remove repeated or independent speech',()=>{
  for(const [first,second,wWinId] of [['go go','go go',0],['one','ones',0],['We are','We are learning.',1]]){
    const cues=api.parseTimedText({events:[
      {tStartMs:0,dDurationMs:3000,wWinId:0,segs:[{utf8:first}]},
      {tStartMs:1000,dDurationMs:3000,wWinId,segs:[{utf8:second}]},
    ]},{kind:'asr'});
    assert.equal(cues.map(c=>c.text).join(' '),first+' '+second);
  }
});

test('native sentence boundaries inside compact Latin text never absorb the next subject',()=>{
  for(const punctuation of ['!','?','!”']){
    const first='This is the first question'+punctuation,last='Another sentence follows.',text=first+last;
    for(const cues of [
      api.groupAuthoredCues([{start:0,end:10,text}]),
      api.parseTimedText({events:[{tStartMs:0,dDurationMs:10000,segs:[{utf8:text}]}]},{kind:'asr'}),
    ]){
      assert.deepEqual(cues.map(c=>c.text),[first,last]);
      assert.ok(cues[0].end<=cues[1].start);assert.equal(cues[0].start,0);assert.equal(cues[1].end,10);
    }
  }
});

test('SelectTranslate numeric joins reconnect a thousands group split across source cues',()=>{
  for(const comma of [',','，']){
    const first='The sample contained 1'+comma,last='000 entries altogether.';
    const cues=api.groupAuthoredCues([{start:0,end:2,text:first},{start:2,end:4,text:last}]);
    assert.deepEqual(cues.map(c=>c.text),['The sample contained 1'+comma+'000 entries altogether.']);
  }
  const counting=api.groupAuthoredCues([{start:0,end:2,text:'The list is 100'},{start:2,end:4,text:'101 102.'}]);
  assert.equal(counting.map(c=>c.text).join(' '),'The list is 100 101 102.');
});

test('ASR growing multiline windows retain the earlier lines when replacing their prefix',()=>{
  const cues=api.parseTimedText({events:[
    {tStartMs:0,dDurationMs:3000,segs:[{utf8:'first line\nsecond line'}]},
    {tStartMs:1000,dDurationMs:3000,segs:[{utf8:'first line\nsecond line\nthird line.'}]},
  ]},{kind:'asr'});
  assert.equal(cues.map(c=>c.text).join(' ').replace(/\s+/g,' '),'first line second line third line.');
  assert.equal(cues[0].start,0);assert.equal(cues.at(-1).end,4);
});
