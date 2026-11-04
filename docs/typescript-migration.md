# TypeScript migration

## Requirements
Migrate the entire native browser extension progressively to TypeScript. Preserve all existing functionality, UI, manifest permissions and message behavior. No React/Vue or other runtime framework. Analyze manifest, background, content scripts, popup and dependencies first. Configure JS/TS coexistence, add Chrome API and message types, verify every stage, and deliver a loadable directory with before/after permissions.

## Baseline
- Commit: 2b2c128b90dbdbd390c7810c951fefb3dec38715; clean main checkout; migration branch migrate/typescript.
- 43 src JavaScript files, 5,633 lines plus public/content-loader.js.
- Node 24.21.0, pnpm 12.6.0, no runtime dependencies.
- node --test: 757 passed, zero failed.
- Manifest V3, minimum Chrome 120, native module service worker src/background/index.js.
- Background owns providers, credential storage and message validation. Shared client sends runtime messages with {type,...payload} and receives {ok,value}/{ok:false,error}.
- Isolated content-loader.js dynamically imports src/content/index.js. Shared/content/YouTube modules are web accessible.
- MAIN-world src/youtube/capture-main.js runs at document_start in YouTube frames; it must remain a classic script.
- Popup, options and text HTML load native ESM from src/ui; common settings/presentation modules connect UI, content and YouTube.
- Dependencies: UI/content call shared client; background calls providers and shared normalization; content lazily starts YouTube; no framework.

## Approach
Use TypeScript itself as the only compiler. Keep relative .js import specifiers so emitted files and manifest paths stay unchanged. allowJs supports modules being migrated separately. Type checking covers strict TS, official Chrome API declarations and wire contracts. Existing JS test harnesses execute dist files. Build scripts/tests remain native Node tooling.

## Permission baseline
permissions: storage, activeTab, contextMenus, webNavigation.
host_permissions: <all_urls>.
optional_permissions and optional_host_permissions: absent.
CSP: script-src 'self'; object-src 'none'.
The whole public/manifest.json is preserved byte-for-byte.

## Stage evidence
Baseline: node --test: 757/757 passed.

Stage 1: strict typecheck/build/check and 758/758 regression tests passed.
Stage 2: migrated shared/providers/background with original content/UI/YouTube in isolated baseline snapshot: strict typecheck/build/check and 758/758 passed.

Stage 3: all 44 runtime scripts migrated, with content/UI/YouTube completed concurrently. pnpm verify: both strict TS configurations passed, 764/764 regression tests passed, dist validation passed (57 files, 44 scripts, 51 references). AST comparison matches every original runtime module. Manifest and all 11 static UI/localization/image assets are byte-identical.

## Final verification and review
- pnpm verify: strict runtime and active compile-only message tests passed; 766/766 Node tests passed; 57 files / 44 scripts / 51 references passed resource and syntax checking.
- Independent review found and verified fixes for inherited exclusion of contract tests and Windows compiler path normalization. Regression tests failed before fixes and passed afterward.
- Runtime structure comparison includes literal/operator/declaration differences. All 44 emitted scripts match the pinned original commit.
- Popup page actions now use PageActionType and discriminated MessageResponse; compile-only typo rejection is tested.
- Browser smoke passed in Chrome for Testing 156.0.8078.4: actual MV3 worker, popup initialization, privileged settings save, local HTTP provider request, content translation/restore, options (107 controls), text tool (11 controls), zero uncaught exceptions.
- Tests use a temporary browser profile and local translation fixture; they do not change user settings or require API keys.
- Live YouTube playback and real external translation services were not manually tested in this migration. Existing YouTube, ASR, selection, sidebar and provider regression suites passed.

## Manifest permission comparison
| Field | Before | After |
| --- | --- | --- |
| permissions | storage, activeTab, contextMenus, webNavigation | identical |
| host_permissions | <all_urls> | identical |
| optional_permissions | absent | absent |
| optional_host_permissions | absent | absent |
| CSP | script-src 'self'; object-src 'none' | identical |
| Injection worlds / frames / matches | Original manifest | identical |
The complete source and emitted manifest are byte-identical to tests/fixtures/manifest.before-typescript.json.

## Load and maintain
- Load unpacked directory: /home/edenz/codes/kuai-translate/dist (manifest.json is at its root).
- Installable archive: release/kuai-translate-1.0.0.zip; extract and load its root directory.
- Maintainable source: release/kuai-translate-1.0.0-source.zip; integrity list: release/SHA256SUMS.
- pnpm install --frozen-lockfile; pnpm verify; pnpm package.
- Optional browser regression: set CHROMIUM_PATH to a Chromium executable and run pnpm smoke after building.
- Source extension code is TS; Node build/test tooling stays JS. No runtime framework or third-party runtime dependency was added.
- Strict checking remains enabled. Limited explicit any is confined to heterogeneous historic/remote data validation and generic event adaptation. Content and UI have no any or suppression directives.
- allowJs/checkJs=false support future mixed modules; build regression covers JS/TS coexistence and type-only exclusion.

TypeScript reference: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html

Final artifact validation uses the installable ZIP file list and an offline restore of the source ZIP followed by pnpm verify.
