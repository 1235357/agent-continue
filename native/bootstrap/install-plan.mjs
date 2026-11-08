// Browser-safe install planning. Pure functions only: no fs, no child_process,
// no registry and no network. The extension setup page and the installer
// scripts consume the same plan so their copy, order and consent are identical.
export const INSTALL_PLAN_FORMAT = 'agent-continue-install-plan';
export const UNINSTALL_PLAN_FORMAT = 'agent-continue-uninstall-plan';
export const HOST_NAME = 'com.agentcontinue.device_control';
export const KEY_ROOT = '\\Software\\Google\\Chrome\\NativeMessagingHosts\\';
export const SUPPORTED_OS = Object.freeze(['windows', 'macos', 'linux']);
export const MIN_NODE = Object.freeze({ major: 22, minor: 13 });
const ARCHES = Object.freeze({ windows: ['x64', 'arm64', 'ia32'], macos: ['arm64', 'x64'], linux: ['x64', 'arm64'] });
const fail = code => { throw new Error(code); };

function text(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
    || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) fail(code);
  return value;
}

function absolutePath(value, code, os) {
  text(value, code);
  const windows = /^(?:[A-Za-z]:\\|\\\\)/.test(value);
  const posix = value.startsWith('/');
  if (!windows && !posix) fail(code);
  if (os === 'windows' ? !windows : !posix || windows || value.includes('\\')) fail(code);
  if (value.split(/[\\/]/).includes('..')) fail(code);
  return value;
}

function parseNode(value) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) fail('invalid_node_version');
  const [major, minor] = value.split('.').map(Number);
  return { major, minor, meetsMinimum: major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor) };
}

function booleans(value) {
  const keys = ['installed', 'manifestPresent', 'registered', 'autostart'];
  if (value === undefined) return { installed: false, manifestPresent: false, registered: false, autostart: false };
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length
    || !keys.every(key => typeof value[key] === 'boolean')) fail('invalid_inspection');
  return { installed: value.installed, manifestPresent: value.manifestPresent,
    registered: value.registered, autostart: value.autostart };
}

function state(flag) { return flag ? 'satisfied' : 'pending'; }

function layout(os, root) {
  const sep = os === 'windows' ? '\\' : '/';
  const manifest = root + sep + 'native-host.json';
  if (os === 'windows') return { manifest, launcher: root + sep + 'native-launcher.exe',
    host: root + sep + 'app\\device-native-host.mjs', state: root + sep + 'state' };
  return { manifest, launcher: root + sep + 'bin/native-launcher.sh',
    host: root + sep + 'app/device-native-host.mjs', state: root + sep + 'state' };
}

function autostart(os, root) {
  if (os === 'windows') return Object.freeze({ kind: 'scheduled-task', label: 'AgentContinue Tunnel',
    detail: 'schtasks /create /sc onlogon /tn AgentContinueTunnel (current user, no elevation)' });
  if (os === 'macos') return Object.freeze({ kind: 'launch-agent', label: HOST_NAME,
    detail: '~/Library/LaunchAgents/' + HOST_NAME + '.plist with RunAtLoad and KeepAlive on exit' });
  return Object.freeze({ kind: 'systemd-user', label: 'agent-continue-tunnel.service',
    detail: '~/.config/systemd/user/agent-continue-tunnel.service, WantedBy=default.target' });
}

function windowsRegistry(arch, manifestPath) {
  return Object.freeze({ hive: 'HKCU', view: arch === 'ia32' ? '32' : '64',
    keyPath: 'HKCU' + KEY_ROOT + HOST_NAME, regSzValue: manifestPath });
}

function command(os, extensionId, defaultWindowsEntry) {
  if (os === 'windows' && defaultWindowsEntry) {
    const local = `.\\install.ps1 -InstallLocal -Consent accept-install -PromptForConnection -ExtensionId '${extensionId}'`;
    return Object.freeze({ kind: 'powershell', local, cmd: 'install.cmd guided ' + extensionId, remote: null });
  }
  return Object.freeze({ kind: 'unavailable', local: null, remote: null });
}

export function buildInstallPlan(input, { defaultWindowsEntry = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('invalid_plan_input');
  const required = ['os', 'arch', 'installRoot', 'extensionId', 'nodeVersion'];
  if (Reflect.ownKeys(input).some(key => !['inspection', ...required].includes(key))
    || !required.every(key => Object.hasOwn(input, key))) fail('invalid_plan_input');
  if (!SUPPORTED_OS.includes(input.os)) fail('unsupported_os');
  if (!ARCHES[input.os].includes(input.arch)) fail('unsupported_architecture');
  if (typeof input.extensionId !== 'string' || !/^[a-p]{32}$/.test(input.extensionId)) fail('invalid_extension_id');
  const root = absolutePath(input.installRoot, 'invalid_install_root', input.os);
  const node = parseNode(input.nodeVersion);
  if (!node.meetsMinimum) fail('node_version_too_old');
  const inspect = booleans(input.inspection);
  const paths = layout(input.os, root);
  const entry = command(input.os, input.extensionId, defaultWindowsEntry);

  const shared = [
    { id: 'preflight', title: 'Check Node, architecture and target paths', action: 'read-only',
      state: 'pending', detail: 'Node ' + input.nodeVersion + ' on ' + input.os + '/' + input.arch + '; no elevation is requested.' },
    { id: 'verify-payload', title: 'Verify payload digests before copying', action: 'read-only',
      state: 'pending', detail: 'Every file is compared with the release manifest; a mismatch stops the install.' },
    { id: 'stage', title: 'Stage app, launcher and runtime', action: 'write-files',
      state: state(inspect.installed), detail: root },
    { id: 'write-manifest', title: 'Write native messaging manifest', action: 'write-file',
      state: state(inspect.manifestPresent), detail: paths.manifest },
  ];
  const tail = [
    { id: 'verify', title: 'Verify with status --json and a single-frame handshake', action: 'read-only',
      state: 'pending', detail: 'installed, registered and host startable must all be true before the page turns green.' },
  ];
  const platform = input.os === 'windows'
    ? [{ id: 'register-hkcu', title: 'Register under HKCU (current user only)', action: 'registry-write-current-user',
      state: state(inspect.registered), detail: windowsRegistry(input.arch, paths.manifest).keyPath }]
    : [{ id: 'register-manifest', title: 'Place the manifest in the per-user Chrome directory', action: 'write-file',
      state: state(inspect.registered), detail: paths.manifest }];
  const auto = [{ id: 'autostart', title: 'Enable login autostart (optional, user-scope only)', action: 'user-autostart',
    state: state(inspect.autostart), detail: autostart(input.os, root).detail }];

  return Object.freeze({
    format: INSTALL_PLAN_FORMAT, version: 1, os: input.os, arch: input.arch,
    installRoot: root, extensionId: input.extensionId, node: Object.freeze(node),
    elevation: false, registry: input.os === 'windows' ? windowsRegistry(input.arch, paths.manifest) : null,
    paths: Object.freeze(paths), autostart: autostart(input.os, root), entry,
    alreadyInstalled: inspect.installed && inspect.manifestPresent,
    steps: Object.freeze([...shared, ...platform, ...auto, ...tail].map(Object.freeze)),
  });
}

export function planJson(plan) { return JSON.stringify(plan) + '\n'; }

export function planText(plan) {
  const lines = ['install root: ' + plan.installRoot, 'platform: ' + plan.os + '/' + plan.arch,
    'elevation: none'];
  if (plan.entry.local) {
    lines.push('Windows command-only setup (run from a verified extracted bundle): ' + plan.entry.local);
    lines.push('Native bridge and autostart steps below are separate and are not applied by this command.');
  } else {
    lines.push('No setup command is available for this platform and installation path.');
  }
  for (const step of plan.steps) lines.push('[' + step.state + '] ' + step.id + ': ' + step.title);
  return lines.join('\n') + '\n';
}

export function buildUninstallPlan(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('invalid_plan_input');
  const allowed = ['os', 'installRoot', 'registeredValue', 'inspection', 'keepData'];
  if (Reflect.ownKeys(input).some(key => !allowed.includes(key)) || !Object.hasOwn(input, 'os')
    || !Object.hasOwn(input, 'installRoot')) fail('invalid_plan_input');
  if (!SUPPORTED_OS.includes(input.os)) fail('unsupported_os');
  const root = absolutePath(input.installRoot, 'invalid_install_root', input.os);
  const paths = layout(input.os, root);
  const inspect = booleans(input.inspection);
  if (input.registeredValue !== undefined && input.registeredValue !== null) text(input.registeredValue, 'invalid_registered_value');
  const owns = inspect.installed && input.os !== 'windows'
    ? true : inspect.installed && typeof input.registeredValue === 'string'
      ? input.registeredValue === paths.manifest : false;
  const steps = [
    { id: 'disable-autostart', title: 'Remove login autostart', action: 'user-autostart-remove',
      state: inspect.autostart ? 'pending' : 'satisfied', detail: autostart(input.os, root).detail },
    { id: 'stop-runtime', title: 'Stop only the runtime this install started', action: 'process-stop-owned',
      state: 'pending', detail: 'A runtime owned by another supervisor is reported, never killed.' },
    { id: 'unregister', title: 'Remove only our own registration', action: input.os === 'windows' ? 'registry-remove-current-user' : 'file-remove',
      state: inspect.registered ? 'pending' : 'satisfied',
      detail: !inspect.registered ? 'not registered'
        : owns ? 'value matches this install root' : 'value does not match; manual review required' },
    { id: 'remove-files', title: 'Remove install root', action: 'write-files-remove',
      state: inspect.installed ? 'pending' : 'satisfied', detail: root },
  ];
  return Object.freeze({ format: UNINSTALL_PLAN_FORMAT, version: 1, os: input.os, installRoot: root,
    owned: owns, keepData: input.keepData === true, paths: Object.freeze(paths),
    steps: Object.freeze(steps.map(Object.freeze)) });
}
