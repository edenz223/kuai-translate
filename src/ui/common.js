export const TYPE_NAMES = {microsoft:'微软翻译 · 免费',google:'谷歌翻译 · 免费',transmart:'腾讯 Transmart · 免费',yandex:'Yandex · 免费',openai:'OpenAI 兼容 API',gemini:'Google Gemini',anthropic:'Anthropic Claude',azure:'Azure Translator',deepl:'DeepL API',deeplx:'DeepLX / 自建接口',ollama:'Ollama'};
export const FREE_TYPES = ['microsoft','google','transmart','yandex'];
export const LANGUAGES = [['auto','自动检测'],['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['pt','Português'],['ru','Русский'],['ar','العربية'],['hi','हिन्दी'],['it','Italiano'],['vi','Tiếng Việt'],['th','ไทย'],['id','Bahasa Indonesia']];
export const byId = (document,id) => document.getElementById(id);
export function setStatus(node, message, error = false) { node.textContent = message; node.classList.toggle('error',error); }
export function fillSelect(document, select, entries, selected) {
  if(selected && !entries.some(([value])=>value===selected))entries=[...entries,[selected,selected]];
  const signature = JSON.stringify(entries);
  if (select.dataset.options !== signature) {
    select.replaceChildren(...entries.map(([value,label]) => { const option = document.createElement('option'); option.value=value;option.textContent=label;return option; }));
    select.dataset.options = signature;
  }
  select.value = selected;
}
export function fillProviders(document, select, settings, selected, follow = false) {
  const entries = settings.providers.filter(provider=>provider.enabled).map(provider=>[provider.id,provider.name || TYPE_NAMES[provider.type] || provider.type]);
  fillSelect(document,select,follow ? [['follow_page','跟随网页翻译'],...entries] : entries,selected);
}
export function downloadText(document, fileName, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type})), anchor = document.createElement('a');
  anchor.href=url;anchor.download=fileName;document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function errorMessage(error) { return error?.message || '操作失败，请重试。'; }
