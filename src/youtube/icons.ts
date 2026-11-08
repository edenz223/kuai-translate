/** Player toolbar icons, drawn locally to sit with YouTube's own white controls. */
export type ToolbarIcon='translate'|'list'|'previous'|'replay'|'next'|'kuai';
type Shape=[tag:'path'|'rect'|'text',attributes:Record<string,string>,text?:string];
const SVG='http://www.w3.org/2000/svg';
const line={fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'};
const chevron={...line,'stroke-width':'2.4'};
const icons:Record<ToolbarIcon,{viewBox:string;size:number;shapes:Shape[]}>={
  // A caption box with 译, read as "translated captions" next to YouTube's CC button.
  translate:{viewBox:'0 0 24 24',size:24,shapes:[
    ['rect',{x:'2.5',y:'4.5',width:'19',height:'15',rx:'3',...line}],
    ['text',{x:'12',y:'16.2','text-anchor':'middle','font-size':'10.5','font-weight':'700','font-family':'system-ui,"Microsoft YaHei","PingFang SC",sans-serif',fill:'currentColor'},'译'],
  ]},
  list:{viewBox:'0 0 24 24',size:24,shapes:[['path',{d:'M4 7h1.5M9 7h11M4 12h1.5M9 12h11M4 17h1.5M9 17h11',...line}]]},
  previous:{viewBox:'0 0 24 24',size:24,shapes:[['path',{d:'M14.5 6l-6 6 6 6',...chevron}]]},
  replay:{viewBox:'0 0 24 24',size:24,shapes:[['path',{d:'M4.8 12a7.2 7.2 0 1 0 2.1-5.1M4.8 4.6v4.3h4.3',...line}]]},
  next:{viewBox:'0 0 24 24',size:24,shapes:[['path',{d:'M9.5 6l6 6-6 6',...chevron}]]},
  // The extension's own logo (public/icons/kuai.svg) marks its settings.
  kuai:{viewBox:'0 0 128 128',size:22,shapes:[
    ['rect',{x:'4',y:'4',width:'120',height:'120',rx:'29',fill:'#3340a6'}],
    ['path',{d:'M34 29H49V57L74 29H94L65 62L95 99H75L49 68V99H34Z',fill:'#ffffff'}],
    ['path',{d:'M88 82H112V101H102L96 108V101H88Z',fill:'#7de3e0'}],
  ]},
};

export function createToolbarIcon(doc:Document,name:ToolbarIcon):SVGSVGElement {
  const {viewBox,size,shapes}=icons[name],svg=doc.createElementNS(SVG,'svg');
  for(const [key,value]of Object.entries({viewBox,width:String(size),height:String(size),'aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
  svg.setAttribute('data-icon',name);
  // Player CSS may size every svg in its buttons; keep the intended icon size.
  for(const [key,value]of [['display','block'],['width',size+'px'],['height',size+'px'],['flex','none'],['pointer-events','none']])svg.style.setProperty(key,value,'important');
  for(const [tag,attributes,text]of shapes){
    const shape=doc.createElementNS(SVG,tag);
    for(const [key,value]of Object.entries(attributes))shape.setAttribute(key,value);
    if(text)shape.textContent=text;
    svg.append(shape);
  }
  return svg;
}

/** The red underline YouTube shows under an active CC button. */
export function createActiveMark(doc:Document):HTMLSpanElement {
  const mark=doc.createElement('span');mark.dataset.kuaiActiveMark='true';
  mark.style.cssText='position:absolute;left:50%;top:calc(50% + 14px);width:20px;height:3px;margin-left:-10px;border-radius:2px;background:#f00;pointer-events:none;display:none;';
  return mark;
}
export function setActiveMark(mark:HTMLElement,active:boolean) {
  const display=active?'block':'none';
  if(mark.style.display!==display)mark.style.display=display;
}
