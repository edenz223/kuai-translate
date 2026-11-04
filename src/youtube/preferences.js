import {subtitleStyle} from './presentation.js';

const languages=[['follow_page','跟随网页目标语言'],['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['pt','Português'],['ru','Русский'],['ar','العربية']];

/** Always-mounted preferences, independent of whether a caption or translation exists. */
export function createSubtitlePreferences({env,player,id,trigger,onChange,onTrackChange,onOpenOptions,cancelSelection=()=>{}}) {
  const doc=env.document,element=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const host=element('section');host.dataset.kuaiSubtitleSettings=id;host.dataset.kuaiCaptionUi='true';host.id='kuai-subtitle-settings-'+id;host.hidden=true;
  host.style.cssText='position:absolute;right:12px;bottom:64px;width:min(340px,calc(100% - 24px));max-height:calc(100% - 80px);z-index:2600;pointer-events:auto;';
  const shadow=host.attachShadow({mode:'open'}),style=element('style');
  style.textContent=':host{font:14px/1.5 system-ui,sans-serif;color:#f8fafc;text-align:left}:host([hidden]){display:none!important}*{box-sizing:border-box}.panel{max-height:60vh;overflow:auto;padding:14px;border:1px solid #ffffff38;border-radius:12px;background:#111827f5;box-shadow:0 8px 30px #0007}.header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.header h2{font:600 15px system-ui;margin:0}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:11px 0}.row span{flex:0 0 auto}select,button,input{font:inherit}select{min-width:0;max-width:190px;padding:5px;border:1px solid #64748b;border-radius:5px;color:#f8fafc;background:#1e293b}input{accent-color:#60a5fa}button{padding:6px 9px;border:1px solid #64748b;border-radius:6px;color:#f8fafc;background:#1e293b;cursor:pointer}button:hover{background:#334155}button:focus-visible,select:focus-visible{outline:2px solid #93c5fd}.close-settings{font-size:20px;line-height:20px;padding:2px 7px}.settings-status{font-size:12px;color:#fbbf24;white-space:pre-wrap}.settings-status:empty{display:none}.all-subtitle-settings{width:100%;margin-top:8px}';
  const panel=element('div','panel'),header=element('div','header'),title=element('h2','','字幕设置'),close=element('button','close-settings','×');close.type='button';close.setAttribute('aria-label','关闭字幕设置');header.append(title,close);panel.append(header);
  const controls=[];
  function field(label,className,type='select'){
    const row=element('label','row'),text=element('span','',label),control=element(type==='select'?'select':'input',className);
    if(type!=='select')control.type='checkbox';control.setAttribute('aria-label',label);row.append(text,control);panel.append(row);controls.push(control);return control;
  }
  const enabled=field('字幕翻译','subtitles-enabled','checkbox'),tracks=field('原字幕语言','subtitle-track'),provider=field('翻译服务','subtitle-provider'),target=field('目标语言','subtitle-target'),mode=field('显示方式','subtitle-mode'),order=field('显示顺序','subtitle-order'),mask=field('遮住译文练习','subtitle-mask','checkbox');
  const status=element('p','settings-status'),all=element('button','all-subtitle-settings','字体、颜色与完整字幕设置');all.type='button';status.setAttribute('role','status');panel.append(status,all);shadow.append(style,panel);player.append(host);
  trigger.setAttribute('aria-controls',host.id);trigger.setAttribute('aria-haspopup','dialog');host.setAttribute('role','dialog');host.setAttribute('aria-label','字幕设置');
  let settings={},busy=false,destroyed=false,trackChoices=[],selectedTrack='';
  function options(control,values,current){
    const choices=values.some(([value])=>value===current)||!current?values:[...values,[current,current]];
    const signature=JSON.stringify(choices);
    if(control._kuaiOptions!==signature){control._kuaiOptions=signature;control.replaceChildren(...choices.map(([value,label])=>{const option=element('option','',label);option.value=value;return option;}));}
    control.value=current;
  }
  function renderTracks(){
    options(tracks,[...trackChoices,['',trackChoices.length?'自动（跟随当前字幕）':'自动（尚未读取到字幕语言）']],selectedTrack);
    tracks.disabled=busy||!trackChoices.length;
  }
  function setTracks(values,selectedId){
    if(destroyed)return;
    trackChoices=values.map(track=>[track.id,track.name+(track.kind==='asr'?' · 自动字幕':'')]);selectedTrack=selectedId||'';renderTracks();
  }
  function render(next){
    settings=next;if(destroyed||busy)return;
    renderTracks();
    const presentation=subtitleStyle(settings);
    enabled.checked=settings.subtitlesEnabled!==false;mask.checked=presentation.hideTranslation;
    options(provider,[['follow_page','跟随网页翻译'],...(settings.providers||[]).filter(item=>item.enabled).map(item=>[item.id,item.name||item.id])],settings.subtitleProviderId||'follow_page');
    options(target,languages,settings.subtitleTargetLanguage||'follow_page');
    options(mode,[['bilingual','原文与译文'],['translation_only','只显示译文']],presentation.displayMode);
    options(order,[['original_on_top','原文在上'],['translation_on_top','译文在上']],presentation.displayOrder);
  }
  function error(value){if(!destroyed)status.textContent=String(value?.message||value||'操作失败，请重试');}
  async function perform(action,reason='preferences'){
    if(busy||destroyed)return;cancelSelection(id,reason);busy=true;controls.forEach(control=>control.disabled=true);status.textContent=reason==='track'?'正在切换字幕语言…':'正在保存…';
    try{await action();if(!destroyed)status.textContent=reason==='track'?'已切换字幕语言':'已保存';}
    catch(reason){error(reason);}
    finally{busy=false;if(!destroyed){controls.forEach(control=>control.disabled=false);render(settings);}}
  }
  function save(patch){return perform(()=>{if(!onChange)throw new Error('设置暂不可用，请刷新页面后重试');return onChange(patch);});}
  for(const [control,patch]of [[enabled,()=>({subtitlesEnabled:enabled.checked})],[provider,()=>({subtitleProviderId:provider.value})],[target,()=>({subtitleTargetLanguage:target.value})],[mode,()=>({subtitleStyle:{displayMode:mode.value}})],[order,()=>({subtitleStyle:{displayOrder:order.value}})],[mask,()=>({subtitleStyle:{hideTranslation:mask.checked}})]])
    control.addEventListener('change',()=>{void save(patch());});
  tracks.addEventListener('change',()=>{
    if(tracks.disabled)return;const selected=tracks.value;
    void perform(()=>{if(!onTrackChange)throw new Error('字幕语言暂不可用，请刷新页面后重试');return onTrackChange(selected);},'track');
  });
  function toggle(force){if(destroyed)return false;const open=force??host.hidden;if(open)cancelSelection(id,'settings-open');host.hidden=!open;trigger.setAttribute('aria-expanded',String(open));return open;}
  close.addEventListener('click',()=>{toggle(false);trigger.focus?.();});
  all.addEventListener('click',()=>{Promise.resolve().then(()=>{if(!onOpenOptions)throw new Error('无法打开扩展设置，请从扩展图标进入');return onOpenOptions('subtitles');}).catch(error);});
  host.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();toggle(false);trigger.focus?.();}event.stopPropagation();});
  for(const type of ['pointerdown','mousedown'])host.addEventListener(type,event=>{if(event.button===0)cancelSelection(id,'settings-intent');event.stopPropagation();});
  for(const type of ['click','dblclick','change'])host.addEventListener(type,event=>event.stopPropagation());
  renderTracks();
  return{host,render,toggle,error,setTracks,mount(){if(!destroyed&&host.parentNode!==player)player.append(host);},destroy(){destroyed=true;host.remove();}};
}
