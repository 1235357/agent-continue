# v0.2.2 验证记录

验证日期：2026-10-23。范围对应本仓库 0.2.2 代码。本文不包含用户提示词、账号凭证或真实会话正文。

## 结论与证据边界

本版本补上 dot 的 **Ctrl+Enter 提交路径**。0.2.1 只有按钮 `.click()`，未实现用户实际采用的快捷键。默认策略现在是 dot 使用 Ctrl+Enter、普通 ChatGPT 使用按钮；每轮只尝试一种方式，出现新用户消息才记为确认。

验证分为三层，不能相互替代：

| 验证层 | 已观察到的事实 | 不能据此推出 |
| --- | --- | --- |
| 已登录的真实 dot 页面 | 使用浏览器原生 `Control+Enter` 提交诊断文字；输入框清空、新用户消息数增加一条，当前选中标签仍是 GitHub | 扩展的合成 KeyboardEvent 一定被真实 dot 接受 |
| 实际 MV3 扩展与官方 ProseMirror | 经扩展真实隔离世界注入，官方 Ctrl-Enter keymap 收到一次事件并提交；没有按钮时仍可提交 | 所有 dot UI 实验、插件或账号配置都采用相同处理器 |
| 有窗口浏览器的隐藏标签 | 发布 CI 配置强制断言目标自然处于 `hidden`，核对前台文字、选区、焦点和活动标签；结果以该提交的 Actions 为准 | 系统睡眠、Edge Sleeping Tabs、数周无人值守或真实 Windows 实机均已验证 |

真实页面诊断只返回控件属性、状态、计数和预先已知诊断消息的匹配布尔值。没有读取或回显私人提示词。原生按键与扩展的 `dispatchEvent(new KeyboardEvent(...))` 是不同路径；后者 `isTrusted=false`。本版本没有引入调试器权限或尝试伪造该属性。

## 已执行的本地回归

最初的本地完整无头运行通过 **150 个场景**。修正焦点仿真后，重新执行受影响的真实 MV3 **9/9** 与官方 ProseMirror **5/5**；新增的自然隐藏标签场景也在本地无头完整 Chrome 中通过，不再跳过。最终测试集在无头与有窗口模式下均包含 **151 个场景**；完整有窗口结果以对应提交的 GitHub Actions 为准。

| 套件 | 本地场景 | 验证重点 |
| --- | ---: | --- |
| `background-state-tests.mjs` | 14 | 首次延时、暂停、令牌、迟到结果、目标变化、防丢弃与恢复 |
| `background-v2-tests.mjs` | 31 | 强制默认、旧记录迁移、发送方式默认与透传、任务快照、并发、队列、调度、重启、静默时段、权限及脱敏 |
| `run-adapter-tests.mjs` | 13 | 普通 ChatGPT 按钮提交、自检、多行、草稿、取消、过期、回执和焦点 |
| `dot-adapter-tests.mjs` | 38 | 显式按钮策略下的 dot 身份、Stop / 重建组件、受控输入、遗留输入恢复与人工修改保护 |
| `dot-keyboard-tests.mjs` | 12 | 默认 Ctrl+Enter、无按钮 / 禁用按钮、可选按钮、强制 / 等待、暂停、人工编辑、忽略按键、迟到 / 缺失回执、不追加备用操作 |
| `file-import-tests.mjs` | 16 | 合成 TXT / Markdown / HTML / DOCX / PDF、编码、原文保存、异常保护、离线 Worker 与无内容日志 |
| `ui-v2-tests.mjs` | 13 | 发送方式保存与展示、隐藏正文、导入 / 导出、任务快照、队列、模板、权限、取消与响应式布局 |
| `mv3-integration-tests.mjs` | 9 | 实际扩展加载、隔离世界 Ctrl+Enter、零 Send 点击、前台保护、停止与组件替换、alarm、PDF Worker、暂停及浏览器重启 |
| `prosemirror-keyboard-tests.mjs` | 5 | 官方编辑器与键盘映射、默认 / 按钮对照、无按钮、拒绝合成按键时不误报成功，以及自然隐藏状态 |

语法检查覆盖 `background.js`、`adapter.js`、`popup.js`、`config.js` 和 `file-import.js`，不计入上述场景数。最终命令退出状态与远程执行结果应一同查看，不能只看测试数量。

## 先复现旧版，再验证修复

新增的 12 个键盘契约场景在公开 v0.2.1 适配器上只有 5 个通过：默认路径仍点按钮、没有按钮或按钮禁用时不发键，无法满足键盘策略的回执与不补发约束。新实现通过这 12 个场景。

官方 ProseMirror 与实际 MV3 的同一测试也在公共提交 `9af6691ea4ad0894a469021ee13a8b77ea337e99` 上运行。第一项实际为 `[键盘命令, 按钮点击, 提交] = [0, 1, 1]`，不符合预期 `[1, 0, 1]`；新实现得到预期结果。这个对照证明旧版缺少键盘路径，**不声称所有 ProseMirror 的按钮点击都会失败**。

另一个假设——普通 ProseMirror 重绘必然导致 v0.2.1 卡住——在最小官方编辑器实验中未复现，因此没有据此追加猜测性输入补丁。

## 后台测试的修正

旧版测试确实核对了 Chrome 的活动 tab ID、前台文本和选区，但没有验证目标文档自然处于隐藏状态。进一步检查发现 Playwright 默认开启焦点仿真，页面会继续报告 `visible`。所以此前“后台隐藏页面已测”的表述过强。

首次有窗口 CI 进一步发现：在另外一个 CDP session 中调用 `Emulation.setFocusEmulationEnabled(false)`，不能释放 Playwright 原 session 持有的可见性覆盖。因此该运行在发送前的 `hidden` 断言处失败，没有被计为后台发送通过。

修正后的 MV3 和 ProseMirror 套件使用独立的本地测试浏览器及 Playwright 公开的 `connectOverCDP({ noDefaults: true })`，从连接开始就不启用焦点仿真，也不禁用后台计时器节流。在 `TEST_HEADED=1` 模式中，测试使用真正有窗口的浏览器，明确检查 `document.visibilityState === 'hidden'`、目标没有文档焦点、前台文档和活动标签不变。测试不重定义 visibility 属性来伪造通过。[Playwright 官方选项说明](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

本地隔离环境缺少 Xvfb 硬编码调用的 `/usr/bin/xkbcomp`，临时提取组件未能启动显示服务器。因此本地验证使用无头完整 Chrome；修正后的两个集成套件已实测自然隐藏状态。有窗口的第二层验证由使用 Xvfb 的 GitHub CI 给出结果。两个工作流均已启用该发布验证，失败会使打包发布门槛不通过。

## 环境与隐私

- Node.js 24.19.0、Playwright 1.62.1；本地浏览器是官方 Chrome for Testing 156.0.8078.47。
- 普通 DOM / UI 测试使用 headless shell；实际 MV3 使用完整 Chrome，独立临时 profile。
- 官方 ProseMirror 测试依赖固定版本：view 1.42.7、state 1.4.4、model 1.25.12、schema-basic 1.2.4、keymap 1.2.3。这些只用于开发测试，不打进安装包；升级了旧测试依赖中已修复的粘贴处理漏洞，完整 npm 审计为 0 个已知漏洞。
- PDF 依赖为离线 `pdfjs-dist@6.4.299`，主模块、Worker 与资源清单一致。
- 自动化聊天请求全部拦截成合成网页；测试不使用用户登录 profile，不扫描上传目录，不载入私人文件。
- 用户个人包另通过不输出正文的本机导入检查；它不上传到公开仓库或 Release。

## 尚未完成的验证

- 把新版扩展安装进已登录真实 dot 后，以扩展自己的合成事件完成私人提示词发送。这不能由真实原生快捷键测试与合成站点扩展测试拼接推定。
- Windows Chrome / Edge 实机、系统锁屏、合盖、睡眠、长期内存压力、所有界面实验及浏览器版本。
- 严格 exactly-once、服务端持久接受、Agent 是否继续完成任务、账号额度或上下文增长。
- 所有第三方文档的编码、字体、排版与图片内容；无 OCR。

“已确认发送”表示页面出现符合条件的新用户消息，不等同于收到服务端幂等回执。未知回执不会立即重试，也不增加确认计数；下一正常周期仍可能与上一条已被接收的消息重复。`maxSends` 是已确认次数上限，不是底层提交次数的硬上限。

提示词配置按原文保存。富文本显示及回执比较兼容段落换行，不能证明服务器按字节保存文档原始内容。防丢弃也不等于禁止冻结或系统睡眠，详见 [README](README.md)。

## 复现与发布门槛

```bash
npm ci --ignore-scripts
npm run vendor
npx playwright install --with-deps chromium
npm test
# Linux 发布验证：实际有窗口浏览器和自然隐藏标签
xvfb-run -a env TEST_HEADED=1 npm test
python3 scripts/package.py
```

可设置 `TEST_CHROMIUM_PATH` 和 `FULL_CHROMIUM_PATH` 使用已有测试浏览器；MV3 与有窗口 ProseMirror 测试必须使用完整 Chrome。更多参数见 [tests/README.md](tests/README.md)。

[GitHub Actions](https://github.com/1235357/agent-continue/actions) 的对应提交 / 标签记录是远程结果依据。版本标签只有在有窗口测试、版本一致性、ZIP 完整性与 SHA-256 检查通过后，才由工作流生成和发布安装包。每周 CI 运行这些本地样本，不会登录用户账号发送消息，也不代表自动修复所有网站改版。
