import type {Settings} from '../shared/settings.js';
import type {CaptionTrack,SettingsPatch} from './types.js';
export interface SubtitlePreferencesOptions {
 env:typeof globalThis;player:Element;id:string;trigger:HTMLElement;
 onChange?:(patch:SettingsPatch)=>unknown;onTrackChange?:(id:string)=>unknown;onOpenOptions?:(section:'subtitles')=>unknown;
 cancelSelection?:(id:string,reason:string)=>void;getLanguage?:()=>string|undefined;
 onLoop?:(enabled:boolean)=>unknown;isLooping?:()=>boolean;
}
type Choice=[value:string,label:string];
interface MenuEntry {
 key:keyof SubtitleWords;className:string;icon:ToolbarIcon|MenuIcon;
 /** Present on rows that open a list of choices; absent on switches. */
 choices?:(text:SubtitleWords)=>Choice[];
 value:()=>string|boolean;select:(value:string|boolean)=>unknown;
 /** Translation choices rest while captions show only their source. */
 needsTranslation?:boolean;
}
interface MenuRow {entry:MenuEntry;row:HTMLElement;label:HTMLElement;content:HTMLElement}
import {subtitleStyle} from './presentation.js';
import {subtitleWords,type SubtitleWords} from './i18n.js';
import {createToolbarIcon,type ToolbarIcon,type MenuIcon} from './icons.js';
import {playerSurface} from './surface.js';

// Language names are shown in their own language; only the follow choice is translated.
// Like YouTube's popup the menu fits its content, between these widths.
const PANEL_WIDTH=300,MAX_WIDTH=400;
// YouTube's settings popup sits 12px above its 48px control bar.
const CONTROL_GAP=12,DEFAULT_BOTTOM=61;
const languages:Choice[]=[['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['pt','Português'],['ru','Русский'],['ar','العربية']];
// Mirrors YouTube's .ytp-popup.ytp-settings-menu: rows, switches and sub-menus.
const menuStyle=':host{font:500 13px/1.2 "YouTube Noto",Roboto,Arial,Helvetica,sans-serif;color:#eee;text-align:left;text-shadow:0 0 2px #00000080;user-select:none;-webkit-user-select:none}:host([hidden]){display:none!important}*{box-sizing:border-box}'
  +'.menu{max-height:inherit;overflow:hidden auto;border-radius:12px;background:#1c1c1ce6;transition:width .25s cubic-bezier(0,0,.2,1),height .25s cubic-bezier(0,0,.2,1);scrollbar-width:thin;scrollbar-color:#ffffff40 transparent}'
  +'.page{padding:8px 0}.page[hidden]{display:none}'
  +'.item{display:flex;align-items:center;height:40px;padding:0 15px 0 0;cursor:pointer;outline:none;white-space:nowrap}.item:hover,.item:focus-visible{background:#ffffff1a}.item[aria-disabled=true]{opacity:.5;cursor:default}.item[aria-disabled=true]:hover{background:none}'
  +'.icon{flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:100%;padding-left:10px}.icon svg{filter:drop-shadow(0 0 1px #00000080)}'
  +'.label{flex:1 0 auto;padding-right:16px}.content{flex:0 1 auto;margin-left:auto;display:flex;align-items:center;justify-content:flex-end;min-width:0;max-width:190px;font-weight:400}'
  +'.value{min-width:0;overflow:hidden;text-overflow:ellipsis}.item[aria-haspopup] .content::after{content:"";flex:none;width:7px;height:7px;margin:0 3px 0 10px;border:solid currentColor;border-width:2px 2px 0 0;transform:rotate(45deg)}'
  +'.switch{position:relative;flex:none;width:36px;height:14px;margin-right:2px;border-radius:14px;background:#ffffff4d;transition:background .1s}.switch::after{content:"";position:absolute;top:-3px;left:0;width:20px;height:20px;border-radius:50%;background:#bdbdbd;box-shadow:0 1px 1px #0009;transition:transform .1s,background .1s}'
  +'.item[aria-checked=true] .switch{background:#f00}.item[aria-checked=true] .switch::after{background:#fff;transform:translateX(16px)}'
  +'.separator{height:1px;margin:8px 0;background:#ffffff33}.external .content::after{content:"↗";font-size:15px;margin-left:8px}'
  +'.header{display:flex;align-items:center;width:100%;height:48px;margin:-8px 0 8px;padding:0 15px 0 8px;border:0;border-bottom:1px solid #ffffff33;font:inherit;color:inherit;text-shadow:inherit;background:none;cursor:pointer;outline:none}.header:hover,.header:focus-visible{background:#ffffff1a}'
  +'.header::before{content:"";width:8px;height:8px;margin:0 14px 0 10px;border:solid currentColor;border-width:0 0 2px 2px;transform:rotate(45deg)}'
  +'.option{padding-left:0}.option .check{flex:none;width:44px;height:100%;position:relative}.option[aria-checked=true] .check::after{content:"";position:absolute;left:19px;top:13px;width:6px;height:11px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg)}'
  +'.settings-status{margin:0;padding:6px 15px 4px;font-size:12px;font-weight:400;color:#fbbf24;white-space:pre-wrap}.settings-status:empty{display:none}'
  +'@media(prefers-reduced-motion:reduce){.menu,.switch,.switch::after{transition:none}}';

/** Always-mounted preferences, independent of whether a caption or translation exists. */
export function createSubtitlePreferences({env,player,id,trigger,onChange,onTrackChange,onOpenOptions,cancelSelection=()=>{},getLanguage=()=>env.navigator?.language,onLoop,isLooping=()=>false}:SubtitlePreferencesOptions) {
  const words=()=>subtitleWords(getLanguage()),doc=env.document,element=<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string):HTMLElementTagNameMap[K]=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const host=element('section');host.dataset.kuaiSubtitleSettings=id;host.dataset.kuaiCaptionUi='true';host.id='kuai-subtitle-settings-'+id;host.hidden=true;
  host.style.cssText='position:absolute;right:12px;bottom:'+DEFAULT_BOTTOM+'px;width:max-content;min-width:min(250px,calc(100% - 24px));max-width:min('+MAX_WIDTH+'px,calc(100% - 24px));max-height:calc(100% - 80px);z-index:2600;pointer-events:auto;';
  const shadow=host.attachShadow({mode:'open'}),style=element('style'),menu=element('div','menu'),main=element('div','page main'),sub=element('div','page sub'),status=element('p','settings-status');
  style.textContent=menuStyle;menu.setAttribute('role','menu');sub.hidden=true;status.setAttribute('role','status');menu.append(main,sub,status);shadow.append(style,menu);
  const home=()=>playerSurface(player,doc);home().append(host);
  trigger.setAttribute('aria-controls',host.id);trigger.setAttribute('aria-haspopup','menu');

  let settings:Partial<Settings>={},busy=false,destroyed=false,trackTracks:CaptionTrack[]=[],selectedTrack='',openEntry:MenuEntry|null=null,resizeTimer:ReturnType<typeof setTimeout>|null=null;
  const translating=()=>settings.subtitleTranslationEnabled!==false,presentation=()=>subtitleStyle(settings);
  const save=(patch:SettingsPatch)=>perform(()=>{if(!onChange)throw new Error(words().settingsUnavailable);return onChange(patch);});
  const entries:MenuEntry[]=[
    {key:'fieldEnabled',className:'subtitles-enabled',icon:'captions',value:()=>settings.subtitlesEnabled!==false,select:value=>save({subtitlesEnabled:!!value})},
    {key:'fieldTranslate',className:'subtitle-translate',icon:'translate',value:translating,select:value=>save({subtitleTranslationEnabled:!!value})},
    {key:'fieldTrack',className:'subtitle-track',icon:'source',choices:text=>{
      const choices=trackTracks.map((track):Choice=>[track.id,track.name+(track.kind==='asr'?text.asrSuffix:'')]);
      return [...choices,['',choices.length?text.trackAuto:text.trackAutoNone]];
    },value:()=>selectedTrack,select:value=>perform(()=>{if(!onTrackChange)throw new Error(words().trackUnavailable);return onTrackChange(String(value));},'track')},
    {key:'fieldProvider',className:'subtitle-provider',icon:'service',needsTranslation:true,
      choices:text=>[['follow_page',text.followPageProvider],...(settings.providers||[]).filter(item=>item.enabled).map((item):Choice=>[item.id,item.name||item.id])],
      value:()=>settings.subtitleProviderId||'follow_page',select:value=>save({subtitleProviderId:String(value)})},
    {key:'fieldTarget',className:'subtitle-target',icon:'target',needsTranslation:true,choices:text=>[['follow_page',text.followPageTarget],...languages],
      value:()=>settings.subtitleTargetLanguage||'follow_page',select:value=>save({subtitleTargetLanguage:String(value)})},
    {key:'fieldMode',className:'subtitle-mode',icon:'display',needsTranslation:true,choices:text=>[['bilingual',text.modeBilingual],['translation_only',text.modeTranslation]],
      value:()=>presentation().displayMode,select:value=>save({subtitleStyle:{displayMode:String(value)}})},
    {key:'fieldOrder',className:'subtitle-order',icon:'order',needsTranslation:true,choices:text=>[['original_on_top',text.orderOriginal],['translation_on_top',text.orderTranslation]],
      value:()=>presentation().displayOrder,select:value=>save({subtitleStyle:{displayOrder:String(value)}})},
    {key:'fieldMask',className:'subtitle-mask',icon:'mask',needsTranslation:true,value:()=>presentation().hideTranslation,select:value=>save({subtitleStyle:{hideTranslation:!!value}})},
    {key:'loop',className:'subtitle-loop',icon:'loop',value:isLooping,select:value=>Promise.resolve(onLoop?.(!!value)).finally(()=>{if(!destroyed)render(settings);})},
    {key:'fieldShortcuts',className:'subtitle-shortcuts',icon:'keyboard',choices:text=>[['ctrl-alt',text.shortcutsCtrlAlt],['letters',text.shortcutsLetters],['off',text.shortcutsOff]],
      value:()=>settings.subtitleShortcuts||'ctrl-alt',select:value=>save({subtitleShortcuts:value as Settings['subtitleShortcuts']})},
  ];
  // A remembered or saved value missing from the list still shows as itself.
  const choicesOf=(entry:MenuEntry,text:SubtitleWords)=>{const values=entry.choices!(text),current=String(entry.value());return values.some(([value])=>value===current)||!current?values:[...values,[current,current] as Choice];};
  const disabled=(entry:MenuEntry)=>busy||(!!entry.needsTranslation&&!translating())||(entry.className==='subtitle-track'&&!trackTracks.length);
  const set=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};
  // Keyboard activation runs the same action as a click.
  const actions=new WeakMap<HTMLElement,()=>void>();
  function item(className:string,role:string,action:()=>void,tag:'div'|'button'='div'){
    const node=element(tag,tag==='div'?'item '+className:className);if(tag==='div')node.setAttribute('role',role);node.tabIndex=-1;
    node.addEventListener('click',action);actions.set(node,action);return node;
  }
  function iconSlot(name:ToolbarIcon|MenuIcon){const slot=element('span','icon');slot.append(createToolbarIcon(doc,name));return slot;}
  const rows:MenuRow[]=entries.map(entry=>{
    const row=item(entry.className,entry.choices?'menuitem':'menuitemcheckbox',()=>activate(entry)),label=element('span','label'),content=element('span','content');
    if(entry.choices){row.setAttribute('aria-haspopup','true');content.append(element('span','value'));}else content.append(element('span','switch'));
    row.append(iconSlot(entry.icon),label,content);main.append(row);return{entry,row,label,content};
  });
  const all=item('all-subtitle-settings external','menuitem',()=>{Promise.resolve().then(()=>{if(!onOpenOptions)throw new Error(words().optionsUnavailable);return onOpenOptions('subtitles');}).catch(error);}),allLabel=element('span','label');all.append(iconSlot('options'),allLabel,element('span','content'));main.append(element('div','separator'),all);
  function activate(entry:MenuEntry){
    if(destroyed||disabled(entry))return;
    if(entry.choices)return showChoices(entry);
    void entry.select(!entry.value());
  }
  function showChoices(entry:MenuEntry){
    openEntry=entry;cancelSelection(id,'settings-choices');
    resize(()=>{main.hidden=true;sub.hidden=false;renderChoices();});focus(sub.querySelector<HTMLElement>('.option[aria-checked=true]')||sub.querySelector('.option'));
  }
  function back(){
    const entry=openEntry;if(!entry)return;openEntry=null;
    resize(()=>{sub.hidden=true;main.hidden=false;sub.replaceChildren();});focus(rows.find(row=>row.entry===entry)?.row);
  }
  function renderChoices(text=words()){
    const entry=openEntry;if(!entry)return;
    const header=item('header','',back,'button') as HTMLButtonElement;header.textContent=text[entry.key];header.type='button';header.setAttribute('aria-label',text.back+' · '+text[entry.key]);
    const current=String(entry.value());
    sub.replaceChildren(header,...choicesOf(entry,text).map(([value,label])=>{
      const option=item('option','menuitemradio',()=>{if(busy||destroyed)return;back();if(value!==String(entry.value()))void entry.select(value);});option.dataset.value=value;option.setAttribute('aria-checked',String(value===current));
      option.append(element('span','check'),element('span','label',label));
      return option;
    }));
  }
  // Animate between the main list and a sub-menu the way YouTube resizes its popup.
  function resize(swap:()=>void){
    const before=menu.getBoundingClientRect();swap();
    if(resizeTimer!==null){env.clearTimeout(resizeTimer);resizeTimer=null;}
    menu.style.width=menu.style.height='';
    if(host.hidden||!before.width||env.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const after=menu.getBoundingClientRect();
    menu.style.width=before.width+'px';menu.style.height=before.height+'px';void menu.offsetWidth;
    menu.style.width=after.width+'px';menu.style.height=after.height+'px';
    resizeTimer=env.setTimeout(()=>{resizeTimer=null;menu.style.width=menu.style.height='';},260);
  }
  function focus(node:HTMLElement|null|undefined){if(node&&!host.hidden)node.focus?.();}
  function render(next:Partial<Settings>){
    settings=next;if(destroyed)return;
    const text=words();host.setAttribute('aria-label',text.settings);set(allLabel,text.allSettings);
    menu.setAttribute('aria-busy',String(busy));
    for(const {entry,row,label,content}of rows){
      set(label,text[entry.key]);const value=entry.value();
      if(entry.choices){const current=String(value),choice=choicesOf(entry,text).find(([key])=>key===current);set(content.firstChild as HTMLElement,choice?.[1]||'');row.dataset.value=current;}
      else row.setAttribute('aria-checked',String(!!value));
      row.setAttribute('aria-disabled',String(disabled(entry)));
    }
    if(openEntry){if(disabled(openEntry))back();else renderChoices(text);}
    place();
  }
  function error(value:unknown){if(!destroyed)status.textContent=String((value as {message?:unknown}|null)?.message||value||words().actionFailed);}
  async function perform(action:()=>unknown,reason='preferences'){
    if(busy||destroyed)return;cancelSelection(id,reason);busy=true;render(settings);status.textContent=reason==='track'?words().switchingTrack:words().saving;
    try{await action();if(!destroyed)status.textContent=reason==='track'?words().switchedTrack:words().saved;}
    catch(reason){error(reason);}
    finally{busy=false;if(!destroyed)render(settings);}
  }
  function setTracks(values:CaptionTrack[],selectedId?:string){
    if(destroyed)return;
    trackTracks=values;selectedTrack=selectedId||'';render(settings);
  }
  // Sit just left of an open subtitle list drawer, above the control bar like YouTube's
  // own menu; only a player too narrow for both moves the panel to its left edge.
  function place(){
    const surface=home(),drawer=Array.from(surface.querySelectorAll<HTMLElement>('section')).find(node=>node.dataset.placement==='drawer'&&node.dataset.side!=='left'&&!node.hidden&&node!==host);
    const width=drawer?.getBoundingClientRect().width||0,own=Math.max(PANEL_WIDTH,host.offsetWidth||0),fits=player.getBoundingClientRect().width-width-36>=own;
    const right=!drawer?12:fits?Math.round(width)+24:null;
    host.style.right=right===null?'auto':right+'px';host.style.left=right===null?'12px':'auto';
    const bar=player.querySelector<HTMLElement>('.ytp-chrome-bottom')?.getBoundingClientRect(),bottom=surface.getBoundingClientRect().bottom;
    host.style.bottom=(bar&&bar.height>0&&bar.top<bottom?Math.round(bottom-bar.top)+CONTROL_GAP:DEFAULT_BOTTOM)+'px';
  }
  // YouTube's own settings popup and this menu share the same corner.
  function closeNativeMenu(){
    const native=player.querySelector<HTMLElement>('.ytp-settings-menu');
    if(native&&native.style.display!=='none'&&!native.hidden)player.querySelector<HTMLElement>('.ytp-settings-button[aria-expanded=true]')?.click?.();
  }
  function toggle(force?:boolean){
    if(destroyed)return false;const open=force??host.hidden;
    if(open&&host.hidden){cancelSelection(id,'settings-open');closeNativeMenu();if(openEntry){openEntry=null;sub.hidden=true;main.hidden=false;sub.replaceChildren();}render(settings);}
    host.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open)place();
    // Opening from the toolbar button takes focus like YouTube's menu; an error report does not.
    if(open&&force===undefined)focus(rows.find(row=>row.row.getAttribute('aria-disabled')!=='true')?.row);
    return open;
  }
  // A press anywhere outside the panel and its toolbar button closes it.
  const outside=(event:Event)=>{if(!host.hidden&&!(event.composedPath?.()||[event.target]).some(node=>node===host||node===trigger))toggle(false);};
  doc.addEventListener('pointerdown',outside,true);
  function moveFocus(step:number){
    const page=openEntry?sub:main,items=Array.from(page.querySelectorAll<HTMLElement>('.item,.header'));if(!items.length)return;
    const active=(shadow.activeElement||doc.activeElement) as HTMLElement|null,index=items.findIndex(node=>node===active);
    focus(items[(index+step+items.length)%items.length]);
  }
  host.addEventListener('keydown',event=>{
    const active=(shadow.activeElement||doc.activeElement) as HTMLElement|null,key=event.key;
    if(key==='Escape'){event.preventDefault();if(openEntry)back();else{toggle(false);trigger.focus?.();}}
    else if(key==='ArrowDown'||key==='ArrowUp'){event.preventDefault();moveFocus(key==='ArrowDown'?1:-1);}
    else if(key==='ArrowLeft'&&openEntry){event.preventDefault();back();}
    else if((key==='Enter'||key===' '||(key==='ArrowRight'&&active?.getAttribute('aria-haspopup')))&&active&&actions.has(active)){event.preventDefault();actions.get(active)!();}
    event.stopPropagation();
  });
  for(const type of ['pointerdown','mousedown'])host.addEventListener(type,event=>{if((event as MouseEvent).button===0)cancelSelection(id,'settings-intent');event.stopPropagation();});
  for(const type of ['click','dblclick','change'])host.addEventListener(type,event=>event.stopPropagation());
  // Wheel inside the panel must not scroll YouTube's fullscreen recommendation grid.
  for(const type of ['wheel','touchmove'])host.addEventListener(type,event=>event.stopPropagation(),{passive:true});
  render(settings);
  return{host,render,toggle,error,setTracks,mount(){if(!destroyed&&host.parentNode!==home())home().append(host);},destroy(){destroyed=true;if(resizeTimer!==null)env.clearTimeout(resizeTimer);doc.removeEventListener('pointerdown',outside,true);host.remove();}};
}
