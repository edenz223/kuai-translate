import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {startOptions} from '../dist/src/ui/options.js';
import {defaultSettings,normalizeSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';
import {describeProviderError,providerProblems,providerIssue,nextProviderName} from '../dist/src/ui/common.js';
import * as stateModule from '../dist/src/ui/state.js';
import {startTextTool} from '../dist/src/ui/text.js';

function options(t,change=()=>{},intercept=()=>{}) {
  let stored=defaultSettings();change(stored);
  const requests=[],previous=globalThis.chrome;
  globalThis.chrome={runtime:{sendMessage:async message=>{
    requests.push(message);
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:structuredClone(stored)};
    if(message.type==='KUAI_SAVE_SETTINGS'){
      const response=await intercept(message,stored);if(response)return response;
      stored=normalizeSettings(message.settings);
      return {ok:true,value:structuredClone(stored)};
    }
    assert.fail('Editing interaction settings must not send '+message.type);
  }}};
  t.after(()=>{globalThis.chrome=previous;});
  const create=()=>{
    const h=createDocument(new URL('../public/options.html',import.meta.url));
    return {...h,start:()=>startOptions(h.document),async edit(id,value,event='change'){
      const field=h.node(id);assert.ok(field,'the settings page must expose '+id);
      if(typeof value==='boolean')field.checked=value;else field.value=String(value);
      await field.fire(event);await setImmediate();return field;
    }};
  };
  return {...create(),requests,get stored(){return stored;},reopen:create,writes:()=>requests.filter(item=>item.type==='KUAI_SAVE_SETTINGS').length};
}

test('save feedback starts idle, expires, and restarts after a subsequent save',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=options(t);await h.start();
  assert.equal(h.node('save-bar').dataset.state,'idle');assert.equal(h.node('status').textContent,'');
  await h.edit('target-language','ja');
  assert.equal(h.node('save-bar').dataset.state,'saved');assert.equal(h.node('status').textContent,'已保存');
  t.mock.timers.tick(1500);
  await h.edit('target-language','en');
  t.mock.timers.tick(600);
  assert.equal(h.node('save-bar').dataset.state,'saved','the first save timer must not dismiss the second save');
  t.mock.timers.tick(1400);
  assert.equal(h.node('save-bar').dataset.state,'idle');assert.equal(h.node('status').textContent,'');
});

for(const initial of ['saved','notice'])test(`a pending save keeps ${initial} feedback visible until completion`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let pending=false,finish;
  const h=options(t,()=>{},()=>pending?new Promise(resolve=>{finish=resolve;}):undefined);await h.start();
  if(initial==='notice'){
    h.node('import-settings').files=[{size:2,text:async()=>JSON.stringify(h.stored)}];
    await h.node('import-settings').fire('change');
  }else await h.edit('target-language','ja');
  assert.equal(h.node('save-bar').dataset.state,initial);
  assert.equal(h.node('save-bar').dataset.visible,'true');
  t.mock.timers.tick(600);pending=true;
  const edit=h.edit('target-language','en');await setImmediate();
  assert.equal(h.node('save-bar').dataset.state,'saving');
  assert.equal(h.node('save-bar').dataset.visible,'true');
  for(const elapsed of [1,398,1,5000]){
    t.mock.timers.tick(elapsed);
    assert.equal(h.node('save-bar').dataset.visible,'true','pending saves must not hide existing feedback');
    assert.equal(h.node('save-bar').dataset.state,'saving','the prior expiry timer must be cancelled');
  }
  finish();await edit;
  assert.equal(h.node('save-bar').dataset.state,'saved');
  assert.equal(h.node('save-bar').dataset.visible,'true');
  assert.equal(h.node('status').textContent,'已保存');
  t.mock.timers.tick(1999);assert.equal(h.node('save-bar').dataset.state,'saved');
  t.mock.timers.tick(1);assert.equal(h.node('save-bar').dataset.state,'idle');
});

test('pending saves expose saving and validation attention persists through other successful saves',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let finish;
  const h=options(t,()=>{},()=>new Promise(resolve=>{finish=resolve;}));await h.start();
  const edit=h.edit('target-language','ja');await setImmediate();
  assert.equal(h.node('save-bar').dataset.state,'saving');assert.equal(h.node('status').textContent,'正在保存…');
  assert.equal(h.node('save-bar').dataset.visible,'false');t.mock.timers.tick(399);
  assert.equal(h.node('save-bar').dataset.visible,'false');t.mock.timers.tick(1);
  assert.equal(h.node('save-bar').dataset.visible,'true');
  finish();await edit;
  await h.edit('page-option-shortcut','Ctrl+','input');
  assert.equal(h.node('save-bar').dataset.state,'attention');assert.match(h.node('status').textContent,/有 1 项输入尚未保存/);
  const another=h.edit('target-language','en');await setImmediate();finish();await another;
  t.mock.timers.tick(10000);
  assert.equal(h.node('save-bar').dataset.state,'attention');assert.match(h.node('status').textContent,/未保存/);
  const corrected=h.edit('page-option-shortcut','Alt+P','input');await setImmediate();finish();await corrected;
  await h.edit('page-option-minTextLength','','input');
  assert.equal(h.node('save-bar').dataset.state,'attention');assert.match(h.node('status').textContent,/数字未输入完整/);
});

test('save errors stay visible across renders until a successful retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let failing=true;
  const h=options(t,()=>{},()=>failing?{ok:false,error:{code:'STORAGE_ERROR',message:'Storage unavailable'}}:undefined);await h.start();
  await h.edit('target-language','ja');
  assert.equal(h.node('save-bar').dataset.state,'attention');assert.match(h.node('status').textContent,/Storage unavailable/);
  assert.equal(h.node('retry-save').hidden,false);
  t.mock.timers.tick(10000);await h.node('add-provider').fire('click');
  assert.equal(h.node('save-bar').dataset.state,'attention');assert.match(h.node('status').textContent,/Storage unavailable/);
  failing=false;await h.node('retry-save').fire('click');
  assert.equal(h.node('save-bar').dataset.state,'saved');assert.equal(h.node('retry-save').hidden,true);
});

test('load and file errors remain attention across routine renders',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=options(t);await h.start();
  h.node('import-settings').files=[{size:2,text:async()=>'{invalid'}];
  await h.node('import-settings').fire('change');
  const message=h.node('status').textContent;
  assert.equal(h.node('save-bar').dataset.state,'attention');
  t.mock.timers.tick(10000);await h.node('add-provider').fire('click');
  assert.equal(h.node('status').textContent,message);assert.equal(h.node('save-bar').dataset.state,'attention');
  globalThis.chrome.runtime.sendMessage=async()=>{throw Error('Cannot load settings');};
  const reopened=h.reopen();await reopened.start();t.mock.timers.tick(10000);
  assert.equal(reopened.node('save-bar').dataset.state,'attention');assert.equal(reopened.node('status').textContent,'Cannot load settings');
});

test('import notices survive routine renders and expire without becoming saved again',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=options(t);await h.start();
  h.node('import-settings').files=[{size:2,text:async()=>JSON.stringify(h.stored)}];
  await h.node('import-settings').fire('change');
  assert.equal(h.node('save-bar').dataset.state,'notice');assert.match(h.node('status').textContent,/已导入可识别/);
  await h.node('add-provider').fire('click');t.mock.timers.tick(2500);
  assert.equal(h.node('save-bar').dataset.state,'notice');
  t.mock.timers.tick(2500);await h.node('cancel-add').fire('click');
  assert.equal(h.node('save-bar').dataset.state,'idle');assert.equal(h.node('status').textContent,'');
});

test('the actual settings controller saves every interaction option and reloads independent services without API calls',async t=>{
  const h=options(t);await h.start();
  const cases=[
    ['page','autoTranslate',true],['page','alwaysLanguages','en\nja','input'],['page','neverLanguages','ko','input'],
    ['page','alwaysSites','example.com\nhttps://news.example/articles/**','input'],['page','neverSites','private.example','input'],
    ['page','translateFullPage',false],['page','excludeSelectors','.advert\n[data-private]','input'],
    ['page','minTextLength','12','input'],['page','translateDynamic',true],['page','contextMenuEnabled',false],
    ['page','shortcut','ctrl + shift + p','input'],['page','displayModeShortcut','Alt+D','input'],
    ['selection','providerId','google'],['selection','sourceLanguage','en'],['selection','targetLanguage','ja'],
    ['selection','triggerMode','dot'],['selection','triggerAction','hover'],['selection','delay','600','input'],
    ['selection','maxLength','12000','input'],['selection','showOriginal',false],['selection','autoSpeak',true],
    ['selection','disabledSites','private.example','input'],
    ['input','enabled',true],['input','providerId','yandex'],['input','sourceLanguage','ja'],['input','targetLanguage','en'],
    ['input','shortcut','Alt+K','input'],['input','icon','icon'],
    ['input','autoApply',false],['input','writeBack','translation-original'],
    ['input','disabledSites','billing.example','input'],
    ['hover','trigger','custom'],['hover','customKeys','control + k','input'],['hover','mode','area'],
    ['hover','delay','450','input'],['hover','holdDelay','1000','input'],['hover','showIndicator',false],
    ['hover','borderColor','#aabbcc','input'],['hover','disabledSites','chat.example','input'],
  ];
  for(const [group,key,value,event] of cases)await h.edit(group+'-option-'+key,value,event);
  await h.edit('hover-enabled',true);await h.edit('selection-enabled',false);
  assert.deepEqual(h.stored.pageOptions,{autoTranslate:true,alwaysLanguages:['en','ja'],neverLanguages:['ko'],alwaysSites:['example.com','https://news.example/articles/**'],neverSites:['private.example'],translateFullPage:false,excludeSelectors:['.advert','[data-private]'],minTextLength:12,translateDynamic:true,contextMenuEnabled:false,shortcut:'Control+Shift+P',displayModeShortcut:'Alt+D'});
  assert.deepEqual(h.stored.selectionOptions,{providerId:'google',sourceLanguage:'en',targetLanguage:'ja',triggerMode:'dot',triggerAction:'hover',delay:600,maxLength:12000,showOriginal:false,autoSpeak:true,disabledSites:['private.example']});
  assert.deepEqual(h.stored.inputOptions,{enabled:true,providerId:'yandex',sourceLanguage:'ja',targetLanguage:'en',shortcut:'Alt+K',restoreShortcut:'',icon:'icon',autoApply:false,includeOriginal:true,displayOrder:'translation-original',disabledSites:['billing.example']});
  assert.deepEqual(h.stored.hoverOptions,{trigger:'custom',customKeys:['Control','K'],mode:'area',displayMode:'inline',delay:450,holdDelay:1000,showIndicator:false,borderColor:'#aabbcc',disabledSites:['chat.example']});
  assert.equal(h.stored.activeProviderId,'microsoft');assert.equal(h.stored.targetLanguage,'zh-Hans');
  assert.equal(h.stored.hoverEnabled,true);assert.equal(h.stored.selectionEnabled,false);
  const reopened=h.reopen();await reopened.start();
  assert.equal(reopened.node('page-option-shortcut').value,'Control+Shift+P');
  assert.equal(reopened.node('page-option-alwaysSites').value,'example.com\nhttps://news.example/articles/**');
  assert.equal(reopened.node('selection-option-providerId').value,'google');
  assert.equal(reopened.node('input-option-providerId').value,'yandex');
  assert.equal(reopened.node('hover-option-customKeys').value,'Control + K');
  assert.equal(reopened.node('page-style-preset').children.length,16,'all existing webpage styles remain selectable');
  assert.ok(h.requests.every(message=>['KUAI_GET_SETTINGS','KUAI_SAVE_SETTINGS'].includes(message.type)));
  assert.ok(h.requests.filter(message=>message.type==='KUAI_SAVE_SETTINGS').every(message=>message.baseSettings));
});

test('the settings page shows only the controls that apply to each selected trigger',async t=>{
  const h=options(t);await h.start();
  assert.ok(h.node('selection-trigger-action-field'),'selection trigger conditions must be exposed by the page');
  assert.equal(h.node('selection-trigger-action-field').hidden,true);
  assert.equal(h.node('selection-delay-field').hidden,false);
  await h.edit('selection-option-triggerMode','icon');
  assert.equal(h.node('selection-trigger-action-field').hidden,false);
  assert.equal(h.node('selection-delay-field').hidden,true,'click activation has no artificial delay');
  await h.edit('selection-option-triggerAction','hover');assert.equal(h.node('selection-delay-field').hidden,false);
  await h.edit('selection-option-triggerMode','meta');assert.equal(h.node('selection-trigger-action-field').hidden,true);
  assert.equal(h.node('hover-options-panel').hidden,false);
  await h.edit('hover-enabled',false);assert.equal(h.node('hover-options-panel').hidden,true);
  await h.edit('hover-enabled',true);assert.equal(h.node('hover-options-panel').hidden,false);
  assert.equal(h.node('hover-custom-keys-field').hidden,true);assert.equal(h.node('hover-hold-delay-field').hidden,true);
  assert.ok(h.node('hover-delay-field'));assert.equal(h.node('hover-delay-field').hidden,true,'keyboard toggles do not wait for a hover timer');
  await h.edit('hover-option-trigger','hover');assert.equal(h.node('hover-delay-field').hidden,false);
  await h.edit('hover-option-trigger','custom');assert.equal(h.node('hover-custom-keys-field').hidden,false);
  await h.edit('hover-option-trigger','left_hold');assert.equal(h.node('hover-custom-keys-field').hidden,true);assert.equal(h.node('hover-hold-delay-field').hidden,false);
  await h.edit('hover-option-showIndicator',false);assert.equal(h.node('hover-border-color-field').hidden,true);
  await h.edit('selection-enabled',false);assert.equal(h.node('selection-options-panel').hidden,true);
  await h.edit('input-option-enabled',false);assert.equal(h.node('input-options-panel').hidden,true);
});

test('the settings page shows one section per address and marks disabled features and unsaved drafts in the sidebar',async t=>{
  const h=options(t),listeners={};
  h.document.defaultView={location:{hash:'#hover'},addEventListener(type,listener){listeners[type]=listener;},scrollTo(){}};
  await h.start();
  assert.equal(h.node('hover').hidden,false);assert.equal(h.node('webpage').hidden,true);
  assert.equal(h.node('nav-hover')['aria-current'],'page');assert.equal(h.node('nav-webpage')['aria-current'],undefined);
  h.document.defaultView.location.hash='#providers';listeners.hashchange();
  assert.equal(h.node('providers').hidden,false);assert.equal(h.node('hover').hidden,true);
  h.document.defaultView.location.hash='#missing';listeners.hashchange();
  assert.equal(h.node('webpage').hidden,false,'an unknown address opens the first section');
  assert.equal(h.node('nav-selection').classList.contains('off'),true);assert.equal(h.node('nav-hover').classList.contains('off'),false);
  assert.equal(h.node('subtitle-options-panel').hidden,false);
  await h.edit('subtitles-enabled',false);
  assert.equal(h.node('subtitle-options-panel').hidden,true);assert.equal(h.node('nav-subtitles').classList.contains('off'),true);
  await h.edit('input-option-shortcut','Ctrl+','input');
  assert.equal(h.node('nav-input').classList.contains('invalid'),true,'a draft left on another section stays findable');
  assert.equal(h.node('nav-webpage').classList.contains('invalid'),false);
  await h.edit('input-option-shortcut','Alt+K','input');
  assert.equal(h.node('nav-input').classList.contains('invalid'),false);
});

test('language pairs swap the languages each feature resolves to and stay disabled for automatic detection',async t=>{
  const h=options(t);await h.start();
  assert.equal(h.node('page-swap-languages').disabled,true);assert.equal(h.node('page-swap-help').hidden,false);
  assert.equal(h.node('selection-swap-languages').disabled,true,'selection follows the automatic page source');
  await h.edit('source-language','en');
  assert.equal(h.node('page-swap-languages').disabled,false);assert.equal(h.node('page-swap-help').hidden,true);
  await h.node('page-swap-languages').fire('click');await setImmediate();
  assert.equal(h.stored.sourceLanguage,'zh-Hans');assert.equal(h.stored.targetLanguage,'en');
  assert.equal(h.node('selection-option-targetLanguage').children[0].textContent,'跟随网页（English）');
  await h.node('selection-swap-languages').fire('click');await setImmediate();
  assert.equal(h.stored.selectionOptions.sourceLanguage,'en');assert.equal(h.stored.selectionOptions.targetLanguage,'zh-Hans');
  assert.equal(h.stored.sourceLanguage,'zh-Hans','swapping a feature leaves the page languages alone');
});

test('invalid or same-context conflicting shortcuts stay visible and never overwrite a saved shortcut',async t=>{
  const h=options(t,settings=>{settings.inputOptions.restoreShortcut='Control+Shift+Z';});await h.start();
  await h.edit('page-option-shortcut','Alt+P','input');
  const writes=h.writes();
  const shortcut=await h.edit('page-option-shortcut','Ctrl+','input');
  assert.equal(h.writes(),writes);assert.equal(h.stored.pageOptions.shortcut,'Alt+P');
  assert.equal(shortcut.value,'Ctrl+');assert.equal(shortcut.getAttribute('aria-invalid'),'true');
  assert.equal(h.node('page-option-shortcut-error').hidden,false);assert.match(h.node('status').textContent,/未保存/);
  await h.edit('page-option-minTextLength','16','input');
  assert.equal(shortcut.value,'Ctrl+','an unrelated save must not swallow the invalid draft');
  await h.edit('page-option-shortcut','Ctrl+P','input');
  await h.edit('page-option-displayModeShortcut','control + p','input');
  assert.equal(h.stored.pageOptions.displayModeShortcut,'');assert.match(h.node('page-option-displayModeShortcut-error').textContent,/冲突/);
  await h.edit('input-option-shortcut','Control+P','input');
  assert.equal(h.stored.inputOptions.shortcut,'Control+P','page and editable-input shortcuts have distinct contexts');
  assert.equal(h.node('input-option-restoreShortcut'),null);
  await h.edit('input-option-shortcut','Control+Shift+Z','input');
  assert.equal(h.stored.inputOptions.restoreShortcut,'Control+Shift+Z');
  assert.match(h.node('input-option-shortcut-error').textContent,/冲突/);
  await h.edit('page-option-displayModeShortcut','','input');await h.edit('page-option-shortcut','','input');
  assert.equal(h.stored.pageOptions.shortcut,'');assert.equal(shortcut.getAttribute('aria-invalid'),'false');
  await h.edit('input-option-shortcut','','input');assert.equal(h.stored.inputOptions.shortcut,'');
  assert.equal(h.stored.inputOptions.restoreShortcut,'Control+Shift+Z','legacy restore preference remains compatible');
});

test('the actual interaction form keeps conflicting save drafts until explicit reload',async t=>{
  let conflict=true;
  const h=options(t,()=>{},()=>conflict?{ok:false,error:{code:'SETTINGS_CONFLICT',message:'Changed in another window'}}:undefined);
  await h.start();await h.edit('selection-option-delay','700','input');
  assert.equal(h.stored.selectionOptions.delay,250);assert.equal(h.node('selection-option-delay').value,'700');
  assert.equal(h.node('reload-settings').hidden,false);assert.equal(h.node('retry-save').hidden,true);
  assert.equal(h.node('save-bar').dataset.state,'attention');assert.match(h.node('status').textContent,/其他页面修改了同一配置/);
  const before=h.writes();await h.edit('input-option-icon','none');assert.equal(h.writes(),before,'a conflict must stop queued overwrites');
  assert.equal(h.node('selection-option-delay').value,'700');
  conflict=false;await h.node('reload-settings').fire('click');
  assert.equal(h.node('selection-option-delay').value,'250');assert.equal(h.node('input-option-icon').value,'dot');
  await h.edit('input-option-icon','icon');assert.equal(h.stored.inputOptions.icon,'icon');
});

test('multiline rules reject oversized or invalid drafts while accepting bounded one-entry-per-line lists',async t=>{
  const h=options(t);await h.start();
  await h.edit('page-option-neverSites','private.example\nprivate.example\nhttps://news.example/account/**','input');
  assert.deepEqual(h.stored.pageOptions.neverSites,['private.example','https://news.example/account/**']);
  let before=h.writes();
  await h.edit('page-option-neverSites',Array.from({length:101},(_,index)=>'site'+index+'.example').join('\n'),'input');
  assert.equal(h.writes(),before);assert.match(h.node('page-option-neverSites-error').textContent,/100/);
  await h.edit('page-option-excludeSelectors',Array.from({length:51},(_,index)=>'.item'+index).join('\n'),'input');
  assert.equal(h.writes(),before);assert.match(h.node('page-option-excludeSelectors-error').textContent,/50/);
  await h.edit('page-option-excludeSelectors','.'+'a'.repeat(2000),'input');assert.equal(h.writes(),before);assert.match(h.node('page-option-excludeSelectors-error').textContent,/2000/);
  const invalid=await h.edit('page-option-neverSites','javascript:alert(1)','input');assert.equal(h.writes(),before);
  await h.edit('page-option-translateFullPage',false);assert.equal(invalid.value,'javascript:alert(1)');
  before=h.writes();await h.edit('page-option-alwaysLanguages','English','input');assert.equal(h.writes(),before);assert.match(h.node('page-option-alwaysLanguages-error').textContent,/语言代码/);
  await h.edit('page-option-neverSites','','input');assert.deepEqual(h.stored.pageOptions.neverSites,[]);
  await h.edit('page-option-alwaysLanguages','en\nzh-Hans','input');assert.deepEqual(h.stored.pageOptions.alwaysLanguages,['en','zh-Hans']);
});

test('input write-back is one choice stored as includeOriginal and displayOrder',async t=>{
  const h=options(t);await h.start();
  const field=h.node('input-option-writeBack');
  assert.deepEqual(field.children.map(option=>option.value),['translation','original-translation','translation-original']);
  assert.equal(field.value,'translation');assert.equal(h.node('input-write-back-help').hidden,true);
  await h.edit('input-option-writeBack','translation-original');assert.equal(h.node('input-write-back-help').hidden,false);
  assert.equal(h.stored.inputOptions.includeOriginal,true);assert.equal(h.stored.inputOptions.displayOrder,'translation-original');
  await h.edit('input-option-writeBack','translation');
  assert.equal(h.stored.inputOptions.includeOriginal,false);assert.equal(h.stored.inputOptions.displayOrder,'translation-original','the order is kept for next time');
  const reopened=h.reopen();await reopened.start();assert.equal(reopened.node('input-option-writeBack').value,'translation');
  await h.edit('input-option-autoApply',false);assert.match(h.node('input-apply-help').textContent,/预览/);
  await h.edit('input-option-icon','none');assert.match(h.node('input-icon-help').textContent,/快捷键/);
});

const text=node=>[node.textContent,...(node.children||[]).map(text)].join(' ');
const chips=row=>(row.children.find(child=>child.className==='chips')?.children||[]).map(chip=>chip.textContent);
const custom=(id,patch={})=>({id,type:'openai',name:id,enabled:true,baseUrl:'',apiKey:'fixture-key',model:'fixture-model',region:'',temperature:null,...patch});

async function open(t,settings,handle=()=>assert.fail('Unexpected message')){
  const previousChrome=globalThis.chrome,saved=[];
  globalThis.chrome={runtime:{sendMessage:async message=>{
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:settings};
    if(message.type==='KUAI_SAVE_SETTINGS'){saved.push(message.settings);return {ok:true,value:message.settings};}
    if(message.type==='KUAI_CANCEL')return {ok:true,value:true};
    return handle(message);
  }}};
  t.after(()=>{globalThis.chrome=previousChrome;});
  const h=createDocument(new URL('../public/options.html',import.meta.url));
  await startOptions(h.document);
  return {...h,saved};
}

test('provider list groups free and custom services and shows where each one is used',async t=>{
  const settings=defaultSettings();
  settings.providers.push(custom('a',{apiKey:''}),custom('b',{enabled:false}));
  settings.activeProviderId='a';settings.selectionOptions.providerId='a';
  const h=await open(t,settings);
  assert.equal(h.node('free-provider-list').children.length,4);
  assert.equal(h.node('custom-provider-list').children.length,2);
  assert.equal(h.node('custom-empty').hidden,true);
  const [a,b]=h.node('custom-provider-list').children;
  assert.deepEqual(chips(a),['网页','划词','缺少 Key']);
  assert.deepEqual(chips(b),['已停用']);
  assert.match(text(a),/OpenAI 兼容 API · fixture-model/);
  assert.deepEqual(chips(h.node('free-provider-list').children[0]),[]);
  assert.equal(h.node('free-provider-list').children[0]['aria-current'],'true','the first service is selected by default');
});

test('the type picker adds a numbered instance and moves focus to its first field',async t=>{
  const h=await open(t,defaultSettings());
  await h.node('add-provider').fire('click');
  assert.equal(h.node('provider-picker').hidden,false);
  assert.equal(h.node('provider-form').hidden,true);
  assert.equal(h.node('add-provider')['aria-expanded'],'true');
  const cards=h.node('provider-types').children;
  assert.equal(h.document.activeElement,cards[0]);
  const openai=cards.find(card=>card.dataset.type==='openai');
  await openai.fire('click');
  assert.equal(h.node('provider-picker').hidden,true);
  assert.equal(h.node('provider-kind').textContent,'OpenAI 兼容 API');
  assert.equal(h.node('provider-title').textContent,'OpenAI 兼容 API');
  assert.equal(h.document.activeElement,h.node('provider-baseUrl'));
  await h.node('add-provider').fire('click');
  await openai.fire('click');
  assert.deepEqual(h.saved.at(-1).providers.filter(item=>item.type==='openai').map(item=>item.name),['OpenAI 兼容 API','OpenAI 兼容 API 2']);
  await h.node('add-provider').fire('click');
  await h.node('provider-types').children.find(card=>card.dataset.type==='gemini').fire('click');
  assert.equal(h.document.activeElement,h.node('provider-apiKey'),'keyed services with a default address start at the key');
  await h.node('add-provider').fire('click');await h.node('cancel-add').fire('click');
  assert.equal(h.node('provider-picker').hidden,true);
  assert.equal(h.document.activeElement,h.node('add-provider'));
});

test('field problems appear after leaving a field or testing, and fields change per type',async t=>{
  const settings=defaultSettings();
  settings.providers.push(custom('a',{apiKey:'',model:''}),custom('d',{type:'deepl'}));
  const tests=[];
  const h=await open(t,settings,message=>{assert.equal(message.type,'KUAI_TEST_PROVIDER');tests.push(message);return {ok:false,error:{code:'INVALID_CONFIG',message:'This service requires your API key.'}};});
  await h.node('custom-provider-list').children[0].fire('click');
  assert.equal(h.node('apiKey-error').hidden,true,'no warning before the user has touched the field');
  h.node('provider-baseUrl').value='example.com';await h.node('provider-baseUrl').fire('input');await h.node('provider-baseUrl').fire('blur');
  assert.match(h.node('baseUrl-error').textContent,/完整地址/);
  assert.equal(h.node('provider-baseUrl')['aria-invalid'],'true');
  assert.equal(h.node('provider-baseUrl').value,'example.com','leaving the field keeps the draft instead of reverting it');
  assert.equal(h.saved.length,0,'an address settings cannot store is not saved');
  assert.match(h.node('baseUrl-error').textContent,/^未保存：/);
  assert.match(h.node('status').textContent,/有 1 项输入尚未保存/);
  await h.node('test-provider').fire('click');
  assert.equal(h.node('apiKey-error').textContent,'请填写 API Key。');
  assert.equal(h.node('model-error').hidden,false);
  assert.equal(h.node('test-status').textContent,'配置不完整：检查标出的字段后重试。');
  h.node('provider-baseUrl').value='https://example.com/v1';await h.node('provider-baseUrl').fire('input');
  assert.equal(h.node('baseUrl-error').hidden,true);
  assert.equal(h.saved.at(-1).providers.find(item=>item.id==='a').baseUrl,'https://example.com/v1');
  assert.doesNotMatch(h.node('status').textContent,/尚未保存/);
  assert.equal(h.node('provider-baseUrl')['aria-invalid'],undefined);
  await h.node('custom-provider-list').children[1].fire('click');
  assert.equal(h.node('model-field').hidden,true);
  assert.equal(h.node('advanced-field').hidden,true);
  assert.equal(h.node('provider-baseUrl').placeholder,'https://api-free.deepl.com/v2');
  assert.equal(h.node('key-link').hidden,false);
});

test('test results explain the failure, show latency and mark the list row',async t=>{
  const settings=defaultSettings();settings.providers.push(custom('a'));
  let reply={ok:false,error:{code:'HTTP_401',message:'The translation service returned HTTP 401.'}};
  const h=await open(t,settings,()=>reply);
  await h.node('custom-provider-list').children[0].fire('click');
  await h.node('test-provider').fire('click');
  assert.match(h.node('test-status').textContent,/^API Key 无效或没有权限：/);
  assert.equal(h.node('test-status').className.includes('error'),true);
  assert.equal(h.node('test-detail').textContent,'服务返回：The translation service returned HTTP 401.');
  assert.deepEqual(chips(h.node('custom-provider-list').children[0]),['测试失败']);
  reply={ok:true,value:{translations:['你好']}};
  await h.node('test-provider').fire('click');
  assert.match(h.node('test-status').textContent,/^连接成功 · \d+ ms$/);
  assert.deepEqual(chips(h.node('custom-provider-list').children[0]),['测试通过']);
  h.node('provider-model').value='other';await h.node('provider-model').fire('input');
  assert.deepEqual(chips(h.node('custom-provider-list').children[0]),[],'an edit makes the old result stale');
});

test('provider helpers name instances, find problems and map error codes',()=>{
  const settings=defaultSettings();
  assert.equal(nextProviderName(settings,'deepl'),'DeepL API');
  settings.providers.push(custom('x',{type:'deepl',name:'DeepL API'}));
  assert.equal(nextProviderName(settings,'deepl'),'DeepL API 2');
  assert.deepEqual(providerProblems(custom('a',{type:'deeplx',apiKey:''})),{baseUrl:'请填写接口地址。'});
  assert.match(providerProblems(custom('a',{baseUrl:'ftp://host'})).baseUrl,/http/);
  assert.match(providerProblems(custom('a',{baseUrl:'https://u:p@host'})).baseUrl,/账号/);
  assert.deepEqual(providerProblems(custom('a',{type:'ollama',apiKey:'',model:''})),{model:'请获取或填写模型名。'});
  assert.equal(providerIssue(custom('a',{baseUrl:'nope'})),'地址无效');
  assert.equal(providerIssue({...settings.providers[0]}),'');
  assert.equal(describeProviderError({code:'HTTP_503',message:'m'}).title,'服务暂时不可用');
  assert.equal(describeProviderError({code:'NETWORK_ERROR',message:'m'}).title,'无法连接到服务');
  assert.deepEqual(describeProviderError({code:'SOMETHING',message:'Raw message'}),{title:'测试失败',hint:'Raw message',detail:''});
});

function optionsPresentation(t) {
  const h=createDocument(new URL('../public/options.html',import.meta.url));
  let stored=defaultSettings();const requests=[],previous=globalThis.chrome;
  globalThis.chrome={runtime:{sendMessage:async message=>{
    requests.push(message);
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:structuredClone(stored)};
    if(message.type==='KUAI_SAVE_SETTINGS'){stored=structuredClone(message.settings);return {ok:true,value:structuredClone(stored)};}
    assert.fail('Changing presentation must not send '+message.type);
  }}};
  t.after(()=>{globalThis.chrome=previous;});
  return {...h,requests,get stored(){return stored;},start:()=>startOptions(h.document),settle:setImmediate};
}

test('actual settings page saves presentation controls and updates its local preview without translation requests',async t=>{
  const h=optionsPresentation(t);await h.start();
  const size=h.node('page-style-fontSize'),color=h.node('subtitle-style-targetColor');
  assert.ok(size,'page text size must be available in the settings HTML');
  assert.ok(color,'subtitle translation color must be available in the settings HTML');
  size.value='135';await size.fire('input');
  color.value='#ffcc00';await color.fire('input');
  h.node('subtitle-style-displayOrder').value='translation_on_top';await h.node('subtitle-style-displayOrder').fire('change');
  h.node('subtitle-target-language').value='ja';await h.node('subtitle-target-language').fire('change');
  h.node('subtitle-shortcuts').value='letters';await h.node('subtitle-shortcuts').fire('change');
  h.node('subtitle-translation-enabled').checked=false;await h.node('subtitle-translation-enabled').fire('change');
  await h.settle();
  assert.equal(h.stored.subtitleShortcuts,'letters');assert.equal(h.stored.subtitleTranslationEnabled,false);
  assert.equal(h.stored.pageStyle.fontSize,135);
  assert.equal(h.stored.subtitleStyle.targetColor,'#ffcc00');
  assert.equal(h.stored.subtitleStyle.displayOrder,'translation_on_top');
  assert.equal(h.stored.subtitleTargetLanguage,'ja');
  assert.equal(h.node('page-preview-translation').style.fontSize,'135%');
  assert.equal(h.node('subtitle-preview-target').style.color,'#ffcc00');
  assert.equal(h.node('subtitle-preview-target').style.order,'-1');
  assert.ok(h.requests.filter(message=>message.type==='KUAI_SAVE_SETTINGS').every(message=>message.baseSettings));
});

const {createSettingsEditor}=stateModule;

const initial = () => ({providers:[{id:'custom',type:'openai',name:'My API',enabled:true,apiKey:'',model:'old'}],activeProviderId:'custom'});
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; };

test('rapid model and key edits save in order without stale responses overwriting the form', async () => {
  const first=deferred(), calls=[];
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>{calls.push(structuredClone(value)); if(calls.length===1)await first.promise;return value;}});
  await editor.load();
  const a=editor.patchProvider('custom',{model:'manual-model-not-in-a-catalog'});
  const b=editor.patchProvider('custom',{apiKey:'local-test-secret'});
  await Promise.resolve();
  assert.equal(calls.length,1);
  assert.equal(editor.get().providers[0].apiKey,'local-test-secret');
  first.resolve();await Promise.all([a,b]);
  assert.equal(calls.length,2);
  assert.equal(calls[1].providers[0].model,'manual-model-not-in-a-catalog');
  assert.equal(calls[1].providers[0].apiKey,'local-test-secret');
  assert.equal(editor.get().providers[0].apiKey,'local-test-secret');
});

test('a failed save retains editable values and the next save can succeed', async () => {
  let count=0;
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>{if(++count===1)throw Error('Storage unavailable');return value;}});
  await editor.load();
  await assert.rejects(editor.patchProvider('custom',{model:'new-model'}),/Storage unavailable/);
  assert.equal(editor.get().providers[0].model,'new-model');
  await assert.rejects(editor.flush(),/Storage unavailable/,'a popup action must not continue with stale saved settings');
  await editor.retry();
  assert.equal(count,2);
  assert.equal(editor.status().error,null);
});

test('provider add, edit and remove preserve independent instances', async () => {
  let index=0;
  const editor=createSettingsEditor({load:async()=>initial(),save:async value=>value,idFactory:()=>`instance-${++index}`});
  await editor.load();
  const id=await editor.addProvider('openai');
  assert.equal(editor.get().providers[1].model,'gpt-4.1-mini');
  const gemini=await editor.addProvider('gemini'),ollama=await editor.addProvider('ollama');
  assert.equal(editor.get().providers.find(item=>item.id===gemini).model,'gemini-flash-lite-latest');
  assert.equal(editor.get().providers.find(item=>item.id===ollama).model,'');
  await editor.removeProvider(gemini);await editor.removeProvider(ollama);
  await editor.patchProvider(id,{name:'Second',model:'custom-second'});
  assert.equal(editor.get().providers[0].model,'old');
  assert.equal(editor.get().providers[1].model,'custom-second');
  await editor.removeProvider(id);
  assert.equal(editor.get().providers.length,1);
});

test('conflicts retain the draft and stop queued overwrites until explicit reload',async()=>{
  let writes=0;
  const editor=createSettingsEditor({load:async()=>initial(),save:async()=>{writes++;throw Object.assign(Error('Changed in another page'),{code:'SETTINGS_CONFLICT'});}});
  await editor.load();
  const first=editor.patchProvider('custom',{model:'edited-model'}),second=editor.patchProvider('custom',{name:'Edited name'});
  await assert.rejects(first,{code:'SETTINGS_CONFLICT'});await assert.rejects(second,{code:'SETTINGS_CONFLICT'});
  assert.equal(writes,1);assert.equal(editor.get().providers[0].model,'edited-model');
  await editor.reload();assert.equal(editor.get().providers[0].model,'old');assert.equal(editor.status().error,null);
});

const deferredAsync=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};};
const documentBoundary=(page='text')=>createDocument(new URL('../public/'+page+'.html',import.meta.url));

test('a late local file read cannot overwrite a newer file in the actual text page controller',async t=>{
  const previousChrome=globalThis.chrome,previousAdd=globalThis.addEventListener;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,value:defaultSettings()})}};globalThis.addEventListener=()=>{};
  t.after(()=>{globalThis.chrome=previousChrome;globalThis.addEventListener=previousAdd;});
  const h=documentBoundary();await startTextTool(h.document);
  const first=deferredAsync(),file=h.node('file');
  file.files=[{name:'a.txt',size:5,text:()=>first.promise}];const a=file.fire('change');
  assert.equal(h.node('translate').disabled,true,'translation must wait for the selected file to finish reading');
  file.files=[{name:'b.txt',size:5,text:async()=> 'B source'}];await file.fire('change');
  first.resolve('A late source');await a;
  assert.equal(h.node('input').value,'B source');
});

test('model controls fetch, select and save a model while ignoring a stale provider response',async t=>{
  const previousChrome=globalThis.chrome,checks=[],saved=[];
  const settings=defaultSettings();
  for(const id of ['custom-a','custom-b'])settings.providers.push({id,type:'openai',name:id,enabled:true,baseUrl:'',apiKey:'fixture-only',model:'',region:'',temperature:null});
  globalThis.chrome={runtime:{sendMessage:async message=>{
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:settings};
    if(message.type==='KUAI_SAVE_SETTINGS'){saved.push(message.settings);return {ok:true,value:message.settings};}
    if(message.type==='KUAI_CANCEL')return {ok:true,value:{cancelled:true}};
    if(message.type==='KUAI_LIST_MODELS'){const result=deferredAsync();checks.push({message,result});return result.promise;}
    assert.fail('Unexpected message '+message.type);
  }}};
  t.after(()=>{globalThis.chrome=previousChrome;});
  const h=documentBoundary('options');await startOptions(h.document);
  assert.ok(h.node('fetch-models'),'model discovery action exists');
  await h.node('custom-provider-list').children[0].fire('click');
  const first=h.node('fetch-models').fire('click');
  assert.equal(h.node('fetch-models').disabled,true);
  await h.node('custom-provider-list').children[1].fire('click');
  checks[0].result.resolve({ok:true,value:[{id:'stale',name:'Stale'}]});await first;
  assert.equal(h.node('model-status').textContent,'');
  assert.equal(h.node('fetch-models').disabled,false);
  const second=h.node('fetch-models').fire('click');
  checks[1].result.resolve({ok:true,value:[{id:'chosen',name:'Chosen model'}]});await second;
  assert.ok(h.node('provider-model-list').children.some(item=>item.value==='chosen'));
  h.node('provider-model-list').value='chosen';await h.node('provider-model-list').fire('change');
  assert.equal(h.node('provider-model').value,'chosen');
  assert.equal(saved.at(-1).providers.find(item=>item.id==='custom-b').model,'chosen');
  h.node('provider-apiKey').value='new-key';await h.node('provider-apiKey').fire('input');
  assert.equal(h.node('provider-model-list').hidden,true);
  const third=h.node('fetch-models').fire('click');checks[2].result.resolve({ok:false,error:{code:'HTTP_401',message:'Check key'}});await third;
  assert.match(h.node('model-status').textContent,/Check key/);
  assert.equal(h.node('provider-model').value,'chosen');
});

test('settings page opens the browser shortcut page that the popup no longer links to',async t=>{
  const s=options(t),opened=[];await s.start();
  globalThis.chrome.tabs={create:async value=>{opened.push(value.url);}};
  await s.node('browser-shortcuts').fire('click');
  assert.deepEqual(opened,['chrome://extensions/shortcuts']);
});
