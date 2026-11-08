import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as windowsRelease from '../native/bootstrap/windows-release.mjs';
import { assetNames, combinedFixture, descriptor, entryUrl, hash, releaseVersion, snapshot, snapshotFiles } from './setup-entry-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = (...args) => {
  assert.equal(typeof windowsRelease.setupEntryMetadata, 'function', 'completed-closure entry metadata projection is required');
  return windowsRelease.setupEntryMetadata(...args);
};

test('entry projection pins final combined entry and checksum-list bytes in exactly six frozen fields', t => {
  const f = combinedFixture(t), before = snapshot(f.root);
  const value = project(f.directory, f.receipt, releaseVersion);
  assert.deepEqual(value, descriptor({ entrySha256: hash(f.bytes['install.ps1']), sumsSha256: hash(f.bytes['SHA256SUMS.txt']) }));
  assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(Object.keys(value).sort(), ['format', 'version', 'releaseTag', 'entryUrl', 'entrySha256', 'sumsSha256'].sort());
  assert.equal(value.sumsSha256, f.receipt.assets['SHA256SUMS.txt']);
  assert.equal(value.entryUrl, entryUrl);
  for (const field of ['published', 'installed', 'installerReleased', 'assets', 'setupSha256']) assert.equal(Object.hasOwn(value, field), false);
  assert.deepEqual(snapshot(f.root), before, 'projection must not stage npm, generate payloads or rewrite inputs');
});

for (const change of [{ combinedBuilt: false }, { deliveryContract: 'current-account-source-only' },
  { administratorBundleVerified: false }, { administratorStagerPlan: false }, { installed: true },
  { published: true }, { releaseTag: 'v0.0.0' }]) {
  test(`entry projection rejects incomplete, source-only or mismatched closure ${JSON.stringify(change)}`, t => {
    const f = combinedFixture(t), before = snapshot(f.root);
    assert.equal(typeof windowsRelease.setupEntryMetadata, 'function');
    assert.throws(() => project(f.directory, { ...f.receipt, ...change }, releaseVersion));
    assert.deepEqual(snapshot(f.root), before);
  });
}

for (const name of assetNames) {
  test(`entry projection verifies the complete sidecar closure, including ${name}`, t => {
    const f = combinedFixture(t);
    fs.appendFileSync(path.join(f.directory, name), 'tampered');
    const before = snapshot(f.root);
    assert.equal(typeof windowsRelease.setupEntryMetadata, 'function');
    assert.throws(() => project(f.directory, f.receipt, releaseVersion));
    assert.deepEqual(snapshot(f.root), before);
  });
}

for (const stamp of ["$script:acReleaseTag = ''\n", "$script:acReleaseTag = 'v0.0.0'\n",
  `$script:acReleaseTag = 'v${releaseVersion}'\n$script:acReleaseTag = 'v${releaseVersion}'\n`]) {
  test('entry projection rejects an unsupported stamp even when all outer hashes are recomputed', t => {
    const f = combinedFixture(t);
    f.bytes['install.ps1'] = Buffer.from(stamp + `$script:acAdministratorInstallerSha256 = '${hash(f.bytes['install-administrator.ps1'])}'\n`);
    f.write();
    assert.equal(typeof windowsRelease.setupEntryMetadata, 'function');
    assert.throws(() => project(f.directory, f.receipt, releaseVersion));
  });
}

test('read-only setup-entry JSON CLI validates the supplied closure without npm staging or source writes', t => {
  const f = combinedFixture(t), before = snapshot(f.root);
  const guarded = ['native/bootstrap/payload-manifest.json', 'native/bootstrap/windows-release/release.json']
    .map(name => path.join(repo, name));
  const guardedBefore = snapshotFiles(guarded);
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/prepare-npm-payload.mjs'), '--setup-entry-json',
    '--combined-release-dir', f.directory, '--combined-release-receipt', f.receiptFile], {
    cwd: f.root, encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false,
    env: { ...process.env, AGENT_CONTINUE_WINDOWS_RELEASE_DIR: '', AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT: '' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value, descriptor({ entrySha256: hash(f.bytes['install.ps1']), sumsSha256: hash(f.bytes['SHA256SUMS.txt']) }));
  assert.equal(result.stdout, JSON.stringify(value) + '\n');
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(snapshotFiles(guarded), guardedBefore);
});

test('setup-entry JSON CLI requires explicit paired inputs and rejects unknown, duplicate or malformed arguments', t => {
  const f = combinedFixture(t), before = snapshot(f.root);
  const paired = ['--combined-release-dir', f.directory, '--combined-release-receipt', f.receiptFile];
  const guarded = ['native/bootstrap/payload-manifest.json', 'native/bootstrap/windows-release/release.json']
    .map(name => path.join(repo, name));
  const guardedBefore = snapshotFiles(guarded);
  for (const args of [[], ['--combined-release-dir', f.directory], ['--combined-release-receipt', f.receiptFile],
    [...paired, '--setup-entry-json'], [...paired, '--combined-release-dir', f.directory],
    [...paired, '--combined-release-receipt', f.receiptFile], [...paired, '--unknown', 'value'],
    [...paired, 'true'], [...paired, '--combined-release-dir'], ['--combined-release-dir', '', '--combined-release-receipt', f.receiptFile]]) {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/prepare-npm-payload.mjs'), '--setup-entry-json', ...args], {
      cwd: f.root, encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false,
      env: { ...process.env, AGENT_CONTINUE_WINDOWS_RELEASE_DIR: f.directory, AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT: f.receiptFile },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'invalid_arguments\n');
    assert.deepEqual(snapshot(f.root), before);
    assert.deepEqual(snapshotFiles(guarded), guardedBefore);
  }
});

test('read-only snapshots track absent files as well as existing bytes', t => {
  const f = combinedFixture(t), absent = path.join(f.root, 'not-generated.json');
  const files = [f.receiptFile, absent], before = snapshotFiles(files);
  assert.deepEqual(before[absent], { exists: false });
  assert.deepEqual(before[f.receiptFile], { exists: true, sha256: hash(fs.readFileSync(f.receiptFile)) });
  fs.writeFileSync(absent, 'inert scratch bytes');
  assert.notDeepEqual(snapshotFiles(files), before);
  fs.unlinkSync(absent);
  assert.deepEqual(snapshotFiles(files), before);
});

test('entry metadata cannot introduce a source/hash cycle through shared bootstrap payload modules', () => {
  const layout = fs.readFileSync(path.join(repo, 'native/bootstrap/payload-layout.mjs'), 'utf8');
  assert.doesNotMatch(layout, /setup-entry(?:-release)?\.js/);
  const builder = fs.readFileSync(path.join(repo, 'scripts/build-setup-release.py'), 'utf8');
  const entry = builder.indexOf('payload["install.ps1"] = pin_installer');
  const helper = builder.indexOf('"acAdministratorInstallerSha256", sha256(payload[ADMIN_INSTALLER])');
  const archive = builder.indexOf('with zipfile.ZipFile(archive, "x")');
  assert.ok(entry >= 0 && helper >= 0 && archive >= 0, 'all build-order markers must exist');
  assert.ok(entry < archive && helper < archive);
  assert.match(builder, /"published": False/);
});

test('setup-entry JSON CLI rejects malformed and invalid receipts without writes or partial output', t => {
  const f = combinedFixture(t);
  for (const bytes of ['{not-json', '{}', JSON.stringify({ ...f.receipt, combinedBuilt: false })]) {
    fs.writeFileSync(f.receiptFile, bytes);
    const before = snapshot(f.root);
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/prepare-npm-payload.mjs'), '--setup-entry-json',
      '--combined-release-dir', f.directory, '--combined-release-receipt', f.receiptFile], {
      cwd: f.root, encoding: 'utf8', timeout: 10000, windowsHide: true, shell: false,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^[a-z_]{1,80}\r?\n$/);
    assert.deepEqual(snapshot(f.root), before);
  }
});
