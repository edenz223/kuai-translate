import test from 'node:test';
import assert from 'node:assert/strict';
import dom from './helpers/content-dom.cjs';
let api={};try{api=await import('../src/shared/styles.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function setup(name){assert.equal(typeof api[name],'function');const h=dom.fixture();return {h,node:h.paragraph('Readable translation')};}

test('page presentation changes existing translated text without replacing its text node',()=>{
  const {node}=setup('applyPageStyle'),text=node.firstChild;
  api.applyPageStyle(node,{preset:'background',textColor:'#102030',fontSize:130,fontWeight:700,backgroundColor:'#ddeeff'});
  assert.equal(node.style.color,'#102030');assert.equal(node.style['font-size'],'130%');assert.equal(node.style['background-color'],'#ddeeff');
  api.applyPageStyle(node,{preset:'plain'});
  assert.equal(node.style['background-color'],'transparent');assert.equal(node.style['border-left'],'0');assert.strictEqual(node.firstChild,text);
});
test('page study blur reveals on pointer or keyboard focus and restores its mask afterwards',()=>{
  const {h,node}=setup('applyPageStyle');api.applyPageStyle(node,{preset:'blur'});
  assert.equal(node.style.filter,'blur(4px)');assert.equal(node.getAttribute('tabindex'),'0');
  h.emit(node,'mouseenter');assert.equal(node.style.filter,'none');h.emit(node,'mouseleave');assert.equal(node.style.filter,'blur(4px)');
  h.emit(node,'focus');assert.equal(node.style.filter,'none');h.emit(node,'blur');assert.equal(node.style.filter,'blur(4px)');
  api.applyPageStyle(node,{preset:'plain'});assert.equal(node.style.filter,'none');assert.equal(node.getAttribute('tabindex'),null);
});
test('underline, border and marker presets use the selected accent without leaked prior decoration',()=>{
  const {node}=setup('applyPageStyle');
  api.applyPageStyle(node,{preset:'wavy',accentColor:'#123456'});assert.equal(node.style['text-decoration-style'],'wavy');assert.equal(node.style['text-decoration-color'],'#123456');
  api.applyPageStyle(node,{preset:'dashed-border',accentColor:'#654321'});assert.equal(node.style.border,'1px dashed #654321');assert.equal(node.style['border-left'],'1px dashed #654321');assert.equal(node.style['text-decoration-line'],'none');
  api.applyPageStyle(node,{preset:'marker'});assert.match(node.style.background,/linear-gradient/);assert.equal(node.style.border,'0');
});
test('explicit text opacity survives a transparent preset without a second multiplier',()=>{
  const {node}=setup('applyPageStyle');api.applyPageStyle(node,{preset:'transparent',opacity:25});assert.equal(node.style.opacity,'0.25');
});
test('explicit colors remain authoritative even when equal to the generic defaults',()=>{
  const {node}=setup('applyPageStyle');api.applyPageStyle(node,{preset:'orange-underline',accentColor:'#4285d4'});assert.equal(node.style['text-decoration-color'],'#4285d4');
  api.applyPageStyle(node,{preset:'highlight',backgroundColor:'#eef5ff'});assert.equal(node.style['background-color'],'#eef5ff');
});
test('source and translated subtitle styles have independent font, weight, color and stroke',()=>{
  const {node}=setup('applySubtitleTextStyle'),text=node.firstChild;
  const style={sourceFontSize:18,targetFontSize:32,sourceWeight:300,targetWeight:800,sourceColor:'#112233',targetColor:'#ffeedd',sourceStroke:'none',targetStroke:'shadow45'};
  api.applySubtitleTextStyle(node,style,'source');assert.equal(node.style['font-size'],'18px');assert.equal(node.style['text-shadow'],'none');
  api.applySubtitleTextStyle(node,style,'target');assert.equal(node.style['font-size'],'32px');assert.equal(node.style['font-weight'],'800');assert.equal(node.style.color,'#ffeedd');assert.match(node.style['text-shadow'],/2px 2px/);assert.strictEqual(node.firstChild,text);
});
test('subtitle background and six-position changes remove stale positioning',()=>{
  const {node}=setup('applySubtitleBoxStyle');api.applySubtitleBoxStyle(node,{backgroundMode:'panel',backgroundColor:'#102030',backgroundOpacity:25});assert.equal(node.style['background-color'],'rgba(16, 32, 48, 0.25)');
  assert.equal(typeof api.applySubtitlePositionStyle,'function');
  api.applySubtitlePositionStyle(node,{position:'top-right',offset:24,maxWidth:72});assert.equal(node.style.top,'24px');assert.equal(node.style.right,'3%');assert.equal(node.style.left,'auto');assert.equal(node.style.bottom,'auto');
  api.applySubtitlePositionStyle(node,{position:'bottom-center',offset:80});assert.equal(node.style.bottom,'80px');assert.equal(node.style.top,'auto');assert.equal(node.style.left,'50%');assert.equal(node.style.right,'auto');assert.equal(node.style.transform,'translateX(-50%)');
});
test('subtitle reflow keeps all six positions and configured width caps without disabling narrow-player wrapping',()=>{
  const {node}=setup('applySubtitleTextStyle');node.textContent='A short\nsentence 中文字幕 https://example.com/averylongunbrokenpath';
  const text=node.firstChild;
  for(const [position,top,bottom,left,right,transform,align]of [
    ['top-left','24px','auto','3%','auto','none','left'],
    ['top-center','24px','auto','50%','auto','translateX(-50%)','center'],
    ['top-right','24px','auto','auto','3%','none','right'],
    ['bottom-left','auto','24px','3%','auto','none','left'],
    ['bottom-center','auto','24px','50%','auto','translateX(-50%)','center'],
    ['bottom-right','auto','24px','auto','3%','none','right'],
  ])for(const maxWidth of [40,88,100]){
    api.applySubtitlePositionStyle(node,{position,offset:24,maxWidth});
    assert.deepEqual([node.style.top,node.style.bottom,node.style.left,node.style.right,node.style.transform,node.style['text-align']],[top,bottom,left,right,transform,align]);
    assert.equal(node.style['max-width'],maxWidth+'%');
    for(const kind of ['source','target']){
      api.applySubtitleTextStyle(node,{},kind);
      assert.equal(node.style['white-space'],'normal');assert.equal(node.style['overflow-wrap'],'anywhere');
      assert.strictEqual(node.firstChild,text);
    }
  }
});
