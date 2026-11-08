import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { administratorBrowserPeerLaunch, openAdministratorBrowserSessionServer, openWindowsAdministratorBrowserWitness }
  from './windows-admin-browser-session.mjs';

const generation = 'a'.repeat(32), digest = 'b'.repeat(64);
const bundle = 'C:\\Program Files\\AgentContinueAdmin\\' + digest.slice(0, 24);
const origin = 'chrome-extension://' + 'c'.repeat(32) + '/';
const selectedSid = 'S-1-5-21-1-2-3-1001';
const args = { generation, bundle, origin, selectedSid };
const bounded = promise => Promise.race([promise, delay(2000).then(() => { throw new Error('fixture_timeout'); })]);

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.killed = false; child.exitCode = null;
  child.finish = code => { child.exitCode = code; child.stdout.end(); child.emit('exit', code); child.emit('close', code); };
  child.kill = () => { child.killed = true; child.finish(1); return true; };
  child.stdin.on('finish', () => child.finish(0));
  return child;
}

test('peer launch is a closed fixed PowerShell vector without path lookup or shell', () => {
  const plan = administratorBrowserPeerLaunch({ ...args, role: 'Owner' });
  assert.equal(plan.command.toLowerCase(), 'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe');
  assert.deepEqual(plan.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    bundle + '\\app\\windows-browser-peer.ps1', '-Role', 'Owner', '-Bundle', bundle, '-Origin', origin,
    '-Generation', generation, '-ExpectedSid', selectedSid]);
  assert.equal(plan.options.windowsHide, true);
  assert.equal(plan.options.shell, false);
  assert.ok(!Object.hasOwn(plan.options.env, 'NODE_OPTIONS'));
  for (const extra of [{ generation: 'invalid' }, { role: 'Command' }, { bundle: '..\\other' },
    { origin: 'https://chatgpt.com/' }]) assert.throws(() => administratorBrowserPeerLaunch({ ...args, role: 'Owner', ...extra }));
});

test('retained session server waits for LISTENING then joins helper after native stdin EOF', async t => {
  const child = fakeChild(), input = new PassThrough();
  const pending = openAdministratorBrowserSessionServer({ bundle, origin, input }, { launch: () => child });
  child.stdout.write('LISTENING\r\n');
  const session = await bounded(pending); t.after(() => session.close());
  assert.equal(session.isLive(), true);
  input.end();
  await bounded(session.finished);
  await session.close();
  assert.equal(session.isLive(), false);
  assert.equal(child.exitCode, 0);
  assert.equal(child.killed, false);
});

test('native input closure during compilation cannot leave a pending helper', async () => {
  const child = fakeChild(), input = new PassThrough();
  const pending = openAdministratorBrowserSessionServer({ bundle, origin, input }, { launch: () => child });
  input.end();
  await assert.rejects(bounded(pending), /browser_peer_unavailable/);
  assert.equal(child.exitCode, 0);
});

test('witness waits for exact helper READY and denies irreversibly on helper EOF', async t => {
  const child = fakeChild();
  const pending = openWindowsAdministratorBrowserWitness(args, { launch: () => child });
  child.stdout.write('REA');
  assert.equal(await Promise.race([pending.then(() => 'ready'), delay(20).then(() => 'waiting')]), 'waiting');
  child.stdout.write('DY\n');
  const witness = await bounded(pending); t.after(() => witness.close());
  assert.equal(witness.isLive(), true);
  child.stdout.end();
  await bounded(witness.finished);
  assert.equal(witness.isLive(), false);
  child.emit('exit', 0);
  assert.equal(witness.isLive(), false);
});

test('wrong helper output, early exit or error cannot authorize an owner', async () => {
  for (const failure of [c => c.stdout.end('READY extra\n'), c => c.finish(0),
    c => c.emit('error', new Error('fixture'))]) {
    const child = fakeChild();
    const pending = openWindowsAdministratorBrowserWitness(args, { launch: () => child });
    failure(child);
    await assert.rejects(bounded(pending), /browser_peer_unavailable/);
    assert.notEqual(child.exitCode, null);
  }
});

test('helper loss during startup and duplicated READY never permits an owner', async () => {
  for (const output of ['READY\nCLOSED\n', 'READY\nREADY\n', 'READY\nC', 'READY\u2028\n', 'x'.repeat(129)]) {
    const child = fakeChild();
    const pending = openWindowsAdministratorBrowserWitness(args, { launch: () => child });
    child.stdout.write(output);
    await assert.rejects(bounded(pending), /browser_peer_unavailable/);
  }
});

test('any helper byte after READY withdraws admission before waiting for a whole line', async t => {
  const child = fakeChild();
  const pending = openWindowsAdministratorBrowserWitness(args, { launch: () => child });
  child.stdout.write('READY\n');
  const witness = await pending; t.after(() => witness.close());
  child.stdout.write('C');
  assert.equal(witness.isLive(), false);
  await bounded(witness.finished);
});
