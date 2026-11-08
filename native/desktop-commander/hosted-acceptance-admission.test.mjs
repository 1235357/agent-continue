import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostedAcceptanceAdmission } from './hosted-acceptance-admission.mjs';
import { prepareHostedShellProbe } from '../../scripts/hosted-read-acceptance.mjs';

const id = () => randomBytes(16).toString('hex');
function temporary(t, prefix = 'ac-admission-') {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}
const reply = { content: [{ type: 'text', text: 'real provider result' }] };

test('admission is exact, ordered, exclusive, and durable', async t => {
  const dir = path.join(temporary(t), 'receipts');
  const a = { id: id(), name: 'write_file', arguments: { path: 'fixture', content: 'one' } };
  const b = { id: id(), name: 'read_file', arguments: { path: 'fixture', length: 10 } };
  const gate = createHostedAcceptanceAdmission([a, b], dir);
  let started, finish;
  const first = new Promise(resolve => { started = resolve; });
  const pending = gate.call({ name: a.name, arguments: { content: 'one', path: 'fixture' } }, params => {
    assert.deepEqual(params.arguments, a.arguments);
    assert.ok(fs.existsSync(path.join(dir, a.id + '.admitted')));
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  await first;
  const unexpected = () => assert.fail('unplanned forwarding');
  assert.equal((await gate.call(a, unexpected)).isError, true);
  assert.equal((await gate.call(b, unexpected)).isError, true);
  finish(reply);
  assert.deepEqual(await pending, reply);
  assert.equal((await gate.call(a, unexpected)).isError, true);
  assert.equal((await gate.call({ ...b, arguments: { ...b.arguments, isUrl: true } }, unexpected)).isError, true);
  assert.deepEqual(await gate.call(b, () => reply), reply);
  assert.deepEqual(fs.readdirSync(dir).sort(), [a.id, b.id].flatMap(value => [value + '.admitted', value + '.provider-replied']).sort());
  assert.throws(() => createHostedAcceptanceAdmission([a, b], dir), { code: 'EEXIST' });
});

test('an uncertain result locks the scope and does not admit a successor', async t => {
  const dir = path.join(temporary(t), 'receipts');
  const a = { id: id(), name: 'read_file', arguments: { path: 'one' } };
  const b = { id: id(), name: 'read_file', arguments: { path: 'two' } };
  const gate = createHostedAcceptanceAdmission([a, b], dir);
  assert.equal((await gate.call(a, () => { throw new Error('secret upstream path'); })).isError, true);
  assert.equal((await gate.call(b, () => assert.fail())).isError, true);
  assert.deepEqual(fs.readdirSync(dir), [a.id + '.admitted']);
});

const extracted = process.env.AC_WINDOWS_ADMIN_BUNDLE_SMOKE_ROOT;
test('an exact acceptance plan forwards actual Windows file and PowerShell calls', { skip: !extracted, timeout: 60000 }, async t => {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.AC_WINDOWS_ADMIN_BUNDLE_SMOKE, 'accept-disposable-standard-token-test');
  assert.equal(path.dirname(extracted), fs.realpathSync.native(os.tmpdir()));
  assert.match(path.basename(extracted), /^ac-admin-smoke-[a-f0-9]{32}$/);
  const app = path.join(extracted, 'app');
  const node = path.join(extracted, 'runtime', 'node.exe');
  const { prepareState } = await import(pathToFileURL(path.join(app, 'runtime.mjs')).href);
  const sdk = name => import(pathToFileURL(path.join(app, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', name)).href);
  const [{ Client }, { StdioClientTransport }] = await Promise.all([sdk('client/index.js'), sdk('client/stdio.js')]);
  const stateRoot = path.join(temporary(t, 'ac-browser-native-start-'), 'device', 'state');
  fs.mkdirSync(path.dirname(stateRoot));
  prepareState(stateRoot, { consent: 'full-account' });
  fs.writeFileSync(path.join(stateRoot, 'startup-imports.mjs'), 'delete process.env.AC_ADMIN_BOOT_APP_ROOT;\n');
  const work = path.join(stateRoot, 'work');
  const target = path.join(work, 'accepted.txt');
  const outside = path.join(work, 'denied.txt');
  const marker = id();
  const write = { id: id(), name: 'write_file', arguments: { path: target, content: marker, mode: 'rewrite' } };
  const read = { id: id(), name: 'read_file', arguments: { path: target, length: 10 } };
  const probe = prepareHostedShellProbe(stateRoot, { exact: true, expectedWindowsToken: 'standard' });
  const shell = { id: id(), name: probe.tool, arguments: probe.request };
  const receiptDir = path.join(stateRoot, 'acceptance-receipts');
  const config = { bundle: extracted, stateRoot, steps: [write, read, shell], receiptDir };
  const script = `import(${JSON.stringify(new URL('./hosted-acceptance-admission.mjs', import.meta.url).href)}).then(m=>m.runHostedAcceptanceStdio(${JSON.stringify(config)})).catch(()=>{process.exitCode=1;});`;
  const system = path.join(process.env.SystemRoot, 'System32');
  const client = new Client({ name: 'owner-acceptance-test', version: '1.0.0' });
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot,
    PATH: [path.dirname(node), system, path.join(system, 'WindowsPowerShell', 'v1.0')].join(';'),
    AC_ADMIN_BOOT_APP_ROOT: app };
  const transport = new StdioClientTransport({ command: node, args: ['--eval', script], cwd: work, env, stderr: 'pipe' });
  transport.stderr?.resume();
  try {
    await client.connect(transport, { timeout: 15000 });
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [write.name, read.name, shell.name].sort());
    assert.equal((await client.callTool(read)).isError, true);
    assert.equal((await client.callTool({ name: write.name, arguments: { ...write.arguments, path: outside } })).isError, true);
    assert.equal(fs.existsSync(outside), false);
    assert.notEqual((await client.callTool(write)).isError, true);
    assert.equal(fs.readFileSync(target, 'utf8'), marker);
    assert.match(JSON.stringify((await client.callTool(read)).content), new RegExp(marker));
    assert.equal((await client.callTool(write)).isError, true);
    const openedAt = Date.now();
    const result = await client.callTool(shell);
    assert.notEqual(result.isError, true);
    const proof = JSON.stringify(result.content).match(/AC_WEB_SHELL_([a-f0-9]{32})/);
    assert.ok(proof, 'actual provider returned a fresh PowerShell marker');
    const browserDigest = createHash('sha256').update(proof[0], 'ascii').digest('hex');
    let evidence;
    for (let i = 0; i < 30; i++) {
      evidence = probe.verify({ openedAt, closedAt: Date.now() }, { browserDigest });
      if (evidence.verified) break;
      await delay(100);
    }
    assert.equal(evidence.verified, true);
    assert.equal(fs.readdirSync(receiptDir).length, 6);
    t.diagnostic(JSON.stringify({ actualWindowsProvider: true, exactFileCalls: true, standardChildTokenVerified: true,
      outsideWriteDenied: true, replayDenied: true, liveHosted: false }));
  } finally { await client.close(); }
});
