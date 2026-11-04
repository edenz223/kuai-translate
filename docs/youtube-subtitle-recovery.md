# YouTube subtitle recovery

## Scope

Fix full caption timeline acquisition and initial sidebar placement on YouTube watch pages, including the reported Wv9wTfGidXQ video. Reference behavior: the local Kiss Translate caption bridge/acquisition and default subtitle CSS. No new runtime dependency or extension permission is required.

## Behavior

- Prefer current audio-track caption URLs over initial player response URLs; keep language, kind and named-track identity.
- Replay up to four early page captures when the isolated controller is ready.
- Retry empty bodies and empty JSON events with fresh runtime addresses after one bounded native caption reload.
- Replace an in-flight request when its signed URL changes. Accepting complete native captures cancels pending replays.
- Wait for the initial watch/right-column layout before painting the list. Keep settled single-column, theater and fullscreen drawers.
- Use white captions, a 50% black panel, soft shadow and player-width font scaling. Fixed-size mode remains available.
- Migrate only the previous default visual appearance; retain custom styles and layout preferences.

## Validation

- pnpm verify: 780 tests pass, both TypeScript checks and extension reference checks pass.
- Chromium MV3 smoke: popup, settings save, page translation/restore and options/text pages pass; zero uncaught exceptions.
- Original video failure was observed in the installed extension. The updated extension has not been reloaded in the user's active browser; a live retest of that video remains necessary.
