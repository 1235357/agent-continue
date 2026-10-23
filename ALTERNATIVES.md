# 同类扩展调研、功能对照与实现边界

调研日期：2026-10-23。目标是 Windows 上的 Chrome / Edge：向指定 ChatGPT / dot 入口，按自定义间隔重复发送原文，默认 20 分钟、没有次数终点，支持手动暂停，让用户继续使用其他标签和应用。

**确实有相似产品，也有值得借鉴的开源实现。** 本次扩展到 19 个相关方案，覆盖定时发送、回复后队列、提示词管理、文件导入、多个会话、UI、保活及 Dots 专门适配。功能覆盖应该逐项验收；“市场全部功能都已覆盖”不是本项目的已验证声明。

## 证据怎么读

- **商店声明**：开发者在官方 Chrome Web Store 页写出的功能；本次没有安装实测这些第三方成品。
- **仓库说明**：官方 README、隐私说明和文件结构可查；不等于全仓审计，也不保证商店包与仓库一致。
- **源码复核**：检查了指定实现路径；仍不等于真实站点端到端验证。
- **未确认**：本次所读材料没有明确证据，不表示功能一定不存在。

商店版本是调研时页面显示的版本；GitHub 默认分支与商店发布版可能不同。“支持 ChatGPT”不能自动推导为支持 `/dots/…`。

## 1. 定时与自动续办：最接近核心需求的 5 个方案

| 方案、版本与证据 | 调度与控制 | 后台是否打扰前台 | 可借鉴之处与缺口 |
| --- | --- | --- | --- |
| [ChatGPT Auto Go][auto-go]，1.3，2026-09-17；商店声明 | 秒数间隔、自定义消息、等待停止生成按钮消失、开始/停止、保存设置 | 未确认完全不激活标签 | 同一句话定时发送最直接；未确认文件导入、未知提交处理、Dots、开源或防冻结能力 |
| [Prompt Later][prompt-later]，0.3.0，2026-09-22；商店与[隐私说明][prompt-later-privacy] | 已有会话单次/每 N 小时/每日/工作日/五字段 cron 与时区；多任务、历史、迟到策略、重启恢复 | 明确声明后台复用或打开会话且不切换活动标签；本次未实测 | 草稿默认保留；未知尝试不立即重发，周期任务继续下一期；声明本地 AES-GCM。未确认 20 分钟范围、Dots、扩展源码/许可。已保存的计划可以暂停、编辑或删除；仅在某一次发送正在执行时，暂不允许对该任务进行这些操作 |
| [ChatSequel][chatsequel]，1.0.0，2026-10-22；商店声明 | 回复结束后延时发送自定义继续文字；每标签暂停/恢复；次数上限或无限 | 未确认完全无激活 | 长度超限时摘要迁移到新会话，计数跨会话保留；15 种语言。回复后延时不等于独立时钟周期，迁移会改变任务位置 |
| [AI Message Sender][ai-sender]，5.1.0，2026-08-31；商店声明 | 延时/日历/回复后串联/日周重复；多标签队列；自检、输入框与按钮拾取、历史 | **官方明确说发送时切到前台** | 调度、自检和选择器配置值得参考；该前台行为不符合核心约束。存储本地，可选 Chrome Sync；休眠宣传不能替代平台官方限制 |
| [AfterLimit][afterlimit]，2.3.1，2026-07-22；商店声明 | 各提示词独立计时、编辑/取消、草稿保存、通知、10 种语言；ChatGPT/Claude/Gemini | 未确认 | 适合稍后发送；未确认无限循环、Dots、真实额度重置检测。“准时”是宣传，仍受电脑和浏览器状态限制 |

定时能力的直接参照是 Auto Go 和 Prompt Later；上下文续办参照 ChatSequel。它们的触发机制不同，不能只用“自动继续”一个标签混为一谈。

## 2. 队列、批处理与界面：10 个相邻方案

| 方案与证据 | 队列、输入与复用 | UI、恢复与隐私特点 | 尚不能据此认定的能力 |
| --- | --- | --- | --- |
| [Auto-Prompt][auto-prompt]；仓库与[调度源码][auto-prompt-code] | ChatGPT/Gemini/Grok/Claude；回复完成推进有限列表；共享系统文字、历史 | 进度、主题、完成通知；源码列表结束就停，再次开始重置索引 | 不等于定时无限循环；README 声明 MIT，但本次目录未见独立 LICENSE 文件 |
| [AI Chat Web Supporter][supporter]；MIT 仓库与保活源码复核 | ChatGPT/Claude 队列，Grok 原生队列；文本/图片/文件；按回复内容续办 | 会话隔离、快捷键、拖动编辑/撤销、暂停恢复；附件 IndexedDB；可选系统保活、主题 | 空闲/锁定时可暂时激活冻结标签再恢复，不能称绝不激活；其续办不是定时原文重复 |
| [ChatGPT Auto Chat][auto-chat]，1.0，2026-05-27；商店声明 | ChatGPT 回复后下一项、多轮重复列表；批量粘贴；回复/代码块/自选元素导出 TXT | 延时、暂停恢复、进度、日志、明暗主题 | 设置轮数不自动代表无穷；未确认文档导入、Dots、保活或焦点保持 |
| [Prompt Stacker][stacker-store]，1.6.0，2026-10-22；[MIT 仓库][stacker] | ChatGPT/Claude/Gemini/DeepSeek；保存链、变量、上一条回复引用、JSON 备份、队列重复 | 拖动编辑/撤销、快捷键、限额暂停、重试/跳过、紧凑浮层、主题；工作队列本地，保存链/设置可同步 | 重复次数不等于固定时钟无限；未确认 Dots。1.6 图片选择和 ZIP 下载属于另一个工作流 |
| [Cue][cue-store]，0.2.0，2026-10-20；[MIT 仓库][cue] | ChatGPT 按会话队列，多标签只有一个发送者；仓库还描述文件/图片排队，附件仅留标签内存 | 原生输入框排队、折叠列表、拖动、暂停恢复、错误停止；Web Lock 协调 | 未确认无限定时；仓库附件功能不能仅凭简略商店描述推定已发布；锁协调不等于防冻结 |
| [LLM Prompt Queue][llm-queue]；公开仓库说明 | ChatGPT/Claude/Gemini/AI Studio；回复后推进，空队列结束；添加、排序、删除 | 开关、状态、跨浏览器会话保存、随系统明暗；声明仅本地 | 未确认定时无限、文件导入、Dots、完整许可文件；同名工具/分叉要单独核对 |
| [Chat Queue][chat-queue]，1.5.1，2026-05-04；商店声明 | ChatGPT/Claude/Copilot，各标签独立；批量、多行、拆分、插入 | 草稿保护、排序编辑、暂停、撤销；声明本地无遥测 | 未确认间隔无限、文档解析、Dots、开源或保活 |
| [ChatGPT Automator][automator]，2.1.0，2026-09-19；商店声明 | ChatGPT 文字/文生图/图生图/视觉分析；CSV、JSON、TXT 导入与结果导出 | 侧栏、绑定标签、声明后台执行、延时/错误暂停、本地存储 | 当前商店链接是指南；旧摘要的源码链接本次打不开，不能将 GitHub 指南当开源；Dots、无限周期、无焦点变化未验证 |
| [Auto Flow for ChatGPT][autoflow]，1.0.3，2026-09-22；商店声明 | ChatGPT 间隔队列；提示词导入、公共前后缀、参考图；结果导出 MD/HTML/CSV/JSON/Excel | 侧栏、错误策略、图片下载、目录组织；声明任务数据不发开发者服务器 | Freemium，不能等同免费无限；未确认导入格式范围、Dots、无前台、保活 |
| [queue-chatgpt][queue-chatgpt]；MIT 仓库说明 | ChatGPT 顺序队列/图像模式；JSON 导入导出、剪贴板导入、辅助模板 | 可配等待、失败退避、快捷键、主题、进度 | 未确认固定无限、Dots、保活；重试只有能判明上次未提交时才适合本项目 |

## 3. 提示词管理、通用自动化与 Dots：4 个补充参照

| 方案 | 已有能力 | 与本项目的关系 |
| --- | --- | --- |
| [Always Continue ChatGPT][always]；MIT 仓库 | 自动点击已有 Continue 按钮，关闭某些提示 | 可参考续生成按钮处理；它不填写周期消息，不是定时发送器 |
| [Open Prompt Manager][promptmanager]；README 3.0.6、MIT 声明、源码可查 | 本地提示词库、标签/文件夹、变量、JSON 备份、可选站点授权、自定义输入定位、快捷键、主题；可主动分享到社区 | 借鉴模板管理/权限 UI，默认不是定时执行器；公开分享必须是独立动作，不能成为私密导入的默认流程 |
| [Automa][automa]；公开源码、AGPL/商业许可 | 图形化流程、表单填写、周期任务、抓取、工作流共享、独立扩展构建 | 范围广，但 ChatGPT/Dots 选择器与状态处理仍需开发；不能由“通用自动化”推出可靠兼容，也不能无条件并入 MIT 项目 |
| [Agent Tincan History extension][tincan-extension]；[MIT 主仓库][tincan] | 多 AI 网页桥接，明确包含 dot-web/dots.send；后台打开指定 dot 页、保护草稿、用新消息确认发送 | 本次找到的 Dots 专门适配参照；依赖 native host 和站点内部读接口，不是安装纯浏览器 ZIP 即获得无限定时。可借鉴目标绑定和确认机制 |

## 4. 把“集大成”变成可验收的功能清单

下表提炼市场能力，不代表它们都已在当前 Release 实现。**本项目当前可用功能和实测范围以 [README](README.md) 与 [VALIDATION](VALIDATION.md) 为准。** 每次发布应更新覆盖状态，不能用调研清单代替实现证明。

| 能力 | 参照 | 验收重点 |
| --- | --- | --- |
| 自定义周期、无限重复 | Auto Go、Prompt Later、ChatSequel | 默认 20 分钟，无隐含总次数/总时长；计时语义明确；人类暂停阻止新提交 |
| 发送后/回复后间隔 | Auto Go、Prompt Stacker | 两种模式分开；回复未结束不误判；长回复不导致发送叠加 |
| 队列单次/循环 | Auto-Prompt、Auto Chat | 顺序、当前项、次数可见；多行文件默认是完整一条，不擅自按行拆分 |
| 文档原文导入 | Automator、Auto Flow | TXT/MD 原文保留；编码/换行/超长错误明确；复杂格式本地解析并列明范围，不静默截断 |
| 私密提示词 | Prompt Later、Cue、Chat Queue | 本地处理，无开发者服务器/遥测；诊断不含正文；私人配置不进公开源码/Release |
| 模板与变量 | Prompt Stacker、Open Prompt Manager | 普通模式保持原文；替换须显式启用，避免误处理文本本身的占位符 |
| 暂停/恢复/快捷键 | ChatSequel、Cue | 暂停始终可达；撤销提交前令牌；恢复不悄悄换提示词、目标或计数 |
| 草稿/附件/人工操作保护 | Chat Queue、Cue、Prompt Later | 检测草稿与待发送附件，不覆盖；不动系统剪贴板；不激活标签/窗口 |
| 重启恢复、错过计划 | Prompt Later | 保存运行意图、重建闹钟、验证会话；不连发补账；未知提交不立即重试 |
| 多任务/多标签 | AI Message Sender、ChatSequel、Cue | 目标隔离、同会话去重；一个标签换聊天不误投；任务错误不互相牵连 |
| 静默时段/日历/时区 | Prompt Later、AI Message Sender | 时间窗与 cron/日周规则分开；跨午夜/时区变化有明确行为 |
| 自检/日志/恢复操作 | AI Message Sender、Auto Chat | 自检不发送、不回显正文；日志只含状态；“已发送”需有接收证据 |
| 明暗主题、紧凑 UI | Prompt Stacker、Cue | 小窗口不裁切暂停按钮，键盘可用；隐私隐藏明确；显示真实运行配置 |
| 防丢弃、系统保活 | AI Chat Web Supporter | 区分丢弃/冻结/电脑睡眠；暂停释放请求，不假称页面永不休眠 |
| Dots 精确适配 | Agent Tincan | 独立适配输入结构及目标；普通 /c/ 成功不能推出 /dots/ 成功；/dots/home 防目标身份变化 |
| 上下文迁移、结果/图片导出、多站点、选择器拾取 | ChatSequel、Prompt Stacker、Auto Flow、Automa | 这些是已有市场能力，需要分别实现/验收，不能用基础定时功能“顺带支持”的措辞带过 |

### 从对照得到的实现决策

1. 文件导入默认“整份文件作为一条消息”。按行拆分适合批处理，会破坏长篇提示词结构，应作为独立选项。
2. 导入成功不需要开发者看到正文；日志也不应包含完整提示词、历史回复或原始文件名。测试用独立内容，用户实际运行用其选定原文件。
3. 临时不可用时可以保留“继续运行”的意图。点击发送但确认失败则把该次标为未知，等待下一计划期或人工处理，不立即重复同一次。
4. 站点扩展、图片处理和上下文迁移要逐项列支持范围，避免为表面数量破坏后台不打扰与本地隐私。
5. “更好”应以误投、重复提交、暂停响应、焦点保持、原文完整性、恢复可预测性验收。视觉外观不能替代这些验证。

## 5. 页面保活、电脑唤醒与 dot 云端工作

| 机制 | 含义 | 扩展能做什么 | 不能据此保证什么 |
| --- | --- | --- | --- |
| Discard / 丢弃 | 页面从内存卸载，回来时重载 | 对指定标签设 autoDiscardable:false，检查返回结果，结束后恢复 | 不能保证页面不冻结 |
| Freeze / 冻结、Edge Sleeping Tabs | 页面脚本任务被挂起 | 检测、延后；网站保持活动例外 | Tabs API 没有公开 frozen:false / autoFreezable:false 可写字段，不能跨版本承诺绝不冻结 |
| 电脑因空闲睡眠 | 整机停止运行本地任务 | 可选 power.requestKeepAwake("system")，允许屏幕关闭，暂停释放 | 不会抵消手动关机/睡眠、浏览器退出或网络故障，也不是页面专属保活 |
| dot 云端任务 | dot 在自己的云电脑工作 | 按用户要求周期性追加消息 | 不能用页面活动证明 dot 云端是否运行，也不能保证发消息就能完成任务 |

[Chrome Tabs API][tabs-api] 定义防丢弃与可读冻结状态。[Chrome 冻结说明][freezing] 区分两者，并描述 Chrome 133 起节能模式下符合条件的后台页可能冻结。特定活动会影响冻结资格，但 Web Lock、静音音频和短计时器不是跨版本通用禁眠 API。

[Edge 官方帮助][edge-performance] 提供“系统和性能 → 性能 → 始终保持这些网站活动”，[Chrome 官方帮助][chrome-performance] 提供“性能 → 始终保持这些网站活动”。可加入实际目标网站，例如 https://chatgpt.com。Edge 的 [SleepingTabsBlockedForUrls][edge-policy] 是管理员策略，不是普通扩展直接可写的设置。

[Power API][power-api] 的 system 级别只防因空闲睡眠，并允许屏幕关闭。[Alarms API][alarms-api] 说明闹钟不能唤醒电脑，错过的重复闹钟醒来后最多触发一次再排下一期。“每 20 分钟”是浏览器可执行期间的目标节奏，不是断电仍准时发送的保证。

[OpenAI 的 dot 官方说明][dots-official] 描述其独立云电脑、对话间持续工作及原生定期任务。用户选择扩展重复发送原文，是额外的周期督办机制，不应宣传为 dot 运行的必要条件。原生定期任务是另一个可比较方案，不改变本项目按用户要求开发扩展的目标。

## 6. 持久任务为什么可能需要站点权限

[`activeTab`][active-tab] 来自用户点击扩展等动作，临时绑定当前标签；关闭或跨源导航会撤销。变成后台本身不会把它变成“所有未来标签均可用”的授权。

要在重启后恢复任务、识别重建会话标签，并在这些页面重新注入发送逻辑，需要持久的目标授权。合理范围是用户显式授予 `https://chatgpt.com/*` 站点访问，而非 `<all_urls>`。[Tabs API][tabs-api] 说明匹配 host permission 能访问对应标签 URL 并注入脚本，因此不必仅为此获得所有站点历史访问；仅创建一个标签页本身并不要求此权限。

[Storage API][storage-api] 可将访问限定到 TRUSTED_CONTEXTS；session 是内存状态，local 用于本机持久化，sync 会跨设备同步。保密模式不能默认把提示词放进 sync 又宣称仅存本机，也不能宣传本地数据对掌控同一浏览器/电脑的人绝对不可读。

## 7. 适配与调研限制

本次读了官方商店、作者仓库/隐私页、部分代码、平台文档及部分 Issues，没有安装第三方成品、做长期压力测试或完整安全审计。星标、用户数、评分和没有公开 Issues 都不能证明可靠性。

维护需要持续核对实际 dot 路由与账号切换、输入选择器、提交确认、冻结、重启及附件。Cue 仓库同时记录新式 form[data-chatgpt-composer] .ProseMirror 与旧 #prompt-textarea；Agent Tincan 为 Dots 单列编辑器。单个旧选择器不能当永久协议。

本项目独立实现，不因调研而声称吸收全部第三方代码。复用时须核对逐文件许可并保留声明；公开仓库、GitHub 指南与允许复用的源码许可不是一回事。同名 brahimhamichan/prompt-later 是 Codex 钩子项目，不能作为商店 Prompt Later 的源码证据。

## 来源索引

全部链接访问于 2026-10-23。商店中的隐私、后台、恢复行为是开发者陈述；浏览器官方 API 是平台约束依据。

[auto-go]: https://chromewebstore.google.com/detail/chatgpt-auto-go/igdhhgcmkacjilplilfoohhknkapfjpe
[prompt-later]: https://chromewebstore.google.com/detail/prompt-later-%E2%80%94-ai-chat-sc/mlcnccgjmdfalcjplophachfjmpmbhal
[prompt-later-privacy]: https://iceyfoxes.github.io/prompt-later-site/privacy.html
[chatsequel]: https://chromewebstore.google.com/detail/chatsequel-chatgpt-auto-c/cdkihfdcmchokmfbpeglffiiknmmjdcj
[ai-sender]: https://chromewebstore.google.com/detail/ai-message-sender/apffdldbkedhimbbmgiafmakjdbflhec
[afterlimit]: https://chromewebstore.google.com/detail/afterlimit-schedule-ai-pr/ioimopgnfnpjhkaogpkeomdiagbmhpaa
[auto-prompt]: https://github.com/yueyueL/Auto-Prompt
[auto-prompt-code]: https://github.com/yueyueL/Auto-Prompt/blob/main/background.js
[supporter]: https://github.com/the-long-ride/ai-chatweb-supporter
[auto-chat]: https://chromewebstore.google.com/detail/chatgpt-auto-chat/fpbogjahcaeiojmjnocfgdogammodjli
[stacker-store]: https://chromewebstore.google.com/detail/prompt-stacker-%E2%80%94-chatgpt/aghgmpdcceanccchafaacmdefmohkame
[stacker]: https://github.com/thegreatLUCY/prompt-stacker
[cue-store]: https://chromewebstore.google.com/detail/cue-prompt-queue-for-chat/cikembdlnlfnbaligkcadpgkidpblnci
[cue]: https://github.com/pranavkale07/cue-prompt-queue
[llm-queue]: https://github.com/pykrete67/prompt-queue-extension
[chat-queue]: https://chromewebstore.google.com/detail/chat-queue-for-chatgpt-cl/oklddkmldemkikacoecmaanmakkplggj
[automator]: https://chromewebstore.google.com/detail/chatgpt-automator/fkgphjfamnianepiekochbanimhieank
[autoflow]: https://chromewebstore.google.com/detail/auto-flow-for-chatgpt/dcbdckhjlpamlgdjkcdhajiaiiahjkie
[queue-chatgpt]: https://github.com/gstohl/queue-chatgpt
[always]: https://github.com/oliveirabruno01/always-continue-ChatGPT
[promptmanager]: https://github.com/jonathanbertholet/promptmanager
[automa]: https://github.com/AutomaApp/automa
[tincan-extension]: https://github.com/mvanhorn/agent-tincan/blob/main/extension/README.md
[tincan]: https://github.com/mvanhorn/agent-tincan
[tabs-api]: https://developer.chrome.com/docs/extensions/reference/api/tabs
[freezing]: https://developer.chrome.com/blog/freezing-on-energy-saver
[edge-performance]: https://support.microsoft.com/en-us/edge/learn-about-performance-features-in-microsoft-edge
[chrome-performance]: https://support.google.com/chrome/answer/12929150
[edge-policy]: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/sleepingtabsblockedforurls
[power-api]: https://developer.chrome.com/docs/extensions/reference/api/power
[alarms-api]: https://developer.chrome.com/docs/extensions/reference/api/alarms
[dots-official]: https://help.openai.com/en/articles/20001530-getting-started-with-your-dot
[active-tab]: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
[storage-api]: https://developer.chrome.com/docs/extensions/reference/api/storage
