import type {SubtitleStyle} from './presentation.js';
import {normalizePageStyle,normalizeSubtitleStyle} from './presentation.js';

/** Fixed property names and validated values; callers never supply arbitrary CSS. */
function apply(element:HTMLElement,properties:Record<string,string|number>) {
  for(const [property,value] of Object.entries(properties))element.style.setProperty(property,String(value),'important');
}

interface MaskState {preset:string;hover:boolean;focus:boolean;tabIndex:string|null;ownsTabIndex:boolean;render?:()=>void}
const pageStates=new WeakMap<HTMLElement,MaskState>();
function pageMask(element:HTMLElement,preset:string) {
  let state=pageStates.get(element);
  if(!state){
    state={preset,hover:false,focus:false,tabIndex:element.getAttribute('tabindex'),ownsTabIndex:false};
    const render=()=>apply(element,{filter:state!.preset==='blur'&&!state!.hover&&!state!.focus?'blur(4px)':'none'});
    for(const [event,property,value] of [['mouseenter','hover',true],['mouseleave','hover',false],['focus','focus',true],['blur','focus',false]] as const)
      element.addEventListener(event,()=>{state![property]=value;render();});
    state.render=render;pageStates.set(element,state);
  }
  state.preset=preset;
  if(preset==='blur'&&element.getAttribute('tabindex')===null){element.setAttribute('tabindex','0');state.ownsTabIndex=true;}
  else if(preset!=='blur'&&state.ownsTabIndex){
    if(state.tabIndex===null)element.removeAttribute('tabindex');else element.setAttribute('tabindex',state.tabIndex);
    state.ownsTabIndex=false;
  }
  state.render!();
}

export function applyPageStyle(element:HTMLElement,input?:unknown) {
  const style=normalizePageStyle(input),preset=style.preset;
  const accent=style.accentColor,background=style.backgroundColor;
  const properties:Record<string,string|number>={
    color:style.textColor,'font-size':style.fontSize+'%','font-weight':preset==='bold'?Math.max(700,style.fontWeight):style.fontWeight,
    'font-family':style.fontFamily,'font-style':style.italic||preset==='italic'?'italic':'normal','line-height':style.lineHeight,
    opacity:style.opacity/100,
    border:'0','border-left':'0','border-radius':'0',padding:'0',background:'none','background-color':'transparent',
    'text-decoration-line':'none','text-decoration-style':'solid','text-decoration-color':accent,
    'text-decoration-thickness':'1px','text-underline-offset':'.18em','box-decoration-break':'clone',
  };
  if(preset==='border'){properties['border-left']='2px solid '+accent;properties['padding-left']='.65em';}
  else properties['padding-left']='0';
  if(['thin-dashed','dashed','dotted','orange-underline','underline','wavy'].includes(preset)){
    properties['text-decoration-line']='underline';
    properties['text-decoration-style']=preset==='thin-dashed'||preset==='dashed'?'dashed':preset==='dotted'?'dotted':preset==='wavy'?'wavy':'solid';
    properties['text-decoration-thickness']=['dashed','orange-underline','underline'].includes(preset)?'2px':'1px';
  }
  if(['background','highlight'].includes(preset)){
    properties['background-color']=background;properties.padding='.2em .45em';properties['padding-left']='.45em';properties['border-radius']='.25em';
  }
  if(preset==='marker')properties.background=`linear-gradient(transparent 45%, ${background} 45%, ${background} 90%, transparent 90%)`;
  if(preset==='dashed-border'){properties.border=properties['border-left']='1px dashed '+accent;properties.padding='.25em .5em';properties['padding-left']='.5em';properties['border-radius']='.25em';}
  apply(element,properties);element.setAttribute('data-kuai-preset',preset);pageMask(element,preset);
  return style;
}

function stroke(value:string) {
  if(value==='none')return 'none';
  if(value==='shadow45')return '2px 2px 2px #000, 0 1px 3px #000';
  const size=({light:.5,normal:1,bold:2} as Record<string,number>)[value]||0;
  return [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]].map(([x,y])=>`${x*size}px ${y*size}px 1px #000`).join(', ');
}

export function applySubtitleTextStyle(element:HTMLElement,input?:unknown,kind='target') {
  const style=normalizeSubtitleStyle(input),prefix=kind==='source'?'source':'target';
  // Caption sources carry layout line breaks; reflow them without rewriting cue text.
  apply(element,{
    color:style[(prefix+'Color') as 'sourceColor'|'targetColor'],'font-size':style[(prefix+'FontSize') as 'sourceFontSize'|'targetFontSize']+'px','font-weight':style[(prefix+'Weight') as 'sourceWeight'|'targetWeight'],
    'font-family':style.fontFamily,'font-style':'normal','text-shadow':stroke(style[(prefix+'Stroke') as 'sourceStroke'|'targetStroke']),
    'line-height':'1.4','white-space':'normal','overflow-wrap':'anywhere',
    'background-color':style.backgroundMode==='line'?subtitleBackground(style):'transparent',
    padding:style.backgroundMode==='line'?'0 10px':'0','border-radius':'0',
    'box-decoration-break':'clone','-webkit-box-decoration-break':'clone',
  });
  return style;
}

function subtitleBackground(style:SubtitleStyle) {
  const rgb=[1,3,5].map(index=>parseInt(style.backgroundColor.slice(index,index+2),16));
  return `rgba(${rgb.join(', ')}, ${style.backgroundOpacity/100})`;
}

export function applySubtitleBoxStyle(element:HTMLElement,input?:unknown) {
  const style=normalizeSubtitleStyle(input),panel=style.backgroundMode==='panel';
  apply(element,{'background-color':panel?subtitleBackground(style):'transparent','border-radius':panel?'10px':'0',padding:panel?'8px 14px':'3px 6px','box-shadow':panel?'0 2px 8px #0006':'none'});
  return style;
}

export function applySubtitlePositionStyle(element:HTMLElement,input?:unknown) {
  const style=normalizeSubtitleStyle(input),[vertical,horizontal]=style.position.split('-');
  apply(element,{
    top:vertical==='top'?style.offset+'px':'auto',bottom:vertical==='bottom'?style.offset+'px':'auto',
    left:horizontal==='left'?'3%':horizontal==='center'?'50%':'auto',right:horizontal==='right'?'3%':'auto',
    transform:horizontal==='center'?'translateX(-50%)':'none','max-width':style.maxWidth+'%',
    'text-align':horizontal==='center'?'center':horizontal,
  });
  return style;
}
