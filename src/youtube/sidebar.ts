import type {CaptionCue,SubtitleBridge,SubtitleSession,SubtitleBridgeConfig} from './types.js';
interface SidebarRow {cue:CaptionCue;index:number;row:HTMLElement;time:HTMLButtonElement;original:HTMLElement;translation:HTMLElement;status:HTMLElement;body:HTMLElement}
interface SidebarEntry {
 session:SubtitleSession;video:HTMLVideoElement;open:boolean;follow:boolean;forceFollow:boolean;programmaticTop:number|null;
 rows:Map<number,SidebarRow>;cues:CaptionCue[];offsets:number[];heights:number[];failedRequests:WeakSet<CaptionCue>;start:number;end:number;active:number;
 source?:CaptionCue[];sourceLength?:number;version?:number;seekError?:boolean;dispose?:()=>void;observer?:MutationObserver;resizeObserver?:ResizeObserver;
 toggleHost?:HTMLElement|null;anchor?:HTMLElement|null;toggleButton?:HTMLButtonElement;
 panel:HTMLElement;title:HTMLElement;closeButton:HTMLButtonElement;count:HTMLElement;followButton:HTMLButtonElement;followState:HTMLElement;status:HTMLElement;retryButton:HTMLButtonElement;search:HTMLInputElement;viewButtons:Map<SidebarView,HTMLButtonElement>;list:HTMLElement;rowsHost:HTMLElement;topSpacer:HTMLElement;bottomSpacer:HTMLElement;
}
type SidebarView='both'|'original'|'translation';
interface SidebarTranslationJob {entry:SidebarEntry;source:CaptionCue[]|undefined;version:number|undefined;batch:CaptionCue[];refused:boolean}
/* YouTube subtitle list. Runs in the extension's isolated content-script world. */
import {applySubtitleMask} from './presentation.js';
import {subtitleWords,type SubtitleWords} from './i18n.js';
import {timelineStatus} from './status.js';
const root = globalThis;
"use strict";

const panelStyle = `
  :host{--reading-surface:#fff;--reading-text:#202124;--reading-muted:#606060;--reading-border:#e5e7eb;--reading-hover:#f1f3f5;--reading-accent:#065fd4;display:block;box-sizing:border-box;margin-bottom:16px;color:var(--yt-spec-text-primary,var(--reading-text));font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:left;color-scheme:light dark}
  @media(prefers-color-scheme:dark){:host{--reading-surface:#0f0f0f;--reading-text:#f1f1f1;--reading-muted:#aaa;--reading-border:#303030;--reading-hover:#272727;--reading-accent:#3ea6ff}}
  :host([hidden]){display:none!important}
  :host([data-placement="drawer"]){position:absolute;top:12px;right:12px;bottom:64px;width:min(370px,calc(100% - 24px));margin:0;z-index:2300}
  *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;user-select:none;-webkit-user-select:none}
  button:focus-visible,.subtitle-list:focus-visible,.translation-text:focus-visible{outline:2px solid var(--yt-spec-call-to-action,var(--reading-accent));outline-offset:-2px}
  .panel{display:flex;flex-direction:column;height:min(640px,70vh);min-height:220px;overflow:hidden;border:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));border-radius:12px;background:var(--yt-spec-base-background,var(--reading-surface))}
  :host([data-placement="drawer"]) .panel{height:100%;min-height:0;box-shadow:0 6px 28px #0005}
  .panel-header{display:flex;gap:10px;align-items:center;padding:10px 12px 4px;flex:none}
  .panel-title{margin:0;font-size:15px;line-height:24px;font-weight:600;flex:1}
  .close-panel{border:0;background:transparent;border-radius:50%;font-size:24px;line-height:28px;width:32px;height:32px;padding:0}
  .close-panel:hover{background:var(--yt-spec-badge-chip-background,var(--reading-hover))}
  .panel-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-height:34px;padding:0 12px 8px;border-bottom:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));flex:none}
  .cue-count,.follow-state{font-size:12px;color:var(--yt-spec-text-secondary,var(--reading-muted))}.cue-count{margin-right:auto}
  .follow-current{border:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));border-radius:6px;background:transparent;color:var(--yt-spec-call-to-action,var(--reading-accent));padding:3px 8px;font-size:12px;white-space:nowrap}
  .follow-current:hover{background:var(--yt-spec-badge-chip-background,var(--reading-hover))}
  .panel-status{margin:0;padding:20px 16px;color:var(--yt-spec-text-secondary,var(--reading-muted));font-size:13px}
  .retry-timeline{align-self:flex-start;margin:-8px 16px 16px;border:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));border-radius:6px;background:transparent;color:var(--yt-spec-call-to-action,var(--reading-accent));padding:3px 10px;font-size:12px}
  .retry-timeline:hover{background:var(--yt-spec-badge-chip-background,var(--reading-hover))}
  .panel-status[hidden],.retry-timeline[hidden],.subtitle-list[hidden],.follow-current[hidden],.follow-state[hidden]{display:none}
  .subtitle-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;overflow-anchor:none;scrollbar-width:thin;touch-action:pan-y;padding:0;position:relative}
  .cue{display:flex;gap:10px;padding:10px 12px 10px 10px;min-height:60px;border-left:2px solid transparent;border-bottom:1px solid var(--yt-spec-10-percent-layer,var(--reading-border))}
  .cue[aria-current="true"]{border-left:3px solid var(--yt-spec-call-to-action,var(--reading-accent));padding-left:9px;background:#3ea6ff24}
  .cue[aria-current="true"] .original-text{font-weight:600}
  .panel-filters{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));flex:none}
  .search{flex:1;min-width:0;height:28px;padding:0 10px;border:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));border-radius:14px;background:transparent;color:inherit;font:inherit;font-size:13px}
  .search:focus-visible{outline:2px solid var(--yt-spec-call-to-action,var(--reading-accent));outline-offset:-1px}
  .views{display:inline-flex;flex:none;border:1px solid var(--yt-spec-10-percent-layer,var(--reading-border));border-radius:14px;overflow:hidden}
  .views button{border:0;background:transparent;padding:4px 9px;font-size:12px;line-height:18px;color:var(--yt-spec-text-secondary,var(--reading-muted))}
  .views button[aria-pressed="true"]{background:var(--yt-spec-badge-chip-background,var(--reading-hover));color:var(--yt-spec-text-primary,var(--reading-text));font-weight:600}
  .timestamp{align-self:flex-start;flex:none;min-width:43px;border:0;border-radius:4px;background:transparent;color:var(--yt-spec-call-to-action,var(--reading-accent));padding:1px 3px;font-size:12px;font-variant-numeric:tabular-nums;line-height:20px}
  .timestamp:hover{background:var(--yt-spec-badge-chip-background,var(--reading-hover))}
  .cue-text{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
  .original-text,.translation-text{display:block;user-select:text!important;-webkit-user-select:text!important;cursor:text}
  .original-text[hidden],.translation-text[hidden]{display:none!important}
  .original-text{font-size:14px;line-height:1.55;font-weight:500;color:var(--yt-spec-text-primary,var(--reading-text))}
  .translation-text{font-size:13px;line-height:1.6;font-weight:400;color:var(--yt-spec-text-secondary,var(--reading-muted))}
  .translation-text:empty{display:none}
  .cue-status{font-size:11px;color:var(--yt-spec-text-secondary,var(--reading-muted));user-select:none;-webkit-user-select:none}.cue-status:empty{display:none}
  .spacer{height:0;pointer-events:none}
  @media(max-height:400px){:host([data-placement="drawer"]){top:6px;bottom:48px}.panel-header{padding-top:4px;padding-bottom:2px}.panel-tools{padding-bottom:4px}}
`;

function timestamp(time:number) {
  const seconds = Math.max(0, Math.floor(time));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return (hours ? hours + ":" + String(minutes).padStart(2, "0") : minutes) + ":" + String(seconds % 60).padStart(2, "0");
}

function cueAt(cues:CaptionCue[], time:number|undefined) {
  if (!Number.isFinite(time)) return -1;
  let low = 0, high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= time!) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  return index >= 0 && time! < cues[index].end ? index : -1;
}

function offsetIndex(offsets:number[], top:number) {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (offsets[middle] <= top) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, Math.max(0, offsets.length - 2));
}

function createController(bridge:SubtitleBridge, env = root) {
  const doc = env.document, entries = new Map<string,SidebarEntry>();
  let configuredOpen = bridge.getConfig?.()?.subtitleListOpen;
  // Reading-list filters are page-local; they never change the video captions.
  let query = "", view: SidebarView = "both";
  let preferredOpen = configuredOpen === true, preferenceVersion = 0, pendingPreference:{version:number}|null = null, stopped = false, started = false, frame:number|null = null, unsubscribe:(()=>void)|undefined, translationJob:SidebarTranslationJob|null = null;

  function labels() {
    return subtitleWords(bridge.getLanguage?.() || env.navigator?.language);
  }
  function held(entry:SidebarEntry) {
    return !!(bridge.isSelectionHeld?.(entry.session.id) || bridge.getState(entry.session.id)?.isSubtitleSelectionHeld);
  }
  function enabled(entry:SidebarEntry) {
    if (bridge.isEnabled) return bridge.isEnabled(entry.session);
    return bridge.getConfig?.()?.isEnable === "1" && entry.session.synchronizer?.isSyncEnabled !== false;
  }
  function element<K extends keyof HTMLElementTagNameMap>(tag:K, className?:string, text?:string):HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setText(node:HTMLElement, text:string) {
    if (node.textContent !== text) node.textContent = text;
  }
  function cancelSelectionOnPress(node:HTMLElement, entry:SidebarEntry, reason:string) {
    for (const type of ["pointerdown", "mousedown"]) {
      node.addEventListener(type, event => {
        // Default button focus can clear a selection before the click handler.
        if ((event as MouseEvent).button === 0) bridge.cancelSelection?.(entry.session.id, reason);
      });
    }
  }
  function schedule() {
    if (stopped || frame !== null) return;
    frame = env.requestAnimationFrame(() => {
      frame = null;
      if (!stopped) sync();
    });
  }
  function placement(entry:SidebarEntry) {
    const video = entry.video, player = video.closest?.(".html5-video-player") || video.parentElement;
    const fullscreen = doc.fullscreenElement;
    if (fullscreen?.contains(video)) {
      return { parent: fullscreen.contains(player) ? player : fullscreen, type: "drawer" };
    }
    const watch = video.closest?.("ytd-watch-flexy");
    // YouTube moves the early player into the watch layout asynchronously.
    // Defer a saved-open panel until that layout exists instead of painting a drawer.
    if(!watch&&new URL(env.location.href).pathname==='/watch')return {parent:null,type:"column"};
    const secondary = watch?.querySelector("#secondary-inner") || watch?.querySelector("#secondary");
    if (secondary?.isConnected) {
      const box = secondary.getBoundingClientRect(), style = env.getComputedStyle?.(secondary);
      if (box.width > 0 && style?.display !== "none" && style?.visibility !== "hidden") return { parent: secondary, type: "column" };
    }
    const watchPage=new URL(env.location.href).pathname==='/watch';
    const loading=doc.readyState==='loading'||doc.readyState==='interactive';
    if(watchPage&&!watch?.hasAttribute('theater')&&(loading||watch?.hasAttribute('is-two-columns_')))
      return {parent:null,type:"column"};
    return { parent: player, type: "drawer" };
  }

  function mountToggle(entry:SidebarEntry) {
    const anchor = doc.getElementById("kuai-subtitle-button-" + entry.session.id);
    if (!anchor?.isConnected) {
      entry.toggleHost?.remove(); entry.toggleHost = null; entry.anchor = null;
      return;
    }
    if (entry.toggleHost?.isConnected && entry.anchor === anchor) return;
    entry.toggleHost?.remove();
    entry.anchor = anchor;
    const host = element("span");
    host.dataset.kuaiSubtitleSidebarToggle = entry.session.id;
    host.dataset.noCaptionDrag = "true";
    host.style.cssText = "display:inline-flex;vertical-align:middle;align-items:center;height:100%;float:left;color:inherit;visibility:inherit;";
    const shadow = host.attachShadow({ mode: "open" }), style = element("style");
    style.textContent = ":host{color:inherit}button{box-sizing:border-box;width:36px;height:100%;min-height:28px;padding:5px;border:0;background:transparent;color:inherit;font:24px/1 sans-serif;cursor:pointer;opacity:.85}button:hover{opacity:1}button:focus-visible{outline:2px solid #7eb6ff;outline-offset:-3px}";
    const button = element("button", "subtitle-list-toggle", "☷");
    button.type = "button";
    button.setAttribute("aria-controls", "kuai-subtitle-sidebar-" + entry.session.id);
    button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); toggle(entry.session.id);
    });
    for (const type of ["pointerdown", "mousedown", "dblclick"]) host.addEventListener(type, event => event.stopPropagation());
    shadow.append(style, button);
    anchor.parentNode!.insertBefore(host, anchor);
    entry.toggleHost = host; entry.toggleButton = button;
  }

  function stopFollowing(entry:SidebarEntry) {
    entry.follow = false; entry.forceFollow = false; entry.programmaticTop = null;
    updateFollow(entry);
  }
  function updateFollow(entry:SidebarEntry) {
    if (!entry.followButton) return;
    const text = labels();
    const unavailable = entry.list.hidden || !entry.cues.length;
    setText(entry.followButton, text.follow);
    entry.followButton.hidden = entry.follow || unavailable;
    entry.followButton.setAttribute("aria-label", text.follow);
    entry.followButton.title = text.follow;
    setText(entry.followState, entry.follow ? text.following : text.reading);
    entry.followState.hidden = unavailable;
  }

  function mountPanel(entry:SidebarEntry) {
    if (!entry.panel) {
      const host = element("section");
      host.id = "kuai-subtitle-sidebar-" + entry.session.id;
      host.dataset.noCaptionDrag = "true";
      host.setAttribute("role", "region");
      const shadow = host.attachShadow({ mode: "open" }), style = element("style");
      style.textContent = panelStyle;
      const panel = element("section", "panel"), header = element("header", "panel-header");
      const title = element("h2", "panel-title"), close = element("button", "close-panel", "×");
      close.type = "button";
      cancelSelectionOnPress(close, entry, "sidebar-close-intent");
      close.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation(); toggle(entry.session.id, false);
        entry.toggleButton?.focus();
      });
      header.append(title, close);
      const tools = element("div", "panel-tools"), count = element("span", "cue-count"), followState = element("span", "follow-state"), follow = element("button", "follow-current");
      followState.setAttribute("role", "status"); followState.setAttribute("aria-atomic", "true");
      follow.type = "button";
      cancelSelectionOnPress(follow, entry, "sidebar-follow-intent");
      follow.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        bridge.cancelSelection?.(entry.session.id, "sidebar-follow");
        entry.list.focus({ preventScroll: true });
        entry.follow = true; entry.forceFollow = true; schedule();
      });
      tools.append(count, followState, follow);
      const filters = element("div", "panel-filters"), search = element("input", "search"), views = element("div", "views"), viewButtons = new Map<SidebarView,HTMLButtonElement>();
      search.type = "search"; search.autocomplete = "off"; search.value = query;
      search.addEventListener("input", () => { setQuery(search.value); });
      // YouTube's page shortcuts must not see typing in the reading list.
      search.addEventListener("keydown", event => {
        if (event.key === "Escape" && search.value) { event.preventDefault(); search.value = ""; setQuery(""); }
        event.stopPropagation();
      });
      views.setAttribute("role", "group");
      for (const value of ["both", "original", "translation"] as const) {
        const button = element("button"); button.type = "button"; button.dataset.view = value;
        button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); view = value; for (const current of entries.values()) refresh(current); });
        views.append(button); viewButtons.set(value, button);
      }
      filters.append(search, views);
      const status = element("p", "panel-status"), list = element("div", "subtitle-list"), retry = element("button", "retry-timeline");
      status.setAttribute("role", "status"); list.tabIndex = 0;
      retry.type = "button"; retry.hidden = true;
      cancelSelectionOnPress(retry, entry, "sidebar-retry-intent");
      retry.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        bridge.retryTimeline?.(entry.session.id); schedule();
      });
      const top = element("div", "spacer"), rows = element("div", "cue-rows"), bottom = element("div", "spacer");
      top.setAttribute("aria-hidden", "true"); bottom.setAttribute("aria-hidden", "true"); rows.setAttribute("role", "list");
      list.append(top, rows, bottom);
      list.addEventListener("scroll", () => {
        const ownScroll = entry.programmaticTop !== null && Math.abs(list.scrollTop - entry.programmaticTop) < 2;
        entry.programmaticTop = null;
        if (!ownScroll) stopFollowing(entry);
        schedule();
      });
      for (const type of ["wheel", "touchmove"]) list.addEventListener(type, () => stopFollowing(entry), { passive: true });
      list.addEventListener("keydown", event => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stopFollowing(entry);
      });
      // Preserve selection defaults and mouseup propagation to selection translation.
      for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) host.addEventListener(type, event => event.stopPropagation());
      // In fullscreen, YouTube's player scrolls its recommendation grid on any wheel
      // that reaches it; its own menus stop wheel propagation the same way.
      for (const type of ["wheel", "touchmove"]) host.addEventListener(type, event => event.stopPropagation(), { passive: true });
      panel.append(header, tools, filters, status, retry, list); shadow.append(style, panel);
      Object.assign(entry, { panel: host, title, closeButton: close, count, followButton: follow, followState, status, retryButton: retry, search, viewButtons, list, rowsHost: rows, topSpacer: top, bottomSpacer: bottom });
      if (env.ResizeObserver) {
        entry.resizeObserver = new env.ResizeObserver(schedule);
        entry.resizeObserver.observe(list);
        const watch=entry.video.closest?.('ytd-watch-flexy');
        if(watch)entry.resizeObserver.observe(watch);
      }
    }
    const target = placement(entry);
    entry.panel.dataset.placement = target.type;
    if (target.parent && entry.panel.parentNode !== target.parent) {
      if (target.type === "column") target.parent.insertBefore(entry.panel, target.parent.firstChild);
      else target.parent.appendChild(entry.panel);
    }
    entry.panel.hidden = !target.parent;
    return !!target.parent&&entry.panel.isConnected;
  }

  function matches(cue:CaptionCue) {
    return !query || cue.text.toLowerCase().includes(query) || !!cue.translation?.toLowerCase().includes(query);
  }
  function setQuery(value:string) {
    const next = value.trim().toLowerCase();
    if (next === query) return;
    query = next;
    for (const entry of entries.values()) {
      if (entry.search && entry.search.value.trim().toLowerCase() !== query) entry.search.value = value;
      if (entry.rowsHost) { resetTimeline(entry, entry.source); entry.list.scrollTop = 0; }
    }
    schedule();
  }
  function resetTimeline(entry:SidebarEntry, source:CaptionCue[]|undefined) {
    entry.source = source; entry.sourceLength = source?.length || 0;
    entry.cues = Array.from(source || []).filter(cue => cue && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && typeof cue.text === "string" && cue.text.trim() && matches(cue)).sort((a, b) => a.start - b.start);
    entry.heights = entry.cues.map(() => 96);
    entry.offsets = Array.from({ length: entry.cues.length + 1 }, (_, index) => index * 96);
    entry.rows.clear(); entry.rowsHost.replaceChildren();
    entry.start = -1; entry.end = -1; entry.active = -1;
    entry.failedRequests = new WeakSet(); entry.forceFollow = entry.follow; entry.seekError = false;
  }
  function makeRow(entry:SidebarEntry, cue:CaptionCue, index:number) {
    const row = element("article", "cue"), time = element("button", "timestamp", timestamp(cue.start));
    row.setAttribute("role", "listitem"); time.type = "button";
    cancelSelectionOnPress(time, entry, "sidebar-seek-intent");
    const body = element("div", "cue-text"), original = element("span", "original-text"), translation = element("span", "translation-text"), status = element("span", "cue-status");
    for (const text of [original, translation]) {
      text.dataset.kuaiSubtitleText = "true";
      // Keep source line breaks in the data while wrapping at the reading width.
      text.style.setProperty("white-space", "normal", "important");
      text.style.setProperty("overflow-wrap", "anywhere", "important");
    }
    time.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      try {
        entry.seekError = bridge.seek(entry.session.id, cue.start) === false;
        if (!entry.seekError) entry.forceFollow = entry.follow;
      } catch { entry.seekError = true; }
      schedule();
    });
    body.append(original, translation, status); row.append(time, body);
    return { cue, index, row, time, original, translation, status, body };
  }
  function setHeight(node:HTMLElement, height:number) {
    const text = Math.max(0, height) + "px";
    if (node.style.height !== text) node.style.height = text;
  }
  function updateSpacers(entry:SidebarEntry) {
    setHeight(entry.topSpacer, entry.offsets[Math.max(0, entry.start)] || 0);
    setHeight(entry.bottomSpacer, (entry.offsets.at(-1) || 0) - (entry.offsets[Math.max(0, entry.end)] || 0));
  }
  function renderWindow(entry:SidebarEntry, scrollTop:number) {
    const length = entry.cues.length, height = entry.list.clientHeight || 400;
    const start = Math.max(0, offsetIndex(entry.offsets, scrollTop) - 4);
    const end = Math.min(length, start + 60, offsetIndex(entry.offsets, scrollTop + height) + 5);
    if (entry.start !== start || entry.end !== end) {
      for (const [index, item] of entry.rows) {
        if (index < start || index >= end) { item.row.remove(); entry.rows.delete(index); }
      }
      let cursor = entry.rowsHost.firstChild;
      for (let index = start; index < end; index++) {
        let item = entry.rows.get(index);
        if (!item) { item = makeRow(entry, entry.cues[index], index); entry.rows.set(index, item); }
        if (cursor === item.row) cursor = cursor.nextSibling;
        else entry.rowsHost.insertBefore(item.row, cursor);
      }
      entry.start = start; entry.end = end;
    }
    updateSpacers(entry);
  }
  function patchRows(entry:SidebarEntry, active:number, config:SubtitleBridgeConfig, text:SubtitleWords) {
    // The study mask is shared; video typography, boxes and display order are not.
    const hideTranslation = config.subtitleStyle ? config.subtitleStyle.hideTranslation === true : config.hideTranslation === "1";
    for (const [index, item] of entry.rows) {
      const cue = item.cue;
      setText(item.original, cue.text);
      setText(item.translation, typeof cue.translation === "string" ? cue.translation : "");
      // The translation view still shows the source until its translation exists.
      item.original.hidden = view === "translation" && !!cue.translation;
      item.translation.hidden = item.status.hidden = view === "original";
      setText(item.status, cue.status === "error" ? text.error : cue.status === "translating" ? text.translating : !cue.translation ? text.pending : "");
      item.status.title = cue.status === "error" ? String(cue.errorMessage || "") : "";
      item.time.title = text.seek + " " + timestamp(cue.start);
      item.time.setAttribute("aria-label", item.time.title);
      item.row.setAttribute("aria-posinset", String(index + 1));
      item.row.setAttribute("aria-setsize", String(entry.cues.length));
      if (index === active) item.row.setAttribute("aria-current", "true");
      else item.row.removeAttribute("aria-current");
      applySubtitleMask(item.translation, hideTranslation);
    }
  }
  function measureRows(entry:SidebarEntry) {
    let firstChanged = entry.cues.length;
    for (const [index, item] of entry.rows) {
      const height = item.row.getBoundingClientRect().height;
      if (height > 0 && Math.abs(height - entry.heights[index]) > 0.5) {
        entry.heights[index] = height; firstChanged = Math.min(firstChanged, index);
      }
    }
    if (firstChanged === entry.cues.length) return false;
    for (let index = firstChanged; index < entry.cues.length; index++) entry.offsets[index + 1] = entry.offsets[index] + entry.heights[index];
    updateSpacers(entry); return true;
  }
  function scrollTo(entry:SidebarEntry, top:number) {
    const maximum = Math.max(0, (entry.offsets.at(-1) || 0) - entry.list.clientHeight);
    const next = Math.max(0, Math.min(maximum, top));
    if (Math.abs(entry.list.scrollTop - next) > 0.5) {
      entry.programmaticTop = next;
      entry.list.scrollTop = next;
    }
  }

  function requestVisible(entry:SidebarEntry) {
    if (translationJob || view === "original" || !entry.open || held(entry) || !enabled(entry) || doc.visibilityState === "hidden" || !entry.panel?.isConnected || entry.video.seeking || entry.video.closest?.(".ad-showing, .ad-interrupting")) return;
    const bounds = entry.list.getBoundingClientRect();
    const top = Math.max(0, bounds.top), bottom = Math.min(env.innerHeight || Infinity, bounds.bottom);
    if (bounds.width <= 0 || bottom <= top || bounds.right <= 0 || bounds.left >= (env.innerWidth || Infinity)) return;
    const batch:CaptionCue[] = [];
    for (const item of entry.rows.values()) {
      const cue = item.cue;
      if ((cue.status && cue.status !== "pending") || entry.failedRequests.has(cue)) continue;
      const box = item.row.getBoundingClientRect();
      if (box.bottom > top && box.top < bottom) batch.push(cue);
      if (batch.length === 12) break;
    }
    if (!batch.length || !bridge.translateCues) return;
    const job = { entry, source: entry.source, version: entry.version, batch, refused: false };
    translationJob = job;
    let result;
    try { result = bridge.translateCues(entry.session.id, batch); }
    catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(value => {
      if (value === false) { job.refused = true; return; }
      if (entry.source !== job.source || entry.version !== job.version) return;
      // A provider may apply its own smaller batch limit. Only stop a no-progress batch.
      if (batch.every(cue => !cue.status || cue.status === "pending")) batch.forEach(cue => entry.failedRequests.add(cue));
    }, () => {
      if (entry.source === job.source && entry.version === job.version) batch.forEach(cue => entry.failedRequests.add(cue));
    }).finally(() => {
      if (translationJob === job) translationJob = null;
      if (!job.refused && !stopped && Array.from(entries.values()).some(current => current.open && !held(current))) schedule();
    });
  }

  function refresh(entry:SidebarEntry) {
    mountToggle(entry);
    const text = labels();
    if (entry.toggleButton) {
      entry.toggleButton.title = text.listTitle;
      entry.toggleButton.setAttribute("aria-label", text.listTitle);
      entry.toggleButton.setAttribute("aria-expanded", String(entry.open));
      entry.toggleButton.style.opacity=entry.open?"1":".55";entry.toggleButton.style.background="transparent";entry.toggleButton.style.color="#fff";
    }
    if (!entry.open) { if (entry.panel) entry.panel.hidden = true; return; }
    // Moving even a shadow host can invalidate the browser's live selection.
    // A hold only freezes the list: selecting a word on the video is not manual reading.
    if (held(entry)) return;
    if (!mountPanel(entry)) {entry.panel.hidden=true;return;}
    entry.panel.setAttribute("aria-label", text.listTitle);
    setText(entry.title, text.listTitle);
    entry.closeButton.title = text.listClose; entry.closeButton.setAttribute("aria-label", text.listClose);
    const config = bridge.getConfig?.() || {}, state = bridge.getState(entry.session.id);
    const source = state?.subtitlesList;
    if (source !== entry.source || source?.length !== entry.sourceLength) resetTimeline(entry, source);
    if (entry.version !== state?.translateVersion) { entry.version = state?.translateVersion; entry.failedRequests = new WeakSet(); }
    setText(entry.count, entry.cues.length + " " + (query ? text.matches : text.count));
    entry.search.placeholder = text.search; entry.search.setAttribute("aria-label", text.search);
    entry.viewButtons.get("both")!.parentElement!.setAttribute("aria-label", text.view);
    for (const [value, button] of entry.viewButtons) {
      setText(button, value === "both" ? text.viewBoth : value === "original" ? text.viewOriginal : text.viewTranslation);
      button.setAttribute("aria-pressed", String(view === value));
    }
    const status = timelineStatus({ enabled: enabled(entry), subtitlesEnabled: config.isEnable === "1", state, video: entry.video }), failed = status === "failed";
    const reason = { disabled: text.disabled, "captions-off": text.nativeDisabled, failed: text.failed, live: text.unavailable, loading: text.loading, ready: "" }[status];
    const statusMessage = reason || (query && !entry.cues.length ? text.noMatches : "") || (entry.seekError ? text.seekError : "");
    entry.status.hidden = !statusMessage; setText(entry.status, statusMessage);
    entry.retryButton.hidden = !failed || !bridge.retryTimeline; setText(entry.retryButton, text.retry);
    entry.list.hidden = !!reason;
    entry.list.setAttribute("aria-label", text.listTitle);
    updateFollow(entry);
    if (reason || doc.visibilityState === "hidden") return;
    // The caption renderer may retain an earlier timestamp for repeated text.
    const time = Number.isFinite(entry.video.currentTime) ? entry.video.currentTime : state?.currentCaption?.start;
    const active = cueAt(entry.cues, time);
    const follow = entry.follow && active >= 0 && (entry.forceFollow || active !== entry.active);
    const viewHeight = entry.list.clientHeight || 400;
    let top = entry.list.scrollTop;
    const anchor = offsetIndex(entry.offsets, top), anchorWithin = top - entry.offsets[anchor];
    if (follow) top = Math.max(0, entry.offsets[active] - viewHeight * 0.3);
    renderWindow(entry, top); patchRows(entry, active, config, text);
    const measured = measureRows(entry);
    if (follow) top = Math.max(0, entry.offsets[active] - viewHeight * 0.3);
    else if (measured) top = entry.offsets[anchor] + anchorWithin;
    renderWindow(entry, top); patchRows(entry, active, config, text); measureRows(entry);
    if (follow || measured) scrollTo(entry, top);
    entry.active = active; entry.forceFollow = false;
    requestVisible(entry);
  }

  function createEntry(session:SubtitleSession) {
    const entry = { session, video: session.video, open: preferredOpen, follow: true, forceFollow: true, programmaticTop: null, rows: new Map<number,SidebarRow>(), cues: [], offsets: [0], failedRequests: new WeakSet(), start: -1, end: -1 } as unknown as SidebarEntry;
    const events = ["timeupdate", "seeked", "loadedmetadata", "durationchange", "emptied", "play", "pause"];
    events.forEach(type => entry.video.addEventListener(type, schedule));
    entry.dispose = () => events.forEach(type => entry.video.removeEventListener(type, schedule));
    if (env.MutationObserver) {
      entry.observer = new env.MutationObserver(() => {
        const anchor = doc.getElementById("kuai-subtitle-button-" + session.id);
        const target = entry.open && !held(entry) ? placement(entry).parent : null;
        if (!entry.video.isConnected || anchor !== entry.anchor || (anchor && !entry.toggleHost?.isConnected) || (entry.open && (!entry.panel?.isConnected || (target && target !== entry.panel.parentNode)))) schedule();
      });
      const watch = entry.video.closest?.("ytd-watch-flexy") || entry.video.closest?.(".html5-video-player") || entry.video.parentElement;
      if (watch) entry.observer.observe(watch, { childList: true, subtree: true, attributes:true, attributeFilter:["theater","is-two-columns_"] });
    }
    return entry;
  }
  function remove(entry:SidebarEntry, reason:string) {
    bridge.cancelSelection?.(entry.session.id, reason);
    entry.dispose?.(); entry.observer?.disconnect(); entry.resizeObserver?.disconnect();
    entry.toggleHost?.remove(); entry.panel?.remove(); entry.rows.clear();
  }
  function sync() {
    if (stopped) return;
    const savedOpen = bridge.getConfig?.()?.subtitleListOpen;
    if (typeof savedOpen === 'boolean' && savedOpen !== configuredOpen) {
      configuredOpen = savedOpen;
      if (!pendingPreference) {
        preferredOpen = savedOpen;
        for (const entry of entries.values()) setOpen(entry, savedOpen);
      }
    }
    const sessions = new Map(Array.from(bridge.getSessions(), session => [session.id, session]));
    for (const [id, entry] of entries) {
      if (sessions.get(id) !== entry.session || entry.video !== entry.session.video || !entry.video.isConnected) {
        remove(entry, "sidebar-remove"); entries.delete(id);
      }
    }
    for (const session of sessions.values()) {
      if (session.rule?.id !== "youtube" || !session.video?.isConnected) continue;
      if (!entries.has(session.id)) entries.set(session.id, createEntry(session));
      refresh(entries.get(session.id)!);
    }
  }
  function setOpen(entry:SidebarEntry, open:boolean) {
    if (entry.open === open) return;
    entry.open = open;
    if (!open) bridge.cancelSelection?.(entry.session.id, "sidebar-close");
    else entry.forceFollow = entry.follow;
  }
  function finishPreference(version:number, error?:unknown) {
    if (stopped || pendingPreference?.version !== version) return;
    pendingPreference = null;
    const savedOpen = bridge.getConfig?.()?.subtitleListOpen;
    if (typeof savedOpen === 'boolean') {
      configuredOpen = preferredOpen = savedOpen;
      for (const entry of entries.values()) { setOpen(entry, savedOpen); refresh(entry); }
    }
    if (error) bridge.reportPreferenceError?.(error);
  }
  function toggle(id:string, open?:boolean) {
    const entry = entries.get(id);
    if (!entry || stopped) return false;
    const nextOpen = open === undefined ? !entry.open : !!open;
    if (entry.open === nextOpen) return nextOpen;
    preferredOpen = nextOpen;setOpen(entry, nextOpen);
    if (bridge.saveSidebarOpen) {
      const version = ++preferenceVersion;pendingPreference = {version};
      Promise.resolve().then(() => bridge.saveSidebarOpen!(nextOpen)).then(() => finishPreference(version), error => finishPreference(version, error));
    }
    refresh(entry); return nextOpen;
  }
  function getSelectionRoots(id:string) {
    const entry = entries.get(id);
    if (!entry?.open || !entry.panel?.isConnected || entry.panel.hidden || entry.list?.hidden || !enabled(entry)) return [];
    return Array.from(entry.rows.values()).flatMap(item => [item.original, item.translation]).filter(node => node.isConnected && !node.hidden && node.textContent);
  }
  function start() {
    if (started || stopped) return controller;
    started = true;
    unsubscribe = bridge.subscribe?.(schedule);
    doc.addEventListener("readystatechange", schedule);
    doc.addEventListener("fullscreenchange", schedule);
    doc.addEventListener("visibilitychange", schedule);
    env.addEventListener("resize", schedule);
    env.addEventListener("scroll", schedule, true);
    env.addEventListener("pageshow", schedule);
    env.addEventListener("pagehide", stop);
    sync(); return controller;
  }
  function stop(event?:PageTransitionEvent) {
    if (event?.persisted || stopped) return;
    stopped = true; pendingPreference = null; preferenceVersion++; unsubscribe?.();
    if (frame !== null) env.cancelAnimationFrame?.(frame);
    frame = null;
    doc.removeEventListener("readystatechange", schedule);
    doc.removeEventListener("fullscreenchange", schedule);
    doc.removeEventListener("visibilitychange", schedule);
    env.removeEventListener("resize", schedule);
    env.removeEventListener("scroll", schedule, true);
    env.removeEventListener("pageshow", schedule);
    env.removeEventListener("pagehide", stop);
    entries.forEach(entry => remove(entry, "sidebar-stop")); entries.clear();
  }
  const controller = { start, stop, sync, toggle, getSelectionRoots };
  return controller;
}

let singleton:ReturnType<typeof createController>|undefined;
const api = {
  createController,
  start(bridge:SubtitleBridge) { singleton?.stop(); singleton = createController(bridge).start(); return singleton; },
  getSelectionRoots(id:string) { return singleton?.getSelectionRoots(id) || []; },
  sync() { singleton?.sync(); },
};
export { createController };
export default api;
