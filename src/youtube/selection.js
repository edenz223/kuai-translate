/* Subtitle text selection and playback ownership, in the isolated content world. */
const root = globalThis;
"use strict";
function createController(bridge, env = root) {
  const doc = env.document;
  const entries = new Map();
  const listeners = [];
  const textSelector = '[data-kuai-subtitle-text], .original-text, .translation-text, .ytp-caption-segment';
  let started = false;
  let syncing = false;
  let unsubscribe;
  let syncTimer = null;
  let settleTimer = null;
  let gesture = null;
  let suppressClick = false;

  const pathOf = event => event.composedPath?.() || [event.target];
  const mediaKey = session => bridge.getMediaKey?.(session) ?? env.location?.href;
  const playerOf = entry => entry.video.closest?.('.html5-video-player') || entry.video.parentElement;
  function ancestry(node) {
    const path = [];
    for (; node; node = node.parentNode || node.host) path.push(node);
    return path;
  }
  function sameNodes(first, second) {
    return first.length === second.length && first.every((node, index) => node === second[index]);
  }
  function usable(entry) {
    const video = entry.video;
    return started && entry.session.video === video && video?.isConnected &&
      Array.from(bridge.getSessions()).includes(entry.session) &&
      (!bridge.isEnabled || bridge.isEnabled(entry.session)) &&
      (!bridge.getState || !!bridge.getState(entry.session.id)) &&
      doc.visibilityState !== 'hidden' && !video.seeking && !video.error &&
      !video.closest?.('.ad-showing, .ad-interrupting') && mediaKey(entry.session) === entry.mediaKey;
  }
  function canControlPlayback(entry) {
    // Reading an ended transcript still needs a stable text snapshot, but never
    // grants permission to pause or restart the finished media.
    return usable(entry) && !entry.video.ended;
  }
  function holdIsCurrent(entry) {
    return !entry.held || (
      entry.heldTexts.every(text => text.isConnected && entry.texts.includes(text)) &&
      entry.heldNodes.every(node => node.isConnected !== false) &&
      entry.heldPaths.every(([text, path]) => sameNodes(path, ancestry(text)))
    );
  }
  function hold(entry, held) {
    if (entry.held === held) return;
    entry.held = held;
    bridge.onHold?.(entry.session, held);
  }
  function remember(entry, texts, nodes = []) {
    entry.heldTexts = texts;
    entry.heldNodes = nodes;
    entry.heldPaths = texts.map(text => [text, ancestry(text)]);
  }
  function cancelEntry(entry) {
    entry.generation++;
    entry.owner = false;
    entry.selected = false;
    entry.blocked = true;
    entry.pointerDown = false;
    entry.settling = false;
    if (gesture === entry) gesture = null;
    hold(entry, false);
    remember(entry, []);
  }
  function cancel(id) {
    const entry = entries.get(id);
    if (entry) cancelEntry(entry);
  }
  function cancelAll() {
    for (const entry of entries.values()) cancelEntry(entry);
    gesture = null;
    suppressClick = false;
  }
  function release(entry) {
    const resume = entry.owner && canControlPlayback(entry) && holdIsCurrent(entry) && entry.video.paused;
    entry.owner = false;
    entry.selected = false;
    entry.pointerDown = false;
    entry.settling = false;
    const generation = ++entry.generation;
    hold(entry, false);
    remember(entry, []);
    // onHold may synchronously update settings, destroy a session, or cancel a seek.
    if (resume && entry.generation === generation && !entry.held && canControlPlayback(entry) && entry.video.paused) {
      try { Promise.resolve(entry.video.play()).catch(() => {}); } catch {}
    }
  }
  function makeSelectable(text) {
    const style = text.style;
    if (!style) return () => {};
    const keys = [['user-select', 'userSelect'], ['-webkit-user-select', 'webkitUserSelect']];
    const saved = keys.map(([css, js]) => ({ css, js,
      value: style.getPropertyValue ? style.getPropertyValue(css) : style[js],
      priority: style.getPropertyPriority?.(css) || '',
    }));
    for (const { css, js } of saved) {
      if (style.setProperty) style.setProperty(css, 'text', 'important');
      else style[js] = 'text';
    }
    return () => {
      for (const { css, js, value, priority } of saved) {
        if (style.getPropertyValue) {
          if (style.getPropertyValue(css) !== 'text' || style.getPropertyPriority(css) !== 'important') continue;
          if (value) style.setProperty(css, value, priority);
          else style.removeProperty(css);
        } else if (style[js] === 'text') {
          if (value === undefined) delete style[js];
          else style[js] = value;
        }
      }
    };
  }
  function updateRoots(entry) {
    const texts = new Set();
    const shadows = new Set();
    const roots = !bridge.isEnabled || bridge.isEnabled(entry.session) ? bridge.getRoots(entry.session) || [] : [];
    for (const node of roots) {
      if (!node || node.isConnected === false) continue;
      if (node.nodeType === 11 && node.host) {
        shadows.add(node);
        node.querySelectorAll(textSelector).forEach(text => texts.add(text));
      } else if (node.nodeType === 1) texts.add(node);
      const shadow = node.getRootNode?.();
      if (shadow?.nodeType === 11 && shadow.host) shadows.add(shadow);
    }
    entry.texts = [...texts];
    entry.shadows = [...shadows];
    for (const [text, restore] of entry.styles) if (!texts.has(text)) { restore(); entry.styles.delete(text); }
    for (const text of texts) if (!entry.styles.has(text)) entry.styles.set(text, makeSelectable(text));
    const observed = [...new Set([playerOf(entry), ...shadows].filter(Boolean))];
    if (!sameNodes(entry.observed, observed)) {
      entry.observer?.disconnect();
      entry.observed = observed;
      for (const target of observed) entry.observer?.observe(target, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
      });
    }
  }
  function remove(entry) {
    cancelEntry(entry);
    entry.dispose();
    entry.observer?.disconnect();
    for (const restore of entry.styles.values()) restore();
    entry.styles.clear();
  }
  function add(session) {
    const entry = {
      session, video: session.video, mediaKey: mediaKey(session), texts: [], shadows: [],
      styles: new Map(), observed: [], heldTexts: [], heldNodes: [], heldPaths: [],
      held: false, selected: false, owner: false, blocked: false, generation: 0,
      pointerDown: false, settling: false, expectedPauses: 0,
    };
    const overrides = ['play', 'playing', 'seeking', 'ended', 'emptied', 'loadstart', 'error', 'abort', 'webkitbeginfullscreen'];
    const override = event => {
      // Media events are queued: an earlier resume may report play after a new
      // selection has synchronously paused the same element again.
      if ((event?.type === 'play' || event?.type === 'playing') && entry.video.paused) return;
      if (entry.held) cancelEntry(entry);
    };
    const pause = () => {
      if (entry.expectedPauses) { entry.expectedPauses--; return; }
      override();
    };
    for (const type of overrides) entry.video.addEventListener(type, override);
    entry.video.addEventListener('pause', pause);
    entry.dispose = () => {
      for (const type of overrides) entry.video.removeEventListener(type, override);
      entry.video.removeEventListener('pause', pause);
    };
    if (env.MutationObserver) entry.observer = new env.MutationObserver(scheduleSync);
    entries.set(session.id, entry);
    return entry;
  }
  function sync() {
    if (!started || syncing) return;
    syncing = true;
    try {
      const sessions = new Map(Array.from(bridge.getSessions(), session => [session.id, session]));
      for (const [id, entry] of entries) {
        if (sessions.get(id) !== entry.session || entry.session.video !== entry.video || !entry.video.isConnected) {
          remove(entry); entries.delete(id);
        }
      }
      for (const session of sessions.values()) {
        if (session.rule?.id !== 'youtube' || !session.video?.isConnected) continue;
        const entry = entries.get(session.id) || add(session);
        const nextKey = mediaKey(session);
        if (entry.mediaKey !== nextKey) { cancelEntry(entry); entry.mediaKey = nextKey; }
        updateRoots(entry);
        if (entry.held && (!usable(entry) || !holdIsCurrent(entry))) cancelEntry(entry);
      }
    } finally { syncing = false; }
  }
  function scheduleSync() {
    if (!started || syncTimer !== null) return;
    syncTimer = env.setTimeout(() => { syncTimer = null; sync(); }, 0);
  }
  function intersects(range, text) {
    if (text.contains(range.startContainer) || text.contains(range.endContainer)) return true;
    try {
      if (typeof range.intersectsNode === 'function') return range.intersectsNode(text);
      if (doc.createRange) {
        const live = doc.createRange();
        live.setStart(range.startContainer, range.startOffset);
        live.setEnd(range.endContainer, range.endOffset);
        return live.intersectsNode(text);
      }
    } catch {}
    return false;
  }
  function selectedText(entry) {
    const selections = new Set([env.getSelection?.() || doc.getSelection?.()]);
    for (const shadow of entry.shadows) {
      try { selections.add(shadow.getSelection?.()); } catch {}
    }
    const texts = new Set();
    const nodes = new Set();
    for (const selection of selections) {
      if (!selection || selection.isCollapsed || !selection.toString().trim()) continue;
      let ranges = [];
      try { ranges = selection.getComposedRanges?.({ shadowRoots: entry.shadows }) || []; } catch {}
      if (!ranges.length) {
        for (let i = 0; i < (selection.rangeCount || 0); i++) {
          try { ranges.push(selection.getRangeAt(i)); } catch {}
        }
      }
      for (const text of entry.texts) {
        if (text.contains(selection.anchorNode) || text.contains(selection.focusNode) || ranges.some(range => intersects(range, text))) {
          texts.add(text);
          for (const node of [selection.anchorNode, selection.focusNode, ...ranges.flatMap(range => [range.startContainer, range.endContainer])]) {
            if (node && text.contains(node)) nodes.add(node);
          }
        }
      }
    }
    return { texts: [...texts], nodes: [...nodes] };
  }
  function changed() {
    if (!started) return;
    sync(); // Hosts and their open shadow text may mount after the session notification.
    for (const entry of entries.values()) {
      const selected = selectedText(entry);
      if (!selected.texts.length) {
        entry.selected = false;
        entry.blocked = false;
        if (entry.held && !entry.pointerDown && !entry.settling) release(entry);
        continue;
      }
      if (entry.blocked || !usable(entry)) continue;
      remember(entry, selected.texts, selected.nodes);
      entry.selected = true;
      hold(entry, true);
      if (!entry.video.paused && !entry.owner && canControlPlayback(entry)) {
        entry.owner = true;
        entry.expectedPauses++;
        try { entry.video.pause(); } catch {
          entry.expectedPauses--;
          entry.owner = false;
        }
        if (!entry.video.paused) entry.owner = false;
      }
    }
  }
  function textEntry(path) {
    for (const entry of entries.values()) {
      const texts = entry.texts.filter(text => path.includes(text) || text.contains(path[0]));
      if (texts.length) return { entry, texts };
    }
    return null;
  }
  function down(event) {
    if (event.button !== undefined && event.button !== 0) return;
    sync();
    const path = pathOf(event);
    const match = textEntry(path);
    // A new physical gesture cannot consume a previous gesture's click blocker.
    suppressClick = false;
    if (match) {
      event.stopPropagation(); // Keep native text-selection defaults; do not preventDefault.
      const { entry, texts } = match;
      if (!usable(entry)) return;
      if (gesture !== entry || !entry.pointerDown) {
        gesture = entry;
        entry.blocked = false;
        entry.pointerDown = true;
        entry.settling = false;
        if (!entry.held) remember(entry, texts);
        hold(entry, true);
      }
      return;
    }
    for (const entry of entries.values()) {
      if (entry.held && (path.includes(entry.video) || path.includes(playerOf(entry)))) cancelEntry(entry);
    }
  }
  function up() {
    if (gesture) {
      gesture.pointerDown = false;
      gesture.settling = true;
      suppressClick = true;
    }
    if (settleTimer !== null) env.clearTimeout(settleTimer);
    settleTimer = env.setTimeout(() => {
      settleTimer = null;
      for (const entry of entries.values()) entry.settling = false;
      gesture = null;
      suppressClick = false;
      changed();
    }, 0);
    // mouseup deliberately continues to the existing window translation listener.
  }
  function pointerCancel() {
    if (gesture) cancelEntry(gesture);
    suppressClick = false;
  }
  function click(event) {
    sync();
    if (textEntry(pathOf(event)) || (suppressClick && event.detail !== 0)) {
      event.stopPropagation();
      if (event.type === 'click') suppressClick = false;
    }
  }
  function keydown(event) {
    if (event.isComposing || event.keyCode === 229 || event.altKey && !event.ctrlKey || event.metaKey) return;
    if (pathOf(event).some(node => node?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName) || node?.getAttribute?.('role') === 'textbox')) return;
    if ([' ', 'Spacebar', 'k', 'K', 'MediaPlayPause', 'MediaPause', 'MediaPlay', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      for (const entry of entries.values()) if (entry.held) cancelEntry(entry);
    }
  }
  function visibility() {
    if (doc.visibilityState === 'hidden') cancelAll();
    else sync();
  }
  function pagehide(event) {
    cancelAll();
    if (!event.persisted) stop();
  }
  function listen(target, type, callback, capture = false) {
    target.addEventListener(type, callback, capture);
    listeners.push(() => target.removeEventListener(type, callback, capture));
  }
  function start() {
    if (started) return api;
    started = true;
    listen(doc, 'selectionchange', changed);
    for (const type of ['pointerdown', 'mousedown']) listen(doc, type, down, true);
    for (const type of ['pointerup', 'mouseup']) listen(doc, type, up, true);
    for (const type of ['click', 'dblclick']) listen(doc, type, click, true);
    listen(doc, 'pointercancel', pointerCancel, true);
    listen(doc, 'keydown', keydown, true);
    listen(doc, 'visibilitychange', visibility);
    for (const type of ['fullscreenchange', 'webkitfullscreenchange', 'yt-navigate-start']) listen(doc, type, cancelAll, true);
    listen(env, 'pagehide', pagehide);
    listen(env, 'pageshow', sync);
    unsubscribe = bridge.subscribe?.(scheduleSync);
    sync();
    return api;
  }
  function stop() {
    if (!started) return;
    started = false;
    unsubscribe?.();
    unsubscribe = null;
    for (const dispose of listeners.splice(0)) dispose();
    for (const entry of entries.values()) remove(entry);
    entries.clear();
    if (syncTimer !== null) env.clearTimeout(syncTimer);
    if (settleTimer !== null) env.clearTimeout(settleTimer);
    syncTimer = settleTimer = null;
    gesture = null;
    suppressClick = false;
  }
  const api = {
    start, stop, sync, cancel,
    isHeld: id => !!entries.get(id)?.held,
    hasSelection: id => !!entries.get(id)?.selected,
  };
  return api;
}
let controller;
const api = {
  createController,
  start(bridge) { controller?.stop(); controller = createController(bridge).start(); return controller; },
  isHeld: id => controller?.isHeld(id) || false,
  hasSelection: id => controller?.hasSelection(id) || false,
  cancel(id, reason) { controller?.cancel(id, reason); },
};
export { createController };
export default api;
