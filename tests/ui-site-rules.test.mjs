import test from 'node:test';
import assert from 'node:assert/strict';
import {applySiteRule,siteRuleState,siteHost,inputSiteDisabled,setInputSiteDisabled} from '../dist/src/shared/site-rules.js';
import {defaultSettings} from '../dist/src/shared/settings.js';

test('site rules leave broader patterns from the options page untouched',()=>{
  const settings=defaultSettings();settings.pageOptions.neverSites=['*.example.com'];
  const url='https://a.example.com/x';
  assert.equal(siteRuleState(settings,url),'never');
  applySiteRule(settings,url,'default');
  assert.deepEqual(settings.pageOptions.neverSites,['*.example.com']);
  assert.equal(siteRuleState(settings,url),'never');
});

test('global auto-translate already covers a site, so always adds no restricting entry',()=>{
  const settings=defaultSettings();settings.pageOptions.autoTranslate=true;
  applySiteRule(settings,'https://example.org/','always');
  assert.deepEqual(settings.pageOptions.alwaysSites,[]);
  assert.equal(siteRuleState(settings,'https://other.example/'),'always');
});

test('a full rule list reports its limit and non-web pages are rejected',()=>{
  const settings=defaultSettings();
  settings.pageOptions.neverSites=Array.from({length:100},(_,index)=>`site${index}.example`);
  assert.throws(()=>applySiteRule(settings,'https://new.example/','never'),/100/);
  assert.equal(siteHost('chrome://extensions'),'');
  assert.throws(()=>applySiteRule(defaultSettings(),'chrome://extensions','never'),/普通网页/);
});

test('removing the only auto-translate site does not widen auto-translate to every site',()=>{
  const settings=defaultSettings(),url='https://example.org/';
  applySiteRule(settings,url,'always');
  assert.equal(siteRuleState(settings,url),'always');
  applySiteRule(settings,url,'default');
  assert.equal(settings.pageOptions.autoTranslate,false);
  assert.equal(siteRuleState(settings,'https://other.example/'),'default');
});

test('input site switch edits only this host and reports a broader pattern that still applies',()=>{
  const settings=defaultSettings(),url='https://mail.example.com/inbox';
  assert.equal(setInputSiteDisabled(settings,url,true),true);
  assert.deepEqual(settings.inputOptions.disabledSites,['mail.example.com']);
  assert.equal(setInputSiteDisabled(settings,url,true),true);assert.deepEqual(settings.inputOptions.disabledSites,['mail.example.com']);
  assert.equal(setInputSiteDisabled(settings,url,false),false);assert.deepEqual(settings.inputOptions.disabledSites,[]);
  settings.inputOptions.disabledSites=['*.example.com'];
  assert.equal(inputSiteDisabled(settings,url),true);
  assert.equal(setInputSiteDisabled(settings,url,false),true);assert.deepEqual(settings.inputOptions.disabledSites,['*.example.com']);
  assert.deepEqual(settings.pageOptions.neverSites,[],'page rules are separate');
  settings.inputOptions.disabledSites=Array.from({length:100},(_,index)=>`site${index}.example`);
  assert.throws(()=>setInputSiteDisabled(settings,'https://new.example/',true),/100/);
  assert.throws(()=>setInputSiteDisabled(settings,'chrome://settings/',true));
});
