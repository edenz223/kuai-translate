import {sendPageAction} from '../../src/ui/popup.js';
import {request, translate, updatePreferences, openOptions} from '../../src/shared/client.js';
import type {BackgroundRequest, MessageResponse, TranslationResult, PageRequest} from '../../src/shared/messages.js';
import type {Settings} from '../../src/shared/settings.js';

const translated: Promise<TranslationResult> = request('KUAI_TRANSLATE',{requestId:'typed',texts:['Hello']});
const settings: Promise<Settings> = request('KUAI_GET_SETTINGS',{includeSecrets:false});
const cancelled: Promise<{cancelled:boolean}> = request('KUAI_CANCEL',{requestId:'typed'});
translate(['Hello'],{signal:new AbortController().signal,targetLanguage:'zh-Hans'});
updatePreferences({subtitleStyle:{targetFontSize:24},subtitleListOpen:true});
openOptions('subtitles');
const page:PageRequest={type:'KUAI_PAGE_STATUS'};
const wire:BackgroundRequest={type:'KUAI_CANCEL',requestId:'typed'};
function consume(response:MessageResponse<TranslationResult>) {
  if(response.ok) return response.value.translations;
  return response.error.code;
}
void [translated,settings,cancelled,page,wire,consume];

// @ts-expect-error Unknown wire message names are rejected.
request('KUAI_UNKNOWN',{});
// @ts-expect-error Cancellation requires an owned request ID.
request('KUAI_CANCEL',{});
// @ts-expect-error Translation input paragraphs are strings.
request('KUAI_TRANSLATE',{requestId:'typed',texts:[42]});
// @ts-expect-error Public preferences never accept provider credentials.
updatePreferences({providers:[{apiKey:'secret'}]});
// @ts-expect-error Settings sections are finite wire values.
openOptions('unknown');
// @ts-expect-error AbortSignal belongs to local options, not the wire payload.
request('KUAI_TRANSLATE',{requestId:'typed',texts:['Hello'],signal:new AbortController().signal});
// @ts-expect-error Request IDs on the wire are strings.
const badWire:BackgroundRequest={type:'KUAI_CANCEL',requestId:42};
void badWire;

// @ts-expect-error Popup page actions use the finite page message vocabulary.
sendPageAction('KUAI_PAGE_STTAUS');
