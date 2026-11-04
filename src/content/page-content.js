import {ancestors,BLOCK_SELECTOR,isReadable,splitText} from './dom.js';

export const PAGE_LINK_ATTRIBUTES=['href','target','rel','download','title','aria-label','hreflang','referrerpolicy'];
const safeProtocols=new Set(['https:','http:','mailto:','tel:']);

/** Retain local link ownership while using the same readable text boundary as blockText. */
function sourceRuns(element,env){
  const runs=[];let pendingSpace=false,lastOwner=null,hasText=false;
  const append=(text,anchor)=>{if(!text)return;const previous=runs.at(-1);if(previous?.anchor===anchor)previous.text+=text;else runs.push({text,anchor});};
  function text(value,anchor){
    for(const part of String(value).split(/(\s+)/u)){
      if(!part)continue;
      if(/^\s+$/u.test(part)){if(hasText)pendingSpace=true;continue;}
      if(pendingSpace){append(' ',lastOwner===anchor?anchor:null);pendingSpace=false;}
      append(part,anchor);hasText=true;lastOwner=anchor;
    }
  }
  // An existing enclosing anchor already supplies this block's navigation; never nest an anchor inside it.
  const inherited=ancestors(element).some(node=>node.tagName==='A');
  function visit(node,anchor=null){
    if(node.nodeType===3){text(node.nodeValue||node.textContent||'',anchor);return;}
    if(node.nodeType!==1||node!==element&&(node.matches?.(BLOCK_SELECTOR)||!isReadable(node,env,{allowOriginal:true})))return;
    if(node.tagName==='BR'){text('\n',anchor);return;}
    if(!inherited&&node!==element&&node.tagName==='A'&&node.hasAttribute('href'))anchor=node;
    for(const child of node.childNodes||[])visit(child,anchor);
  }
  visit(element);return runs;
}

export function capturePageContent(element,env){
  const runs=sourceRuns(element,env),source=runs.map(run=>run.text).join(''),linked=runs.some(run=>run.anchor),units=[];
  if(!linked)return {source,runs,linked,units:splitText(source)};
  for(const run of runs){
    run.indices=[];
    if(!/[\p{L}\p{N}]/u.test(run.text))continue;
    run.before=run.text.startsWith(' ')?' ':'';run.after=run.text.endsWith(' ')?' ':'';
    for(const part of splitText(run.text.trim())){run.indices.push(units.length);units.push(part);}
  }
  return {source,runs,linked,units};
}

export function pageContentMatches(content,element,env){
  const current=sourceRuns(element,env);
  return current.length===content.runs.length&&current.every((run,index)=>run.anchor===content.runs[index].anchor&&run.text===content.runs[index].text);
}

function linkAttributes(source,document,env){
  const raw=source.getAttribute('href');if(raw===null)return null;
  let url;try{url=new URL(raw,source.baseURI||document.baseURI||env.location?.href);}catch{return null;}
  if(!safeProtocols.has(url.protocol))return null;
  const attributes={href:url.href};
  for(const name of PAGE_LINK_ATTRIBUTES)if(name!=='href')attributes[name]=source.getAttribute(name);
  if(attributes.target&&attributes.target.toLowerCase()!=='_self'){
    const rel=new Set((attributes.rel||'').split(/\s+/).filter(value=>value&&value.toLowerCase()!=='opener').map(value=>value.toLowerCase()));
    rel.add('noopener');attributes.rel=[...rel].join(' ');
  }
  return attributes;
}

/** Update native navigation only from the live source. Provider output never supplies an attribute. */
function syncLink(binding,document,env){
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
  binding.node.style.color='inherit';
  const decoration=attributes?env.getComputedStyle?.(binding.source)?.textDecorationLine||'none':'none';
  binding.node.style.setProperty('text-decoration-line',decoration,'important');
  return !!attributes;
}
function bindActivation(binding){
  const node=binding.node;
  const activate=event=>{
    if(node!==binding.node||node.parentNode!==binding.output||!binding.valid()||!syncLink(binding,binding.document,binding.env))event.preventDefault();
  };
  node.addEventListener('click',activate);node.addEventListener('auxclick',activate);
}

export function renderPageContent(output,content,parts,{document,env,valid}){
  if(!content.linked){output.append(document.createTextNode(parts.join(' ')));return [];}
  const bindings=[];
  for(const run of content.runs){
    const translated=run.indices.length?run.before+run.indices.map(index=>parts[index]).join(' ')+run.after:run.text;
    const text=document.createTextNode(translated);
    if(!run.anchor){output.append(text);continue;}
    const node=document.createElement('span');node.append(text);output.append(node);
    const binding={source:run.anchor,node,output,valid,document,env};syncLink(binding,document,env);bindings.push(binding);
  }
  return bindings;
}
export function refreshPageLinks(bindings,document,env){for(const binding of bindings||[])syncLink(binding,document,env);}

export function isPageLinkMutation(record){
  return record.type==='attributes'&&PAGE_LINK_ATTRIBUTES.includes(record.attributeName)&&['A','BASE'].includes(record.target?.tagName);
}
