import {originalMutationFilter} from './source-text.js';
import type {DisplayMode} from '../shared/messages.js';
import type {Settings} from '../shared/settings.js';
import type {BrowserEnvironment,CodedError} from './dom.js';
import type {createPageTranslator,PageStatus} from './page-translator.js';

export interface PageTriggersOptions {document:Document;env?:BrowserEnvironment;getSettings:()=>Settings;page:ReturnType<typeof createPageTranslator>;changeDisplayMode:(mode:DisplayMode)=>unknown;onManualStop?:()=>void}

import {ancestors,isEditable,isOwnedUI} from './dom.js';
import {normalizeInteractionOptions} from '../shared/interactions.js';
import {isPageSiteBlocked,shouldAutoTranslate,pageTranslationKey} from './page-policy.js';
import {matchesShortcut} from './shortcuts.js';
import {isPageLinkMutation,PAGE_LINK_ATTRIBUTES} from './page-content.js';

/** Own automatic and keyboard intent without taking over manual stop/restore. */
export function createPageTriggers({document,env=globalThis,getSettings,page,changeDisplayMode,onManualStop=()=>{}}: PageTriggersOptions){
  const disposers: (()=>void)[]=[];let started=false,stopped=false,epoch=0,autoTimer: number|null=null,dynamicTimer: number|null=null,viewportTimer: number|null=null,observer: MutationObserver|null=null;
  let autoAttempted=false,manualStopped=false,activeSession=false,dirty=false,inFlight: Promise<PageStatus>|null=null,modePending=false,viewportDirty=false;
  const preferences=()=>normalizeInteractionOptions(getSettings(),getSettings().providers).pageOptions;
  const route=()=>env.location?.href||'';
  const hidden=()=>document.visibilityState==='hidden';
  const autoKey=(settings: Settings)=>{const value=normalizeInteractionOptions(settings,settings.providers).pageOptions;return JSON.stringify([pageTranslationKey(settings),value.autoTranslate,value.alwaysSites,value.alwaysLanguages]);};
  let previousAutoKey=autoKey(getSettings());
  function clearTimers(){if(autoTimer!==null)env.clearTimeout(autoTimer);if(dynamicTimer!==null)env.clearTimeout(dynamicTimer);if(viewportTimer!==null)env.clearTimeout(viewportTimer);autoTimer=dynamicTimer=viewportTimer=null;}
  function report(error: unknown): void{if(!stopped)page.reportError?.(error);}
  function execute({dynamic=false,viewport=false}: {dynamic?:boolean;viewport?:boolean}={}): Promise<PageStatus | {cancelled:true}>{
    if(stopped)return Promise.resolve({cancelled:true});
    if(isPageSiteBlocked(getSettings(),route())){const error=new Error('当前网址已设为不翻译，可在网页翻译设置中修改。') as CodedError;error.code='SITE_DISABLED';return Promise.reject(error);}
    clearTimers();activeSession=true;autoAttempted=true;dirty=false;viewportDirty=false;
    const version=epoch,job=page.translatePage({retryErrors:!dynamic&&!viewport});inFlight=job;
    return Promise.resolve(job).catch(error=>{if(version===epoch)report(error);throw error;}).finally(()=>{
      if(inFlight!==job)return;inFlight=null;if(dirty)scheduleDynamic();if(viewportDirty)scheduleViewport();
    });
  }
  function translate(){manualStopped=false;autoAttempted=true;clearTimers();return execute();}
  function restore(){onManualStop();epoch++;manualStopped=true;autoAttempted=true;activeSession=false;dirty=false;viewportDirty=false;clearTimers();return page.restore();}
  function cancel(){onManualStop();epoch++;manualStopped=true;autoAttempted=true;activeSession=false;dirty=false;viewportDirty=false;clearTimers();return page.cancelCurrent();}
  function toggle(){const state=page.status();return activeSession||state.active||state.total?Promise.resolve(restore()):translate();}
  function handleUserAction(action: string): boolean{
    if(action==='stop'){cancel();return true;}if(action==='restore'){restore();return true;}
    if(action==='translate'){void translate().catch(()=>{});return true;}return false;
  }
  async function automatic(){
    autoTimer=null;if(stopped||hidden()||manualStopped||autoAttempted||activeSession||!preferences().autoTranslate)return;
    autoAttempted=true;const version=epoch,url=route(),identity=autoKey(getSettings());
    const allowed=await shouldAutoTranslate(document,getSettings(),env);
    if(!allowed||stopped||hidden()||version!==epoch||route()!==url||autoKey(getSettings())!==identity||manualStopped||activeSession)return;
    await execute();
  }
  function scheduleAuto(){if(stopped||hidden()||manualStopped||autoAttempted||activeSession||!preferences().autoTranslate||autoTimer!==null)return;autoTimer=env.setTimeout(()=>{void automatic().catch(report);},0);}
  function scheduleDynamic(){
    if(stopped||hidden()||manualStopped||!activeSession||!dirty||!preferences().translateDynamic||inFlight||dynamicTimer!==null)return;
    dynamicTimer=env.setTimeout(()=>{dynamicTimer=null;if(stopped||manualStopped||hidden()||!activeSession||!preferences().translateDynamic)return;void execute({dynamic:true}).catch(report);},250);
  }
  function scheduleViewport(){
    if(stopped||hidden()||manualStopped||!activeSession||!viewportDirty||inFlight||dynamicTimer!==null||viewportTimer!==null)return;
    viewportTimer=env.setTimeout(()=>{
      viewportTimer=null;
      if(stopped||hidden()||manualStopped||!activeSession||inFlight)return;
      void execute({viewport:true}).catch(report);
    },120);
  }
  function viewportChanged(){if(stopped||manualStopped||!activeSession)return;viewportDirty=true;scheduleViewport();}
  const owned=(node: unknown): boolean=>ancestors(node).some(element=>element.hasAttribute?.('data-kuai-owned')||element.hasAttribute?.('data-kuai-ui'));
  function sourceMutation(record: MutationRecord): boolean{
    if(record.type==='attributes')return (record.attributeName==='lang'||isPageLinkMutation(record))&&!owned(record.target);
    if(owned(record.target))return false;
    if(record.type==='characterData')return true;
    return [...(record.addedNodes||[]),...(record.removedNodes||[])].some(node=>!owned(node));
  }
  const originalMutations=originalMutationFilter();
  function changed(records: MutationRecord[]): void{
    const ignored=originalMutations(records);records=records.filter(record=>!ignored.has(record));
    if(stopped||manualStopped||!records.some(sourceMutation))return;
    if(!activeSession){autoAttempted=false;scheduleAuto();return;}
    if(preferences().translateDynamic){dirty=true;scheduleDynamic();}
    else if(records.some(record=>sourceMutation(record)&&[...(record.addedNodes||[])].some(node=>!owned(node))))viewportChanged();
  }
  async function mode(){
    if(modePending||stopped)return;modePending=true;const version=epoch,url=route();
    try{
      const next=getSettings().pageDisplayMode==='translation_only'?'bilingual':'translation_only';
      await changeDisplayMode(next);
      if(stopped||version!==epoch||route()!==url)return;
      if(!page.status().total)await translate();else page.refreshPresentation();
    }finally{modePending=false;}
  }
  function keydown(event: KeyboardEvent): void{
    if(stopped||hidden()||event.isComposing||event.keyCode===229||event.repeat||event.defaultPrevented)return;
    if((event.composedPath?.()||[event.target]).some(node=>isEditable(node)||isOwnedUI(node)))return;
    const value=preferences();let action: (()=>unknown) | undefined;
    if(matchesShortcut(event,value.shortcut))action=toggle;else if(matchesShortcut(event,value.displayModeShortcut))action=mode;
    if(!action)return;event.preventDefault();event.stopPropagation();void Promise.resolve().then(action).catch(report);
  }
  function routeChanged(){epoch++;clearTimers();autoAttempted=false;manualStopped=false;activeSession=false;dirty=false;viewportDirty=false;inFlight=null;scheduleAuto();}
  function updateSettings(){
    const next=autoKey(getSettings());if(next!==previousAutoKey){previousAutoKey=next;epoch++;clearTimers();viewportDirty=false;if(!manualStopped){autoAttempted=false;if(activeSession&&preferences().translateDynamic){dirty=true;scheduleDynamic();}else{activeSession=false;scheduleAuto();}}}
    else if(!preferences().translateDynamic){dirty=false;if(dynamicTimer!==null)env.clearTimeout(dynamicTimer);dynamicTimer=null;scheduleViewport();}
  }
  function listen<K extends keyof (DocumentEventMap & WindowEventMap)>(target: EventTarget,type: K,fn: (event:(DocumentEventMap & WindowEventMap)[K])=>void,capture=false): void{target.addEventListener(type,fn as EventListener,capture);disposers.push(()=>target.removeEventListener(type,fn as EventListener,capture));}
  function start(){
    if(started||stopped)return api;started=true;listen(document,'keydown',keydown,true);
    listen(document,'scroll',viewportChanged,true);listen(env,'scroll',viewportChanged);listen(env,'resize',viewportChanged);
    // Carousels and reveal effects move text into view by CSS transition without any scroll.
    listen(document,'transitionend',viewportChanged,true);listen(document,'animationend',viewportChanged,true);
    listen(document,'visibilitychange',()=>{if(hidden()){epoch++;clearTimers();}else{if(!activeSession&&!manualStopped)autoAttempted=false;scheduleAuto();scheduleDynamic();viewportChanged();}});
    listen(env,'pagehide',()=>{epoch++;clearTimers();});
    listen(env,'pageshow',()=>{if(!activeSession&&!manualStopped)autoAttempted=false;scheduleAuto();scheduleDynamic();viewportChanged();});
    if(env.MutationObserver){observer=new env.MutationObserver(changed);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,characterDataOldValue:true,attributes:true,attributeFilter:['lang',...PAGE_LINK_ATTRIBUTES]});}
    scheduleAuto();return api;
  }
  function stop(){if(stopped)return;stopped=true;epoch++;clearTimers();observer?.disconnect();disposers.splice(0).forEach(dispose=>dispose());}
  const api={start,stop,routeChanged,updateSettings,translate,restore,cancel,toggle,mode,handleUserAction};return api;
}
