/** Public configuration schema. Provider secrets are exposed only to extension pages. */
import { normalizePageStyle, normalizeSubtitleStyle, SUBTITLE_STYLE_DEFAULTS } from './presentation.js';
import { normalizeInteractionOptions, normalizeShortcut } from './interactions.js';
export interface Provider {
  id: string; type: string; name: string; enabled: boolean;
  baseUrl?: string; apiKey?: string; model: string; region?: string; temperature: number | null;
}
export interface SubtitleTrackPreference {languageCode:string;kind:string;name:string}
export type Settings = ReturnType<typeof defaultSettings>;
export type PublicSettings = Settings;
type LegacyRecord = Record<string, any>;

export const APP_NAME = 'Kuai translate';
export const SETTINGS_KEY = 'kuai.settings.v1';
export const PROVIDER_TYPES = Object.freeze(['microsoft','google','transmart','yandex','openai','gemini','anthropic','azure','deepl','deeplx','ollama']);
export const FREE_PROVIDERS = Object.freeze([
  ['microsoft','微软翻译'], ['google','谷歌翻译'], ['transmart','腾讯 Transmart'], ['yandex','Yandex'],
].map(([id,name]) => Object.freeze({id,name,type:id,enabled:true,baseUrl:'',apiKey:'',model:'',region:'',temperature:0.2})));
const freeIds = new Set(FREE_PROVIDERS.map(provider => provider.id));
// Historic backups contain nested, provider-specific records; validate before normalization.
const plain = (value: unknown): value is LegacyRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback='', limit=8192) => typeof value === 'string' ? value.slice(0,limit) : fallback;
const flag = (value: unknown, fallback:boolean) => typeof value === 'boolean' ? value : fallback;

const version=(value:unknown,minimum:number):number=>Number.isSafeInteger(value)&&(value as number)>=minimum?value as number:minimum;
const legacySubtitleVisual:Record<string,string|number>={sourceFontSize:20,targetFontSize:24,sourceColor:'#e5e7eb',targetColor:'#ffffff',sourceWeight:400,targetWeight:600,sourceStroke:'none',targetStroke:'normal',fontFamily:'system-ui, sans-serif',backgroundColor:'#080c15',backgroundOpacity:86};

/** Semantic source choice only: signed URLs and video identities never persist. */
export function normalizeSubtitleTrackPreference(input?:unknown):SubtitleTrackPreference {
  const automatic={languageCode:'',kind:'',name:''};
  if(!plain(input))return automatic;
  const languageCode=typeof input.languageCode==='string'?input.languageCode.trim():'',kind=input.kind??'',name=input.name??'';
  if(!languageCode||languageCode.length>32||!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(languageCode)||!['','asr'].includes(kind)||typeof name!=='string')return automatic;
  return {languageCode,kind,name:name.trim().slice(0,200)};
}

export function defaultSettings() {
  return {
    schemaVersion:1, inputDefaultsVersion:3, paragraphDefaultsVersion:1, subtitleStyleDefaultsVersion:2, providerRevision:0, providers:structuredClone(FREE_PROVIDERS) as Provider[],
    activeProviderId:'microsoft', subtitleProviderId:'follow_page',
    sourceLanguage:'auto', targetLanguage:'zh-Hans', interfaceLanguage:'auto',
    subtitlesEnabled:true, selectionEnabled:false, hoverEnabled:true, showOriginal:true,
    pageDisplayMode:'bilingual',pageStyle:normalizePageStyle(),
    subtitleTargetLanguage:'follow_page',subtitleStyle:normalizeSubtitleStyle(),
    subtitleTrackPreference:normalizeSubtitleTrackPreference(),subtitleListOpen:false,
    ...normalizeInteractionOptions({},FREE_PROVIDERS),
  };
}

function language(value:unknown, fallback:string, allowAuto=false) {
  const candidate=text(value,fallback,32).trim();
  if ((allowAuto && candidate==='auto') || /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(candidate)) return candidate;
  throw new Error('语言代码无效 / Invalid language code');
}

function providerConfig(input:unknown):Provider {
  if (!plain(input)) throw new Error('翻译服务配置无效 / Invalid provider configuration');
  const id=text(input.id,'',80), type=text(input.type);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) throw new Error('翻译服务 ID 无效 / Invalid provider ID');
  if (!PROVIDER_TYPES.includes(type)) throw new Error('不支持的服务类型 / Unsupported provider type');
  if (freeIds.has(id)) {
    const builtIn=FREE_PROVIDERS.find(provider=>provider.id===id)!;
    if (type!==id) throw new Error('免费服务 ID 不能用于自配 API');
    return {...builtIn,enabled:flag(input.enabled,true)};
  }
  if (freeIds.has(type)) throw new Error('免费服务使用内置条目，无需创建副本');
  const baseUrl=text(input.baseUrl).trim();
  if (baseUrl) {
    let url;
    try { url=new URL(baseUrl); } catch { throw new Error('API 地址无效 / Invalid API URL'); }
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址只能使用 HTTP/HTTPS，凭据请填写在 API Key 中');
  }
  const temperature=input.temperature==null || typeof input.temperature==='string' && !input.temperature.trim() ? null : Number(input.temperature);
  return {
    id,type,name:text(input.name,type,120).trim() || type,enabled:flag(input.enabled,true),
    baseUrl,apiKey:text(input.apiKey),model:text(input.model,'',200).trim(),region:text(input.region,'',100).trim(),
    temperature:temperature===null ? null : Number.isFinite(temperature) ? Math.min(2,Math.max(0,temperature)) : 0.2,
  };
}

export function normalizeSettings(input:unknown):Settings {
  if (!plain(input)) throw new Error('设置格式无效 / Invalid settings');
  if (input.providers!==undefined && !Array.isArray(input.providers)) throw new Error('翻译服务列表格式无效');
  const items: readonly unknown[]=input.providers ?? FREE_PROVIDERS;
  if (items.length>80) throw new Error('最多保存 80 个翻译服务');
  const seen=new Set(), providers=items.map(item=>{
    const provider=providerConfig(item);
    if (seen.has(provider.id)) throw new Error('翻译服务 ID 重复 / Duplicate provider ID');
    seen.add(provider.id);return provider;
  });
  for (const builtIn of [...FREE_PROVIDERS].reverse()) if (!seen.has(builtIn.id)) providers.unshift({...builtIn});
  const enabled=(id:unknown)=>providers.some(provider=>provider.id===id && provider.enabled);
  const active=enabled(input.activeProviderId) ? input.activeProviderId : providers.find(provider=>provider.enabled)?.id || '';
  let styleInput=input.subtitleStyle;
  if(input.schemaVersion===1&&version(input.subtitleStyleDefaultsVersion,0)<1&&plain(styleInput)&&!Object.hasOwn(styleInput,'backgroundMode')){
    const keys=Object.keys(legacySubtitleVisual),wasDefault=keys.every(key=>styleInput[key]===legacySubtitleVisual[key]);
    if(wasDefault)styleInput={...styleInput,...Object.fromEntries(keys.map(key=>[key,SUBTITLE_STYLE_DEFAULTS[key as keyof typeof SUBTITLE_STYLE_DEFAULTS]])),backgroundMode:SUBTITLE_STYLE_DEFAULTS.backgroundMode,fontSizeMode:'responsive'};
    else if(keys.some(key=>Object.hasOwn(styleInput,key)))styleInput={...styleInput,backgroundMode:'panel'};
  }
  if(input.schemaVersion===1&&version(input.subtitleStyleDefaultsVersion,0)<2&&plain(styleInput)&&!Object.hasOwn(styleInput,'fontSizeMode')){
    const prior={sourceFontSize:24,targetFontSize:24,sourceColor:'#ffffff',targetColor:'#ffffff',sourceWeight:400,targetWeight:400,sourceStroke:'none',targetStroke:'none',fontFamily:'system-ui, sans-serif',backgroundColor:'#000000',backgroundOpacity:50,backgroundMode:'line'};
    const wasDefault=Object.entries(prior).every(([key,value])=>styleInput[key]===value);
    styleInput=wasDefault?{...styleInput,fontSizeMode:'responsive',sourceStroke:'soft',targetStroke:'soft',backgroundMode:'panel'}:{...styleInput,fontSizeMode:'fixed'};
  }
  const subtitleStyle=normalizeSubtitleStyle(styleInput);
  if (!['bilingual','translation_only'].includes(input.subtitleStyle?.displayMode))
    subtitleStyle.displayMode=flag(input.showOriginal,true) ? 'bilingual' : 'translation_only';
  // Versioned defaults migrate once; subsequent explicit choices remain valid.
  const legacyInputDefaults=input.schemaVersion===1 && version(input.inputDefaultsVersion,0)<1 &&
    input.inputOptions?.targetLanguage==='follow_page' && input.inputOptions?.icon==='none';
  const chineseInputDefault=input.schemaVersion===1&&input.inputDefaultsVersion===1&&input.inputOptions?.targetLanguage==='zh-Hans';
  let interactionInput=legacyInputDefaults?{...input,inputOptions:{...input.inputOptions,targetLanguage:'en',icon:'dot'}}:
    chineseInputDefault?{...input,inputOptions:{...input.inputOptions,targetLanguage:'en'}}:input;
  // Alt+X already restores its own unedited translation; the old second key only shadowed redo.
  if(input.schemaVersion===1&&version(input.inputDefaultsVersion,0)<3&&normalizeShortcut(input.inputOptions?.restoreShortcut)==='Control+Shift+Z')
    interactionInput={...interactionInput,inputOptions:{...interactionInput.inputOptions,restoreShortcut:''}};
  if(input.schemaVersion===1&&version(input.paragraphDefaultsVersion,0)<1&&input.hoverOptions?.trigger==='alt')
    interactionInput={...interactionInput,hoverOptions:{...input.hoverOptions,trigger:'shift'}};
  return {
    schemaVersion:1,inputDefaultsVersion:version(input.inputDefaultsVersion,3),paragraphDefaultsVersion:version(input.paragraphDefaultsVersion,1),subtitleStyleDefaultsVersion:version(input.subtitleStyleDefaultsVersion,2),providerRevision:Number.isSafeInteger(input.providerRevision)&&input.providerRevision>=0?input.providerRevision:0,providers,activeProviderId:active,
    subtitleProviderId:input.subtitleProviderId==='follow_page' || !enabled(input.subtitleProviderId) ? 'follow_page' : input.subtitleProviderId,
    sourceLanguage:language(input.sourceLanguage,'auto',true),targetLanguage:language(input.targetLanguage,'zh-Hans'),
    interfaceLanguage:['auto','en','zh-CN'].includes(input.interfaceLanguage) ? input.interfaceLanguage : 'auto',
    subtitlesEnabled:flag(input.subtitlesEnabled,true),selectionEnabled:flag(input.selectionEnabled,false),
    hoverEnabled:flag(input.hoverEnabled,true),showOriginal:subtitleStyle.displayMode!=='translation_only',
    pageDisplayMode:input.pageDisplayMode==='translation_only' ? 'translation_only' : 'bilingual',
    pageStyle:normalizePageStyle(input.pageStyle),subtitleStyle,
    subtitleTrackPreference:normalizeSubtitleTrackPreference(input.subtitleTrackPreference),subtitleListOpen:flag(input.subtitleListOpen,false),
    subtitleTargetLanguage:input.subtitleTargetLanguage==null || input.subtitleTargetLanguage==='follow_page' ? 'follow_page' : language(input.subtitleTargetLanguage,'zh-Hans'),
    ...normalizeInteractionOptions(interactionInput,providers),
  };
}

export function publicSettings(settings:unknown):PublicSettings {
  const value=normalizeSettings(settings);
  value.providers=value.providers.map(({apiKey,baseUrl,region,...provider})=>provider);
  return value;
}

function redactEndpoint(value:string|undefined) {
  if (!value) return value;
  try {
    const url=new URL(value);
    url.hash='';
    for (const key of [...url.searchParams.keys()]) if (/key|token|secret|auth|password|signature/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}

export function exportSettings(settings:unknown, {includeSecrets=false}={}) {
  const value=normalizeSettings(settings);
  if (!includeSecrets) for (const provider of value.providers) {
    provider.apiKey='';provider.baseUrl=redactEndpoint(provider.baseUrl);
  }
  return {app:APP_NAME,formatVersion:1,secretsIncluded:!!includeSecrets,settings:value};
}

const openAICompatible=new Set(['openai','openrouter','deepseek','qwen','zhipu','doubao','siliconflow','kimi','grok','mistral','minimax','hunyuan','xiaomimimo','customai']);
const legacyTypes:Record<string,string>={microsoft:'azure',gemini:'gemini',claude:'anthropic',deepl:'deepl',deeplx:'deeplx',ollama:'ollama'};
function readJSON(value:any):any { return typeof value==='string' ? JSON.parse(value) : value; }

const legacyThemes:Record<string,string>={
  ztsl_theme_none:'plain',ztsl_theme_thin_dashed_underline:'thin-dashed',ztsl_theme_dashed_underline:'dashed',
  ztsl_theme_dotted_underline:'dotted',ztsl_theme_background_color:'background',ztsl_theme_transparent_text:'transparent',
  ztsl_theme_orange_underline:'orange-underline',ztsl_theme_straight_underline:'underline',ztsl_theme_underline_tilde:'wavy',
  ztsl_theme_marker:'marker',ztsl_theme_highlight:'highlight',ztsl_theme_blur_cover:'blur',
  ztsl_theme_italic:'italic',ztsl_theme_bold:'bold',ztsl_theme_dashed_border:'dashed-border',
};
const legacySizes:Record<string,number>={smallest:16,smaller:20,medium:24,larger:32,largest:40};
const legacyColor=(value:any)=>typeof value==='string' && /^#[a-f0-9]{3}$/i.test(value) ? '#'+[...value.slice(1)].map(character=>character+character).join('') : value;
function legacyPresentation(legacy:LegacyRecord) {
  const theme=legacy.transTheme, candidate=legacy.transThemeConfig?.[theme];
  const custom=plain(candidate) && candidate.isCustom!=='0' ? candidate : {};
  const accent=legacyColor(custom.boderColor || custom.borderColor);
  let preset=legacyThemes[theme];
  if (preset==='plain' && /^#[a-f0-9]{6}$/i.test(accent || '')) preset='background';
  const pageStyle=normalizePageStyle({
    preset,fontSize:custom.zoomRatio,fontWeight:custom.fontWeight,fontFamily:custom.fontFamily,
    textColor:legacyColor(custom.textColor),accentColor:accent,
    backgroundColor:['background','marker','highlight'].includes(preset) ? accent : undefined,
    // Legacy opacity was only used by its transparent-text theme; other themes also stored 10.
    opacity:preset==='transparent' ? custom.opacity ?? 10 : 100,
  });
  const video=plain(legacy.videoSubtitlesConfig) ? legacy.videoSubtitlesConfig : {};
  const style=plain(video.styleConfig) ? video.styleConfig : {};
  const displayMode=['bilingual','translation_only'].includes(video.transDisplayMode) ? video.transDisplayMode :
    video.showOriginal==='0' || video.showOriginal===false ? 'translation_only' : 'bilingual';
  const opacity=style.background?.opacity;
  const subtitleStyle=normalizeSubtitleStyle({
    displayMode,displayOrder:style.displayOrder,hideTranslation:video.hideTranslation==='1' || video.hideTranslation===true,
    sourceFontSize:legacySizes[style.fontSize?.source] ?? style.fontSize?.source,
    targetFontSize:legacySizes[style.fontSize?.target] ?? style.fontSize?.target,
    sourceColor:legacyColor(style.fontColor?.source),targetColor:legacyColor(style.fontColor?.target),
    sourceWeight:style.fontWeight?.source,targetWeight:style.fontWeight?.target,
    sourceStroke:style.textStroke?.source,targetStroke:style.textStroke?.target,
    fontFamily:style.fontFamily,backgroundColor:legacyColor(style.background?.color),
    backgroundOpacity:opacity!=null && opacity!=='' ? Number(opacity)*100 : undefined,
    position:style.defaultPosition,
  });
  return {
    pageDisplayMode:legacy.transDisplayMode==='translation_only' ? 'translation_only' : 'bilingual',pageStyle,subtitleStyle,
    subtitleTargetLanguage:!video.targetLanguageZingCode || video.targetLanguageZingCode==='follow_webpage' ? 'follow_page' : video.targetLanguageZingCode,
  };
}

const legacyFlag=(value:unknown)=>value==='1' || value===true?true:value==='0' || value===false?false:undefined;
const legacyFollow=(value:unknown)=>value==='follow_webpage'?'follow_page':value;
function assignLegacyFlag(target:LegacyRecord,key:string,value:unknown) {
  const enabled=legacyFlag(value);
  if(enabled!==undefined) target[key]=enabled;
}
function assignLegacyValue(target:LegacyRecord,key:string,value:unknown) {
  if(value!==undefined) target[key]=value;
}
function legacyRuleRecord(input:unknown):LegacyRecord {
  try { const parsed=readJSON(input);return plain(parsed?.urlConfigs)?parsed.urlConfigs:{}; }
  catch { return {}; }
}

/** Migrate public behavior choices only; unsupported scoring and gesture modes stay out of this schema. */
function legacyInteractions(legacy:LegacyRecord,wrapper:LegacyRecord,value:Settings,ids:Map<string,string>) {
  const page=value.pageOptions,selection=value.selectionOptions,typed=value.inputOptions,hover=value.hoverOptions;
  const shortcuts=plain(legacy.shortcutKeysConfig)?legacy.shortcutKeysConfig:{};
  const input=plain(legacy.inputTranslateConfig)?legacy.inputTranslateConfig:{};
  const service=(key:string)=>{
    const id=ids.get(key) || (freeIds.has(key)?key:'');
    return value.providers.some(provider=>provider.id===id && provider.enabled)?id:'follow_page';
  };
  assignLegacyFlag(value,'selectionEnabled',legacy.selectionTranslationEnable);
  assignLegacyFlag(value,'hoverEnabled',legacy.hoverTransEnable);
  assignLegacyFlag(page,'translateFullPage',legacy.isTransAllPageArea);
  assignLegacyFlag(page,'contextMenuEnabled',legacy.pageRightClickMenuEnable);
  assignLegacyValue(page,'alwaysLanguages',legacy.alwaysTranslateLanguages);
  assignLegacyValue(page,'neverLanguages',legacy.neverTranslateLanguages);
  assignLegacyValue(page,'shortcut',shortcuts.pageTransShortcutKey ?? legacy.pageTransShortcutKey);
  assignLegacyValue(page,'displayModeShortcut',shortcuts.translationModeShortcutKey ?? legacy.translationModeShortcutKey);

  if(legacy.selectionTranslationEngine!==undefined) selection.providerId=service(legacy.selectionTranslationEngine);
  assignLegacyValue(selection,'sourceLanguage',legacyFollow(legacy.selectionTranslationSourceLangZingCode ?? legacy.selectionTranslationSourceLang));
  assignLegacyValue(selection,'targetLanguage',legacyFollow(legacy.selectionTranslationTargetLangZingCode ?? legacy.selectionTranslationTargetLang));
  assignLegacyValue(selection,'triggerMode',legacy.selectionTranslationTriggerMode);
  assignLegacyValue(selection,'triggerAction',legacy.selectionTranslationTriggerAction);
  assignLegacyFlag(selection,'autoSpeak',legacy.selectionTranslationTriggerRead);

  const hoverTriggers:Record<string,string>={HoverCtrl:'ctrl',HoverShift:'shift',HoverAlt:'alt',HoldLeftClick:'left_hold',Hover:'hover',Custom:'custom'};
  if(Object.hasOwn(hoverTriggers,legacy.hoverTransShortcutKey)) hover.trigger=hoverTriggers[legacy.hoverTransShortcutKey];
  assignLegacyValue(hover,'mode',legacy.hoverTransMode);
  assignLegacyFlag(hover,'showIndicator',legacy.hoverTransBluePointEnable);
  assignLegacyValue(hover,'borderColor',legacyColor(legacy.hoverTransHoverBorderColor));
  const customKeys=[shortcuts.hoverTransShortcutKeyCustom1 ?? legacy.hoverTransShortcutKeyCustom1,shortcuts.hoverTransShortcutKeyCustom2 ?? legacy.hoverTransShortcutKeyCustom2];
  if(customKeys.some(key=>key!==undefined)) hover.customKeys=customKeys;

  assignLegacyFlag(typed,'enabled',input.isEnable);
  assignLegacyValue(typed,'sourceLanguage',legacyFollow(input.sourceLanguageZingCode ?? input.sourceLanguage));
  assignLegacyValue(typed,'targetLanguage',legacyFollow(input.targetLanguageZingCode));
  // Multi-model scoring does not exist in this release. Do not select its first candidate or a dormant single-model choice.
  if(input.inputTransMode!=='multi' && input.singleModel!==undefined) typed.providerId=service(input.singleModel);
  assignLegacyValue(typed,'shortcut',shortcuts.inputTransShortcutKey ?? input.inputTransShortcutKey);
  assignLegacyValue(typed,'restoreShortcut',input.restoreOriginalShortcutKey);
  if(input.inputBoxIcon!==undefined) typed.icon=input.inputBoxIcon;
  else if(legacyFlag(input.isInputIcon)!==undefined) typed.icon=legacyFlag(input.isInputIcon)?'icon':'none';
  assignLegacyFlag(typed,'includeOriginal',input.originalTextSwitch);
  assignLegacyValue(typed,'displayOrder',input.displayOrder);

  for(const rules of [legacyRuleRecord(legacy.translationUrlPattern),legacyRuleRecord(wrapper.translationUrlPattern)]) {
    for(const [pattern,rule] of Object.entries(rules)) {
      if(!plain(rule)) continue;
      if(legacyFlag(rule.alwaysTranslate)===true) page.alwaysSites.push(pattern);
      if(legacyFlag(rule.neverTranslate)===true) page.neverSites.push(pattern);
      // These historical "disable" fields used zero to mean disabled.
      if(legacyFlag(rule.disableInputTranslation)===false) typed.disabledSites.push(pattern);
      if(legacyFlag(rule.disableSelectionTranslation)===false) selection.disabledSites.push(pattern);
    }
  }
  const normalized=normalizeInteractionOptions(value,value.providers);
  if(legacyFlag(legacy.isAutoTransEnPage)===true && !normalized.pageOptions.alwaysLanguages.length)
    normalized.pageOptions.alwaysLanguages=['en'];
  normalized.pageOptions.autoTranslate=normalized.pageOptions.alwaysLanguages.length>0 || normalized.pageOptions.alwaysSites.length>0;
  Object.assign(value,normalized);
}

function importLegacy(input:LegacyRecord):Settings {
  let legacy=readJSON(input.member_settings ?? input.settings ?? input);
  if (plain(legacy?.member_settings)) legacy=legacy.member_settings;
  if (!plain(legacy?.translationEngineConfig)) throw new Error('无法识别的设置备份 / Unrecognized settings backup');
  const value=defaultSettings(), ids=new Map<string,string>(), configs=legacy.translationEngineConfig;
  for (const [key,own] of Object.entries(configs)) {
    if (!plain(own) || /:[^:]+:(?:free|plus|pro)$/.test(key)) continue;
    if (freeIds.has(key) && own.serviceMode==='free') {
      value.providers.find(provider=>provider.id===key)!.enabled=own.engineEnable!=='0';ids.set(key,key);continue;
    }
    const base=text(own.baseEngineKey,key.split('__inst_')[0]), baseConfig=plain(configs[base]) ? configs[base] : {};
    const config={...baseConfig,...own};
    if (config.serviceMode!=='custom') continue;
    const type=openAICompatible.has(base) ? 'openai' : legacyTypes[base];
    if (!type) continue;
    const baseUrl=text(config.apiUrl).trim();
    try {
      if (baseUrl && /(^|\.)selecttranslate\.com$/i.test(new URL(baseUrl).hostname.replace(/\.+$/,''))) continue;
      const id='imported-'+key.replace(/[^a-z0-9_-]/gi,'_').slice(0,60);
      if (value.providers.some(provider=>provider.id===id)) continue;
      value.providers.push(providerConfig({id,type,name:config.name || config.engineName || key,enabled:config.engineEnable!=='0',baseUrl,
        apiKey:config.apiKey,model:config.model,region:config.apiRegion,temperature:config.temperature}));
      ids.set(key,id);
    } catch { /* An unsupported legacy entry cannot make safe entries unusable. */ }
  }
  value.activeProviderId=ids.get(legacy.translationEngine) || value.activeProviderId;
  value.subtitleProviderId=ids.get(legacy.videoSubtitlesConfig?.translationEngine) || 'follow_page';
  value.subtitlesEnabled=legacy.videoSubtitlesConfig?.isEnable!=='0';
  Object.assign(value,legacyPresentation(legacy));
  if (legacy.sourceLanguageZingCode) value.sourceLanguage=legacy.sourceLanguageZingCode;
  if (legacy.targetLanguageZingCode) value.targetLanguage=legacy.targetLanguageZingCode;
  legacyInteractions(legacy,input,value,ids);
  return normalizeSettings(value);
}

export function importSettings(data:unknown, current=defaultSettings()) {
  const input=readJSON(data);
  if (!plain(input)) throw new Error('设置备份必须是 JSON 对象');
  if (input.app===APP_NAME || (input.schemaVersion===1 && Array.isArray(input.providers))) {
    if (input.formatVersion!==undefined && input.formatVersion!==1) throw new Error('此备份版本尚不支持');
    const value=normalizeSettings(input.settings ?? input);
    if (input.secretsIncluded===false) for (const provider of value.providers) {
      const previous=current.providers?.find(item=>item.id===provider.id && item.type===provider.type);
      if (previous && provider.baseUrl===redactEndpoint(previous.baseUrl) && !provider.apiKey) provider.apiKey=previous.apiKey || '';
    }
    return value;
  }
  return importLegacy(input);
}
