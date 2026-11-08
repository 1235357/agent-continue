import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { metadataFromBuildReceipt, stageWindowsRelease } from '../native/bootstrap/windows-release.mjs';
import { buildPackage } from '../native/bootstrap/build-package.mjs';
import { RUNTIME_FILES } from '../native/bootstrap/payload-layout.mjs';
import { verifyPayload } from '../native/bootstrap/bootstrap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'native', 'bootstrap');
const releaseFiles = ['native-launcher.exe', 'release.json'];

function directory(value, code, optional = false) {
  try {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) ||
        value.startsWith('\\\\') || value.startsWith('//')) throw new Error(code);
    const resolved = path.resolve(value), parsed = path.parse(resolved);
    let current = parsed.root;
    for (const part of ['', ...resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)]) {
      current = path.join(current, part);
      let info;
      try { info = fs.lstatSync(current); }
      catch (error) { if (optional && current === resolved && error.code === 'ENOENT') return null; throw error; }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(code);
    }
    return resolved;
  } catch { throw new Error(code); }
}

function regular(file, code, optional = false) {
  try {
    const info = fs.lstatSync(file, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino === 0n) throw new Error(code);
    return info;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw new Error(code);
  }
}

function writeGenerated(file, bytes) {
  const code = 'invalid_generated_target';
  directory(path.dirname(file), code);
  const before = regular(file, code, true);
  const descriptor = fs.openSync(file, before ? 'r+' : 'wx', 0o600);
  try {
    const info = fs.fstatSync(descriptor, { bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.ino === 0n ||
        (before && (before.dev !== info.dev || before.ino !== info.ino))) throw new Error(code);
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, bytes);
  } finally { fs.closeSync(descriptor); }
}

// The production caller supplies only its completed private build stage and fixed target.
export function copyNativeReleaseSnapshot(stageRoot, bootstrapRoot) {
  const sourceCode = 'invalid_native_release_snapshot', targetCode = 'invalid_generated_target';
  stageRoot = directory(stageRoot, sourceCode);
  bootstrapRoot = directory(bootstrapRoot, targetCode);
  const source = directory(path.join(stageRoot, 'native-release'), sourceCode, true);
  const arches = source ? fs.readdirSync(source).sort() : [];
  if (source && (!arches.length || arches.some(arch => !['arm64', 'x64'].includes(arch)))) throw new Error(sourceCode);
  const snapshot = arches.map(arch => {
    const folder = directory(path.join(source, arch), sourceCode);
    if (JSON.stringify(fs.readdirSync(folder).sort()) !== JSON.stringify(releaseFiles)) throw new Error(sourceCode);
    return { arch, files: releaseFiles.map(name => {
      const file = path.join(folder, name);
      regular(file, sourceCode);
      return { name, bytes: fs.readFileSync(file) };
    }) };
  });

  const generated = path.join(bootstrapRoot, 'packaged-native-release');
  if (directory(generated, targetCode, true)) {
    const existing = fs.readdirSync(generated);
    if (existing.some(arch => !arches.includes(arch))) throw new Error('unexpected_generated_release_entry');
    // Check the whole old tree before overwriting anything; never sweep unknown paths.
    for (const arch of existing) {
      const folder = directory(path.join(generated, arch), targetCode);
      if (JSON.stringify(fs.readdirSync(folder).sort()) !== JSON.stringify(releaseFiles)) {
        throw new Error('unexpected_generated_release_entry');
      }
      for (const name of releaseFiles) regular(path.join(folder, name), targetCode);
    }
  }
  if (!snapshot.length) return;
  if (!directory(generated, targetCode, true)) fs.mkdirSync(generated, { mode: 0o700 });
  for (const { arch, files } of snapshot) {
    const folder = path.join(generated, arch);
    if (!directory(folder, targetCode, true)) fs.mkdirSync(folder, { mode: 0o700 });
    for (const { name, bytes } of files) writeGenerated(path.join(folder, name), bytes);
  }
}

export function prepareNpmPayload({ releaseDirectory, buildReceipt, bootstrapRoot = target, releaseVersion } = {}) {
  if (!releaseDirectory) throw new Error('combined_release_directory_required');
  releaseVersion ??= JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
  return stageWindowsRelease(releaseDirectory, bootstrapRoot, metadataFromBuildReceipt(buildReceipt, releaseVersion));
}

export function prepareCompatibilityPayload(bootstrapRoot = target) {
  bootstrapRoot = directory(bootstrapRoot, 'invalid_generated_target');
  const temporary = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(temporary, 'ac-npm-source-'));
  try {
    const stage = path.join(scratch, 'package');
    buildPackage(stage);
    const payload = path.join(bootstrapRoot, 'payload');
    if (!directory(payload, 'invalid_generated_target', true)) fs.mkdirSync(payload, { mode: 0o700 });
    if (fs.readdirSync(payload).some(name => !RUNTIME_FILES.includes(name))) throw new Error('unexpected_generated_payload_entry');
    for (const name of RUNTIME_FILES) writeGenerated(path.join(payload, name), fs.readFileSync(path.join(stage, 'payload', name)));
    writeGenerated(path.join(bootstrapRoot, 'payload-manifest.json'), fs.readFileSync(path.join(stage, 'payload-manifest.json')));
    return verifyPayload(bootstrapRoot);
  } finally {
    if (path.dirname(fs.realpathSync(scratch)) !== temporary) throw new Error('invalid_generated_target');
    fs.rmSync(scratch, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = new Map(), args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (!['--combined-release-dir', '--combined-release-receipt'].includes(flag) || flags.has(flag) ||
          typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      flags.set(flag, value);
    }
    const releaseDirectory = flags.get('--combined-release-dir') ?? process.env.AGENT_CONTINUE_WINDOWS_RELEASE_DIR;
    if (!releaseDirectory) throw new Error('combined_release_directory_required');
    const receiptFile = flags.get('--combined-release-receipt') ?? process.env.AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT;
    if (!receiptFile) throw new Error('combined_release_receipt_required');
    directory(path.dirname(receiptFile), 'invalid_combined_release_receipt');
    const info = regular(receiptFile, 'invalid_combined_release_receipt');
    if (info.size <= 0n || info.size > 65536n) throw new Error('invalid_combined_release_receipt');
    const buildReceipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    const prepared = prepareNpmPayload({ releaseDirectory, buildReceipt });
    const compatibilityPayload = prepareCompatibilityPayload();
    console.log(JSON.stringify({ ...prepared, compatibilityPayloadFiles: compatibilityPayload.files }));
  } catch (error) {
    console.error(/^[a-z_]{1,80}$/.test(error.message) ? error.message : 'combined_release_preparation_failed');
    process.exitCode = 1;
  }
}
