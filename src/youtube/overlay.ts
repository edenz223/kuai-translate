import type {Settings} from '../shared/settings.js';
import type {SubtitleSession,CaptionTrack,SettingsPatch} from './types.js';
export interface CaptionViewOptions {
 env?:typeof globalThis;onToggle?:()=>unknown;onTrackChange?:(id:string)=>unknown;onRetry?:()=>unknown;
 onPreferences?:(patch:SettingsPatch)=>unknown;onOpenOptions?:(section:'subtitles')=>unknown;onNavigate?:(direction:number)=>unknown;
 cancelSelection?:(id:string,reason:string)=>void;
}
interface DragState {pointerId:number;y:number;offset:number;before:number|null;bounds:string;layout?:string;moved?:boolean}
// Captured browser events are registered through runtime event names.
type BrowserEventCallback=(event:any)=>void;
import {applySubtitleTextStyle,applySubtitleBoxStyle,applySubtitlePositionStyle} from '../shared/styles.js';
import {subtitleStyle,subtitleLayoutKey,applySubtitleMask} from './presentation.js';
import {navigationState} from './navigation.js';
import {createSubtitlePreferences} from './preferences.js';

/** Selectable captions with a draggable background; player controls stay available without captions. */
export function createCaptionView(session:SubtitleSession,{env=globalThis,onToggle,onTrackChange,onRetry,onPreferences,onOpenOptions,onNavigate,cancelSelection=()=>{}}:CaptionViewOptions) {
  const doc=env.document,player=(session.video.closest('.html5-video-player')||session.video.parentElement)!;
  const element=<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string):HTMLElementTagNameMap[K]=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const host=element('div');host.id='kuai-captions-window-'+session.id;host.dataset.kuaiCaptionUi='true';host.hidden=true;
  host.style.cssText='position:absolute;width:max-content;z-index:2050;pointer-events:none;';
  const shadow=host.attachShadow({mode:'open'}),style=element('style');
  style.textContent=':host{color:white;font:20px/1.5 system-ui,sans-serif;text-align:center}*{box-sizing:border-box}.captions{pointer-events:auto;max-width:100%;touch-action:none}.caption-lines{display:flex;flex-direction:column}.caption-line{font-size:0;line-height:0}.original-text,.translation-text{display:inline;white-space:normal;overflow-wrap:anywhere;cursor:text;user-select:text!important;-webkit-user-select:text!important;unicode-bidi:plaintext}.captions[data-dragging] *{cursor:grabbing!important}.status{font:13px/1.4 system-ui;color:#fde68a;cursor:text}.retry{margin-left:8px;font:12px/1.4 system-ui;color:inherit;background:#ffffff13;border:1px solid #ffffff35;border-radius:5px;padding:2px 6px;cursor:pointer}button:focus-visible,.translation-text:focus-visible{outline:2px solid #a5b4fc}.caption-line[hidden],.original-text[hidden],.translation-text[hidden],.status[hidden],button[hidden]{display:none!important}';
  const box=element('div','captions'),lines=element('div','caption-lines'),originalLine=element('div','caption-line original-line'),translationLine=element('div','caption-line translation-line'),original=element('span','original-text'),translation=element('span','translation-text'),status=element('span','status');
  original.dir=translation.dir='auto';original.dataset.kuaiSubtitleText=translation.dataset.kuaiSubtitleText='true';
  const retry=element('button','retry','重试');retry.type='button';retry.hidden=true;box.style.cursor='grab';
  originalLine.append(original);translationLine.append(translation);lines.append(originalLine,translationLine);box.append(lines,status,retry);shadow.append(style,box);player.append(host);

  const toolbar=element('span');toolbar.dataset.kuaiCaptionUi='true';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Kuai translate 字幕工具');
  function control(text:string,title:string){const node=element('button','ytp-button',text);node.type='button';node.title=title;node.setAttribute('aria-label',title);node.style.cssText='display:inline-flex!important;align-items:center;justify-content:center;flex:0 0 34px;width:34px;height:100%;color:inherit;background:transparent;border:0;padding:0;font:700 17px system-ui;cursor:pointer;';toolbar.append(node);return node;}
  const button=control('译','开启或关闭 Kuai translate 字幕翻译');button.id='kuai-subtitle-button-'+session.id;
  const previous=control('‹','上一句字幕 · Ctrl+Alt+←'),next=control('›','下一句字幕 · Ctrl+Alt+→'),settingsButton=control('⚙','字幕设置');
  previous.dataset.kuaiSubtitlePrevious=session.id;next.dataset.kuaiSubtitleNext=session.id;settingsButton.dataset.kuaiSubtitleSettingsToggle=session.id;
  const preferences=createSubtitlePreferences({env,player,id:session.id,trigger:settingsButton,onChange:onPreferences,onTrackChange,onOpenOptions,cancelSelection});
  let native:HTMLElement|null=null,nativeVisibility='',nativeHidden=false,dragState:DragState|null=null,dragOffset:number|null=null,clickPointer:number|null=null,clickTimer:ReturnType<typeof setTimeout>|null=null,destroyed=false,mounting=false,rendering=false,lastSettings:Settings|undefined,presentation=subtitleStyle(),layoutKey:string|undefined,positionKey:string|undefined;
  function restoreNative(){if(nativeHidden&&native?.style.visibility==='hidden')native.style.visibility=nativeVisibility;nativeHidden=false;}
  function nativeVisible(show:boolean){
    const found=player.querySelector<HTMLElement>('.ytp-caption-window-container');
    if(found!==native){restoreNative();native=found;nativeVisibility=native?.style.visibility||'';}
    if(!native)return;if(show)restoreNative();else if(!nativeHidden){nativeVisibility=native.style.visibility||'';native.style.visibility='hidden';nativeHidden=true;}
  }
  function mount(){
    if(destroyed||mounting)return;
    // Releasing a held selection can synchronously render and call mount again.
    mounting=true;
    try{
      const controls=[...player.querySelectorAll<HTMLElement>('.ytp-right-controls')].find(node=>{
        const style=env.getComputedStyle?.(node);
        return !node.hidden&&style?.display!=='none'&&style?.visibility!=='hidden'&&style?.visibility!=='collapse';
      }),parent=controls||player;
      // Keep native controls in their existing order, with fullscreen at the right
      // edge. Ignore opacity so native auto-hide does not relocate the toolbar.
      if(toolbar.parentNode!==parent||(parent===controls&&parent.firstChild!==toolbar)){
        cancelSelection(session.id,'controls-relocated');if(destroyed)return;
        if(parent===controls)parent.insertBefore(toolbar,parent.firstChild);else parent.append(toolbar);
        toolbar.style.cssText=parent===player?'position:absolute;right:12px;top:12px;display:inline-flex;align-items:center;z-index:2400;height:34px;color:white;background:#111b;border-radius:6px;':'display:inline-flex;align-items:center;height:100%;float:left;color:inherit;';
      }
      if(host.parentNode!==player){cancelDrag();cancelSelection(session.id,'captions-relocated');if(destroyed)return;player.append(host);}preferences.mount();
    }finally{mounting=false;}
  }
  const press=(node:HTMLElement,reason:string)=>{for(const type of ['pointerdown','mousedown'])node.addEventListener(type,event=>{if((event as MouseEvent).button===0)cancelSelection(session.id,reason);event.stopPropagation();});};
  for(const [node,reason]of [[button,'toggle'],[retry,'retry'],[previous,'seek'],[next,'seek'],[settingsButton,'settings-open']] as const)press(node,reason);
  function reportError(error:unknown){if(!destroyed){preferences.toggle(true);preferences.error(error);}}
  function perform<A extends unknown[]>(callback:((...args:A)=>unknown)|undefined,...args:A){try{return Promise.resolve(callback?.(...args)).catch(reportError);}catch(error){reportError(error);return Promise.resolve();}}
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void perform(onToggle);});
  settingsButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();preferences.toggle();});
  for(const [node,direction]of [[previous,-1],[next,1]] as const)node.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(!node.disabled)void perform(onNavigate,direction);});
  retry.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void perform(onRetry);});
  for(const type of ['click','dblclick'])box.addEventListener(type,event=>event.stopPropagation());
  // Only a player resize changes the drag bounds; page scroll and caption changes do not.
  const boundsKey=()=>{const rect=player.getBoundingClientRect();return JSON.stringify([rect.width,rect.height]);};
  const position=()=>applySubtitlePositionStyle(host,dragOffset===null?presentation:{...presentation,offset:dragOffset});
  function clearClick(){clickPointer=null;if(clickTimer!==null)env.clearTimeout(clickTimer);clickTimer=null;}
  function finishDrag(rollback:boolean){
    const state=dragState;if(!state)return null;dragState=null;
    if(rollback)dragOffset=state.before;
    box.removeAttribute('data-dragging');box.style.cursor='grab';
    try{box.releasePointerCapture?.(state.pointerId);}catch{}
    position();
    // Captions are frozen while dragging; show the current caption again afterwards.
    if(!rendering&&!destroyed&&lastSettings)render(lastSettings);
    return state;
  }
  function cancelDrag(){finishDrag(true);}
  function currentDrag(){
    if(!dragState)return false;
    if(destroyed||!host.isConnected||!session.video.isConnected||!player.contains(session.video)||host.hidden||!session.isEnabled()||session.state.isSubtitleSelectionHeld||dragState.bounds!==boundsKey()){
      cancelDrag();return false;
    }
    return true;
  }
  // Only the background owns this gesture. Text, masked text and controls keep
  // their native selection/focus defaults and the selection controller's pause ownership.
  const isBackground=(target:EventTarget|null)=>target===box||target===lines||target===originalLine||target===translationLine;
  box.addEventListener('pointerdown',event=>{
    const target=(event.composedPath?.()||[event.target])[0];
    if(destroyed||dragState||host.hidden||!host.isConnected||!session.isEnabled()||event.defaultPrevented||event.button!==0||event.isPrimary===false||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!Number.isFinite(event.pointerId)||!Number.isFinite(event.clientY)||!isBackground(target))return;
    cancelSelection(session.id,'drag');if(destroyed||host.hidden||!host.isConnected)return;
    event.preventDefault();event.stopPropagation();clearClick();clickPointer=event.pointerId;
    dragState={pointerId:event.pointerId,y:event.clientY,offset:dragOffset??presentation.offset,before:dragOffset,bounds:boundsKey(),layout:layoutKey};
    box.setAttribute('data-dragging','');box.style.cursor='grabbing';
    try{box.setPointerCapture?.(event.pointerId);}catch{}
  });
  box.addEventListener('mousedown',event=>{if(isBackground(event.target))event.stopPropagation();});
  box.addEventListener('lostpointercapture',event=>{if(event.pointerId===dragState?.pointerId)cancelDrag();});
  function move(event:PointerEvent){
    if(event.pointerId!==dragState?.pointerId||!currentDrag()||!Number.isFinite(event.clientY))return;
    const delta=presentation.position.startsWith('top-')?event.clientY-dragState!.y:dragState!.y-event.clientY;
    if(delta===0&&!dragState!.moved)return;dragState!.moved=true;
    dragOffset=Math.max(0,Math.min(300,Math.max(0,player.getBoundingClientRect().height-100),dragState!.offset+delta));
    event.preventDefault();position();
  }
  function up(event:PointerEvent){
    if(event.pointerId===dragState?.pointerId){
      if(event.type==='pointercancel')cancelDrag();
      else if(currentDrag()){
        move(event);const state=finishDrag(false);
        if(state&&dragOffset!==null&&dragOffset!==state.offset)void perform(onPreferences,{subtitleStyle:{offset:dragOffset}});
      }
    }
    if(event.pointerId===clickPointer){if(clickTimer!==null)env.clearTimeout(clickTimer);clickTimer=env.setTimeout(clearClick,0);}
  }
  function click(event:MouseEvent & Partial<PointerEvent>){
    if(clickPointer===null||event.detail===0||(event.pointerId!==undefined&&event.pointerId!==clickPointer))return;
    clearClick();event.preventDefault();event.stopPropagation();
  }
  const listeners:(()=>void)[]=[];
  function listen(target:EventTarget,type:string,callback:BrowserEventCallback,capture=false){target.addEventListener(type,callback,capture);listeners.push(()=>target.removeEventListener(type,callback,capture));}
  listen(env,'pointerdown',()=>{if(!dragState)clearClick();},true);
  listen(env,'pointermove',move,true);listen(env,'pointerup',up,true);listen(env,'pointercancel',up,true);listen(env,'click',click,true);
  listen(env,'blur',cancelDrag);listen(env,'resize',cancelDrag);
  for(const type of ['fullscreenchange','webkitfullscreenchange'])listen(doc,type,cancelDrag,true);
  listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden')cancelDrag();});
  function setTracks(values:CaptionTrack[],selectedId?:string){preferences.setTracks(values,selectedId);}
  function render(settings:Settings){
    if(destroyed)return;lastSettings=settings;rendering=true;
    try{paint(settings);}finally{rendering=false;}
  }
  function paint(settings:Settings){
    mount();preferences.render(settings);
    const pressed=String(session.isEnabled());if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);button.style.opacity=session.isEnabled()?'1':'.55';
    const navigation=navigationState(session);
    for(const [node,target,label]of [[previous,navigation.previous,'上一句字幕'],[next,navigation.next,'下一句字幕']] as const){node.disabled=target===null;node.style.opacity=node.disabled?'.4':'1';node.title=label+' · '+(navigation.reason||(target===null?'已到时间轴边界':node===previous?'Ctrl+Alt+←':'Ctrl+Alt+→'));}
    const nextLayout=subtitleLayoutKey(settings),nextStyle=subtitleStyle(settings),nextPosition=JSON.stringify([nextStyle.position,nextStyle.offset]);
    if(dragState&&(dragState.layout!==nextLayout||!currentDrag()))cancelDrag();
    const layoutChanged=layoutKey!==undefined&&layoutKey!==nextLayout;layoutKey=nextLayout;if(layoutChanged)cancelSelection(session.id,'subtitle-layout');
    if(positionKey!==undefined&&positionKey!==nextPosition)dragOffset=null;positionKey=nextPosition;presentation=nextStyle;
    applySubtitleTextStyle(original,presentation,'source',player.getBoundingClientRect().width||1200);applySubtitleTextStyle(translation,presentation,'target',player.getBoundingClientRect().width||1200);applySubtitleBoxStyle(box,presentation);
    position();
    if(session.state.isSubtitleSelectionHeld||dragState)return;
    const caption=session.state.currentCaption,enabled=session.isEnabled();
    const set=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};set(original,caption?.original||'');set(translation,caption?.translation||'');
    // Translation-only still shows the source until its translation exists.
    originalLine.hidden=original.hidden=presentation.displayMode==='translation_only'&&!!caption?.translation;translationLine.hidden=translation.hidden=!caption?.translation;
    translationLine.style.order=translation.style.order=presentation.displayOrder==='translation_on_top'?'-1':'1';applySubtitleMask(translation,presentation.hideTranslation);
    const error=caption?.errorMessage||session.state.errorMessage||'',message=error||(!caption?.translation&&caption?(caption.status==='translating'?'翻译中…':'等待翻译'):'');
    set(status,message);status.hidden=!message;retry.hidden=!error;host.hidden=!enabled||(!caption&&!message);host.style.display=host.hidden?'none':'block';nativeVisible(!enabled||!caption?.original);
  }
  function destroy(){if(destroyed)return;destroyed=true;cancelDrag();clearClick();restoreNative();preferences.destroy();host.remove();toolbar.remove();listeners.splice(0).forEach(dispose=>dispose());}
  mount();
  return{host,toolbar,mount,render,setTracks,destroy,reportError,getRoots:()=>host.isConnected&&!host.hidden?[original,translation].filter(node=>!node.hidden&&node.textContent):[]};
}
