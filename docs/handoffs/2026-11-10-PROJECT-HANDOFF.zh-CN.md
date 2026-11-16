# AgentContinue 项目交接：2026-11-10 冻结快照

> 接手入口。先读本文件，再按问题读取历史证据，避免重复走弯路。
> 这是开发交接，不是发布公告、安装包、零缺陷保证或完整私人聊天导出。
> 时间基准：America/Chicago。整理时间为 2026-11-10；逐项证据保留原 UTC 时间。

## 1. 一分钟结论

1. 项目有两条产品主线：后台定时发送，以及普通 ChatGPT / Dot 经官方 MCP 隧道操作 Windows。当前优先修好本地发送，Windows-first 总目标保留；不要转去扩展 Linux 功能。
2. 唯一分支是 `main`。当前 HEAD 和本地 `origin/main` 都是 `c00499f8f0285890cedb39aea0c4b4cf564038f7`。该提交已推送；后续 10 个文件仍有未提交修改，不能说 GitHub 已包含这些修改。
3. `manifest.json` 为 `3.0.12`，根 npm CLI 独立为 `0.3.0`。3.0.12 未发布、未提交商店。现有 3.0.12 ZIP 是较早候选，不含此次后续修复，不能直接上传。
4. 最近实际内置浏览器商店读回为 **3.0.11 Pending review**，英文默认、个人开发者已登录。此前公开版本最后确认是 2.1.0，但本次没有重新核实公开页面；不要混淆公开、待审和本机安装版本。
5. 这不是“已经完全开发完，只差点发布”。当前源码有实质修复和专项回归，但最终组合快照尚无完整回归、当前安装的真实网页发送验收和新的发布回执。
6. 原原生 goal 最新工具读回为 `usageLimited`，不是 `complete`、不是用户暂停，也不是根因已解决。此轮用户要求转为交接整理；不擅自新建替代 goal 或声称已恢复额度。

## 2. 工作位置与外部入口

| 项目 | 路径 / 链接 |
| --- | --- |
| 唯一开发仓库 | `D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo` |
| 本聊天启动目录，非插件仓库 | `D:\Desktop\服务器反向代理` |
| 旧用户加载目录，不可直接覆盖 | `D:\Desktop\Northwestern University MSCS\[Develop]\AgentContinue` |
| 其他同名目录，不能推定为权威副本 | `[Develop]\agent-continue-main` |
| GitHub | <https://github.com/1235357/agent-continue> |
| Releases | <https://github.com/1235357/agent-continue/releases> |
| Issues | <https://github.com/1235357/agent-continue/issues/new/choose> |
| Chrome Web Store item ID | `jpioilmpbolfokedaefmbfbjeaahfdkl` |
| 公开商店 | <https://chromewebstore.google.com/detail/jpioilmpbolfokedaefmbfbjeaahfdkl> |
| 开发者后台 | <https://chrome.google.com/u/1/webstore/devconsole/0b08cfa8-d6ea-4913-b423-582b36114041/jpioilmpbolfokedaefmbfbjeaahfdkl/edit> |
| 开发者邮箱 | `zhentongye2028@u.northwestern.edu` |
| 作者 LinkedIn | <https://www.linkedin.com/in/tony-zhentong-ye/> |

实际环境：Windows；Node `v24.16.0`；Python `3.13.5`；Git。CI 使用 Node 22。根包要求 Node >=22.13.0。
存在一个指向已不存在路径、可清理但本轮未清理的旧 detached worktree 记录；它不是第二主分支。不要因此重建功能分支或删除其他目录。

## 3. 不得丢失的产品要求

### 后台发送

1. 真正后台运行，不切换用户标签、不抢前台、不使用系统剪贴板发送。
2. 发送配置中的完整 prompt，而不是任意现有草稿。替换未发送文字，使用输入区域内的移除控件解除待发附件；不删除账户文件或原始本地文件。
3. 同一已绑定会话内，文字变化、输入框重建、Send 延迟出现、已知未提交的传输异常，都应继续准备和检查，不因这些现象结束本轮。
4. 不设应用级 prompt 字符上限，不设整轮准备/发送回执等待总时限。浏览器资源、账号配额、平台长度和页面可执行性依然存在；不能承诺断网、退出登录或页面冻结时也能被服务器接受。
5. 用户手动 Pause 优先；不得给其他会话发送。已尝试但结果不明的提交不能盲目换一种方法再点一次。
6. 手动发送了本轮已经准备好的准确 prompt 后，当前轮不得继续灌入、移除附件或停止新回复；核对对应的新消息，再记为 `manual-sent`。手动完成和扩展点击分别计数。
7. 配置默认每 20 分钟、无限次数、到点可打断回复；用户已有任务的 prompt、间隔、目标、计数不能在修复时被重置。恢复前必须读真实当前状态。
8. 日志必须可定位阶段、等待原因、实际写入/点击/回执；日志存储故障不能决定发送权限或扣住 Pause。

### Windows 控制

用户要的不是“在线”图标，而是选定普通 ChatGPT / Dot 在知情授权后实际读写文件、执行任意 PowerShell、启动/管理进程。当前账户和管理员为不同权限范围；管理员实际执行子进程必须取得并核对 Windows 高权限令牌。

采用命令安装：Node / PowerShell / CMD，可在同意后下载校验官方 portable Node。不开发自定义 EXE/MSI 安装器；这不等于不能使用 Node、官方隧道客户端等本身的原生可执行依赖。

网页审批、浏览器 nativeMessaging、Windows UAC 和本地连接同意是不同的授权。简化用户体验，不伪造这些授权。安装成功、注册成功、隧道在线、对话可发现工具、工具实际执行、暂停已停止，是不同证据。

### 发布与保护边界

- 只有 `main` 为发布来源；GitHub、商店、文档与实际包要一致。英文默认，中文可切换，用户正文不翻译。
- 项目免费、MIT 开源，突出邮箱、GitHub Issues 和 LinkedIn。
- 不动生产 VPN/MCP/IDE/训练/科研任务，不重载外部 Chrome 原任务。测试用临时文件和自建进程。
- Pause/Revoke 高于恢复；浏览器重开只恢复仍被授权且保存为 running 的意图，不能清除暂停/撤销。
- 未知原生操作按原 ID 查询持久回执，不得重新发一个 Start/Bind 猜测重试；不能复活已撤销的 r11。
- 网页浏览使用内置浏览器。若工具明确拒绝扩展协议，不可换 CDP、OS GUI、浏览器资料文件等绕过；不是让用户再次泛泛授权就能解决。

## 4. 历史发展与为什么反复失败

| 阶段 | 已知推进与教训 |
| --- | --- |
| 0.1 / 0.2，10 月 23 日 | 单会话重复 prompt、Dot、队列/文件、本地 UI。早期内容保护和提交策略后来多次改变，不能照旧文档回退。 |
| 1.0 / 1.1 | 大幅 UI、重启恢复、MAIN/editor 和多方法尝试。部分历史文案夸大保证，不能当成当前事实。 |
| 2.0 / 2.0.1，11 月 1 日 | 检视实际旧日志和代码，区分 unconfirmed 与实际失败；收敛单次提交机制，修包根 manifest / 漏 content.js。 |
| 2.1，11 月 2 日 | 英文默认、中文切换，GitHub / 商店资料同步。 |
| 2.2.0 / 2.2.1 | 开发者支持、schema3 日志和发送保护策略修正；历史稳定制品保留。 |
| Windows 支线 | 由 Desktop Commander Remote 私有化诉求发展，复用开源 provider 和官方 OpenAI runtime-only 隧道，不是 Vercel 免费实例能替代的本机执行器。 |
| 11 月 4 日之后 | 曾走自定义启动器/签名与安全软件审核；用户随后明确不要 EXE/MSI，改为 Node/脚本安装。不要重开签名/EXE 开发支线。 |
| 11 月 6-8 日 | D940、r11 等独立安装取得有限的真实普通 Chat/Dot 管理员命令、文件、进程及部分生命周期证据；各安装证据不得互换。 |
| 3.0.1 后 | Google Yellow Argon 拒绝商店描述的文件格式关键词堆砌。已改简洁英文描述；不能只改代码不改真实商店资料。 |
| 3.0.3 / 3.0.4 后 | 用户仍报告填入不发送、内容变化保护、0 计数。不能把重复报告贬为“小问题”，也不能只把 timeout 删掉就宣称根治。 |
| 3.0.6-3.0.10 | 有些候选/标签未真正发布；曾因测试、原生打包、兼容性问题停止。完整历史查 CHANGELOG 和 dated receipts，不从标签名字推断成功。 |
| 3.0.11，11 月 10 日 | GitHub 已发布，精确 Store ZIP 已提交待审；仍有用户新故障。 |
| 3.0.12，当前 | 许可 ACK 丢失、授权和 dispatch 混淆、手动接管、重挂载、阶段日志与日志阻塞修复；后续 WIP 尚未发布/安装。 |

关键架构事实：DOM 显示文字、页面编辑模型已更新、Send 可用、worker 准许本次提交、真正 dispatch、新消息出现，不能互相替代。页面慢可能是一个因素，但不是目前已证实的唯一根因。

## 5. 现状矩阵：提交、制品、安装、平台分开

| 层 | 最近证据 | 不能由此声称 |
| --- | --- | --- |
| Git main | `c00499f` 已推送，本地 ref 一致 | 本轮 WIP 已在 GitHub |
| 源码版本 | manifest 3.0.12，CLI 0.3.0 | npm 已发布 3.0.12 或商店已更新 |
| GitHub Release | 3.0.11/f104b1a 是最近已核实发布 | 3.0.12 已发布 |
| Store 后台 | 3.0.11 Pending review，英文默认 | Google 已批准或用户自动更新 |
| Store 公开 | 历史最后确认 2.1.0；本轮未重查 | 当前仍必定是 2.1.0 |
| 用户外部 Chrome | 历史截图与日志，当前未改 | 新源码正在用户生产实例运行 |
| IAB 开发扩展 | 历史 ID `hjnopijiekcbgiljjfiekeiepkebhido` | 当前版本/权限/运行状态均已重验 |
| 早期外部候选 ID | `dcahjbghpncachlghgemfgpeggibgmbd` | 与 IAB ID 或正式商店 ID 可通配 |
| Windows 历史安装 | r11 完成过限定生命周期，后已撤销；另有3.0.4限定工具证据 | 当前候选 Pause/Revoke/重开已完成 |

最近旧候选 ZIP（**仅供追溯，已过时，不得直接发布**）：

```text
dist/agent-continue-3.0.12.zip
4a4d1a7d714f8e9d52954957bb31b485cb3cf2ec45c2f3480fc5184aa1ee284e
dist/agent-continue-3.0.12-store.zip
aa327a34795e768ad58e01e1eb5f8c2bba67387b5ddb4a7503ea5fe6577d244f
```

后续源文件已改变，必须完整重建、验证内包和安装后再准备新发布。GitHub 自动 source archive 也不是直接可用的扩展安装包。

## 6. 本轮已定位的具体缺陷

### A. 已在 c00499f 的修复

- 隔离世界已接受最终 GRANT_RUN，但 ACK 丢失/拒绝/不返回，worker 可无限卡在许可交接。修复为同 invocation、token、document 的只读读回，不以 DOM 文字冒充权限。
- 授权阶段被过早视作 dispatch，使尚未提交的同会话 reload 被错误归为未知。已拆分 authorization 与 actual dispatch。
- 手动 Send 后输入框重建、旧 MAIN 监听器仍捕获断开的编辑器，排队重试会再写一次。真实 PM/MV3 case52 RED 为5次写入而预期4次；修复在可信事件同步重取当前 scoped editor/view。
- schema5 每轮日志、手动完成计数、诊断存储与控制队列分离，已在该提交；后续仍发现下面 B 的旧日志路径遗漏。

### B. 当前未提交的实质修复

1. **旧 activity 日志仍会挡住控制队列。** RED：log get/set 拒绝让已提交 Start 返回失败；写入不返回扣住发送完成与 Pause。现有 patch 使用独立活动队列、250ms 诊断观察窗口、健康降级和 Clear epoch。250ms 不是发送总时限。
2. **工具栏 Enter 被误判成手动发送。** 原 MAIN 对整个 composer 的 Enter 都设永久 manualSubmission，附件工具按钮按键也可使0点击、0回执却无限等待。已限定当前 editor/子节点，并排除 prevented/repeat/IME229。
3. **prepared 标志跨编辑器重建错误复用。** 文字相同不代表新 view 完成激活；原逻辑跳过必要 transaction/input/change。现 patch 绑定 editor+composer+view；observe 只读发现变化后走已知未提交的准备恢复。
4. **Clear 双屏障与健康队列。** 独立审查发现等待旧 Clear 后可越过新 Clear，丢失新 epoch 日志；健康持久化不返回会积累闭包。现 patch 加屏障 identity 复核和单写入/最新值合并，覆盖 activity、delivery、health 三种 drain。
5. **Windows 测试夹具污染。** 云端夹具把临时 `Microsoft` 目录当文件入 ZIP。现测试显式注入该目录，并只打包创建时固定文件清单；stub 显式导入 OS 模块。未放宽15秒 launcher watchdog，云端超时是否因此解决仍待新 CI。

这些不是对用户唯一现场根因的全部归因。旧日志不足以回溯手动点击前后完整事件序列或证明 CPU 卡顿来源。

## 7. 当前 WIP 清单

交接前原有 10 个修改文件，全部是 WIP，不得 reset/checkout 覆盖：

```text
CHANGELOG.md
background.js
docs/DEVELOPMENT-HANDOFF.md
docs/RUNTIME-ACCEPTANCE.md
editor-commit.js
tests/background-state-tests.mjs
tests/background-v2-tests.mjs
tests/editor-commit-tests.mjs
tests/hosted-windows-launcher-tests.mjs
tests/prosemirror-keyboard-tests.mjs
```

此交接新增 `docs/handoffs/2026-11-10-PROJECT-HANDOFF.zh-CN.md` 和同目录接手指令。
完整差异及逐文件哈希在交接包 `pending-tracked.patch`、`snapshot-manifest.json`；`source/` 是当前工作树，不是干净 HEAD。

## 8. 验证证据及其边界

| 范围 | 结果 | 适用快照 |
| --- | --- | --- |
| c00499f Extension CI42875070408 | SUCCESS | 不覆盖之后 WIP |
| Native CI42875069957 | Ubuntu/macOS success；Windows failure | 失败于 hosted-launcher3次15s超时，继而夹具目录打包错误 |
| 当前交接快照 background-v2 | **80/80，exit0** | 本轮重新运行；`handoff-20261110-background-v2.log` |
| 当前 editor-commit 单测 | **102/102，exit0** | 本轮重新运行；`handoff-20261110-editor.log` |
| background-state | 60/60，exit0 | 本轮 activity 修复后、最后health合并前；不得说完整最终组合已复验 |
| support/codec/docs | 59/59，exit0 | 本轮 activity 首次修复后，后续无直接修改这些模块 |
| 编辑器 PM/MV3 | 同事报告52-55为4/4，重点选择22/22；三个新增缺陷先各自RED | 已看代码及报告；交接不冒称又完整跑了55/55 |
| hosted-launcher 本地 | 11 pass /1 skip，exit0，约41s | `hosted-fixture-inventory-green.log`；skip为缺少CI专用kit输入 |
| c00499f本地完整npm | exit0；PM52、editor11、integration14、background70等 | 老快照，不覆盖WIP；最终全套必须重跑 |
| 旧 ZIP 提取 PM45-52 | 8/8 | 旧字节，不覆盖新WIP |

云端链接：
- <https://github.com/1235357/agent-continue/actions/runs/42875070408>
- <https://github.com/1235357/agent-continue/actions/runs/42875069957>

原用户日志路径：`D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-activity (3).json`。
当前本机读回仍是46372字节，mtimeUTC `2026-11-10T15:26:25Z`，extension3.0.11；198事件、180 busy、2 unconfirmed、无 sent，最后 paused。不能当成3.0.12或最后手动事件的新日志。本交接包不附该原文件。

## 9. 源码导航与日志读法

| 模块 | 接手重点 |
| --- | --- |
| `background.js` | job/intentVersion、串行权限状态、CHECK/WAIT/COMMIT/GRANT/PAGE_RESULT、重启/目标恢复、三类日志队列 |
| `editor-commit.js` | MAIN公开view写入，prepare/observe/commit、绑定、manual fence和真实dispatch边界 |
| `adapter.js` | ISOLATED页面读取与fallback、准确payload、手动接管和回执确认，不是原生shell通道 |
| `delivery-diagnostics.js` / `activity-export.js` | 固定字段校验，schema5、相对时间、20轮/64变化、隐私过滤 |
| `popup.*` / `i18n*` / `support*` | 英中界面、运行计数、日志和导出；手动/自动完成归属不可混算 |
| `devices.*` / `device-control.js` | 设备状态与控制，不等于对话已授权工具 |
| `setup*` / `current-account-setup.js` | 简化知情安装与当前账户继续连接 |
| `admin-browser.js` / `admin-control.js` / `admin-installation-pause.js` | 管理员保存意图、原ID回执、暂停/撤销/恢复 |
| `native/bootstrap/` / `native/desktop-commander/` | 命令安装、锁定依赖、官方隧道、生命周期/provider |
| `scripts/package.py` | 严格allowlist，成对GitHub/Store载荷一致 |
| `.github/workflows/release.yml` | canonical main/tag、Windows sidecar、全回归、不可覆盖release资产 |

schema5 phases：`page -> prepare -> readiness -> authorization -> dispatch -> receipt`。
看 `modelWrites/domWrites/fillCalls` 是否持续增加，`sendPresent/sendEnabled` 是否改变，grant/readback是否有进展，`dispatchAttempts` 是否为0，是否出现 `manualIntents` 和对应 receipt。同步写入耗时能提示模型写入负担，但不是CPU profiler。
固定字段和聚合轮询是有意设计，不记录prompt/聊天/完整URL/路径/凭据/原始异常。最多20轮/64变化/200活动行；截断与健康字段必须如实读，不可宣称记录所有无限事件。日志不会自动上传。

## 10. 接手后执行顺序

1. 先 `git status`、核对HEAD和交接清单；保留WIP，检查是否有别人继续修改。不要先pull/reset或套用整个旧补丁覆盖同事。
2. 重审 B 的四类逻辑修复及Windows夹具更改；依据RED/GREEN证据，不继续凭“像SSH一样简单”改协议或堆新授权层。
3. 运行完整当前源码测试，记录命令、SHA/文件哈希、exit、pass/fail/skip；不能只看最后十行就标记全部通过。
4. 定位并修复新的 Windows CI 原因，尤其真实 stub 启动的15s超时；不要因本机通过就把失败当绿。不要盲增预算或削弱权限/路径校验。
5. 修正文档版本漂移：目前README顶端仍写3.0.11 candidate；旧history段落的preserve drafts/schema3等已过时。遵循本文件最新要求，保留历史但标明已取代。改公共包内文档须重新打包/哈希。
6. 冻结唯一main源码，完整测试+独立审查后提交/推送。重新构建新成对包，校验实际包中全部改动和依赖闭包。禁止使用上述旧3.0.12字节。
7. 通过支持且被允许的内置浏览器路径，在普通无害测试chat先做真实后台发送；验证覆盖草稿/移除待发附件/延迟Send/输入框remount/手动发送后不再注入/Pause/计数。若平台明确拒绝扩展页面操作，须让用户完成那个具体动作，不能绕过。
8. 只在独立验收安装测试Windows管理员命令、临时文件、自建进程、Pause/Revoke及完整浏览器退出后保存running恢复。r11/旧3.0.4结果不能替代新绑定。
9. 发布不可覆盖的新版GitHubRelease，下载实际资产重核SHA和载荷；取得真实release URL。npm是独立交付状态，不能凭GitHub tgz声称npm已上架。
10. 最后在内置浏览器重读当前商店状态。若需要取消旧待审版本换新修复包，依据已有同范围授权和当前状态判断；别在包未准备好前先取消。上传精确StoreZIP、核对英文资料/隐私/权限/审核说明，保存提交回执。提交不等于通过。
11. 只有实际发布与审核提交回执及验收条件都满足，才按goal完成标准收尾。不保证Google批准时刻，不给用户无限“已完成”假象。

## 11. 复现命令（不安装、不授权、不连生产隧道）

```powershell
Set-Location -LiteralPath 'D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo'
git status --short --branch
node --version
python --version
node tests/background-v2-tests.mjs
node --test tests/editor-commit-tests.mjs
node tests/background-state-tests.mjs
node --test tests/delivery-diagnostics-tests.mjs tests/support-tests.mjs tests/public-documentation-tests.mjs
node --test tests/hosted-windows-launcher-tests.mjs
```

```powershell
# 完整回归耗时较长。新机器先按锁文件准备开发依赖与bundled PDF资源。
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run vendor
npm.cmd run test:pdf-vendor
npx.cmd playwright install chromium
npm.cmd test
python -B -m unittest discover -s tests -p test_package.py
python -B -m unittest discover -s tests -p test_release_source.py
python -B -m unittest discover -s tests -p test_release_installer_pin.py
```

PM定点：`$env:TEST_PM_CASES='52,53,54,55'; node tests/prosemirror-keyboard-tests.mjs`；结束后移除该环境变量再跑全套，避免误把选择测试写成55/55。
这些是临时合成浏览器fixture，不能用来绕过真实浏览器禁止的扩展页面读取。

## 12. 交接包范围及已知未完成

- 包含当前完整Git跟踪源码、未提交补丁、新交接文档、代码历史文本、固定选取的合成测试日志、逐文件SHA256与Git状态。
- 不包含node_modules/npm缓存、整个.artifacts、dist旧候选、任何密钥/密码、浏览器profile/cookies、私聊正文、原用户日志、生产/科研运行状态；不把交接包公开上传为用户安装包。
- 源码快照支持离线查看/比较；依赖重装和完整历史获取仍需GitHub/npm等网络或另行准备可信缓存。不是“全量私密聊天/全部环境/全部依赖离线镜像”。
- 最新WIP未完整回归、未提交/推送、未重建最终包、未安装当前用户实例、未完成新版本生命周期实测、未新发Release或商店审核。
- 内置浏览器当前能访问Store网页，但扩展协议访问曾明确被拒绝。不要反复问泛泛权限、不要误报浏览器不可用，更不要绕过工具限制。
- 新goal接手应先读取当前原goal。此时是usageLimited；工具不能擅自把它恢复active或以交接完成冒充产品完成。

## 13. 历史材料阅读顺序

1. 本文件与同目录 `COLLEAGUE-PROMPT.zh-CN.md`。
2. `docs/DEVELOPMENT-HANDOFF.md` 顶部最新段落，按日期定位旧段落；较新事实覆盖相冲突历史。
3. `docs/RUNTIME-ACCEPTANCE.md` 对应安装/版本/操作ID的证据，不跨安装借用。
4. `docs/COMPOSER-PRIORITY.md`、`PRIVACY.md`、`VALIDATION.md`。
5. `native/README.md`、`native/bootstrap/README.md`、`SETUP-DESIGN.md`与原生设计文档。
6. `CHANGELOG.md`、成对包检查器、release workflow。老文案中的绝对可靠性陈述不是验收结论。

交接原则：先让用户当前不可用的核心发送真正恢复，再闭环Windows真实控制和正式发布；不要用更复杂的框架、更多候选编号、更多“授权成功”替代用户可见的实际结果。
