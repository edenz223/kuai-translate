import test from 'node:test';
import assert from 'node:assert/strict';
let presentation={};
try{presentation=await import('../src/shared/presentation.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}

test('page and subtitle styles have independent safe defaults suitable for visible bilingual output',()=>{
  assert.equal(typeof presentation.normalizePageStyle,'function');
  assert.equal(typeof presentation.normalizeSubtitleStyle,'function');
  const page=presentation.normalizePageStyle(),subtitle=presentation.normalizeSubtitleStyle();
  assert.deepEqual(page,{preset:'border',fontSize:100,fontWeight:400,fontFamily:'inherit',textColor:'inherit',accentColor:'#4285d4',backgroundColor:'#eef5ff',opacity:100,italic:false,lineHeight:1.6});
  assert.deepEqual(subtitle,{displayMode:'bilingual',displayOrder:'original_on_top',hideTranslation:false,sourceFontSize:24,targetFontSize:24,sourceColor:'#ffffff',targetColor:'#ffffff',sourceWeight:400,targetWeight:400,sourceStroke:'none',targetStroke:'none',fontFamily:'system-ui, sans-serif',backgroundColor:'#000000',backgroundOpacity:50,backgroundMode:'line',position:'bottom-center',offset:70,maxWidth:88});
  page.opacity=0;subtitle.targetFontSize=70;
  assert.equal(presentation.normalizePageStyle().opacity,100);
  assert.equal(presentation.normalizeSubtitleStyle().targetFontSize,24);
});

test('numeric styles are bounded without losing valid fractional or zero choices',()=>{
  assert.equal(typeof presentation.normalizePageStyle,'function');
  const page=presentation.normalizePageStyle({fontSize:999,fontWeight:5,opacity:0,lineHeight:2.25});
  assert.equal(page.fontSize,200);assert.equal(page.fontWeight,100);assert.equal(page.opacity,0);assert.equal(page.lineHeight,2.25);
  const subtitle=presentation.normalizeSubtitleStyle({sourceFontSize:1,targetFontSize:999,sourceWeight:999,targetWeight:0,backgroundOpacity:999,offset:-1,maxWidth:5});
  assert.equal(subtitle.sourceFontSize,12);assert.equal(subtitle.targetFontSize,72);
  assert.equal(subtitle.sourceWeight,900);assert.equal(subtitle.targetWeight,100);
  assert.equal(subtitle.backgroundOpacity,100);assert.equal(subtitle.offset,0);assert.equal(subtitle.maxWidth,40);
});

test('style normalization rejects executable CSS fragments and unknown fields while accepting named Chinese fonts',()=>{
  assert.equal(typeof presentation.normalizePageStyle,'function');
  for(const fontFamily of ['Arial; background:red','url(https://example.com/x)','font:serif','a'.repeat(121),'Arial\nserif']){
    assert.equal(presentation.normalizePageStyle({fontFamily}).fontFamily,'inherit');
    assert.equal(presentation.normalizeSubtitleStyle({fontFamily}).fontFamily,'system-ui, sans-serif');
  }
  const fontFamily='"思源黑体", Noto Sans, sans-serif';
  assert.equal(presentation.normalizePageStyle({fontFamily}).fontFamily,fontFamily);
  const page=presentation.normalizePageStyle({textColor:'url(x)',accentColor:'red',backgroundColor:'#ABCDEF',cssText:'position:fixed',preset:'untrusted'});
  assert.equal(page.textColor,'inherit');assert.equal(page.accentColor,'#4285d4');assert.equal(page.backgroundColor,'#abcdef');
  assert.equal(page.preset,'border');assert.equal(Object.hasOwn(page,'cssText'),false);
});

test('supported style presets, caption order and study masking survive normalization',()=>{
  assert.equal(typeof presentation.normalizePageStyle,'function');
  for(const preset of ['border','plain','thin-dashed','dashed','dotted','background','transparent','orange-underline','underline','wavy','marker','highlight','blur','italic','bold','dashed-border']){
    assert.ok(presentation.PAGE_PRESETS.includes(preset));assert.equal(presentation.normalizePageStyle({preset}).preset,preset);
  }
  const value=presentation.normalizeSubtitleStyle({displayMode:'translation_only',displayOrder:'translation_on_top',hideTranslation:true,sourceStroke:'shadow45',position:'top-right'});
  assert.equal(value.displayMode,'translation_only');assert.equal(value.displayOrder,'translation_on_top');assert.equal(value.hideTranslation,true);
  assert.equal(value.sourceStroke,'shadow45');assert.equal(value.position,'top-right');
});
