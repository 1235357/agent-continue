import { createTranslator, initializeLanguage, subscribeLanguage, setLanguage, getLanguage } from './i18n.js';
import { buildSetupRequest, serializeSetupRequest, describeTarget, parseLocalPairingTicket } from './setup-model.js';
import { resolveStatusView } from './native/bootstrap/registration-status-view.mjs';
import { buildInstallPlan } from './native/bootstrap/install-plan.mjs';
import { controlDevice } from './device-control.js';
import { createSetupClient, administratorSetupCommand } from './setup-client.js';

const catalog = {
  'Windows 访问权限': 'Windows access',
  '当前账户': 'Current account',
  '管理员': 'Administrator',
  '授权后，MCP 可按当前账户权限修改文件、执行命令和控制进程。无需管理员批准。': 'Authorized MCP can modify files, run commands and control processes as your current account. No administrator approval is requested.',
  '授权后，MCP 可按 Windows 管理员权限操作文件、终端和进程。安装和连接可能分别请求 Windows 批准（UAC）。': 'Windows administrator access: files, PowerShell and processes; installation and connection may require separate Windows approvals (UAC).',
  '同意并复制后，运行命令允许本页在安装完成后请求一次连接。离开本页或撤回同意会取消；ChatGPT / Dot 授权仍需分别完成。': 'Run the command to request one connection after installation. Closing this page or withdrawing consent cancels pending steps. Authorize ChatGPT / Dot separately.',
  '粘贴命令，按提示输入隧道 ID 和密钥文件路径。不要粘贴密钥内容。安装后仅在本页仍打开且同意有效时请求连接。安装和连接可能分别请求 Windows 批准（UAC）。': 'Paste the command and supply the tunnel ID and key-file path when prompted. Never paste the key itself. Connection is requested after installation only while this page remains open and consent stays valid. Installation and connection may require separate Windows approvals (UAC).',
  '兼容组件安装后，本页会请求一次连接；请求不代表就绪。若不支持自动继续，请在设备页手动连接。ChatGPT 和 Dot 仍需分别授权。': 'After compatible components are installed, this page requests one connection; a request does not mean ready. If automatic continuation is unsupported, connect manually in Devices. ChatGPT and Dot still require separate authorization.',
  '复制命令会申请浏览器本机通信权限并准备本页安装意图，不会运行安装。安装和连接可能分别请求 Windows 批准（UAC）。': 'Copy requests browser native-messaging permission and prepares setup intent for this page; it does not run the installer. Installation and connection may require separate Windows approvals (UAC).',
  '正在准备本页安装；尚未安装或连接。': 'Preparing setup for this page; nothing is installed or connected.',
  '已复制安装命令。等待本页确认安装；尚未请求连接。': 'Install command copied. Waiting for this page to confirm installation; no connection requested yet.',
  '正在请求连接；就绪尚未确认。': 'Requesting a connection; readiness is unconfirmed.',
  '已请求连接；就绪尚未确认。请在设备页查看状态。ChatGPT 和 Dot 仍需分别授权。': 'Connection requested; readiness is unconfirmed. Check status in Devices. ChatGPT and Dot still require separate authorization.',
  '安装已验证；连接就绪尚未确认。ChatGPT 和 Dot 仍需分别授权。': 'Installation verified; connection readiness is unconfirmed. Authorize ChatGPT and Dot separately.',
  '已复制安装命令；此版本不支持本页自动连接。安装后请在设备页手动连接。': 'Install command copied; this version does not support automatic connection from this page. After installation, connect manually in Devices.',
  '安装或连接结果未确认；不会重试或创建新请求。请在设备页检查原操作。': 'Installation or connection is unconfirmed; no retry or new request will be made. Check the original operation in Devices.',
  '自动复制失败，本页自动连接已取消。请手动复制命令，安装后在设备页连接。': 'Automatic copy failed and automatic connection from this page is cancelled. Copy the command manually, then connect in Devices after installation.',
  '本页自动连接意图已取消；已提交的操作仍可能完成。可在设备页检查状态或暂停。': 'Automatic connection intent for this page is cancelled; a submitted operation may still finish. Check status or pause in Devices.',
  '未获得浏览器本机通信权限；未复制命令或请求连接。': 'Browser native-messaging permission was not granted; no command copied or connection requested.',
  '管理员路径使用单独校验的安装包及其固定版本的便携 Node，不使用当前账户的 Node 补装流程。': 'The administrator route uses a separately verified bundle with its pinned portable Node, not current-account Node provisioning.',
  '设置 Windows': 'Set up Windows',
  '授权后，MCP 可按系统账户权限修改文件、执行命令和控制进程。管理员或 root 权限仍需系统批准。': 'Authorized MCP can modify files, run commands and control processes as your OS account. Administrator or root access requires OS approval.',
  '复制不安装、不连接、不授予权限。浏览器及 ChatGPT / Dot 授权仍需分别完成；手动暂停会保留。': 'Copying does not install, connect or grant access. Browser and ChatGPT / Dot approvals remain separate; a manual pause stays in effect.',
  '我理解并同意上述访问范围。': 'I understand and agree to this access.',
  '准备源码与隧道。': 'Prepare the source and tunnel.',
  '仅限全新安装：先取得已审阅并解压的安装源码包、官方隧道 ID 和本机密钥文件路径；命令须在该源码包目录运行。': "Fresh installations only: obtain the reviewed, extracted setup source bundle, official tunnel ID and local key-file path. Run the command from that bundle's directory.",
  '在 PowerShell 中运行。': 'Run in PowerShell.',
  '粘贴命令，按提示输入隧道 ID 和密钥文件路径，再输入 REGISTER 注册桥接；留空取消。无需 JSON，不要粘贴密钥内容；此步骤不启动隧道。': 'Paste the command, supply the tunnel ID and key-file path when prompted, then type REGISTER to register the bridge; leave it blank to cancel. No JSON is needed. Never paste the key itself. This step does not start the tunnel.',
  '在设备页连接。': 'Connect in Devices.',
  '安装后允许本机控制桥访问，检查状态，再重新连接。最后分别完成 ChatGPT 和 Dot 的插件授权。': 'After installation, Allow local bridge access, Check status, then Reconnect. Complete plugin authorization separately in ChatGPT and Dot.',
  '查看命令与源码要求': 'Command and source requirements',
  '高级：其他平台、JSON 与诊断': 'Advanced: other platforms, JSON and diagnostics',
  'Windows 本机控制': 'Windows local controls',
  '准备隧道 ID 和运行密钥文件': 'Prepare the tunnel ID and runtime-key file',
  '连接 ChatGPT 和 Dot': 'Connect ChatGPT and Dot',
  '准备专用隧道。': 'Prepare a dedicated tunnel.',
  '在 OpenAI Platform 中创建隧道，并关联将使用该插件的 ChatGPT 工作区。把受限运行密钥保存在目标设备上；终端只接收本机密钥文件的路径。不要把运行密钥粘贴到扩展、对话或配置请求。': 'Create a tunnel in OpenAI Platform and associate it with the ChatGPT workspace that will use the plugin. Keep the restricted runtime key on the target device and enter only the key-file path in the terminal. Do not paste the runtime key into the extension, a chat, or a setup request.',
  '确认设备已连接。': 'Confirm the device is connected.',
  '在目标设备上启动官方隧道并检查状态。使用 Windows 浏览器管理时，在设备页连接；独立管理模式不需要 Chrome 桥接。设备就绪不代表对话已授权。': 'Connect the official tunnel on the target device and check its status. For browser-managed Windows, connect from Devices; standalone mode does not need the Chrome bridge. A ready device does not mean any chat is authorized.',
  '已安装？打开设备页': 'Already installed? Open Devices',
  '推荐：由浏览器管理 Windows 连接': 'Recommended: browser-managed Windows',
  '仅用于全新安装。运行一个命令后输入 REGISTER，确认注册当前扩展的本机控制桥；留空取消。此步骤不会启动隧道。': 'For a fresh installation only. Run one command and type REGISTER to register the native bridge for this extension, or leave it blank to cancel. This does not connect the tunnel.',
  '安装后前往设备页，选择“允许本机控制桥访问”，然后“检查状态”和“重新连接”。只恢复上次已启用的连接；手动暂停会保留。': 'In Devices, select Allow local bridge access, then Check status and Reconnect. Only an enabled connection resumes when you reopen the browser; a manual pause stays in effect.',
  '备用：独立管理器和高级命令': 'Fallback: standalone manager and advanced commands',
  '如果选择独立管理器，不要同时运行上方浏览器管理命令，也不要用它覆盖现有安装。': 'Use standalone setup instead of browser-managed setup, not alongside it or over an existing installation.',
  '独立管理器的 CMD 命令': 'Standalone CMD command',
  '打开浏览器管理的 Windows 设备': 'Open browser-managed Windows device',
  '浏览器管理安装的只读检查': 'Read-only browser-managed install check',
  '安装结果不明时，不要删除目录或重复安装。此只读命令分别检查配置、本机控制桥文件与注册信息，不会连接或重试；检查通过也不证明浏览器启动或对话授权。': 'If setup is unclear, do not delete the directory or reinstall. This read-only command checks configuration, bridge files and registration separately. It does not connect or retry; a pass is not proof of browser launch or chat authorization.',
  '在正确的工作区创建私有插件。': 'Create a private plugin in the matching workspace.',
  '打开 ChatGPT 插件': 'Open ChatGPT Plugins',
  '选择添加自定义 MCP 服务器，将连接类型设为 Tunnel，选中刚才的隧道，再审阅认证和权限设置。不要使用已有生产插件替代测试。': 'Add a custom MCP server, select Tunnel as the connection type, and choose your tunnel. Review the authentication and access settings. Do not substitute an existing production plugin for testing.',
  '分别验收两个入口。': 'Verify both chat surfaces.',
  '在普通 ChatGPT 对话与 Dot 中分别选用该插件。只批准一次读取目标设备上的无敏感测试文本文件，并核对实际 read_file 工具结果中的插件、文件路径和返回内容。不要在请求中提供预期内容；模型回复或另一个入口通过都不能代替本入口的验证。': 'Select the plugin in an ordinary ChatGPT chat and separately in Dot. Approve only one read of a disposable, non-sensitive text file on the target device. Check the actual read_file tool result for the plugin, file path, and returned contents. Do not include the expected contents in the request. A model reply or a pass on the other surface is not verification.',
  '找不到隧道或工具？': 'Tunnel or tools missing?',
  '隧道未列出：核对目标 ChatGPT 工作区是否已关联，以及创建者是否具有 Tunnels Read + Use 权限。': "Tunnel not listed: check the target ChatGPT workspace association and the plugin creator's Tunnels Read + Use permissions.",
  '插件已创建但没有工具：先确认设备端隧道仍在线，再核对当前对话是否能选用该插件。若 Dot 没有显示插件，Dot 仍未验证；无需为此重装设备端。': 'Plugin created but tools missing: confirm the device tunnel is still online and check whether this chat offers the plugin. If Dot does not offer the plugin, Dot remains unverified; do not reinstall the device for this reason.',
  'OpenAI 官方隧道设置指南': 'Official OpenAI tunnel setup guide',
  '安装中断后的检查': 'If installation stops',
  '安装结果不明时，不要删除目录或重复安装。使用原安装路径查询首次连接结果，即使没有显示操作 ID 也可以检查。': 'If the result is unclear, do not delete the directory or reinstall. Check the first connection attempt using the original install path, even if no operation ID was displayed.',
  '需要报告问题时，请提供扩展版本和错误代码；不要上传密钥文件、完整路径或原始终端输出。卸载选项目前只生成计划，不会清理文件；待检查不等于已完成。': 'For an issue report, share the extension version and error code, not key files, full paths or raw terminal output. The uninstall option currently generates a plan only; it does not remove files. Pending review does not mean completed.',
  '从已审阅并解压的源码包目录运行安装命令。不安装 AgentContinue EXE；仅浏览器管理模式注册 Chrome 主机。': 'Run the install command from the reviewed, extracted source bundle. No Agent Continue EXE is installed; only browser-managed mode registers its Chrome host.',
  '审阅并导出 Windows 配置请求': 'Review and export a Windows setup request',
  '引导命令已包含当前扩展 ID，无需导出 JSON。请核对终端显示的扩展 ID，再输入官方隧道 ID 和运行密钥文件的绝对路径。不要粘贴密钥内容。': "The guided command includes this extension's ID; no JSON export is needed. Check the extension ID shown in the terminal, then enter the official tunnel ID and absolute path to the runtime-key file. Do not paste the key itself.",
  '已有兼容的 Node.js 时直接使用；否则确认后会自动下载并校验官方便携 Node ZIP，只为当前用户安装。不运行 EXE/MSI 安装器，不需要管理员权限，不改系统 PATH。': 'Setup reuses compatible Node.js. Otherwise, after you confirm, it automatically downloads and verifies the official portable Node ZIP and installs it for the current user only. No EXE/MSI installer, administrator access, or system PATH changes.',
  '核对后输入 CONNECT 开始安装并请求连接；留空取消。': 'Type CONNECT to install and request a connection, or leave it blank to cancel.',
  '复制 PowerShell 命令': 'Copy PowerShell command',
  '改用 CMD 运行': 'Use CMD instead',
  '复制 CMD 命令': 'Copy CMD command',
  '高级：手动传入参数': 'Advanced: pass arguments manually',
  '下面的直接 Node 命令和高级 CMD 命令需要已有 Node.js 22.13 或更新版本。没有兼容版本时，使用上方任一引导命令，或下方的高级 PowerShell 命令。': 'The direct Node and advanced CMD commands below require Node.js 22.13 or newer. Without a compatible version, use either guided command above or the advanced PowerShell command below.',
  '使用实际导出的 JSON 路径、官方隧道 ID 和本机密钥文件路径。只在本机终端输入路径，不要把密钥内容粘贴到扩展或聊天。隧道运行需要校验过的 OpenAI 官方便携客户端。': 'Use the exported JSON path, official tunnel ID and local key-file path. Enter paths only in your terminal; never paste the key into the extension or chat. The tunnel uses a verified, portable OpenAI client.',
  'Node.js（在 PowerShell 中运行）': 'Node.js (run in PowerShell)',
  'PowerShell（支持补装便携 Node）': 'PowerShell (can provision portable Node)',
  '暂停与恢复': 'Pause and reconnect',
  '使用便携 Node 时的管理命令': 'Manage with portable Node',
  '安装成功后，如果终端提示可选配对：输入 PAIR 打开扩展控制面板，或按 Enter 保留连接而不配对。': 'If the terminal offers pairing after a successful install: Type PAIR to open extension controls; Enter keeps the connection without pairing.',
  '输入 PAIR 后，同一终端会显示一条临时配对凭证，不会自动打开浏览器。只将整行 ACPAIR1 凭证粘贴到扩展控制面板，不要分享。': 'PAIR displays a temporary pairing ticket in the same terminal. No browser opens automatically. Paste the entire ACPAIR1 line into the extension controls only. Do not share it.',
  '打开扩展控制面板': 'Open extension controls',
  '临时浏览器控制页': 'Temporary browser controls',
  '控制会话将在 15 分钟后结束，也可以在终端按 Enter 或 Ctrl+C 结束。关闭面板或结束会话不会改变隧道连接；已提交的操作仍可能完成。': 'The control session ends after 15 minutes or when you press Enter or Ctrl+C in the terminal. Closing the panel or ending the session does not change the tunnel connection; an action already submitted may still finish.',
  '重新打开临时控制会话': 'Reopen a temporary control session',
  '如果跳过了配对、未看到配对提示，或会话已结束，请在设备管理器运行时在交互终端执行此命令。': 'If you skipped pairing, did not see the prompt, or the session ended, run this command in an interactive terminal while the device manager is running.',
  '终端显示的配对凭证': 'Pairing ticket from terminal', '打开控制面板': 'Open controls', '关闭控制面板': 'Close panel',
  '查看本机状态': 'Check local status',
  '断开并暂停': 'Disconnect and pause', '重新连接': 'Reconnect',
  '正在验证本机会话。': 'Verifying local session.', '配对凭证无效。': 'Invalid pairing ticket.',
  '本机会话无法验证。': 'Local session could not be authenticated.',
  '本机会话已结束。': 'Local session expired.', '正在检查本机状态。': 'Checking local status.',
  '本机已就绪。': 'Local runtime ready.', '本机已断开。': 'Local runtime disconnected.',
  '本机已暂停。': 'Local runtime paused.', '已请求暂停，尚未确认停止。': 'Pause requested; stop unconfirmed.',
  '本机操作结果不明。': 'Local operation unconfirmed.',
  '该浏览器会话有待查操作。请配对原设备并检查状态；普通状态不能解除锁定。': 'This browser session has a pending action. Pair with the original device and check status; a generic status does not unlock controls.',
  '本机会话记录不可用。只能查看状态。': 'The local session journal is unavailable. Only status checks are allowed.',
  '本机控制正忙。请先检查状态，再决定是否操作。': 'Local controls are busy. Check status before starting another action.',
  '无法在面板恢复时，可在原设备上用操作编号查询原回执。查询不会重新执行操作。紧急断开可使用终端的暂停命令。': 'If the panel cannot recover the receipt, query the operation ID on the original device. This does not replay the action. The terminal pause command remains available for urgent disconnection.',
  '仅限既有 Chrome 桥接': 'Existing Chrome bridge only',
  '高级命令需传入已导出 JSON 的绝对路径；引导命令不需要该文件。不要执行 JSON 文件。独立管理模式不需要 Chrome 桥接权限。': 'Pass the exported JSON\'s absolute path to an advanced command. Guided setup does not need that file. Do not execute the JSON file. Standalone mode does not need Chrome bridge permission.',
  'macOS 官方客户端应通过 brew install openai/tools/tunnel-client 安装；不要绕过 Gatekeeper。安装官方客户端并不等于安装本扩展的原生桥接。stdio 模式下每个隧道仅允许一个活动运行时；替换前先停止旧实例。': "On macOS, install the official client with brew install openai/tools/tunnel-client; do not bypass Gatekeeper. Installing the official client does not install this extension's native bridge. In stdio mode, keep only one active runtime per tunnel; stop the old instance before replacing it.",
  'Agent Continue | 设备设置': 'Agent Continue | Device Setup',
  '跳至设备设置': 'Skip to device setup', '设备设置': 'Device Setup',
  '界面语言': 'Interface language', '英语': 'English', '简体中文': 'Simplified Chinese',
  '安装目标': 'Installation target', '选择要设置的设备': 'Choose the device to set up',
  '请选择目标': 'Select a target', '本机 Linux': 'Local Linux', '远程 Linux 服务器': 'Remote Linux server',
  '请选择目标。本候选版本没有已发布的安装器。': 'Choose a target. This candidate has no released installer.',
  'Windows 启动器发布验收尚未通过：测试生成的程序曾被 Defender 检测并隔离，尚未确认误报。请勿恢复隔离文件、添加排除项或关闭防护；暂不执行候选启动器，等待安全分类与发布修复。': 'Windows launcher release acceptance has not passed: Defender detected and quarantined a generated test executable; a false positive has not been established. Do not restore quarantined files, add exclusions or disable protection. Do not execute the candidate launcher until security classification and release remediation are complete.',
  '此浏览器的扩展标识': 'Extension ID in this browser', '此浏览器的桥接权限': 'Bridge permission in this browser',
  '目标设备安装': 'Target device installation', '对话工具授权': 'Chat tool authorization',
  '未知': 'Unknown', '未验证': 'Not verified', '已授权': 'Granted', '未授权': 'Not granted',
  '目标选择不会检测、连接或控制任何设备。': 'Target selection does not detect, connect to, or control a device.',
  '打开本机控制与浏览器授权': 'Open local controls and browser authorization',
  '了解设备访问范围': 'Understand device access',
  '接入目标是完整的账户级文件、终端与进程操作，而不只是查询状态。工具在目标设备上以所选操作系统账户运行；经明确配置为管理员或 root 后，可修改系统文件与设置。': 'The intended access includes account-level file, terminal and process operations, not just status checks. Tools run on the target device as the selected operating-system account; when explicitly configured as administrator or root, they can modify system files and settings.',
  '选择或绑定一个对话并不授予设备权限。安装器的系统批准与 ChatGPT 中的工具授权仍是独立步骤；Dot 与普通对话均适用。': 'Selecting or binding a conversation does not grant device access. Operating-system approval in the installer and tool authorization in ChatGPT remain separate steps for both Dot and ordinary chats.',
  'Desktop Commander 上游声明遥测默认开启。集成安装器必须在首次运行前处理其安装脚本与隐私配置，并验证关闭状态；本候选版本尚未部署该集成。不要分享原始工具调用历史，其中可能包含命令参数和结果。': "Desktop Commander's upstream policy states that telemetry is enabled by default. The integrated installer must handle installation scripts and privacy configuration before first execution and verify the disabled state; this integration is not deployed by this candidate. Do not share raw tool-call history, which can contain command arguments and results.",
  '配置请求': 'Setup request',
  '请求只包含目标平台、当前扩展标识与固定桥接标识。不包含密钥、命令或文件路径，也不授权安装或提权。': 'The request contains only the target platform, current extension ID and fixed bridge identity. It contains no keys, commands or file paths and does not authorize installation or elevation.',
  'Windows 与远程 Linux 的源码接收器可使用各自目标的请求生成只读计划。macOS 与本机 Linux 请求目前仅供交接；接收器拒绝其他目标。': 'The Windows and remote Linux source consumers can generate read-only plans for their respective targets. macOS and local Linux requests are currently handoff metadata only; each consumer rejects other targets.',
  '审阅配置请求': 'Review setup request', '尚未发起导出。': 'No export initiated.',
  '接入顺序': 'Connection sequence',
  '核对扩展标识。在目标设备上审阅并安装本机组件；操作系统批准与浏览器权限是独立步骤。扩展不能安装自己的第一个原生主机。': 'Verify the extension identity. Review and install the local component on the target device; operating-system approval and browser permission are separate steps. The extension cannot install its own first native host.',
  '本机桥接安装后，可在设备控制页明确申请可选浏览器权限并手动检查状态。浏览器授权不证明安装成功。': 'After local bridge installation, explicitly request optional browser permission and check status on Devices. Browser approval does not prove installation succeeded.',
  '在目标设备上配置官方隧道和 MCP。运行密钥留在设备端受保护位置；不要粘贴到扩展、请求文件或聊天里。同一个 stdio 隧道只运行一个实例。': 'Configure the official tunnel and MCP on the target device. Keep the runtime key in protected device storage, never in the extension, request file or chat. Run only one instance for a stdio tunnel.',
  '官方入口': 'Official resources', 'OpenAI 隧道文档': 'OpenAI tunnel documentation',
  'Desktop Commander 开源 MCP': 'Desktop Commander open-source MCP', 'Desktop Commander 上游隐私说明': 'Desktop Commander upstream privacy policy',
  'OpenAI 隧道管理': 'OpenAI tunnel management', 'OpenAI 运行密钥管理': 'OpenAI runtime key management',
  'ChatGPT 私有插件连接说明': 'ChatGPT private plugin connection guide', 'Chrome 原生消息机制': 'Chrome native messaging',
  '这是未签名的配置数据，不是安装器、批准凭证或完成回执。': 'This is unsigned configuration data, not an installer, approval credential or completion receipt.',
  '我已核对目标与扩展标识，同意发起本机 JSON 导出。': 'I checked the target and extension identity and agree to initiate the local JSON export.',
  '取消': 'Cancel', '导出请求': 'Export request',
  'Windows 仅有源码候选版本；尚无已发布安装器。': 'Windows has a source candidate only; no released installer.',
  'macOS 原生安装尚未实现；尚无已发布安装器。': 'macOS native installation is not implemented; no released installer.',
  'Linux 仅有离线源码包候选版本；不是安装器。': 'Linux has an offline source-kit candidate only; it is not an installer.',
  '远程 Linux 可在目标服务器上用候选源码包配置；没有已发布的安装器。': 'Remote Linux can be configured on the target server from the source candidate; no installer has been released.',
  '在服务器上运行已核验的安装源码包，使用 Linux 专用隧道和仅保存在服务器上的密钥文件。配置完成不会启动隧道、安装服务或授权对话。': 'Run the verified setup source bundle on the server, with its own tunnel and a key file stored only on that server. Setup does not start the tunnel, install a service or authorize chats.',
  '本机桥接控制 Windows 上的 MCP；浏览器权限不证明安装或对话授权成功。': 'The local bridge controls MCP on Windows; browser permission does not prove installation or chat authorization.',
  'Windows 直连官方隧道。浏览器管理模式需要本机桥接；独立管理模式不需要。': 'Windows connects directly to the official tunnel. Browser-managed mode requires a local bridge; standalone mode does not.',
  '此平台的本机桥接尚未提供。权限状态只属于当前浏览器，不证明目标设备可用。': 'The local bridge is not available for this platform. Permission status belongs only to this browser, not target-device availability.',
  '远程 Linux 在服务器上直接运行隧道，不经过 Windows 中转；工具数据不用桥接；可选生命周期管理另需本机桥接和SSH。': 'Remote Linux runs its tunnel directly on the server, without a Windows relay; tool data does not use the bridge; optional lifecycle management separately requires a local bridge and SSH.',
  '已发起导出；尚未验证是否保存、安装或授权。': 'Export initiated; saving, installation and authorization are not verified.',
  '导出未发起。请重新核对目标与当前扩展标识。': 'Export was not initiated. Check the target and current extension identity again.',
  '语言设置保存失败。': 'The language preference could not be saved.',
  'Windows 请求交接说明': 'Windows request handoff instructions',
  '以下为只读状态：只读取本机检查结果，不写入注册表，也不注册或启动本机主机。': 'Read-only status: only local check results are read; nothing is written to the registry and no native host is registered or started.',
  '远程 Linux 请求交接说明': 'Remote Linux request handoff instructions',
  '可选远程管理': 'Optional remote management',
  '服务器 MCP 工具数据直接连接官方 OpenAI，无需 Windows 中转或本机浏览器桥接；服务器工具安装不以本机 native 权限为前置条件。': 'Server MCP tool data goes directly to official OpenAI, without a Windows relay or local browser bridge; local native permission is not a prerequisite for server tool installation.',
  '浏览器驱动的暂停与重连是独立的可选生命周期管理路径：需要已安装的本机 native manager、允许 nativeMessaging，并准备独立核验的 SSH 主机密钥与用于按需 SSH 认证的 OS agent。此页面不会安装、申请权限或调用 native。': 'Browser-driven pause and reconnect are a separate optional lifecycle-management path: they require an installed local native manager, allowed nativeMessaging, independently verified SSH host keys and an OS agent ready for on-demand SSH authentication. This page does not install, request permission or call native code.',
  '仅在本机可信入口审阅并运行源码引导命令。以下路径、主机、端口、账户和摘要不会加入浏览器请求；不要在此页面或聊天中输入主机密钥、私钥或运行密钥。摘要必须来自独立核验，不能把命令本身当作信任证明。': 'Review and run the source bootstrap command only at a trusted local entry. The paths, host, port, account and digest below are not added to the browser request; do not enter host keys, private keys or runtime keys on this page or in chat. The digest must come from independent verification, not from trusting the command itself.',
  '这是源码指引，没有已发布安装器或可运行的公共 npx 命令，不是现场安装。enroll-ssh 不建立 SSH 连接或启动服务。返回的 deviceUrl 仅选择设备，不表示已连接、已认证或已授权；还需独立验证 SSH 认证、设备可达性、本机注册和对话工具授权。': 'This is source guidance with no released installer or runnable public npx command, not an on-site installation. enroll-ssh does not establish SSH connections or start services. The returned deviceUrl conveys selection only: the device is not connected, authenticated or authorized by this link; SSH authentication, device reachability, native registration and chat tool authorization need separate verification.',
  '可选本机管理器请另行导出与本机系统匹配的本机平台请求，而不是 linux-server 请求；服务器请求仍在服务器使用。setup-manager 不需要本机 OpenAI 运行密钥，也不下载隧道客户端；仅准备私有状态与扩展绑定，本机原生注册仍需单独完成。': 'For the optional local manager, separately export a matching local-platform request, not the linux-server request; keep the server request for the server. setup-manager needs no local OpenAI runtime key and does not download a tunnel client; it prepares only private state and the extension binding, and native registration remains separate.',
  '手动前往设备管理与浏览器授权': 'Manually open device management and browser authorization',
  '这是只读源码接收器，不是安装器。请先在服务器上审阅可信引导源码与离线源码包；清单摘要必须来自独立核对，不能用请求文件替代。': 'This read-only source consumer is not an installer. First review the trusted bootstrap source and offline source package on the server; independently verify the manifest digest rather than treating the request as trust evidence.',
  '文件路径与清单摘要仅在服务器端输入，不会加入扩展请求。接收器不联网、不执行包内代码，也不安装、启动或恢复隧道。': 'File paths and the manifest digest are supplied only on the server, not added to the extension request. The consumer does not access the network, execute package code, or install, start or resume a tunnel.',
  '始终保留。源码校验成功不证明设备已安装、隧道已就绪或对话已授权；后续步骤需要独立验收。': 'is always retained. Successful source verification does not prove device installation, tunnel readiness or chat authorization; subsequent steps require separate acceptance.',
  '在 Linux 服务器上直接审阅并部署服务组件；本机浏览器桥接权限不是前置条件。此候选版本不提供自动安装器，不会通过 Windows 转发连接。': 'Review and deploy the service components directly on the Linux server; local browser bridge permission is not a prerequisite. This candidate provides no automatic installer and does not relay connections through Windows.',
  '这是源码候选版本，不提供可下载的安装器。请先从维护者取得并审阅 Windows 安装源码；不要把请求文件作为程序运行。': 'This is a source candidate without a downloadable installer. Obtain and review the Windows installer source from its maintainer first; do not run the request file as a program.',
  '接受 -SetupRequestFile 参数指向下载的 JSON。默认模式为只读 Plan，仅核对配置与生成计划，不安装、不注册、不启动任何组件。': 'accepts -SetupRequestFile pointing to the downloaded JSON. Its default read-only Plan checks the configuration and generates a plan without installing, registering or starting components.',
  '后续受保护的安装、验证与注册是独立维护步骤。请求文件、计划指纹和浏览器权限都不能替代明确批准，也不证明设备或对话已接入。': 'Protected installation, verification and registration are separate maintenance steps. A request file, plan fingerprint or browser permission cannot replace explicit approval and does not prove device or chat access.',
  '安装 AgentContinue': 'Install AgentContinue',
  '只写入当前用户空间，不需要管理员。': 'Writes only inside the current user space; no administrator elevation is requested.',
  '计划按 Node 22.13.0 或更高版本生成；安装器运行前会重新核对。': 'The plan assumes Node 22.13.0 or newer; the installer re-checks before running.',
  '安装命令': 'Install command',
  'Windows 命令安装': 'Windows command-line setup',
  '此平台尚未提供已发布的本机安装包。': 'A released local installer is not available for this platform yet.',
  'Agent Continue 发布页': 'Agent Continue releases',
  '仅使用明确提供安装 ZIP 和 SHA-256 校验值的版本。解压前，核对 ZIP 的 SHA-256 是否与该版本公布的校验值完全一致。': 'Use only a release that provides the setup ZIP and its SHA-256 checksum. Before extracting, compare the ZIP hash with the checksum for that exact release.',
  '如果 PowerShell 策略阻止脚本，请先核对来源与 SHA-256。受管理电脑请联系管理员；不要绕过策略。': 'If PowerShell policy blocks the script, verify its source and SHA-256 first. On a managed PC, contact your administrator; do not bypass the policy.',
  '可复制安装命令。': 'The install command can be copied.',
  '勾选同意后可复制命令。': 'Agree to the statement to enable copying.',
  '已复制安装命令。': 'Install command copied.',
  '无法自动复制，请选择命令文本手动复制。': 'Automatic copy failed; select the command text and copy it manually.',
  '无法保存同意状态。': 'The consent state could not be saved.',
  '我理解：授权后的 MCP 可按所选系统账户的权限操作文件、终端和进程。': 'I understand that authorized MCP tools can access files, the terminal and processes as the selected OS account.',
  '安装后检查': 'Post-install check',
  '我已运行，检测': 'I ran it — check now',
  '尚未检测。': 'Not checked yet.',
  '需要在已安装的扩展中检测。': 'Checking requires an installed extension.',
  '正在检测安装状态…': 'Checking installation status…',
  '未获得本机桥接权限。请在设备页授权后再检查。': 'Local bridge permission is not granted. Grant it in Devices, then check again.',
  '无法验证本机状态。请检查设备管理器后重试。': 'Local state could not be verified. Check the device manager and try again.',
  '检测结果：已注册。': 'Check result: registered.',
  '检测结果：未检测到 host。': 'Check result: host not detected.',
  '管理面板': 'Management panel',
  '本机运行时就绪不代表 ChatGPT 或 Dot 已授权。': 'Local runtime readiness does not verify ChatGPT or Dot authorization.',
  '本机注册状态': 'Local registration',
  '主机可启动': 'Host startable',
  '连接状态': 'Connection',
  '已注册': 'registered',
  '未检测到 host': 'host not detected',
  '可启动': 'startable',
  '就绪（本机运行时）': 'Ready (local runtime)',
  '已断开': 'disconnected',
};
const t = createTranslator(catalog);
const $ = id => document.getElementById(id);
let permission = 'unknown', initialized = false, feedback = '尚未发起导出。', permissionSequence = 0;
let reviewed = null;
const urls = new Set();
const CONSENT_KEY = 'installConsent';
const PLANNED_NODE = '22.13.0';
const INSTALL_ROOTS = Object.freeze({
  windows: 'C:\\Users\\<current-user>\\AppData\\Local\\AgentContinue',
  macos: '/Users/<current-user>/Library/Application Support/AgentContinue',
  linux: '/home/<current-user>/.local/share/agent-continue',
});
const OS_SWITCHES = Object.freeze([['installOsWindows', 'windows'], ['installOsMacos', 'macos'], ['installOsLinux', 'linux']]);
const WINDOWS_GUIDED_ENTRIES = Object.freeze({
  powershell: ['windowsGuidedCommand', 'copyWindowsGuidedCommand', 'windowsCopyFeedback'],
  cmd: ['windowsGuidedCmdCommand', 'copyWindowsGuidedCmdCommand', 'windowsCmdCopyFeedback'],
  browserPowerShell: ['windowsBrowserPowerShell', 'copyWindowsBrowserPowerShell', 'windowsBrowserPowerShellFeedback'],
  browserCmd: ['windowsBrowserCmd', 'copyWindowsBrowserCmd', 'windowsBrowserCmdFeedback'],
});
let installOs = 'windows';
let windowsAccessScope = 'current-account';
let installConsent = false;
let installConsentEpoch = 0;
let installFeedbackKey = null;
let windowsCopyAttempt = null;
let administratorSetupClient = null;
const ADMINISTRATOR_SETUP_FEEDBACK = Object.freeze({
  preparing: '正在准备本页安装；尚未安装或连接。',
  waiting: '已复制安装命令。等待本页确认安装；尚未请求连接。',
  connecting: '正在请求连接；就绪尚未确认。',
  requested: '已请求连接；就绪尚未确认。请在设备页查看状态。ChatGPT 和 Dot 仍需分别授权。',
  manual: '已复制安装命令；此版本不支持本页自动连接。安装后请在设备页手动连接。',
  unconfirmed: '安装或连接结果未确认；不会重试或创建新请求。请在设备页检查原操作。',
  'copy-failed': '自动复制失败，本页自动连接已取消。请手动复制命令，安装后在设备页连接。',
  cancelled: '本页自动连接意图已取消；已提交的操作仍可能完成。可在设备页检查状态或暂停。',
  'permission-denied': '未获得浏览器本机通信权限；未复制命令或请求连接。',
});
let detecting = false;
let probeGeneration = 0;
let hostStartable = false;
let connection = 'unknown';
let detection = 'unchecked';
let controlSession, controlStatus = '';
const controlEncoder = new TextEncoder();
const localControlPendingKey = 'agentContinueLoopbackPendingV1';
const localControlLock = 'agent-continue-loopback-controls-v1';
const localControlOperationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function setControlStatus(key) {
  controlStatus = key;
  $('localControlStatus').textContent = key ? t(key) : '';
}

function closeControlPanel() {
  const old = controlSession;
  controlSession = undefined;
  if (old?.unresolved) $('localControlReceipt').textContent = old.unresolved;
  if (old) { old.abort.abort(); old.port?.close(); clearTimeout(old.expires); }
  const frame = $('localControlFrame');
  if (frame.getAttribute('src') !== null) frame.removeAttribute('src');
  $('localControlButtons').hidden = true;
  $('localControlRecovery').textContent = '';
  setControlStatus('');
}

function dismissLocalControls() {
  closeControlPanel();
  $('localControlForm').reset();
  $('localControlTicket').removeAttribute('aria-invalid');
  $('localControlDetails').open = false;
}

function controlMessage(session, packet, timeoutMs) {
  return new Promise((resolve, reject) => {
    const signal = session.abort.signal;
    if (signal.aborted) { reject(new Error()); return; }
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', failed);
      session.port.onmessage = null;
    };
    const failed = () => { end(); reject(new Error()); };
    const timer = setTimeout(failed, timeoutMs);
    signal.addEventListener('abort', failed, { once: true });
    session.port.onmessage = ({data}) => {
      end();
      if (typeof data !== 'string' || data.length > 1024) reject(new Error());
      else resolve(data);
    };
    try { session.port.postMessage(JSON.stringify(packet)); } catch { failed(); }
  });
}

async function signedControl(session, action, id, timeoutMs) {
  const bytes = value => controlEncoder.encode(JSON.stringify(value));
  const nonce = crypto.randomUUID();
  const tag = await crypto.subtle.sign('HMAC', session.key, bytes(['ac-request-v1', session.origin, nonce, id, action]));
  const mac = Array.from(new Uint8Array(tag), byte => byte.toString(16).padStart(2, '0')).join('');
  const reply = JSON.parse(await controlMessage(session, { nonce, id, action, mac }, timeoutMs));
  if (typeof reply?.payload !== 'string' || typeof reply.mac !== 'string' || reply.mac.length !== 64 || !/^[0-9a-f]{64}$/.test(reply.mac) ||
      !await crypto.subtle.verify('HMAC', session.key, Uint8Array.from(reply.mac.match(/../g), byte => parseInt(byte, 16)),
        bytes(['ac-reply-v1', session.origin, nonce, id, action, reply.payload]))) throw new Error();
  const result = JSON.parse(reply.payload);
  if (result.id !== id || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() ||
      result.expiresAt > Date.now() + 900000) throw new Error();
  return result;
}

function showControlState(value) {
  setControlStatus(!value.ok ? (value.error === 'local_control_busy' ? '本机控制正忙。请先检查状态，再决定是否操作。' : '本机操作结果不明。') : value.paused === true ?
    (value.connection === 'disconnected' ? '本机已暂停。' : '已请求暂停，尚未确认停止。') :
    ({ ready: '本机已就绪。', disconnected: '本机已断开。' }[value.connection] || '本机操作结果不明。'));
}

function setControlButtons(session) {
  $('localControlCheck').disabled = session.busy;
  for (const id of ['localControlPause', 'localControlReconnect']) {
    $(id).disabled = session.busy || !session.journalHealthy || Boolean(session.unresolved);
  }
  renderControlRecovery(session);
}

function renderControlRecovery(session) {
  const key = session?.verified && (!session.journalHealthy ? '本机会话记录不可用。只能查看状态。'
    : session.unresolved ? '该浏览器会话有待查操作。请配对原设备并检查状态；普通状态不能解除锁定。' : '');
  $('localControlRecovery').textContent = key ? t(key) : '';
}

async function retireLocalControl(storage, id) {
  if ((await storage.get(localControlPendingKey))[localControlPendingKey] !== id) throw new Error();
  await storage.remove(localControlPendingKey);
}

async function exchangeLocalControl(session, action, timeoutMs) {
  const mutation = action !== 'status';
  const storage = globalThis.chrome?.storage?.session;
  const locks = globalThis.navigator?.locks;
  const readOnly = async () => {
    session.journalHealthy = false;
    if (mutation || controlSession !== session) return null;
    return signedControl(session, 'status', session.unresolved || crypto.randomUUID(), timeoutMs);
  };
  if (!storage?.get || !storage.set || !storage.remove || !locks?.request) return readOnly();
  const options = mutation ? { ifAvailable: true } : { signal: session.abort.signal };
  return locks.request(localControlLock, options, async lock => {
    if (!lock) return { ok: false, error: 'local_control_busy' };
    if (controlSession !== session) return null;
    let stored;
    try {
      const values = await storage.get(localControlPendingKey);
      stored = values[localControlPendingKey];
      if (stored !== undefined && (typeof stored !== 'string' || stored.length !== 36 || !localControlOperationId.test(stored))) return readOnly();
    } catch { return readOnly(); }
    if (controlSession !== session) return null;
    session.unresolved = stored || null;
    session.journalHealthy = true;
    if (mutation && stored) return null;
    const id = stored || crypto.randomUUID();
    if (mutation) {
      // Record only the correlation ID, before a request can reach the device.
      session.unresolved = id;
      try {
        await storage.set({ [localControlPendingKey]: id });
        if (controlSession !== session) { await retireLocalControl(storage, id); return null; }
      } catch { session.journalHealthy = false; return null; }
    }
    const result = await signedControl(session, action, id, timeoutMs);
    const terminal = result.ok === true && ['settled', 'not-executed'].includes(result.operationStatus);
    // A signed busy reply proves only the new request was not admitted.
    if (session.unresolved && (terminal || mutation && result.error === 'local_control_busy')) {
      try {
        await retireLocalControl(storage, id);
        session.unresolved = null;
      }
      catch { session.journalHealthy = false; }
    }
    return result;
  });
}

function showLocalReceipt(session, result) {
  $('localControlReceipt').textContent = result?.operationStatus ? `${result.operationStatus} | ${result.id}` : session.unresolved || '';
}

async function localAction(action) {
  const session = controlSession;
  if (!session?.verified || session.busy || (action !== 'status' && (!session.journalHealthy || session.unresolved))) return;
  session.busy = true;
  setControlButtons(session);
  setControlStatus('正在检查本机状态。');
  try {
    const result = await exchangeLocalControl(session, action, 32000);
    if (controlSession !== session) return;
    showControlState(result || { ok: false });
    showLocalReceipt(session, result);
  } catch {
    if (controlSession !== session) return;
    setControlStatus('本机操作结果不明。');
    showLocalReceipt(session);
  } finally { session.busy = false; if (controlSession === session) setControlButtons(session); }
}

function currentRequest() { return buildSetupRequest($('target').value, globalThis.chrome?.runtime?.id); }
function render() {
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  document.documentElement.lang = getLanguage() === 'zh_CN' ? 'zh-CN' : 'en';
  $('language').value = getLanguage();
  $('language').disabled = !initialized;
  setControlStatus(controlStatus);
  renderControlRecovery(controlSession);
  let valid = false;
  try { currentRequest(); valid = true; } catch { /* Missing identity never falls back to the store ID. */ }
  const id = globalThis.chrome?.runtime?.id;
  $('extension-id').textContent = typeof id === 'string' && id.length === 32 && /^[a-p]{32}$/.test(id) ? id : t('未知');
  $('browser-permission').textContent = t({ granted: '已授权', absent: '未授权', unknown: '未知' }[permission]);
  const target = $('target').value;
  $('availability').textContent = t({ windows: 'Windows 仅有源码候选版本；尚无已发布安装器。', macos: 'macOS 原生安装尚未实现；尚无已发布安装器。',
    linux: 'Linux 仅有离线源码包候选版本；不是安装器。', 'linux-server': '远程 Linux 可在目标服务器上用候选源码包配置；没有已发布的安装器。' }[target] || '请选择目标。本候选版本没有已发布的安装器。');
  $('target-boundary').textContent = t(!target ? '目标选择不会检测、连接或控制任何设备。' :
    target === 'windows' ? 'Windows 直连官方隧道。浏览器管理模式需要本机桥接；独立管理模式不需要。' :
      describeTarget(target).usesBrowserNativeBridge ? '此平台的本机桥接尚未提供。权限状态只属于当前浏览器，不证明目标设备可用。' :
        '远程 Linux 在服务器上直接运行隧道，不经过 Windows 中转；工具数据不用桥接；可选生命周期管理另需本机桥接和SSH。');
  $('localControls').hidden = target !== 'windows' || installOs !== 'windows';
  $('windowsHandoff').hidden = target !== 'windows';
  $('windowsHandoffLink').hidden = target !== 'windows';
  $('linuxHandoff').hidden = target !== 'linux-server';
  $('linuxHandoffLink').hidden = target !== 'linux-server';
  $('remoteManagement').hidden = target !== 'linux-server';
  for (const step of document.querySelectorAll('[data-local-bridge-step]')) step.hidden = target === 'linux-server' || target === 'windows';
  $('remoteServerStep').hidden = target !== 'linux-server';
  $('reviewSetup').disabled = !initialized || !valid;
  $('export-feedback').textContent = t(feedback);
  $('downloadSetup').disabled = !reviewed || !$('exportConsent').checked;
  renderInstall();
}

function renderInstall() {
  // The install panel answers "install this device's bridge", so it is scoped
  // to its own OS switch and never rewrites the setup target or its review.
  const plan = installPlan(installOs);
  $('installSection').hidden = false;
  $('install-title').textContent = t(installOs === 'windows' ? '设置 Windows' : '安装 AgentContinue');
  for (const [elementId, os] of OS_SWITCHES) {
    const element = $(elementId);
    // The VM fixture exposes plain objects; a real button also gets ARIA state.
    if (typeof element.setAttribute === 'function') element.setAttribute('aria-pressed', String(installOs === os));
  }
  $('installConsent').checked = installConsent;
  const administrator = windowsAccessScope === 'administrator';
  $('windowsAccessScope').value = windowsAccessScope;
  $('windowsAccessField').hidden = installOs !== 'windows';
  $('setupRisk').textContent = t(installOs !== 'windows'
    ? '授权后，MCP 可按系统账户权限修改文件、执行命令和控制进程。管理员或 root 权限仍需系统批准。'
    : administrator ? '授权后，MCP 可按 Windows 管理员权限操作文件、终端和进程。安装和连接可能分别请求 Windows 批准（UAC）。'
      : '授权后，MCP 可按当前账户权限修改文件、执行命令和控制进程。无需管理员批准。');
  $('setupGrantBoundary').textContent = t(installOs === 'windows' && administrator
    ? '同意并复制后，运行命令允许本页在安装完成后请求一次连接。离开本页或撤回同意会取消；ChatGPT / Dot 授权仍需分别完成。'
    : '复制不安装、不连接、不授予权限。浏览器及 ChatGPT / Dot 授权仍需分别完成；手动暂停会保留。');
  for (const [id, standardKey, administratorKey] of [
    ['windowsRunGuidance', '粘贴命令，按提示输入隧道 ID 和密钥文件路径，再输入 REGISTER 注册桥接；留空取消。无需 JSON，不要粘贴密钥内容；此步骤不启动隧道。',
      '粘贴命令，按提示输入隧道 ID 和密钥文件路径。不要粘贴密钥内容。安装后仅在本页仍打开且同意有效时请求连接。安装和连接可能分别请求 Windows 批准（UAC）。'],
    ['windowsConnectGuidance', '安装后允许本机控制桥访问，检查状态，再重新连接。最后分别完成 ChatGPT 和 Dot 的插件授权。',
      '兼容组件安装后，本页会请求一次连接；请求不代表就绪。若不支持自动继续，请在设备页手动连接。ChatGPT 和 Dot 仍需分别授权。'],
    ['windowsCommandScope', '只写入当前用户空间，不需要管理员。',
      '复制命令会申请浏览器本机通信权限并准备本页安装意图，不会运行安装。安装和连接可能分别请求 Windows 批准（UAC）。'],
    ['windowsNodeProvisioning', '已有兼容的 Node.js 时直接使用；否则确认后会自动下载并校验官方便携 Node ZIP，只为当前用户安装。不运行 EXE/MSI 安装器，不需要管理员权限，不改系统 PATH。',
      '管理员路径使用单独校验的安装包及其固定版本的便携 Node，不使用当前账户的 Node 补装流程。'],
  ]) $(id).textContent = t(administrator ? administratorKey : standardKey);
  $('windowsStandaloneInstall').hidden = administrator;
  $('windowsBrowserRecovery').hidden = administrator;
  $('otherInstallPlan').hidden = installOs === 'windows';
  $('installConsentLabel').hidden = installOs !== 'windows';
  $('windowsExistingDevice').hidden = installOs !== 'windows';
  $('windowsSourceInstall').hidden = installOs !== 'windows';
  const administratorState = administrator ? administratorSetupClient?.getState() : null;
  for (const [shell, [preview, copy, feedback]] of Object.entries(WINDOWS_GUIDED_ENTRIES)) {
    const command = windowsGuidedCommand(plan, shell);
    $(preview).textContent = command;
    $(copy).disabled = !command || !!(administratorState && administratorState.state !== 'idle');
    $(feedback).textContent = command && administratorState?.shell === shell
      ? t(ADMINISTRATOR_SETUP_FEEDBACK[administratorState.state] ?? '')
      : command && windowsCopyAttempt?.command === command ? t(windowsCopyAttempt.feedbackKey) : '';
  }
  const setupFeedback = ADMINISTRATOR_SETUP_FEEDBACK[administratorState?.state] ?? installFeedbackKey;
  $('installFeedback').hidden = installOs !== 'windows' || (installConsent && !setupFeedback);
  $('installFeedback').textContent = t(setupFeedback ?? '勾选同意后可复制命令。');
  $('windowsInstallCheck').hidden = installOs !== 'windows';
  $('managementSection').hidden = installOs !== 'windows';
  $('installDetection').textContent = ['connecting', 'requested'].includes(administratorState?.state)
    ? t('安装已验证；连接就绪尚未确认。ChatGPT 和 Dot 仍需分别授权。') : detectionText();
  $('detectInstall').disabled = detecting;
  $('managementRegistered').textContent = t(detection === 'registered' ? '已注册' :
    detection === 'host-missing' ? '未检测到 host' : '未知');
  $('managementHost').textContent = t(hostStartable ? '可启动' : '未知');
  $('managementConnection').textContent = t({ unknown: '未知', ready: '就绪（本机运行时）', disconnected: '已断开' }[connection]);
}

function detectionText() {
  if (detecting) return t('正在检测安装状态…');
  if (detection === 'registered') return t('检测结果：已注册。');
  if (detection === 'host-missing') return t('检测结果：未检测到 host。');
  if (detection === 'unavailable') return t('无法验证本机状态。请检查设备管理器后重试。');
  if (permission === 'absent') return t('未获得本机桥接权限。请在设备页授权后再检查。');
  return t(typeof globalThis.chrome?.runtime?.sendNativeMessage === 'function' ? '尚未检测。' : '需要在已安装的扩展中检测。');
}

function detectArch(os) {
  const architecture = globalThis.navigator?.userAgentData?.architecture;
  if (os === 'windows') return architecture === 'arm' ? 'arm64' : 'x64';
  if (os === 'macos') return architecture === 'x86' ? 'x64' : 'arm64';
  return architecture === 'arm' ? 'arm64' : 'x64';
}

function installPlan(os) {
  const id = globalThis.chrome?.runtime?.id;
  if (typeof id !== 'string' || id.length !== 32 || !/^[a-p]{32}$/.test(id)) return null;
  try {
    return buildInstallPlan({ os, arch: detectArch(os), installRoot: INSTALL_ROOTS[os], extensionId: id,
      nodeVersion: PLANNED_NODE }, { defaultWindowsEntry: os === 'windows' });
  } catch { return null; }
}

function windowsGuidedCommand(plan, shell) {
  if (plan?.os !== 'windows' || !installConsent) return '';
  if (windowsAccessScope === 'administrator') {
    const state = administratorSetupClient?.getState();
    if (state?.extensionId === plan.extensionId && state.shell === shell && state.command) return state.command;
    return administratorSetupCommand(plan.extensionId, shell);
  }
  if (shell === 'browserPowerShell') return `.\\install.ps1 -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId '${plan.extensionId}'`;
  if (shell === 'browserCmd') return 'install.cmd guided-browser ' + plan.extensionId;
  return shell === 'cmd' ? plan.entry.cmd : plan.entry.local;
}

async function refreshPermission() {
  const sequence = ++permissionSequence;
  let result = 'unknown';
  try {
    const value = await globalThis.chrome?.permissions?.contains({ permissions: ['nativeMessaging'] });
    if (typeof value === 'boolean') result = value ? 'granted' : 'absent';
  } catch { /* Permission observation is local and does not contact the bridge. */ }
  if (sequence !== permissionSequence) return;
  permission = result;
  render();
  return result;
}

function invalidateReview() {
  reviewed = null;
  $('exportConsent').checked = false;
  if ($('setupReview').open) $('setupReview').close();
}
$('target').addEventListener('change', () => { invalidateReview(); render(); });
for (const [elementId, os] of OS_SWITCHES) $(elementId).addEventListener('click', () => {
  if (installOs !== os) {
    administratorSetupClient?.cancel();
    resetDetection();
    windowsCopyAttempt = null;
  }
  if (installOs === 'windows' && os !== 'windows') dismissLocalControls();
  installOs = os;
  render();
});
function revealLocalControls() {
  $('setupAdvanced').open = true;
  $('localControlDetails').open = true;
  $('localControlTicket').focus();
}
$('localControls').addEventListener('click', event => {
  if (!event.isTrusted || $('localControls').hidden) return;
  event.preventDefault();
  revealLocalControls();
});
$('openWindowsLocalControls').addEventListener('click', () => {
  if (installOs !== 'windows' || $('windowsSourceInstall').hidden) return;
  revealLocalControls();
});
$('localControlForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (installOs !== 'windows') return;
  closeControlPanel();
  const field = $('localControlTicket');
  field.removeAttribute('aria-invalid');
  let destination, keyBytes;
  try {
    const ticket = parseLocalPairingTicket(field.value);
    destination = ticket.destination;
    keyBytes = controlEncoder.encode(ticket.code);
  } catch {
    field.setAttribute('aria-invalid', 'true'); field.focus(); setControlStatus('配对凭证无效。'); return;
  } finally {
    field.value = '';
  }
  const session = { origin: destination.slice(0, -'/embed'.length), verified: false, abort: new AbortController() };
  controlSession = session;
  setControlStatus('正在验证本机会话。');
  try { session.key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
  catch { if (controlSession === session) { closeControlPanel(); setControlStatus('本机会话无法验证。'); } return; }
  finally { keyBytes.fill(0); }
  if (controlSession !== session) return;
  session.expires = setTimeout(() => {
    if (controlSession !== session) return;
    closeControlPanel(); setControlStatus('本机会话无法验证。');
  }, 9000);
  $('localControlFrame').src = destination;
});
$('closeLocalControl').addEventListener('click', () => {
  dismissLocalControls();
  $('localControlDetails').querySelector('summary').focus();
});
$('localControlFrame').addEventListener('load', async () => {
  const session = controlSession;
  if (!session?.key) return;
  if (session.port) { closeControlPanel(); setControlStatus('本机会话无法验证。'); return; }
  const frame = $('localControlFrame');
  const channel = new MessageChannel();
  session.port = channel.port1;
  try {
    frame.contentWindow.postMessage('agent-continue-local-control', session.origin, [channel.port2]);
    const value = await exchangeLocalControl(session, 'status', 8000);
    if (controlSession !== session) return;
    if (!value || (!value.ok && value.error !== 'local_control_busy')) throw new Error();
    clearTimeout(session.expires);
    session.expires = setTimeout(() => { closeControlPanel(); setControlStatus('本机会话已结束。'); }, value.expiresAt - Date.now());
    session.verified = true;
    $('localControlButtons').hidden = false;
    setControlButtons(session);
    showControlState(value);
    showLocalReceipt(session, value);
    $('localControlCheck').focus();
  } catch { if (controlSession === session) { closeControlPanel(); setControlStatus('本机会话无法验证。'); } }
});
for (const [id, action] of [['localControlCheck', 'status'], ['localControlPause', 'disconnect-and-pause'],
  ['localControlReconnect', 'reconnect']]) $(id).addEventListener('click', event => { if (event.isTrusted) void localAction(action); });
$('installConsent').addEventListener('change', event => {
  installConsentEpoch++;
  installConsent = event?.target?.checked === true;
  if (!installConsent) administratorSetupClient?.cancel();
  installFeedbackKey = null;
  windowsCopyAttempt = null;
  render();
  void saveInstallConsent();
});
$('windowsAccessScope').addEventListener('change', event => {
  const next = event.target.value;
  if (!['current-account', 'administrator'].includes(next) || next === windowsAccessScope) { renderInstall(); return; }
  windowsAccessScope = next;
  administratorSetupClient?.cancel();
  installConsentEpoch++;
  installConsent = false;
  installFeedbackKey = null;
  windowsCopyAttempt = null;
  resetDetection();
  renderInstall();
  void saveInstallConsent();
});
for (const [shell, [, button]] of Object.entries(WINDOWS_GUIDED_ENTRIES)) {
  $(button).addEventListener('click', event => copyWindowsGuidedCommand(event, shell));
}
$('detectInstall').addEventListener('click', () => { void detectInstallation(); });

$('reviewSetup').addEventListener('click', () => {
  try {
    reviewed = serializeSetupRequest(currentRequest());
    $('request-preview').textContent = reviewed;
    $('exportConsent').checked = false;
    render();
    $('setupReview').showModal();
  } catch { feedback = '导出未发起。请重新核对目标与当前扩展标识。'; render(); }
});
$('cancelSetup').addEventListener('click', () => $('setupReview').close());
$('setupReview').addEventListener('close', () => {
  // A queued close from an older review must not erase a newly opened one.
  if ($('setupReview').open) return;
  reviewed = null;
  $('request-preview').textContent = '';
  $('exportConsent').checked = false;
  render();
});
$('exportConsent').addEventListener('change', render);
$('downloadSetup').addEventListener('click', () => {
  if (!reviewed || !$('exportConsent').checked || !$('setupReview').open) return;
  try {
    if (serializeSetupRequest(currentRequest()) !== reviewed) throw new Error('Binding changed.');
    const url = URL.createObjectURL(new Blob([reviewed], { type: 'application/json;charset=utf-8' }));
    urls.add(url);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'agent-continue-setup-request.json';
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
    feedback = '已发起导出；尚未验证是否保存、安装或授权。';
  } catch { feedback = '导出未发起。请重新核对目标与当前扩展标识。'; }
  $('setupReview').close();
  render();
});
$('language').addEventListener('change', async event => {
  try { await setLanguage(event.target.value); }
  catch { feedback = '语言设置保存失败。'; }
  render();
});
for (const event of [globalThis.chrome?.permissions?.onAdded, globalThis.chrome?.permissions?.onRemoved]) {
  event?.addListener(change => {
    if (!change?.permissions?.includes('nativeMessaging')) return;
    resetDetection();
    permission = 'unknown';
    render();
    void refreshPermission();
  });
}
addEventListener('pagehide', () => {
  administratorSetupClient?.cancel();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
});
// Preserve deep links when their destination lives in collapsed advanced content.
function revealSetupAnchor(hash) {
  const target = $(hash.slice(1));
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
  target.scrollIntoView?.({ block: 'start' });
}
for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener('click', () => revealSetupAnchor(link.hash));
}
addEventListener('hashchange', () => revealSetupAnchor(globalThis.location.hash));
await initializeLanguage();
initialized = true;
subscribeLanguage(render);
await loadInstallConsent();
render();
renderFirstInstallGuidance();
await refreshPermission();
if (globalThis.location?.hash) revealSetupAnchor(globalThis.location.hash);

// Read-only: renders the five facts from `status --json`. It never executes
// reg.exe, never contacts the registry and never registers or starts the host.
async function renderFirstInstallGuidance() {
  const block = $('firstInstallGuidance'), target = $('firstInstallPreview');
  if (!block || !target) return;
  // The installer host injects this read-only bridge; without it the page
  // states that the status is unknown instead of guessing or clearing.
  const view = await resolveStatusView(globalThis.agentContinueRegistrationStatus,
    { language: getLanguage(), timeoutMs: 1500 });
  target.textContent = view.text;
  block.hidden = false;
}

async function loadInstallConsent() {
  const epoch = installConsentEpoch;
  if (epoch !== 0) return;
  try {
    const values = await globalThis.chrome?.storage?.local?.get?.([CONSENT_KEY]);
    if (epoch === installConsentEpoch && windowsAccessScope === 'current-account') installConsent = values?.[CONSENT_KEY] === true;
  } catch { if (epoch === installConsentEpoch) installConsent = false; }
}

async function saveInstallConsent() {
  // The legacy persisted boolean authorizes only the current-account command.
  try { await globalThis.chrome?.storage?.local?.set?.({ [CONSENT_KEY]: windowsAccessScope === 'current-account' && installConsent }); }
  catch { installFeedbackKey = '无法保存同意状态。'; render(); }
}

async function copyWindowsGuidedCommand(event, shell) {
  if (!event.isTrusted || installOs !== 'windows' || !installConsent) return;
  const [preview, , feedback] = WINDOWS_GUIDED_ENTRIES[shell];
  const command = windowsGuidedCommand(installPlan(installOs), shell);
  if (!command || command !== $(preview).textContent) {
    windowsCopyAttempt = null;
    renderInstall();
    return;
  }

  if (windowsAccessScope === 'administrator') {
    administratorSetupClient ??= createSetupClient({
      getContext: () => ({ os: installOs, scope: windowsAccessScope, consent: installConsent,
        epoch: installConsentEpoch, extensionId: globalThis.chrome?.runtime?.id }),
      permissionGranted: () => permission === 'granted',
      onChange(state) {
        if (state.state === 'copy-failed') $('windowsCommandDetails').open = true;
        renderInstall();
      },
    });
    await administratorSetupClient.copy(event, shell);
    return;
  }

  const attempt = { command, feedbackKey: '' };
  windowsCopyAttempt = attempt;
  $(feedback).textContent = '';
  try {
    await navigator.clipboard.writeText(command);
    attempt.feedbackKey = '已复制安装命令。';
  } catch {
    attempt.feedbackKey = '无法自动复制，请选择命令文本手动复制。';
    if (windowsCopyAttempt === attempt && shell === 'browserPowerShell') $('windowsCommandDetails').open = true;
  }
  if (windowsCopyAttempt === attempt) renderInstall();
}

function resetDetection() {
  probeGeneration++;
  detecting = false;
  hostStartable = false;
  connection = 'unknown';
  detection = 'unchecked';
}

async function detectInstallation() {
  if (detecting || installOs !== 'windows') return;
  resetDetection();
  const generation = probeGeneration;
  detecting = true;
  render();
  try {
    const granted = await refreshPermission();
    const runtime = globalThis.chrome?.runtime;
    if (generation !== probeGeneration || granted !== 'granted' || typeof runtime?.sendNativeMessage !== 'function') return;
    const result = await controlDevice(runtime, 'status', undefined, 5000);
    if (generation !== probeGeneration) return;
    if (result.kind === 'observed') {
      detection = 'registered';
      hostStartable = true;
      connection = result.connection;
    } else {
      detection = result.reason === 'host-absent' ? 'host-missing' : 'unavailable';
    }
  } finally {
    if (generation === probeGeneration) {
      detecting = false;
      render();
    }
  }
}
