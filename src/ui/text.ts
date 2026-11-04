import {getSettings,translate,cancel,makeRequestId} from '../shared/client.js';
import {createTextTranslator} from './text-model.js';
import {byId,fillProviders,fillSelect,LANGUAGES,setStatus,errorMessage,downloadText} from './common.js';

export async function startTextTool(document: Document=globalThis.document): Promise<void> {
  const status=byId(document,'status'), input=byId<HTMLTextAreaElement>(document,'input'), output=byId<HTMLTextAreaElement>(document,'output');
  const runner=createTextTranslator({translate,cancel,makeRequestId});
  let fileName='text.txt', running=false, reading=false, generation=0;
  const busy=(value: boolean): void=>{
    running=value;
    byId<HTMLButtonElement>(document,'translate').disabled=value || reading || !input.value.trim();
    byId<HTMLButtonElement>(document,'cancel').disabled=!value && !reading;byId<HTMLButtonElement>(document,'cancel').hidden=!value && !reading;
    byId<HTMLButtonElement>(document,'copy').disabled=!output.value;byId<HTMLButtonElement>(document,'download').disabled=!output.value;
  };
  try {const settings=await getSettings();fillProviders(document,byId<HTMLSelectElement>(document,'provider'),settings,settings.activeProviderId);fillSelect(document,byId<HTMLSelectElement>(document,'source'),LANGUAGES,settings.sourceLanguage);fillSelect(document,byId<HTMLSelectElement>(document,'target'),LANGUAGES.filter(([id])=>id!=='auto'),settings.targetLanguage);}
  catch(error){setStatus(status,errorMessage(error),true);return;}
  busy(false);
  function invalidate(): number{generation++;runner.stop();reading=false;output.value='';busy(false);return generation;}
  input.addEventListener('input',()=>{invalidate();setStatus(status,input.value.trim()?'原文已修改，点击翻译生成新的译文。':'粘贴文字或打开本地文件后即可翻译。');});
  byId<HTMLSelectElement>(document,'format').addEventListener('change',event=>{invalidate();fileName='text.'+(event.target as HTMLInputElement).value;setStatus(status,'格式已更改，请重新开始翻译。');});
  byId<HTMLInputElement>(document,'file').addEventListener('change',async event=>{
    const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
    const version=invalidate();
    try {
      if(file.size>2*1024*1024)throw Error('文本文件不能超过 2 MB。');
      if(!/\.(txt|md|srt|vtt)$/i.test(file.name))throw Error('仅支持 TXT、MD、SRT、VTT。');
      reading=true;busy(false);setStatus(status,'正在读取本地文件…');
      const text=await file.text();
      if(version!==generation)return;
      fileName=file.name;byId<HTMLSelectElement>(document,'format').value=file.name.toLowerCase().split('.').at(-1)!;input.value=text;output.value='';
      setStatus(status,'已在本地读取文件；点击翻译后才发送正文。');
    }catch(error){if(version===generation)setStatus(status,errorMessage(error),true);}
    finally{if(version===generation){reading=false;busy(false);}(event.target as HTMLInputElement).value='';}
  });
  byId<HTMLButtonElement>(document,'translate').addEventListener('click',async()=>{
    if(reading || running || !input.value.trim())return;
    const version=++generation;output.value='';busy(true);
    try {const result=await runner.run(input.value,fileName,{providerId:byId<HTMLSelectElement>(document,'provider').value,sourceLanguage:byId<HTMLSelectElement>(document,'source').value,targetLanguage:byId<HTMLSelectElement>(document,'target').value},progress=>{if(version===generation)setStatus(status,`翻译中：${progress.completed} / ${progress.total}`);});
      if(version!==generation)return;output.value=result.text;byId<HTMLButtonElement>(document,'download').disabled=false;setStatus(status,'翻译完成。原文保留在左侧。');}
    catch(error){if(version===generation)setStatus(status,errorMessage(error),(error as {name?: string}).name!=='AbortError');}
    finally{if(version===generation)busy(false);}
  });
  byId<HTMLButtonElement>(document,'cancel').addEventListener('click',()=>{invalidate();setStatus(status,'已取消，原文保持不变。');});
  for(const id of ['provider','source','target'])byId(document,id).addEventListener('change',()=>{invalidate();output.value='';setStatus(status,'翻译设置已更改，请重新开始。');});
  byId<HTMLButtonElement>(document,'download').addEventListener('click',()=>{if(output.value)downloadText(document,fileName.replace(/\.(txt|md|srt|vtt)$/i,'.translated.$1'),output.value);});
  byId<HTMLButtonElement>(document,'copy').addEventListener('click',async()=>{if(!output.value)return;try{await navigator.clipboard.writeText(output.value);setStatus(status,'译文已复制。');}catch{setStatus(status,'请选中右侧译文后复制。',true);}});
  (document.defaultView || globalThis).addEventListener('pagehide',()=>runner.stop(),{once:true});
}
if(globalThis.document)startTextTool();
