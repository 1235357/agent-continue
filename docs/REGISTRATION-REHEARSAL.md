# Registration Rehearsal (document only)

Prepared 2026-11-04. **Nothing in this document was executed when it was written.**
No registry value was added or deleted, no installer ran, no host started and no
Chrome profile was modified. The commands below are the literal plan output of
`registrationPlan`; they exist so a human can decide whether to run them.

Scope: one per-user Chrome native-messaging registration on Windows for
`com.agentcontinue.device_control`. Out of scope: machine-wide (`HKLM`) writes,
elevation, Chrome launch, installation, tunnel, MCP and chat authorization.

## 1. What this rehearsal is, and what it is not

It is: showing the exact registry key and value, recording who authorized the
write, performing the two-view write, then proving with read-only commands that
the value matches and that nothing else changed.

It is not: installing the product, starting a resident owner or tunnel, editing
an existing Chrome profile, changing policy, adding a service, scheduled task,
startup entry or firewall rule. If any step seems to require one of those, stop.

## 2. Preconditions, all read-only

Run these first and stop on any mismatch.

| Check | Command | Expected |
| --- | --- | --- |
| Manifest exists | `Test-Path -LiteralPath "<INSTALL_ROOT>\native-host.json"` | `True` |
| Binding exists | `Test-Path -LiteralPath "<INSTALL_ROOT>\app\device-native-binding.json"` | `True` |
| State root is private | `(Get-Item -LiteralPath "<INSTALL_ROOT>\state").FullName` | an absolute path, not inside the repo or a synced folder |
| Extension id matches | compare the binding `extensionId` with the id shown at `chrome://extensions` | identical 32-character id |
| Manifest origin | `allowed_origins` must be exactly `["chrome-extension://<EXTENSION_ID>/"]` | one element, trailing slash, no wildcard |
| Key is untouched | `reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:32` | exit 1, "unable to find" (a missing key is the expected pre-state, not an error) |

`<INSTALL_ROOT>` and `<EXTENSION_ID>` are placeholders. Substitute locally; never
commit the substituted values, and never type a private key or runtime key into
any command in this document.

Read-only state report:

```text
node native/bootstrap/bin.mjs status --install-dir "<INSTALL_ROOT>" --json
node native/bootstrap/bin.mjs verify --install-dir "<INSTALL_ROOT>"
```

`status` always exits 0 and reports `registered` as
`not-registered | registered | drift | error | unknown` (registration is per-user:
only the two HKCU views decide it, HKLM is `not-applicable`); before the
rehearsal it must be `not-registered` (or `unknown` if a view cannot be queried —
that is a stop condition, not a pass). `verify` exits 0 only when no check fails;
`SKIP` is not a failure.

## 3. Who authorizes, and when

The write is gated twice, independent of this document:

1. **Two approvals**, each bound to the exact `keyPath`, `regSzValue`, `hive` and
   `view`, issued by two *distinct* issuer ids (`duplicate_approver` if the same
   issuer signs twice). Default lifetime 120 s; an expired grant fails as
   `expired_approval`.
2. **One consent**, bound to the same four fields, default lifetime 300 s, and
   valid only when the caller echoes the exact `keyPath` and `regSzValue`
   (`echo_mismatch` otherwise); a changed field fails as `consent_mismatch`.
3. `execute` defaults to false. Without `execute: true` the call only returns
   `{ executable: "reg.exe", args }` and writes nothing.

The assistant cannot self-issue both approvals. The practical rehearsal needs
(a) your explicit statement that this key and value may be written now, and
(b) a second, independent confirmation from another person or a separately
recorded session. Grants live in process memory only; **revoking is simply
discarding or letting them expire**. There is no persisted token to clean up.

Current limitation, stated plainly: the repository has a read-only registry
adapter but **no shipped write adapter**. A rehearsal is therefore either the
two `reg add` commands below run by you, or a newly reviewed adapter — not
something this document performs.

After the write, this changes on the computer: one registry key with one default
`REG_SZ` string pointing at `native-host.json`. No file is copied, no process is
started now, nothing auto-runs at login, no tunnel and no MCP is installed.
Chrome may later launch the referenced host script when the extension asks for a
native connection; that host can then read and write its binding and state root.

## 4. Exact write plan

Key path, both views (identical string; the view flag selects the registry view):

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control
```

| Hive | View | Value name | Type | Data |
| --- | --- | --- | --- | --- |
| HKCU | 32 | default (`/ve`) | `REG_SZ` | `<INSTALL_ROOT>\native-host.json` (absolute, placeholder) |
| HKCU | 64 | default (`/ve`) | `REG_SZ` | `<INSTALL_ROOT>\native-host.json` (absolute, placeholder) |

Commands, shown not run:

```text
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /t REG_SZ /d "<INSTALL_ROOT>\native-host.json" /f /reg:32
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /t REG_SZ /d "<INSTALL_ROOT>\native-host.json" /f /reg:64
```

Before either command, the console must display: hive, view, key path, value name
`(Default)`, type `REG_SZ`, and the exact absolute manifest path — the same four
fields the approvals are bound to. If the displayed text and the approval differ
in any character, do not continue.

`HKLM` is intentionally excluded: it needs elevation, affects all users and is a
separate decision.

## 5. Rollback, and proving it is clean

Only roll back what this rehearsal created. If the pre-check already found a
value, stop and attribute it instead of deleting someone else's registration.

```text
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /f /reg:32
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /f /reg:64
```

Confirm clean (both must report the key is absent, exit code 1):

```text
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:32
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:64
```

Then re-run `status --json`: `registered` must be `not-registered`, and
`installed`, `binding` and `hostStartable` must be unchanged from the pre-check.
If the same value existed before the rehearsal, the writer never overwrites it
(same value reports `already-present`); a different existing value is a conflict
and must not be replaced without a new decision.

## 6. Post-write read-only verification

```text
node native/bootstrap/bin.mjs status --install-dir "<INSTALL_ROOT>" --json
node native/bootstrap/bin.mjs verify --install-dir "<INSTALL_ROOT>"
```

Expected `status --json` (exit 0):

```json
{"format":"agent-continue-registration-status","version":1,"root":"<INSTALL_ROOT>",
 "installed":true,"binding":"present","registered":"registered","hostStartable":true,
 "failed":0,"counts":{"pass":N,"fail":0,"skip":M}}
```

`N`/`M` depend on which optional files exist; what matters is `registered:
registered`, `failed: 0` and exit 0. Expected `verify`: every check `PASS` or
`SKIP`, `fail=0`, exit code 0. A missing key shows as `registered:
not-registered`; a different value shows as `drift`; an unreadable view shows
`unknown` — all exit 0 for `status` and must not be read as success.

**If `verify` has any FAIL, roll back first and diagnose second.** Do not
"repair" by overwriting the value, and do not delete keys you did not create.

A green rehearsal means only that the value is present, consistent and readable.
It does not prove that Chrome accepts the origin, that the host completed a
handshake, that a tunnel is live or that chat tools are authorized.

## 7. Failure modes: how to recognize, how to attribute, what not to do

**Enterprise policy blocks native messaging.** Read-only checks:

```text
reg query "HKLM\Software\Policies\Google\Chrome\NativeMessagingAllowlist" /ve
reg query "HKLM\Software\Policies\Google\Chrome\NativeMessagingBlocklist" /ve
```

If an allowlist exists and this host name is absent, or the blocklist contains
it, policy outranks the per-user key. Attribute to policy, hand it to your
administrator, and stop. Never edit or delete policy keys to "test" around it.

**Defender or EDR interferes.** Symptoms: `reg add` returns "Access is denied"
although a per-user write normally succeeds, the command is quarantined, or a
security notification appears. Check Windows Security → Protection history for a
matching event and attribute it there. Do not disable real-time protection,
exclusions or ASR rules; stop and ask.

**Chrome does not accept the origin.** Distinguish the two messages in the
extension's service-worker console:

- "Native messaging host com.agentcontinue.device_control is not found" —
  registration or path problem: re-check both views and that the `REG_SZ` path
  exists and is absolute.
- "Access to the specified native messaging host is forbidden" — origin
  mismatch: compare the real extension id at `chrome://extensions` with the
  binding `extensionId` and the manifest `allowed_origins`.

Fix an origin mismatch by reissuing the binding and manifest through the setup
flow, never by widening `allowed_origins` to a wildcard or by editing the
registry value in place. Fully quit and restart Chrome before retesting so a
stale process cannot mask the result.

**Anything unexpected** — a pre-existing value, an elevation prompt, an unknown
key path, a changed manifest hash, a non-`not-registered` pre-state — is an abort.
Roll back only what was created, record the observation, and stop.

## 8. Checklist

1. Read sections 2–4 aloud with the other approver; confirm the four bound fields.
2. Capture the pre-state (`status --json`, both `reg query` results).
3. Obtain the two distinct approvals and the consent within their lifetimes.
4. Display hive, view, key path, `(Default)`, `REG_SZ`, absolute manifest path.
5. Run the two `reg add` commands (or the reviewed adapter with `execute: true`).
6. Run `status --json` then `verify`; require exit 0 and `registered`.
7. If anything fails, run both `reg delete` commands, then re-run `status` and
   both `reg query` checks, and record `not-registered`.

## 实测记录：2026-11-04（真实 HKCU 写入，已授权）

不在测试内模拟；本节是这台机器上的真实执行记录。

### 1. 自持开发者密钥与扩展 ID 派生

- 生成：`node native/dev-identity.mjs`（RSA-2048，私钥 `native/dev/extension-key.pem`，被 `.gitignore` 的 `native/dev/` 覆盖；不进入 `dist/`，不打印私钥）。
- `manifest.json` 的 `key` = base64(DER/SPKI)，长度 392 字符。
- 派生：`sha256(DER/SPKI)` = `af96ca0aabf379c1507ba556a2f741a2985b118308ed2d1b2a0792b23230e519`；取前 16 字节（32 个 hex 字符）逐位映射 `0..9a..f -> a..p`：
  `af96ca0aabf379c1507ba556a2f741a2`（hex）→ **`kpjgmkakklpdhjmbfahlkffgkcphebkc`**。
- 扩展加载侧的复核方式：打开 `chrome://extensions` 的“开发者模式”，选择“加载已解压”，应显示该 ID；若显示不同，说明 `key` 未被读取，以实测为准。

### 2. 注册前只读状态

```
reg query HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control /ve /reg:64
→ ERROR: The system was unable to find the specified registry key or value.  exit=1
reg query ... /ve /reg:32
→ ERROR: The system was unable to find the specified registry key or value.  exit=1
```

### 3. 精确目标（dry-run 与 install-plan 一致）

```
keyPath    = HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control
(Default)  = REG_SZ
data       = C:\Users\zye12\AppData\Local\AgentContinue\native-host.json
views      = /reg:64 与 /reg:32
```

`native-host.json` 已写作 `allowed_origins: ["chrome-extension://kpjgmkakklpdhjmbfahlkffgkcphebkc/"]`。

### 4. 真实写入（两条 reg add，经双授权 + 执行回读）

```
node native/bootstrap/bin.mjs register --os windows --install-dir %LOCALAPPDATA%\AgentContinue \
  --extension-id kpjgmkakklpdhjmbfahlkffgkcphebkc --view 64 --execute --consent accept-install \
  --approver-a operator --approver-b agent-continue-installer
→ {"mode":"executed","status":"written","view":"64"}  exit=0

node ... --view 32 --execute --consent accept-install ...
→ {"mode":"executed","status":"already-present","view":"32"}  exit=0
```

`view=32` 返回 `already-present` 是**实测事实**：`HKCU\Software` 未做 WOW64 重定向，两个视图落在同一物理键，因此第二条写入读到的就是第一条刚写的值（不是被跳过，也不是冲突）。

### 5. 写入后逐字节回读

```
reg query ... /ve /reg:64 → (Default) REG_SZ C:\Users\zye12\AppData\Local\AgentContinue\native-host.json  exit=0
reg query ... /ve /reg:32 → (Default) REG_SZ C:\Users\zye12\AppData\Local\AgentContinue\native-host.json  exit=0
```

两次回读与 `regSzValue` 完全一致，无回滚。

### 6. status / verify（同一份真实状态）

```
node bin.mjs status --json --install-dir %LOCALAPPDATA%\AgentContinue
{"installed":false,"binding":"missing","registered":"unknown","hostStartable":false,
 "failed":6,"counts":{"pass":2,"fail":6,"skip":5}}   exit=0

node bin.mjs verify --install-dir %LOCALAPPDATA%\AgentContinue
VERIFY RESULT pass=2 fail=6 skip=5                   exit=1
```

`registered:"unknown"` 而非 `registered` 的原因是可复核的：`precheckInstall` 在读注册表前要求 `binding`，而本机尚未 stage（`installed:false`、`binding:missing`），因此四条 registry 检查被 `SKIP`。**这不否定写入**；它说明“注册表值已写但与安装态尚未对齐”。

### 7. 结论边界

- 已写入：是（两条 `/reg:64` 与 `/reg:32`，exit=0）。
- 已回读一致：是（两视图输出与 REG_SZ 相同）。
- 已证明（见第 8 节）：Chrome 156 用 `key` 派生出同一 ID；同一 ID 的 `connectNative` **没有** 被 origin 拒绝（只有 `path` 指向的 exe 不存在时才报 not found）。
- 尚未证明：真实 `native-launcher.exe` 存在时的握手（host 尚未构建/签名）；`status` 能否报 `registered`（需先完成 stage 与 binding，且安装布局需先统一）。
- 回滚方式（如需）：两条 `reg delete ... /ve /f /reg:64|32`，然后 `reg query` 应回到 exit=1。

### 8. Chrome 端实测（2026-11-04，同一台机器，Chrome 156.0.8078.74）

三次探针都用**一次性 profile**（`$env:TEMP` 下临时目录，跑完即删），没有触碰用户正在使用的 Chrome profile，也没有新增注册表键。探针脚本用完即删，命令与输出如下。

**探针 1：Chrome 自己派生出的 ID**

```text
chrome --headless=new --user-data-dir=<TEMP profile> --remote-debugging-port=<port> \
       --load-extension="<repo>" about:blank
CDP: Extensions.loadUnpacked { path: "<repo>" }
→ {"id":"kpjgmkakklpdhjmbfahlkffgkcphebkc"}
```

判定：Chrome 读 `manifest.json` 的 `key` 后，派生结果与文档第 1 节的计算**逐字符相同**。这是 Chrome 自己的解析器给出的回答，不是我们的复算。

**探针 2：同 ID 的 `connectNative` 是否被 origin 拒绝**（临时扩展同样使用该 `key`，`permissions:["nativeMessaging"]`，只调用一次 `connectNative`）：

```text
（此时 manifest path = C:\Users\zye12\AppData\Local\AgentContinue\native-launcher.exe，该文件不存在）
CDP: Runtime.evaluate connectNative 'com.agentcontinue.device_control'
→ "disconnected:Specified native messaging host not found."
```

判定：不是 `forbidden` —— 说明 origin 检查没有被触发为拒绝；但 host 查找确实失败。为区分“找不到 host”与“origin 被拒”，做了探针 3。

**探针 3：把 `path` 换成确实存在的 PE（`C:\Windows\System32\cmd.exe`）后再连一次**

```text
manifest path 临时改为 C:\Windows\System32\cmd.exe（sha256 d79e2221…bf09c31）
→ "disconnected:Error when communicating with the native messaging host."
```

判定：这是**决定性的**。同一个 `allowed_origins`、同一个 ID、同一个注册表键，只把 `path` 从“不存在的 exe”换成“存在的 PE”，错误就从 `not found` 变成“通信失败”。因此：

1. Chrome 找到了注册表项，读到了 manifest，并且**接受了这个 origin**（否则会是 `Access to the specified native messaging host is forbidden.`）。
2. 当前生产态之所以是 `not found`，原因是 manifest 的 `path` 指向一个尚不存在的 `native-launcher.exe`；Chrome 156 对不存在的宿主文件报 `not found`，而不是 `failed to start`。
3. `Error when communicating with the native messaging host` 是 `cmd.exe` 不懂 stdio 协议导致的，属于预期，不是注册问题。

**探针后已完全还原**：`native-host.json` 逐字节还原，`sha256 3a82df2617067ab534f451e2f9b84b6fcce4a9532cd4a105657a6f6cbcccffa8` 与改动前一致；临时 profile、临时扩展、临时探针脚本全部删除；注册表值未动。

**另外修正了一处产物缺陷**：该文件最初由 PowerShell `ConvertTo-Json` 写出，带 UTF-8 BOM（首三字节 `EF BB BF`）。已改写为无 BOM 的 UTF-8（首字节 `7B`），JSON 内容与 `allowed_origins` 未变；注册表 `REG_SZ` 仍指向同一路径，因此两条经授权的写入不受影响。

### 9. 布局收口 + 本地构建 + 端到端握手（2026-11-04，第二轮实测）

#### 9.1 唯一口径：`<root>\native-host.json` + `<root>\native-launcher.exe` + `<root>\app\`

以**已写入的注册值**为准做决定：`REG_SZ = C:\Users\zye12\AppData\Local\AgentContinue\native-host.json`，即 manifest 在安装根，launcher 就是该 manifest 的 `path`（也在根），运行时文件继续放 `app\`。

三个候选布局里，`native-launcher.test.mjs:232` 的既有断言、以及 precheck 的 manifest 校验本来就是“根目录 manifest + 根目录 exe”，所以 `install-plan` 的 `bin\native-launcher.exe` 与 `runtime-precheck` 的 `app\native-host.json` 才是两处离群值。收口方式是把这两处改成根目录口径，注册值**不需要重写**：

```text
reg query ... /ve /reg:64 → (Default) REG_SZ C:\Users\zye12\AppData\Local\AgentContinue\native-host.json   exit=0
reg query ... /ve /reg:32 → (Default) REG_SZ C:\Users\zye12\AppData\Local\AgentContinue\native-host.json   exit=0
```

代码同步（不 commit）：

| 文件 | 改动 |
| --- | --- |
| `native/bootstrap/install-plan.mjs:50` | Windows launcher 由 `bin\native-launcher.exe` 改为 `native-launcher.exe` |
| `native/bootstrap/runtime-precheck.mjs:163` | manifest 由 `app\native-host.json` 改为根 `native-host.json` |
| `native/bootstrap/packed.test.mjs:826` | 夹具 manifest 落根目录 |
| `native/bootstrap/packed.test.mjs:334` | `help` 契约补上上一轮新增的 `register/status/verify` |
| `native/bootstrap/registration-status.test.mjs` | 夹具 manifest 落根、`path` 指向根目录 exe |
| `native/desktop-commander/runtime-precheck.test.mjs` | 同上 |
| `docs/INSTALL-DESIGN.md`、`docs/RUNTIME-ACCEPTANCE.md`、本文上半部分示例 | 路径统一为根目录口径 |

测试：`registration-status.test.mjs`、`runtime-precheck.test.mjs`、`install-plan.test.mjs` 全绿；`packed.test.mjs` 在补上 `help` 契约后整轮复跑 **tests 7 / pass 6 / fail 0 / skipped 1**（跳过的是 `AGENT_CONTINUE_REAL_CACHE` 未设置的 opt-in 项）。

#### 9.2 构建 `native-launcher.exe`（真实构建，未签名）

```text
Build-NativeLauncher.ps1 -OutputPath  <root>\native-launcher.exe
                         -ManifestPath <root>\native-host.json
                         -NodePath     C:\Program Files\nodejs\node.exe
                         -HostScriptPath <root>\app\device-native-host.mjs
                         -ExtensionId kpjgmkakklpdhjmbfahlkffgkcphebkc
build_exit=0
launcher sha256 = 63dedd679281ccf9a1f1540d611610a5e8a7b6aa1686a55938ac66a4d5dc0f90, size = 15872
manifest sha256 = e1e3b84726a0c61cad2dbd5e3b28dd9fa40a805d962436857c2619c441451799
manifest = {"name":"com.agentcontinue.device_control", ..., "path":"C:\\Users\\zye12\\AppData\\Local\\AgentContinue\\native-launcher.exe",
            "type":"stdio","allowed_origins":["chrome-extension://kpjgmkakklpdhjmbfahlkffgkcphebkc/"]}
```

构建前把旧 manifest 备份并删除（脚本以 `CreateNew` 写 manifest，要求文件不存在），由脚本重写；对照后五个字段与真实 ID 完全一致，注册值指向的路径未变。

#### 9.3 Defender 实际反应（事实，不做取舍）

```text
launcher_exists=True
threat_detections_1h=0                     (Get-MpThreatDetection，近 1 小时)
Get-WinEvent ... 'Windows Defender/Operational' Id=1116,1117 近 1 小时 → "No events were found"
```

即：本次 CodeDom 编译出的 15872 字节 GUI PE **没有被隔离、没有被删除、没有 1116/1117 事件**。这和“需要签名或申诉”是两个不同层面的结论——本轮只证明“这一次构建在本机未被拦”，未证明“在其他机器/后续扫描不会被拦”，也未验证签名链路。是否签名或申诉由用户决定，本轮两者都没做。

#### 9.4 端到端：真实扩展 → Chrome → launcher → host → owner

一次 `connectNative`/`sendNativeMessage`，副产物同时做了两条路径：

| 路径 | 结果 |
| --- | --- |
| 进程级（`<root>\native-launcher.exe` + `<origin>`） | **exit=0**，**恰好 1 帧**，`id` 回显 `e2e-launcher-1`，`action` 回显 `status`，`ok=true`，`state` 键 = `["connection","paused"]` |
| Chrome 156.0.8078.74（一次性 profile，`Extensions.loadUnpacked`） | `loadedId = kpjgmkakklpdhjmbfahlkffgkcphebkc`；`sendNativeMessage` 收到 1 帧：`{"version":1,"id":"ui-status-e2e","action":"status","ok":true,"state":{"paused":true,"connection":"disconnected"}}`，`lastError=null` |

帧协议是 **4 字节小端长度前缀 + JSON**，不是按行分隔。第一次用换行分隔的帧探针得到 `device_bridge_unavailable`（host 的 catch-all 把 `invalid_device_frame` 吞掉了），改用长度前缀后立刻 exit 0；这条差异值得写进任何后续手工探针。

边界：Chrome 侧用到的扩展是仓库代码的拷贝（**同一 `key`、同一 ID、同一 `device-control.js`**），唯一差异是把 `nativeMessaging` 从 `optional_permissions` 移到 `permissions` —— 无头 Chrome 无法弹出可选权限授权框。真实 `optional_permissions` 声明下需要用户在扩展页面点一次授权，这一条仍未验证。owner 用的是 stub controller（`{paused:true, ready:false, runtime:'stopped'}`），不是真实 lifecycle controller，也没有隧道与 chat 授权。

#### 9.5 `status --json` 与 `verify`

```text
status --json  {"installed":false,"binding":"present","registered":"partial","hostStartable":true,
                "failed":1,"counts":{"pass":12,"fail":1,"skip":0}}    exit=0
verify         VERIFY RESULT pass=12 fail=1 skip=0                     exit=1
FAIL runtime_files: hash mismatch: package.json
```

`runtime_files` 失败是**参照目录默认值**的问题，不是 staging 错误：`app\package.json` 的 sha256 与 provider（`native/desktop-commander/package.json`）相同，而 precheck 默认拿自身所在目录（`native/bootstrap`）做参照，所以只有 `package.json` 一个文件对不上。真实安装时这个参照应该指向“已验证的 provider 副本”，CLI 目前没有传参入口——这是本轮新发现的缺陷，未修。

`registered:"partial"` 同理：precheck 统计 `HKCU/32、HKCU/64、HKLM/32、HKLM/64` 四个视图，而 per-user 安装只写 HKCU（本机两视图还是同一物理键），HKLM 恒为 absent，于是永远只能得到 `partial`。也是新发现缺陷，未修（是否需要把 HKLM absent 记为正常，需要产品口径）。

#### 9.6 仍未证明 / 本轮遗留

1. 真实 `optional_permissions` 授权路径（用户点一次授权后 `connectNative` 可用）。
2. 签名与否的实际影响：本轮构建没有被 Defender 拦，但未在其它机器复现，也未走签名/申诉。
3. 真实 owner（lifecycle controller + 隧道 + chat 授权）下的 `status` 帧；本轮 `state` 来自 stub controller。
4. `runtime_files` 的参照目录接线、`registered` 的 HKLM 语义 —— 两处新缺陷，需先定口径再改。

### 10. 口径落定 + 0 fail + 真实 owner 一帧（2026-11-04，第三轮实测）

以上 9.5/9.6 的两处缺陷已按产品语义定案并实现，9.5 的数字与 9.6 的第 4 条作废，保留为历史记录。

#### 10.1 `runtime_files`：安装根自己的 payload 清单是唯一真值

| 位置 | 改动 |
| --- | --- |
| `native/bootstrap/bootstrap.mjs` | staging 在写完 `app\` 并校验后，以 `CreateNew` 把包根的 `payload-manifest.json` 逐字节复制到 `<root>\payload-manifest.json`（mode 0600） |
| `native/bootstrap/runtime-precheck.mjs` | `readPayloadManifest(file)`：要求 canonical JSON+换行、`format=agent-continue-payload`、`version=1`、每条记录恰好 `{path,bytes,sha256}`、相对路径、无重复；比对同时校验**字节数与 sha256** |
| 同上 | 缺省参照 = `<root>\payload-manifest.json`；`options.reference` 只接受**绝对路径的清单文件**，不再有任何目录猜测；清单缺失/非法 → `FAIL payload manifest: ...` |
| `native/bootstrap/registration-status.mjs` | `status|verify` 增加 `--reference <abs-path>`（相对路径直接 `invalid_arguments`） |
| `native/desktop-commander/runtime-precheck.test.mjs` | 夹具改为“写 manifest + 校验”模式；新增负例：篡改 `device-native-host.mjs` → `FAIL hash mismatch: device-native-host.mjs expected bytes=… sha256=… actual bytes=… sha256=…`；同长度改写 `device-owner.mjs` 也 FAIL（证明不是只比长度）；`--reference` 覆盖生效；缺清单/坏清单 FAIL |

9.5 里“只报 `package.json` 一个”的原因得到解释：默认参照是 `native/bootstrap` 目录，17 个文件里只有 `package.json` 在该目录存在，其余全部落入“无参照”分支，因此比对集合本身是错的；现在 17 个文件全部参与比对。

#### 10.2 HKLM：per-user 设计，不是缺陷

| 行为 | 现在 |
| --- | --- |
| `registry:HKLM/32`、`registry:HKLM/64` | 恒为 `SKIP`，`kind=not-applicable`，理由 `not applicable: per-user install never writes HKLM`；若发现残留值，仅在理由里追加 `residual with the same value (informational)` / `residual with a different value (informational)`；查询失败也只作为信息 |
| `registered` | 只由 `HKCU/32`、`HKCU/64` 决定，取值收敛为 `registered \| not-registered \| drift \| error \| unknown`；`partial` 已从代码、视图文案与测试中删除 |
| 一个 HKCU 视图匹配、另一个缺失 | `drift`（不一致写入），仍是允许的枚举值，不再是“部分注册” |

#### 10.3 真实安装根：manifest 补齐 + 0 fail

17 个 `app\` 文件与 `native/desktop-commander` 逐字节一致（0 mismatch），据此生成安装根 manifest：

```text
manifest_written=C:\Users\zye12\AppData\Local\AgentContinue\payload-manifest.json
files=17  manifest_sha256=a0e3e5b56cf37409fab9ba57b24a5b828a597cab7455e93f6c1dd41464dcb58f

status --json  {"installed":true,"binding":"present","registered":"registered","hostStartable":true,
                "failed":0,"counts":{"pass":11,"fail":0,"skip":2}}   exit=0
verify         PASS runtime_files: 17 files match the payload manifest <root>\payload-manifest.json
               PASS registry:HKCU/32: registered; default value matches the manifest path
               PASS registry:HKCU/64: registered; default value matches the manifest path
               SKIP registry:HKLM/32: not applicable: per-user install never writes HKLM
               SKIP registry:HKLM/64: not applicable: per-user install never writes HKLM
               VERIFY RESULT pass=11 fail=0 skip=2                        exit=0
```

`verify` 首次合法到达 **0 fail**（skip=2 就是两条 HKLM 信息项）；注册表未重写、未回滚。

#### 10.4 真实 owner lifecycle 的一帧 `status`

`native/desktop-commander/runtime-acceptance.mjs` 本来就是真实 `startDeviceOwner` + 真实 host + 一帧 `status`，本轮补上回执打印，并新增 `--resume` 以区分“真实控制器状态”与“常量”：

```text
node native/desktop-commander/runtime-acceptance.mjs
  host_status_reply={"version":1,"id":"acceptance-a6074a7e9e65","action":"status","ok":true,
                     "state":{"paused":true,"connection":"disconnected"}}
  RESULT pass=12 fail=0

node native/desktop-commander/runtime-acceptance.mjs --resume
  lifecycle_intent=paused:false
  host_status_reply={"version":1,"id":"acceptance-0354f8dfe1e7","action":"status","ok":true,
                     "state":{"paused":false,"connection":"disconnected"}}
  RESULT pass=12 fail=0
```

两次都是真实 owner 的 IPC + challenge/HMAC + 一帧回执；`paused` 随 `lifecycle.json` 的真实意图在 `true/false` 之间变化，证明回执来自控制器而不是常量。默认 `paused:true` 来自 `lifecycle.mjs:30`（`lifecycle.json` 缺失时安全默认暂停）。`connection:"disconnected"` 也是真实值：acceptance 不启动隧道，runtime 处于 `stopped`，所以 9.4 里 stub 的 `paused:true` 只是与真实默认值恰好相同，并非被替代为“假数据”。

仍未证明：`connection:"ready"` 需要真实隧道与 lifecycle 启动，acceptance 不启动隧道；Chrome 侧 `optional_permissions` 授权、签名/申诉与否，也仍未证明。

#### 10.5 本轮遗留

1. `connection:"ready"` 分支（真实隧道 + lifecycle 启动）未覆盖。
2. 真实 `optional_permissions` 授权路径未覆盖。
3. 签名/申诉未做，Defender 只记录了本机这一次构建未被拦。
