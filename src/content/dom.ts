import type {Settings} from '../shared/settings.js';
import type {TranslationOptions} from '../shared/messages.js';

export type BrowserEnvironment = typeof globalThis;
export type CodedError = Error & {code?: string};
export interface PageBlock {element: HTMLElement; text: string}

/** Browser-facing helpers shared by the native page and selection controllers. */
// Docs renderers such as Mintlify emit paragraphs as `<span data-as="p">`; without it, a whole article reads as one block.
export const BLOCK_SELECTOR = 'p,div,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dt,dd,article,section,[slot="title"],[role="heading"],[data-as="p"]';
const EXCLUDED_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','PRE','TEXTAREA','INPUT','SELECT','OPTION','BUTTON','SVG','MATH','VIDEO','AUDIO','CANVAS']);

export function parentElement(node: unknown): HTMLElement | null {
  return (node as Node | null | undefined)?.nodeType === 1 ? node as HTMLElement : (node as Node | null | undefined)?.parentElement || ((node as Node | null | undefined)?.getRootNode?.() as ShadowRoot | undefined)?.host as HTMLElement || null;
}

export function ancestors(node: unknown): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let current = parentElement(node); current; current = current.parentElement || (current.getRootNode?.() as ShadowRoot | undefined)?.host as HTMLElement) result.push(current);
  return result;
}

function editableElement(element: HTMLElement): boolean {
  const editable = element.getAttribute?.('contenteditable');
  return element.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(element.tagName) ||
    (editable !== null && editable !== undefined && editable !== 'false') || element.getAttribute?.('role') === 'textbox';
}

export function isEditable(node: unknown): boolean {
  return ancestors(node).some(editableElement);
}

export function isOwnedUI(node: unknown): boolean {
  return ancestors(node).some(element => element.hasAttribute?.('data-kuai-ui'));
}

type StyleSnapshot = Partial<Pick<CSSStyleDeclaration,'display'|'visibility'|'position'|'clip'|'clipPath'|'overflow'|'color'|'textDecorationLine'>>;
interface LayoutCache {styles:WeakMap<Element,StyleSnapshot|undefined>;rendered:WeakMap<Element,boolean>}
let layoutCache: LayoutCache | null = null;

/**
 * Reuse style and box reads for the rest of one synchronous pass. Rendering a row
 * inserts nodes; on CSS-heavy pages each later read would otherwise restyle the
 * whole document. Our rows never change a page element's visibility or link style.
 */
export function withLayoutCache<T>(run: () => T): T {
  if (layoutCache) return run();
  layoutCache = {styles:new WeakMap(),rendered:new WeakMap()};
  try { return run(); } finally { layoutCache = null; }
}

export function computedStyle(element: Element, env: BrowserEnvironment): StyleSnapshot | undefined {
  if (!layoutCache) return env.getComputedStyle?.(element);
  if (layoutCache.styles.has(element)) return layoutCache.styles.get(element);
  const style = env.getComputedStyle?.(element);
  const snapshot = style && {display:style.display,visibility:style.visibility,position:style.position,clip:style.clip,clipPath:style.clipPath,overflow:style.overflow,color:style.color,textDecorationLine:style.textDecorationLine};
  layoutCache.styles.set(element,snapshot);return snapshot;
}

// Some screen-reader labels use an empty overflow-hidden box instead of clip.
function emptyBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect?.();
  return !!rect && (rect.width < 1 || rect.height < 1);
}

function rendered(element: HTMLElement): boolean {
  if (!element.getClientRects) return true;
  if (layoutCache?.rendered.has(element)) return layoutCache.rendered.get(element)!;
  const value = element.getClientRects().length > 0;
  layoutCache?.rendered.set(element,value);return value;
}

export function isReadable(element: HTMLElement | null | undefined, env: BrowserEnvironment, {allowOriginal=false}: {allowOriginal?:boolean}={}): boolean {
  if (!element?.isConnected) return false;
  let hiddenByTranslation=false;
  for (const ancestor of ancestors(element)) {
    if(allowOriginal&&ancestor.hasAttribute?.('data-kuai-original')){hiddenByTranslation=true;continue;}
    if (EXCLUDED_TAGS.has(ancestor.tagName) || ancestor.hasAttribute?.('data-kuai-owned') ||
        ancestor.getAttribute?.('translate') === 'no' || ancestor.getAttribute?.('aria-hidden') === 'true' ||
        ancestor.className?.split?.(/\s+/).includes('html5-video-player') || editableElement(ancestor)) return false;
    const style = computedStyle(ancestor,env);
    // Accessibility-only copies can have a layout box while all their pixels are clipped.
    const clip=style?.clip?.match(/^rect\(([^)]+)\)$/)?.[1].split(/[\s,]+/).filter(Boolean).map(value=>parseFloat(value));
    if(clip?.length===4&&['absolute','fixed'].includes(style?.position||'')&&(clip[1]<=clip[3]||clip[2]<=clip[0])||/^inset\(50%(?:\s+50%){0,3}\)$/.test(style?.clipPath||''))return false;
    if(['absolute','fixed'].includes(style?.position||'')&&/^(hidden|clip)/.test(style?.overflow||'')&&emptyBox(ancestor))return false;
    // Inline code belongs to its sentence (`run ~/.codex`); block code without <pre> stays untranslated.
    if (ancestor.tagName === 'CODE' && style?.display && !style.display.startsWith('inline')) return false;
    if (ancestor.hidden || style?.display === 'none' || ['hidden','collapse'].includes(style?.visibility as string)) return false;
  }
  return hiddenByTranslation || rendered(element);
}

/**
 * A tag block, or any box taken out of flow: an absolutely positioned card title or
 * banner caption is laid out apart from its ancestor's text, even when it is an <a> or <strong>.
 */
export function isBlock(element: Element, env: BrowserEnvironment): boolean {
  if (element.matches?.(BLOCK_SELECTOR)) return true;
  const position = computedStyle(element,env)?.position;
  return position === 'absolute' || position === 'fixed';
}

export function closestBlock(element: Element | null | undefined, env: BrowserEnvironment): HTMLElement | null {
  for (let node = element; node; node = node.parentElement) if (isBlock(node,env)) return node as HTMLElement;
  return null;
}

export function blocksWithin(root: ParentNode, env: BrowserEnvironment): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter(element => isBlock(element,env));
}

/** Read a block without including nested blocks or our appended translation. */
export function blockText(element: HTMLElement, env: BrowserEnvironment): string {
  const read = (node: Node): string => {
    if (node.nodeType === 3) return node.nodeValue || node.textContent || '';
    if (node.nodeType !== 1) return '';
    if (node !== element && (isBlock(node as HTMLElement, env) || !isReadable(node as HTMLElement, env,{allowOriginal:true}))) return '';
    if ((node as HTMLElement).tagName === 'BR') return '\n';
    return Array.from(node.childNodes || [], read).join('');
  };
  return read(element).replace(/\s+/gu, ' ').trim();
}

/** Include only pixels visible in the viewport and clipping scroll ancestors. */
export function isInViewport(element: HTMLElement,env: BrowserEnvironment): boolean{
  const rect=element.getBoundingClientRect?.();
  if(!rect||![rect.top,rect.bottom,rect.left,rect.right].every(Number.isFinite))return true;
  let top=Math.max(0,rect.top),bottom=Math.min(env.innerHeight||800,rect.bottom),left=Math.max(0,rect.left),right=Math.min(env.innerWidth||1200,rect.right);
  if(bottom<=top||right<=left)return false;
  for(const ancestor of ancestors(element).slice(1)){
    const style=env.getComputedStyle?.(ancestor),clipY=/^(auto|scroll|hidden|clip)$/.test(style?.overflowY||style?.overflow||''),clipX=/^(auto|scroll|hidden|clip)$/.test(style?.overflowX||style?.overflow||'');
    if(!clipX&&!clipY)continue;
    const bounds=ancestor.getBoundingClientRect?.();if(!bounds)continue;
    if(clipY){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}
    if(clipX){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}
    if(bottom<=top||right<=left)return false;
  }
  return true;
}

export function collectBlocks(document: Document, env: BrowserEnvironment, {visibleOnly=false}: {visibleOnly?:boolean}={}): PageBlock[] {
  const body = document.body;
  if (!body) return [];
  return withLayoutCache(() => [body, ...blocksWithin(body,env)]
    .filter(element => (!visibleOnly||isInViewport(element,env))&&isReadable(element, env))
    .map(element => ({ element, text:blockText(element, env) }))
    .filter(item => item.text && /\p{L}/u.test(item.text)));
}

/** Split by Unicode characters rather than cutting a surrogate pair. */
export function splitText(text: unknown, limit = 1800): string[] {
  const parts: string[] = []; let part = '';
  for (const character of String(text)) {
    if (part.length + character.length > limit && part) { parts.push(part); part = ''; }
    part += character;
  }
  if (part) parts.push(part);
  return parts;
}

export function batches<T extends {text:string}>(items: Iterable<T>): T[][];
export function batches<T>(items: Iterable<T>, textOf: (item:T)=>string): T[][];
export function batches<T>(items: Iterable<T>, textOf: (item:T)=>string = item => (item as {text:string}).text): T[][] {
  const result: T[][] = []; let batch: T[] = [], length = 0;
  for (const item of items) {
    const size = textOf(item).length;
    if (batch.length && (batch.length >= 8 || length + size > 6000)) { result.push(batch); batch = []; length = 0; }
    batch.push(item); length += size;
  }
  if (batch.length) result.push(batch);
  return result;
}

export function translationsOf(response: unknown, expected: number): string[] {
  const values = (response as {translations?:unknown} | null | undefined)?.translations;
  if (!Array.isArray(values) || values.length !== expected || values.some(value => typeof value !== 'string' || !value.trim())) {
    const error = new Error('翻译服务返回了空译文或无效结果，请重试或切换服务。') as CodedError;
    error.code = 'INVALID_RESPONSE'; throw error;
  }
  return values as string[];
}

export function requestOptions(settings: Settings, requestId: string): TranslationOptions {
  return { requestId, providerId:settings.activeProviderId, sourceLanguage:settings.sourceLanguage, targetLanguage:settings.targetLanguage };
}

export function configurationKey(settings: Partial<Settings>): string {
  const provider = settings.providers?.find(item => item.id === settings.activeProviderId);
  return JSON.stringify([settings.activeProviderId, settings.sourceLanguage, settings.targetLanguage,settings.providerRevision??0, provider?.model, provider?.type, provider?.enabled]);
}

export function makeId(): string { return 'page-' + globalThis.crypto.randomUUID(); }
export function isChinese(settings: Settings, env: BrowserEnvironment): boolean {
  const language = settings.interfaceLanguage;
  return /^zh/i.test(language && language !== 'auto' ? language : env.navigator?.language || 'en');
}
