const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/subtitle-sidebar-harness.cjs');
const api = require('../dist/src/youtube/sidebar.js');

function fixture(options) {
  assert.equal(typeof api.createController, 'function', 'the isolated sidebar controller must be implemented');
  return createFixture(api, options);
}

test('the control opens a bilingual list beside YouTube without requesting captions while closed', async () => {
  const f = fixture({ translated: false });
  await f.flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.toggleButton().getAttribute('aria-expanded'), 'false');assert.equal(f.toggleButton().querySelector('[data-kuai-active-mark]').style.display,'none');assert.equal(f.toggleButton().querySelector('svg').getAttribute('data-icon'),'list');assert.equal(f.toggleButton().style.background,'transparent');
  assert.ok(!f.panel() || f.panel().hidden);
  f.emit(f.toggleButton(), 'click');
  await f.flush();
  assert.equal(f.toggleButton().getAttribute('aria-expanded'), 'true');assert.equal(f.toggleButton().querySelector('[data-kuai-active-mark]').style.display,'block');assert.equal(f.toggleButton().style.background,'transparent');
  assert.equal(f.panel().parentElement, f.right);
  assert.equal(f.panel().shadowRoot.querySelector('.timestamp').textContent, '0:00');
  assert.equal(f.panel().shadowRoot.querySelector('.original-text').textContent, 'Original 1');
  assert.equal(f.panel().shadowRoot.querySelector('.translation-text').textContent, 'Translated: Original 1');
  const roots = f.controller.getSelectionRoots(f.session.id);
  assert.ok(roots.length > 0);
  assert.ok(roots.every(root => root.matches('[data-kuai-subtitle-text]') && root.tagName !== 'BUTTON'));
  f.controller.stop();
});

test('timestamp buttons seek to their cue without starting a paused video', async () => {
  const f = fixture();
  f.controller.toggle(f.session.id, true); await f.flush();
  const buttons = f.panel().shadowRoot.querySelectorAll('.timestamp');
  const click = f.emit(buttons[1], 'click');
  assert.equal(f.video.currentTime, 10);
  assert.deepEqual(f.seeks, [{ id: 'video-one', time: 10 }]);
  assert.equal(f.video.playCount, 0);
  assert.equal(f.video.paused, true);
  assert.equal(click.defaultPrevented, true);
  f.controller.stop();
});

test('the current cue is highlighted and existing row text nodes survive translation notifications', async () => {
  const f = fixture();
  f.state.currentCaption = { start: 10, end: 18, original: 'Original 2', translation: 'Translation 2' };
  f.video.currentTime = 10;
  f.controller.toggle(f.session.id, true); await f.flush();
  const selected = f.panel().shadowRoot.querySelector('[aria-current="true"]');
  assert.equal(selected.querySelector('.original-text').textContent, 'Original 2');
  const original = selected.querySelector('.original-text').firstChild;
  f.cues[1].translation = 'Updated translation'; f.notify(); await f.flush();
  assert.equal(selected.querySelector('.original-text').firstChild, original);
  assert.equal(selected.querySelector('.translation-text').textContent, 'Updated translation');
  f.controller.stop();
});

test('manual reading exposes a return-to-current action that resumes following and restores list focus', async () => {
  const f = fixture({ count: 50 });
  f.state.currentCaption = { start: 0, end: 8, original: 'Original 1' };
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, list = root.querySelector('.subtitle-list');
  const follow = root.querySelector('.follow-current'), followState = root.querySelector('.follow-state');
  assert.equal(follow.hidden, true, 'following is a state, not an always-present action');
  assert.ok(followState?.textContent);
  const followingText = followState.textContent;
  f.emit(list, 'wheel', { deltaY: 320 }); list.scrollTop = 320; f.emit(list, 'scroll'); await f.flush();
  assert.equal(follow.hidden, false);
  assert.notEqual(followState.textContent, followingText);
  assert.equal(follow.getAttribute('aria-pressed'), null, 'returning to the current cue is an action rather than a toggle');
  assert.equal(follow.getAttribute('aria-label'), follow.textContent);
  f.state.currentCaption = { start: 200, end: 208, original: 'Original 21' }; f.video.currentTime = 200; f.notify(); await f.flush();
  assert.equal(list.scrollTop, 320);
  f.emit(follow, 'click'); await f.flush();
  assert.ok(list.scrollTop > 1000);
  assert.equal(root.querySelector('[aria-current="true"]').querySelector('.original-text').textContent, 'Original 21');
  assert.equal(follow.hidden, true);
  assert.equal(followState.textContent, followingText);
  assert.equal(f.document.activeElement, list, 'hiding the action must not strand keyboard focus');
  f.controller.stop();
});

test('video translation-only and reversed display settings keep both reading-list languages in source order', async () => {
  const f = fixture();
  f.config.subtitleStyle = { displayMode: 'translation_only', displayOrder: 'translation_on_top' };
  f.controller.toggle(f.session.id, true); await f.flush();
  const row = f.panel().shadowRoot.querySelector('.cue');
  const original = row.querySelector('.original-text'), translation = row.querySelector('.translation-text');
  assert.equal(original.hidden, false);
  assert.equal(translation.hidden, false);
  assert.deepEqual(row.querySelector('.cue-text').children.slice(0, 2), [original, translation]);
  assert.ok(Number(translation.style.order || 0) >= Number(original.style.order || 0), 'video display order must not visually reverse the reading list');
  assert.deepEqual(f.controller.getSelectionRoots(f.session.id).slice(0, 2), [original, translation]);
  f.controller.stop();
});

test('the learning mask reveals by pointer or keyboard without changing bilingual reading order or text nodes', async () => {
  const f = fixture();
  f.config.subtitleStyle = { hideTranslation: true, displayMode: 'translation_only', displayOrder: 'translation_on_top' };
  f.controller.toggle(f.session.id, true); await f.flush();
  const original = f.panel().shadowRoot.querySelector('.original-text');
  const translation = f.panel().shadowRoot.querySelector('.translation-text'), node = translation.firstChild;
  assert.equal(original.hidden, false);
  assert.match(translation.style.filter, /blur/); assert.equal(translation.getAttribute('tabindex'), '0');
  for (const [reveal, hide] of [['mouseenter', 'mouseleave'], ['focus', 'blur']]) {
    f.emit(translation, reveal); assert.equal(translation.style.filter, 'none');
    f.emit(translation, hide); assert.match(translation.style.filter, /blur/);
  }
  f.config.subtitleStyle.hideTranslation = false; f.notify(); await f.flush();
  assert.equal(translation.style.filter, 'none'); assert.equal(translation.getAttribute('tabindex'), null);
  assert.equal(translation.firstChild, node);
  f.controller.stop();
});

test('holding a selection freezes text and active-row changes until release', async () => {
  const f = fixture();
  f.state.currentCaption = { start: 0, end: 8, original: 'Original 1' };
  f.controller.toggle(f.session.id, true); await f.flush();
  const row = f.panel().shadowRoot.querySelector('.cue');
  const span = row.querySelector('.translation-text'), selectedText = span.firstChild;
  f.state.isSubtitleSelectionHeld = true; f.notify(); await f.flush();
  f.cues[0].translation = 'Late response';
  f.state.currentCaption = { start: 20, end: 28, original: 'Original 3' };
  f.video.currentTime = 20;
  f.notify(); await f.flush();
  assert.equal(span.firstChild, selectedText);
  assert.equal(span.textContent, 'Translation 1');
  assert.equal(row.getAttribute('aria-current'), 'true');
  f.state.isSubtitleSelectionHeld = false; f.notify(); await f.flush();
  assert.equal(span.textContent, 'Late response');
  assert.equal(row.getAttribute('aria-current'), null);
  assert.equal(f.panel().shadowRoot.querySelector('[aria-current="true"]').querySelector('.original-text').textContent, 'Original 3');
  f.controller.stop();
});

test('only geometrically visible pending rows are requested, using their actual cue references', async () => {
  const f = fixture({ count: 100, translated: false });
  f.cues[1].status = 'error'; f.cues[1].errorMessage = 'Provider unavailable';
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].batch, [f.cues[0], f.cues[2]]);
  assert.equal(f.requests[0].batch[0], f.state.subtitlesList[0]);
  assert.equal(f.cues[3].status, 'pending');
  assert.equal(f.cues[1].status, 'error');
  f.notify(); await f.flush();
  assert.equal(f.requests.length, 1, 'provider errors must not be retried by deep-watch updates');
  assert.match(f.panel().shadowRoot.querySelectorAll('.cue')[1].textContent, /translation.*unavailable|translation.*failed/i);
  f.controller.stop();
});

test('one translation batch remains in flight and closing stops the queue after it completes', async () => {
  const f = fixture({ count: 100, translated: false }); let finish;
  f.bridge.translateCues = (id, batch) => {
    f.requests.push({ id, batch });
    return new Promise(resolve => { finish = () => { batch[0].status = 'success'; batch[0].translation = 'Completed'; resolve(); }; });
  };
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 1);
  const list = f.panel().shadowRoot.querySelector('.subtitle-list');
  list.scrollTop = 800; f.emit(list, 'scroll'); f.notify(); await f.flush();
  assert.equal(f.requests.length, 1);
  f.emit(f.panel().shadowRoot.querySelector('.close-panel'), 'click');
  finish(); await f.flush();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.controller.getSelectionRoots(f.session.id), []);
  assert.ok(!f.panel() || f.panel().hidden);
  f.controller.stop();
});

test('replacement sessions discard old rows while retaining the page-level open preference', async () => {
  const f = fixture(); f.controller.toggle(f.session.id, true); await f.flush();
  const oldPanel = f.panel(), oldRoots = f.controller.getSelectionRoots(f.session.id);
  f.sessions.clear(); f.states.clear(); f.video.remove(); f.controlHost.remove();
  const video = f.document.createElement('video'); f.player.append(video);
  const control = f.document.createElement('span'); control.id = 'kuai-subtitle-button-video-two'; f.controls.append(control);
  const next = { id: 'video-two', rule: { id: 'youtube' }, video };
  f.sessions.set(next.id, next); f.states.set(next.id, { subtitlesList: [{ start: 0, end: 10, text: 'New video', translation: 'New translation', status: 'success' }], currentCaption: null });
  f.env.location.href = 'https://www.youtube.com/watch?v=two'; f.notify(); await f.flush();
  assert.equal(oldPanel.isConnected, false);
  assert.ok(oldRoots.every(root => !root.isConnected));
  assert.deepEqual(f.controller.getSelectionRoots('video-one'), []);
  const newPanel = f.document.getElementById('kuai-subtitle-sidebar-video-two');
  assert.ok(newPanel?.isConnected && !newPanel.hidden);
  assert.equal(newPanel.shadowRoot.querySelector('.original-text').textContent, 'New video');
  f.controller.stop();
});

test('long transcripts keep a bounded DOM window and can follow a distant active cue', async () => {
  const f = fixture({ count: 10000 });
  f.state.currentCaption = { start: 80000, end: 80008, original: 'Original 8001' };
  f.video.duration = 100000; f.video.currentTime = 80000;
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot;
  assert.ok(root.querySelectorAll('.cue').length < 100, 'opening must not build ten thousand cue rows');
  const current = root.querySelector('[aria-current="true"]');
  assert.equal(current.querySelector('.original-text').textContent, 'Original 8001');
  const text = current.querySelector('.original-text').firstChild;
  for (let i = 0; i < 4; i++) { f.notify(); await f.flush(); }
  assert.equal(current.querySelector('.original-text').firstChild, text);
  assert.ok(root.querySelectorAll('.cue').length < 100);
  f.controller.stop();
});

test('subtitle markup stays text and invalid or blank timeline entries are omitted', async () => {
  const f = fixture();
  f.state.subtitlesList = [
    { start: NaN, end: 1, text: 'Invalid' }, { start: 1, end: 0, text: 'Backwards' },
    { start: 0, end: 1, text: '  ' },
    { start: 3605, end: 3610, text: '<img src=x onerror=alert(1)>', translation: '<script>bad()</script>', status: 'success' },
  ];
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot;
  assert.equal(root.querySelectorAll('.cue').length, 1);
  assert.equal(root.querySelector('.timestamp').textContent, '1:00:05');
  assert.equal(root.querySelector('.original-text').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(root.querySelectorAll('img,script').length, 0);
  f.controller.stop();
});

test('teardown removes controls and subscriptions while BFCache pagehide preserves them', async () => {
  const f = fixture(); f.controller.toggle(f.session.id, true); await f.flush();
  f.env.dispatchEvent({ type: 'pagehide', persisted: true }); await f.flush();
  assert.ok(f.panel()?.isConnected);
  f.env.dispatchEvent({ type: 'pagehide', persisted: false }); await f.flush();
  assert.equal(f.panel(), null);
  assert.equal(f.toggleButton(), undefined);
  assert.equal(f.subscribers.size, 0);
  assert.deepEqual(f.controller.getSelectionRoots(f.session.id), []);
});

test('a hold from selecting video captions freezes the list without leaving follow mode', async () => {
  const f = fixture({ count: 50 });
  f.state.currentCaption = { start: 0, end: 8, original: 'Original 1' };
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, follow = root.querySelector('.follow-current'), list = root.querySelector('.subtitle-list');
  f.state.isSubtitleSelectionHeld = true; f.notify(); await f.flush();
  f.state.isSubtitleSelectionHeld = false;
  f.state.currentCaption = { start: 200, end: 208, original: 'Original 21' }; f.video.currentTime = 200; f.notify(); await f.flush();
  assert.equal(follow.hidden, true);
  assert.ok(list.scrollTop > 1000);
  assert.equal(root.querySelector('[aria-current="true"]').querySelector('.original-text').textContent, 'Original 21');
  f.controller.stop();
});

test('a failed timeline explains itself and can be retried from the list', async () => {
  const f = fixture({ count: 0 }), retries = [];
  f.bridge.retryTimeline = id => { retries.push(id); f.state.timelineFailed = false; };
  f.state.timelineFailed = true;
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, status = root.querySelector('.panel-status'), retry = root.querySelector('.retry-timeline');
  assert.match(status.textContent, /Couldn't load/); assert.equal(retry.hidden, false); assert.equal(retry.textContent, 'Retry');
  f.emit(retry, 'click'); await f.flush();
  assert.deepEqual(retries, ['video-one']); assert.equal(retry.hidden, true); assert.match(status.textContent, /Loading/);
  f.controller.stop();
});

test('searching filters the reading list by source or translation and Escape clears it', async () => {
  const f = fixture({ count: 30 });
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, search = root.querySelector('.search');
  assert.equal(search.getAttribute('aria-label'), 'Search subtitles');
  search.value = 'Translation 2'; f.emit(search, 'input'); await f.flush();
  const texts = () => root.querySelectorAll('.original-text').map(node => node.textContent);
  assert.deepEqual(texts().slice(0, 3), ['Original 2', 'Original 20', 'Original 21']);
  assert.equal(root.querySelector('.cue-count').textContent, '11 matches');
  const typing = f.emit(search, 'keydown', { key: 'k' }); assert.equal(typing.propagationStopped, true, 'page shortcuts never see typing');
  search.value = 'nothing'; f.emit(search, 'input'); await f.flush();
  assert.equal(root.querySelector('.panel-status').textContent, 'No matching subtitles');
  f.emit(search, 'keydown', { key: 'Escape' }); await f.flush();
  assert.equal(search.value, ''); assert.equal(root.querySelector('.cue-count').textContent, '30 captions');
  f.controller.stop();
});

test('the list view shows both languages, only the source, or only translations without changing text nodes', async () => {
  const f = fixture({ translated: false });
  f.cues[0].translation = 'Translation 1'; f.cues[0].status = 'success';
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, button = value => root.querySelector(`[data-view="${value}"]`);
  const rows = () => root.querySelectorAll('.cue');
  const requests = f.requests.length;
  f.emit(button('translation'), 'click'); await f.flush();
  assert.equal(button('translation').getAttribute('aria-pressed'), 'true');
  assert.equal(rows()[0].querySelector('.original-text').hidden, true);
  assert.equal(rows()[0].querySelector('.translation-text').hidden, false);
  f.emit(button('original'), 'click'); await f.flush();
  assert.equal(rows()[0].querySelector('.original-text').hidden, false);
  assert.equal(rows()[0].querySelector('.translation-text').hidden, true);
  f.cues.slice(1).forEach(cue => { cue.status = 'pending'; cue.translation = ''; }); f.notify(); await f.flush();
  assert.equal(f.requests.length, requests, 'the source-only view requests no translations');
  f.emit(button('both'), 'click'); await f.flush();
  assert.equal(rows()[0].querySelector('.translation-text').hidden, false);
  f.controller.stop();
});

test('wheel and touch scrolling in the list never reach the player or its fullscreen grid', async () => {
  const f = fixture({ count: 30 });
  f.document.fullscreenElement = f.player;
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.panel().parentElement, f.player); assert.equal(f.panel().dataset.placement, 'drawer');
  let reached = 0; f.player.addEventListener('wheel', () => reached++); f.player.addEventListener('touchmove', () => reached++);
  const list = f.panel().shadowRoot.querySelector('.subtitle-list');
  f.emit(list, 'wheel', { deltaY: 120 }); f.emit(list, 'touchmove');
  f.emit(f.panel().shadowRoot.querySelector('.panel-title'), 'wheel', { deltaY: 120 });
  assert.equal(reached, 0);
  f.controller.stop();
});
