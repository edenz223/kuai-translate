import {sourceText} from './source-text.js';
import type {BrowserEnvironment} from './dom.js';
import {blockText,computedStyle,isBlock,isPageReadable,isPageControl,isNonLanguageText} from './dom.js';

export const INLINE_CONTROL_LIMIT=40,INLINE_TEXT_LIMIT=30,INLINE_BLOCK_LIMIT=16,INLINE_NOWRAP_LIMIT=20;
export interface SourceLayout {multiline:boolean;width:number;fontSize:number;lineHeight?:string;fontOverride?:boolean;nowrap:boolean;display:string;column:boolean;textWidth?:number;duplicatePseudo?:string;expandOverflow?:boolean}
const weightedLength=(text: string)=>Array.from(text).reduce((length,character)=>length+(character.codePointAt(0)!>255?2:1),0);

/** Address labels and punctuation must not outweigh the prose they accompany. */
function isFontSource(parent: HTMLElement,text: string,env: BrowserEnvironment): boolean {
  if(!/\p{L}/u.test(text)||isNonLanguageText(text))return false;
  const label=text.trim().toLowerCase();
  if(!/^(?:[a-z\d-]+\.)+[a-z]{2,}$/i.test(label))return true;
  const anchor=parent.closest<HTMLAnchorElement>('a[href]');
  if(!anchor)return true;
  try{
    const url=new URL(anchor.getAttribute('href')!,anchor.baseURI||parent.ownerDocument.baseURI||env.location?.href);
    return url.hostname.replace(/^www\./,'')!==label&&url.searchParams.get('site')?.toLowerCase()!==label;
  }catch{return true;}
}

/** Measure source text before appending any output; later refreshes reuse this snapshot. */
export function measureSourceLayout(element: HTMLElement,env: BrowserEnvironment): SourceLayout {
  const style=computedStyle(element,env),rect=element.getBoundingClientRect(),hostFontSize=parseFloat(style?.fontSize||'')||16;
  const texts=new Map<HTMLElement,string>();
  const tops: number[]=[],widths: number[]=[];let multiline=false;
  const visit=(node: Node): void=>{
    if(node.nodeType===3){
      if(!/\S/u.test(sourceText(node)))return;
      const parent=node.parentElement!;texts.set(parent,(texts.get(parent)||'')+sourceText(node));
      try{const range=element.ownerDocument.createRange();range.selectNodeContents(node);for(const box of Array.from(range.getClientRects?.()||[]))if(box.width&&box.height){tops.push((box.top+box.bottom)/2);widths.push(box.width);}}catch{}
      return;
    }
    if(node.nodeType!==1||node!==element&&(isBlock(node as Element,env)||!isPageReadable(node as HTMLElement,env)))return;
    if((node as Element).tagName==='BR'){multiline=true;return;}
    for(const child of node.childNodes)visit(child);
  };
  visit(element);
  let dominant=element,longest=0;
  for(const [parent,text]of texts){
    if(!isFontSource(parent,text,env))continue;
    const length=Array.from(text.replace(/\s/gu,'')).length;
    if(length>longest){dominant=parent;longest=length;}
  }
  const textStyle=dominant===element?style:computedStyle(dominant,env),fontSize=parseFloat(textStyle?.fontSize||'')||hostFontSize;
  const lineHeight=parseFloat(style?.lineHeight||'')||hostFontSize*1.2;
  multiline ||= tops.length>1&&Math.max(...tops)-Math.min(...tops)>lineHeight*.5;
  const column=style?.flexDirection?.startsWith('column')||false;
  const duplicatePseudo=column&&/flex/.test(style?.display||'')?['before','after'].filter(name=>{
    const pseudo=computedStyle(element,env,'::'+name);
    return pseudo?.height==='0px'&&pseudo.content?.slice(1,-1)===blockText(element,env);
  }).join(' '):'';
  const expandOverflow=parseInt(style?.webkitLineClamp||'')>0||style?.textOverflow==='ellipsis'&&/hidden|clip/.test((style?.overflowX||style?.overflow||'')+' '+(style?.overflowY||style?.overflow||''));
  return {expandOverflow,duplicatePseudo,multiline,width:rect.width,fontSize,lineHeight:textStyle?.lineHeight,fontOverride:dominant!==element&&fontSize!==hostFontSize,nowrap:/nowrap|^pre$/.test(style?.whiteSpace||'')||style?.textOverflow==='ellipsis',display:style?.display||'',textWidth:widths.reduce((sum,width)=>sum+width,0),column};
}

export function pageLayout(element: HTMLElement,source: string,translation: string,metrics: SourceLayout,env: BrowserEnvironment=globalThis): {layout:'inline'|'block'} {
  const control=isPageControl(element,source,env);
  const limit=control?INLINE_CONTROL_LIMIT:metrics.nowrap?INLINE_NOWRAP_LIMIT:['SPAN','STRONG','TD','TH'].includes(element.tagName)?INLINE_TEXT_LIMIT:INLINE_BLOCK_LIMIT;
  const fits=control||!metrics.textWidth||metrics.textWidth+(weightedLength(translation)/2+.35)*metrics.fontSize<=metrics.width;
  const inline=!metrics.multiline&&fits&&Math.max(weightedLength(source),weightedLength(translation))<=limit;
  return {layout:inline?'inline':'block'};
}
