# Options · 翻译服务 UX Plan

**Goal:** Make the 翻译服务 section easy to scan (what is configured, what is in use, what is broken)
and make adding, configuring, testing and removing a custom API a short, safe path.
**Scope:** `#providers` in `public/options.html`, its logic in `src/ui/options.ts`, helpers in
`src/ui/common.ts` / `src/ui/state.ts`, styles in `public/ui.css`.
**Constraints:** No runtime dependency, no new permission, settings schema unchanged (`Provider` keeps its fields;
usage and test results are derived or session-only). Autosave stays. Fits P3 of
`2026-11-07-popup-settings-ux.md`; this plan is the 服务 part in detail.

## Current problems

| Area | Now | Effect |
| --- | --- | --- |
| List | 4 free services and every custom instance in one flat list; only `· 已停用` as status | Cannot tell which service pages, subtitles, selection or input use, or which one is missing a key |
| Add | Type `<select>` plus `＋ 添加实例` under a list up to 520px tall; new name is `openai API` | Add control is easy to miss; the default name is the raw type id; no hint about which type needs what |
| Form | All fields stacked; the model list is hidden, then the button, then the text input, inside a half-width grid cell | Model step reads out of order; temperature is shown to everyone; required fields are not marked |
| Validation | Any input saves at once; a bad URL or empty key shows up only on test or first translation | Errors surface on the web page instead of here |
| Test | One line of text: `连接成功：…` or the raw error message | No latency; no hint whether the key, the address or the network is wrong |
| Delete | `删除此实例` removes at once, no confirm, no undo | One click loses a key; selection/input silently fall back to another service |
| Disable | Unchecking `在服务选择器中启用` on the active service lets normalization pick another one silently | Web translation changes service without telling the user |
| Free services | Read-only name, enable checkbox, one notice | Most of the panel is empty |
| Narrow screens | List becomes a 2-column grid 230px tall above the form | Selection and form are far apart; long names wrap badly |

## S1 — List and add flow (done)
- Group `#provider-list` into **免费服务** and **自配 API** (group headings stay outside the button rows, or the tests
  that use `children[n]` move to querying by `data-provider-id`).
- Each row: name, type, and chips computed from settings:
  `网页` (activeProviderId), `字幕` (subtitleProviderId), `划词` / `输入` (interaction providerId),
  `已停用`, `缺少 Key` (keyed type without apiKey; same rule as the popup warning, shared from `common.ts`),
  last test result `✓ / !` (session-only map keyed by provider fingerprint, cleared when the provider changes).
- Use `aria-current="true"` instead of `aria-pressed` for the selected row; Up/Down move between rows.
- Replace the type select with a `＋ 添加自配服务` button at the top of the 自配 API group. It opens an inline
  type picker: one card per type with a one-line description and needs (`需要 API Key` / `自建地址` / `本地运行`).
- New instance name comes from `TYPE_NAMES` with a number when needed (`OpenAI 兼容 API 2`);
  after adding, select it and focus API 地址 (or API Key when the type has a fixed default address).
- Empty 自配 API group shows a short card: what custom APIs add (AI translation, own quota) plus the add button.

## S2 — Detail panel (done)
- Header: name (editable for custom), type, an enable switch, and `设为网页默认` (hidden when already default,
  disabled when the service is disabled). Show where the service is used, e.g. `用于：网页、划词`.
- Fields in groups, shown per type from one table in `common.ts` (replaces the inline `machine` / placeholder maps):
  - **连接**: API 地址 (placeholder = default, `必填` only for DeepLX), API Key with show/hide (`aria-pressed`),
    Azure 区域. Per-type key help, with a link to the provider's key page where one exists.
  - **模型** (AI types): model text input with `获取模型` next to it on one row; the fetched list renders as a
    select under the input. Status line stays under the row.
  - **高级** (`<details>`, closed by default): 温度.
- Inline validation after a field is left (or on 测试连接): URL must parse as http(s); keyed type without key;
  DeepLX without address; AI type without model. Messages sit under the field with `aria-describedby`.
  Settings normalization rejects an unparsable address, so such an address stays an unsaved draft
  (`未保存：…`, counted in the save bar) instead of failing the save and reverting on blur.
  Ollama's `OLLAMA_ORIGINS` requirement is in its key help rather than a URL check.
- Free services: replace the empty form with a short card: no key needed, limits set by the service,
  enable switch, `设为网页默认`, `测试连接`.

## S3 — Test feedback (done)
- `测试连接` moves into the panel header row so it stays visible (primary button). Result block under it:
  success with latency and the sample translation, or failure with a cause and next step mapped from the error code
  (`HTTP_401/403` → check key; `HTTP_404` → check address or model; `HTTP_429` → rate limit;
  `NETWORK_ERROR` / `TIMEOUT` → address reachable? local service running?; `INVALID_CONFIG` → name the field).
  Unknown codes fall back to the current message.
- Store the result in the S1 session map so the list chip matches. The existing invalidation on select or edit stays.

## S4 — Safe destructive actions
- Delete asks for confirmation inline (the button turns into `确认删除` / `取消`, focus moves to `取消`).
  The prompt lists where the service is used and what each place falls back to.
- After deleting, show `已删除「名称」 · 撤销` in the panel status for ~8s; undo restores the previous settings
  snapshot through `editor.replace` if nothing else changed in between.
- Disabling a service that is in use asks for confirmation the same way and names the fallback.
- Selection moves to the neighbouring row after a delete, not back to the first row.

## S5 — Layout, keyboard, theme
- ≤760px: the list becomes a full-width select above the panel (switcher plus add button); the panel follows directly.
- Wide screens: list column sticky inside the card so it stays visible next to a long form.
- Check focus order, visible focus, contrast of the chips and status colours in both themes.
- Nav label and heading use the same text (`翻译服务`).

## Tests
- `tests/ui-async.test.js`: update row lookup; add cases for usage chips, missing-key chip, add flow naming and
  focus, delete confirm plus undo, disable-in-use confirm, error-code mapping, per-type field visibility.
- `scripts/browser-smoke.mjs` uses `#provider-type`, `#add-provider`, `#provider-kind`, `#provider-baseUrl`,
  `#provider-apiKey`, `#fetch-models`, `#provider-model-list`, `#provider-model`: keep these IDs, or update the
  smoke script in the same change.
- `pnpm run verify` and `pnpm run smoke` before each phase lands.

## Order
S1 → S2 → S3 → S4 → S5; each phase is one PR. S1 and S3 share the session test map, so S1 adds it.

## Open questions
- Allow drag/arrow reordering of custom instances? Array order already persists, so no schema change, but the
  popup and selectors would follow the new order.
- Copy an instance (same type and address, new key)? Useful for several OpenAI-compatible gateways.
