# 开发与维护

本文说明 Kuai translate 的源码布局、运行边界、测试和交付流程。用户安装与功能范围见 [README](../README.md)，来源与许可见 [provenance.md](provenance.md)。

## 环境与常用命令

使用 Node.js 24 或更高版本及 pnpm 12.6.0。先执行 `pnpm install --frozen-lockfile` 安装 TypeScript 和 Chrome/Node 类型；扩展运行时仍无第三方依赖，不需要本地 Web 服务器或 bundler。`package.json` 的 `private: true` 用来防止误发到 npm，不影响在 GitHub 公开源码。

```bash
pnpm test
pnpm build
pnpm check
pnpm package
```

| 命令 | 输入与输出 |
| --- | --- |
| `pnpm typecheck` | 严格检查运行时代码和编译期消息契约 |
| `pnpm verify` | 依次类型检查、构建、运行测试和检查产物 |
| `pnpm test` | 先构建，再针对 `dist/` 运行仓库测试；不依赖在线翻译服务或个人密钥 |
| `pnpm build` | 清空并重新生成 `dist/`；`src/` 保留为 `dist/src/`，`public/` 内容放到 `dist/` 根目录，根 `LICENSE` 复制为 `dist/LICENSE.txt` |
| `pnpm check` | 检查已有 `dist/`；因此单独执行前需要先构建 |
| `pnpm package` | 内部依次重新构建、检查并写入 `release/`；不会自动运行测试 |

维护时执行 `pnpm verify` 后再执行 `pnpm package`。所有路径以项目根目录为基准。

## 源码布局

| 路径 | 责任 |
| --- | --- |
| `src/background/index.ts` | MV3 service worker 入口，同步注册事件监听 |
| `src/background/controller.ts` | 受信任发送方检查、配置读写、翻译任务、取消和上下文菜单 |
| `src/background/settings-merge.ts` | 配置保存的三向合并与并发冲突保护 |
| `src/background/preferences.ts` | 内容页面可修改的公共字幕偏好白名单 |
| `src/providers/` | 各服务请求/响应适配、HTTP 边界和可公开错误 |
| `src/shared/settings.ts` | 配置 schema、规范化、默认值、公共配置及导入/导出 |
| `src/shared/interactions.ts` | 四组交互默认值、快捷键/网址规则规范化与匹配、功能独立服务/语言解析 |
| `src/shared/presentation.ts` | 网页与字幕样式的默认值、预设 ID 和数据规范化 |
| `src/shared/styles.ts` | 页面、字幕层及设置预览共用的固定 CSS 属性应用函数 |
| `src/shared/client.ts` | 扩展消息客户端与请求取消 |
| `src/content/` | 网页段落翻译、划词/输入/悬停交互及内容入口 |
| `src/content/page-policy.ts` / `page-triggers.ts` | 网页范围与语言/网址过滤、自动和动态调度、快捷键与停止归属 |
| `src/content/input-editor.ts` / `shortcuts.ts` | 可编辑区域快照、单步安全恢复、精确动作快捷键与按住键跟踪 |
| `src/content/input-feedback.ts` | 输入圆点、轻量状态与操作、显式预览，以及独立于划词卡片的显示生命周期 |
| `src/content/page-content.ts` | 原文文本/链接分段、对应关系、纯文本批次索引与本地安全链接重建 |
| `src/content/page-translator.ts` | 段落与整页共用的译文注册表、渲染、逐段取消与重试、样式更新 |
| `src/content/originals.ts` | 仅译文模式下隐藏成功段落原文，以及保留节点的原位恢复 |
| `src/youtube/` | 页面字幕捕获、字幕解析、播放会话、字幕层、侧栏和选择暂停控制 |
| `src/youtube/asr-segmentation.ts` | 明确自动生成的 JSON3 字幕本地分组、保守重复整理和时间边界 |
| `src/youtube/preferences.ts` / `navigation.ts` | 播放器快捷设置与有效时间轴内的前后句导航 |
| `src/ui/` | 弹窗、设置页、文本工具及可测试状态逻辑 |
| `src/ui/presentation.ts` | 设置表单、样式恢复默认与本地预览接线 |
| `src/ui/interaction-options.ts` | 四组交互表单、条件控件、草稿校验与分区恢复默认 |
| `public/` | manifest、静态 HTML/CSS、内容加载器、图标和语言资源 |
| `tests/` | 实际模块的行为测试与可控浏览器/DOM/HTTP 边界 |
| `scripts/` | 构建、资源检查与确定性 ZIP 打包 |
| `.github/workflows/ci.yml` | 测试、打包和 artifact 上传 |
| `dist/` | 生成的可加载扩展，不作为手工编辑源文件 |
| `release/` | 生成的安装包、源码包及校验清单 |

ESM 模块在构建中不被压缩或重写。后台和扩展页面原生加载模块；经典内容加载器从扩展 URL 导入内容入口。YouTube 的页面环境捕获脚本只处理字幕元数据/文本，与持有 API Key 的后台分离。

## 配置与消息合同

持久化使用 `chrome.storage.local` 中的 `kuai.settings.v1`。默认有 Microsoft、Google、Transmart、Yandex 四个内置条目，初始网页服务为 Microsoft，字幕服务为 `follow_page`。

1.5 保留该存储 key 和 schemaVersion。原有 Kuai translate 配置通过规范化补齐缺失字段，不要求清空存储。浏览器中的未打包扩展身份还取决于加载目录；本地升级应覆盖相同目录，在原有扩展条目重新加载并刷新网页。换目录加载出的另一个扩展实例需要手动导入配置，不能靠相同应用名称继承设置。

自配服务条目包含：

```js
{
  id, name, type, enabled,
  baseUrl, apiKey, model, region, temperature
}
```

`temperature: null` 表示未指定；适配器不发送温度参数。模型名由用户手动填写。规范化允许保存尚未填写完整的编辑中配置，实际测试或翻译时再校验所需模型、密钥与地址。

`publicSettings()` 移除 `apiKey`、`baseUrl`、`region`，只把所需服务元数据和偏好发送给内容脚本。不要将完整私有设置广播到页面。`providerRevision` 由后台维护，用于使服务配置更改后的旧译文/任务失效；客户端不能自行覆盖它。

消息响应格式统一为：

```js
{ ok: true, value }
{ ok: false, error: { code, message } }
```

`src/shared/client.ts` 的 `request()` 解包成功值，失败时抛出带 `code` 的 `Error`。

| 消息 | 主要合同 |
| --- | --- |
| `KUAI_GET_SETTINGS` | 默认公共设置；完整设置要求 `includeSecrets: true` 且发送方为扩展页面 |
| `KUAI_SAVE_SETTINGS` | 扩展页面发送 `{ settings, baseSettings }`，后台串行合并并返回完整保存结果 |
| `KUAI_TRANSLATE` | 发送 `requestId`、`texts`、语言和 `providerId`；返回 `{ translations, providerId }` |
| `KUAI_TEST_PROVIDER` | 扩展页面可以测试尚未保存的单个服务草稿 |
| `KUAI_CANCEL` | 取消属于该发送方文档的 `requestId` |
| `KUAI_UPDATE_PREFERENCES` | `{ patch }` 修改白名单内的公共字幕偏好，返回公共设置；不能修改 Key、地址、provider 列表或网页配置 |
| `KUAI_UPDATE_PAGE_PREFERENCES` | 仅 `{ type, patch: { pageDisplayMode: 'bilingual' \| 'translation_only' } }`，拒绝任何额外消息/patch 字段，返回公共设置 |
| `KUAI_OPEN_OPTIONS` | `{ section: 'webpage' \| 'selection' \| 'input' \| 'hover' \| 'subtitles' }` 打开固定设置分区，返回 `{ opened: true, section }`；不接受任意 URL |
| `KUAI_SETTINGS_CHANGED` | 后台通知内容脚本，载荷仅含公共设置 |

内容脚本只传服务 ID，不传任意服务 URL 或 Key。后台校验扩展身份和发送方范围；取消也受文档范围约束。单个翻译请求目前最多 64 条文本、每条 5000 字符、合计 50000 字符，整个服务请求有 30 秒超时。文本工具使用更小的片段和批次，调用方不可依靠静默截断来满足限制。

### 并发编辑

设置页面和 popup 可能同时打开。`createSettingsEditor()` 把写入串行化，为每笔编辑提供相邻本地草稿的 `baseSettings`。后台在其保存队列中比较 base、draft、当前存储：

- 只应用相对于 base 真正改变的字段，保留其他窗口改动的字段。
- `pageStyle`、`subtitleStyle` 及四组 `pageOptions` / `selectionOptions` / `inputOptions` / `hoverOptions` 分别按内部字段合并；修改一个字段不会覆盖另一个窗口保存的同组其他字段。
- 服务实例按 ID 合并；删除与他处编辑冲突时不复活或静默删除该实例。
- 同字段不同值，以及服务地址与密钥的危险交叉修改，返回 `SETTINGS_CONFLICT`。
- 冲突后 UI 保留草稿，明确要求重新读取；普通暂时保存失败允许继续编辑或重试。

不能用“保存前再 GET 一次，然后写入整个快照”替代该合同，那样仍有跨窗口竞态。

设置写入成功后发出公开变更通知，不等待所有标签页确认，以免无关页面阻塞后续保存。内容脚本在处理外部状态查询、翻译和字幕列表操作前，通过 `getSettings(false)` 读取后台当前公开设置；通知也只触发重新读取，不直接采用可能迟到的通知快照。异步读取有独立归属，较旧响应不能覆盖新配置或启动旧操作。读取失败向操作调用方报错，不默默使用旧语言继续执行；恢复和停止可以解除尚未完成的操作。读取设置、取消请求不进入写入队列，内容脚本始终不接收私有凭据。

播放器的偏好更新使用更窄的 patch 接口，允许 `subtitlesEnabled`、`subtitleProviderId`、`subtitleTargetLanguage`、`subtitleStyle`、`subtitleTrackPreference`、`subtitleListOpen`。后台校验字段名、值类型、服务可用性和规范化后的字符串，串行叠加到当前设置；返回值仍不含私有服务字段。

网页显示模式通过 `KUAI_UPDATE_PAGE_PREFERENCES` 单独修改，只接受 `pageDisplayMode`。该 patch 与完整配置保存使用同一串行写队列，叠加当前配置，不因单纯切换显示模式而中断翻译任务。

字幕轨偏好只持久化 `{ languageCode, kind, name }`。空语言表示自动；非空语言最多 32 字符，允许已知语言代码形状；`kind` 为人工 `''` 或自动 `'asr'`，名称裁剪至 200 字符。不持久化轨道地址、视频 ID 或观看历史。读取时先匹配语言/种类/名称，再退到语言/种类、语言和可用默认轨道；没有匹配时保留偏好。公共 patch 严格拒绝额外字段和错误类型，普通规范化则退回自动选择。

`subtitleListOpen` 为布尔值，默认 false。播放器控制器串行写偏好，较新的外部配置及当前视频身份优先于迟到响应；ON/OFF 和列表打开/关闭都保存。初次恢复及外部通知不回写，保存失败恢复已保存状态并显示错误。列表滚动、跟随、文字选择、播放位置和快捷设置面板展开状态不持久化。

### 交互配置与规范化

准确默认值以 `src/shared/interactions.ts` 为准；顶层继续保留 `selectionEnabled: true` 和 `hoverEnabled: false`：

```js
const interactionDefaults = {
pageOptions: {
  autoTranslate: false, alwaysLanguages: [], neverLanguages: [],
  alwaysSites: [], neverSites: [], translateFullPage: true,
  excludeSelectors: [], minTextLength: 1, translateDynamic: false,
  contextMenuEnabled: true, shortcut: 'Alt+Z', displayModeShortcut: ''
},
selectionOptions: {
  providerId: 'follow_page', sourceLanguage: 'follow_page', targetLanguage: 'follow_page',
  triggerMode: 'auto', triggerAction: 'click', delay: 250, maxLength: 5000,
  showOriginal: true, autoSpeak: false, disabledSites: []
},
inputOptions: {
  enabled: true, providerId: 'follow_page', sourceLanguage: 'follow_page', targetLanguage: 'en',
  shortcut: 'Alt+X', restoreShortcut: '', icon: 'dot', autoApply: true,
  includeOriginal: false, displayOrder: 'original-translation', disabledSites: []
},
hoverOptions: {
  trigger: 'shift', customKeys: [], mode: 'paragraph', displayMode: 'inline', delay: 300, holdDelay: 800,
  showIndicator: true, borderColor: '#cfcfcf', disabledSites: []
}
};
```

`normalizeInteractionOptions(input, providers)` 返回四个完整组；`resolveFeatureSettings(settings, feature)` 解析划词/输入的独立服务与语言，悬停沿用网页。服务只能引用启用的已保存实例或 `follow_page`；源语言可为 `auto`、`follow_page` 或语言代码，目标不能为 `auto`。`interactionConfigurationKey()` 用于通知路由，实际消费者仍按受影响的功能取消任务。

完整配置包含公开的三个迁移标记：`inputDefaultsVersion: 3`、`paragraphDefaultsVersion: 1`、`subtitleStyleDefaultsVersion: 1`。仅对 `schemaVersion: 1` 完整旧配置识别旧默认值，局部未标记的显式值不被当成旧备份；已有效的未来版本标记也保留。

- 输入：无标记的旧 `follow_page / none` 对改为 `en / dot`；标记 1 且目标为 `zh-Hans` 时改为 `en`，入口及其他选项保留。其他目标保留。标记低于 3 且 `restoreShortcut` 为旧默认 `Control+Shift+Z` 时清空（再次按 `shortcut` 即恢复），自定义值保留；字段仍保留以兼容旧备份。
- 段落：缺少标记且旧触发方式为 `alt` 时一次性改为 `shift`，不改变启用状态或自定义组合。旧产品导入使用当前默认对象作基底，因此其明确支持的旧按键保持为显式值。
- 字幕：缺少标记且没有明确 `backgroundMode` 时，只有旧字号/颜色/字重/描边/字体/背景这一整组视觉值全部匹配旧默认才改为新默认；布局、模式、顺序和遮罩不参加比较且保留。已自定义视觉值保留 `panel` 背景。

标记经规范化、公开设置、合并与备份保留；升级后主动选回中文、Alt 或旧外观不会反复被覆盖。旧配置未记录“主动选择相同默认值”的来源，因此无法区分这类选择与未改默认。迁移不改原对象和服务凭据。

| 配置 | 枚举或边界 |
| --- | --- |
| 划词触发 / 入口激活 | `auto / icon / dot / shift / alt / ctrl / meta`；`click / hover` |
| 划词延迟 / 最大长度 | 0–2000 ms；1.0.000 字符 |
| 输入入口 / 顺序 | `none / dot / icon`；`original-translation / translation-original` |
| 悬停触发 / 范围 | `ctrl / shift / alt / left_hold / hover / custom`；`paragraph / area` |
| 段落显示方式 | 统一为 `inline`；旧 `popup`、缺失或非法值均规范化为 `inline`，显示与样式由网页设置决定 |
| 鼠标触发延迟 / 左键按住时长 | 50–3000 ms；200–3000 ms，左键模式先等待按住时长，再等待延迟；键盘切换不使用此延迟 |
| 网页最少长度 | 1–200 字符 |
| 列表 | 网站/语言每组最多 100 项，选择器最多 50 项，每行最多 2000 字符 |

`normalizeShortcut()` 接受一个或多个修饰键与一个 A–Z 字母，统一成 Control / Alt / Shift / Meta 顺序；空字符串禁用。`normalizeKey()` 处理 Ctrl、Cmd、Option 等别名。段落自定义快捷键允许 1–2 个不同的修饰键或字母组合；释放组合中的按键时切换一次，重复键和其他动作组合不触发段落翻译。实际 `matchesShortcut()` 必须精确匹配修饰键并排除重复键与组合输入。UI 校验网页两组、输入两组各自的快捷键冲突；无效草稿不会因其他控件保存而被静默丢弃。

`normalizeSiteList()` 与 `isSiteListed()` 只支持受限域名/HTTP(S) glob，不执行任意正则。裸域名及 `*.域名` 都包含域名本身与子域名；可限制协议和端口。带路径时匹配路径、查询与片段，`*` 不跨 `/`，`**` 可以跨层。示例和语言规则见 [README](../README.md#网站语言与排除规则)。CSS 排除只用作 DOM 选择器，非法选择器忽略；命中段落内部子区域时整段跳过。

旧版迁移只映射明确存在且受支持的交互字段，缺失值使用本项目默认值。可识别 `translationUrlPattern.urlConfigs` 的对象或 JSON 数据，旧 `disableInputTranslation` / `disableSelectionTranslation` 中 `0` 表示禁用。旧单服务引用需映射到可用实例；旧多模型列表、评分、`autoApplyBestTranslation`、手机手势及上下文摘要不映射为新功能。旧自动语言/网址规则可能启用自动翻译，需在用户说明中提醒导入后检查。

1.3 继续保留 `hoverOptions` 的存储形状与 `hoverEnabled`，但规范化统一采用 `displayMode: inline`。旧弹窗偏好不再触发单独的渲染路径；设置中的段落选项移入网页分区，旧 `#hover` 入口仍可定位。启用状态、已保存触发键、范围、网站例外及其他服务配置保持兼容。

### 显示配置与旧数据迁移

| 配置 | 语义与单位 |
| --- | --- |
| `pageDisplayMode` | `bilingual` / `translation_only` |
| `pageStyle.preset` | `PAGE_PRESETS` 中的 16 个枚举值，不是任意 CSS |
| `pageStyle.fontSize` / `fontWeight` / `lineHeight` | 50–200% / 100–900 / 1–3 |
| `pageStyle.fontFamily` / `textColor` | 安全字体名称/字体栈；文字色为 hex 或 `inherit` |
| `pageStyle.accentColor` / `backgroundColor` / `opacity` / `italic` | hex 颜色 / 0–100 不透明度 / 布尔斜体 |
| `subtitleTargetLanguage` | 固定语言代码或 `follow_page`，与网页目标语言分开 |
| `subtitleStyle.displayMode` / `displayOrder` / `hideTranslation` | 双语或仅译文、原文在上或译文在上、独立的学习模糊遮罩 |
| `sourceFontSize` / `targetFontSize` | 各自 12–72 px |
| `sourceColor` / `targetColor`、`sourceWeight` / `targetWeight` | 各自 hex 颜色与 100–900 字重 |
| `sourceStroke` / `targetStroke` | `none` / `light` / `normal` / `bold` / `shadow45` |
| 字幕 `backgroundMode` | `line` 逐行背景（默认）或 `panel` 整块背景 |
| 字幕 `fontFamily`、`backgroundColor`、`backgroundOpacity` | 字体、hex 背景颜色、0–100 不透明度 |
| 字幕 `position`、`offset`、`maxWidth` | 上/下与左/中/右六方位、0–300 px 边缘距离、40–100% 最大宽度 |

`showOriginal` 只是向旧设置兼容的派生别名；新 UI 写 `subtitleStyle.displayMode`。旧备份没有明确显示模式时，才使用旧 `showOriginal` 值补充它。

旧产品数据通过 `legacyPresentation()` 映射，覆盖 `transDisplayMode`、`transTheme`、当前主题的 `transThemeConfig`、字幕样式和独立字幕目标。兼容历史 `boderColor` 拼写，字号档位映射为 16/20/24/32/40 px，字幕背景 0–1 的透明度转换为百分比。数据经过新的白名单、颜色/字体校验与范围限制，不复制或执行旧产品的 CSS/脚本。保留支持的数据不代表执行旧格式里的所有字段。

默认字幕两种语言均为 24 px、白色、400 字重、无描边，逐行使用 50% 黑色背景、1.4 行高及左右 10 px 内边距。外层背景透明、无阴影和圆角，保留空白拖动边缘；`panel` 恢复外层背景/内边距并清除文字背景，双向切换不残留旧样式。设置预览的每种语言有单独行容器，避免 flex 将文字背景拉满；顺序和原文隐藏应用到行容器。没有移植旧插件随视频宽度缩放字体的算法，不把基础样式声明为像素复刻。

### 呈现变化不触发重新翻译

`styles.js` 只写固定 CSS 属性，不替换文字节点；设置页预览与页面使用同一组函数。字幕字体、背景、显示顺序和模式应用到 overlay；sidebar 使用独立的阅读样式和固定双语顺序，仅共享显式的学习遮罩。

纯样式变化走 `refreshPresentation()` 或字幕视图更新，保留已有结果及仍有效的请求。切换实际服务、模型/凭据或有效翻译语言会按配置身份使任务失效。固定的字幕目标不随无关的网页目标变化失效。

当前 `providerRevision` 是全体服务共用的修订号：修改任意服务配置，可能取消使用另一个独立服务的在途划词/输入卡片；重新触发后使用当前配置。该保护用于不暴露私有凭据也能识别配置变化，尚未细化为每服务修订号。网页全局语言变化已按有效语言隔离，不会中断使用独立固定语言的划词/输入请求。

预设默认透明度和橙/黄配色在 UI 选择预设时填入并保存；renderer 尊重明确的配置值。不要在 CSS helper 里用“值等于默认色”推断用户没有选择过这个颜色，否则控件和效果会不一致。

### 网页消息

Popup 使用 `chrome.tabs.sendMessage` 向 **`frameId: 0`** 发送 `KUAI_PAGE_TRANSLATE`、`KUAI_PAGE_RESTORE`、`KUAI_PAGE_STATUS`，以及 `KUAI_YOUTUBE_OPEN_LIST`。字幕列表入口仅在识别出的 YouTube 视频 URL 启用，消息接收方仍需确认播放器就绪；成功打开返回 `{ opened: true }`，未就绪必须显示可操作错误。右键菜单针对实际点击所在 frame。网页翻译启动后立即返回状态，后续进度显示在页面上，不依赖 popup 保持打开。

页面状态包含 `active`、`translated`、`errors`、`total`、`cancelled` 和 `isTranslated`。正文经过 `page-policy.js` 过滤后发送；手动、自动、动态与快捷键意图由 `page-triggers.ts` 管理。自动翻译默认关闭，开启后网站/原文语言允许列表为 OR 关系，两者空则允许符合条件的页面；禁用规则和已识别的目标语言阻止自动开始。原文语言优先使用最近的 `lang`，否则使用可用的本地 Chrome 检测；未知结果不伪造匹配。popup 样式入口打开 `options.html#webpage`。

仅译文模式要先得到有效、可显示的成功结果，再用自有隐藏容器包裹该段原节点。失败/等待/取消段落不隐藏原文。恢复时在当前位置解包，保留节点身份、处理器和网页后来的修改，不用旧 `innerHTML` 覆盖现场。既有译文被站点移除或移出原段落时，清理该记录并恢复原文。

动态翻译另行 opt-in，仅在已经开始翻译的会话处理新增/修改正文，忽略自有译文变更，避免循环请求。手动停止/恢复保留本路由的停止意图；导航取消旧任务并重新判断。Alt+Z 切换翻译/恢复；显示模式快捷键默认空，若配置后在尚无译文时触发，会开始翻译。浏览器内部页、扩展商店及其他不能注入内容脚本的受保护页面仍不可用。

后台菜单等待初始化完成，按全局 `contextMenuEnabled` 与 `selectionEnabled` / `inputOptions.enabled` 的菜单签名串行重建。无关配置变化不重建，迟到点击再次核对当前保存的开关；`stop()` 及未完成回调不能复活监听器或菜单任务。

### 网页译文链接

`page-content.js` 按可读源节点捕获文字与原生链接的连续片段，以锚点对象身份区分同名不同地址链接。带链接的段落将各片段按原顺序分块，批次完成后按索引重组；不带链接的段落继续整段分块。纯空白/标点间隔本地保留。只发送可见文本字符串，href 和属性不进入请求；URL 若本身就是可见正文仍属于文本。

渲染仅创建文本节点及确定的本地 `<a>`，提供者返回的 HTML 保持字面文字。允许 HTTP(S)、mailto、tel；相对地址和片段用当前 baseURI 解析，脚本等其他协议变成普通译文。按白名单保留 target、rel、download、title、aria-label、hreflang、referrerpolicy；新浏览上下文加入 noopener，不复制任意脚本、ID、class 或事件处理器。已有原生外层链接包围的翻译块不再嵌套 `<a>`。

有效性除文字外还包含链接节点身份与片段边界。文字不变但锚点被替换时，旧对应关系也失效；href/target/base 等只改属性时，保持文字节点并同步链接属性，无需重译。MutationObserver 监听源结构和链接/base 属性，忽略自有变化；点击和辅助点击前再次核对，避免同步修改后、观察器执行前导航到旧地址。动态重译仍尊重已有 opt-in 和页面会话规则。

链接边界拆分会减少跨边界句子的翻译上下文，这是当前纯文本服务合同下的取舍。非 href 的脚本控件不复制其行为，受控 DOM 检查也不等于真实浏览器导航验证。

### 输入、划词和悬停生命周期

划词触发 UI 保留原生选区，以实际 range 身份去重，关闭后可重选同一文字。图标/圆点被点击或悬停前不发请求；普通划词控制器不操作视频播放。可选单词朗读仅取 `localService === true` 的匹配语音；源语言为自动时使用浏览器语言寻找语音，没有匹配就跳过，不回退到网络语音。

划词与输入分别维护状态、请求集合和代次。未固定划词卡片在原文选区清除时关闭并取消自己的请求，迟到结果不能复活；不取消另一路输入任务。卡片内的复制和文字选择保留有效节点，状态更新不替换未变化的文字。图钉图标按钮切换固定状态；固定后在当前页面复用坐标，可拖动标题栏或使用方向键移动并在窗口变化时限制到视口内。原文/译文文字及按钮不作为拖动区域。关闭、路由或相关服务/功能失效清理固定状态。

输入的快捷键、聚焦圆点和右键命令共用 `input-editor.js` 快照。默认圆点位于输入框内侧，首选距右边约 24 px、距下边约 8 px，随输入框及窗口位置变化调整；小输入框缩小入口。聚焦不发请求；圆点首次点击仅展开翻译图标，再点击图标才触发，快捷键仍可直接触发。默认翻译完成直接安全写回，不打开结果卡片；默认圆点模式仅用图标反馈：展开后翻译成功显示绿色勾，再点同一图标还原；加载时可点图标取消，错误时可点图标重试，不显示文字反馈弹窗。只有显式保存 `autoApply: false` 才打开单独的输入预览，不占用固定的划词卡片。

文本、焦点归属、selection、类型、可编辑性与 DOM 身份都需匹配，`beforeinput` 可以取消写入。只支持普通文本控件及能保留现有节点的简单富文本写回；复杂富文本选区保留安全复制/显式预览。只记录最近一次成功替换，再次按主快捷键或输入反馈的恢复按钮在记录有效时恢复（默认关闭的 `restoreShortcut` 若有自定义值也可恢复）；用户输入、组合输入、无关焦点或编辑器变化使旧操作失效，不接管原编辑器的多步 undo。

段落键盘快捷键在按下时记录指向的原段落和源文本，在释放时切换。轻量的捕获阶段只识别会冲突的完整组合；原有输入/划词处理仍在冒泡阶段，尊重编辑器的 `preventDefault`。Alt+Z / Alt+X 不会顺带触发 Alt 段落翻译。组合输入、选区、输入框、失焦、路由变化或整页恢复会取消尚未提交的手势；已经提交的请求不因松键或移开鼠标而取消。

`index.js` 将同一个 `page` 控制器传给交互层。`page.toggleBlocks(blocks, {validate})` 用于键盘开关；`page.translateBlocks(blocks, {validate, retryErrors})` 用于只确保译文存在的鼠标触发。两者与 `translatePage()` 使用同一个按源元素索引的注册表，状态统计包含异步语言过滤中的预留。整页翻译会接管和复用已有段落，不清除后重译。输出采用网页样式和双语/仅译文逻辑，失败行只重试自己的段落。

每段都有独立的完成与校验归属。一个网络批次可以包含多个段落；只有最后一个仍需要该批次的段落被移除时，才取消这次网络请求。取消同时释放本地等待，使提供者忽略取消时后面的有效批次也能继续。旧返回只能更新仍在注册表中且身份匹配的原条目，不能覆盖同源元素的新任务。

`isPageBlockAllowed()` 在异步检测后、下一批发出前、返回写入和样式刷新时重查现场规则。源节点、原文字段、URL、设置身份及排除区域变化使过期条目失效。正文中的扩展译文不作为原文参与扫描。普通鼠标移动不会扫描或重新测量整个网页译文注册表。

全局 Restore 统一清除输出并解除未释放的快捷键手势；段落 Toggle 只清除选中的段落。不创建右下角页面进度工具条。Escape 只取消未触发手势或关闭划词/输入卡片，避免在关闭卡片时误清除全文。`hover-inline.js` 的独立注册表已移除。

## 字幕状态与播放控制

YouTube 代码分为字幕捕获、会话、字幕层、侧栏和选择控制。页面捕获的数据必须经过来源、视频 ID、轨道和大小校验；旧视频、旧轨道或旧请求的结果不能更新当前会话。

`parseTimedText(input, { kind: 'asr' })` 仅对明确自动生成的 JSON3 使用本地断句。捕获响应携带请求开始时的轨道元数据；控制器按语言、轨道种类、名称和 vss 身份核对，不能把较新的自动轨道标记借给旧人工轨道响应，同语言也不能绕过换轨校验。人工 JSON3、VTT、XML 保持原解析路径。

`asr-segmentation.js` 利用可用的 `tOffsetMs`、句末标点、约 0.8 秒的明显停顿与长度边界分组；按 120 字符上限预估组数并计算均衡长度目标，12 字符作为最小片段偏好；候选边界的标点/源片段/普通空格代价依次为 0/25/50，继续保留约 8 秒目标，不强行截断不可再分的单词或数字。缺少词级时间时只能估算内部时间，不能提供音频级对齐保证。重复移除需有时间或滚动窗口重叠证据，不能仅因为相邻文字一样而删除正常重复讲话。处理结果进入同一会话时间轴，视频、列表和前后句导航使用一致的 cue；不额外调用标点补全模型。

JSON3/XML/VTT 解析和原生 TextTrack/DOM 回退可能携带换行。此前共享字幕样式及 overlay 后备 CSS 的 `white-space: pre-wrap` 会在空间足够时也强制断行；1.2.1 改为 `white-space: normal`，保留 `overflow-wrap: anywhere`，让字幕层和侧栏按宽度重新排版。修改仅限呈现，原始 cue 文本、现有文本节点、最大宽度及位置设置保留；作者手工断行也会重排，目前没有独立保留选项。自动测试核对数据与实际 CSS 属性，不能代替浏览器行数/像素排版和剪贴板换行格式检查。

识别到播放器后即挂载“译”、设置、列表及前后句控件，放在当前可见的 `.ytp-right-controls` 内部最前面，使原生全屏仍在最右侧。布局更新时检查所有候选，跳过隐藏或 `visibility: hidden/collapse` 的旧控制栏；不把原生自动隐藏用的 opacity 当成不可用。挂载协调带重入保护，选区取消引发的同步渲染不能重复移动按钮或释放选区。设置和列表的存在不依赖字幕获取或翻译成功。无字幕、字幕未开启或读取失败由对应面板显示状态；字幕入口故障不应阻断普通网页翻译。

视频字幕框只常驻原文、译文和必要的状态；空白背景显示 grab/grabbing 并支持垂直拖动，文字仍用于选择。拖动以 `pointerId` 归属、指针捕获和有界偏移实现，完成后仅保存 `subtitleStyle.offset`；取消、捕获丢失、字幕/布局改变或退出会回滚。原字幕轨选择放在快捷设置中，错误时才显示字幕重试入口。

侧栏采用独立的阅读字体、主题配色和双语顺序，不调用视频字幕的文字/背景样式函数。原文在上、译文在下，视频仅译文设置也不会隐藏列表原文；只有显式学习遮罩继续共享。手动滚动或选择后暂停自动跟随，“回到当前字幕”重新跟随并把焦点交回列表，不自动播放。保留虚拟列表测量锚点、选中文字节点和全屏重定位的原有约束。

`preferences.js` 的快捷面板只写公共字幕 patch；完整设置链接使用 `KUAI_OPEN_OPTIONS` 的 `subtitles` 分区。`navigation.ts` 根据当前有效时间轴计算上一句/下一句，尊重视频时长和 seekable 范围；有限时间轴缺失、直播即时字幕或越界时不执行跳转。按钮与 Ctrl+Alt+左右方向键只改变时间，不替用户播放；文字输入、组合输入和隐藏文档不接管快捷键。

字幕文字选择与播放控制通过明确的暂停归属协作：只有扩展因为本次有效字幕选择暂停了原本正在播放的视频，清除选择才可能恢复播放。用户自己的暂停、播放、跳转、视频切换或会话结束会使旧恢复资格失效。不要仅凭 `video.paused` 为真就执行 `play()`。

选中期间固定字幕视图，避免刷新节点破坏选区；新的字幕翻译调度暂停。已经在途的响应不能因此取得播放控制权。侧栏与字幕层都使用同一会话状态，时间戳跳转、跟随操作和切换字幕轨要先处理选择生命周期。

## 测试

全部测试：

```bash
pnpm test
```

根据问题运行对应模块，例如：

```bash
pnpm build
node --test tests/providers.test.js tests/background.test.js tests/settings.test.mjs
node --test tests/shared-interactions.test.mjs tests/interaction-settings.test.mjs tests/client.test.mjs
node --test tests/content-page.test.js tests/content-page-links.test.js tests/content-interactions.test.js tests/content-runtime.test.js
node --test tests/content-interaction-triggers.test.js tests/content-input-options.test.js tests/page-options.test.mjs tests/ui-interaction-options.test.js
node --test tests/content-selection-input-lifetime.test.js tests/input-defaults.test.mjs tests/reading-defaults.test.mjs
node --test tests/content-page-shared.test.js tests/content-paragraph-shortcut.test.js tests/content-hover-inline.test.js tests/content-runtime.test.js
node --test tests/subtitle-selection.test.cjs tests/subtitle-sidebar.test.cjs
node --test tests/youtube-wrapping.test.mjs tests/youtube-overlay.test.mjs tests/styles.test.mjs
node --test tests/youtube-captions.test.mjs tests/youtube-capture.test.mjs tests/youtube-runtime.test.mjs tests/youtube-preferences-persistence.test.mjs
node --test tests/ui-state.test.js tests/ui-async.test.js tests/ui-popup.test.js tests/ui-presentation.test.js tests/ui-text.test.js
node --test tests/styles.test.mjs tests/presentation.test.mjs
node --test tests/build.test.mjs
```

测试导入实际源码。边界夹具用于控制 HTTP 返回、Chrome 消息、DOM 和播放事件，使失败、取消及异步乱序可稳定复现。提供者响应测试不发出真实付费请求，也不需要真实密钥。

行为测试覆盖可见译文、原文保留、真实左键/键盘触发路径、计时取消、独立服务、输入快照与单步恢复、页面规则与动态变更、跨窗口保存、字幕暂停归属及打包引用等。增加测试时应覆盖具体风险，不为简单可逆文案修改生成只复刻实现的测试。

### 实际浏览器检查

本次交付**尚未完成真实浏览器和在线 API 的端到端验证**。以后检查时请记录浏览器版本、扩展版本、日期、服务类型、步骤和观察结果，与自动测试结果分开。可以围绕相关改动执行：

| 场景 | 观察结果 |
| --- | --- |
| 双语/仅译文、失败与重试 | 只有成功段落隐藏原文，失败有提示；还原保留节点、处理器和网站新修改 |
| 译文原生链接 | 双语和仅译文中按鼠标/键盘打开；同名链接不同地址、相对地址、href/base 变化、复杂链接卡片；恢复保留原节点 |
| 改网页字体/颜色/预设 | 已有结果原位变化，无重复服务请求；控件值与实际颜色/透明度一致 |
| 网站/语言允许与禁用规则 | 自动翻译默认关闭；允许列表为 OR，禁用优先；手动停止后不立即自动重启 |
| 动态追加正文与嵌套排除 | 未开启动态翻译时不自动发送；开启且已开始翻译后处理新正文；排除段落内的文字不进入请求 |
| 划词触发与独立服务 | 自动/图标/圆点/修饰键按配置触发，超长/禁用站点不发请求；固定语言不随网页变化 |
| 划词关闭与固定 | 清除原文选区关闭未固定卡片；图钉图标保留坐标，拖标题/方向键可移动；复制译文不破坏选区；固定卡片不被输入翻译替换 |
| 输入圆点与单步恢复 | 默认输出英文，圆点在框内靠右；直接写回无结果弹窗，反馈操作在四个视口边缘可见；键盘可操作按钮；显式预览可选词复制；快照失效不覆盖新内容，复杂富文本不压平 |
| 段落快捷键 | 默认指向后按下并松开一次 Shift 切换，松键后请求继续；再次按下关闭待完成/成功结果；Alt+Z/X、编辑器、组合输入和选区不会误触 |
| 段落与网页协调 | 整页复用已有段落和进行中的请求；共享双语/仅译文模式；单段关闭不取消其他段，整页恢复全部清除 |
| 右键菜单开关 | 保存后菜单显隐正确；快速连续修改和迟到点击仍遵循最新开关 |
| 快速改模型/Key、多窗口保存 | 最新输入保留，无旧 Key 回滚；同字段冲突明确显示 |
| 文件读取/翻译中改输入 | 旧文件或旧译文不会覆盖新文本，取消后无迟到结果 |
| YouTube 普通播放与选择 | 列表跟随；选字幕暂停，取消仅恢复扩展拥有的暂停 |
| 视频选项刷新恢复 | 译开关、源轨、列表、服务/目标/显示选项硬刷新后保留；无匹配轨道临时回退后仍可恢复偏好，失败不假装保存成功 |
| 字幕背景拖动 | 空白背景显示小手并拖动，文字可选择；松手保存位置，取消回滚；落点点击不误切播放器 |
| 字幕列表独立排版 | 视频字体、背景、顺序和仅译文不改变列表；手动阅读后“回到当前字幕”恢复跟随而不播放 |
| CC 关闭、无字幕或读取失败 | 设置和侧栏入口仍能打开，面板给出实际状态 |
| 原生控制栏位置 | 普通、影院和全屏下扩展控件在原生右侧按钮组左边，全屏仍最右；原生自动隐藏保留，隐藏旧控制栏不截获扩展入口 |
| 自动字幕断句 | 英语、中文、无标点、重复说话和多人字幕对照音频；词序完整、跳转对应；切换同语言人工/自动轨道拒绝旧响应，人工轨道时间轴不重组 |
| 默认字幕样式 | 24 px 白字常规字重、逐行半透明黑底；普通/影院/全屏及窄容器下对照，切换整块背景后无残留，设置预览与浮层一致 |
| 改字幕目标/字体/顺序/学习遮罩 | 固定目标不受网页目标影响；样式不重复翻译，悬停/键盘可揭示遮罩 |
| 字幕宽窄容器与来源换行 | 字幕层和侧栏不强制保留来源断行；窄容器仍正常换行，位置/最大宽度有效；单独检查实际像素排版和复制文本格式 |
| 上一句/下一句与键盘导航 | 保留播放状态，边界不越界，输入框和无时间轴场景不误触发 |
| 手动暂停、跳转、切视频、关侧栏 | 不被旧选择擅自恢复播放，不展示上一视频的迟到结果 |
| 免费服务与自配 API | 在线请求成功或显示实际失败；记录网络和服务条件，不推广为永久保证 |

## 构建、检查和源码边界

`scripts/project.mjs` 定义运行时复制规则和源码打包 allowlist。构建只接受预期类型的文件，并拒绝符号链接，避免把项目外文件带入产物。根目录的 `LICENSE` 另行复制为 `dist/LICENSE.txt`，使安装 ZIP 也携带许可文本；README 等开发文档不复制到运行时。

`checkDist()` 检查 Manifest V3 与项目名、禁止继承扩展 key/update URL、核对 manifest 和 HTML 的本地资源引用、解析可识别的本地 ESM 导入并运行 JavaScript 语法检查。它是静态闭包检查，不能代替浏览器执行，也不宣称识别任意动态构造的所有资源路径。

源码 ZIP 仅收录 `src/`、`public/`、`scripts/`、`tests/`、`docs/`、`.github/` 及显式列出的项目根文档/配置。新增根目录文档时，应确认它在 allowlist 中；`docs/` 下的 Markdown 已可收录。`dist/`、`release/`、Git 元数据和个人环境文件不进入源码包。

allowlist 限制可打包路径，但不能自动证明这些文件的正文没有意外写入密钥。提交或分享前仍应检查实际变更和归档文件列表，不要把真实配置当测试夹具。

## 打包与发布

```bash
pnpm test
pnpm package
```

对于清单版本 1.0.0，生成：

- `release/kuai-translate-1.0.0.zip`：根目录直接包含 `manifest.json`，可解压加载。
- `release/kuai-translate-1.0.0-source.zip`：单一 `kuai-translate-1.0.0/` 顶层目录，包含可维护源码与文档。
- `release/SHA256SUMS`：两个 ZIP 的 SHA-256 值。

ZIP 使用稳定排序、固定时间戳和权限以及固定压缩参数。验证重复构建时，可在同一 Node 版本下保存第一次哈希，再重新打包比较：

```bash
pnpm package
node --input-type=module -e "import fs from 'node:fs'; fs.copyFileSync('release/SHA256SUMS', 'release/SHA256SUMS.first');"
pnpm package
node --input-type=module -e "import fs from 'node:fs'; import assert from 'node:assert/strict'; assert.equal(fs.readFileSync('release/SHA256SUMS', 'utf8'), fs.readFileSync('release/SHA256SUMS.first', 'utf8')); console.log('Archive hashes match');"
```

`release/` 不进入源码包，因此此比较文件不会影响源码 ZIP。相同输入和运行环境应得到相同结果；不同 Node/zlib 版本的压缩字节不作跨版本一致性保证。

更改版本时同步 `package.json`、`public/manifest.json`、变更日志及说明中的示例文件名。CI 执行测试、打包与 artifact 上传，权限为仓库内容只读，不推送提交、不创建 Release、不上传扩展商店。发布需要维护者自行选择仓库、审核结果并操作。

首次分享到自己的 GitHub 仓库的命令见 [README 的分享步骤](../README.md#分享到你自己的-github-仓库)。不要给文档填写并不存在的仓库、商店或下载地址。

### 按可见区域翻译

网页会话使用 collectBlocks 的 visibleOnly 模式，在读取原文前过滤视口外与滚动容器裁剪外的块。page-triggers 在已开始的会话中监听滚动与窗口变化，使用 120 ms 合并调度，并与动态内容请求共用单条等待队列。新追加的可见内容参与补译；已有内容变化的主动刷新仍遵循 translateDynamic。网页任务在每批发送前复验可见性并释放未发送的离屏条目，明确的段落操作仍可处理指定块。停止、还原、导航和后台状态取消调度；滚动不自动重试错误段落。统计通过扩展状态接口保留，不再创建浮动工具条。

## TypeScript 维护约定

源码使用 `.ts`，相对模块引用保留 `.js`，对应 `dist/` 的浏览器运行路径。`allowJs: true`、`checkJs: false` 支持渐进共存；全部扩展入口现已迁为 TS，`strict: true` 覆盖运行时和消息契约测试。`public/content-loader.ts` 与 YouTube `capture-main.ts` 保持 classic script；纯类型模块使用 `.d.ts`，不会打包到浏览器。构建脚本与 Node 回归测试保留原生 JS。

详细基线、阶段证据、权限比较和加载方式见 [迁移记录](typescript-migration.md)。
