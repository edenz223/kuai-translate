import {getSettings,request,cancel,makeRequestId} from '../shared/client.js';
import {normalizeSettings,exportSettings,importSettings,APP_NAME} from '../shared/settings.js';
import {createSettingsEditor,bindProviderFields,syncProviderFields,createProviderTester} from './state.js';
import {createPresentationControls} from './presentation.js';
import {createInteractionControls} from './interaction-options.js';
import {byId,TYPE_NAMES,FREE_TYPES,LANGUAGES,fillProviders,fillSelect,setStatus,errorMessage,downloadText} from './common.js';

export async function startOptions(document = globalThis.document) {
  document.title=APP_NAME + ' · 设置';
  const status=byId(document,'status'), testStatus=byId(document,'test-status');
  const fail=error=>setStatus(status,errorMessage(error),true);
  let selectedId,providerFingerprint='';
  const tester=createProviderTester({request,cancel,makeRequestId,onState:state=>{
    byId(document,'test-provider').disabled=state.status==='pending';
    setStatus(testStatus,state.status==='pending' ? '正在测试…' : state.status==='success' ? '连接成功：'+(state.result.translations || []).join(' / ') : state.status==='error' ? errorMessage(state.error) : '',state.status==='error');
  }});
  const editor=createSettingsEditor({load:()=>getSettings(true),save:(settings,baseSettings)=>request('KUAI_SAVE_SETTINGS',{settings,baseSettings}),normalize:normalizeSettings});
  const presentation=createPresentationControls({document,editor,onError:fail});
  const interactions=createInteractionControls({document,editor,onError:fail,onValidationChange:()=>render(editor.get(),editor.status())});
  const fields=Object.fromEntries(['name','enabled','baseUrl','apiKey','model','region','temperature'].map(key=>[key,byId(document,'provider-'+key)]));
  const preferences={subtitlesEnabled:'subtitles-enabled',selectionEnabled:'selection-enabled',hoverEnabled:'hover-enabled'};
  function render(settings,state) {
    if (!settings.providers.some(provider=>provider.id===selectedId)) selectedId=settings.providers[0]?.id;
    const host=byId(document,'provider-list');
    host.replaceChildren(...settings.providers.map(provider=>{
      const button=document.createElement('button');button.type='button';button.className='provider-item';
      button.classList.toggle('selected',provider.id===selectedId);button.setAttribute('aria-pressed',String(provider.id===selectedId));
      const name=document.createElement('strong'), detail=document.createElement('span');
      name.textContent=provider.name || TYPE_NAMES[provider.type];detail.textContent=(TYPE_NAMES[provider.type] || provider.type)+(provider.enabled ? '' : ' · 已停用');
      button.append(name,detail);button.addEventListener('click',()=>{selectedId=provider.id;setStatus(testStatus,'');render(editor.get(),editor.status());});return button;
    }));
    const provider=settings.providers.find(item=>item.id===selectedId), free=FREE_TYPES.includes(provider?.type);
    const fingerprint=JSON.stringify(provider);
    if(fingerprint!==providerFingerprint){providerFingerprint=fingerprint;tester.invalidate();}
    byId(document,'provider-form').hidden=!provider;
    if(provider) {
      byId(document,'provider-kind').textContent=TYPE_NAMES[provider.type] || provider.type;
      byId(document,'custom-fields').hidden=free;
      byId(document,'free-notice').hidden=!free;
      byId(document,'delete-provider').disabled=free;
      fields.name.readOnly=free;
      syncProviderFields({fields,provider,activeElement:document.activeElement});
      const machine=['azure','deepl','deeplx'].includes(provider.type);
      byId(document,'model-field').hidden=machine;byId(document,'temperature-field').hidden=machine;
      byId(document,'region-field').hidden=provider.type!=='azure';
      byId(document,'key-help').textContent=['deeplx','ollama'].includes(provider.type) ? '自建服务可不填 Key。请填写自己的服务地址。' : '仅保存在扩展本地存储中。测试和翻译时发往所选服务。';
      fields.baseUrl.placeholder=({openai:'https://api.openai.com/v1',gemini:'https://generativelanguage.googleapis.com',anthropic:'https://api.anthropic.com',azure:'https://api.cognitive.microsofttranslator.com',deepl:'https://api-free.deepl.com',deeplx:'https://your-server.example/translate',ollama:'http://localhost:11434'})[provider.type] || '';
    }
    fillProviders(document,byId(document,'active-provider'),settings,settings.activeProviderId);
    fillProviders(document,byId(document,'subtitle-provider'),settings,settings.subtitleProviderId,true);
    fillSelect(document,byId(document,'source-language'),LANGUAGES,settings.sourceLanguage);
    fillSelect(document,byId(document,'target-language'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);
    for(const [key,id] of Object.entries(preferences))byId(document,id).checked=!!settings[key];
    presentation.render(settings);
    interactions.render(settings);
    const conflicted=state.error?.code==='SETTINGS_CONFLICT';
    const invalid=interactions.validationCount(),incomplete=interactions.incompleteCount();
    byId(document,'retry-save').hidden=!state.error || conflicted;
    byId(document,'reload-settings').hidden=!conflicted && !invalid && !incomplete;
    byId(document,'reload-settings').disabled=state.saving;
    setStatus(status,conflicted ? '其他页面修改了同一配置，当前草稿仍保留。请先复制需要保留的修改，再重新读取最新设置。' : state.error ? '保存失败：'+errorMessage(state.error) : invalid ? `有 ${invalid} 项输入尚未保存，请修正对应提示。其他设置仍会正常保存。` : incomplete ? `有 ${incomplete} 项数字未输入完整，完成输入后自动保存；留空并离开输入框会恢复已保存值。` : state.saving ? '正在保存…' : '设置已保存到此浏览器。',!!state.error || !!invalid);
  }
  editor.subscribe(render);
  try {await editor.load();}catch(error){fail(error);return;}
  presentation.bind();
  interactions.bind();
  bindProviderFields({fields,editor,getId:()=>selectedId,onError:fail});
  for(const field of Object.values(fields))field.addEventListener('blur',()=>syncProviderFields({fields,provider:editor.get().providers.find(item=>item.id===selectedId)}));
  const selectFields={'active-provider':'activeProviderId','subtitle-provider':'subtitleProviderId','source-language':'sourceLanguage','target-language':'targetLanguage'};
  for(const [id,key] of Object.entries(selectFields))byId(document,id).addEventListener('change',event=>editor.update(settings=>{settings[key]=event.target.value;}).catch(fail));
  for(const [key,id] of Object.entries(preferences))byId(document,id).addEventListener('change',event=>editor.update(settings=>{settings[key]=event.target.checked;}).catch(fail));
  byId(document,'retry-save').addEventListener('click',()=>editor.retry().catch(fail));
  byId(document,'reload-settings').addEventListener('click',async()=>{try{await editor.reload();interactions.resetDrafts();render(editor.get(),editor.status());}catch(error){fail(error);}});
  byId(document,'add-provider').addEventListener('click',async()=>{try{selectedId=await editor.addProvider(byId(document,'provider-type').value);render(editor.get(),editor.status());}catch(error){fail(error);}});
  byId(document,'delete-provider').addEventListener('click',()=>editor.removeProvider(selectedId).catch(fail));
  byId(document,'show-key').addEventListener('click',event=>{const show=fields.apiKey.type==='password';fields.apiKey.type=show?'text':'password';event.target.textContent=show?'隐藏':'显示';});
  byId(document,'test-provider').addEventListener('click',()=>tester.test(editor.get().providers.find(item=>item.id===selectedId)));
  document.defaultView?.addEventListener('pagehide',()=>tester.invalidate(),{once:true});
  byId(document,'export-settings').addEventListener('click',()=>{
    try {const value=exportSettings(editor.get(),{includeSecrets:byId(document,'include-secrets').checked});downloadText(document,'kuai-translate-settings.json',typeof value==='string'?value:JSON.stringify(value,null,2),'application/json');}
    catch(error){fail(error);}
  });
  byId(document,'import-settings').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try {if(file.size>2*1024*1024)throw Error('配置文件超过 2 MB。');const incoming=JSON.parse(await file.text());const merged=importSettings(incoming,editor.get());await editor.replace(merged);interactions.resetDrafts();render(editor.get(),editor.status());setStatus(status,'已导入可识别的直连/免费配置，原平台账号信息不会导入。');}
    catch(error){fail(error);}finally{event.target.value='';}
  });
}
if(globalThis.document)startOptions();
