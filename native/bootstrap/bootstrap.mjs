import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROVIDER, RUNTIME_FILES } from './payload-layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const encode = value => JSON.stringify(value) + '\n';
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const errors = new Set(['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists',
  'npm_unavailable', 'dependency_acquisition_failed', 'acquisition_exit_unconfirmed',
  'provider_verification_failed', 'receipt_write_failed', 'bootstrap_failed']);

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) ||
      value.startsWith('\\\\') || value.startsWith('//')) fail('invalid_install_path');
  const result = path.resolve(value), parsed = path.parse(result);
  let current = parsed.root;
  for (const part of result.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail('invalid_install_path');
      current = fs.realpathSync(current);
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}

function overlap(first, second) {
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  first = fold(first); second = fold(second);
  const contains = (a, b) => a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
  if (contains(first, second) || contains(second, first)) return true;
  // realpath can preserve a case alias; identity comparisons work on both case modes.
  const physicalAncestor = (ancestor, child) => {
    let identity;
    try { identity = fs.statSync(ancestor, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (identity.ino === 0n) fail('invalid_install_path');
    for (let current = child; ; current = path.dirname(current)) {
      try {
        const info = fs.statSync(current, { bigint: true });
        if (info.dev === identity.dev && info.ino === identity.ino) return true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (path.dirname(current) === current) return false;
    }
  };
  return physicalAncestor(first, second) || physicalAncestor(second, first);
}

export { localPath as resolveLocalPath, overlap as pathsOverlap };

function regular(file, limit = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.ino === 0n || stat.size > BigInt(limit)) fail('payload_invalid');
  return fs.readFileSync(file);
}

function checkedManifest(packageRoot) {
  localPath(packageRoot);
  const bytes = regular(path.join(packageRoot, 'payload-manifest.json'), 65536).toString('utf8');
  const manifest = JSON.parse(bytes);
  if (!exact(manifest, ['format', 'version', 'provider', 'files']) || manifest.format !== 'agent-continue-payload' ||
      manifest.version !== 1 || !exact(manifest.provider, ['name', 'version']) ||
      manifest.provider.name !== PROVIDER.name || manifest.provider.version !== PROVIDER.version ||
      !Array.isArray(manifest.files) || manifest.files.length !== RUNTIME_FILES.length || encode(manifest) !== bytes) fail('payload_invalid');
  let total = 0;
  for (let index = 0; index < RUNTIME_FILES.length; index++) {
    const record = manifest.files[index];
    if (!exact(record, ['path', 'bytes', 'sha256']) || record.path !== RUNTIME_FILES[index] ||
        !Number.isInteger(record.bytes) || record.bytes < 0 || record.bytes > 4 * 1024 * 1024 ||
        typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) fail('payload_invalid');
    total += record.bytes;
  }
  if (total > 8 * 1024 * 1024) fail('payload_invalid');
  return manifest;
}

function verifyFiles(root, manifest, exactDirectory) {
  localPath(root);
  if (!fs.lstatSync(root).isDirectory()) fail('payload_invalid');
  if (exactDirectory && JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(RUNTIME_FILES)) fail('payload_invalid');
  for (const record of manifest.files) {
    const bytes = regular(path.join(root, record.path));
    if (bytes.length !== record.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail('payload_invalid');
  }
}

function providerPin(root) {
  const pin = JSON.parse(regular(path.join(root, 'upstream-pin.json')).toString('utf8'));
  if (pin.name !== PROVIDER.name || pin.version !== PROVIDER.version || !Number.isInteger(pin.files) || pin.files <= 0 ||
      !/^[a-f0-9]{64}$/.test(pin.treeSha256)) fail('payload_invalid');
  return pin;
}

function verifyLock(root) {
  const meta = JSON.parse(regular(path.join(root, 'package.json')));
  const lock = JSON.parse(regular(path.join(root, 'package-lock.json'))), pin = providerPin(root);
  if (!exact(meta.dependencies, [PROVIDER.name]) || meta.dependencies[PROVIDER.name] !== PROVIDER.version ||
      lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object' ||
      !exact(lock.packages['']?.dependencies, [PROVIDER.name]) || lock.packages[''].dependencies[PROVIDER.name] !== PROVIDER.version) fail('payload_invalid');
  const packages = Object.entries(lock.packages);
  const parent = lock.packages['node_modules/' + PROVIDER.name];
  const bundleName = 'node_modules/' + PROVIDER.name + '/node_modules/@desktop-commander/telemetry-contract';
  const bundle = lock.packages[bundleName];
  if (packages.length > 10000 || parent?.version !== PROVIDER.version || parent?.integrity !== pin.integrity) fail('payload_invalid');
  if (bundle !== undefined || parent.bundleDependencies !== undefined ||
      parent.dependencies?.['@desktop-commander/telemetry-contract'] !== undefined) {
    if (!bundle || bundle.inBundle !== true || bundle.version !== '0.1.1' || bundle.link ||
        bundle.resolved !== undefined || bundle.integrity !== undefined ||
        JSON.stringify(parent.bundleDependencies) !== '["@desktop-commander/telemetry-contract"]' ||
        parent.dependencies?.['@desktop-commander/telemetry-contract'] !== 'file:vendor/telemetry-contract') fail('payload_invalid');
  }
  for (const [name, record] of packages) {
    if (name === '') continue;
    // This single vendored dependency is covered by the pinned parent tarball's integrity.
    if (name === bundleName) continue;
    if (!record || record.link || record.inBundle || typeof record.resolved !== 'string' ||
        typeof record.integrity !== 'string' || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(record.integrity)) fail('payload_invalid');
    const url = new URL(record.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password || url.search || url.hash) fail('payload_invalid');
  }
}

export function verifyPayload(packageRoot = here) {
  try {
    packageRoot = localPath(packageRoot);
    const manifest = checkedManifest(packageRoot), payload = path.join(packageRoot, 'payload');
    verifyFiles(payload, manifest, true); verifyLock(payload);
    return { files: RUNTIME_FILES.length, providerVersion: PROVIDER.version };
  } catch { fail('payload_invalid'); }
}

function stageReceipt() {
  return { format: 'agent-continue-acquisition', version: 1, status: 'staged', providerVersion: PROVIDER.version,
    configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
}

export async function verifyProviderStage(installDir, packageRoot = here) {
  try {
    const root = localPath(installDir);
    packageRoot = localPath(packageRoot);
    if (overlap(root, packageRoot) || !fs.lstatSync(root).isDirectory()) fail('provider_stage_invalid');
    verifyPayload(packageRoot);
    const manifest = checkedManifest(packageRoot), app = path.join(root, 'app');
    verifyFiles(app, manifest, false); verifyLock(app);
    const receiptFile = localPath(path.join(root, 'receipt.json'));
    const info = fs.lstatSync(receiptFile);
    if (!info.isFile() || info.size > 16384 || fs.readFileSync(receiptFile, 'utf8') !== encode(stageReceipt())) fail('provider_stage_invalid');
    const module = await import(pathToFileURL(path.join(app, 'runtime.mjs')).href);
    const result = module.verifyUpstream(), pin = providerPin(app);
    if (!exact(result, ['version', 'verifiedFiles']) || result.version !== PROVIDER.version || result.verifiedFiles !== pin.files) fail('provider_stage_invalid');
    return { providerVersion: PROVIDER.version, files: RUNTIME_FILES.length };
  } catch { fail('provider_stage_invalid'); }
}

function findNpm(supplied) {
  const candidates = supplied ? [supplied] : [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (!path.isAbsolute(candidate)) continue;
      const file = fs.realpathSync(candidate), root = path.dirname(path.dirname(file));
      if (path.basename(file) !== 'npm-cli.js' || path.basename(path.dirname(file)) !== 'bin' ||
          !fs.statSync(file).isFile() || JSON.parse(regular(localPath(path.join(root, 'package.json')), 65536)).name !== 'npm') continue;
      return { file, root };
    } catch { /* Another supported installation layout may still exist. */ }
  }
  fail('npm_unavailable');
}

function acquire(npm, args, cwd, env, timeout, signal, reportFile) {
  return new Promise((resolve, reject) => {
    let child, deadline, force, final, settled = false, cancelled = false, failed = false;
    const started = performance.now();
    let exitObserved = false, closeObserved = false, exitCode = null, closeCode = null, cancelReason = null;
    const finish = code => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(force); clearTimeout(final);
      signal?.removeEventListener('abort', stop);
      try {
        fs.writeFileSync(reportFile, encode({ format: 'agent-continue-acquisition-process', version: 1,
          result: code || 'completed', exitObserved, closeObserved, exitCode, closeCode, cancelReason,
          durationMs: Math.round(performance.now() - started) }), { flag: 'wx', mode: 0o600 });
      } catch { /* Diagnostics never change the acquisition/receipt result. */ }
      if (code === 'acquisition_exit_unconfirmed') {
        child?.unref(); child?.stdout?.destroy(); child?.stderr?.destroy();
      }
      code ? reject(new Error(code)) : resolve();
    };
    const live = () => child?.pid && child.exitCode === null && child.signalCode === null;
    const stop = () => {
      if (cancelled || settled) return;
      cancelled = true;
      cancelReason = signal?.aborted ? 'cancelled' : 'deadline';
      if (live()) { try { child.kill('SIGTERM'); } catch { /* Exit still requires close. */ } }
      force = setTimeout(() => {
        if (live()) { try { child.kill('SIGKILL'); } catch { /* Never widen the signal target. */ } }
        final = setTimeout(() => finish('acquisition_exit_unconfirmed'), 2000);
      }, 2000);
    };
    try {
      child = spawn(process.execPath, [npm, ...args], { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.resume(); child.stderr.resume();
      child.once('error', () => { failed = true; });
      child.once('exit', code => { exitObserved = true; exitCode = Number.isInteger(code) ? code : null; });
      child.once('close', code => {
        closeObserved = true; closeCode = Number.isInteger(code) ? code : null;
        finish(code === 0 && !failed && !cancelled ? null : 'dependency_acquisition_failed');
      });
      deadline = setTimeout(stop, timeout);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
    } catch { finish('dependency_acquisition_failed'); }
  });
}

export async function stageRuntime(options, trusted = {}) {
  try {
    if (options?.consent !== 'acquire-provider') fail('consent_required');
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => !['installDir', 'consent', 'offlineCache', 'signal'].includes(key)) ||
        !trusted || typeof trusted !== 'object' || Array.isArray(trusted) ||
        Object.keys(trusted).some(key => !['packageRoot', 'npmCli', 'acquisitionTimeoutMs'].includes(key)) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal))) fail('bootstrap_failed');
    const cancelled = () => { if (options.signal?.aborted) fail('dependency_acquisition_failed'); };
    cancelled();
    const root = localPath(options.installDir), packageRoot = localPath(trusted.packageRoot || here);
    if (overlap(root, packageRoot)) fail('invalid_install_path');
    try { if (!fs.statSync(path.dirname(root)).isDirectory()) fail('invalid_install_path'); }
    catch { fail('invalid_install_path'); }
    verifyPayload(packageRoot);
    const manifest = checkedManifest(packageRoot), npm = findNpm(trusted.npmCli);
    const timeout = trusted.acquisitionTimeoutMs ?? 180000;
    if (!Number.isInteger(timeout) || timeout < 20 || timeout > 180000) fail('bootstrap_failed');
    let cache;
    if (options.offlineCache !== undefined) {
      cache = localPath(options.offlineCache);
      try {
        if (overlap(cache, root) || overlap(cache, packageRoot) || overlap(cache, npm.root) ||
            overlap(cache, path.dirname(fs.realpathSync(process.execPath))) ||
            !fs.statSync(cache).isDirectory() || !fs.statSync(localPath(path.join(cache, '_cacache'))).isDirectory()) fail('invalid_install_path');
      } catch { fail('invalid_install_path'); }
    }
    cancelled();
    try { fs.mkdirSync(root, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') fail('destination_exists'); throw error; }
    const app = path.join(root, 'app'), acquisition = path.join(root, 'acquisition');
    fs.mkdirSync(app, { mode: 0o700 }); fs.mkdirSync(acquisition, { mode: 0o700 });
    for (const record of manifest.files) {
      fs.writeFileSync(path.join(app, record.path), regular(path.join(packageRoot, 'payload', record.path)), { flag: 'wx', mode: 0o600 });
    }
    verifyFiles(app, manifest, true);
    for (const name of ['home', 'temp', 'cache', 'logs']) fs.mkdirSync(path.join(acquisition, name), { mode: 0o700 });
    for (const name of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(acquisition, name), '', { flag: 'wx', mode: 0o600 });
    const home = path.join(acquisition, 'home'), temp = path.join(acquisition, 'temp');
    const env = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
      TEMP: temp, TMP: temp, TMPDIR: temp, PATH: path.dirname(process.execPath),
      CI: 'true', NO_COLOR: '1', DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', PUPPETEER_SKIP_DOWNLOAD: '1' };
    for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || process.env.WINDIR;
      if (!systemRoot || !path.isAbsolute(systemRoot)) fail('bootstrap_failed');
      const system = path.join(systemRoot, 'System32');
      env.PATH += path.delimiter + system;
      env.ComSpec = path.join(system, 'cmd.exe');
      env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    }
    const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/',
      '--prefix', app, '--workspaces=false',
      '--logs-dir', path.join(acquisition, 'logs'), '--logs-max=2', '--update-notifier=false',
      '--userconfig', path.join(acquisition, 'user.npmrc'), '--globalconfig', path.join(acquisition, 'global.npmrc'),
      '--cache', cache || path.join(acquisition, 'cache')];
    if (cache) args.push('--offline');
    cancelled(); await acquire(npm.file, args, app, env, timeout, options.signal, path.join(acquisition, 'process.json')); cancelled();
    verifyFiles(app, manifest, false);
    try {
      const module = await import(pathToFileURL(path.join(app, 'runtime.mjs')).href);
      const result = module.verifyUpstream(), pin = providerPin(app);
      if (!exact(result, ['version', 'verifiedFiles']) || result.version !== PROVIDER.version || result.verifiedFiles !== pin.files) throw new Error('invalid_result');
    } catch { fail('provider_verification_failed'); }
    cancelled();
    const receipt = stageReceipt();
    const pending = path.join(root, 'receipt.pending.' + crypto.randomUUID());
    try { fs.writeFileSync(pending, encode(receipt), { flag: 'wx', mode: 0o600 }); }
    catch { fail('receipt_write_failed'); }
    cancelled();
    try { fs.linkSync(pending, path.join(root, 'receipt.json')); }
    catch { fail('receipt_write_failed'); }
    try { fs.unlinkSync(pending); } catch { /* The committed receipt already defines success. */ }
    return receipt;
  } catch (error) { fail(errors.has(error?.message) ? error.message : 'bootstrap_failed'); }
}
