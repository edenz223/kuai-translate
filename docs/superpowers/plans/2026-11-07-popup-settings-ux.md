# Popup and Settings UX Plan

**Goal:** Make the toolbar popup the place for everyday choices, and make the options page easier to scan.
**Constraints:** No runtime dependency, no new permission unless a phase says so, settings schema unchanged.
Subtitle controls stay out of the popup (1.3 decision; see `docs/ui-ux-review.md`).

## P1 — Popup redesign (done)
- Header: site host and a page state badge (未翻译 / 翻译中 / 已翻译 / 部分失败 / 本站不翻译 / 不可用).
- Language pair with swap (disabled while source is auto-detect); main toggle button with icon and progress bar.
- Provider select warns when a keyed service has no API key and links to `options.html#providers`.
- Quick switches: bilingual display, hover, selection and input translation.
- 本站 rule: default / auto-translate / never. Edits only the exact host entry (`src/ui/site-rules.ts`);
  broader patterns written in the options page are left alone and explained in a note.
  Removing the only allow-list entry turns auto-translate off rather than widening it to every site.
- Icon navigation: text/file tool, page settings, settings & API.

## P2 — Toolbar state and shortcuts
- Content runtime pushes page status changes; background sets `chrome.action` badge per tab.
- Register manifest `commands` for page toggle and display mode; keep in-page keys as fallback and avoid double firing.
- Context menu: "always / never translate this site".

## P3 — Options page restructure
- Left navigation (tabs on narrow screens): 常规 / 网页 / 划词 / 输入 / 字幕 / 服务 / 外观 / 网站规则 / 备份.
- Site rules as a list editor (add, remove, switch type) on top of the existing `string[]` fields.
- Common fields first, the rest under 高级; per-section reset; live style previews; settings search.
- First-run onboarding card: target language, service, try the shortcut.

## P4 — i18n and polish
- Move popup/options strings to `chrome.i18n` via `data-i18n`.
- Keyboard and dark-mode review; popup screenshot in `scripts/browser-smoke.mjs`.
