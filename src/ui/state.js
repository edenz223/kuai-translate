/** An options-page draft whose saves are serialized without rolling back newer typing. */
export function createSettingsEditor({load, save, normalize = structuredClone, idFactory = () => crypto.randomUUID()}) {
  let settings, revision = 0, pending = 0, error = null, failureBase = null, conflict = null, tail = Promise.resolve();
  const listeners = new Set();
  const status = () => ({revision, saving:pending > 0, error});
  const get = () => structuredClone(settings);
  const notify = () => listeners.forEach(listener => listener(get(), status()));
  function enqueue(value) {
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
        if (failure.code === 'SETTINGS_CONFLICT') conflict = failure;
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
        for (const key of ['name','enabled','baseUrl','apiKey','model','region','temperature'])
          if (Object.hasOwn(patch,key)) provider[key] = patch[key];
      });
    },
    async addProvider(type) {
      if (!['openai','gemini','anthropic','azure','deepl','deeplx','ollama'].includes(type)) throw new Error('不支持的自配服务。');
      const id = idFactory();
      await this.update(next => next.providers.push({id,type,name:type + ' API',enabled:true,baseUrl:'',apiKey:'',model:'',region:'',temperature:null}));
      return id;
    },
    removeProvider(id) { return this.update(next => { next.providers = next.providers.filter(item => item.id !== id); }); },
  };
}

export function bindProviderFields({fields, editor, getId, onError = () => {}}) {
  const dispose = [];
  for (const [key, field] of Object.entries(fields)) {
    const type = key === 'enabled' ? 'change' : 'input';
    const listener = () => {
      let value = key === 'enabled' ? field.checked : field.value;
      if (key === 'temperature') value = field.value === '' ? undefined : Number(field.value);
      try { Promise.resolve(editor.patchProvider(getId(), {[key]:value})).catch(onError); }
      catch (error) { onError(error); }
    };
    field.addEventListener(type,listener);
    dispose.push(() => field.removeEventListener(type,listener));
  }
  return () => dispose.forEach(callback => callback());
}

export function syncProviderFields({fields,provider,activeElement}) {
  if(!provider)return;
  for(const [key,field] of Object.entries(fields)) {
    if(key==='enabled')field.checked=!!provider.enabled;
    else if(field!==activeElement) {
      const value=String(provider[key] ?? '');
      if(field.value!==value)field.value=value;
    }
  }
}

/** A connection check belongs to one unmodified provider draft. */
export function createProviderTester({request,cancel,makeRequestId,onState=()=>{}}) {
  let generation=0,activeId=null;
  function invalidate() {
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
