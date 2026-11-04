import type {Settings} from '../shared/settings.js';
import type {Translate} from '../shared/messages.js';
import type {InteractionOptions} from '../shared/interactions.js';
import type {BrowserEnvironment,CodedError,PageBlock} from './dom.js';
import type {SelectionIdentity,SelectionRoot} from './input-editor.js';

type Feature = 'selection'|'input'|'hover';
interface InteractionsOptions {document:Document;env?:BrowserEnvironment;translate:Translate;cancel?:(id:string)=>unknown;getSettings:()=>Settings;makeRequestId?:()=>string;page?:ReturnType<typeof createPageTranslator>}
interface SelectionSnapshot {text:string;selection:Selection;rect:DOMRect|null;anchor:Node|null;identity:SelectionIdentity;path:(EventTarget|null)[]}
interface HoverTask {root:HTMLElement;blocks:PageBlock[]}
interface Popup {host:HTMLDivElement;section:HTMLElement;header:HTMLElement;pin:HTMLButtonElement;source:HTMLDivElement;message:HTMLDivElement;output:HTMLDivElement;copy:HTMLButtonElement;retry:HTMLButtonElement;retryAction:(()=>Promise<unknown>)|null}
type TextResult = {cancelled:true} | {skipped:true} | {translation:string;applied:boolean};

import {appendIcon} from './icons.js';
import {batches,BLOCK_SELECTOR,blockText,configurationKey,isChinese,isEditable,isOwnedUI,isReadable,makeId,parentElement,requestOptions,splitText,translationsOf} from './dom.js';
import {normalizeInteractionOptions,normalizeKey,resolveFeatureSettings,isSiteListed} from '../shared/interactions.js';
import {isPageSiteBlocked} from './page-policy.js';
import {createHeldKeys,matchesShortcut} from './shortcuts.js';
import {createInputEditor} from './input-editor.js';
import {createInputFeedback} from './input-feedback.js';
import {createPageTranslator} from './page-translator.js';

const words={
  zh:{cancel:'取消',pin:'固定位置；取消选择后保留。拖动标题栏或使用方向键移动。',unpin:'取消固定；没有有效原文选区时关闭。',title:'Kuai translate',close:'关闭',copy:'复制译文',copied:'已复制',retry:'重试',loading:'翻译中…',noSelection:'请先选择要翻译的文字。',input:'请先聚焦可编辑的文本输入框；密码、验证码、银行卡和只读输入框不会被翻译。',noText:'输入框中没有可翻译文字。',changed:'输入内容、光标位置或编辑器状态已变化，或无法安全保留格式；可复制下面的译文。',applied:'已替换选中的输入文字。',failed:'翻译失败，请重试。',disabled:'此功能已关闭或在当前网站停用。',apply:'应用译文',restore:'恢复原输入',restored:'已恢复原输入。',preview:'译文已准备，可应用到输入框或复制。',selectionTrigger:'翻译选中文字',inputTrigger:'翻译输入内容'},
  en:{cancel:'Cancel',pin:'Pin in place after deselection. Drag the header or use arrow keys to move.',unpin:'Unpin; close when no valid source selection remains.',title:'Kuai translate',close:'Close',copy:'Copy translation',copied:'Copied',retry:'Retry',loading:'Translating…',noSelection:'Select some text to translate first.',input:'Focus an editable text field first. Password, verification, card and read-only fields are excluded.',noText:'The input field has no text to translate.',changed:'The input, caret or editor state changed, or its formatting cannot be safely preserved. Copy the translation below.',applied:'The selected input text was replaced.',failed:'Translation failed. Please retry.',disabled:'This feature is disabled or unavailable on this site.',apply:'Apply translation',restore:'Restore original input',restored:'The original input was restored.',preview:'The translation is ready to apply or copy.',selectionTrigger:'Translate selected text',inputTrigger:'Translate input'},
};
const modifierNames: Record<string,string>={ctrl:'Control',shift:'Shift',alt:'Alt',meta:'Meta'};
const modifierFlags: Record<string,'ctrlKey'|'shiftKey'|'altKey'|'metaKey'>={ctrl:'ctrlKey',shift:'shiftKey',alt:'altKey',meta:'metaKey'};
function selectionPosition(selection: Selection): DOMRect | null{try{return selection.getRangeAt(0).getBoundingClientRect();}catch{return null;}}
function selectionIdentity(selection: Selection | null | undefined): SelectionIdentity{try{if(selection?.rangeCount){const range=selection.getRangeAt(0);return [range.startContainer,range.startOffset,range.endContainer,range.endOffset];}}catch{}return [];}
const sameIdentity=(left: SelectionIdentity,right: SelectionIdentity): boolean=>left.length===right.length&&left.every((value,index)=>value===right[index]);
const sameSelection=(left: SelectionSnapshot | null,right: SelectionSnapshot | null): boolean=>!!left&&!!right&&left.text===right.text&&(left.identity.length&&right.identity.length?sameIdentity(left.identity,right.identity):left.anchor===right.anchor);

export function createInteractions({document,env=globalThis,translate,cancel=()=>{},getSettings,makeRequestId=makeId,page:sharedPage}: InteractionsOptions){
  const pending=new Set<string>(),disposers: (()=>void)[]=[],heldKeys=createHeldKeys();
  let generation=0,started=false,popup: Popup|null=null,requestContext: {reason:Feature;key:string;url:string}|null=null,lastSelection: SelectionSnapshot|null=null,selectionTask: SelectionSnapshot|null=null,selectionTimer: number|null=null,selectionTrigger: {host:HTMLDivElement;button:HTMLButtonElement}|null=null;
  let hoverVersion=0,hoverTimer: number|null=null,hoverTask: HoverTask|null=null,hoverIndicator: HTMLDivElement|null=null,lastPointer: EventTarget|null=null,pointerButtons=0,holdStarted: number|null=null,keyboardGesture: (HoverTask & {keys:string[];key:string;url:string})|null=null,chordBlocked=false;
  let inputFocusTimer: number|null=null,latest='selection',pinned=false,cardPosition: {left:number;top:number}|null=null,drag: {header:HTMLElement;id:number;x:number;y:number;left:number;top:number}|null=null,cardPointer=false;
  let state={status:'idle',source:'',translation:'',message:'',reason:''};
  const labels=()=>words[isChinese(getSettings(),env)?'zh':'en'];
  const route=()=>env.location?.href||'';
  const options=()=>normalizeInteractionOptions(getSettings(),getSettings().providers);
  const now=()=>env.performance?.now?.()??Date.now();
  const inputEditor=createInputEditor({document,env,onChange:()=>{inputFeedback?.render();}});
  const featureOptions=<F extends Feature>(feature: F): InteractionOptions[`${F}Options`]=>options()[(feature+'Options') as `${F}Options`];
  function allowed(feature: Feature): boolean{
    const settings=getSettings(),config=featureOptions(feature);
    if(document.visibilityState==='hidden'||isSiteListed(route(),config.disabledSites))return false;
    if(feature==='selection')return settings.selectionEnabled!==false;
    if(feature==='input')return (config as InteractionOptions['inputOptions']).enabled;
    return !!settings.hoverEnabled&&!isPageSiteBlocked(settings,route());
  }
  function featureKey(feature: Feature): string{
    const config=featureOptions(feature),effective=resolveFeatureSettings(getSettings(),feature);
    const policy=options().pageOptions;
    const relevant=feature==='input'?[(config as InteractionOptions['inputOptions']).autoApply,(config as InteractionOptions['inputOptions']).includeOriginal,(config as InteractionOptions['inputOptions']).displayOrder]:
      feature==='selection'?[(config as InteractionOptions['selectionOptions']).maxLength]:[policy.neverSites,policy.neverLanguages,policy.excludeSelectors,policy.minTextLength,policy.translateFullPage,
        (config as InteractionOptions['hoverOptions']).trigger,(config as InteractionOptions['hoverOptions']).customKeys,(config as InteractionOptions['hoverOptions']).mode,(config as InteractionOptions['hoverOptions']).displayMode,(config as InteractionOptions['hoverOptions']).delay,(config as InteractionOptions['hoverOptions']).holdDelay,config.disabledSites];
    return JSON.stringify([configurationKey(effective),allowed(feature),relevant]);
  }
  let lastInputKey=JSON.stringify([route(),featureKey('input')]);
  let lastHoverKey=JSON.stringify([route(),featureKey('hover')]);
  const page=sharedPage||createPageTranslator({document,env,translate,cancel,getSettings,makeRequestId});
  const inputFeedback=createInputFeedback({document,env,editor:inputEditor,translate,cancel,getSettings,
    options:()=>featureOptions('input'),allowed:()=>allowed('input'),key:()=>featureKey('input'),labels,makeRequestId,onState:()=>{latest='input';}});
  const canRestoreInput=()=>inputFeedback.canRestore();
  function abortRequests(){for(const id of pending){try{Promise.resolve(cancel(id)).catch(()=>{});}catch{}}pending.clear();}
  function releaseDrag(){if(drag){try{drag.header.releasePointerCapture?.(drag.id);}catch{}drag=null;}}
  function closeResult({keepCard=false}={}){
    generation++;abortRequests();requestContext=null;releaseDrag();
    if(!keepCard){popup?.host.remove();popup=null;pinned=false;cardPosition=null;cardPointer=false;}
    state={status:'idle',source:'',translation:'',message:'',reason:''};
  }
  function clearSelectionTask(){
    if(selectionTimer!==null)env.clearTimeout(selectionTimer);selectionTimer=null;selectionTask=null;
    selectionTrigger?.host.remove();selectionTrigger=null;
  }
  function clearHover(){
    hoverVersion++;if(hoverTimer!==null)env.clearTimeout(hoverTimer);hoverTimer=null;hoverTask=null;
    hoverIndicator?.remove();hoverIndicator=null;
  }
  function clearParagraphGesture(){clearHover();keyboardGesture=null;}
  function clearInlineTranslations(){clearParagraphGesture();page.restore();}
  function refreshPresentation(){page.refreshPresentation();if(hoverTask?.root?.isConnected)indicateHover(hoverTask.root);}
  function cancelCurrent(){clearSelectionTask();clearHover();lastSelection=null;closeResult();inputFeedback.cancelCurrent();latest='selection';}
  function append<K extends keyof HTMLElementTagNameMap>(tag: K,parent?: ParentNode,attribute?: string): HTMLElementTagNameMap[K]{const node=document.createElement(tag);if(attribute)node.setAttribute(attribute,'');parent?.append(node);return node;}
  function preserveFocus(node: HTMLButtonElement): void{for(const type of ['pointerdown','mousedown'] as const)node.addEventListener(type,event=>{if(event.button===0)event.preventDefault();});}
  function open(rect?: DOMRect | null): Popup{
    if(!popup?.host.isConnected){
      const host=document.createElement('div');host.id='kuai-translation-popup';host.setAttribute('data-kuai-owned','');host.setAttribute('data-kuai-ui','');
      const shadow=host.attachShadow({mode:'open'}),style=append('style',shadow);
      style.textContent=':host{color-scheme:light dark}*{box-sizing:border-box}section{background:#fff;color:#172033;border:1px solid #b4bfd1;border-radius:12px;box-shadow:0 6px 30px #0003;font:14px/1.6 system-ui,sans-serif;overflow:auto;padding:14px}header{display:flex;align-items:center;gap:12px;font-weight:650}header span{flex:1;user-select:none}button{font:inherit;border:1px solid #bbc5d6;border-radius:6px;background:#f2f5fa;color:#172033;padding:3px 8px;cursor:pointer}[data-pin]{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px}[data-pin][aria-pressed=true]{background:#dbeafe;color:#1d4ed8;border-color:#60a5fa}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid #1976d2;outline-offset:2px}.source,.translation{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text!important;-webkit-user-select:text!important}.source{font-size:12px;color:#5d687b;max-height:110px;overflow:auto;border-bottom:1px solid #dde3ec;padding-bottom:9px;margin:10px 0}.translation{margin:10px 0}.message{font-size:12px;color:#5d687b}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}[hidden]{display:none!important}@media(prefers-color-scheme:dark){section{background:#202635;color:#eef2fa;border-color:#596174}button{background:#303a50;color:#eef2fa;border-color:#6c7690}.source,.message{color:#b6c1d5}}';
      const section=append('section',shadow);section.setAttribute('role','dialog');section.setAttribute('aria-label','Kuai translate');
      const header=append('header',section),title=append('span',header),pin=append('button',header,'data-pin'),close=append('button',header);
      header.setAttribute('tabindex','0');header.setAttribute('aria-label',labels().pin);pin.type='button';appendIcon(document,pin,'pin');preserveFocus(pin);pin.addEventListener('click',()=>{pinned=!pinned;if(!pinned&&!usableSelection(readSelection()))closeResult();else render();});
      header.addEventListener('pointerdown',event=>{if(!pinned||event.button!==0||!([header,title] as EventTarget[]).includes(targetOf(event)!))return;event.preventDefault();drag={header,id:event.pointerId,x:event.clientX,y:event.clientY,left:cardPosition!.left,top:cardPosition!.top};try{header.setPointerCapture?.(event.pointerId);}catch{}});
      header.addEventListener('keydown',event=>{if(!pinned||targetOf(event)!==header||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?1:10;placeCard(cardPosition!.left+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),cardPosition!.top+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0));});title.textContent='Kuai translate';close.type='button';close.textContent='×';close.setAttribute('aria-label',labels().close);preserveFocus(close);close.addEventListener('click',()=>{clearSelectionTask();lastSelection=null;closeResult();});
      const source=append('div',section,'data-source'),message=append('div',section,'data-message'),output=append('div',section,'data-translation');
      source.className='source';message.className='message';message.setAttribute('role','status');output.className='translation';
      const actions=append('div',section);actions.className='actions';
      const copy=append('button',actions,'data-copy'),retry=append('button',actions,'data-retry');
      for(const button of [copy,retry]){button.type='button';preserveFocus(button);}
      copy.addEventListener('click',async()=>{if(!state.translation)return;try{await env.navigator.clipboard.writeText(state.translation);if(popup)popup.message.textContent=labels().copied;}catch{if(popup)popup.message.textContent=labels().copy;}});
      retry.addEventListener('click',()=>{const task=popup?.retryAction;if(task)void task().catch(()=>{});});
      host.addEventListener('pointerdown',()=>{cardPointer=true;});host.addEventListener('mousedown',()=>{cardPointer=true;});
      document.documentElement.append(host);popup={host,section,header,pin,source,message,output,copy,retry,retryAction:null};
    }
    if(!pinned||!cardPosition)placeCard(Number(rect?.left)||16,(Number(rect?.bottom)||60)+8);
    else placeCard(cardPosition!.left,cardPosition!.top);
    return popup;
  }
  function placeCard(left: number,top: number): void{
    if(!popup)return;
    const viewportWidth=env.innerWidth||1200,viewportHeight=env.innerHeight||800,width=Math.max(0,Math.min(420,viewportWidth-24));
    const height=Math.min(popup.section.getBoundingClientRect().height||160,Math.max(0,viewportHeight-24));
    left=Math.max(12,Math.min(viewportWidth-width-12,left));top=Math.max(12,Math.min(viewportHeight-height-12,top));cardPosition={left,top};
    popup.host.style.cssText='all:initial;position:fixed;z-index:2147483646;width:'+width+'px;';popup.host.style.left=left+'px';popup.host.style.top=top+'px';
    popup.section.style.maxHeight=Math.max(0,viewportHeight-top-12)+'px';
    popup.header.style.cursor=pinned?'move':'';
  }
  function render(){
    if(!popup)return;
    if(popup.source.textContent!==state.source)popup.source.textContent=state.source;popup.source.hidden=!state.source||state.reason==='selection'&&!featureOptions('selection').showOriginal;
    if(popup.output.textContent!==state.translation)popup.output.textContent=state.translation;popup.message.textContent=state.message;
    popup.copy.textContent=labels().copy;popup.copy.disabled=!state.translation||!env.navigator?.clipboard?.writeText;
    popup.retry.textContent=labels().retry;popup.retry.hidden=state.status!=='error'||!popup.retryAction;
    popup.pin.setAttribute('aria-pressed',String(pinned));popup.pin.setAttribute('aria-label',pinned?labels().unpin:labels().pin);popup.pin.title=pinned?labels().unpin:labels().pin;popup.header.style.cursor=pinned?'move':'';
  }
  function fail(message: string,code='NO_TEXT'): never{clearSelectionTask();lastSelection=null;closeResult();latest='selection';open();state.status='error';state.message=message;render();const error=new Error(message) as CodedError;error.code=code;throw error;}
  function selectionSources(path: (EventTarget | null)[]=[]): Selection[]{
    const sources=new Set<SelectionRoot>();
    for(const node of path){const shadow=(node as Node | null)?.getRootNode?.() as SelectionRoot | undefined;if(shadow?.host)sources.add(shadow);if((node as HTMLElement | null)?.shadowRoot)sources.add((node as HTMLElement).shadowRoot!);}
    for(const host of document.querySelectorAll('[id]'))if(/^(?:kuai-captions-window-|kuai-subtitle-sidebar-)/.test(host.id)&&host.shadowRoot)sources.add(host.shadowRoot);
    const result: (Selection | null | undefined)[]=[];for(const source of sources){try{const selection=source.getSelection?.();if(selection)result.push(selection);}catch{}}
    result.push(env.getSelection?.(),document.getSelection?.());return result.filter(Boolean) as Selection[];
  }
  function readSelection(path: (EventTarget | null)[]=[]): SelectionSnapshot | null{
    for(const selection of selectionSources(path)){
      const text=selection.toString().trim();
      if(!selection.isCollapsed&&text&&!isOwnedUI(selection.anchorNode))return {text,selection,rect:selectionPosition(selection),anchor:selection.anchorNode,identity:selectionIdentity(selection),path};
    }
    return null;
  }
  function usableSelection(selected: SelectionSnapshot | null): selected is SelectionSnapshot{return (allowed('selection')&&!inputEditor.isComposing()&&selected&&selected.text.length<=featureOptions('selection').maxLength&&!isEditable(selected.anchor)&&!isEditable(selected.selection?.focusNode)) as boolean;}
  function selectedStillCurrent(selected: SelectionSnapshot): boolean{return selected.anchor?.isConnected!==false&&sameSelection(selected,readSelection(selected.path));}
  function speakWord(text: string,settings: Settings): void{
    if(!featureOptions('selection').autoSpeak||!text||text.length>80||!/^\p{L}[\p{L}\p{M}'’-]*$/u.test(text))return;
    try{
      const speech=env.speechSynthesis,Utterance=env.SpeechSynthesisUtterance;if(!speech||!Utterance)return;
      const language=String(settings.sourceLanguage==='auto'?env.navigator?.language:settings.sourceLanguage||'').toLowerCase().split(/[-_]/)[0];
      const voice=speech.getVoices().find(item=>item.localService===true&&String(item.lang).toLowerCase().split(/[-_]/)[0]===language);
      if(!voice)return;const utterance=new Utterance(text);utterance.voice=voice;utterance.lang=voice.lang;speech.speak(utterance);
    }catch{}
  }
  async function runText(text: string,rect: DOMRect | null | undefined,{reason='selection',retry=null,speak=true,validate=()=>true}: {reason?:Feature;retry?:(()=>Promise<unknown>)|null;speak?:boolean;validate?:()=>boolean}={}): Promise<TextResult>{
    closeResult({keepCard:pinned});latest='selection';const version=++generation,settings=resolveFeatureSettings(getSettings(),reason),key=featureKey(reason),url=route();
    requestContext={reason,key,url};
    state={status:'loading',source:text,translation:'',message:labels().loading,reason};open(rect);popup!.retryAction=retry;render();
    const result: string[]=[];
    const current=()=>{
      if(version!==generation)return false;
      if(route()!==url||featureKey(reason)!==key||!allowed(reason)||!validate()){closeResult();return false;}
      return true;
    };
    try{
      for(const group of batches(splitText(text),part=>part)){
        if(!current())return {cancelled:true};const id=makeRequestId();pending.add(id);
        try{const response=await translate(group,requestOptions(settings,id));if(!current())return {cancelled:true};result.push(...translationsOf(response,group.length));}
        finally{pending.delete(id);}
      }
      if(!current())return {cancelled:true};
      const translation=result.join(' ');let applied=false,message='';
      state={status:'success',source:text,translation,message,reason};render();
      if(reason==='selection'&&speak)speakWord(text,settings);
      return {translation,applied};
    }catch(error){if(!current())return {cancelled:true};state.status='error';state.message=String((error as {message?:unknown} | null)?.message||labels().failed);render();throw error;}
  }
  async function translateSelection({text,path=[],speak=true}: {text?:unknown;path?:(EventTarget|null)[];speak?:boolean}={}): Promise<TextResult>{
    if(!allowed('selection'))return fail(labels().disabled,'FEATURE_DISABLED');
    if(inputEditor.isComposing())return {skipped:true};
    const selected=readSelection(path),source=typeof text==='string'&&text.trim()?text.trim():selected?.text;
    if(!source)return fail(labels().noSelection);
    if(source.length>featureOptions('selection').maxLength)return {skipped:true};
    clearSelectionTask();
    return runText(source,selected?.rect,{retry:()=>translateSelection({text:source,speak:false}),speak});
  }
  const translateInput=()=>inputFeedback.run();
  const applyPreview=()=>inputFeedback.apply();
  const restoreInput=()=>inputFeedback.restore();
  function createTrigger(id: string,kind: string,rect: DOMRect | null,label: string,activate: ()=>void){
    const host=document.createElement('div');host.id=id;host.setAttribute('data-kuai-owned','');host.setAttribute('data-kuai-ui','');
    const shadow=host.attachShadow({mode:'open'}),style=append('style',shadow),button=append('button',shadow);
    style.textContent=':host{all:initial}button{box-sizing:border-box;display:block;width:28px;height:28px;padding:0;border:1px solid #5888c0;border-radius:7px;color:#fff;background:#2563a6;box-shadow:0 2px 8px #0003;font:700 15px/1 system-ui,sans-serif;cursor:pointer}button.dot{width:18px;height:18px;border-radius:50%;font-size:10px}button:focus-visible{outline:2px solid #173f71;outline-offset:2px}';
    button.type='button';button.className=kind==='dot'?'dot':'';button.textContent=kind==='dot'?'•':'译';button.title=label;button.setAttribute('aria-label',label);button.setAttribute('tabindex','-1');
    preserveFocus(button);button.addEventListener('click',event=>{event.stopPropagation();activate();});
    const left=Math.max(4,Math.min((env.innerWidth||1200)-34,Number(rect?.right??rect?.left)||10)),top=Math.max(4,Math.min((env.innerHeight||800)-34,Number(rect?.bottom)||30));
    host.style.cssText='all:initial;position:fixed;z-index:2147483647;left:'+left+'px;top:'+top+'px;';document.documentElement.append(host);return {host,button};
  }
  function activateSelection(selected: SelectionSnapshot | null,delay=0): void{
    if(!usableSelection(selected)||!selectedStillCurrent(selected)||sameSelection(lastSelection,selected))return;
    if(selectionTimer!==null)env.clearTimeout(selectionTimer);
    selectionTask=selected;
    const action=()=>{
      selectionTimer=null;
      if(selectionTask!==selected||!usableSelection(selected)||!selectedStillCurrent(selected))return;
      lastSelection=selected;clearSelectionTask();void translateSelection({text:selected.text,path:selected.path}).catch(()=>{});
    };
    if(delay)selectionTimer=env.setTimeout(action,delay);else action();
  }
  function prepareSelection(selected: SelectionSnapshot | null,modifier=false): void{
    if(!usableSelection(selected)||sameSelection(lastSelection,selected))return;
    const config=featureOptions('selection');clearSelectionTask();selectionTask=selected;
    if(['icon','dot'].includes(config.triggerMode)){
      selectionTimer=env.setTimeout(()=>{
        selectionTimer=null;if(selectionTask!==selected||!usableSelection(selected)||!selectedStillCurrent(selected))return;
        selectionTrigger=createTrigger('kuai-selection-trigger',config.triggerMode,selected.rect,labels().selectionTrigger,()=>{if(featureOptions('selection').triggerAction==='click')activateSelection(selected);});
        if(config.triggerAction==='hover'){
          selectionTrigger.button.addEventListener('mouseenter',()=>activateSelection(selected,featureOptions('selection').delay));
          selectionTrigger.button.addEventListener('mouseleave',()=>{if(selectionTimer!==null)env.clearTimeout(selectionTimer);selectionTimer=null;});
        }
      },0);
    }else if(config.triggerMode==='auto'||modifier)activateSelection(selected,config.delay);
  }
  function updateInputTrigger(){inputFeedback.render();}
  function hoverEligible(){
    return allowed('hover')&&!inputEditor.isComposing()&&!readSelection()&&!!lastPointer&&!isOwnedUI(lastPointer)&&!isEditable(lastPointer)&&!isEditable(document.activeElement);
  }
  function hoverMatches(){
    if(!hoverEligible())return false;
    const config=featureOptions('hover');
    if(config.trigger==='left_hold')return pointerButtons===1&&holdStarted!==null;
    return config.trigger==='hover'&&!pointerButtons;
  }
  function gestureKeys(){const config=featureOptions('hover');return config.trigger==='custom'?config.customKeys:[modifierNames[config.trigger]].filter(Boolean);}
  function gestureValidity(key: string,url: string): ()=>boolean{return ()=>started&&allowed('hover')&&featureKey('hover')===key&&route()===url;}
  function hoverRoot(): HTMLElement | null{
    const element=parentElement(lastPointer);
    const block=element?.closest?.<HTMLElement>(BLOCK_SELECTOR);
    // Feed cards use a full-card overlay link and render content in named shadow slots.
    // Resolve that surface to the card's content, rather than its ancestor's metadata.
    const card=element?.closest<HTMLElement>('shreddit-post')||(block?.tagName==='ARTICLE'?block.querySelector<HTMLElement>('shreddit-post'):null);
    if(card&&isReadable(card,env)&&(featureOptions('hover').mode==='area'||element===card||!block||!card.contains(block)||!blockText(block,env)||element?.closest('[slot="full-post-link"],[slot="credit-bar"]')))return card;
    const root=featureOptions('hover').mode==='area'?element?.closest?.<HTMLElement>('article,section,main,div')||block:block;
    return root&&isReadable(root,env)?root:null;
  }
  function hoverBlocks(root: HTMLElement): PageBlock[]{
    // Match the outlined region: retain its own text and each nested paragraph as
    // separate source units so every translation stays next to its original.
    const regions=root.tagName==='SHREDDIT-POST'
      ?Array.from(root.querySelectorAll<HTMLElement>('[slot="title"],[slot="text-body"],[slot="body"]')):[root];
    const elements=new Set(regions.flatMap(region=>[region,...region.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)]));
    return [...elements].filter(element=>isReadable(element,env)).map(element=>({element,text:blockText(element,env)}))
      .filter(block=>/[\p{L}\p{N}]/u.test(block.text));
  }

  const blocksKey=(blocks: readonly PageBlock[]): string=>blocks.map(item=>item.text).join('\n');
  const sameBlocks=(left: readonly PageBlock[],right: readonly PageBlock[]): boolean=>left.length===right.length&&left.every((block,index)=>block.element===right[index].element&&block.text===right[index].text);
  function indicateHover(root: HTMLElement): void{
    hoverIndicator?.remove();hoverIndicator=null;const config=featureOptions('hover');if(!config.showIndicator)return;
    const rect=root.getBoundingClientRect(),node=document.createElement('div');node.setAttribute('data-kuai-owned','');node.setAttribute('data-kuai-ui','');node.id='kuai-hover-indicator';
    node.style.cssText='all:initial;pointer-events:none;position:fixed;z-index:2147483644;box-sizing:border-box;border:2px dashed '+config.borderColor+';border-radius:4px;left:'+rect.left+'px;top:'+rect.top+'px;width:'+Math.max(0,rect.width)+'px;height:'+Math.max(0,rect.height)+'px;';
    document.documentElement.append(node);hoverIndicator=node;
  }
  function evaluateHover(){
    if(!hoverMatches()){clearHover();return;}
    const root=hoverRoot();if(!root){clearHover();return;}
    const blocks=hoverBlocks(root),sourceKey=blocksKey(blocks);if(!sourceKey){clearHover();return;}
    if(hoverTask?.root===root&&sameBlocks(hoverTask.blocks,blocks))return;
    clearHover();const version=hoverVersion,key=featureKey('hover'),url=route(),config=featureOptions('hover');
    hoverTask={root,blocks};indicateHover(root);
    const delay=config.delay+(config.trigger==='left_hold'?Math.max(0,config.holdDelay-(now()-holdStarted!)):0);
    hoverTimer=env.setTimeout(()=>{
      hoverTimer=null;
      if(version!==hoverVersion||!hoverMatches()||hoverRoot()!==root||!root.isConnected||!sameBlocks(blocks,hoverBlocks(root)))return;
      // Once accepted, pointer/key release does not own the translation request.
      void page.translateBlocks(blocks,{validate:gestureValidity(key,url)}).catch(()=>{});
    },delay);
  }
  function targetOf(event: Event): EventTarget | null{return event.composedPath?.()[0]||event.target;}
  function mousemove(event: MouseEvent): void{
    lastPointer=targetOf(event);pointerButtons=event.buttons||0;heldKeys.update(event);if(pointerButtons!==1)holdStarted=null;
    if(keyboardGesture){
      if(!hoverEligible()||pointerButtons||hoverRoot()!==keyboardGesture.root)clearParagraphGesture();
      return;
    }
    evaluateHover();
  }
  function mousedown(event: MouseEvent): void{
    if(event.button!==0)return;const target=targetOf(event);if(isOwnedUI(target))return;cardPointer=false;
    lastPointer=target;pointerButtons=1;heldKeys.update(event);holdStarted=now();keyboardGesture=null;clearSelectionTask();evaluateHover();
  }
  function mouseup(event: MouseEvent): void{
    if(event.button!==0)return;pointerButtons=0;holdStarted=null;if(featureOptions('hover').trigger==='left_hold')clearHover();
    const target=targetOf(event);if(!allowed('selection')||inputEditor.isComposing()||isOwnedUI(target)||isEditable(target))return;
    const config=featureOptions('selection'),path=event.composedPath?.()||[target],selected=readSelection(path);
    prepareSelection(selected,!!event[modifierFlags[config.triggerMode]]);
  }
  function selectionchange(){
    const selected=readSelection();
    if(selected){clearHover();keyboardGesture=null;}else lastSelection=null;
    if(selectionTask&&!selectedStillCurrent(selectionTask))clearSelectionTask();
    if(popup&&!pinned&&!usableSelection(selected)&&!cardPointer&&!cardSelection())closeResult();
    render();
  }
  function cardSelection(){
    if(!popup)return false;
    const selections=[...selectionSources(),(popup.host.shadowRoot! as SelectionRoot).getSelection?.()].filter(Boolean) as Selection[];
    return selections.some(selection=>!selection.isCollapsed&&[selection.anchorNode,selection.focusNode].some(node=>node&&(popup!.host.contains(node)||popup!.host.shadowRoot!.contains(node))));
  }
  function resetGestures(){keyboardGesture=null;chordBlocked=false;heldKeys.clear();pointerButtons=0;holdStarted=null;lastPointer=null;clearHover();clearSelectionTask();lastSelection=null;}
  // Observe page shortcut chords before their capture listener stops propagation.
  // Input and selection actions retain their normal bubbling event semantics.
  function trackParagraphChord(event: KeyboardEvent): void{
    const keys=gestureKeys(),key=normalizeKey(event.key),config=options().pageOptions;
    if(!keys.includes(key)||matchesShortcut(event,config.shortcut)||matchesShortcut(event,config.displayModeShortcut)){
      if(keyboardGesture)clearParagraphGesture();if(keys.some(value=>heldKeys.has(value)))chordBlocked=true;
    }
  }
  function keydown(event: KeyboardEvent): void{
    if(event.key==='Escape'){resetGestures();cancelCurrent();return;}
    if(event.repeat)return;
    if(event.defaultPrevented||event.isComposing||event.keyCode===229||inputEditor.isComposing()){
      clearParagraphGesture();chordBlocked=true;return;
    }
    heldKeys.update(event,true);
    const keys=gestureKeys(),key=normalizeKey(event.key);
    if(allowed('input')&&inputEditor.eligible()){
      const config=featureOptions('input');
      if(matchesShortcut(event,config.restoreShortcut)&&canRestoreInput()){event.preventDefault();restoreInput();return;}
      if(matchesShortcut(event,config.shortcut)){
        if(canRestoreInput()){event.preventDefault();restoreInput();return;}
        const snapshot=inputEditor.capture(),available=!!snapshot?.text.trim();inputEditor.release(snapshot);
        if(available){event.preventDefault();void translateInput().catch(()=>{});return;}
      }
    }
    const selectionConfig=featureOptions('selection');
    if(heldKeys.has(modifierNames[selectionConfig.triggerMode]))prepareSelection(readSelection(),true);
    const protectedTarget=(event.composedPath?.()||[event.target]).some(node=>isEditable(node)||isOwnedUI(node));
    if(protectedTarget||!hoverEligible()||pointerButtons){keyboardGesture=null;clearHover();return;}
    if(keys.length&&!chordBlocked&&keys.includes(key)&&heldKeys.matches(keys)){
      const root=hoverRoot()!,blocks=root?hoverBlocks(root):[];
      if(blocks.length){keyboardGesture={root,blocks,keys,key:featureKey('hover'),url:route()};indicateHover(root!);event.preventDefault();}
    }
  }
  function keyup(event: KeyboardEvent): void{
    const gesture=keyboardGesture,key=normalizeKey(event.key);heldKeys.update(event,false);
    if(!gestureKeys().some(value=>heldKeys.has(value)))chordBlocked=false;
    if(!gesture||!gesture.keys.includes(key))return;
    keyboardGesture=null;clearHover();
    const valid=gestureValidity(gesture.key,gesture.url);
    if(event.defaultPrevented||event.isComposing||event.keyCode===229||!valid()||!hoverEligible()||pointerButtons||
      (event.composedPath?.()||[event.target]).some(node=>isEditable(node)||isOwnedUI(node))||
      hoverRoot()!==gesture.root||!sameBlocks(gesture.blocks,hoverBlocks(gesture.root)))return;
    event.preventDefault();void page.toggleBlocks(gesture.blocks,{validate:valid}).catch(()=>{});
  }
  function listen<K extends keyof (DocumentEventMap & WindowEventMap)>(target: EventTarget,type: K,handler: (event:(DocumentEventMap & WindowEventMap)[K])=>void,capture=false): void{target.addEventListener(type,handler as EventListener,capture);disposers.push(()=>target.removeEventListener(type,handler as EventListener,capture));}
  function start(){
    if(started)return api;started=true;inputEditor.start();inputFeedback.start();
    listen(document,'mouseup',mouseup);listen(document,'mousedown',mousedown);listen(document,'mousemove',mousemove);
    listen(document,'keydown',trackParagraphChord,true);listen(document,'keyup',keyup);listen(document,'keydown',keydown);listen(document,'selectionchange',selectionchange);
    listen(document,'compositionstart',()=>{resetGestures();updateInputTrigger();});
    listen(document,'compositionend',updateInputTrigger);
    listen(document,'focusin',event=>inputFeedback.focusin(event));
    listen(document,'pointerdown',event=>inputFeedback.pointerdown(event),true);listen(document,'mousedown',event=>inputFeedback.pointerdown(event),true);
    listen(document,'focusout',()=>{if(inputFocusTimer!==null)env.clearTimeout(inputFocusTimer);inputFocusTimer=env.setTimeout(()=>{inputFocusTimer=null;inputFeedback.render(true);},0);});
    listen(env,'blur',()=>{resetGestures();releaseDrag();cardPointer=false;inputFeedback.hide();});
    listen(document,'visibilitychange',()=>{if(document.visibilityState==='hidden'){resetGestures();inputEditor.invalidate();releaseDrag();cardPointer=false;inputFeedback.hide();}else updateInputTrigger();});
    listen(document,'pointercancel',()=>{resetGestures();releaseDrag();cardPointer=false;});
    listen(document,'pointermove',event=>{if(drag&&event.pointerId===drag.id)placeCard(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);});
    listen(document,'pointerup',()=>{releaseDrag();cardPointer=false;});
    listen(document,'mouseup',()=>{cardPointer=false;});
    listen(document,'scroll',updateInputTrigger,true);listen(env,'scroll',updateInputTrigger,true);
    listen(env,'resize',()=>{if(cardPosition)placeCard(cardPosition!.left,cardPosition!.top);updateInputTrigger();});
    updateInputTrigger();return api;
  }
  function updateSettings(){
    const hoverKey=JSON.stringify([route(),featureKey('hover')]);
    if(hoverKey!==lastHoverKey){resetGestures();lastHoverKey=hoverKey;}
    else clearSelectionTask();
    if(inputFocusTimer!==null)env.clearTimeout(inputFocusTimer);inputFocusTimer=null;
    const inputKey=JSON.stringify([route(),featureKey('input')]);if(inputKey!==lastInputKey){inputEditor.invalidate();lastInputKey=inputKey;}
    if(requestContext&&(requestContext.url!==route()||requestContext.key!==featureKey(requestContext.reason)))closeResult();
    inputFeedback.update();render();refreshPresentation();
  }
  function stop(){
    started=false;disposers.splice(0).forEach(dispose=>dispose());resetGestures();if(!sharedPage)page.stop();closeResult();inputFeedback.stop();inputEditor.stop();
    if(inputFocusTimer!==null)env.clearTimeout(inputFocusTimer);inputFocusTimer=null;
  }
  const api={start,stop,updateSettings,cancelCurrent,clearInlineTranslations,clearParagraphGesture,refreshPresentation,translateSelection,translateInput,restoreInput,applyInput:applyPreview,getState:()=>latest==='input'?inputFeedback.getState():({...state})};return api;
}
