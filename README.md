# Kuai translate

独立实现的 Manifest V3 浏览器翻译扩展：网页双语翻译、划词翻译、输入翻译、文本/文件翻译，以及 YouTube 双语字幕和侧边字幕列表。默认可用微软、谷歌、腾讯 Transmart、Yandex 免 Key 网页接口，也可配置自己的 API。无账号、遥测或中转服务器，运行时无第三方依赖。

## 功能

| 功能 | 说明 |
| --- | --- |
| 网页翻译 | 双语对照或仅译文，保留原文节点和链接；按可见区域翻译，滚动补译；16 种译文样式；按网站/语言自动翻译、CSS 排除规则 |
| 段落翻译 | 指向段落按一次 Shift 翻译、再按一次关闭，与整页翻译共用结果 |
| 划词翻译 | 自动、图标、圆点或修饰键触发；结果卡可固定、拖动；独立服务与语言 |
| 输入翻译 | 输入框内小圆点或 Alt+X 翻译并写回，再按 Alt+X 恢复；可预览、保留原文；跳过密码等敏感字段 |
| YouTube 字幕 | 独立服务和目标语言，双语/仅译文、顺序、学习遮罩、样式与位置；上一句 / 重播 / 下一句、单句循环和可选快捷键；侧边字幕列表支持时间戳跳转、搜索和显示切换；选中字幕时暂停播放 |
| 文本/文件 | 粘贴文本或打开 TXT、MD、SRT、VTT（≤ 2 MB），保留格式并下载译文 |
| 翻译服务 | 免 Key 网页接口；OpenAI 兼容、Gemini、Claude、Azure、DeepL、DeepLX、Ollama，可获取模型列表、测试连接、多实例 |
| 配置备份 | 导出默认不含 API Key；可导入旧版直连/免费配置 |

不包含 OCR、PDF/电子书版式翻译或其他视频站点集成。浏览器内部页和扩展商店等受保护页面无法注入。

## 安装

需要支持 Manifest V3 的 Chromium 浏览器（Chrome、Edge）。

- **发布包**：解压 `kuai-translate-<版本>.zip`，在 `chrome://extensions` 开启开发者模式，“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
- **源码构建**：需要 Node.js 24+ 和 pnpm，执行 `pnpm install --frozen-lockfile && pnpm build`，加载生成的 `dist/` 目录。

更新时覆盖原目录后在扩展页点击“重新加载”并刷新网页；换目录加载会得到新的扩展 ID，需要重新导入配置。

## 开发

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 编译 `src/`、`public/` 到 `dist/` |
| `pnpm test` | 构建并运行 Node 内置测试 |
| `pnpm typecheck` | TypeScript 严格类型检查 |
| `pnpm check` | 检查 `dist/` 的清单引用、模块导入和脚本语法 |
| `pnpm verify` | typecheck + test + check |
| `pnpm package` | 生成安装 ZIP、源码 ZIP 和 `SHA256SUMS` 到 `release/` |

源码结构：

| 目录 | 职责 |
| --- | --- |
| `src/background/` | Service worker：私有设置、三方合并保存、翻译请求、右键菜单、快捷键 |
| `src/providers/` | 各翻译服务适配器与有界 HTTP |
| `src/content/` | 网页翻译、划词、输入、段落快捷翻译 |
| `src/youtube/` | 字幕捕获与解析、断句、浮层、侧边列表、选择暂停 |
| `src/shared/` | 设置规范化、交互选项、样式、网站规则、消息客户端 |
| `src/ui/` | 弹窗、设置页、文本工具 |
| `public/` | Manifest、HTML、CSS、图标与本地化 |

只有后台持有 API Key 并调用翻译服务；内容脚本只拿到不含密钥和地址的公开设置，通过服务 ID 请求翻译。消息统一返回 `{ok:true,value}` 或 `{ok:false,error:{code,message}}`。

推送 `v*` 标签时 Release 工作流会校验版本号、打包并创建草稿 Release，说明取自 [CHANGELOG.md](CHANGELOG.md)。

## 隐私与许可

数据发送、权限和本地存储见 [PRIVACY.md](PRIVACY.md)。项目使用 [MIT License](LICENSE)；第三方翻译服务的条款由各服务方决定。
