import {debug} from '../shared/debug.js';
import type {SubtitleSession} from './types.js';
import {subtitleWords} from './i18n.js';
import {timelineStatus} from './status.js';
// Like a music player: "previous" restarts the current sentence once it has played a moment.
export const REPLAY_AFTER_SECONDS=1.5;
/** Navigation uses the current finite timeline; assigning time never changes playback state. */
export function navigationState(session:SubtitleSession,{words=subtitleWords(),subtitlesEnabled=true,diagnostic=false}={}) {
  const video=session.video,state=session.state;
  const status=timelineStatus({enabled:session.isEnabled(),subtitlesEnabled,state,video});
  const reason=status==='disabled'?words.navDisabled:status==='captions-off'?words.navCaptionsOff:status==='live'?words.navLive:status==='failed'?words.failed:status==='none'?words.noCaptions:status!=='ready'?words.navWaiting:
    !Number.isFinite(video.duration)||video.duration<=0||!Number.isFinite(video.currentTime)?words.navUnseekable:'';
  const cues=state.subtitlesList||[];
  if(diagnostic&&reason)debug('youtube:navigation',`字幕导航不可用：${status}，共 ${cues.length} 条`,{outcome:'unavailable',status,cues:cues.length});
  if(reason)return{previous:null,next:null,current:null,replay:false,reason};
  let low=0,high=cues.length;
  while(low<high){const middle=(low+high)>>>1;if(cues[middle].start<=video.currentTime)low=middle+1;else high=middle;}
  let previous=low-1,replay=false;const inside=previous>=0&&video.currentTime<cues[previous].end,current=inside?previous:-1;
  if(inside){
    const start=cues[previous].start;replay=video.currentTime-start>=REPLAY_AFTER_SECONDS;
    if(!replay)while(previous>=0&&cues[previous].start===start)previous--;
  }
  const available=(time:number|undefined)=>{
    if(!Number.isFinite(time)||time!<0||time!>=video.duration)return null;
    if(video.seekable?.length){let valid=false;for(let index=0;index<video.seekable.length;index++)if(time!>=video.seekable.start(index)&&time!<video.seekable.end(index))valid=true;if(!valid)return null;}
    return time!;
  };
  const target=available(cues[previous]?.start);
  return{previous:target,next:available(cues[low]?.start),current:available(cues[current]?.start),replay:replay&&target!==null,reason:''};
}
