const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./helpers/subtitle-sidebar-harness.cjs');
const modulePath = path.resolve(__dirname, '../dist/src/youtube/sidebar.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};

function fixture(options) {
  assert.equal(typeof api.createController, 'function', 'the isolated sidebar controller must be implemented');
  return createFixture(api, options);
}

test('the control opens a bilingual list beside YouTube without requesting captions while closed', async () => {
  const f = fixture({ translated: false });
  await f.flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.toggleButton().getAttribute('aria-expanded'), 'false');assert.equal(f.toggleButton().style.opacity,'.55');assert.equal(f.toggleButton().style.background,'transparent');
  assert.ok(!f.panel() || f.panel().hidden);
  f.emit(f.toggleButton(), 'click');
  await f.flush();
  assert.equal(f.toggleButton().getAttribute('aria-expanded'), 'true');assert.equal(f.toggleButton().style.opacity,'1');assert.equal(f.toggleButton().style.background,'transparent');
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

test('programmatic following remains active when its scroll event is delivered', async () => {
  const f = fixture({ count: 50 });
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, list = root.querySelector('.subtitle-list');
  f.video.currentTime = 200; f.emit(f.video, 'timeupdate'); await f.flush();
  const firstTop = list.scrollTop;
  f.emit(list, 'scroll'); await f.flush();
  assert.equal(root.querySelector('.follow-current').hidden, true);
  f.video.currentTime = 300; f.emit(f.video, 'timeupdate'); await f.flush();
  assert.ok(list.scrollTop > firstTop);
  assert.equal(root.querySelector('[aria-current="true"]').querySelector('.original-text').textContent, 'Original 31');
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

test('video typography and background changes leave reading styles, row identity and manual position unchanged', async () => {
  const f = fixture({ count: 50 });
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, list = root.querySelector('.subtitle-list');
  f.emit(list, 'wheel'); list.scrollTop = 320; f.emit(list, 'scroll'); await f.flush();
  const row = root.querySelectorAll('.cue')[4], original = row.querySelector('.original-text');
  const translation = row.querySelector('.translation-text'), body = row.querySelector('.cue-text');
  const nodes = [original.firstChild, translation.firstChild];
  const properties = ['color', 'font-size', 'font-weight', 'font-family', 'text-shadow', 'background-color', 'padding', 'border-radius'];
  const styles = () => [original, translation, body].map(node => properties.map(property => node.style[property]));
  const before = styles(), requests = f.requests.length;
  for (const change of [
    { sourceColor: '#ff0000', targetColor: '#00ff00', sourceFontSize: 72, targetFontSize: 12, sourceWeight: 900, targetWeight: 100, fontFamily: 'monospace', sourceStroke: 'bold', targetStroke: 'shadow45', backgroundColor: '#0000ff', backgroundOpacity: 100 },
    { sourceColor: '#ffffff', targetColor: '#000000', sourceFontSize: 12, targetFontSize: 72, sourceWeight: 100, targetWeight: 900, fontFamily: 'serif', sourceStroke: 'none', targetStroke: 'none', backgroundColor: '#ffffff', backgroundOpacity: 0 },
  ]) {
    f.config.subtitleStyle = change; f.notify(); await f.flush();
    assert.deepEqual(styles(), before);
    assert.equal(original.firstChild, nodes[0]); assert.equal(translation.firstChild, nodes[1]);
    assert.equal(row.isConnected, true); assert.equal(list.scrollTop, 320);
    assert.equal(f.requests.length, requests);
  }
  f.controller.stop();
});

test('reading measurements preserve the visible cue when rows above it grow', async () => {
  const f = fixture({ count: 50 });
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, list = root.querySelector('.subtitle-list');
  f.emit(list, 'wheel'); list.scrollTop = 320; f.emit(list, 'scroll'); await f.flush();
  const rows = root.querySelectorAll('.cue'), visible = rows[4];
  const before = visible.getBoundingClientRect().top;
  rows[0]._height = 140;
  f.cues[0].translation = 'A translation with additional wrapped lines'; f.notify(); await f.flush();
  assert.equal(list.scrollTop, 380);
  assert.equal(visible.getBoundingClientRect().top, before);
  assert.equal(visible.isConnected, true);
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

test('video display changes during a held selection preserve both text roots and the reader position on release', async () => {
  const f = fixture({ count: 50 });
  f.controller.toggle(f.session.id, true); await f.flush();
  const root = f.panel().shadowRoot, list = root.querySelector('.subtitle-list');
  f.emit(list, 'wheel'); list.scrollTop = 320; f.emit(list, 'scroll'); await f.flush();
  const row = root.querySelectorAll('.cue')[4], original = row.querySelector('.original-text'), translation = row.querySelector('.translation-text');
  const originalText = original.firstChild, selectedText = translation.firstChild;
  f.state.isSubtitleSelectionHeld = true; f.notify(); await f.flush();
  f.config.subtitleStyle = { displayMode: 'translation_only', displayOrder: 'translation_on_top', sourceFontSize: 72, targetFontSize: 72 };
  f.cues[4].translation = 'Translation received during selection'; f.video.currentTime = 400;
  f.notify(); await f.flush();
  assert.equal(original.firstChild, originalText); assert.equal(translation.firstChild, selectedText);
  assert.equal(list.scrollTop, 320); assert.equal(row.isConnected, true);
  f.state.isSubtitleSelectionHeld = false; f.notify(); await f.flush();
  assert.equal(original.hidden, false); assert.equal(original.firstChild, originalText);
  assert.equal(translation.textContent, 'Translation received during selection');
  assert.equal(list.scrollTop, 320);
  assert.ok(f.controller.getSelectionRoots(f.session.id).includes(original));
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

test('a provider batch limit leaves unattempted visible cues eligible for the next batch', async () => {
  const f = fixture({ translated: false });
  f.bridge.translateCues = async (id, batch) => {
    f.requests.push({ id, batch });
    batch[0].status = 'success'; batch[0].translation = 'One at a time';
  };
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests.map(request => request.batch[0].start), [0, 10, 20]);
  assert.equal(f.cues[3].status, 'pending');
  f.controller.stop();
});

test('selection hold stops new row requests and release resumes eligible visible rows', async () => {
  const f = fixture({ translated: false });
  f.state.isSubtitleSelectionHeld = true;
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 0);
  f.state.isSubtitleSelectionHeld = false; f.notify(); await f.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.cues[0].status, 'success');
  f.controller.stop();
});

test('a panel outside the browser viewport does not translate until it becomes visible', async () => {
  const f = fixture({ translated: false }); f.document.listTop = 1000;
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 0);
  f.document.listTop = 140; f.env.dispatchEvent({ type: 'resize' }); await f.flush();
  assert.equal(f.requests.length, 1);
  f.controller.stop();
});

test('disabled subtitles and a disabled native caption synchronizer do not start row requests', async () => {
  const f = fixture({ translated: false });
  f.config.isEnable = '0'; f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.controller.getSelectionRoots(f.session.id), []);
  assert.match(f.panel().shadowRoot.querySelector('.panel-status').textContent, /turn on|disabled|enable/i);
  f.config.isEnable = '1'; f.session.synchronizer = { isSyncEnabled: false }; f.notify(); await f.flush();
  assert.equal(f.requests.length, 0);
  f.session.synchronizer.isSyncEnabled = true; f.notify(); await f.flush();
  assert.equal(f.requests.length, 1);
  f.controller.stop();
});

test('fullscreen relocation waits for a held selection before moving to the player drawer', async () => {
  const f = fixture(); f.controller.toggle(f.session.id, true); await f.flush();
  const panel = f.panel(), original = panel.shadowRoot.querySelector('.original-text').firstChild;
  f.state.isSubtitleSelectionHeld = true; f.notify(); await f.flush();
  f.document.fullscreenElement = f.player; f.emit(f.document, 'fullscreenchange'); await f.flush();
  assert.equal(panel.parentElement, f.right);
  assert.equal(panel.shadowRoot.querySelector('.original-text').firstChild, original);
  f.state.isSubtitleSelectionHeld = false; f.notify(); await f.flush();
  assert.equal(panel.parentElement, f.player);
  assert.equal(panel.dataset.placement, 'drawer');
  f.document.fullscreenElement = null; f.emit(f.document, 'fullscreenchange'); await f.flush();
  assert.equal(panel.parentElement, f.right);
  f.controller.stop();
});

test('layouts without a right column use a player drawer and leave mouseup available for selection translation', async () => {
  const f = fixture({ secondary: false }); f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.panel().parentElement, f.player);
  let mouseups = 0, playerClicks = 0;
  f.document.addEventListener('mouseup', () => mouseups++);
  f.player.addEventListener('click', () => playerClicks++);
  const text = f.panel().shadowRoot.querySelector('.original-text');
  f.emit(text, 'mouseup'); f.emit(text, 'click');
  assert.equal(mouseups, 1);
  assert.equal(playerClicks, 0);
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

test('a provider rejection does not create an unbounded automatic retry loop', async () => {
  const f = fixture({ translated: false });
  f.bridge.translateCues = async (id, batch) => { f.requests.push({ id, batch }); throw Error('Offline'); };
  f.controller.toggle(f.session.id, true); await f.flush();
  for (let i = 0; i < 3; i++) { f.notify(); await f.flush(); }
  assert.equal(f.requests.length, 1);
  f.state.translateVersion++; f.notify(); await f.flush();
  assert.equal(f.requests.length, 2, 'a new translation version may retry still-pending cues');
  f.controller.stop();
});

test('a bridge refusal waits for a later external update instead of pumping empty requests', async () => {
  const f = fixture({ translated: false });
  f.bridge.translateCues = (id, batch) => { f.requests.push({ id, batch }); return false; };
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 1);
  f.bridge.translateCues = async (id, batch) => {
    f.requests.push({ id, batch }); batch.forEach(cue => { cue.status = 'success'; cue.translation = 'Now available'; });
  };
  f.notify(); await f.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.panel().shadowRoot.querySelector('.translation-text').textContent, 'Now available');
  f.controller.stop();
});

test('a refused timestamp seek gives a visible error and preserves playback state', async () => {
  const f = fixture(); f.bridge.seek = () => false;
  f.controller.toggle(f.session.id, true); await f.flush();
  f.emit(f.panel().shadowRoot.querySelector('.timestamp'), 'click'); await f.flush();
  const status = f.panel().shadowRoot.querySelector('.panel-status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /unable to seek/i);
  assert.equal(f.video.currentTime, 0);
  assert.equal(f.video.playCount, 0);
  f.notify(); await f.flush();
  assert.equal(status.hidden, false, 'a translation update must not immediately erase the error');
  f.controller.stop();
});

test('closing or removing sidebar text cancels selection ownership before hiding the DOM', async () => {
  const f = fixture(); const cancellations = [];
  f.bridge.cancelSelection = (id, reason) => {
    cancellations.push({ id, reason, connected: f.panel()?.isConnected, hidden: f.panel()?.hidden });
    f.state.isSubtitleSelectionHeld = false;
  };
  f.controller.toggle(f.session.id, true); await f.flush();
  f.state.isSubtitleSelectionHeld = true; f.notify(); await f.flush();
  f.controller.toggle(f.session.id, false);
  assert.deepEqual(cancellations[0], { id: 'video-one', reason: 'sidebar-close', connected: true, hidden: false });
  f.controller.toggle(f.session.id, true); await f.flush();
  f.controller.stop();
  assert.equal(cancellations.at(-1).reason, 'sidebar-stop');
  assert.equal(cancellations.at(-1).connected, true);
});

test('a replaced video waits for the old batch and starts its own visible batch when that batch settles', async () => {
  const f = fixture({ translated: false }); let finishOld;
  f.bridge.translateCues = (id, batch) => {
    f.requests.push({ id, batch });
    return new Promise(resolve => { finishOld = resolve; });
  };
  f.controller.toggle(f.session.id, true); await f.flush();
  f.sessions.clear(); f.states.clear(); f.video.remove(); f.controlHost.remove();
  const video = f.document.createElement('video'); f.player.append(video);
  const control = f.document.createElement('span'); control.id = 'kuai-subtitle-button-video-two'; f.controls.append(control);
  const next = { id: 'video-two', rule: { id: 'youtube' }, video };
  const nextCue = { start: 0, end: 10, text: 'Next video', status: 'pending' };
  f.sessions.set(next.id, next); f.states.set(next.id, { subtitlesList: [nextCue], currentCaption: null });
  f.notify(); await f.flush();
  assert.equal(f.requests.length, 1, 'do not overlap the old sidebar request');
  f.bridge.translateCues = async (id, batch) => {
    f.requests.push({ id, batch }); batch.forEach(cue => { cue.status = 'success'; cue.translation = 'Next translated'; });
  };
  finishOld(); await f.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].id, 'video-two');
  assert.equal(f.requests[1].batch[0], nextCue);
  assert.equal(f.document.getElementById('kuai-subtitle-sidebar-video-two').shadowRoot.querySelector('.translation-text').textContent, 'Next translated');
  f.controller.stop();
});

test('hidden pages and advertisements never create additional sidebar requests', async () => {
  const f = fixture({ translated: false });
  f.document.visibilityState = 'hidden'; f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 0);
  f.document.visibilityState = 'visible'; f.player.classList.add('ad-showing'); f.emit(f.document, 'visibilitychange'); await f.flush();
  assert.equal(f.requests.length, 0);
  f.player.classList.remove('ad-showing'); f.emit(f.video, 'timeupdate'); await f.flush();
  assert.equal(f.requests.length, 1);
  f.controller.stop();
});

test('an ended video can translate visible subtitles and seek back without starting playback', async () => {
  const f = fixture({ translated: false });
  f.video.ended = true; f.video.currentTime = f.video.duration; f.video.paused = true;
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.panel().shadowRoot.querySelector('.translation-text').textContent, 'Translated: Original 1');
  f.emit(f.panel().shadowRoot.querySelectorAll('.timestamp')[1], 'click'); await f.flush();
  assert.equal(f.video.currentTime, 10);
  assert.equal(f.video.paused, true);
  assert.equal(f.video.playCount, 0);
  f.controller.stop();
});

test('an interrupting YouTube ad blocks pending row requests until normal playback returns', async () => {
  const f = fixture({ translated: false });
  f.player.classList.add('ad-interrupting');
  f.controller.toggle(f.session.id, true); await f.flush();
  f.emit(f.video, 'timeupdate'); await f.flush();
  assert.equal(f.requests.length, 0);
  f.player.classList.remove('ad-interrupting'); f.emit(f.video, 'timeupdate'); await f.flush();
  assert.equal(f.requests.length, 1);
  f.controller.stop();
});

test('repeated caption text cannot leave the active row attached to stale caption timestamps', async () => {
  const f = fixture({ count: 3 });
  f.cues.forEach(cue => { cue.text = 'Repeated line'; cue.translation = 'Repeated translation'; });
  f.state.currentCaption = { start: 0, end: 8, original: 'Repeated line', translation: 'Repeated translation', status: 'success' };
  f.video.currentTime = 12;
  f.controller.toggle(f.session.id, true); await f.flush();
  assert.equal(f.panel().shadowRoot.querySelector('[aria-current="true"]').querySelector('.timestamp').textContent, '0:10');
  f.video.currentTime = 22; f.emit(f.video, 'timeupdate'); await f.flush();
  assert.equal(f.panel().shadowRoot.querySelector('[aria-current="true"]').querySelector('.timestamp').textContent, '0:20');
  f.controller.stop();
});

test('timestamp, close and return-current presses cancel playback ownership before focus-driven deselection', async () => {
  for (const selector of ['.timestamp', '.close-panel', '.follow-current']) {
    for (const type of ['pointerdown', 'mousedown']) {
      const f = fixture(); f.controller.toggle(f.session.id, true); await f.flush();
      let ownedPause = true;
      f.state.isSubtitleSelectionHeld = true;
      f.bridge.cancelSelection = id => {
        assert.equal(id, f.session.id);
        ownedPause = false; f.state.isSubtitleSelectionHeld = false;
      };
      f.notify(); await f.flush();
      const control = f.panel().shadowRoot.querySelector(selector);
      const press = f.emit(control, type);
      // Browser focus/default deselection occurs after down, before click. This
      // boundary models the selection controller resuming only an owned pause.
      if (ownedPause) await f.video.play();
      f.emit(control, 'click'); await f.flush();
      assert.equal(press.defaultPrevented, false, `${selector}/${type}: preserve browser defaults`);
      assert.equal(f.video.playCount, 0, `${selector}/${type}: click cancellation would be too late`);
      assert.equal(f.video.paused, true);
      f.controller.stop();
    }
  }
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

test('saved open list waits for the watch layout instead of flashing over the player',async()=>{
  const f=fixture({secondary:false});f.watch.remove();f.document.body.append(f.player);
  f.controller.toggle(f.session.id,true);await f.flush();
  assert.ok(!f.panel()?.isConnected||f.panel().hidden,'unresolved watch layout must not paint a drawer');
  f.document.body.append(f.watch);f.watch.append(f.player,f.right);
  f.controller.sync();await f.flush();
  assert.equal(f.panel().parentElement,f.right);
  assert.equal(f.panel().hidden,false);
  f.controller.stop();
});

test('an initial watch shell waits for its late right column without painting a drawer',async()=>{
  const f=fixture({secondary:false});f.document.readyState='loading';
  f.controller.toggle(f.session.id,true);await f.flush();
  assert.ok(!f.panel()?.isConnected||f.panel().hidden);
  f.watch.append(f.right);f.controller.sync();await f.flush();
  assert.equal(f.panel().parentElement,f.right);assert.equal(f.panel().hidden,false);
  f.controller.stop();
});
test('a zero-width desktop right column waits for layout while settled theater can use a drawer',async()=>{
  const f=fixture();f.watch.setAttribute('is-two-columns_','');const rect=f.right.getBoundingClientRect.bind(f.right);
  f.right.getBoundingClientRect=()=>({...rect(),width:0});
  f.controller.toggle(f.session.id,true);await f.flush();
  assert.ok(!f.panel()?.isConnected||f.panel().hidden);
  f.right.getBoundingClientRect=rect;f.controller.sync();await f.flush();
  assert.equal(f.panel().parentElement,f.right);
  f.right.remove();f.watch.removeAttribute('is-two-columns_');f.watch.setAttribute('theater','');
  f.controller.sync();await f.flush();
  assert.equal(f.panel().parentElement,f.player);assert.equal(f.panel().hidden,false);
  f.controller.stop();
});
