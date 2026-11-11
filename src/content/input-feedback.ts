import type {Settings} from '../shared/settings.js';
import type {Translate} from '../shared/messages.js';
import type {InteractionOptions} from '../shared/interactions.js';
import type {BrowserEnvironment,CodedError} from './dom.js';
import type {createInputEditor,EditorElement,InputSnapshot} from './input-editor.js';

interface InputContext {url:string;key:string}
export interface InputFeedbackOptions {document:Document;env:BrowserEnvironment;editor:ReturnType<typeof createInputEditor>;translate:Translate;cancel:(id:string)=>unknown;getSettings:()=>Settings;options:()=>InteractionOptions['inputOptions'];allowed:()=>boolean;key:()=>string;labels:()=>Record<string,string>;onState:()=>void;makeRequestId?:()=>string}

import {appendIcon} from './icons.js';
import {ancestors,batches,makeId,requestOptions,splitText,translationsOf} from './dom.js';
import {resolveFeatureSettings} from '../shared/interactions.js';

const spring='cubic-bezier(.34,1.56,.64,1)';
const MIN_LOADING_MS=400;
/** The entry reflects the request state even while collapsed; motion is dropped for reduced-motion users. */
const TRIGGER_STYLE=[
  ':host{all:initial;--accent:#087e8b;--accent-2:#14b8a6;--ok:#16a34a;--bad:#dc2626}*{box-sizing:border-box}[hidden]{display:none!important}',
  'button{font:12px/1.4 system-ui,sans-serif;cursor:pointer;border:1px solid #5888c0;border-radius:5px;background:#fff;color:#173f71;padding:2px 5px;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button:disabled{opacity:.5}',
  '.trigger{position:relative;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--accent);display:grid;place-items:center}',
  `.trigger.entering{animation:kuai-appear .32s ${spring} both}`,
  `.trigger::before{content:"";position:absolute;inset:1px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 8%,transparent);opacity:0;transform:scale(.4);transition:opacity .2s,transform .28s ${spring},border-color .2s,background .2s}`,
  `.trigger:not(.icon)::after{content:"";width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,var(--accent-2),var(--accent));box-shadow:0 0 0 2px #fff,0 1px 4px color-mix(in srgb,var(--accent) 45%,transparent);transition:transform .28s ${spring},background .25s,box-shadow .25s}`,
  '.trigger:hover::before,.trigger:focus-visible::before,.trigger[aria-expanded=true]::before{opacity:1;transform:scale(1)}',
  '.trigger:not(.icon):hover::after{transform:scale(1.2)}.trigger[aria-expanded=true]:not(.icon)::after{transform:scale(.75)}.trigger:active::after{transform:scale(.6)}',
  '.trigger[data-state=loading]::before{opacity:1;transform:scale(1);border-color:color-mix(in srgb,var(--accent) 18%,transparent);background:transparent}',
  '.spinner{position:absolute;inset:1px;border-radius:50%;border:1.5px solid transparent;border-top-color:var(--accent);pointer-events:none;opacity:0;animation:kuai-spin .8s linear infinite;transition:opacity .2s}.trigger[data-state=loading]>.spinner{opacity:1}',
  '.trigger[data-state=loading]:not(.icon)::after{animation:kuai-breathe 1.1s ease-in-out infinite}.trigger.none[data-state=loading]::after{display:none}',
  '[data-trigger-label]{display:none}.trigger.none[data-state=loading]>[data-trigger-label]{display:block}',
  '.trigger[data-state=translated]::before{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,transparent);animation:kuai-ring-done .6s ease-out}.trigger[data-state=error]::before{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,transparent);animation:kuai-ring-done .6s ease-out}',
  `.trigger[data-state=translated]:not(.icon)::after{background:var(--ok);box-shadow:0 0 0 2px #fff,0 1px 4px color-mix(in srgb,var(--ok) 50%,transparent);animation:kuai-pop .4s ${spring}}`,
  '.trigger[data-state=error]:not(.icon)::after{background:var(--bad);box-shadow:0 0 0 2px #fff,0 1px 4px color-mix(in srgb,var(--bad) 50%,transparent)}.trigger[data-state=error]{animation:kuai-shake .4s ease-in-out}',
  // The icon's ring follows its rounded-square outline; the loading arc travels along that same outline.
  '.trigger.icon{width:22px;height:22px;border-radius:6px;overflow:visible}.trigger.icon::before,.trigger.icon>.spinner{inset:-4px;border-radius:10px}.trigger.icon::before{background:transparent}',
  '.trigger.icon>.spinner{padding:1.5px;border:0;overflow:hidden;animation:none;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}.trigger.icon>.spinner::before{content:"";position:absolute;inset:-50%;background:conic-gradient(transparent 0 65%,var(--accent));animation:kuai-spin .8s linear infinite}',
  `.trigger.icon>svg{display:block;width:100%;height:100%;pointer-events:none;transition:transform .28s ${spring}}.trigger.icon:hover>svg,.trigger.icon[aria-expanded=true]>svg{transform:scale(1.05)}.trigger.icon:active>svg{transform:scale(.95)}`,
  '.trigger.icon[data-state=translated]::before,.trigger.icon[data-state=error]::before{opacity:1;transform:scale(1)}',
  `.translate-action{--from:6px;position:absolute;right:calc(100% + 5px);bottom:-6px;display:grid;place-items:center;width:30px;height:30px;padding:0;background:rgb(255 255 255/.92);color:#475569;border:1px solid rgb(15 23 42/.08);border-radius:10px;box-shadow:0 1px 2px rgb(15 23 42/.06),0 6px 18px rgb(15 23 42/.14);backdrop-filter:blur(8px);transform-origin:var(--origin,right center);transition:opacity .18s,transform .3s ${spring},border-radius .3s ${spring},color .2s,background .2s,border-color .2s,box-shadow .2s,display .3s allow-discrete,overlay .3s allow-discrete}`,
  '.translate-action[data-side=right]{--from:-6px;--origin:left center}',
  '@starting-style{.translate-action{opacity:0;transform:translateX(var(--from)) scale(.6)}}',
  '.translate-action:hover{color:var(--accent);transform:translateY(-1px);box-shadow:0 2px 4px rgb(15 23 42/.08),0 10px 24px rgb(15 23 42/.16)}.translate-action:active{transform:scale(.92);transition-duration:.08s}',
  '.translate-action[data-state=loading]{color:var(--accent);border-radius:50%}.translate-action[data-state=loading]>svg:first-child{animation:kuai-breathe 1.1s ease-in-out infinite}',
  '.translate-action[data-state=loading]::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-right-color:color-mix(in srgb,var(--accent) 35%,transparent);animation:kuai-spin .9s linear infinite}',
  '.translate-action[data-state=translated]{color:var(--ok);border-color:#bbf7d0;background:rgb(240 253 244/.95)}',
  `.completion-check{position:absolute;right:-5px;top:-5px;width:14px;height:14px;padding:2px;border-radius:50%;background:var(--ok);color:#fff;stroke-width:3;box-shadow:0 0 0 2px #fff;animation:kuai-pop .4s ${spring}}`,
  '.translate-action[data-state=error]{color:var(--bad);border-color:#fecaca;animation:kuai-shake .4s ease-in-out}',
  '.feedback{position:absolute;right:0;bottom:100%;display:flex;gap:4px;align-items:center;padding:4px;background:#fff;color:#172033;border:1px solid #d5dce6;border-radius:8px;box-shadow:0 6px 18px rgb(15 23 42/.14);width:max-content;max-width:min(300px,calc(100vw - 16px));flex-wrap:wrap;font:12px/1.4 system-ui,sans-serif;animation:kuai-appear .22s ease-out both}',
  '.status{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '@keyframes kuai-spin{to{transform:rotate(360deg)}}',
  '@keyframes kuai-appear{from{opacity:0;transform:scale(.4)}}',
  '@keyframes kuai-pop{0%{transform:scale(.3)}60%{transform:scale(1.35)}100%{transform:scale(1)}}',
  '@keyframes kuai-ring-done{from{transform:scale(1);opacity:1}to{transform:scale(1.35);opacity:0}}',
  '@keyframes kuai-breathe{50%{transform:scale(.55);opacity:.6}}',
  '@keyframes kuai-shake{25%{transform:translateX(-2px)}50%{transform:translateX(2px)}75%{transform:translateX(-1px)}}',
  '@media(prefers-reduced-motion:reduce){*,::before,::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}.trigger[data-state=loading]::before{border-color:var(--accent)}.trigger[data-state=loading]>.spinner{opacity:0}}',
].join('');

/** Input requests and feedback deliberately have no selection-card ownership. */
export function createInputFeedback({document,env,editor,translate,cancel,getSettings,options,allowed,key,labels,onState,makeRequestId=makeId}: InputFeedbackOptions){
  let generation=0,context: (InputContext & {element:EditorElement})|null=null,snapshot: InputSnapshot|null=null,pendingApply: (InputContext & {snapshot:InputSnapshot;text:string})|null=null,restoreContext: InputContext|null=null,trigger: HTMLDivElement|null=null,preview: HTMLDivElement|null=null,enabled=false,renderedElement: EditorElement|null=null,renderedConfig='',uiInteraction=false;
  let expanded=false;
  let frame: number|null=null,frameTimer=false,dirty=false,watchUntil=0,tracking=0,lastRect='',observer: ResizeObserver|null=null,observed: HTMLElement[]=[];
  const trackingListeners: (()=>void)[]=[],now=()=>env.performance?.now?.()??Date.now();
  const rectKey=(rect: DOMRect)=>[rect.left,rect.top,rect.right,rect.bottom].join(',');
  function viewport(){const view=env.visualViewport;return {left:view?.offsetLeft||0,top:view?.offsetTop||0,right:(view?.offsetLeft||0)+(view?.width||env.innerWidth||1200),bottom:(view?.offsetTop||0)+(view?.height||env.innerHeight||800)};}
  function visibleRect(element: HTMLElement,rect: DOMRect){
    const view=viewport(),visible={left:Math.max(view.left,rect.left),top:Math.max(view.top,rect.top),right:Math.min(view.right,rect.right),bottom:Math.min(view.bottom,rect.bottom)},containers: HTMLElement[]=[];
    const root=env.getComputedStyle?.(document.documentElement),propagated=(root?.overflowX||root?.overflow||'visible')==='visible'&&(root?.overflowY||root?.overflow||'visible')==='visible';
    let position=env.getComputedStyle?.(element)?.position||'static';
    for(const parent of ancestors(element).slice(1)){
      const style=env.getComputedStyle?.(parent);if(style?.display==='contents')continue;
      const block=!!style&&([style.transform,style.perspective,style.filter,style.backdropFilter].some(value=>value&&value!=='none')||/\b(paint|layout|strict|content)\b/.test(style.contain)||/\b(transform|perspective|filter)\b/.test(style.willChange));
      if((position==='fixed'||position==='absolute')&&!block&&(position==='fixed'||(style?.position||'static')==='static'))continue;
      position=style?.position||'static';
      if(parent===document.documentElement||parent===document.body&&propagated||style?.display==='inline')continue;
      const clipX=(style?.overflowX||style?.overflow||'visible')!=='visible',clipY=(style?.overflowY||style?.overflow||'visible')!=='visible';
      if(!clipX&&!clipY)continue;containers.push(parent);const bounds=parent.getBoundingClientRect(),scaleX=bounds.width/(parent.offsetWidth||bounds.width)||1,scaleY=bounds.height/(parent.offsetHeight||bounds.height)||1;
      const left=bounds.left+(parent.clientLeft||0)*scaleX,top=bounds.top+(parent.clientTop||0)*scaleY;
      if(clipX){visible.left=Math.max(visible.left,left);visible.right=Math.min(visible.right,left+(parent.clientWidth??bounds.width/scaleX)*scaleX);}
      if(clipY){visible.top=Math.max(visible.top,top);visible.bottom=Math.min(visible.bottom,top+(parent.clientHeight??bounds.height/scaleY)*scaleY);}
    }
    if(observer&&(observed.length!==containers.length+1||observed.some((node,index)=>node!==[element,...containers][index]))){observer.disconnect();observed=[element,...containers];for(const node of observed)observer.observe(node);}
    return visible;
  }
  function queue(){
    if(frame!==null||!trigger)return;
    const version=tracking,run=()=>{
      if(version!==tracking)return;frame=null;
      if(!trigger||!renderedElement?.isConnected){hide();return;}
      if(dirty||rectKey(renderedElement.getBoundingClientRect())!==lastRect){dirty=false;layout();}
      if(now()<watchUntil)queue();
    };
    frameTimer=!env.requestAnimationFrame;frame=frameTimer?env.setTimeout(run,16):env.requestAnimationFrame(run);
  }
  function schedule(){if(trigger){dirty=true;queue();}}
  function track(){
    const version=tracking,changed=()=>{if(version===tracking)schedule();};
    if(env.ResizeObserver)observer=new env.ResizeObserver(changed);
    const listen=(target: EventTarget,type: string)=>{target.addEventListener(type,changed,true);trackingListeners.push(()=>target.removeEventListener(type,changed,true));};
    for(const type of ['input','transitionend','animationend'])listen(document,type);
    if(env.visualViewport)for(const type of ['resize','scroll'])listen(env.visualViewport,type);
    watchUntil=now()+1000;queue();
  }
  function untrack(){
    tracking++;observer?.disconnect();observer=null;observed=[];trackingListeners.splice(0).forEach(off=>off());
    if(frame!==null){if(frameTimer)env.clearTimeout(frame);else env.cancelAnimationFrame?.(frame);}frame=null;dirty=false;watchUntil=0;lastRect='';
  }
  function place(host: HTMLElement,left: number,top: number){
    host.style.left=left+'px';host.style.top=top+'px';
    const rect=host.getBoundingClientRect(),scaleX=rect.width/host.offsetWidth||1,scaleY=rect.height/host.offsetHeight||1;
    if(Math.abs(rect.left-left)>.5)host.style.left=left+(left-rect.left)/scaleX+'px';
    if(Math.abs(rect.top-top)>.5)host.style.top=top+(top-rect.top)/scaleY+'px';
  }
  let loadingSince: number|null=null,loadingTimer: number|null=null;
  let state={status:'idle',source:'',translation:'',message:'',reason:'input'};
  const pending=new Set<string>(),route=()=>env.location?.href||'';
  const append=<K extends keyof HTMLElementTagNameMap>(tag: K,parent: ParentNode,attribute?: string): HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);if(attribute)node.setAttribute(attribute,'');parent.append(node);return node;};
  function preserve(button: HTMLButtonElement): void{for(const type of ['pointerdown','mousedown'] as const)button.addEventListener(type,event=>{if(event.button===0)event.preventDefault();});}
  function publish(){onState();render();}
  function canRestore(){return restoreContext?.url===route()&&restoreContext!.key===key()&&editor.canRestore();}
  function clearLoading(){if(loadingTimer!==null)env.clearTimeout(loadingTimer);loadingTimer=null;loadingSince=null;}
  function reset(){
    clearLoading();expanded=false;generation++;for(const id of pending){try{Promise.resolve(cancel(id)).catch(()=>{});}catch{}}pending.clear();
    editor.release(snapshot);snapshot=null;pendingApply=null;context=null;preview?.remove();preview=null;
    state={status:'idle',source:'',translation:'',message:'',reason:'input'};
  }
  function cancelCurrent(){reset();publish();}
  function error(message: string,code: string): never{reset();state.status='error';state.message=message;publish();const error=new Error(message) as CodedError;error.code=code;throw error;}
  function restore(){if(!allowed()||!canRestore())return false;const restored=editor.restore();if(restored){restoreContext=null;pendingApply=null;state={status:'idle',source:'',translation:'',message:'',reason:'input'};publish();}return restored;}
  function apply(){
    const action=pendingApply;if(!action)return false;
    if(action.url!==route()||action.key!==key()||!allowed()){pendingApply=null;render();return false;}
    const applied=editor.apply(action.snapshot,action.text);state.message=applied?labels().applied:labels().changed;
    if(applied){restoreContext={key:action.key,url:action.url};pendingApply=null;}publish();return applied;
  }
  async function run(){
    const field=context?.element||renderedElement;
    if(owns(editor.activeElement())&&(!context||context.url===route()&&context.key===key())&&editor.eligible(field))field!.focus();
    if(!allowed())return error(labels().disabled,'FEATURE_DISABLED');
    const captured=editor.capture();if(!captured)return error(labels().input,'UNSUPPORTED_INPUT');
    if(!captured.text.trim()){editor.release(captured);return error(labels().noText,'NO_TEXT');}
    const keepExpanded=expanded;reset();expanded=keepExpanded;snapshot=captured;const version=++generation,url=route(),requestKey=key(),settings=resolveFeatureSettings(getSettings(),'input');
    context={url,key:requestKey,element:captured.element};state={status:'loading',source:captured.text,translation:'',message:labels().loading,reason:'input'};publish();
    const current=()=>{if(version!==generation)return false;if(url!==route()||requestKey!==key()||!allowed()){cancelCurrent();return false;}return true;};
    try{
      const result: string[]=[];
      for(const group of batches(splitText(captured.text),part=>part)){
        if(!current())return {cancelled:true};const id=makeRequestId();pending.add(id);
        try{const response=await translate(group,requestOptions(settings,id));if(!current())return {cancelled:true};result.push(...translationsOf(response,group.length));}finally{pending.delete(id);}
      }
      if(!current())return {cancelled:true};
      const translation=result.join(' '),config=options(),replacement=config.includeOriginal?(config.displayOrder==='translation-original'?[translation,captured.text]:[captured.text,translation]).join('\n'):translation;
      let applied=false,message;
      if(config.autoApply){applied=editor.apply(captured,replacement);if(applied)restoreContext={key:requestKey,url};message=applied?labels().applied:labels().changed;editor.release(captured);snapshot=null;}
      else{pendingApply={snapshot:captured,text:replacement,key:requestKey,url};message=captured.safe&&editor.valid(captured)?labels().preview:labels().changed;}
      state={status:'success',source:captured.text,translation,message,reason:'input'};publish();return {translation,applied};
    }catch(error){if(!current())return {cancelled:true};editor.release(captured);snapshot=null;state.status='error';state.message=String((error as {message?:unknown} | null)?.message||labels().failed);publish();throw error;}
  }
  function action(parent: ParentNode,name: string,label: string,handler: ()=>unknown): HTMLButtonElement{const button=append('button',parent,'data-'+name);button.type='button';button.textContent=label;button.setAttribute('aria-label',label);preserve(button);button.addEventListener('click',event=>{event.stopPropagation();handler();});return button;}
  function actions(parent: ParentNode): void{
    action(parent,'cancel',labels().cancel,cancelCurrent);
    action(parent,'retry',labels().retry,()=>void run().catch(()=>{}));
    action(parent,'apply',labels().apply,apply);
    action(parent,'restore',labels().restore,restore);
    action(parent,'copy',labels().copy,async()=>{try{await env.navigator.clipboard.writeText(state.translation);state.message=labels().copied;render();}catch{}});
  }
  function owns(node: unknown): boolean{return !!node&&[trigger,preview].some(host=>host&&(host===node||host.shadowRoot?.contains(node as Node)));}
  function syncActions(root: ParentNode): void{
    const visible={cancel:state.status==='loading',retry:state.status==='error',apply:!!pendingApply,restore:!!restoreContext,copy:!!state.translation&&!canRestore()};
    for(const [name,show]of Object.entries(visible)){
      const button=root.querySelector<HTMLButtonElement>('[data-'+name+']');if(!button)continue;button.hidden=!show;
      button.disabled=name==='apply'? !pendingApply?.snapshot.safe||!editor.valid(pendingApply.snapshot):name==='restore'?!canRestore():name==='copy'?!env.navigator?.clipboard?.writeText:false;
      button.title=button.disabled&&['apply','restore'].includes(name)?labels().changed:'';
    }
  }
  function layout(){
    if(!trigger||!renderedElement?.isConnected)return;
    const raw=renderedElement.getBoundingClientRect(),rect=visibleRect(renderedElement,raw),button=trigger.shadowRoot!.querySelector<HTMLButtonElement>('[data-trigger]')!,icon=options().icon==='icon';lastRect=rectKey(raw);
    const width=rect.right-rect.left,height=rect.bottom-rect.top,minimum=Math.min(icon?22:18,raw.width,raw.height),hidden=width<minimum||height<minimum||width<=0||height<=0;
    trigger.style.visibility=hidden?'hidden':'visible';if(preview)preview.style.visibility=hidden?'hidden':'visible';if(hidden)return;
    const size=Math.max(1,Math.min(icon?22:18,width,height)),left=Math.max(rect.left,rect.right-24-size),top=Math.max(rect.top,rect.bottom-8-size);
    button.style.width=size+'px';button.style.height=size+'px';trigger.style.width=size+'px';trigger.style.height=size+'px';place(trigger,left,top);
    const actionButton=trigger.shadowRoot!.querySelector<HTMLButtonElement>('[data-translate]')!;actionButton.style.right=left>=37?'calc(100% + 5px)':'auto';actionButton.style.left=left>=37?'auto':'calc(100% + 5px)';actionButton.setAttribute('data-side',left>=37?'left':'right');
    const view=viewport(),viewportWidth=view.right-view.left,viewportHeight=view.bottom-view.top;
    if(preview){
      preview.style.maxWidth=Math.max(0,Math.min(400,viewportWidth-8))+'px';
      const measured=preview.getBoundingClientRect();
      place(preview,Math.max(view.left+4,Math.min(view.right-measured.width-4,rect.left)),Math.max(view.top+4,Math.min(view.bottom-measured.height-4,rect.bottom+8)));
    }
    const box=trigger.shadowRoot!.querySelector<HTMLElement>('.feedback')!;if(!box||box.hidden)return;
    box.style.position='fixed';box.style.right='auto';box.style.bottom='auto';box.style.maxWidth=Math.max(0,Math.min(300,viewportWidth-8))+'px';box.style.maxHeight=Math.max(0,viewportHeight-8)+'px';box.style.overflow='auto';
    const measured=box.getBoundingClientRect(),boxWidth=Math.min(measured.width,300,viewportWidth-8),boxHeight=Math.min(measured.height,viewportHeight-8);
    const boxLeft=Math.max(view.left+4,Math.min(view.right-boxWidth-4,left+size-boxWidth)),above=top-boxHeight-4,below=top+size+4;
    const boxTop=Math.max(view.top+4,Math.min(view.bottom-boxHeight-4,above>=view.top+4?above:below));place(box,boxLeft,boxTop);
  }
  function sync(){
    if(!trigger)return;
    const root=trigger.shadowRoot!,active=!context||context.element===renderedElement,button=root.querySelector<HTMLButtonElement>('[data-trigger]')!;
    const config=options(),restorable=active&&canRestore(),loading=active&&state.status==='loading',failed=active&&state.status==='error';
    const copyResult=active&&state.message===labels().changed&&!!state.translation;
    const now=env.performance?.now?.()??Date.now(),reduced=env.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let visualLoading=loading;
    if(reduced||!active)clearLoading();
    else if(loading){if(loadingSince===null)loadingSince=now;}
    else if(loadingSince!==null&&(state.status==='success'||failed)&&now-loadingSince<MIN_LOADING_MS){
      visualLoading=true;if(loadingTimer===null)loadingTimer=env.setTimeout(()=>{loadingTimer=null;sync();},MIN_LOADING_MS-(now-loadingSince));
    }else clearLoading();
    const label=button.querySelector<HTMLElement>('[data-trigger-label]');if(label)label.textContent=visualLoading?'…':'';
    button.setAttribute('aria-expanded',String(expanded));button.title=labels().inputTrigger;
    const translateButton=root.querySelector<HTMLButtonElement>('[data-translate]')!,mode=visualLoading?'loading':restorable?'translated':failed?'error':copyResult?'copy':'idle',showCheck=restorable&&!visualLoading;
    if(mode==='error')button.className=button.className.replace(' entering','');
    button.setAttribute('data-state',mode);translateButton.hidden=!expanded;translateButton.setAttribute('data-state',mode);translateButton.setAttribute('aria-pressed',String(showCheck));
    const check=translateButton.querySelector<SVGElement>('[data-check]')!;if(showCheck)check.removeAttribute('hidden');else check.setAttribute('hidden','');
    const actionLabel=visualLoading?labels().cancel:restorable?labels().restore:failed?labels().retry:copyResult?labels().copy:labels().inputTrigger+' ('+resolveFeatureSettings(getSettings(),'input').targetLanguage+')';
    translateButton.title=actionLabel;translateButton.setAttribute('aria-label',actionLabel);
    const box=root.querySelector<HTMLElement>('.feedback')!;box.hidden=config.icon!=='none'&&config.autoApply||!active||state.status==='idle';const status=box.querySelector<HTMLElement>('[role="status"]')!;status.title=state.message;status.textContent=state.status==='loading'?labels().loading:state.status==='error'?labels().failed:state.message===labels().changed?labels().copy:state.message;syncActions(root);
    if(preview){const output=preview.shadowRoot!.querySelector<HTMLElement>('[data-translation]')!;if(output.textContent!==state.translation)output.textContent=state.translation;preview.shadowRoot!.querySelector<HTMLElement>('[role="status"]')!.textContent=pendingApply&&!editor.valid(pendingApply.snapshot)?labels().changed:state.message;syncActions(preview.shadowRoot!);}
    layout();
  }
  function position(host: HTMLElement): void{host.style.cssText='all:initial;position:fixed;z-index:2147483647;';host.style.position='fixed';}
  function render(settled=false){
    const focused=editor.activeElement(),inside=owns(focused)||uiInteraction;
    if(!enabled||!allowed()||editor.isComposing()){hide();return;}
    // focusout can report body before the destination receives focusin. Keep the
    // surface until that event settles, without relaxing editor snapshot guards.
    if(!editor.eligible(focused)&&!inside){if(settled||focused===renderedElement)hide();else if(trigger)sync();return;}
    const element=inside?renderedElement:focused;if(!editor.eligible(element)){hide();return;}
    const active=context?.element===element||!context,config=options(),configKey=JSON.stringify(config);
    if(config.icon==='none'&&(!active||state.status==='idle')&&!canRestore()){hide();return;}
    const wantsPreview=active&&!config.autoApply&&state.status!=='idle';
    if(trigger&&renderedElement===element&&renderedConfig===configKey){renderPreview(wantsPreview);sync();schedule();return;}
    hide();renderedElement=element;renderedConfig=configKey;
    const host=document.createElement('div');host.id='kuai-input-trigger';host.setAttribute('data-kuai-owned','');host.setAttribute('data-kuai-ui','');
    const shadow=host.attachShadow({mode:'open'}),style=append('style',shadow);
    style.textContent=TRIGGER_STYLE;
    const button=action(shadow,'trigger',labels().inputTrigger,()=>{if(state.status==='loading'&&context?.element===renderedElement)cancelCurrent();else if(config.icon!=='none'){expanded=!expanded;sync();}else if(canRestore())restore();else void run().catch(()=>{});});
    const translateButton=action(shadow,'translate',labels().inputTrigger,()=>{
      if(state.status==='loading'&&context?.element===renderedElement){cancelCurrent();return;}
      if(canRestore()){restore();return;}
      if(context?.element===renderedElement&&state.message===labels().changed&&state.translation){void env.navigator?.clipboard?.writeText(state.translation).catch(()=>{});return;}
      void run().catch(()=>{});
    });translateButton.className='translate-action';translateButton.textContent='';appendIcon(document,translateButton,'translate');const check=appendIcon(document,translateButton,'check');check.setAttribute('data-check','');check.setAttribute('class','completion-check');check.setAttribute('hidden','');
    const icon=config.icon==='icon';button.className='trigger'+(icon?' icon':config.icon==='none'?' none':'')+' entering';button.textContent='';if(icon)appendIcon(document,button,'kuai');button.title=active&&state.message||labels().inputTrigger;button.setAttribute('tabindex','0');
    button.addEventListener('animationend',event=>{if(event.target===button&&event.animationName==='kuai-appear')button.className=button.className.replace(' entering','');});
    const spinner=append('span',button);spinner.className='spinner';spinner.setAttribute('aria-hidden','true');if(config.icon==='none')append('span',button,'data-trigger-label');
    {
      const feedback=append('div',shadow);feedback.className='feedback';const status=append('span',feedback);status.className='status';status.setAttribute('role','status');status.title=state.message;status.textContent=state.status==='loading'?labels().loading:state.status==='error'?labels().failed:state.message===labels().changed?labels().copy:state.message;actions(feedback);
    }
    position(host);document.documentElement.append(host);trigger=host;track();
    renderPreview(wantsPreview);sync();
  }
  function renderPreview(wantsPreview: boolean){
    if(!wantsPreview){preview?.remove();preview=null;return;}
    if(!preview){
      preview=document.createElement('div');preview.id='kuai-input-preview';preview.setAttribute('data-kuai-owned','');preview.setAttribute('data-kuai-ui','');
      const root=preview.attachShadow({mode:'open'}),style=append('style',root);style.textContent='section{box-sizing:border-box;max-width:min(400px,100%);max-height:50vh;overflow:auto;padding:12px;border:1px solid #bbc5d6;border-radius:10px;background:white;color:#172033;font:14px/1.6 system-ui,sans-serif;box-shadow:0 6px 30px #0003}div{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:4px}';
      const section=append('section',root);section.setAttribute('role','dialog');section.setAttribute('aria-label',labels().inputTrigger);
      action(section,'close',labels().close,cancelCurrent);const output=append('div',section,'data-translation');output.textContent=state.translation;const message=append('div',section);message.setAttribute('role','status');message.textContent=state.message;actions(section);
      position(preview);document.documentElement.append(preview);
    }
  }
  function hide(){untrack();clearLoading();expanded=false;trigger?.remove();trigger=null;preview?.remove();preview=null;uiInteraction=false;}
  function update(){if(context&&(context.url!==route()||context.key!==key()))reset();if(restoreContext&&(restoreContext.url!==route()||restoreContext.key!==key()))restoreContext=null;render();}
  return {run,restore,apply,canRestore,render,update,cancelCurrent,focusin(event: Event){if(!owns(event.composedPath?.()[0]||event.target))uiInteraction=false;render(true);if(trigger){watchUntil=now()+1000;queue();}},pointerdown(event: Event){uiInteraction=owns(event.composedPath?.()[0]||event.target);if(!uiInteraction){expanded=false;sync();}},getState:()=>({...state}),start(){enabled=true;render();},hide,stop(){enabled=false;reset();hide();}};
}
