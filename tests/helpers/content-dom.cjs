/* Controlled DOM and event boundaries; not a browser/layout implementation. */
class Target {
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn,options=false){const capture=options===true||!!options.capture,entries=this.listeners.get(type)||[];if(!entries.some(entry=>entry.fn===fn&&entry.capture===capture))entries.push({fn,capture,once:!!options.once});this.listeners.set(type,entries);}
  removeEventListener(type,fn,options=false){const capture=options===true||!!options.capture;this.listeners.set(type,(this.listeners.get(type)||[]).filter(entry=>entry.fn!==fn||entry.capture!==capture));}
  dispatchEvent(event){
    event.target ||= this;const path=event.composedPath?.()||[this];
    const invoke=(node,capture)=>{event.currentTarget=node;for(const entry of [...(node.listeners?.get(event.type)||[])])if(entry.capture===capture){entry.fn.call(node,event);if(entry.once)node.removeEventListener(event.type,entry.fn,capture);if(event.immediateStopped)break;}};
    for(const node of [...path].reverse()){invoke(node,true);if(event.propagationStopped)return !event.defaultPrevented;}
    for(const node of path){invoke(node,false);if(event.propagationStopped||!event.bubbles)break;}return !event.defaultPrevented;
  }
}
class Node extends Target {
  constructor(type,doc){super();this.nodeType=type;this.ownerDocument=doc;this.parentNode=null;this.childNodes=[];}
  appendChild(node){node.remove();node.parentNode=this;this.childNodes.push(node);return node;}
  insertBefore(node,reference){if(reference==null)return this.appendChild(node);if(node===reference)return node;if(reference.parentNode!==this)throw Error('Reference is not a child');node.remove();node.parentNode=this;this.childNodes.splice(this.childNodes.indexOf(reference),0,node);return node;}
  append(...nodes){for(const node of nodes)this.appendChild(typeof node==='string'?this.ownerDocument.createTextNode(node):node);}
  removeChild(node){if(node.parentNode!==this)throw Error('Node is not a child');this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;return node;}
  replaceChildren(...nodes){for(const node of [...this.childNodes])node.remove();this.append(...nodes);}
  remove(){this.parentNode?.removeChild(this);}
  get children(){return this.childNodes.filter(node=>node.nodeType===1);}
  get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
  get firstChild(){return this.childNodes[0]||null;}
  get textContent(){return this.nodeType===3?this.nodeValue:this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value){if(this.nodeType===3){this.nodeValue=String(value);return;}this.replaceChildren();if(value)this.append(String(value));}
  get isConnected(){return this.nodeType===9||!!this.parentNode?.isConnected||!!this.host?.isConnected;}
  contains(node){return node===this||this.childNodes.some(child=>child.contains(node));}
  getRootNode(){let node=this;while(node.parentNode)node=node.parentNode;return node;}
  querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children){if(child.matches(selector))found.push(child);visit(child);}};visit(this);return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
class Element extends Node {
  constructor(tag,doc){super(1,doc);this.tagName=tag.toUpperCase();this.attrs=new Map();const priorities=new Map();this.style={setProperty(name,value,priority=''){this[name]=value;priorities.set(name,priority);},getPropertyValue(name){return typeof this[name]==='string'?this[name]:'';},getPropertyPriority(name){return priorities.get(name)||'';},removeProperty(name){const value=this.getPropertyValue(name);delete this[name];priorities.delete(name);return value;}};this.hidden=false;this.disabled=false;this.value='';this.selectionStart=0;this.selectionEnd=0;this.type='text';this.isContentEditable=false;this.dataset=new Proxy({},{get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))??undefined,set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true;}});}
  get id(){return this.getAttribute('id')||'';}set id(value){this.setAttribute('id',value);}
  get className(){return this.getAttribute('class')||'';}set className(value){this.setAttribute('class',value);}
  setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)??null;}hasAttribute(name){return this.attrs.has(name);}removeAttribute(name){this.attrs.delete(name);}
  matches(selector){return selector.split(',').some(part=>{part=part.trim();const tag=part.match(/^[a-z][\w-]*/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const match of part.matchAll(/#([\w-]+)/g))if(this.id!==match[1])return false;for(const match of part.matchAll(/\.([\w-]+)/g))if(!this.className.split(/\s+/).includes(match[1]))return false;for(const match of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)){if(!this.hasAttribute(match[1])||(match[2]!==undefined&&this.getAttribute(match[1])!==match[2]))return false;}return true;});}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches?.(selector))return node;return null;}
  attachShadow(){const root=new Node(11,this.ownerDocument);root.host=this;this.shadowRoot=root;return root;}
  getBoundingClientRect(){if(this._rect)return this._rect;if(this.style.position==='fixed'){const left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0,width=parseFloat(this.style.width)||300,height=parseFloat(this.style.height)||30;return {left,top,right:left+width,bottom:top+height,width,height};}return {left:10,top:10,right:310,bottom:40,width:300,height:30};}
  getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  focus(){this.ownerDocument.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  get outerHTML(){return '<'+this.tagName.toLowerCase()+' '+[...this.attrs].map(([name,value])=>name+'="'+value+'"').join(' ')+'>'+this.innerHTML+'</'+this.tagName.toLowerCase()+'>';}
  get innerHTML(){const serialize=node=>node.nodeType===3?node.nodeValue:'<'+node.tagName.toLowerCase()+' '+[...node.attrs].map(([name,value])=>name+'="'+value+'"').join(' ')+'>'+node.childNodes.map(serialize).join('')+'</'+node.tagName.toLowerCase()+'>';return this.childNodes.map(serialize).join('');}
}
class Range {
  constructor(doc){this.doc=doc;this.startContainer=this.endContainer=doc;this.startOffset=this.endOffset=0;}
  setStart(node,offset){this.startContainer=node;this.startOffset=offset;}
  setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}
  setStartAfter(node){this.setStart(node.parentNode,node.parentNode.childNodes.indexOf(node)+1);}
  collapse(toStart){if(toStart){this.endContainer=this.startContainer;this.endOffset=this.startOffset;}else{this.startContainer=this.endContainer;this.startOffset=this.endOffset;}}
  selectNodeContents(node){this.setStart(node,0);this.setEnd(node,node.nodeType===3?node.nodeValue.length:node.childNodes.length);}
  cloneRange(){const range=new Range(this.doc);Object.assign(range,this);return range;}
  getBoundingClientRect(){return (this.startContainer.parentElement||this.startContainer).getBoundingClientRect?.()||{left:0,bottom:0};}
  toString(){if(this.startContainer===this.endContainer){const node=this.startContainer;return node.nodeType===3?node.nodeValue.slice(this.startOffset,this.endOffset):node.childNodes.slice(this.startOffset,this.endOffset).map(child=>child.textContent).join('');}const text=[];let reading=false;const visit=node=>{if(node===this.startContainer){reading=true;text.push(node.nodeValue.slice(this.startOffset));return;}if(node===this.endContainer){text.push(node.nodeValue.slice(0,this.endOffset));reading=false;return;}if(node.nodeType===3&&reading)text.push(node.nodeValue);else node.childNodes.forEach(visit);};visit(this.doc);return text.join('');}
  deleteContents(){if(this.startContainer===this.endContainer){const node=this.startContainer;if(node.nodeType===3)node.nodeValue=node.nodeValue.slice(0,this.startOffset)+node.nodeValue.slice(this.endOffset);else for(const child of node.childNodes.slice(this.startOffset,this.endOffset))child.remove();return;}let reading=false;const visit=node=>{if(node===this.startContainer){node.nodeValue=node.nodeValue.slice(0,this.startOffset);reading=true;return;}if(node===this.endContainer){node.nodeValue=node.nodeValue.slice(this.endOffset);reading=false;return;}if(node.nodeType===3&&reading)node.nodeValue='';else node.childNodes.forEach(visit);};visit(this.doc);}
  insertNode(node){const start=this.startContainer;if(start.nodeType!==3){start.insertBefore(node,start.childNodes[this.startOffset]);return;}const tail=start.nodeValue.slice(this.startOffset),parent=start.parentNode,index=parent.childNodes.indexOf(start);start.nodeValue=start.nodeValue.slice(0,this.startOffset);const next=parent.childNodes[index+1];parent.insertBefore(node,next);if(tail)parent.insertBefore(this.doc.createTextNode(tail),next);}
}
function selectionFor(range){return {_range:range,get rangeCount(){return this._range?1:0;},get isCollapsed(){return !this._range||this._range.startContainer===this._range.endContainer&&this._range.startOffset===this._range.endOffset;},get anchorNode(){return this._range?.startContainer;},get focusNode(){return this._range?.endContainer;},getRangeAt(){return this._range;},toString(){return this._range?.toString()||'';},removeAllRanges(){this._range=null;},addRange(next){this._range=next;}};}
class Event {
 constructor(type,init={}){Object.assign(this,{type,bubbles:true,cancelable:true,defaultPrevented:false,button:0,buttons:0,altKey:false,ctrlKey:false,shiftKey:false,metaKey:false,repeat:false,isComposing:false},init);}
 preventDefault(){if(this.cancelable)this.defaultPrevented=true;}stopPropagation(){this.propagationStopped=true;}stopImmediatePropagation(){this.immediateStopped=true;this.propagationStopped=true;}
 composedPath(){const list=[];for(let node=this.target;node;node=node.parentNode||node.host||(node.nodeType===9?node.defaultView:null))list.push(node);return list;}
}
function fixture(){
 const doc=new Node(9,null);doc.ownerDocument=doc;doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_namespace,tag)=>new Element(tag,doc);doc.createTextNode=value=>{const node=new Node(3,doc);node.nodeValue=String(value);return node;};doc.createRange=()=>new Range(doc);doc.documentElement=doc.createElement('html');doc.body=doc.createElement('body');doc.append(doc.documentElement);doc.documentElement.append(doc.body);doc.getElementById=id=>doc.querySelector('#'+id);doc.visibilityState='visible';doc.activeElement=doc.body;
 const timers=new Map(),frames=new Map();let timer=0,id=0,now=0;const env=new Target();Object.assign(env,{document:doc,location:{href:'https://example.org/article'},innerWidth:1200,innerHeight:800,Event,InputEvent:Event,Node,HTMLElement:Element,navigator:{language:'zh-CN'},performance:{now:()=>now},getComputedStyle:element=>({...element.style,display:element.hidden?'none':element.style.display||(element.tagName==='BUTTON'?'inline-block':/^(HTML|BODY|P|DIV|LI|UL|OL|TD|TH|H[1-6]|BLOCKQUOTE|FIGCAPTION|DT|DD|ARTICLE|SECTION|FOOTER|HEADER|NAV|PRE|CODE|TEXTAREA|INPUT|SELECT|OPTION)$/.test(element.tagName)?'block':'inline'),visibility:element.style.visibility||'visible'}),getSelection:()=>doc.selection,requestAnimationFrame:fn=>{frames.set(++timer,{fn,at:now+16});return timer;},cancelAnimationFrame:key=>frames.delete(key),setTimeout:(fn,delay=0)=>{timers.set(++timer,{fn,at:now+delay});return timer;},clearTimeout:key=>timers.delete(key),console});doc.defaultView=env;doc.getSelection=()=>doc.selection;
 const paragraph=(text,tag='p')=>{const node=doc.createElement(tag);node.textContent=text;doc.body.append(node);return node;};
 const settings={activeProviderId:'microsoft',sourceLanguage:'auto',targetLanguage:'zh-Hans',selectionEnabled:true,hoverEnabled:false};
 const requests=[],cancellations=[];let responder=texts=>Promise.resolve({translations:texts.map(text=>'译：'+text)});
 const dependencies={document:doc,env,getSettings:()=>settings,translate:(texts,options)=>{requests.push({texts,options});return responder(texts,options);},cancel:requestId=>{cancellations.push(requestId);return Promise.resolve();},makeRequestId:()=>`request-${++id}`};
 function select(node,text=node.textContent,{start=0,end=start+text.length}={}){const range=new Range(doc);range.setStart(node.firstChild||node,start);range.setEnd(node.firstChild||node,end);doc.selection=selectionFor(range);doc.selection.toString=()=>text;}
 function setRange(start,startOffset,end=start,endOffset=startOffset){const range=new Range(doc);range.setStart(start,startOffset);range.setEnd(end,endOffset);doc.selection=selectionFor(range);return doc.selection;}
 function emit(target,type,init={}){const event=new Event(type,{target,...init});target.dispatchEvent(event);return event;}
 function advance(ms){const until=now+ms;for(;;){const next=[...timers,...frames].filter(([,value])=>value.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);frames.delete(next[0]);now=next[1].at;next[1].fn(now);}now=until;}
 return {doc,env,settings,dependencies,requests,cancellations,paragraph,select,setRange,emit,respond:fn=>{responder=fn;},flushTimers:()=>{const pending=[...timers.values()];timers.clear();for(const value of pending){now=Math.max(now,value.at);value.fn();}},advance,frameCount:()=>frames.size,timerCount:()=>timers.size};
}
module.exports={fixture,Event};
