/** Browser-facing helpers shared by the native page and selection controllers. */
export const BLOCK_SELECTOR = 'p,div,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dt,dd,article,section';
const EXCLUDED_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','PRE','CODE','TEXTAREA','INPUT','SELECT','OPTION','BUTTON','SVG','MATH','VIDEO','AUDIO','CANVAS']);

export function parentElement(node) {
  return node?.nodeType === 1 ? node : node?.parentElement || node?.getRootNode?.()?.host || null;
}

export function ancestors(node) {
  const result = [];
  for (let current = parentElement(node); current; current = current.parentElement || current.getRootNode?.()?.host) result.push(current);
  return result;
}

export function isEditable(node) {
  return ancestors(node).some(element => {
    const editable = element.getAttribute?.('contenteditable');
    return element.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(element.tagName) ||
      (editable !== null && editable !== undefined && editable !== 'false') || element.getAttribute?.('role') === 'textbox';
  });
}

export function isOwnedUI(node) {
  return ancestors(node).some(element => element.hasAttribute?.('data-kuai-ui'));
}

export function isReadable(element, env, {allowOriginal=false}={}) {
  if (!element?.isConnected) return false;
  let hiddenByTranslation=false;
  for (const ancestor of ancestors(element)) {
    if(allowOriginal&&ancestor.hasAttribute?.('data-kuai-original')){hiddenByTranslation=true;continue;}
    if (EXCLUDED_TAGS.has(ancestor.tagName) || ancestor.hasAttribute?.('data-kuai-owned') ||
        ancestor.getAttribute?.('translate') === 'no' || ancestor.getAttribute?.('aria-hidden') === 'true' ||
        ancestor.className?.split?.(/\s+/).includes('html5-video-player') || isEditable(ancestor)) return false;
    const style = env.getComputedStyle?.(ancestor);
    if (ancestor.hidden || style?.display === 'none' || ['hidden','collapse'].includes(style?.visibility)) return false;
  }
  return hiddenByTranslation || !element.getClientRects || element.getClientRects().length > 0;
}

/** Read a block without including nested blocks or our appended translation. */
export function blockText(element, env) {
  const read = node => {
    if (node.nodeType === 3) return node.nodeValue || node.textContent || '';
    if (node.nodeType !== 1) return '';
    if (node !== element && (node.matches?.(BLOCK_SELECTOR) || !isReadable(node, env,{allowOriginal:true}))) return '';
    if (node.tagName === 'BR') return '\n';
    return Array.from(node.childNodes || [], read).join('');
  };
  return read(element).replace(/\s+/gu, ' ').trim();
}

/** Include only pixels visible in the viewport and clipping scroll ancestors. */
export function isInViewport(element,env){
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

export function collectBlocks(document, env, {visibleOnly=false}={}) {
  if (!document.body) return [];
  return [document.body, ...document.body.querySelectorAll(BLOCK_SELECTOR)]
    .filter(element => (!visibleOnly||isInViewport(element,env))&&isReadable(element, env))
    .map(element => ({ element, text:blockText(element, env) }))
    .filter(item => item.text && /[\p{L}\p{N}]/u.test(item.text));
}

/** Split by Unicode characters rather than cutting a surrogate pair. */
export function splitText(text, limit = 1800) {
  const parts = []; let part = '';
  for (const character of String(text)) {
    if (part.length + character.length > limit && part) { parts.push(part); part = ''; }
    part += character;
  }
  if (part) parts.push(part);
  return parts;
}

export function batches(items, textOf = item => item.text) {
  const result = []; let batch = [], length = 0;
  for (const item of items) {
    const size = textOf(item).length;
    if (batch.length && (batch.length >= 8 || length + size > 6000)) { result.push(batch); batch = []; length = 0; }
    batch.push(item); length += size;
  }
  if (batch.length) result.push(batch);
  return result;
}

export function translationsOf(response, expected) {
  const values = response?.translations;
  if (!Array.isArray(values) || values.length !== expected || values.some(value => typeof value !== 'string' || !value.trim())) {
    const error = new Error('翻译服务返回了空译文或无效结果，请重试或切换服务。');
    error.code = 'INVALID_RESPONSE'; throw error;
  }
  return values;
}

export function requestOptions(settings, requestId) {
  return { requestId, providerId:settings.activeProviderId, sourceLanguage:settings.sourceLanguage, targetLanguage:settings.targetLanguage };
}

export function configurationKey(settings) {
  const provider = settings.providers?.find(item => item.id === settings.activeProviderId);
  return JSON.stringify([settings.activeProviderId, settings.sourceLanguage, settings.targetLanguage,settings.providerRevision??0, provider?.model, provider?.type, provider?.enabled]);
}

export function makeId() { return 'page-' + globalThis.crypto.randomUUID(); }
export function isChinese(settings, env) {
  const language = settings.interfaceLanguage;
  return /^zh/i.test(language && language !== 'auto' ? language : env.navigator?.language || 'en');
}
