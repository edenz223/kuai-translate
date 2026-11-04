import boundary from './subtitle-sidebar-harness.cjs';
import {defaultSettings} from '../../dist/src/shared/settings.js';
import {createYouTubeController} from '../../dist/src/youtube/index.js';
import sidebarAPI from '../../dist/src/youtube/sidebar.js';
import selectionAPI from '../../dist/src/youtube/selection.js';

/** Real runtime, overlay, sidebar and selection controllers on a controlled DOM boundary. */
export function studyFixture({settings={},rect,cc=true,save,openOptions,createView,onHarness}={}) {
  const h=boundary.createFixture({createController:()=>({start:()=>({})})},{language:'zh-CN'});
  h.controlHost.remove();if(rect)h.video._rect=rect;
  let timer=0,bridge;const timers=new Map(),outbound=[],translations=[],patches=[],cancellations=[],options=[];
  Object.assign(h.env,{
    location:{href:'https://www.youtube.com/watch?v=abcdef12345',origin:'https://www.youtube.com'},
    setTimeout:(fn,delay=0)=>{timers.set(++timer,{fn,delay});return timer;},clearTimeout:id=>timers.delete(id),
    setInterval:()=>1,clearInterval(){},postMessage:data=>outbound.push(data),getSelection:()=>h.document.selection,
  });
  const ccButton=h.document.createElement('button');ccButton.className='ytp-subtitles-button';ccButton.setAttribute('aria-pressed',String(cc));
  ccButton.click=()=>{ccButton.setAttribute('aria-pressed',String(ccButton.getAttribute('aria-pressed')!=='true'));};h.controls.append(ccButton);
  const config={...defaultSettings(),...settings};
  onHarness?.(h);
  const manager=createYouTubeController({env:h.env,settings:config,
    ...(createView?{createView}:{}),
    translate:async(texts,request)=>{translations.push({texts,request});return{translations:texts.map(text=>'译:'+text)};},
    updatePreferences:async patch=>{patches.push(patch);if(save)return save(patch);Object.assign(config,patch.subtitleStyle?{...patch,subtitleStyle:{...config.subtitleStyle,...patch.subtitleStyle}}:patch);return structuredClone(config);},
    openOptions:section=>{options.push(section);return openOptions?.(section);},
    createSidebar:(value,env)=>{bridge=value;return sidebarAPI.createController(value,env);},
    createSelection:(value,env)=>{const controller=selectionAPI.createController(value,env),cancel=controller.cancel;controller.cancel=(...args)=>{cancellations.push(args);return cancel(...args);};return controller;},
  }).start();
  async function flush(){for(let pass=0;pass<8;pass++){await Promise.resolve();for(const [id,item]of [...timers])if(item.delay===0){timers.delete(id);item.fn();}await h.flush();}}
  const message=data=>h.env.dispatchEvent({type:'message',source:h.env,origin:h.env.location.origin,data:{source:'kuai-youtube-data',videoId:'abcdef12345',...data}});
  const tracks=()=>message({kind:'tracks',selectedLanguage:'en',tracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=abcdef12345&lang=en',languageCode:'en',name:'English'}]});
  const load=async()=>{tracks();const request=outbound.filter(item=>item.kind==='fetch-track').at(-1);message({kind:'captions',requestId:request.requestId,body:JSON.stringify({events:[{tStartMs:0,dDurationMs:3000,segs:[{utf8:'First'}]},{tStartMs:5000,dDurationMs:3000,segs:[{utf8:'Second'}]},{tStartMs:10000,dDurationMs:3000,segs:[{utf8:'Third'}]}]})});await flush();};
  return{...h,manager,bridge,config,ccButton,outbound,translations,patches,cancellations,options,flush,message,tracks,load,
    session:()=>bridge.getSessions()[0],
    mainButton:()=>h.document.querySelectorAll('button').find(node=>node.id.startsWith('kuai-subtitle-button-')),
    listButton:()=>h.document.querySelector('[data-kuai-subtitle-sidebar-toggle]')?.shadowRoot.querySelector('button'),
    panel:()=>h.document.querySelectorAll('section').find(node=>node.id.startsWith('kuai-subtitle-sidebar-')),
    settingsButton:()=>h.document.querySelector('[data-kuai-subtitle-settings-toggle]'),
    settingsPanel:()=>h.document.querySelector('[data-kuai-subtitle-settings]'),
    captionHost:()=>h.document.querySelectorAll('div').find(node=>node.id.startsWith('kuai-captions-window-')),
  };
}
export const rect=boundary.rect;
