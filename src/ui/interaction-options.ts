import type {Settings} from '../shared/settings.js';
import type {SettingsEditor, SettingsChange} from './state.js';
import type {SelectEntry} from './common.js';

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type InteractionKind = 'checkbox' | 'languages' | 'sites' | 'selectors' | 'number' | 'shortcut' | 'provider' | 'select' | 'keys' | 'color' | 'writeBack';
type InteractionField = [kind: InteractionKind, entriesOrOther?: SelectEntry[] | string, label?: string];
type InteractionProperty = 'pageOptions' | 'selectionOptions' | 'inputOptions' | 'hoverOptions';
interface InteractionGroup { property: InteractionProperty; defaults: Settings[InteractionProperty]; fields: Record<string,InteractionField>; }
interface ValidationResult { value?: unknown; error?: string; empty?: true; partial?: true; }
export interface InteractionControlOptions { document: Document; editor: SettingsEditor; onError?: (error: unknown) => void; onValidationChange?: () => void; }
export interface InteractionControls { render(settings: Settings): void; bind(): void; resetDrafts(group?: string): void; validationCount(): number; incompleteCount(): number; invalidGroups(): string[]; }

import {PAGE_OPTIONS_DEFAULTS,SELECTION_OPTIONS_DEFAULTS,INPUT_OPTIONS_DEFAULTS,HOVER_OPTIONS_DEFAULTS,normalizeShortcut,normalizeKey,normalizeSiteList} from '../shared/interactions.js';
import {byId,fillProviders,fillSelect,languageName,LANGUAGES,hoverTriggers,selectionTriggers} from './common.js';

const sourceLanguages: SelectEntry[]=[['follow_page','跟随网页'],...LANGUAGES];
const targetLanguages: SelectEntry[]=[['follow_page','跟随网页'],...LANGUAGES.filter(([id])=>id!=='auto')];
const writeBackEntries: SelectEntry[]=[['translation','仅译文（替换原文）'],['original-translation','原文 + 译文'],['translation-original','译文 + 原文']];
/** One select for what ends up in the box; stored as `includeOriginal` + `displayOrder`. */
const writeBackValue=(input: Settings['inputOptions']): string=>input.includeOriginal?input.displayOrder:'translation';
/** Follow-page labels name the language the web page settings currently resolve to. */
function languageEntries(entries: SelectEntry[],current: string): SelectEntry[] {
  return entries.map(([id,label])=>id==='follow_page'?[id,`${label}（${languageName(current)}）`]:[id,label]);
}
/** Languages a feature resolves to, so a follow-page value can be swapped as an explicit choice. */
type LanguageOptions = Settings['selectionOptions'] | Settings['inputOptions'];
const resolvedSource=(settings: Settings,options: LanguageOptions): string=>options.sourceLanguage==='follow_page'?settings.sourceLanguage:options.sourceLanguage;
const groups: Record<string,InteractionGroup>={
  page:{property:'pageOptions',defaults:PAGE_OPTIONS_DEFAULTS,fields:{
    autoTranslate:['checkbox'],alwaysLanguages:['languages'],neverLanguages:['languages'],alwaysSites:['sites'],neverSites:['sites'],
    translateFullPage:['checkbox'],excludeSelectors:['selectors'],minTextLength:['number'],translateDynamic:['checkbox'],contextMenuEnabled:['checkbox'],
    shortcut:['shortcut','displayModeShortcut','切换网页显示模式'],displayModeShortcut:['shortcut','shortcut','网页翻译 / 恢复原文'],
  }},
  selection:{property:'selectionOptions',defaults:SELECTION_OPTIONS_DEFAULTS,fields:{
    providerId:['provider'],sourceLanguage:['select',sourceLanguages],targetLanguage:['select',targetLanguages],
    triggerMode:['select',selectionTriggers()],
    triggerAction:['select',[['click','点击入口'],['hover','悬停入口']]],delay:['number'],maxLength:['number'],showOriginal:['checkbox'],autoSpeak:['checkbox'],disabledSites:['sites'],
  }},
  input:{property:'inputOptions',defaults:INPUT_OPTIONS_DEFAULTS,fields:{
    enabled:['checkbox'],providerId:['provider'],sourceLanguage:['select',sourceLanguages],targetLanguage:['select',targetLanguages],
    shortcut:['shortcut','restoreShortcut','已保存的还原快捷键'],
    icon:['select',[['none','不显示入口'],['dot','小圆点'],['icon','翻译图标']]],autoApply:['checkbox'],writeBack:['writeBack'],disabledSites:['sites'],
  }},
  hover:{property:'hoverOptions',defaults:HOVER_OPTIONS_DEFAULTS,fields:{
    trigger:['select',hoverTriggers()],
    customKeys:['keys'],mode:['select',[['paragraph','当前段落'],['area','当前区域内的可读段落']]],
    delay:['number'],holdDelay:['number'],showIndicator:['checkbox'],borderColor:['color'],disabledSites:['sites'],
  }},
};
const listKinds=new Set(['sites','languages','selectors']);
const format=(value: unknown,kind: InteractionKind): string=>Array.isArray(value)?value.join(kind==='keys'?' + ':'\n'):String(value??'');

function parseList(value: string,kind: InteractionKind): ValidationResult {
  const raw=value.split(/\r?\n/),lines=raw.map(line=>line.trim()).filter(Boolean),limit=kind==='selectors'?50:100;
  if(lines.length>limit)return {error:`每行一项，最多 ${limit} 项；请删减后保存。`};
  if(raw.some(line=>line.length>2000))return {error:'每行最多 2000 个字符，请缩短后保存。'};
  if(lines.some(line=>/[\u0000-\u001f\u007f]/.test(line)))return {error:'规则中不能包含控制字符，请每行填写一项。'};
  if(kind==='sites'){
    if(lines.some(line=>normalizeSiteList([line]).length!==1))return {error:'网站规则无效。请填写域名或 HTTP/HTTPS 地址，可使用 * 和 **。'};
    return {value:normalizeSiteList(lines)};
  }
  if(kind==='languages'){
    try {
      const normalized=lines.map(line=>{
        if(line.length>32 || !/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(line))throw Error();
        return Intl.getCanonicalLocales(line.replace(/_/g,'-'))[0];
      });
      return {value:[...new Set(normalized)]};
    }catch{return {error:'请填写语言代码，例如 en、ja 或 zh-Hans，每行一个。'};}
  }
  return {value:[...new Set(lines)]};
}

/** Interaction drafts stay local until valid; saving any other field cannot erase them. */
export function createInteractionControls({document,editor,onError=()=>{},onValidationChange=()=>{}}: InteractionControlOptions): InteractionControls {
  const node=<T extends HTMLElement = HTMLElement>(id: string): T=>byId<T>(document,id),drafts=new Map<string,string | boolean>(),errors=new Map<string,string>(),incomplete=new Set<string>();
  const idFor=(group: string,key: string): string=>group+'-option-'+key;
  function setError(id: string,message=''): void {
    if(message)errors.set(id,message);else errors.delete(id);
    node(id).setAttribute('aria-invalid',String(!!message));
    const messageNode=node(id+'-error');
    if(messageNode){messageNode.textContent=message?message+' 此项尚未保存。':'';messageNode.hidden=!message;}
  }
  const save=(change: SettingsChange)=>{try{return Promise.resolve(editor.update(change)).catch(onError);}catch(error){onError(error);return Promise.resolve();}};
  function parse(group: string,key: string,value: string | boolean,blur=false): ValidationResult {
    const {property,fields}=groups[group],[kind,other,label]=fields[key],settings=editor.get();
    if(kind==='number'){
      if((value as string).trim()==='')return {empty:true};
      if(!blur && !/^-?\d+(?:\.\d+)?$/.test(value as string))return {partial:true};
      return Number.isFinite(Number(value))?{value:Number(value)}:{error:'请输入有限数字。'};
    }
    if(kind==='shortcut'){
      const shortcut=normalizeShortcut(value,null);
      if(shortcut===null)return {error:'格式为一个或多个修饰键 + 一个 A–Z 字母，例如 Control+Shift+K；留空关闭。'};
      if(shortcut && shortcut===(settings[property] as unknown as Record<string,unknown>)[other as string])return {error:`与“${label}”的快捷键冲突，请使用不同组合。`};
      return {value:shortcut};
    }
    if(kind==='keys'){
      if(!(value as string).trim())return settings.hoverOptions.trigger==='custom'?{error:'请设置一至两个不同的快捷键按键。'}:{value:[]};
      const parts=(value as string).split('+').map(part=>normalizeKey(part));
      if(parts.length>2 || parts.some(part=>!part))return {error:'请填写一至两个 Control / Alt / Shift / Meta 或 A–Z 按键，用 + 分隔。'};
      if(new Set(parts).size!==parts.length)return {error:'自定义快捷键必须由一至两个不同按键组成。'};
      return {value:parts};
    }
    if(listKinds.has(kind))return parseList(value as string,kind);
    return {value};
  }
  function render(settings: Settings): void {
    for(const [group,{property,fields,defaults}] of Object.entries(groups)){
      const values=(settings[property]||defaults) as unknown as Record<string,unknown>;
      for(const [key,[kind,entries]] of Object.entries(fields)){
        const id=idFor(group,key),field=node<FormControl>(id);
        if(kind==='provider')fillProviders(document,field,settings,values[key] as string,true);
        else if(kind==='writeBack')fillSelect(document,field,writeBackEntries,writeBackValue(settings.inputOptions));
        else if(kind==='select')fillSelect(document,field,key==='sourceLanguage'||key==='targetLanguage'?languageEntries(entries as SelectEntry[],settings[key]):entries as SelectEntry[],values[key] as string);
        else if(kind==='checkbox')(field as HTMLInputElement).checked=!!values[key];
        else if(field!==document.activeElement)field.value=drafts.has(id)?drafts.get(id) as string:format(values[key],kind);
        if(kind==='shortcut' && drafts.has(id)){
          const checked=parse(group,key,drafts.get(id)!);
          setError(id,checked.error || (checked.value!==values[key]?'此组合已可用，离开此输入框即可保存。':''));
        }else setError(id,errors.get(id));
      }
    }
    const {pageOptions:page,selectionOptions:selection,inputOptions:input,hoverOptions:hover}=settings;
    node('page-auto-rules').hidden=!page.autoTranslate;
    node('selection-options-panel').hidden=!settings.selectionEnabled;
    const buttonTrigger=['icon','dot'].includes(selection.triggerMode);
    node('selection-trigger-action-field').hidden=!buttonTrigger;
    node('selection-delay-field').hidden=buttonTrigger && selection.triggerAction==='click';
    node('input-options-panel').hidden=!input.enabled;
    for(const [group,options] of [['selection',selection],['input',input]] as const){
      const auto=resolvedSource(settings,options)==='auto';
      node<HTMLButtonElement>(group+'-swap-languages').disabled=auto;node(group+'-swap-help').hidden=!auto;
    }
    node('input-icon-help').textContent=input.icon==='dot'?'聚焦输入框时右下角显示小圆点；点击展开翻译图标，再点图标翻译，完成后再点还原。':
      input.icon==='icon'?'聚焦输入框时显示翻译图标，点击即翻译，完成后再点还原。':'不显示入口，只用快捷键或右键菜单翻译。';
    node('input-write-back-help').hidden=!input.includeOriginal;
    node('input-apply-help').textContent=input.autoApply?'不弹出结果卡，译文直接替换输入框内容。':'先在小卡片中预览译文，确认后点“应用”写回。';
    node('hover-options-panel').hidden=!settings.hoverEnabled;
    node('hover-custom-keys-field').hidden=hover.trigger!=='custom';
    node('hover-delay-field').hidden=!['hover','left_hold'].includes(hover.trigger);
    node('hover-hold-delay-field').hidden=hover.trigger!=='left_hold';
    node('hover-left-hold-help').hidden=hover.trigger!=='left_hold';
    node('hover-trigger-help').textContent=hover.trigger==='hover'?'无需按键，指向文字并达到等待时长即可翻译。移开文字、开始选择文字或按 Escape 会取消待触发任务。':
      hover.trigger==='left_hold'?'在文字上按住鼠标左键触发；松开左键、拖动选择文字或按 Escape 会取消待触发任务。':
      hover.trigger==='custom'&&!hover.customKeys.length?'请先填写一至两个不同的按键，填好后即可切换段落译文。':
      '鼠标指向文字，按一次所选按键翻译，再按一次关闭；无需一直按住。整页翻译会复用这里的译文，恢复原文会一起清除。';
    node('hover-border-color-field').hidden=!hover.showIndicator;
    node('hover-service-summary').textContent='鼠标指向段落，按一次快捷键翻译，再按一次关闭。服务、显示方式、样式与整页翻译共用。';
  }
  function commit(group: string,key: string,{blur=false}: {blur?: boolean}={}) {
    const {property,fields}=groups[group],[kind]=fields[key],id=idFor(group,key),field=node<FormControl>(id);
    if(kind==='writeBack'){
      const value=field.value;
      return save(settings=>{
        settings.inputOptions.includeOriginal=value!=='translation';
        if(value!=='translation')settings.inputOptions.displayOrder=value as Settings['inputOptions']['displayOrder'];
      });
    }
    const editable=!['checkbox','select','provider'].includes(kind),raw=kind==='checkbox'?(field as HTMLInputElement).checked:field.value;
    if(editable)drafts.set(id,raw);
    const parsed=parse(group,key,raw,blur);
    if(parsed.empty || parsed.partial){
      setError(id);
      if(blur){drafts.delete(id);incomplete.delete(id);field.value=format((editor.get()[property] as unknown as Record<string,unknown>)[key],kind);}
      else incomplete.add(id);
      onValidationChange();return;
    }
    incomplete.delete(id);
    if(parsed.error){setError(id,parsed.error);onValidationChange();return;}
    setError(id);
    if(blur)drafts.delete(id);
    const current=(editor.get()[property] as unknown as Record<string,unknown>)[key];
    if(JSON.stringify(current)===JSON.stringify(parsed.value)){
      if(blur)field.value=format(current,kind);
      onValidationChange();return;
    }
    return save(settings=>{(settings[property] as unknown as Record<string,unknown>)[key]=parsed.value;}).then(()=>{
      if(blur && !drafts.has(id))field.value=format((editor.get()[property] as unknown as Record<string,unknown>)[key],kind);
    });
  }
  function resetDrafts(group?: string): void {
    for(const [name,{fields}] of Object.entries(groups)){
      if(group && name!==group)continue;
      for(const key of Object.keys(fields)){const id=idFor(name,key);drafts.delete(id);incomplete.delete(id);setError(id);}
    }
  }
  function bind(): void {
    for(const [group,{property,fields,defaults}] of Object.entries(groups)){
      for(const [key,[kind]] of Object.entries(fields)){
        const field=node(idFor(group,key)),type=['checkbox','select','provider','writeBack'].includes(kind)?'change':'input';
        field.addEventListener(type,()=>commit(group,key));
        if(type==='input')field.addEventListener('blur',()=>commit(group,key,{blur:true}));
      }
      node('reset-'+group+'-options')?.addEventListener('click',()=>{
        resetDrafts(group);return save(settings=>{(settings as unknown as Record<string,unknown>)[property]=structuredClone(defaults);});
      });
    }
    for(const group of ['selection','input'] as const)node(group+'-swap-languages').addEventListener('click',()=>save(settings=>{
      const options=settings[groups[group].property] as LanguageOptions,source=resolvedSource(settings,options);
      if(source==='auto')return;
      options.sourceLanguage=options.targetLanguage==='follow_page'?settings.targetLanguage:options.targetLanguage;options.targetLanguage=source;
    }));
  }
  const invalidGroups=(): string[]=>[...new Set([...errors.keys()].map(id=>id.slice(0,id.indexOf('-option-'))))];
  return {render,bind,resetDrafts,validationCount:()=>errors.size,incompleteCount:()=>incomplete.size,invalidGroups};
}
