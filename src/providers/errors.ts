/** Deliberately excludes URLs, request bodies, API keys and provider error bodies. */
export class TranslationError extends Error {
  declare code: string;
  constructor(code:string, message:string) { super(message); this.name = 'TranslationError'; this.code = code; }
}
export function failure(code:string, message:string) { return new TranslationError(code, message); }
export function publicError(error:unknown) {
  return error instanceof TranslationError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'The operation could not be completed. Please retry.' };
}
