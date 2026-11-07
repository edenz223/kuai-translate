import type {Provider,Settings} from '../shared/settings.js';

export type SelectEntry = [value: string, label: string];
export type SelectControl = HTMLElement & {value: string};

export const TYPE_NAMES: Record<string,string> = {microsoft:'微软翻译 · 免费',google:'谷歌翻译 · 免费',transmart:'腾讯 Transmart · 免费',yandex:'Yandex · 免费',openai:'OpenAI 兼容 API',gemini:'Google Gemini',anthropic:'Anthropic Claude',azure:'Azure Translator',deepl:'DeepL API',deeplx:'DeepLX / 自建接口',ollama:'Ollama'};
export const FREE_TYPES = ['microsoft','google','transmart','yandex'];
export interface ProviderInfo {description:string;needs:string;defaultUrl:string;keyRequired:boolean;urlRequired:boolean;models:boolean;region:boolean;keyUrl?:string;keyHelp:string;urlHelp:string;focus:'baseUrl'|'apiKey'|'model'}
const keyHelp='仅保存在扩展本地存储中，只在获取模型、测试和翻译时发往该服务。';
// Defaults mirror src/providers/index.ts; custom types only. Free types need no configuration.
export const PROVIDER_INFO: Record<string,ProviderInfo> = {
  openai:{description:'OpenAI 及兼容接口，如 AI 网关和本地推理服务。',needs:'需要 API Key',defaultUrl:'https://api.openai.com/v1',keyRequired:true,urlRequired:false,models:true,region:false,keyUrl:'https://platform.openai.com/api-keys',keyHelp,urlHelp:'留空使用 OpenAI 官方地址；兼容服务请填写到 /v1 一级，例如 https://example.com/v1。',focus:'baseUrl'},
  gemini:{description:'Google AI Studio 提供的 Gemini 模型。',needs:'需要 API Key',defaultUrl:'https://generativelanguage.googleapis.com/v1beta',keyRequired:true,urlRequired:false,models:true,region:false,keyUrl:'https://aistudio.google.com/apikey',keyHelp,urlHelp:'留空使用 Google 官方地址。',focus:'apiKey'},
  anthropic:{description:'Anthropic Claude 模型。',needs:'需要 API Key',defaultUrl:'https://api.anthropic.com/v1',keyRequired:true,urlRequired:false,models:true,region:false,keyUrl:'https://console.anthropic.com/settings/keys',keyHelp,urlHelp:'留空使用 Anthropic 官方地址。',focus:'apiKey'},
  azure:{description:'微软 Azure AI 翻译，按自己的订阅计费。',needs:'需要 Key 和区域',defaultUrl:'https://api.cognitive.microsofttranslator.com',keyRequired:true,urlRequired:false,models:false,region:true,keyUrl:'https://portal.azure.com/',keyHelp,urlHelp:'留空使用全局地址；自定义域名资源请填写自己的终结点。',focus:'apiKey'},
  deepl:{description:'DeepL 官方 API，Free 与 Pro 账号均可。',needs:'需要 API Key',defaultUrl:'https://api-free.deepl.com/v2',keyRequired:true,urlRequired:false,models:false,region:false,keyUrl:'https://www.deepl.com/your-account/keys',keyHelp,urlHelp:'留空使用 Free 地址；Pro 账号请填写 https://api.deepl.com/v2。',focus:'apiKey'},
  deeplx:{description:'自建或第三方 DeepLX 兼容接口。',needs:'需要自建地址',defaultUrl:'https://your-server.example/translate',keyRequired:false,urlRequired:true,models:false,region:false,keyHelp:'接口设置了访问令牌时填写，否则留空。',urlHelp:'填写完整接口地址。',focus:'baseUrl'},
  ollama:{description:'在本机运行的开源模型。',needs:'本地运行，无需 Key',defaultUrl:'http://localhost:11434',keyRequired:false,urlRequired:false,models:true,region:false,keyHelp:'Ollama 默认无需 Key。若连接被拒绝，请为 Ollama 设置 OLLAMA_ORIGINS 允许扩展访问。',urlHelp:'留空使用本机默认地址。',focus:'model'},
};
export const needsKey=(type: string): boolean=>!!PROVIDER_INFO[type]?.keyRequired;
export type ProviderField = 'baseUrl' | 'apiKey' | 'model';
/** `blocking` problems are rejected by settings normalization, so such a value cannot be saved yet. */
export function urlProblem(url: string, example = 'https://example.com/v1', blocking = false): string | undefined {
  let parsed: URL;
  try { parsed=new URL(url.trim()); } catch { return '请输入完整地址，例如 '+example+'。'; }
  if(!['http:','https:'].includes(parsed.protocol))return '地址需以 http:// 或 https:// 开头。';
  if(parsed.username || parsed.password)return '地址中不能包含账号或密码；Key 请填在下方。';
  if(!blocking && parsed.hash)return '地址中不能包含 # 片段。';
}
/** Problems that stop a custom provider from translating, keyed by the field to fix. */
export function providerProblems(provider: Provider): Partial<Record<ProviderField,string>> {
  const info=PROVIDER_INFO[provider.type], problems: Partial<Record<ProviderField,string>>={};
  if(!info)return problems;
  const url=provider.baseUrl?.trim();
  if(url) problems.baseUrl=urlProblem(url,info.defaultUrl);
  else if(info.urlRequired) problems.baseUrl='请填写接口地址。';
  if(!problems.baseUrl)delete problems.baseUrl;
  if(info.keyRequired && !provider.apiKey)problems.apiKey='请填写 API Key。';
  if(info.models && !provider.model?.trim())problems.model='请获取或填写模型名。';
  return problems;
}
const ISSUE_LABELS: Record<ProviderField,string> = {baseUrl:'地址待填写',apiKey:'缺少 Key',model:'缺少模型'};
export function providerIssue(provider: Provider): string {
  const problems=providerProblems(provider), field=(['apiKey','baseUrl','model'] as const).find(key=>problems[key]);
  return !field ? '' : field==='baseUrl' && provider.baseUrl ? '地址无效' : ISSUE_LABELS[field];
}
/** Features that name this provider explicitly; ones following the web page are left out. */
export function providerUsage(settings: Settings, id: string): string[] {
  return [[settings.activeProviderId,'网页'],[settings.subtitleProviderId,'字幕'],[settings.selectionOptions.providerId,'划词'],[settings.inputOptions.providerId,'输入']]
    .filter(([value])=>value===id).map(([,label])=>label);
}
export function nextProviderName(settings: Settings, type: string): string {
  const base=TYPE_NAMES[type] || type, names=new Set(settings.providers.map(provider=>provider.name));
  let name=base;
  for(let index=2;names.has(name);index++)name=base+' '+index;
  return name;
}
const ERROR_HINTS: [RegExp,string,string][] = [
  [/^HTTP_40[13]$/,'API Key 无效或没有权限','检查 Key 是否完整、未过期，并且账号可以使用该服务或模型。'],
  [/^HTTP_404$/,'地址或模型不存在','检查 API 地址是否填到正确层级（如 /v1），以及模型名是否可用。'],
  [/^HTTP_429$/,'请求过多或额度不足','稍后再试，或检查账号余额与速率限制。'],
  [/^HTTP_5\d\d$/,'服务暂时不可用','服务端出现错误，稍后再试。'],
  [/^HTTP_/,'服务拒绝了请求','检查 API 地址、模型名和账号设置。'],
  [/^NETWORK_ERROR$/,'无法连接到服务','检查地址能否访问；本地或自建服务需已启动并允许扩展访问。'],
  [/^TIMEOUT$/,'请求超时','检查网络或服务负载后重试。'],
  [/^(?:INVALID|INCOMPLETE)_RESPONSE$/,'无法识别服务返回的内容','确认服务类型与地址匹配，例如兼容接口应选择 OpenAI 兼容 API。'],
];
/** Turns a provider error code into a cause and a next step; unknown codes keep the original message. */
export function describeProviderError(error: unknown): {title:string;hint:string;detail:string} {
  const code=(error as {code?: string} | null)?.code || '', detail=errorMessage(error);
  if(code==='INVALID_CONFIG')return {title:'配置不完整',hint:'检查标出的字段后重试。',detail};
  const match=ERROR_HINTS.find(([pattern])=>pattern.test(code));
  return match ? {title:match[1],hint:match[2],detail} : {title:'测试失败',hint:detail,detail:''};
}
export const LANGUAGES: SelectEntry[] = [['auto','自动检测'],['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['pt','Português'],['ru','Русский'],['ar','العربية'],['hi','हिन्दी'],['it','Italiano'],['vi','Tiếng Việt'],['th','ไทย'],['id','Bahasa Indonesia']];
export const languageName = (id: string): string => LANGUAGES.find(([value])=>value===id)?.[1] || id;
export const byId = <T extends HTMLElement = HTMLElement>(document: Document,id: string): T => document.getElementById(id) as T;
export function setStatus(node: HTMLElement, message: string, error = false): void { node.textContent = message; node.classList.toggle('error',error); }
export function fillSelect(document: Document, select: SelectControl, entries: SelectEntry[], selected: string): void {
  if(selected && !entries.some(([value])=>value===selected))entries=[...entries,[selected,selected]];
  const signature = JSON.stringify(entries);
  if (select.dataset.options !== signature) {
    select.replaceChildren(...entries.map(([value,label]) => { const option = document.createElement('option'); option.value=value;option.textContent=label;return option; }));
    select.dataset.options = signature;
  }
  select.value = selected;
}
export function fillProviders(document: Document, select: SelectControl, settings: Settings, selected: string, follow = false): void {
  const entries = settings.providers.filter(provider=>provider.enabled).map((provider): SelectEntry=>[provider.id,provider.name || TYPE_NAMES[provider.type] || provider.type]);
  const current = entries.find(([id])=>id===settings.activeProviderId)?.[1];
  fillSelect(document,select,follow ? [['follow_page',current ? `跟随网页翻译（当前：${current}）` : '跟随网页翻译'],...entries] : entries,selected);
}
export function downloadText(document: Document, fileName: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type})), anchor = document.createElement('a');
  anchor.href=url;anchor.download=fileName;document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function errorMessage(error: unknown): string { return (error as {message?: string} | null)?.message || '操作失败，请重试。'; }
