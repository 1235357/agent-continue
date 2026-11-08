import { createTranslator, initializeLanguage, subscribeLanguage, setLanguage, getLanguage } from './i18n.js';
import { createDeviceController, deviceScope, HOST, PENDING_KEY, PRIORITY_PAUSE_KEY, REVISION_KEY } from './device-control.js';
import { BROWSER_WAKE_HOST, controlPrepared, validPreparedReference } from './browser-wake.js';
import { ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_PAUSE, ADMIN_BROWSER_PAUSE_LAST, ADMIN_BROWSER_PAUSE_RECONCILE, ADMIN_BROWSER_PAUSE_STATUS, ADMIN_BROWSER_RESTORE, adminBrowserObservation, adminBrowserPauseRecord } from './admin-browser.js';
import { ADMIN_CONTROL_SUPPORT, ADMIN_CONTROL, ADMIN_CONTROL_STATUS, ADMIN_CONTROL_FENCE, ADMIN_CONTROL_RECONCILE, ADMIN_CONTROL_JOURNAL, administratorControlRecord, administratorControlJournal, administratorControlSupport, administratorControlStatus } from './admin-control.js';

const catalog = {
  '重新核对浏览器权限': 'Check browser permission',
  '浏览器权限已授权': 'Browser permission granted',
  '正在读取浏览器权限。不会发起设备连接。': 'Checking browser permission. This does not connect a device.',
  '浏览器权限已授权；本次权限检查不会启动设备或连接隧道。': 'Browser permission granted; this permission check does not connect a device or start a tunnel.',
  '浏览器未批准权限。可重新点击允许；勾选风险确认不会自行授予权限。': 'The browser denied permission. You may request it again; the consent checkbox does not grant permission.',
  '浏览器权限请求不可用。请检查此浏览器是否支持可选的原生消息权限。': 'The browser permission request is unavailable. Check whether this browser supports optional native messaging.',
  '无法核实浏览器权限。尚未联系本机桥接；可只读重新核对权限。': 'Browser permission could not be verified. The native bridge was not contacted; you can check permission again without changing it.',
  '本机操作记录不可用，权限请求暂时禁用；可只读重新核对浏览器权限。': 'Local operation records are unavailable, so requesting permission is disabled. You can still check browser permission without changing it.',
  '现有设备操作结果未确认，权限请求暂时禁用；可只读重新核对权限和原操作回执。': 'An existing device operation is unresolved, so requesting permission is disabled. You can still check browser permission and the original receipt without replaying the operation.',
  '正在等待浏览器权限结果；尚未连接设备。': 'Waiting for the browser permission result; no device connection has been started.',
  '设备检查或操作尚未结束，权限请求暂时禁用。': 'A device check or operation is still pending, so requesting permission is disabled.',
  '浏览器权限尚未授予。请先勾选风险确认，再点击允许并完成浏览器弹窗。': 'Browser permission is not granted. Select the consent checkbox, then click Allow and complete the browser prompt.',
  '风险确认已勾选，但浏览器权限尚未授予。请点击允许并完成浏览器弹窗。': 'Consent is selected, but browser permission is not granted. Click Allow and complete the browser prompt.',
  'Agent Continue | 设备': 'Agent Continue | Devices',
  '跳至设备状态': 'Skip to device status',
  '设备': 'Devices',
  '界面语言': 'Interface language',
  '英语': 'English',
  '简体中文': 'Simplified Chinese',
  '本机': 'This device',
  '账户': 'Account',
  '当前账户': 'Current account',
  '管理员': 'Administrator',
  '正在核对撤销支持。尚未请求撤销。': 'Checking Revoke support. Revocation has not been requested.',
  '未能核实撤销支持。未发出撤销请求；可重试检查。': 'Revoke support could not be verified. No revocation was requested; you can retry the check.',
  '独立管理器': 'Standalone manager',
  '浏览器管理的 Windows': 'Browser-managed Windows',
  'Windows 管理员运行端': 'Windows administrator runtime',
  '核对管理员状态': 'Check administrator status',
  '暂停管理员连接': 'Pause administrator connection',
  '确认暂停': 'Confirm pause',
  '若发出新请求，确认后本机 Windows 会提示授权。此操作仅影响管理员 MCP，不会更改普通权限连接或提示词调度。': 'If a new request is sent, a local Windows authorization prompt follows confirmation. This affects only the administrator MCP and does not change the standard connection or prompt schedules.',
  '如果上次暂停仍未解决，则不会发出新请求。请查询上次操作的回执。': 'If a previous Pause is unresolved, no new request is sent. Check the receipt for the previous operation.',
  '正在请求管理员暂停。尚未核实结果。': 'Requesting administrator Pause. The outcome is not verified.',
  '上次暂停记录（非当前连接状态）：': 'Last Pause record (not current connection status):',
  '已存操作进度（非当前状态）：': 'Saved operation progress (not current status):',
  '已请求管理员暂停，但未核实是否停止。请查询操作回执。': 'Administrator Pause was requested, but shutdown is not verified. Check the operation receipt.',
  '管理员暂停请求已取消。仍可查询操作回执。': 'The administrator Pause request was cancelled. You can still check the operation receipt.',
  '管理员暂停请求的结果未确认。若有操作编号，请查询回执。': 'The administrator Pause request is unconfirmed. Check the receipt if an operation ID is available.',
  '核对上次暂停并防止重放': 'Reconcile last Pause',
  '请求防重放': 'Request fence',
  '此请求需要本机 Windows 授权。防重放仅阻止此编号再次被接收，不会重新连接或更改当前连接，也不能证明上次请求从未执行。': 'This request requires local Windows authorization. A fence only prevents this ID from being admitted again. It does not reconnect or change the current connection, and it does not prove the earlier request never ran.',
  '正在请求防重放。尚未核实结果。': 'Requesting a fence. The outcome is not verified.',
  '已请求在本机启动核对，但尚未核实防重放结果。请查询该操作的回执。': 'The local reconciliation launch was requested, but the fence is not verified. Check the receipt for that operation.',
  '已取消核对所需的 Windows 授权。请查询该操作的回执。': 'Local Windows authorization was cancelled. Check the receipt for that operation.',
  '核对是否在本机启动尚未确认。请查询该操作的回执。': 'The local reconciliation launch is unconfirmed. Check the receipt for that operation.',
  '未发出新请求。请查询现有操作的回执。': 'No new request was sent. Check the receipt for the existing operation.',
  '无法读取上次管理员暂停记录。': 'Could not read the last administrator Pause record.',
  '管理员暂停操作编号': 'Administrator pause operation ID',
  '查询暂停回执': 'Check pause receipt',
  '正在查询管理员暂停回执。': 'Checking the administrator pause receipt.',
  '该操作的暂停已记录，未证实已停止。': 'Pause was recorded for this operation. Shutdown was not verified.',
  '核实该操作时，受管管理员运行端未在运行；这不是当前连接状态。': 'The managed administrator runtime was not running when this operation was verified. This is not the current connection status.',
  '此暂停已被取代，未应用于原目标。这不是当前连接状态。': 'This Pause was superseded and was not applied to its original target. This is not the current connection status.',
  '此暂停编号不能再次被接收。其先前影响未知。这不是当前连接状态。': 'This Pause ID cannot be admitted again. Its prior effect is unknown. This is not the current connection status.',
  '该操作没有可核实的暂停回执。未重新发起暂停。': 'No verified pause receipt for this operation. Pause was not resent.',
  '管理员操作需要本机 Windows 授权及对应原生支持。普通权限连接的操作不会影响管理员连接。': 'Administrator actions require local Windows authorization and corresponding native support. Standard connection controls do not affect the administrator connection.',
  '核对管理员操作支持': 'Check administrator control support',
  '连接前自动检查': 'Connect Windows',
  '高级设置与诊断': 'Advanced setup and diagnostics',
  '正在自动核对本机连接条件。尚未请求启动。': 'Checking the Windows connection requirements. Startup has not been requested.',
  '未能核实连接条件。请检查安装或展开高级诊断；没有请求启动。': 'Connection requirements could not be verified. Check setup or open advanced diagnostics; startup was not requested.',
  '连接准备已取消，保留你的暂停选择。': 'Connection preparation was cancelled; your pause choice is preserved.',
  '连接准备已取消，保留你的撤销选择。': 'Connection preparation was cancelled; your Revoke choice is preserved.',
  '连接管理员运行端': 'Connect administrator runtime',
  '重连已保存的管理员连接': 'Reconnect saved administrator connection',
  '撤销此安装的管理员授权': 'Revoke administrator authorization for this installation',
  '连接支持': 'Connect support',
  '已保存连接的重连支持': 'Saved-connection reconnect support',
  '撤销支持': 'Revoke support',
  '管理员操作记录': 'Administrator operation record',
  '安装包 SHA-256': 'Bundle SHA-256',
  '管理员操作': 'Administrator action',
  '原始操作目标': 'Original operation target',
  '距请求记录的时间（最近更新时）': 'Elapsed since request record (at last update)',
  '已存请求结果': 'Stored submission outcome',
  '已存操作状态（非当前就绪状态）': 'Stored operation state (not current readiness)',
  '最近手动回执查询': 'Last manual receipt read',
  '原生验证进度': 'Native verification progress',
  '重读操作记录': 'Reload operation records',
  '查询此操作回执': 'Read this operation receipt',
  '恢复核对此操作': 'Recover this operation',
  '阻止此编号再次接收': 'Fence this operation ID',
  '确认管理员操作': 'Confirm administrator action',
  '连接可能解除本机暂停并请求管理员运行端启动。确认后需要本机 Windows 授权；启动请求不代表已就绪，也不授予对话工具权限。': 'Connect may clear a local pause and request administrator runtime startup. Local Windows authorization follows confirmation; a startup request is not readiness or a chat tool grant.',
  '重连仅恢复已保存为运行且仍获授权的安装，不会解除暂停或撤销，也不会自动改为连接。确认后需要本机 Windows 授权。': 'Reconnect resumes only a saved-running, still-authorized installation. It cannot unpause or undo revocation and never falls through to Connect. Local Windows authorization follows confirmation.',
  '撤销会禁止此安装后续管理员连接，与代次及当前就绪状态无关。确认后需要本机 Windows 授权。撤销标记不证明进程已停止，也不会更改普通连接、调度或对话授权。': 'Revoke denies future administrator connections for this entire installation, independently of generation or readiness. Local Windows authorization follows confirmation. A revocation marker is not proof of stopped processes and does not change standard connections, schedules, or chat grants.',
  '恢复核对需要本机 Windows 授权，仅核对此安装的同一操作编号；可能通过放弃或保留暂停来降低权限，绝不会重放启动或任务请求。结果仍需查询回执。': 'Recovery requires local Windows authorization and reconciles this same installation and operation ID only. It may reduce authority by abandoning the operation or preserving pause, but never replays startup or task requests. Read the receipt to verify the outcome.',
  '防重放需要本机 Windows 授权，仅阻止此编号再次接收，不会重试原操作、创建新目标或证明先前操作从未执行。结果仍需查询回执。': 'Fencing requires local Windows authorization and only prevents this ID from being admitted again. It never retries the original action, invents a target, or proves the original action never ran. Read the receipt to verify the outcome.',
  '整个安装，无代次目标': 'Entire installation; no generation target',
  '尚未核对原生操作支持。': 'Native control support has not been checked.',
  '操作支持已核对；不代表当前就绪或对话授权。': 'Control support was checked; this does not establish current readiness or chat grants.',
  '使用上次核实的撤销支持；当前状态未确认。': 'Using last verified Revoke support; current state is unconfirmed.',
  '输入另一操作的回执引用（只读）': 'Enter another operation receipt reference (read-only)',
  '正在核对原生操作支持。': 'Checking native control support.',
  '原生支持未确认；此操作已禁用。': 'Native support is unconfirmed; this action is disabled.',
  '原生支持已确认；可请求此操作。': 'Native support confirmed; this action is eligible.',
  '原生支持已确认；当前不可请求此操作。': 'Native support confirmed; this action is currently ineligible.',
  '已保存意图未知': 'Saved intent unobserved',
  '已保存暂停': 'Saved intent paused',
  '已保存运行（不代表就绪）': 'Saved intent running (not readiness)',
  '安装已撤销': 'Installation revoked',
  '没有已存管理员操作。': 'No stored administrator operations.',
  '管理员操作记录不可用或无效。新启动和恢复操作保持禁用。': 'Administrator operation records are unavailable or invalid. New startup and recovery actions remain disabled.',
  '管理员启动结果尚未确认。请读取同一操作回执，不要重新提交。': 'Administrator startup is unconfirmed. Read the same operation receipt; do not resubmit.',
  '正在等待 Windows 授权或本机接收。尚未核实结果。': 'Awaiting Windows authorization or local admission. The outcome is not verified.',
  '此操作已请求。尚未核实实际效果；请查询同一编号的回执。': 'This action was requested. Actual effects are not verified; read the receipt for this same ID.',
  'Windows 请求已取消。仍可查询同一编号的回执。': 'The Windows request was cancelled. The same ID remains available for receipt readback.',
  '请求结果未确认。已保留记录；不会重试或生成新编号。': 'The request outcome is unconfirmed. Records are retained; no retry or new operation ID is generated.',
  '无法核实管理员操作状态；新连接保持禁用。': 'Administrator operation status could not be verified; new connections stay disabled.',
  '管理员请求仍在等待处理；新连接保持禁用。': 'Administrator request pending; new connections stay disabled.',
  '管理员操作结果未确认；新连接保持禁用，不会自动重试。': 'Administrator outcome unknown; new connections stay disabled. No automatic retry.',
  '管理员操作结果未确认；不会自动重试。': 'Administrator outcome unknown. No automatic retry.',
  'Windows 授权已取消；操作结果仍未确认，不会自动重试。': 'Windows approval was cancelled; the outcome remains unknown. No automatic retry.',
  '管理员请求已发送；尚未核实结果。': 'Administrator request sent; the outcome is not verified.',
  '撤销已记录；尚未确认停止。': 'Revocation recorded; shutdown was not verified.',
  '上次请求保留暂停；尚未确认停止。': 'The last request preserved Pause; shutdown was not verified.',
  '上次请求已核实停止；不代表当前连接状态。': 'Shutdown was verified for the last request; this is not current connection status.',
  '上次启动请求已记录；尚未核实当前就绪。': 'The last startup request was recorded; current readiness is not verified.',
  '上次请求已被取代；不代表当前连接状态。': 'The last request was superseded; this is not current connection status.',
  '上次请求被拒绝；不代表当前连接状态。': 'The last request was rejected; this is not current connection status.',
  '上次请求已阻止再次接收；先前影响仍未确认。': 'The last request was fenced against future admission; earlier effects are not verified.',
  '上次请求已放弃；未重放启动。': 'The last request was abandoned; startup was not replayed.',
  '管理员操作仍未解决；新连接保持禁用。': 'An administrator operation remains unresolved; new connections stay disabled.',
  '原生支持或操作记录已变化。未发出请求；请重新核对。': 'Native support or operation records changed. No request was sent; check again.',
  '有未解决的管理员操作。新启动保持禁用；暂停和撤销不受此限制。': 'An administrator operation is unresolved. New startup remains disabled; Pause and Revoke are not blocked by startup.',
  '正在读取此编号的回执。': 'Reading the receipt for this ID.',
  '此编号的回执未确认。未重试原操作。': 'The receipt for this ID is unconfirmed. The original action was not retried.',
  '尚未手动读取回执。': 'No manual receipt read yet.',
  '等待原生操作回执。': 'Waiting for a native operation receipt.',
  '本机已保留操作编号；尚未记录意图或确认启动。': 'The operation ID is reserved locally; intent or startup is not yet confirmed.',
  '运行意图已记录；尚未确认已启动或就绪。': 'Running intent was saved; startup and readiness are not confirmed.',
  '启动已请求；等待运行端。此历史回执不代表当前就绪。': 'Restart requested; waiting for runtime. This historical receipt does not establish current readiness.',
  '启动结果未知；不得重放任务请求。': 'The startup outcome is unknown; do not replay the task request.',
  '此安装的撤销已记录；未证实进程已停止。': 'Revocation was recorded for this installation; stopped processes are not verified.',
  '核对此操作时已证实停止；不代表当前运行端状态。': 'Shutdown was verified when this operation was checked; this is not current runtime state.',
  '此操作已被取代；不代表当前运行端状态。': 'This operation was superseded; this is not current runtime state.',
  '此操作被拒绝；不代表当前运行端状态。': 'This operation was rejected; this is not current runtime state.',
  '此编号已被禁止再次接收；先前影响不由此证明。': 'This ID is fenced against future admission; its earlier effects are not established by this receipt.',
  '此操作已放弃；未重放启动。': 'This operation was abandoned; startup was not replayed.',
  '此操作已恢复为暂停；未重放启动，不代表进程已停止。': 'This operation recovered to paused; startup was not replayed and stopped processes are not implied.',
  '没有已核实的原生进度。': 'No verified native progress.',
  '正在完整校验运行端': 'Verifying the complete installed runtime',
  '正在校验受控操作': 'Verifying the protected control action',
  '正在等待运行端': 'Waiting for runtime',
  '正在等待停止证据': 'Waiting for shutdown evidence',
  '进度阶段已收尾（不代表成功）': 'Progress phase settled (not proof of success)',
  '已校验文件': 'Verified files',
  '秒': 'seconds',
  '普通权限桥接注册': 'Standard bridge registration',
  '普通权限 MCP 连接': 'Standard MCP connection',
  '普通权限连接暂停': 'Standard connection pause',
  '检查普通权限连接': 'Check standard connection',
  '断开并暂停普通权限连接': 'Disconnect and pause standard connection',
  '重连普通权限连接': 'Reconnect standard connection',
  '恢复普通权限 MCP 的远程访问？此操作不会重连管理员连接，也不会更改对话授权。': 'Restore remote access to the standard MCP connection? This does not reconnect the administrator runtime or change chat grants.',
  '断开普通权限 MCP 并保留暂停？管理员连接和提示词调度不会暂停。': 'Disconnect the standard MCP connection and keep it paused? This does not pause the administrator runtime or prompt scheduling.',
  '浏览器重开时恢复已授权的管理员连接': 'Restore the authorized administrator connection when Chrome reopens',
  '此选项不安装或授权运行端，不启动首次连接，也不解除本机暂停。关闭此选项不会取消已受理的启动或暂停现有连接；需要停止时请使用断开并暂停。': 'This does not install or authorize the runtime, start a first connection, or clear a local pause. Turning it off does not cancel an accepted startup or pause an existing connection; use Disconnect and pause to stop.',
  '最近检查时，本机运行端报告就绪。尚未验证网页工具授权。': 'The local runtime reported ready at the last check. Chat tool access is not verified.',
  '本机运行端未观测到就绪。': 'Local runtime readiness was not observed.',
  '未收到有效的管理员状态回执。': 'No valid administrator status response.',
  '尚未核对管理员状态。': 'Administrator status has not been checked.',
  '无法保存管理员恢复选项。': 'Could not save the administrator recovery preference.',
  '远程设备': 'Remote device',
  '当前设备': 'Selected device',
  '返回本机': 'Return to this device',
  '设备选择无效': 'Invalid device selection',
  '远程设备登记尚未发布。已在本机登记的目标可使用安装器提供的设备链接选择；此页面不接收主机、密钥或 SSH 命令。': 'Remote enrollment is not released. A locally enrolled target can be selected using an installer-provided device link; this page never accepts hosts, keys, or SSH commands.',
  '安装指南': 'Installation guide',
  '请从已校验并解压的 Windows 安装包中运行命令。不需要 Agent Continue EXE/MSI 安装器或管理员提权；只有浏览器管理模式注册本机控制桥。': 'Run the setup command from a verified, extracted Windows bundle. No Agent Continue EXE/MSI installer or administrator elevation is required. Only browser-managed mode registers the local bridge.',
  'Windows 命令安装与本机控制': 'Windows command setup and local controls',
  '使用 PowerShell 或 CMD 引导安装。安装后可按需使用临时本机地址和配对码打开控制面板。': 'Use the guided PowerShell or CMD setup. After setup, you can open controls with a temporary local address and pairing code.',
  '连接 ChatGPT 或 Dot': 'Connect ChatGPT or Dot',
  '按托管连接步骤单独配置工具并为选定的对话授权。本机安装或配对不会授予对话访问权限。': 'Follow the hosted connection steps to configure tools and authorize the chosen conversation separately. Local setup or pairing does not grant chat access.',
  '浏览器权限': 'Browser permission',
  '原生桥接注册': 'Native bridge registration',
  'MCP 连接': 'MCP connection',
  '手动暂停': 'Manual pause',
  '设备操作': 'Device operation',
  '操作编号': 'Operation ID',
  '最近有效观测': 'Last valid observation',
  '未知': 'Unknown',
  '尚未检查': 'Not checked',
  '尚无回执': 'No receipt',
  '无': 'None',
  '尚无观测': 'No observation',
  '尚未检查设备状态。': 'Device status has not been checked.',
  '检查状态': 'Check status',
  '断开并暂停': 'Disconnect and pause',
  '重新连接': 'Reconnect',
  '可选的原生桥接': 'Optional native bridge',
  '独立管理和临时本机配对不需要原生消息权限。使用浏览器管理模式时，请先注册本机控制桥，再授予此权限。': 'Standalone mode and temporary local pairing do not need native messaging. For browser-managed mode, register the local bridge before granting this permission.',
  '原生消息权限允许扩展联系单独安装的本机控制桥。重新连接会恢复 MCP 远程访问；断开并暂停会中断该访问。此权限不会安装控制桥，也不会授予任何对话工具权限。': 'Native messaging permission lets the extension contact a separately installed local bridge. Reconnecting restores MCP remote access; disconnecting and pausing interrupts that access. This permission neither installs the bridge nor grants tools to any chat.',
  '我理解本机控制及恢复远程访问的风险，并同意请求可选的原生消息权限。': 'I understand the risks of local control and restoring remote access, and consent to requesting optional native messaging permission.',
  '允许本机控制桥访问': 'Allow local bridge access',
  '原生主机标识': 'Native host identity',
  '扩展标识': 'Extension ID',
  '对话与设备边界': 'Chat and device boundaries',
  'Dot 与普通 ChatGPT 对话使用相同的设备控制边界。设备操作独立于提示词调度；不会开始、暂停或更改任何调度任务，也不会更改对话授权。': 'Dot and ordinary ChatGPT chats have the same device-control boundary. Device actions are separate from prompt scheduling: they do not start, pause, or change scheduled jobs or change chat grants.',
  '对话中的工具可用性与审批仍由对应平台管理。这里的回执只反映控制桥报告的有限状态，不证明远端访问或工具授权成功。远程管理接线是未发布源码候选，尚未进行真实 SSH 或登录恢复验收。': 'Tool availability and approval remain with each chat platform. Receipts here reflect only bounded state reported by the bridge, not successful remote access or tool authorization. Remote management wiring is an unreleased source candidate without real SSH or login-recovery acceptance.',
  '取消': 'Cancel',
  '确认操作': 'Confirm action',
  '已授权': 'Granted',
  '未授权': 'Not granted',
  '未注册': 'Not registered',
  '桥接可响应': 'Bridge reachable',
  '已就绪': 'Ready',
  '已断开': 'Disconnected',
  '已暂停': 'Paused',
  '未暂停': 'Not paused',
  '进行中，尚未完成': 'In progress, not complete',
  '仍在执行，结果未知': 'Still running, outcome unknown',
  '已收尾，不代表成功': 'Settled, not proof of success',
  '未执行': 'Not executed',
  '结果未确认': 'Outcome unconfirmed',
  '设备操作待完成或结果未确认。只可检查状态；普通状态回执不会解除锁定。': 'A device operation is pending or unconfirmed. Only status checks are available; a generic status receipt will not release the lock.',
  '连接操作待确认。暂停仍可使用；不会重试连接或清除原操作记录。': 'A connection operation is unconfirmed. Pause remains available; reconnect will not be retried and the original record is retained.',
  '本机操作记录不可用。控制保持锁定，请在本机核实。': 'The local operation record is unavailable. Controls remain locked; verify locally.',
  '安全的多页面锁定不可用。只可检查状态。': 'Safe multi-page locking is unavailable. Only status checks are available.',
  '已获得浏览器权限。尚未检查原生控制桥；权限不代表安装成功。': 'Browser permission granted. The native bridge has not been checked; permission is not proof of installation.',
  '浏览器权限未获批准。未联系原生控制桥。': 'Browser permission was not granted. The native bridge was not contacted.',
  '无法请求浏览器权限。此构建或浏览器可能不支持可选的原生访问。': 'Cannot request browser permission. This build or browser may not support optional native access.',
  '检查状态需要浏览器权限；未弹出权限申请，也未联系原生控制桥。': 'Checking status requires browser permission; no permission prompt or native bridge request was sent.',
  '正在检查状态；不会重试。': 'Checking status; no retries.',
  '正在发送设备操作；尚未确认完成。': 'Sending the device action; completion is not confirmed.',
  '收到本机桥接的有限状态回执；不代表对话授权或远端访问成功。': 'Received bounded state from the local bridge; this does not establish chat grants or successful remote access.',
  '原生桥接拒绝了请求；未确认设备操作结果。': 'The native bridge rejected the request; no device action outcome is confirmed.',
  '原生主机未注册。浏览器权限与本机安装是独立步骤。': 'The native host is not registered. Browser permission and local installation are separate steps.',
  '请求超时。结果未知；不会自动重试或重新连接。': 'The request timed out. The outcome is unknown; there is no automatic retry or reconnect.',
  '响应未通过协议或关联校验。状态和操作结果仍未知。': 'The response failed protocol or correlation checks. State and action outcome remain unknown.',
  '无法联系原生控制桥。原因未知，不能据此判断已安装或已断开。': 'Cannot contact the native bridge. The cause is unknown; this does not establish installation or disconnection.',
  '未收到与待处理操作匹配的完成回执。保持锁定，不会自动重试。': 'No matching completion receipt was received for the pending action. Controls stay locked; no automatic retry.',
  '本机协调或存储不可用。未发起新的设备操作；既有操作仍需核实。': 'Local coordination or storage is unavailable. No new device action was started; existing actions still need verification.',
  '语言设置保存失败。': 'The language preference could not be saved.',
  '重新连接会恢复选定设备 MCP 的远程访问。此操作不会更改 Dot 或普通对话的工具授权。是否继续？': 'Reconnecting restores remote access to the selected device\'s MCP. It does not change tool grants in Dot or ordinary chats. Continue?',
  '断开并暂停会中断选定设备 MCP 的远程访问并保留手动暂停。此操作不会暂停提示词调度或更改对话授权。是否继续？': 'Disconnecting and pausing interrupts remote MCP access for the selected device and preserves manual pause. It does not pause prompt scheduling or change chat grants. Continue?',
  '已准备的命令': 'Prepared command',
  '命令 SHA-256': 'Command SHA-256',
  '核对命令引用': 'Check command reference',
  '撤销待执行命令': 'Revoke pending command',
  '确认撤销': 'Confirm revocation',
  '撤销会阻止此引用的后续执行，但不会停止已被接收的命令，也不会更改任何对话权限。': 'Revocation blocks future execution of this reference. It does not stop a command that has already been admitted or change any chat grants.',
  '已准备，尚无接收回执。': 'Prepared; no admission receipt was found.',
  '引用已过期。': 'The reference has expired.',
  '此引用已由设备所有者撤销。': 'This reference has been revoked by the device owner.',
  '已接收，执行结果未确认。': 'Admitted; execution outcome unconfirmed.',
  '执行端报告了结果，未核对实际效果。': 'The provider reported a result; actual effects were not verified.',
  '执行端报告了错误，实际效果未知。': 'The provider reported an error; actual effects are unknown.',
  '本机回执不可用，无法判断执行状态。': 'The local receipt is unavailable; execution state is unknown.',
  '无法核实结果。未自动重试。': 'The outcome could not be verified. No automatic retry was attempted.',
  '等待本机回执。': 'Waiting for the local receipt.',
  '先核实当前设备状态。': 'Check the current device status first.',
};
const t = createTranslator(catalog);
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const feedbackKeys = {
  'not-checked': '尚未检查设备状态。',
  'permission-granted': '已获得浏览器权限。尚未检查原生控制桥；权限不代表安装成功。',
  'permission-denied': '浏览器权限未获批准。未联系原生控制桥。',
  'permission-unavailable': '无法请求浏览器权限。此构建或浏览器可能不支持可选的原生访问。',
  'permission-required': '检查状态需要浏览器权限；未弹出权限申请，也未联系原生控制桥。',
  checking: '正在检查状态；不会重试。',
  'requesting-mutation': '正在发送设备操作；尚未确认完成。',
  observed: '收到本机桥接的有限状态回执；不代表对话授权或远端访问成功。',
  rejected: '原生桥接拒绝了请求；未确认设备操作结果。',
  'host-absent': '原生主机未注册。浏览器权限与本机安装是独立步骤。',
  timeout: '请求超时。结果未知；不会自动重试或重新连接。',
  'invalid-response': '响应未通过协议或关联校验。状态和操作结果仍未知。',
  transport: '无法联系原生控制桥。原因未知，不能据此判断已安装或已断开。',
  unconfirmed: '未收到与待处理操作匹配的完成回执。保持锁定，不会自动重试。',
  'local-unavailable': '本机协调或存储不可用。未发起新的设备操作；既有操作仍需核实。',
};
const operationKeys = { 'in-progress': '进行中，尚未完成', 'unknown-running': '仍在执行，结果未知', settled: '已收尾，不代表成功', 'not-executed': '未执行', unknown: '结果未确认' };
const browserManagedActionKeys = {
  status: '检查普通权限连接',
  'disconnect-and-pause': '断开并暂停普通权限连接',
  reconnect: '重连普通权限连接',
};
const browserManagedRiskKeys = {
  'disconnect-and-pause': '断开普通权限 MCP 并保留暂停？管理员连接和提示词调度不会暂停。',
  reconnect: '恢复普通权限 MCP 的远程访问？此操作不会重连管理员连接，也不会更改对话授权。',
};
let pendingAction = null, languageError = false;
const initialParams = new URL(globalThis.location.href).searchParams;
const accounts = initialParams.getAll('account');
const accountHint = accounts.length === 1 && ['current', 'administrator'].includes(accounts[0]) &&
  initialParams.getAll('mode').length === 1 && initialParams.get('mode') === 'browser-managed' &&
  Array.from(initialParams.keys()).length === 2 ? accounts[0] : undefined;
// Consume only a valid presentation hint; privileged senders still require the exact canonical URL.
if (accountHint && location.pathname === '/devices.html') {
  try { globalThis.history?.replaceState(globalThis.history.state, '', location.pathname + '?mode=browser-managed' + location.hash); }
  catch { /* A noncanonical URL remains ineligible for control. */ }
}
const params = new URL(globalThis.location.href).searchParams;
const targets = params.getAll('target'), modes = params.getAll('mode');
const browserManaged = modes.length === 1 && modes[0] === 'browser-managed' && Array.from(params.keys()).length === 1;
const validSelection = browserManaged || modes.length === 0 &&
  (targets.length === 0 || targets.length === 1 && /^[a-f0-9]{64}$/.test(targets[0]));
const target = validSelection && targets.length ? targets[0] : null;
let selectedAccount = accountHint ?? 'current', accountSelectionMade = false;
function renderAccountSurface() {
  const administrator = browserManaged && selectedAccount === 'administrator';
  $('account-selector').hidden = !browserManaged;
  $('account-current').checked = !administrator;
  $('account-administrator').checked = administrator;
  $('standard-controls').hidden = administrator;
  $('device-diagnostics').hidden = administrator;
  $('prepared-account-scope').hidden = administrator;
  $('administrator-controls').hidden = !administrator;
  $('administrator-control-panel').hidden = !administrator || !adminPauseRoute();
}
const scope = deviceScope(target, browserManaged);
const controller = createDeviceController({ runtime: validSelection ? globalThis.chrome?.runtime : undefined,
  permissions: globalThis.chrome?.permissions, storage: validSelection ? globalThis.chrome?.storage?.local : undefined,
  locks: navigator.locks, target, browserManaged, onChange: () => render() });
const adminStorage = globalThis.chrome?.storage?.local;
let adminStatus, adminReadBusy = false, adminRestore, adminSaveBusy = false, adminSaveFailed = false;
let adminRevision = 0, adminPermissionRefreshing = false, adminPermissionUnverified = false;
let adminGuidedBusy = false, adminGuidedEpoch = 0, adminGuidedNote;
let adminPauseRevision = 0, adminPauseBusy = false, adminPauseResult;
let adminPauseRecord, adminPauseStorageReady, adminPauseStorageRevision = 0;
let adminPauseSubmitting = false, adminPauseRequestNote;
let adminPauseReconciling = false, adminPauseReconcileNote, adminPauseHasReadback = false;
let adminPauseFollowup, adminPauseActionRevision = 0;
const adminPauseLabels = {
  unconfirmed: '该操作没有可核实的暂停回执。未重新发起暂停。',
  'pause-recorded': '该操作的暂停已记录，未证实已停止。',
  stopped: '核实该操作时，受管管理员运行端未在运行；这不是当前连接状态。',
  superseded: '此暂停已被取代，未应用于原目标。这不是当前连接状态。',
  fenced: '此暂停编号不能再次被接收。其先前影响未知。这不是当前连接状态。',
};
const adminPauseRequestLabels = {
  requested: '已请求管理员暂停，但未核实是否停止。请查询操作回执。',
  cancelled: '管理员暂停请求已取消。仍可查询操作回执。',
  unconfirmed: '管理员暂停请求的结果未确认。若有操作编号，请查询回执。',
};
const adminPauseReconcileLabels = {
  requested: '已请求在本机启动核对，但尚未核实防重放结果。请查询该操作的回执。',
  cancelled: '已取消核对所需的 Windows 授权。请查询该操作的回执。',
  unconfirmed: '核对是否在本机启动尚未确认。请查询该操作的回执。',
};
const adminPauseId = () => {
  const value = $('administrator-pause-id').value;
  return value.length === 32 && /^[0-9a-f]{32}$/.test(value) ? value : null;
};
const adminPauseRoute = () => browserManaged && location.pathname === '/devices.html' &&
  location.search === '?mode=browser-managed' && window.top === window && !globalThis.chrome?.extension?.inIncognitoContext;
const administratorPermitted = state => !adminPermissionRefreshing && !adminPermissionUnverified && state.permission === 'granted';
const canRequestAdminPause = state => adminPauseRoute() && administratorPermitted(state) &&
  adminPauseStorageReady && !adminPauseSubmitting && !adminPauseBusy && !adminPauseReconciling;
const adminPauseReconcileId = () => adminPauseStorageReady && !adminPauseHasReadback &&
  adminPauseRecord && adminPauseRecord.outcome !== 'cancelled' ? adminPauseRecord.operationId : undefined;

function cancelAdministratorPauseFollowup() {
  const followup = adminPauseFollowup;
  adminPauseFollowup = undefined;
  if (!followup) return;
  clearTimeout(followup.timer);
  followup.cancelRead?.();
}

function interruptAdministratorPauseFollowup(event) {
  if (event?.target?.closest?.('#account-selector') || ['account-current', 'account-administrator'].includes(event?.target?.id)) return;
  adminPauseActionRevision++;
  cancelAdministratorPauseFollowup();
}

function currentAdministratorPauseFollowup(followup) {
  return adminPauseFollowup === followup && Date.now() < followup.deadline &&
    followup.revision === adminRevision && followup.storageRevision === adminPauseStorageRevision &&
    followup.inputRevision === adminPauseRevision && followup.href === location.href &&
    adminPauseRoute() && administratorPermitted(controller.getState()) && adminPauseStorageReady &&
    followup.operationId === adminPauseRecord?.operationId && followup.operationId === adminPauseId();
}

function setAdministratorPauseRecord(record, selectLatest = false) {
  const input = $('administrator-pause-id');
  const previousId = adminPauseRecord?.operationId;
  const nextId = record?.operationId;
  if (nextId !== previousId) {
    if (adminGuidedBusy) {
      adminGuidedEpoch++;
      adminGuidedNote = '连接准备已取消，保留你的暂停选择。';
    }
    adminPauseRequestNote = adminPauseReconcileNote = undefined;
    adminPauseHasReadback = false;
    if ($('administrator-pause-dialog').open) $('administrator-pause-dialog').close();
    if ($('administrator-pause-reconcile-dialog').open) $('administrator-pause-reconcile-dialog').close();
  }
  adminPauseRecord = record;
  if ((selectLatest && nextId) || !input.value || input.value === previousId) {
    const nextValue = nextId ?? '';
    if (input.value !== nextValue) {
      input.value = nextValue;
      adminPauseRevision++;
      adminPauseResult = undefined;
    }
  }
}

function observeAdministratorPauseRecord(saved, selectLatest) {
  const record = adminBrowserPauseRecord(saved);
  adminPauseStorageReady = saved === undefined || record !== null;
  setAdministratorPauseRecord(record, selectLatest);
}

async function loadAdministratorPauseRecord(selectLatest = false) {
  const revision = ++adminPauseStorageRevision;
  try {
    const saved = (await adminStorage.get([ADMIN_BROWSER_PAUSE_LAST]))[ADMIN_BROWSER_PAUSE_LAST];
    if (revision !== adminPauseStorageRevision) return;
    observeAdministratorPauseRecord(saved, selectLatest);
  } catch {
    if (revision !== adminPauseStorageRevision) return;
    adminPauseStorageReady = false;
  }
  render();
}

async function adminPausePermitted(revision) {
  try {
    return await chrome.permissions.contains({ permissions: ['nativeMessaging'] }) &&
      revision === adminRevision && adminPauseRoute() && administratorPermitted(controller.getState());
  } catch { return false; }
}

function renderAdministrator(state) {
  if (!browserManaged) return;
  const granted = administratorPermitted(state);
  $('administrator-check').disabled = !granted || adminReadBusy;
  $('administrator-restore').checked = adminRestore === true;
  $('administrator-restore').disabled = adminSaveBusy || typeof adminRestore !== 'boolean' ||
    !(adminRestore || granted && adminStatus);
  const pauseAllowed = canRequestAdminPause(state);
  $('administrator-pause').disabled = !pauseAllowed;
  if (!pauseAllowed && $('administrator-pause-dialog').open) $('administrator-pause-dialog').close();
  const reconcileVisible = adminPauseRoute() && granted && Boolean(adminPauseReconcileId());
  const reconcileAllowed = reconcileVisible && pauseAllowed;
  $('administrator-pause-reconcile').hidden = !reconcileVisible;
  $('administrator-pause-reconcile').disabled = !reconcileAllowed;
  if (!reconcileAllowed && $('administrator-pause-reconcile-dialog').open) $('administrator-pause-reconcile-dialog').close();
  const reconcileFeedback = adminPauseReconciling ? '正在请求防重放。尚未核实结果。' : adminPauseReconcileNote;
  $('administrator-pause-reconcile-feedback').hidden = !reconcileVisible || !reconcileFeedback;
  text('administrator-pause-reconcile-feedback', reconcileFeedback ? t(reconcileFeedback) : '');
  const latestPauseFeedback = adminPauseStorageReady && !adminPauseBusy && !adminPauseReconciling && adminPauseRecord &&
    adminPauseId() === adminPauseRecord.operationId && adminPauseResult !== 'unconfirmed' ? adminPauseLabels[adminPauseResult] : undefined;
  const requestFeedback = adminPauseSubmitting ? '正在请求管理员暂停。尚未核实结果。' : latestPauseFeedback ?? adminPauseRequestNote ??
    (adminPauseStorageReady === false ? '无法读取上次管理员暂停记录。' : adminPauseRequestLabels[adminPauseRecord?.outcome]);
  $('administrator-pause-request-feedback').hidden = !granted || !requestFeedback;
  text('administrator-pause-request-feedback', requestFeedback ?
    (adminPauseSubmitting || latestPauseFeedback ? '' : t('上次暂停记录（非当前连接状态）：') + ' ') + t(requestFeedback) : '');
  $('administrator-pause-id').disabled = adminPauseSubmitting || adminPauseReconciling;
  $('administrator-pause-check').disabled = !adminPauseRoute() || !granted || !adminPauseId() ||
    adminPauseBusy || adminPauseSubmitting || adminPauseReconciling;
  $('administrator-pause-feedback').hidden = !granted || (!adminPauseBusy && !adminPauseResult);
  text('administrator-pause-feedback', adminPauseBusy ? t('正在查询管理员暂停回执。') : adminPauseResult ? t(adminPauseLabels[adminPauseResult]) : '');
  text('administrator-status', t(adminSaveFailed ? '无法保存管理员恢复选项。' :
    !granted || adminStatus === undefined ? '尚未核对管理员状态。' :
      adminStatus === null ? '未收到有效的管理员状态回执。' :
        adminStatus.state === 'ready' ? '最近检查时，本机运行端报告就绪。尚未验证网页工具授权。' :
          '本机运行端未观测到就绪。'));
  renderAdministratorControls(state);
}

async function loadAdministratorPreference() {
  try { adminRestore = (await adminStorage.get([ADMIN_BROWSER_RESTORE]))[ADMIN_BROWSER_RESTORE] === true; }
  catch { adminRestore = undefined; }
  render();
}

const adminControlActions = ['connect', 'resume-saved', 'revoke'];
const adminControlActionKeys = {
  connect: '连接管理员运行端', 'resume-saved': '重连已保存的管理员连接', revoke: '撤销此安装的管理员授权',
  reconcile: '恢复核对此操作', fence: '阻止此编号再次接收',
};
const adminControlElements = { connect: 'administrator-connect', 'resume-saved': 'administrator-reconnect', revoke: 'administrator-revoke' };
const adminControlTerminal = new Set(['launch-requested', 'revocation-recorded', 'stopped', 'superseded', 'rejected', 'fenced', 'abandoned', 'recovered-paused']);
const adminControlStateKeys = {
  unconfirmed: '等待原生操作回执。', reserved: '本机已保留操作编号；尚未记录意图或确认启动。',
  'intent-saved': '运行意图已记录；尚未确认已启动或就绪。',
  'launch-requested': '启动已请求；等待运行端。此历史回执不代表当前就绪。',
  'launch-unconfirmed': '启动结果未知；不得重放任务请求。',
  'revocation-recorded': '此安装的撤销已记录；未证实进程已停止。',
  stopped: '核对此操作时已证实停止；不代表当前运行端状态。',
  superseded: '此操作已被取代；不代表当前运行端状态。', rejected: '此操作被拒绝；不代表当前运行端状态。',
  fenced: '此编号已被禁止再次接收；先前影响不由此证明。', abandoned: '此操作已放弃；未重放启动。',
  'recovered-paused': '此操作已恢复为暂停；未重放启动，不代表进程已停止。',
};
const adminControlOutcomeKeys = {
  requested: '此操作已请求。尚未核实实际效果；请查询同一编号的回执。',
  cancelled: 'Windows 请求已取消。仍可查询同一编号的回执。',
  unconfirmed: '请求结果未确认。已保留记录；不会重试或生成新编号。',
};
const adminControlSummaryOutcomes = {
  requested: '管理员请求已发送；尚未核实结果。',
  cancelled: 'Windows 授权已取消；操作结果仍未确认，不会自动重试。',
  unconfirmed: '管理员操作结果未确认；不会自动重试。',
};
const adminControlSummaryStates = {
  'launch-requested': '上次启动请求已记录；尚未核实当前就绪。',
  'revocation-recorded': '撤销已记录；尚未确认停止。',
  'recovered-paused': '上次请求保留暂停；尚未确认停止。',
  stopped: '上次请求已核实停止；不代表当前连接状态。',
  superseded: '上次请求已被取代；不代表当前连接状态。',
  rejected: '上次请求被拒绝；不代表当前连接状态。',
  fenced: '上次请求已阻止再次接收；先前影响仍未确认。',
  abandoned: '上次请求已放弃；未重放启动。',
};
const adminControlRiskKeys = {
  connect: '连接可能解除本机暂停并请求管理员运行端启动。确认后需要本机 Windows 授权；启动请求不代表已就绪，也不授予对话工具权限。',
  'resume-saved': '重连仅恢复已保存为运行且仍获授权的安装，不会解除暂停或撤销，也不会自动改为连接。确认后需要本机 Windows 授权。',
  revoke: '撤销会禁止此安装后续管理员连接，与代次及当前就绪状态无关。确认后需要本机 Windows 授权。撤销标记不证明进程已停止，也不会更改普通连接、调度或对话授权。',
  reconcile: '恢复核对需要本机 Windows 授权，仅核对此安装的同一操作编号；可能通过放弃或保留暂停来降低权限，绝不会重放启动或任务请求。结果仍需查询回执。',
  fence: '防重放需要本机 Windows 授权，仅阻止此编号再次接收，不会重试原操作、创建新目标或证明先前操作从未执行。结果仍需查询回执。',
};
let adminControlSupports = {}, adminControlSupportBusy = false, adminControlJournalReady = false;
let adminControlKnownRevoke, adminControlRevokeCached = false;
let adminControlRecords = [], adminControlJournalRevision = 0, adminControlSelectionRevision = 0;
let adminControlSelected = '', adminControlReadBusy = false, adminControlReceipt;
let adminControlOptionsSignature;
let adminControlReview, adminControlNote, adminControlStartupUnknown = false;
let adminControlSummaryNote;
let adminRevokePreparing = false;
const adminControlWrites = new Set();
const adminControlKey = record => record ? record.bundleSha256 + ':' + record.operationId : '';
const selectedAdminControl = () => adminControlRecords.find(record => adminControlKey(record) === adminControlSelected);
// Progress polling does not supersede an attempt; changed operation identities or outcomes do.
const administratorControlSummarySnapshot = () => JSON.stringify([adminControlJournalReady, adminControlRecords.map(record =>
  [adminControlKey(record), record.control, record.target, record.createdAt, record.state, record.outcome])]);
function setAdministratorControlNote(note, snapshot = administratorControlSummarySnapshot()) {
  adminControlNote = note;
  adminControlSummaryNote = note && snapshot === administratorControlSummarySnapshot() ? { note, snapshot } : undefined;
}
function administratorControlReference() {
  if (adminControlSelected !== 'manual') return selectedAdminControl();
  const bundleSha256 = $('administrator-control-reference-bundle').value;
  const operationId = $('administrator-control-reference-id').value;
  const control = $('administrator-control-reference-action').value;
  return /^[0-9a-f]{64}$/.test(bundleSha256) && /^[0-9a-f]{32}$/.test(operationId) && adminControlActions.includes(control) ?
    { bundleSha256, operationId, control } : null;
}
const sameAdminControl = (a, b) => Boolean(a && b && a.bundleSha256 === b.bundleSha256 &&
  a.operationId === b.operationId && a.control === b.control);
const sameAdminSupport = (a, b) => Boolean(a && b && ['control', 'state', 'bundleSha256', 'target', 'ownerState', 'eligible'].every(key => a[key] === b[key]));
const unsettledAdminControl = record => !adminControlTerminal.has(record.state);
const recoverableAdminControl = (record, kind) => unsettledAdminControl(record) ||
  kind === 'reconcile' && record.control === 'revoke' && record.state === 'revocation-recorded';

function closeAdministratorControlReview() {
  adminControlReview = undefined;
  if ($('administrator-control-dialog').open) $('administrator-control-dialog').close();
}

function observeAdministratorControlJournal(saved, prefer) {
  const journal = administratorControlJournal(saved);
  adminControlJournalReady = Boolean(journal);
  adminControlRecords = journal?.operations ?? [];
  if (adminControlSummaryNote?.snapshot !== administratorControlSummarySnapshot()) adminControlSummaryNote = undefined;
  const previous = adminControlSelected;
  if (prefer && adminControlRecords.some(record => adminControlKey(record) === prefer)) adminControlSelected = prefer;
  else if (adminControlSelected !== 'manual' && !selectedAdminControl()) adminControlSelected = adminControlKey(adminControlRecords.at(-1));
  if (previous !== adminControlSelected) {
    adminControlSelectionRevision++;
    adminControlReceipt = undefined;
    if (adminControlReview?.kind !== 'revoke') closeAdministratorControlReview();
  }
}

async function loadAdministratorControlJournal(prefer) {
  const revision = ++adminControlJournalRevision;
  try {
    const saved = (await adminStorage.get([ADMIN_CONTROL_JOURNAL]))[ADMIN_CONTROL_JOURNAL];
    if (revision !== adminControlJournalRevision) return;
    observeAdministratorControlJournal(saved, prefer);
  } catch {
    if (revision !== adminControlJournalRevision) return;
    adminControlJournalReady = false;
    closeAdministratorControlReview();
  }
  render();
}

// Timeouts stop only the page's wait. They never resend, cancel native work or erase its ID.
async function administratorControlRequest(message, timeout = message.type === ADMIN_CONTROL_SUPPORT ? 30000 : 5000) {
  let timer;
  try {
    return await Promise.race([chrome.runtime.sendMessage(message),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); })]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function canRequestAdministratorControl(control, state = controller.getState()) {
  const support = adminControlSupports[control];
  if (!adminPauseRoute() || !administratorPermitted(state) || !adminControlJournalReady ||
      support?.state !== 'supported' || !support.eligible || adminControlWrites.has(control)) return false;
  if (control === 'revoke') return !adminControlRecords.some(record => record.control === 'revoke' &&
    record.bundleSha256 === support.bundleSha256 && unsettledAdminControl(record));
  return !adminControlStartupUnknown && !adminControlWrites.size && !adminPauseSubmitting && !adminPauseReconciling &&
    !adminControlRecords.some(unsettledAdminControl);
}

function canRecoverAdministratorControl(record = selectedAdminControl(), state = controller.getState(), kind = 'reconcile') {
  const support = adminControlSupports[record?.control];
  return Boolean(adminPauseRoute() && administratorPermitted(state) && adminControlJournalReady && record &&
    recoverableAdminControl(record, kind) && support?.state === 'supported' && support.bundleSha256 === record.bundleSha256 &&
    !adminControlWrites.has('recovery') && !adminControlWrites.has(record.control));
}

function administratorControlReviewCurrent(review) {
  if (!adminPauseRoute() || !administratorPermitted(controller.getState()) || !adminControlJournalReady ||
      !sameAdminSupport(review.support, adminControlSupports[review.support.control])) return false;
  if (review.kind !== 'revoke' && review.journalRevision !== adminControlJournalRevision) return false;
  if (review.record) {
    const selected = selectedAdminControl();
    return sameAdminControl(review.record, selected) && review.record.target === selected.target && recoverableAdminControl(selected, review.kind);
  }
  if (!review.support.eligible) return false;
  return review.kind === 'revoke' ? !adminControlRecords.some(record => record.control === 'revoke' &&
    record.bundleSha256 === review.support.bundleSha256 && unsettledAdminControl(record)) :
    !adminControlStartupUnknown && !adminPauseSubmitting && !adminPauseReconciling && !adminControlRecords.some(unsettledAdminControl);
}

function renderAdministratorControls(state) {
  const allowed = adminPauseRoute() && administratorPermitted(state);
  if (!adminPauseRoute()) return;
  $('administrator-guided-connect').disabled = !canPrepareAdministratorConnection(state);
  text('administrator-guided-connect', t('连接前自动检查'));
  text('administrator-guided-feedback', adminGuidedNote ? t(adminGuidedNote) : '');
  $('administrator-control-support-check').disabled = !allowed || adminControlSupportBusy || adminRevokePreparing;
  for (const control of adminControlActions) {
    $(adminControlElements[control]).disabled = !canRequestAdministratorControl(control, state);
    const support = adminControlSupports[control];
    const supportKey = !allowed || !support ? '尚未核对原生操作支持。' : support.state !== 'supported' ? '原生支持未确认；此操作已禁用。' :
      support.eligible ? '原生支持已确认；可请求此操作。' : '原生支持已确认；当前不可请求此操作。';
    const ownerKey = { unobserved: '已保存意图未知', paused: '已保存暂停', running: '已保存运行（不代表就绪）', revoked: '安装已撤销' }[support?.ownerState];
    const cached = control === 'revoke' && adminControlRevokeCached && allowed;
    text(adminControlElements[control] + '-support', t(cached ? '使用上次核实的撤销支持；当前状态未确认。' :
      adminControlSupportBusy ? '正在核对原生操作支持。' : supportKey) + (allowed && ownerKey && !cached ? ' ' + t(ownerKey) : ''));
  }
  $('administrator-revoke').disabled = adminRevokePreparing ||
    !canRequestAdministratorControl('revoke', state) && !canPrepareAdministratorRevoke(state);
  const select = $('administrator-control-operation');
  const signature = getLanguage() + '|' + adminControlRecords.map(record => adminControlKey(record) + ':' + record.control).join('|');
  if (signature !== adminControlOptionsSignature) {
    const options = adminControlRecords.map(record => {
      const option = document.createElement('option');
      option.value = adminControlKey(record);
      option.textContent = t(adminControlActionKeys[record.control]) + ' | ' + record.operationId + ' | ' + record.bundleSha256.slice(0, 8);
      return option;
    });
    if (!options.length) {
      const option = document.createElement('option');
      option.value = ''; option.textContent = t('没有已存管理员操作。'); options.push(option);
    }
    const manual = document.createElement('option');
    manual.value = 'manual'; manual.textContent = t('输入另一操作的回执引用（只读）'); options.push(manual);
    select.replaceChildren(...options);
    adminControlOptionsSignature = signature;
  }
  select.value = adminControlSelected;
  select.disabled = false;
  const record = selectedAdminControl();
  $('administrator-control-reference-fields').hidden = adminControlSelected !== 'manual';
  text('administrator-control-reference-feedback', t(adminControlReadBusy ? '正在读取此编号的回执。' :
    adminControlReceipt === undefined ? '尚未手动读取回执。' : adminControlReceipt ? adminControlStateKeys[adminControlReceipt.state] : '此编号的回执未确认。未重试原操作。'));
  $('administrator-control-details').hidden = !record;
  text('administrator-control-progress', '');
  if (record) {
    text('administrator-control-id', record.operationId);
    text('administrator-control-bundle', record.bundleSha256);
    text('administrator-control-action', t(adminControlActionKeys[record.control]));
    text('administrator-control-target', record.target ?? t('整个安装，无代次目标'));
    text('administrator-control-elapsed', Math.max(0, Math.floor((Date.now() - record.createdAt) / 1000)) + ' ' + t('秒'));
    text('administrator-control-outcome', t(adminControlOutcomeKeys[record.outcome]));
    text('administrator-control-state', t(adminControlStateKeys[record.state]));
    text('administrator-control-receipt', t(adminControlReadBusy ? '正在读取此编号的回执。' :
      adminControlReceipt === undefined ? '尚未手动读取回执。' : adminControlReceipt ? adminControlStateKeys[adminControlReceipt.state] : '此编号的回执未确认。未重试原操作。'));
    const progress = adminControlReceipt === undefined ? record.progress : adminControlReceipt?.progress;
    const phaseKey = { 'verifying-full': '正在完整校验运行端', 'verifying-control': '正在校验受控操作',
      'waiting-owner': '正在等待运行端', 'waiting-stop': '正在等待停止证据', settled: '进度阶段已收尾（不代表成功）' }[progress?.phase];
    text('administrator-control-progress', phaseKey ? t('已存操作进度（非当前状态）：') + ' ' + t(phaseKey) + (progress.verifiedFiles === null ? '' :
      ' | ' + t('已校验文件') + ': ' + progress.verifiedFiles + ' / ' + progress.totalFiles) : t('没有已核实的原生进度。'));
  }
  $('administrator-control-journal-check').disabled = !adminPauseRoute();
  $('administrator-control-receipt-check').disabled = !allowed || !administratorControlReference() || adminControlReadBusy;
  for (const [id, kind] of [['administrator-control-recover', 'reconcile'], ['administrator-control-fence', 'fence']]) {
    $(id).disabled = !canRecoverAdministratorControl(record, state, kind);
  }
  const note = !adminControlJournalReady ? '管理员操作记录不可用或无效。新启动和恢复操作保持禁用。' :
    adminControlWrites.size ? '正在等待 Windows 授权或本机接收。尚未核实结果。' : adminControlNote ??
      (adminControlStartupUnknown ? '管理员启动结果尚未确认。请读取同一操作回执，不要重新提交。' :
        adminControlRecords.some(unsettledAdminControl) ? '有未解决的管理员操作。新启动保持禁用；暂停和撤销不受此限制。' :
          Object.keys(adminControlSupports).length ? '操作支持已核对；不代表当前就绪或对话授权。' : '尚未核对原生操作支持。');
  text('administrator-control-feedback', t(note));
  const pending = adminControlRecords.find(unsettledAdminControl);
  const latest = adminControlRecords.at(-1);
  const attempt = adminControlSummaryNote?.snapshot === administratorControlSummarySnapshot() ? adminControlSummaryNote.note : undefined;
  const outcome = Object.keys(adminControlOutcomeKeys).find(key => adminControlOutcomeKeys[key] === attempt);
  const detail = attempt ? adminControlSummaryOutcomes[outcome] ?? attempt : adminControlSummaryStates[latest?.state] ??
    (latest?.outcome === 'cancelled' ? adminControlSummaryOutcomes.cancelled : undefined);
  const blocked = adminControlStartupUnknown || pending;
  const summary = !adminControlJournalReady ? '无法核实管理员操作状态；新连接保持禁用。' :
    adminControlWrites.size ? '正在等待 Windows 授权或本机接收。尚未核实结果。' :
      detail ?? (blocked ? pending?.outcome === 'requested' && pending.state !== 'launch-unconfirmed'
          ? '管理员请求仍在等待处理；新连接保持禁用。' : '管理员操作结果未确认；新连接保持禁用，不会自动重试。' :
        adminControlSummaryOutcomes[latest?.outcome]);
  const warning = adminControlJournalReady && !adminControlWrites.size && detail && blocked ? '管理员操作仍未解决；新连接保持禁用。' : undefined;
  text('administrator-control-summary', [summary, warning].filter(Boolean).map(key => t(key)).join(' '));
  if (adminControlReview && (!administratorControlReviewCurrent(adminControlReview) ||
      (adminControlReview.record ? !sameAdminControl(adminControlReview.record, record) || !canRecoverAdministratorControl(record, state, adminControlReview.kind) :
        !canRequestAdministratorControl(adminControlReview.kind, state)))) closeAdministratorControlReview();
  if (adminControlReview) {
    text('administrator-control-title', t(adminControlActionKeys[adminControlReview.kind]));
    text('administrator-control-risk', t(adminControlRiskKeys[adminControlReview.kind]));
  }
}

async function checkAdministratorControlSupport() {
  if (adminControlSupportBusy || adminRevokePreparing || !adminPauseRoute() || !administratorPermitted(controller.getState())) return;
  const revision = adminRevision;
  adminControlSupportBusy = true;
  adminControlSupports = { revoke: adminControlKnownRevoke ?? null };
  adminControlRevokeCached = Boolean(adminControlKnownRevoke);
  closeAdministratorControlReview();
  render();
  let timer, expired = false;
  try {
    // Bound permission readback as well as messaging; expired checks cannot dispatch or publish late support.
    const deadline = new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, 30000); });
    await Promise.race([deadline, (async () => {
      if (!await adminPausePermitted(revision) || expired) return;
      const replies = await Promise.all(adminControlActions.map(async control => administratorControlSupport(
        await administratorControlRequest({ type: ADMIN_CONTROL_SUPPORT, control }), control)));
      if (expired || !await adminPausePermitted(revision) || expired) return;
      const digests = new Set(replies.filter(reply => reply?.state === 'supported').map(reply => reply.bundleSha256));
      const revoke = replies[2];
      if (digests.size > 1 || digests.size === 1 && adminControlKnownRevoke &&
          !digests.has(adminControlKnownRevoke.bundleSha256) && revoke?.state !== 'supported') adminControlKnownRevoke = undefined;
      else if (revoke?.state === 'supported') adminControlKnownRevoke = revoke;
      adminControlSupports = Object.fromEntries(adminControlActions.map((control, index) => [control, digests.size > 1 ? null : replies[index]]));
      adminControlRevokeCached = digests.size <= 1 && revoke?.state !== 'supported' && Boolean(adminControlKnownRevoke);
      if (adminControlRevokeCached) adminControlSupports.revoke = adminControlKnownRevoke;
    })()]);
  } finally { expired = true; clearTimeout(timer); adminControlSupportBusy = false; render(); }
}

function canPrepareAdministratorRevoke(state = controller.getState()) {
  return adminPauseRoute() && administratorPermitted(state) && adminControlJournalReady &&
    !adminRevokePreparing && !adminControlSupportBusy && !adminControlWrites.has('revoke') &&
    !Object.hasOwn(adminControlSupports, 'revoke') &&
    !adminControlRecords.some(record => record.control === 'revoke' && unsettledAdminControl(record));
}

async function prepareAdministratorRevoke() {
  if (adminRevokePreparing) return;
  if (canRequestAdministratorControl('revoke')) return reviewAdministratorControl('revoke');
  if (!canPrepareAdministratorRevoke()) return;
  const revision = adminRevision;
  const summarySnapshot = administratorControlSummarySnapshot();
  adminRevokePreparing = true;
  setAdministratorControlNote('正在核对撤销支持。尚未请求撤销。', summarySnapshot);
  render();
  let timer, expired = false;
  try {
    const deadline = new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, 30000); });
    await Promise.race([deadline, (async () => {
      if (!await adminPausePermitted(revision) || expired) return;
      const support = administratorControlSupport(await administratorControlRequest({ type: ADMIN_CONTROL_SUPPORT, control: 'revoke' }), 'revoke');
      if (expired || !await adminPausePermitted(revision) || expired) return;
      if (support?.state !== 'supported') return;
      if (Object.values(adminControlSupports).some(value => value?.state === 'supported' && value.bundleSha256 !== support.bundleSha256)) {
        adminControlSupports = {};
      }
      adminControlSupports.revoke = adminControlKnownRevoke = support;
      adminControlRevokeCached = false;
      setAdministratorControlNote(support.eligible ? undefined : '原生支持已确认；当前不可请求此操作。', summarySnapshot);
      if (canRequestAdministratorControl('revoke') && !$('administrator-pause-dialog').open && !$('administrator-control-dialog').open) {
        reviewAdministratorControl('revoke');
      }
    })()]);
  } finally {
    expired = true;
    clearTimeout(timer);
    adminRevokePreparing = false;
    if (adminControlNote === '正在核对撤销支持。尚未请求撤销。') {
      setAdministratorControlNote(revision === adminRevision ? '未能核实撤销支持。未发出撤销请求；可重试检查。' : undefined, summarySnapshot);
    }
    render();
  }
}

function canPrepareAdministratorConnection(state = controller.getState()) {
  const permissionEligible = administratorPermitted(state) || state.initialized && !adminPermissionRefreshing && !adminPermissionUnverified &&
    state.permission === 'absent' && $('riskConsent').checked && state.journalHealthy && !state.pending &&
    !state.requestingPermission && !state.statusBusy && !state.mutationBusy;
  return adminPauseRoute() && permissionEligible && adminControlJournalReady &&
    !adminGuidedBusy && !adminRevokePreparing && !adminControlSupportBusy && !adminControlWrites.size &&
    !adminControlStartupUnknown && !adminPauseSubmitting && !adminPauseReconciling &&
    !$('administrator-pause-dialog').open && !$('administrator-control-dialog').open &&
    !adminControlRecords.some(unsettledAdminControl);
}

async function prepareAdministratorConnection() {
  if (!canPrepareAdministratorConnection()) return;
  const epoch = ++adminGuidedEpoch;
  adminGuidedBusy = true;
  adminGuidedNote = '正在自动核对本机连接条件。尚未请求启动。';
  render();
  let permissionTimer, expired = false;
  try {
    if (!administratorPermitted(controller.getState())) {
      // The consented click must reach requestPermission before any await.
      const requested = controller.requestPermission(true);
      await Promise.race([
        new Promise(resolve => { permissionTimer = setTimeout(() => { expired = true; resolve(); }, 30000); }),
        (async () => {
          await requested;
          if (!expired && epoch === adminGuidedEpoch) await refreshBrowserPermission(true);
        })(),
      ]);
      clearTimeout(permissionTimer);
      if (expired || epoch !== adminGuidedEpoch || !$('riskConsent').checked ||
          !administratorPermitted(controller.getState())) {
        if (epoch === adminGuidedEpoch) adminGuidedNote = '未能核实连接条件。请检查安装或展开高级诊断；没有请求启动。';
        return;
      }
    }
    const revision = adminRevision;
    await checkAdministratorControlSupport();
    if (epoch !== adminGuidedEpoch || revision !== adminRevision || !adminPauseRoute()) return;
    if (!canRequestAdministratorControl('connect') || $('administrator-pause-dialog').open ||
        $('administrator-control-dialog').open) {
      adminGuidedNote = '未能核实连接条件。请检查安装或展开高级诊断；没有请求启动。';
      return;
    }
    adminGuidedNote = undefined;
    reviewAdministratorControl('connect');
  } catch {
    if (epoch === adminGuidedEpoch) adminGuidedNote = '未能核实连接条件。请检查安装或展开高级诊断；没有请求启动。';
  } finally {
    expired = true;
    clearTimeout(permissionTimer);
    adminGuidedBusy = false;
    render();
  }
}

function reviewAdministratorControl(kind) {
  const recovery = kind === 'fence' || kind === 'reconcile';
  const record = recovery ? selectedAdminControl() : undefined;
  if (recovery ? !canRecoverAdministratorControl(record, controller.getState(), kind) : !canRequestAdministratorControl(kind)) return;
  if (kind === 'revoke' && adminGuidedBusy) {
    adminGuidedEpoch++;
    adminGuidedNote = '连接准备已取消，保留你的撤销选择。';
  }
  const support = adminControlSupports[record?.control ?? kind];
  adminControlReview = { kind, record, support, journalRevision: adminControlJournalRevision };
  text('administrator-control-review-reference', support.bundleSha256 + ' | ' + (record ?
    record.control + ' | ' + record.operationId : kind + ' | ' + (support.target ?? t('整个安装，无代次目标'))));
  render();
  $('administrator-control-dialog').showModal();
}

function administratorControlSubmission(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 4 &&
    ['bundleSha256', 'operationId', 'control', 'outcome'].every(key => Object.hasOwn(value, key)) &&
    sameAdminControl(value, expected) && Object.hasOwn(adminControlOutcomeKeys, value.outcome) ? value : null;
}

async function confirmAdministratorControl() {
  const review = adminControlReview;
  if (!$('administrator-control-dialog').open || !review) return;
  closeAdministratorControlReview();
  if (review.record ? !canRecoverAdministratorControl(review.record, controller.getState(), review.kind) : !canRequestAdministratorControl(review.kind)) return;
  const revision = adminRevision;
  const busyKey = review.record ? 'recovery' : review.kind;
  const previous = new Set(adminControlRecords.map(adminControlKey));
  const summarySnapshot = administratorControlSummarySnapshot();
  adminControlWrites.add(busyKey);
  setAdministratorControlNote(undefined);
  render();
  try {
    if (!await adminPausePermitted(revision)) return;
    // An installation-wide deny must not depend on a fresh liveness/support RPC.
    // Cached feature evidence is not authorization; the high child verifies the exact binding.
    const support = review.kind === 'revoke' ? adminControlSupports.revoke : administratorControlSupport(
      await administratorControlRequest({ type: ADMIN_CONTROL_SUPPORT, control: review.support.control }), review.support.control);
    if (!await adminPausePermitted(revision)) return;
    if (!sameAdminSupport(support, review.support) || !administratorControlReviewCurrent(review)) {
      if (support?.state === 'supported' && adminControlKnownRevoke?.bundleSha256 !== support.bundleSha256) adminControlKnownRevoke = undefined;
      adminControlSupports = adminControlKnownRevoke ? { revoke: adminControlKnownRevoke } : {};
      adminControlRevokeCached = Boolean(adminControlKnownRevoke);
      setAdministratorControlNote('原生支持或操作记录已变化。未发出请求；请重新核对。', summarySnapshot);
      return;
    }
    // Persisted identity belongs to the worker; the page never manufactures or replays an ID.
    const request = review.record ? { type: review.kind === 'fence' ? ADMIN_CONTROL_FENCE : ADMIN_CONTROL_RECONCILE,
      bundleSha256: review.record.bundleSha256, operationId: review.record.operationId, control: review.record.control } :
      { type: ADMIN_CONTROL, control: review.kind, bundleSha256: support.bundleSha256,
        ...(review.kind === 'revoke' ? {} : { target: support.target }) };
    if (!review.record && review.kind !== 'revoke') adminControlStartupUnknown = true;
    adminStatus = undefined;
    render();
    const value = await administratorControlRequest(request, 30000);
    const reply = review.record ? administratorControlSubmission(value, review.record) : administratorControlRecord(value);
    const matching = reply && (review.record || reply.control === review.kind && reply.bundleSha256 === support.bundleSha256 &&
      reply.target === (review.kind === 'revoke' ? null : support.target));
    await loadAdministratorControlJournal(matching ? adminControlKey(reply) : undefined);
    if (revision !== adminRevision || !adminPauseRoute()) return;
    const persisted = adminControlRecords.find(record => record.control === review.support.control &&
      record.bundleSha256 === support.bundleSha256 && (matching ? sameAdminControl(record, reply) : !previous.has(adminControlKey(record))));
    if (persisted) {
      adminControlSelected = adminControlKey(persisted);
      adminControlReceipt = undefined;
      if (!review.record && review.kind !== 'revoke') adminControlStartupUnknown = false;
    }
    setAdministratorControlNote(adminControlOutcomeKeys[matching ? reply.outcome : 'unconfirmed'], summarySnapshot);
    // A new startup needs a fresh explicit support check, but Revoke stays available during verification.
    if (!review.record) { delete adminControlSupports.connect; delete adminControlSupports['resume-saved']; }
  } finally { adminControlWrites.delete(busyKey); render(); }
}

async function readAdministratorControlReceipt() {
  const record = administratorControlReference();
  if (!adminPauseRoute() || !administratorPermitted(controller.getState()) || !record || adminControlReadBusy) return;
  const revision = adminRevision, selectionRevision = adminControlSelectionRevision;
  adminControlReadBusy = true;
  adminControlReceipt = undefined;
  render();
  try {
    if (!await adminPausePermitted(revision)) return;
    const value = await administratorControlRequest({ type: ADMIN_CONTROL_STATUS, bundleSha256: record.bundleSha256,
      operationId: record.operationId, control: record.control });
    if (await adminPausePermitted(revision) && selectionRevision === adminControlSelectionRevision && sameAdminControl(record, administratorControlReference())) {
      adminControlReceipt = administratorControlStatus(value, record);
    }
  } finally { adminControlReadBusy = false; render(); }
}

if (adminPauseRoute()) {
  $('administrator-guided-connect').addEventListener('click', prepareAdministratorConnection);
  $('administrator-control-support-check').addEventListener('click', checkAdministratorControlSupport);
  for (const control of adminControlActions) $(adminControlElements[control]).addEventListener('click',
    () => control === 'revoke' ? prepareAdministratorRevoke() : reviewAdministratorControl(control));
  $('administrator-control-recover').addEventListener('click', () => reviewAdministratorControl('reconcile'));
  $('administrator-control-fence').addEventListener('click', () => reviewAdministratorControl('fence'));
  $('administrator-control-confirm').addEventListener('click', confirmAdministratorControl);
  $('administrator-control-dialog').addEventListener('cancel', () => { adminControlReview = undefined; });
  $('administrator-control-dialog').addEventListener('close', () => {
    if (!$('administrator-control-dialog').open) adminControlReview = undefined;
  });
  $('administrator-control-operation').addEventListener('change', event => {
    adminControlSelected = event.target.value;
    adminControlSelectionRevision++;
    adminControlReceipt = undefined;
    closeAdministratorControlReview();
    render();
  });
  $('administrator-control-journal-check').addEventListener('click', () => loadAdministratorControlJournal());
  $('administrator-control-receipt-check').addEventListener('click', readAdministratorControlReceipt);
  for (const id of ['administrator-control-reference-bundle', 'administrator-control-reference-id', 'administrator-control-reference-action']) {
    $(id).addEventListener(id.endsWith('action') ? 'change' : 'input', () => {
      adminControlSelectionRevision++;
      adminControlReceipt = undefined;
      render();
    });
  }
}
const preparedLabels = {
  staged: '已准备，尚无接收回执。', expired: '引用已过期。', 'owner-revoked': '此引用已由设备所有者撤销。',
  'admitted-outcome-unconfirmed': '已接收，执行结果未确认。', 'provider-reported-result': '执行端报告了结果，未核对实际效果。',
  'provider-reported-error': '执行端报告了错误，实际效果未知。', 'receipt-unavailable': '本机回执不可用，无法判断执行状态。',
};
let preparedReview = null, preparedBusy = false, preparedRevision = 0, preparedUnconfirmed = false;
function preparedInput(state = controller.getState()) {
  const operationId = $('prepared-id').value.trim(), sha256 = $('prepared-digest').value.trim();
  const ownerId = administratorPermitted(state) ? state.observation?.ownerId : null;
  return { operationId, sha256, ownerId };
}
const samePreparedInput = (a, b) => a?.operationId === b.operationId && a.sha256 === b.sha256 && a.ownerId === b.ownerId;
function renderPrepared(state) {
  $('prepared-controls').hidden = !browserManaged;
  if (!browserManaged) return;
  const input = preparedInput(state);
  if (preparedReview && !samePreparedInput(preparedReview.input, input)) preparedReview = null;
  const allowed = Boolean(input.ownerId) && validPreparedReference(input.operationId, input.sha256);
  const canRevoke = allowed && preparedReview?.status === 'staged' && preparedReview.expiresAt > Date.now();
  $('prepared-check').disabled = !allowed || preparedBusy;
  $('prepared-revoke').disabled = !canRevoke || preparedBusy;
  if (!canRevoke && $('prepared-dialog').open) $('prepared-dialog').close();
  text('prepared-feedback', t(preparedBusy ? '等待本机回执。' : preparedReview ? preparedLabels[preparedReview.status] :
    preparedUnconfirmed ? '无法核实结果。未自动重试。' : input.ownerId ? '' : '先核实当前设备状态。'));
}

async function runPrepared(action) {
  const input = preparedInput();
  if (preparedBusy || !input.ownerId || !validPreparedReference(input.operationId, input.sha256) ||
      (action === 'prepared-revoke' && (!samePreparedInput(preparedReview?.input, input) ||
        preparedReview.status !== 'staged' || preparedReview.expiresAt <= Date.now()))) return;
  const revision = preparedRevision;
  preparedBusy = true;
  preparedReview = null;
  preparedUnconfirmed = false;
  render();
  const result = await controlPrepared(globalThis.chrome.runtime, action, input.ownerId, input.operationId, input.sha256);
  preparedBusy = false;
  if (revision === preparedRevision && samePreparedInput(input, preparedInput())) {
    if (result) preparedReview = { ...result, input };
    else preparedUnconfirmed = true;
  }
  render();
}

function render() {
  // Translate only authored interface keys, never bridge IDs or user-owned content.
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  document.documentElement.lang = getLanguage() === 'zh_CN' ? 'zh-CN' : 'en';
  $('language').value = getLanguage();
  const extensionID = globalThis.chrome?.runtime?.id;
  text('extension-id', typeof extensionID === 'string' && /^[a-p]{32}$/.test(extensionID) ? extensionID : t('未知'));
  const s = controller.getState();
  text('selected-target', !validSelection ? t('设备选择无效') : target || t(browserManaged ? '浏览器管理的 Windows' : '本机'));
  if (target || browserManaged) text('local-title', t(browserManaged ? '浏览器管理的 Windows' : '远程设备'));
  if (browserManaged) {
    text('registration-label', t('普通权限桥接注册'));
    text('connection-label', t('普通权限 MCP 连接'));
    text('pause-label', t('普通权限连接暂停'));
  }
  text('native-host', browserManaged ? BROWSER_WAKE_HOST : HOST);
  if (validSelection && !target) $(browserManaged ? 'browser-mode' : 'standard-mode').setAttribute('aria-current', 'page');
  $('language').disabled = !s.initialized;
  text('permission', t({ granted: '已授权', absent: '未授权', unknown: '未知' }[adminPermissionUnverified ? 'unknown' : s.permission]));
  text('registration', t({ unchecked: '尚未检查', absent: '未注册', reachable: '桥接可响应', unknown: '未知' }[s.registration]));
  text('connection', t(s.observation ? { ready: '已就绪', disconnected: '已断开', unknown: '未知' }[s.observation.connection] :
    s.registration === 'unchecked' ? '尚未检查' : '未知'));
  text('pause', t(s.observation?.paused == null ? '未知' : s.observation.paused ? '已暂停' : '未暂停'));
  const op = s.observation?.operation, pending = s.priorityPause || s.pending;
  text('operation', t(pending ? (op?.id === pending.id && op.action === pending.action ? operationKeys[op.status] : '结果未确认') :
    op ? operationKeys[op.status] : '尚无回执'));
  text('operation-id', pending?.id || op?.id || t('无'));
  text('observed', s.observedAt ? new Intl.DateTimeFormat(getLanguage() === 'zh_CN' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'medium' }).format(s.observedAt) : t('尚无观测'));
  text('feedback', t(languageError ? '语言设置保存失败。' : feedbackKeys[s.feedback]));
  const lockKey = !s.journalHealthy ? '本机操作记录不可用。控制保持锁定，请在本机核实。' :
    pending ? (browserManaged && s.canPause ? '连接操作待确认。暂停仍可使用；不会重试连接或清除原操作记录。' :
      '设备操作待完成或结果未确认。只可检查状态；普通状态回执不会解除锁定。') :
      !navigator.locks?.request ? '安全的多页面锁定不可用。只可检查状态。' : null;
  $('lockNotice').hidden = !lockKey;
  text('lockNotice', lockKey ? t(lockKey) : '');
  for (const button of document.querySelectorAll('[data-action]')) {
    if (browserManaged) button.textContent = t(browserManagedActionKeys[button.dataset.action]);
    button.disabled = !validSelection || (button.dataset.action === 'status' ? !s.initialized || s.statusBusy || s.requestingPermission :
      !actionPermitted(s, button.dataset.action) || adminPermissionUnverified);
  }
  $('grantPermission').disabled = !s.initialized || !s.journalHealthy || Boolean(pending) ||
    s.permission === 'granted' || !$('riskConsent').checked || s.requestingPermission || s.statusBusy || s.mutationBusy || s.pauseBusy || adminPermissionRefreshing;
  text('grantPermission', t(s.permission === 'granted' ? '浏览器权限已授权' : '允许本机控制桥访问'));
  $('permission-check').disabled = !s.initialized || s.requestingPermission || s.statusBusy || s.mutationBusy || s.pauseBusy || adminPermissionRefreshing;
  const permissionFeedback = !s.initialized || adminPermissionRefreshing ? '正在读取浏览器权限。不会发起设备连接。' :
    s.requestingPermission ? '正在等待浏览器权限结果；尚未连接设备。' :
      adminPermissionUnverified ? '无法核实浏览器权限。尚未联系本机桥接；可只读重新核对权限。' :
      s.permission === 'granted' ? '浏览器权限已授权；本次权限检查不会启动设备或连接隧道。' :
        s.permission === 'unknown' ? (s.feedback === 'permission-unavailable' ?
          '浏览器权限请求不可用。请检查此浏览器是否支持可选的原生消息权限。' :
          '无法核实浏览器权限。尚未联系本机桥接；可只读重新核对权限。') :
        !s.journalHealthy ? '本机操作记录不可用，权限请求暂时禁用；可只读重新核对浏览器权限。' :
          pending ? '现有设备操作结果未确认，权限请求暂时禁用；可只读重新核对权限和原操作回执。' :
            s.statusBusy || s.mutationBusy || s.pauseBusy ? '设备检查或操作尚未结束，权限请求暂时禁用。' :
              s.feedback === 'permission-unavailable' ? '浏览器权限请求不可用。请检查此浏览器是否支持可选的原生消息权限。' :
                s.feedback === 'permission-denied' ? '浏览器未批准权限。可重新点击允许；勾选风险确认不会自行授予权限。' :
                  $('riskConsent').checked ? '风险确认已勾选，但浏览器权限尚未授予。请点击允许并完成浏览器弹窗。' :
                    '浏览器权限尚未授予。请先勾选风险确认，再点击允许并完成浏览器弹窗。';
  text('permission-feedback', t(permissionFeedback));
  renderAdministrator(s);
  renderPrepared(s);
  renderAccountSurface();
  if (pendingAction) {
    text('dialog-title', t(browserManaged ? browserManagedActionKeys[pendingAction] : pendingAction === 'reconnect' ? '重新连接' : '断开并暂停'));
    const risk = browserManaged ? browserManagedRiskKeys[pendingAction] :
      pendingAction === 'reconnect' ? '重新连接会恢复选定设备 MCP 的远程访问。此操作不会更改 Dot 或普通对话的工具授权。是否继续？' :
      '断开并暂停会中断选定设备 MCP 的远程访问并保留手动暂停。此操作不会暂停提示词调度或更改对话授权。是否继续？';
    text('dialog-risk', t(risk));
    if (!actionPermitted(s, pendingAction) || adminPermissionUnverified) $('operationDialog').close();
  }
}

if (browserManaged) {
  $('administrator-pause').addEventListener('click', () => {
    if (!canRequestAdminPause(controller.getState()) || $('administrator-pause-dialog').open) return;
    adminGuidedEpoch++;
    adminGuidedNote = '连接准备已取消，保留你的暂停选择。';
    closeAdministratorControlReview();
    $('administrator-pause-dialog').showModal();
    render();
  });
  $('administrator-pause-confirm').addEventListener('click', async () => {
    const dialog = $('administrator-pause-dialog');
    if (!dialog.open || !canRequestAdminPause(controller.getState())) return;
    const revision = ++adminRevision, storageRevision = adminPauseStorageRevision, actionRevision = adminPauseActionRevision;
    const previousId = adminPauseRecord?.operationId;
    adminStatus = undefined;
    adminPauseSubmitting = true;
    adminPauseRequestNote = undefined;
    dialog.close();
    render();
    try {
      if (!await adminPausePermitted(revision) || storageRevision !== adminPauseStorageRevision) return;
      let record;
      try { record = adminBrowserPauseRecord(await chrome.runtime.sendMessage({ type: ADMIN_BROWSER_PAUSE })); }
      catch { /* Recover the operation ID from storage, never resend. */ }
      if (!adminPauseRoute()) return;
      // Only storage supplies the latest operation ID, even when the launch reply is lost.
      await loadAdministratorPauseRecord(true);
      if (revision !== adminRevision || !adminPauseRoute()) return;
      if (!record || !adminPauseRecord) adminPauseRequestNote = adminPauseRequestLabels.unconfirmed;
      else if (record.operationId === previousId && adminPauseRecord?.operationId === previousId) {
        adminPauseRequestNote = '未发出新请求。请查询现有操作的回执。';
      }
      if (actionRevision === adminPauseActionRevision && adminPauseStorageReady && adminPauseRecord) {
        cancelAdministratorPauseFollowup();
        const followup = adminPauseFollowup = { operationId: adminPauseRecord.operationId,
          revision, storageRevision: adminPauseStorageRevision, inputRevision: adminPauseRevision,
          href: location.href, deadline: Date.now() + 15000, checks: 0 };
        void readAdministratorPauseReceipt(true, followup).then(receipt => continueAdministratorPauseFollowup(followup, receipt));
      }
    } finally {
      adminPauseSubmitting = false;
      render();
    }
  });
  $('administrator-pause-reconcile').addEventListener('click', () => {
    const dialog = $('administrator-pause-reconcile-dialog');
    const operationId = adminPauseReconcileId();
    if (!operationId || !canRequestAdminPause(controller.getState()) || dialog.open) return;
    text('administrator-pause-reconcile-target', operationId);
    dialog.showModal();
  });
  $('administrator-pause-reconcile-confirm').addEventListener('click', async () => {
    const dialog = $('administrator-pause-reconcile-dialog');
    const operationId = adminPauseReconcileId();
    if (!dialog.open || !operationId || !canRequestAdminPause(controller.getState())) return;
    const revision = adminRevision, storageRevision = adminPauseStorageRevision;
    const stillCurrent = () => revision === adminRevision && storageRevision === adminPauseStorageRevision &&
      adminPauseRoute() && administratorPermitted(controller.getState()) && operationId === adminPauseReconcileId();
    adminPauseReconciling = true;
    adminPauseReconcileNote = undefined;
    dialog.close();
    render();
    try {
      if (!await adminPausePermitted(revision) || !stillCurrent()) return;
      let saved;
      try { saved = (await adminStorage.get([ADMIN_BROWSER_PAUSE_LAST]))[ADMIN_BROWSER_PAUSE_LAST]; }
      catch {
        if (stillCurrent()) adminPauseReconcileNote = '无法读取上次管理员暂停记录。';
        return;
      }
      if (!stillCurrent()) return;
      const persisted = adminBrowserPauseRecord(saved);
      if (persisted?.operationId !== operationId || persisted.outcome === 'cancelled') {
        observeAdministratorPauseRecord(saved, false);
        return;
      }
      let acknowledgement;
      try {
        acknowledgement = adminBrowserPauseRecord(await chrome.runtime.sendMessage({ type: ADMIN_BROWSER_PAUSE_RECONCILE, operationId }));
      } catch { /* The launch is unconfirmed; do not retry or infer a receipt. */ }
      if (stillCurrent()) {
        adminPauseReconcileNote = adminPauseReconcileLabels[
          acknowledgement?.operationId === operationId ? acknowledgement.outcome : 'unconfirmed'];
      }
    } finally {
      adminPauseReconciling = false;
      render();
    }
  });
  $('administrator-pause-id').addEventListener('input', () => {
    adminPauseRevision++;
    adminPauseResult = undefined;
    render();
  });
  function continueAdministratorPauseFollowup(followup, receipt) {
    if (!currentAdministratorPauseFollowup(followup) || followup.checks >= 4 ||
        !['unconfirmed', 'pause-recorded'].includes(receipt)) {
      if (adminPauseFollowup === followup) cancelAdministratorPauseFollowup();
      return;
    }
    // This exact-ID readback exists only after an explicit Pause, never on page load.
    followup.timer = setTimeout(async () => {
      if (!currentAdministratorPauseFollowup(followup)) {
        if (adminPauseFollowup === followup) cancelAdministratorPauseFollowup();
        return;
      }
      followup.checks++;
      const next = await readAdministratorPauseReceipt(true, followup);
      continueAdministratorPauseFollowup(followup, next);
    }, Math.min(3000, followup.deadline - Date.now()));
  }
  async function readAdministratorPauseReceipt(afterPause = false, followup) {
    const operationId = adminPauseId();
    if (!operationId || !adminPauseRoute() || adminPauseSubmitting && !afterPause || adminPauseBusy || adminPauseReconciling ||
        !administratorPermitted(controller.getState())) return;
    const revision = adminRevision, inputRevision = adminPauseRevision, storageRevision = adminPauseStorageRevision;
    const stillCurrent = () => (!followup || currentAdministratorPauseFollowup(followup)) &&
      (!afterPause || adminPauseStorageReady && storageRevision === adminPauseStorageRevision && operationId === adminPauseRecord?.operationId);
    // Followup reads do not lock manual controls or replace the last feedback with a spinner.
    if (!followup) adminPauseBusy = true;
    if (!followup || adminPauseSubmitting) adminPauseResult = undefined;
    render();
    let timer, expired = false;
    const read = async () => {
      let result;
      try {
        if (await adminPausePermitted(revision) && !expired && stillCurrent() && inputRevision === adminPauseRevision && operationId === adminPauseId()) {
          result = await chrome.runtime.sendMessage({ type: ADMIN_BROWSER_PAUSE_STATUS, operationId });
        } else return;
      }
      catch { /* Unknown receipt; do not send a mutating request. */ }
      if (expired || !stillCurrent() || !await adminPausePermitted(revision) || expired || !stillCurrent()) return;
      const receipt = result?.operationId === operationId && Object.keys(result).length === 2 &&
        Object.hasOwn(result, 'operationId') && Object.hasOwn(result, 'state') && typeof result.state === 'string' &&
        Object.hasOwn(adminPauseLabels, result.state) ? result.state : 'unconfirmed';
      if (inputRevision === adminPauseRevision && operationId === adminPauseId()) adminPauseResult = receipt;
      // Once the latest ID has verified readback, an input edit or an unknown reply cannot undo it.
      if (operationId === adminPauseRecord?.operationId && receipt !== 'unconfirmed') {
        adminPauseHasReadback = true;
        adminPauseReconcileNote = undefined;
      }
      return receipt;
    };
    try {
      if (!followup) return await read();
      const deadline = new Promise(resolve => {
        followup.cancelRead = () => { expired = true; resolve(); };
        timer = setTimeout(followup.cancelRead, Math.min(5000, Math.max(0, followup.deadline - Date.now())));
      });
      return await Promise.race([deadline, read()]);
    }
    finally {
      expired = true;
      clearTimeout(timer);
      if (followup) followup.cancelRead = undefined;
      else adminPauseBusy = false;
      render();
    }
  }
  $('administrator-pause-receipt').addEventListener('submit', event => {
    event.preventDefault();
    return readAdministratorPauseReceipt();
  });
  $('administrator-check').addEventListener('click', async () => {
    if (adminReadBusy || !adminPauseRoute() || !administratorPermitted(controller.getState())) return;
    adminReadBusy = true;
    const revision = adminRevision;
    adminStatus = undefined;
    render();
    let observed = null, timer, expired = false;
    try {
      // One deadline covers both permission reads and the query; expiry never retries native work.
      const deadline = new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, 5000); });
      await Promise.race([deadline, (async () => {
        if (!await adminPausePermitted(revision) || expired) return;
        const value = await chrome.runtime.sendMessage({ type: ADMIN_BROWSER_MESSAGE });
        if (expired || !await adminPausePermitted(revision) || expired) return;
        observed = adminBrowserObservation(value);
      })()]);
    }
    catch { /* No raw transport error in Devices. */ }
    finally {
      expired = true;
      clearTimeout(timer);
      if (revision === adminRevision && adminPauseRoute() && administratorPermitted(controller.getState())) adminStatus = observed;
      adminReadBusy = false;
      render();
    }
  });
  $('administrator-restore').addEventListener('change', async event => {
    const enabled = event.target.checked;
    if (adminSaveBusy || enabled && (!adminStatus || controller.getState().permission !== 'granted')) return render();
    adminSaveBusy = true;
    adminSaveFailed = false;
    render();
    try { await adminStorage.set({ [ADMIN_BROWSER_RESTORE]: enabled }); }
    catch { adminSaveFailed = true; }
    finally { adminSaveBusy = false; await loadAdministratorPreference(); }
  });
  for (const id of ['prepared-id', 'prepared-digest']) $(id).addEventListener('input', () => {
    preparedRevision++;
    preparedReview = null;
    preparedUnconfirmed = false;
    render();
  });
  $('prepared-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('prepared-check').disabled) void runPrepared('prepared-review');
  });
  $('prepared-revoke').addEventListener('click', () => {
    renderPrepared(controller.getState());
    if ($('prepared-revoke').disabled || $('prepared-dialog').open) return;
    const { operationId, sha256 } = preparedReview.input;
    text('prepared-reference', operationId + ' / ' + sha256);
    $('prepared-dialog').showModal();
  });
  $('prepared-confirm').addEventListener('click', () => {
    if (!$('prepared-dialog').open) return;
    $('prepared-dialog').close();
    void runPrepared('prepared-revoke');
  });
}

function actionPermitted(state, action) {
  return browserManaged && action === 'disconnect-and-pause' ? state.canPause : state.canMutate;
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => {
  const action = button.dataset.action;
  if (action === 'status') { void controller.run('status'); return; }
  if (!actionPermitted(controller.getState(), action) || adminPermissionUnverified) return;
  pendingAction = action;
  render();
  $('operationDialog').showModal();
});
$('cancelOperation').addEventListener('click', () => {
  pendingAction = null;
  $('operationDialog').close();
});
$('operationDialog').addEventListener('cancel', () => { pendingAction = null; });
$('operationDialog').addEventListener('close', () => {
  // A queued close from an older review must not consume a newly opened one.
  if (!$('operationDialog').open) pendingAction = null;
});
$('confirmOperation').addEventListener('click', () => {
  if (!$('operationDialog').open || !pendingAction) return;
  const action = pendingAction;
  pendingAction = null;
  $('operationDialog').close();
  if (actionPermitted(controller.getState(), action) && !adminPermissionUnverified) void controller.run(action);
});
$('riskConsent').addEventListener('change', () => {
  if (!$('riskConsent').checked && adminGuidedBusy) {
    adminGuidedEpoch++;
    adminGuidedNote = '未能核实连接条件。请检查安装或展开高级诊断；没有请求启动。';
  }
  render();
});
$('grantPermission').addEventListener('click', () => { void controller.requestPermission($('riskConsent').checked); });
$('permission-check').addEventListener('click', () => {
  const state = controller.getState();
  if (!state.initialized || adminPermissionRefreshing || state.requestingPermission || state.statusBusy || state.mutationBusy || state.pauseBusy) return;
  void refreshBrowserPermission(true);
});
$('language').addEventListener('change', async event => {
  languageError = false;
  try { await setLanguage(event.target.value); }
  catch { languageError = true; }
  render();
});
for (const account of ['current', 'administrator']) $('account-' + account).addEventListener('change', event => {
  if (!browserManaged || !event.target.checked) return;
  selectedAccount = account;
  accountSelectionMade = true;
  renderAccountSurface();
});
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (browserManaged && area === 'local' && Object.hasOwn(changes, ADMIN_BROWSER_RESTORE)) {
    void loadAdministratorPreference();
  }
  if (adminPauseRoute() && area === 'local' && Object.hasOwn(changes, ADMIN_BROWSER_PAUSE_LAST)) {
    cancelAdministratorPauseFollowup();
    adminPauseStorageRevision++;
    observeAdministratorPauseRecord(changes[ADMIN_BROWSER_PAUSE_LAST].newValue, adminPauseSubmitting);
    render();
  }
  if (adminPauseRoute() && area === 'local' && Object.hasOwn(changes, ADMIN_CONTROL_JOURNAL)) {
    cancelAdministratorPauseFollowup();
    adminControlJournalRevision++;
    observeAdministratorControlJournal(changes[ADMIN_CONTROL_JOURNAL].newValue);
    render();
  }
  if (area === 'local' && [PENDING_KEY, PRIORITY_PAUSE_KEY, REVISION_KEY].some(key => Object.hasOwn(changes, key + scope))) {
    cancelAdministratorPauseFollowup();
    void controller.refreshPending();
  }
});
async function refreshBrowserPermission(preserveRevoke = false) {
  cancelAdministratorPauseFollowup();
  const retainedRevoke = preserveRevoke && administratorPermitted(controller.getState()) ? adminControlKnownRevoke : undefined;
  const revision = ++adminRevision;
  adminPermissionRefreshing = true;
  adminPermissionUnverified = true;
  adminStatus = adminPauseResult = adminPauseReconcileNote = undefined;
  adminControlSupports = {};
  adminControlKnownRevoke = undefined;
  adminControlRevokeCached = false;
  adminControlReceipt = undefined;
  closeAdministratorControlReview();
  render();
  let timer, completed = false, expired = false;
  try {
    await Promise.race([
      new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, 5000); }),
      (async () => { await controller.initialize(); if (!expired) completed = true; })(),
    ]);
  } catch { /* Unverified permission remains retryable without authorizing native work. */ }
  finally {
    expired = true;
    clearTimeout(timer);
    if (revision === adminRevision) {
      adminPermissionRefreshing = false;
      adminPermissionUnverified = !completed;
      if (retainedRevoke && administratorPermitted(controller.getState())) {
        adminControlKnownRevoke = retainedRevoke;
        adminControlSupports = { revoke: retainedRevoke };
        adminControlRevokeCached = true;
      }
      render();
    }
  }
}
for (const event of [globalThis.chrome?.permissions?.onAdded, globalThis.chrome?.permissions?.onRemoved]) {
  event?.addListener(change => {
    if (!change?.permissions?.includes('nativeMessaging')) return;
    void refreshBrowserPermission();
  });
}
if (browserManaged) {
  for (const event of ['click', 'input', 'change', 'submit']) {
    document.addEventListener?.(event, interruptAdministratorPauseFollowup, true);
  }
  for (const event of ['pagehide', 'beforeunload', 'popstate', 'hashchange']) {
    globalThis.addEventListener?.(event, interruptAdministratorPauseFollowup);
  }
}
await initializeLanguage();
subscribeLanguage(render);
await controller.initialize();
if (browserManaged) await loadAdministratorPreference();
if (browserManaged && !accountHint && !accountSelectionMade && (adminRestore === true || adminStatus?.state === 'ready')) {
  selectedAccount = 'administrator';
  renderAccountSurface();
}
if (adminPauseRoute()) await loadAdministratorPauseRecord();
if (adminPauseRoute()) await loadAdministratorControlJournal();
