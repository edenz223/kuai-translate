import type {BrowserEnvironment} from './dom.js';

// The active editor may be a native control or a contenteditable element. Kind checks guard control-only members.
export type EditorElement = HTMLElement & Pick<HTMLInputElement,'disabled'|'readOnly'|'type'|'value'|'selectionStart'|'selectionEnd'|'setSelectionRange'|'autocomplete'>;
export type SelectionIdentity = [] | [Node,number,Node,number];
export type SelectionRoot = ShadowRoot & {getSelection?:()=>Selection|null};
export interface InputSnapshot {element:EditorElement;kind:'control'|'rich';revision:number;safe:boolean;dirty:boolean;contentDirty?:boolean;type:string;editable:string|null;observer?:MutationObserver;value:string;start:number;end:number;selectionStart:number|null;selectionEnd:number|null;text:string;selection?:Selection|null;identity:SelectionIdentity;html:string;node:Text|null;nodeValue:string|null}

import {ancestors,isOwnedUI} from './dom.js';

const identity=(selection: Selection | null | undefined): SelectionIdentity=>{
  try{if(selection?.rangeCount){const range=selection.getRangeAt(0);return [range.startContainer,range.startOffset,range.endContainer,range.endOffset];}}catch{}
  return [];
};
const same=(left: SelectionIdentity,right: SelectionIdentity): boolean=>left.length===right.length&&left.every((value,index)=>value===right[index]);

/** Own only the latest edit, never the editor's undo stack or its internal model. */
export function createInputEditor({document,env=globalThis,onChange=()=>{}}: {document:Document;env?:BrowserEnvironment;onChange?:()=>void}){
  const listeners: (()=>void)[]=[],snapshots=new Set<InputSnapshot>(),ownEvents=new WeakSet<Event>();
  let revision=0,composing=false,undo: {before:InputSnapshot;guard:InputSnapshot}|null=null,started=false;
  function activeElement(): EditorElement | null{let element=document.activeElement;while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;return element as EditorElement | null;}
  function eligible(element: EditorElement | null=activeElement()): 'control'|'rich'|false{
    if(!element?.isConnected||isOwnedUI(element)||element.disabled||element.readOnly)return false;
    if(ancestors(element).some(node=>node.getAttribute?.('aria-disabled')==='true'||node.getAttribute?.('aria-readonly')==='true'||node.tagName==='FIELDSET'&&(node as HTMLFieldSetElement).disabled))return false;
    const autocomplete=String(element.getAttribute?.('autocomplete')||element.autocomplete||'').toLowerCase().split(/\s+/);
    if(autocomplete.some(value=>['current-password','new-password','one-time-code'].includes(value)||value.startsWith('cc-')))return false;
    if(element.tagName==='TEXTAREA')return 'control';
    if(element.tagName==='INPUT')return ['text','search'].includes(element.type||'text')?'control':false;
    if(element.getAttribute?.('contenteditable')==='false')return false;
    return element.isContentEditable||['','true','plaintext-only'].includes(element.getAttribute?.('contenteditable') as string)?'rich':false;
  }
  function selectionOf(element: HTMLElement): Selection | null | undefined{
    const root=element.getRootNode?.() as SelectionRoot | undefined;
    try{const local=root?.host&&root.getSelection?.();if(local?.rangeCount)return local;}catch{}
    return env.getSelection?.()||document.getSelection?.();
  }
  function release(snapshot: InputSnapshot | null | undefined): void{snapshot?.observer?.disconnect();snapshots.delete(snapshot!);}
  function clearUndo(){if(undo)release(undo.guard);undo=null;}
  function invalidate(){revision++;clearUndo();onChange();}
  function trackMutations(snapshot: InputSnapshot,records: MutationRecord[]): void{
    if(!records.length)return;
    snapshot.dirty=true;
    if(records.some(record=>record.type!=='attributes'||record.target!==snapshot.element))snapshot.contentDirty=true;
  }
  function capture(): InputSnapshot | null{
    const element=activeElement()!,kind=eligible(element);if(!kind||composing)return null;
    const snapshot={element,kind,revision,safe:true,dirty:false,type:element.type,editable:element.getAttribute?.('contenteditable')} as InputSnapshot;
    if(kind==='control'){
      const value=String(element.value??''),start=element.selectionStart,end=element.selectionEnd;
      const selected=Number.isInteger(start)&&Number.isInteger(end)&&end!>start!;
      Object.assign(snapshot,{value,start:selected?start:0,end:selected?end:value.length,selectionStart:start,selectionEnd:end,text:selected?value.slice(start!,end!):value});
    }else{
      const selection=selectionOf(element),points=identity(selection);
      const inside=points.length&&element.contains(points[0])&&element.contains(points[2]);
      let range: Range | null | undefined;
      try{range=inside&&!selection!.isCollapsed?selection!.getRangeAt(0).cloneRange():null;}catch{}
      const node=range&&range.startContainer===range.endContainer&&range.startContainer.nodeType===3?range.startContainer:
        !range&&element.childNodes.length===1&&element.firstChild!.nodeType===3?element.firstChild:null;
      const locked=node&&ancestors(node).some(ancestor=>ancestor!==element&&ancestor.getAttribute?.('contenteditable')==='false');
      const start=range?.startOffset??0,end=range?.endOffset??node?.nodeValue?.length??0;
      Object.assign(snapshot,{selection,identity:points,html:element.innerHTML,value:element.textContent,text:range?range.toString():element.textContent,
        node,nodeValue:node?.nodeValue,start,end,safe:!!node&&!locked&&(!points.length||!!inside)});
    }
    if(env.MutationObserver){
      snapshot.observer=new env.MutationObserver(records=>trackMutations(snapshot,records));
      snapshot.observer.observe(element,{attributes:true,childList:true,characterData:true,subtree:true});
    }
    snapshots.add(snapshot);return snapshot;
  }
  function valid(snapshot: InputSnapshot | null | undefined,{restoring=false}: {restoring?:boolean}={}): boolean{
    if(!snapshot)return false;
    trackMutations(snapshot,snapshot.observer?.takeRecords?.()||[]);
    if(snapshot.dirty&&!restoring||restoring&&snapshot.kind==='rich'&&snapshot.contentDirty||snapshot.revision!==revision||composing)return false;
    const {element,kind}=snapshot;
    if(activeElement()!==element||eligible(element)!==kind||element.type!==snapshot.type||element.getAttribute?.('contenteditable')!==snapshot.editable)return false;
    return kind==='control'
      ?element.value===snapshot.value&&(restoring||element.selectionStart===snapshot.selectionStart&&element.selectionEnd===snapshot.selectionEnd)
      :element.textContent===snapshot.value&&element.innerHTML===snapshot.html&&(restoring||same(identity(selectionOf(element)),snapshot.identity))&&(!snapshot.node||snapshot.node!.isConnected&&snapshot.node!.nodeValue===snapshot.nodeValue);
  }
  function event(element: EditorElement,type: string,data: string,inputType='insertReplacementText'){
    const EventClass=env.InputEvent||env.Event;
    const value=new EventClass(type,{bubbles:true,cancelable:type==='beforeinput',composed:true,inputType,data});
    ownEvents.add(value);return element.dispatchEvent(value);
  }
  function setValue(element: EditorElement,value: string): void{
    let setter;for(let prototype=Object.getPrototypeOf(element);prototype&&!setter;prototype=Object.getPrototypeOf(prototype))setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
    if(setter)setter.call(element,value);else element.value=value;
  }
  function setRichSelection(snapshot: InputSnapshot,start: number,end=start): void{
    const range=document.createRange();range.setStart(snapshot.node!,start);range.setEnd(snapshot.node!,end);
    const selection=selectionOf(snapshot.element)||snapshot.selection;selection?.removeAllRanges();selection?.addRange(range);
  }
  function apply(snapshot: InputSnapshot | null | undefined,text: string): boolean{
    if(!snapshot?.safe||!valid(snapshot)||!event(snapshot.element,'beforeinput',text)||!valid(snapshot))return false;
    const {element}=snapshot,epoch=revision;
    const value=(snapshot.kind==='control'?snapshot.value:snapshot.nodeValue!).slice(0,snapshot.start)+text+(snapshot.kind==='control'?snapshot.value:snapshot.nodeValue!).slice(snapshot.end);
    clearUndo();release(snapshot);
    if(snapshot.kind==='control'){setValue(element,value);element.setSelectionRange?.(snapshot.start+text.length,snapshot.start+text.length);}
    else{snapshot.node!.nodeValue=value;setRichSelection(snapshot,snapshot.start+text.length);}
    event(element,'input',text);
    const unchanged=revision===epoch&&activeElement()===element&&eligible(element)===snapshot.kind&&
      (snapshot.kind==='control'?element.value===value:snapshot.node!.isConnected&&snapshot.node!.nodeValue===value);
    if(unchanged){const guard=capture();if(guard)undo={before:snapshot,guard};}
    onChange();return true;
  }
  // Applying a pending translation must match the captured selection. Restoring
  // an unchanged result may tolerate caret movement and harmless attributes,
  // but keeps content, focus, revision, editor and original-node checks.
  function canRestore(){return !!undo&&valid(undo.guard,{restoring:true})&&(undo.before.kind==='control'||undo.before.node?.isConnected&&undo.before.element.contains(undo.before.node));}
  function restore(){
    if(!canRestore()){clearUndo();return false;}
    const {before}=undo!,{element}=before;
    if(!event(element,'beforeinput',before.text,'historyUndo')||!canRestore())return false;
    clearUndo();
    if(before.kind==='control'){setValue(element,before.value);element.setSelectionRange?.(before.selectionStart,before.selectionEnd);}
    else{
      before.node!.nodeValue=before.nodeValue!;
      const selection=selectionOf(element),points=before.identity;
      if(points.length){const range=document.createRange();range.setStart(points[0],points[1]);range.setEnd(points[2],points[3]);selection?.removeAllRanges();selection?.addRange(range);}
    }
    event(element,'input',before.text,'historyUndo');onChange();return true;
  }
  function listen<K extends keyof (DocumentEventMap & WindowEventMap)>(target: EventTarget,type: K,handler: (event:(DocumentEventMap & WindowEventMap)[K])=>void): void{target.addEventListener(type,handler as EventListener,true);listeners.push(()=>target.removeEventListener(type,handler as EventListener,true));}
  function start(){
    if(started)return;started=true;
    listen(document,'input',event=>{if(!ownEvents.has(event))invalidate();});
    listen(document,'compositionstart',()=>{composing=true;invalidate();});
    listen(document,'compositionend',()=>{composing=false;invalidate();});
    listen(document,'focusout',invalidate);
    listen(env,'blur',()=>{composing=false;invalidate();});
  }
  function stop(){listeners.splice(0).forEach(off=>off());for(const snapshot of [...snapshots])release(snapshot);undo=null;revision++;composing=false;started=false;}
  return {start,stop,capture,release,valid,apply,restore,canRestore,invalidate,eligible,activeElement,isComposing:()=>composing};
}
