import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {startOptions} from '../dist/src/ui/options.js';
import {defaultSettings} from '../dist/src/shared/settings.js';
import {createDocument} from './helpers/ui-document.cjs';

function options(t) {
  const h=createDocument(new URL('../public/options.html',import.meta.url));
  let stored=defaultSettings();const requests=[],previous=globalThis.chrome;
  globalThis.chrome={runtime:{sendMessage:async message=>{
    requests.push(message);
    if(message.type==='KUAI_GET_SETTINGS')return {ok:true,value:structuredClone(stored)};
    if(message.type==='KUAI_SAVE_SETTINGS'){stored=structuredClone(message.settings);return {ok:true,value:structuredClone(stored)};}
    assert.fail('Changing presentation must not send '+message.type);
  }}};
  t.after(()=>{globalThis.chrome=previous;});
  return {...h,requests,get stored(){return stored;},start:()=>startOptions(h.document),settle:setImmediate};
}

test('actual settings page saves presentation controls and updates its local preview without translation requests',async t=>{
  const h=options(t);await h.start();
  const size=h.node('page-style-fontSize'),color=h.node('subtitle-style-targetColor');
  assert.ok(size,'page text size must be available in the settings HTML');
  assert.ok(color,'subtitle translation color must be available in the settings HTML');
  size.value='135';await size.fire('input');
  color.value='#ffcc00';await color.fire('input');
  h.node('subtitle-style-displayOrder').value='translation_on_top';await h.node('subtitle-style-displayOrder').fire('change');
  h.node('subtitle-target-language').value='ja';await h.node('subtitle-target-language').fire('change');
  await h.settle();
  assert.equal(h.stored.pageStyle.fontSize,135);
  assert.equal(h.stored.subtitleStyle.targetColor,'#ffcc00');
  assert.equal(h.stored.subtitleStyle.displayOrder,'translation_on_top');
  assert.equal(h.stored.subtitleTargetLanguage,'ja');
  assert.equal(h.node('page-preview-translation').style.fontSize,'135%');
  assert.equal(h.node('subtitle-preview-target').style.color,'#ffcc00');
  assert.equal(h.node('subtitle-preview-target').style.order,'-1');
  assert.ok(h.requests.filter(message=>message.type==='KUAI_SAVE_SETTINGS').every(message=>message.baseSettings));
});

test('presentation renders preserve an active fractional edit and reset only the chosen style group',async t=>{
  const h=options(t);await h.start();
  const lineHeight=h.node('page-style-lineHeight');assert.ok(lineHeight);
  lineHeight.focus();lineHeight.value='1.';await lineHeight.fire('input');await h.settle();
  assert.equal(lineHeight.value,'1.','save completion must not erase an in-progress decimal');
  h.node('subtitle-style-targetFontSize').value='36';await h.node('subtitle-style-targetFontSize').fire('input');
  h.node('page-style-fontSize').value='150';await h.node('page-style-fontSize').fire('input');
  h.node('page-display-mode').value='translation_only';await h.node('page-display-mode').fire('change');
  h.document.activeElement=null;await lineHeight.fire('blur');
  assert.equal(lineHeight.value,'1');
  await h.node('reset-page-style').fire('click');await h.settle();
  assert.equal(h.stored.pageStyle.fontSize,100);assert.equal(h.stored.pageStyle.lineHeight,1.6);
  assert.equal(h.stored.subtitleStyle.targetFontSize,36,'page reset must not reset subtitle styling');
  assert.equal(h.stored.pageDisplayMode,'translation_only','style reset must not change display preference');
  await h.node('reset-subtitle-style').fire('click');await h.settle();
  assert.equal(h.stored.subtitleStyle.targetFontSize,24);
});

test('choosing transparent presentation supplies a visible effect without overwriting a custom opacity',async t=>{
  const h=options(t);await h.start();
  const preset=h.node('page-style-preset'),opacity=h.node('page-style-opacity');
  preset.value='transparent';await preset.fire('change');await h.settle();
  assert.equal(h.stored.pageStyle.opacity,55);assert.equal(h.node('page-preview-translation').style.opacity,'0.55');
  opacity.value='75';await opacity.fire('input');
  preset.value='border';await preset.fire('change');preset.value='transparent';await preset.fire('change');await h.settle();
  assert.equal(h.stored.pageStyle.opacity,75);assert.equal(h.node('page-preview-translation').style.opacity,'0.75');
});

test('preset colors are saved in their controls and subsequent explicit color choices render unchanged',async t=>{
  const h=options(t);await h.start();
  const preset=h.node('page-style-preset'),accent=h.node('page-style-accentColor'),background=h.node('page-style-backgroundColor');
  preset.value='orange-underline';await preset.fire('change');await h.settle();
  assert.equal(h.stored.pageStyle.accentColor,'#f97316');assert.equal(accent.value,'#f97316');
  accent.value='#4285d4';await accent.fire('input');await h.settle();
  assert.equal(h.stored.pageStyle.accentColor,'#4285d4');assert.equal(h.node('page-preview-translation').style.textDecorationColor,'#4285d4');
  preset.value='marker';await preset.fire('change');await h.settle();
  assert.equal(h.stored.pageStyle.backgroundColor,'#fff3a3');assert.equal(background.value,'#fff3a3');
  background.value='#eef5ff';await background.fire('input');await h.settle();
  assert.match(h.node('page-preview-translation').style.background,/#eef5ff/);
});


test('caption background mode is saved, previewed and reset without changing subtitle language',async t=>{
  const h=options(t);await h.start();const mode=h.node('subtitle-style-backgroundMode');assert.ok(mode);
  assert.equal(mode.value,'line');assert.equal(h.node('subtitle-preview-box').style.backgroundColor,'transparent');
  assert.equal(h.node('subtitle-preview-target').style.backgroundColor,'rgba(0, 0, 0, 0.5)');
  mode.value='panel';await mode.fire('change');await h.settle();assert.equal(h.stored.subtitleStyle.backgroundMode,'panel');
  assert.equal(h.node('subtitle-preview-box').style.backgroundColor,'rgba(0, 0, 0, 0.5)');assert.equal(h.node('subtitle-preview-target').style.backgroundColor,'transparent');
  h.node('subtitle-target-language').value='ja';await h.node('subtitle-target-language').fire('change');
  await h.node('reset-subtitle-style').fire('click');await h.settle();assert.equal(mode.value,'line');assert.equal(h.stored.subtitleTargetLanguage,'ja');
});
