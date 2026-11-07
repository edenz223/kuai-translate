/** Per-site page rule shortcuts for the popup and context menu; the options page keeps the full rule lists. */
import type {Settings} from './settings.js';
import {isSiteListed,normalizeSiteList} from './interactions.js';

export type SiteRule = 'default' | 'always' | 'never';
const LIMIT=100;

export function siteHost(url: string): string{
  try{const parsed=new URL(url);return /^https?:$/.test(parsed.protocol)?parsed.hostname.toLowerCase().replace(/\.+$/,''):'';}catch{return '';}
}

/** The effective rule for this URL, matching the page auto-translate policy. */
export function siteRuleState(settings: Settings,url: string): SiteRule{
  const value=settings.pageOptions;
  if(isSiteListed(url,value.neverSites))return 'never';
  if(value.autoTranslate&&(isSiteListed(url,value.alwaysSites)||!value.alwaysSites.length&&!value.alwaysLanguages.length))return 'always';
  return 'default';
}

/** Edits only this host's own entries; broader patterns written in the options page stay untouched. */
export function applySiteRule(settings: Settings,url: string,rule: SiteRule): void{
  const host=siteHost(url);
  if(!host)throw Error('只能为普通网页设置网站规则。');
  const value=settings.pageOptions,without=(list: string[])=>list.filter(item=>item!==host);
  const add=(list: string[]): string[]=>{
    const next=normalizeSiteList([...without(list),host]);
    if(!next.includes(host))throw Error(`网站规则已达 ${LIMIT} 项上限，请在设置中整理后重试。`);
    return next;
  };
  const scopedToHost=value.alwaysSites.includes(host);
  value.neverSites=without(value.neverSites);value.alwaysSites=without(value.alwaysSites);
  // An emptied allow-list would otherwise widen auto-translate from this host to every site.
  if(scopedToHost&&!value.alwaysSites.length&&!value.alwaysLanguages.length)value.autoTranslate=false;
  if(rule==='never')value.neverSites=add(value.neverSites);
  else if(rule==='always'&&siteRuleState(settings,url)!=='always'){
    // Enabling auto-translate with empty lists would match every site, so record this host explicitly.
    value.alwaysSites=add(value.alwaysSites);value.autoTranslate=true;
  }
}
