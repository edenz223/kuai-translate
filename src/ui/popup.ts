import type {PageActionType,MessageResponse} from '../shared/messages.js';
import type {SettingsChange} from './state.js';
import type {Settings} from '../shared/settings.js';

export interface PageActionResult {
  active?: boolean; total?: number; translated?: number; errors?: number; cancelled?: boolean; error?: string;
  opened?: boolean; message?: string;
}
type PageActionResponse = MessageResponse<PageActionResult>;

import {getSettings, request} from '../shared/client.js';
import {normalizeSettings} from '../shared/settings.js';
import {createSettingsEditor} from './state.js';
import {videoIdFromUrl} from '../youtube/captions.js';
import {byId,fillProviders,fillSelect,LANGUAGES,setStatus,errorMessage,needsKey,keyLabel,hoverTriggers,selectionTriggers,type SelectEntry} from './common.js';
import {presetNames} from './presentation.js';
import {PAGE_PRESETS} from '../shared/presentation.js';
import {applySiteRule,siteHost,siteRuleState,type SiteRule} from '../shared/site-rules.js';

export async function sendPageAction(type: PageActionType,chromeApi: typeof chrome=globalThis.chrome,targetTab?: chrome.tabs.Tab): Promise<PageActionResult> {
  const tab=targetTab || (await chromeApi.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id || !/^https?:/.test(tab.url || ''))throw Error('请在普通网页中使用；浏览器内部页面不支持翻译。');
  if(type==='KUAI_YOUTUBE_OPEN_LIST'&&!videoIdFromUrl(tab.url!))throw Error('字幕列表仅适用于 YouTube 视频页面。');
  const result: PageActionResponse=await chromeApi.tabs.sendMessage(tab.id,{type},{frameId:0});
  if(!result?.ok)throw Error(result?.error?.message || '页面尚未就绪，请刷新后重试。');
  return result.value;
}


const SETTINGS_CONTROLS=['source','target','swap-languages','provider','display-bilingual','display-translation','hover-trigger','paragraph-enabled','selection-trigger','selection-enabled','input-shortcut','input-enabled','page-style'];
// Errors show next to the card whose control caused them, not in a status line at the bottom.
const FEATURE_CONTROLS=new Set(['hover-trigger','paragraph-enabled','selection-trigger','selection-enabled','input-shortcut','input-enabled','page-style']);
const errorSlot=(control: string): string=>FEATURE_CONTROLS.has(control)?'features-error':'page-error';
// Common picks only; any other combination is typed on the options page and kept here as the current entry.
const INPUT_SHORTCUTS=['Alt+X','Alt+T','Alt+I','Control+Shift+X'];
const PAGE_STYLES: SelectEntry[]=PAGE_PRESETS.map(id=>[id,presetNames[id] || id]);
/** Maps a browser language code (en, zh-CN, pt-BR…) to a LANGUAGES id, or '' when unknown. */
export function languageId(code: string | undefined): string{
  const value=String(code || '').toLowerCase();
  if(!value || value==='und')return '';
  if(/^zh(?:-(?:cn|sg|hans))?$/.test(value))return 'zh-Hans';
  if(/^zh-(?:tw|hk|mo|hant)$/.test(value))return 'zh-Hant';
  const base=value.split('-')[0];
  return LANGUAGES.find(([id])=>id!=='auto'&&id.toLowerCase()===value)?.[0] || LANGUAGES.find(([id])=>id!=='auto'&&id.toLowerCase()===base)?.[0] || '';
}

export async function startPopup(document: Document = globalThis.document, chromeApi: typeof chrome = globalThis.chrome): Promise<void> {
  const status=byId(document,'status'), fail=(error: unknown): void=>setStatus(status,errorMessage(error),true);
  const editor=createSettingsEditor({load:()=>getSettings(true),save:(settings,baseSettings)=>request('KUAI_SAVE_SETTINGS',{settings,baseSettings}),normalize:normalizeSettings});
  let tab: chrome.tabs.Tab | undefined,available=false,pageReady=false,working=false,pageState: PageActionResult={active:false,total:0},pageError='',settingsTouched=false,staleTab=false,detected='',errorAt='page-error';
  const main=byId<HTMLButtonElement>(document,'translate-page'),siteRule=byId<HTMLSelectElement>(document,'site-rule');
  const hasTranslations=()=>!!pageState.active || Number(pageState.total)>0;
  function renderActions(): void{
    const settings=editor.get();
    const saveError=editor.status().error;
    main.disabled=working || !pageReady || !!saveError;
    byId(document,'translate-page-label').textContent=working?'处理中…':hasTranslations()?'恢复原文':'翻译此网页';
    main.setAttribute('aria-busy',String(working));
    // Keep the settings shown to the user stable until their save and this action finish.
    for(const id of SETTINGS_CONTROLS)byId<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(document,id).disabled=working;
    // A trigger choice next to a switched-off feature has no effect; dim it so the row reads as off.
    if(settings)for(const [id,on] of [['hover-trigger',settings.hoverEnabled],['selection-trigger',settings.selectionEnabled],['input-shortcut',settings.inputOptions.enabled]] as const)
      byId<HTMLSelectElement>(document,id).disabled=working || !on;
    byId<HTMLButtonElement>(document,'swap-languages').disabled=working || settings?.sourceLanguage==='auto';
    siteRule.disabled=working || !available;
    const translated=Number(pageState.translated)||0,errors=Number(pageState.errors)||0,total=Number(pageState.total)||0;
    const blocked=available&&!!settings&&siteRuleState(settings,tab!.url!)==='never';
    // Only say what the badge and button cannot: progress, partial failures and how to stop.
    const progress=pageState.active?`正在翻译 ${translated} / ${pageState.total} 段，再次点击停止`:errors?`已翻译 ${translated} 段，${errors} 段失败；可恢复原文后重试`:pageState.cancelled&&!translated?'翻译已停止':'';
    const pageMessage=pageError || (!available?'请在普通网页使用；浏览器内部页面不支持翻译。':!pageReady?'':[progress,pageState.error?String(pageState.error):''].filter(Boolean).join(' '));
    setStatus(byId(document,'page-scope'),pageMessage,!!pageError || !!errors || !!pageState.error);
    byId(document,'reload-page').hidden=!staleTab;
    const [state,label]=!available?['blocked','不可用']:pageError || errors || pageState.error?['error',errors?'部分失败':'出错']:pageState.active?['working','翻译中']:translated?['done','已翻译']:blocked?['blocked','本站不翻译']:['idle','未翻译'];
    const badge=byId(document,'page-badge');badge.dataset.state=state;badge.textContent=label;badge.hidden=state==='idle';
    byId(document,'page-progress').hidden=!pageState.active || !total;
    byId(document,'page-progress-bar').style.width=total?`${Math.min(100,Math.round(translated/total*100))}%`:'0';
  }
  function renderSiteRule(settings: Settings): void{
    const url=tab?.url || '',host=available?siteHost(url):'';
    byId(document,'site-host').textContent=host || '当前网页';
    const note=byId(document,'site-rule-note'),text=byId(document,'site-rule-text');
    byId(document,'site-rule-field').hidden=!host;
    if(!host){siteRule.value='default';note.hidden=true;return;}
    const state=siteRuleState(settings,url),{neverSites,alwaysSites}=settings.pageOptions;
    siteRule.value=state;
    // Broader patterns from the options page cannot be undone from here; say where they live.
    const own=state==='never'?neverSites.includes(host):alwaysSites.includes(host);
    text.textContent=state==='default' || own?'':state==='always'&&!alwaysSites.length?'已对所有网站开启自动翻译。':'本站由设置中的网站规则控制。';
    note.hidden=!text.textContent;
  }
  async function refreshPage(): Promise<void>{
    if(!available)return;
    pageState=await sendPageAction('KUAI_PAGE_STATUS',chromeApi,tab);pageReady=true;pageError='';staleTab=false;renderActions();
  }
  // Tabs opened before the extension was installed or updated have no content script until reloaded.
  const notReady=(error: unknown): boolean=>/Receiving end|connection|Could not establish/i.test((error as {message?: string} | null)?.message || '');
  const pageFailure=(error: unknown): string=>{
    staleTab=notReady(error);
    pageError=staleTab?'页面尚未就绪，请刷新页面。':errorMessage(error);
    renderActions();return pageError;
  };
  function showError(slot: string,message=''): void{
    for(const id of ['page-error','features-error']){const node=byId(document,id);node.textContent=id===slot?message:'';node.hidden=id!==slot || !message;}
  }
  function renderLanguages(settings: Settings): void{
    const name=detected&&LANGUAGES.find(([id])=>id===detected)?.[1];
    const sources=LANGUAGES.map(([id,label]): SelectEntry=>[id,id==='auto'&&name?`${label}（${name}）`:label]);
    fillSelect(document,byId<HTMLSelectElement>(document,'source'),sources,settings.sourceLanguage);
  }
  function settingsFailure(error: unknown): void{
    const recovery=(error as {code?: string} | null)?.code==='SETTINGS_CONFLICT'?'其他窗口修改了同一配置。请重新打开此弹窗后再选择，或在“设置与 API”中修改。':errorMessage(error)+' 重新选择可重试，或重新打开此弹窗。';
    showError(errorAt,'当前修改尚未保存。'+recovery);
  }
  const openOptions=(section: string)=>chromeApi.tabs.create({url:chromeApi.runtime.getURL('options.html#'+section)});
  editor.subscribe((settings,state)=>{
    fillProviders(document,byId<HTMLSelectElement>(document,'provider'),settings,settings.activeProviderId);
    renderLanguages(settings);
    fillSelect(document,byId<HTMLSelectElement>(document,'target'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);
    const provider=settings.providers.find(item=>item.id===settings.activeProviderId);
    byId(document,'provider-warning').hidden=!provider || !needsKey(provider.type) || !!provider.apiKey;
    const bilingual=settings.pageDisplayMode!=='translation_only';
    byId<HTMLInputElement>(document,'display-bilingual').checked=bilingual;
    byId<HTMLInputElement>(document,'display-translation').checked=!bilingual;
    const hover=settings.hoverOptions,input=settings.inputOptions;
    // A custom hover trigger is only offered once its keys exist; they are edited on the options page.
    const customKeys=hover.customKeys.length?hover.customKeys.join('+'):'';
    const hoverEntries=hoverTriggers().flatMap(([id,label]): SelectEntry[]=>id!=='custom'?[[id,label]]:customKeys?[[id,keyLabel(customKeys)]]:hover.trigger==='custom'?[[id,label]]:[]);
    fillSelect(document,byId<HTMLSelectElement>(document,'hover-trigger'),hoverEntries,hover.trigger);
    fillSelect(document,byId<HTMLSelectElement>(document,'selection-trigger'),selectionTriggers(),settings.selectionOptions.triggerMode);
    const taken=[input.restoreShortcut,settings.pageOptions.shortcut,settings.pageOptions.displayModeShortcut];
    const shortcuts=[...new Set([input.shortcut,...INPUT_SHORTCUTS.filter(item=>!taken.includes(item))])];
    fillSelect(document,byId<HTMLSelectElement>(document,'input-shortcut'),shortcuts.map(item=>[item,item?keyLabel(item):'无快捷键']),input.shortcut);
    fillSelect(document,byId<HTMLSelectElement>(document,'page-style'),PAGE_STYLES,settings.pageStyle.preset);
    byId<HTMLInputElement>(document,'paragraph-enabled').checked=settings.hoverEnabled;
    byId<HTMLInputElement>(document,'selection-enabled').checked=settings.selectionEnabled;
    byId<HTMLInputElement>(document,'input-enabled').checked=input.enabled;
    byId(document,'paragraph-shortcut').hidden=!settings.hoverEnabled || hover.trigger!=='custom' || !!customKeys;
    renderSiteRule(settings);
    renderActions();
    // Changes save automatically; only a failed save is reported, next to the control that caused it.
    if(settingsTouched){if(state.error)settingsFailure(state.error);else showError(errorAt);}
  });
  try { await editor.load(); setStatus(status,''); } catch(error) { fail(error);return; }
  async function changeSetting(change: SettingsChange,refresh=false,control=''): Promise<void>{
    if(working)return;settingsTouched=true;errorAt=errorSlot(control);
    try{await editor.update(change);}catch(error){settingsFailure(error);return;}
    if(refresh)try{await refreshPage();}catch(error){pageFailure(error);}
  }
  const onChange=(id: string,change: (settings: Settings,control: HTMLInputElement & HTMLSelectElement)=>void,refresh=false)=>
    byId(document,id).addEventListener('change',event=>changeSetting(settings=>change(settings,event.target as HTMLInputElement & HTMLSelectElement),refresh,id));
  onChange('provider',(settings,control)=>{settings.activeProviderId=control.value;},true);
  onChange('source',(settings,control)=>{settings.sourceLanguage=control.value;},true);
  onChange('target',(settings,control)=>{settings.targetLanguage=control.value;},true);
  onChange('display-bilingual',settings=>{settings.pageDisplayMode='bilingual';});
  onChange('display-translation',settings=>{settings.pageDisplayMode='translation_only';});
  onChange('hover-trigger',(settings,control)=>{settings.hoverOptions.trigger=control.value as Settings['hoverOptions']['trigger'];});
  onChange('selection-trigger',(settings,control)=>{settings.selectionOptions.triggerMode=control.value as Settings['selectionOptions']['triggerMode'];});
  onChange('input-shortcut',(settings,control)=>{settings.inputOptions.shortcut=control.value;});
  onChange('page-style',(settings,control)=>{settings.pageStyle.preset=control.value;});
  onChange('paragraph-enabled',(settings,control)=>{settings.hoverEnabled=control.checked;});
  onChange('selection-enabled',(settings,control)=>{settings.selectionEnabled=control.checked;});
  onChange('input-enabled',(settings,control)=>{settings.inputOptions.enabled=control.checked;});
  byId(document,'swap-languages').addEventListener('click',()=>changeSetting(settings=>{
    if(settings.sourceLanguage==='auto')return;
    [settings.sourceLanguage,settings.targetLanguage]=[settings.targetLanguage,settings.sourceLanguage];
  },true));
  siteRule.addEventListener('change',()=>{
    const url=tab?.url || '',rule=siteRule.value as SiteRule;
    // Validate on a copy so a full rule list reports its limit instead of a failed save.
    try{applySiteRule(structuredClone(editor.get()),url,rule);}catch(error){showError('page-error',errorMessage(error));renderSiteRule(editor.get());return;}
    return changeSetting(settings=>applySiteRule(settings,url,rule),true,'site-rule');
  });
  async function page(type: 'KUAI_PAGE_TRANSLATE'|'KUAI_PAGE_RESTORE'|'toggle'): Promise<void> {
    if(working || !available || editor.status().error || type==='toggle'&&!pageReady)return;
    working=true;errorAt='page-error';renderActions();
    try {
      await editor.flush();
      if(type==='toggle'){await refreshPage();type=hasTranslations()?'KUAI_PAGE_RESTORE':'KUAI_PAGE_TRANSLATE';}
      const result=await sendPageAction(type,chromeApi,tab);
      pageState=result;pageError='';staleTab=false;
    } catch(error) { if(editor.status().error)settingsFailure(error);else pageFailure(error); }
    finally {working=false;renderActions();}
  }
  main.addEventListener('click',()=>page('toggle'));
  byId(document,'page-settings').addEventListener('click',()=>openOptions('webpage'));
  byId(document,'hover-settings').addEventListener('click',()=>openOptions('hover'));
  byId(document,'provider-settings').addEventListener('click',()=>openOptions('providers'));
  byId(document,'options').addEventListener('click',()=>chromeApi.runtime.openOptionsPage());
  byId(document,'text-tool').addEventListener('click',()=>chromeApi.tabs.create({url:chromeApi.runtime.getURL('text.html')}));
  byId(document,'reload-page').addEventListener('click',async()=>{
    if(!tab?.id)return;
    try{await chromeApi.tabs.reload(tab.id);document.defaultView?.close?.();}catch(error){showError('page-error',errorMessage(error));}
  });
  try {
    [tab]=await chromeApi.tabs.query({active:true,currentWindow:true});available=!!tab?.id&&/^https?:/.test(tab.url || '');
    renderSiteRule(editor.get());
    // Best effort: the hint next to "自动检测" never blocks or fails the popup.
    if(available&&typeof chromeApi.tabs.detectLanguage==='function')Promise.resolve(chromeApi.tabs.detectLanguage(tab!.id!))
      .then(code=>{detected=languageId(code);renderLanguages(editor.get());},()=>{});
    await refreshPage();
  } catch(error) {pageReady=false;pageFailure(error);}
  renderActions();
  // Enter translates right away; focus stays put if the page cannot be translated.
  if(!main.disabled)main.focus();
}
if (globalThis.document) startPopup();
