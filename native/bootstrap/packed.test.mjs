import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSetupRequest, serializeSetupRequest } from '../../setup-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const payloadFiles = [
  'device-native-host.mjs', 'device-operations.mjs', 'device-owner.mjs', 'device-server.mjs', 'device-ssh.mjs',
  'host.mjs', 'lifecycle.mjs', 'operation-receipts.mjs', 'package-lock.json', 'package.json',
  'prepared-process.mjs', 'process-observation.mjs', 'profile.mjs', 'research-handoff.mjs', 'research-runner.mjs', 'runtime.mjs', 'setup-cli.mjs',
  'tunnel-pins.json', 'upstream-pin.json', 'windows-child.mjs', 'windows-process-query.cs',
];
const packageFiles = [
  'bin.mjs', 'bootstrap.mjs', 'browser-control.mjs', 'browser-wake-registration.mjs', 'client-acquisition.mjs', 'device-enrollment.mjs', 'device-setup.mjs', 'payload-layout.mjs', 'package.json',
  'install-plan.mjs', 'registration-guidance.mjs', 'registration-plan.mjs', 'registration-render.mjs',
  'registration-status.mjs', 'registration-status-view.mjs', 'registration-execution.mjs', 'registration-writer.mjs', 'registry-win.mjs', 'runtime-precheck.mjs',
  'README.md', 'LICENSE', 'payload-manifest.json', 'Prepare-ReleaseNative.ps1', 'native-publishers.json', 'install.ps1', 'install.cmd',
  ...payloadFiles.map(name => `payload/${name}`),
].sort();
const receipt = Object.freeze({
  format: 'agent-continue-acquisition', version: 1, status: 'staged', providerVersion: '0.3.1',
  configured: false, activated: false, protectedInstallationVerified: false,
  nativeDependenciesVerified: false,
});
const realCache = process.env.AGENT_CONTINUE_REAL_CACHE;
const officialArchive = process.env.AGENT_CONTINUE_OFFICIAL_ARCHIVE;
const officialClient = process.env.AGENT_CONTINUE_OFFICIAL_CLIENT === '1' || officialArchive !== undefined;
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  crypto.createHash(algorithm).update(bytes).digest(encoding);

// Child diagnostics deliberately contain counts/codes only, never raw npm/host output.
function sameJSON(actual, expected, label) {
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalize(value[key])]),
    );
    return value;
  };
  assert.ok(JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected)), label);
}

function parseJSON(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(label); }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`));
}

function trustedNpmCLI() {
  const nodeDirectory = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath,
    path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try {
      const resolved = fs.realpathSync(candidate);
      const bin = path.dirname(resolved), npm = path.dirname(bin);
      if (path.basename(resolved) !== 'npm-cli.js' || path.basename(bin) !== 'bin' ||
          path.basename(npm) !== 'npm' || !fs.lstatSync(resolved).isFile()) continue;
      const metadata = path.join(npm, 'package.json');
      if (!fs.lstatSync(metadata).isFile() ||
          JSON.parse(fs.readFileSync(metadata, 'utf8')).name !== 'npm') continue;
      return resolved;
    } catch { /* Try only the remaining standard local toolchain locations. */ }
  }
  throw new Error('trusted_local_npm_cli_unavailable');
}

function fixture(t) {
  const temp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, 'agent-continue-packed-'));
  const identity = fs.lstatSync(root, { bigint: true });
  const children = new Set();
  let nestedExitUnconfirmed = false;
  t.after(async () => {
    // If any retained child cannot be confirmed closed, preserve its files.
    const stopped = await Promise.all([...children].map(child => child.stop()));
    assert.ok(stopped.every(Boolean), 'owned_child_exit_unconfirmed');
    if (nestedExitUnconfirmed) {
      t.diagnostic('Disposable fixture retained: nested acquisition exit unconfirmed');
      return;
    }
    assert.equal(path.dirname(path.resolve(root)), temp, 'cleanup_outside_temp_root');
    assert.match(path.basename(root), /^agent-continue-packed-[A-Za-z0-9]+$/);
    const current = fs.lstatSync(root, { bigint: true });
    assert.ok(current.isDirectory() && !current.isSymbolicLink(), 'cleanup_redirected_root');
    assert.equal(fs.realpathSync(root), root, 'cleanup_redirected_ancestor');
    assert.equal(current.dev, identity.dev, 'cleanup_root_replaced');
    assert.equal(current.ino, identity.ino, 'cleanup_root_replaced');
    fs.rmSync(root, { recursive: true, force: true });
  });

  const home = path.join(root, 'home'), cache = path.join(root, 'npm-cache');
  const work = path.join(root, 'work'), temporary = path.join(root, 'temp');
  for (const directory of [home, cache, path.join(cache, '_cacache'), work, temporary,
    path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'Local')]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const userconfig = path.join(root, 'empty-user.npmrc');
  const globalconfig = path.join(root, 'empty-global.npmrc');
  for (const file of [userconfig, globalconfig]) fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  const npmCli = trustedNpmCLI();
  const env = {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TEMP: temporary, TMP: temporary, TMPDIR: temporary,
    PATH: path.dirname(process.execPath),
    NPM_CONFIG_USERCONFIG: userconfig, NPM_CONFIG_GLOBALCONFIG: globalconfig,
    NPM_CONFIG_CACHE: cache, NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false',
    npm_execpath: npmCli, NO_COLOR: '1',
  };
  if (process.platform === 'win32') {
    assert.ok(process.env.SystemRoot, 'windows_system_root_unavailable');
    env.SystemRoot = process.env.SystemRoot;
    env.WINDIR = process.env.SystemRoot;
    env.PATH = [env.PATH, path.join(env.SystemRoot, 'System32'),
      path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(path.delimiter);
  } else {
    env.PATH += `${path.delimiter}/usr/bin${path.delimiter}/bin`;
  }

  function start(args, options = {}) {
    const cwd = options.cwd || work;
    assert.ok(isWithin(root, cwd), 'child_cwd_outside_owned_fixture');
    const child = spawn(process.execPath, args, { cwd, env: options.env || env,
      shell: false, windowsHide: true, stdio: [options.pipe ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let ended = false, launchError = false;
    const closed = new Promise(resolve => {
      child.once('error', () => { launchError = true; });
      child.once('close', (code, signal) => {
        ended = true; children.delete(handle); resolve({ code, signal, launchError });
      });
    });
    const wait = async milliseconds => {
      let timer;
      try { return await Promise.race([closed, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), milliseconds);
      })]); }
      finally { clearTimeout(timer); }
    };
    const handle = { child, closed, wait, async stop() {
      if (ended) return true;
      child.stdin?.end();
      try { child.kill('SIGTERM'); } catch { /* Retain the exact handle until close. */ }
      if (await wait(6000)) return true;
      try { child.kill('SIGKILL'); } catch { /* A close event is still required. */ }
      return Boolean(await wait(3000));
    } };
    child.stdin?.on('error', () => {});
    children.add(handle);
    return handle;
  }

  async function run(args, options = {}) {
    const handle = start(args, options);
    let stdout = '', stdoutBytes = 0, stderrBytes = 0, overflow = false;
    handle.child.stdout.on('data', data => {
      stdoutBytes += data.length;
      if (stdoutBytes > 4 * 1024 * 1024) overflow = true;
      else stdout += data.toString('utf8');
    });
    handle.child.stderr.on('data', data => { stderrBytes += data.length; });
    const result = await handle.wait(options.timeout || 60000);
    if (!result) {
      assert.ok(await handle.stop(), 'owned_child_exit_unconfirmed');
      throw new Error('owned_child_deadline');
    }
    assert.ok(!result.launchError, 'owned_node_launch_failed');
    assert.ok(!overflow, 'owned_child_output_limit');
    return { ...result, stdout, stdoutBytes, stderrBytes };
  }

  async function npm(args, cwd = work) {
    const result = await run([npmCli, ...args, '--ignore-scripts', '--no-audit', '--no-fund',
      '--offline', '--registry=https://registry.npmjs.org/', '--userconfig', userconfig,
      '--globalconfig', globalconfig, '--cache', cache, '--logs-max=0', '--update-notifier=false'], { cwd });
    assert.ok(result.code === 0 && result.signal === null,
      `local_npm_failed:exit=${result.code};signal=${result.signal};stderrBytes=${result.stderrBytes}`);
    return result;
  }
  return { root, cache, work, env, npmCli, start, run, npm,
    holdUnconfirmedAcquisition: () => { nestedExitUnconfirmed = true; } };
}

function inventory(root) {
  const entries = [];
  function scan(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const file = path.join(directory, entry.name), info = fs.lstatSync(file);
      if (info.isSymbolicLink()) entries.push([name, 'link', fs.readlinkSync(file)]);
      else if (info.isDirectory()) { entries.push([name, 'directory']); scan(file, name); }
      else {
        assert.ok(info.isFile(), 'unexpected_fixture_file_type');
        entries.push([name, 'file', hash(fs.readFileSync(file))]);
      }
    }
  }
  scan(root);
  return entries.sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

function verifyClosure(root, expectedManifest) {
  const entries = inventory(root);
  assert.ok(entries.every(([, type]) => type !== 'link'), 'package_contains_links');
  sameJSON(entries.filter(([, type]) => type === 'file').map(([name]) => name).sort(),
    packageFiles, 'package_file_closure_mismatch');
  sameJSON(entries.filter(([, type]) => type === 'directory').map(([name]) => name),
    ['payload'], 'package_directory_closure_mismatch');
  const manifestBytes = fs.readFileSync(path.join(root, 'payload-manifest.json'), 'utf8');
  const manifest = parseJSON(manifestBytes, 'invalid_payload_manifest_json');
  assert.ok(manifestBytes === `${JSON.stringify(manifest)}\n`, 'noncanonical_payload_manifest');
  const expected = { format: 'agent-continue-payload', version: 1,
    provider: { name: '@wonderwhy-er/desktop-commander', version: '0.3.1' },
    files: payloadFiles.map(name => {
      const file = path.join(root, 'payload', name), info = fs.lstatSync(file);
      assert.equal(info.nlink, 1, 'payload_not_single_link');
      const bytes = fs.readFileSync(file);
      return { path: name, bytes: bytes.length, sha256: hash(bytes) };
    }),
  };
  sameJSON(manifest, expected, 'payload_manifest_inventory_mismatch');
  if (expectedManifest) sameJSON(manifest, expectedManifest, 'installed_payload_changed');
  return manifest;
}

async function packAndInstall(t) {
  for (const name of ['bootstrap.mjs', 'bin.mjs', 'payload-layout.mjs', 'build-package.mjs']) {
    assert.ok(fs.existsSync(path.join(here, name)), 'main_modules_required_before_packed_execution');
  }
  const f = fixture(t);
  const { buildPackage } = await import(new URL('./build-package.mjs', import.meta.url));
  const packaged = path.join(f.root, 'package');
  sameJSON(buildPackage(packaged), { built: true, files: payloadFiles.length }, 'synchronous_builder_result_mismatch');
  const manifest = verifyClosure(packaged);
  const meta = parseJSON(fs.readFileSync(path.join(packaged, 'package.json'), 'utf8'), 'invalid_package_metadata');
  assert.equal(meta.name, 'agent-continue-device-bootstrap');
  assert.equal(meta.version, '0.3.0');
  assert.equal(meta.private, true);
  assert.equal(meta.type, 'module');
  sameJSON(meta.bin, { 'agent-continue-device': 'bin.mjs' }, 'package_bin_metadata_mismatch');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.keys(meta[key] || {}).length, 0, 'bootstrap_has_dependencies');
  }
  for (const key of ['bundledDependencies', 'bundleDependencies']) {
    assert.ok(meta[key] === undefined || (Array.isArray(meta[key]) && meta[key].length === 0),
      'bootstrap_has_bundled_dependencies');
  }
  assert.equal(Object.keys(meta.scripts || {}).length, 0, 'bootstrap_has_lifecycle_scripts');
  const archives = path.join(f.root, 'archives');
  fs.mkdirSync(archives);
  const packed = parseJSON((await f.npm(['pack', '--json', '--pack-destination', archives], packaged)).stdout,
    'invalid_npm_pack_json');
  assert.ok(Array.isArray(packed) && packed.length === 1, 'npm_pack_result_count');
  const record = packed[0];
  assert.ok(typeof record.filename === 'string' && path.basename(record.filename) === record.filename,
    'npm_pack_filename_outside_owned_archives');
  sameJSON(record.files.map(file => file.path).sort(), packageFiles, 'packed_file_closure_mismatch');
  assert.equal(record.entryCount, packageFiles.length);
  sameJSON(record.bundled || [], [], 'packed_bundled_dependencies');
  assert.ok(record.files.find(file => file.path === 'bin.mjs').mode & 0o111, 'packed_bin_not_executable');
  const tarball = path.join(archives, record.filename), bytes = fs.readFileSync(tarball);
  assert.ok(record.shasum === hash(bytes, 'sha1'), 'tarball_shasum_mismatch');
  assert.ok(record.integrity === `sha512-${hash(bytes, 'sha512', 'base64')}`, 'tarball_integrity_mismatch');
  const prefix = path.join(f.root, 'installed prefix \u6d4b\u8bd5');
  await f.npm(['install', '--prefix', prefix, '--no-save', '--package-lock=false', tarball]);
  const installed = path.join(prefix, 'node_modules', meta.name);
  verifyClosure(installed, manifest);
  for (const name of packageFiles) {
    assert.ok(fs.readFileSync(path.join(installed, name)).equals(fs.readFileSync(path.join(packaged, name))),
      'installed_package_bytes_changed');
  }
  const installedMeta = parseJSON(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'),
    'invalid_installed_metadata');
  sameJSON(installedMeta.bin, meta.bin, 'installed_bin_metadata_mismatch');
  const bin = path.join(installed, installedMeta.bin['agent-continue-device']);
  const shim = path.join(prefix, 'node_modules', '.bin',
    process.platform === 'win32' ? 'agent-continue-device.cmd' : 'agent-continue-device');
  assert.ok(fs.existsSync(shim), 'npm_did_not_install_bin_entry');
  if (process.platform !== 'win32') {
    assert.equal(fs.realpathSync(shim), fs.realpathSync(bin), 'installed_bin_link_mismatch');
    assert.ok(fs.statSync(bin).mode & 0o111, 'installed_bin_not_executable');
  }
  const installedAPI = await import(pathToFileURL(path.join(installed, 'bootstrap.mjs')));
  sameJSON(installedAPI.verifyPayload(installed), { files: payloadFiles.length, providerVersion: '0.3.1' },
    'installed_payload_verifier_result_mismatch');
  return { ...f, installed, bin, manifest };
}

async function command(f, args, expected, code = 0, timeout, env) {
  let result;
  try { result = await f.run([f.bin, ...args], { timeout: timeout ?? 10000, ...(env ? { env } : {}) }); }
  catch (error) {
    if (['stage', 'acquire', 'setup', 'setup-manager'].includes(args[0])) f.holdUnconfirmedAcquisition();
    throw error;
  }
  let failureCode = 'unclassified';
  try {
    const output = JSON.parse(result.stdout);
    if (output.ok === false && ['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists',
      'npm_unavailable', 'dependency_acquisition_failed', 'acquisition_exit_unconfirmed',
      'provider_verification_failed', 'receipt_write_failed', 'bootstrap_failed', 'invalid_arguments',
      'provider_stage_invalid', 'unsupported_tunnel_platform', 'client_input_invalid', 'client_exists',
      'client_acquisition_failed', 'client_archive_invalid', 'client_verification_failed', 'client_receipt_failed',
      'setup_request_invalid', 'setup_target_mismatch', 'setup_input_invalid', 'setup_configuration_failed',
      'setup_receipt_failed', 'setup_cancelled'].includes(output.error)) failureCode = output.error;
    if (output.error === 'acquisition_exit_unconfirmed') f.holdUnconfirmedAcquisition();
  } catch { /* Never include unvalidated child output in a failure message. */ }
  if (['stage', 'acquire', 'setup', 'setup-manager'].includes(args[0])) {
    const at = args.indexOf('--install-dir'), destination = args[at + 1];
    if (at > 0 && typeof destination === 'string' && path.isAbsolute(destination) && isWithin(f.root, destination)) {
      const acquisition = path.join(destination, 'acquisition');
      if (fs.existsSync(acquisition)) {
        try {
          const report = JSON.parse(fs.readFileSync(path.join(acquisition, 'process.json')));
          if (report.closeObserved !== true) f.holdUnconfirmedAcquisition();
        } catch { f.holdUnconfirmedAcquisition(); }
      }
    }
  }
  assert.ok(result.code === code && result.signal === null,
    `installed_cli_exit_mismatch:exit=${result.code};signal=${result.signal};stderrBytes=${result.stderrBytes};code=${failureCode}`);
  assert.equal(result.stderrBytes, 0, 'installed_cli_leaked_stderr');
  assert.ok(result.stdout.endsWith('\n') && result.stdout.trim().split('\n').length === 1,
    'installed_cli_not_one_json_line');
  sameJSON(parseJSON(result.stdout, 'invalid_installed_cli_json'), expected, 'installed_cli_contract_mismatch');
}

test('actual local npm tarball has exact closure and installed help/version/refusal are effect-free',
  { timeout: 300000 }, async t => {
    const f = await packAndInstall(t);
    const destination = path.join(f.root, 'must not be created \u6d4b\u8bd5');
    const before = inventory(f.root);
    await command(f, ['help'], { ok: true, commands: ['help', 'version', 'stage', 'acquire', 'setup', 'setup-server', 'setup-manager', 'install-local',
      'start-manager', 'manager-status', 'manager-control', 'manager-browser', 'enroll-ssh', 'install-plan', 'uninstall', 'register',
      'register-browser-wake', 'status', 'verify'] });
    await command(f, ['version'], { ok: true, version: '0.3.0' });
    const setupArgs = ['setup', '--install-dir', destination, '--consent', 'no',
      '--setup-request', path.join(f.root, 'missing-request'), '--tunnel-id', 'tunnel_' + 'a'.repeat(32),
      '--runtime-key-file', path.join(f.root, 'missing-key')];
    await command(f, setupArgs, { ok: false, error: 'consent_required' }, 1);
    await command(f, ['manager-browser', '--install-dir', destination, '--consent', 'no'], { ok: false, error: 'consent_required' }, 1);
    await command(f, [...setupArgs, '--setup-request', 'duplicate'], { ok: false, error: 'invalid_arguments' }, 1);
    await command(f, ['setup', '--install-dir', destination, '--consent', 'full-account'],
      { ok: false, error: 'invalid_arguments' }, 1);
    await command(f, ['acquire', '--install-dir', destination, '--consent', 'yes'], { ok: false, error: 'consent_required' }, 1);
    await command(f, ['acquire', '--install-dir', destination, '--consent', 'full-account', '--tunnel-archive', 'relative'],
      { ok: false, error: 'client_input_invalid' }, 1);
    for (const consent of [undefined, 'full-account', 'yes']) {
      await command(f, ['stage', '--install-dir', destination,
        ...(consent ? ['--consent', consent] : []), '--offline-cache', f.cache],
      { ok: false, error: consent ? 'consent_required' : 'invalid_arguments' }, 1);
      assert.equal(fs.existsSync(destination), false, 'refusal_created_destination');
    }
    await command(f, ['stage', '--install-dir', destination, '--consent', 'acquire-provider',
      '--offline-cache', f.cache, '--unknown-option'], { ok: false, error: 'invalid_arguments' }, 1);
    await command(f, ['stage', '--install-dir', 'relative', '--consent', 'acquire-provider',
      '--offline-cache', f.cache],
      { ok: false, error: 'invalid_install_path' }, 1);
    await command(f, ['stage', '--install-dir', destination, '--consent', 'acquire-provider',
      '--offline-cache', path.join(f.root, 'missing-cache')], { ok: false, error: 'invalid_install_path' }, 1);
    assert.equal(fs.existsSync(destination), false, 'invalid_options_created_destination');
    sameJSON(inventory(f.root), before, 'help_version_or_refusal_modified_owned_fixture');
    const payload = path.join(f.installed, 'payload');
    const { prepareState } = await import(pathToFileURL(path.join(payload, 'runtime.mjs')));
    const runState = path.join(f.root, 'research state');
    prepareState(runState, { consent: 'full-account' });
    const plan = path.join(f.root, 'research-plan.json'), projectId = crypto.randomUUID(), runId = crypto.randomUUID();
    const script = "console.log('packed runner output')";
    fs.writeFileSync(plan, JSON.stringify({ version: 1, projectId, runId, parentRunId: null, revision: hash(script),
      program: process.execPath, argv: ['-e', script], cwd: f.root, maxOutputBytes: 1024, review: null }), { flag: 'wx' });
    const runner = path.join(payload, 'research-runner.mjs');
    const ran = parseJSON((await f.run([runner, 'run', '--state-dir', runState, '--plan', plan], { timeout: 10000 })).stdout,
      'invalid_packed_research_run');
    assert.equal(ran.status, 'settled');
    assert.equal(ran.report.termination.exitCode, 0);
    const reloaded = parseJSON((await f.run([runner, 'status', '--state-dir', runState, '--project', projectId,
      '--run', runId], { timeout: 10000 })).stdout, 'invalid_packed_research_status');
    sameJSON(reloaded, ran, 'packed_research_receipt_mismatch');
    const commandFile = path.join(f.root, 'prepared-process.json');
    const shell = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';
    fs.writeFileSync(commandFile, JSON.stringify({ command: 'echo packed prepared command', shell, timeout_ms: 10000 }));
    const stager = path.join(payload, 'prepared-process.mjs');
    const reviewed = parseJSON((await f.run([stager, 'inspect', '--request-file', commandFile])).stdout, 'invalid_review');
    assert.equal(reviewed.staged, false);
    const staged = parseJSON((await f.run([stager, 'stage', '--state-dir', runState,
      '--request-file', commandFile, '--reviewed-sha256', reviewed.agent_continue_process_sha256])).stdout, 'invalid_stage');
    assert.equal(staged.staged, true);
    assert.equal(staged.executed, false);
    assert.ok(fs.existsSync(path.join(runState, 'prepared-processes', staged.agent_continue_operation_id + '.json')));
    t.diagnostic(JSON.stringify({ actualNpmPack: true, actualLocalTarballInstall: true,
      packedFiles: packageFiles.length, payloadFiles: payloadFiles.length,
      installedBinMetadata: true, installedHelpVersionRefusal: true, installedResearchRunner: true,
      installedPreparedProcess: true, registryPublication: false }));
  });

test('installed local package prepares a key-free manager with a test acquisition adapter and enrolls through the CLI',
  { timeout: 300000 }, async t => {
    const f = await packAndInstall(t), installDir = path.join(f.root, 'manager'), app = path.join(installDir, 'app');
    const provider = fileURLToPath(new URL('../desktop-commander/node_modules/@wonderwhy-er/desktop-commander/', import.meta.url));
    const npmDir = path.join(f.root, 'fixture-toolchain', 'npm'), npmBin = path.join(npmDir, 'bin');
    fs.mkdirSync(npmBin, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(npmDir, 'package.json'), JSON.stringify({ name: 'npm', version: '0.0.0-fixture' }));
    const npmCli = path.join(npmBin, 'npm-cli.js'), attempts = path.join(f.root, 'provider-attempts');
    fs.writeFileSync(npmCli, `const fs=require('node:fs'),path=require('node:path');
      if(process.argv[2]!=='ci'||!process.argv.includes('--ignore-scripts'))process.exit(81);
      fs.appendFileSync(${JSON.stringify(attempts)},'1');
      const source=${JSON.stringify(provider)},output=path.join(process.cwd(),'node_modules','@wonderwhy-er','desktop-commander');
      fs.mkdirSync(output,{recursive:true});
      fs.copyFileSync(path.join(source,'package.json'),path.join(output,'package.json'));
      fs.cpSync(path.join(source,'dist'),path.join(output,'dist'),{recursive:true});\n`);
    const state = path.join(installDir, 'state'), extensionId = 'b'.repeat(32);
    const targetPlatform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
    const requestFile = path.join(f.root, 'local-manager-request.json');
    const requestBytes = serializeSetupRequest(buildSetupRequest(targetPlatform, extensionId));
    fs.writeFileSync(requestFile, requestBytes, { flag: 'wx', mode: 0o600 });
    const prepared = { format: 'agent-continue-manager-setup-result', version: 1, status: 'prepared', providerVersion: '0.3.1',
      target: targetPlatform, extensionId, nativeHost: 'com.agentcontinue.device_control', requestSha256: hash(requestBytes),
      prepared: true, localTunnelConfigured: false, activated: false, authenticationVerified: false,
      nativeRegistrationVerified: false, chatAuthorizationVerified: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
    const { setupManager } = await import(pathToFileURL(path.join(f.installed, 'device-setup.mjs')));
    sameJSON(await setupManager({ installDir, consent: 'full-account', setupRequestFile: requestFile },
      { npmCli, acquisitionTimeoutMs: 10000 }), prepared, 'installed_manager_api_mismatch');
    assert.equal(fs.readFileSync(attempts, 'utf8'), '1', 'provider_not_acquired_exactly_once');
    sameJSON(JSON.parse(fs.readFileSync(path.join(installDir, 'manager-receipt.json'))), prepared, 'manager_receipt_mismatch');
    const owner = await import(pathToFileURL(path.join(app, 'device-owner.mjs')));
    const binding = owner.readNativeBinding(path.join(app, 'device-native-binding.json')); binding.assertCurrent();
    assert.equal(binding.root, state); assert.equal(binding.extensionId, extensionId);
    assert.equal(fs.existsSync(path.join(installDir, 'client')), false);
    assert.equal(fs.existsSync(path.join(installDir, 'setup-receipt.json')), false);
    assert.equal(fs.existsSync(path.join(state, 'binding.json')), false);
    const knownHosts = path.join(f.root, 'verified known hosts'), knownBytes = 'server.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly\n';
    fs.writeFileSync(knownHosts, knownBytes, { mode: 0o600 });
    const descriptor = { host: 'server.example', port: 22, user: 'researcher', node: '/usr/bin/node',
      entry: '/srv/research/app/device-server.mjs', stateRoot: '/srv/research/state', knownHosts, knownHostsSha256: hash(knownBytes) };
    const target = hash(JSON.stringify([extensionId, descriptor]));
    const args = ['enroll-ssh', '--install-dir', installDir, '--consent', 'full-account', '--ssh-executable', process.execPath,
      '--host', descriptor.host, '--port', '22', '--user', descriptor.user, '--remote-node', descriptor.node,
      '--remote-install-dir', '/srv/research', '--known-hosts', knownHosts, '--known-hosts-sha256', descriptor.knownHostsSha256];
    await command(f, args, { ok: true, format: 'agent-continue-ssh-enrollment-result', version: 1, status: 'enrolled', target,
      deviceUrl: 'chrome-extension://' + extensionId + '/devices.html?target=' + target,
      sshAuthenticationVerified: false, ownerReachabilityVerified: false, nativeRegistrationVerified: false,
      chatAuthorizationVerified: false, activated: false });
    const registry = path.join(app, 'device-ssh-targets.json'), bytes = fs.readFileSync(registry);
    owner.readSshTarget(registry, extensionId, target).assertCurrent();
    assert.equal(fs.lstatSync(registry).nlink, 1);
    await command(f, args, { ok: false, error: 'enrollment_exists' }, 1);
    assert.ok(fs.readFileSync(registry).equals(bytes), 'duplicate_cli_changed_enrolled_target');
    assert.equal(fs.existsSync(path.join(state, 'device-channel.json')), false);
    assert.equal(fs.existsSync(path.join(state, 'device-operations.jsonl')), false);
    assert.equal(fs.existsSync(path.join(state, 'tunnel.yaml')), false);
    t.diagnostic(JSON.stringify({ actualLocalTarballManagerSetup: true, actualLocalTarballEnroll: true,
      providerFixtureCopyOnly: true, localKeyRequired: false, tunnelClientAcquired: false, payloadReaderAccepted: true,
      realSsh: false, nativeRegistration: false, toolAuthorization: false }));
  });

test('outer CLI closure cannot authorize fixture deletion after an unconfirmed nested acquisition exit', async t => {
  let retained, identity;
  try {
    await t.test('retain disposable fixture on typed unconfirmed result', async inner => {
      const f = fixture(inner);
      retained = f.root; identity = fs.lstatSync(retained, { bigint: true });
      f.bin = path.join(f.work, 'synthetic-exit.mjs');
      fs.writeFileSync(f.bin, `process.stdout.write('{"ok":false,"error":"acquisition_exit_unconfirmed"}\\n');process.exitCode=1;`);
      await command(f, ['stage', '--install-dir', path.join(f.root, 'unused'), '--consent', 'acquire-provider'],
        { ok: false, error: 'acquisition_exit_unconfirmed' }, 1);
    });
    assert.equal(fs.existsSync(retained), true);
  } finally {
    // This fixture's CLI only printed a synthetic result; it spawned no npm.
    if (retained && fs.existsSync(retained)) {
      const current = fs.lstatSync(retained, { bigint: true });
      assert.equal(current.ino, identity.ino); assert.equal(current.dev, identity.dev);
      assert.equal(fs.realpathSync(retained), retained);
      assert.equal(path.dirname(retained), fs.realpathSync(os.tmpdir()));
      fs.rmSync(retained, { recursive: true, force: true });
    }
  }
});

test('actual offline npm acquisition suppresses synthetic provider installation hooks',
  { timeout: 180000 }, async t => {
    const f = fixture(t), provider = path.join(f.root, 'synthetic-provider');
    fs.mkdirSync(path.join(provider, 'dist'), { recursive: true });
    const markers = ['preinstall', 'install', 'postinstall'].map(name => path.join(f.root, `hook-${name}`));
    const scripts = Object.fromEntries(['preinstall', 'install', 'postinstall'].map((name, index) => [name,
      `node -e "require('fs').writeFileSync(${JSON.stringify(markers[index]).replaceAll('"', '\\"')},'hook-executed')"`,
    ]));
    const meta = { name: '@wonderwhy-er/desktop-commander', version: '0.3.1', scripts };
    fs.writeFileSync(path.join(provider, 'package.json'), JSON.stringify(meta) + '\n');
    fs.writeFileSync(path.join(provider, 'dist', 'index.js'), 'throw new Error("synthetic_provider_must_not_be_imported");\n');
    const packed = parseJSON((await f.npm(['pack', '--json', '--pack-destination', f.work], provider)).stdout,
      'invalid_synthetic_pack_json')[0];
    const tarball = path.join(f.work, packed.filename);
    await f.npm(['cache', 'add', tarball]);
    const lock = { name: 'synthetic-acquisition-fixture', version: '0.0.0', lockfileVersion: 3,
      packages: {
        '': { name: 'synthetic-acquisition-fixture', version: '0.0.0', dependencies: { [meta.name]: meta.version } },
        [`node_modules/${meta.name}`]: { version: meta.version, integrity: packed.integrity,
          resolved: 'https://registry.npmjs.org/@wonderwhy-er/desktop-commander/-/desktop-commander-0.3.1.tgz', hasInstallScript: true },
      } };
    const runtimeRoot = path.join(f.root, 'runtime-template');
    fs.mkdirSync(runtimeRoot);
    for (const name of payloadFiles) fs.copyFileSync(path.resolve(here, '../desktop-commander', name), path.join(runtimeRoot, name));
    const records = ['dist/index.js', 'package.json'].map(name => {
      const bytes = fs.readFileSync(path.join(provider, name));
      return [name, bytes.length, hash(bytes)];
    });
    const pin = { name: meta.name, version: meta.version, integrity: packed.integrity,
      files: records.length, treeSha256: hash(JSON.stringify(records)) };
    const runtimeMeta = { name: 'synthetic-acquisition-fixture', version: '0.0.0', private: true, type: 'module',
      dependencies: { [meta.name]: meta.version } };
    fs.writeFileSync(path.join(runtimeRoot, 'package.json'), JSON.stringify(runtimeMeta) + '\n');
    fs.writeFileSync(path.join(runtimeRoot, 'package-lock.json'), JSON.stringify(lock) + '\n');
    fs.writeFileSync(path.join(runtimeRoot, 'upstream-pin.json'), JSON.stringify(pin) + '\n');
    const { buildPackage } = await import(new URL('./build-package.mjs', import.meta.url));
    const packaged = path.join(f.root, 'synthetic-bootstrap');
    buildPackage(packaged, { runtimeRoot });
    const { stageRuntime } = await import(new URL('./bootstrap.mjs', import.meta.url));
    const installDir = path.join(f.root, 'synthetic-stage');
    const ancestorMeta = { name: 'enclosing-workspace', version: '0.0.0', private: true,
      workspaces: ['synthetic-stage/app'], dependencies: { [meta.name]: meta.version } };
    const ancestorLock = structuredClone(lock);
    ancestorLock.name = ancestorMeta.name;
    ancestorLock.packages[''] = { ...ancestorMeta };
    ancestorLock.packages['synthetic-stage/app'] = { ...runtimeMeta };
    ancestorLock.packages['node_modules/synthetic-acquisition-fixture'] = { resolved: 'synthetic-stage/app', link: true };
    fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify(ancestorMeta) + '\n');
    fs.writeFileSync(path.join(f.root, 'package-lock.json'), JSON.stringify(ancestorLock) + '\n');
    fs.writeFileSync(path.join(f.root, '.npmrc'), 'registry=https://must-not-use.invalid/\n');
    fs.mkdirSync(path.join(f.root, 'node_modules'));
    fs.writeFileSync(path.join(f.root, 'node_modules', 'preserve-sentinel'), 'unchanged');
    const outside = () => inventory(f.root).filter(([name]) =>
      !name.startsWith('synthetic-stage') && !name.startsWith('npm-cache') && !name.startsWith('temp'));
    const before = outside();
    sameJSON(await stageRuntime({ installDir, consent: 'acquire-provider', offlineCache: f.cache },
      { packageRoot: packaged, npmCli: f.npmCli }), receipt, 'synthetic_stage_receipt_mismatch');
    assert.ok(markers.every(marker => !fs.existsSync(marker)), 'acquisition_ran_installation_hook');
    sameJSON(outside(), before, 'acquisition_modified_enclosing_workspace');
    // Positive control: these harmless hooks really run when explicitly enabled.
    const control = path.join(f.root, 'hook-positive-control'); fs.mkdirSync(control);
    fs.writeFileSync(path.join(control, 'package.json'), JSON.stringify(runtimeMeta) + '\n');
    fs.writeFileSync(path.join(control, 'package-lock.json'), JSON.stringify(lock) + '\n');
    const result = await f.run([f.npmCli, 'ci', '--ignore-scripts=false', '--no-audit', '--no-fund', '--offline',
      '--cache', f.cache], { cwd: control });
    assert.ok(result.code === 0 && result.signal === null, 'synthetic_hook_positive_control_failed');
    assert.ok(markers.every(marker => fs.readFileSync(marker, 'utf8') === 'hook-executed'),
      'synthetic_hook_positive_control_not_observed');
    t.diagnostic(JSON.stringify({ actualOfflineNpmAcquisition: true, syntheticProviderOnly: true,
      suppressedInstallationHooks: 3, observedPositiveControlHooks: 3,
      enclosingWorkspacePreserved: true, realProviderAcceptance: false }));
  });

function validateRealCache(cache, ownedRoot, npmCli) {
  try { return checkedRealCache(cache, ownedRoot, npmCli); }
  catch { throw new Error('explicit_writable_populated_cache_invalid'); }
}

function checkedRealCache(cache, ownedRoot, npmCli) {
  assert.ok(typeof cache === 'string' && path.isAbsolute(cache) && !cache.startsWith('\\\\') &&
    !cache.startsWith('//'), 'explicit_cache_must_be_absolute_local');
  const resolved = path.resolve(cache);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'explicit_cache_has_redirected_ancestor');
  }
  assert.ok(fs.lstatSync(resolved).isDirectory(), 'explicit_cache_not_directory');
  assert.ok(fs.lstatSync(path.join(resolved, '_cacache')).isDirectory() &&
    !fs.lstatSync(path.join(resolved, '_cacache')).isSymbolicLink(), 'explicit_cache_missing_cacache');
  const content = path.join(resolved, '_cacache', 'content-v2');
  assert.ok(fs.lstatSync(content).isDirectory() && !fs.lstatSync(content).isSymbolicLink() &&
    fs.readdirSync(content).length > 0, 'explicit_cache_not_populated');
  for (const protectedRoot of [ownedRoot, path.resolve(here, '../..'),
    path.dirname(process.execPath), path.dirname(path.dirname(npmCli))]) {
    assert.ok(!isWithin(resolved, protectedRoot) && !isWithin(protectedRoot, resolved),
      'explicit_cache_overlaps_protected_root');
  }
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
  return resolved;
}

// Instrumentation, not an OS sandbox. No tool call below asks for process execution.
const hostGuard = `
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const report = process.env.AGENT_CONTINUE_PACKED_GUARD_LOG;
const record = event => fs.appendFileSync(report, event + '\\n');
const denied = () => { record('network-attempt'); throw new Error('test_network_forbidden'); };
globalThis.fetch = denied;
net.Socket.prototype.connect = denied;
net.connect = net.createConnection = tls.connect = denied;
http.request = http.get = https.request = https.get = denied;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  dns[key] = denied;
  if (dns.promises[key]) dns.promises[key] = denied;
}
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  cp[key] = () => { record('child-attempt'); throw new Error('test_child_forbidden'); };
}
syncBuiltinESMExports();
record('guard-loaded');
process.once('exit', () => record('guard-exit'));
`;

async function fileRoundtrip(t, f, runtime, app, preparedState) {
  const state = preparedState ?? path.join(f.root, 'private full-account fixture \u6d4b\u8bd5');
  if (!preparedState) sameJSON(runtime.prepareState(state, { consent: 'full-account' }),
    { prepared: true, activated: false, protectedInstallationVerified: false }, 'private_state_result_mismatch');
  const guard = path.join(f.root, 'host-guard.mjs'), guardLog = path.join(f.root, 'guard.log');
  fs.writeFileSync(guard, hostGuard, { flag: 'wx', mode: 0o600 });
  const launch = runtime.buildHostLaunch(state, { ...f.env, PATH: path.join(state, 'work'),
    AGENT_CONTINUE_PACKED_GUARD_LOG: guardLog });
  assert.equal(launch.command, process.execPath, 'host_must_use_trusted_node');
  assert.equal(launch.args[0], path.join(app, 'host.mjs'), 'host_must_be_staged_copy');
  for (const key of Object.keys(launch.env)) {
    assert.ok(!/^(OPENAI_|NODE_OPTIONS$|NODE_AUTH_TOKEN$|NPM_TOKEN$)/i.test(key), 'host_inherited_credentials');
  }
  const handle = f.start(['--import', pathToFileURL(guard).href, ...launch.args],
    { cwd: launch.cwd, env: launch.env, pipe: true });
  const waiting = new Map();
  let nextId = 0, buffer = '', protocolErrors = 0, stdoutBytes = 0, stderrBytes = 0, fatal = false;
  function rejectWaiting(code) {
    fatal = true;
    for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error(code)); }
    waiting.clear();
  }
  handle.child.stderr.on('data', data => { stderrBytes += data.length; });
  handle.child.stdout.setEncoding('utf8');
  handle.child.stdout.on('data', data => {
    stdoutBytes += Buffer.byteLength(data);
    if (stdoutBytes > 4 * 1024 * 1024) { rejectWaiting('host_output_limit'); return; }
    buffer += data;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let reply;
      try { reply = JSON.parse(line); }
      catch { protocolErrors++; rejectWaiting('host_invalid_json'); continue; }
      if (!reply || reply.jsonrpc !== '2.0') { protocolErrors++; rejectWaiting('host_invalid_rpc'); continue; }
      const pending = waiting.get(reply.id);
      if (pending) {
        waiting.delete(reply.id); clearTimeout(pending.timer);
        if (reply.error) pending.reject(new Error('host_rpc_error'));
        else pending.resolve(reply.result);
      }
    }
  });
  void handle.closed.then(() => rejectWaiting('host_closed'));
  function send(method, params) {
    if (fatal) return Promise.reject(new Error('host_unavailable'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('host_rpc_deadline')); }, 15000);
      waiting.set(id, { resolve, reject, timer });
      handle.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  try {
    const initialized = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'agent-continue-packed-isolated-test', version: '0.1.0' } });
    assert.equal(initialized.serverInfo.name, 'desktop-commander');
    assert.equal(initialized.serverInfo.version, '0.3.1');
    handle.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await send('tools/list', {});
    for (const name of ['write_file', 'read_file']) {
      assert.ok(listed.tools.some(tool => tool.name === name), 'file_tool_not_listed');
    }
    const ownedFile = path.join(state, 'work', 'harmless \u6d4b\u8bd5.txt');
    const content = 'AGENT_CONTINUE_PACKED_FILE_OK';
    const written = await send('tools/call', { name: 'write_file',
      arguments: { path: ownedFile, content, mode: 'rewrite' } });
    assert.ok(written?.isError !== true, 'owned_file_write_failed');
    assert.equal(fs.readFileSync(ownedFile, 'utf8'), content, 'owned_file_roundtrip_mismatch');
    const read = await send('tools/call', { name: 'read_file', arguments: { path: ownedFile, length: 10 } });
    assert.ok(read?.isError !== true && JSON.stringify(read.content).includes(content), 'owned_file_read_failed');
    handle.child.stdin.end();
    const stopped = await handle.wait(5000);
    assert.ok(stopped && stopped.code === 0 && stopped.signal === null, 'host_stdin_close_not_clean');
    assert.equal(protocolErrors, 0);
    assert.equal(buffer.trim(), '', 'host_partial_protocol_line');
    const events = fs.readFileSync(guardLog, 'utf8').trim().split('\n');
    assert.ok(events.includes('guard-loaded') && events.includes('guard-exit'), 'host_guard_not_observed');
    assert.equal(events.filter(event => event === 'network-attempt').length, 0, 'host_attempted_network');
    t.diagnostic(JSON.stringify({ realStagedHost: true, initialize: true, tools: listed.tools.length,
      ownedFileRoundtrip: true, rpcReplies: nextId, hostNetworkAttempts: 0,
      blockedHostChildAttempts: events.filter(event => event === 'child-attempt').length,
      hostChildExecutions: 0, stderrBytes, stdinCloseExit: stopped.code }));
  } finally {
    rejectWaiting('host_test_finished');
    assert.ok(await handle.stop(), 'owned_host_exit_unconfirmed');
  }
}

test('opt-in: installed tarball configures real pinned device from browser request and writable offline cache',
  { timeout: 420000, skip: realCache === undefined ?
    'AGENT_CONTINUE_REAL_CACHE absent; real installed-provider staging and MCP acceptance not executed' : false },
  async t => {
    const f = await packAndInstall(t);
    const cache = validateRealCache(realCache, f.root, f.npmCli);
    const installDir = path.join(f.root, 'staged runtime \u6d4b\u8bd5');
    let setupReceipt;
    try {
      const pins = parseJSON(fs.readFileSync(path.join(f.installed, 'payload', 'tunnel-pins.json')), 'invalid_tunnel_pins');
      const platform = process.platform + '-' + process.arch;
      const acquired = { format: 'agent-continue-device-acquisition', version: 1, status: 'acquired',
        providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', platform,
        executableSha256: pins.platforms[platform].executableSha256, configured: false, activated: false,
        protectedInstallationVerified: false, nativeDependenciesVerified: false };
      const target = { win32: 'windows', darwin: 'macos', linux: 'linux-server' }[process.platform];
      const request = buildSetupRequest(target, 'jpioilmpbolfokedaefmbfbjeaahfdkl');
      const requestBytes = serializeSetupRequest(request);
      const requestFile = path.join(f.root, 'browser-request.json'), key = path.join(f.root, 'opaque-fake-key');
      fs.writeFileSync(requestFile, requestBytes, { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(key, 'FAKE-NON-CREDENTIAL-FOR-CONFIGURATION-ONLY', { flag: 'wx', mode: 0o600 });
      setupReceipt = { format: 'agent-continue-device-setup-result', version: 1, status: 'configured',
        providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', target, extensionId: request.extensionId,
        nativeHost: request.nativeHost, requestSha256: hash(requestBytes), configured: true, activated: false,
        authenticationVerified: false, nativeRegistrationVerified: false, chatAuthorizationVerified: false,
        protectedInstallationVerified: false, nativeDependenciesVerified: false };
      await command(f, [officialClient ? 'setup' : 'stage', '--install-dir', installDir,
        '--consent', officialClient ? 'full-account' : 'acquire-provider', '--offline-cache', cache,
        ...(officialClient ? ['--setup-request', requestFile, '--tunnel-id', 'tunnel_' + 'a'.repeat(32), '--runtime-key-file', key] : []),
        ...(officialArchive !== undefined ? ['--tunnel-archive', officialArchive] : [])],
      { ok: true, ...(officialClient ? setupReceipt : receipt) }, 0, officialClient ? 280000 : 195000);
      if (officialClient) {
        const client = path.join(installDir, 'client'), pin = pins.platforms[platform];
        sameJSON(parseJSON(fs.readFileSync(path.join(client, 'receipt.json'))), acquired, 'client_receipt_mismatch');
        const executable = process.platform === 'win32' ? 'tunnel-client-runtime.exe' : 'tunnel-client-runtime';
        assert.equal(hash(fs.readFileSync(path.join(client, executable))), pin.executableSha256);
        assert.equal(hash(fs.readFileSync(path.join(client, 'release.zip'))), pin.archiveSha256);
        assert.equal(hash(fs.readFileSync(path.join(client, pin.asset.slice(0, -4) + '.spdx.json'))), pin.spdxSha256);
        for (const name of ['LICENSE', 'NOTICE', pin.asset.slice(0, -4) + '-licenses.txt']) {
          assert.ok(fs.statSync(path.join(client, name)).size > 0);
        }
        assert.equal(fs.existsSync(path.join(client, 'tunnel.yaml')), false);
        const state = path.join(installDir, 'state');
        assert.equal(fs.readFileSync(path.join(installDir, 'setup-receipt.json'), 'utf8'), JSON.stringify(setupReceipt) + '\n');
        const profile = await import(pathToFileURL(path.join(installDir, 'app', 'profile.mjs')));
        sameJSON(profile.inspectTunnelProfile(state),
          { configured: true, activation: 'not-observed', authenticationVerified: false }, 'installed_profile_inspection_mismatch');
        const document = parseJSON(fs.readFileSync(path.join(state, 'tunnel.yaml')));
        assert.equal(document.control_plane.base_url, 'https://api.openai.com');
        assert.equal(document.control_plane.api_key, 'file:' + key);
        assert.equal(fs.existsSync(path.join(state, 'health.url')), false);
        const nativeBinding = path.join(installDir, 'app', 'device-native-binding.json');
        if (request.nativeHost === null) assert.equal(fs.existsSync(nativeBinding), false);
        else {
          const { readNativeBinding } = await import(pathToFileURL(path.join(installDir, 'app', 'device-owner.mjs')).href);
          const prepared = readNativeBinding(nativeBinding);
          assert.equal(prepared.extensionId, request.extensionId); assert.equal(prepared.root, state); prepared.assertCurrent();
        }
        for (const name of ['device-channel.json', 'device-operations.jsonl', 'device-operations.lease', 'controller.lease']) {
          assert.equal(fs.existsSync(path.join(state, name)), false);
        }
        t.diagnostic(JSON.stringify({ actualInstalledBinSetup: true, realBrowserProducer: true,
          keyContentsNotNeededForConfiguration: true, ...setupReceipt }));
      } else t.diagnostic('Official client opt-in absent: real-client acquisition not executed');
    } catch (error) {
      const logs = path.join(installDir, 'acquisition', 'logs');
      let bytes = 0, logCount = 0, lastPhase = 'none', npmExit = null, npmOk = false, exitHandlerNeverCalled = false;
      const codes = new Set();
      if (fs.existsSync(logs)) for (const name of fs.readdirSync(logs)) {
        const file = path.join(logs, name), stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) continue;
        const text = fs.readFileSync(file, 'utf8'); bytes += stat.size; logCount++;
        const exit = [...text.matchAll(/\bverbose exit (-?\d+)/g)].at(-1);
        if (exit) npmExit = Number(exit[1]);
        npmOk ||= /\binfo ok\b/.test(text);
        exitHandlerNeverCalled ||= text.includes('Exit handler never called');
        let last = -1;
        for (const phase of ['idealTree', 'reify', 'tarball', 'fetch', 'exit']) {
          const at = text.lastIndexOf(phase); if (at > last) { last = at; lastPhase = phase; }
        }
        for (const code of ['EINTEGRITY', 'ENOTCACHED', 'ENOENT', 'EPERM', 'ETIMEDOUT', 'EACCES', 'EBUSY', 'ECONNRESET']) {
          if (text.includes(code)) codes.add(code);
        }
      }
      const modules = path.join(installDir, 'app', 'node_modules');
      const provider = path.join(modules, '@wonderwhy-er', 'desktop-commander', 'package.json');
      const npmVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(f.npmCli)), 'package.json'))).version;
      const reportFile = path.join(installDir, 'acquisition', 'process.json');
      const processReport = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : {};
      const flags = {};
      for (const key of ['exitObserved', 'closeObserved']) if (typeof processReport[key] === 'boolean') flags[key] = processReport[key];
      for (const key of ['exitCode', 'closeCode', 'durationMs']) if (Number.isInteger(processReport[key])) flags[key] = processReport[key];
      if (['deadline', 'cancelled', null].includes(processReport.cancelReason)) flags.cancelReason = processReport.cancelReason;
      t.diagnostic(JSON.stringify({ failureOnlyAcquisition: true, nodeVersion: process.version, npmVersion,
        logCount, bytes, lastPhase, errorCodes: [...codes].sort(), npmExit, npmOk, exitHandlerNeverCalled,
        ...flags,
        moduleEntries: fs.existsSync(modules) ? fs.readdirSync(modules).length : 0,
        providerMetadataPresent: fs.existsSync(provider) }));
      throw error;
    }
    sameJSON(parseJSON(fs.readFileSync(path.join(installDir, 'receipt.json'), 'utf8'), 'invalid_receipt_json'),
      receipt, 'real_acquisition_receipt_mismatch');
    const app = path.join(installDir, 'app');
    for (const entry of f.manifest.files) {
      assert.ok(hash(fs.readFileSync(path.join(app, entry.path))) === entry.sha256,
        'staged_payload_hash_mismatch');
    }
    assert.equal(fs.existsSync(path.join(app, '.npmrc')), false, 'ambient_npmrc_in_staged_app');
    assert.equal(fs.existsSync(path.join(app, 'consent.json')), false, 'acquisition_configured_runtime');
    const runtime = await import(pathToFileURL(path.join(app, 'runtime.mjs')));
    const pin = parseJSON(fs.readFileSync(path.join(app, 'upstream-pin.json'), 'utf8'), 'invalid_staged_pin');
    assert.ok(Number.isInteger(pin.files) && pin.files > 0, 'invalid_staged_inventory_count');
    sameJSON(runtime.verifyUpstream(), { version: '0.3.1', verifiedFiles: pin.files },
      'real_provider_inventory_mismatch');
    t.diagnostic(JSON.stringify({ actualInstalledBinOfflineStage: true, providerVersion: '0.3.1',
      verifiedFiles: pin.files, deliberatelyWritableSelectedCache: true, ...receipt }));
    await t.test('bounded actual staged MCP initialize/list/owned-file roundtrip',
      { timeout: 75000 },
      async child => fileRoundtrip(child, f, runtime, app, officialClient ? path.join(installDir, 'state') : undefined));
  });

test('packed tarball carries the registration modules and runs status/verify read-only',
  { timeout: 300000 }, async t => {
    const f = await packAndInstall(t);
    const load = name => import(pathToFileURL(path.join(f.installed, name)));
    const expected = {
      'registration-status.mjs': ['STATUS_FORMAT', 'VERIFY_FORMAT', 'buildRegistrationStatus',
        'executeStatusCommand', 'renderStatusJson', 'renderStatusText', 'renderVerifyJson',
        'renderVerifyText', 'statusFromReport'],
      'registration-status-view.mjs': ['BINDING_STATES', 'REGISTERED_STATES', 'STATUS_FORMAT',
        'STATUS_VIEW_FORMAT', 'buildStatusView', 'buildUnknownStatusView', 'resolveStatusView'],
      'registration-guidance.mjs': ['buildFirstInstallGuidance', 'buildPendingFirstInstallGuidance'],
      'registration-render.mjs': ['renderRegistrationDisplay'],
    };
    for (const [name, exports] of Object.entries(expected)) {
      sameJSON(Object.keys(await load(name)).sort(), [...exports].sort(), `packed_${name}_exports_mismatch`);
    }
    const root = path.join(f.root, 'packed precheck root'), app = path.join(root, 'app');
    const state = path.join(root, 'state');
    fs.mkdirSync(app, { recursive: true }); fs.mkdirSync(state, { recursive: true });
    const extensionId = 'c'.repeat(32);
    fs.writeFileSync(path.join(app, 'device-native-binding.json'), JSON.stringify({
      format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: state }) + '\n');
    const marker = fs.readFileSync(path.join(app, 'device-native-binding.json'));
    fs.writeFileSync(path.join(root, 'payload-manifest.json'), JSON.stringify({ format: 'agent-continue-payload', version: 1,
      files: [{ path: 'device-native-binding.json', bytes: marker.length, sha256: hash(marker) }] }) + '\n');
    fs.writeFileSync(path.join(root, 'native-host.json'), JSON.stringify({
      name: 'com.agentcontinue.device_control', description: 'Agent Continue device lifecycle bridge',
      path: path.join(app, 'device-native-host.mjs'), type: 'stdio',
      allowed_origins: ['chrome-extension://' + extensionId + '/'] }) + '\n');
    const queries = [];
    const registry = { get: plan => { queries.push(plan.hive + '/' + plan.view); return null; } };
    const stub = () => ({ ok: true, reason: 'syntax stubbed for the packed read-only probe' });
    const deps = { registry, verifySyntax: stub };
    const statusApi = await load('registration-status.mjs');
    const status = statusApi.executeStatusCommand(['status', '--install-dir', root, '--json'], deps);
    assert.equal(status.exitCode, 0, 'packed_status_exit');
    const statusReport = parseJSON(status.output, 'packed_status_invalid_json');
    assert.equal(statusReport.format, 'agent-continue-registration-status', 'packed_status_format');
    assert.equal(statusReport.registered, 'not-registered', 'packed_status_registry_state');
    assert.equal(queries.length, 4, 'packed_status_registry_queries');
    const verify = statusApi.executeStatusCommand(['verify', '--install-dir', root, '--json'], deps);
    assert.equal(verify.exitCode, 0, 'packed_verify_exit_on_consistent_root');
    assert.equal(parseJSON(verify.output, 'packed_verify_invalid_json').format,
      'agent-continue-registration-verify', 'packed_verify_format');
    const binStatus = await f.run([f.bin, 'status', '--install-dir', root, '--json'], { timeout: 60000 });
    assert.equal(binStatus.code, 0, 'packed_bin_status_exit');
    assert.equal(binStatus.signal, null);
    assert.equal(binStatus.stderrBytes, 0, 'packed_bin_status_stderr');
    const binReport = parseJSON(binStatus.stdout, 'packed_bin_status_invalid_json');
    assert.equal(binReport.format, 'agent-continue-registration-status', 'packed_bin_status_format');
    for (const key of ['root', 'installed', 'binding', 'registered', 'hostStartable', 'failed', 'counts']) {
      assert.ok(Object.hasOwn(binReport, key), `packed_bin_status_missing_${key}`);
    }
    const binVerify = await f.run([f.bin, 'verify', '--install-dir', root, '--json'], { timeout: 60000 });
    assert.equal(binVerify.code, 1, 'packed_bin_verify_exit_on_empty_root');
    assert.equal(binVerify.stderrBytes, 0, 'packed_bin_verify_stderr');
    assert.equal(parseJSON(binVerify.stdout, 'packed_bin_verify_invalid_json').format,
      'agent-continue-registration-verify', 'packed_bin_verify_format');
    t.diagnostic(JSON.stringify({ packedRegistrationModules: 4, packedStatusExit: status.exitCode,
      packedVerifyExit: verify.exitCode, packedBinStatusExit: binStatus.code,
      packedBinVerifyExit: binVerify.code, registryWrites: 0 }));
  });
