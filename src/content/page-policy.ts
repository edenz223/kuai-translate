import {debug} from '../shared/debug.js';
import type {Settings} from '../shared/settings.js';
import type {BrowserEnvironment,PageBlock} from './dom.js';

import {ancestors,collectBlocks,configurationKey,isBlock,isNonLanguageText} from './dom.js';
import {normalizeInteractionOptions,isSiteListed} from '../shared/interactions.js';

const options=(settings: Partial<Settings>)=>normalizeInteractionOptions(settings,settings.providers).pageOptions;
function language(value: unknown): string{
  if(typeof value!=='string'||value.length>32)return '';
  const code=value.trim().replace(/_/g,'-').toLowerCase();
  if(!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)||code==='und')return '';
  if(/^zh-(?:cn|sg|hans)(?:-|$)/.test(code))return 'zh-hans';
  if(/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(code))return 'zh-hant';
  return code;
}
export function languageListed(value: unknown,list: readonly string[]): boolean{
  const code=language(value);if(!code)return false;
  return list.some(item=>{const rule=language(item);return rule&&(code===rule||code.startsWith(rule+'-'));});
}
function declaredLanguage(element: HTMLElement): string{
  for(const node of ancestors(element)){const code=language(node.getAttribute?.('lang'));if(code)return code;}
  return '';
}

/** Browser language detection stays local to this extension context and is optional. */
export function detectTextLanguage(text: string,element: HTMLElement,env: BrowserEnvironment=globalThis): Promise<string>{
  const declared=declaredLanguage(element);if(declared)return Promise.resolve(declared);
  const i18n=env.chrome?.i18n;if(typeof i18n?.detectLanguage!=='function'||!text?.trim())return Promise.resolve('');
  return new Promise<string>(resolve=>{
    let settled=false;
    const finish=(code: string): void=>{if(settled)return;settled=true;(env.clearTimeout||globalThis.clearTimeout)(timer);resolve(code);};
    const timer=(env.setTimeout||globalThis.setTimeout)(()=>finish(''),1500);
    try{
      Promise.resolve(i18n.detectLanguage(String(text).slice(0,4096))).then(result=>{
        const item=result?.isReliable&&Array.isArray(result.languages)?result.languages.filter(item=>Number(item.percentage)>=70).sort((a,b)=>b.percentage-a.percentage)[0]:null;
        finish(language(item?.language));
      },error=>{debug('page:language','error',error);finish('');});
    }catch(error){debug('page:language','error',error);finish('');}
  });
}

export function isPageSiteBlocked(settings: Settings,url: string): boolean{return isSiteListed(url,options(settings).neverSites);}
export function pageTranslationKey(settings: Partial<Settings>): string{
  const value=options(settings);
  return JSON.stringify([configurationKey(settings),value.neverSites,value.neverLanguages,value.translateFullPage,value.excludeSelectors,value.minTextLength]);
}

function blockSkipReason({element,text}: PageBlock,value: ReturnType<typeof options>,env: BrowserEnvironment): string{
  if(!element?.isConnected||typeof text!=='string'||!/\p{L}/u.test(text)||isNonLanguageText(text))return 'non-language-or-detached';
  if([...text.trim()].length<value.minTextLength)return 'min-length';
  if(languageListed(declaredLanguage(element),value.neverLanguages))return 'language';
  if(!value.translateFullPage&&element.closest?.('footer,[role="contentinfo"]'))return 'page-area';
  for(const selector of value.excludeSelectors){try{
    if(element.closest?.(selector))return 'selector';
    for(const excluded of element.querySelectorAll?.(selector)||[]){
      if(ancestors(excluded).some(node=>node.hasAttribute?.('data-kuai-owned')))continue;
      // blockText skips nested blocks; an excluded inline region belongs to this entire source unit.
      let owner: Element | null=excluded;while(owner&&owner!==element&&!isBlock(owner,env))owner=owner.parentElement;
      if(owner===element)return 'selector';
    }
  }catch{/* Invalid selectors never become code or broad matches. */}}
  return '';
}

/** Recheck current DOM policy without starting asynchronous language detection. */
export function isPageBlockAllowed(block: PageBlock,settings: Settings,{env=globalThis,url=env.location?.href||''}: {env?:BrowserEnvironment;url?:string}={}): boolean{
  return !pageBlockSkipReason(block,settings,{env,url});
}

/** A reason can be counted by a pass without logging individual DOM nodes. */
export function pageBlockSkipReason(block:PageBlock,settings:Settings,{env=globalThis,url=env.location?.href||''}:{env?:BrowserEnvironment;url?:string}={}):string{
  const value=options(settings);return isSiteListed(url,value.neverSites)?'site-rule':blockSkipReason(block,value,env);
}

/** Sync for ordinary pages; async only when per-paragraph language filtering is requested. */
export function filterPageBlocks(blocks: PageBlock[],settings: Settings,{env=globalThis,url=env.location?.href||''}: {env?:BrowserEnvironment;url?:string}={}): PageBlock[] | Promise<PageBlock[]>{
  const value=options(settings),blocked=isSiteListed(url,value.neverSites),skips:Record<string,number>={};
  const skip=(reason:string)=>{skips[reason]=(skips[reason]||0)+1;};
  const filtered=blocks.filter(block=>{const reason=blocked?'site-rule':blockSkipReason(block,value,env);if(reason)skip(reason);return !reason;});
  const finish=(selected:PageBlock[])=>{debug('page:policy','pass',{collected:blocks.length,selected:selected.length,skipped:blocks.length-selected.length,reasons:skips});return selected;};
  if(blocked||!value.neverLanguages.length)return finish(filtered);
  return Promise.all(filtered.map(async block=>({block,code:await detectTextLanguage(block.text,block.element,env)})))
    .then(items=>finish(items.filter(item=>{const reason=languageListed(item.code,value.neverLanguages)?'language':pageBlockSkipReason(item.block,settings,{env,url});if(reason)skip(reason);return !reason;}).map(item=>item.block)));
}

export async function shouldAutoTranslate(document: Document,settings: Settings,env: BrowserEnvironment=globalThis): Promise<boolean>{
  const value=options(settings),url=env.location?.href||'';
  if(!value.autoTranslate||!/^https?:/i.test(url)||isSiteListed(url,value.neverSites))return false;
  const sample=collectBlocks(document,env).map(item=>item.text).join(' ').slice(0,4096);
  const code=await detectTextLanguage(sample,document.body||document.documentElement,env);
  if(languageListed(code,value.neverLanguages))return false;
  const target=language(settings.targetLanguage);
  if(code&&target&&(code===target||!code.includes('-')&&target.startsWith(code+'-')||code.startsWith(target+'-')))return false;
  return !value.alwaysSites.length&&!value.alwaysLanguages.length||isSiteListed(url,value.alwaysSites)||languageListed(code,value.alwaysLanguages);
}
