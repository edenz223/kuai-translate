import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings } from '../dist/src/shared/settings.js';

let helpers={};
try { helpers=await import('../dist/src/shared/interactions.js'); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND') throw error; }
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

test('1.2 hover settings gain inline display while retaining enabled state and all six gesture choices',()=>{
  for(const trigger of ['ctrl','shift','alt','left_hold','hover','custom'])for(const hoverEnabled of [false,true]){
    const hoverOptions={trigger,customKeys:['Control','K'],mode:'area',delay:450,holdDelay:1100,showIndicator:false,borderColor:'#123abc',disabledSites:['private.example']};
    const settings=normalizeSettings({hoverEnabled,hoverOptions});
    assert.deepEqual(settings.hoverOptions,{...hoverOptions,displayMode:'inline'},trigger);
    assert.equal(settings.hoverEnabled,hoverEnabled,trigger);
    assert.equal(Object.hasOwn(hoverOptions,'displayMode'),false,'migration must leave caller-owned settings untouched');
  }
});

test('paragraph display normalization maps every legacy display value to the shared inline renderer',()=>{
  const normalize=api('normalizeInteractionOptions');
  for(const [displayMode,expected] of [
    ['inline','inline'],['popup','inline'],[undefined,'inline'],[null,'inline'],['','inline'],
    ['bilingual','inline'],['translation_only','inline'],['Popup','inline'],[false,'inline'],[0,'inline'],[{},'inline'],
  ])assert.equal(normalize({hoverOptions:{displayMode}}).hoverOptions.displayMode,expected,String(displayMode));
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

test('held hover keys normalize aliases without admitting arbitrary keyboard event codes',()=>{
  const normalize=api('normalizeKey');
  for(const [value,expected] of [['Ctrl','Control'],['Control','Control'],[' cmd ','Meta'],['Opt','Alt'],['shift','Shift'],['z','Z']])
    assert.equal(normalize(value),expected);
  for(const value of ['KeyA','Alt+Z','F1','Enter','3',null,{}]) assert.equal(normalize(value),'');
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

test('all interaction list inputs are bounded and detached from caller-owned arrays',()=>{
  const normalize=api('normalizeInteractionOptions'),lines=Array.from({length:130},(_,i)=>`x${i}.example.com`);
  const value=normalize({pageOptions:{alwaysSites:lines,excludeSelectors:Array.from({length:60},(_,i)=>`.x${i}`)},inputOptions:{disabledSites:['a'.repeat(2001)+'.com','ok.example']}});
  assert.equal(value.pageOptions.alwaysSites.length,100);assert.equal(value.pageOptions.excludeSelectors.length,50);
  assert.deepEqual(value.inputOptions.disabledSites,['ok.example']);
  value.pageOptions.alwaysSites[0]='edited.example';assert.equal(lines[0],'x0.example.com');
});

test('page language rules contain actual language codes rather than feature follow-page placeholders',()=>{
  const value=api('normalizeInteractionOptions')({pageOptions:{alwaysLanguages:['follow_page','follow_webpage','en'],neverLanguages:['auto','follow_page','zh_Hans']}});
  assert.deepEqual(value.pageOptions.alwaysLanguages,['en']);assert.deepEqual(value.pageOptions.neverLanguages,['zh-Hans']);
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

test('interaction identity tracks effective translation and policy changes without exposing secrets or reacting to unrelated styles',()=>{
  const key=api('interactionConfigurationKey'),base={
    ...defaultSettings(),selectionOptions:{providerId:'google',targetLanguage:'ja'},
    providers:[{id:'microsoft',enabled:true,type:'microsoft'},{id:'google',enabled:true,type:'google',model:'m',apiKey:'private-secret',baseUrl:'https://private.example'}],
  };
  const original=key(base);assert.equal(original.includes('private-secret'),false);assert.equal(original.includes('private.example'),false);
  assert.equal(key({...base,pageStyle:{fontSize:150},subtitleTargetLanguage:'ko'}),original);
  assert.notEqual(key({...base,selectionOptions:{...base.selectionOptions,targetLanguage:'en'}}),original);
  assert.notEqual(key({...base,hoverEnabled:!base.hoverEnabled}),original);
  assert.equal(key({...base,hoverOptions:{displayMode:'popup'}}),original,'obsolete popup preferences do not invalidate shared translations');
  assert.notEqual(key({...base,pageOptions:{neverSites:['example.com']}}),original);
  assert.notEqual(key({...base,providerRevision:1}),original);
  assert.notEqual(key({...base,providers:base.providers.map(provider=>provider.id==='google'?{...provider,model:'m2'}:provider)}),original);
});
