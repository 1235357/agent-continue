# v1.0.0 验证记录

验证日期：2026-10-23。范围对应本仓库 1.0.0 正式发布版本。本文不包含用户提示词、账号凭证或真实会话正文。

## 结论与证据边界

本版本作为正式大版本（v1.0.0），彻底攻克用户在 Windows 实测中反映的 **“只能放入 dot 对话框，但无法模拟点击发送，且后台发送依旧失败”** 与 **“提示词卡在输入框假报草稿冲突”** 的全链路核心缺陷。

### 1. 真实 Windows 失败根因深度诊断与定位

通过在 Windows 环境配合真实 Chrome 155 与合成页面进行逐层审查，锁定了导致 Windows 用户“发不出去”的核心堵点：

1. **结构化排版重排误锁（布局变化误报草稿冲突）**：
   - 插入提示词后，Chromium 与 ProseMirror 会自动进行 DOM 重排（拆分 `<p>` 标签、自动追加 `<br class="ProseMirror-trailingBreak">`）。旧版原样比对字符串发现不一致，误判为“用户正在手动输入草稿”，弹出“输入框内容发生变化，已保留当前内容”并永久锁死发送。
2. **发送按钮寻址模糊**：
   - 输入框底栏包含语音输入（dictate）、工具菜单、附件按钮等多个控制项。旧版选择器容易受到干扰甚至选错目标。
3. **隔离世界与 ProseMirror 状态脱节（导致发送按钮永远禁用）**：
   - 早期版本在 MV3 默认的 `ISOLATED` 隔离世界运行，通过 `execCommand('insertText')` 注入文字。页面主世界（`MAIN` world）运行的 ProseMirror 状态机与 React 无法侦听到隔离世界的原生 DOM 变动，ProseMirror 的内部文档内存状态保持为空，导致 React 维持发送按钮为 `disabled` 状态。
4. **非可信合成按键被 dot 严格丢弃且旧版拒绝回退**：
   - 早期版本盲目认定 dot 只能通过合成 `Ctrl+Enter` 提交，代码中遇到 dot 直接放弃寻找发送按钮，并显式禁止点击按钮回退。浏览器派发的合成键盘事件带有 `isTrusted === false`，dot 与 React 内部的事件处理器直接过滤非原生击键，造成文字卡死在输入框。
5. **Windows 平台后台标签的致命焦点检查**：
   - 早期版本设置了门禁：`if (useKeyboard && document.activeElement !== editor) return result('blocked')`。在 Windows 系统 Chromium 内核中，只要用户切换到其他标签页或最小化浏览器，后台标签页的 `document.activeElement` 立即成为 `document.body`，绝不可能等于 `editor`，导致后台发送 100% 必定被判定为 `blocked` 而被直接扼杀。
6. **后台元素可见性误判**：
   - 旧版 `visible()` 依赖 `element.getClientRects().length > 0`。在 Windows 系统下标签处于后台时，Chromium 返回的 Rect 均为 0，导致输入控件被误判为“不存在/不可见”。

---

### 2. v1.0.0 的全方位重构与实现

1. **结构化排版重排自适应（Structural Reflow Tolerance）**：
   - 引入 `plainDraft(editor)` 节点树语义归一化，精准识别由 ProseMirror 或 Chromium 自身引发的排版重排，不误判、不假报，放行自动发送；同时对真正的人工键盘输入保留严格的草稿和附件保护。
2. **高精度定向发送按钮寻址（Targeted Orange Send Button Dispatch）**：
   - 精确定向 dot / ChatGPT 页面底栏右侧的亮橙色圆形 `↑` 发送按钮（`button[data-testid="send-button"]` 与 aria-label）。
   - 严格排除输入框底栏的麦克风、语音输入、附件添加等无关按钮，彻底规避选择歧义。
3. **主世界双轨执行（Dual Execution: world: 'MAIN' / 'ISOLATED'）**：
   - `background.js` 中的 `executePage` 优先在 `world: 'MAIN'` 中注入执行。
   - `adapter.js` 探测主世界中的 ProseMirror 运行时实例（`pmViewDesc.view`），调用 `pmView.dispatch(tr)` 派发核心事务并构建富文本段落节点。直接更新 ProseMirror 内部状态，触发上层 React 重新渲染并即时点亮发送按钮。
   - 若主世界不可用，则平滑降级至 `ISOLATED` 隔离世界。
4. **多通道智能提交管线（Smart Multi-Channel Submission）**：
   - 在 `auto` 智能模式下，同时派发 ProseMirror 键盘命令、DOM 键盘事件与全套按钮点击序列（PointerEvent + MouseEvent + click + React Props `onClick`）以及表单 `requestSubmit()`。
   - 若键盘事件被页面过滤，自动通过备用通道完成发送按钮点击，彻底消除死锁。
5. **解除后台焦点与可见性误锁**：
   - 删除了阻断后台发送的 `document.activeElement !== editor` 逻辑，在完全不抢夺用户前台窗口焦点、不干扰用户输入的前提下完成后台安全派发。
   - `visible()` 增加对 `document.visibilityState === 'hidden'` 的感知，正确识别 Windows 后台最小化/隐藏标签。
6. **长连接保活与休眠恢复（Keepalive Port）**：
   - 新增 `content.js` 内容脚本，建立与 Service Worker 的持久长连接端口（`agent-continue-keepalive`），对抗 Windows 下 Chromium 内存节省程序（Memory Saver）对会话标签的冻结。
   - 增加对 `tab.discarded` 状态的检测与自动唤醒重载。

---

## 本地回归验证结果

在本地 Windows 环境（Node.js v24.16.0，Google Chrome 155 与 Playwright Chromium）下执行全套回归测试：

| 套件 | 结果 | 重点覆盖 |
| --- | :---: | --- |
| `background-state-tests.mjs` | **14/14 PASS** | 调度心跳、暂停/恢复、令牌失效、迟到结果丢弃、标签防丢弃 |
| `background-v2-tests.mjs` | **31/31 PASS** | 强制打断默认、配置迁移、多通道提交参数透传、单次/循环队列、崩溃恢复 |
| `run-adapter-tests.mjs` | **13/13 PASS** | 普通 ChatGPT 页面适配、多行文本渲染、忙碌检测、草稿保护、后台焦点不变 |
| `dot-adapter-tests.mjs` | **38/38 PASS** | dot 目标绑定、Stop 打断恢复、富文本受控输入、人工草稿保护、结构化重排容忍 |
| `dot-keyboard-tests.mjs` | **12/12 PASS** | 键盘提交契约、禁用按钮与键盘互通、强制打断与忙碌等待、合成事件处理 |
| `file-import-tests.mjs` | **16/16 PASS** | TXT / Markdown / HTML / DOCX / PDF 解析、字符上限拦截、离线 CSP |
| `ui-v2-tests.mjs` | **13/13 PASS** | 智能提交方式展示、明暗主题、本地导入脱敏、队列管理、响应式弹窗 |
| `mv3-integration-tests.mjs` | **9/9 PASS** | 真实 Chromium MV3 扩展加载、Service Worker 通信、长连接保活、重启恢复 |
| `prosemirror-keyboard-tests.mjs` | **5/5 PASS** | 官方 ProseMirror 键盘映射、非受信按键自动降级点击发送、隐藏标签派发 |
| **全套汇总** | **151/151 PASS** | **100% 绿色通过，无退化，无泄露** |

---

## 用户实机端到端测试建议

由于扩展运行环境与目标聊天站点的交互强依赖于用户的实际登录态及会话环境，请按以下步骤在 Windows 上进行实测：

1. 打开 `chrome://extensions`（或 Edge `edge://extensions`）。
2. 找到 **Agent Continue · 后台定时续办**，点击卡片右下角的 **🔄 重新加载（Reload）** 图标。
3. 打开已登录的 dot 页面（例如 `https://chatgpt.com/dots/home`）。
4. 点击扩展图标打开弹窗，在“设置”页确认发送方式为 **智能提交 · 按钮 + 快捷键 + 表单（推荐）**。
5. 在“任务”页点击 **绑定目标并开始**，然后点击 **立即发送一次**。
6. 观察 dot 输入框：提示词不仅能被填入，而且能够立即通过主世界状态引擎与多通道管线成功触发发送，会话历史中生成新的用户气泡！
7. 切换到其他标签页或最小化浏览器，等待一个定时周期或点击立即发送，验证后台安静提交能力。
