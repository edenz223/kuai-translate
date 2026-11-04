import test from 'node:test';
import assert from 'node:assert/strict';
let settings = {};
try { settings = await import('../dist/src/shared/settings.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
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
test('blank custom temperature remains omitted while explicit numeric choices survive saving and backup',()=>{
  for(const [temperature,expected] of [[undefined,null],[null,null],['',null],['  ',null],[0,0],[0.7,0.7],['0.7',0.7]]) {
    const value=defaults();value.providers.push({id:'api',type:'openai',enabled:true,temperature});
    const normalized=settings.normalizeSettings(value);
    assert.equal(normalized.providers.at(-1).temperature,expected);
    assert.equal(settings.publicSettings(normalized).providers.at(-1).temperature,expected);
    assert.equal(settings.importSettings(settings.exportSettings(normalized),normalized).providers.at(-1).temperature,expected);
  }
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

test('legacy import keeps direct inherited instances but excludes platform accounts and shared models', () => {
  defaults();
  const imported=settings.importSettings({member_settings:JSON.stringify({
    translationEngine:'openai__inst_custom',targetLanguageZingCode:'ja',token:'platform-account-token',
    translationEngineConfig:{
      openai:{serviceMode:'custom',engineEnable:'1',apiKey:'test-key',apiUrl:'https://example.com/v1',model:'base'},
      openai__inst_custom:{baseEngineKey:'openai',serviceMode:'custom',engineEnable:'1',model:'manual-model'},
      'openai:shared:pro':{serviceMode:'pro',apiKey:'platform-secret'},
      microsoft:{serviceMode:'free',engineEnable:'1'},
    },videoSubtitlesConfig:{isEnable:'1',translationEngine:'follow_webpage'}
  })});
  const chosen=imported.providers.find(provider=>provider.id===imported.activeProviderId);
  assert.equal(chosen.model,'manual-model');
  assert.equal(chosen.apiKey,'test-key');
  assert.equal(imported.targetLanguage,'ja');
  assert.equal(JSON.stringify(imported).includes('platform-account-token'),false);
  assert.equal(JSON.stringify(imported).includes('platform-secret'),false);
});

test('invalid endpoint schemes, URL credentials and invalid settings structures are rejected', () => {
  const value=defaults();
  for(const baseUrl of ['javascript:alert(1)','https://user:secret@example.com/v1']) {
    assert.throws(()=>settings.normalizeSettings({...value,providers:[...value.providers,{id:'x',name:'X',type:'openai',enabled:true,baseUrl}]}));
  }
  assert.throws(()=>settings.importSettings({unrelated:'file'}));
  assert.throws(()=>settings.normalizeSettings({...value,providers:'broken'}));
});
test('public provider revisions invalidate credential edits without exposing any credential',()=>{
  const value=defaults();value.providerRevision=5;
  assert.equal(settings.publicSettings(value).providerRevision,5);
  assert.equal(settings.normalizeSettings({...value,providerRevision:-2}).providerRevision,0);
});
test('a redacted import cannot transfer an existing key to a changed API endpoint',()=>{
  const current=defaults();current.providers.push({id:'api',type:'openai',name:'API',enabled:true,baseUrl:'https://original.example/v1',apiKey:'test-secret',model:'m'});
  const backup=settings.exportSettings(current);backup.settings.providers.at(-1).baseUrl='https://different.example/v1';
  assert.equal(settings.importSettings(backup,current).providers.at(-1).apiKey,'');
});
test('credential-free exports remove endpoint fragments as well as sensitive query values',()=>{
  const current=defaults();current.providers.push({id:'api',type:'openai',name:'API',enabled:true,baseUrl:'https://example.com/v1?key=test-query#token=test-fragment',apiKey:'test-key'});
  const serialized=JSON.stringify(settings.exportSettings(current));
  assert.equal(serialized.includes('test-query'),false);assert.equal(serialized.includes('test-fragment'),false);
});
test('legacy platform hosts with a DNS trailing dot are excluded during import',()=>{
  defaults();const result=settings.importSettings({translationEngine:'openai',translationEngineConfig:{openai:{serviceMode:'custom',engineEnable:'1',apiUrl:'https://api.selecttranslate.com./proxy',apiKey:'test-platform-key',model:'m'}}});
  assert.equal(JSON.stringify(result).includes('test-platform-key'),false);
});

test('new public presentation preferences survive save, public views and backup independently of provider secrets',()=>{
  const value=defaults();
  assert.equal(value.pageDisplayMode,'bilingual');assert.equal(value.pageStyle?.fontSize,100);
  assert.equal(value.subtitleTargetLanguage,'follow_page');assert.equal(value.subtitleStyle?.displayMode,'bilingual');
  value.pageDisplayMode='translation_only';value.pageStyle.fontSize=125;
  value.subtitleTargetLanguage='ja';value.subtitleStyle.hideTranslation=true;value.subtitleStyle.position='top-left';
  const roundTrip=settings.importSettings(settings.exportSettings(value),value),publicValue=settings.publicSettings(roundTrip);
  assert.equal(publicValue.pageDisplayMode,'translation_only');assert.equal(publicValue.pageStyle.fontSize,125);
  assert.equal(publicValue.subtitleTargetLanguage,'ja');assert.equal(publicValue.subtitleStyle.hideTranslation,true);assert.equal(publicValue.subtitleStyle.position,'top-left');
  assert.throws(()=>settings.normalizeSettings({...value,subtitleTargetLanguage:'auto'}));
});

test('explicit subtitle display mode wins over the legacy showOriginal alias',()=>{
  const explicit=settings.normalizeSettings({...defaults(),showOriginal:false,subtitleStyle:{displayMode:'bilingual'}});
  assert.equal(explicit.showOriginal,true);assert.equal(explicit.subtitleStyle.displayMode,'bilingual');
  const old=defaults();delete old.subtitleStyle;old.showOriginal=false;
  const migrated=settings.normalizeSettings(old);
  assert.equal(migrated.subtitleStyle.displayMode,'translation_only');assert.equal(migrated.showOriginal,false);
  const translationOnly=settings.normalizeSettings({...defaults(),showOriginal:true,subtitleStyle:{displayMode:'translation_only'}});
  assert.equal(translationOnly.showOriginal,false);
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

test('legacy transparent opacity and all five caption font choices retain their effective values',()=>{
  for(const [size,pixels] of [['smallest',16],['smaller',20],['medium',24],['larger',32],['largest',40]]){
    const value=settings.importSettings({translationEngineConfig:{},transTheme:'ztsl_theme_transparent_text',transThemeConfig:{ztsl_theme_transparent_text:{isCustom:'1',opacity:35,borderColor:'#ffffff'}},
      videoSubtitlesConfig:{targetLanguageZingCode:'follow_webpage',styleConfig:{fontSize:{source:size,target:size}}}});
    assert.equal(value.pageStyle?.preset,'transparent');assert.equal(value.pageStyle.opacity,35);
    assert.equal(value.subtitleTargetLanguage,'follow_page');assert.equal(value.subtitleStyle.sourceFontSize,pixels);assert.equal(value.subtitleStyle.targetFontSize,pixels);
  }
});
