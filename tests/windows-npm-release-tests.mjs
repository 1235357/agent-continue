import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { windowsSetup } from '../cli.mjs';
import { metadataFromBuildReceipt, validateWindowsRelease, buildWindowsCommandPlan } from '../native/bootstrap/windows-release.mjs';
import { prepareNpmPayload, prepareCompatibilityPayload, copyNativeReleaseSnapshot } from '../scripts/prepare-npm-payload.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['agent-continue-setup.zip', 'install.ps1', 'install-administrator.ps1',
  'Stage-WindowsAdministratorBundle.ps1', 'agent-continue-windows-administrator-x64.zip', 'SHA256SUMS.txt'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assignment = (name, value) => `$script:${name} = '${value}'\n`;

function fixture(t) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'ac-windows-npm-fixture-'));
  t.after(() => {
    const relative = path.relative(temporary, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const releaseDirectory = path.join(root, 'combined'), bootstrapRoot = path.join(root, 'bootstrap');
  fs.mkdirSync(releaseDirectory); fs.mkdirSync(bootstrapRoot);
  // Opaque inert archive bytes: tests exercise transfer of builder-attested hashes,
  // not ZIP decoding, real administrator inventory, installation or execution.
  const bytes = {
    'agent-continue-setup.zip': Buffer.from('synthetic source archive, never extracted'),
    'agent-continue-windows-administrator-x64.zip': Buffer.from('synthetic runtime archive, never executed'),
    'Stage-WindowsAdministratorBundle.ps1': Buffer.from('# synthetic stager, never executed\n'),
  };
  bytes['install-administrator.ps1'] = Buffer.from(assignment('acReleaseTag', 'v3.0.0') +
    assignment('acAdministratorBundleSha256', hash(bytes[names[4]])) +
    assignment('acAdministratorStagerSha256', hash(bytes[names[3]])));
  bytes['install.ps1'] = Buffer.from(assignment('acReleaseTag', 'v3.0.0') +
    assignment('acAdministratorInstallerSha256', hash(bytes[names[2]])));
  const sources = { 'bin.mjs': Buffer.from('// synthetic source\n'),
    'payload-manifest.json': Buffer.from('{"synthetic":true}\n') };
  bytes['SHA256SUMS.txt'] = Buffer.from(Object.entries({ ...sources, ...bytes })
    .map(([name, data]) => `${hash(data)}  ${name}\n`).join(''));
  for (const [name, data] of Object.entries(bytes)) fs.writeFileSync(path.join(releaseDirectory, name), data);
  const receipt = { built: true, combinedBuilt: true, deliveryContract: 'combined-public', releaseTag: 'v3.0.0',
    installed: false, published: false, administratorBundleVerified: true, administratorStagerPlan: true,
    sha256: hash(bytes[names[0]]), administratorBundleSha256: hash(bytes[names[4]]),
    assets: Object.fromEntries(names.map(name => [name, hash(bytes[name])])) };
  const prepare = extra => prepareNpmPayload({ releaseDirectory, buildReceipt: receipt, bootstrapRoot,
    releaseVersion: '3.0.0', ...extra });
  return { root, releaseDirectory, bootstrapRoot, bytes, receipt, prepare,
    generated: path.join(bootstrapRoot, 'windows-release') };
}

test('requires an explicit completed public combined input and preserves legacy helper export', t => {
  const f = fixture(t);
  assert.equal(typeof copyNativeReleaseSnapshot, 'function');
  assert.throws(() => prepareNpmPayload({ bootstrapRoot: f.bootstrapRoot, releaseVersion: '3.0.0' }), /combined_release_directory_required/);
  assert.throws(() => f.prepare({ buildReceipt: undefined }), /combined_release_receipt_required/);
  assert.deepEqual(fs.readdirSync(f.bootstrapRoot), []);
});

test('compatibility source payload is rebuilt and verified without shipping a custom executable', t => {
  const f = fixture(t);
  const result = prepareCompatibilityPayload(f.bootstrapRoot);
  assert.equal(result.files, 21);
  const names = fs.readdirSync(path.join(f.bootstrapRoot, 'payload'));
  assert.equal(names.length, 21);
  assert.equal(names.some(name => /\.(exe|msi)$/i.test(name)), false);
  assert.equal(fs.existsSync(path.join(f.bootstrapRoot, 'packaged-native-release')), false);
  const before = fs.readFileSync(path.join(f.bootstrapRoot, 'payload-manifest.json'));
  prepareCompatibilityPayload(f.bootstrapRoot);
  assert.deepEqual(fs.readFileSync(path.join(f.bootstrapRoot, 'payload-manifest.json')), before);
  fs.writeFileSync(path.join(f.bootstrapRoot, 'payload', 'private.txt'), 'preserve');
  assert.throws(() => prepareCompatibilityPayload(f.bootstrapRoot), /unexpected_generated_payload_entry/);
  assert.equal(fs.readFileSync(path.join(f.bootstrapRoot, 'payload', 'private.txt'), 'utf8'), 'preserve');
});

test('one-command dispatch launches one fixed plan and never promotes child exit to chat authorization', async t => {
  const f = fixture(t); f.prepare();
  const argv = ['--account', 'administrator', '--extension-id', 'a'.repeat(32),
    '--consent', 'accept-administrator-browser-installation'];
  let calls = 0;
  const execute = (file, args, options) => {
    calls++;
    assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(args.includes('-Administrator'), true);
    assert.equal(options.shell, false);
    assert.equal(options.stdio, 'inherit');
    return { status: 0, signal: null };
  };
  assert.deepEqual(await windowsSetup(argv, { platform: 'win32', interactive: true, releaseRoot: f.generated, execute }),
    { ok: true, installerExited: true, account: 'administrator', chatAuthorizationVerified: false });
  assert.equal(calls, 1);
  const failed = await windowsSetup(argv, { platform: 'win32', interactive: true, releaseRoot: f.generated,
    execute() { calls++; return { status: 2, signal: null }; } });
  assert.deepEqual(failed, { ok: false, error: 'windows_installer_failed', installerExitCode: 2 });
  for (const result of [{ status: null, signal: 'SIGTERM' }, { error: { code: 'ETIMEDOUT' } }, { status: null }]) {
    let attempts = 0;
    await assert.rejects(windowsSetup(argv, { platform: 'win32', interactive: true, releaseRoot: f.generated,
      execute() { attempts++; return result; } }), /windows_install_unconfirmed/);
    assert.equal(attempts, 1);
  }
  assert.equal(calls, 2);
});

test('stages exactly six pinned assets plus minimal metadata without touching old generated payload', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.bootstrapRoot, 'payload'));
  fs.writeFileSync(path.join(f.bootstrapRoot, 'payload', 'keep.txt'), 'old payload must not change');
  fs.mkdirSync(path.join(f.bootstrapRoot, 'packaged-native-release'));
  fs.writeFileSync(path.join(f.bootstrapRoot, 'packaged-native-release', 'keep.txt'), 'legacy must not change');
  const result = f.prepare();
  assert.equal(result.prepared, true);
  assert.equal(result.installed, false); assert.equal(result.published, false);
  assert.deepEqual(fs.readdirSync(f.generated).sort(), [...names, 'release.json'].sort());
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(f.generated, name)), f.bytes[name]);
  const metadata = JSON.parse(fs.readFileSync(path.join(f.generated, 'release.json')));
  assert.deepEqual(Object.keys(metadata).sort(), ['format', 'version', 'deliveryContract', 'releaseTag', 'assets'].sort());
  assert.equal(metadata.releaseTag, 'v3.0.0');
  assert.deepEqual(metadata.assets, f.receipt.assets);
  assert.deepEqual(validateWindowsRelease(f.generated), metadata);
  assert.deepEqual(f.prepare(), result, 'identical repeat validates without rewriting');
  assert.equal(fs.readFileSync(path.join(f.bootstrapRoot, 'payload', 'keep.txt'), 'utf8'), 'old payload must not change');
  assert.equal(fs.readFileSync(path.join(f.bootstrapRoot, 'packaged-native-release', 'keep.txt'), 'utf8'), 'legacy must not change');
});

for (const change of [{ deliveryContract: 'windows-preview' }, { deliveryContract: 'current-account-source-only' },
  { combinedBuilt: false }, { built: false }, { administratorBundleVerified: false }, { administratorStagerPlan: false },
  { releaseTag: 'v3.0.0-preview' }, { releaseTag: 'v2.2.1' }, { installed: true }, { published: true }]) {
  test(`rejects non-public or incomplete build receipt ${JSON.stringify(change)}`, t => {
    const f = fixture(t);
    assert.throws(() => f.prepare({ buildReceipt: { ...f.receipt, ...change } }), /invalid_combined_release_receipt/);
    assert.equal(fs.existsSync(f.generated), false);
  });
}

for (const name of names) {
  for (const mutation of ['missing', 'tampered', 'directory', 'hardlink']) {
    test(`rejects ${mutation} input asset ${name} before generating anything`, t => {
      const f = fixture(t), file = path.join(f.releaseDirectory, name);
      if (mutation === 'tampered') fs.appendFileSync(file, 'changed');
      else {
        fs.unlinkSync(file);
        if (mutation === 'directory') fs.mkdirSync(file);
        if (mutation === 'hardlink') {
          const other = path.join(f.root, 'linked-input'); fs.writeFileSync(other, f.bytes[name]); fs.linkSync(other, file);
        }
      }
      assert.throws(() => f.prepare(), /windows_release_/);
      assert.equal(fs.existsSync(f.generated), false);
    });
  }
}

test('rejects missing, malformed and extra pins, extra files, and unsafe checksum paths', t => {
  const f = fixture(t);
  for (const assets of [{ ...f.receipt.assets, [names[0]]: 'f'.repeat(64) },
    { ...f.receipt.assets, extra: 'f'.repeat(64) }, { ...f.receipt.assets, [names[0]]: null }]) {
    assert.throws(() => f.prepare({ buildReceipt: { ...f.receipt, assets } }), /invalid_combined_release_receipt|windows_release_digest/);
  }
  const missing = { ...f.receipt.assets }; delete missing[names[0]];
  assert.throws(() => f.prepare({ buildReceipt: { ...f.receipt, assets: missing } }), /invalid_combined_release_receipt/);
  fs.writeFileSync(path.join(f.releaseDirectory, 'native-launcher.exe'), 'retired launcher');
  assert.throws(() => f.prepare(), /windows_release_inventory/);
  fs.unlinkSync(path.join(f.releaseDirectory, 'native-launcher.exe'));
  for (const name of ['../escape', 'payload/CON.txt', 'payload/key.pem', 'payload//double', 'custom.exe']) {
    const sums = Buffer.concat([f.bytes['SHA256SUMS.txt'], Buffer.from(`${'0'.repeat(64)}  ${name}\n`)]);
    fs.writeFileSync(path.join(f.releaseDirectory, 'SHA256SUMS.txt'), sums);
    assert.throws(() => f.prepare({ buildReceipt: { ...f.receipt,
      assets: { ...f.receipt.assets, 'SHA256SUMS.txt': hash(sums) } } }), /windows_release_checksums/);
  }
  assert.equal(fs.existsSync(f.generated), false);
});

test('sidecar pins must agree even if every top-level asset hash is recomputed', t => {
  const f = fixture(t);
  const parent = Buffer.from(assignment('acReleaseTag', 'v3.0.0') + assignment('acAdministratorInstallerSha256', '0'.repeat(64)));
  fs.writeFileSync(path.join(f.releaseDirectory, 'install.ps1'), parent);
  const sums = Buffer.from(f.bytes['SHA256SUMS.txt'].toString().replace(hash(f.bytes['install.ps1']), hash(parent)));
  fs.writeFileSync(path.join(f.releaseDirectory, 'SHA256SUMS.txt'), sums);
  assert.throws(() => f.prepare({ buildReceipt: { ...f.receipt, assets: { ...f.receipt.assets,
    'install.ps1': hash(parent), 'SHA256SUMS.txt': hash(sums) } } }), /windows_release_pin/);
});

test('refuses redirected source/target ancestors and existing invalid generated files', t => {
  const f = fixture(t), alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.releaseDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.prepare({ releaseDirectory: alias }), /windows_release_path/);
  fs.unlinkSync(alias);
  fs.symlinkSync(f.bootstrapRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.prepare({ bootstrapRoot: alias }), /windows_release_path/);
  assert.throws(() => f.prepare({ releaseDirectory: path.join(f.releaseDirectory, '..', 'combined', '.') + path.sep + '..' }), /windows_release_/);
  f.prepare();
  const before = fs.readFileSync(path.join(f.generated, 'install.ps1'));
  fs.writeFileSync(path.join(f.generated, 'extra.txt'), 'preserve unknown files');
  assert.throws(() => f.prepare(), /windows_release_inventory/);
  assert.deepEqual(fs.readFileSync(path.join(f.generated, 'install.ps1')), before);
});

test('packaged validation rejects altered metadata or changed assets', t => {
  const f = fixture(t); f.prepare();
  fs.appendFileSync(path.join(f.generated, 'install.ps1'), 'changed');
  assert.throws(() => validateWindowsRelease(f.generated), /windows_release_digest/);
  fs.writeFileSync(path.join(f.generated, 'install.ps1'), f.bytes['install.ps1']);
  const meta = path.join(f.generated, 'release.json'), original = fs.readFileSync(meta);
  fs.writeFileSync(meta, original.toString().replace('combined-public', 'windows-preview'));
  assert.throws(() => validateWindowsRelease(f.generated), /windows_release_metadata/);
});

test('guided command plan uses only fixed executable, packaged installer and current-account flags', t => {
  const f = fixture(t); f.prepare();
  const plan = buildWindowsCommandPlan({ releaseRoot: f.generated, account: 'current',
    extensionId: 'a'.repeat(32), consent: 'accept-install' });
  assert.equal(plan.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(plan.args, ['-NoLogo', '-NoProfile', '-File', path.join(f.generated, 'install.ps1'),
    '-InstallLocal', '-BrowserManaged', '-Consent', 'accept-install', '-PromptForConnection', '-ExtensionId', 'a'.repeat(32)]);
  assert.equal(plan.options.shell, false);
  assert.equal(plan.options.cwd, f.generated);
  assert.equal(plan.options.stdio, 'inherit');
  assert.equal(plan.options.windowsHide, false);
  assert.equal(Object.hasOwn(plan.options, 'env'), false);
});

test('administrator guided command binds optional setup ID without request/tunnel/key CLI arguments', t => {
  const f = fixture(t); f.prepare();
  const input = { releaseRoot: f.generated, account: 'administrator', extensionId: 'a'.repeat(32),
    setupId: 'b'.repeat(32), consent: 'accept-administrator-browser-installation' };
  const plan = buildWindowsCommandPlan(input);
  assert.deepEqual(plan.args, ['-NoLogo', '-NoProfile', '-File', path.join(f.generated, 'install.ps1'),
    '-Administrator', '-Apply', '-Consent', input.consent, '-PromptForConnection',
    '-ExtensionId', input.extensionId, '-BrowserSetupId', input.setupId]);
  delete input.setupId;
  assert.ok(!buildWindowsCommandPlan(input).args.includes('-BrowserSetupId'));
});

for (const change of [{ account: 'root' }, { account: 'Administrator' }, { extensionId: 'z'.repeat(32) },
  { consent: '' }, { consent: 'accept-administrator-browser-installation' }, { setupId: 'a'.repeat(32) },
  { setupRequest: 'anything.json' }, { runtimeKey: 'must-not-accept' }, { tunnelId: 'tunnel_any' },
  { installer: 'other.ps1' }, { file: 'cmd.exe' }, { env: {} }, { shell: true }, { args: [] }]) {
  test(`rejects unsupported command fields ${JSON.stringify(change)}`, t => {
    const f = fixture(t); f.prepare();
    assert.throws(() => buildWindowsCommandPlan({ releaseRoot: f.generated, account: 'current',
      extensionId: 'a'.repeat(32), consent: 'accept-install', ...change }), /windows_release_/);
  });
}

test('never falls back to environment, PATH or an unstaged installer', t => {
  const f = fixture(t); f.prepare();
  const input = { releaseRoot: f.generated, account: 'current', extensionId: 'a'.repeat(32), consent: 'accept-install' };
  assert.throws(() => buildWindowsCommandPlan({ ...input, releaseRoot: undefined }), /windows_release_path/);
  fs.unlinkSync(path.join(f.generated, 'install.ps1'));
  assert.throws(() => buildWindowsCommandPlan(input), /windows_release_inventory/);
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts', 'prepare-npm-payload.mjs')],
    { encoding: 'utf8', cwd: f.root, env: { ...process.env, AGENT_CONTINUE_WINDOWS_RELEASE_DIR: '',
      AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT: '', AGENT_CONTINUE_PAYLOAD_BASE: f.releaseDirectory } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /combined_release_directory_required/);
});
