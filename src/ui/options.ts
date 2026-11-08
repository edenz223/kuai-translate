import type {ProviderModel} from '../providers/index.js';
import type {Settings} from '../shared/settings.js';
import type {EditorStatus} from './state.js';

import {getSettings,request,cancel,makeRequestId} from '../shared/client.js';
import {normalizeSettings,exportSettings,importSettings,APP_NAME} from '../shared/settings.js';
import {createSettingsEditor,bindProviderFields,syncProviderFields,createProviderTester} from './state.js';
import {createPresentationControls} from './presentation.js';
import {createInteractionControls} from './interaction-options.js';
import {byId,TYPE_NAMES,FREE_TYPES,LANGUAGES,PROVIDER_INFO,fillProviders,fillSelect,setStatus,errorMessage,downloadText,providerProblems,providerIssue,urlProblem,providerUsage,nextProviderName,describeProviderError} from './common.js';
import type {ProviderField} from './common.js';
import type {Provider} from '../shared/settings.js';

/** Hint icons sit inside labels: clicking must not toggle the control, and bubbles stay inside the viewport. */
function bindHints(document: Document): void {
  const hintOf=(event: Event): HTMLElement | null=>(event.target as Element | null)?.closest?.<HTMLElement>('.hint') ?? null;
  document.addEventListener('click',event=>{if(hintOf(event))event.preventDefault();});
  const place=(event: Event): void=>{
    const hint=hintOf(event),bubble=hint?.querySelector<HTMLElement>('.hint-text'),view=document.documentElement;
    if(!hint || !bubble)return;
    hint.classList.remove('above');bubble.style.setProperty('--hint-shift','0px');
    const rect=bubble.getBoundingClientRect(),margin=8;
    const shift=rect.left<margin ? margin-rect.left : rect.right>view.clientWidth-margin ? view.clientWidth-margin-rect.right : 0;
    bubble.style.setProperty('--hint-shift',shift+'px');
    hint.classList.toggle('above',rect.bottom>view.clientHeight-margin && rect.height+margin<hint.getBoundingClientRect().top);
  };
  document.addEventListener('mouseover',place);
  document.addEventListener('focusin',place);
}

const SECTIONS=['webpage','hover','selection','input','subtitles','providers','backup'];
/** One section at a time; the address hash keeps links from the popup and context menu working. */
function bindSections(document: Document): void {
  const view=document.defaultView;
  const show=(): void=>{
    const hash=view?.location?.hash.slice(1) || '',current=SECTIONS.includes(hash) ? hash : SECTIONS[0];
    for(const id of SECTIONS){
      byId(document,id).hidden=id!==current;
      const link=byId(document,'nav-'+id);
      if(id===current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
    view?.scrollTo?.(0,0);
  };
  view?.addEventListener('hashchange',show);
  show();
}

export async function startOptions(document: Document = globalThis.document): Promise<void> {
  document.title=APP_NAME + ' · 设置';
  bindHints(document);
  bindSections(document);
  const status=byId(document,'status'), testStatus=byId(document,'test-status');
  const fail=(error: unknown): void=>setStatus(status,errorMessage(error),true);
  let selectedId: string | undefined,providerFingerprint: string | undefined='',pickerOpen=false;
  // Session-only: which fields the user has left, and the last test result per provider version.
  const touched=new Set<string>(),urlDrafts=new Map<string,string>(),testResults=new Map<string,{fingerprint:string;ok:boolean}>();
  let testStarted=0,testFingerprint='',rows=new Map<string,HTMLButtonElement>();
  const testDetail=byId(document,'test-detail');
  const tester=createProviderTester({request,cancel,makeRequestId,onState:state=>{
    byId<HTMLButtonElement>(document,'test-provider').disabled=state.status==='pending';
    byId(document,'test-result').dataset.state=state.status;
    let detail='';
    if(state.status==='success'){
      setStatus(testStatus,`连接成功 · ${Date.now()-testStarted} ms`);
      detail='示例译文：'+(state.result.translations || []).join(' / ');
    }else if(state.status==='error'){
      const error=describeProviderError(state.error);
      setStatus(testStatus,error.title+'：'+error.hint,true);
      if(error.detail)detail='服务返回：'+error.detail;
    }else setStatus(testStatus,state.status==='pending' ? '正在测试…' : '');
    testDetail.textContent=detail;testDetail.hidden=!detail;
    if(state.status==='success' || state.status==='error'){
      testResults.set(state.providerId,{fingerprint:testFingerprint,ok:state.status==='success'});
      render(editor.get(),editor.status());
    }
  }});
  const editor=createSettingsEditor({load:()=>getSettings(true),save:(settings,baseSettings)=>request('KUAI_SAVE_SETTINGS',{settings,baseSettings}),normalize:normalizeSettings});
  const presentation=createPresentationControls({document,editor,onError:fail});
  const interactions=createInteractionControls({document,editor,onError:fail,onValidationChange:()=>render(editor.get(),editor.status())});
  const fields=Object.fromEntries(['name','enabled','baseUrl','apiKey','model','region','temperature','systemPrompt','userPrompt'].map(key=>[key,byId<HTMLInputElement>(document,'provider-'+key)]));
  const problemFields: ProviderField[]=['baseUrl','apiKey','model'];
  const modelSelect=byId<HTMLSelectElement>(document,'provider-model-list'),modelButton=byId<HTMLButtonElement>(document,'fetch-models'),modelStatus=byId(document,'model-status');
  let modelGeneration=0,modelRequestId:string|undefined,modelFingerprint='',models:ProviderModel[]=[];
  function invalidateModels():void {
    modelGeneration++;
    if(modelRequestId)void cancel(modelRequestId).catch(()=>{});
    modelRequestId=undefined;models=[];modelButton.disabled=false;modelSelect.hidden=true;
    modelSelect.replaceChildren();setStatus(modelStatus,'');
  }
  const preferences: Record<'subtitlesEnabled' | 'selectionEnabled' | 'hoverEnabled',string>={subtitlesEnabled:'subtitles-enabled',selectionEnabled:'selection-enabled',hoverEnabled:'hover-enabled'};
  function select(id: string,focus=false): void {
    selectedId=id;pickerOpen=false;setStatus(testStatus,'');render(editor.get(),editor.status());
    if(focus)rows.get(id)?.focus();
  }
  function render(settings: Settings,state: EditorStatus): void {
    if (!settings.providers.some(provider=>provider.id===selectedId)) selectedId=settings.providers[0]?.id;
    const free=settings.providers.filter(item=>FREE_TYPES.includes(item.type)),custom=settings.providers.filter(item=>!FREE_TYPES.includes(item.type)),order=[...free,...custom];
    rows=new Map();
    const chip=(text: string,kind: string): HTMLElement=>{const node=document.createElement('span');node.className='chip '+kind;node.textContent=text;return node;};
    const row=(provider: Provider): HTMLButtonElement=>{
      const button=document.createElement('button'),selected=provider.id===selectedId;button.type='button';button.className='provider-item';button.dataset.providerId=provider.id;
      button.classList.toggle('selected',selected);
      if(selected)button.setAttribute('aria-current','true');
      const name=document.createElement('strong');name.textContent=provider.name || TYPE_NAMES[provider.type];button.append(name);
      if(!FREE_TYPES.includes(provider.type)){const detail=document.createElement('span');detail.className='provider-type-name';detail.textContent=(TYPE_NAMES[provider.type] || provider.type)+(provider.model ? ' · '+provider.model : '');button.append(detail);}
      const result=testResults.get(provider.id),issue=providerIssue(provider);
      const chips=[...providerUsage(settings,provider.id).map(label=>chip(label,'use'))];
      if(!provider.enabled)chips.push(chip('已停用','off'));
      if(issue)chips.push(chip(issue,'warn'));
      else if(result?.fingerprint===JSON.stringify(provider))chips.push(chip(result.ok ? '测试通过' : '测试失败',result.ok ? 'ok' : 'warn'));
      if(chips.length){const host=document.createElement('span');host.className='chips';host.append(...chips);button.append(host);}
      button.addEventListener('click',()=>select(provider.id,true));
      button.addEventListener('keydown',event=>{
        const key=(event as KeyboardEvent).key;if(key!=='ArrowDown' && key!=='ArrowUp')return;
        event.preventDefault();
        const next=order[order.findIndex(item=>item.id===provider.id)+(key==='ArrowDown' ? 1 : -1)];
        if(next)select(next.id,true);
      });
      rows.set(provider.id,button);return button;
    };
    byId(document,'free-provider-list').replaceChildren(...free.map(row));
    byId(document,'custom-provider-list').replaceChildren(...custom.map(row));
    byId(document,'custom-empty').hidden=custom.length>0;
    byId(document,'provider-picker').hidden=!pickerOpen;
    byId(document,'add-provider').setAttribute('aria-expanded',String(pickerOpen));
    const provider=settings.providers.find(item=>item.id===selectedId), isFree=FREE_TYPES.includes(provider?.type as string);
    const modelKey=JSON.stringify(provider && [provider.id,provider.type,provider.baseUrl,provider.apiKey]);
    if(modelKey!==modelFingerprint){modelFingerprint=modelKey;invalidateModels();}
    if(models.length && provider)fillSelect(document,modelSelect,[['','请选择模型'],...models.map((model):[string,string]=>[model.id,model.name===model.id?model.id:model.name+' · '+model.id])],provider.model || '');
    const fingerprint=JSON.stringify(provider);
    if(fingerprint!==providerFingerprint){providerFingerprint=fingerprint;tester.invalidate();}
    byId(document,'provider-form').hidden=!provider || pickerOpen;
    if(provider) {
      const info=PROVIDER_INFO[provider.type],active=provider.id===settings.activeProviderId;
      byId(document,'provider-title').textContent=provider.name || TYPE_NAMES[provider.type] || provider.type;
      byId(document,'provider-kind').textContent=TYPE_NAMES[provider.type] || provider.type;
      const usage=[],others=providerUsage(settings,provider.id).filter(label=>label!=='网页');
      if(active)usage.push('网页翻译默认使用此服务，跟随网页设置的功能也会使用它');
      if(others.length)usage.push(others.join('、')+'指定使用此服务');
      if(!provider.enabled)usage.push('已停用，不会出现在服务选择器中');
      const usageNode=byId(document,'provider-usage');usageNode.textContent=usage.map(text=>text+'。').join('');usageNode.hidden=!usage.length;
      const makeDefault=byId<HTMLButtonElement>(document,'make-default');
      makeDefault.hidden=active;makeDefault.disabled=!provider.enabled;makeDefault.title=provider.enabled ? '' : '先启用此服务';
      byId(document,'custom-fields').hidden=isFree;
      byId(document,'free-notice').hidden=!isFree;
      byId(document,'delete-provider').hidden=isFree;
      fields.name.readOnly=isFree;
      syncProviderFields({fields,provider,activeElement:document.activeElement});
      const urlDraft=urlDrafts.get(provider.id);
      if(urlDraft!==undefined && fields.baseUrl!==document.activeElement)fields.baseUrl.value=urlDraft;
      if(info) {
        byId(document,'model-field').hidden=!info.models;byId(document,'advanced-field').hidden=!info.models;
        byId(document,'region-field').hidden=!info.region;
        byId(document,'baseUrl-required').hidden=!info.urlRequired;byId(document,'apiKey-required').hidden=!info.keyRequired;
        byId(document,'baseUrl-help').textContent=info.urlHelp;byId(document,'key-help').textContent=info.keyHelp;
        const link=byId<HTMLAnchorElement>(document,'key-link');link.hidden=!info.keyUrl;if(info.keyUrl)link.href=info.keyUrl;
        fields.baseUrl.placeholder=info.defaultUrl;
        const problems=providerProblems(urlDraft===undefined ? provider : {...provider,baseUrl:urlDraft});
        if(urlDraft!==undefined)problems.baseUrl='未保存：'+problems.baseUrl;
        for(const field of problemFields) {
          const message=touched.has(provider.id+':'+field) ? problems[field] : undefined,node=byId(document,field+'-error');
          node.textContent=message || '';node.hidden=!message;
          if(message)fields[field].setAttribute('aria-invalid','true');else fields[field].removeAttribute('aria-invalid');
        }
      }
    }
    fillProviders(document,byId<HTMLSelectElement>(document,'active-provider'),settings,settings.activeProviderId);
    fillProviders(document,byId<HTMLSelectElement>(document,'subtitle-provider'),settings,settings.subtitleProviderId,true);
    fillSelect(document,byId<HTMLSelectElement>(document,'source-language'),LANGUAGES,settings.sourceLanguage);
    fillSelect(document,byId<HTMLSelectElement>(document,'target-language'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);
    for(const [key,id] of Object.entries(preferences))byId<HTMLInputElement>(document,id).checked=!!settings[key as keyof Settings];
    byId(document,'subtitle-options-panel').hidden=!settings.subtitlesEnabled;
    byId<HTMLButtonElement>(document,'page-swap-languages').disabled=settings.sourceLanguage==='auto';
    byId(document,'page-swap-help').hidden=settings.sourceLanguage!=='auto';
    presentation.render(settings);
    interactions.render(settings);
    const conflicted=(state.error as {code?: string} | null)?.code==='SETTINGS_CONFLICT';
    const unsavedUrls=[...urlDrafts.keys()].filter(id=>touched.has(id+':baseUrl') && settings.providers.some(item=>item.id===id)).length;
    const invalid=interactions.validationCount()+unsavedUrls,incomplete=interactions.incompleteCount();
    // The sidebar shows which features are off and which hidden section still holds an unsaved draft.
    const off: Record<string,boolean>={hover:!settings.hoverEnabled,selection:!settings.selectionEnabled,input:!settings.inputOptions.enabled,subtitles:!settings.subtitlesEnabled};
    const unsaved=new Set(interactions.invalidGroups().map(group=>group==='page' ? 'webpage' : group));
    if(unsavedUrls)unsaved.add('providers');
    for(const id of SECTIONS){const link=byId(document,'nav-'+id);link.classList.toggle('off',!!off[id]);link.classList.toggle('invalid',unsaved.has(id));}
    byId(document,'retry-save').hidden=!state.error || conflicted;
    byId<HTMLButtonElement>(document,'reload-settings').hidden=!conflicted && !invalid && !incomplete;
    byId<HTMLButtonElement>(document,'reload-settings').disabled=state.saving;
    setStatus(status,conflicted ? '其他页面修改了同一配置，当前草稿仍保留。请先复制需要保留的修改，再重新读取最新设置。' : state.error ? '保存失败：'+errorMessage(state.error) : invalid ? `有 ${invalid} 项输入尚未保存，请修正对应提示。其他设置仍会正常保存。` : incomplete ? `有 ${incomplete} 项数字未输入完整，完成输入后自动保存；留空并离开输入框会恢复已保存值。` : state.saving ? '正在保存…' : '更改已自动保存',!!state.error || !!invalid);
  }
  editor.subscribe(render);
  try {await editor.load();}catch(error){fail(error);return;}
  presentation.bind();
  interactions.bind();
  // The address may pass through invalid text while typing; keep it as a draft instead of failing the save.
  const {baseUrl:baseUrlField,...boundFields}=fields;
  bindProviderFields({fields:boundFields,editor,getId:()=>selectedId,onError:fail});
  baseUrlField.addEventListener('input',()=>{
    const id=selectedId,value=baseUrlField.value;
    if(!id)return;
    if(value.trim() && urlProblem(value,undefined,true)){urlDrafts.set(id,value);render(editor.get(),editor.status());return;}
    urlDrafts.delete(id);
    return editor.patchProvider(id,{baseUrl:value}).then(()=>{},fail);
  });
  for(const [key,field] of Object.entries(fields))field.addEventListener('blur',()=>{
    syncProviderFields({fields,provider:editor.get().providers.find(item=>item.id===selectedId)});
    if(selectedId && problemFields.includes(key as ProviderField)){touched.add(selectedId+':'+key);render(editor.get(),editor.status());}
  });
  const selectFields={'active-provider':'activeProviderId','subtitle-provider':'subtitleProviderId','source-language':'sourceLanguage','target-language':'targetLanguage'};
  for(const [id,key] of Object.entries(selectFields))byId(document,id).addEventListener('change',event=>editor.update(settings=>{(settings as unknown as Record<string,unknown>)[key]=(event.target as HTMLSelectElement).value;}).catch(fail));
  for(const [key,id] of Object.entries(preferences))byId(document,id).addEventListener('change',event=>editor.update(settings=>{(settings as unknown as Record<string,unknown>)[key]=(event.target as HTMLInputElement).checked;}).catch(fail));
  byId(document,'page-swap-languages').addEventListener('click',()=>editor.update(settings=>{
    if(settings.sourceLanguage==='auto')return;
    [settings.sourceLanguage,settings.targetLanguage]=[settings.targetLanguage,settings.sourceLanguage];
  }).catch(fail));
  byId(document,'retry-save').addEventListener('click',()=>editor.retry().catch(fail));
  byId<HTMLButtonElement>(document,'reload-settings').addEventListener('click',async()=>{try{await editor.reload();interactions.resetDrafts();urlDrafts.clear();render(editor.get(),editor.status());}catch(error){fail(error);}});
  const typeButtons=Object.entries(PROVIDER_INFO).map(([type,info])=>{
    const button=document.createElement('button'),name=document.createElement('strong'),description=document.createElement('span'),needs=document.createElement('span');
    button.type='button';button.className='provider-type';button.dataset.type=type;
    name.textContent=TYPE_NAMES[type];description.textContent=info.description;needs.className='chip off';needs.textContent=info.needs;
    button.append(name,description,needs);button.addEventListener('click',()=>addProvider(type));return button;
  });
  byId(document,'provider-types').replaceChildren(...typeButtons);
  async function addProvider(type: string): Promise<void> {
    try{
      selectedId=await editor.addProvider(type,nextProviderName(editor.get(),type));pickerOpen=false;
      render(editor.get(),editor.status());fields[PROVIDER_INFO[type].focus].focus();
    }catch(error){fail(error);}
  }
  function setPicker(open: boolean): void {
    pickerOpen=open;render(editor.get(),editor.status());
    if(open)typeButtons[0].focus();else byId(document,'add-provider').focus();
  }
  byId(document,'add-provider').addEventListener('click',()=>setPicker(!pickerOpen));
  byId(document,'cancel-add').addEventListener('click',()=>setPicker(false));
  byId(document,'provider-picker').addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Escape')setPicker(false);});
  byId(document,'make-default').addEventListener('click',()=>editor.update(settings=>{if(selectedId)settings.activeProviderId=selectedId;}).catch(fail));
  byId<HTMLButtonElement>(document,'delete-provider').addEventListener('click',()=>{
    const provider=editor.get().providers.find(item=>item.id===selectedId);
    if(!provider || globalThis.confirm && !globalThis.confirm(`删除“${provider.name || TYPE_NAMES[provider.type]}”？其地址、Key 和模型设置会一并删除。`))return;
    return editor.removeProvider(provider.id).catch(fail);
  });
  byId(document,'show-key').addEventListener('click',event=>{const show=fields.apiKey.type==='password';fields.apiKey.type=show?'text':'password';const button=event.target as HTMLButtonElement;button.textContent=show?'隐藏':'显示';button.setAttribute('aria-pressed',String(show));});
  byId<HTMLButtonElement>(document,'test-provider').addEventListener('click',()=>{
    const provider=editor.get().providers.find(item=>item.id===selectedId)!;
    for(const field of problemFields)touched.add(provider.id+':'+field);
    testStarted=Date.now();testFingerprint=JSON.stringify(provider);
    render(editor.get(),editor.status());
    return tester.test(provider);
  });
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
  // Browser-level commands live on Chrome's own page; extension pages cannot link there directly.
  byId(document,'browser-shortcuts').addEventListener('click',()=>globalThis.chrome.tabs.create({url:'chrome://extensions/shortcuts'}));
  byId(document,'export-settings').addEventListener('click',()=>{
    try {const value=exportSettings(editor.get(),{includeSecrets:byId<HTMLInputElement>(document,'include-secrets').checked});downloadText(document,'kuai-translate-settings.json',typeof value==='string'?value:JSON.stringify(value,null,2),'application/json');}
    catch(error){fail(error);}
  });
  byId(document,'import-settings').addEventListener('change',async event=>{
    const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
    try {if(file.size>2*1024*1024)throw Error('配置文件超过 2 MB。');const incoming=JSON.parse(await file.text());const merged=importSettings(incoming,editor.get());await editor.replace(merged);interactions.resetDrafts();urlDrafts.clear();render(editor.get(),editor.status());setStatus(status,'已导入可识别的直连/免费配置，原平台账号信息不会导入。');}
    catch(error){fail(error);}finally{(event.target as HTMLInputElement).value='';}
  });
}
if(globalThis.document)startOptions();
