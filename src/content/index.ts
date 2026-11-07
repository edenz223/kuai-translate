import type {Settings} from '../shared/settings.js';
import type {MessageResponse,PageBadgeState,PageRequest,PageStatus,PreferencePatch,PublicFailure} from '../shared/messages.js';
import type {YouTubeControllerOptions} from '../youtube/index.js';
import type {BrowserEnvironment,CodedError} from './dom.js';

type SaveMethod = 'updatePreferences'|'updatePagePreferences';
type SavePatch<M extends SaveMethod> = Parameters<typeof defaultClient[M]>[0];
type ContentClient = Pick<typeof defaultClient,'getSettings'|'translate'|'cancel'|'onSettingsChanged'> & Partial<Pick<typeof defaultClient,'makeRequestId'|'openOptions'|'reportPageState'|SaveMethod>>;
interface YouTubeInstance {stop?:()=>void;openSidebar?:()=>unknown}
type YouTubeStartOptions = YouTubeControllerOptions & {cancel:typeof defaultClient.cancel};
export interface ContentRuntimeOptions {env?:BrowserEnvironment;client?:ContentClient;startYouTube?:(options:YouTubeStartOptions)=>YouTubeInstance|Promise<YouTubeInstance>}
export interface ContentRuntime {start:()=>Promise<ContentRuntime>;stop:()=>void;status:()=>PageStatus}
interface SettingsRead {promise:Promise<void>;resolve:()=>void;reject:(reason:unknown)=>void}
type RuntimeEventMap = DocumentEventMap & WindowEventMap & {'yt-navigate-start':Event};

import * as defaultClient from '../shared/client.js';
import { createPageTranslator } from './page-translator.js';
import { createInteractions } from './interactions.js';
import {pageTranslationKey,isPageSiteBlocked} from './page-policy.js';
import {createPageTriggers} from './page-triggers.js';
import {interactionConfigurationKey} from '../shared/interactions.js';

const PAGE_MESSAGES = new Set(['KUAI_PAGE_TRANSLATE','KUAI_PAGE_RESTORE','KUAI_SELECTION_TRANSLATE','KUAI_INPUT_TRANSLATE','KUAI_PAGE_STATUS','KUAI_YOUTUBE_OPEN_LIST','KUAI_PAGE_TOGGLE','KUAI_PAGE_DISPLAY_MODE']);
const emptyStatus = () => ({active:false,translated:0,errors:0,total:0,cancelled:false,isTranslated:false});

/** Wire native controllers to document-scoped extension messages. */
export function createContentRuntime({env=globalThis,client=defaultClient,startYouTube}: ContentRuntimeOptions={}) {
  const document=env.document,subscribers=new Set<(settings:Settings)=>void>(),disposers: (()=>void)[]=[];
  let settings: Settings, page: ReturnType<typeof createPageTranslator>|undefined, pageTriggers: ReturnType<typeof createPageTriggers>|undefined, interactions: ReturnType<typeof createInteractions>|undefined, youtube: YouTubeInstance|undefined, youtubeStarting: Promise<YouTubeInstance|undefined>|null|undefined, startPromise: Promise<ContentRuntime>|null|undefined, stopped=false, observer: MutationObserver|undefined, unsubscribeSettings: (()=>void)|undefined, readyResolver: (()=>void)|null|undefined;
  let phase='idle',subtitleError: PublicFailure|null=null,settingsRead: SettingsRead|undefined,settingsError='',actionEpoch=0;
  let lastUrl=env.location?.href||'', lastError='';
  // The background clears the badge on each committed navigation, so a fresh document starts idle.
  let reportedBadge: PageBadgeState='idle';
  const topFrame=(()=>{try{return !env.top||env.top===(env as unknown);}catch{return false;}})();
  const launchYouTube=startYouTube || (async (options: YouTubeStartOptions) => (await import('../youtube/index.js')).startYouTube(options));
  const subscribeSettings=(callback: (settings:Settings)=>void): (()=>void)=>{subscribers.add(callback);return()=>subscribers.delete(callback);};
  const actionError=()=>Object.assign(new Error(stopped?'页面翻译已停止，请刷新页面。':'页面操作已取消，请重试。'),{code:stopped?'CONTENT_STOPPED':'CANCELLED'});
  function cancelSettingsRead(){actionEpoch++;const read=settingsRead;settingsRead=undefined;read?.reject(actionError());}
  function refreshSettings(): Promise<void>{
    if(stopped)return Promise.reject(actionError());
    const previous=settingsRead,read={} as SettingsRead;
    read.promise=new Promise<void>((resolve,reject)=>{read.resolve=resolve;read.reject=reject;});settingsRead=read;
    // Release older waiters to follow this read, even if their old transport never settles.
    previous?.resolve();
    Promise.resolve().then(()=>client.getSettings(false)).then(next=>{
      if(stopped||settingsRead!==read)return;
      if(!next||typeof next!=='object'||Array.isArray(next))throw Error('Invalid settings response');
      settingsError='';updateSettings(next);read.resolve();
    }).catch(()=>{
      if(stopped||settingsRead!==read)return;
      settingsError='无法读取最新翻译设置，请重试或刷新页面。';
      read.reject(Object.assign(new Error(settingsError),{code:'SETTINGS_UNAVAILABLE'}));
    });
    return read.promise;
  }
  async function withSettings<T>(action: ()=>T | Promise<T>,version=actionEpoch): Promise<T>{
    if(stopped||version!==actionEpoch)throw actionError();
    refreshSettings();
    let read: SettingsRead | undefined;
    do{
      read=settingsRead;await read!.promise;
      if(stopped||version!==actionEpoch)throw actionError();
    }while(read!==settingsRead);
    return action();
  }
  async function savePreferences<M extends SaveMethod>(method: M,patch: SavePatch<M>): Promise<Settings>{
    const version=actionEpoch;await (client[method] as (patch:SavePatch<M>)=>unknown)(patch);
    return withSettings(()=>settings,version);
  }
  function listen<K extends keyof RuntimeEventMap>(target: EventTarget,type: K,handler: (event:RuntimeEventMap[K])=>void): void{target.addEventListener(type,handler as EventListener);disposers.push(()=>target.removeEventListener(type,handler as EventListener));}
  function routeChanged(event: Event | MutationRecord[]): void{
    const next=env.location?.href||'';
    if(next===lastUrl&&(event as Event)?.type!=='yt-navigate-start')return;
    cancelSettingsRead();lastUrl=next;page?.restore();interactions?.updateSettings();pageTriggers?.routeChanged();
  }
  function updateSettings(next: Settings): void{
    if(stopped||!next||typeof next!=='object'||JSON.stringify(settings)===JSON.stringify(next))return;
    const previous=settings,identityChanged=pageTranslationKey(previous)!==pageTranslationKey(next);
    settings=next;
    if(identityChanged)page?.restore();else page?.refreshPresentation();
    if(interactionConfigurationKey(previous)!==interactionConfigurationKey(next))interactions?.updateSettings();
    interactions?.refreshPresentation?.();
    pageTriggers?.updateSettings();
    lastError='';
    for(const callback of [...subscribers]){try{callback(next);}catch{subtitleError={code:'YOUTUBE_UPDATE_FAILED',message:'字幕界面更新失败，请重新打开字幕列表或刷新页面。'};}}
    reportBadge();
  }
  function reportBadge(): void{
    if(stopped||!topFrame||!client.reportPageState||!settings)return;
    const value=status();
    const state: PageBadgeState=value.active?'working':value.errors||value.error?'error':value.translated?'done':isPageSiteBlocked(settings,env.location?.href||'')?'blocked':'idle';
    if(state===reportedBadge)return;
    reportedBadge=state;client.reportPageState(state).catch(()=>{if(reportedBadge===state)reportedBadge='idle';});
  }
  function status(): PageStatus{return {...(page?.status()||emptyStatus()),phase,...(settingsError||lastError?{error:settingsError||lastError}:{}),...(subtitleError?{subtitleError}:{})};}
  function ensureYouTube(): Promise<YouTubeInstance|undefined>{
    if(youtube)return Promise.resolve(youtube);
    if(youtubeStarting)return youtubeStarting;
    const attemptSubscriptions: (()=>void)[]=[];
    const subscribe=(callback: (settings:Settings)=>void): (()=>void)=>{const off=subscribeSettings(callback);attemptSubscriptions.push(off);return off;};
    // Start in a microtask so even a synchronous constructor failure clears the
    // promise after it has been assigned, allowing a later explicit retry.
    youtubeStarting=Promise.resolve().then(()=>launchYouTube({
      settings,subscribeSettings:subscribe,translate:client.translate,cancel:client.cancel,
      updatePreferences:client.updatePreferences&& ((patch:PreferencePatch)=>savePreferences('updatePreferences',patch)),openOptions:client.openOptions,
    })).then(instance=>{
      if(stopped){instance?.stop?.();return;}
      youtube=instance;subtitleError=null;return instance;
    }).catch(()=>{
      attemptSubscriptions.forEach(off=>off());
      const error=new Error('字幕入口暂时无法初始化，请重试打开字幕列表或刷新页面。') as CodedError & {code:string};error.code='YOUTUBE_INIT_FAILED';
      subtitleError={code:error.code,message:error.message};throw error;
    }).finally(()=>{youtubeStarting=null;});
    return youtubeStarting;
  }
  async function dispatch(message: PageRequest): Promise<unknown>{
    if(stopped)throw actionError();
    if(message.type==='KUAI_PAGE_RESTORE'){lastError='';return pageTriggers!.restore();}
    const version=actionEpoch,controller=message.type==='KUAI_YOUTUBE_OPEN_LIST'?await ensureYouTube():undefined;
    return withSettings(async()=>{
    switch(message.type){
      case 'KUAI_PAGE_STATUS':return status();
      case 'KUAI_PAGE_TRANSLATE':
        if(isPageSiteBlocked(settings,env.location?.href||'')){const error=new Error('当前网址已设为不翻译，可在网页翻译设置中修改。') as CodedError;error.code='SITE_DISABLED';throw error;}
        lastError='';void pageTriggers!.translate().catch(error=>{lastError=String(error?.message||'Page translation failed');page!.cancelCurrent();});return status();
      case 'KUAI_PAGE_TOGGLE':lastError='';void pageTriggers!.toggle().catch(error=>{lastError=String(error?.message||'Page translation failed');reportBadge();});return status();
      case 'KUAI_PAGE_DISPLAY_MODE':void pageTriggers!.mode().catch(error=>{lastError=String(error?.message||'Display mode change failed');reportBadge();});return status();
      case 'KUAI_SELECTION_TRANSLATE':return interactions!.translateSelection({text:message.text});
      case 'KUAI_INPUT_TRANSLATE':return interactions!.translateInput();
      case 'KUAI_YOUTUBE_OPEN_LIST': {
        const result=await controller?.openSidebar?.();
        return result&&typeof result==='object'?result:{opened:!!result,message:result?'':'请在包含播放器的 YouTube 视频页面打开字幕列表。'};
      }
    }
    },version);
  }
  function messageListener(message: unknown,sender: chrome.runtime.MessageSender,respond: (response:MessageResponse<unknown>)=>void): boolean{
    if(!PAGE_MESSAGES.has((message as PageRequest | null | undefined)?.type as string)||sender?.id!==env.chrome?.runtime?.id)return false;
    Promise.resolve(startPromise).then(()=>dispatch(message as PageRequest)).then(value=>respond({ok:true,value}),(error:unknown)=>respond({ok:false,error:{code:(error as CodedError | null)?.code||'CONTENT_ERROR',message:String((error as CodedError | null)?.message||'Page translation failed')}}));
    return true;
  }
  async function ready(){
    if(document.body||['interactive','complete'].includes(document.readyState))return;
    await new Promise<void>(resolve=>{
      const loaded=()=>{document.removeEventListener('DOMContentLoaded',loaded);readyResolver=null;resolve();};
      readyResolver=loaded;document.addEventListener('DOMContentLoaded',loaded);
    });
  }
  function pagehide(event: PageTransitionEvent): void{if(event.persisted){cancelSettingsRead();page?.cancelCurrent();interactions?.updateSettings();}else stop();}
  function start(): Promise<ContentRuntime>{
    if(stopped){const error=new Error('页面功能已停止，请刷新页面。') as CodedError;error.code='CONTENT_STOPPED';return Promise.reject(error);}
    if(startPromise)return startPromise;
    phase='initializing';
    startPromise=(async()=>{
      env.chrome.runtime.onMessage.addListener(messageListener);
      disposers.push(()=>env.chrome.runtime.onMessage.removeListener(messageListener));
      listen(env,'pagehide',pagehide);
      await ready();if(stopped)return api;
      settings=await client.getSettings(false);if(stopped)return api;
      const dependencies={document,env,getSettings:()=>settings,translate:client.translate,cancel:client.cancel,makeRequestId:client.makeRequestId,openOptions:client.openOptions,onUserAction:(action:string)=>pageTriggers?.handleUserAction(action)};
      page=createPageTranslator({...dependencies,onRestore:()=>interactions?.clearParagraphGesture?.(),onChange:reportBadge});
      interactions=createInteractions({...dependencies,page}).start();
      pageTriggers=createPageTriggers({document,env,getSettings:()=>settings,page,onManualStop:cancelSettingsRead,changeDisplayMode:async value=>{
        if(!client.updatePagePreferences)throw Error('请重新加载扩展并刷新网页，再使用显示模式快捷键。');
        await savePreferences('updatePagePreferences',{pageDisplayMode:value});
      }}).start();
      // Payload snapshots can arrive late; only the background's current public record is authoritative.
      unsubscribeSettings=client.onSettingsChanged(()=>{void refreshSettings().catch(()=>{});});
      for(const type of ['popstate','hashchange','pageshow'] as const)listen(env,type,routeChanged);
      listen(document,'yt-navigate-start',routeChanged);
      // URL comparison is constant-time. The observer does not rescan or translate the DOM.
      if(env.MutationObserver){observer=new env.MutationObserver(routeChanged);observer.observe(document.documentElement,{childList:true,subtree:true});}
      // Caption UI is optional: its failure must not disable webpage translation.
      try{await ensureYouTube();}catch{}
      // A back/forward cache restore commits a navigation, which clears the badge; report the kept state again.
      listen(env,'pageshow',event=>{if(event.persisted){reportedBadge='idle';reportBadge();}});
      if(!stopped)phase='ready';reportBadge();
      return api;
    })().catch(()=>{
      cleanup();startPromise=null;
      if(stopped){
        phase='stopped';
        const error=new Error('页面功能已停止，请刷新页面。') as CodedError;error.code='CONTENT_STOPPED';throw error;
      }
      phase='failed';
      const error=new Error('页面功能初始化失败，请重试或刷新页面。') as CodedError;error.code='CONTENT_INIT_FAILED';throw error;
    });
    return startPromise;
  }
  function cleanup(){
    readyResolver?.();
    unsubscribeSettings?.();observer?.disconnect();disposers.splice(0).forEach(dispose=>dispose());
    pageTriggers?.stop();page?.stop();interactions?.stop();youtube?.stop?.();subscribers.clear();
    page=pageTriggers=interactions=youtube=observer=unsubscribeSettings=undefined;
  }
  function stop(){if(stopped)return;stopped=true;cancelSettingsRead();cleanup();phase='stopped';}
  const api: ContentRuntime={start,stop,status};return api;
}

let singleton: ContentRuntime | undefined;
export function start(options?: ContentRuntimeOptions): Promise<ContentRuntime>{
  const instance=singleton ||= createContentRuntime(options);
  return instance.start().catch(error=>{if(singleton===instance)singleton=undefined;throw error;});
}
