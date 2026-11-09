import type {BrowserEnvironment} from './dom.js';

interface OriginalEntry {element: HTMLElement; originals: HTMLElement[];output?:HTMLElement|null}

import {blocksWithin,isBlock,isPageReadable as isReadable} from './dom.js';

/** Hide only the source belonging to this block, after a successful result. */
export function hideOriginal(entry: OriginalEntry,document: Document,env: BrowserEnvironment): void {
  if(entry.originals.length)return;
  function wrap(node: Node): void {
    const host=document.createElement('span');host.setAttribute('data-kuai-original','');
    host.hidden=true;host.style.setProperty('display','none','important');
    node.parentNode!.insertBefore(host,node);host.append(node);entry.originals.push(host);
  }
  function visit(parent: Node): void {
    for(const node of [...parent.childNodes]) {
      if(node.nodeType===3){if(node.nodeValue)wrap(node);continue;}
      if(node.nodeType!==1||isBlock(node as HTMLElement,env)||!isReadable(node as HTMLElement,env))continue;
      if(entry.output&&node.contains(entry.output)||blocksWithin(node as HTMLElement,env).length)visit(node);
      else if(node.textContent||(node as HTMLElement).tagName==='BR')wrap(node);
    }
  }
  visit(entry.element);
}

/** Unwrap in place; preserve original nodes, handlers and later site edits. */
export function restoreOriginal(entry: OriginalEntry): void {
  for(const host of entry.originals) {
    const parent=host.parentNode;if(!parent)continue;
    for(const node of [...host.childNodes])parent.insertBefore(node,host);
    host.remove();
  }
  entry.originals=[];
}
