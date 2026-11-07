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
import {byId,fillProviders,fillSelect,LANGUAGES,setStatus,errorMessage,needsKey} from './common.js';
import {applySiteRule,siteHost,siteRuleState,type SiteRule} from '../shared/site-rules.js';

export async function sendPageAction(type: PageActionType,chromeApi: typeof chrome=globalThis.chrome,targetTab?: chrome.tabs.Tab): Promise<PageActionResult> {
  const tab=targetTab || (await chromeApi.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id || !/^https?:/.test(tab.url || ''))throw Error('请在普通网页中使用；浏览器内部页面不支持翻译。');
  if(type==='KUAI_YOUTUBE_OPEN_LIST'&&!videoIdFromUrl(tab.url!))throw Error('字幕列表仅适用于 YouTube 视频页面。');
  const result: PageActionResponse=await chromeApi.tabs.sendMessage(tab.id,{type},{frameId:0});
  if(!result?.ok)throw Error(result?.error?.message || '页面尚未就绪，请刷新后重试。');
  return result.value;
}


const SETTINGS_CONTROLS=['source','target','swap-languages','provider','display-bilingual','paragraph-enabled','selection-enabled','input-enabled'];
const SITE_RULES: SiteRule[]=['default','always','never'];

export async function startPopup(document: Document = globalThis.document, chromeApi: typeof chrome = globalThis.chrome): Promise<void> {
  const status=byId(document,'status'), fail=(error: unknown): void=>setStatus(status,errorMessage(error),true);
  const editor=createSettingsEditor({load:()=>getSettings(true),save:(settings,baseSettings)=>request('KUAI_SAVE_SETTINGS',{settings,baseSettings}),normalize:normalizeSettings});
  let tab: chrome.tabs.Tab | undefined,available=false,pageReady=false,working=false,pageState: PageActionResult={active:false,total:0},pageError='',settingsTouched=false;
  const main=byId<HTMLButtonElement>(document,'translate-page');
  const hasTranslations=()=>!!pageState.active || Number(pageState.total)>0;
  function renderActions(): void{
    const settings=editor.get();
    const saveError=editor.status().error;
    main.disabled=working || !pageReady || !!saveError;
    byId(document,'translate-page-label').textContent=working?'处理中…':hasTranslations()?'恢复原文':'翻译此网页';
    main.setAttribute('aria-busy',String(working));
    // Keep the settings shown to the user stable until their save and this action finish.
    for(const id of SETTINGS_CONTROLS)byId<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(document,id).disabled=working;
    byId<HTMLButtonElement>(document,'swap-languages').disabled=working || settings?.sourceLanguage==='auto';
    for(const rule of SITE_RULES)byId<HTMLInputElement>(document,'site-'+rule).disabled=working || !available;
    const shortcut=settings?.pageOptions?.shortcut;
    const translated=Number(pageState.translated)||0,errors=Number(pageState.errors)||0,total=Number(pageState.total)||0;
    const blocked=available&&!!settings&&siteRuleState(settings,tab!.url!)==='never';
    const progress=pageState.active?`正在翻译：${translated} / ${pageState.total} 段。再次点击可停止并恢复原文。`:errors?`已翻译 ${translated} 段，${errors} 段失败。可在网页重试，或恢复原文后重新翻译。`:translated?`已翻译 ${translated} 段。`:pageState.cancelled?'翻译已停止，可恢复原文或在网页继续翻译。':blocked?'本站已设为从不翻译，可在下方“本站”中修改。':shortcut?`整页翻译 / 恢复原文：${shortcut}`:'点击上方按钮翻译整页。';
    const pageMessage=pageError || (!available?'请在普通网页使用；浏览器内部页面不支持翻译。':!pageReady?'正在读取页面状态…':progress+(pageState.error?' '+String(pageState.error):''));
    setStatus(byId(document,'page-scope'),pageMessage,!!pageError || !!errors || !!pageState.error);
    const [state,label]=!available?['blocked','不可用']:pageError || errors || pageState.error?['error',errors?'部分失败':'出错']:pageState.active?['working','翻译中']:translated?['done','已翻译']:blocked?['blocked','本站不翻译']:['idle','未翻译'];
    const badge=byId(document,'page-badge');badge.dataset.state=state;badge.textContent=label;
    byId(document,'page-progress').hidden=!pageState.active || !total;
    byId(document,'page-progress-bar').style.width=total?`${Math.min(100,Math.round(translated/total*100))}%`:'0';
  }
  function renderSiteRule(settings: Settings): void{
    const url=tab?.url || '',host=available?siteHost(url):'';
    byId(document,'site-host').textContent=host || '当前网页';
    const note=byId(document,'site-rule-note');
    if(!host){for(const rule of SITE_RULES)byId<HTMLInputElement>(document,'site-'+rule).checked=false;note.hidden=true;return;}
    const state=siteRuleState(settings,url),{neverSites,alwaysSites}=settings.pageOptions;
    for(const rule of SITE_RULES)byId<HTMLInputElement>(document,'site-'+rule).checked=rule===state;
    // Broader patterns from the options page cannot be undone from here; say where they live.
    const own=state==='never'?neverSites.includes(host):alwaysSites.includes(host);
    note.textContent=state==='default' || own?'':state==='always'&&!alwaysSites.length?'已对所有网站开启自动翻译，可在网页设置中限定网站。':'本站由网页设置中的网站规则控制，请在设置中调整。';
    note.hidden=!note.textContent;
  }
  async function refreshPage(): Promise<void>{
    if(!available)return;
    pageState=await sendPageAction('KUAI_PAGE_STATUS',chromeApi,tab);pageReady=true;pageError='';renderActions();
  }
  const pageFailure=(error: unknown): string=>{
    const message=/Receiving end|connection|Could not establish/i.test((error as {message?: string} | null)?.message || '')?'页面尚未就绪，请刷新网页后重试。':errorMessage(error);
    fail(Error(message));return message;
  };
  function settingsFailure(error: unknown): void{
    const recovery=(error as {code?: string} | null)?.code==='SETTINGS_CONFLICT'?'其他窗口修改了同一配置。请重新打开此弹窗后再选择，或在“设置与 API”中修改。':errorMessage(error)+' 重新选择可重试，或重新打开此弹窗。';
    setStatus(status,'当前修改尚未保存。'+recovery,true);
  }
  const openOptions=(section: string)=>chromeApi.tabs.create({url:chromeApi.runtime.getURL('options.html#'+section)});
  editor.subscribe((settings,state)=>{
    fillProviders(document,byId<HTMLSelectElement>(document,'provider'),settings,settings.activeProviderId);
    fillSelect(document,byId<HTMLSelectElement>(document,'source'),LANGUAGES,settings.sourceLanguage);
    fillSelect(document,byId<HTMLSelectElement>(document,'target'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);
    const provider=settings.providers.find(item=>item.id===settings.activeProviderId);
    byId(document,'provider-warning').hidden=!provider || !needsKey(provider.type) || !!provider.apiKey;
    byId<HTMLInputElement>(document,'display-bilingual').checked=settings.pageDisplayMode!=='translation_only';
    byId<HTMLInputElement>(document,'paragraph-enabled').checked=settings.hoverEnabled;
    byId<HTMLInputElement>(document,'selection-enabled').checked=settings.selectionEnabled;
    byId<HTMLInputElement>(document,'input-enabled').checked=settings.inputOptions.enabled;
    const hover=settings.hoverOptions,keys=({alt:'Alt',ctrl:'Control',shift:'Shift'} as Record<string,string>)[hover.trigger] || hover.customKeys.join(' + ');
    byId(document,'paragraph-shortcut').textContent=!settings.hoverEnabled?'悬浮翻译已关闭；整页翻译不受影响。':hover.trigger==='hover'?'指向段落后自动翻译，结果与整页译文一起管理。':hover.trigger==='left_hold'?'按住段落空白处的鼠标左键触发翻译；拖动选字不会触发。':keys?`指向段落后，按一次 ${keys} 翻译，再按一次关闭译文。`:'请在网页设置中填写段落翻译快捷键。';
    renderSiteRule(settings);
    renderActions();
    if(settingsTouched){if(state.error)settingsFailure(state.error);else setStatus(status,state.saving?'正在保存设置…':'设置已保存。');}
  });
  try { await editor.load(); setStatus(status,''); } catch(error) { fail(error);return; }
  async function changeSetting(change: SettingsChange,refresh=false): Promise<void>{
    if(working)return;settingsTouched=true;
    try{await editor.update(change);}catch(error){settingsFailure(error);return;}
    if(refresh)try{await refreshPage();}catch(error){pageFailure(error);}
  }
  const onChange=(id: string,change: (settings: Settings,control: HTMLInputElement & HTMLSelectElement)=>void,refresh=false)=>
    byId(document,id).addEventListener('change',event=>changeSetting(settings=>change(settings,event.target as HTMLInputElement & HTMLSelectElement),refresh));
  onChange('provider',(settings,control)=>{settings.activeProviderId=control.value;},true);
  onChange('source',(settings,control)=>{settings.sourceLanguage=control.value;},true);
  onChange('target',(settings,control)=>{settings.targetLanguage=control.value;},true);
  onChange('display-bilingual',(settings,control)=>{settings.pageDisplayMode=control.checked?'bilingual':'translation_only';});
  onChange('paragraph-enabled',(settings,control)=>{settings.hoverEnabled=control.checked;});
  onChange('selection-enabled',(settings,control)=>{settings.selectionEnabled=control.checked;});
  onChange('input-enabled',(settings,control)=>{settings.inputOptions.enabled=control.checked;});
  byId(document,'swap-languages').addEventListener('click',()=>changeSetting(settings=>{
    if(settings.sourceLanguage==='auto')return;
    [settings.sourceLanguage,settings.targetLanguage]=[settings.targetLanguage,settings.sourceLanguage];
  },true));
  for(const rule of SITE_RULES)byId(document,'site-'+rule).addEventListener('change',()=>{
    const url=tab?.url || '';
    // Validate on a copy so a full rule list reports its limit instead of a failed save.
    try{applySiteRule(structuredClone(editor.get()),url,rule);}catch(error){fail(error);renderSiteRule(editor.get());return;}
    return changeSetting(settings=>applySiteRule(settings,url,rule),true);
  });
  async function page(type: 'KUAI_PAGE_TRANSLATE'|'KUAI_PAGE_RESTORE'|'toggle'): Promise<void> {
    if(working || !available || editor.status().error || type==='toggle'&&!pageReady)return;
    working=true;renderActions();
    try {
      await editor.flush();
      if(type==='toggle'){await refreshPage();type=hasTranslations()?'KUAI_PAGE_RESTORE':'KUAI_PAGE_TRANSLATE';}
      const result=await sendPageAction(type,chromeApi,tab);
      pageState=result;
      setStatus(status,type==='KUAI_PAGE_RESTORE' ? '已恢复原文。' : '翻译已开始，可在网页右下角查看进度。');
    } catch(error) { if(editor.status().error)settingsFailure(error);else pageFailure(error); }
    finally {working=false;renderActions();}
  }
  main.addEventListener('click',()=>page('toggle'));
  byId(document,'page-settings').addEventListener('click',()=>openOptions('webpage'));
  byId(document,'provider-settings').addEventListener('click',()=>openOptions('providers'));
  byId(document,'options').addEventListener('click',()=>chromeApi.runtime.openOptionsPage());
  // Browser-level shortcuts work even when the page has focus elsewhere, e.g. the address bar.
  byId(document,'shortcuts').addEventListener('click',()=>chromeApi.tabs.create({url:'chrome://extensions/shortcuts'}));
  byId(document,'text-tool').addEventListener('click',()=>chromeApi.tabs.create({url:chromeApi.runtime.getURL('text.html')}));
  try {
    [tab]=await chromeApi.tabs.query({active:true,currentWindow:true});available=!!tab?.id&&/^https?:/.test(tab.url || '');
    renderSiteRule(editor.get());
    await refreshPage();
  } catch(error) {pageReady=false;pageError=pageFailure(error);}
  renderActions();
}
if (globalThis.document) startPopup();
