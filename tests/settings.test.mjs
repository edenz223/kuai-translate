import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,normalizeSettings,exportSettings,importSettings,publicSettings} from '../dist/src/shared/settings.js';
import {mergeSettings} from '../dist/src/background/settings-merge.js';
import {resolveFeatureSettings} from '../dist/src/shared/interactions.js';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createInteractions} from '../dist/src/content/interactions.js';
import * as settings from '../dist/src/shared/settings.js';
import * as helpers from '../dist/src/shared/interactions.js';
import * as presentation from '../dist/src/shared/presentation.js';

function defaults() { assert.equal(typeof settings.defaultSettings, 'function'); return settings.defaultSettings(); }

test('a fresh installation selects a free Microsoft provider without any credential', () => {
  const value = defaults();
  assert.equal(value.activeProviderId, 'microsoft');
  assert.deepEqual(value.providers.map(provider => provider.id), ['microsoft', 'google', 'transmart', 'yandex']);
  assert.ok(value.providers.every(provider => provider.enabled && !provider.apiKey));
  value.providers[0].enabled = false;
  assert.equal(defaults().providers[0].enabled, true);
});

test('editing an incomplete named API instance is allowed while duplicate IDs are rejected', () => {
  const value = defaults();
  value.providers.push({ id:'my-ai', name:'My AI', type:'openai', enabled:true, apiKey:'', model:'', baseUrl:'https://example.com/v1' });
  value.activeProviderId = 'my-ai';
  const normalized = settings.normalizeSettings(value);
  assert.equal(normalized.activeProviderId, 'my-ai');
  assert.equal(normalized.providers.at(-1).baseUrl, 'https://example.com/v1');
  assert.throws(() => settings.normalizeSettings({...value,providers:[...value.providers,value.providers[0]]}), /重复|duplicate/i);
});

test('custom prompts default to empty, are capped and survive saving and backup',()=>{
  const value=defaults();value.providers.push({id:'api',type:'openai',enabled:true,systemPrompt:'Be formal.',userPrompt:'x'.repeat(9000)});
  const normalized=settings.normalizeSettings(value),provider=normalized.providers.at(-1);
  assert.equal(provider.systemPrompt,'Be formal.');assert.equal(provider.userPrompt.length,8000);
  assert.equal(settings.importSettings(settings.exportSettings(normalized),normalized).providers.at(-1).systemPrompt,'Be formal.');
  value.providers.push({id:'bare',type:'openai',enabled:true});
  assert.deepEqual([settings.normalizeSettings(value).providers.at(-1).systemPrompt,settings.normalizeSettings(value).providers.at(-1).userPrompt],['','']);
});

test('disabling a selected service reconciles selection without turning it on again', () => {
  const value = defaults(); value.providers[0].enabled = false;
  const once = settings.normalizeSettings(value), twice = settings.normalizeSettings(once);
  assert.equal(once.activeProviderId, 'google');
  assert.equal(twice.providers[0].enabled, false);
  once.providers.forEach(provider => {provider.enabled=false;});
  assert.equal(settings.normalizeSettings(once).activeProviderId, '');
});

test('public settings omit keys and private endpoints and cannot mutate stored settings', () => {
  const value = defaults(); value.providers.push({id:'private',name:'Private',type:'openai',enabled:true,baseUrl:'https://private.example/v1',apiKey:'test-secret',model:'custom'});
  const publicValue = settings.publicSettings(value);
  assert.equal(JSON.stringify(publicValue).includes('test-secret'), false);
  assert.equal(JSON.stringify(publicValue).includes('private.example'), false);
  publicValue.providers[0].name='Changed';
  assert.notEqual(value.providers[0].name,'Changed');
});

test('exports omit keys by default and importing redacted own settings preserves existing keys', () => {
  const value=defaults(); value.providers.push({id:'api',name:'API',type:'openai',enabled:true,baseUrl:'https://example.com/v1',apiKey:'test-secret',model:'gpt-test'});
  const safe=settings.exportSettings(value);
  assert.equal(JSON.stringify(safe).includes('test-secret'),false);
  assert.equal(settings.importSettings(safe,value).providers.find(provider=>provider.id==='api').apiKey,'test-secret');
  assert.equal(settings.exportSettings(value,{includeSecrets:true}).settings.providers.at(-1).apiKey,'test-secret');
});

test('invalid endpoint schemes, URL credentials and invalid settings structures are rejected', () => {
  const value=defaults();
  for(const baseUrl of ['javascript:alert(1)','https://user:secret@example.com/v1']) {
    assert.throws(()=>settings.normalizeSettings({...value,providers:[...value.providers,{id:'x',name:'X',type:'openai',enabled:true,baseUrl}]}));
  }
  assert.throws(()=>settings.importSettings({unrelated:'file'}));
  assert.throws(()=>settings.normalizeSettings({...value,providers:'broken'}));
});
test('a redacted import cannot transfer an existing key to a changed API endpoint',()=>{
  const current=defaults();current.providers.push({id:'api',type:'openai',name:'API',enabled:true,baseUrl:'https://original.example/v1',apiKey:'test-secret',model:'m'});
  const backup=settings.exportSettings(current);backup.settings.providers.at(-1).baseUrl='https://different.example/v1';
  assert.equal(settings.importSettings(backup,current).providers.at(-1).apiKey,'');
});

test('legacy structured theme and subtitle styles migrate without importing arbitrary CSS',()=>{
  const legacy={translationEngineConfig:{},transDisplayMode:'translation_only',transTheme:'ztsl_theme_dashed_underline',
    transThemeConfig:{ztsl_theme_dashed_underline:{isCustom:'1',zoomRatio:125,boderColor:'#AABBCC',textColor:'#123456',fontWeight:600,fontFamily:'思源黑体, sans-serif',opacity:10,value:'background:url(private-legacy-css)'}},
    videoSubtitlesConfig:{transDisplayMode:'translation_only',showOriginal:'1',hideTranslation:'1',targetLanguageZingCode:'ja',styleConfig:{
      background:{color:'#000000',opacity:0.5},fontSize:{source:'smallest',target:'largest'},fontColor:{source:'#ABCDEF',target:'#123456'},
      fontWeight:{source:300,target:700},textStroke:{source:'light',target:'shadow45'},displayOrder:'translation_on_top',defaultPosition:'top-right',
    }}};
  const value=settings.importSettings(legacy);
  assert.equal(value.pageDisplayMode,'translation_only');assert.equal(value.pageStyle?.preset,'dashed');
  assert.equal(value.pageStyle.fontSize,125);assert.equal(value.pageStyle.accentColor,'#aabbcc');assert.equal(value.pageStyle.textColor,'#123456');
  assert.equal(value.pageStyle.fontWeight,600);assert.equal(value.pageStyle.fontFamily,'思源黑体, sans-serif');assert.equal(value.pageStyle.opacity,100);
  assert.equal(value.subtitleTargetLanguage,'ja');assert.equal(value.subtitleStyle.displayMode,'translation_only');assert.equal(value.showOriginal,false);
  assert.equal(value.subtitleStyle.hideTranslation,true);assert.equal(value.subtitleStyle.backgroundOpacity,50);
  assert.equal(value.subtitleStyle.sourceFontSize,16);assert.equal(value.subtitleStyle.targetFontSize,40);
  assert.equal(value.subtitleStyle.sourceColor,'#abcdef');assert.equal(value.subtitleStyle.targetColor,'#123456');
  assert.equal(value.subtitleStyle.sourceWeight,300);assert.equal(value.subtitleStyle.targetWeight,700);
  assert.equal(value.subtitleStyle.sourceStroke,'light');assert.equal(value.subtitleStyle.targetStroke,'shadow45');
  assert.equal(value.subtitleStyle.displayOrder,'translation_on_top');assert.equal(value.subtitleStyle.position,'top-right');
  assert.equal(JSON.stringify(value).includes('private-legacy-css'),false);
});

const api=name=>{assert.equal(typeof helpers[name],'function',`${name} must be available`);return helpers[name];};

test('existing settings receive compatible interaction defaults without sharing mutable lists',()=>{
  const settings=normalizeSettings({providers:defaultSettings().providers,activeProviderId:'google',hoverEnabled:true});
  assert.deepEqual(settings.pageOptions,{
    autoTranslate:false,alwaysLanguages:[],neverLanguages:[],alwaysSites:[],neverSites:[],translateFullPage:true,
    excludeSelectors:[],minTextLength:1,translateDynamic:false,contextMenuEnabled:true,shortcut:'Alt+Z',displayModeShortcut:'',
  });
  assert.deepEqual(settings.selectionOptions,{
    providerId:'follow_page',sourceLanguage:'follow_page',targetLanguage:'follow_page',triggerMode:'auto',triggerAction:'click',
    delay:250,maxLength:5000,showOriginal:true,autoSpeak:false,disabledSites:[],
  });
  assert.deepEqual(settings.inputOptions,{
    enabled:true,providerId:'follow_page',sourceLanguage:'follow_page',targetLanguage:'en',shortcut:'Alt+X',
    restoreShortcut:'',icon:'dot',autoApply:true,includeOriginal:false,displayOrder:'original-translation',disabledSites:[],
  });
  assert.deepEqual(settings.hoverOptions,{
    trigger:'shift',customKeys:[],mode:'paragraph',displayMode:'inline',delay:300,holdDelay:800,showIndicator:true,borderColor:'#cfcfcf',disabledSites:[],
  });
  assert.equal(settings.hoverEnabled,true);
  settings.pageOptions.alwaysSites.push('example.com');
  settings.hoverOptions.customKeys.push('Z');
  assert.deepEqual(defaultSettings().pageOptions.alwaysSites,[]);
  assert.deepEqual(defaultSettings().hoverOptions.customKeys,[]);
});

test('action shortcuts canonicalize modifiers while invalid or duplicate chords cannot become active',()=>{
  const normalize=api('normalizeShortcut');
  for(const [value,expected] of [
    [' alt + x ','Alt+X'],['ctrl+shift+z','Control+Shift+Z'],['shift+Alt+control+q','Control+Alt+Shift+Q'],
    ['cmd+z','Meta+Z'],['option+x','Alt+X'],['',''],
  ]) assert.equal(normalize(value,'Alt+Z'),expected,value);
  for(const value of ['X','Alt','Alt+4','Ctrl+Ctrl+Z','Alt+X+Y','Alt+F5','Alt++X','Control+Enter',false,{}])
    assert.equal(normalize(value,null),null,String(value));
  assert.equal(normalize('bad','Alt+Z'),'Alt+Z');
});

test('interaction normalization bounds numbers, drops unsupported fields, and reconciles unavailable services',()=>{
  const normalize=api('normalizeInteractionOptions');
  const value=normalize({
    pageOptions:{autoTranslate:true,translateFullPage:false,minTextLength:999,alwaysLanguages:['en','en','auto','fr'],neverLanguages:'ja\nzh-Hans',excludeSelectors:[' .ads ','',22]},
    selectionOptions:{providerId:'missing',sourceLanguage:'auto',targetLanguage:'auto',triggerMode:'invented',delay:-2,maxLength:1.9,autoSpeak:'1'},
    inputOptions:{providerId:'disabled',sourceLanguage:'EN_us',targetLanguage:'ja',shortcut:'ctrl+x',autoApply:false,multi:true},
    hoverOptions:{trigger:'custom',customKeys:['ctrl','CONTROL','z','x'],delay:Infinity,holdDelay:12,borderColor:'#A1b2C3'},
  },[{id:'google',enabled:true},{id:'disabled',enabled:false}]);
  assert.equal(value.pageOptions.autoTranslate,true);assert.equal(value.pageOptions.translateFullPage,false);
  assert.equal(value.pageOptions.minTextLength,200);assert.deepEqual(value.pageOptions.alwaysLanguages,['en','fr']);
  assert.deepEqual(value.pageOptions.neverLanguages,['ja','zh-Hans']);assert.deepEqual(value.pageOptions.excludeSelectors,['.ads']);
  assert.equal(value.selectionOptions.providerId,'follow_page');assert.equal(value.selectionOptions.sourceLanguage,'auto');
  assert.equal(value.selectionOptions.targetLanguage,'follow_page');assert.equal(value.selectionOptions.triggerMode,'auto');
  assert.equal(value.selectionOptions.delay,0);assert.equal(value.selectionOptions.maxLength,1);assert.equal(value.selectionOptions.autoSpeak,false);
  assert.equal(value.inputOptions.providerId,'follow_page');assert.equal(value.inputOptions.sourceLanguage,'en-US');
  assert.equal(value.inputOptions.targetLanguage,'ja');assert.equal(value.inputOptions.shortcut,'Control+X');
  assert.equal(value.inputOptions.autoApply,false);assert.equal('multi' in value.inputOptions,false);
  assert.deepEqual(value.hoverOptions.customKeys,['Control','Z']);assert.equal(value.hoverOptions.delay,300);
  assert.equal(value.hoverOptions.holdDelay,200);assert.equal(value.hoverOptions.borderColor,'#a1b2c3');
  assert.equal(normalize({selectionOptions:{providerId:'named'}}).selectionOptions.providerId,'named');
});

test('site lists normalize host case and reject schemes, credentials and malformed host globs',()=>{
  const normalize=api('normalizeSiteList');
  assert.deepEqual(normalize(' Example.COM \nhttps://*.Example.com/news/**\nexample.com\nhttps://user:pass@example.com/\nfile:///tmp/a\njavaScript:alert(1)\nfoo.*.example.com\nhttps://example.com:99999'),[
    'example.com','https://*.example.com/news/**',
  ]);
  assert.deepEqual(normalize(['*.example.com','*','localhost:8080','https://example.com/path?x=1#part']),[
    '*.example.com','*','localhost:8080','https://example.com/path?x=1#part',
  ]);
});

test('site glob matching obeys hostname boundaries, protocols and path segment wildcards',()=>{
  const listed=api('isSiteListed');
  for(const [url,pattern,expected] of [
    ['https://example.com/a','example.com',true],['https://a.b.example.com/a','example.com',true],
    ['https://notexample.com/a','example.com',false],['https://example.com.evil.test/a','example.com',false],
    ['https://example.com/a','*.example.com',true],['https://sub.example.com/a','*.example.com',true],
    ['http://example.com/a','https://example.com/*',false],['https://example.com/news/a','example.com/news/*',true],
    ['https://example.com/news/a/b','example.com/news/*',false],['https://example.com/news/a/b','example.com/news/**',true],
    ['https://example.com/news/a?lang=ja#top','https://example.com/news/*?lang=ja#top',true],
    ['https://example.com/axb','https://example.com/a.b',false],['https://example.com/a.b','https://example.com/a.b',true],
    ['https://example.com/%E6%96%B0%E9%97%BB/a','https://example.com/新闻/*',true],
    ['http://localhost:8080/a','localhost:8080',true],['http://localhost:8081/a','localhost:8080',false],
    ['file:///tmp/a','*',false],['https://example.com/a','javascript:.*',false],['not a url','example.com',false],
  ]) assert.equal(listed(url,[pattern]),expected,`${url} against ${pattern}`);
});

test('effective feature settings resolve independent services and languages without mutating page or subtitle settings',()=>{
  const resolve=api('resolveFeatureSettings'),settings={
    activeProviderId:'microsoft',sourceLanguage:'auto',targetLanguage:'zh-Hans',providerRevision:3,
    providers:[{id:'microsoft',enabled:true},{id:'google',enabled:true},{id:'off',enabled:false}],
    subtitleProviderId:'google',subtitleTargetLanguage:'ko',
    selectionOptions:{providerId:'google',sourceLanguage:'fr',targetLanguage:'ja'},
    inputOptions:{providerId:'off',sourceLanguage:'follow_page',targetLanguage:'en'},
  };
  const selection=resolve(settings,'selection');
  assert.equal(selection.activeProviderId,'google');assert.equal(selection.sourceLanguage,'fr');assert.equal(selection.targetLanguage,'ja');
  assert.equal(selection.providerRevision,3);assert.equal(selection.subtitleTargetLanguage,'ko');
  const input=resolve(settings,'input');assert.equal(input.activeProviderId,'microsoft');assert.equal(input.sourceLanguage,'auto');assert.equal(input.targetLanguage,'en');
  const hover=resolve(settings,'hover');assert.equal(hover.activeProviderId,'microsoft');assert.equal(hover.targetLanguage,'zh-Hans');
  assert.notEqual(selection,settings);assert.equal(settings.activeProviderId,'microsoft');assert.equal(settings.targetLanguage,'zh-Hans');
});

test('feature settings detect the source instead of sending a same-language pair',()=>{
  const settings={activeProviderId:'microsoft',sourceLanguage:'en',targetLanguage:'zh-Hans',providers:[{id:'microsoft',enabled:true}],
    selectionOptions:{sourceLanguage:'zh_hans',targetLanguage:'follow_page'},inputOptions:{sourceLanguage:'follow_page',targetLanguage:'en'}};
  const input=resolveFeatureSettings(settings,'input');assert.equal(input.sourceLanguage,'auto');assert.equal(input.targetLanguage,'en');
  const selection=resolveFeatureSettings(settings,'selection');assert.equal(selection.sourceLanguage,'auto');assert.equal(selection.targetLanguage,'zh-Hans');
  settings.inputOptions.targetLanguage='ja';assert.equal(resolveFeatureSettings(settings,'input').sourceLanguage,'en');
  settings.inputOptions.targetLanguage='zh-Hant';settings.inputOptions.sourceLanguage='zh-Hans';assert.equal(resolveFeatureSettings(settings,'input').sourceLanguage,'zh-Hans');
  assert.equal(resolveFeatureSettings(settings,'hover').sourceLanguage,'en');
});

test('all four complete interaction groups survive public views and secret-free backup round trips',()=>{
  const value=defaultSettings();
  value.pageOptions={autoTranslate:true,alwaysLanguages:['en'],neverLanguages:['ja'],alwaysSites:['news.example'],neverSites:['blocked.example'],translateFullPage:false,excludeSelectors:['.advert'],minTextLength:8,translateDynamic:true,contextMenuEnabled:false,shortcut:'Control+Z',displayModeShortcut:'Alt+Q'};
  value.selectionOptions={providerId:'google',sourceLanguage:'en',targetLanguage:'fr',triggerMode:'dot',triggerAction:'hover',delay:120,maxLength:1500,showOriginal:false,autoSpeak:true,disabledSites:['private.example']};
  value.inputOptions={enabled:false,providerId:'yandex',sourceLanguage:'auto',targetLanguage:'en',shortcut:'Meta+X',restoreShortcut:'Meta+Shift+Z',icon:'icon',autoApply:false,includeOriginal:true,displayOrder:'translation-original',disabledSites:['mail.example']};
  value.hoverOptions={trigger:'custom',customKeys:['Control','Z'],mode:'area',displayMode:'inline',delay:450,holdDelay:900,showIndicator:false,borderColor:'#123abc',disabledSites:['editor.example']};
  // Action chord order is canonical on disk; this is the same chosen chord.
  value.inputOptions.restoreShortcut='Shift+Meta+Z';
  for(const result of [normalizeSettings(value),publicSettings(value),importSettings(exportSettings(value),value)]) {
    for(const name of ['pageOptions','selectionOptions','inputOptions','hoverOptions']) assert.deepEqual(result[name],value[name]);
  }
  const exported=exportSettings(value);exported.settings.inputOptions.disabledSites.push('changed.example');
  assert.deepEqual(value.inputOptions.disabledSites,['mail.example']);
});

test('legacy explicit interaction fields and safe available service references migrate together',()=>{
  const legacy={
    translationEngine:'google',sourceLanguageZingCode:'auto',targetLanguageZingCode:'zh-Hans',
    translationEngineConfig:{google:{serviceMode:'free',engineEnable:'1'},openai:{serviceMode:'custom',engineEnable:'1',apiUrl:'https://own.example/v1',apiKey:'own-test-key',model:'own-model'}},
    isTransAllPageArea:'0',pageRightClickMenuEnable:'0',alwaysTranslateLanguages:['en'],neverTranslateLanguages:['ja'],
    selectionTranslationEnable:'0',selectionTranslationEngine:'openai',selectionTranslationSourceLangZingCode:'en',selectionTranslationTargetLangZingCode:'fr',
    selectionTranslationTriggerMode:'dot',selectionTranslationTriggerAction:'hover',selectionTranslationTriggerRead:'1',
    hoverTransEnable:'1',hoverTransShortcutKey:'Custom',hoverTransMode:'area',hoverTransBluePointEnable:'0',hoverTransHoverBorderColor:'#ABC',
    shortcutKeysConfig:{pageTransShortcutKey:'Ctrl+Z',translationModeShortcutKey:'Alt+Q',inputTransShortcutKey:'Alt+Y',hoverTransShortcutKeyCustom1:'Control',hoverTransShortcutKeyCustom2:'Z'},
    inputTranslateConfig:{isEnable:'0',sourceLanguageZingCode:'auto',targetLanguageZingCode:'en',inputTransMode:'single',singleModel:'google',inputBoxIcon:'dot',originalTextSwitch:'1',displayOrder:'translation-original',restoreOriginalShortcutKey:'Ctrl+Shift+R'},
  };
  const value=importSettings({member_settings:JSON.stringify(legacy),translationUrlPattern:JSON.stringify({urlConfigs:{
    'news.example':{alwaysTranslate:'1'},'blocked.example':{neverTranslate:'1'},
    'mail.example':{disableInputTranslation:'0'},'search.example':{disableSelectionTranslation:'0'},
    'enabled.example':{disableInputTranslation:'1',disableSelectionTranslation:'1'},
  }})});
  assert.equal(value.pageOptions.autoTranslate,true);assert.equal(value.pageOptions.translateFullPage,false);
  assert.equal(value.pageOptions.contextMenuEnabled,false);assert.equal(value.pageOptions.shortcut,'Control+Z');assert.equal(value.pageOptions.displayModeShortcut,'Alt+Q');
  assert.deepEqual(value.pageOptions.alwaysLanguages,['en']);assert.deepEqual(value.pageOptions.neverLanguages,['ja']);
  assert.deepEqual(value.pageOptions.alwaysSites,['news.example']);assert.deepEqual(value.pageOptions.neverSites,['blocked.example']);
  assert.equal(value.selectionEnabled,false);assert.equal(value.selectionOptions.providerId,'imported-openai');
  assert.equal(value.selectionOptions.sourceLanguage,'en');assert.equal(value.selectionOptions.targetLanguage,'fr');
  assert.equal(value.selectionOptions.triggerMode,'dot');assert.equal(value.selectionOptions.triggerAction,'hover');assert.equal(value.selectionOptions.autoSpeak,true);
  assert.deepEqual(value.selectionOptions.disabledSites,['search.example']);
  assert.equal(value.hoverEnabled,true);assert.equal(value.hoverOptions.trigger,'custom');assert.deepEqual(value.hoverOptions.customKeys,['Control','Z']);
  assert.equal(value.hoverOptions.mode,'area');assert.equal(value.hoverOptions.showIndicator,false);assert.equal(value.hoverOptions.borderColor,'#aabbcc');
  assert.equal(value.inputOptions.enabled,false);assert.equal(value.inputOptions.providerId,'google');assert.equal(value.inputOptions.targetLanguage,'en');
  assert.equal(value.inputOptions.shortcut,'Alt+Y');assert.equal(value.inputOptions.restoreShortcut,'Control+Shift+R');
  assert.equal(value.inputOptions.icon,'dot');assert.equal(value.inputOptions.includeOriginal,true);assert.equal(value.inputOptions.displayOrder,'translation-original');
  assert.deepEqual(value.inputOptions.disabledSites,['mail.example']);
});

test('two settings windows merge independent nested interaction edits without discarding either edit',()=>{
  const base=defaultSettings(),draft=structuredClone(base),current=structuredClone(base);
  draft.pageOptions.minTextLength=12;current.pageOptions.alwaysSites=['news.example'];
  draft.selectionOptions.triggerMode='icon';current.selectionOptions.targetLanguage='ja';
  draft.inputOptions.includeOriginal=true;current.inputOptions.icon='dot';
  draft.hoverOptions.trigger='ctrl';current.hoverOptions.mode='area';
  const result=mergeSettings(base,draft,current);
  assert.equal(result.pageOptions.minTextLength,12);assert.deepEqual(result.pageOptions.alwaysSites,['news.example']);
  assert.equal(result.selectionOptions.triggerMode,'icon');assert.equal(result.selectionOptions.targetLanguage,'ja');
  assert.equal(result.inputOptions.includeOriginal,true);assert.equal(result.inputOptions.icon,'dot');
  assert.equal(result.hoverOptions.trigger,'ctrl');assert.equal(result.hoverOptions.mode,'area');
  assert.deepEqual(base.inputOptions.disabledSites,[]);
});

test('nested interaction conflicts remain explicit while identical concurrent edits are accepted',()=>{
  for(const [group,field,mine,theirs] of [
    ['pageOptions','alwaysSites',['a.example'],['b.example']],['selectionOptions','delay',100,500],
    ['inputOptions','targetLanguage','fr','ja'],['hoverOptions','trigger','ctrl','alt'],
  ]) {
    const base=defaultSettings(),draft=structuredClone(base),current=structuredClone(base);
    draft[group][field]=mine;current[group][field]=theirs;
    assert.throws(()=>mergeSettings(base,draft,current),error=>error.code==='SETTINGS_CONFLICT');
    current[group][field]=mine;assert.deepEqual(mergeSettings(base,draft,current)[group][field],mine);
  }
});

test('new and missing input options use English and a dot independently of the page target',()=>{
  for(const settings of [defaultSettings(),normalizeSettings({targetLanguage:'fr'})]){
    assert.equal(settings.inputOptions.targetLanguage,'en');
    assert.equal(settings.inputOptions.icon,'dot');
    assert.equal(settings.inputOptions.autoApply,true);
    assert.equal(settings.inputDefaultsVersion,3);
    settings.targetLanguage='de';
    assert.equal(resolveFeatureSettings(settings,'input').targetLanguage,'en');
    assert.equal(resolveFeatureSettings(settings,'selection').targetLanguage,'de');
  }
});

function legacy(){
  const settings=defaultSettings();delete settings.inputDefaultsVersion;
  settings.targetLanguage='fr';settings.inputOptions.targetLanguage='follow_page';settings.inputOptions.icon='none';
  settings.providers.push({id:'private',type:'openai',name:'Private API',enabled:true,baseUrl:'https://api.example/v1',apiKey:'fixture-only-secret',model:'own-model',region:'',temperature:null});
  settings.inputOptions.providerId='private';return settings;
}

test('the paired legacy input defaults upgrade once while private API and unrelated choices survive',()=>{
  const old=legacy(),before=structuredClone(old),settings=normalizeSettings(old);
  assert.equal(settings.inputOptions.targetLanguage,'en');assert.equal(settings.inputOptions.icon,'dot');
  assert.equal(settings.inputDefaultsVersion,3);assert.equal(settings.targetLanguage,'fr');
  assert.equal(settings.inputOptions.providerId,'private');assert.equal(settings.providers.at(-1).apiKey,'fixture-only-secret');
  assert.deepEqual(old,before,'migration may not mutate the supplied record');
  assert.deepEqual(normalizeSettings(settings),settings,'normalized settings must be stable');
});

test('the old second restore key is cleared once while custom keys and explicit later choices survive',()=>{
  const stored=version=>{const settings=defaultSettings();settings.inputDefaultsVersion=version;return settings;};
  for(const [version,restoreShortcut,want] of [[2,'Control+Shift+Z',''],[2,'shift+ctrl+z',''],[1,'Control+Shift+Z',''],[2,'Alt+R','Alt+R'],[3,'Control+Shift+Z','Control+Shift+Z']]){
    const old=stored(version);old.inputOptions.restoreShortcut=restoreShortcut;
    const settings=normalizeSettings(old);
    assert.equal(settings.inputOptions.restoreShortcut,want,`${version} ${restoreShortcut}`);assert.equal(settings.inputDefaultsVersion,3);
    assert.deepEqual(normalizeSettings(settings),settings);
  }
  assert.equal(normalizeSettings({inputOptions:{restoreShortcut:'Control+Shift+Z'}}).inputOptions.restoreShortcut,'Control+Shift+Z','unversioned partial values are explicit');
  assert.equal(defaultSettings().inputOptions.restoreShortcut,'');
});

const oldVisual={sourceFontSize:20,targetFontSize:24,sourceColor:'#e5e7eb',targetColor:'#ffffff',sourceWeight:400,targetWeight:600,sourceStroke:'none',targetStroke:'normal',fontFamily:'system-ui, sans-serif',backgroundColor:'#080c15',backgroundOpacity:86};
function v140(){
  const value=defaultSettings();value.inputDefaultsVersion=1;delete value.paragraphDefaultsVersion;delete value.subtitleStyleDefaultsVersion;
  value.inputOptions.targetLanguage='zh-Hans';value.hoverOptions.trigger='alt';
  value.subtitleStyle={...value.subtitleStyle,...oldVisual,offset:125,maxWidth:73};delete value.subtitleStyle.backgroundMode;delete value.subtitleStyle.fontSizeMode;
  value.providers.push({id:'private',type:'openai',name:'Private',enabled:true,baseUrl:'https://api.example/v1',apiKey:'fixture-only-secret',model:'custom',region:'',temperature:null});
  return value;
}
const settle=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};

test('default Shift tap toggles a paragraph once on release and leaves Alt available as a non-trigger',async()=>{
  const h=fixture();Object.assign(h.settings,defaultSettings(),{hoverEnabled:true});
  const page=createPageTranslator(h.dependencies),ui=createInteractions({...h.dependencies,page}).start(),p=h.paragraph('A short paragraph');
  try{
    h.emit(p,'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.advance(5000);await settle();assert.equal(h.requests.length,0);
    h.emit(h.doc,'keyup',{key:'Shift'});await settle();assert.equal(p.querySelector('[data-kuai-page-translation]')?.textContent,'译：A short paragraph');
    h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();assert.equal(p.querySelector('[data-kuai-page-translation]'),null);assert.equal(h.requests.length,1);
    h.emit(h.doc,'keydown',{key:'Alt',altKey:true});h.emit(h.doc,'keyup',{key:'Alt'});await settle();assert.equal(h.requests.length,1);
  }finally{ui.stop();page.stop();}
});

test('1.4 default corrections preserve entry choices and subtitle layout while upgrading only legacy visual defaults',()=>{
  const old=v140();old.inputOptions.icon='icon';const before=structuredClone(old),value=normalizeSettings(old);
  assert.equal(value.inputOptions.targetLanguage,'en');assert.equal(value.inputOptions.icon,'icon');assert.equal(value.hoverOptions.trigger,'shift');
  assert.equal(value.subtitleStyle.sourceFontSize,24);assert.equal(value.subtitleStyle.targetWeight,400);assert.equal(value.subtitleStyle.targetStroke,'soft');
  assert.equal(value.subtitleStyle.backgroundMode,'panel');assert.equal(value.subtitleStyle.backgroundColor,'#000000');assert.equal(value.subtitleStyle.backgroundOpacity,50);
  assert.equal(value.subtitleStyle.offset,125);assert.equal(value.subtitleStyle.maxWidth,73);assert.equal(value.providers.at(-1).apiKey,'fixture-only-secret');
  assert.deepEqual(old,before);assert.deepEqual(normalizeSettings(value),value);
});


test('page and subtitle styles have independent safe defaults suitable for visible bilingual output',()=>{
  assert.equal(typeof presentation.normalizePageStyle,'function');
  assert.equal(typeof presentation.normalizeSubtitleStyle,'function');
  const page=presentation.normalizePageStyle(),subtitle=presentation.normalizeSubtitleStyle();
  assert.deepEqual(page,{preset:'border',fontSize:100,fontWeight:0,fontFamily:'inherit',textColor:'inherit',accentColor:'#4285d4',backgroundColor:'#eef5ff',opacity:100,italic:false,lineHeight:0});
  assert.deepEqual(subtitle,{displayMode:'bilingual',displayOrder:'original_on_top',hideTranslation:false,fontSizeMode:'responsive',sourceFontSize:24,targetFontSize:24,sourceColor:'#ffffff',targetColor:'#ffffff',sourceWeight:400,targetWeight:400,sourceStroke:'soft',targetStroke:'soft',fontFamily:'system-ui, sans-serif',backgroundColor:'#000000',backgroundOpacity:50,backgroundMode:'panel',position:'bottom-center',offset:70,horizontalOffset:0,maxWidth:88});
  page.opacity=0;subtitle.targetFontSize=70;
  assert.equal(presentation.normalizePageStyle().opacity,100);
  assert.equal(presentation.normalizeSubtitleStyle().targetFontSize,24);
});

test('style normalization rejects executable CSS fragments and unknown fields while accepting named Chinese fonts',()=>{
  assert.equal(typeof presentation.normalizePageStyle,'function');
  for(const fontFamily of ['Arial; background:red','url(https://example.com/x)','font:serif','a'.repeat(121),'Arial\nserif']){
    assert.equal(presentation.normalizePageStyle({fontFamily}).fontFamily,'inherit');
    assert.equal(presentation.normalizeSubtitleStyle({fontFamily}).fontFamily,'system-ui, sans-serif');
  }
  const fontFamily='"思源黑体", Noto Sans, sans-serif';
  assert.equal(presentation.normalizePageStyle({fontFamily}).fontFamily,fontFamily);
  const page=presentation.normalizePageStyle({textColor:'url(x)',accentColor:'red',backgroundColor:'#ABCDEF',cssText:'position:fixed',preset:'untrusted'});
  assert.equal(page.textColor,'inherit');assert.equal(page.accentColor,'#4285d4');assert.equal(page.backgroundColor,'#abcdef');
  assert.equal(page.preset,'border');assert.equal(Object.hasOwn(page,'cssText'),false);
});

test('page font defaults migrate once and preserve individually customized values',()=>{
 for(const [weight,height,wantWeight,wantHeight] of [[400,1.6,0,0],[600,1.8,600,1.8],[400,2,0,2],[500,1.6,500,0]]){
  const input=defaultSettings();delete input.pageStyleDefaultsVersion;input.pageStyle.fontWeight=weight;input.pageStyle.lineHeight=height;
  const value=normalizeSettings(input);assert.equal(value.pageStyleDefaultsVersion,1);assert.equal(value.pageStyle.fontWeight,wantWeight);assert.equal(value.pageStyle.lineHeight,wantHeight);
  value.pageStyle.fontWeight=400;value.pageStyle.lineHeight=1.6;
  const again=normalizeSettings(value);assert.equal(again.pageStyle.fontWeight,400);assert.equal(again.pageStyle.lineHeight,1.6);
 }
});
