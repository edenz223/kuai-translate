import type {Settings} from '../shared/settings.js';

export interface CaptionCue {start:number; end:number; text:string; voice?:string; translation?:string; status?:'pending'|'translating'|'success'|'error'; errorMessage?:string}
export interface CurrentCaption {start:number;end:number;original:string;translation:string;status?:CaptionCue['status'];errorMessage:string}
export interface CaptionTrack {id:string;baseUrl:string;languageCode:string;kind:string;name:string}
export interface JsonSegment {utf8:string;tOffsetMs?:unknown}
export interface JsonCaptionEvent {tStartMs:unknown;dDurationMs?:unknown;segs:JsonSegment[];wWinId?:unknown;aAppend?:unknown}
export interface SubtitleState {videoId:string;subtitlesList:CaptionCue[];currentCaption:CurrentCaption|null;selectionCaptionSnapshot:CurrentCaption|null;isSubtitleSelectionHeld:boolean;translateVersion:number;isLiveDomCaptions:boolean;timelineFailed:boolean;errorMessage:string}
export type {Translate as TranslateSubtitles} from '../shared/messages.js';
export type {PreferencePatch as SettingsPatch} from '../shared/messages.js';
export interface SubtitleSession {
 id:string;video:HTMLVideoElement;rule:{id:string};state:SubtitleState;
 start:()=>SubtitleSession;destroy:()=>void;update:()=>void;setCues:(cues:CaptionCue[],options?:{live?:boolean})=>void;
 hold:(held:boolean)=>void;updateSettings:(settings:Settings)=>void;setEnabled:(enabled:boolean)=>void;seek:(time:number)=>boolean;
 translateCues:(cues:CaptionCue[])=>false|Promise<void>;retry:()=>void;isEnabled:()=>boolean;
 synchronizer:{isSyncEnabled:boolean;update:()=>void;triggerTranslation:(cues:CaptionCue[])=>false|Promise<void>};
}
export interface SubtitleBridgeConfig {isEnable?:string;hideTranslation?:string;styleConfig?:{displayOrder:string};subtitleStyle?:Partial<Settings['subtitleStyle']>;subtitleListOpen?:boolean}
export interface SubtitleBridge {
 getSessions:()=>Iterable<SubtitleSession>;getState:(id:string)=>SubtitleState|undefined;
 getConfig?:()=>SubtitleBridgeConfig;getLanguage?:()=>string|undefined;isEnabled?:(session:SubtitleSession)=>boolean;
 isSelectionHeld?:(id:string)=>boolean;getMediaKey?:(session:SubtitleSession)=>string|undefined;
 getRoots:(session:SubtitleSession)=>Array<HTMLElement|ShadowRoot>;onHold?:(session:SubtitleSession,held:boolean)=>void;
 cancelSelection?:(id:string,reason:string)=>void;translateCues?:(id:string,cues:CaptionCue[])=>false|Promise<void>;
 seek:(id:string,time:number)=>boolean;retryTimeline?:(id:string)=>void;subscribe?:(callback:()=>void)=>(()=>void);
 saveSidebarOpen?:(open:boolean)=>unknown;reportPreferenceError?:(error:unknown)=>void;
}
