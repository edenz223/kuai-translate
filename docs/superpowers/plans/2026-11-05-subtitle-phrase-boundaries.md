# ASR Phrase Boundaries Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, then independent review.

**Goal:** Avoid arbitrary mid-phrase subtitle cuts while keeping long speech bounded.
**Architecture:** Keep capture, deduplication and timing unchanged. Select cuts using
semantic ranks, protected lexical boundaries, soft targets and bounded fallback.
**Tech Stack:** TypeScript, native Intl.Segmenter, Node tests, pnpm, esbuild, Chromium.
**Spec:** ../specs/2026-11-05-subtitle-phrase-boundaries.md

## Global Constraints
120 chars / 8 seconds are soft; 160 chars / 10 seconds are upper bounds except
indivisible words/numbers. WSL development, ZIP before Windows transfer.
No runtime dependency or permission change.

## Review Focus
- Long punctuation-free speech still progresses in bounded time.
- Protected number/word boundaries do not swallow or duplicate characters.
- CJK offsets stay aligned with the original source string.
- Existing punctuation/speaker boundaries and monotonic times remain intact.
- Soft extensions do not become unrestricted oversized cues.

## Task 1: Phrase cuts
- [x] Add failing behavior cases in tests/youtube-captions.test.mjs:
  90-character 10-second sentence remains whole; clause boundary can exceed 120;
  preposition/determiner and fixed phrase protection; CJK words stay whole.
- [x] Run build and focused tests; confirm new failures.
- [x] Modify src/youtube/asr-segmentation.ts: rank semantic cuts before balance,
  add CJK word/fixed English phrase protection, and soft/hard limit fallback.
- [x] Run focused and full pnpm verify; adjust obsolete strict-limit assertions
  to upper bounds while retaining text, timing and numeric integrity checks.

## Task 2: Verify and deliver
- [x] Update CHANGELOG.md, request independent review and address findings.
- [x] Run browser smoke, package and diff check.
- [x] Copy release ZIPs to Windows, extract and verify SHA256.

## Verification record

- New boundary regressions, including a review-found 18-second fixed
  phrase, were observed failing before their fixes; full suite now 821/821.
- Type checking, emitted-runtime validation and git diff --check pass.
- Chromium smoke: ordinary page translation, options, model discovery and
  controlled YouTube-origin startup pass with module fetching blocked.
- 600 seeded long-speech probes preserve source text, positive monotonic timing,
  and 160-character / 10-second upper bounds for divisible inputs.
- Independent review found one P2: fixed expressions could exceed the duration
  cap. Fixed by treating expressions as a cut preference; its regression went
  RED to GREEN and the full suite passed. No other findings.
- This phase uses local heuristics and browser word segmentation, not a grammar
  parser; unusual compound words and genuinely ambiguous clauses remain limited.

## Task 3: Authored playback grouping follow-up

- [x] Confirm live DOM overlay/sidebar belong to different extensions; identify
  authored-track short-cue path.
- [x] Reproduce screenshot phrase and VTT/XML cases with failing tests.
- [x] Extract shared text boundaries and add bounded authored cue grouping.
- [x] Use the grouped timeline for fetched authored and finite native captions.
- [x] Verify exact full overlay text and shared list cues at 259.5/261.5/263.5s.
- [x] Independent review: fix Korean join spacing and preserve VTT voice turns;
  authored/native regressions observed RED then GREEN.
- [x] Full suite 830/830, typecheck/build checks, Chromium smoke, diff check.
- [x] Package ZIPs, copy to Windows, extract and verify SHA256.

Follow-up review found two P2 issues (Korean spaces and VTT voice metadata).
Both were fixed with failing-first parser/native playback tests. No findings were
deferred. Original ASR regression coverage continues to pass. Live browser
inspection was read-only; the user's running extensions were not reloaded or
disabled, so applying the exported build still requires an extension reload.

## Task 4: User-directed SelectTranslate port

- [x] Inspect local SelectTranslate GXe and its normalization pipeline.
- [x] Extract nine pure-function golden examples; observe failing parity tests.
- [x] Share sentence grouping between ASR and authored playback, using native
  sentence boundaries, unfinished-tail buffers and reference 120/12-char rules.
- [x] Remove the superseded duration cap and update conflicting policy assertions;
  retain source text, timing, numeric, speaker/voice and CJK coverage.
- [x] Independent review found compact Latin sentence-boundary rounding and
  cross-source thousands-spacing defects. Both reproduced RED and fixed GREEN.
- [x] Add progressive-window deduplication and its multiline interaction
  regression; ensure replacement and overlap cleanup cannot delete text twice.
- [x] Full pnpm verify 845/845, typecheck/build validation, Chromium smoke,
  including blocked-module YouTube-origin startup, and git diff --check pass.
- [x] Package, copy ZIPs to Windows, extract, verify SHA256.

The nine recorded SelectTranslate text examples all match. Source timestamps are
retained more precisely than the reference's single proportional buffer clock.
No review findings deferred. Tests explicitly retain real pauses and speaker
boundaries, even though the reference's generic buffer is less conservative.
