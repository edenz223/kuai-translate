/** Every YouTube subtitle surface reads its text here, in the extension's interface language. */
const zh={
  // Player toolbar and captions
  toolbar:'Kuai translate 字幕工具',toggle:'开启或关闭字幕翻译（关闭后仍保留 Kuai 字幕和列表）',previous:'上一句字幕',next:'下一句字幕',
  settings:'字幕设置',back:'返回',retry:'重试',pending:'等待翻译',translating:'翻译中…',
  replay:'重播本句',loop:'单句循环',looping:'单句循环中',
  boundary:'已到时间轴边界',navDisabled:'请先开启 Kuai 字幕',navCaptionsOff:'请开启视频字幕后继续',navLive:'当前字幕没有可跳转的完整时间轴',
  navUnseekable:'视频暂时无法定位',navWaiting:'正在等待字幕时间轴',
  // Runtime errors
  readTimeout:'字幕读取超时，请重试。',readFailed:'暂时无法读取这条字幕，请切换字幕语言或重试。',
  preferencesUnavailable:'字幕设置暂不可用，请刷新页面后重试',pageLeft:'页面已经离开，请在当前视频重试',
  seekError:'无法跳转到这句字幕',trackGone:'这条字幕已不可用，请重新选择',
  cueTooLong:'这句字幕过长（超过 40000 字符），未发送翻译请求。',emptyTranslation:'翻译返回为空或数量不匹配，请重试',translationFailed:'字幕翻译失败，请重试',
  // Player settings panel
  fieldEnabled:'Kuai 字幕',fieldTranslate:'翻译字幕',fieldTrack:'原字幕语言',fieldProvider:'翻译服务',fieldTarget:'目标语言',fieldMode:'显示方式',fieldOrder:'显示顺序',fieldMask:'遮住译文练习',
  allSettings:'字体、颜色与完整字幕设置',trackAuto:'自动（跟随当前字幕）',trackAutoNone:'自动（尚未读取到字幕语言）',asrSuffix:' · 自动字幕',
  followPageProvider:'跟随网页翻译',followPageTarget:'跟随网页目标语言',modeBilingual:'原文与译文',modeTranslation:'只显示译文',
  orderOriginal:'原文在上',orderTranslation:'译文在上',actionFailed:'操作失败，请重试',switchingTrack:'正在切换字幕语言…',saving:'正在保存…',
  switchedTrack:'已切换字幕语言',saved:'已保存',settingsUnavailable:'设置暂不可用，请刷新页面后重试',trackUnavailable:'字幕语言暂不可用，请刷新页面后重试',
  optionsUnavailable:'无法打开扩展设置，请从扩展图标进入',
  fieldShortcuts:'播放器快捷键',shortcutsCtrlAlt:'Ctrl+Alt+方向键',shortcutsLetters:'A / S / D 字母键',shortcutsOff:'关闭',
  // Subtitle list
  listTitle:'字幕列表',listClose:'关闭字幕列表',follow:'回到当前字幕',following:'正在跟随',reading:'自由阅读中',
  loading:'正在读取字幕时间轴…',failed:'暂时无法读取这条字幕的完整时间轴。',disabled:'请开启 Kuai 字幕后使用字幕列表。',nativeDisabled:'请开启视频字幕后继续。',
  unavailable:'此视频暂时没有完整的字幕时间轴。',noCaptions:'此视频没有字幕。',error:'翻译暂不可用',seek:'跳转到',count:'句字幕',
  search:'搜索字幕',noMatches:'没有匹配的字幕',matches:'条匹配',view:'列表显示',viewBoth:'双语',viewOriginal:'原文',viewTranslation:'译文',
};
export type SubtitleWords={[key in keyof typeof zh]:string};
const en:SubtitleWords={
  toolbar:'Kuai Translate subtitle tools',toggle:'Turn subtitle translation on or off (Kuai captions and the list stay)',previous:'Previous subtitle',next:'Next subtitle',
  settings:'Subtitle settings',back:'Back',retry:'Retry',pending:'Waiting for translation',translating:'Translating…',
  replay:'Replay sentence',loop:'Loop sentence',looping:'Looping sentence',
  boundary:'No more subtitles this way',navDisabled:'Turn on Kuai captions first',navCaptionsOff:'Turn on captions in the video to continue',
  navLive:'These subtitles have no complete timeline to jump through',navUnseekable:'The video cannot seek right now',navWaiting:'Waiting for the subtitle timeline',
  readTimeout:'Loading subtitles timed out. Please retry.',readFailed:"Couldn't load these subtitles. Switch the subtitle language or retry.",
  preferencesUnavailable:'Subtitle settings are unavailable. Reload the page and try again.',pageLeft:'The page has changed. Try again on the current video.',
  seekError:'Unable to seek to this subtitle',trackGone:'This subtitle track is no longer available. Choose another one.',
  cueTooLong:'This subtitle is over 40,000 characters and was not sent for translation.',emptyTranslation:'The translation came back empty or incomplete. Please retry.',
  translationFailed:'Subtitle translation failed. Please retry.',
  fieldEnabled:'Kuai captions',fieldTranslate:'Translate captions',fieldTrack:'Source subtitles',fieldProvider:'Translation service',fieldTarget:'Target language',fieldMode:'Display',
  fieldOrder:'Order',fieldMask:'Hide translation to practice',allSettings:'Fonts, colors and all subtitle settings',trackAuto:'Auto (current captions)',
  trackAutoNone:'Auto (no captions found yet)',asrSuffix:' · auto-generated',followPageProvider:'Same as page translation',followPageTarget:'Same as page target language',
  modeBilingual:'Original and translation',modeTranslation:'Translation only',orderOriginal:'Original on top',orderTranslation:'Translation on top',
  actionFailed:'Something went wrong. Please retry.',switchingTrack:'Switching subtitles…',saving:'Saving…',switchedTrack:'Subtitles switched',saved:'Saved',
  settingsUnavailable:'Settings are unavailable. Reload the page and try again.',trackUnavailable:'Subtitle languages are unavailable. Reload the page and try again.',
  optionsUnavailable:"Couldn't open extension settings. Open them from the extension icon.",
  fieldShortcuts:'Player shortcuts',shortcutsCtrlAlt:'Ctrl+Alt+arrow keys',shortcutsLetters:'A / S / D letter keys',shortcutsOff:'Off',
  listTitle:'Subtitle list',listClose:'Close subtitle list',follow:'Back to current',following:'Following current',reading:'Reading freely',
  loading:'Loading the subtitle timeline…',failed:"Couldn't load the full subtitles for this video.",disabled:'Turn on Kuai captions to use this list.',
  nativeDisabled:'Turn on captions in the video to continue.',unavailable:'A complete subtitle timeline is unavailable for this video.',noCaptions:'This video has no subtitles.',
  error:'Translation unavailable',seek:'Seek to',count:'captions',
  search:'Search subtitles',noMatches:'No matching subtitles',matches:'matches',view:'List view',viewBoth:'Both',viewOriginal:'Original',viewTranslation:'Translation',
};

export function subtitleWords(language?:string|null):SubtitleWords {
  return /^zh/i.test(String(language||'')) ? zh : en;
}

export type SubtitleAction='previous'|'replay'|'next'|'loop';
const keyLabels:Record<string,Record<SubtitleAction,string>>={
  'ctrl-alt':{previous:'Ctrl+Alt+←',replay:'Ctrl+Alt+↓',next:'Ctrl+Alt+→',loop:'Ctrl+Alt+↑'},
  letters:{previous:'A',replay:'S',next:'D',loop:'R'},
};
/** The key hint for a player action, or '' when its shortcuts are off. */
export function shortcutLabel(scheme:string|undefined,action:SubtitleAction):string {
  return keyLabels[scheme||'ctrl-alt']?.[action]||'';
}
