import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPackage } from '../native/bootstrap/build-package.mjs';
import { stageRuntime, verifyProviderStage } from '../native/bootstrap/bootstrap.mjs';
import { acquireClient } from '../native/bootstrap/client-acquisition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodePin = Object.freeze({ version: '22.23.4', stem: 'node-v22.23.4-win-x64',
  archiveSha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20',
  executableSha256: 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f' });
const flags = ['--node-archive', '--tunnel-archive', '--npm-cache', '--out'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
const fail = code => { throw new Error(code); };
const fileLimit = 40000;
const archiveLimit = 768 * 1024 * 1024;
const fileFlags = fs.constants.COPYFILE_EXCL;

function canonical(input, kind) {
  if (typeof input !== 'string' || !/^[a-z]:[\\/]/i.test(input) || /[\x00-\x1f]/.test(input) ||
      /[<>:"|?*]/.test(input.slice(2))) fail('invalid_path');
  const file = path.resolve(input), dir = kind === 'out' ? path.dirname(file) : file;
  const resolved = fs.realpathSync.native(dir);
  if (!/^[a-z]:[\\/]/i.test(resolved)) fail('invalid_path');
  if (kind === 'out') {
    if (resolved.toLowerCase() !== dir.toLowerCase()) fail('invalid_path');
    if (!file.endsWith('.zip') || fs.existsSync(file)) fail('output_exists_or_invalid');
  } else {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink() || (kind === 'directory' ? !info.isDirectory() :
      !info.isFile() || kind !== 'system' && info.nlink !== 1 || info.size < 1 || info.size > 128 * 1024 * 1024)) fail('invalid_path');
    return resolved;
  }
  return file;
}

function assertOrdinaryWindows(ps) {
  const probe = '$ErrorActionPreference="Stop"; $i=[Security.Principal.WindowsIdentity]::GetCurrent(); ' +
    'try { if ($i.IsSystem -or [Security.Principal.WindowsPrincipal]::new($i).IsInRole(' +
    '[Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 2 } } finally {$i.Dispose()}';
  const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, stdio: 'ignore' });
  if (r.status !== 0) fail('ordinary_windows_token_required');
}

function powershell(ps, script, args, limit = 120000) {
  const r = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(here, script), ...args],
    { windowsHide: true, encoding: 'utf8', timeout: limit, maxBuffer: 16384 });
  const operation = args[1].toLowerCase();
  if (r.error?.code === 'ETIMEDOUT') fail(operation + '_timeout');
  if (r.error || r.status !== 0 || r.stderr) {
    let phase;
    try { phase = JSON.parse(r.stdout).phase; } catch { /* No external error text. */ }
    fail(typeof phase === 'string' && /^[a-z]+$/.test(phase) ? 'powershell_' + phase : operation + '_failed');
  }
  return r.stdout.trim();
}

function tree(root, visitor, depth = 0, prefix = '') {
  if (depth > 25) fail('invalid_inventory');
  for (const name of fs.readdirSync(root)) {
    if (!/^[a-z0-9@_.+-]+$/i.test(name) || /\.$/.test(name) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) fail('invalid_inventory');
    const file = path.join(root, name), info = fs.lstatSync(file);
    if (info.isSymbolicLink()) fail('invalid_inventory');
    if (info.isDirectory()) tree(file, visitor, depth + 1, prefix + name + '/');
    else {
      if (!info.isFile() || info.nlink !== 1) fail('invalid_inventory');
      visitor(file, prefix + name, info.size);
    }
  }
}

function copyCache(input, output) {
  fs.mkdirSync(output);
  const cache = canonical(path.join(input, '_cacache'), 'directory');
  let files = 0, bytes = 0;
  tree(cache, (file, name, size) => {
    bytes += size;
    if (++files > fileLimit || bytes > archiveLimit) fail('cache_limit');
    const to = path.join(output, '_cacache', name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to, fileFlags);
  });
  if (!files) fail('empty_cache');
}

function inventory(root) {
  const names = ['runtime/node.exe', 'client/tunnel-client-runtime.exe'], seen = new Set();
  let bytes = 0;
  tree(path.join(root, 'app'), (_, name, size) => {
    if (/\.(?:pfx|p12|pem|key)$/i.test(name) ||
        name.split('/').some(part => /^(?:\.env(?:\..*)?|\.npmrc|runtime\.key|tunnel\.yaml|binding\.json)$/i.test(part))) fail('unexpected_sensitive_name');
    const folded = name.toLowerCase();
    if (seen.has(folded)) fail('duplicate_inventory_entry');
    seen.add(folded);
    names.push('app/' + name);
    bytes += size;
    if (names.length > fileLimit || bytes > archiveLimit) fail('inventory_limit');
  });
  return names.sort();
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') fail('windows_x64_required');
  const args = process.argv.slice(2), options = {};
  if (args.length !== 8) fail('invalid_arguments');
  for (let i = 0; i < args.length; i += 2) {
    if (!flags.includes(args[i]) || Object.hasOwn(options, args[i])) fail('invalid_arguments');
    options[args[i]] = canonical(args[i + 1], args[i] === '--out' ? 'out' : args[i] === '--npm-cache' ? 'directory' : 'file');
  }
  const system = path.join(canonical(process.env.SystemRoot, 'directory'), 'System32');
  const ps = canonical(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'system');
  assertOrdinaryWindows(ps);
  if (hashFile(options['--node-archive']) !== nodePin.archiveSha256) fail('node_archive_hash');
  const parent = fs.realpathSync.native(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'ac-admin-build-'));
  try {
    const setup = path.join(scratch, 'setup'), root = path.join(scratch, 'payload'), cache = path.join(scratch, 'cache');
    const archive = path.join(scratch, 'bundle.zip'), listing = path.join(scratch, 'members.txt');
    buildPackage(setup);
    copyCache(options['--npm-cache'], cache);
    await stageRuntime({ installDir: root, consent: 'acquire-provider', offlineCache: cache }, { packageRoot: setup });
    const client = await acquireClient({ installDir: root, consent: 'full-account',
      offlineArchive: options['--tunnel-archive'] }, { packageRoot: setup });
    const provider = await verifyProviderStage(root, setup);
    const runtime = path.join(root, 'runtime'), app = path.join(root, 'app');
    const ownerEntry = path.join(app, 'windows-admin-owner.mjs');
    fs.copyFileSync(path.join(here, '..', 'native', 'desktop-commander', 'windows-admin-owner.mjs'), ownerEntry, fileFlags);
    const browserEntry = path.join(app, 'windows-admin-browser-host.mjs');
    fs.copyFileSync(path.join(here, '..', 'native', 'desktop-commander', 'windows-admin-browser-host.mjs'), browserEntry, fileFlags);
    const demandEntry = path.join(app, 'windows-admin-demand.mjs');
    fs.copyFileSync(path.join(here, '..', 'native', 'desktop-commander', 'windows-admin-demand.mjs'), demandEntry, fileFlags);
    const intentEntry = path.join(app, 'windows-admin-intent.mjs');
    fs.copyFileSync(path.join(here, '..', 'native', 'desktop-commander', 'windows-admin-intent.mjs'), intentEntry, fileFlags);
    const jobSource = path.join(app, 'windows-owner-job.cs');
    fs.copyFileSync(path.join(here, '..', 'native', 'desktop-commander', 'windows-owner-job.cs'), jobSource, fileFlags);
    const browserSessionSources = ['windows-admin-browser-session.mjs', 'windows-browser-peer.cs', 'windows-browser-peer.ps1'];
    for (const name of browserSessionSources) {
      fs.copyFileSync(path.join(here, '..', 'native', 'desktop-commander', name), path.join(app, name), fileFlags);
    }
    fs.mkdirSync(runtime);
    powershell(ps, 'Write-WindowsAdministratorBundle.ps1',
      ['-Action', 'Node', '-Source', options['--node-archive'], '-Destination', runtime, '-Reference', nodePin.stem]);
    if (hashFile(path.join(runtime, 'node.exe')) !== nodePin.executableSha256) fail('node_executable_hash');
    const notices = path.join(app, 'third-party-notices');
    fs.mkdirSync(notices);
    fs.copyFileSync(path.join(runtime, 'LICENSE'), path.join(notices, 'node-LICENSE.txt'), fileFlags);
    const clientStem = 'tunnel-client-runtime-v0.0.19-windows-amd64';
    for (const name of ['LICENSE', 'NOTICE', clientStem + '-licenses.txt', clientStem + '.spdx.json']) {
      fs.copyFileSync(path.join(root, 'client', name), path.join(notices, 'openai-' + name), fileFlags);
    }
    fs.copyFileSync(path.join(here, '..', 'LICENSE'), path.join(notices, 'agent-continue-LICENSE.txt'), fileFlags);
    const evidence = { format: 'agent-continue-windows-administrator-build', version: 1,
      sourcePayloadSha256: hashFile(path.join(setup, 'payload-manifest.json')),
      npmLockSha256: hashFile(path.join(app, 'package-lock.json')),
      windowsAdministratorOwnerSha256: hashFile(ownerEntry),
      windowsAdministratorBrowserHostSha256: hashFile(browserEntry),
      windowsAdministratorDemandSha256: hashFile(demandEntry),
      windowsAdministratorIntentSha256: hashFile(intentEntry),
      windowsAdministratorJobSourceSha256: hashFile(jobSource),
      windowsAdministratorBrowserSessionSources: Object.fromEntries(browserSessionSources.map(name => [name, hashFile(path.join(app, name))])),
      node: { version: nodePin.version, archiveSha256: nodePin.archiveSha256, executableSha256: nodePin.executableSha256 },
      provider: provider.providerVersion, tunnel: client.tunnelRelease, tunnelExecutableSha256: client.executableSha256,
      tunnelArchiveSha256: hashFile(path.join(root, 'client', 'release.zip')) };
    fs.writeFileSync(path.join(app, 'agent-continue-build-evidence.json'), JSON.stringify(evidence) + '\n', { flag: 'wx' });
    const names = inventory(root);
    fs.writeFileSync(listing, names.join('\n') + '\n', { flag: 'wx' });
    powershell(ps, 'Write-WindowsAdministratorBundle.ps1',
      ['-Action', 'Zip', '-Source', root, '-Destination', archive, '-Reference', listing], 300000);
    const digest = hashFile(archive);
    const receipt = JSON.parse(powershell(ps, 'Stage-WindowsAdministratorBundle.ps1',
      ['-Action', 'Plan', '-Archive', archive, '-ExpectedSha256', digest]));
    if (receipt.ok !== true || receipt.files !== names.length || receipt.protectedFilesVerified !== false ||
        receipt.activated !== false || receipt.registrationChanged !== false) fail('invalid_plan_receipt');
    fs.copyFileSync(archive, options['--out'], fileFlags);
    if (hashFile(options['--out']) !== digest) fail('output_hash_mismatch');
    console.log(JSON.stringify({ ok: true, sha256: digest, files: names.length, bytes: fs.statSync(archive).size,
      stagerPlan: true, protectedFilesVerified: false, activated: false, ...evidence }));
  } finally {
    if (path.dirname(scratch) !== parent || fs.realpathSync.native(scratch) !== scratch ||
        !/^ac-admin-build-[a-z0-9]{6}$/i.test(path.basename(scratch))) fail('unsafe_cleanup');
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: /^[a-z0-9_]+$/.test(error.message) ? error.message : 'bundle_build_failed' }));
  process.exitCode = 1;
});
