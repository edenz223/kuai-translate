/* Controlled DOM/layout/media boundaries for the real sidebar controller.
 * This is not a browser or a YouTube end-to-end fixture. */
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      listener.call(this, event);
      if (event.immediateStopped) break;
    }
    return !event.defaultPrevented;
  }
}

class Node extends Target {
  constructor(type, document) {
    super(); this.nodeType = type; this.ownerDocument = document;
    this.parentNode = null; this.childNodes = [];
  }
  appendChild(node) {
    if (node.nodeType === 11 && !node.host) {
      for (const child of [...node.childNodes]) this.appendChild(child);
      return node;
    }
    node.remove(); node.parentNode = this; this.childNodes.push(node); return node;
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
  }
  insertBefore(node, before) {
    if (!before) return this.appendChild(node);
    if (node === before) return node;
    node.remove(); const index = this.childNodes.indexOf(before);
    if (index < 0) throw Error('Reference node is not a child');
    node.parentNode = this; this.childNodes.splice(index, 0, node); return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw Error('Node is not a child');
    this.childNodes.splice(index, 1); node.parentNode = null; return node;
  }
  replaceChildren(...nodes) { for (const child of [...this.childNodes]) child.remove(); this.append(...nodes); }
  remove() { this.parentNode?.removeChild(this); }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const all = this.parentNode?.childNodes; return all?.[all.indexOf(this) + 1] || null; }
  get isConnected() { return this.nodeType === 9 || !!this.parentNode?.isConnected || !!this.host?.isConnected; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    if (this.nodeType === 3) { this.nodeValue = String(value); return; }
    this.replaceChildren(); if (String(value)) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
  getRootNode() { let node = this; while (node.parentNode) node = node.parentNode; return node; }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class Element extends Node {
  constructor(tag, document) {
    super(1, document); this.tagName = tag.toUpperCase(); this.attrs = new Map();
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    this.scrollTop = 0; this.hidden = false; this.disabled = false;
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())) ?? undefined,
      set: (_, key, value) => { this.setAttribute('data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; },
    });
    this.classList = {
      contains: value => this.className.split(/\s+/).includes(value),
      add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
      remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); },
      toggle: (value, force) => {
        const add = force ?? !this.classList.contains(value);
        this.classList[add ? 'add' : 'remove'](value); return add;
      },
    };
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim(); if (part === '*') return true;
      const tag = part.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const match of part.matchAll(/#([\w-]+)/g)) if (this.id !== match[1]) return false;
      for (const match of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
      for (const match of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
        if (!this.hasAttribute(match[1]) || (match[2] !== undefined && this.getAttribute(match[1]) !== match[2])) return false;
      }
      return true;
    });
  }
  closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentElement; } return null; }
  attachShadow() { const shadow = new Node(11, this.ownerDocument); shadow.host = this; this.shadowRoot = shadow; return shadow; }
  get clientHeight() { return this.classList.contains('subtitle-list') ? 240 : this.offsetHeight; }
  get clientWidth() { return 340; }
  get offsetHeight() {
    if (this.hidden) return 0;
    if (this.classList.contains('cue')) return this._height || 80;
    if (this.classList.contains('subtitle-list')) return 240;
    if (this.style.height) return parseFloat(this.style.height) || 0;
    return this.children.reduce((sum, child) => sum + child.offsetHeight, 0);
  }
  get scrollHeight() { return this.children.reduce((sum, child) => sum + child.offsetHeight, 0); }
  getBoundingClientRect() {
    if (this._rect) return this._rect;
    if (!this.isConnected || this.hidden) return rect(0, 0, 0, 0);
    if (this.classList.contains('subtitle-list')) return rect(1000, this.ownerDocument.listTop, 340, 240);
    const list = this.closest('.subtitle-list');
    if (list) {
      let top = list.getBoundingClientRect().top - list.scrollTop;
      for (let node = this; node && node !== list; node = node.parentElement) {
        for (const sibling of node.parentElement.children) { if (sibling === node) break; top += sibling.offsetHeight; }
      }
      return rect(1000, top, 340, this.offsetHeight);
    }
    return rect(0, 100, 960, 540);
  }
  scrollTo(options) { this.scrollTop = Number(options.top) || 0; }
  focus() { this.ownerDocument.activeElement = this; }
}

class Video extends Element {
  constructor(document) {
    super('video', document); this.currentTime = 0; this.duration = 5000;
    this.paused = true; this.ended = false; this.seeking = false; this.currentSrc = 'blob:video-one';
    this.playCount = 0; this.pauseCount = 0; this.seekable = { length: 0 };
  }
  play() { this.playCount++; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCount++; this.paused = true; }
}

function rect(left, top, width, height) { return { left, top, width, height, right: left + width, bottom: top + height }; }

class Document extends Node {
  constructor() {
    super(9, null); this.ownerDocument = this; this.visibilityState = 'visible'; this.fullscreenElement = null;
    this.listTop = 140; this.documentElement = this.createElement('html'); this.body = this.createElement('body');
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body);
  }
  createElement(tag) { return tag === 'video' ? new Video(this) : new Element(tag, this); }
  createElementNS(_, tag) { return this.createElement(tag); }
  createTextNode(value) { const node = new Node(3, this); node.nodeValue = String(value); return node; }
  createDocumentFragment() { return new Node(11, this); }
  getElementById(id) { return this.querySelector('#' + id); }
}

function emit(target, type, init = {}) {
  const path = []; for (let node = target; node; node = node.parentNode || node.host) path.push(node);
  const event = {
    type, target, button: 0, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediateStopped = true; this.propagationStopped = true; },
    composedPath: () => path,
    ...init,
  };
  for (const node of path) { node.dispatchEvent(event); if (event.propagationStopped) break; }
  return event;
}

function createFixture(api, { count = 12, translated = true, secondary = true, language = 'en', embed = false, config: settings = {}, bridge: extra = {} } = {}) {
  const document = new Document(), env = new Target(), frames = new Map(); let frameId = 0;
  Object.assign(env, {
    document, HTMLVideoElement: Video, HTMLElement: Element, Node, URL,
    location: { href: embed ? 'https://www.youtube.com/embed/one' : 'https://www.youtube.com/watch?v=one' }, navigator: { language },
    innerHeight: 900, innerWidth: 1440, console,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: element => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible' }),
  });
  const watch = document.createElement('ytd-watch-flexy'), player = document.createElement('div');
  player.className = 'html5-video-player';
  // An embed has no watch layout; its controls are a layer beside the player, not inside it.
  const layer = document.createElement('div'); layer.id = 'player-controls';
  if (embed) document.body.append(player, layer); else { document.body.append(watch); watch.append(player); }
  const video = document.createElement('video'); player.append(video);
  const controls = document.createElement('div'), controlHost = document.createElement('span');
  controls.className = 'ytp-right-controls'; controlHost.id = 'kuai-subtitle-button-video-one';
  (embed ? document.body : player).append(controls); controls.append(controlHost);
  const right = document.createElement('div'); right.id = 'secondary'; if (secondary) watch.append(right);
  const session = { id: 'video-one', rule: { id: 'youtube' }, video };
  const cues = Array.from({ length: count }, (_, index) => ({
    start: index * 10, end: index * 10 + 8, text: `Original ${index + 1}`,
    translation: translated ? `Translation ${index + 1}` : '', status: translated ? 'success' : 'pending',
  }));
  const state = { subtitlesList: cues, currentCaption: null, translateVersion: 0, isSubtitleSelectionHeld: false };
  const sessions = new Map([[session.id, session]]), states = new Map([[session.id, state]]);
  const subscribers = new Set(), requests = [], seeks = [];
  const config = { isEnable: '1', hideTranslation: '0', styleConfig: {}, ...settings };
  const bridge = {
    getSessions: () => sessions.values(), getState: id => states.get(id), getConfig: () => config,
    getLanguage: () => language, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    isSelectionHeld: id => !!states.get(id)?.isSubtitleSelectionHeld,
    translateCues: async (id, batch) => {
      requests.push({ id, batch });
      batch.forEach(cue => { cue.status = 'success'; cue.translation = `Translated: ${cue.text}`; });
      for (const callback of subscribers) callback(id);
    },
    seek: (id, time) => { seeks.push({ id, time }); sessions.get(id).video.currentTime = time; return true; },
    ...extra,
  };
  const controller = api.createController(bridge, env).start();
  async function flush() {
    for (let pass = 0; pass < 40; pass++) {
      await Promise.resolve();
      if (!frames.size) { await Promise.resolve(); if (!frames.size) return; }
      const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback());
    }
    throw Error('Sidebar did not become idle within 40 frame turns');
  }
  return {
    document, env, player, watch, layer, video, controls, controlHost, right, session, state, cues, sessions, states,
    bridge, config, controller, requests, seeks, subscribers, flush, emit,
    notify(id = session.id) { for (const callback of subscribers) callback(id); },
    panel() { return document.getElementById('kuai-subtitle-sidebar-' + session.id); },
    toggleButton() { return controls.querySelector('[data-kuai-subtitle-sidebar-toggle]')?.shadowRoot?.querySelector('button'); },
  };
}

module.exports = { createFixture, emit, Element, Video, rect };
