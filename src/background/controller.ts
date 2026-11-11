import {debug,setDebug} from '../shared/debug.js';
import type {Settings,Provider} from '../shared/settings.js';
import type {BackgroundRequest, BackgroundResponse, PageActionType, PageBadgeState, PageRequest, SettingsChanged} from '../shared/messages.js';
import type {SiteRule} from '../shared/site-rules.js';
interface Owner {trusted:boolean;scope:string;tabId?:number;frameId?:number;documentId:string}
interface TranslationJob {owner:Owner;controller:AbortController;savedProviderId:string;providerIdentity:string;
  followProvider:boolean;followSource:boolean;followTarget:boolean;sourceLanguage:string;targetLanguage:string}
interface BackgroundController {start():BackgroundController;stop():void;
  handleMessage(message:BackgroundRequest,sender:chrome.runtime.MessageSender):Promise<BackgroundResponse>;readonly ready:Promise<void>}
type MessageOf<T extends BackgroundRequest['type']> = Extract<BackgroundRequest,{type:T}>;
import { SETTINGS_KEY, defaultSettings, normalizeSettings, publicSettings } from '../shared/settings.js';
import { translateWithProvider, listProviderModels } from '../providers/index.js';
import { failure, publicError } from '../providers/errors.js';
import { mergeSettings } from './settings-merge.js';
import { applyPreferencePatch } from './preferences.js';
import { applySiteRule, inputSiteDisabled, setInputSiteDisabled } from '../shared/site-rules.js';

const messageTypes = new Set(['KUAI_GET_SETTINGS', 'KUAI_SAVE_SETTINGS', 'KUAI_UPDATE_PREFERENCES', 'KUAI_UPDATE_PAGE_PREFERENCES', 'KUAI_OPEN_OPTIONS', 'KUAI_TRANSLATE', 'KUAI_CANCEL', 'KUAI_TEST_PROVIDER', 'KUAI_LIST_MODELS', 'KUAI_PAGE_STATE']);
const providerIdentity=(provider?:Provider)=>provider ? JSON.stringify(['id','type','enabled','baseUrl','apiKey','model','region','temperature','systemPrompt','userPrompt'].map(key=>provider[key as keyof Provider])) : '';
const menuItems: {id:string;title:string;contexts:NonNullable<chrome.contextMenus.CreateProperties['contexts']>;message:PageActionType}[] = [
  { id: 'kuai.page', title: 'Kuai translate · 翻译网页', contexts: ['page'], message: 'KUAI_PAGE_TRANSLATE' },
  { id: 'kuai.restore', title: 'Kuai translate · 恢复原文', contexts: ['page'], message: 'KUAI_PAGE_RESTORE' },
  { id: 'kuai.selection', title: 'Kuai translate · 翻译选中文字', contexts: ['selection'], message: 'KUAI_SELECTION_TRANSLATE' },
  { id: 'kuai.input', title: 'Kuai translate · 翻译输入内容', contexts: ['editable'], message: 'KUAI_INPUT_TRANSLATE' },
];
// Site rules change settings in the background; they never message the page.
const siteMenuItems: {id:string;title:string;rule:SiteRule}[] = [
  { id: 'kuai.site.always', title: 'Kuai translate · 本站自动翻译', rule: 'always' },
  { id: 'kuai.site.never', title: 'Kuai translate · 本站从不翻译', rule: 'never' },
  { id: 'kuai.site.default', title: 'Kuai translate · 本站恢复默认', rule: 'default' },
];
// A checkbox whose state follows the active tab; Chrome has no menu onShown event to compute it on demand.
const INPUT_SITE_MENU = { id: 'kuai.site.input', title: 'Kuai translate · 本站禁用输入翻译' };
const WEB_PAGES = ['http://*/*', 'https://*/*'];
const BADGES: Record<PageBadgeState,[text:string,color:string]> = {
  idle:['',''], working:['…','#087e8b'], done:['✓','#087e8b'], error:['!','#b32332'], blocked:['–','#7b8d99'],
};
const COMMANDS: Record<string,PageActionType> = {'toggle-page':'KUAI_PAGE_TOGGLE','toggle-display-mode':'KUAI_PAGE_DISPLAY_MODE'};

/** Owns privileged API credentials. Content scripts can supply only saved provider IDs. */
export function createBackground({ chromeApi = globalThis.chrome, fetchImpl = globalThis.fetch, timeoutMs = 30000 }: {chromeApi?:typeof chrome;fetchImpl?:typeof fetch;timeoutMs?:number} = {}):BackgroundController {
  const jobs = new Map<string,TranslationJob>(), disposers:(()=>void)[] = [];
  let settings = defaultSettings(), serialized = JSON.stringify(settings);
  let initialization:Promise<void>|null|undefined, writeQueue:Promise<unknown> = Promise.resolve(), menuTask:Promise<void>|null|undefined, menuRequested = false, appliedMenuSignature:string|null = null;
  let started = false, stopped = false, settingsEpoch = 0, menuUrl = '';

  function identify(sender:chrome.runtime.MessageSender):Owner {
    if (!sender || sender.id !== chromeApi.runtime.id) throw failure('FORBIDDEN', 'This request is not permitted.');
    let url;
    try { url = new URL(sender.url!); } catch { throw failure('FORBIDDEN', 'This request is not permitted.'); }
    const extensionURL = new URL(chromeApi.runtime.getURL(''));
    const sameExtension=(value:URL)=>value.protocol===extensionURL.protocol && value.hostname===extensionURL.hostname && !value.username && !value.password;
    const parse=(value:string|undefined)=>{try{return new URL(value!);}catch{return null;}};
    const origin=sender.origin && sender.origin!=='null' ? parse(sender.origin) : null;
    const trusted = sameExtension(url);
    const documentId = typeof sender.documentId === 'string' && /^[a-z0-9_-]{1,128}$/i.test(sender.documentId) ? sender.documentId : '';
    if (trusted) {
      if (sender.origin!==undefined && (!origin || !sameExtension(origin))) throw failure('FORBIDDEN','This request is not permitted.');
      return { trusted, scope: 'extension:' + (documentId || url.href), tabId: sender.tab?.id, frameId: sender.frameId, documentId };
    }
    if (!Number.isSafeInteger(sender.tab?.id) || sender.tab!.id!<0 || !Number.isSafeInteger(sender.frameId) || sender.frameId! < 0 || !documentId)
      throw failure('FORBIDDEN', 'This request is not permitted.');
    if (['blob:','data:','filesystem:'].includes(url.protocol)) {
      // Only Chrome's sender metadata may establish a creator origin, never message payload fields.
      const evidence=origin || (sender.origin==null || sender.origin==='null' ? parse(sender.tab!.url) : null);
      if (!evidence || !['https:','http:'].includes(evidence.protocol) || evidence.username || evidence.password)
        throw failure('FORBIDDEN','This request is not permitted.');
      if (url.protocol!=='data:') {
        const embedded=parse(url.href.slice(url.protocol.length));
        if (!embedded || !['https:','http:'].includes(embedded.protocol) || embedded.origin!==evidence.origin)
          throw failure('FORBIDDEN','This request is not permitted.');
      }
    } else if (!['http:', 'https:', 'file:', 'about:'].includes(url.protocol)) throw failure('FORBIDDEN', 'This request is not permitted.');
    return { trusted: false, scope: `document:${sender.tab!.id!}:${sender.frameId}:${documentId}`, tabId: sender.tab!.id!, frameId: sender.frameId, documentId };
  }
  function requirePage(owner:Owner) {
    if (!owner.trusted) throw failure('FORBIDDEN', 'Open the extension settings page to perform this operation.');
  }
  function requestKey(owner:Owner, requestId:unknown) {
    if (typeof requestId !== 'string' || !/^[a-z0-9._:-]{1,128}$/i.test(requestId)) throw failure('INVALID_INPUT', 'A valid request ID is required.');
    return owner.scope + '::' + requestId;
  }
  function cancelJobs(predicate:(job:TranslationJob)=>unknown = () => true) {
    for (const job of jobs.values()) if (predicate(job)) job.controller.abort();
  }
  async function broadcast(snapshot:Settings) {
    if (stopped) return;
    const message:SettingsChanged = { type: 'KUAI_SETTINGS_CHANGED', settings: snapshot };
    try { await chromeApi.runtime.sendMessage(message); } catch { /* No open extension page. */ }
    if (stopped) return;
    try {
      const tabs = await chromeApi.tabs.query({});
      if (stopped) return;
      await Promise.allSettled(tabs.filter(tab => Number.isSafeInteger(tab.id) && tab.id! >= 0).map(async tab => chromeApi.tabs.sendMessage(tab.id!, message)));
    } catch { /* Tabs may close during a settings change. */ }
  }
  function publish(next:Settings) {
    setDebug(next.debugMode);
    const encoded = JSON.stringify(next);
    if (encoded === serialized) return;
    const previousMenus=menuSignature();
    settingsEpoch++;
    settings = next; serialized = encoded;
    cancelJobs(job=>
      job.followProvider && job.savedProviderId!==next.activeProviderId ||
      job.followSource && job.sourceLanguage!==next.sourceLanguage ||
      job.followTarget && job.targetLanguage!==next.targetLanguage ||
      job.savedProviderId && job.providerIdentity!==providerIdentity(next.providers.find(provider=>provider.id===job.savedProviderId)));
    // Notifications are advisory; an unrelated tab must never hold settings writes.
    void broadcast(publicSettings(next));
    if(started && previousMenus!==menuSignature()) void setupMenus();
    else syncInputSiteMenu();
  }
  function initialize():Promise<void> {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        // Chrome persists this restriction across service-worker restarts.
        await chromeApi.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        const value = await chromeApi.storage.local.get(SETTINGS_KEY);
        try { settings = normalizeSettings(value[SETTINGS_KEY] ?? defaultSettings()); }
        catch (error) { debug('background:settings','error',error);settings = defaultSettings(); } // Preserve malformed stored bytes until an explicit save.
        setDebug(settings.debugMode);
        serialized = JSON.stringify(settings);
        if (value[SETTINGS_KEY] === undefined) await chromeApi.storage.local.set({ [SETTINGS_KEY]: settings });
      } catch (error) { debug('background:storage','error',error);throw failure('STORAGE_UNAVAILABLE', 'Private extension storage could not be initialized. Reload the extension and retry.'); }
    })();
    // An idle worker may initialize before its first caller subscribes to ready.
    // A transient failure must not poison every later request in this worker.
    const pending=initialization;
    pending.catch(() => { if (initialization===pending) initialization=null; });
    return pending;
  }
  function writeSettings(prepare:(current:Settings)=>Settings):Promise<Settings> {
    const operation = writeQueue.catch(() => {}).then(async () => {
      if(stopped) throw failure('CANCELLED','The extension worker has stopped. Retry the request.');
      const next=prepare(settings);
      const revision = Number.isSafeInteger(settings.providerRevision) ? settings.providerRevision : 0;
      const providersChanged = JSON.stringify(next.providers) !== JSON.stringify(settings.providers);
      next.providerRevision = providersChanged ? (revision === Number.MAX_SAFE_INTEGER ? 0 : revision + 1) : revision;
      try { await chromeApi.storage.local.set({ [SETTINGS_KEY]: next }); }
      catch { throw failure('STORAGE_UNAVAILABLE', 'Settings could not be saved. Please retry.'); }
      if(stopped) throw failure('CANCELLED','The extension worker has stopped. Retry the request.');
      publish(next);
      return structuredClone(next);
    });
    writeQueue = operation;
    return operation;
  }
  function save(input:unknown, baseInput?:unknown) {
    let draft:Settings, base:Settings|undefined;
    try {
      draft = normalizeSettings(input);
      if (baseInput !== undefined) base = normalizeSettings(baseInput);
    }
    catch { throw failure('INVALID_SETTINGS', 'The settings are invalid. Check provider IDs, URLs and language choices.'); }
    return writeSettings(current=>{
      try { return base ? mergeSettings(base, draft, current) : draft; }
      catch (error) {
        if ((error as {code?:string})?.code === 'SETTINGS_CONFLICT') throw error;
        throw failure('INVALID_SETTINGS', 'The merged settings are invalid. Reload settings and retry.');
      }
    });
  }
  function updatePreferences(message:MessageOf<'KUAI_UPDATE_PREFERENCES'>) {
    if (Object.keys(message).some(key=>!['type','patch'].includes(key))) throw failure('INVALID_PREFERENCES','字幕偏好消息无效。');
    const patch=structuredClone(message.patch);
    return writeSettings(current=>applyPreferencePatch(current,patch)).then(publicSettings);
  }
  function updatePagePreferences(message:MessageOf<'KUAI_UPDATE_PAGE_PREFERENCES'>) {
    const patch=message.patch;
    if(Object.keys(message).some(key=>!['type','patch'].includes(key)) || !patch || typeof patch!=='object' || Array.isArray(patch) ||
      Object.keys(patch).length!==1 || !Object.hasOwn(patch,'pageDisplayMode') || !['bilingual','translation_only'].includes(patch.pageDisplayMode))
      throw failure('INVALID_PREFERENCES','网页显示偏好无效，请选择双语对照或仅译文。');
    const pageDisplayMode=patch.pageDisplayMode;
    return writeSettings(current=>normalizeSettings({...current,pageDisplayMode})).then(publicSettings);
  }
  async function setPageBadge(owner:Owner, message:MessageOf<'KUAI_PAGE_STATE'>) {
    const state=message.state;
    if (Object.keys(message).some(key=>!['type','state'].includes(key)) || !Object.hasOwn(BADGES,state)) throw failure('INVALID_INPUT','页面状态无效。');
    // Only the top document of a web tab speaks for the toolbar button.
    if (owner.trusted || owner.frameId!==0 || !Number.isSafeInteger(owner.tabId) || !chromeApi.action) return {shown:false};
    const [text,color]=BADGES[state], tabId=owner.tabId!;
    try {
      if (color) await chromeApi.action.setBadgeBackgroundColor({tabId,color});
      await chromeApi.action.setBadgeText({tabId,text});
    } catch { return {shown:false}; }
    return {shown:true};
  }
  async function openOptions(message:MessageOf<'KUAI_OPEN_OPTIONS'>) {
    const section=message.section;
    if (!['webpage','selection','input','hover','subtitles'].includes(section) || Object.keys(message).some(key=>!['type','section'].includes(key)))
      throw failure('INVALID_INPUT','请选择有效的翻译设置分区。');
    await chromeApi.tabs.create({url:chromeApi.runtime.getURL('options.html')+'#'+section});
    return {opened:true,section};
  }
  async function providerRequest(owner:Owner, requestId:unknown, provider:Provider, message:{texts:string[];providerId?:string;sourceLanguage?:string;targetLanguage?:string}, savedProvider=false, models=false) {
    const key = requestKey(owner, requestId);
    if (jobs.has(key)) throw failure('DUPLICATE_REQUEST', 'This translation request is already running.');
    if (jobs.size >= 64 || Array.from(jobs.values()).filter(job => job.owner.scope === owner.scope).length >= 12)
      throw failure('BUSY', 'Too many translations are running. Wait for a current request to finish.');
    const job = {
      owner,controller:new AbortController(),savedProviderId:savedProvider ? provider.id : '',providerIdentity:providerIdentity(provider),
      followProvider:savedProvider && (!message.providerId || message.providerId==='follow_page'),
      followSource:message.sourceLanguage==null,followTarget:message.targetLanguage==null,
      sourceLanguage:message.sourceLanguage ?? settings.sourceLanguage,targetLanguage:message.targetLanguage ?? settings.targetLanguage,
    };
    jobs.set(key, job);
    try {
      const options = {
        signal: job.controller.signal, fetchImpl, timeoutMs,
      };
      if(models)return await listProviderModels(provider,options);
      const translations = await translateWithProvider(provider, {
        texts:message.texts,sourceLanguage:job.sourceLanguage,targetLanguage:job.targetLanguage,
        ...options,
      });
      if (job.controller.signal.aborted) throw failure('CANCELLED', 'Translation was cancelled.');
      return { translations, providerId: provider.id || provider.type };
    } finally { if (jobs.get(key) === job) jobs.delete(key); }
  }
  async function handleMessage(message:BackgroundRequest, sender:chrome.runtime.MessageSender):Promise<BackgroundResponse> {
    try {
      if (stopped) throw failure('CANCELLED', 'The extension worker has stopped. Retry the request.');
      const owner = identify(sender);
      if (!message || !messageTypes.has(message.type)) throw failure('UNKNOWN_MESSAGE', 'This request type is not supported.');
      if (['KUAI_SAVE_SETTINGS', 'KUAI_TEST_PROVIDER', 'KUAI_LIST_MODELS'].includes(message.type) || message.type === 'KUAI_GET_SETTINGS' && message.includeSecrets) requirePage(owner);
      if (message.type==='KUAI_OPEN_OPTIONS') return {ok:true,value:await openOptions(message)};
      await initialize();
      if(stopped) throw failure('CANCELLED','The extension worker has stopped. Retry the request.');
      if(started) void setupMenus();
      let value;
      switch (message.type) {
        case 'KUAI_GET_SETTINGS':
          value = message.includeSecrets ? structuredClone(settings) : publicSettings(settings);
          break;
        case 'KUAI_SAVE_SETTINGS':
          value = await save(message.settings, message.baseSettings);
          break;
        case 'KUAI_UPDATE_PREFERENCES':
          value = await updatePreferences(message);
          break;
        case 'KUAI_UPDATE_PAGE_PREFERENCES':
          value = await updatePagePreferences(message);
          break;
        case 'KUAI_PAGE_STATE':
          value = await setPageBadge(owner, message);
          break;
        case 'KUAI_CANCEL': {
          const job = jobs.get(requestKey(owner, message.requestId));
          job?.controller.abort(); value = { cancelled: !!job }; break;
        }
        case 'KUAI_LIST_MODELS':
          value = await providerRequest(owner, message.requestId, message.provider, {texts:[],sourceLanguage:'auto',targetLanguage:'en'},false,true);
          break;
        case 'KUAI_TEST_PROVIDER':
          value = await providerRequest(owner, message.requestId || 'test-' + crypto.randomUUID(), message.provider, {
            texts: [message.text ?? 'Hello'], sourceLanguage: 'auto',
          });
          break;
        case 'KUAI_TRANSLATE': {
          const id = !message.providerId || message.providerId === 'follow_page' ? settings.activeProviderId : message.providerId;
          const provider = settings.providers.find(item => item.id === id && item.enabled);
          if (!provider) throw failure('INVALID_CONFIG', 'Select an enabled translation service in the extension settings.');
          value = await providerRequest(owner, message.requestId, provider, message, true); break;
        }
      }
      return { ok: true, value };
    } catch (error) { debug('background:message','error',error);return { ok: false, error: publicError(error) }; }
  }
  function onMessage(message:BackgroundRequest, sender:chrome.runtime.MessageSender, respond:(response:BackgroundResponse)=>void) {
    if (!messageTypes.has(message?.type)) return false;
    handleMessage(message, sender).then(respond);
    return true;
  }
  function menuEnabled(item:typeof menuItems[number]) {
    return settings.pageOptions.contextMenuEnabled &&
      (item.id!=='kuai.selection' || settings.selectionEnabled) &&
      (item.id!=='kuai.input' || settings.inputOptions.enabled);
  }
  function visibleMenus():chrome.contextMenus.CreateProperties[] {
    if (!settings.pageOptions.contextMenuEnabled) return [];
    return [...menuItems.filter(menuEnabled).map(({message,...item})=>item),
      ...siteMenuItems.map(({rule,...item}):chrome.contextMenus.CreateProperties=>({...item,contexts:['page'],documentUrlPatterns:WEB_PAGES})),
      ...settings.inputOptions.enabled ? [{...INPUT_SITE_MENU,type:'checkbox' as const,checked:inputSiteDisabled(settings,menuUrl),
        contexts:['page','editable'] as chrome.contextMenus.CreateProperties['contexts'],documentUrlPatterns:WEB_PAGES}] : []];
  }
  function syncInputSiteMenu(url=menuUrl) {
    menuUrl=url;
    if(!started || stopped || !chromeApi.contextMenus?.update || !visibleMenus().some(item=>item.id===INPUT_SITE_MENU.id)) return;
    // Before the menu exists this fails harmlessly; creation reads menuUrl itself.
    Promise.resolve().then(()=>chromeApi.contextMenus.update(INPUT_SITE_MENU.id,{checked:inputSiteDisabled(settings,url)},()=>void chromeApi.runtime.lastError)).catch(()=>{});
  }
  function syncActiveTab(tab?:chrome.tabs.Tab) {
    if(tab?.active) syncInputSiteMenu(tab.url || '');
  }
  function refreshActiveTab() {
    Promise.resolve().then(()=>chromeApi.tabs.query({active:true,lastFocusedWindow:true})).then(([tab])=>syncActiveTab(tab)).catch(()=>{});
  }
  function menuSignature() {
    return visibleMenus().map(item=>item.id).join('|');
  }
  function menuOperation(method:'create'|'removeAll',...args:[]|[chrome.contextMenus.CreateProperties]) {
    // create returns an ID, not a Promise; callbacks also support the extension's Chrome 120 minimum.
    return new Promise<void>((resolve,reject)=>{
      const done=()=>chromeApi.runtime.lastError ? reject(failure('MENU_UNAVAILABLE','Context menus could not be updated.')) : resolve();
      try {
        const result=(chromeApi.contextMenus[method] as (...args:unknown[])=>unknown)(...args,done);
        if(result && typeof (result as Promise<void>).then==='function') (result as Promise<void>).then(resolve,reject);
      }catch(error){reject(error);}
    });
  }
  function setupMenus():Promise<void> {
    if(stopped || !chromeApi.contextMenus) return Promise.resolve();
    menuRequested=true;
    if(menuTask) return menuTask;
    menuTask=(async()=>{
      await initialize();
      while(menuRequested && !stopped) {
        menuRequested=false;
        if(menuSignature()===appliedMenuSignature) continue;
        await menuOperation('removeAll');
        if(stopped) return;
        const signature=menuSignature(),visible=visibleMenus();
        for(const item of visible) {
          if(stopped || signature!==menuSignature()) break;
          await menuOperation('create',item);
        }
        if(stopped) return;
        if(signature===menuSignature()) appliedMenuSignature=signature;
        else menuRequested=true;
      }
    })().catch(()=>{appliedMenuSignature=null;menuRequested=false;}).finally(()=>{
      menuTask=null;
      if(menuRequested && !stopped) void setupMenus();
    });
    return menuTask;
  }
  function onSiteMenu(rule:SiteRule, url:string) {
    if (stopped || !/^https?:/.test(url)) return;
    initialize().then(()=>{
      if (stopped || !settings.pageOptions.contextMenuEnabled) return;
      return writeSettings(current=>{const next=structuredClone(current);applySiteRule(next,url,rule);return normalizeSettings(next);});
    }).catch(()=>{});
  }
  function onInputSiteMenu(disabled:boolean|undefined, url:string) {
    if (stopped || !/^https?:/.test(url)) return;
    let blocked = false;
    initialize().then(()=>{
      if (stopped || !settings.pageOptions.contextMenuEnabled || !settings.inputOptions.enabled) return;
      return writeSettings(current=>{
        const next=structuredClone(current);blocked=setInputSiteDisabled(next,url,disabled ?? !inputSiteDisabled(current,url));return normalizeSettings(next);
      }).then(()=>{if (disabled===false && blocked) throw Error('A broader pattern still matches.');});
    }).catch(()=>{
      // A broader pattern or the list limit can only be handled in the full rule list.
      if (!stopped) return chromeApi.tabs.create({url:chromeApi.runtime.getURL('options.html')+'#input'});
    }).catch(()=>{}).finally(()=>syncInputSiteMenu(url));
  }
  function onMenu(info:chrome.contextMenus.OnClickData, tab?:chrome.tabs.Tab) {
    if (info.menuItemId === INPUT_SITE_MENU.id) return onInputSiteMenu(info.checked, info.pageUrl || tab?.url || '');
    const site = siteMenuItems.find(menu => menu.id === info.menuItemId);
    if (site) return onSiteMenu(site.rule, info.pageUrl || tab?.url || '');
    const item = menuItems.find(menu => menu.id === info.menuItemId);
    if (stopped || !item || !Number.isInteger(tab?.id) || tab!.id!<0) return;
    const message:PageRequest = { type: item.message };
    if (item.message === 'KUAI_SELECTION_TRANSLATE') message.text = info.selectionText;
    const tabId=tab!.id!,frameId=Number.isInteger(info.frameId) && info.frameId!>=0?info.frameId:0;
    initialize().then(()=>writeQueue.catch(()=>{})).then(()=>{
      if(!stopped && menuEnabled(item)) return chromeApi.tabs.sendMessage(tabId,message,{frameId});
    }).catch(()=>{});
  }
  async function onCommand(command:string, tab?:chrome.tabs.Tab) {
    const type=COMMANDS[command];
    if (stopped || !type) return;
    try {
      const target=tab?.id!==undefined ? tab : (await chromeApi.tabs.query({active:true,currentWindow:true}))[0];
      if (!Number.isInteger(target?.id) || target!.id!<0 || !/^https?:/.test(target!.url || '')) return;
      await chromeApi.tabs.sendMessage(target!.id!,{type},{frameId:0});
    } catch {}
  }
  function onStorage(changes:Record<string,chrome.storage.StorageChange>, area:string) {
    if (area !== 'local' || !changes[SETTINGS_KEY] || stopped) return;
    const epoch = ++settingsEpoch;
    // Read the current record, not a potentially delayed older change payload.
    initialize().then(() => chromeApi.storage.local.get(SETTINGS_KEY)).then(value => {
      if (!stopped && epoch === settingsEpoch && value[SETTINGS_KEY] !== undefined) publish(normalizeSettings(value[SETTINGS_KEY]));
    }).catch(error => {debug('background:settings','error',error);});
  }
  function listen<T extends (...args:any[])=>void>(event:chrome.events.Event<T>|undefined, callback:T) {
    if (!event) return;
    event.addListener(callback); disposers.push(() => event.removeListener(callback));
  }
  function start():BackgroundController {
    if (started || stopped) return api;
    started = true;
    // Register before awaiting storage, so an event that woke this worker is not lost.
    listen(chromeApi.runtime.onMessage, onMessage);
    listen(chromeApi.runtime.onInstalled, setupMenus);
    listen(chromeApi.contextMenus?.onClicked, onMenu);
    listen(chromeApi.commands?.onCommand, onCommand);
    listen(chromeApi.webNavigation?.onCommitted, (details:chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
      if (details.frameId === 0 && chromeApi.action) Promise.resolve().then(()=>chromeApi.action.setBadgeText({tabId:details.tabId,text:''})).catch(()=>{});
      if (details.frameId === 0 && chromeApi.tabs?.get) Promise.resolve().then(()=>chromeApi.tabs.get(details.tabId)).then(tab=>syncActiveTab({...tab,url:details.url})).catch(()=>{});
    });
    listen(chromeApi.tabs?.onActivated, ({tabId}:chrome.tabs.OnActivatedInfo) => {
      Promise.resolve().then(()=>chromeApi.tabs.get(tabId)).then(syncActiveTab).catch(()=>{});
    });
    listen(chromeApi.windows?.onFocusChanged, refreshActiveTab);
    listen(chromeApi.storage.onChanged, onStorage);
    listen(chromeApi.tabs?.onRemoved, (tabId:number) => cancelJobs(job => job.owner.tabId === tabId));
    listen(chromeApi.webNavigation?.onCommitted, (details:chrome.webNavigation.WebNavigationTransitionCallbackDetails) => cancelJobs(job => !job.owner.trusted && job.owner.tabId === details.tabId &&
      (details.frameId === 0 || job.owner.frameId === details.frameId) && job.owner.documentId !== details.documentId));
    void initialize();
    void setupMenus();
    refreshActiveTab();
    return api;
  }
  function stop() {
    if (stopped) return;
    stopped = true; cancelJobs();
    for (const dispose of disposers.splice(0)) dispose();
  }
  const api:BackgroundController = { start, stop, handleMessage, get ready() { return initialize(); } };
  return api;
}
