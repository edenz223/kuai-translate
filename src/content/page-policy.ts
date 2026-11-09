import type {Settings} from '../shared/settings.js';
import type {BrowserEnvironment,PageBlock} from './dom.js';

import {ancestors,collectBlocks,configurationKey,isBlock,isUrlText} from './dom.js';
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
      },()=>finish(''));
    }catch{finish('');}
  });
}

export function isPageSiteBlocked(settings: Settings,url: string): boolean{return isSiteListed(url,options(settings).neverSites);}
export function pageTranslationKey(settings: Partial<Settings>): string{
  const value=options(settings);
  return JSON.stringify([configurationKey(settings),value.neverSites,value.neverLanguages,value.translateFullPage,value.excludeSelectors,value.minTextLength]);
}

function blockAllowed({element,text}: PageBlock,value: ReturnType<typeof options>,env: BrowserEnvironment): boolean{
  if(!element?.isConnected||typeof text!=='string'||!/\p{L}/u.test(text)||isUrlText(text)||[...text.trim()].length<value.minTextLength)return false;
  if(languageListed(declaredLanguage(element),value.neverLanguages))return false;
  if(!value.translateFullPage&&element.closest?.('footer,[role="contentinfo"]'))return false;
  for(const selector of value.excludeSelectors){try{
    if(element.closest?.(selector))return false;
    for(const excluded of element.querySelectorAll?.(selector)||[]){
      if(ancestors(excluded).some(node=>node.hasAttribute?.('data-kuai-owned')))continue;
      // blockText skips nested blocks; an excluded inline region belongs to this entire source unit.
      let owner: Element | null=excluded;while(owner&&owner!==element&&!isBlock(owner,env))owner=owner.parentElement;
      if(owner===element)return false;
    }
  }catch{/* Invalid selectors never become code or broad matches. */}}
  return true;
}

/** Recheck current DOM policy without starting asynchronous language detection. */
export function isPageBlockAllowed(block: PageBlock,settings: Settings,{env=globalThis,url=env.location?.href||''}: {env?:BrowserEnvironment;url?:string}={}): boolean{
  const value=options(settings);return !isSiteListed(url,value.neverSites)&&blockAllowed(block,value,env);
}

/** Sync for ordinary pages; async only when per-paragraph language filtering is requested. */
export function filterPageBlocks(blocks: PageBlock[],settings: Settings,{env=globalThis,url=env.location?.href||''}: {env?:BrowserEnvironment;url?:string}={}): PageBlock[] | Promise<PageBlock[]>{
  const value=options(settings);if(isSiteListed(url,value.neverSites))return [];
  const filtered=blocks.filter(block=>blockAllowed(block,value,env));
  if(!value.neverLanguages.length)return filtered;
  return Promise.all(filtered.map(async block=>({block,code:await detectTextLanguage(block.text,block.element,env)})))
    .then(items=>items.filter(item=>!languageListed(item.code,value.neverLanguages)&&isPageBlockAllowed(item.block,settings,{env,url})).map(item=>item.block));
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
