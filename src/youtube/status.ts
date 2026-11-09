import type {SubtitleState} from './types.js';
/** One timeline status shared by the subtitle list, navigation and settings panel. */
export type TimelineStatus='disabled'|'captions-off'|'none'|'failed'|'live'|'loading'|'ready';

export function timelineStatus({enabled,subtitlesEnabled,state,video}:{enabled:boolean;subtitlesEnabled:boolean;state?:SubtitleState;video:HTMLVideoElement}):TimelineStatus {
  if(!enabled&&!subtitlesEnabled)return 'disabled';
  const live=!!state?.isLiveDomCaptions||video.duration===Infinity,empty=!state?.subtitlesList?.length;
  // A video without caption tracks has nothing to turn on or to wait for.
  if(state?.noTracks&&empty)return 'none';
  if(!enabled)return 'captions-off';
  if(state?.timelineFailed&&(empty||live))return 'failed';
  if(live)return 'live';
  return empty?'loading':'ready';
}
