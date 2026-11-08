import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
export const setupId = 'a'.repeat(32);
export const releaseVersion = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url))).version;
const releaseTag = 'v' + releaseVersion;
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const assetNames = ['agent-continue-setup.zip', 'install.ps1', 'install-administrator.ps1',
  'Stage-WindowsAdministratorBundle.ps1', 'agent-continue-windows-administrator-x64.zip', 'SHA256SUMS.txt'];
// Inert test identity only. No URL in these fixtures is fetched or evidence of publication.
export const entryUrl = 'https://github.com/1235357/agent-continue/releases/download/' + releaseTag + '/install.ps1';
export const entryBytes = Buffer.from(`$script:acReleaseTag = '${releaseTag}'\n# Inert fixture; never execute an installer.\n`);
export const sumsBytes = Buffer.from(`${hash(entryBytes)}  install.ps1\n`);
export const descriptor = (extra = {}) => ({ format: 'agent-continue-windows-setup-entry', version: 1,
  releaseTag, entryUrl, entrySha256: hash(entryBytes), sumsSha256: hash(sumsBytes), ...extra });

export function snapshotFiles(files) {
  return Object.fromEntries(files.map(file => {
    try { return [file, { exists: true, sha256: hash(fs.readFileSync(file)) }]; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return [file, { exists: false }];
    }
  }));
}

export function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true }).sort().map(name => {
    const file = path.join(root, name);
    return [name, fs.statSync(file).isDirectory() ? 'directory' : hash(fs.readFileSync(file))];
  }));
}

export function combinedFixture(t) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'ac-entry-contract-'));
  t.after(() => {
    const relative = path.relative(temporary, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'combined');
  fs.mkdirSync(directory);
  const assignment = (name, value) => `$script:${name} = '${value}'\n`;
  const bytes = {
    'agent-continue-setup.zip': Buffer.from('opaque inert setup archive; no extraction'),
    'agent-continue-windows-administrator-x64.zip': Buffer.from('opaque inert administrator archive; no execution'),
    'Stage-WindowsAdministratorBundle.ps1': Buffer.from('# inert stager\n'),
  };
  bytes['install-administrator.ps1'] = Buffer.from(assignment('acReleaseTag', releaseTag) +
    assignment('acAdministratorBundleSha256', hash(bytes[assetNames[4]])) +
    assignment('acAdministratorStagerSha256', hash(bytes[assetNames[3]])));
  bytes['install.ps1'] = Buffer.from(assignment('acReleaseTag', releaseTag) +
    assignment('acAdministratorInstallerSha256', hash(bytes['install-administrator.ps1'])));
  const sources = { 'bin.mjs': Buffer.from('// inert source\n'), 'payload-manifest.json': Buffer.from('{"inert":true}\n') };
  const receipt = { built: true, combinedBuilt: true, deliveryContract: 'combined-public', releaseTag,
    installed: false, published: false, administratorBundleVerified: true, administratorStagerPlan: true };
  function write() {
    bytes['SHA256SUMS.txt'] = Buffer.from(Object.entries({ ...sources, ...Object.fromEntries(
      Object.entries(bytes).filter(([name]) => name !== 'SHA256SUMS.txt')) })
      .map(([name, data]) => `${hash(data)}  ${name}\n`).join(''));
    for (const [name, data] of Object.entries(bytes)) fs.writeFileSync(path.join(directory, name), data);
    receipt.sha256 = hash(bytes[assetNames[0]]);
    receipt.administratorBundleSha256 = hash(bytes[assetNames[4]]);
    receipt.assets = Object.fromEntries(assetNames.map(name => [name, hash(bytes[name])]));
    fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt) + '\n');
  }
  write();
  return { root, directory, receiptFile: path.join(root, 'receipt.json'), receipt, bytes, write };
}
