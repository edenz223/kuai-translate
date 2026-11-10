import {sourceText} from './source-text.js';
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

type StyleSnapshot = Partial<Pick<CSSStyleDeclaration,'display'|'visibility'|'position'|'clip'|'clipPath'|'overflow'|'color'|'textDecorationLine'|'overflowX'|'overflowY'|'transform'|'filter'|'perspective'|'contain'|'willChange'|'whiteSpace'|'textOverflow'|'webkitLineClamp'|'fontSize'|'lineHeight'|'flexDirection'|'textIndent'|'content'|'height'>>;
interface LayoutCache {styles:WeakMap<Element,StyleSnapshot|undefined>;pseudos:Map<string,WeakMap<Element,StyleSnapshot|undefined>>;rendered:WeakMap<Element,boolean>;prose:WeakMap<Element,boolean>}
let layoutCache: LayoutCache | null = null;

/**
 * Reuse style and box reads for the rest of one synchronous pass. Rendering a row
 * inserts nodes; on CSS-heavy pages each later read would otherwise restyle the
 * whole document. Our rows never change a page element's visibility or link style.
 */
export function withLayoutCache<T>(run: () => T): T {
  if (layoutCache) return run();
  layoutCache = {styles:new WeakMap(),pseudos:new Map(),rendered:new WeakMap(),prose:new WeakMap()};
  try { return run(); } finally { layoutCache = null; }
}

export function computedStyle(element: Element, env: BrowserEnvironment,pseudo?:string): StyleSnapshot | undefined {
  if (!layoutCache) return env.getComputedStyle?.(element,pseudo);
  if(pseudo&&!layoutCache.pseudos.has(pseudo))layoutCache.pseudos.set(pseudo,new WeakMap());
  const cache=pseudo?layoutCache.pseudos.get(pseudo)!:layoutCache.styles;
  if (cache.has(element)) return cache.get(element);
  const style = env.getComputedStyle?.(element,pseudo);
  const snapshot = style && {display:style.display,visibility:style.visibility,position:style.position,clip:style.clip,clipPath:style.clipPath,overflow:style.overflow,color:style.color,textDecorationLine:style.textDecorationLine,overflowX:style.overflowX,overflowY:style.overflowY,transform:style.transform,filter:style.filter,perspective:style.perspective,contain:style.contain,willChange:style.willChange,whiteSpace:style.whiteSpace,textOverflow:style.textOverflow,webkitLineClamp:style.webkitLineClamp,fontSize:style.fontSize,lineHeight:style.lineHeight,flexDirection:style.flexDirection,textIndent:style.textIndent,content:style.content,height:style.height};
  cache.set(element,snapshot);return snapshot;
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

export function isReadable(element: HTMLElement | null | undefined, env: BrowserEnvironment, {allowOriginal=false,allowControls=false}: {allowOriginal?:boolean;allowControls?:boolean}={}): boolean {
  if (!element?.isConnected) return false;
  let hiddenByTranslation=false;
  for (const ancestor of ancestors(element)) {
    const original=allowOriginal&&ancestor.hasAttribute?.('data-kuai-original');
    if(original)hiddenByTranslation=true;
    if ((EXCLUDED_TAGS.has(ancestor.tagName)&&!(allowControls&&ancestor.tagName==='BUTTON')) || ancestor.hasAttribute?.('data-kuai-owned') ||
        ancestor.getAttribute?.('translate') === 'no' || ancestor.getAttribute?.('aria-hidden') === 'true' ||
        ancestor.className?.split?.(/\s+/).includes('html5-video-player') || editableElement(ancestor)) return false;
    const style = computedStyle(ancestor,env);
    // Accessibility-only copies can have a layout box while all their pixels are clipped.
    const clip=style?.clip?.match(/^rect\(([^)]+)\)$/)?.[1].split(/[\s,]+/).filter(Boolean).map(value=>parseFloat(value));
    if(clip?.length===4&&['absolute','fixed'].includes(style?.position||'')&&(clip[1]<=clip[3]||clip[2]<=clip[0])||/^inset\(50%(?:\s+50%){0,3}\)$/.test(style?.clipPath||''))return false;
    if(['absolute','fixed'].includes(style?.position||'')&&/^(hidden|clip)/.test(style?.overflow||'')&&emptyBox(ancestor))return false;
    if(parseFloat(style?.textIndent||'')<-100&&/hidden|clip/.test(style?.overflow||''))return false;
    // Inline code belongs to its sentence (`run ~/.codex`); block code without <pre> stays untranslated.
    if (!original && ancestor.tagName === 'CODE' && style?.display && !style.display.startsWith('inline')) return false;
    if (ancestor.hidden || !original&&style?.display === 'none' || ['hidden','collapse'].includes(style?.visibility as string)) return false;
  }
  return hiddenByTranslation || rendered(element);
}

export function isPageReadable(element: HTMLElement | null | undefined,env: BrowserEnvironment,options: {allowOriginal?:boolean}={}): boolean {
  return isReadable(element,env,{...options,allowControls:true});
}

// Translation can release a line clamp and change computed display; live hosts stay block boundaries.
const pinnedBlocks=new WeakSet<Element>();
export function pinBlock(element: Element): void {pinnedBlocks.add(element);}
export function unpinBlock(element: Element): void {pinnedBlocks.delete(element);}
function blockDisplay(display: string): boolean {
  return !!display&&!display.startsWith('inline')&&!display.startsWith('-webkit-inline')&&!display.startsWith('ruby')&&!['math','none','contents'].includes(display);
}
const controlSelector='button,[role="button"],[role="tab"],[role="menuitem"]';
function atomicControl(element: Element,env: BrowserEnvironment): boolean {
  return element.matches?.(controlSelector)||element.tagName==='A'&&/^(inline-|-webkit-inline-)/.test(computedStyle(element,env)?.display||'');
}

function parentHasProse(parent: Element,env: BrowserEnvironment): boolean {
  if(layoutCache?.prose.has(parent))return layoutCache.prose.get(parent)!;
  const hasProse=(node: Node): boolean=>{
    if(node.nodeType===3)return /\p{L}/u.test(sourceText(node));
    if(node.nodeType!==1||!isPageReadable(node as HTMLElement,env,{allowOriginal:true})||atomicControl(node as Element,env)||blockDisplay(computedStyle(node as Element,env)?.display||''))return false;
    return Array.from(node.childNodes).some(hasProse);
  };
  const result=Array.from(parent.childNodes).some(hasProse);
  layoutCache?.prose.set(parent,result);return result;
}

/** Atomic controls in a toolbar stand alone; a badge embedded in prose belongs to its sentence. */
export function isBlock(element: Element, env: BrowserEnvironment): boolean {
  if(element.tagName==='BR'||element.hasAttribute?.('data-kuai-owned')||element.hasAttribute?.('data-kuai-original'))return false;
  if(pinnedBlocks.has(element))return true;
  const style=computedStyle(element,env),display=style?.display||'';
  if(style?.position==='absolute'||style?.position==='fixed'||blockDisplay(display))return true;
  if(element.matches?.('[data-as="p"],[slot="title"],[role="heading"]')||!display&&element.matches?.(BLOCK_SELECTOR))return true;
  if(!atomicControl(element,env))return false;
  return !element.parentElement||!parentHasProse(element.parentElement,env);
}

/** A label can be nested, but a paragraph inside a linked card is still prose. */
export function isPageControl(element: HTMLElement,source: string,env: BrowserEnvironment): boolean {
  const control=element.closest<HTMLElement>('a,button,label,[role="button"],[role="tab"],[role="menuitem"]');
  if(!control)return false;
  if(control===element)return true;
  const read=(node: Node): string=>{
    if(node.nodeType===3)return sourceText(node);
    if(node.nodeType!==1||!isPageReadable(node as HTMLElement,env,{allowOriginal:true}))return '';
    if((node as Element).tagName==='BR')return ' ';
    return Array.from(node.childNodes,read).join('');
  };
  return read(control).replace(/\s+/gu,' ').trim()===source;
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
    if (node.nodeType === 3) return sourceText(node);
    if (node.nodeType !== 1) return '';
    if (node !== element && (isBlock(node as HTMLElement, env) || !isPageReadable(node as HTMLElement, env,{allowOriginal:true}))) return '';
    if ((node as HTMLElement).tagName === 'BR') return '\n';
    return Array.from(node.childNodes || [], read).join('');
  };
  return read(element).replace(/\s+/gu, ' ').trim();
}

const urlToken=/^(?:[a-z][a-z\d+.-]*:\/\/|www\.|(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?\/)[\w\-.~:/?#[\]@!$&'()*+,;=%]*$/i;
const stripTextPunctuation=(token: string)=>token.replace(/^[<(（「『【"'“‘]+|[>)）」』】"'”’.,;:!?。，；：！？]+$/gu,'');
/** A line holding only web addresses reads the same in every language. */
export function isUrlText(text: string): boolean {
  const tokens=text.trim().split(/\s+/u).map(stripTextPunctuation);
  return tokens.every(token=>urlToken.test(token));
}

/** Handles and compact counts, like web addresses, do not need a language service. */
export function isNonLanguageText(text: string): boolean {
  const tokens=text.trim().split(/(\s+)/u).map(stripTextPunctuation),count=/^[+-]?\d+(?:[.,]\d+)*[ \u00a0]?[kmbt]\+?$/i;
  for(let index=0;index<tokens.length;index+=2){
    const token=tokens[index];if(urlToken.test(token)||/^@[\p{L}\p{Nd}_.·-]+$/u.test(token)||count.test(token))continue;
    // Preserve the one optional space before a magnitude without accepting standalone numbers.
    if(/^[ \u00a0]$/.test(tokens[index+1]||'')&&count.test(token+tokens[index+1]+(tokens[index+2]||''))){index+=2;continue;}
    return false;
  }
  return true;
}

function establishesContainingBlock(style: StyleSnapshot | undefined): boolean {
  return ['transform','filter','perspective'].some(key=>{const value=style?.[key as keyof StyleSnapshot];return value&&value!=='none';})||
    /layout|paint|strict|content/.test(style?.contain||'')||/transform|filter|perspective/.test(style?.willChange||'');
}

/** Positioned descendants bypass overflow boxes below their containing block. Root overflow clips at the viewport. */
export function clippingAncestors(element: HTMLElement,env: BrowserEnvironment): HTMLElement[] {
  const chain=ancestors(element),result: HTMLElement[]=[];let positioned=computedStyle(element,env)?.position;
  for(const ancestor of chain.slice(1)){
    const style=computedStyle(ancestor,env);
    if(positioned==='fixed'||positioned==='absolute'){
      if(establishesContainingBlock(style)||positioned==='absolute'&&style?.position&&style.position!=='static')positioned='static';
      else continue;
    }
    if(ancestor.tagName==='HTML')continue;
    if(ancestor.tagName==='BODY'){
      const root=ancestor.ownerDocument.documentElement,rootStyle=computedStyle(root,env);
      if(!rootStyle?.overflow||rootStyle.overflow==='visible')continue;
    }
    result.push(ancestor);
    if(style?.position==='fixed'||style?.position==='absolute')positioned=style.position;
  }
  return result;
}

export function visibleRect(element: HTMLElement,env: BrowserEnvironment,rect=element.getBoundingClientRect(),includeSelf=false): {top:number;bottom:number;left:number;right:number} {
  let top=Math.max(0,rect.top),bottom=Math.min(env.innerHeight||800,rect.bottom),left=Math.max(0,rect.left),right=Math.min(env.innerWidth||1200,rect.right);
  for(const ancestor of [...(includeSelf?[element]:[]),...clippingAncestors(element,env)]){
    const style=computedStyle(ancestor,env),paint=/paint|strict|content/.test(style?.contain||''),clipY=paint||/^(auto|scroll|hidden|clip)$/.test(style?.overflowY||style?.overflow||''),clipX=paint||/^(auto|scroll|hidden|clip)$/.test(style?.overflowX||style?.overflow||'');
    if(!clipX&&!clipY)continue;
    const bounds=ancestor.getBoundingClientRect?.();if(!bounds)continue;
    if(clipY){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}
    if(clipX){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}
  }
  return {top,bottom,left,right};
}

/** Include only pixels visible in the viewport and clipping scroll ancestors. */
export function isInViewport(element: HTMLElement,env: BrowserEnvironment): boolean {
  const rect=element.getBoundingClientRect?.();
  if(!rect||![rect.top,rect.bottom,rect.left,rect.right].every(Number.isFinite))return true;
  const {top,bottom,left,right}=visibleRect(element,env,rect);return bottom>top&&right>left;
}

export function collectBlocks(document: Document, env: BrowserEnvironment, {visibleOnly=false}: {visibleOnly?:boolean}={}): PageBlock[] {
  const body = document.body;
  if (!body) return [];
  return withLayoutCache(() => [body, ...blocksWithin(body,env)]
    .filter(element => (!visibleOnly||isInViewport(element,env))&&isPageReadable(element, env))
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
