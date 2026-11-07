import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runtimeStructure} from '../scripts/runtime-structure.mjs';
const baseline=JSON.parse(await fs.readFile(new URL('./fixtures/runtime.before-typescript.json',import.meta.url),'utf8'));
const root=new URL('../',import.meta.url);

test('migration preserves the complete manifest and every permission except the release version',async()=>{
  const before=await fs.readFile(new URL('./fixtures/manifest.before-typescript.json',import.meta.url),'utf8');
  const {version}=JSON.parse(await fs.readFile(new URL('package.json',root),'utf8'));
  const expected=Buffer.from(before.replace(/("version": )"[^"]+"/,'$1'+JSON.stringify(version)));
  // Keyboard commands need no permission; every other manifest byte stays as migrated.
  const withoutCommands=async name=>{
    const text=await fs.readFile(new URL(name,root),'utf8');
    assert.deepEqual(Object.keys(JSON.parse(text).commands),['toggle-page','toggle-display-mode']);
    return Buffer.from(text.replace(/  "commands": \{[\s\S]*?\n  \},\n/,''));
  };
  assert.deepEqual(await withoutCommands('public/manifest.json'),expected);
  assert.deepEqual(await withoutCommands('dist/manifest.json'),expected);
});

test('unchanged public assets preserve their migration baseline',async()=>{
  for(const [name,hash] of Object.entries(baseline.assets)) {
    const emitted=await fs.readFile(new URL('dist/'+name.slice('public/'.length),root));
    if(['public/options.html','public/popup.html','public/ui.css','public/_locales/en/messages.json','public/_locales/zh_CN/messages.json'].includes(name)){
      // The subtitle font scaling control is covered by the presentation UI tests.
      // Options and popup changes are covered by the interaction and popup UI tests.
      // The redesigned popup styles are checked by the browser smoke screenshot.
      // Locale additions name the keyboard commands registered in the manifest.
      assert.deepEqual(emitted,await fs.readFile(new URL(name,root)));continue;
    }
    assert.equal(createHash('sha256').update(emitted).digest('hex'),hash,name);
  }
});

test('unchanged runtimes preserve their original executable structure',async()=>{
  // These modules now intentionally evolve beyond the migration-only baseline.
  // Dedicated caption capture, runtime, overlay, sidebar and style tests cover them.
  // Model discovery is covered by provider-models, background and ui-async tests.
  // Link color preservation is covered by content-page-links and the browser smoke.
  // Numeric-only page filtering is covered by page-options tests.
  // Bootstrap is now bundled; lifecycle behavior is covered by content-loader and browser smoke tests.
  // Semantic ASR cuts are covered by youtube-captions behavior tests.
  // Authored playback grouping is covered by captions and runtime overlay tests.
  // Popup cleanup and input controls are covered by ui-popup and ui-interaction-options tests.
  // Toolbar badge reporting and page commands are covered by content-badge and background tests.
  // The input restore default is covered by input-defaults and content-input-options tests.
  const evolved=new Set(['src/ui/popup.js','src/content/index.js','src/content/page-translator.js','src/content/page-triggers.js','src/shared/client.js','src/ui/interaction-options.js','src/youtube/captions.js','src/youtube/asr-segmentation.js','public/content-loader.js','src/content/page-policy.js','src/content/page-content.js','src/background/controller.js','src/providers/index.js','src/ui/options.js','src/content/interactions.js','src/content/dom.js','src/content/page-translator.js','src/youtube/index.js','src/youtube/capture-main.js','src/youtube/sidebar.js','src/youtube/presentation.js','src/youtube/overlay.js','src/shared/presentation.js','src/shared/settings.js','src/shared/styles.js','src/ui/presentation.js','src/shared/interactions.js']);
  for(const [name,hash] of Object.entries(baseline.runtime)) {
    if(evolved.has(name))continue;
    const target=name==='public/content-loader.js'?'content-loader.js':name;
    assert.equal(runtimeStructure(await fs.readFile(new URL('dist/'+target,root),'utf8')),hash,name);
  }
});

test('classic injections contain no ESM imports or exports after compilation',async()=>{
  for(const name of ['content-loader.js','src/youtube/capture-main.js']) {
    const source=await fs.readFile(new URL('dist/'+name,root),'utf8');
    assert.doesNotMatch(source,/^\s*(?:import|export)\s/m,name);
  }
});
