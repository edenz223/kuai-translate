import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,normalizeSettings,publicSettings,exportSettings,importSettings} from '../dist/src/shared/settings.js';
import {mergeSettings} from '../dist/src/background/settings-merge.js';
import {fixture} from './helpers/content-dom.cjs';
import {createPageTranslator} from '../dist/src/content/page-translator.js';
import {createInteractions} from '../dist/src/content/interactions.js';
import {applySubtitleTextStyle,applySubtitleBoxStyle} from '../dist/src/shared/styles.js';

const oldVisual={sourceFontSize:20,targetFontSize:24,sourceColor:'#e5e7eb',targetColor:'#ffffff',sourceWeight:400,targetWeight:600,sourceStroke:'none',targetStroke:'normal',fontFamily:'system-ui, sans-serif',backgroundColor:'#080c15',backgroundOpacity:86};
function v140(){
  const value=defaultSettings();value.inputDefaultsVersion=1;delete value.paragraphDefaultsVersion;delete value.subtitleStyleDefaultsVersion;
  value.inputOptions.targetLanguage='zh-Hans';value.hoverOptions.trigger='alt';
  value.subtitleStyle={...value.subtitleStyle,...oldVisual,offset:125,maxWidth:73};delete value.subtitleStyle.backgroundMode;delete value.subtitleStyle.fontSizeMode;
  value.providers.push({id:'private',type:'openai',name:'Private',enabled:true,baseUrl:'https://api.example/v1',apiKey:'fixture-only-secret',model:'custom',region:'',temperature:null});
  return value;
}
const settle=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};

test('default Shift tap toggles a paragraph once on release and leaves Alt available as a non-trigger',async()=>{
  const h=fixture();Object.assign(h.settings,defaultSettings(),{hoverEnabled:true});
  const page=createPageTranslator(h.dependencies),ui=createInteractions({...h.dependencies,page}).start(),p=h.paragraph('A short paragraph');
  try{
    h.emit(p,'mousemove');h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.advance(5000);await settle();assert.equal(h.requests.length,0);
    h.emit(h.doc,'keyup',{key:'Shift'});await settle();assert.equal(p.querySelector('[data-kuai-page-translation]')?.textContent,'译：A short paragraph');
    h.emit(h.doc,'keydown',{key:'Shift',shiftKey:true});h.emit(h.doc,'keyup',{key:'Shift'});await settle();assert.equal(p.querySelector('[data-kuai-page-translation]'),null);assert.equal(h.requests.length,1);
    h.emit(h.doc,'keydown',{key:'Alt',altKey:true});h.emit(h.doc,'keyup',{key:'Alt'});await settle();assert.equal(h.requests.length,1);
  }finally{ui.stop();page.stop();}
});

test('1.4 default corrections preserve entry choices and subtitle layout while upgrading only legacy visual defaults',()=>{
  const old=v140();old.inputOptions.icon='icon';const before=structuredClone(old),value=normalizeSettings(old);
  assert.equal(value.inputOptions.targetLanguage,'en');assert.equal(value.inputOptions.icon,'icon');assert.equal(value.hoverOptions.trigger,'shift');
  assert.equal(value.subtitleStyle.sourceFontSize,24);assert.equal(value.subtitleStyle.targetWeight,400);assert.equal(value.subtitleStyle.targetStroke,'soft');
  assert.equal(value.subtitleStyle.backgroundMode,'panel');assert.equal(value.subtitleStyle.backgroundColor,'#000000');assert.equal(value.subtitleStyle.backgroundOpacity,50);
  assert.equal(value.subtitleStyle.offset,125);assert.equal(value.subtitleStyle.maxWidth,73);assert.equal(value.providers.at(-1).apiKey,'fixture-only-secret');
  assert.deepEqual(old,before);assert.deepEqual(normalizeSettings(value),value);
});

test('explicit language, trigger and custom caption appearance survive the default correction',()=>{
  const old=v140();old.inputOptions.targetLanguage='ja';old.hoverOptions.trigger='ctrl';old.subtitleStyle.targetFontSize=32;
  const value=normalizeSettings(old);
  assert.equal(value.inputOptions.targetLanguage,'ja');assert.equal(value.hoverOptions.trigger,'ctrl');assert.equal(value.subtitleStyle.targetFontSize,32);
  assert.equal(value.subtitleStyle.backgroundMode,'panel');assert.equal(value.subtitleStyle.backgroundOpacity,86);assert.equal(value.subtitleStyle.targetWeight,600);
});

test('choosing prior defaults after upgrade remains intentional through merge and backup round trips',()=>{
  const base=normalizeSettings(v140()),draft=structuredClone(base),current=structuredClone(base);
  draft.inputOptions.targetLanguage='zh-Hans';draft.hoverOptions.trigger='alt';Object.assign(draft.subtitleStyle,oldVisual,{backgroundMode:'panel'});current.selectionOptions.delay=600;
  const saved=mergeSettings(base,draft,current);
  for(const value of [normalizeSettings(saved),publicSettings(saved),importSettings(exportSettings(saved),saved)]){
    assert.equal(value.inputOptions.targetLanguage,'zh-Hans');assert.equal(value.hoverOptions.trigger,'alt');assert.equal(value.subtitleStyle.targetWeight,600);assert.equal(value.subtitleStyle.backgroundMode,'panel');
    assert.equal(value.selectionOptions.delay,600);assert.equal(value.inputDefaultsVersion,2);assert.equal(value.paragraphDefaultsVersion,1);assert.equal(value.subtitleStyleDefaultsVersion,2);
  }
  assert.equal(JSON.stringify(publicSettings(saved)).includes('fixture-only-secret'),false);assert.equal(importSettings(exportSettings(saved),saved).providers.at(-1).apiKey,'fixture-only-secret');
});

test('semantic caption preference and sidebar visibility survive public config, backup and concurrent edits',()=>{
  const base=normalizeSettings(v140()),draft=structuredClone(base),current=structuredClone(base);
  draft.subtitleTrackPreference={languageCode:'en',kind:'asr',name:'English'};draft.subtitleListOpen=true;current.inputOptions.targetLanguage='fr';
  const saved=mergeSettings(base,draft,current);
  for(const value of [normalizeSettings(saved),publicSettings(saved),importSettings(exportSettings(saved),saved)]){
    assert.deepEqual(value.subtitleTrackPreference,{languageCode:'en',kind:'asr',name:'English'});assert.equal(value.subtitleListOpen,true);assert.equal(value.inputOptions.targetLanguage,'fr');
  }
  const malformed=normalizeSettings({subtitleTrackPreference:{languageCode:'https://secret.example',kind:'other',name:'x'},subtitleListOpen:'true'});
  assert.deepEqual(malformed.subtitleTrackPreference,{languageCode:'',kind:'',name:''});assert.equal(malformed.subtitleListOpen,false);
});

test('line and panel subtitle backgrounds switch without stale paint or replacement of selected text',()=>{
  const h=fixture(),box=h.paragraph('','div'),source=h.paragraph('Source'),target=h.paragraph('译文'),text=target.firstChild;
  const line={backgroundMode:'line'};
  applySubtitleBoxStyle(box,line);applySubtitleTextStyle(source,line,'source');applySubtitleTextStyle(target,line,'target');
  assert.equal(box.style['background-color'],'transparent');assert.equal(box.style['box-shadow'],'none');
  for(const node of [source,target]){assert.equal(node.style['font-size'],'24px');assert.equal(node.style.color,'#ffffff');assert.equal(node.style['font-weight'],'400');assert.equal(node.style['text-shadow'],'1px 1px 2px #000');assert.equal(node.style['background-color'],'rgba(0, 0, 0, 0.5)');assert.equal(node.style['line-height'],'1.3');}
  const panel={backgroundMode:'panel',backgroundColor:'#123456',backgroundOpacity:40};
  applySubtitleBoxStyle(box,panel);applySubtitleTextStyle(target,panel);
  assert.equal(box.style['background-color'],'rgba(18, 52, 86, 0.4)');assert.equal(target.style['background-color'],'transparent');assert.equal(target.style.padding,'0');
  applySubtitleBoxStyle(box,line);applySubtitleTextStyle(target,line);assert.equal(box.style['border-radius'],'0');assert.equal(target.style.padding,'0 10px');assert.strictEqual(target.firstChild,text);
});

test('Kiss default migration upgrades only the prior default appearance and keeps custom choices',()=>{
  const old=defaultSettings();old.subtitleStyleDefaultsVersion=1;
  old.subtitleStyle={...old.subtitleStyle,sourceStroke:'none',targetStroke:'none',backgroundMode:'line',sourceFontSize:24,targetFontSize:24};
  delete old.subtitleStyle.fontSizeMode;
  old.subtitleStyle.offset=125;
  const upgraded=normalizeSettings(old);
  assert.equal(upgraded.subtitleStyle.fontSizeMode,'responsive');
  assert.equal(upgraded.subtitleStyle.backgroundMode,'panel');
  assert.equal(upgraded.subtitleStyle.targetStroke,'soft');
  assert.equal(upgraded.subtitleStyle.offset,125);
  assert.deepEqual(normalizeSettings(upgraded),upgraded);
  old.subtitleStyle.targetFontSize=32;
  const custom=normalizeSettings(old);
  assert.equal(custom.subtitleStyle.targetFontSize,32);
  assert.equal(custom.subtitleStyle.fontSizeMode,'fixed');
  assert.equal(custom.subtitleStyle.backgroundMode,'line');
  assert.equal(custom.subtitleStyle.targetStroke,'none');
});
