// Browser boundaries only: the production controller owns all selection/playback decisions.
// This fixture does not emulate browser layout, native Selection behavior, or YouTube.
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener, options = false) {
    const capture = options === true || !!options.capture;
    const entries = this.listeners.get(type) || [];
    if (!entries.some(e => e.listener === listener && e.capture === capture)) entries.push({ listener, capture, once: !!options.once });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, listener, options = false) {
    const capture = options === true || !!options.capture;
    this.listeners.set(type, (this.listeners.get(type) || []).filter(e => e.listener !== listener || e.capture !== capture));
  }
  listenerCount() { return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0); }
}
class BoundaryNode extends Target {
  constructor(type, document) { super(); this.nodeType = type; this.ownerDocument = document; this.parentNode = null; this.childNodes = []; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.childNodes.push(node); this.ownerDocument?.mutate(this, 'childList'); } }
  remove() { if (this.parentNode) { const parent = this.parentNode; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null; this.ownerDocument?.mutate(parent, 'childList'); } }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return this.nodeType === 9 || !!this.parentNode?.isConnected || !!this.host?.isConnected; }
  getRootNode() { let node = this; while (node.parentNode) node = node.parentNode; return node; }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; if (value) { const text = new BoundaryNode(3, this.ownerDocument); text.data = String(value); this.append(text); } }
  get firstChild() { return this.childNodes[0] || null; }
}
class Element extends BoundaryNode {
  constructor(tag, document) { super(1, document); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.className = ''; this.style = {}; this.dataset = {}; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
      if (part.startsWith('#')) return this.id === part.slice(1);
      const attr = part.match(/^\[([^=\]]+)(?:="?([^"\]]+)"?)?\]$/);
      if (attr) return this.attrs.has(attr[1]) && (attr[2] === undefined || this.attrs.get(attr[1]) === attr[2]);
      return this.tagName.toLowerCase() === part.toLowerCase();
    });
  }
  closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentElement; } return null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'class') this.className = String(value); this.ownerDocument.mutate(this, 'attributes'); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  querySelectorAll(selector) { const output = []; const walk = node => { for (const child of node.childNodes) { if (child.matches?.(selector)) output.push(child); walk(child); } }; walk(this); return output; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  attachShadow() { const shadow = new BoundaryNode(11, this.ownerDocument); shadow.host = this; shadow.querySelectorAll = Element.prototype.querySelectorAll; shadow.querySelector = Element.prototype.querySelector; shadow.getSelection = () => this.ownerDocument.selection; this.shadowRoot = shadow; return shadow; }
}
function event(target, type, options = {}) {
  const path = []; let node = target;
  while (node) { path.push(node); node = node.parentNode || node.host || (node.nodeType === 9 ? node.defaultView : null); }
  const value = {
    type, target, button: 0, pointerId: 1, detail: 1, bubbles: true, cancelable: true,
    defaultPrevented: false, ...options, composedPath: () => path,
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.propagationStopped = true; this.immediateStopped = true; },
  };
  const invoke = (current, capture) => {
    value.currentTarget = current;
    for (const record of [...(current.listeners?.get(type) || [])]) {
      if (record.capture !== capture) continue;
      record.listener(value);
      if (record.once) current.removeEventListener(type, record.listener, capture);
      if (value.immediateStopped) break;
    }
  };
  for (let index = path.length - 1; index >= 0; index--) { invoke(path[index], true); if (value.propagationStopped) return value; }
  for (let index = 0; index < path.length; index++) { invoke(path[index], false); if (value.propagationStopped || (!value.bubbles && index === 0)) break; }
  return value;
}
function createHarness() {
  const env = new Target(); const timers = new Map(); let timerId = 0; const observers = new Set();
  env.console = { warn() {} }; env.location = { href: 'https://www.youtube.com/watch?v=alpha' };
  env.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id; };
  env.clearTimeout = id => timers.delete(id); env.requestAnimationFrame = env.setTimeout; env.cancelAnimationFrame = env.clearTimeout;
  const document = new BoundaryNode(9, null); document.ownerDocument = document; document.defaultView = env;
  document.visibilityState = 'visible'; document.fullscreenElement = null;
  document.mutate = (target, type) => { for (const observer of observers) if (observer.targets.some(record => record.target === target || (record.options.subtree && record.target.contains(target)))) observer.pending.push({ target, type }); };
  document.createElement = tag => new Element(tag, document);
  document.body = document.createElement('body'); document.append(document.body);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector); document.querySelector = selector => document.body.querySelector(selector);
  document.getElementById = id => document.querySelector('#' + id);
  document.selection = emptySelection(); document.getSelection = () => document.selection;
  env.document = document; env.getSelection = document.getSelection; env.Node = BoundaryNode; env.Element = Element; env.HTMLElement = Element; env.ShadowRoot = BoundaryNode;
  env.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; this.pending = []; observers.add(this); }
    observe(target, options) { observers.add(this); this.targets.push({ target, options }); }
    disconnect() { this.targets = []; this.pending = []; observers.delete(this); }
  };
  class Video extends Element {
    constructor() { super('video', document); this.paused = false; this.ended = false; this.seeking = false; this.error = null; this.currentTime = 1; this.duration = 60; this.currentSrc = 'blob:alpha'; this.pauseCalls = 0; this.playCalls = 0; }
    pause() { this.pauseCalls++; if (!this.paused) { this.paused = true; event(this, 'pause', { bubbles: false }); } }
    play() { this.playCalls++; if (this.rejectPlay) return Promise.reject(new Error('Playback denied')); this.paused = false; event(this, 'play', { bubbles: false }); return Promise.resolve(); }
  }
  env.HTMLVideoElement = Video;
  const sessions = new Map(); const states = new Map(); const roots = new Map(); const subscribers = new Set(); const holds = [];
  const bridge = {
    getSessions: () => sessions.values(), getState: id => states.get(id), getRoots: session => roots.get(session.id) || [],
    getMediaKey: session => session.mediaKey, isEnabled: session => session.enabled,
    onHold: (session, held) => { holds.push([session.id, held]); states.get(session.id).isSubtitleSelectionHeld = held; },
    subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback); },
  };
  function addSession(id = 'one', { paused = false, shadow = true } = {}) {
    const player = document.createElement('div'); player.className = 'html5-video-player'; document.body.append(player);
    const video = new Video(); video.paused = paused; player.append(video);
    const host = document.createElement('div'); host.id = 'st-captions-window-' + id; player.append(host);
    const container = shadow ? host.attachShadow({ mode: 'open' }) : host;
    const text = document.createElement('span'); text.className = 'original-text'; text.setAttribute('data-kuai-subtitle-text', 'true'); text.textContent = 'The selected subtitle'; container.append(text);
    const session = { id, video, player, host, container, text, mediaKey: id + ':alpha', enabled: true, rule: { id: 'youtube' } };
    sessions.set(id, session); states.set(id, { currentCaption: { original: text.textContent }, subtitlesList: [], isSubtitleSelectionHeld: false }); roots.set(id, [text]);
    return session;
  }
  function setSelection(nodes, text = 'selected', { dispatch = true, composedOnly = false } = {}) {
    const range = { startContainer: nodes[0]?.firstChild || nodes[0], startOffset: 0, endContainer: nodes.at(-1)?.firstChild || nodes.at(-1), endOffset: 3, intersectsNode: node => nodes.some(selected => node.contains(selected) || selected.contains(node)) };
    const selected = { isCollapsed: false, rangeCount: 1, anchorNode: range.startContainer, focusNode: range.endContainer, toString: () => text, getRangeAt: () => range };
    if (composedOnly) { selected.anchorNode = selected.focusNode = document.body; selected.getRangeAt = () => ({ startContainer: document.body, endContainer: document.body, startOffset: 0, endOffset: 1, intersectsNode: () => false }); selected.getComposedRanges = () => [range]; }
    document.selection = selected;
    if (dispatch) event(document, 'selectionchange', { bubbles: false });
    return selected;
  }
  function clearSelection() { document.selection = emptySelection(); event(document, 'selectionchange', { bubbles: false }); }
  function flush() {
    for (let loop = 0; loop < 20; loop++) {
      let work = false;
      for (const observer of [...observers]) if (observer.pending.length) { const records = observer.pending.splice(0); observer.callback(records); work = true; }
      const batch = [...timers.values()]; timers.clear(); for (const callback of batch) { callback(); work = true; }
      if (!work) return;
    }
    throw new Error('Fixture work did not settle');
  }
  return { env, document, bridge, sessions, states, roots, holds, addSession, setSelection, clearSelection, event, flush, notify: () => subscribers.forEach(callback => callback()), subscriberCount: () => subscribers.size, observerCount: () => observers.size, timerCount: () => timers.size };
}
function emptySelection() { return { isCollapsed: true, rangeCount: 0, anchorNode: null, focusNode: null, toString: () => '' }; }
module.exports = { createHarness, event };
