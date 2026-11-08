import type {Settings} from '../shared/settings.js';
import type {CaptionTrack,SettingsPatch} from './types.js';
export interface SubtitlePreferencesOptions {
 env:typeof globalThis;player:Element;id:string;trigger:HTMLElement;
 onChange?:(patch:SettingsPatch)=>unknown;onTrackChange?:(id:string)=>unknown;onOpenOptions?:(section:'subtitles')=>unknown;
 cancelSelection?:(id:string,reason:string)=>void;getLanguage?:()=>string|undefined;
 onLoop?:(enabled:boolean)=>unknown;isLooping?:()=>boolean;
}
interface OptionsSelect extends HTMLSelectElement {_kuaiOptions?:string}
import {subtitleStyle} from './presentation.js';
import {subtitleWords,type SubtitleWords} from './i18n.js';

// Language names are shown in their own language; only the follow choice is translated.
const languages:[string,string][]=[['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['pt','Português'],['ru','Русский'],['ar','العربية']];

/** Always-mounted preferences, independent of whether a caption or translation exists. */
export function createSubtitlePreferences({env,player,id,trigger,onChange,onTrackChange,onOpenOptions,cancelSelection=()=>{},getLanguage=()=>env.navigator?.language,onLoop,isLooping=()=>false}:SubtitlePreferencesOptions) {
  const words=()=>subtitleWords(getLanguage()),doc=env.document,element=<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string):HTMLElementTagNameMap[K]=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const host=element('section');host.dataset.kuaiSubtitleSettings=id;host.dataset.kuaiCaptionUi='true';host.id='kuai-subtitle-settings-'+id;host.hidden=true;
  host.style.cssText='position:absolute;right:12px;bottom:64px;width:min(340px,calc(100% - 24px));max-height:calc(100% - 80px);z-index:2600;pointer-events:auto;';
  const shadow=host.attachShadow({mode:'open'}),style=element('style');
  style.textContent=':host{font:14px/1.5 system-ui,sans-serif;color:#f8fafc;text-align:left}:host([hidden]){display:none!important}*{box-sizing:border-box}.panel{max-height:60vh;overflow:auto;padding:14px;border:1px solid #ffffff38;border-radius:12px;background:#111827f5;box-shadow:0 8px 30px #0007}.header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.header h2{font:600 15px system-ui;margin:0}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:11px 0}.row span{flex:0 0 auto}select,button,input{font:inherit}select{min-width:0;max-width:190px;padding:5px;border:1px solid #64748b;border-radius:5px;color:#f8fafc;background:#1e293b}input{accent-color:#60a5fa}button{padding:6px 9px;border:1px solid #64748b;border-radius:6px;color:#f8fafc;background:#1e293b;cursor:pointer}button:hover{background:#334155}button:focus-visible,select:focus-visible{outline:2px solid #93c5fd}.close-settings{font-size:20px;line-height:20px;padding:2px 7px}.settings-status{font-size:12px;color:#fbbf24;white-space:pre-wrap}.settings-status:empty{display:none}.all-subtitle-settings{width:100%;margin-top:8px}';
  const panel=element('div','panel'),header=element('div','header'),title=element('h2'),close=element('button','close-settings','×');close.type='button';header.append(title,close);panel.append(header);
  const controls:(HTMLInputElement|HTMLSelectElement)[]=[],labels:[HTMLElement,HTMLElement,keyof SubtitleWords][]=[];
  function field(label:keyof SubtitleWords,className:string,type:'checkbox'):HTMLInputElement;
  function field(label:keyof SubtitleWords,className:string,type?:'select'):HTMLSelectElement;
  function field(label:keyof SubtitleWords,className:string,type='select'){
    const row=element('label','row'),text=element('span'),control=element(type==='select'?'select':'input',className);
    if(type!=='select')(control as HTMLInputElement).type='checkbox';row.append(text,control);panel.append(row);controls.push(control);labels.push([text,control,label]);return control;
  }
  const enabled=field('fieldEnabled','subtitles-enabled','checkbox'),tracks=field('fieldTrack','subtitle-track'),provider=field('fieldProvider','subtitle-provider'),target=field('fieldTarget','subtitle-target'),mode=field('fieldMode','subtitle-mode'),order=field('fieldOrder','subtitle-order'),mask=field('fieldMask','subtitle-mask','checkbox'),
    loop=field('loop','subtitle-loop','checkbox'),shortcuts=field('fieldShortcuts','subtitle-shortcuts');
  const status=element('p','settings-status'),all=element('button','all-subtitle-settings');all.type='button';status.setAttribute('role','status');panel.append(status,all);shadow.append(style,panel);player.append(host);
  trigger.setAttribute('aria-controls',host.id);trigger.setAttribute('aria-haspopup','dialog');host.setAttribute('role','dialog');
  function applyLabels(text:SubtitleWords){
    const set=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};
    set(title,text.settings);host.setAttribute('aria-label',text.settings);close.setAttribute('aria-label',text.closeSettings);set(all,text.allSettings);
    for(const [span,control,key]of labels){set(span,text[key]);control.setAttribute('aria-label',text[key]);}
  }
  let settings:Partial<Settings>={},busy=false,destroyed=false,trackTracks:CaptionTrack[]=[],selectedTrack='';
  function options(control:OptionsSelect,values:[string,string][],current:string){
    const choices=values.some(([value])=>value===current)||!current?values:[...values,[current,current]];
    const signature=JSON.stringify(choices);
    if(control._kuaiOptions!==signature){control._kuaiOptions=signature;control.replaceChildren(...choices.map(([value,label])=>{const option=element('option','',label);option.value=value;return option;}));}
    control.value=current;
  }
  function renderTracks(text=words()){
    const choices=trackTracks.map((track):[string,string]=>[track.id,track.name+(track.kind==='asr'?text.asrSuffix:'')]);
    options(tracks,[...choices,['',choices.length?text.trackAuto:text.trackAutoNone]],selectedTrack);
    tracks.disabled=busy||!choices.length;
  }
  function setTracks(values:CaptionTrack[],selectedId?:string){
    if(destroyed)return;
    trackTracks=values;selectedTrack=selectedId||'';renderTracks();
  }
  function render(next:Partial<Settings>){
    settings=next;if(destroyed)return;
    const text=words();applyLabels(text);if(busy)return;
    renderTracks(text);
    const presentation=subtitleStyle(settings);
    enabled.checked=settings.subtitlesEnabled!==false;mask.checked=presentation.hideTranslation;
    options(provider,[['follow_page',text.followPageProvider],...(settings.providers||[]).filter(item=>item.enabled).map((item):[string,string]=>[item.id,item.name||item.id])],settings.subtitleProviderId||'follow_page');
    options(target,[['follow_page',text.followPageTarget],...languages],settings.subtitleTargetLanguage||'follow_page');
    options(mode,[['bilingual',text.modeBilingual],['translation_only',text.modeTranslation]],presentation.displayMode);
    options(order,[['original_on_top',text.orderOriginal],['translation_on_top',text.orderTranslation]],presentation.displayOrder);
    options(shortcuts,[['ctrl-alt',text.shortcutsCtrlAlt],['letters',text.shortcutsLetters],['off',text.shortcutsOff]],settings.subtitleShortcuts||'ctrl-alt');
    loop.checked=isLooping();place();
  }
  function error(value:unknown){if(!destroyed)status.textContent=String((value as {message?:unknown}|null)?.message||value||words().actionFailed);}
  async function perform(action:()=>unknown,reason='preferences'){
    if(busy||destroyed)return;cancelSelection(id,reason);busy=true;controls.forEach(control=>control.disabled=true);status.textContent=reason==='track'?words().switchingTrack:words().saving;
    try{await action();if(!destroyed)status.textContent=reason==='track'?words().switchedTrack:words().saved;}
    catch(reason){error(reason);}
    finally{busy=false;if(!destroyed){controls.forEach(control=>control.disabled=false);render(settings);}}
  }
  function save(patch:SettingsPatch){return perform(()=>{if(!onChange)throw new Error(words().settingsUnavailable);return onChange(patch);});}
  for(const [control,patch]of [[enabled,()=>({subtitlesEnabled:enabled.checked})],[provider,()=>({subtitleProviderId:provider.value})],[target,()=>({subtitleTargetLanguage:target.value})],[mode,()=>({subtitleStyle:{displayMode:mode.value}})],[order,()=>({subtitleStyle:{displayOrder:order.value}})],[mask,()=>({subtitleStyle:{hideTranslation:mask.checked}})],[shortcuts,()=>({subtitleShortcuts:shortcuts.value as Settings['subtitleShortcuts']})]] as const)
    control.addEventListener('change',()=>{void save(patch());});
  tracks.addEventListener('change',()=>{
    if(tracks.disabled)return;const selected=tracks.value;
    void perform(()=>{if(!onTrackChange)throw new Error(words().trackUnavailable);return onTrackChange(selected);},'track');
  });
  loop.addEventListener('change',()=>{const on=loop.checked;Promise.resolve(onLoop?.(on)).finally(()=>{if(!destroyed)loop.checked=isLooping();});});
  // Stay clear of a subtitle list drawer open on the right of the same player.
  function place(){
    const drawer=Array.from(player.querySelectorAll<HTMLElement>('section')).some(node=>node.dataset.placement==='drawer'&&!node.hidden&&node!==host);
    host.style.right=drawer?'auto':'12px';host.style.left=drawer?'12px':'auto';
  }
  function toggle(force?:boolean){if(destroyed)return false;const open=force??host.hidden;if(open){cancelSelection(id,'settings-open');place();loop.checked=isLooping();}host.hidden=!open;trigger.setAttribute('aria-expanded',String(open));return open;}
  // A press anywhere outside the panel and its toolbar button closes it.
  const outside=(event:Event)=>{if(!host.hidden&&!(event.composedPath?.()||[event.target]).some(node=>node===host||node===trigger))toggle(false);};
  doc.addEventListener('pointerdown',outside,true);
  close.addEventListener('click',()=>{toggle(false);trigger.focus?.();});
  all.addEventListener('click',()=>{Promise.resolve().then(()=>{if(!onOpenOptions)throw new Error(words().optionsUnavailable);return onOpenOptions('subtitles');}).catch(error);});
  host.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();toggle(false);trigger.focus?.();}event.stopPropagation();});
  for(const type of ['pointerdown','mousedown'])host.addEventListener(type,event=>{if((event as MouseEvent).button===0)cancelSelection(id,'settings-intent');event.stopPropagation();});
  for(const type of ['click','dblclick','change'])host.addEventListener(type,event=>event.stopPropagation());
  // Wheel inside the panel must not scroll YouTube's fullscreen recommendation grid.
  for(const type of ['wheel','touchmove'])host.addEventListener(type,event=>event.stopPropagation(),{passive:true});
  applyLabels(words());renderTracks();
  return{host,render,toggle,error,setTracks,mount(){if(!destroyed&&host.parentNode!==player)player.append(host);},destroy(){destroyed=true;doc.removeEventListener('pointerdown',outside,true);host.remove();}};
}
