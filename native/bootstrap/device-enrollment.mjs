import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveLocalPath, verifyProviderStage } from './bootstrap.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fail = code => { throw new Error(code); };
const encode = value => JSON.stringify(value) + '\n';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = ['installDir', 'consent', 'sshExecutable', 'host', 'port', 'user', 'remoteNode',
  'remoteInstallDir', 'knownHosts', 'knownHostsSha256'];
const errors = new Set(['consent_required', 'enrollment_input_invalid', 'enrollment_install_invalid',
  'enrollment_exists', 'enrollment_changed', 'enrollment_write_failed']);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

function record(value, allowed, complete = false) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    (!complete || Reflect.ownKeys(value).length === allowed.length) &&
    Reflect.ownKeys(value).every(key => allowed.includes(key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function remote(value) {
  return typeof value === 'string' && value.length <= 900 && !/[\x00-\x1f\x7f]/.test(value) &&
    value !== '/' && !value.startsWith('//') && path.posix.isAbsolute(value) && path.posix.normalize(value) === value;
}

function local(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) fail('enrollment_input_invalid');
  const result = resolveLocalPath(value), root = path.parse(result).root;
  if (process.platform === 'win32' && result.slice(root.length).split(path.sep).some(part => /[<>:"|?*]|[. ]$/.test(part))) {
    fail('enrollment_input_invalid');
  }
  return result;
}

function absent(file) {
  try { fs.lstatSync(file); fail('enrollment_exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function enrollSshTarget(options, trusted = {}) {
  try {
    const consent = options && Object.getOwnPropertyDescriptor(options, 'consent');
    if (!consent || !Object.hasOwn(consent, 'value') || consent.value !== 'full-account') fail('consent_required');
    if (!record(options, keys, true) || !record(trusted, ['packageRoot'])) fail('enrollment_input_invalid');
    const input = Object.fromEntries(keys.map(key => [key, options[key]]));
    const packageRoot = trusted.packageRoot ?? here;
    if (typeof input.host !== 'string' || !(net.isIP(input.host) || input.host.length <= 253 &&
        input.host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) ||
        !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || typeof input.user !== 'string' ||
        !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}\$?$/.test(input.user) || !remote(input.remoteNode) || !remote(input.remoteInstallDir) ||
        !hex(input.knownHostsSha256)) fail('enrollment_input_invalid');
    let installDir, app, bindingFile, registry, installInfo, appInfo;
    try {
      installDir = local(input.installDir); app = local(path.join(installDir, 'app'));
      installInfo = fs.lstatSync(installDir, { bigint: true }); appInfo = fs.lstatSync(app, { bigint: true });
      if (!installInfo.isDirectory() || !appInfo.isDirectory() || installInfo.ino === 0n || appInfo.ino === 0n) fail('enrollment_install_invalid');
      bindingFile = path.join(app, 'device-native-binding.json'); registry = path.join(app, 'device-ssh-targets.json');
      absent(registry);
      await verifyProviderStage(installDir, packageRoot);
    } catch (error) { fail(error.message === 'enrollment_exists' ? error.message : 'enrollment_install_invalid'); }
    const assertInstall = () => {
      if (local(input.installDir) !== installDir || local(path.join(installDir, 'app')) !== app ||
          !same(fs.lstatSync(installDir, { bigint: true }), installInfo) || !same(fs.lstatSync(app, { bigint: true }), appInfo)) {
        fail('enrollment_changed');
      }
    };
    let owner, binding;
    try {
      assertInstall();
      owner = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
      assertInstall(); binding = owner.readNativeBinding(bindingFile);
      if (binding.root !== path.join(installDir, 'state')) fail('enrollment_install_invalid');
    } catch { fail('enrollment_install_invalid'); }
    let sshExecutable, knownHosts;
    try { sshExecutable = local(input.sshExecutable); knownHosts = local(input.knownHosts); }
    catch { fail('enrollment_input_invalid'); }
    const descriptor = { host: input.host, port: input.port, user: input.user, node: input.remoteNode,
      entry: path.posix.join(input.remoteInstallDir, 'app/device-server.mjs'), stateRoot: path.posix.join(input.remoteInstallDir, 'state'),
      knownHosts, knownHostsSha256: input.knownHostsSha256 };
    const target = digest(JSON.stringify([binding.extensionId, descriptor]));
    const value = { format: 'agent-continue-ssh-targets', version: 1, extensionId: binding.extensionId,
      sshExecutable, targets: [{ id: target, ...descriptor }] };
    const pending = path.join(app, 'device-ssh-targets.pending.' + crypto.randomUUID());
    let candidate, candidateInfo;
    try { fs.writeFileSync(pending, encode(value), { flag: 'wx', mode: 0o600 }); }
    catch { fail('enrollment_write_failed'); }
    try {
      candidate = owner.readSshTarget(pending, binding.extensionId, target);
      candidateInfo = fs.lstatSync(pending, { bigint: true });
    } catch { fail('enrollment_input_invalid'); }
    try {
      await verifyProviderStage(installDir, packageRoot);
      assertInstall(); binding.assertCurrent(); candidate.assertCurrent();
    } catch { fail('enrollment_changed'); }
    try { fs.linkSync(pending, registry); }
    catch (error) { fail(error.code === 'EEXIST' ? 'enrollment_exists' : 'enrollment_write_failed'); }
    try {
      fs.unlinkSync(pending);
      assertInstall(); binding.assertCurrent();
      const published = owner.readSshTarget(registry, binding.extensionId, target);
      if (!same(fs.lstatSync(registry, { bigint: true }), candidateInfo) || published.sshExecutable !== sshExecutable ||
          Object.keys(descriptor).some(key => published[key] !== descriptor[key])) fail('enrollment_changed');
      published.assertCurrent();
    } catch { fail('enrollment_write_failed'); }
    return { format: 'agent-continue-ssh-enrollment-result', version: 1, status: 'enrolled', target,
      deviceUrl: 'chrome-extension://' + binding.extensionId + '/devices.html?target=' + target,
      sshAuthenticationVerified: false, ownerReachabilityVerified: false, nativeRegistrationVerified: false,
      chatAuthorizationVerified: false, activated: false };
  } catch (error) { fail(errors.has(error?.message) ? error.message : 'enrollment_input_invalid'); }
}
