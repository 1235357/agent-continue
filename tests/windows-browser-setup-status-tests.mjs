import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { serveAdministratorBrowser, createAdministratorBrowserActions } from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

const setupId = 'a'.repeat(32), digest = 'b'.repeat(64), target = 'c'.repeat(32) + ':idle';
const origin = 'chrome-extension://' + 'd'.repeat(32) + '/';
const binding = { version: 1, origin, bundleSha256: digest, systemDirectory: 'C:\\Windows\\System32' };
const root = 'C:\\Program Files\\AgentContinueAdmin\\' + digest.slice(0, 24);
const request = () => ({ version: 1, id: randomUUID(), action: 'setup-status', setupId });
const unknown = () => ({ setupId, state: 'unconfirmed', bundleSha256: null, target: null });
const installed = () => ({ setupId, state: 'installed', bundleSha256: digest, target });
const forbidden = () => assert.fail('setup observation must not start, install, pause or fall back');

async function framed(req, readSetupStatus, args = [origin]) {
  const input = new PassThrough(), output = new PassThrough();
  try {
    await writeFrame(input, req);
    await serveAdministratorBrowser({ input, output, args, origin, readSetupStatus,
      start: forbidden, openSession: forbidden, readStatus: forbidden, readPauseSupport: forbidden,
      requestPause: forbidden, readControlSupport: forbidden, requestControl: forbidden });
    return await readFrame(output, 4000);
  } finally { input.destroy(); output.destroy(); }
}

test('setup-status routes only the setup ID and returns exact correlated projections', async () => {
  for (const result of [unknown(), installed()]) {
    const req = request(), calls = [];
    assert.deepEqual(await framed(req, value => { calls.push(value); return result; }), { ...req, ...result });
    assert.deepEqual(calls, [setupId]);
  }
});

test('setup-status rejects malformed requests before dispatch and binds actual native origin', async () => {
  const req = request();
  for (const value of [null, 1, {}, [], '', setupId.toUpperCase(), setupId + '\n', setupId.slice(1), randomUUID()]) {
    await assert.rejects(framed({ ...req, setupId: value }, forbidden), /browser_request/);
  }
  for (const key of Object.keys(req)) {
    const bad = { ...req }; delete bad[key];
    await assert.rejects(framed(bad, forbidden), /browser_request/);
  }
  for (const extra of ['origin', 'bundleSha256', 'target', 'command', 'userSid', 'consent']) {
    await assert.rejects(framed({ ...req, [extra]: 'injected' }, forbidden), /browser_request/);
  }
  for (const id of ['old-id', setupId, req.id + '\n', null, 1]) {
    await assert.rejects(framed({ ...req, id }, forbidden), /browser_request/);
  }
  await assert.rejects(framed(req, forbidden, [origin.replace('d', 'e')]), /browser_origin/);
});

test('setup-status callback failures and malformed projections fail closed without leaking fields', async () => {
  const req = request();
  for (const result of [null, {}, [], { ...installed(), setupId: 'e'.repeat(32) },
    { ...installed(), bundleSha256: digest.toUpperCase() }, { ...installed(), target: target + '\n' },
    { ...installed(), target: null }, { ...installed(), privateKey: 'secret' },
    { ...unknown(), target }, { ...unknown(), bundleSha256: digest }, { ...installed(), state: 'ready' }]) {
    assert.deepEqual(await framed(req, () => result), { ...req, ...unknown() });
  }
  assert.deepEqual(await framed(req, () => { throw new Error('private'); }), { ...req, ...unknown() });
  assert.deepEqual(await framed(req, undefined), { ...req, ...unknown() });
});

test('readSetupStatus invokes only the fast read-only stager with binding-owned extension ID', async () => {
  const calls = [];
  const actions = createAdministratorBrowserActions(root, binding, async (...args) => {
    calls.push(args); return { stdout: JSON.stringify(installed()) };
  });
  assert.equal(typeof actions.readSetupStatus, 'function');
  assert.deepEqual(await actions.readSetupStatus(setupId), installed());
  const [exe, argv, options] = calls[0];
  assert.equal(exe, binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(argv, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
    '-Action', 'ObserveBrowserSetup', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest,
    '-BrowserSetupId', setupId, '-BrowserExtensionId', 'd'.repeat(32)]);
  assert.equal(options.windowsHide, true);
  assert.ok(options.timeout > 0 && options.timeout <= 20000);
  assert.equal(calls.length, 1);
  for (const bad of ['', setupId + '\n', setupId.toUpperCase(), {}, null]) {
    await assert.rejects(actions.readSetupStatus(bad));
  }
  assert.equal(calls.length, 1);
});

test('readSetupStatus denies mismatched digest, extra fields, process and JSON failures without retry', async () => {
  for (const result of [{ ...installed(), bundleSha256: 'f'.repeat(64) }, { ...installed(), origin },
    { ...installed(), setupId: 'e'.repeat(32) }, { ...unknown(), target }, null, 'bad']) {
    let calls = 0;
    const actions = createAdministratorBrowserActions(root, binding, async () => {
      calls++; return { stdout: result === 'bad' ? 'PRIVATE' : JSON.stringify(result) };
    });
    assert.deepEqual(await actions.readSetupStatus(setupId), unknown());
    assert.equal(calls, 1);
  }
  let calls = 0;
  const actions = createAdministratorBrowserActions(root, binding, async () => { calls++; throw new Error('denied'); });
  assert.deepEqual(await actions.readSetupStatus(setupId), unknown());
  assert.equal(calls, 1);
});
