# Options · Input Translation UX Plan

**Goal:** Make the 输入翻译 section of `options.html` explain itself: what happens when I press the key or click the dot, what gets written back, and how to undo it.
**Constraints:** No runtime dependency, no new permission, `inputOptions` schema unchanged (`src/shared/interactions.ts`).
Builds on the P3 options restructure (`2026-11-07-popup-settings-ux.md`); can ship before it.

## Current problems
- `restoreShortcut` (default `Control+Shift+Z`) is live in `src/content/interactions.ts:329` but has no field.
  It duplicates `Alt+X`, which already restores when the box still holds the unedited translation (line 331),
  and it shadows redo in editors during that window.
- Fields are ordered provider → icon → source → target → shortcut; the language pair is split across rows.
- `#input-apply-help` is one long paragraph mixing dot/icon behaviour, auto-apply, preview and safety rules.
- `includeOriginal` + `displayOrder` are two controls for one question: what text ends up in the box.
- Label `输出语言（默认英文）` hardcodes the default; free-text shortcut fields only validate after typing.
- Disabling input translation for one site means typing its host into a textarea; the popup 本站 rule only covers page translation.

## I1 — Layout and copy (done)
- Order: 启用 → 语言对（原文 → 输出, with swap like the popup） → 服务 → 触发方式 → 写回 → 网站.
- Group into three fieldsets: **怎么触发**（快捷键、入口样式）/ **写回什么**（自动写回、写回内容）/ **在哪里不用**.
- Split `#input-apply-help` into one short hint per control; move the safety note
  （密码、验证码、支付卡字段不处理；内容变化后停止写回）to a single muted line at the end.
- Label `输出语言`; show the default only via the reset button.
- `follow_page` options read `跟随网页翻译（当前：中文）` so the effective value is visible.

## I2 — Write-back as one choice (done)
- Replace the `includeOriginal` checkbox + `displayOrder` select with one select 写回内容:
  仅译文 / 原文 + 译文 / 译文 + 原文. Maps onto the existing two fields in `interaction-options.ts`
  (new field kind, render reads both, commit writes both in one `editor.update`).
- `autoApply` off → copy reads 先预览，确认后再写回; the 写回内容 select stays enabled for both modes.

## I3 — Shortcuts (default and migration done; recorder and warnings pending)
- One key translates and restores. `restoreShortcut` default becomes `''` (off); no options field is added.
- Migration: `inputDefaultsVersion` 2 → 3; a stored `Control+Shift+Z` is cleared, any other value is kept
  (same pattern as the existing input-default migrations in `src/shared/settings.ts`). The field stays in the
  schema so old backups and legacy imports still load.
- The conflict check in `interaction-options.ts` keeps comparing against `restoreShortcut` only when it is non-empty.
- Copy: 输入翻译 / 再次按下恢复原文, with one hint 译文未再编辑时，再按一次恢复原文.
- Recorder button next to each shortcut input: focus → press combo → normalized value via `normalizeShortcut`;
  Escape cancels, Backspace clears. Text entry stays for keyboard/IME users.
- Warn (not block) on combos browsers or editors commonly own: `Control+Z/Y/Shift+Z`, `Control+W/T/N`, `Meta+Q`.

## I4 — Live preview
- Small static mock input under 触发方式 showing the chosen entry（无 / 小圆点 / 翻译图标）and its states
  （待机 → 展开 → 翻译中 → ✓）, reusing the shadow-DOM styles from `src/content/input-feedback.ts`
  (extract the style string to `src/shared/styles.ts`).
- Under 写回内容, a two-line sample (`你好` → `Hello`) rendered in the chosen order. No network call.

## I5 — Context menu 本站禁用输入翻译 (done)
- New checkbox item `kuai.site.input` — `Kuai translate · 本站禁用输入翻译` — in `src/background/controller.ts`,
  contexts `['page','editable']`, `documentUrlPatterns: WEB_PAGES`. Shown only when `contextMenuEnabled`
  and `inputOptions.enabled`; it joins `menuSignature()` so the menu rebuilds when either changes.
- Helpers in `src/shared/site-rules.ts`, next to `applySiteRule`:
  `inputSiteDisabled(settings,url)` uses `isSiteListed(url, inputOptions.disabledSites)`;
  `setInputSiteDisabled(settings,url,disabled)` adds or removes only the exact host entry, with the same 100-item limit error.
- Click handling goes through the existing `onSiteMenu` path: background edits settings, never messages the page.
  Content scripts already re-read settings, so the dot disappears and `Alt+X` stops on that site immediately.
- Checked state: Chrome has no `contextMenus.onShown`, so refresh `checked` with `contextMenus.update`
  on tab activation (new `tabs.onActivated` listener), top-frame `webNavigation.onCommitted` (already tracked
  for the badge) and settings change. No new permission: `<all_urls>` host access already exposes `tab.url`.
- Broader pattern (e.g. `*.example.com`) blocks the site: item shows checked; unchecking cannot remove that pattern,
  so it opens `options.html#input` instead of silently doing nothing.
- Options page: disabled sites move to the P3 list editor when it lands; the hint mentions the right-click item.

## I6 — Section summary
- Section header shows a summary chip: `Alt+X · 小圆点 · 自动写回 → English`, so the collapsed panel still tells the story.

## Tests
- Unit (`tests/ui-*.test.js`, `tests/content-input-options.test.js`): 写回内容 mapping both directions; `inputDefaultsVersion` 3 migration (default cleared, custom kept); recorder normalization;
  `setInputSiteDisabled` add/remove/limit and broader-pattern detection.
- `tests/background.test.js`: menu item visibility follows `inputOptions.enabled`, click toggles the host, checked state refreshes on tab switch.
- `scripts/browser-smoke.mjs`: options page loads, toggling 启用 hides the panel, changing 写回内容 persists both fields.
- Manual: right-click in an input → 本站禁用输入翻译 → dot gone, `Alt+X` passes through to the page; IME composition in the recorder, dark mode, 360px width.
