/** Validated data only. Rendering modules decide how these values become CSS. */
export const PAGE_PRESETS = Object.freeze([
  'border','plain','thin-dashed','dashed','dotted','background','transparent',
  'orange-underline','underline','wavy','marker','highlight','blur','italic','bold','dashed-border',
]);
export const PAGE_STYLE_DEFAULTS = Object.freeze({
  preset:'border',fontSize:100,fontWeight:400,fontFamily:'inherit',textColor:'inherit',
  accentColor:'#4285d4',backgroundColor:'#eef5ff',opacity:100,italic:false,lineHeight:1.6,
});
export const SUBTITLE_STYLE_DEFAULTS = Object.freeze({
  displayMode:'bilingual',displayOrder:'original_on_top',hideTranslation:false,
  fontSizeMode:'responsive',sourceFontSize:24,targetFontSize:24,sourceColor:'#ffffff',targetColor:'#ffffff',
  sourceWeight:400,targetWeight:400,sourceStroke:'soft',targetStroke:'soft',
  fontFamily:'system-ui, sans-serif',backgroundColor:'#000000',backgroundOpacity:50,backgroundMode:'panel',
  position:'bottom-center',offset:70,maxWidth:88,
});

const record = (value: unknown): Record<string, unknown> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const choice = (value: unknown, values: readonly string[], fallback: string): string => values.includes(value as string) ? value as string : fallback;
const boolean = (value: unknown, fallback: boolean) => typeof value==='boolean' ? value : fallback;
function bound(value: unknown, minimum: number, maximum: number, fallback: number) {
  if (typeof value!=='number' && (typeof value!=='string' || !value.trim())) return fallback;
  const number=Number(value);
  return Number.isFinite(number) ? Math.min(maximum,Math.max(minimum,number)) : fallback;
}
function color(value: unknown, fallback: string, inherit=false) {
  if (inherit && value==='inherit') return value;
  return typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
function font(value: unknown, fallback: string) {
  return typeof value==='string' && value.length<=120 && value.trim() && /^[\p{Script=Han}A-Za-z0-9 ,'"_-]+$/u.test(value) ? value.trim() : fallback;
}

export function normalizePageStyle(input?: unknown) {
  const value=record(input), defaults=PAGE_STYLE_DEFAULTS;
  return {
    preset:choice(value.preset,PAGE_PRESETS,defaults.preset),
    fontSize:bound(value.fontSize,50,200,defaults.fontSize),fontWeight:bound(value.fontWeight,100,900,defaults.fontWeight),
    fontFamily:font(value.fontFamily,defaults.fontFamily),textColor:color(value.textColor,defaults.textColor,true),
    accentColor:color(value.accentColor,defaults.accentColor),backgroundColor:color(value.backgroundColor,defaults.backgroundColor),
    opacity:bound(value.opacity,0,100,defaults.opacity),italic:boolean(value.italic,defaults.italic),
    lineHeight:bound(value.lineHeight,1,3,defaults.lineHeight),
  };
}

export function normalizeSubtitleStyle(input?: unknown) {
  const value=record(input), defaults=SUBTITLE_STYLE_DEFAULTS, strokes=['none','soft','light','normal','bold','shadow45'];
  return {
    displayMode:choice(value.displayMode,['bilingual','translation_only'],defaults.displayMode),
    displayOrder:choice(value.displayOrder,['original_on_top','translation_on_top'],defaults.displayOrder),
    hideTranslation:boolean(value.hideTranslation,defaults.hideTranslation),
    fontSizeMode:choice(value.fontSizeMode,['responsive','fixed'],Object.hasOwn(value,'sourceFontSize')||Object.hasOwn(value,'targetFontSize')?'fixed':defaults.fontSizeMode),
    sourceFontSize:bound(value.sourceFontSize,12,72,defaults.sourceFontSize),targetFontSize:bound(value.targetFontSize,12,72,defaults.targetFontSize),
    sourceColor:color(value.sourceColor,defaults.sourceColor),targetColor:color(value.targetColor,defaults.targetColor),
    sourceWeight:bound(value.sourceWeight,100,900,defaults.sourceWeight),targetWeight:bound(value.targetWeight,100,900,defaults.targetWeight),
    sourceStroke:choice(value.sourceStroke,strokes,defaults.sourceStroke),targetStroke:choice(value.targetStroke,strokes,defaults.targetStroke),
    fontFamily:font(value.fontFamily,defaults.fontFamily),backgroundColor:color(value.backgroundColor,defaults.backgroundColor),
    backgroundOpacity:bound(value.backgroundOpacity,0,100,defaults.backgroundOpacity),
    backgroundMode:choice(value.backgroundMode,['line','panel'],defaults.backgroundMode),
    position:choice(value.position,['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right'],defaults.position),
    offset:bound(value.offset,0,300,defaults.offset),maxWidth:bound(value.maxWidth,40,100,defaults.maxWidth),
  };
}

export type PageStyle = ReturnType<typeof normalizePageStyle>;
export type SubtitleStyle = ReturnType<typeof normalizeSubtitleStyle>;
