import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,normalizeSettings,publicSettings,exportSettings,importSettings} from '../dist/src/shared/settings.js';
import {normalizeInteractionOptions,resolveFeatureSettings} from '../dist/src/shared/interactions.js';
import {mergeSettings} from '../dist/src/background/settings-merge.js';

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

test('nondefault legacy target or entry choices are preserved rather than inferred as untouched defaults',()=>{
  for(const [targetLanguage,icon] of [['en','none'],['follow_page','icon'],['follow_page','dot'],['zh-Hant','dot']]){
    const old=legacy();Object.assign(old.inputOptions,{targetLanguage,icon});
    const settings=normalizeSettings(old);
    assert.equal(settings.inputOptions.targetLanguage,targetLanguage);assert.equal(settings.inputOptions.icon,icon);
    assert.equal(settings.inputDefaultsVersion,3);
  }
});

test('after migration follow-page and hidden entry remain valid choices through save and backup round trips',()=>{
  const base=normalizeSettings(legacy()),draft=structuredClone(base),current=structuredClone(base);
  Object.assign(draft.inputOptions,{targetLanguage:'follow_page',icon:'none'});
  current.selectionOptions.delay=500;
  const saved=mergeSettings(base,draft,current);
  assert.equal(saved.inputOptions.targetLanguage,'follow_page');assert.equal(saved.inputOptions.icon,'none');
  assert.equal(resolveFeatureSettings(saved,'input').targetLanguage,'fr');assert.equal(saved.selectionOptions.delay,500);
  for(const value of [normalizeSettings(saved),publicSettings(saved),importSettings(exportSettings(saved),saved)]){
    assert.equal(value.inputOptions.targetLanguage,'follow_page');assert.equal(value.inputOptions.icon,'none');
    assert.equal(value.inputDefaultsVersion,3);
  }
  assert.equal(JSON.stringify(publicSettings(saved)).includes('fixture-only-secret'),false);
  assert.equal(JSON.stringify(exportSettings(saved)).includes('fixture-only-secret'),false);
  assert.equal(importSettings(exportSettings(saved),saved).providers.at(-1).apiKey,'fixture-only-secret');
});

test('pure interaction normalization retains an explicitly requested follow-page target and hidden entry',()=>{
  const inputOptions=normalizeInteractionOptions({inputOptions:{targetLanguage:'follow_page',icon:'none'}}).inputOptions;
  assert.equal(inputOptions.targetLanguage,'follow_page');assert.equal(inputOptions.icon,'none');
});

test('unversioned partial configuration is not mistaken for the old stored default pair',()=>{
  const settings=normalizeSettings({inputOptions:{targetLanguage:'follow_page',icon:'none'}});
  assert.equal(settings.inputOptions.targetLanguage,'follow_page');assert.equal(settings.inputOptions.icon,'none');
  assert.equal(settings.inputDefaultsVersion,3);
});


test('paragraph translation defaults on and selection defaults off without overriding explicit preferences',()=>{
 for(const settings of [defaultSettings(),normalizeSettings({})]){
  assert.equal(settings.hoverEnabled,true);assert.equal(settings.selectionEnabled,false);
 }
 const settings=normalizeSettings({hoverEnabled:false,selectionEnabled:true});
 assert.equal(settings.hoverEnabled,false);assert.equal(settings.selectionEnabled,true);
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
