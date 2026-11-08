# Agent Continue Windows Preview: Start Here

This preview kit contains the unpacked Chrome extension and the Windows command bundle in one ZIP. It is not the stable Chrome Web Store package.

Keep the complete extracted kit together. The command below uses the adjacent,
checksum-verified `WindowsSetup` payload. Do not distribute or run its
`install.ps1` by itself: the scheduler-only GitHub `v2.2.1` release does not
contain the separate Windows setup assets it would try to download.

The guided installer below runs as the current ordinary Windows account. It
does not install or authorize the separate administrator candidate. Administrator
controls visible in the preview are under acceptance; they are not a delivered
one-command administrator installation or proof that a chat has elevated access.

## 1. Verify and extract

Get the ZIP and its matching external `.zip.sha256` file from the same trusted release. In PowerShell, substitute the actual ZIP path below and compare the full SHA-256 hash with the value for that exact archive in the sidecar **before extracting**. Stop if the checksum is missing or does not match.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<downloaded ZIP path>'
```

After extracting, the root contains:

```text
START-HERE.md   This guide
SHA256SUMS.txt  Hashes of archive members, not of the ZIP itself
AgentContinue/  Unpacked Chrome extension
WindowsSetup/   Windows command bundle
```

## 2. Load the extension

In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the extracted `AgentContinue` folder containing `manifest.json`. Open the extension and go to **Settings > Manage devices > Installation guide**, then **Windows command setup and local controls**. English is the default; **Interface language** offers **Simplified Chinese**.

In Setup, choose **Windows**, review the account-access disclosure, and check the extension ID. The guided command carries that ID from this unpacked copy. Do not mix a setup command and installer from different kits. Export a setup JSON only if using an advanced command.

## 3. Run browser-managed setup once

Prepare a dedicated OpenAI tunnel associated with the intended ChatGPT workspace and a restricted runtime-key file on this device. Open an interactive terminal in the extracted `WindowsSetup` folder. Copy **one** guided command from Setup, or replace `EXTENSION_ID` below with the actual ID of the unpacked extension:

```powershell
.\install.ps1 -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId 'EXTENSION_ID'
```

```cmd
install.cmd guided-browser EXTENSION_ID
```

Check that the ID printed in the terminal matches the one in Setup. Enter the tunnel ID and only the absolute path to the local key file. Do not paste the key contents into the terminal, extension, or chat. Type `REGISTER` to register the bridge for this extension and current Windows user, or leave the answer blank to cancel. The command does not start the tunnel, and no JSON export is needed.

Setup reuses compatible Node.js or downloads and verifies official portable Node.js for the current user after consent. It does not use an Agent Continue EXE/MSI installer or request elevation. If policy blocks the command, stop and check with your administrator rather than bypassing it. Use this mode for a fresh install; do not run the standalone setup for the same installation.

If browser-managed setup is interrupted, do not delete the directory or run the
installer again. From the same `WindowsSetup` folder, inspect the original root:

```powershell
.\install.ps1 -DeviceAction browser-installer-status -InstallDir "$env:LOCALAPPDATA\AgentContinue"
```

The read-only result separates verified configuration, exact bridge files and
registry observations. `registration: "matched"` plus `bundle: "verified"`
establishes the inspected bridge registration, not that a browser has launched
it or that a chat is authorized. `absent`, `conflict` and `unconfirmed` are
different states; a query error must not be treated as absence. This command
does not connect, repair, replay or uninstall anything. The standalone
`installer-status` below observes a different, first-connect operation and is
not a substitute for browser-managed installation inspection.

If a different Node executable is used for inspection, the exact stored wrapper
can still be inspected, but the result reports `interpreter: "mismatch"` and
`configuration: "not-verified"`. This is not a broken-bridge verdict. Use the
original setup interpreter with `-NodePath` to verify that configuration; the
inspector does not execute an interpreter inferred from an installed file.
`registryComplete: false` also preserves unreadable or changing registry slots,
even if another slot establishes a conflicting registration.

Current preview limits: browser-wake setup supports only its validated CMD-safe
ASCII application and Node paths; some otherwise valid Windows profile paths
are not supported. Node version alone does not establish that its architecture
and npm installation can be used. Browser-managed removal is not yet delivered;
the legacy uninstall command is plan-only. Do not delete or overwrite an
uncertain installation to work around these limits.

## 4. Connect from Devices

After installation, choose **Already installed? Open Devices** in Setup, or open **Manage devices > Browser-managed Windows**. Select **Allow local bridge access** and approve Chrome's Native Messaging prompt. Start a new browser session if Chrome already attempted startup before registration. Choose **Check status**, then **Reconnect** for the first connection.

After the first connection, reopening Chrome with the extension enabled can restore the tunnel without a terminal window or a separate startup task. Chrome starts the registered local runtime; the extension alone is not the tunnel client. **Disconnect and pause** persists across browser sessions and requires a manual **Reconnect**. You can also revoke the browser permission in Chrome to prevent future wake attempts. Never start a second manager for the same tunnel.

## 5. Verify hosted access separately

Follow **Connect ChatGPT and Dot** in Setup to configure the private MCP app in the matching workspace. Verify with a disposable file in an ordinary ChatGPT chat and separately in Dot. Neither registration nor a local ready receipt proves either surface is authorized. Earlier isolated tests completed ordinary ChatGPT reads, a keyed write with replay rejection, and an output-only terminal call; those tests do not establish acceptance of this browser-managed preview, administrator control, your installation, or Dot. Authorized tools run with your Windows account's file, terminal, and process permissions.

OpenAI Secure MCP Tunnel is a private connection for the associated organization
and ChatGPT workspace, not a public ChatGPT plugin distribution channel. A public
Chrome extension can guide each owner through their own private setup; installing
that extension does not grant any chat access. See the
[official tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
The current hosted request deadline is 120 seconds, including queue time. For
long-running commands, start with a bounded response wait and read the same
process or operation receipt afterward; a request timeout is not evidence that
the process stopped and is not permission to execute it again.

## Run an exact terminal request

If your private app lists **Start Process (Exact Arguments)**, use it when changing the spelling of a command, shell path, or timeout is unacceptable. Generate the request locally from the three values you reviewed, then pass the five fields as supplied. Do not ask the chat to regenerate the hash after changing an argument.

For example, in a local Node.js REPL:

```js
const { createHash, randomUUID } = require('node:crypto');
const command = "Write-Output 'Preview check'";
const shell = process.env.SystemRoot.replaceAll('\\', '/') + '/System32/WindowsPowerShell/v1.0/powershell.exe';
const timeout_ms = 10000;
const digest = createHash('sha256').update(JSON.stringify([command, shell, timeout_ms]), 'utf8').digest('hex');
console.log(JSON.stringify({
  command, shell, timeout_ms, agent_continue_operation_id: randomUUID(),
  agent_continue_process_sha256: digest,
}, null, 2));
```

Invoke `agent_continue_start_process_exact`, not `start_process`. A hash mismatch rejects that delivery before execution; an admitted operation ID cannot execute twice. **Check Operation Receipt** returns `requestKind: exact-process` in its structured result for a request admitted through the exact tool. Check the same ID and verify the actual effect before starting a new operation. A normal receipt is not evidence that the exact guard ran. The hash does not grant access, elevate privileges, or make the ordinary terminal tool strict. Do not put credentials in the command or chat.

## Standalone fallback

The **Fallback: standalone manager and advanced commands** section is a separate setup mode. It requests a first connection with `CONNECT` and does not register a Chrome bridge. If offered, `PAIR` creates a short-lived local ticket for **Open extension controls**; pressing Enter keeps the connection without pairing. Do not share that ticket. Closing paired controls does not pause the connection.

For a standalone first-connect attempt that was interrupted or unclear, use
`installer-status` in Setup instead of rerunning the installer. This does not
inspect browser-wake registration. To pause from the original `WindowsSetup` folder:

```powershell
.\install.ps1 -DeviceAction disconnect-and-pause -Consent accept-control
```

## 简体中文摘要

1. 从同一可信发布获取 ZIP 与对应的外部 `.zip.sha256` 文件。先比对整个 ZIP 的 SHA-256，再解压；包内 `SHA256SUMS.txt` 仅记录成员文件的哈希。保留完整解压目录，不要单独分发或执行 `install.ps1`；仅调度功能的 GitHub `v2.2.1` 发布没有独立的 Windows 安装资源。
2. 在 Chrome 扩展管理页启用开发者模式，选择“加载已解压的扩展程序”，加载 `AgentContinue` 文件夹。打开“设置 > 设备管理 > 安装指南”，选择 Windows，审阅账户权限说明并核对扩展 ID。只有高级命令需要导出配置 JSON。
3. 在同一预览包的 `WindowsSetup` 目录运行浏览器管理的 PowerShell 或 CMD 命令。核对扩展 ID，输入隧道 ID 和本机密钥文件路径，不输入密钥内容。输入 `REGISTER` 为当前 Windows 用户注册本机控制桥；留空取消。缺少兼容 Node.js 时，确认后会下载并校验官方便携版，不使用 Agent Continue EXE/MSI 安装器，不提权。此入口安装普通账户运行时，不安装或授权另行验收中的管理员候选；看到管理员控制项不等于一键管理员安装已交付。
4. 到设备页授权本机控制桥，检查状态，再手动连接一次。后续重新打开 Chrome 可自动恢复已启用的连接；“断开并暂停”会保留。独立管理是备选模式，使用 `CONNECT` 和可选的 `PAIR`，不要与浏览器管理混用。
5. 早期独立测试通过了普通 ChatGPT 的读文件、带操作 ID 的写入防重和只输出文本的终端调用；这不证明当前浏览器管理预览、管理员控制、自己的设备或 Dot 已通过验收。官方隧道用于指定组织与工作区的私有连接，不是公开 ChatGPT 插件发布渠道。当前托管请求期限为 120 秒，包含排队时间；长任务应有限等待后查询同一进程或操作回执，超时不能当作任务已停止或重新执行的依据。
6. 如果私有插件列出“Start Process (Exact Arguments)”，需要逐字执行时，从已审阅的命令、Shell 路径和超时在本机生成摘要，再用该工具提交。摘要不匹配时本次不执行；普通终端工具不受此约束，摘要也不替代权限确认。
7. 浏览器管理模式安装中断时，在原 `WindowsSetup` 目录使用 `-DeviceAction browser-installer-status` 只读检查原安装路径。配置、桥接文件与注册分别报告；`matched` 与 `verified` 同时成立也不证明浏览器启动或对话授权。`absent`、`conflict`、`unconfirmed` 不能混同。独立管理器的 `installer-status` 检查的是首次连接操作，不能替代此检查。两者都不应触发重试或重装。
8. 当前浏览器控制桥仅支持已验证的 CMD 安全 ASCII 应用与 Node 路径，部分合法 Windows 用户路径不受支持；Node 版本符合也不等于架构与 npm 可用。浏览器管理模式的完整移除尚未交付，旧卸载命令仅生成计划。不要通过删除或覆盖结果不明的安装绕过限制。
9. 若检查命令使用了不同的 Node，结果会单独报告 `interpreter: "mismatch"` 与 `configuration: "not-verified"`，不把原桥接误判为损坏。可用 `-NodePath` 指定原安装使用的解释器再检查；检查器不会自动执行从安装文件中推导出的解释器。`registryComplete: false` 会保留不可读或变化中的注册项状态，即使另一个注册项已证实冲突。
