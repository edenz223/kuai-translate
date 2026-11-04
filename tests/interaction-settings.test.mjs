import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, exportSettings, importSettings, normalizeSettings, publicSettings } from '../dist/src/shared/settings.js';
import { mergeSettings } from '../dist/src/background/settings-merge.js';

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

test('old popup paragraph settings migrate to the page renderer through public settings and backup import',()=>{
  for(const displayMode of ['inline','popup']){
    const value=defaultSettings();value.hoverOptions.displayMode=displayMode;
    value.hoverOptions.customKeys=['Control','K'];value.hoverOptions.trigger='custom';
    value.providers.push({id:'private',type:'openai',name:'My API',enabled:true,baseUrl:'https://own.example/v1',apiKey:'fixture-private-key',model:'my-model'});
    assert.equal(normalizeSettings(value).providers.find(provider=>provider.id==='private').apiKey,'fixture-private-key');
    assert.equal(publicSettings(value).hoverOptions.displayMode,'inline');
    const exported=exportSettings(value);
    assert.equal(exported.settings.hoverOptions.displayMode,'inline');
    const imported=importSettings(JSON.stringify(exported),normalizeSettings(value));
    assert.equal(imported.hoverOptions.displayMode,'inline');
    assert.deepEqual(imported.hoverOptions.customKeys,['Control','K']);
    assert.equal(imported.providers.find(provider=>provider.id==='private').apiKey,'fixture-private-key','reimport restores matching local credentials without putting them in the backup');
    assert.equal(JSON.stringify(exported).includes('fixture-private-key'),false);
  }
});

test('importing a 1.2 backup without hover display selects inline and preserves existing hover preferences',()=>{
  const hoverOptions={trigger:'left_hold',customKeys:['K'],mode:'area',delay:500,holdDelay:1200,showIndicator:false,borderColor:'#123abc',disabledSites:['reader.example']};
  const backup={app:'Kuai translate',formatVersion:1,settings:{schemaVersion:1,hoverEnabled:true,hoverOptions}};
  const current=defaultSettings();current.hoverOptions.displayMode='popup';
  const restored=importSettings(backup,current);
  assert.equal(restored.hoverEnabled,true);
  assert.deepEqual(restored.hoverOptions,{...hoverOptions,displayMode:'inline'});
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

test('legacy missing options receive current defaults and explicit old triggers remain supported',()=>{
  const absent=importSettings({translationEngineConfig:{}});
  assert.equal(absent.hoverOptions.trigger,'shift');assert.equal(absent.selectionOptions.triggerMode,'auto');
  assert.equal(absent.inputOptions.icon,'dot');assert.equal(absent.inputOptions.targetLanguage,'en');assert.equal(absent.pageOptions.translateFullPage,true);assert.equal(absent.pageOptions.autoTranslate,false);
  for(const [legacy,expected] of [['HoverCtrl','ctrl'],['HoverShift','shift'],['HoverAlt','alt'],['HoldLeftClick','left_hold'],['Hover','hover'],['Custom','custom']])
    assert.equal(importSettings({translationEngineConfig:{},hoverTransShortcutKey:legacy}).hoverOptions.trigger,expected);
  const fallback=importSettings({translationEngineConfig:{},inputTranslateConfig:{isInputIcon:'1',inputTransShortcutKey:'Ctrl+Q'},hoverTransShortcutKey:'Custom',hoverTransShortcutKeyCustom1:'Z'});
  assert.equal(fallback.inputOptions.icon,'icon');assert.equal(fallback.inputOptions.shortcut,'Control+Q');assert.deepEqual(fallback.hoverOptions.customKeys,['Z']);
});

test('legacy automatic language or site rules enable bounded opt-in page automation',()=>{
  const languages=importSettings({translationEngineConfig:{},alwaysTranslateLanguages:['en','fr']});
  assert.equal(languages.pageOptions.autoTranslate,true);assert.deepEqual(languages.pageOptions.alwaysLanguages,['en','fr']);
  const historical=importSettings({translationEngineConfig:{},isAutoTransEnPage:'1'});
  assert.equal(historical.pageOptions.autoTranslate,true);assert.deepEqual(historical.pageOptions.alwaysLanguages,['en']);
  const blocked=importSettings({translationEngineConfig:{},translationUrlPattern:{urlConfigs:{'blocked.example':{neverTranslate:'1'}}}});
  assert.equal(blocked.pageOptions.autoTranslate,false);assert.deepEqual(blocked.pageOptions.neverSites,['blocked.example']);
});

test('legacy unsupported scoring, mobile actions and shared service identities cannot appear as working input features',()=>{
  const value=importSettings({translationEngineConfig:{
    google:{serviceMode:'free',engineEnable:'1'},'openai:shared:pro':{serviceMode:'pro',apiKey:'shared-test-secret'},
    openai:{serviceMode:'custom',engineEnable:'0',apiUrl:'https://own.example',apiKey:'disabled-own-key'},
  },selectionTranslationEngine:'openai',hoverTransMobileShortcut:'TripleTap',contextAwareEnable:'1',
  inputTranslateConfig:{inputTransMode:'multi',singleModel:'google',transModelList:['google','openai:shared:pro'],autoApplyBestTranslation:'0',inputBoxIcon:'none',targetLanguageZingCode:'fr'}});
  assert.equal(value.selectionOptions.providerId,'follow_page');assert.equal(value.inputOptions.providerId,'follow_page');
  assert.equal(value.inputOptions.autoApply,true);assert.equal(value.inputOptions.targetLanguage,'fr');
  for(const field of ['inputTransMode','transModelList','autoApplyBestTranslation','hoverTransMobileShortcut','contextAwareEnable'])
    assert.equal(JSON.stringify(value).includes(`"${field}"`),false,field);
  assert.equal(JSON.stringify(value).includes('shared-test-secret'),false);
});

test('legacy malformed rules and unsupported shortcut strings cannot activate translated actions',()=>{
  const value=importSettings({translationEngineConfig:{},hoverTransEnable:'unknown',selectionTranslationEnable:'unknown',
    shortcutKeysConfig:{pageTransShortcutKey:'DoubleCtrl',inputTransShortcutKey:'SpaceSpace'},
    translationUrlPattern:{urlConfigs:{
      'https://user:pass@example.com':{alwaysTranslate:'1',disableInputTranslation:'0'},
      'javascript:alert(1)':{neverTranslate:'1'},'ok.example':{disableInputTranslation:'1'},
    }}});
  assert.equal(value.hoverEnabled,true);assert.equal(value.selectionEnabled,false);assert.equal(value.pageOptions.autoTranslate,false);
  assert.deepEqual(value.pageOptions.alwaysSites,[]);assert.deepEqual(value.pageOptions.neverSites,[]);assert.deepEqual(value.inputOptions.disabledSites,[]);
  assert.equal(value.pageOptions.shortcut,'Alt+Z');assert.equal(value.inputOptions.shortcut,'Alt+X');
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

test('obsolete popup display edits cannot override a concurrent paragraph shortcut change',()=>{
  const base=defaultSettings(),displayDraft=structuredClone(base),gestureDraft=structuredClone(base);
  displayDraft.hoverOptions.displayMode='popup';
  gestureDraft.hoverEnabled=true;
  gestureDraft.hoverOptions.trigger='custom';gestureDraft.hoverOptions.customKeys=['Control','K'];
  gestureDraft.hoverOptions.mode='area';gestureDraft.hoverOptions.delay=650;
  for(const [draft,current] of [[displayDraft,gestureDraft],[gestureDraft,displayDraft]]){
    const merged=mergeSettings(base,draft,current);
    assert.equal(merged.hoverEnabled,true);
    assert.deepEqual(merged.hoverOptions,{
      trigger:'custom',customKeys:['Control','K'],mode:'area',displayMode:'inline',delay:650,holdDelay:800,
      showIndicator:true,borderColor:'#cfcfcf',disabledSites:[],
    });
  }
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

test('merging an independent edit cannot resurrect a disabled feature provider',()=>{
  const base=defaultSettings();base.selectionOptions.providerId='google';
  const draft=structuredClone(base),current=structuredClone(base);
  draft.selectionOptions.triggerMode='icon';current.providers.find(provider=>provider.id==='google').enabled=false;
  const result=mergeSettings(base,draft,current);
  assert.equal(result.selectionOptions.triggerMode,'icon');assert.equal(result.selectionOptions.providerId,'follow_page');
  assert.equal(result.providers.find(provider=>provider.id==='google').enabled,false);
});
