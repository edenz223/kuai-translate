import test from 'node:test';
import assert from 'node:assert/strict';
import {startOptions} from '../dist/src/ui/options.js';
import {defaultSettings} from '../dist/src/shared/settings.js';
import {describeProviderError,providerProblems,providerIssue,nextProviderName} from '../dist/src/ui/common.js';
import {createDocument} from './helpers/ui-document.cjs';

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

test('an empty custom group explains custom APIs, and free services hide custom-only fields',async t=>{
  const h=await open(t,defaultSettings());
  assert.equal(h.node('custom-empty').hidden,false);
  assert.equal(h.node('custom-fields').hidden,true);
  assert.equal(h.node('delete-provider').hidden,true);
  assert.equal(h.node('free-notice').hidden,false);
  assert.equal(h.node('make-default').hidden,true,'the default service has no make-default action');
  assert.match(h.node('provider-usage').textContent,/网页翻译默认使用此服务/);
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

test('make default switches web translation to the selected service',async t=>{
  const settings=defaultSettings();settings.providers.push(custom('a'),custom('off',{enabled:false}));
  const h=await open(t,settings);
  await h.node('custom-provider-list').children[1].fire('click');
  assert.equal(h.node('make-default').disabled,true,'a disabled service cannot become the default');
  await h.node('custom-provider-list').children[0].fire('click');
  assert.equal(h.document.activeElement,h.node('custom-provider-list').children[0],'focus follows the re-rendered row');
  await h.node('make-default').fire('click');
  assert.equal(h.saved.at(-1).activeProviderId,'a');
  assert.equal(h.node('make-default').hidden,true);
  assert.deepEqual(chips(h.node('custom-provider-list').children[0]),['网页']);
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
