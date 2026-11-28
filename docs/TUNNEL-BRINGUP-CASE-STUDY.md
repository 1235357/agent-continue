# 隧道打通实录：从 409 初始化门禁到 Dot/普通 ChatGPT 直连 Windows SSH

- 日期：2026-11-28
- 范围：OpenAI 官方 Secure MCP Tunnel（`openai/tunnel-client`）＋ 本机 `private-mcp` 执行端 ＋ 浏览器端 ChatGPT / Dot
- 结论：**dot 与普通 ChatGPT 对话均已通过官方隧道真实执行本机工具**；`research_ssh` 在 Windows 上经 EasyConnect VPN 直连 WKU 两台 Linux 主机成功，**全程无中转服务器**。

本文记录“为什么失败、怎么定位、最终怎么修好”的完整因果链，供后续维护与二次部署复用。所有结论均对应本机可复查的文件或审计记录。

---

## 1. 目标与边界

目标不是再写一个 MCP 服务器，而是把官方组件**落地成可用链路**：

```
ChatGPT / Dot  ──(HTTPS, OpenAI)──►  OpenAI Tunnel  ──(官方 tunnel-client, stdio)──►  private-mcp (本机)
                                                                                     ├─ windows_status / windows_powershell
                                                                                     └─ research_ssh ──► zye-15 / zye-18 (WKU Linux)
```

硬性边界：

- **严禁中转**：工具调用走 OpenAI 官方隧道，本仓库/本机不引入任何自建转发服务。
- 运行密钥只以 `file:` 路径交给 `tunnel-client`；扩展、对话、日志、提交中都不出现密钥内容。
- 工具调用是“与已登录用户权限匹配的本机能力”，不是沙箱；写入/执行前必须有用户明确授权。
- 设备端（Windows）与对话端（ChatGPT 授权）是两套独立同意，不能互相替代。

---

## 2. 最终可用的运行形态

Windows 本机：

| 组件 | 实际值 / 位置 |
| --- | --- |
| tunnel-client | v0.0.19，detached 常驻进程 |
| profile | `%APPDATA%\tunnel-client\private-research.yaml` |
| state root | `C:\Users\<user>\.local\state\tunnel-client\` |
| 日志 | `logs/private-research.log`（warning 级） |
| 健康地址文件 | `health/private-research.url`（指向本机 `/healthz` 等端点） |
| MCP 子进程 | `node.exe D:\Desktop\服务器反向代理\private-mcp\server.cjs`（单 stdio 实例） |
| 关键开关 | `mcp.stdio_send_initialized_notification: true` |
| 审计 | `private-mcp/state/tool-audit.jsonl`（仅 callId/tool/outcome/pid 等，不含参数与输出） |

执行端 `private-mcp` 暴露 4 个工具：`echo`、`windows_status`、`windows_powershell`、`research_ssh`。

`research_ssh` 的实际命令形态：

```
%SystemRoot%\System32\OpenSSH\ssh.exe -T \
  -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o ForwardAgent=no -o ConnectTimeout=15 <host> sh -s
```

- `host` 白名单：`zye-15`、`zye-18`
- 超时 1–120 秒，超时结果是 `unknown_outcome`，**不自动重放**
- 单互斥锁：并发第二次调用直接返回 “Execution busy”

---

## 3. 卡点总览

| # | 现象 | 真正根因 | 修复 |
| --- | --- | --- | --- |
| 1 | 所有带 id 的 MCP 请求被 409 拒绝，错误码 `-32002 mcp_initialization_required` | 客户端从未发送 `notifications/initialized`，tunnel 的转发门禁一直关闭 | profile 增加 `mcp.stdio_send_initialized_notification: true` |
| 2 | 改了配置但行为不变，健康检查仍连旧进程 | 旧 `tunnel-client.exe` 一直在跑；新进程绑定失败或没被真正使用 | 用 Node 启动器以 detached 方式重启，并核对 `child_generation`/PID |
| 3 | 中文路径下 PowerShell 脚本解析失败、乱码 | Windows PowerShell 5.1 把无 BOM 的 `.ps1` 当 ANSI 读，UTF-8 中文路径被破坏 | 不再走 `-File`，改用 `-EncodedCommand`（UTF-16LE base64）；外層启动器改用 Node/UTF-8 |
| 4 | GitHub Actions / Git Bash 里 `$_`、`$()` 被吞 | Git Bash 先展开 `$` 再交给 PowerShell | 复杂脚本一律经 Node 生成 `-EncodedCommand`，或写文件后执行 |
| 5 | Dot 的 `research_ssh` 报 “Cisco tunnel is not online”，但 VPN 明明已连 | 适配器正则只认 Cisco，实际是 `Sangfor SSL VPN CS Support System VNIC` | 先写失败测试，再扩展 VPN 适配器匹配并保留 fail-closed |
| 6 | 健康状态 “看起来正常” 但工具仍不可用 | 只看了进程存活/端口，没有看 `/health/mcp` 的 `state` 与 `reason_code` | 用 `/health/mcp` 的 `state=initialized|discovered` 作为验收信号 |

---

## 4. 卡点 1：409 初始化门禁（最耗时）

### 现象

隧道在线（`/healthz`、`/readyz` 正常），但任何带请求 id 的工具调用都返回：

```
HTTP 409
{"jsonrpc":"2.0","id":...,"error":{"code":-32002,"message":"mcp_initialization_required", ...}}
```

只有 `initialize`、`ping`、`server/discover` 能通。

### 定位过程

1. 用官方 MCP 客户端直连 `server.cjs`（不经隧道）→ 正常返回 4 个工具，说明**服务端无问题**。
2. 对比官方 `tunnel-client` 的转发日志与源码：`serialized_forwarding_transport.go` 里存在一个“会话门”：
   - 收到 `initialize` 后记录 epoch；
   - 只有收到 `notifications/initialized` 后，才放行带 id 的其他方法；
   - 2026-07-28 无状态协议下还接受 `server/discover` 作为发现入口。
3. 结论：tunnel 侧的 stdio 客户端没有替我们把 `notifications/initialized` 发给子进程，门一直没开。

### 修复

在 profile 里打开官方提供的开关：

```yaml
mcp:
  stdio_send_initialized_notification: true
```

重启后 `/health/mcp` 从 `not_observed`/`failed` 进入 `initialized`（随后 `discovered`），409 消失。

### 经验

- 409 + `-32002` **不是鉴权问题，也不是工具名写错**；先看 `/health/mcp` 的 `state`。
- 只看 TCP 端口或进程存活会误判“隧道已好”。验收标准必须是：`state` 进入 `initialized`/`discovered`，并且真实工具调用有审计记录。

---

## 5. 卡点 2：旧进程占位与“改了没生效”

### 现象

修改 profile 后重启，行为不变；`/health/mcp` 里的 `child_generation`、`initialize_epoch` 不变。

### 根因

- 上一个 `tunnel-client.exe` 没有被替换，仍持有 profile 与单实例 stdio 连接；
- 新启动的实例因端口/锁冲突直接退出，但外层脚本没有检查退出码。

### 修复

- 使用 UTF-8 Node 启动器 `launch-tunnel.cjs`，以 detached 方式启动：
  `tunnel-client.exe run --profile-dir <dir> --profile private-research`
- 重启后核对三件事：
  1. 健康地址文件指向的 `/healthz` 是否为新 PID；
  2. `/health/mcp.child_generation` 是否变化；
  3. 日志尾部是否出现新的 initialize 记录。

### 经验

“一条隧道只允许一个 stdio 实例”。任何“配置改了没反应”，先怀疑旧进程，而不是继续改配置。

---

## 6. 卡点 3/4：PowerShell、编码与路径

### 现象 A：中文路径下脚本执行失败

仓库位于 `D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`，脚本中出现中文或方括号路径时，PowerShell 5.1 解析异常，控制台出现乱码。

根因：PS 5.1 读取无 BOM 的 `.ps1` 时按系统 ANSI（GBK）解码，UTF-8 内容被破坏。

修复：不再依赖 `.ps1` 文件编码，统一用：

```powershell
powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64(UTF-16LE 脚本)>
```

### 现象 B：Git Bash 吃掉 `$_`

在 Git Bash 里内联 PowerShell 单行命令时，`$_`、`$()`、`$env:` 先被 bash 展开，交给 PowerShell 的已是残缺文本。

修复：所有复杂命令由 Node 生成脚本字符串再编码；或写入临时 `.ps1`（UTF-8 with BOM 亦可）后执行。测试与发布脚本中同样遵守此规则。

### 经验

跨 shell 传 PowerShell 代码时，**编码与展开顺序**比命令本身更容易出错。`-EncodedCommand` 同时解决这两个问题。

---

## 7. 卡点 5：EasyConnect 被误判为“VPN 未连接”

### 现象

Dot 调用 `research_ssh` 返回：

```
Research SSH not observed: Cisco tunnel is not confirmed online...
```

但本机 VPN 实际已连接。

### 根因

执行端的 VPN 预检用一个适配器名正则做 fail-closed 判断，只匹配 `Cisco AnyConnect|Cisco Secure Client`；本机实际适配器是：

```
Sangfor SSL VPN CS Support System VNIC
```

于是一个正确的环境被判定为“VPN 离线”，SSH 根本不会发起。

### 修复（先测试后改代码）

1. 在 `execution.test.cjs` 增加用例：
   - Sangfor / Cisco 适配器应被识别为 VPN；
   - `Intel(R) Wi-Fi 6E AX211`、`TAP-Windows Adapter V9 #2` 不应被识别为 VPN；
   - 额外参数、超时 121 秒、`host: '-oProxyCommand=...'` 必须被拒绝。
2. 扩展 `VPN_ADAPTER_PATTERN`：

```
Cisco AnyConnect|Cisco Secure Client|Sangfor SSL VPN|Sangfor VPN|EasyConnect
```

3. 保留 fail-closed：只有确认 VPN 适配器处于 connected 且路由可用时才继续；否则返回明确错误，而不是“跳过检查”。

同时补了 `requireEasyConnect` 路由预检（`native/bootstrap/ssh-preflight.mjs`）：

- 用 `Find-NetRoute -RemoteIPAddress` 查本机出口别名；
- 别名必须等于已连接的 EasyConnect 适配器；
- 否则报 `easyconnect_route_unverified` / `easyconnect_route_mismatch` / `easyconnect_vnic_disconnected`；
- 未启用该选项时也不做 TCP 探测，避免“能连端口就算通过”的假阳性。

### 经验

VPN 名称是环境事实，不是常量。任何“名称白名单”都要有失败用例和明确的失败原因码，避免把“不认识”当成“不可用”。

---

## 8. 卡点 6：如何判断“真的通了”

不要用“进程在”“端口开”“日志没报错”判断。实际验收看三层：

1. **隧道层**：`/health/mcp`
   - `state`：`not_observed → initialized → discovered`
   - `reason_code`、`child_generation`、`initialize_epoch`、`server_discover_epoch`
2. **工具层**：真实调用返回结构化结果（例如 `windows_status` 的 JSON）
3. **设备层**：`private-mcp/state/tool-audit.jsonl` 出现同一 `callId` 的 `started` 与 `succeeded`

---

## 9. 验收证据（2026-11-28）

| 入口 | 调用 | 结果 | 证据 |
| --- | --- | --- | --- |
| Dot | `research_ssh` → `zye-15` | 认证成功，退出码 0 | callId 前缀 `7a125de8` |
| Dot | `research_ssh` → `zye-18` | 认证成功，退出码 0 | callId 前缀 `6d95df97` |
| Dot | `windows_status` | 返回本机状态 JSON | callId 前缀 `340058da` |
| 普通 ChatGPT（标准对话，带 `Private Research MCP` chip） | `windows_status` | 原始 JSON：`{"platform":"win32","uptimeSeconds":232613.484,"totalMemoryBytes":34053414912,"freeMemoryBytes":4164194304,"logicalCpus":24,"pid":35012,...}` | callId `bc14b9f4-...` |
| 设备审计 | 同一 callId | `started` + `succeeded` 两行 | `tool-audit.jsonl` 第 15–16 行，时间 `2026-11-28T11:47:25.868Z` 起 |

补充：

- `windows_status` 的 `pid` 与审计中的 `pid` 一致，说明“对话里的返回”和“本机实际执行”是同一实例，不是缓存或模拟。
- WKU 直连使用 Windows 自带 OpenSSH，`BatchMode=yes` + `StrictHostKeyChecking=yes`，没有交互式密码输入。

> 说明：以上 callId 仅保留前缀用于人工比对；完整值在审计文件中。审计不记录命令参数与输出。

---

## 10. 可复现的最小步骤

1. 准备 `private-mcp`，确认 `node server.cjs` 可被官方 MCP 客户端列出 4 个工具。
2. 在 OpenAI Platform 创建隧道，运行密钥保存在本机文件，只把 `file:` 路径写入 profile。
3. 写入 profile：
   - `command` 指向 `node.exe` 与 `server.cjs` 的绝对路径；
   - `mcp.stdio_send_initialized_notification: true`；
   - 运行密钥使用 `api_key: file:...`。
4. 结束所有旧 `tunnel-client.exe`，用 detached 启动器启动新实例。
5. 检查 `/health/mcp`：`state` 应为 `initialized`（或 `discovered`）。
6. 在 ChatGPT 中创建/选择私有插件（Tunnel 类型，绑定该隧道），分别用普通对话与 Dot 调用只读工具。
7. 在本机审计文件中核对同一 `callId` 的 `started`/`succeeded`。

---

## 11. 仍待完成（与本次打通解耦）

- EasyConnect 断开 → 进程以退出码 3 fail-closed，并验证重连；
- “暂停后重新登录自动恢复”的生产级信号（现有 `authorizeLoginRecovery` 只是授权缝，默认拒绝）；
- 单实例强制、撤销（revoke）与同账号登录恢复；
- Windows 安装包的签名与可信密钥录入；
- 扩展内一键生成 profile（含 `stdio_send_initialized_notification`）。

这些属于“可用性/运维闭环”，不影响本文已验证的直连链路。