import type {CaptionCue} from './types.js';
import {segmentCaptionCues} from './asr-segmentation.js';

// Keep source voice and turn metadata outside the sentence segmenter. The same
// grouping drives video text, translations, list rows and subtitle navigation.
const separateTurn=/(?:^|\n)\s*(?:>>|[-–—]\s|\[[^\]\n]+\]|[♪♫]|[\p{L}][\p{L} .'-]{0,35}:\s)/u;
export function groupAuthoredCues(cues:readonly CaptionCue[]):CaptionCue[]{
  const grouped:CaptionCue[]=[];let pending:CaptionCue[]=[];
  const flush=()=>{
    if(!pending.length)return;
    const voice=pending[0].voice;
    for(const cue of segmentCaptionCues(pending))grouped.push({...cue,...(voice?{voice}:{}),translation:'',status:'pending'});
    pending=[];
  };
  for(const cue of cues){
    const previous=pending.at(-1),gap=previous?cue.start-previous.end:0;
    const isolated=separateTurn.test(cue.text)||cue.voice?.includes('\n');
    if(previous&&(gap<0||gap>=0.8||previous.voice!==cue.voice))flush();
    if(isolated){flush();grouped.push({...cue});continue;}
    pending.push(cue);
  }
  flush();return grouped;
}
