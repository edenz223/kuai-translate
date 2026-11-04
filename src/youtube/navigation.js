/** Navigation uses the current finite timeline; assigning time never changes playback state. */
export function navigationState(session) {
  const video=session.video,state=session.state;
  let reason='';
  if(!session.isEnabled())reason='请先开启字幕翻译';
  else if(state.isLiveDomCaptions||video.duration===Infinity)reason='当前字幕没有可跳转的完整时间轴';
  else if(!Number.isFinite(video.duration)||video.duration<=0||!Number.isFinite(video.currentTime))reason='视频暂时无法定位';
  const cues=state.subtitlesList||[];
  if(!reason&&!cues.length)reason='正在等待字幕时间轴';
  if(reason)return{previous:null,next:null,reason};
  let low=0,high=cues.length;
  while(low<high){const middle=(low+high)>>>1;if(cues[middle].start<=video.currentTime)low=middle+1;else high=middle;}
  let previous=low-1;
  if(previous>=0&&video.currentTime<cues[previous].end){const start=cues[previous].start;while(previous>=0&&cues[previous].start===start)previous--;}
  const available=time=>{
    if(!Number.isFinite(time)||time<0||time>=video.duration)return null;
    if(video.seekable?.length){let valid=false;for(let index=0;index<video.seekable.length;index++)if(time>=video.seekable.start(index)&&time<video.seekable.end(index))valid=true;if(!valid)return null;}
    return time;
  };
  return{previous:available(cues[previous]?.start),next:available(cues[low]?.start),reason:''};
}
