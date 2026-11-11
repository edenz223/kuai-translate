import {KUAI_ICON} from '../shared/kuai-icon.js';

/** Local icons; no remote assets or page HTML are used. */
export function appendIcon(document: Document,parent: ParentNode,name: string): SVGSVGElement{
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  if(name==='kuai'){
    const {viewBox,size,shapes}=KUAI_ICON;
    for(const [key,value]of Object.entries({viewBox,width:String(size),height:String(size),'aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
    for(const [tag,attributes]of shapes){const shape=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attributes))shape.setAttribute(key,value);svg.append(shape);}
    parent.append(svg);return svg;
  }
  for(const [key,value]of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',name==='check'?'M5 12l4 4L19 6':name==='pin'?'M16 3l5 5-4 1-3 5v4l-3-3-6 6 6-6-3-3h4l5-3z':'M3 5h12M9 3v2M5 5c0 5 3 8 7 10M13 5c0 5-4 10-10 12M13 21l4-10 4 10M14.5 17h5');
  svg.append(path);parent.append(svg);return svg;
}
