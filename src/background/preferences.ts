import type {Settings} from '../shared/settings.js';
type PreferenceRecord=Record<string,any>;
import { normalizeSettings, normalizeSubtitleTrackPreference, SUBTITLE_SHORTCUT_SCHEMES } from '../shared/settings.js';
import { normalizeSubtitleStyle, SUBTITLE_STYLE_DEFAULTS } from '../shared/presentation.js';
import { failure } from '../providers/errors.js';

const plain=(value:unknown):value is PreferenceRecord=>value!==null && typeof value==='object' && !Array.isArray(value);
const allowed=new Set(['subtitlesEnabled','subtitleProviderId','subtitleTargetLanguage','subtitleStyle','subtitleTrackPreference','subtitleListOpen','subtitleShortcuts']);
const invalid:()=>never=()=>{throw failure('INVALID_PREFERENCES','字幕偏好无效，请检查所选服务、语言或样式。');};

/** A content page can change these public caption preferences, never provider credentials. */
export function applyPreferencePatch(current:Settings,patch:unknown):Settings {
  if (!plain(patch) || Object.keys(patch).some(key=>!allowed.has(key))) invalid();
  const next={...current};
  if (Object.hasOwn(patch,'subtitlesEnabled')) {
    if (typeof patch.subtitlesEnabled!=='boolean') invalid();
    next.subtitlesEnabled=patch.subtitlesEnabled;
  }
  if (Object.hasOwn(patch,'subtitleListOpen')) {
    if (typeof patch.subtitleListOpen!=='boolean') invalid();
    next.subtitleListOpen=patch.subtitleListOpen;
  }
  if (Object.hasOwn(patch,'subtitleShortcuts')) {
    if (!SUBTITLE_SHORTCUT_SCHEMES.includes(patch.subtitleShortcuts)) invalid();
    next.subtitleShortcuts=patch.subtitleShortcuts;
  }
  if (Object.hasOwn(patch,'subtitleTrackPreference')) {
    const preference=patch.subtitleTrackPreference,keys=['languageCode','kind','name'];
    if (!plain(preference) || Object.keys(preference).length!==keys.length || keys.some(key=>typeof preference[key]!=='string')) invalid();
    const normalized=normalizeSubtitleTrackPreference(preference);
    if (keys.some(key=>normalized[key as keyof typeof normalized]!==preference[key])) invalid();
    next.subtitleTrackPreference=normalized;
  }
  if (Object.hasOwn(patch,'subtitleProviderId')) {
    const id=patch.subtitleProviderId;
    if (typeof id!=='string' || id!=='follow_page' && !current.providers.some(provider=>provider.id===id && provider.enabled)) invalid();
    next.subtitleProviderId=id;
  }
  if (Object.hasOwn(patch,'subtitleTargetLanguage')) {
    if (typeof patch.subtitleTargetLanguage!=='string') invalid();
    next.subtitleTargetLanguage=patch.subtitleTargetLanguage;
  }
  if (Object.hasOwn(patch,'subtitleStyle')) {
    const style=patch.subtitleStyle;
    if (!plain(style)) invalid();
    for (const [key,value] of Object.entries(style)) {
      if (!Object.hasOwn(SUBTITLE_STYLE_DEFAULTS,key) || typeof value!==typeof SUBTITLE_STYLE_DEFAULTS[key as keyof typeof SUBTITLE_STYLE_DEFAULTS]) invalid();
      if (typeof value==='number' && !Number.isFinite(value)) invalid();
    }
    const normalized=normalizeSubtitleStyle({...current.subtitleStyle,...style});
    for (const [key,value] of Object.entries(style)) {
      if (typeof value!=='string') continue;
      const expected=key==='fontFamily' ? value.trim() : /Color$/.test(key) ? value.toLowerCase() : value;
      if (normalized[key as keyof typeof normalized]!==expected) invalid();
    }
    next.subtitleStyle=normalized;
  }
  try { return normalizeSettings(next); } catch { invalid(); }
}
