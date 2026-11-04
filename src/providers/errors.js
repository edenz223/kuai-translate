/** Deliberately excludes URLs, request bodies, API keys and provider error bodies. */
export class TranslationError extends Error {
  constructor(code, message) { super(message); this.name = 'TranslationError'; this.code = code; }
}
export function failure(code, message) { return new TranslationError(code, message); }
export function publicError(error) {
  return error instanceof TranslationError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'The operation could not be completed. Please retry.' };
}
