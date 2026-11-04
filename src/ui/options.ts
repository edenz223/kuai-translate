import type {ProviderModel} from '../providers/index.js';
import type {Settings} from '../shared/settings.js';
import type {EditorStatus} from './state.js';

import {getSettings,request,cancel,makeRequestId} from '../shared/client.js';
import {normalizeSettings,exportSettings,importSettings,APP_NAME} from '../shared/settings.js';
import {createSettingsEditor,bindProviderFields,syncProviderFields,createProviderTester} from './state.js';
import {createPresentationControls} from './presentation.js';
import {createInteractionControls} from './interaction-options.js';
import {byId,TYPE_NAMES,FREE_TYPES,LANGUAGES,fillProviders,fillSelect,setStatus,errorMessage,downloadText} from './common.js';

export async function startOptions(document: Document = globalThis.document): Promise<void> {
  document.title=APP_NAME + ' · 设置';
  const status=byId(document,'status'), testStatus=byId(document,'test-status');
  const fail=(error: unknown): void=>setStatus(status,errorMessage(error),true);
  let selectedId: string | undefined,providerFingerprint: string | undefined='';
  const tester=createProviderTester({request,cancel,makeRequestId,onState:state=>{
    byId<HTMLButtonElement>(document,'test-provider').disabled=state.status==='pending';
    setStatus(testStatus,state.status==='pending' ? '正在测试…' : state.status==='success' ? '连接成功：'+(state.result.translations || []).join(' / ') : state.status==='error' ? errorMessage(state.error) : '',state.status==='error');
  }});
  const editor=createSettingsEditor({load:()=>getSettings(true),save:(settings,baseSettings)=>request('KUAI_SAVE_SETTINGS',{settings,baseSettings}),normalize:normalizeSettings});
  const presentation=createPresentationControls({document,editor,onError:fail});
  const interactions=createInteractionControls({document,editor,onError:fail,onValidationChange:()=>render(editor.get(),editor.status())});
  const fields=Object.fromEntries(['name','enabled','baseUrl','apiKey','model','region','temperature'].map(key=>[key,byId<HTMLInputElement>(document,'provider-'+key)]));
  const modelSelect=byId<HTMLSelectElement>(document,'provider-model-list'),modelButton=byId<HTMLButtonElement>(document,'fetch-models'),modelStatus=byId(document,'model-status');
  let modelGeneration=0,modelRequestId:string|undefined,modelFingerprint='',models:ProviderModel[]=[];
  function invalidateModels():void {
    modelGeneration++;
    if(modelRequestId)void cancel(modelRequestId).catch(()=>{});
    modelRequestId=undefined;models=[];modelButton.disabled=false;modelSelect.hidden=true;
    modelSelect.replaceChildren();setStatus(modelStatus,'');
  }
  const preferences: Record<'subtitlesEnabled' | 'selectionEnabled' | 'hoverEnabled',string>={subtitlesEnabled:'subtitles-enabled',selectionEnabled:'selection-enabled',hoverEnabled:'hover-enabled'};
  function render(settings: Settings,state: EditorStatus): void {
    if (!settings.providers.some(provider=>provider.id===selectedId)) selectedId=settings.providers[0]?.id;
    const host=byId(document,'provider-list');
    host.replaceChildren(...settings.providers.map(provider=>{
      const button=document.createElement('button');button.type='button';button.className='provider-item';
      button.classList.toggle('selected',provider.id===selectedId);button.setAttribute('aria-pressed',String(provider.id===selectedId));
      const name=document.createElement('strong'), detail=document.createElement('span');
      name.textContent=provider.name || TYPE_NAMES[provider.type];detail.textContent=(TYPE_NAMES[provider.type] || provider.type)+(provider.enabled ? '' : ' · 已停用');
      button.append(name,detail);button.addEventListener('click',()=>{selectedId=provider.id;setStatus(testStatus,'');render(editor.get(),editor.status());});return button;
    }));
    const provider=settings.providers.find(item=>item.id===selectedId), free=FREE_TYPES.includes(provider?.type as string);
    const modelKey=JSON.stringify(provider && [provider.id,provider.type,provider.baseUrl,provider.apiKey]);
    if(modelKey!==modelFingerprint){modelFingerprint=modelKey;invalidateModels();}
    if(models.length && provider)fillSelect(document,modelSelect,[['','请选择模型'],...models.map((model):[string,string]=>[model.id,model.name===model.id?model.id:model.name+' · '+model.id])],provider.model || '');
    const fingerprint=JSON.stringify(provider);
    if(fingerprint!==providerFingerprint){providerFingerprint=fingerprint;tester.invalidate();}
    byId(document,'provider-form').hidden=!provider;
    if(provider) {
      byId(document,'provider-kind').textContent=TYPE_NAMES[provider.type] || provider.type;
      byId(document,'custom-fields').hidden=free;
      byId(document,'free-notice').hidden=!free;
      byId<HTMLButtonElement>(document,'delete-provider').disabled=free;
      fields.name.readOnly=free;
      syncProviderFields({fields,provider,activeElement:document.activeElement});
      const machine=['azure','deepl','deeplx'].includes(provider.type);
      byId(document,'model-field').hidden=machine;byId(document,'temperature-field').hidden=machine;
      byId(document,'region-field').hidden=provider.type!=='azure';
      byId(document,'key-help').textContent=['deeplx','ollama'].includes(provider.type) ? '自建服务可不填 Key。请填写自己的服务地址。' : '仅保存在扩展本地存储中。获取模型、测试和翻译时发往所选服务。';
      fields.baseUrl.placeholder=({openai:'https://api.openai.com/v1',gemini:'https://generativelanguage.googleapis.com',anthropic:'https://api.anthropic.com',azure:'https://api.cognitive.microsofttranslator.com',deepl:'https://api-free.deepl.com',deeplx:'https://your-server.example/translate',ollama:'http://localhost:11434'} as Record<string,string>)[provider.type] || '';
    }
    fillProviders(document,byId<HTMLSelectElement>(document,'active-provider'),settings,settings.activeProviderId);
    fillProviders(document,byId<HTMLSelectElement>(document,'subtitle-provider'),settings,settings.subtitleProviderId,true);
    fillSelect(document,byId<HTMLSelectElement>(document,'source-language'),LANGUAGES,settings.sourceLanguage);
    fillSelect(document,byId<HTMLSelectElement>(document,'target-language'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);
    for(const [key,id] of Object.entries(preferences))byId<HTMLInputElement>(document,id).checked=!!settings[key as keyof Settings];
    presentation.render(settings);
    interactions.render(settings);
    const conflicted=(state.error as {code?: string} | null)?.code==='SETTINGS_CONFLICT';
    const invalid=interactions.validationCount(),incomplete=interactions.incompleteCount();
    byId(document,'retry-save').hidden=!state.error || conflicted;
    byId<HTMLButtonElement>(document,'reload-settings').hidden=!conflicted && !invalid && !incomplete;
    byId<HTMLButtonElement>(document,'reload-settings').disabled=state.saving;
    setStatus(status,conflicted ? '其他页面修改了同一配置，当前草稿仍保留。请先复制需要保留的修改，再重新读取最新设置。' : state.error ? '保存失败：'+errorMessage(state.error) : invalid ? `有 ${invalid} 项输入尚未保存，请修正对应提示。其他设置仍会正常保存。` : incomplete ? `有 ${incomplete} 项数字未输入完整，完成输入后自动保存；留空并离开输入框会恢复已保存值。` : state.saving ? '正在保存…' : '设置已保存到此浏览器。',!!state.error || !!invalid);
  }
  editor.subscribe(render);
  try {await editor.load();}catch(error){fail(error);return;}
  presentation.bind();
  interactions.bind();
  bindProviderFields({fields,editor,getId:()=>selectedId,onError:fail});
  for(const field of Object.values(fields))field.addEventListener('blur',()=>syncProviderFields({fields,provider:editor.get().providers.find(item=>item.id===selectedId)}));
  const selectFields={'active-provider':'activeProviderId','subtitle-provider':'subtitleProviderId','source-language':'sourceLanguage','target-language':'targetLanguage'};
  for(const [id,key] of Object.entries(selectFields))byId(document,id).addEventListener('change',event=>editor.update(settings=>{(settings as unknown as Record<string,unknown>)[key]=(event.target as HTMLSelectElement).value;}).catch(fail));
  for(const [key,id] of Object.entries(preferences))byId(document,id).addEventListener('change',event=>editor.update(settings=>{(settings as unknown as Record<string,unknown>)[key]=(event.target as HTMLInputElement).checked;}).catch(fail));
  byId(document,'retry-save').addEventListener('click',()=>editor.retry().catch(fail));
  byId<HTMLButtonElement>(document,'reload-settings').addEventListener('click',async()=>{try{await editor.reload();interactions.resetDrafts();render(editor.get(),editor.status());}catch(error){fail(error);}});
  byId(document,'add-provider').addEventListener('click',async()=>{try{selectedId=await editor.addProvider(byId<HTMLSelectElement>(document,'provider-type').value);render(editor.get(),editor.status());}catch(error){fail(error);}});
  byId<HTMLButtonElement>(document,'delete-provider').addEventListener('click',()=>editor.removeProvider(selectedId).catch(fail));
  byId(document,'show-key').addEventListener('click',event=>{const show=fields.apiKey.type==='password';fields.apiKey.type=show?'text':'password';(event.target as HTMLButtonElement).textContent=show?'隐藏':'显示';});
  byId<HTMLButtonElement>(document,'test-provider').addEventListener('click',()=>tester.test(editor.get().providers.find(item=>item.id===selectedId)!));
  modelSelect.addEventListener('change',async()=>{
    if(modelSelect.value)try{fields.model.value=modelSelect.value;await editor.patchProvider(selectedId,{model:modelSelect.value});}catch(error){fail(error);}
  });
  modelButton.addEventListener('click',async()=>{
    const provider=editor.get().providers.find(item=>item.id===selectedId);
    if(!provider || modelButton.disabled)return;
    const generation=++modelGeneration,requestId=makeRequestId();modelRequestId=requestId;
    modelButton.disabled=true;setStatus(modelStatus,'正在获取模型…');
    try{
      const result=await request('KUAI_LIST_MODELS',{provider,requestId});
      if(generation!==modelGeneration)return;
      models=result;modelSelect.hidden=!models.length;
      render(editor.get(),editor.status());
      setStatus(modelStatus,models.length?`已获取 ${models.length} 个模型，请选择；也可手动填写。`:'服务未返回可用模型，可重试或手动填写模型名。');
    }catch(error){if(generation===modelGeneration)setStatus(modelStatus,'获取失败：'+errorMessage(error)+'；可重试或手动填写模型名。',true);}
    finally{if(generation===modelGeneration){modelRequestId=undefined;modelButton.disabled=false;}}
  });
  document.defaultView?.addEventListener('pagehide',()=>{tester.invalidate();invalidateModels();},{once:true});
  byId(document,'export-settings').addEventListener('click',()=>{
    try {const value=exportSettings(editor.get(),{includeSecrets:byId<HTMLInputElement>(document,'include-secrets').checked});downloadText(document,'kuai-translate-settings.json',typeof value==='string'?value:JSON.stringify(value,null,2),'application/json');}
    catch(error){fail(error);}
  });
  byId(document,'import-settings').addEventListener('change',async event=>{
    const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
    try {if(file.size>2*1024*1024)throw Error('配置文件超过 2 MB。');const incoming=JSON.parse(await file.text());const merged=importSettings(incoming,editor.get());await editor.replace(merged);interactions.resetDrafts();render(editor.get(),editor.status());setStatus(status,'已导入可识别的直连/免费配置，原平台账号信息不会导入。');}
    catch(error){fail(error);}finally{(event.target as HTMLInputElement).value='';}
  });
}
if(globalThis.document)startOptions();
