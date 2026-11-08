/** Every YouTube subtitle surface reads its text here, in the extension's interface language. */
const zh={
  // Player toolbar and captions
  toolbar:'Kuai translate 字幕工具',toggle:'开启或关闭 Kuai translate 字幕翻译',previous:'上一句字幕',next:'下一句字幕',
  settings:'字幕设置',closeSettings:'关闭字幕设置',retry:'重试',pending:'等待翻译',translating:'翻译中…',
  boundary:'已到时间轴边界',navDisabled:'请先开启字幕翻译',navCaptionsOff:'请开启视频字幕后继续',navLive:'当前字幕没有可跳转的完整时间轴',
  navUnseekable:'视频暂时无法定位',navWaiting:'正在等待字幕时间轴',
  // Runtime errors
  readTimeout:'字幕读取超时，请重试。',readFailed:'暂时无法读取这条字幕，请切换字幕语言或重试。',
  preferencesUnavailable:'字幕设置暂不可用，请刷新页面后重试',pageLeft:'页面已经离开，请在当前视频重试',
  seekError:'无法跳转到这句字幕',trackGone:'这条字幕已不可用，请重新选择',
  cueTooLong:'这句字幕过长（超过 40000 字符），未发送翻译请求。',emptyTranslation:'翻译返回为空或数量不匹配，请重试',translationFailed:'字幕翻译失败，请重试',
  // Player settings panel
  fieldEnabled:'字幕翻译',fieldTrack:'原字幕语言',fieldProvider:'翻译服务',fieldTarget:'目标语言',fieldMode:'显示方式',fieldOrder:'显示顺序',fieldMask:'遮住译文练习',
  allSettings:'字体、颜色与完整字幕设置',trackAuto:'自动（跟随当前字幕）',trackAutoNone:'自动（尚未读取到字幕语言）',asrSuffix:' · 自动字幕',
  followPageProvider:'跟随网页翻译',followPageTarget:'跟随网页目标语言',modeBilingual:'原文与译文',modeTranslation:'只显示译文',
  orderOriginal:'原文在上',orderTranslation:'译文在上',actionFailed:'操作失败，请重试',switchingTrack:'正在切换字幕语言…',saving:'正在保存…',
  switchedTrack:'已切换字幕语言',saved:'已保存',settingsUnavailable:'设置暂不可用，请刷新页面后重试',trackUnavailable:'字幕语言暂不可用，请刷新页面后重试',
  optionsUnavailable:'无法打开扩展设置，请从扩展图标进入',
  // Subtitle list
  listTitle:'字幕列表',listClose:'关闭字幕列表',follow:'回到当前字幕',following:'正在跟随',reading:'自由阅读中',
  loading:'正在读取字幕时间轴…',failed:'暂时无法读取这条字幕的完整时间轴。',disabled:'请开启字幕翻译后使用字幕列表。',nativeDisabled:'请开启视频字幕后继续。',
  unavailable:'此视频暂时没有完整的字幕时间轴。',error:'翻译暂不可用',seek:'跳转到',count:'句字幕',
};
export type SubtitleWords={[key in keyof typeof zh]:string};
const en:SubtitleWords={
  toolbar:'Kuai Translate subtitle tools',toggle:'Turn Kuai Translate subtitles on or off',previous:'Previous subtitle',next:'Next subtitle',
  settings:'Subtitle settings',closeSettings:'Close subtitle settings',retry:'Retry',pending:'Waiting for translation',translating:'Translating…',
  boundary:'No more subtitles this way',navDisabled:'Turn on subtitle translation first',navCaptionsOff:'Turn on captions in the video to continue',
  navLive:'These subtitles have no complete timeline to jump through',navUnseekable:'The video cannot seek right now',navWaiting:'Waiting for the subtitle timeline',
  readTimeout:'Loading subtitles timed out. Please retry.',readFailed:"Couldn't load these subtitles. Switch the subtitle language or retry.",
  preferencesUnavailable:'Subtitle settings are unavailable. Reload the page and try again.',pageLeft:'The page has changed. Try again on the current video.',
  seekError:'Unable to seek to this subtitle',trackGone:'This subtitle track is no longer available. Choose another one.',
  cueTooLong:'This subtitle is over 40,000 characters and was not sent for translation.',emptyTranslation:'The translation came back empty or incomplete. Please retry.',
  translationFailed:'Subtitle translation failed. Please retry.',
  fieldEnabled:'Subtitle translation',fieldTrack:'Source subtitles',fieldProvider:'Translation service',fieldTarget:'Target language',fieldMode:'Display',
  fieldOrder:'Order',fieldMask:'Hide translation to practice',allSettings:'Fonts, colors and all subtitle settings',trackAuto:'Auto (current captions)',
  trackAutoNone:'Auto (no captions found yet)',asrSuffix:' · auto-generated',followPageProvider:'Same as page translation',followPageTarget:'Same as page target language',
  modeBilingual:'Original and translation',modeTranslation:'Translation only',orderOriginal:'Original on top',orderTranslation:'Translation on top',
  actionFailed:'Something went wrong. Please retry.',switchingTrack:'Switching subtitles…',saving:'Saving…',switchedTrack:'Subtitles switched',saved:'Saved',
  settingsUnavailable:'Settings are unavailable. Reload the page and try again.',trackUnavailable:'Subtitle languages are unavailable. Reload the page and try again.',
  optionsUnavailable:"Couldn't open extension settings. Open them from the extension icon.",
  listTitle:'Subtitle list',listClose:'Close subtitle list',follow:'Back to current',following:'Following current',reading:'Reading freely',
  loading:'Loading the subtitle timeline…',failed:"Couldn't load the full subtitles for this video.",disabled:'Enable subtitle translation to use this list.',
  nativeDisabled:'Turn on captions in the video to continue.',unavailable:'A complete subtitle timeline is unavailable for this video.',
  error:'Translation unavailable',seek:'Seek to',count:'captions',
};

export function subtitleWords(language?:string|null):SubtitleWords {
  return /^zh/i.test(String(language||'')) ? zh : en;
}
