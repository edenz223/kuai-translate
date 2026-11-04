# TypeScript Migration Implementation Plan

> **For agentic workers:** Execute the stages below; use parallel agents only for disjoint module groups.

**Goal:** Migrate all extension runtime JavaScript to TypeScript without changing behavior, UI, permissions, message transport or runtime paths.
**Architecture:** Keep native browser ESM and classic injection scripts. Compile TS to the same .js paths with TypeScript; allow JS/TS coexistence during migration.
**Tech Stack:** Node 24, pnpm, TypeScript, @types/chrome, native node:test.
**Spec:** The user's seven migration requirements, captured in docs/typescript-migration.md.

## Global Constraints
- Work in /home/edenz/codes/kuai-translate and follow /home/edenz/WSL_QUICK_REFERENCE.md; pnpm manages dependencies.
- Preserve the complete manifest, public HTML/CSS/images/locales, message strings, sender validation and credential boundaries.
- No runtime framework, bundler, new browser permission or transport.
- Every stage runs type checking, build, artifact checking and all regression tests.
- Strict TS; explicit types at Chrome and messaging boundaries. No ts-nocheck or global API erasure.

## Review Focus
- Classic MAIN-world capture and isolated-world bootstrap must remain scripts without ESM exports.
- Tests must execute compiled artifacts, including VM and CommonJS harnesses.
- Native dynamic import and web_accessible_resources paths must remain valid.
- Source ZIP must include config, TS and pnpm lockfile; runtime ZIP excludes TS and tooling.
- Settings broadcasts and cancellation must preserve sender/document ownership and wire payloads.

### Task 1: Coexistence build and baseline
- [x] Add a mixed JS/TS build regression test; observe failure before implementing support.
- [x] Configure allowJs/checkJs=false with strict TS, Chrome types and ES2022 browser output.
- [x] Compile TS into dist while copying legacy JS unchanged; test against dist.
- [x] Check typecheck/build/check/test and record results.

### Task 2: Shared model, providers and privileged background
- [x] Migrate shared, providers and background modules with Settings, Provider, errors and message request/reply types.
- [x] Preserve authorization, secrets, cancellation, storage and menu behavior.
- [x] Check typecheck/build/check/test and record results.

### Task 3: Content and injection
- [x] Migrate content modules and classic bootstrap; retain existing DOM lifecycle and runtime paths.
- [x] Check typecheck/build/check/test and record results.

### Task 4: UI and YouTube
- [x] Migrate popup/options/text, caption/session/selection/sidebar/capture modules.
- [x] Preserve classic capture scope, all UI and native player/ASR behavior.
- [x] Check typecheck/build/check/test and record results.

### Task 5: Deliverable and review
- [x] Add compile-time message contract tests; verify invalid messages are rejected.
- [x] Run independent review, full verification, source/runtime ZIP checks and complete manifest/permission comparison.
- [x] Document browser loading directory and limits of automated verification.
