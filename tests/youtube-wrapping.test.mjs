import test from 'node:test';
import assert from 'node:assert/strict';
import {studyFixture} from './helpers/youtube-study.mjs';

// The controlled DOM does not perform layout. These tests exercise the real
// capture/parser/session/views and check their CSS reflow contract, not pixels.
const timedCaptions=[
  ['JSON3',JSON.stringify({events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'A short\n'},{utf8:'sentence'}]}]})],
  ['WebVTT','WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nA short\nsentence'],
  ['XML','<transcript><text start="0" dur="3">A short<br/>sentence</text></transcript>'],
];

for(const [format,body]of timedCaptions)test(`${format} caption breaks remain data while overlay and sidebar allow width-based reflow`,async t=>{
  const h=studyFixture();t.after(()=>h.manager.stop());h.tracks();
  const request=h.outbound.find(item=>item.kind==='fetch-track');
  h.message({kind:'captions',requestId:request.requestId,body});await h.flush();
  assert.equal(h.session().state.subtitlesList[0].text,'A short\nsentence');
  assert.equal(h.session().state.currentCaption.original,'A short\nsentence');
  assert.deepEqual(h.translations[0].texts,['A short\nsentence']);
  assert.equal(h.manager.openSidebar(),true);await h.flush();
  for(const host of [h.captionHost(),h.panel()])for(const [selector,text]of [
    ['.original-text','A short\nsentence'],['.translation-text','译:A short\nsentence'],
  ]){
    const node=host.shadowRoot.querySelector(selector);
    assert.equal(node.textContent,text,'presentation must not rewrite source or translated text');
    assert.equal(node.style['white-space'],'normal','caption line breaks must not be forced after reflow');
    assert.equal(node.style['overflow-wrap'],'anywhere','long unbroken text must still wrap in a narrow container');
  }
  assert.equal(h.captionHost().style['max-width'],'88%');
});

test('native DOM segment boundaries do not force overlay line breaks or alter native caption nodes',async t=>{
  let native,first,second;
  const h=studyFixture({onHarness:boundary=>{
    native=boundary.document.createElement('div');native.className='ytp-caption-window-container';
    first=boundary.document.createElement('span');first.className='ytp-caption-segment';first.textContent='A short';
    second=boundary.document.createElement('span');second.className='ytp-caption-segment';second.textContent='sentence';
    native.append(first,second);boundary.video.parentElement.append(native);
  }});t.after(()=>h.manager.stop());await h.flush();
  const firstText=first.firstChild,secondText=second.firstChild;
  assert.equal(h.session().state.currentCaption.original,'A short\nsentence');
  const original=h.captionHost().shadowRoot.querySelector('.original-text');
  assert.equal(original.textContent,'A short\nsentence');
  assert.equal(original.style['white-space'],'normal');
  assert.equal(original.style['overflow-wrap'],'anywhere');
  h.manager.sync();await h.flush();
  assert.strictEqual(first.firstChild,firstText);assert.strictEqual(second.firstChild,secondText);
  assert.equal(first.textContent,'A short');assert.equal(second.textContent,'sentence');
  assert.equal(native.style.visibility,'hidden');h.manager.stop();assert.equal(native.style.visibility,'');
});

test('native text-track line breaks use the same reflowable subtitle presentation',async t=>{
  const h=studyFixture({onHarness:boundary=>{
    boundary.video.textTracks=[{mode:'showing',language:'en',cues:[{startTime:0,endTime:3,text:'A short<br/>sentence'}]}];
  }});t.after(()=>h.manager.stop());await h.flush();
  assert.equal(h.session().state.subtitlesList[0].text,'A short\nsentence');
  for(const node of [h.captionHost().shadowRoot.querySelector('.original-text'),h.captionHost().shadowRoot.querySelector('.translation-text')]){
    assert.equal(node.style['white-space'],'normal');assert.equal(node.style['overflow-wrap'],'anywhere');
  }
});
