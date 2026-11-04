import {BLOCK_SELECTOR,isReadable} from './dom.js';

/** Hide only the source belonging to this block, after a successful result. */
export function hideOriginal(entry,document,env) {
  if(entry.originals.length)return;
  function wrap(node) {
    const host=document.createElement('span');host.setAttribute('data-kuai-original','');
    host.hidden=true;host.style.setProperty('display','none','important');
    node.parentNode.insertBefore(host,node);host.append(node);entry.originals.push(host);
  }
  function visit(parent) {
    for(const node of [...parent.childNodes]) {
      if(node.nodeType===3){if(node.nodeValue)wrap(node);continue;}
      if(node.nodeType!==1||node.matches(BLOCK_SELECTOR)||!isReadable(node,env))continue;
      if(node.querySelector(BLOCK_SELECTOR))visit(node);
      else if(node.textContent||node.tagName==='BR')wrap(node);
    }
  }
  visit(entry.element);
}

/** Unwrap in place; preserve original nodes, handlers and later site edits. */
export function restoreOriginal(entry) {
  for(const host of entry.originals) {
    const parent=host.parentNode;if(!parent)continue;
    for(const node of [...host.childNodes])parent.insertBefore(node,host);
    host.remove();
  }
  entry.originals=[];
}
