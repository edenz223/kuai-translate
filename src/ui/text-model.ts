export interface TextPiece { index: number; leading: string; trailing: string; }
export interface TextPart { pieces: (string | TextPiece)[]; newline: string; }
export interface TextDocumentPlan { texts: string[]; render(translations: unknown): string; }
export interface TextProgress { completed: number; total: number; }
export interface TextTranslationOptions { providerId?: string; sourceLanguage?: string; targetLanguage?: string; requestId?: string; signal?: AbortSignal; }
export interface TextTranslationResult { translations: string[]; }
export interface TextTranslatorOptions {
  translate: (texts: string[], options: TextTranslationOptions) => Promise<TextTranslationResult>;
  cancel: (requestId: string) => unknown;
  makeRequestId: () => string;
}
export interface TextTranslator {
  stop(): void;
  run(text: unknown, fileName: string, options?: TextTranslationOptions, onProgress?: (progress: TextProgress) => void): Promise<{text: string; count: number}>;
}

/** Parse local text without sending timestamps, code fences or file metadata to a provider. */
export function parseTextDocument(input: unknown, fileName = 'text.txt'): TextDocumentPlan {
  const text = String(input), extension = fileName.toLowerCase().split('.').at(-1)!;
  if (!['txt','md','srt','vtt'].includes(extension)) throw new Error('仅支持 TXT、MD、SRT、VTT 文本文件。');
  const lines = (text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []).filter((line,index,array) => index !== array.length - 1 || line);
  const body = (line: string): string => line.replace(/(?:\r\n|\r|\n)$/,'');
  const ending = (line: string): string => line.slice(body(line).length);
  const texts: string[] = [], parts: (string | TextPart)[] = [];
  function translated(value: string, newline = '\n'): void {
    const pieces: (string | TextPiece)[] = [];
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(value.length, offset + 3000);
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      const chunk = value.slice(offset,end), leading = chunk.match(/^\s*/)![0], trailing = chunk.match(/\s*$/)![0];
      const content = chunk.trim();
      if (content) { const index = texts.length; texts.push(content); pieces.push({index,leading,trailing}); }
      else pieces.push(chunk);
      offset = end;
    }
    parts.push({pieces,newline});
  }
  if (extension === 'srt' || extension === 'vtt') {
    let found = 0;
    const timing = /^\s*(?:\d+:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d+:)?\d{2}:\d{2}[.,]\d{3}(?:\s|$)/;
    for (let index = 0; index < lines.length; index++) {
      parts.push(lines[index]);
      if (!timing.test(body(lines[index]))) continue;
      const start = index + 1;
      let end = start;
      while (end < lines.length && body(lines[end]).trim()) end++;
      if (end === start) continue;
      found++;
      translated(lines.slice(start,end).map(body).join('\n'), ending(lines[index]) || '\n');
      parts.push(ending(lines[end - 1])); index = end - 1;
    }
    if (!found) throw new Error('没有识别到有效字幕时间轴；请检查文件格式。');
  } else {
    let fence: string | null = null, frontMatter = extension === 'md' && /^(---|\+\+\+)$/.test(body(lines[0] || '')) ? body(lines[0]) : null;
    for (let index = 0; index < lines.length; index++) {
      const line = body(lines[index]), newline = ending(lines[index]);
      if (frontMatter) { parts.push(lines[index]); if (index > 0 && line === frontMatter) frontMatter = null; continue; }
      const marker = extension === 'md' && line.match(/^\s*(`{3,}|~{3,})/);
      if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; parts.push(lines[index]); continue; }
      if (fence || !line.trim()) { parts.push(lines[index]); continue; }
      const prefix = extension === 'md' ? (line.match(/^\s*(?:(?:#{1,6}|[-+*]|\d+[.)]|>)\s+)*/)?.[0] || '') : '';
      parts.push(prefix); translated(line.slice(prefix.length)); parts.push(newline);
    }
  }
  return {
    texts,
    render(translations: unknown): string {
      if (!Array.isArray(translations) || translations.length !== texts.length || translations.some(value => typeof value !== 'string' || !value.trim()))
        throw new Error('译文为空或数量不匹配，原文已保留。');
      return parts.map(part => typeof part === 'string' ? part : part.pieces.map(piece => typeof piece === 'string' ? piece :
        piece.leading + translations[piece.index].replace(/\r\n|\r|\n/g,part.newline) + piece.trailing).join('')).join('');
    },
  };
}

const cancelledError = () => Object.assign(new Error('已取消翻译。'), {name:'AbortError',code:'CANCELLED'});

export function createTextTranslator({translate, cancel, makeRequestId}: TextTranslatorOptions): TextTranslator {
  let generation = 0, activeId: string | null = null;
  function stop(): void {
    generation++;
    if (activeId) Promise.resolve(cancel(activeId)).catch(() => {});
    activeId = null;
  }
  return {
    stop,
    async run(text: unknown, fileName: string, options: TextTranslationOptions = {}, onProgress: (progress: TextProgress) => void = () => {}) {
      stop();
      const version = generation, plan = parseTextDocument(text,fileName), output: string[] = [];
      if (!plan.texts.length) throw new Error('请输入需要翻译的文字。');
      onProgress({completed:0,total:plan.texts.length});
      for (let offset = 0; offset < plan.texts.length; offset += 8) {
        if (version !== generation) throw cancelledError();
        const batch = plan.texts.slice(offset,offset + 8), requestId = makeRequestId(); activeId = requestId;
        let result;
        try { result = await translate(batch,{...options,requestId}); }
        catch (error) { if (version !== generation) throw cancelledError(); throw error; }
        finally { if (activeId === requestId) activeId = null; }
        if (version !== generation) throw cancelledError();
        if (!Array.isArray(result?.translations) || result.translations.length !== batch.length || result.translations.some(value => typeof value !== 'string' || !value.trim()))
          throw new Error('译文为空或数量不匹配，原文已保留；可以重新翻译。');
        output.push(...result.translations);
        onProgress({completed:output.length,total:plan.texts.length});
      }
      return {text:plan.render(output),count:plan.texts.length};
    },
  };
}
