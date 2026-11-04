import {normalizeSubtitleStyle} from '../shared/presentation.js';

export function subtitleStyle(settings={}) {
  return normalizeSubtitleStyle(settings.subtitleStyle??{displayMode:settings.showOriginal===false?'translation_only':'bilingual'});
}

export function subtitleLayoutKey(settings) {
  const style=subtitleStyle(settings);
  return JSON.stringify(['displayMode','displayOrder','hideTranslation','sourceFontSize','targetFontSize','sourceWeight','targetWeight','fontFamily','position','offset','maxWidth'].map(key=>style[key]));
}

const masks=new WeakMap();
/** The learning mask reveals on pointer or keyboard focus without changing text nodes. */
export function applySubtitleMask(element,enabled) {
  let state=masks.get(element);
  if(!state){
    state={enabled:false,hover:false,focus:false};
    state.render=()=>element.style.setProperty('filter',state.enabled&&!state.hover&&!state.focus?'blur(5px)':'none','important');
    for(const [event,key,value]of [['mouseenter','hover',true],['mouseleave','hover',false],['focus','focus',true],['blur','focus',false]])
      element.addEventListener(event,()=>{state[key]=value;state.render();});
    masks.set(element,state);
  }
  state.enabled=!!enabled;
  if(enabled){if(element.getAttribute('tabindex')!=='0')element.setAttribute('tabindex','0');}
  else if(element.hasAttribute('tabindex'))element.removeAttribute('tabindex');
  state.render();
}
