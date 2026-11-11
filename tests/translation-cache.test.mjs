import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranslationCache,translationCacheKey,TRANSLATION_CACHE_KEY} from '../dist/src/background/translation-cache.js';

const key=index=>index.toString(16).padStart(64,'0');
test('session LRU evicts by count, and a read refreshes recency',async()=>{
  const cache=createTranslationCache();
  for(let index=0;index<5000;index++)cache.set(key(index),'译文');
  assert.equal(cache.get(key(0)),'译文');cache.set(key(5000),'fresh');
  assert.equal(cache.get(key(1)),undefined);assert.equal(cache.get(key(0)),'译文');assert.equal(cache.get(key(5000)),'fresh');
});
test('serialized UTF-8 size stays under the byte cap, including escaping and outer storage object',async()=>{
  let snapshot;
  const cache=createTranslationCache({maxBytes:1000,storage:{get:async()=>({}),set:async value=>{snapshot=value;}}});
  for(let index=0;index<10;index++)cache.set(key(index),'你好\n"'.repeat(20));
  await cache.flush();
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<=1000);assert.ok(snapshot[TRANSLATION_CACHE_KEY].length<10);
  assert.equal(cache.get(key(0)),undefined);assert.equal(cache.get(key(9)),'你好\n"'.repeat(20));
});
test('cache load validates entries, enforces bounds and preserves LRU order',async()=>{
  let stored={[TRANSLATION_CACHE_KEY]:[[key(0),'old'],[key(1),'middle'],['raw-secret','bad'],[key(2),'recent'],[key(3),'']]};
  const cache=createTranslationCache({maxEntries:2,storage:{get:async()=>stored,set:async value=>{stored=value;}}});
  await cache.initialize();assert.equal(cache.get(key(0)),undefined);assert.equal(cache.get(key(1)),'middle');cache.set(key(4),'new');
  assert.equal(cache.get(key(2)),undefined);await cache.flush();assert.deepEqual(stored[TRANSLATION_CACHE_KEY],[[key(1),'middle'],[key(4),'new']]);
});
test('empty results are ignored and identity hashes use unambiguous tuples',async()=>{
  const cache=createTranslationCache();
  for(const text of ['', ' ', '\u200b'])cache.set(key(0),text);
  assert.equal(cache.get(key(0)),undefined);
  const first=await translationCacheKey('private-key','auto','ja','Hello');
  assert.match(first,/^[a-f0-9]{64}$/);assert.equal(first,await translationCacheKey('private-key','auto','ja','Hello'));
  assert.notEqual(first,await translationCacheKey('another-key','auto','ja','Hello'));
  assert.notEqual(await translationCacheKey('a','bc','d','e'),await translationCacheKey('ab','c','d','e'));
});
