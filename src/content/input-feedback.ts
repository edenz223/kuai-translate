import type {Settings} from '../shared/settings.js';
import type {Translate} from '../shared/messages.js';
import type {InteractionOptions} from '../shared/interactions.js';
import type {BrowserEnvironment,CodedError} from './dom.js';
import type {createInputEditor,EditorElement,InputSnapshot} from './input-editor.js';

interface InputContext {url:string;key:string}
export interface InputFeedbackOptions {document:Document;env:BrowserEnvironment;editor:ReturnType<typeof createInputEditor>;translate:Translate;cancel:(id:string)=>unknown;getSettings:()=>Settings;options:()=>InteractionOptions['inputOptions'];allowed:()=>boolean;key:()=>string;labels:()=>Record<string,string>;onState:()=>void;makeRequestId?:()=>string}

import {appendIcon} from './icons.js';
import {batches,makeId,requestOptions,splitText,translationsOf} from './dom.js';
import {resolveFeatureSettings} from '../shared/interactions.js';

/** Input requests and feedback deliberately have no selection-card ownership. */
export function createInputFeedback({document,env,editor,translate,cancel,getSettings,options,allowed,key,labels,onState,makeRequestId=makeId}: InputFeedbackOptions){
  let generation=0,context: (InputContext & {element:EditorElement})|null=null,snapshot: InputSnapshot|null=null,pendingApply: (InputContext & {snapshot:InputSnapshot;text:string})|null=null,restoreContext: InputContext|null=null,trigger: HTMLDivElement|null=null,preview: HTMLDivElement|null=null,enabled=false,renderedElement: EditorElement|null=null,renderedConfig='',uiInteraction=false;
  let expanded=false;
  let state={status:'idle',source:'',translation:'',message:'',reason:'input'};
  const pending=new Set<string>(),route=()=>env.location?.href||'';
  const append=<K extends keyof HTMLElementTagNameMap>(tag: K,parent: ParentNode,attribute?: string): HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);if(attribute)node.setAttribute(attribute,'');parent.append(node);return node;};
  function preserve(button: HTMLButtonElement): void{for(const type of ['pointerdown','mousedown'] as const)button.addEventListener(type,event=>{if(event.button===0)event.preventDefault();});}
  function publish(){onState();render();}
  function canRestore(){return restoreContext?.url===route()&&restoreContext!.key===key()&&editor.canRestore();}
  function reset(){
    expanded=false;generation++;for(const id of pending){try{Promise.resolve(cancel(id)).catch(()=>{});}catch{}}pending.clear();
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
    const rect=renderedElement.getBoundingClientRect(),button=trigger.shadowRoot!.querySelector<HTMLButtonElement>('[data-trigger]')!,icon=options().icon==='icon';
    const size=Math.max(1,Math.min(icon?28:18,rect.width||rect.right-rect.left,rect.height||rect.bottom-rect.top));button.style.width=size+'px';button.style.height=size+'px';position(trigger,rect,size);
    const actionButton=trigger.shadowRoot!.querySelector<HTMLButtonElement>('[data-translate]')!;actionButton.style.right=parseFloat(trigger.style.left)>=37?'calc(100% + 5px)':'auto';actionButton.style.left=parseFloat(trigger.style.left)>=37?'auto':'calc(100% + 5px)';
    const box=trigger.shadowRoot!.querySelector<HTMLElement>('.feedback')!;if(!box||box.hidden)return;
    const viewportWidth=env.innerWidth||1200,viewportHeight=env.innerHeight||800;
    box.style.position='fixed';box.style.right='auto';box.style.bottom='auto';box.style.maxWidth=Math.max(0,Math.min(300,viewportWidth-8))+'px';box.style.maxHeight=Math.max(0,viewportHeight-8)+'px';box.style.overflow='auto';
    const measured=box.getBoundingClientRect(),width=Math.min(measured.width,300,viewportWidth-8),height=Math.min(measured.height,viewportHeight-8),anchorLeft=parseFloat(trigger.style.left),anchorTop=parseFloat(trigger.style.top);
    const left=Math.max(4,Math.min(viewportWidth-width-4,anchorLeft+size-width));
    const above=anchorTop-height-4,below=anchorTop+size+4;
    const top=Math.max(4,Math.min(viewportHeight-height-4,above>=4?above:below));box.style.left=left+'px';box.style.top=top+'px';
  }
  function sync(){
    if(!trigger)return;
    const root=trigger.shadowRoot!,active=!context||context.element===renderedElement,button=root.querySelector<HTMLButtonElement>('[data-trigger]')!;
    const config=options(),restorable=active&&canRestore(),loading=active&&state.status==='loading',failed=active&&state.status==='error';
    const copyResult=active&&state.message===labels().changed&&!!state.translation;
    button.textContent=config.icon==='dot'?'':loading?'…':config.icon==='icon'?'译':'';
    button.setAttribute('aria-expanded',String(expanded));button.title=labels().inputTrigger;
    const translateButton=root.querySelector<HTMLButtonElement>('[data-translate]')!,mode=restorable?'translated':loading?'loading':failed?'error':copyResult?'copy':'idle';
    translateButton.hidden=!expanded;translateButton.setAttribute('data-state',mode);translateButton.setAttribute('aria-pressed',String(restorable));
    const check=translateButton.querySelector<SVGElement>('[data-check]')!;if(restorable)check.removeAttribute('hidden');else check.setAttribute('hidden','');
    const actionLabel=restorable?labels().restore:loading?labels().cancel:failed?labels().retry:copyResult?labels().copy:labels().inputTrigger+' ('+resolveFeatureSettings(getSettings(),'input').targetLanguage+')';
    translateButton.title=actionLabel;translateButton.setAttribute('aria-label',actionLabel);
    const box=root.querySelector<HTMLElement>('.feedback')!;box.hidden=config.icon==='dot'&&config.autoApply||!active||state.status==='idle';const status=box.querySelector<HTMLElement>('[role="status"]')!;status.title=state.message;status.textContent=state.status==='loading'?labels().loading:state.status==='error'?labels().failed:state.message===labels().changed?labels().copy:state.message;syncActions(root);
    if(preview){const output=preview.shadowRoot!.querySelector<HTMLElement>('[data-translation]')!;if(output.textContent!==state.translation)output.textContent=state.translation;preview.shadowRoot!.querySelector<HTMLElement>('[role="status"]')!.textContent=pendingApply&&!editor.valid(pendingApply.snapshot)?labels().changed:state.message;syncActions(preview.shadowRoot!);}
    layout();
  }
  function position(host: HTMLElement,rect: DOMRect,size: number): void{
    const width=env.innerWidth||1200,height=env.innerHeight||800;
    const left=Math.max(4,Math.min(width-size-4,Math.max(Number(rect.left)||0,(Number(rect.right)||0)-24-size)));
    const top=Math.max(4,Math.min(height-size-4,Math.max(Number(rect.top)||0,(Number(rect.bottom)||0)-8-size)));
    host.style.cssText='all:initial;position:fixed;z-index:2147483647;';host.style.left=left+'px';host.style.top=top+'px';
  }
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
    if(trigger&&renderedElement===element&&renderedConfig===configKey&&!!preview===wantsPreview){sync();return;}
    hide();renderedElement=element;renderedConfig=configKey;
    const host=document.createElement('div');host.id='kuai-input-trigger';host.setAttribute('data-kuai-owned','');host.setAttribute('data-kuai-ui','');
    const shadow=host.attachShadow({mode:'open'}),style=append('style',shadow);
    style.textContent=':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}button{font:12px/1.4 system-ui,sans-serif;cursor:pointer;border:1px solid #5888c0;border-radius:5px;background:#fff;color:#173f71;padding:2px 5px}button:focus-visible{outline:2px solid #1976d2}button:disabled{opacity:.5}.trigger{width:18px;height:18px;padding:0;border-radius:50%;background:transparent;color:#64748b;border:0;display:grid;place-items:center}.trigger:empty::after{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.trigger:hover{background:#e2e8f0;color:#334155}.translate-action{position:absolute;right:calc(100% + 5px);bottom:0;display:grid;place-items:center;width:28px;height:28px;padding:5px;background:#fff;color:#475569;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 2px 6px #0001}.translate-action:hover{background:#f1f5f9}.translate-action[data-state=translated]{color:#15803d;border-color:#86efac;background:#f0fdf4}.completion-check{position:absolute;right:-4px;top:-4px;width:12px;height:12px;border-radius:50%;background:#15803d;color:#fff;box-shadow:0 0 0 2px #fff}.translate-action[data-state=loading]>svg:first-child{animation:kuai-spin 1s linear infinite}.translate-action[data-state=error]{color:#dc2626;border-color:#fca5a5}@keyframes kuai-spin{to{transform:rotate(360deg)}}.trigger.icon{width:28px;height:28px;border-radius:7px}.feedback{position:absolute;right:0;bottom:100%;display:flex;gap:4px;align-items:center;padding:4px;background:#fff;color:#172033;border:1px solid #bbc5d6;border-radius:6px;box-shadow:0 2px 8px #0002;width:max-content;max-width:min(300px,calc(100vw - 16px));flex-wrap:wrap;font:12px/1.4 system-ui,sans-serif}.status{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    const button=action(shadow,'trigger',labels().inputTrigger,()=>{if(state.status==='loading'&&context?.element===renderedElement)cancelCurrent();else if(config.icon==='dot'){expanded=!expanded;sync();}else if(canRestore())restore();else void run().catch(()=>{});});
    const translateButton=action(shadow,'translate',labels().inputTrigger,()=>{
      if(state.status==='loading'&&context?.element===renderedElement){cancelCurrent();return;}
      if(canRestore()){restore();return;}
      if(context?.element===renderedElement&&state.message===labels().changed&&state.translation){void env.navigator?.clipboard?.writeText(state.translation).catch(()=>{});return;}
      void run().catch(()=>{});
    });translateButton.className='translate-action';translateButton.textContent='';appendIcon(document,translateButton,'translate');const check=appendIcon(document,translateButton,'check');check.setAttribute('data-check','');check.setAttribute('class','completion-check');check.setAttribute('hidden','');
    const icon=config.icon==='icon';button.className='trigger'+(icon?' icon':'');button.textContent=state.status==='loading'&&active?'…':icon?'译':'•';button.title=active&&state.message||labels().inputTrigger;button.setAttribute('tabindex','0');
    {
      const feedback=append('div',shadow);feedback.className='feedback';const status=append('span',feedback);status.className='status';status.setAttribute('role','status');status.title=state.message;status.textContent=state.status==='loading'?labels().loading:state.status==='error'?labels().failed:state.message===labels().changed?labels().copy:state.message;actions(feedback);
    }
    const rect=element!.getBoundingClientRect(),size=Math.max(1,Math.min(icon?28:18,rect.width||rect.right-rect.left,rect.height||rect.bottom-rect.top));button.style.width=size+'px';button.style.height=size+'px';
    position(host,rect,size);document.documentElement.append(host);trigger=host;
    if(active&&!config.autoApply&&state.status!=='idle'){
      preview=document.createElement('div');preview.id='kuai-input-preview';preview.setAttribute('data-kuai-owned','');preview.setAttribute('data-kuai-ui','');
      const root=preview.attachShadow({mode:'open'}),style=append('style',root);style.textContent='section{box-sizing:border-box;max-width:400px;max-height:50vh;overflow:auto;padding:12px;border:1px solid #bbc5d6;border-radius:10px;background:white;color:#172033;font:14px/1.6 system-ui,sans-serif;box-shadow:0 6px 30px #0003}div{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:4px}';
      const section=append('section',root);section.setAttribute('role','dialog');section.setAttribute('aria-label',labels().inputTrigger);
      action(section,'close',labels().close,cancelCurrent);const output=append('div',section,'data-translation');output.textContent=state.translation;const message=append('div',section);message.setAttribute('role','status');message.textContent=state.message;actions(section);
      position(preview,element!.getBoundingClientRect(),28);preview.style.left=Math.max(4,Math.min((env.innerWidth||1200)-420,element!.getBoundingClientRect().left||4))+'px';preview.style.top=Math.max(4,Math.min((env.innerHeight||800)-200,element!.getBoundingClientRect().bottom+8))+'px';document.documentElement.append(preview);
    }
    sync();
  }
  function hide(){expanded=false;trigger?.remove();trigger=null;preview?.remove();preview=null;uiInteraction=false;}
  function update(){if(context&&(context.url!==route()||context.key!==key()))reset();if(restoreContext&&(restoreContext.url!==route()||restoreContext.key!==key()))restoreContext=null;render();}
  return {run,restore,apply,canRestore,render,update,cancelCurrent,focusin(event: Event){if(!owns(event.composedPath?.()[0]||event.target))uiInteraction=false;render(true);},pointerdown(event: Event){uiInteraction=owns(event.composedPath?.()[0]||event.target);if(!uiInteraction){expanded=false;sync();}},getState:()=>({...state}),start(){enabled=true;render();},hide,stop(){enabled=false;reset();trigger?.remove();trigger=null;}};
}
