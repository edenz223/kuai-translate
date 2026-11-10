import {DEFAULT_MODELS, type Provider, type Settings} from '../shared/settings.js';

export interface EditorStatus { revision: number; saving: boolean; error: unknown; }
export type SettingsChange = (settings: Settings) => void;
export type SettingsListener = (settings: Settings, status: EditorStatus) => void;
export type ProviderPatch = Partial<Pick<Provider,'name' | 'enabled' | 'baseUrl' | 'apiKey' | 'model' | 'region' | 'temperature' | 'systemPrompt' | 'userPrompt'>>;
export type ProviderFields = Record<string, HTMLInputElement>;
export interface SettingsEditorOptions {
  load: () => Promise<unknown>;
  save: (settings: Settings, base: Settings) => Promise<unknown>;
  normalize?: (value: unknown) => Settings;
  idFactory?: () => string;
}
export interface SettingsEditor {
  load(): Promise<Settings>;
  reload(): Promise<Settings>;
  get(): Settings;
  status(): EditorStatus;
  subscribe(listener: SettingsListener): () => boolean;
  update(change: SettingsChange): Promise<Settings>;
  replace(value: unknown): Promise<Settings>;
  retry(): Promise<Settings>;
  flush(): Promise<void>;
  patchProvider(id: string | undefined, patch: ProviderPatch): Promise<Settings>;
  addProvider(type: string, name?: string): Promise<string>;
  removeProvider(id: string | undefined): Promise<Settings>;
}
export type ProviderTestState = {status: 'idle'} | {status: 'pending'; providerId: string} |
  {status: 'success'; providerId: string; result: ProviderTestResult} | {status: 'error'; providerId: string; error: unknown};
export interface ProviderTestResult { translations?: string[]; }
export interface ProviderTesterOptions {
  request: (type: 'KUAI_TEST_PROVIDER', payload: {provider: Provider; text: string; requestId: string}) => Promise<ProviderTestResult>;
  cancel: (id: string) => unknown;
  makeRequestId: () => string;
  onState?: (state: ProviderTestState) => void;
}
export interface ProviderTester { invalidate(): void; test(provider: Provider): Promise<ProviderTestResult | undefined>; }

/** An options-page draft whose saves are serialized without rolling back newer typing. */
export function createSettingsEditor({load, save, normalize = structuredClone as (value: unknown) => Settings, idFactory = () => crypto.randomUUID()}: SettingsEditorOptions): SettingsEditor {
  let settings: Settings, revision = 0, pending = 0, error: unknown = null, failureBase: Settings | null = null, conflict: unknown = null, tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<SettingsListener>();
  const status = (): EditorStatus => ({revision, saving:pending > 0, error});
  const get = (): Settings => structuredClone(settings);
  const notify = () => listeners.forEach(listener => listener(get(), status()));
  function enqueue(value: unknown): Promise<Settings> {
    const base = get();
    settings = normalize(value);
    const snapshot = get(), version = ++revision;
    pending++; error = conflict; notify();
    const task = tail.then(async () => {
      const effectiveBase = structuredClone(failureBase || base);
      try {
        if (conflict) throw conflict;
        const stored = await save(snapshot,effectiveBase);
        if (version === revision) settings = normalize(stored);
        error = null; failureBase = null;
        return get();
      } catch (failure) {
        failureBase ||= effectiveBase;
        if ((failure as {code?: string}).code === 'SETTINGS_CONFLICT') conflict = failure;
        error = failure; throw failure;
      } finally { pending--; notify(); }
    });
    // Continue after a failed write so the user can fix/retry without reloading.
    tail = task.catch(() => {});
    return task;
  }
  return {
    async load() { settings = normalize(await load()); revision++; error = failureBase = conflict = null; notify(); return get(); },
    async reload() { await tail; return this.load(); },
    get, status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(change) { const next = get(); change(next); return enqueue(next); },
    replace(value) { return enqueue(value); },
    retry() { return enqueue(get()); },
    flush() { return tail.then(() => { if (error) throw error; }); },
    patchProvider(id, patch) {
      return this.update(next => {
        const provider = next.providers.find(item => item.id === id);
        if (!provider) throw new Error('翻译服务已删除，请重新选择。');
        for (const key of ['name','enabled','baseUrl','apiKey','model','region','temperature','systemPrompt','userPrompt'] as const)
          if (Object.hasOwn(patch,key)) (provider as unknown as Record<string, unknown>)[key] = patch[key];
      });
    },
    async addProvider(type, name) {
      if (!['openai','gemini','anthropic','azure','deepl','deeplx','ollama'].includes(type)) throw new Error('不支持的自配服务。');
      const id = idFactory();
      await this.update(next => next.providers.push({id,type,name:name || type + ' API',enabled:true,baseUrl:'',apiKey:'',model:DEFAULT_MODELS[type] || '',region:'',temperature:null,systemPrompt:'',userPrompt:''}));
      return id;
    },
    removeProvider(id) { return this.update(next => { next.providers = next.providers.filter(item => item.id !== id); }); },
  };
}

export function bindProviderFields({fields, editor, getId, onError = () => {}}: {fields: ProviderFields; editor: SettingsEditor; getId: () => string | undefined; onError?: (error: unknown) => void}): () => void {
  const dispose: (() => void)[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const type = key === 'enabled' ? 'change' : 'input';
    const listener = () => {
      let value: string | boolean | number | undefined = key === 'enabled' ? field.checked : field.value;
      if (key === 'temperature') value = field.value === '' ? undefined : Number(field.value);
      try { Promise.resolve(editor.patchProvider(getId(), {[key]:value})).catch(onError); }
      catch (error) { onError(error); }
    };
    field.addEventListener(type,listener);
    dispose.push(() => field.removeEventListener(type,listener));
  }
  return () => dispose.forEach(callback => callback());
}

export function syncProviderFields({fields,provider,activeElement}: {fields: ProviderFields; provider?: Provider; activeElement?: Element | null}): void {
  if(!provider)return;
  for(const [key,field] of Object.entries(fields)) {
    if(key==='enabled')field.checked=!!provider.enabled;
    else if(field!==activeElement) {
      const value=String(provider[key as keyof Provider] ?? '');
      if(field.value!==value)field.value=value;
    }
  }
}

/** A connection check belongs to one unmodified provider draft. */
export function createProviderTester({request,cancel,makeRequestId,onState=()=>{}}: ProviderTesterOptions): ProviderTester {
  let generation=0,activeId: string | null=null;
  function invalidate(): void {
    generation++;
    if(activeId)Promise.resolve(cancel(activeId)).catch(()=>{});
    activeId=null;onState({status:'idle'});
  }
  return {
    invalidate,
    async test(provider) {
      invalidate();
      const version=generation,requestId=makeRequestId();activeId=requestId;
      onState({status:'pending',providerId:provider.id});
      try {
        const result=await request('KUAI_TEST_PROVIDER',{provider:structuredClone(provider),text:'Hello',requestId});
        if(version!==generation)return;
        onState({status:'success',providerId:provider.id,result});return result;
      }catch(error){if(version===generation)onState({status:'error',providerId:provider.id,error});}
      finally{if(activeId===requestId)activeId=null;}
    },
  };
}
