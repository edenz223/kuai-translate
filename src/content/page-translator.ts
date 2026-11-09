import type {Settings} from '../shared/settings.js';
import type {Translate} from '../shared/messages.js';
import type {BrowserEnvironment,CodedError,PageBlock} from './dom.js';
import type {SourceLayout} from './page-layout.js';
import {measureSourceLayout,pageLayout} from './page-layout.js';
import type {PageContent,PageLinkBinding} from './page-content.js';

export interface PageStatus {active:boolean;translated:number;errors:number;total:number;cancelled:boolean;isTranslated:boolean;error?:string}
export interface PageTranslatorOptions {document:Document;env?:BrowserEnvironment;translate:Translate;cancel?:(id:string)=>unknown;getSettings:()=>Settings;makeRequestId?:()=>string;onBeforeTranslate?:()=>void;onRestore?:()=>void;onChange?:(status:PageStatus)=>void}
export interface TranslateBlocksOptions {validate?:()=>boolean;retryErrors?:boolean;viewportOnly?:boolean}
type PageEntryStatus = 'pending'|'success'|'error'|'cancelled';
interface PageEntry {element:HTMLElement;source:string;key:string;validate:()=>boolean;viewportOnly:boolean;url:string;status:PageEntryStatus;output:HTMLElement|null;inner?:HTMLElement;sourceLayout?:string|null;overflowLayout?:string|null;parts:(string|undefined)[];originals:HTMLElement[];content:PageContent;links:PageLinkBinding[];resolve:(()=>void)|null;done?:Promise<void>;titleLayout?:string|null;layout:SourceLayout;forcedBlock?:boolean;forcedWidth?:number;flexLayout?:string|null;inlineLayout?:string|null;duplicatePseudo?:string|null;loadingHost?:HTMLElement|null;loadingNode?:Text|null;expected?:number;shownAt?:number}
interface PageRequest {owners:Set<PageEntry>;release:(()=>void)|null}

import { ancestors, batches, blockText, collectBlocks, computedStyle, isPageControl, isBlock, isChinese, isPageReadable as isReadable, isInViewport, visibleRect, makeId, requestOptions, translationsOf, withLayoutCache } from './dom.js';
import {filterPageBlocks,isPageBlockAllowed,isPageSiteBlocked,pageTranslationKey} from './page-policy.js';
import {pageStyleRule} from '../shared/styles.js';
import {hideOriginal,restoreOriginal} from './originals.js';
import {capturePageContent,pageContentMatches,renderPageContent,refreshPageLinks,isPageLinkMutation,PAGE_LINK_ATTRIBUTES} from './page-content.js';

const words = {
  zh:{loading:'翻译中…',cancelled:'已停止',retry:'重试',failed:'翻译失败，请重试。'},
  en:{loading:'Translating…',cancelled:'Stopped',retry:'Retry',failed:'Translation failed. Please retry.'},
};
const alwaysAllowed=()=>true;
// Some widgets rebuild themselves when a translation changes their height; stop feeding that loop.
const WIPE_WINDOW=1000,WIPE_LIMIT=3;

/** Append translations to existing blocks. Original nodes and listeners never move. */
export function createPageTranslator({ document, env = globalThis, translate, cancel = () => {}, getSettings, makeRequestId = makeId,onBeforeTranslate=()=>{},onRestore=()=>{},onChange }: PageTranslatorOptions) {
  const entries = new Map<HTMLElement,PageEntry>(), requests = new Map<string,PageRequest>(),loadingEntries=new Set<PageEntry>(),loadingDisposers: (()=>void)[]=[];
  const requestCancelled=Symbol('cancelled request'),wipes=new Map<string,number>();
  let cancelled = false,observer: MutationObserver|null=null,repairQueued=false,positionQueued=false,squeezeQueued=false,titleLayoutStyle: HTMLStyleElement|null=null,pageSheet: HTMLStyleElement|null=null,lastError='';
  const labels = () => words[isChinese(getSettings(), env) ? 'zh' : 'en'];
  const route = () => env.location?.href || '';
  const status = (): PageStatus => {
    const all = [...entries.values()], translated = all.filter(entry => entry.status === 'success').length;
    return { active:all.some(entry=>entry.status==='pending'), translated, errors:all.filter(entry => entry.status === 'error').length, total:all.length, cancelled, isTranslated:translated > 0,...(lastError?{error:lastError}:{}) };
  };
  // Entry changes arrive in bursts; observers receive one summary per microtask.
  let changeQueued=false;
  function changed(): void{
    if(!onChange||changeQueued)return;
    changeQueued=true;queueMicrotask(()=>{changeQueued=false;onChange(status());});
  }
  function abortRequest(id: string): void {
    const request=requests.get(id);if(!request)return;
    requests.delete(id);request.release!();
    try { Promise.resolve(cancel(id)).catch(() => {}); } catch {}
  }
  // A shared batch can only be cancelled once its last live paragraph releases it.
  function releaseRequests(entry: PageEntry): void {
    for(const [id,request] of requests){request.owners.delete(entry);if(!request.owners.size)abortRequest(id);}
  }
  function finish(entry: PageEntry): void {entry.resolve?.();entry.resolve=null;}
  function remove(entry: PageEntry): void {
    if(entry.status==='success'&&!entry.element.isConnected&&Date.now()-entry.shownAt!<WIPE_WINDOW)wipes.set(entry.source,(wipes.get(entry.source)||0)+1);
    releaseRequests(entry);removeLoading(entry);restoreOriginal(entry);entry.output?.remove();finish(entry);
    if(entry.sourceLayout!==undefined&&entry.element.getAttribute('data-kuai-page-source')==='expanded'){
      if(entry.sourceLayout===null)entry.element.removeAttribute('data-kuai-page-source');
      else entry.element.setAttribute('data-kuai-page-source',entry.sourceLayout);
    }
    if(entry.overflowLayout!==undefined){if(entry.overflowLayout===null)entry.element.removeAttribute('data-kuai-page-overflow');else entry.element.setAttribute('data-kuai-page-overflow',entry.overflowLayout);}
    if(entry.duplicatePseudo!==undefined){if(entry.duplicatePseudo===null)entry.element.removeAttribute('data-kuai-duplicate-pseudo');else entry.element.setAttribute('data-kuai-duplicate-pseudo',entry.duplicatePseudo);}
    if(entry.inlineLayout!==undefined){if(entry.inlineLayout===null)entry.element.removeAttribute('data-kuai-inline-layout');else entry.element.setAttribute('data-kuai-inline-layout',entry.inlineLayout);}
    if(entry.flexLayout!==undefined){if(entry.flexLayout===null)entry.element.removeAttribute('data-kuai-flex-layout');else entry.element.setAttribute('data-kuai-flex-layout',entry.flexLayout);}
    if(entry.titleLayout!==undefined&&entry.element.getAttribute('data-kuai-title-layout')==='stacked'){if(entry.titleLayout===null)entry.element.removeAttribute('data-kuai-title-layout');else entry.element.setAttribute('data-kuai-title-layout',entry.titleLayout);}
    if(entries.get(entry.element)===entry)entries.delete(entry.element);
    changed();
    if(!entries.size){observer?.disconnect();observer=null;titleLayoutStyle?.remove();titleLayoutStyle=null;pageSheet?.remove();pageSheet=null;}
  }
  function observe() {
    if(observer||!env.MutationObserver)return;
    observer=new env.MutationObserver(records=>{
      if(repairQueued||!records.some(record=>{
        if(record.removedNodes?.length)return true;
        if(ancestors(record.target).some(node=>node.hasAttribute?.('data-kuai-owned')||node.hasAttribute?.('data-kuai-ui')))return false;
        return record.type==='characterData'||record.addedNodes?.length||isPageLinkMutation(record);
      }))return;
      repairQueued=true;queueMicrotask(()=>{repairQueued=false;refreshPresentation();});
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:PAGE_LINK_ATTRIBUTES});
  }
  function makeEntry(element: HTMLElement, source: string, key: string, validate: ()=>boolean, viewportOnly: boolean): PageEntry {
    const entry: PageEntry={element,source,key,validate,viewportOnly,url:route(),status:'pending',layout:measureSourceLayout(element,env),output:null,parts:[],originals:[],content:capturePageContent(element,env),links:[],resolve:null};
    entry.done=new Promise<void>(resolve=>{entry.resolve=resolve;});entries.set(element,entry);observe();changed();return entry;
  }
  function stackYouTubeTitle(entry: PageEntry): void{
    let host;try{host=new URL(route()).hostname;}catch{return;}
    const element=entry.element;
    if(!/(^|\.)youtube\.com$/.test(host)||element.tagName!=='H1'||
      !element.closest('ytd-watch-metadata,ytd-video-primary-info-renderer')&&!element.matches('.ytd-watch-metadata,.ytd-video-primary-info-renderer'))return;
    // A block-level translation is still a horizontal flex item in YouTube's
    // heading. Scope a normal block layout to translated video titles only.
    if(!titleLayoutStyle?.isConnected){
      titleLayoutStyle=document.createElement('style');titleLayoutStyle.setAttribute('data-kuai-owned','');titleLayoutStyle.setAttribute('data-kuai-title-layout-style','');
      titleLayoutStyle.textContent='h1[data-kuai-title-layout=stacked]{display:block!important;height:auto!important;max-height:none!important;overflow:visible!important}h1[data-kuai-title-layout=stacked]>[data-kuai-page-translation]{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important}h1[data-kuai-title-layout=stacked]>[data-kuai-page-translation]>br{display:none!important}';
      document.documentElement.append(titleLayoutStyle);
    }
    if(entry.titleLayout===undefined)entry.titleLayout=element.getAttribute('data-kuai-title-layout');
    element.setAttribute('data-kuai-title-layout','stacked');
  }
  function lastSourceText(element: HTMLElement,allowOriginal=false): Text | null{
    let last: Text|null=null;
    const visit=(node: Node): void=>{
      if(node.nodeType===3){if(/\S/u.test(node.nodeValue||''))last=node as Text;return;}
      if(node.nodeType!==1||node!==element&&(isBlock(node as HTMLElement,env)||!isReadable(node as HTMLElement,env,{allowOriginal})))return;
      for(const child of node.childNodes)visit(child);
    };
    visit(element);return last;
  }
  function measureLoading(entry: PageEntry): {visible:boolean;x?:number;y?:number}{
    if(!entry.element.isConnected||!isReadable(entry.element,env)||!isInViewport(entry.element,env))return {visible:false};
    let rect;const node=entry.loadingNode;
    if(node?.isConnected)try{
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,node.nodeValue!.length);
      rect=Array.from(range.getClientRects?.()||[]).at(-1)||range.getBoundingClientRect?.();
    }catch{}
    rect ||=entry.element.getBoundingClientRect();
    const x=Math.max(0,Math.min((env.innerWidth||1200)-14,(rect.right||0)+4)),y=Math.max(0,(rect.bottom||0)-13);
    const bounds=visibleRect(node?.parentElement||entry.element,env,rect,true);
    const endVisible=rect.right>0&&rect.right<=(env.innerWidth||1200)&&rect.bottom>0&&rect.bottom<=(env.innerHeight||800)&&x>=bounds.left&&x+12<=bounds.right+16&&y>=bounds.top&&y+12<=bounds.bottom;
    return {visible:endVisible,x,y};
  }
  // Read every position before moving any spinner, so one layout serves the whole pass.
  function positionLoaders(){
    const layouts=withLayoutCache(()=>[...loadingEntries].filter(entry=>entry.loadingHost?.isConnected).map(entry=>[entry.loadingHost!,measureLoading(entry)] as const));
    for(const [spinner,{visible,x,y}] of layouts){
      spinner.style.setProperty('display',visible?'block':'none','important');
      if(x!==undefined){spinner.style.setProperty('left',x+'px','important');spinner.style.setProperty('top',y+'px','important');}
    }
  }
  function queuePositionLoaders(){
    if(positionQueued)return;
    positionQueued=true;queueMicrotask(()=>{positionQueued=false;positionLoaders();});
  }
  function removeLoading(entry: PageEntry): void{
    entry.loadingHost?.remove();entry.loadingHost=null;entry.loadingNode=null;loadingEntries.delete(entry);
    if(!loadingEntries.size)loadingDisposers.splice(0).forEach(dispose=>dispose());
  }
  function appendLoading(entry: PageEntry): void{
    if(!entry.loadingHost?.isConnected){
      const spinner=document.createElement('span');spinner.setAttribute('data-kuai-owned','');spinner.setAttribute('data-kuai-page-loading','');spinner.setAttribute('role','status');spinner.setAttribute('aria-label',labels().loading);
      spinner.style.cssText='all:initial;position:fixed!important;width:0!important;height:0!important;overflow:visible!important;z-index:2147483644!important;pointer-events:none!important;';
      const shadow=spinner.attachShadow({mode:'open'}),style=document.createElement('style'),ring=document.createElement('span');ring.setAttribute('aria-hidden','true');
      style.textContent=':host{font-size:0;line-height:0;pointer-events:none}span{position:absolute;left:0;top:0;box-sizing:border-box;width:12px;height:12px;border:1.5px solid #94a3b855;border-top-color:#64748b;border-radius:50%;animation:kuai-loading .7s linear infinite;pointer-events:none}@keyframes kuai-loading{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){span{animation:none}}';
      shadow.append(style,ring);document.documentElement.append(spinner);entry.loadingHost=spinner;entry.loadingNode=lastSourceText(entry.element);
    }
    loadingEntries.add(entry);
    if(!loadingDisposers.length)for(const [target,type,capture]of ([[document,'scroll',true],[env,'scroll',false],[env,'resize',false]] as [EventTarget,string,boolean][])){
      target.addEventListener(type,positionLoaders,capture);loadingDisposers.push(()=>target.removeEventListener(type,positionLoaders,capture));
    }
    queuePositionLoaders();
  }
  /** Place this block's result after its own text, before any following nested block. */
  function positionOutput(entry: PageEntry): void{
    if(!entry.output)return;
    let anchor: Node|null=lastSourceText(entry.element,true);
    if(!anchor)return;
    const inline=entry.output.getAttribute('data-kuai-layout')==='inline'&&isPageControl(entry.element,entry.source,env);
    // A full-width label wrapper can leave no space after itself; keep its sole text and result together.
    const label=anchor.parentElement?.hasAttribute('data-kuai-original')?anchor.parentElement.parentNode!:anchor.parentNode!;
    const parent=inline&&(label as HTMLElement).tagName==='SPAN'&&(anchor.nodeValue||'').replace(/\s+/gu,' ').trim()===entry.source?label:entry.element;
    while(anchor.parentNode&&anchor.parentNode!==parent)anchor=anchor.parentNode;
    if(anchor.parentNode!==parent)return;
    const next=Array.from(parent.childNodes)[Array.from(parent.childNodes).indexOf(anchor as ChildNode)+1]||null;
    if(next!==entry.output)parent.insertBefore(entry.output,next);
  }
  function ensureOutput(entry: PageEntry): asserts entry is PageEntry & {output:HTMLElement} {
    if(entry.output)return;
    const output=document.createElement('kuai-translator'),inner=document.createElement('font');
    output.className='kuai-translator-wrapper notranslate';
    output.setAttribute('data-kuai-owned','');output.setAttribute('data-kuai-page-translation','');
    output.setAttribute('role','status');output.setAttribute('aria-live','polite');output.setAttribute('translate','no');
    inner.className='kuai-translator-inner';
    inner.setAttribute('lang',getSettings().targetLanguage||'');
    output.append(inner);entry.element.append(output);
    entry.output=output;entry.inner=inner;positionOutput(entry);
  }
  /** One sheet styles every row by state; a stylesheet per row restyled the whole document on each insertion. */
  function updatePageSheet(): void {
    const style=getSettings().pageStyle||{};
    let success=false,other=false;
    for(const entry of entries.values())if(entry.status==='success')success=true;else other=true;
    let css='kuai-translator.kuai-translator-wrapper{font:inherit!important;letter-spacing:inherit!important;color:inherit!important;box-sizing:border-box!important;min-width:0!important;max-width:100%!important;white-space:normal;overflow-wrap:anywhere}'+
      'kuai-translator[data-kuai-layout=inline]{display:inline!important;margin-inline-start:.35em!important;white-space:normal!important;overflow-wrap:anywhere!important}'+
      'kuai-translator[data-kuai-layout=inline]>.kuai-translator-inner{white-space:normal!important;overflow-wrap:anywhere!important}'+
      'kuai-translator[data-kuai-layout=block]{display:block!important;white-space:normal!important}'+
      'kuai-translator[data-state=pending]{display:none!important}'+
      'kuai-translator[data-kuai-only]{margin-inline-start:0!important}'+
      '[data-kuai-page-source=expanded]{-webkit-line-clamp:unset!important;max-height:none!important;height:auto!important}'+
      '[data-kuai-page-overflow=expanded]{overflow:visible!important}'+
      '[data-kuai-inline-layout=column]{display:block!important;width:max-content!important;max-width:100%!important}'+
      '[data-kuai-inline-layout=column][data-kuai-duplicate-pseudo~=before]::before,[data-kuai-inline-layout=column][data-kuai-duplicate-pseudo~=after]::after{display:none!important}'+
      '[data-kuai-inline-layout^=flex]{flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important}'+
      '[data-kuai-inline-layout=grid]{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important}'+
      '[data-kuai-flex-layout=row]{flex-wrap:wrap!important}'+
      '[data-kuai-flex-layout]>kuai-translator[data-kuai-layout=block]{flex-basis:100%!important;width:100%!important;grid-column:1/-1!important}'+
      // A full-width flex basis starts a new row; zero preferred width avoids adding to the host's intrinsic width.
      'kuai-translator[data-kuai-forced-block=row]:not([data-kuai-only]){width:0!important}'+
      'kuai-translator>font.kuai-translator-inner{font:inherit!important;letter-spacing:inherit!important;color:inherit;white-space:pre-wrap;overflow-wrap:anywhere}';
    for(const [active,selector,theme] of [[success,'[data-state=success]',style],[other,':not([data-state=success])',{...style,preset:style.preset==='blur'?'plain':style.preset,opacity:100}]] as const){
      if(!active)continue;
      // Include the font tag to outrank the inherited baseline without per-row inline styles.
      css+=pageStyleRule('kuai-translator'+selector+'>font.kuai-translator-inner',theme);
      css+=pageStyleRule('kuai-translator'+selector+'[data-kuai-layout=inline]>font.kuai-translator-inner',theme,true);
      css+=pageStyleRule('kuai-translator'+selector+'[data-kuai-forced-block]>font.kuai-translator-inner',theme,true);
    }
    for(const width of new Set([...entries.values()].map(entry=>entry.forcedWidth).filter(width=>width!==undefined))){
      css+='[data-kuai-flex-layout=row]:has(>kuai-translator[data-kuai-forced-width="'+width+'"]:not([data-kuai-only])){width:'+width+'px!important;align-content:center!important}';
    }
    if(!pageSheet?.isConnected){
      pageSheet=document.createElement('style');pageSheet.setAttribute('data-kuai-owned','');pageSheet.setAttribute('data-kuai-page-style','');
      document.documentElement.append(pageSheet);
    }
    // Avoid observer churn when a presentation refresh leaves the theme unchanged.
    if(pageSheet.textContent!==css)pageSheet.textContent=css;
  }
  function queueSqueezeCheck(): void {
    if(squeezeQueued)return;
    squeezeQueued=true;queueMicrotask(()=>{
      squeezeQueued=false;
      // Finish reading every inline result before changing any host's layout.
      const squeezed=withLayoutCache(()=>[...entries.values()].flatMap(entry=>{
        if(entry.forcedBlock||entry.status!=='success'||!entry.inner||!entry.output?.isConnected||entry.output.getAttribute('data-kuai-layout')!=='inline')return [];
        const box=entry.inner.getBoundingClientRect(),hostStyle=computedStyle(entry.element,env),innerStyle=computedStyle(entry.inner,env);
        const fontSize=parseFloat(innerStyle?.fontSize||'')||entry.layout.fontSize;
        const lineHeight=parseFloat(hostStyle?.lineHeight||'')||(parseFloat(hostStyle?.fontSize||'')||entry.layout.fontSize)*1.2;
        // Mixed-width glyphs can make a three-character column slightly wider than three em.
        if(!(box.width>0&&box.width<fontSize*4&&box.height>lineHeight*1.5))return [];
        let width: number|undefined;
        if(/flex/.test(entry.layout.display)&&!entry.layout.column){
          let textWidth=0;
          const visit=(node: Node): void=>{
            if(node.nodeType===3){
              try{const range=document.createRange();range.selectNodeContents(node);for(const rect of Array.from(range.getClientRects?.()||[]))textWidth+=rect.width;}catch{}
            }else for(const child of node.childNodes)visit(child);
          };
          visit(entry.inner);
          // Preserve the source's preferred width, adding only what a wider translation needs.
          width=entry.layout.width+Math.max(0,textWidth-(entry.layout.textWidth||0));
        }
        return [{entry,width}];
      }));
      // Keep the fallback for this translation even if a later refresh has more space.
      for(const {entry,width} of squeezed){entry.forcedBlock=true;entry.forcedWidth=width;}
      withLayoutCache(()=>{for(const {entry} of squeezed)present(entry);});
    });
  }
  function present(entry: PageEntry): void {
    if(!entry.output||!entry.inner)return;
    positionOutput(entry);updatePageSheet();
    const settings=getSettings(),style=settings.pageStyle||{};
    const pending=entry.status==='pending',translationOnly=settings.pageDisplayMode==='translation_only'&&entry.status==='success';
    const theme=entry.status==='success'?style:{...style,preset:style.preset==='blur'?'plain':style.preset,opacity:100};
    if(pending){
      restoreOriginal(entry);appendLoading(entry);
      entry.output.setAttribute('aria-label',labels().loading);return;
    }
    removeLoading(entry);entry.output.removeAttribute('aria-label');
    const layout=entry.forcedBlock?{layout:'block' as const}:pageLayout(entry.element,entry.source,entry.inner.textContent||'',entry.layout,env);
    entry.output.setAttribute('data-kuai-layout',layout.layout);
    if(entry.forcedBlock)entry.output.setAttribute('data-kuai-forced-block',/flex/.test(entry.layout.display)&&!entry.layout.column?'row':'');
    if(entry.forcedWidth!==undefined)entry.output.setAttribute('data-kuai-forced-width',String(entry.forcedWidth));
    if(layout.layout==='inline'&&/flex|grid/.test(entry.layout.display)){
      if(entry.layout.duplicatePseudo){
        if(entry.duplicatePseudo===undefined)entry.duplicatePseudo=entry.element.getAttribute('data-kuai-duplicate-pseudo');
        entry.element.setAttribute('data-kuai-duplicate-pseudo',entry.layout.duplicatePseudo);
      }
      if(entry.inlineLayout===undefined)entry.inlineLayout=entry.element.getAttribute('data-kuai-inline-layout');
      entry.element.setAttribute('data-kuai-inline-layout',/flex/.test(entry.layout.display)?entry.layout.column?'column':'flex':'grid');
    }else if(entry.inlineLayout!==undefined){
      if(entry.inlineLayout===null)entry.element.removeAttribute('data-kuai-inline-layout');else entry.element.setAttribute('data-kuai-inline-layout',entry.inlineLayout);
    }
    if(layout.layout==='block'&&/flex|grid/.test(entry.layout.display)){
      if(entry.flexLayout===undefined)entry.flexLayout=entry.element.getAttribute('data-kuai-flex-layout');
      entry.element.setAttribute('data-kuai-flex-layout',entry.layout.column?'column':'row');
    }else if(entry.flexLayout!==undefined){
      if(entry.flexLayout===null)entry.element.removeAttribute('data-kuai-flex-layout');else entry.element.setAttribute('data-kuai-flex-layout',entry.flexLayout);
    }
    stackYouTubeTitle(entry);positionOutput(entry);
    if(entry.sourceLayout===undefined)entry.sourceLayout=entry.element.getAttribute('data-kuai-page-source');
    // Stacked flex rows can use a control's existing height without expanding the whole header.
    if((layout.layout==='block'&&entry.forcedWidth===undefined||entry.layout.expandOverflow)&&entry.element.getAttribute('data-kuai-page-source')!=='expanded')entry.element.setAttribute('data-kuai-page-source','expanded');
    if(entry.layout.expandOverflow){
      if(entry.overflowLayout===undefined)entry.overflowLayout=entry.element.getAttribute('data-kuai-page-overflow');
      entry.element.setAttribute('data-kuai-page-overflow','expanded');
    }
    if(entry.status==='success')refreshPageLinks(entry.links,document,env);
    if(theme.preset==='blur'&&layout.layout==='block')entry.inner.setAttribute('tabindex','0');else entry.inner.removeAttribute('tabindex');
    if(translationOnly){entry.output.setAttribute('data-kuai-only','');hideOriginal(entry,document,env);}
    else{entry.output.removeAttribute('data-kuai-only');restoreOriginal(entry);}
    if(layout.layout==='inline'&&entry.status==='success')queueSqueezeCheck();
  }

  function current(entry: PageEntry): boolean {
    if(entries.get(entry.element)!==entry)return false;
    if(entry.url!==route()||entry.key!==pageTranslationKey(getSettings())||!entry.validate()||
      !isReadable(entry.element,env)||blockText(entry.element,env)!==entry.source||!pageContentMatches(entry.content,entry.element,env)||
      entry.output&&(!entry.output.isConnected||!entry.element.contains(entry.output))||
      !isPageBlockAllowed({element:entry.element,text:entry.source},getSettings(),{env,url:route()})){
      remove(entry);return false;
    }
    return true;
  }
  // Validate every row before rendering any: interleaving DOM writes with these reads restyles the page per row.
  function refreshPresentation() {
    withLayoutCache(()=>{for(const entry of [...entries.values()].filter(current))present(entry);});
    return status();
  }
  function hasTranslation(element: HTMLElement,source: string): boolean {
    const entry=entries.get(element);
    return !!entry&&current(entry)&&entry.source===source&&['pending','success'].includes(entry.status);
  }
  function show(entry: PageEntry, text: string, state: PageEntryStatus): void {
    if(state==='success'&&text.trim()===entry.source.trim()){
      removeLoading(entry);entry.output?.remove();entry.output=null;entry.inner=undefined;entry.status=state;finish(entry);changed();return;
    }
    ensureOutput(entry);entry.status = state;entry.output.setAttribute('data-state',state);entry.output.setAttribute('aria-busy',String(state==='pending'));entry.inner!.replaceChildren();
    entry.links=[];
    if(state!=='pending')positionOutput(entry);
    if(state==='pending')appendLoading(entry);
    else if(state==='success'){entry.shownAt=Date.now();entry.links=renderPageContent(entry.inner!,entry.content,entry.parts,{document,env,valid:()=>current(entry)});}
    else entry.inner!.append(document.createTextNode(text));
    if (state === 'error' || state === 'cancelled') {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = labels().retry;
      retry.style.cssText = 'font:inherit;margin-left:.5em;padding:.1em .5em;cursor:pointer;';
      retry.addEventListener('click',event => {
        event.preventDefault();event.stopPropagation();
        if(current(entry))void translateBlocks([{element:entry.element,text:entry.source}],{validate:entry.validate}).catch(reportError);
      });entry.inner!.append(retry);
    }
    present(entry);if(state!=='pending')finish(entry);
    changed();
  }
  function cancelCurrent() {
    cancelled = true;
    for(const id of [...requests.keys()])abortRequest(id);
    withLayoutCache(()=>{
      const pending=[...entries.values()].filter(entry=>entry.status==='pending'),live=pending.filter(entry=>entry.output&&current(entry));
      for(const entry of pending)if(live.includes(entry))show(entry,labels().cancelled,'cancelled');else remove(entry);
    });
    return status();
  }
  function restore() {
    onRestore();cancelled = false;lastError='';wipes.clear();
    for(const entry of [...entries.values()])remove(entry);
    observer?.disconnect();observer=null;return status();
  }
  function candidatesOf(blocks: readonly PageBlock[] | null | undefined): PageBlock[] {
    const seen=new Set<HTMLElement>(),result: PageBlock[]=[];
    for(const block of blocks||[]){
      if(seen.has(block?.element)||typeof block?.text!=='string')continue;seen.add(block.element);
      if(isReadable(block.element,env)&&blockText(block.element,env)===block.text&&isPageBlockAllowed(block,getSettings(),{env,url:route()}))result.push(block);
    }
    return result;
  }
  async function run(created: PageEntry[],settings: Settings): Promise<void> {
    try{
      const selected=filterPageBlocks(created.map(entry=>({element:entry.element,text:entry.source})),settings,{env,url:created[0].url});
      const blocks=(selected&&typeof (selected as Promise<PageBlock[]>).then==='function'?await selected:selected) as PageBlock[];
      const eligible=new Set(blocks.map(block=>block.element)),units: {entry:PageEntry;index:number;text:string}[]=[];
      withLayoutCache(()=>{
        const ready=created.filter(entry=>{
          if(!current(entry)||entry.status!=='pending')return false;
          if(!eligible.has(entry.element)||entry.viewportOnly&&!isInViewport(entry.element,env)){remove(entry);return false;}
          return true;
        });
        for(const entry of ready){
          show(entry,labels().loading,'pending');
          const parts=entry.content.units;entry.expected=parts.length;
          if(!parts.length){show(entry,'','success');continue;}
          parts.forEach((text,index)=>units.push({entry,index,text}));
        }
      });
      for(const group of batches(units)){
        const batch=group.filter(unit=>{
          if(!current(unit.entry)||unit.entry.status!=='pending')return false;
          if(unit.entry.viewportOnly&&!isInViewport(unit.entry.element,env)){remove(unit.entry);return false;}
          return true;
        });
        if(!batch.length)continue;
        const id=makeRequestId(),request: PageRequest={owners:new Set(batch.map(unit=>unit.entry)),release:null};
        const released=new Promise<typeof requestCancelled>(resolve=>{request.release=()=>resolve(requestCancelled);});requests.set(id,request);
        try{
          const response=await Promise.race([translate(batch.map(unit=>unit.text),requestOptions(settings,id)),released]);
          if(response===requestCancelled)continue;
          // Drop the request first: rendering or invalidation after completion must not cancel a finished request.
          requests.delete(id);
          const translated=translationsOf(response,batch.length);
          withLayoutCache(()=>{
            const live=new Set(batch.map(unit=>unit.entry).filter(entry=>current(entry)&&entry.status==='pending'));
            batch.forEach((unit,index)=>{
              const entry=unit.entry;if(!live.has(entry)||entry.status!=='pending')return;
              entry.parts[unit.index]=translated[index];
              if(entry.parts.filter(value=>typeof value==='string').length===entry.expected)show(entry,entry.parts.join(' '),'success');
            });
          });
        }catch(error){
          requests.delete(id);
          // A provider failure stops only this operation, including its queued rows.
          fail(created,error);
          break;
        }

      }
    }catch(error){
      fail(created,error);
    }
  }
  function fail(created: PageEntry[],error: unknown): void{
    withLayoutCache(()=>{
      const message=String((error as {message?:unknown} | null)?.message||labels().failed);
      for(const entry of created.filter(entry=>current(entry)&&entry.status==='pending'))show(entry,message,'error');
    });
  }
  function translateBlocks(blocks: readonly PageBlock[],options: TranslateBlocksOptions={}): Promise<PageStatus> {
    return withLayoutCache(()=>startBlocks(blocks,options));
  }
  function startBlocks(blocks: readonly PageBlock[],{validate=alwaysAllowed,retryErrors=true,viewportOnly=false}: TranslateBlocksOptions): Promise<PageStatus> {
    refreshPresentation();if(!validate())return Promise.resolve(status());
    const settings=getSettings(),key=pageTranslationKey(settings),created: PageEntry[]=[],selected: PageEntry[]=[];
    for(const {element,text} of candidatesOf(blocks)){
      let entry: PageEntry | null | undefined=entries.get(element);
      if(entry&&entry.source!==text){remove(entry);entry=null;}
      if(entry&&['pending','success'].includes(entry.status)){
        // A whole-page pass adopts existing work; disabling its former gesture cannot remove a page-owned row.
        if(validate===alwaysAllowed)entry.validate=alwaysAllowed;
        if(!viewportOnly)entry.viewportOnly=false;
        selected.push(entry);continue;
      }
      if(entry&&!retryErrors)continue;
      // Automatic passes leave a block alone once the page keeps discarding its fresh translation.
      if(!retryErrors&&(wipes.get(text)||0)>=WIPE_LIMIT)continue;
      if(entry)remove(entry);
      entry=makeEntry(element,text,key,validate,viewportOnly);created.push(entry);selected.push(entry);
    }
    if(created.length){cancelled=false;lastError='';void run(created,settings);}
    return Promise.all(selected.map(entry=>entry.done)).then(status);
  }
  function toggleBlocks(blocks: readonly PageBlock[],options: Pick<TranslateBlocksOptions,'validate'>={}): Promise<PageStatus> {
    return withLayoutCache(()=>startToggle(blocks,options));
  }
  function startToggle(blocks: readonly PageBlock[],{validate=alwaysAllowed}: Pick<TranslateBlocksOptions,'validate'>): Promise<PageStatus> {
    refreshPresentation();if(!validate())return Promise.resolve(status());
    const candidates=candidatesOf(blocks);
    // A translated region toggles closed even if language detection excluded some of its source units.
    if(candidates.some(({element,text})=>hasTranslation(element,text))){
      for(const {element} of candidates){const entry=entries.get(element);if(entry)remove(entry);}
      if(!entries.size)cancelled=false;
      return Promise.resolve(status());
    }
    return translateBlocks(candidates,{validate});
  }
  async function translatePage({retryErrors=true}: {retryErrors?:boolean}={}): Promise<PageStatus> {
    if(isPageSiteBlocked(getSettings(),route())){const error=new Error('当前网址已设为不翻译，可在网页翻译设置中修改。') as CodedError;error.code='SITE_DISABLED';throw error;}
    onBeforeTranslate();lastError='';return translateBlocks(collectBlocks(document,env,{visibleOnly:true}),{retryErrors,viewportOnly:true});
  }
  function reportError(error: unknown): void{lastError=String((error as {message?:unknown} | null)?.message||labels().failed);changed();}
  return { translatePage,translateBlocks,toggleBlocks,restore,cancelCurrent,status,refreshPresentation,hasTranslation,reportError,stop:restore };
}
