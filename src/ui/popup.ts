import type {PageActionType,MessageResponse} from '../shared/messages.js';
import type {SettingsChange} from './state.js';

export interface PageActionResult {
  active?: boolean; total?: number; translated?: number; errors?: number; cancelled?: boolean; error?: string;
  opened?: boolean; message?: string;
}
type PageActionResponse = MessageResponse<PageActionResult>;

import {getSettings, request} from '../shared/client.js';
import {normalizeSettings} from '../shared/settings.js';
import {createSettingsEditor} from './state.js';
import {videoIdFromUrl} from '../youtube/captions.js';
import {byId,fillProviders,fillSelect,LANGUAGES,setStatus,errorMessage} from './common.js';

export async function sendPageAction(type: PageActionType,chromeApi: typeof chrome=globalThis.chrome,targetTab?: chrome.tabs.Tab): Promise<PageActionResult> {
  const tab=targetTab || (await chromeApi.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id || !/^https?:/.test(tab.url || ''))throw Error('请在普通网页中使用；浏览器内部页面不支持翻译。');
  if(type==='KUAI_YOUTUBE_OPEN_LIST'&&!videoIdFromUrl(tab.url!))throw Error('字幕列表仅适用于 YouTube 视频页面。');
  const result: PageActionResponse=await chromeApi.tabs.sendMessage(tab.id,{type},{frameId:0});
  if(!result?.ok)throw Error(result?.error?.message || '页面尚未就绪，请刷新后重试。');
  return result.value;
}

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
    main.textContent=working?'处理中…':hasTranslations()?'恢复原文':'翻译此网页';
    main.setAttribute('aria-busy',String(working));
    // Keep the settings shown to the user stable until their save and this action finish.
    for(const id of ['provider','target','paragraph-enabled'])byId<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(document,id).disabled=working;
    const shortcut=settings?.pageOptions?.shortcut;
    const translated=Number(pageState.translated)||0,errors=Number(pageState.errors)||0;
    const progress=pageState.active?`正在翻译：${translated} / ${pageState.total} 段。再次点击可停止并恢复原文。`:errors?`已翻译 ${translated} 段，${errors} 段失败。可在网页重试，或恢复原文后重新翻译。`:translated?`已翻译 ${translated} 段。`:pageState.cancelled?'翻译已停止，可恢复原文或在网页继续翻译。':shortcut?`整页翻译 / 恢复原文：${shortcut}`:'点击上方按钮翻译整页。';
    const pageMessage=pageError || (!available?'请在普通网页使用；浏览器内部页面不支持翻译。':!pageReady?'正在读取页面状态…':progress+(pageState.error?' '+String(pageState.error):''));
    setStatus(byId(document,'page-scope'),pageMessage,!!pageError || !!errors || !!pageState.error);
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
  editor.subscribe((settings,state)=>{
    fillProviders(document,byId<HTMLSelectElement>(document,'provider'),settings,settings.activeProviderId);
    fillSelect(document,byId<HTMLSelectElement>(document,'target'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);
    byId<HTMLInputElement>(document,'paragraph-enabled').checked=settings.hoverEnabled;
    const hover=settings.hoverOptions,keys=({alt:'Alt',ctrl:'Control',shift:'Shift'} as Record<string,string>)[hover.trigger] || hover.customKeys.join(' + ');
    byId(document,'paragraph-shortcut').textContent=hover.trigger==='hover'?'指向段落后自动翻译，结果与整页译文一起管理。':hover.trigger==='left_hold'?'按住段落空白处的鼠标左键触发翻译；拖动选字不会触发。':keys?`指向段落后，按一次 ${keys} 翻译，再按一次关闭译文。`:'请在网页设置中填写段落翻译快捷键。';
    renderActions();
    if(settingsTouched){if(state.error)settingsFailure(state.error);else setStatus(status,state.saving?'正在保存设置…':'设置已保存。');}
  });
  try { await editor.load(); setStatus(status,''); } catch(error) { fail(error);return; }
  async function changeSetting(change: SettingsChange,refresh=false): Promise<void>{
    if(working)return;settingsTouched=true;
    try{await editor.update(change);}catch(error){settingsFailure(error);return;}
    if(refresh)try{await refreshPage();}catch(error){pageFailure(error);}
  }
  byId<HTMLSelectElement>(document,'provider').addEventListener('change',event=>changeSetting(settings=>{settings.activeProviderId=(event.target as HTMLSelectElement).value;},true));
  byId<HTMLSelectElement>(document,'target').addEventListener('change',event=>changeSetting(settings=>{settings.targetLanguage=(event.target as HTMLSelectElement).value;},true));
  byId<HTMLInputElement>(document,'paragraph-enabled').addEventListener('change',event=>changeSetting(settings=>{settings.hoverEnabled=(event.target as HTMLInputElement).checked;}));
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
  byId(document,'page-settings').addEventListener('click',()=>chromeApi.tabs.create({url:chromeApi.runtime.getURL('options.html#webpage')}));
  byId(document,'options').addEventListener('click',()=>chromeApi.runtime.openOptionsPage());
  byId(document,'text-tool').addEventListener('click',()=>chromeApi.tabs.create({url:chromeApi.runtime.getURL('text.html')}));
  try {
    [tab]=await chromeApi.tabs.query({active:true,currentWindow:true});available=!!tab?.id&&/^https?:/.test(tab.url || '');
    await refreshPage();
  } catch(error) {pageReady=false;pageError=pageFailure(error);}
  renderActions();
}
if (globalThis.document) startPopup();
