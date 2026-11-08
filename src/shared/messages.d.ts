import type {ProviderModel} from '../providers/index.js';
import type {Provider, Settings, PublicSettings} from './settings.js';

export type OptionsSection = 'webpage' | 'selection' | 'input' | 'hover' | 'subtitles';
export type DisplayMode = 'bilingual' | 'translation_only';
/** Toolbar badge summary of the top frame's page translation. */
export type PageBadgeState = 'idle' | 'working' | 'done' | 'error' | 'blocked';
export interface TranslationOptions {
  signal?: AbortSignal; requestId?: string; providerId?: string;
  sourceLanguage?: string; targetLanguage?: string;
}
export interface TranslationResult { translations: string[]; providerId: string }
export type Translate = (texts: string[], options?: TranslationOptions) => Promise<TranslationResult>;
export type PreferencePatch = Partial<Pick<Settings,
  'subtitlesEnabled' | 'subtitleProviderId' | 'subtitleTargetLanguage' | 'subtitleTrackPreference' | 'subtitleListOpen' | 'subtitleShortcuts'>> &
  {subtitleStyle?: Partial<Settings['subtitleStyle']>};
export interface RequestPayloadMap {
  KUAI_GET_SETTINGS: {includeSecrets?: boolean};
  KUAI_SAVE_SETTINGS: {settings: Settings; baseSettings?: Settings};
  KUAI_UPDATE_PREFERENCES: {patch: PreferencePatch};
  KUAI_UPDATE_PAGE_PREFERENCES: {patch: {pageDisplayMode: DisplayMode}};
  KUAI_OPEN_OPTIONS: {section: OptionsSection};
  KUAI_TRANSLATE: Omit<TranslationOptions, 'signal'> & {requestId: string; texts: string[]};
  KUAI_CANCEL: {requestId: string};
  KUAI_LIST_MODELS: {provider: Provider; requestId: string};
  KUAI_TEST_PROVIDER: {provider: Provider; requestId?: string; text?: string};
  KUAI_PAGE_STATE: {state: PageBadgeState};
}
export interface RequestResultMap {
  KUAI_GET_SETTINGS: Settings;
  KUAI_SAVE_SETTINGS: Settings;
  KUAI_UPDATE_PREFERENCES: PublicSettings;
  KUAI_UPDATE_PAGE_PREFERENCES: PublicSettings;
  KUAI_OPEN_OPTIONS: {opened: boolean; section: OptionsSection};
  KUAI_TRANSLATE: TranslationResult;
  KUAI_CANCEL: {cancelled: boolean};
  KUAI_LIST_MODELS: ProviderModel[];
  KUAI_TEST_PROVIDER: TranslationResult;
  KUAI_PAGE_STATE: {shown: boolean};
}
export type RequestType = keyof RequestPayloadMap;
export type RequestPayload<T extends RequestType> = RequestPayloadMap[T];
export type BackgroundRequest = {[K in RequestType]: {type: K} & RequestPayloadMap[K]}[RequestType];
export interface PublicFailure {code: string; message: string}
export type MessageResponse<T> = {ok: true; value: T} | {ok: false; error: PublicFailure};
export type BackgroundResponse = MessageResponse<RequestResultMap[RequestType]>;
export type PageActionType = 'KUAI_PAGE_TRANSLATE' | 'KUAI_PAGE_RESTORE' | 'KUAI_SELECTION_TRANSLATE' |
  'KUAI_INPUT_TRANSLATE' | 'KUAI_PAGE_STATUS' | 'KUAI_YOUTUBE_OPEN_LIST' | 'KUAI_PAGE_TOGGLE' | 'KUAI_PAGE_DISPLAY_MODE';
export type PageRequest = {type: PageActionType; text?: string};
export interface SettingsChanged {type: 'KUAI_SETTINGS_CHANGED'; settings: PublicSettings}
export interface PageStatus {
  active: boolean; translated: number; errors: number; total: number; cancelled: boolean; isTranslated: boolean;
  phase?: string; error?: string; subtitleError?: PublicFailure;
}
