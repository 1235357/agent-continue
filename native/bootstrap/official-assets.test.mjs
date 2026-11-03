import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPackage } from './build-package.mjs';
import { acquireClient } from './client-acquisition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const archiveDirectory = process.env.AGENT_CONTINUE_OFFICIAL_ASSET_DIR;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('opt-in: all six official archives pass extraction and byte pins without executing any client',
  { timeout: 180000, skip: !archiveDirectory ? 'Official six-archive directory absent; cross-architecture acquisition not executed' : false },
  async t => {
    assert.ok(path.isAbsolute(archiveDirectory));
    const temporary = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(temporary, 'agent-official-assets-'));
    const identity = fs.lstatSync(root, { bigint: true });
    t.after(() => {
      const info = fs.lstatSync(root, { bigint: true });
      assert.equal(path.dirname(root), temporary);
      assert.equal(fs.realpathSync(root), root);
      assert.equal(info.ino, identity.ino); assert.equal(info.dev, identity.dev);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const packageRoot = path.join(root, 'package'), installDir = path.join(root, 'install');
    buildPackage(packageRoot);
    fs.mkdirSync(installDir);
    const app = path.join(installDir, 'app');
    fs.cpSync(path.join(packageRoot, 'payload'), app, { recursive: true });
    fs.cpSync(path.resolve(here, '../desktop-commander/node_modules'), path.join(app, 'node_modules'), { recursive: true });
    const staged = { format: 'agent-continue-acquisition', version: 1, status: 'staged', providerVersion: '0.3.1',
      configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
    fs.writeFileSync(path.join(installDir, 'receipt.json'), JSON.stringify(staged) + '\n', { flag: 'wx' });
    const pins = JSON.parse(fs.readFileSync(path.join(app, 'tunnel-pins.json')));
    assert.deepEqual(Object.keys(pins.platforms).sort(),
      ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
    for (const [platform, pin] of Object.entries(pins.platforms)) {
      const result = await acquireClient({ installDir, consent: 'full-account',
        offlineArchive: path.join(archiveDirectory, pin.asset) }, { packageRoot, platform });
      const client = path.join(installDir, 'client');
      assert.equal(result.status, 'acquired'); assert.equal(result.platform, platform);
      for (const key of ['configured', 'activated', 'protectedInstallationVerified', 'nativeDependenciesVerified']) assert.equal(result[key], false);
      assert.equal(fs.readFileSync(path.join(client, 'receipt.json'), 'utf8'), JSON.stringify(result) + '\n');
      assert.equal(hash(fs.readFileSync(path.join(client, 'release.zip'))), pin.archiveSha256);
      assert.equal(hash(fs.readFileSync(path.join(client, platform.startsWith('win32') ? 'tunnel-client-runtime.exe' : 'tunnel-client-runtime'))), pin.executableSha256);
      assert.equal(hash(fs.readFileSync(path.join(client, pin.asset.slice(0, -4) + '.spdx.json'))), pin.spdxSha256);
      for (const name of ['LICENSE', 'NOTICE', pin.asset.slice(0, -4) + '-licenses.txt']) assert.ok(fs.statSync(path.join(client, name)).size > 0);
      t.diagnostic(JSON.stringify({ officialAssetAcquisition: true, platform, activated: false, executableRun: false }));
      // Only the disposable harness moves its completed fixture to test the next architecture.
      fs.renameSync(client, path.join(installDir, 'verified-' + platform));
    }
    assert.equal(fs.readFileSync(path.join(installDir, 'receipt.json'), 'utf8'), JSON.stringify(staged) + '\n');
  });
