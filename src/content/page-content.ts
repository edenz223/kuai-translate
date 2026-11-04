import type {BrowserEnvironment} from './dom.js';

interface SourceRun {text:string; anchor:HTMLAnchorElement|null; indices?:number[]; before?:string; after?:string}
export interface PageContent {source:string; runs:SourceRun[]; linked:boolean; units:string[]}
export interface PageLinkBinding {source:HTMLAnchorElement; node:HTMLElement; output:HTMLElement; valid:()=>boolean; document:Document; env:BrowserEnvironment}

import {ancestors,BLOCK_SELECTOR,isReadable,splitText} from './dom.js';

export const PAGE_LINK_ATTRIBUTES=['href','target','rel','download','title','aria-label','hreflang','referrerpolicy'];
const safeProtocols=new Set(['https:','http:','mailto:','tel:']);

/** Retain local link ownership while using the same readable text boundary as blockText. */
function sourceRuns(element: HTMLElement,env: BrowserEnvironment): SourceRun[]{
  const runs: SourceRun[]=[];let pendingSpace=false,lastOwner: HTMLAnchorElement | null=null,hasText=false;
  const append=(text: string,anchor: HTMLAnchorElement | null): void=>{if(!text)return;const previous=runs.at(-1);if(previous?.anchor===anchor)previous.text+=text;else runs.push({text,anchor});};
  function text(value: unknown,anchor: HTMLAnchorElement | null): void{
    for(const part of String(value).split(/(\s+)/u)){
      if(!part)continue;
      if(/^\s+$/u.test(part)){if(hasText)pendingSpace=true;continue;}
      if(pendingSpace){append(' ',lastOwner===anchor?anchor:null);pendingSpace=false;}
      append(part,anchor);hasText=true;lastOwner=anchor;
    }
  }
  // An existing enclosing anchor already supplies this block's navigation; never nest an anchor inside it.
  const inherited=ancestors(element).some(node=>node.tagName==='A');
  function visit(node: Node,anchor: HTMLAnchorElement | null=null): void{
    if(node.nodeType===3){text(node.nodeValue||node.textContent||'',anchor);return;}
    if(node.nodeType!==1||node!==element&&((node as HTMLElement).matches?.(BLOCK_SELECTOR)||!isReadable(node as HTMLElement,env,{allowOriginal:true})))return;
    if((node as HTMLElement).tagName==='BR'){text('\n',anchor);return;}
    if(!inherited&&node!==element&&(node as HTMLElement).tagName==='A'&&(node as HTMLElement).hasAttribute('href'))anchor=node as HTMLAnchorElement;
    for(const child of node.childNodes||[])visit(child,anchor);
  }
  visit(element);return runs;
}

export function capturePageContent(element: HTMLElement,env: BrowserEnvironment): PageContent{
  const runs=sourceRuns(element,env),source=runs.map(run=>run.text).join(''),linked=runs.some(run=>run.anchor),units: string[]=[];
  if(!linked)return {source,runs,linked,units:splitText(source)};
  for(const run of runs){
    run.indices=[];
    if(!/\p{L}/u.test(run.text))continue;
    run.before=run.text.startsWith(' ')?' ':'';run.after=run.text.endsWith(' ')?' ':'';
    for(const part of splitText(run.text.trim())){run.indices!.push(units.length);units.push(part);}
  }
  return {source,runs,linked,units};
}

export function pageContentMatches(content: PageContent,element: HTMLElement,env: BrowserEnvironment): boolean{
  const current=sourceRuns(element,env);
  return current.length===content.runs.length&&current.every((run,index)=>run.anchor===content.runs[index].anchor&&run.text===content.runs[index].text);
}

function linkAttributes(source: HTMLAnchorElement,document: Document,env: BrowserEnvironment): Record<string,string|null> | null{
  const raw=source.getAttribute('href');if(raw===null)return null;
  let url;try{url=new URL(raw,source.baseURI||document.baseURI||env.location?.href);}catch{return null;}
  if(!safeProtocols.has(url.protocol))return null;
  const attributes: Record<string,string|null>={href:url.href};
  for(const name of PAGE_LINK_ATTRIBUTES)if(name!=='href')attributes[name]=source.getAttribute(name);
  if(attributes.target&&attributes.target.toLowerCase()!=='_self'){
    const rel=new Set((attributes.rel||'').split(/\s+/).filter(value=>value&&value.toLowerCase()!=='opener').map(value=>value.toLowerCase()));
    rel.add('noopener');attributes.rel=[...rel].join(' ');
  }
  return attributes;
}

/** Update native navigation only from the live source. Provider output never supplies an attribute. */
function syncLink(binding: PageLinkBinding,document: Document,env: BrowserEnvironment): boolean{
  const attributes=linkAttributes(binding.source,document,env),tag=attributes?'A':'SPAN';
  if(binding.node.tagName!==tag){
    const next=document.createElement(tag.toLowerCase()),old=binding.node;
    next.append(...old.childNodes);old.parentNode?.insertBefore(next,old);old.remove();binding.node=next;
    if(attributes)bindActivation(binding);
  }
  for(const name of PAGE_LINK_ATTRIBUTES){
    const value=attributes?.[name];
    if(value===null||value===undefined){if(binding.node.hasAttribute(name))binding.node.removeAttribute(name);}
    else if(binding.node.getAttribute(name)!==value)binding.node.setAttribute(name,value);
  }
  const sourceStyle=env.getComputedStyle?.(binding.source);
  binding.node.style.setProperty('color',sourceStyle?.color||'inherit','important');
  const decoration=attributes?sourceStyle?.textDecorationLine||'none':'none';
  binding.node.style.setProperty('text-decoration-line',decoration,'important');
  return !!attributes;
}
function bindActivation(binding: PageLinkBinding): void{
  const node=binding.node;
  const activate=(event: Event): void=>{
    if(node!==binding.node||node.parentNode!==binding.output||!binding.valid()||!syncLink(binding,binding.document,binding.env))event.preventDefault();
  };
  node.addEventListener('click',activate);node.addEventListener('auxclick',activate);
}

export function renderPageContent(output: HTMLElement,content: PageContent,parts: readonly (string | undefined)[],{document,env,valid}: {document:Document; env:BrowserEnvironment; valid:()=>boolean}): PageLinkBinding[]{
  if(!content.linked){output.append(document.createTextNode(parts.join(' ')));return [];}
  const bindings: PageLinkBinding[]=[];
  for(const run of content.runs){
    const translated=run.indices!.length?run.before+run.indices!.map(index=>parts[index]).join(' ')+run.after:run.text;
    const text=document.createTextNode(translated);
    if(!run.anchor){output.append(text);continue;}
    const node=document.createElement('span');node.append(text);output.append(node);
    const binding={source:run.anchor,node,output,valid,document,env};syncLink(binding,document,env);bindings.push(binding);
  }
  return bindings;
}
export function refreshPageLinks(bindings: readonly PageLinkBinding[] | null | undefined,document: Document,env: BrowserEnvironment): void{for(const binding of bindings||[])syncLink(binding,document,env);}

export function isPageLinkMutation(record: MutationRecord): boolean{
  return record.type==='attributes'&&PAGE_LINK_ATTRIBUTES.includes(record.attributeName as string)&&['A','BASE'].includes((record.target as HTMLElement | undefined)?.tagName as string);
}
