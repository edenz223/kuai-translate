import { failure, TranslationError } from './errors.js';

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Covers connection, body reading and parsing; a stalled transport cannot hang a job. */
export async function withRequestLifetime(run, { signal, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  let rejectCancelled, timer;
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
  const abort = () => {
    controller.abort();
    rejectCancelled(failure('CANCELLED', 'Translation was cancelled.'));
  };
  const timedOut = () => {
    controller.abort();
    rejectCancelled(failure('TIMEOUT', 'The translation service timed out. Please retry.'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  timer = setTimeout(timedOut, Math.max(1, Math.min(Number(timeoutMs) || 30000, 60000)));
  try {
    if (signal?.aborted) return await cancelled;
    return await Promise.race([run(controller.signal), cancelled]);
  } catch (error) {
    if (error instanceof TranslationError) throw error;
    if (signal?.aborted) throw failure('CANCELLED', 'Translation was cancelled.');
    throw failure('NETWORK_ERROR', 'Unable to reach the translation service. Check the connection and endpoint.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Stop remaining members of a parallel batch after any failure.
    controller.abort();
  }
}

export async function requestJSON(fetchImpl, url, options, signal) {
  if (signal.aborted) throw failure('CANCELLED', 'Translation was cancelled.');
  const response = await fetchImpl(String(url), {
    ...options, signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    response.body?.cancel?.().catch(() => {});
    const status = Number(response.status) || 0;
    throw failure('HTTP_' + status, `The translation service returned HTTP ${status}. Check its configuration or retry later.`);
  }
  if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) {
    response.body?.cancel?.().catch(() => {});
    throw failure('RESPONSE_TOO_LARGE', 'The translation response was too large. Use a smaller batch.');
  }
  let body = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const cancelReader = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancelReader, { once: true });
    if (signal.aborted) cancelReader();
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw failure('RESPONSE_TOO_LARGE', 'The translation response was too large. Use a smaller batch.');
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    } finally { signal.removeEventListener('abort', cancelReader); reader.releaseLock(); }
  } else {
    body = await response.text();
    if (new TextEncoder().encode(body).length > MAX_RESPONSE_BYTES)
      throw failure('RESPONSE_TOO_LARGE', 'The translation response was too large. Use a smaller batch.');
  }
  try { return JSON.parse(body); }
  catch { throw failure('INVALID_RESPONSE', 'The translation service did not return valid JSON.'); }
}
