import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = new URL('../scripts/prepare-npm-payload.mjs', import.meta.url);
const source = fs.readFileSync(script, 'utf8');
let copySnapshot;
// Do not import the old, unguarded prepack entry point during the regression run.
if (source.includes('export function copyNativeReleaseSnapshot(') &&
    source.includes('if (process.argv[1] &&')) {
  ({ copyNativeReleaseSnapshot: copySnapshot } = await import(script.href));
}
function copy(stage, bootstrap) {
  assert.equal(typeof copySnapshot, 'function', 'missing side-effect-free snapshot-copy helper');
  return copySnapshot(stage, bootstrap);
}
const releaseFiles = ['native-launcher.exe', 'release.json'];
function putRelease(root, arch, marker = 'staged') {
  const folder = path.join(root, arch);
  fs.mkdirSync(folder, { recursive: true });
  for (const name of releaseFiles) fs.writeFileSync(path.join(folder, name), `${marker}:${arch}:${name}\n`);
}
function fixture(t, arches = ['x64']) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'ac-npm-release-snapshot-'));
  t.after(() => {
    const relative = path.relative(temporary, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const stage = path.join(root, 'stage'), bootstrap = path.join(root, 'bootstrap');
  fs.mkdirSync(stage); fs.mkdirSync(bootstrap);
  const releases = path.join(stage, 'native-release');
  for (const arch of arches) putRelease(releases, arch);
  return { root, stage, bootstrap, releases, generated: path.join(bootstrap, 'packaged-native-release') };
}
function link(t, target, destination, directory = false) {
  try { fs.symlinkSync(target, destination, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`link fixture unavailable: ${error.code}`); return false; }
    throw error;
  }
  return true;
}

test('root npm excludes all native release binaries and ignores older generated files in git', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(repo, 'package.json')));
  assert.deepEqual(meta.files.filter(name => name.includes('native-release') || /\.(exe|msi)$/i.test(name)), []);
  assert.ok(!meta.files.includes('native/') && !meta.files.includes('native/bootstrap/'));
  assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'),
    /^native\/bootstrap\/packaged-native-release\/$/m);
});

test('prepack uses an explicit completed Windows closure and a guarded fixed production target', () => {
  assert.match(source, /const target = path\.join\(root, 'native', 'bootstrap'\)/);
  assert.match(source, /stageWindowsRelease\(releaseDirectory, bootstrapRoot, metadataFromBuildReceipt/);
  assert.match(source, /buildPackage\(stage\);[\s\S]*verifyPayload\(bootstrapRoot\)/);
  assert.match(source, /if \(process\.argv\[1\] && path\.resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)\)/);
  assert.deepEqual([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map(match => match[1]).sort(),
    ['AGENT_CONTINUE_WINDOWS_RELEASE_DIR', 'AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT']);
  const entry = source.slice(source.indexOf('if (process.argv[1] &&'));
  assert.doesNotMatch(entry, /copyNativeReleaseSnapshot\(/, 'legacy custom launcher snapshots are never a public fallback');
});

test('installer prefers the fixed generated entry, including invalid entries, without an override', () => {
  const installer = fs.readFileSync(path.join(repo, 'native/bootstrap/install.ps1'), 'utf8');
  const block = installer.slice(installer.indexOf('function Invoke-NativeRelease('),
    installer.indexOf('if ($CheckNode)', installer.indexOf('function Invoke-NativeRelease(')));
  assert.match(block, /\$releaseRoot = Join-Path \$script:acPayloadRoot 'packaged-native-release'/);
  assert.match(block, /Get-ChildItem -LiteralPath \$script:acPayloadRoot -Force -ErrorAction Stop/);
  assert.match(block, /\$_.Name -ieq 'packaged-native-release'/);
  assert.match(block, /if \(\$packagedRelease.Count -eq 0\)\s*\{\s*\$releaseRoot = Join-Path \$script:acPayloadRoot 'native-release'/);
  assert.match(block, /'-ReleaseRoot', \$releaseRoot/);
  assert.doesNotMatch(block, /\$env:|Test-Path -LiteralPath \$releaseRoot -PathType Container/);
});

test('source ZIP continues to archive the validated stage, not generated npm assets', () => {
  const zip = fs.readFileSync(path.join(repo, 'scripts/build-setup-release.py'), 'utf8');
  assert.match(zip, /native\/bootstrap\/build-package\.mjs/);
  assert.match(zip, /"--output", str\(stage\)/);
  assert.match(zip, /files = sorted\(\(p for p in stage\.rglob\("\*"\) if p\.is_file\(\)\),\s*key=lambda p: p\.relative_to\(stage\)\.as_posix\(\)\)/);
  assert.match(zip, /names = \[p\.relative_to\(stage\)\.as_posix\(\) for p in files\]/);
  assert.match(zip, /payload = \{name: file\.read_bytes\(\) for name, file in zip\(names, files\)\}/);
  assert.match(zip, /members = \{\*\*payload, "SHA256SUMS\.txt": inner_sums\}/);
  assert.match(zip, /for name, data in members\.items\(\):\s*member = zipfile\.ZipInfo\(name, date_time=ZIP_TIMESTAMP\)[\s\S]*?bundle\.writestr\(member, data, compress_type=zipfile\.ZIP_DEFLATED, compresslevel=9\)/);
  assert.match(zip, /if any\(name\.lower\(\)\.endswith\(\("\.exe", "\.msi", "\.zip"\)\) for name in payload\):\s*raise ValueError\("setup_source_contains_binary_or_archive"\)/);
  assert.match(zip, /if bundle\.namelist\(\) != list\(members\):\s*raise ValueError\("setup_source_inventory_mismatch"\)/);
  assert.match(zip, /for name, data in members\.items\(\):\s*if bundle\.read\(name\) != data:\s*raise ValueError\("setup_source_content_mismatch"\)/);
  assert.doesNotMatch(zip, /packaged-native-release/);
});

test('copies inert staged bytes for both architectures and never reads original release inputs', t => {
  const f = fixture(t, ['x64', 'arm64']);
  putRelease(path.join(f.bootstrap, 'native-release'), 'x64', 'unvalidated-original');
  copy(f.stage, f.bootstrap);
  assert.deepEqual(fs.readdirSync(f.generated).sort(), ['arm64', 'x64']);
  for (const arch of ['arm64', 'x64']) {
    assert.deepEqual(fs.readdirSync(path.join(f.generated, arch)).sort(), releaseFiles);
    for (const name of releaseFiles) {
      const output = path.join(f.generated, arch, name);
      assert.deepEqual(fs.readFileSync(output), fs.readFileSync(path.join(f.releases, arch, name)));
      assert.equal(fs.lstatSync(output).nlink, 1);
    }
  }
  putRelease(path.join(f.bootstrap, 'native-release'), 'x64', 'changed-original');
  copy(f.stage, f.bootstrap);
  assert.equal(fs.readFileSync(path.join(f.generated, 'x64', 'native-launcher.exe'), 'utf8'),
    'staged:x64:native-launcher.exe\n');
});

test('replaces only declared regular generated files with the current staged bytes', t => {
  const f = fixture(t);
  putRelease(f.generated, 'x64', 'old-longer-generated-content');
  copy(f.stage, f.bootstrap);
  for (const name of releaseFiles) assert.deepEqual(fs.readFileSync(path.join(f.generated, 'x64', name)),
    fs.readFileSync(path.join(f.releases, 'x64', name)));
});

test('absent staged release does not create assets or reopen a late original release', t => {
  const f = fixture(t, []);
  putRelease(path.join(f.bootstrap, 'native-release'), 'x64', 'late-original');
  copy(f.stage, f.bootstrap);
  assert.equal(fs.existsSync(f.generated), false);
  fs.mkdirSync(f.generated);
  copy(f.stage, f.bootstrap);
  assert.deepEqual(fs.readdirSync(f.generated), []);
});

test('absent staged release refuses old generated assets without deleting them', t => {
  const f = fixture(t, []);
  putRelease(f.generated, 'x64', 'stale');
  assert.throws(() => copy(f.stage, f.bootstrap), /unexpected_generated_release_entry/);
  assert.equal(fs.readFileSync(path.join(f.generated, 'x64', 'release.json'), 'utf8'), 'stale:x64:release.json\n');
});

for (const stale of ['private.txt', 'arm64', 'unknown']) {
  test(`refuses undeclared generated entry ${stale} before overwriting declared bytes`, t => {
    const f = fixture(t);
    putRelease(f.generated, 'x64', 'unchanged');
    if (stale === 'private.txt') fs.writeFileSync(path.join(f.generated, 'x64', stale), 'keep');
    else putRelease(f.generated, stale, 'keep');
    assert.throws(() => copy(f.stage, f.bootstrap), /unexpected_generated_release_entry/);
    assert.equal(fs.readFileSync(path.join(f.generated, 'x64', 'release.json'), 'utf8'), 'unchanged:x64:release.json\n');
  });
}

for (const invalid of ['empty', 'unknown-arch', 'extra-file', 'missing-file', 'nested-directory']) {
  test(`refuses invalid staged release closure: ${invalid}`, t => {
    const f = fixture(t, invalid === 'empty' ? [] : ['x64']);
    if (invalid === 'empty') fs.mkdirSync(f.releases);
    if (invalid === 'unknown-arch') putRelease(f.releases, 'unknown');
    if (invalid === 'extra-file') fs.writeFileSync(path.join(f.releases, 'x64', 'extra'), 'not declared');
    if (invalid === 'missing-file') fs.unlinkSync(path.join(f.releases, 'x64', 'release.json'));
    if (invalid === 'nested-directory') {
      fs.unlinkSync(path.join(f.releases, 'x64', 'release.json'));
      fs.mkdirSync(path.join(f.releases, 'x64', 'release.json'));
    }
    assert.throws(() => copy(f.stage, f.bootstrap), /invalid_native_release_snapshot/);
    assert.equal(fs.existsSync(f.generated), false);
  });
}

for (const location of ['stage-root', 'stage-arch', 'generated-root', 'generated-arch', 'bootstrap-parent']) {
  test(`refuses redirected directory: ${location}`, t => {
    const f = fixture(t);
    const other = path.join(f.root, 'other'); fs.mkdirSync(other);
    let stage = f.stage, bootstrap = f.bootstrap;
    if (location === 'stage-root' || location === 'stage-arch') {
      const entry = location === 'stage-root' ? f.releases : path.join(f.releases, 'x64');
      fs.renameSync(entry, path.join(other, 'saved'));
      if (!link(t, path.join(other, 'saved'), entry, true)) return;
    } else if (location === 'bootstrap-parent') {
      bootstrap = path.join(f.root, 'alias');
      if (!link(t, f.bootstrap, bootstrap, true)) return;
    } else {
      if (location === 'generated-arch') fs.mkdirSync(f.generated);
      if (!link(t, other, location === 'generated-root' ? f.generated : path.join(f.generated, 'x64'), true)) return;
    }
    assert.throws(() => copy(stage, bootstrap), /invalid_native_release_snapshot|invalid_generated_target/);
    assert.deepEqual(fs.readdirSync(other), location.startsWith('stage-') ? ['saved'] : []);
  });
}

for (const kind of ['hardlink', 'symlink']) {
  for (const location of ['stage', 'generated']) {
    test(`refuses ${kind} release file in ${location}`, t => {
      const f = fixture(t);
      if (location === 'generated') putRelease(f.generated, 'x64', 'keep');
      const file = path.join(location === 'stage' ? f.releases : f.generated, 'x64', 'native-launcher.exe');
      const other = path.join(f.root, 'unrelated'); fs.writeFileSync(other, 'do not modify');
      fs.unlinkSync(file);
      if (kind === 'hardlink') fs.linkSync(other, file);
      else if (!link(t, other, file)) return;
      assert.throws(() => copy(f.stage, f.bootstrap), /invalid_native_release_snapshot|invalid_generated_target/);
      assert.equal(fs.readFileSync(other, 'utf8'), 'do not modify');
    });
  }
}

test('rejects files at generated directory paths and validates every architecture before writing', t => {
  const f = fixture(t, ['x64', 'arm64']);
  fs.writeFileSync(f.generated, 'not a directory');
  assert.throws(() => copy(f.stage, f.bootstrap), /invalid_generated_target/);
  fs.unlinkSync(f.generated);
  putRelease(f.generated, 'arm64', 'unchanged');
  fs.writeFileSync(path.join(f.generated, 'x64'), 'not a directory');
  assert.throws(() => copy(f.stage, f.bootstrap), /invalid_generated_target/);
  assert.equal(fs.readFileSync(path.join(f.generated, 'arm64', 'release.json'), 'utf8'), 'unchanged:arm64:release.json\n');
});

test('rejects relative directory arguments before filesystem writes', t => {
  const f = fixture(t);
  assert.throws(() => copy('relative-stage', f.bootstrap), /invalid_native_release_snapshot/);
  assert.throws(() => copy(f.stage, 'relative-bootstrap'), /invalid_generated_target/);
  assert.equal(fs.existsSync(f.generated), false);
});
