import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareHostedAppendProbe, prepareHostedShellProbe } from '../scripts/hosted-read-acceptance.mjs';
import { catalogAuditFile, instrumentCatalogHost, summarizeCatalogAudit } from './hosted-catalog-fixture.mjs';
import { prepareManagedProcess } from './hosted-managed-process.mjs';
import { createOperationReceipts } from '../native/desktop-commander/operation-receipts.mjs';

let phase = 'input';
async function run() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.AC_HOSTED_BROWSER_ACCEPTANCE, 'accept-dedicated-test-tunnel');
  const { AC_HOSTED_SETUP: setup, AC_HOSTED_KEY_FILE: key, AC_HOSTED_TUNNEL_ID: tunnel,
    AC_HOSTED_TUNNEL_ARCHIVE: archive, AC_HOSTED_NPM_CACHE: cache, AC_HOSTED_WEB_WINDOW_SECONDS: seconds,
    AC_HOSTED_PREPARED_PROCESS: preparedMode, AC_HOSTED_APPEND_READBACK: appendMode,
    AC_HOSTED_MANAGED_PROCESS: managedMode } = process.env;
  assert.ok(preparedMode === undefined || ['accept-prepared-preview', 'accept-revoked-preview'].includes(preparedMode));
  assert.ok(appendMode === undefined || appendMode === 'accept-disposable-append-readback' && preparedMode === undefined);
  assert.ok(managedMode === undefined || managedMode === 'accept-owned-process-lifecycle' &&
    appendMode === undefined && preparedMode === undefined);
  const append = appendMode !== undefined;
  const managed = managedMode !== undefined;
  const prepared = preparedMode !== undefined;
  const revoked = preparedMode === 'accept-revoked-preview';
  assert.match(tunnel, /^tunnel_[a-f0-9]{32}$/);
  assert.match(seconds, /^(?:[1-9]|[1-9][0-9]|1[0-7][0-9]|180)$/);
  for (const file of [setup, key, archive, cache]) assert.ok(path.isAbsolute(file));
  const temp = fs.realpathSync.native(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(temp, 'ac-browser-native-start-'));
  const install = path.join(scratch, 'device'), state = path.join(install, 'state');
  const app = path.join(install, 'app'), manifest = path.join(scratch, 'setup-request.json');
  const finishFile = path.join(scratch, 'finish-web-window');
  const shellProofFile = path.join(scratch, 'shell-browser-marker.sha256');
  const extensionId = Array.from(randomBytes(32), byte => 'abcdefghijklmnop'[byte % 16]).join('');
  const emit = value => console.log(JSON.stringify(value));
  let owner;
  try {
    phase = 'setup';
    fs.writeFileSync(manifest, JSON.stringify({ format: 'agent-continue-device-setup', version: 1,
      target: 'windows', extensionId, nativeHost: 'com.agentcontinue.device_control' }, null, 2) + '\n', { flag: 'wx' });
    const result = JSON.parse(execFileSync(process.execPath, [path.join(setup, 'bin.mjs'), 'setup',
      '--install-dir', install, '--consent', 'full-account', '--setup-request', manifest,
      '--tunnel-id', tunnel, '--runtime-key-file', key, '--tunnel-archive', archive, '--offline-cache', cache],
    { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16384 }));
    assert.equal(result.status, 'configured');
    assert.equal(result.activated, false);
    assert.equal(result.nativeRegistrationVerified, false);
    assert.equal(result.extensionId, extensionId);
    phase = 'instrument';
    const stagePrepared = (prepared || managed) ? (request, digest) => {
      const file = path.join(scratch, 'reviewed-process.json');
      fs.writeFileSync(file, JSON.stringify(request), { flag: 'wx' });
      const staged = JSON.parse(execFileSync(process.execPath, [path.join(app, 'prepared-process.mjs'), 'stage',
        '--state-dir', state, '--request-file', file, '--reviewed-sha256', digest],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 2048 }));
      assert.equal(staged.staged, true);
      assert.equal(staged.executed, false);
      return { agent_continue_operation_id: staged.agent_continue_operation_id,
        agent_continue_process_sha256: staged.agent_continue_process_sha256 };
    } : undefined;
    const probe = managed ? prepareManagedProcess(stagePrepared) : append ? prepareHostedAppendProbe(state, { requireReadback: true }) :
      prepareHostedShellProbe(state, { exact: true, expectedWindowsToken: 'standard', stagePrepared });
    if (revoked) {
      const reply = JSON.parse(execFileSync(process.execPath, [path.join(app, 'prepared-process.mjs'), 'revoke',
        '--state-dir', state, '--operation-id', probe.request.agent_continue_operation_id,
        '--reviewed-sha256', probe.request.agent_continue_process_sha256],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 2048 }));
      assert.equal(reply.revoked, true);
      assert.equal(reply.status, 'owner-revoked');
    }
    const host = path.join(app, 'host.mjs');
    fs.writeFileSync(host, instrumentCatalogHost(fs.readFileSync(host, 'utf8'),
      managed ? { managedProcess: probe.config } :
        append ? { append: { write: probe.request, read: probe.readRequest } } : { shellRequest: probe.request, prepared }));
    const { openController } = await import(pathToFileURL(path.join(app, 'lifecycle.mjs')).href);
    owner = openController(state);
    phase = 'connect';
    const openedAt = Date.now();
    const ready = await owner.reconnect();
    assert.equal(ready.paused, false);
    assert.equal(ready.ready, true);
    emit(managed ? { phase: 'process-ready', startTool: probe.startTool, startRequest: probe.request, stopId: probe.stopId,
      finishFile, browserProofFile: shellProofFile } :
      append ? { phase: 'append-ready', appendRequest: probe.request, readRequest: probe.readRequest,
      finishFile, browserProofFile: shellProofFile } :
      { phase: 'shell-ready', shellTool: probe.tool, shellRequest: probe.request, finishFile, shellProofFile });
    phase = 'observe';
    const deadline = performance.now() + Number(seconds) * 1000;
    while (performance.now() < deadline) {
      try {
        const info = fs.lstatSync(finishFile);
        if (info.isFile() && !info.isSymbolicLink() && info.size === 0) break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(100);
    }
    // The pinned provider flushes history every second.
    await delay(1200);
    const closedAt = Date.now();
    phase = 'pause';
    const paused = await owner.pause();
    assert.equal(paused.paused, true);
    assert.equal(paused.runtime, 'stopped');
    await owner.dispose();
    owner = null;
    const reopened = openController(state);
    owner = reopened;
    const observed = await reopened.status();
    assert.equal(observed.paused, true);
    assert.equal(observed.runtime, 'stopped');
    await reopened.dispose();
    owner = null;
    phase = 'verify';
    let events = '';
    try { events = fs.readFileSync(path.join(state, catalogAuditFile), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const counts = summarizeCatalogAudit(events);
    let browserDigest = null;
    function readBrowserDigest() {
      try {
        const info = fs.lstatSync(shellProofFile);
        if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 66) {
          const received = fs.readFileSync(shellProofFile, 'utf8').trim();
          if (/^[a-f0-9]{64}$/.test(received)) return received;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return null;
    }
    browserDigest = readBrowserDigest();
    if (managed && !browserDigest && counts['process-empty'] === 1) {
      // The network window stays closed while the operator observes the last
      // webpage reply. No process action can arrive during this proof window.
      emit({ phase: 'process-proof-window', tunnelPaused: true, seconds: 60 });
      const proofDeadline = performance.now() + 60000;
      while (!browserDigest && performance.now() < proofDeadline) {
        await delay(150);
        browserDigest = readBrowserDigest();
      }
    }
    const proof = managed ? probe.verify(browserDigest, counts, createOperationReceipts(state).lookup(probe.stopId).status) :
      probe.verify({ openedAt, closedAt }, { browserDigest });
    const rejectedOnBrowser = ['-32074', 'The device owner revoked this operation before admission. This request did not execute.']
      .some(marker => createHash('sha256').update(marker).digest('hex') === browserDigest);
    const verified = managed ? proof.verified && counts['process-denied'] === 0 :
      append ? proof.verified && counts['append-write-forwarded'] === 1 &&
      counts['append-write-result'] === 1 && counts['append-read-forwarded'] === 1 :
      revoked ? proof.receiptState === 'owner-revoked' && proof.preparedReceipt &&
      proof.shellCalls === 0 && proof.childProof === 'missing' && counts['shell-prepared-forwarded'] === 1 &&
      counts['shell-owner-revoked'] === 1 && rejectedOnBrowser :
      proof.verified && counts[prepared ? 'shell-prepared-forwarded' : 'shell-exact-forwarded'] === 1;
    emit({ phase: managed ? 'process-evidence' : append ? 'append-evidence' : 'shell-evidence', counts, proof, persistedPause: true,
      ...(revoked ? { rejectedOnBrowser } : {}), verified });
    process.exitCode = verified ? 0 : 2;
  } finally {
    if (owner) {
      const paused = await owner.pause();
      assert.equal(paused.paused, true);
      assert.equal(paused.runtime, 'stopped');
      await owner.dispose();
    }
    assert.equal(path.dirname(scratch), temp);
    assert.equal(fs.realpathSync.native(scratch), scratch);
    assert.match(path.basename(scratch), /^ac-browser-native-start-[A-Za-z0-9]{6}$/);
    fs.rmSync(scratch, { recursive: true });
    emit({ phase: 'shell-cleanup', released: true });
  }
}

run().catch(error => {
  let reason;
  try { reason = JSON.parse(error.stdout).error; } catch { /* Never print subprocess output. */ }
  console.error(JSON.stringify({ phase: 'shell-fixture-unconfirmed', stage: phase,
    ...(typeof reason === 'string' && /^[a-z_]{1,64}$/.test(reason) ? { reason } : {}) }));
  process.exitCode = 1;
});
