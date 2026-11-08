import type {SubtitleSession} from './types.js';
import {subtitleWords} from './i18n.js';
import {timelineStatus} from './status.js';
/** Navigation uses the current finite timeline; assigning time never changes playback state. */
export function navigationState(session:SubtitleSession,{words=subtitleWords(),subtitlesEnabled=true}={}) {
  const video=session.video,state=session.state;
  const status=timelineStatus({enabled:session.isEnabled(),subtitlesEnabled,state,video});
  const reason=status==='disabled'?words.navDisabled:status==='captions-off'?words.navCaptionsOff:status==='live'?words.navLive:status==='failed'?words.failed:status!=='ready'?words.navWaiting:
    !Number.isFinite(video.duration)||video.duration<=0||!Number.isFinite(video.currentTime)?words.navUnseekable:'';
  const cues=state.subtitlesList||[];
  if(reason)return{previous:null,next:null,reason};
  let low=0,high=cues.length;
  while(low<high){const middle=(low+high)>>>1;if(cues[middle].start<=video.currentTime)low=middle+1;else high=middle;}
  let previous=low-1;
  if(previous>=0&&video.currentTime<cues[previous].end){const start=cues[previous].start;while(previous>=0&&cues[previous].start===start)previous--;}
  const available=(time:number|undefined)=>{
    if(!Number.isFinite(time)||time!<0||time!>=video.duration)return null;
    if(video.seekable?.length){let valid=false;for(let index=0;index<video.seekable.length;index++)if(time!>=video.seekable.start(index)&&time!<video.seekable.end(index))valid=true;if(!valid)return null;}
    return time!;
  };
  return{previous:available(cues[previous]?.start),next:available(cues[low]?.start),reason:''};
}
