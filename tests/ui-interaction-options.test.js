import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {startOptions} from '../dist/src/ui/options.js';
import {defaultSettings,normalizeSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';

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
    ['input','autoApply',false],['input','includeOriginal',true],['input','displayOrder','translation-original'],
    ['input','disabledSites','billing.example','input'],
    ['hover','trigger','custom'],['hover','customKeys','control + k','input'],['hover','mode','area'],
    ['hover','delay','450','input'],['hover','holdDelay','1000','input'],['hover','showIndicator',false],
    ['hover','borderColor','#aabbcc','input'],['hover','disabledSites','chat.example','input'],
  ];
  for(const [group,key,value,event] of cases)await h.edit(group+'-option-'+key,value,event);
  await h.edit('hover-enabled',true);await h.edit('selection-enabled',false);
  assert.deepEqual(h.stored.pageOptions,{autoTranslate:true,alwaysLanguages:['en','ja'],neverLanguages:['ko'],alwaysSites:['example.com','https://news.example/articles/**'],neverSites:['private.example'],translateFullPage:false,excludeSelectors:['.advert','[data-private]'],minTextLength:12,translateDynamic:true,contextMenuEnabled:false,shortcut:'Control+Shift+P',displayModeShortcut:'Alt+D'});
  assert.deepEqual(h.stored.selectionOptions,{providerId:'google',sourceLanguage:'en',targetLanguage:'ja',triggerMode:'dot',triggerAction:'hover',delay:600,maxLength:12000,showOriginal:false,autoSpeak:true,disabledSites:['private.example']});
  assert.deepEqual(h.stored.inputOptions,{enabled:true,providerId:'yandex',sourceLanguage:'ja',targetLanguage:'en',shortcut:'Alt+K',restoreShortcut:'Control+Shift+Z',icon:'icon',autoApply:false,includeOriginal:true,displayOrder:'translation-original',disabledSites:['billing.example']});
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

test('editing a paragraph shortcut migrates an old popup preference without losing other gesture settings',async t=>{
  const savedHover={trigger:'left_hold',customKeys:['K'],mode:'area',delay:650,holdDelay:1200,showIndicator:false,borderColor:'#123abc',disabledSites:['reader.example']};
  const h=options(t,settings=>{settings.hoverEnabled=true;settings.hoverOptions={...structuredClone(savedHover),displayMode:'popup'};});
  await h.start();
  assert.equal(h.writes(),0,'opening the settings page must not issue a save');
  await h.edit('hover-option-trigger','alt');
  assert.deepEqual(h.stored.hoverOptions,{...savedHover,trigger:'alt',displayMode:'inline'});
  assert.equal(h.stored.hoverEnabled,true);
  const reopened=h.reopen();await reopened.start();
  assert.equal(reopened.node('hover-option-trigger').value,'alt');
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
  assert.equal(h.node('input-display-order-field').hidden,true);
  await h.edit('input-option-includeOriginal',true);assert.equal(h.node('input-display-order-field').hidden,false);
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

test('hover instructions describe direct hover, held mouse and empty custom triggers accurately',async t=>{
  const h=options(t);await h.start();
  await h.edit('hover-option-trigger','hover');
  assert.ok(h.node('hover-trigger-help'),'the active hover trigger needs matching instructions');
  assert.match(h.node('hover-trigger-help').textContent,/无需按键/);
  await h.edit('hover-option-trigger','left_hold');assert.match(h.node('hover-trigger-help').textContent,/按住鼠标左键/);
  await h.edit('hover-option-trigger','custom');assert.match(h.node('hover-trigger-help').textContent,/先填写/);
  await h.edit('hover-option-customKeys','Alt+K','input');assert.match(h.node('hover-trigger-help').textContent,/所选按键/);
});

test('invalid or same-context conflicting shortcuts stay visible and never overwrite a saved shortcut',async t=>{
  const h=options(t);await h.start();
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

test('shortcut conflict hints follow changes to the paired action without silently saving an earlier draft',async t=>{
  const h=options(t);await h.start();
  await h.edit('page-option-displayModeShortcut','Alt+Z','input');
  assert.match(h.node('page-option-displayModeShortcut-error').textContent,/冲突/);
  await h.edit('page-option-shortcut','Alt+P','input');
  assert.doesNotMatch(h.node('page-option-displayModeShortcut-error').textContent,/冲突/);
  assert.match(h.node('page-option-displayModeShortcut-error').textContent,/离开/);
  assert.equal(h.stored.pageOptions.displayModeShortcut,'','a previously rejected draft still needs an explicit field edit or blur');
  await h.node('page-option-displayModeShortcut').fire('blur');
  assert.equal(h.stored.pageOptions.displayModeShortcut,'Alt+Z');assert.equal(h.node('page-option-displayModeShortcut-error').hidden,true);
});

test('partial numeric and custom-key edits survive other saves and normalize only when complete or blurred',async t=>{
  const h=options(t);await h.start();
  const field=h.node('selection-option-delay');assert.ok(field,'selection delay must be editable');
  field.focus();field.value='1.';await field.fire('input');await setImmediate();
  await h.edit('input-option-icon','dot');assert.equal(field.value,'1.');
  h.document.activeElement=null;await field.fire('blur');await setImmediate();assert.equal(field.value,'1');assert.equal(h.stored.selectionOptions.delay,1);
  field.focus();field.value='';await field.fire('input');await h.edit('input-option-icon','icon');assert.equal(field.value,'');
  h.document.activeElement=null;await field.fire('blur');assert.equal(field.value,'1','an empty numeric draft returns to the saved value');
  await h.edit('selection-option-delay','9000','input');h.document.activeElement=null;await field.fire('blur');assert.equal(field.value,'2000');assert.equal(h.stored.selectionOptions.delay,2000);
  await h.edit('hover-option-trigger','custom');await h.edit('hover-option-customKeys','Ctrl + K','input');
  const before=h.writes();const keys=await h.edit('hover-option-customKeys','Ctrl +','input');
  assert.equal(h.writes(),before);assert.deepEqual(h.stored.hoverOptions.customKeys,['Control','K']);
  await h.edit('page-option-minTextLength','9','input');assert.equal(keys.value,'Ctrl +');
  await h.edit('hover-option-customKeys','Alt + Alt','input');assert.equal(h.writes(),before+1);assert.match(h.node('hover-option-customKeys-error').textContent,/不同/);
  await h.edit('hover-option-customKeys','a + b','input');assert.deepEqual(h.stored.hoverOptions.customKeys,['A','B']);
});

test('rendering never assigns a focused number value while the browser reports an unfinished input as empty',async t=>{
  const h=options(t);await h.start();
  const field=h.node('selection-option-delay');field.focus();
  let visibleDraft='1e';
  // Native number fields can retain visible incomplete text while their value getter is empty.
  Object.defineProperty(field,'value',{configurable:true,get:()=>'',set:value=>{visibleDraft=String(value);}});
  const before=h.writes();await field.fire('input');
  assert.equal(visibleDraft,'1e','a render must not write over the active native input editor');
  assert.equal(h.writes(),before);
  await h.edit('input-option-icon','dot');assert.equal(visibleDraft,'1e');
  h.document.activeElement=null;await field.fire('blur');assert.equal(visibleDraft,'250');
});

test('an unfinished numeric draft is visibly unsaved until blur restores the last saved number',async t=>{
  const h=options(t);await h.start();
  const field=h.node('selection-option-delay');field.focus();field.value='';await field.fire('input');
  assert.match(h.node('status').textContent,/未完成|未输入完整/);
  assert.equal(h.node('reload-settings').hidden,false,'the user can explicitly discard an unfinished draft');
  h.document.activeElement=null;await field.fire('blur');
  assert.equal(field.value,'250');assert.match(h.node('status').textContent,/已保存/);
});

test('an earlier save finishing after a partial shortcut edit preserves the newer local draft',async t=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});let pause=true;
  const h=options(t,()=>{},async()=>{if(pause){pause=false;await waiting;}});await h.start();
  const field=h.node('page-option-shortcut');field.focus();field.value='Alt+Q';
  const saving=field.fire('input');await setImmediate();
  field.value='Control+';await field.fire('input');
  release();await saving;await setImmediate();
  assert.equal(h.stored.pageOptions.shortcut,'Alt+Q');assert.equal(field.value,'Control+');
  assert.equal(field.getAttribute('aria-invalid'),'true');assert.match(h.node('status').textContent,/未保存/);
});

test('the actual interaction form keeps conflicting save drafts until explicit reload',async t=>{
  let conflict=true;
  const h=options(t,()=>{},()=>conflict?{ok:false,error:{code:'SETTINGS_CONFLICT',message:'Changed in another window'}}:undefined);
  await h.start();await h.edit('selection-option-delay','700','input');
  assert.equal(h.stored.selectionOptions.delay,250);assert.equal(h.node('selection-option-delay').value,'700');
  assert.equal(h.node('reload-settings').hidden,false);assert.equal(h.node('retry-save').hidden,true);
  const before=h.writes();await h.edit('input-option-icon','none');assert.equal(h.writes(),before,'a conflict must stop queued overwrites');
  assert.equal(h.node('selection-option-delay').value,'700');
  conflict=false;await h.node('reload-settings').fire('click');
  assert.equal(h.node('selection-option-delay').value,'250');assert.equal(h.node('input-option-icon').value,'dot');
  await h.edit('input-option-icon','icon');assert.equal(h.stored.inputOptions.icon,'icon');
});

test('input form shows upgraded defaults and retains explicit follow-page choices after reload',async t=>{
  const h=options(t,settings=>{
    delete settings.inputDefaultsVersion;settings.targetLanguage='fr';
    settings.inputOptions.targetLanguage='follow_page';settings.inputOptions.icon='none';
  });
  await h.start();
  assert.equal(h.node('input-option-targetLanguage').value,'en');assert.equal(h.node('input-option-icon').value,'dot');
  await h.edit('input-option-targetLanguage','follow_page');await h.edit('input-option-icon','none');
  assert.equal(h.stored.inputDefaultsVersion,2);assert.equal(h.stored.inputOptions.targetLanguage,'follow_page');assert.equal(h.stored.inputOptions.icon,'none');
  await h.node('reload-settings').fire('click');
  assert.equal(h.node('input-option-targetLanguage').value,'follow_page');assert.equal(h.node('input-option-icon').value,'none');
  assert.equal(h.node('reset-input-options'),null);
  assert.equal(h.stored.targetLanguage,'fr','input edits must not change the webpage target');
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

test('removed interaction resets stay absent while hover reset preserves other settings',async t=>{
  const h=options(t,settings=>{
    settings.providers.push({id:'private-api',type:'openai',name:'My API',enabled:true,baseUrl:'https://api.example/v1',apiKey:'local-secret',model:'my-model',region:'',temperature:null});
    settings.activeProviderId='private-api';settings.pageStyle.preset='marker';settings.subtitleStyle.targetFontSize=35;settings.pageDisplayMode='translation_only';
  });await h.start();
  await h.edit('page-option-minTextLength','27','input');await h.edit('selection-option-providerId','google');await h.edit('input-option-autoApply',false);await h.edit('hover-option-delay','650','input');
  await h.edit('selection-enabled',false);await h.edit('hover-enabled',true);
  const before=structuredClone(h.stored);
  for(const group of ['page','selection','input'])assert.equal(h.node('reset-'+group+'-options'),null);
  await h.node('reset-hover-options').fire('click');await setImmediate();assert.equal(h.stored.hoverOptions.delay,300);assert.equal(h.stored.hoverEnabled,true);
  assert.equal(h.stored.hoverOptions.displayMode,'inline');
  for(const key of ['pageOptions','selectionOptions','inputOptions','selectionEnabled','activeProviderId','providers','pageStyle','subtitleStyle','pageDisplayMode'])assert.deepEqual(h.stored[key],before[key],key+' must survive hover reset');
  const reopened=h.reopen();await reopened.start();assert.equal(reopened.node('hover-option-trigger').value,'shift');
  assert.equal(h.stored.providers.find(item=>item.id==='private-api').apiKey,'local-secret');
  assert.equal(h.stored.pageStyle.preset,'marker');assert.equal(h.stored.subtitleStyle.targetFontSize,35);assert.equal(h.stored.pageDisplayMode,'translation_only');
});

test('enabled provider choices stay current and invalid drafts can be explicitly discarded by reloading',async t=>{
  const h=options(t);await h.start();
  assert.ok(h.node('selection-option-providerId'),'selection must have an independent service choice');
  assert.ok(h.node('selection-option-providerId').children.some(option=>option.value==='follow_page'));
  await h.edit('selection-option-providerId','google');await h.edit('input-option-providerId','google');
  const googleButton=h.node('free-provider-list').children[1];await googleButton.fire('click');await h.edit('provider-enabled',false);
  assert.equal(h.stored.selectionOptions.providerId,'follow_page');assert.equal(h.stored.inputOptions.providerId,'follow_page');
  assert.equal(h.node('selection-option-providerId').children.some(option=>option.value==='google'),false);
  await h.edit('page-option-shortcut','Ctrl+','input');
  await h.node('reload-settings').fire('click');await setImmediate();
  assert.equal(h.node('page-option-shortcut').value,'Alt+Z');assert.equal(h.node('page-option-shortcut-error').hidden,true);
});
