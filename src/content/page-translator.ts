import type {Settings} from '../shared/settings.js';
import type {Translate} from '../shared/messages.js';
import type {BrowserEnvironment,CodedError,PageBlock} from './dom.js';
import type {PageContent,PageLinkBinding} from './page-content.js';

export interface PageStatus {active:boolean;translated:number;errors:number;total:number;cancelled:boolean;isTranslated:boolean;error?:string}
export interface PageTranslatorOptions {document:Document;env?:BrowserEnvironment;translate:Translate;cancel?:(id:string)=>unknown;getSettings:()=>Settings;makeRequestId?:()=>string;onBeforeTranslate?:()=>void;onRestore?:()=>void}
export interface TranslateBlocksOptions {validate?:()=>boolean;retryErrors?:boolean;viewportOnly?:boolean}
type PageEntryStatus = 'pending'|'success'|'error'|'cancelled';
interface PageEntry {element:HTMLElement;source:string;key:string;validate:()=>boolean;viewportOnly:boolean;url:string;status:PageEntryStatus;output:HTMLElement|null;parts:(string|undefined)[];originals:HTMLElement[];content:PageContent;links:PageLinkBinding[];resolve:(()=>void)|null;done?:Promise<void>;titleLayout?:boolean;loadingHost?:HTMLElement|null;loadingNode?:Text|null;expected?:number}
interface PageRequest {owners:Set<PageEntry>;release:(()=>void)|null}

import { ancestors, BLOCK_SELECTOR, batches, blockText, collectBlocks, isChinese, isReadable, isInViewport, makeId, requestOptions, translationsOf } from './dom.js';
import {filterPageBlocks,isPageBlockAllowed,isPageSiteBlocked,pageTranslationKey} from './page-policy.js';
import {applyPageStyle} from '../shared/styles.js';
import {hideOriginal,restoreOriginal} from './originals.js';
import {capturePageContent,pageContentMatches,renderPageContent,refreshPageLinks,isPageLinkMutation,PAGE_LINK_ATTRIBUTES} from './page-content.js';

const words = {
  zh:{loading:'翻译中…',cancelled:'已停止',retry:'重试',failed:'翻译失败，请重试。'},
  en:{loading:'Translating…',cancelled:'Stopped',retry:'Retry',failed:'Translation failed. Please retry.'},
};
const alwaysAllowed=()=>true;

/** Append translations to existing blocks. Original nodes and listeners never move. */
export function createPageTranslator({ document, env = globalThis, translate, cancel = () => {}, getSettings, makeRequestId = makeId,onBeforeTranslate=()=>{},onRestore=()=>{} }: PageTranslatorOptions) {
  const entries = new Map<HTMLElement,PageEntry>(), requests = new Map<string,PageRequest>(),loadingEntries=new Set<PageEntry>(),loadingDisposers: (()=>void)[]=[];
  const requestCancelled=Symbol('cancelled request');
  let cancelled = false,observer: MutationObserver|null=null,repairQueued=false,titleLayoutStyle: HTMLStyleElement|null=null,lastError='';
  const labels = () => words[isChinese(getSettings(), env) ? 'zh' : 'en'];
  const route = () => env.location?.href || '';
  const status = (): PageStatus => {
    const all = [...entries.values()], translated = all.filter(entry => entry.status === 'success').length;
    return { active:all.some(entry=>entry.status==='pending'), translated, errors:all.filter(entry => entry.status === 'error').length, total:all.length, cancelled, isTranslated:translated > 0,...(lastError?{error:lastError}:{}) };
  };
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
    releaseRequests(entry);removeLoading(entry);restoreOriginal(entry);entry.output?.remove();finish(entry);
    if(entry.titleLayout&&entry.element.getAttribute('data-kuai-title-layout')==='stacked')entry.element.removeAttribute('data-kuai-title-layout');
    if(entries.get(entry.element)===entry)entries.delete(entry.element);
    if(!entries.size){observer?.disconnect();observer=null;titleLayoutStyle?.remove();titleLayoutStyle=null;}
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
    const entry: PageEntry={element,source,key,validate,viewportOnly,url:route(),status:'pending',output:null,parts:[],originals:[],content:capturePageContent(element,env),links:[],resolve:null};
    entry.done=new Promise<void>(resolve=>{entry.resolve=resolve;});entries.set(element,entry);observe();return entry;
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
      titleLayoutStyle.textContent='h1[data-kuai-title-layout=stacked]{display:block!important;height:auto!important;max-height:none!important;overflow:visible!important}h1[data-kuai-title-layout=stacked]>[data-kuai-page-translation]{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important}';
      document.documentElement.append(titleLayoutStyle);
    }
    element.setAttribute('data-kuai-title-layout','stacked');entry.titleLayout=true;
  }
  function lastSourceText(element: HTMLElement): Text | null{
    let last: Text|null=null;
    const visit=(node: Node): void=>{
      if(node.nodeType===3){if(/\S/u.test(node.nodeValue||''))last=node as Text;return;}
      if(node.nodeType!==1||node!==element&&((node as HTMLElement).matches?.(BLOCK_SELECTOR)||!isReadable(node as HTMLElement,env)))return;
      for(const child of node.childNodes)visit(child);
    };
    visit(element);return last;
  }
  function positionLoading(entry: PageEntry): void{
    const spinner=entry.loadingHost;if(!spinner?.isConnected)return;
    const visible=entry.element.isConnected&&isReadable(entry.element,env)&&isInViewport(entry.element,env);
    spinner.style.setProperty('display',visible?'block':'none','important');if(!visible)return;
    let rect;const node=entry.loadingNode;
    if(node?.isConnected)try{
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,node.nodeValue!.length);
      rect=Array.from(range.getClientRects?.()||[]).at(-1)||range.getBoundingClientRect?.();
    }catch{}
    rect ||=entry.element.getBoundingClientRect();
    const x=Math.max(0,Math.min((env.innerWidth||1200)-14,(rect.right||0)+4)),y=Math.max(0,(rect.bottom||0)-13);
    const endVisible=rect.right>0&&rect.right<=(env.innerWidth||1200)&&rect.bottom>0&&rect.bottom<=(env.innerHeight||800)&&ancestors(node||entry.element).every(ancestor=>{
      const style=env.getComputedStyle?.(ancestor),clipX=/^(auto|scroll|hidden|clip)$/.test(style?.overflowX||style?.overflow||''),clipY=/^(auto|scroll|hidden|clip)$/.test(style?.overflowY||style?.overflow||'');
      if(!clipX&&!clipY)return true;const bounds=ancestor.getBoundingClientRect();
      return (!clipX||x>=bounds.left&&x+12<=bounds.right)&&(!clipY||y>=bounds.top&&y+12<=bounds.bottom);
    });
    spinner.style.setProperty('display',endVisible?'block':'none','important');
    spinner.style.setProperty('left',x+'px','important');spinner.style.setProperty('top',y+'px','important');
  }
  function positionLoaders(){for(const entry of loadingEntries)positionLoading(entry);}
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
    positionLoading(entry);
  }
  function ensureOutput(entry: PageEntry): asserts entry is PageEntry & {output:HTMLElement} {
    if(entry.output)return;
    const output = document.createElement('span');
    output.setAttribute('data-kuai-owned',''); output.setAttribute('data-kuai-page-translation','');
    output.setAttribute('lang',getSettings().targetLanguage || '');
    output.setAttribute('role','status');output.setAttribute('aria-live','polite');
    output.style.cssText = 'display:block!important;margin:.35em 0 .5em;white-space:pre-wrap;overflow-wrap:anywhere;';
    entry.element.append(output);entry.output=output;
  }
  function present(entry: PageEntry): void {
    if(!entry.output)return;
    const settings=getSettings(),style=settings.pageStyle||{};
    if(entry.status==='pending'){
      restoreOriginal(entry);
      entry.output.style.cssText='display:none!important;';appendLoading(entry);
      entry.output.setAttribute('aria-label',labels().loading);return;
    }
    removeLoading(entry);entry.output.style.cssText='display:block!important;margin:.35em 0 .5em;white-space:pre-wrap;overflow-wrap:anywhere;';
    entry.output.removeAttribute('aria-label');stackYouTubeTitle(entry);
    if(entry.status==='success')refreshPageLinks(entry.links,document,env);
    applyPageStyle(entry.output,entry.status==='success'?style:{...style,preset:style.preset==='blur'?'plain':style.preset,opacity:100});
    if(settings.pageDisplayMode==='translation_only'&&entry.status==='success')hideOriginal(entry,document,env);
    else restoreOriginal(entry);
  }
  function current(entry: PageEntry): boolean {
    if(entries.get(entry.element)!==entry)return false;
    if(entry.url!==route()||entry.key!==pageTranslationKey(getSettings())||!entry.validate()||
      !isReadable(entry.element,env)||blockText(entry.element,env)!==entry.source||!pageContentMatches(entry.content,entry.element,env)||
      entry.output&&(!entry.output.isConnected||!entry.element.contains(entry.output))||
      !isPageBlockAllowed({element:entry.element,text:entry.source},getSettings(),{url:route()})){
      remove(entry);return false;
    }
    return true;
  }
  function refreshPresentation() {
    for(const entry of [...entries.values()])if(current(entry))present(entry);
    return status();
  }
  function hasTranslation(element: HTMLElement,source: string): boolean {
    const entry=entries.get(element);
    return !!entry&&current(entry)&&entry.source===source&&['pending','success'].includes(entry.status);
  }
  function show(entry: PageEntry, text: string, state: PageEntryStatus): void {
    ensureOutput(entry);entry.status = state;entry.output.setAttribute('data-state',state);entry.output.setAttribute('aria-busy',String(state==='pending'));entry.output.replaceChildren();
    entry.links=[];
    if(state!=='pending'&&entry.output.parentNode!==entry.element)entry.element.append(entry.output);
    if(state==='pending')appendLoading(entry);
    else if(state==='success')entry.links=renderPageContent(entry.output,entry.content,entry.parts,{document,env,valid:()=>current(entry)});
    else entry.output.append(document.createTextNode(text));
    if (state === 'error' || state === 'cancelled') {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = labels().retry;
      retry.style.cssText = 'font:inherit;margin-left:.5em;padding:.1em .5em;cursor:pointer;';
      retry.addEventListener('click',event => {
        event.preventDefault();event.stopPropagation();
        if(current(entry))void translateBlocks([{element:entry.element,text:entry.source}],{validate:entry.validate}).catch(reportError);
      });entry.output.append(retry);
    }
    present(entry);if(state!=='pending')finish(entry);
  }
  function cancelCurrent() {
    cancelled = true;
    for(const id of [...requests.keys()])abortRequest(id);
    for(const entry of [...entries.values()])if(entry.status==='pending'){
      if(entry.output&&current(entry))show(entry,labels().cancelled,'cancelled');else remove(entry);
    }
    return status();
  }
  function restore() {
    onRestore();cancelled = false;lastError='';
    for(const entry of [...entries.values()])remove(entry);
    observer?.disconnect();observer=null;return status();
  }
  function candidatesOf(blocks: readonly PageBlock[] | null | undefined): PageBlock[] {
    const seen=new Set<HTMLElement>(),result: PageBlock[]=[];
    for(const block of blocks||[]){
      if(seen.has(block?.element)||typeof block?.text!=='string')continue;seen.add(block.element);
      if(isReadable(block.element,env)&&blockText(block.element,env)===block.text&&isPageBlockAllowed(block,getSettings(),{url:route()}))result.push(block);
    }
    return result;
  }
  async function run(created: PageEntry[],settings: Settings): Promise<void> {
    try{
      const selected=filterPageBlocks(created.map(entry=>({element:entry.element,text:entry.source})),settings,{env,url:created[0].url});
      const blocks=(selected&&typeof (selected as Promise<PageBlock[]>).then==='function'?await selected:selected) as PageBlock[];
      const eligible=new Set(blocks.map(block=>block.element)),units: {entry:PageEntry;index:number;text:string}[]=[];
      for(const entry of created){
        if(!current(entry)||entry.status!=='pending')continue;
        if(!eligible.has(entry.element)||entry.viewportOnly&&!isInViewport(entry.element,env)){remove(entry);continue;}
        show(entry,labels().loading,'pending');
        const parts=entry.content.units;entry.expected=parts.length;
        if(!parts.length){show(entry,'','success');continue;}
        parts.forEach((text,index)=>units.push({entry,index,text}));
      }
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
          batch.forEach((unit,index)=>{
            const entry=unit.entry;if(!current(entry)||entry.status!=='pending')return;
            entry.parts[unit.index]=translated[index];
            if(entry.parts.filter(value=>typeof value==='string').length===entry.expected)show(entry,entry.parts.join(' '),'success');
          });
        }catch(error){
          requests.delete(id);
          // A provider failure stops only this operation, including its queued rows.
          for(const entry of created)if(current(entry)&&entry.status==='pending')show(entry,String((error as {message?:unknown} | null)?.message||labels().failed),'error');
          break;
        }

      }
    }catch(error){
      for(const entry of created)if(current(entry)&&entry.status==='pending')show(entry,String((error as {message?:unknown} | null)?.message||labels().failed),'error');
    }
  }
  function translateBlocks(blocks: readonly PageBlock[],{validate=alwaysAllowed,retryErrors=true,viewportOnly=false}: TranslateBlocksOptions={}): Promise<PageStatus> {
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
      if(entry)remove(entry);
      entry=makeEntry(element,text,key,validate,viewportOnly);created.push(entry);selected.push(entry);
    }
    if(created.length){cancelled=false;lastError='';void run(created,settings);}
    return Promise.all(selected.map(entry=>entry.done)).then(status);
  }
  function toggleBlocks(blocks: readonly PageBlock[],{validate=alwaysAllowed}: Pick<TranslateBlocksOptions,'validate'>={}): Promise<PageStatus> {
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
  function reportError(error: unknown): void{lastError=String((error as {message?:unknown} | null)?.message||labels().failed);}
  return { translatePage,translateBlocks,toggleBlocks,restore,cancelCurrent,status,refreshPresentation,hasTranslation,reportError,stop:restore };
}
