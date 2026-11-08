import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../native/bootstrap/install.ps1', import.meta.url));
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const options = { skip: process.platform !== 'win32', timeout: 30000 };

function dispatch(t, kind = 'verified') {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'ac-adoption-dispatch-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const release = path.join(root, 'release'), install = path.join(root, 'installed');
  const temp = path.join(root, 'temp'), payload = path.join(root, 'payload');
  for (const dir of [release, install, temp, payload]) fs.mkdirSync(dir);
  fs.copyFileSync(source, path.join(release, 'install.ps1'));
  const manifest = '{"fixture":"inert read-only inspector"}';
  const extension = 'a'.repeat(32);
  // Only the inspection command exists. Any attempted installation fails.
  const entry = `import fs from 'node:fs';
import crypto from 'node:crypto';
if (process.argv[2] !== 'browser-install-status' || process.argv.length !== 7 ||
    process.argv[3] !== '--install-dir' || process.argv[5] !== '--extension-id') process.exit(73);
const extensionId = process.argv[6];
const payloadManifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(new URL('./payload-manifest.json', import.meta.url))).digest('hex');
console.log(JSON.stringify({ok:true,action:'existing-install',mode:'browser-managed',status:'existing-matched',reason:'verified',
extensionId,payloadManifestSha256,configuration:'verified',registration:'matched',runtime:'not-observed',mutationPerformed:false,
chatAuthorizationVerified:false,next:'open-devices',devicesUrl:'chrome-extension://'+extensionId+'/devices.html?mode=browser-managed'}));
${kind === 'failed-child' ? 'process.exit(1);' : ''}
`;
  fs.writeFileSync(path.join(payload, 'bin.mjs'), entry);
  fs.writeFileSync(path.join(payload, 'payload-manifest.json'), manifest);
  const sums = `${hash(entry)}  bin.mjs\n${hash(manifest)}  payload-manifest.json\n`;
  fs.writeFileSync(path.join(root, 'prepare.ps1'), `
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=${quote(path.join(release, 'agent-continue-setup.zip'))}
[IO.Compression.ZipFile]::CreateFromDirectory(${quote(payload)},$archive)
$sums=${quote(sums)}+((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()+'  agent-continue-setup.zip'+[Environment]::NewLine)
[IO.File]::WriteAllText(${quote(path.join(release, 'SHA256SUMS.txt'))},$sums,[Text.Encoding]::ASCII)
`, 'utf8');
  const env = { ...process.env, TEMP: temp, TMP: temp,
    PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') };
  const preparation = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'prepare.ps1')], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, env,
  });
  assert.ifError(preparation.error);
  assert.equal(preparation.status, 0, preparation.stdout + preparation.stderr);
  if (kind === 'tampered') fs.appendFileSync(path.join(release, 'agent-continue-setup.zip'), 'tamper');
  if (kind === 'missing') fs.unlinkSync(path.join(release, 'agent-continue-setup.zip'));
  fs.writeFileSync(path.join(install, 'lifecycle.json'), '{"paused":true,"revoked":true}');
  const before = fs.readFileSync(path.join(install, 'lifecycle.json'), 'utf8');
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(release, 'install.ps1'),
    '-InstallLocal', '-BrowserManaged', '-PromptForConnection', '-Consent', 'accept-install',
    '-InstallDir', install, '-ExtensionId', extension, '-NodePath', process.execPath], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, env,
  });
  assert.ifError(result.error);
  assert.equal(fs.readFileSync(path.join(install, 'lifecycle.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(install), ['lifecycle.json']);
  assert.deepEqual(fs.readdirSync(temp), [], 'verified inspection scratch must be cleaned');
  assert.ok(result.stdout.trim(), result.stderr || 'parent returned no result');
  const row = JSON.parse(result.stdout.trim());
  assert.equal(row.mutationPerformed, false);
  assert.equal(row.runtime, 'not-observed');
  assert.equal(row.chatAuthorizationVerified, false);
  return { result, row };
}

test('real parent dispatcher adopts archive-only local release without prompts or installation mutation', options, t => {
  const { result, row } = dispatch(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(row.status, 'existing-matched');
  assert.equal(row.registration, 'matched');
});

for (const kind of ['tampered', 'missing', 'failed-child']) {
  test(`archive-only adoption ${kind} remains unconfirmed without repair or replay`, options, t => {
    const { result, row } = dispatch(t, kind);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(row.status, 'existing-unconfirmed');
    assert.equal(row.devicesUrl, null);
  });
}
