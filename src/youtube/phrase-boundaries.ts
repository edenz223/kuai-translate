/** Shared text boundaries for fetched subtitle phrases; no source timing is inferred here. */
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
export function joinCaptionFragments(left:string,right:string) {
  if(!left)return right.trimStart();
  if(!right)return left;
  // Reconnect a printed thousands group across cue windows without collapsing
  // ordinary spoken counts such as 100 / 101 into a different number.
  if(/\b\d{1,3}[,，]$/u.test(left.trimEnd())&&/^\d{3}(?:\D|$)/u.test(right.trimStart()))return left+right.trimStart();
  if(/\s$/.test(left)||/^\s/.test(right)||/^[,.;:!?。！？、，；：)\]”’]/u.test(right)||cjk.test(left.at(-1)!)||cjk.test(right[0]))return left+right;
  return left+' '+right;
}
export function endsCaptionSentence(text:string) {
  const tail=text.trim().replace(/["'”’）)\]]+$/u,'');
  if(/[!?。！？…]$/u.test(tail))return true;
  if(!tail.endsWith('.'))return false;
  const word=tail.split(/\s+/).at(-1)!;
  // Conservative: retain ambiguous abbreviations; a pause/length bound can still end them.
  return !/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$/i.test(word)&&! /^(?:[A-Za-z]\.)+$/.test(word);
}
