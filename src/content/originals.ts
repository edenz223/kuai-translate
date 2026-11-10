import type {BrowserEnvironment} from './dom.js';

interface OriginalEntry {element: HTMLElement; originals: Node[];output?:HTMLElement|null}

import {blocksWithin,isBlock,isPageReadable as isReadable} from './dom.js';
import {hideText,restoreText,sourceText} from './source-text.js';

/** Hide only the source belonging to this block, after a successful result. */
export function hideOriginal(entry: OriginalEntry,_document: Document,env: BrowserEnvironment): void {
  const previous=new Set(entry.originals),originals=new Set<Node>();
  const hasText=(node: Node): boolean=>node.nodeType===3?!!sourceText(node):Array.from(node.childNodes).some(hasText);
  function visit(parent: Node): void {
    for(const node of [...parent.childNodes]) {
      if(node.nodeType===3){if(sourceText(node)){hideText(node as Text);originals.add(node);}continue;}
      if(node.nodeType!==1||isBlock(node as HTMLElement,env)||!isReadable(node as HTMLElement,env,{allowOriginal:true}))continue;
      if(entry.output&&node.contains(entry.output)||blocksWithin(node as HTMLElement,env).length)visit(node);
      else if(hasText(node)||(node as HTMLElement).tagName==='BR'){
        const element=node as HTMLElement;
        if(previous.has(node)||!element.hasAttribute('data-kuai-original')){
          if(!element.hasAttribute('data-kuai-original'))element.setAttribute('data-kuai-original','');
          originals.add(node);
        }
      }
    }
  }
  visit(entry.element);
  for(const node of previous)if(!originals.has(node))restoreNode(node);
  entry.originals=[...originals];
}
function restoreNode(node: Node): void {
  if(node.nodeType===3)restoreText(node as Text);
  else (node as HTMLElement).removeAttribute('data-kuai-original');
}
/** Never change a site's node identity, parent, or newer text. */
export function restoreOriginal(entry: OriginalEntry): void {
  for(const node of entry.originals)restoreNode(node);
  entry.originals=[];
}
