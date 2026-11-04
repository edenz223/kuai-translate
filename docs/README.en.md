# Kuai translate

[简体中文](../README.md) · [Development guide](development.md) · [Contributing](../CONTRIBUTING.md) · [Privacy](../PRIVACY.md)

Kuai translate is an independently implemented browser extension for bilingual web pages, selected text, user-configured translation APIs, and YouTube captions with an adjacent subtitle list. Microsoft, Google, Tencent Transmart and Yandex web translation adapters are available without entering an API key. You can also use only your own API services.

The project uses **TypeScript, native ESM, HTML, CSS and Manifest V3**. Building, testing and packaging require **Node.js 24 or later, pnpm and TypeScript**. Chrome/Node declarations are development dependencies. The browser runtime has **no third-party dependencies** and needs no framework, bundler or application server. The extension has no account system, subscriptions, promotions, telemetry or uninstall landing page.

This is a new source project with its own extension identity. It does not include the earlier product's compiled bundles or claim to reconstruct that product's full original source and feature set. See [provenance](provenance.md).

## Features and scope

| Feature | Behavior |
| --- | --- |
| Bilingual / translation-only pages | Keep both texts and corresponding clickable translated links by default; hide a paragraph's original only after its translation succeeds, with the original retained on failure |
| Webpage presentation | 16 presets plus typography, colors, opacity and line height; in-page and popup settings entries; styling does not repeat translation requests |
| Webpage triggers and scope | Manual or opt-in automatic translation with site/source-language rules, optional dynamic content, exclusions and shortcuts |
| Selection translation | Deselect to dismiss, or pin with the pin icon and move the card; independent service/languages, trigger options, local word speech and site exclusions |
| Input translation | English output and an inset dot by default; guarded direct application without an automatic result card, compact recovery actions and optional preview |
| Paragraph shortcut | Shares webpage output and requests; point at a paragraph and press Shift once to translate, then again to remove it; requests continue after key release |
| YouTube captions and settings | Separate subtitle service and target language, display mode/order and typography; settings do not depend on a successful caption download |
| YouTube subtitle list | Independent compact bilingual rows, original above translation; timestamps, current-cue highlighting and an explicit return to current after manual reading |
| Subtitle study mask | Blur existing translations and reveal them on hover or keyboard focus, independently of display mode |
| Subtitle text selection | Hold the current caption and pause playback while selecting; resume only playback paused by this extension for that selection |
| Custom APIs | Multiple named instances, API model discovery and selection (with manual entry), connection checks and local settings |
| Text and files | Separate page for pasted text and TXT, MD, SRT and VTT files, with visible original/translated text and downloads |
| Settings backup | API keys excluded by default; optional secret export and import of recognized legacy free/direct API, presentation and interaction settings |

**This release does not include OCR, PDF layout translation, ebooks, meeting transcription or integrations for other video sites.** Multi-model scoring, mobile gestures and context-summary translation are also outside its scope. The browser's PDF viewer is not a supported document translation workflow.

Page translation starts manually by default and processes loaded, readable text. Automatic translation and continued translation of dynamic content are separate opt-in settings. Bilingual mode keeps originals visible; translation-only mode retains their nodes for restoration. Browser-internal pages, extension stores and other protected pages block injection; shortcuts and site rules cannot override those browser restrictions.

For AI services, enter your API address (or leave it blank for the default) and key, click “获取模型” (Fetch models), then select a model to save it. OpenAI-compatible APIs, Gemini, Anthropic Claude and Ollama are supported. Manual model entry remains available if discovery fails or returns no models. Ollama lists models installed on the server and permits an empty key for local services.

## Installation

The target is a Chromium browser with Manifest V3 support, such as Chrome or Edge. This release does not provide a Firefox-specific manifest or a Firefox compatibility guarantee.

### Build from source

Download or clone the source, enter the directory containing `package.json`, and use Node.js 24 or later:

```bash
node --version
pnpm test
pnpm build
pnpm check
```

Run `pnpm install --frozen-lockfile` first to install TypeScript and Chrome/Node declarations. `pnpm verify` runs strict type checks, builds the extension, executes regression tests against `dist/`, and checks resources. Browser runtime has no third-party dependencies.

Open `chrome://extensions` or `edge://extensions`, enable developer mode, choose **Load unpacked**, and select the generated **`dist/`** directory. Refresh pages that were already open.

After editing the source, run `pnpm build`, reload the extension on its management page, and refresh the target web page. Do not edit generated files in `dist/`; the next build replaces them.

### Install a packaged ZIP

If a maintainer provides `kuai-translate-1.0.0.zip`, extract it to a persistent folder and load the folder that directly contains `manifest.json` using **Load unpacked**. Node.js is not needed for this installation path.

The `-source.zip` archive contains source and must be built first. A ZIP is not a signed store or CRX installation package.

### Update an existing installation

Keep **the same unpacked directory and existing extension entry** to retain its local extension identity and settings. You may first export a backup. Extract the new installation ZIP over the files in the directory you previously loaded, or rebuild the same `dist/` at the same source-project path. Then click **Reload** for the existing Kuai translate entry and refresh your web and YouTube tabs.

Do not uninstall the existing extension or load a different version-named directory for each update. A different directory may create a different extension ID and separate storage, requiring a manual settings import. A default backup without API keys cannot restore keys into a new instance: enter them again, or explicitly create a private backup that includes them.

## Webpage, selection and input settings

Settings have sections for webpage, selection, input, YouTube and translation services. Paragraph shortcuts live inside webpage settings. Webpage defaults are Microsoft, automatic source-language detection and Simplified Chinese as the target. Selection and input each have **independent service, source-language and target-language choices**. Selection follows webpage defaults; input follows its service and source language but defaults to English output. Paragraph shortcuts share the webpage service, languages, display mode and styles. YouTube retains its separate service and target-language controls.

### Defaults and triggers

| Area | Initial behavior | Available adjustments |
| --- | --- | --- |
| Webpage | **Alt+Z** translates / restores; automatic and dynamic translation off; all readable regions including footers; minimum 1 character; context menus on | Site/source-language rules, CSS exclusions, minimum 1–200 characters, translation and display-mode shortcuts |
| Selection | Disabled by default; once enabled, automatic after **250 ms**; up to **5000** characters; source shown in the card; speech off | Automatic, icon, dot, Shift / Alt / Control / Meta; click or hover activation for icon/dot, click by default; 0–2000 ms delay and 1.0.000-character limit |
| Input | Enabled; **Alt+X** translates; **Ctrl+Shift+Z** restores; direct application without an automatic result card; English target; click the inset dot to reveal a translation icon, then click that icon to translate; original omitted | Dot/icon or hidden entry, explicit preview before Apply, include original, order and both shortcuts |
| Paragraph shortcut | **Enabled** initially; point at a paragraph, press **Shift** once to translate and again to remove its translation | Shares page output and requests; configurable keys and paragraph/area scope; optional timed pointer triggers remain available |

Selection modifier modes allow selecting first and pressing the key afterward. An icon or dot sends nothing until activated: click runs immediately, while hover uses the configured delay. Optional word speech uses an available **local browser voice** for one selected source word. If no suitable voice exists, speech is skipped without a remote-voice fallback.

Action shortcuts require **one or more modifiers plus one A–Z letter**, such as `Control+Shift+K`. Aliases include `Ctrl`, `Cmd` / `Command`, and `Opt` / `Option`; an empty value disables the shortcut. The webpage display-mode shortcut starts empty. Once configured, it switches existing results between bilingual and translation-only; if there are no results, that shortcut starts translation. Page shortcuts operate outside editors; input shortcuts require an eligible editor. Composition and repeated keydown events are ignored. Browser or operating-system shortcuts may take priority.

Custom paragraph shortcuts use **one or two distinct keys** from Control, Alt, Shift, Meta / Cmd and A–Z, such as `K`, `Control+K` or `A+B`. Press and release the combination once to toggle the paragraph. Holding it or moving the pointer does not repeatedly trigger translation. Complete action chords do not also trigger a paragraph action; if Alt is explicitly selected, Alt+Z and Alt+X do not trigger bare Alt. Editable fields, composition and text selection keep their own interaction priority.

### Shared paragraph and full-page translations

Enable paragraph shortcuts from the popup or **Webpage → Paragraph shortcuts**. Point at a paragraph and press **Shift** once. The request continues after release. Press it again to remove that paragraph, including a pending request; a late result cannot bring it back. **Alt+Z** and the popup's main button toggle the full page. The button reflects actual page state as Translate or Restore.

Both routes use the same entries and renderer. A full-page pass reuses completed and pending paragraph work. Removing one paragraph does not cancel another paragraph, and Restore removes all page output. An error-row retry retries that row only. Both routes share bilingual/translation-only mode and webpage styling.

Old popup-hover preferences migrate to inline webpage output while retaining enablement, scope, site exceptions and custom keys. The former Kuai default Alt trigger upgrades once to Shift in 1.5. Selection translation retains its separate popup. Escape dismisses an uncommitted gesture or selection/input card; use the paragraph shortcut or Restore to remove page translations.

Optional direct hover and left-button hold remain timed pointer triggers. They ensure a paragraph is translated without toggling an existing result off. Dragging a text selection does not trigger left hold. Area mode handles readable paragraphs under the same page exclusions.

### Selection-card dismissal and pinning

An unpinned card closes when its source selection is cleared, canceling only its own pending requests. A late result cannot reopen it. Selecting/copying translated text or using the card controls remains possible.

Press **the pin icon** to pin the current viewport position. The card stays after deselection and later selections reuse that location. Drag the header or focus it and use arrow keys to move it; resizing keeps it within the viewport. Unpinning with no usable source selection closes the card, and Close always works.

The position lasts only for this card session on this page. Route/provider/feature invalidation still clears obsolete work. Input operations have separate ownership and do not remove a pinned selection result.

### Applying and restoring input translations

Input defaults to **English**, independently of the webpage target. A small dot sits inside the focused field with room before the right edge; it shrinks for small fields and follows scroll/resize. Click the dot to reveal the translation icon, then click that icon (or press Alt+X) to translate and write directly, without automatically opening a result card.

Selected input text is translated; otherwise the whole input is used. The default dot mode has no text feedback popup. The expanded translation icon stays visible, gains a green check after application, and restores the original on the next click. While loading it cancels; after an error it retries. Explicitly turn automatic application off to preview before choosing Apply. Including the original joins original and translation with a newline in the chosen order.

**Ctrl+Shift+Z restores only the latest successful replacement made by this extension.** The field feedback restore action and pressing Alt+X again can restore that same unchanged replacement. This is a single-step record, not an editor-wide undo history. Changes to content, focus, composition, selection or editor state prevent stale restoration. Without a valid record, the restore shortcut does not intercept the browser's normal action.

Password, readonly/disabled and explicitly marked one-time-code/payment-card fields are excluded. Simple rich-text changes preserve existing nodes where safe. **Selections spanning complex rich-text structures retain a copy action, with a preview only when that mode was explicitly selected**; rejected or stale applications leave the input untouched. Automatic replacement is not guaranteed in every web editor.

### Site, source-language and exclusion rules

Automatic webpage translation is off by default. Once enabled, empty site and source-language allow lists admit otherwise eligible pages. If either list has entries, matching **either the site or source language** can start translation. A page recognized as already in the target language does not start automatically. A manual stop or restore prevents immediate automatic restart on the same route.

Never-site and never-language rules take priority and also constrain **manual webpage and hover translation**. Language comes from page declarations or browser-local detection. An unknown language cannot satisfy a language allow rule and cannot reliably be excluded by a language deny list. Selection and input have independent disabled-site lists; hover has an additional list on top of webpage rules. Configure each relevant section to disable all of those features on a site.

Enter one item per line. Site/language lists allow up to 100 entries, selector lists up to 50, with at most 2000 characters per line.

| Example | Meaning |
| --- | --- |
| `example.com` or `*.example.com` | The domain and its subdomains, any path; excludes unrelated names such as `notexample.com` |
| `https://example.com/news/*` | HTTPS only; `*` does not cross a `/` in the path |
| `https://example.com/news/**` | HTTPS only; `**` can cross path segments |
| `en`, `ja`, `zh-Hans` | Source-language codes, one per line; `en` also matches `en-US` |
| `.advertisement`, `[data-private]` | CSS exclusions, one per line, applied to webpage and hover text |

Site patterns support optional HTTP/HTTPS schemes and ports; omitting the scheme allows both. Patterns containing paths match the complete path, query and fragment and are not regular expressions. If an exclusion matches a nested part of a paragraph, the whole containing paragraph is conservatively skipped so the excluded text is not sent. Turning full-page translation off additionally skips footers; it does not perform intelligent article extraction. Editors, code and extension controls are always excluded.

Dynamic translation is also off by default. When enabled, it handles newly loaded or changed text only after webpage translation has started. With it off, translate again to process new content. The webpage context-menu switch hides all Kuai menu entries; disabling selection or input hides its corresponding entry.

Each interaction section can restore its own defaults without deleting service instances or resetting unrelated presentation/subtitle settings. Automatic webpage translation, dynamic translation, automatic selection and direct hover can send text under their configured rules without a confirmation for each request; see [Privacy](../PRIVACY.md).

## Webpage display and presentation

The popup's webpage style entry opens the relevant settings section. Once page translation has started, its in-page toolbar also offers a translation-style button.

- **Bilingual** keeps the original and appends a translated paragraph.
- **Translation only** hides source text only after that paragraph has a valid result. Loading, failed and cancelled paragraphs retain their original. Restore reuses original nodes, preserving handlers and subsequent site edits. If the site removes an extension translation, the corresponding original is revealed instead of leaving a blank paragraph.
- The **16 presets** are a left border, plain, thin dashed underline, dashed underline, dotted underline, background, transparent, orange underline, solid underline, wavy underline, marker, highlight, study blur, italic, bold and dashed border.
- Adjust font-size percentage, weight, family, text/accent/background colors, opacity, italics and line height. Study blur reveals on hover or keyboard focus.

The preview uses local sample text. Presentation changes apply to existing results **without making another translation request**. Resetting webpage styles keeps the selected service, languages and display mode.

### Links in translated text

Bilingual and translation-only output retain corresponding native links, including relative URLs, fragments, HTTP(S), mail and telephone links. Identical labels can still lead to distinct original destinations. The original page nodes and their handlers remain available for restoration.

Link addresses and metadata stay local instead of being added to translation requests. Changes to destinations, opening attributes or the document base update existing translated links without retranslating. Replacing a link or changing text structure invalidates its mapping; opt-in dynamic translation can process the new structure. Script URLs do not become executable links, and arbitrary scripted controls are not cloned.

For compatibility with the current text-only providers, linked paragraphs are translated as ordered text/link runs and reconstructed using original node ownership. This preserves definite destinations but can reduce sentence context near links. Paragraphs without links retain whole-paragraph translation.

## Translation services

### Built-in services without an API key

Microsoft is selected by default. Google, Tencent Transmart and Yandex are also included.

These adapters use third-party **web interfaces on a best-effort basis**. Availability depends on the provider, network access, rate limits and interface changes. There is no promise of permanent availability or unlimited usage. They are separate from the providers' official cloud APIs that require your own credentials. If a service fails, choose another service or configure your own API and retry.

### Custom API instances

Open settings, choose a service type under the translation services section, and add an instance. Each instance has its own name and configuration; multiple instances of the same type are supported.

| Type | Main configuration |
| --- | --- |
| OpenAI-compatible API | API key, full model name and an optional compatible API endpoint |
| Google Gemini | API key, full model name and an optional endpoint |
| Anthropic Claude | API key, full model name and an optional endpoint |
| Azure Translator | API key, endpoint and region as required by your Azure service |
| DeepL API | API key and the correct endpoint for your account |
| DeepLX / self-hosted endpoint | Your own service URL; a key if required by your deployment |
| Ollama | A reachable local/self-hosted service and an available model name; key optional |

An empty endpoint uses the type's default, except DeepLX, which requires your service URL. Ollama defaults to `http://localhost:11434`. Model names are entered manually; there is no fixed model catalog. **Temperature is optional**: leaving it empty omits the parameter so the service can use its default.

The connection test sends a short real translation request to that draft instance. After checking it, select the instance in the relevant webpage, selection or input section. YouTube's service and target language can each be selected independently or follow the webpage choices. Disabling an instance keeps its configuration.

Settings save automatically. If another window changes the same field, the current draft is retained and a conflict is shown. Copy any edits you need to keep before choosing the reload action, which explicitly discards unsaved changes. A successful connection check validates that particular request, not every future request or model capability.

The configuration and text-tool pages currently use Chinese interface labels.

## YouTube

1. Open a YouTube video. Once its player is identified, the extension provides **译**, **⚙ settings** and **☷ list** controls at the left of the native right-side control group. Native controls retain their order, with fullscreen at the far right. Settings and the list no longer wait for a successful caption download or translation. The extension popup offers the same settings entry and a button to open the list.
2. Enable caption translation and YouTube's **CC** when translating. With captions disabled, missing or failing to load, the list shows its state and settings remain accessible.
3. The **⚙** panel provides the source caption track, service, subtitle target language, bilingual/translation-only mode, original-first/translation-first order and a study mask. Its full-settings button opens typography and positioning controls.
4. Click timestamps to seek. Manual scrolling switches to free reading; **Back to current** resumes following without pulling you away during reading. Previous/next cue buttons and **Ctrl+Alt+← / Ctrl+Alt+→** navigate an available timeline while preserving whether playback is running or paused. Buttons are disabled at timeline limits or when seeking is unavailable; text inputs are excluded from shortcut handling.
5. Selecting text in the overlay or list holds the caption, pauses a playing video and pauses further subtitle translation scheduling. Clearing the selection resumes only a pause owned by the extension for that selection; prior user pauses, manual controls, seeking and video changes invalidate old resume permission.

The translation toggle, source-track preference, list visibility, service, target language, display mode/order, mask and position are saved and restored after refresh. Track preferences store language, manual/automatic kind and name. If a new video lacks a match, an available track is used without deleting the saved preference. Choose “自动（跟随当前字幕）” to return to automatic track selection. Playback time, selection, list scroll and temporary settings-panel visibility are not persisted. Failed saves show an error and restore saved values.

The default overlay uses **24 px white regular text for both languages, no outline, and 50% black backgrounds behind individual lines**. The outer rounded card is removed in this mode; “背景形式” can switch back to a full panel. These are base styles, not a promise of pixel-equivalent sizing across different players.

Original and translated captions have **independent size, color, weight and outline/shadow** controls. Shared options include font family, background color/opacity, six positions, edge offset and maximum width. Video typography, box styling, display mode and order apply only to the overlay. The list has independent compact reading typography and theme colors, always showing original text above translation. The explicit study mask remains shared and reveals on hover or focus. Presentation-only edits do not re-request translations.

The overlay and sidebar reflow captions to the available width instead of forcing line breaks carried by the caption source. Narrow containers still wrap, and maximum-width and positioning settings still apply. Authored hard breaks also reflow; there is no separate option to preserve them. Caption text data is not rewritten, but the browser's clipboard line-break formatting should be checked in the copied result.

Changing the effective subtitle service or target language uses that new translation configuration. A fixed subtitle target stays unchanged when the webpage target changes. Blank caption background shows a grab cursor and supports vertical dragging with automatic offset saving. Text remains selectable. Source-track controls are in settings rather than a permanent strip under the captions. The full settings page also supports a numeric offset.

This requires captions supplied by the video and a compatible YouTube page structure. It does not perform speech recognition. If only the currently displayed caption can be read, the list is limited and indicates that state; a full transcript is not guaranteed. For errors, check CC and the caption language, then retry.

### Automatic-caption boundaries

Identified automatic JSON3 tracks are regrouped locally before the shared video/list/seek timeline. A **120-character target** estimates a balanced number of groups. Clause punctuation is preferred, then source-event boundaries, then ordinary spaces; a 12-character minimum preference avoids tiny tails. The existing approximately 8-second duration and 0.8-second pause guides remain, using word timing when available and keeping indivisible words/numbers intact.

The reported screenshot sentence now prefers a break after `After reading about this online and troubleshooting it a few times,`, with `I realized…` in the following cue. A fixed-text regression covers this example; its synthetic timing is not measured from the original video. Deduplication still requires timestamp or overlapping-window evidence. Authored manual cues keep their original segmentation.

No extra model request or invented punctuation is involved. Sparse timing limits precision; this is not a claim of human-edited sentence accuracy. Other formats and native fallbacks continue to use their available data.

## Text and files

Open the text/file tool from the extension popup or settings page. Paste text or choose a `.txt`, `.md`, `.srt` or `.vtt` file up to **2 MB**. Selecting a file reads it locally; text is sent to the selected translation service when you start translation.

The original remains on the left and the translation appears on the right. Cancel, copy and download controls are provided. Long text is split into bounded requests and reconstructed without silently dropping the remainder. SRT/VTT timing information is preserved. Markdown fenced code, front matter and basic paragraph prefixes are preserved, but complex inline Markdown, HTML and rich formatting require review after translation.

## Migration and privacy

Version 1.5 upgrades recognizable old Kuai defaults once: the 1.4 Simplified Chinese input target becomes English while retaining the entry choice; the earlier follow-webpage/hidden-entry pair becomes English/dot. The former Alt paragraph default becomes Shift without enabling the feature. Other target languages and nondefault keys remain unchanged. Older versions did not record whether an unchanged default was chosen explicitly, so such values also upgrade; choosing Chinese or Alt again after upgrading is then remembered.

Only an unchanged old group of caption visual defaults upgrades to the new line backgrounds; layout position and width remain. Customized visual values keep their panel appearance, with a subtitle-style reset available to adopt the new defaults. These migrations do not change providers or API keys.

This independent extension **does not automatically read the earlier product extension's storage**. Export a readable JSON backup and import it in Kuai translate settings. The current version retains recognized free/direct API, webpage/current-theme and subtitle presentation/target-language migration, and adds recognized site/language rules, independent selection/input services and languages, trigger fields, hover keys/scope and input shortcuts. Explicit automatic rules in an old backup may enable automatic translation; review those switches after import.

Custom values for unselected legacy themes are not converted. Old font-size categories become pixels and subtitle opacity becomes a percentage. Multi-model lists, automatic model scoring, mobile gestures and context-summary fields do not become supported features.

Migration reads supported data without executing old scripts or arbitrary CSS. Invalid or unsupported values may receive defaults, be bounded or be skipped. Platform accounts, membership services, login credentials and shared paid services are excluded. Updating Kuai translate 1.0 / 1.1 / 1.2.x / 1.3 / 1.4 in the same directory preserves settings and supplies this project's defaults for missing fields; the 1.0 original-text switch maps to subtitle display mode. Review services, models, languages, triggers and presentation after importing.

API keys are stored in extension local storage. Background requests go directly to the selected provider; there is no Kuai translate account or relay server. Backups exclude API keys by default. Including keys is an explicit export option. Do not commit personal backups, credentials or private source text to GitHub.

See [PRIVACY.md](../PRIVACY.md) for permissions and data handling, and [SECURITY.md](../SECURITY.md) for vulnerability reporting.

## Development and packaging

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run automated tests with Node's built-in test runner |
| `pnpm build` | Compile TypeScript and copy static assets into loadable `dist/` |
| `pnpm check` | Check an existing build's resources, module references and JavaScript syntax |
| `pnpm package` | Rebuild, check and write installation/source archives and SHA-256 hashes |

For version 1.0.0, output is written to `release/`:

```text
kuai-translate-1.0.0.zip
kuai-translate-1.0.0-source.zip
SHA256SUMS
```

Source archives use an explicit allowlist. Installation archives contain only `dist/` contents, including the project's MIT license in `LICENSE.txt`. ZIP ordering and metadata are fixed for repeatability with the same files and runtime. GitHub Actions runs tests and packaging, then uploads artifacts; **it does not create releases or publish to an extension store**. See the [development guide](development.md).

### Share in your GitHub repository

Create an empty repository in your own GitHub account. Replace the placeholder remote below with its actual address. For a source ZIP without Git history:

```bash
git init -b main
git add .
git commit -m "Initial Kuai translate source"
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

If the directory is already a Git repository, keep its history and check `git remote -v` before configuring your remote. Review staged files for personal backups and secrets before committing. You may manually create a GitHub Release and upload the generated ZIPs and `SHA256SUMS`.

## Validation status

Automated tests use controlled DOM, browser messaging and HTTP boundaries for adapters, settings, visible translation output, shared paragraph/page rendering and targeted cancellation, subtitle text/styles, selection/list behavior and packaging. **This delivery has not completed browser pixel-layout, YouTube or live-API end-to-end validation.** Passing tests do not establish actual caption line counts or compatibility with every page layout, network region or third-party endpoint.

See the [release verification record](verification.md) for recorded checks and independent rebuild results.

Report problems in the repository you use with browser version, reproduction steps, provider type and redacted error text. Reload the extension and refresh a normal page if its controls do not respond. Do not publish API keys, credential-bearing URLs or private text in issues.

## License

This independent implementation is available under the [MIT License](../LICENSE). Third-party services retain their own terms and interface limits. See the [changelog](../CHANGELOG.md).
