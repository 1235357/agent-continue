import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const WINDOWS_RELEASE_ASSETS = Object.freeze(['agent-continue-setup.zip', 'install.ps1',
  'install-administrator.ps1', 'Stage-WindowsAdministratorBundle.ps1',
  'agent-continue-windows-administrator-x64.zip', 'SHA256SUMS.txt']);
const metadataFile = 'release.json';
const format = 'agent-continue-windows-npm-release';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const hashPattern = /^[a-f0-9]{64}$/;
const fail = code => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) ||
      value.startsWith('\\\\') || value.startsWith('//')) fail('windows_release_path');
  const relative = value.slice(path.parse(value).root.length);
  if (relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..' ||
      /[<>:"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    fail('windows_release_path');
  }
  return path.resolve(value);
}

function directory(value) {
  const resolved = localPath(value), root = path.parse(resolved).root;
  let current = root;
  try {
    for (const part of ['', ...resolved.slice(root.length).split(path.sep)]) {
      current = path.join(current, part);
      const info = fs.lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) fail('windows_release_path');
    }
    const actual = fs.realpathSync.native(resolved);
    if ((process.platform === 'win32' ? actual.toLowerCase() !== resolved.toLowerCase() : actual !== resolved)) {
      fail('windows_release_path');
    }
  } catch { fail('windows_release_path'); }
  return resolved;
}

function regular(file) {
  directory(path.dirname(file));
  try {
    const info = fs.lstatSync(file, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino === 0n) fail('windows_release_file');
    return info;
  } catch { fail('windows_release_file'); }
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs && b.isFile() && b.nlink === 1n;
}

function asset(file, { retain = false, destination } = {}) {
  const before = regular(file), limit = file.endsWith('.zip') ? 768 * 1024 * 1024 : 4 * 1024 * 1024;
  if (before.size <= 0n || before.size > BigInt(limit)) fail('windows_release_size');
  const input = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let output;
  try {
    if (!sameFile(before, fs.fstatSync(input, { bigint: true }))) fail('windows_release_changed');
    if (destination) {
      directory(path.dirname(destination));
      output = fs.openSync(destination, 'wx', 0o600);
    }
    const hash = crypto.createHash('sha256'), chunks = [], buffer = Buffer.alloc(65536);
    let size = 0, count;
    while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
      size += count;
      if (size > limit) fail('windows_release_size');
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      if (retain) chunks.push(Buffer.from(chunk));
      if (output !== undefined) fs.writeFileSync(output, chunk);
    }
    if (BigInt(size) !== before.size || !sameFile(before, fs.fstatSync(input, { bigint: true })) ||
        !sameFile(before, regular(file))) fail('windows_release_changed');
    return { sha256: hash.digest('hex'), bytes: retain ? Buffer.concat(chunks) : undefined };
  } finally {
    fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
  }
}

function checkedMetadata(value) {
  if (!exactKeys(value, ['format', 'version', 'deliveryContract', 'releaseTag', 'assets']) || value.format !== format ||
      value.version !== 1 || value.deliveryContract !== 'combined-public' ||
      typeof value.releaseTag !== 'string' || !/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(value.releaseTag) ||
      !exactKeys(value.assets, WINDOWS_RELEASE_ASSETS) || Object.values(value.assets).some(pin => typeof pin !== 'string' || !hashPattern.test(pin))) {
    fail('windows_release_metadata');
  }
  return Object.freeze({ format, version: 1, deliveryContract: 'combined-public', releaseTag: value.releaseTag,
    assets: Object.freeze(Object.fromEntries(WINDOWS_RELEASE_ASSETS.map(name => [name, value.assets[name]]))) });
}

export function metadataFromBuildReceipt(receipt, releaseVersion) {
  if (!receipt) fail('combined_release_receipt_required');
  if (typeof releaseVersion !== 'string' || receipt.built !== true || receipt.combinedBuilt !== true ||
      receipt.deliveryContract !== 'combined-public' || receipt.administratorBundleVerified !== true || receipt.administratorStagerPlan !== true ||
      receipt.installed !== false || receipt.published !== false || receipt.releaseTag !== `v${releaseVersion}` ||
      receipt.sha256 !== receipt.assets?.['agent-continue-setup.zip'] ||
      receipt.administratorBundleSha256 !== receipt.assets?.['agent-continue-windows-administrator-x64.zip']) {
    fail('invalid_combined_release_receipt');
  }
  try {
    return checkedMetadata({ format, version: 1, deliveryContract: receipt.deliveryContract,
      releaseTag: receipt.releaseTag, assets: receipt.assets });
  } catch { fail('invalid_combined_release_receipt'); }
}

function parseMetadata(bytes) {
  try {
    if (bytes.length > 65536) fail('windows_release_metadata');
    const value = checkedMetadata(JSON.parse(bytes.toString('utf8')));
    // Only our minimal canonical record is accepted, including no duplicate keys.
    if (bytes.toString('utf8') !== JSON.stringify(value) + '\n') fail('windows_release_metadata');
    return value;
  } catch { fail('windows_release_metadata'); }
}

function checkPin(source, variable, expected) {
  const assignments = [...source.matchAll(new RegExp(`^[ \\t]*\\$script:${variable}[ \\t]*=.*$`, 'gmi'))];
  if (assignments.length !== 1 || assignments[0][0].trim() !== `$script:${variable} = '${expected}'`) {
    fail('windows_release_pin');
  }
}

function checksums(bytes, pins) {
  if (bytes.some(value => value > 127) || bytes.at(-1) !== 10) fail('windows_release_checksums');
  const entries = new Map(), seen = new Set();
  for (const line of bytes.toString('ascii').slice(0, -1).split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9@_.+/-]+)$/.exec(line);
    if (!match) fail('windows_release_checksums');
    const [, pin, name] = match;
    if (name.split('/').some(part => !part || part === '.' || part === '..' || part.endsWith('.') ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) ||
        /^(\.env(?:\..*)?|\.npmrc|runtime\.key|tunnel\.yaml|binding\.json)$/i.test(part) || /\.(pem|key|pfx|p12)$/i.test(part)) ||
        name === 'SHA256SUMS.txt' || seen.has(name.toLowerCase()) ||
        (/\.(exe|msi|zip)$/i.test(name) && !WINDOWS_RELEASE_ASSETS.slice(0, -1).includes(name))) fail('windows_release_checksums');
    entries.set(name, pin); seen.add(name.toLowerCase());
  }
  for (const name of WINDOWS_RELEASE_ASSETS.filter(name => name !== 'SHA256SUMS.txt')) {
    if (entries.get(name) !== pins[name]) fail('windows_release_checksums');
  }
  if (!entries.has('bin.mjs') || !entries.has('payload-manifest.json')) fail('windows_release_checksums');
}

export function validateWindowsRelease(releaseRoot, expectedMetadata) {
  releaseRoot = directory(releaseRoot);
  const entries = fs.readdirSync(releaseRoot).sort();
  const packaged = entries.includes(metadataFile);
  if (entries.join('\n') !== [...WINDOWS_RELEASE_ASSETS, ...(packaged ? [metadataFile] : [])].sort().join('\n')) {
    fail('windows_release_inventory');
  }
  const metadata = expectedMetadata ? checkedMetadata(expectedMetadata) :
    packaged ? parseMetadata(asset(path.join(releaseRoot, metadataFile), { retain: true }).bytes) : fail('windows_release_metadata_required');
  if (packaged) {
    const saved = parseMetadata(asset(path.join(releaseRoot, metadataFile), { retain: true }).bytes);
    if (JSON.stringify(saved) !== JSON.stringify(metadata)) fail('windows_release_metadata');
  }
  const sources = {};
  // ZIPs remain opaque here: their exact pins must come from the completed
  // setup builder's source/inventory verification, not a new local attestation.
  for (const name of WINDOWS_RELEASE_ASSETS) {
    const snapshot = asset(path.join(releaseRoot, name), { retain: !name.endsWith('.zip') });
    if (snapshot.sha256 !== metadata.assets[name]) fail('windows_release_digest');
    if (snapshot.bytes) sources[name] = snapshot.bytes;
  }
  checkPin(sources['install.ps1'].toString('utf8'), 'acReleaseTag', metadata.releaseTag);
  checkPin(sources['install-administrator.ps1'].toString('utf8'), 'acReleaseTag', metadata.releaseTag);
  checkPin(sources['install.ps1'].toString('utf8'), 'acAdministratorInstallerSha256', metadata.assets['install-administrator.ps1']);
  checkPin(sources['install-administrator.ps1'].toString('utf8'), 'acAdministratorBundleSha256', metadata.assets['agent-continue-windows-administrator-x64.zip']);
  checkPin(sources['install-administrator.ps1'].toString('utf8'), 'acAdministratorStagerSha256', metadata.assets['Stage-WindowsAdministratorBundle.ps1']);
  checksums(sources['SHA256SUMS.txt'], metadata.assets);
  return metadata;
}

export function setupEntryMetadata(releaseDirectory, buildReceipt, releaseVersion) {
  const metadata = validateWindowsRelease(releaseDirectory, metadataFromBuildReceipt(buildReceipt, releaseVersion));
  return Object.freeze({ format: 'agent-continue-windows-setup-entry', version: 1,
    releaseTag: metadata.releaseTag,
    entryUrl: `https://github.com/1235357/agent-continue/releases/download/${metadata.releaseTag}/install.ps1`,
    entrySha256: metadata.assets['install.ps1'], sumsSha256: metadata.assets['SHA256SUMS.txt'] });
}

export function stageWindowsRelease(releaseDirectory, bootstrapRoot, metadata) {
  metadata = validateWindowsRelease(releaseDirectory, metadata);
  const releaseRoot = path.join(directory(bootstrapRoot), 'windows-release');
  if (!fs.existsSync(releaseRoot)) {
    // Never overwrite or recursively remove old/generated data. A partial failed
    // stage remains invalid and requires explicit owner cleanup, not blind reuse.
    fs.mkdirSync(releaseRoot, { mode: 0o700 });
    for (const name of WINDOWS_RELEASE_ASSETS) {
      const copy = asset(path.join(releaseDirectory, name), { destination: path.join(releaseRoot, name) });
      if (copy.sha256 !== metadata.assets[name]) fail('windows_release_digest');
    }
    fs.writeFileSync(path.join(releaseRoot, metadataFile), JSON.stringify(metadata) + '\n', { flag: 'wx', mode: 0o600 });
  }
  validateWindowsRelease(releaseRoot, metadata);
  return { prepared: true, releaseRoot, releaseTag: metadata.releaseTag, assets: metadata.assets, installed: false, published: false };
}

export function buildWindowsCommandPlan(input) {
  const keys = ['releaseRoot', 'account', 'extensionId', 'consent', ...(Object.hasOwn(input || {}, 'setupId') ? ['setupId'] : [])];
  if (!exactKeys(input, keys) || !['current', 'administrator'].includes(input.account) ||
      typeof input.extensionId !== 'string' || !/^[a-p]{32}$/.test(input.extensionId) ||
      (Object.hasOwn(input, 'setupId') && (input.account !== 'administrator' || typeof input.setupId !== 'string' || !/^[a-f0-9]{32}$/.test(input.setupId)))) {
    fail('windows_release_arguments');
  }
  const administrator = input.account === 'administrator';
  if (input.consent !== (administrator ? 'accept-administrator-browser-installation' : 'accept-install')) fail('windows_release_consent');
  validateWindowsRelease(input.releaseRoot);
  const releaseRoot = directory(input.releaseRoot);
  const args = ['-NoLogo', '-NoProfile', '-File', path.join(releaseRoot, 'install.ps1'),
    ...(administrator ? ['-Administrator', '-Apply'] : ['-InstallLocal', '-BrowserManaged']),
    '-Consent', input.consent, '-PromptForConnection', '-ExtensionId', input.extensionId,
    ...(input.setupId ? ['-BrowserSetupId', input.setupId] : [])];
  return { file: powershell, args, options: { cwd: releaseRoot, shell: false, stdio: 'inherit', windowsHide: false } };
}
