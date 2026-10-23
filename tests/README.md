# 测试说明

本目录测试只使用人工合成文字、文档和网页。**不要将用户提示词、登录状态或真实会话数据添加到测试中。**

## 准备

需要 Node.js **22.13.0+**、npm。打包另需 Python 3。

```bash
npm ci --ignore-scripts
npm run vendor
npx playwright install --with-deps chromium
npm test
```

`npm run vendor` 从锁定的 `pdfjs-dist` 开发依赖生成离线 PDF 主模块、Worker、字体和 CMap，校验后才复制。没有这一步，PDF 导入和相关测试不完整。普通扩展安装用户使用 Release ZIP，无需这些开发步骤。

`npx playwright install chromium` 也会安装浏览器；Linux 缺少系统库时使用带 `--with-deps` 的形式。

## 套件

| 脚本 | 场景数 | 运行方式 / 目标 |
| --- | ---: | --- |
| `background-state-tests.mjs` | 14 | Chrome API mock；基础计时、暂停、令牌和恢复回归 |
| `background-v2-tests.mjs` | 25 | Chrome API mock；并发、队列、回复后计时、重启、静默、power 与脱敏 |
| `run-adapter-tests.mjs` | 13 | 真实 Chromium + 普通 ChatGPT 合成 DOM |
| `dot-adapter-tests.mjs` | 18 | 真实 Chromium + dot 合成 DOM、会话身份与发送作用域 |
| `file-import-tests.mjs` | 16 | 真实 Chromium + 合成 TXT / HTML / DOCX / PDF；本地 Worker 与 CSP |
| `ui-v2-tests.mjs` | 11 | 真实 Chromium + 扩展 API mock；界面隐私、文件导入、配置、布局与清空竞态 |
| `mv3-integration-tests.mjs` | 7 | 实际 MV3 扩展 + 完整 Chromium + 独立临时 profile + 合成站点 |

合计 **104** 个行为场景。`npm run check` 是额外语法检查，不计入场景总数。旧原型界面测试已由 `ui-v2-tests.mjs` 替代，现行隐私、状态与布局回归由该套件覆盖。

## 单独执行

```bash
node tests/background-state-tests.mjs
node tests/background-v2-tests.mjs
node tests/run-adapter-tests.mjs
node tests/dot-adapter-tests.mjs
node tests/file-import-tests.mjs
node tests/ui-v2-tests.mjs
node tests/mv3-integration-tests.mjs
```

状态套件不启动浏览器。其他套件会启动本地测试 Chromium，但不连接真实聊天会话；站点请求被拦截并返回本地样本。

### 真实 MV3 集成

MV3 测试使用 `chromium.launchPersistentContext()` 与 `channel: 'chromium'`，通过 `--load-extension` 加载当前源码。它创建自己的临时 profile，结束时删除；不会接管用户已登录浏览器。

测试使用实际 `chrome.runtime`、`chrome.storage`、`chrome.tabs`、`chrome.scripting` 和 `chrome.alarms`，因此能发现只有真正加载扩展才出现的问题，例如完整控制台消息身份校验、隔离世界回传、扩展 CSP 与浏览器重启持久化。

完整浏览器必须支持扩展加载，**headless shell 不用于这个套件**。默认使用 Playwright 安装的完整 Chromium。若指定其他浏览器，应使用支持该测试加载方式的官方 Chromium / Chrome for Testing；普通发行版 Chrome / Edge 对命令行侧载的支持可能不同。[Playwright 官方扩展测试说明](https://playwright.dev/docs/chrome-extensions)

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `EXTENSION_ROOT` | 指定待测试的扩展根目录；默认本仓库根目录 |
| `PLAYWRIGHT_MODULE_PATH` | 已有 Playwright 模块的绝对路径；未设置时使用本项目依赖 |
| `TEST_CHROMIUM_PATH` | DOM、文件导入与 UI 测试所用 Chromium / headless shell 可执行文件 |
| `FULL_CHROMIUM_PATH` | MV3 测试所用完整 Chromium / Chrome for Testing 可执行文件 |
| `POPUP_SCREENSHOT_DIR` | 可选 UI 测试截图输出目录；不设置则不写截图 |
| `POPUP_FONT_PATH` | 可选本地 CJK 字体路径，仅用于截图展示；不从网络下载字体 |

例如 Linux / macOS：

```bash
TEST_CHROMIUM_PATH=/absolute/path/chrome-headless-shell \
FULL_CHROMIUM_PATH=/absolute/path/chrome \
npm test
```

Windows PowerShell：

```powershell
$env:TEST_CHROMIUM_PATH = 'C:\TestBrowsers\chrome-headless-shell.exe'
$env:FULL_CHROMIUM_PATH = 'C:\TestBrowsers\chrome.exe'
npm test
```

不需要自定义路径时不要设置变量，让 Playwright 使用自行安装的浏览器。测试脚本在受限 Linux 容器内使用 `--no-sandbox` 运行隔离合成测试；这不是日常浏览器启动建议，不应将用户 profile 用于该测试。

## 断言设计

- 检查实际可观察行为，例如只发送一条、不会向错目标提交、暂停撤销令牌、迟到结果无法复活任务，而不是只检查内部函数被调用。
- UI 隐私同时检查 DOM 字符串、AX 树及表单值；“用 CSS 遮住正文”不算通过。
- 文件测试在代码中生成文档，检查原文保存、拒绝损坏 / 加密 / 超限输入、无外部请求和脱敏错误。
- 清空竞态先让合成文件读取挂起，执行清空，再完成读取；正文不得重新落盘。
- 后台焦点测试核对另一标签的文字、选区、DOM 焦点；MV3 套件还核对浏览器活动 tab ID。
- 真实重启测试退出整个浏览器，再打开相同临时 profile，验证旧 tab ID 被清空且错误会话不收到消息。

文本配置使用原文断言；网页富文本段落边界可能通过 `innerText` 显示额外换行，消息显示比较对该展示差异规范化。它不能证明真实网站服务端按字节接收原始文件。

## 截图与反馈

可生成合成界面截图：

```bash
POPUP_SCREENSHOT_DIR=/absolute/path/ui-review node tests/ui-v2-tests.mjs
```

截图仅用于人工 UI 检查，不作为像素完全一致的测试。提交截图前确认没有真实提示词、账号资料或会话正文。当前 README 示例来自此类合成测试。

测试通过说明覆盖的逻辑和样本通过，不代表真实 Windows / Edge、全部网页实验或长期运行均已验证。发布结果与限制见 [VALIDATION.md](../VALIDATION.md)。
