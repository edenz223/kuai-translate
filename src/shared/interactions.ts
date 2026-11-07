/** Public interaction data and pure matching helpers. This module has no DOM or network effects. */
const defaults=<T extends Record<string, unknown>>(value:T): Readonly<T> =>Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,Array.isArray(item)?Object.freeze(item):item])) as T);
export const PAGE_OPTIONS_DEFAULTS=defaults({
  autoTranslate:false,alwaysLanguages:[],neverLanguages:[],alwaysSites:[],neverSites:[],translateFullPage:true,
  excludeSelectors:[],minTextLength:1,translateDynamic:false,contextMenuEnabled:true,shortcut:'Alt+Z',displayModeShortcut:'',
});
export const SELECTION_OPTIONS_DEFAULTS=defaults({
  providerId:'follow_page',sourceLanguage:'follow_page',targetLanguage:'follow_page',triggerMode:'auto',triggerAction:'click',
  delay:250,maxLength:5000,showOriginal:true,autoSpeak:false,disabledSites:[],
});
export const INPUT_OPTIONS_DEFAULTS=defaults({
  enabled:true,providerId:'follow_page',sourceLanguage:'follow_page',targetLanguage:'en',shortcut:'Alt+X',
  restoreShortcut:'',icon:'dot',autoApply:true,includeOriginal:false,displayOrder:'original-translation',disabledSites:[],
});
export const HOVER_OPTIONS_DEFAULTS=defaults({
  trigger:'shift',customKeys:[],mode:'paragraph',displayMode:'inline',delay:300,holdDelay:800,showIndicator:true,borderColor:'#cfcfcf',disabledSites:[],
});

// Legacy/import records have heterogeneous nested fields; normalized results are concrete.
const record=(value: unknown): Record<string, any> =>value && typeof value==='object' && !Array.isArray(value)?value as Record<string, any>:{};
const boolean=(value: unknown,fallback: boolean)=>typeof value==='boolean'?value:fallback;
const choice=(value: unknown,values: readonly string[],fallback: string): string=>values.includes(value as string)?value as string:fallback;
const modifiers=['Control','Alt','Shift','Meta'];
const keyAliases: Record<string,string>={CTRL:'Control',CONTROL:'Control',ALT:'Alt',OPT:'Alt',OPTION:'Alt',SHIFT:'Shift',META:'Meta',CMD:'Meta',COMMAND:'Meta'};
const lines=(value: unknown): unknown[] =>Array.isArray(value)?value:typeof value==='string'?value.split(/\r?\n/):[];
function bounded(value: unknown,minimum: number,maximum: number,fallback: number) {
  if(typeof value!=='number' && (typeof value!=='string' || !value.trim())) return fallback;
  const number=Number(value);
  return Number.isFinite(number)?Math.floor(Math.min(maximum,Math.max(minimum,number))):fallback;
}
function list(value: unknown,limit=100,transform: (value:string)=>string=value=>value) {
  const result: string[]=[],seen=new Set<string>();
  for(const item of lines(value)) {
    if(typeof item!=='string' || item.length>2000 || /[\u0000-\u001f\u007f]/.test(item)) continue;
    const normalized=transform(item.trim());
    if(!normalized || seen.has(normalized)) continue;
    result.push(normalized);seen.add(normalized);
    if(result.length>=limit) break;
  }
  return result;
}
function language(value: unknown,fallback='follow_page',allowAuto=false,allowFollow=true) {
  if(typeof value!=='string') return fallback;
  const candidate=value.trim().replace(/_/g,'-');
  if(candidate==='follow-page') return allowFollow?'follow_page':fallback;
  if(allowAuto && candidate.toLowerCase()==='auto') return 'auto';
  if(candidate.length>32 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(candidate)) return fallback;
  try { return Intl.getCanonicalLocales(candidate)[0] || fallback; } catch { return fallback; }
}
function provider(value: unknown,providers?: readonly {id:string;enabled:boolean}[]) {
  if(value==='follow_page') return value;
  if(typeof value!=='string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) return 'follow_page';
  return !Array.isArray(providers) || providers.some(item=>item.id===value && item.enabled===true)?value:'follow_page';
}

export function normalizeKey(value: unknown) {
  if(typeof value!=='string') return '';
  const candidate=value.trim().toUpperCase();
  return keyAliases[candidate] || (/^[A-Z]$/.test(candidate)?candidate:'');
}

export function normalizeShortcut(value:unknown):string;
export function normalizeShortcut(value:unknown,fallback:string):string;
export function normalizeShortcut(value:unknown,fallback:null):string|null;
export function normalizeShortcut(value: unknown,fallback:string|null='') {
  if(typeof value!=='string') return fallback;
  if(!value.trim()) return '';
  if(value.length>120) return fallback;
  const parts=value.split('+').map(normalizeKey),letter=parts.pop();
  if(!/^[A-Z]$/.test(letter || '') || !parts.length || parts.some(key=>!modifiers.includes(key)) || new Set(parts).size!==parts.length) return fallback;
  return [...modifiers.filter(key=>parts.includes(key)),letter].join('+');
}

function sitePattern(value: unknown) {
  if(typeof value!=='string' || !value || value.length>2000 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  let rest=value,protocol='';
  const scheme=rest.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if(scheme) {
    protocol=scheme[1].toLowerCase()+':';
    if(protocol!=='http:' && protocol!=='https:') return null;
    rest=rest.slice(scheme[0].length);
  } else if(rest.includes('://')) return null;
  const boundary=rest.search(/[/?#]/),authority=boundary<0?rest:rest.slice(0,boundary);
  let path=boundary<0?'':rest.slice(boundary);
  if(!authority || /[@%]/.test(authority)) return null;
  const wildcard=authority.startsWith('*.'),rawHost=wildcard?authority.slice(2):authority;
  let host='',port='';
  if(rawHost==='*' && !wildcard) host='*';
  else {
    if(rawHost.includes('*')) return null;
    try {
      const parsed=new URL(`${protocol || 'https:'}//${rawHost}`);
      host=parsed.hostname.toLowerCase().replace(/\.+$/,'');
      if(!host || parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash) return null;
      if(!host.startsWith('[') && host.split('.').some(label=>!(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))) return null;
      if(wildcard && host.startsWith('[')) return null;
      const explicitPort=rawHost.match(/:(\d+)$/);
      if(explicitPort) port=String(Number(explicitPort[1]));
      else if(rawHost.endsWith(':')) return null;
    } catch { return null; }
  }
  if(path && !path.startsWith('/')) path='/'+path;
  if(path) {
    try {const parsedPath=new URL('https://pattern.invalid'+path);path=parsedPath.pathname+parsedPath.search+parsedPath.hash;}
    catch {return null;}
  }
  const canonical=`${protocol?protocol+'//':''}${wildcard?'*.':''}${host}${port?':'+port:''}${path}`;
  if(canonical.length>2000) return null;
  return {canonical,protocol,host,port,path};
}

export function normalizeSiteList(value: unknown) {
  return list(value,100,item=>sitePattern(item)?.canonical || '');
}

/** A small wildcard state machine treats every non-star character literally. */
function matchesPath(pattern:string,value:string,budget:{remaining:number}) {
  const tokens:string[]=[];
  for(let index=0;index<pattern.length;index++) {
    if(pattern[index]!=='*') {tokens.push(pattern[index]);continue;}
    let count=1;
    while(pattern[index+1]==='*') {index++;count++;}
    tokens.push(count>1?'**':'*');
  }
  const expand=(states:Set<number>)=>{
    for(const index of states) if(tokens[index]==='*' || tokens[index]==='**') states.add(index+1);
    return states;
  };
  let states=expand(new Set([0]));
  for(const character of value) {
    const next=new Set<number>();
    for(const index of states) {
      if(--budget.remaining<0) return false;
      const token=tokens[index];
      if(token==='**' || token==='*' && character!=='/') next.add(index);
      else if(token===character) next.add(index+1);
    }
    if(!next.size) return false;
    states=expand(next);
  }
  return states.has(tokens.length);
}

export function isSiteListed(url:string,patterns:unknown) {
  let parsed;
  try { parsed=new URL(url); } catch { return false; }
  if(!['https:','http:'].includes(parsed.protocol)) return false;
  const host=parsed.hostname.toLowerCase().replace(/\.+$/,''),path=parsed.pathname+parsed.search+parsed.hash;
  const budget={remaining:2000000};
  for(const value of normalizeSiteList(patterns)) {
    const pattern=sitePattern(value)!;
    if(pattern.protocol && pattern.protocol!==parsed.protocol) continue;
    if(pattern.port && pattern.port!==(parsed.port || (parsed.protocol==='https:'?'443':'80'))) continue;
    if(pattern.host!=='*' && host!==pattern.host && !host.endsWith('.'+pattern.host)) continue;
    if(!pattern.path || matchesPath(pattern.path,path,budget)) return true;
    if(budget.remaining<0) return false;
  }
  return false;
}

export function normalizeInteractionOptions(input?:unknown,providers?:readonly {id:string;enabled:boolean}[]) {
  const value=record(input),page=record(value.pageOptions),selection=record(value.selectionOptions),typed=record(value.inputOptions),hover=record(value.hoverOptions);
  const p=PAGE_OPTIONS_DEFAULTS,s=SELECTION_OPTIONS_DEFAULTS,i=INPUT_OPTIONS_DEFAULTS,h=HOVER_OPTIONS_DEFAULTS;
  return {
    pageOptions:{
      autoTranslate:boolean(page.autoTranslate,p.autoTranslate),alwaysLanguages:list(page.alwaysLanguages,100,item=>language(item,'',false,false)),
      neverLanguages:list(page.neverLanguages,100,item=>language(item,'',false,false)),alwaysSites:normalizeSiteList(page.alwaysSites),neverSites:normalizeSiteList(page.neverSites),
      translateFullPage:boolean(page.translateFullPage,p.translateFullPage),excludeSelectors:list(page.excludeSelectors,50),minTextLength:bounded(page.minTextLength,1,200,p.minTextLength),
      translateDynamic:boolean(page.translateDynamic,p.translateDynamic),contextMenuEnabled:boolean(page.contextMenuEnabled,p.contextMenuEnabled),
      shortcut:normalizeShortcut(page.shortcut,p.shortcut),displayModeShortcut:normalizeShortcut(page.displayModeShortcut,p.displayModeShortcut),
    },
    selectionOptions:{
      providerId:provider(selection.providerId,providers),sourceLanguage:language(selection.sourceLanguage,s.sourceLanguage,true),targetLanguage:language(selection.targetLanguage,s.targetLanguage),
      triggerMode:choice(selection.triggerMode,['auto','icon','dot','shift','alt','ctrl','meta'],s.triggerMode),triggerAction:choice(selection.triggerAction,['click','hover'],s.triggerAction),
      delay:bounded(selection.delay,0,2000,s.delay),maxLength:bounded(selection.maxLength,1,50000,s.maxLength),
      showOriginal:boolean(selection.showOriginal,s.showOriginal),autoSpeak:boolean(selection.autoSpeak,s.autoSpeak),disabledSites:normalizeSiteList(selection.disabledSites),
    },
    inputOptions:{
      enabled:boolean(typed.enabled,i.enabled),providerId:provider(typed.providerId,providers),sourceLanguage:language(typed.sourceLanguage,i.sourceLanguage,true),targetLanguage:language(typed.targetLanguage,i.targetLanguage),
      shortcut:normalizeShortcut(typed.shortcut,i.shortcut),restoreShortcut:normalizeShortcut(typed.restoreShortcut,i.restoreShortcut),icon:choice(typed.icon,['none','dot','icon'],i.icon),
      autoApply:boolean(typed.autoApply,i.autoApply),includeOriginal:boolean(typed.includeOriginal,i.includeOriginal),
      displayOrder:choice(typed.displayOrder,['original-translation','translation-original'],i.displayOrder),disabledSites:normalizeSiteList(typed.disabledSites),
    },
    hoverOptions:{
      trigger:choice(hover.trigger,['ctrl','shift','alt','left_hold','hover','custom'],h.trigger),customKeys:list(hover.customKeys,2,normalizeKey),
      // Older popup-hover preferences now use the shared webpage renderer.
      mode:choice(hover.mode,['paragraph','area'],h.mode),displayMode:'inline',
      delay:bounded(hover.delay,50,3000,h.delay),holdDelay:bounded(hover.holdDelay,200,3000,h.holdDelay),
      showIndicator:boolean(hover.showIndicator,h.showIndicator),borderColor:typeof hover.borderColor==='string' && /^#[a-f0-9]{6}$/i.test(hover.borderColor)?hover.borderColor.toLowerCase():h.borderColor,
      disabledSites:normalizeSiteList(hover.disabledSites),
    },
  };
}

export function resolveFeatureSettings<T extends Record<string, any>>(settings:T,feature:string):T {
  const value=record(settings) as T,options=normalizeInteractionOptions(value,value.providers);
  const selected=feature==='selection'?options.selectionOptions:feature==='input'?options.inputOptions:null;
  if(!selected) return {...value};
  return {
    ...value,activeProviderId:selected.providerId==='follow_page'?value.activeProviderId:selected.providerId,
    sourceLanguage:selected.sourceLanguage==='follow_page'?value.sourceLanguage:selected.sourceLanguage,
    targetLanguage:selected.targetLanguage==='follow_page'?value.targetLanguage:selected.targetLanguage,
  };
}

export function interactionConfigurationKey(settings:unknown) {
  const value=record(settings),options=normalizeInteractionOptions(value,value.providers);
  const identities=['selection','input','hover'].map(feature=>{
    const effective=resolveFeatureSettings(value,feature),chosen=value.providers?.find((item:{id:string;type?:string;model?:string;enabled?:boolean})=>item.id===effective.activeProviderId);
    return [effective.activeProviderId,effective.sourceLanguage,effective.targetLanguage,chosen?.type,chosen?.model,chosen?.enabled];
  });
  return JSON.stringify([boolean(value.selectionEnabled,false),boolean(value.hoverEnabled,true),options,value.providerRevision??0,identities]);
}

export type InteractionOptions = ReturnType<typeof normalizeInteractionOptions>;
