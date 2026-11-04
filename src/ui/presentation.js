import {PAGE_STYLE_DEFAULTS,SUBTITLE_STYLE_DEFAULTS,PAGE_PRESETS} from '../shared/presentation.js';
import {applyPageStyle,applySubtitleTextStyle,applySubtitleBoxStyle} from '../shared/styles.js';
import {byId,fillSelect,LANGUAGES} from './common.js';

const presetNames={border:'左侧边线',plain:'跟随原文', 'thin-dashed':'细虚线下划线',dashed:'虚线下划线',dotted:'点状下划线',background:'背景色',transparent:'透明效果','orange-underline':'橙色下划线',underline:'实线下划线',wavy:'波浪下划线',marker:'马克笔',highlight:'高亮',blur:'模糊遮盖（悬停显示）',italic:'斜体',bold:'加粗','dashed-border':'虚线边框'};
const weights=Array.from({length:9},(_,index)=>{const value=(index+1)*100;return [String(value),value===400?'400 · 正常':value===600?'600 · 半粗':value===700?'700 · 粗体':String(value)];});
const modes=[['bilingual','原文 + 译文'],['translation_only','仅译文']];
const orders=[['original_on_top','原文在上'],['translation_on_top','译文在上']];
const strokes=[['none','无阴影'],['light','轻阴影'],['normal','普通阴影'],['bold','加粗阴影'],['shadow45','45° 投影']];
const positions=[['bottom-center','底部居中'],['top-center','顶部居中'],['bottom-left','左下角'],['bottom-right','右下角'],['top-left','左上角'],['top-right','右上角']];
const pageFields={preset:['select',PAGE_PRESETS.map(id=>[id,presetNames[id]||id])],fontSize:['number'],fontWeight:['number-select',weights],fontFamily:['text'],textColor:['color'],accentColor:['color'],backgroundColor:['color'],opacity:['number'],italic:['checkbox'],lineHeight:['number']};
const subtitleFields={displayMode:['select',modes],displayOrder:['select',orders],hideTranslation:['checkbox'],sourceFontSize:['number'],targetFontSize:['number'],sourceColor:['color'],targetColor:['color'],sourceWeight:['number-select',weights],targetWeight:['number-select',weights],sourceStroke:['select',strokes],targetStroke:['select',strokes],fontFamily:['text'],backgroundColor:['color'],backgroundOpacity:['number'],backgroundMode:['select',[['line','逐行背景'],['panel','整块背景']]],position:['select',positions],offset:['number'],maxWidth:['number']};

/** Settings controls share the exact presentation helpers used by the real page. */
export function createPresentationControls({document,editor,onError=()=>{}}) {
  const node=id=>byId(document,id);
  const groups=[['pageStyle','page-style-',pageFields,PAGE_STYLE_DEFAULTS],['subtitleStyle','subtitle-style-',subtitleFields,SUBTITLE_STYLE_DEFAULTS]];
  const save=change=>{try{return Promise.resolve(editor.update(change)).catch(onError);}catch(error){onError(error);}};
  function syncField(field,kind,value,entries) {
    if(entries)fillSelect(document,field,entries,String(value));
    else if(kind==='checkbox')field.checked=!!value;
    else if(field!==document.activeElement)field.value=String(value??'');
  }
  function render(settings) {
    for(const [group,prefix,fields,defaults] of groups){
      const values=settings[group]||defaults;
      for(const [key,[kind,entries]] of Object.entries(fields)){
        const value=group==='pageStyle'&&key==='textColor'&&values[key]==='inherit'?'#182b3a':values[key];
        syncField(node(prefix+key),kind,value,entries);
      }
    }
    const page=settings.pageStyle||PAGE_STYLE_DEFAULTS,subtitle=settings.subtitleStyle||SUBTITLE_STYLE_DEFAULTS;
    fillSelect(document,node('page-display-mode'),modes,settings.pageDisplayMode||'bilingual');
    fillSelect(document,node('subtitle-target-language'),[['follow_page','跟随网页目标语言'],...LANGUAGES.filter(([id])=>id!=='auto')],settings.subtitleTargetLanguage||'follow_page');
    node('page-color-inherit').checked=page.textColor==='inherit';node('page-style-textColor').disabled=page.textColor==='inherit';
    node('page-preview-source').hidden=settings.pageDisplayMode==='translation_only';
    applyPageStyle(node('page-preview-translation'),page);
    const original=node('subtitle-preview-source'),translated=node('subtitle-preview-target');
    applySubtitleTextStyle(original,subtitle,'source');applySubtitleTextStyle(translated,subtitle,'target');
    applySubtitleBoxStyle(node('subtitle-preview-box'),subtitle);
    original.hidden=subtitle.displayMode==='translation_only';node('subtitle-preview-source-line').hidden=original.hidden;translated.style.order=subtitle.displayOrder==='translation_on_top'?'-1':'0';node('subtitle-preview-target-line').style.order=translated.style.order;
    translated.classList.toggle('study-hidden',subtitle.hideTranslation);
  }
  function bind() {
    for(const [group,prefix,fields] of groups)for(const [key,[kind]] of Object.entries(fields)){
      const field=node(prefix+key),type=kind==='checkbox'||kind.includes('select')?'change':'input';
      field.addEventListener(type,()=>{
        let value=kind==='checkbox'?field.checked:field.value;
        if(kind.startsWith('number')){if(value===''||!Number.isFinite(Number(value)))return;value=Number(value);}
        return save(settings=>{
          settings[group][key]=value;
          if(group==='pageStyle'&&key==='preset'){
            if(value==='transparent'&&settings.pageStyle.opacity===100)settings.pageStyle.opacity=55;
            if(value==='orange-underline'&&settings.pageStyle.accentColor===PAGE_STYLE_DEFAULTS.accentColor)settings.pageStyle.accentColor='#f97316';
            if(['marker','highlight'].includes(value)&&settings.pageStyle.backgroundColor===PAGE_STYLE_DEFAULTS.backgroundColor)settings.pageStyle.backgroundColor='#fff3a3';
          }
        });
      });
      if(!kind.includes('select')&&kind!=='checkbox')field.addEventListener('blur',()=>render(editor.get()));
    }
    node('page-display-mode').addEventListener('change',event=>save(settings=>{settings.pageDisplayMode=event.target.value;}));
    node('subtitle-target-language').addEventListener('change',event=>save(settings=>{settings.subtitleTargetLanguage=event.target.value;}));
    node('page-color-inherit').addEventListener('change',event=>save(settings=>{settings.pageStyle.textColor=event.target.checked?'inherit':node('page-style-textColor').value;}));
    node('reset-page-style').addEventListener('click',()=>save(settings=>{settings.pageStyle=structuredClone(PAGE_STYLE_DEFAULTS);}));
    node('reset-subtitle-style').addEventListener('click',()=>save(settings=>{settings.subtitleStyle=structuredClone(SUBTITLE_STYLE_DEFAULTS);}));
  }
  return {render,bind};
}
