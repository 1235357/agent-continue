import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bad = () => { throw new Error('administrator_demand_invalid'); };
const digestPattern = /^[a-f0-9]{64}$/;
const sidPattern = /^S-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}$/;
const tunnelPattern = /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/;

export function administratorDemandLaunch(root, binding) {
  const win = path.win32;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).length !== 5 ||
      binding.version !== 1 || typeof binding.bundleSha256 !== 'string' || !digestPattern.test(binding.bundleSha256) ||
      typeof binding.userSid !== 'string' || !sidPattern.test(binding.userSid) ||
      typeof binding.tunnelId !== 'string' || !tunnelPattern.test(binding.tunnelId) ||
      typeof binding.systemDirectory !== 'string' || !/^[A-Z]:\\Windows\\System32$/i.test(binding.systemDirectory) ||
      typeof root !== 'string' || !/^[A-Z]:\\[^\\]/i.test(root) || win.normalize(root) !== root ||
      win.basename(win.dirname(root)) !== 'AgentContinueAdmin' || win.basename(root) !== binding.bundleSha256.slice(0, 24)) bad();
  const system = binding.systemDirectory, windows = win.dirname(system);
  const bridge = root + '.browser';
  const temp = win.join(root + '.state', 'temp');
  return {
    command: win.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', win.join(bridge, 'stager.ps1'),
      '-Action', 'StartHostedOwner', '-Archive', win.join(bridge, 'bundle.zip'),
      '-ExpectedSha256', binding.bundleSha256, '-ExpectedUserSid', binding.userSid,
      '-HostedTunnelId', binding.tunnelId, '-Consent', 'restore-authorized-administrator-owner', '-BrowserWake'],
    options: { cwd: system, windowsHide: true, shell: false, stdio: 'ignore', env: {
      SystemRoot: windows, WINDIR: windows, SystemDrive: win.parse(system).root.slice(0, 2),
      // Windows PowerShell needs PATHEXT even for an absolute .exe invocation.
      PATH: system, PATHEXT: '.EXE', ComSpec: win.join(system, 'cmd.exe'), TEMP: temp, TMP: temp,
    } },
  };
}

function readBinding(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) bad();
  const bytes = Buffer.alloc(1025);
  const fd = fs.openSync(file, 'r');
  try {
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== stat.size) bad();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)));
  } finally { fs.closeSync(fd); }
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64' || process.argv.length !== 2) bad();
    const root = path.dirname(path.dirname(entry));
    if (process.execPath !== path.join(root, 'runtime', 'node.exe')) bad();
    const { command, args, options } = administratorDemandLaunch(root, readBinding(path.join(root + '.browser', 'demand.json')));
    const child = spawn(command, args, options);
    child.once('error', () => { process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
  } catch { process.exitCode = 1; }
}
