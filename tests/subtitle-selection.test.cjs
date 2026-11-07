const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/subtitle-selection-harness.cjs');
const { createController } = require('../dist/src/youtube/selection.js');

test('caption selection pauses a playing video once and ordinary deselection resumes once', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]);
  assert.equal(session.video.paused, true);
  assert.equal(controller.isHeld(session.id), true);
  assert.equal(controller.hasSelection(session.id), true);
  h.setSelection([session.text], 'selected subtitle');
  assert.equal(session.video.pauseCalls, 1);
  h.clearSelection(); h.flush();
  assert.equal(session.video.paused, false);
  assert.equal(session.video.playCalls, 1);
  assert.equal(controller.isHeld(session.id), false);
  assert.deepEqual(h.holds, [['one', true], ['one', false]]);
  controller.stop();
});

test('selection of an initially paused video never acquires permission to play it', () => {
  const h = createHarness(); const session = h.addSession('one', { paused: true });
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); h.clearSelection(); h.flush();
  assert.equal(session.video.pauseCalls, 0);
  assert.equal(session.video.playCalls, 0);
  assert.equal(session.video.paused, true);
  assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('pointer down provisionally holds text without pausing and a simple click releases it', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  const down = h.event(session.text, 'pointerdown');
  h.event(session.text, 'mousedown');
  assert.equal(controller.isHeld(session.id), true);
  assert.equal(controller.hasSelection(session.id), false);
  assert.equal(session.video.pauseCalls, 0);
  assert.equal(down.defaultPrevented, false);
  assert.equal(down.propagationStopped, true);
  h.event(session.text, 'pointerup'); h.event(session.text, 'mouseup'); h.flush();
  assert.equal(controller.isHeld(session.id), false);
  assert.equal(session.video.pauseCalls, 0);
  assert.deepEqual(h.holds, [['one', true], ['one', false]]);
  controller.stop();
});

test('unrelated page selection does not pause a video and multiple sessions stay isolated', () => {
  const h = createHarness(); const first = h.addSession('one'); const second = h.addSession('two');
  const paragraph = h.document.createElement('p'); paragraph.textContent = 'Elsewhere'; h.document.body.append(paragraph);
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([paragraph]);
  assert.equal(first.video.pauseCalls + second.video.pauseCalls, 0);
  h.setSelection([second.text]);
  assert.equal(first.video.pauseCalls, 0); assert.equal(second.video.pauseCalls, 1);
  assert.equal(controller.hasSelection(first.id), false);
  h.clearSelection(); h.flush();
  assert.equal(first.video.playCalls, 0); assert.equal(second.video.playCalls, 1);
  controller.stop();
});

test('player control intent revokes ownership even when the video was already feature-paused', () => {
  const h = createHarness(); const session = h.addSession();
  const button = h.document.createElement('button'); button.className = 'ytp-play-button'; session.player.append(button);
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); h.event(button, 'pointerdown');
  assert.equal(controller.isHeld(session.id), false);
  h.setSelection([session.text]); // A stale range event must not reacquire a cancelled pause.
  assert.equal(controller.isHeld(session.id), false);
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0);
  controller.stop();
});

test('external play overrides selection without immediately being paused again', async () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); await session.video.play();
  h.setSelection([session.text]); h.clearSelection(); h.flush();
  assert.equal(controller.isHeld(session.id), false);
  assert.equal(session.video.pauseCalls, 1);
  assert.equal(session.video.playCalls, 1);
  controller.stop();
});

test('playback shortcuts cancel ownership while editable text shortcuts do not', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); h.event(h.document, 'keydown', { key: 'k' }); h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0);
  session.video.paused = false;
  h.event(session.text, 'pointerdown'); h.setSelection([session.text]); h.event(session.text, 'pointerup'); h.flush();
  const input = h.document.createElement('input'); h.document.body.append(input);
  h.event(input, 'keydown', { key: ' ' }); h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 1);
  controller.stop();
});

test('an ad is never paused by stale caption selection and class transitions cancel promptly', () => {
  const h = createHarness(); const session = h.addSession(); session.player.setAttribute('class', 'html5-video-player ad-showing');
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); assert.equal(session.video.pauseCalls, 0);
  h.clearSelection(); session.player.setAttribute('class', 'html5-video-player'); h.flush();
  h.setSelection([session.text]); assert.equal(session.video.pauseCalls, 1);
  session.player.setAttribute('class', 'html5-video-player ad-showing'); h.flush();
  assert.equal(controller.isHeld(session.id), false);
  h.clearSelection(); h.flush(); assert.equal(session.video.playCalls, 0);
  controller.stop();
});

test('teardown relinquishes ownership and removes every controller-owned browser resource', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  h.event(session.text, 'pointerdown'); h.setSelection([session.text]); h.notify(); controller.stop();
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
  assert.equal(h.document.listenerCount(), 0); assert.equal(h.env.listenerCount(), 0); assert.equal(session.video.listenerCount(), 0);
  assert.equal(h.subscriberCount(), 0); assert.equal(h.observerCount(), 0); assert.equal(h.timerCount(), 0);
});
