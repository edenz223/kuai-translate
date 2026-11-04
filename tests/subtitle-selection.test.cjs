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

test('a temporarily collapsed range during a drag does not release an owned pause', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  h.event(session.text, 'pointerdown'); h.setSelection([session.text]);
  h.clearSelection(); h.flush();
  assert.equal(controller.isHeld(session.id), true);
  assert.equal(session.video.playCalls, 0);
  h.setSelection([session.text]); h.event(session.text, 'pointerup'); h.flush();
  assert.equal(session.video.pauseCalls, 1);
  assert.equal(controller.hasSelection(session.id), true);
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 1);
  controller.stop();
});

test('composed ranges find subtitle text when document selection endpoints are retargeted', () => {
  const h = createHarness(); const session = h.addSession(); h.roots.set(session.id, [session.container]);
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text], 'selected', { composedOnly: true });
  assert.equal(session.video.paused, true);
  assert.equal(controller.hasSelection(session.id), true);
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 1);
  controller.stop();
});

test('shadow-local selections work when the document selection is collapsed', () => {
  const h = createHarness(); const session = h.addSession(); h.roots.set(session.id, [session.container]);
  const controller = createController(h.bridge, h.env).start();
  const local = h.setSelection([session.text], 'selected', { dispatch: false }); h.clearSelection();
  session.container.getSelection = () => local;
  h.event(h.document, 'selectionchange', { bubbles: false });
  assert.equal(session.video.pauseCalls, 1);
  assert.equal(controller.hasSelection(session.id), true);
  controller.stop();
});

test('roots are discovered after startup and refreshed after caption text mounts late', () => {
  const h = createHarness(); const controller = createController(h.bridge, h.env).start();
  const session = h.addSession(); session.text.remove(); h.roots.set(session.id, [session.container]);
  h.notify(); h.flush();
  session.container.append(session.text);
  h.event(session.text, 'pointerdown');
  assert.equal(controller.isHeld(session.id), true);
  h.setSelection([session.text]);
  assert.equal(session.video.pauseCalls, 1);
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

for (const type of ['seeking', 'ended', 'emptied', 'loadstart', 'error', 'pause']) {
  test(type + ' invalidates selection-owned playback without resuming', () => {
    const h = createHarness(); const session = h.addSession();
    const controller = createController(h.bridge, h.env).start();
    h.setSelection([session.text]); h.event(session.video, type, { bubbles: false }); h.clearSelection(); h.flush();
    assert.equal(controller.isHeld(session.id), false);
    assert.equal(session.video.playCalls, 0);
    controller.stop();
  });
}

for (const change of ['media-key', 'video', 'registry', 'ad', 'disabled', 'caption-removed', 'roots-removed']) {
  test(change + ' is revalidated before any automatic resume', () => {
    const h = createHarness(); const session = h.addSession(); const originalVideo = session.video;
    const controller = createController(h.bridge, h.env).start();
    h.setSelection([session.text]);
    if (change === 'media-key') session.mediaKey = 'one:beta';
    if (change === 'video') { session.video = new h.env.HTMLVideoElement(); session.player.append(session.video); }
    if (change === 'registry') h.sessions.set(session.id, { ...session });
    if (change === 'ad') session.player.setAttribute('class', 'html5-video-player ad-showing');
    if (change === 'disabled') session.enabled = false;
    if (change === 'caption-removed') session.text.remove();
    if (change === 'roots-removed') h.roots.set(session.id, []);
    h.clearSelection(); h.flush();
    assert.equal(controller.isHeld(session.id), false);
    assert.equal(originalVideo.playCalls, 0);
    assert.equal(session.video.playCalls, 0);
    controller.stop();
  });
}

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

for (const type of ['yt-navigate-start', 'fullscreenchange', 'webkitbeginfullscreen', 'pagehide', 'visibilitychange']) {
  test(type + ' cancels ownership before automatic DOM selection clearing', () => {
    const h = createHarness(); const session = h.addSession();
    const controller = createController(h.bridge, h.env).start(); h.setSelection([session.text]);
    if (type === 'visibilitychange') h.document.visibilityState = 'hidden';
    const target = type === 'pagehide' ? h.env : type === 'webkitbeginfullscreen' ? session.video : h.document;
    h.event(target, type, { persisted: true }); h.clearSelection(); h.flush();
    assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
    controller.stop();
  });
}

test('caption click suppression preserves default selection and the window mouseup translator', () => {
  const h = createHarness(); const session = h.addSession(); let translated = 0; let playerClicks = 0;
  h.env.addEventListener('mouseup', () => translated++);
  session.player.addEventListener('click', () => playerClicks++);
  const controller = createController(h.bridge, h.env).start();
  assert.equal(h.event(session.text, 'pointerdown').defaultPrevented, false);
  h.setSelection([session.text]); h.event(session.player, 'pointerup'); h.event(session.player, 'mouseup');
  h.event(session.player, 'click');
  assert.equal(translated, 1); assert.equal(playerClicks, 0);
  assert.equal(h.event(session.text, 'dblclick').defaultPrevented, false);
  h.flush(); h.event(session.player, 'pointerdown'); h.event(session.player, 'click');
  assert.equal(playerClicks, 1);
  controller.stop();
});

test('pointer cancellation and explicit cancellation never resume on a later range collapse', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start();
  h.event(session.text, 'pointerdown'); h.setSelection([session.text]); h.event(session.text, 'pointercancel');
  h.clearSelection(); h.flush(); assert.equal(session.video.playCalls, 0);
  session.video.paused = false; h.event(session.text, 'pointerdown'); h.setSelection([session.text]);
  controller.cancel(session.id, 'sidebar-seek'); h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('a rejected play promise is handled and does not leave permission for a later retry', async () => {
  const h = createHarness(); const session = h.addSession(); session.video.rejectPlay = true;
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); h.clearSelection(); h.flush(); await Promise.resolve();
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 1); assert.equal(session.video.paused, true);
  assert.equal(controller.isHeld(session.id), false);
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

test('native caption roots become selectable and original inline selection styles are restored', () => {
  const h = createHarness(); const session = h.addSession(); session.text.className = 'ytp-caption-segment';
  session.text.style.userSelect = 'none'; session.text.style.webkitUserSelect = 'none';
  const controller = createController(h.bridge, h.env).start();
  assert.equal(session.text.style.userSelect, 'text');
  assert.equal(session.text.style.webkitUserSelect, 'text');
  h.roots.set(session.id, []); controller.sync();
  assert.equal(session.text.style.userSelect, 'none');
  assert.equal(session.text.style.webkitUserSelect, 'none');
  controller.stop();
});

test('moving a selected panel host cancels ownership even before fullscreenchange arrives', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start(); h.setSelection([session.text]);
  h.document.body.append(session.host); h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('replacing selected text nodes is cancellation rather than user deselection', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start(); h.setSelection([session.text]);
  session.text.textContent = 'A replacement caption'; h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('a queued play event from an earlier resume cannot cancel a newer selection pause', () => {
  const h = createHarness(); const session = h.addSession(); const video = session.video;
  // Native media properties change synchronously, but their events are queued.
  video.pause = () => {
    video.pauseCalls++;
    if (!video.paused) { video.paused = true; h.env.setTimeout(() => h.event(video, 'pause', { bubbles: false })); }
  };
  video.play = () => {
    video.playCalls++; video.paused = false;
    h.env.setTimeout(() => h.event(video, 'play', { bubbles: false }));
    return Promise.resolve();
  };
  const controller = createController(h.bridge, h.env).start();
  h.setSelection([session.text]); h.clearSelection(); h.setSelection([session.text]); h.flush();
  assert.equal(controller.isHeld(session.id), true);
  assert.equal(controller.hasSelection(session.id), true);
  assert.equal(video.paused, true); assert.equal(video.pauseCalls, 2);
  h.clearSelection(); h.flush();
  assert.equal(video.playCalls, 2); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('disabled subtitles do not restyle native captions or consume their pointer gestures', () => {
  const h = createHarness(); const session = h.addSession(); session.enabled = false;
  session.text.style.userSelect = 'none';
  const controller = createController(h.bridge, h.env).start();
  assert.equal(session.text.style.userSelect, 'none');
  const down = h.event(session.text, 'pointerdown');
  assert.equal(!!down.propagationStopped, false);
  h.setSelection([session.text]);
  assert.equal(session.video.pauseCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('ad-interrupting captions never acquire a selection pause', () => {
  const h = createHarness(); const session = h.addSession();
  session.player.setAttribute('class', 'html5-video-player ad-interrupting');
  const controller = createController(h.bridge, h.env).start();
  h.event(session.text, 'pointerdown'); h.setSelection([session.text]);
  assert.equal(session.video.pauseCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('ad-interrupting revokes an existing pause before selection is cleared', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start(); h.setSelection([session.text]);
  session.player.setAttribute('class', 'html5-video-player ad-interrupting');
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});

test('ended videos still hold selected subtitle text without acquiring playback ownership', () => {
  const h = createHarness(); const session = h.addSession('one', { paused: true });
  session.video.ended = true; session.video.currentTime = session.video.duration;
  const controller = createController(h.bridge, h.env).start();
  h.event(session.text, 'pointerdown');
  assert.equal(controller.isHeld(session.id), true, 'provisional text hold is valid after playback ends');
  h.setSelection([session.text]); h.event(session.text, 'pointerup'); h.flush();
  assert.equal(controller.hasSelection(session.id), true);
  assert.equal(controller.isHeld(session.id), true);
  assert.equal(session.video.pauseCalls, 0); assert.equal(session.video.playCalls, 0);
  h.clearSelection(); h.flush();
  assert.equal(controller.isHeld(session.id), false);
  assert.equal(session.video.pauseCalls, 0); assert.equal(session.video.playCalls, 0);
  assert.deepEqual(h.holds, [['one', true], ['one', false]]);
  controller.stop();
});

test('an owned pause cannot resume after ended becomes true before its queued event', () => {
  const h = createHarness(); const session = h.addSession();
  const controller = createController(h.bridge, h.env).start(); h.setSelection([session.text]);
  session.video.ended = true;
  h.clearSelection(); h.flush();
  assert.equal(session.video.playCalls, 0); assert.equal(controller.isHeld(session.id), false);
  controller.stop();
});
