import { spawn } from 'node:child_process';
import { validateDeviceRequest } from './device-operations.mjs';
import { responseValid, readSshTarget, sendDeviceRequest } from './device-owner.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const unavailable = () => new Error('device_ssh_unavailable');
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

export async function routeDeviceRequest(binding, value, targetsFile, options = {}) {
  binding.assertCurrent();
  const response = value?.version === 2
    ? await sendSshDeviceRequest(readSshTarget(targetsFile, binding.extensionId, value.target), value, options)
    : await sendDeviceRequest(binding, value);
  binding.assertCurrent();
  return response;
}

export async function sendSshDeviceRequest(binding, value, options = {}) {
  try {
    if (!exact(value, ['version', 'target', 'id', 'action']) || value.version !== 2 || value.target !== binding.target ||
        !/^[a-f0-9]{64}$/.test(value.target) || !exact(options, Object.keys(options).filter(key => ['spawnProcess', 'timeoutMs'].includes(key)))) throw unavailable();
    const request = validateDeviceRequest({ version: 1, id: value.id, action: value.action });
    const timeoutMs = options.timeoutMs ?? 12000, spawnProcess = options.spawnProcess ?? spawn;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || typeof spawnProcess !== 'function') throw unavailable();
    binding.assertCurrent();
    const environment = {};
    for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID']) {
      if (typeof process.env[name] === 'string') environment[name] = process.env[name];
    }
    environment.SSH_ASKPASS_REQUIRE = 'never';
    const knownHosts = (process.platform === 'win32' ? binding.knownHosts.replace(/\\/g, '/') : binding.knownHosts).replace(/"/g, '\\"');
    const args = ['-F', 'none', '-T'];
    for (const option of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ForwardAgent=no', 'ForwardX11=no',
      'ClearAllForwardings=yes', 'Tunnel=no', 'ProxyCommand=none', 'ProxyJump=none', 'ControlMaster=no',
      'ControlPath=none', 'ControlPersist=no', 'PermitLocalCommand=no', 'RemoteCommand=none',
      'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'NumberOfPasswordPrompts=0',
      'PreferredAuthentications=publickey', 'IdentityFile=none', 'IdentitiesOnly=no', 'GlobalKnownHostsFile=none',
      'KnownHostsCommand=none', 'UpdateHostKeys=no', 'VerifyHostKeyDNS=no', 'ConnectionAttempts=1', 'ConnectTimeout=8',
      'UserKnownHostsFile="' + knownHosts + '"']) args.push('-o', option);
    args.push('-p', String(binding.port), '-l', binding.user, '--', binding.host,
      [binding.node, binding.entry, 'request', '--state-dir', binding.stateRoot, '--id', request.id, '--action', request.action].map(quote).join(' '));
    const child = spawnProcess(binding.sshExecutable, args, { shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: environment });
    const output = await new Promise((resolve, reject) => {
      let bytes = Buffer.alloc(0), rejected = false, done = false, drain;
      const finish = (error, result) => {
        if (done) return; done = true; clearTimeout(timer); clearTimeout(drain);
        if (error) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); reject(unavailable()); }
        else resolve(result);
      };
      const stop = () => {
        if (rejected || done) return; rejected = true;
        try { child.kill(); } catch { /* An unknown local exit does not imply remote rollback. */ }
        drain = setTimeout(() => finish(unavailable()), 500);
      };
      const timer = setTimeout(stop, timeoutMs);
      child.stdout.on('data', chunk => {
        if (rejected) return;
        if (bytes.length + chunk.length > 4096) { stop(); return; }
        bytes = Buffer.concat([bytes, chunk]);
      });
      child.stderr.resume(); child.stderr.on('error', stop); child.stdout.on('error', stop);
      child.on('error', () => finish(unavailable()));
      child.once('close', (code, signal) => finish(rejected || code !== 0 || signal !== null ? unavailable() : null, bytes));
    });
    binding.assertCurrent();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(output);
    if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) throw unavailable();
    const response = JSON.parse(text);
    if (JSON.stringify(response) + '\n' !== text || !responseValid(response, request)) throw unavailable();
    return { ...response, version: 2, target: binding.target };
  } catch { throw unavailable(); }
}
