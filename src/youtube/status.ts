import type {SubtitleState} from './types.js';
/** One timeline status shared by the subtitle list, navigation and settings panel. */
export type TimelineStatus='disabled'|'captions-off'|'failed'|'live'|'loading'|'ready';

export function timelineStatus({enabled,subtitlesEnabled,state,video}:{enabled:boolean;subtitlesEnabled:boolean;state?:SubtitleState;video:HTMLVideoElement}):TimelineStatus {
  if(!enabled)return subtitlesEnabled?'captions-off':'disabled';
  const live=!!state?.isLiveDomCaptions||video.duration===Infinity,empty=!state?.subtitlesList?.length;
  if(state?.timelineFailed&&(empty||live))return 'failed';
  if(live)return 'live';
  return empty?'loading':'ready';
}
