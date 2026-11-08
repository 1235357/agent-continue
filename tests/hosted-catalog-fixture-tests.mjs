import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { buildHostLaunch, prepareState } from '../native/desktop-commander/runtime.mjs';
import { catalogAuditFile, hostedCanaryGate, instrumentCatalogHost, summarizeCatalogAudit } from './hosted-catalog-fixture.mjs';

function hostDiagnostics() {
  const limit = 4096;
  let stderr = Buffer.alloc(0), bytes = 0;
  return {
    capture(chunk) {
      chunk = Buffer.from(chunk);
      bytes = Math.min(limit + 1, bytes + chunk.length);
      if (stderr.length < limit) stderr = Buffer.concat([stderr, chunk.subarray(0, limit - stderr.length)]);
    },
    summary(child) {
      const text = stderr.toString('utf8');
      const labels = [
        ['reviewed host anchor must appear exactly once', 'reviewed-anchor-mismatch'],
        ['agent_continue_native_start_failed', 'native-start-failed'],
        ['ERR_MODULE_NOT_FOUND', 'module-not-found'],
        ['ERR_UNSUPPORTED_RESOLVE_REQUEST', 'unsupported-resolve-request'],
        ['SyntaxError', 'syntax-error'],
      ].filter(([match]) => text.includes(match)).map(([, label]) => label);
      return JSON.stringify({ exitCode: Number.isInteger(child.exitCode) ? child.exitCode : null,
        signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(child.signalCode) ? child.signalCode : null,
        stderrBytes: bytes, stderrTruncated: bytes > limit, labels });
    },
  };
}

test('host diagnostics are bounded and never echo raw stderr, paths, commands, or credentials', () => {
  const diagnostic = hostDiagnostics();
  diagnostic.capture(Buffer.from('reviewed host anchor must appear '));
  diagnostic.capture(Buffer.from('exactly once\nprivate-token private-command C:\\private\\path\n'));
  diagnostic.capture(Buffer.alloc(8192, 120));
  diagnostic.capture(Buffer.from('agent_continue_native_start_failed'));
  const summary = diagnostic.summary({ exitCode: 1, signalCode: 'private-signal' });
  assert.deepEqual(JSON.parse(summary), { exitCode: 1, signal: null, stderrBytes: 4097,
    stderrTruncated: true, labels: ['reviewed-anchor-mismatch'] });
  assert.ok(summary.length < 256);
  assert.doesNotMatch(summary, /private|xxxx|native-start-failed/);
  assert.deepEqual(JSON.parse(hostDiagnostics().summary({ exitCode: null, signalCode: 'SIGTERM' })), {
    exitCode: null, signal: 'SIGTERM', stderrBytes: 0, stderrTruncated: false, labels: [],
  });
});

test('catalog instrumentation accepts the current host without replacing its delivery cleanup', async () => {
  const source = await fs.readFile(new URL('../native/desktop-commander/host.mjs', import.meta.url), 'utf8');
  const instrumented = instrumentCatalogHost(source);
  const deliveryStart = source.indexOf('      let delivery;');
  const deliveryEnd = source.indexOf('      return await delivery;', deliveryStart);
  assert.ok(deliveryStart !== -1 && deliveryEnd > deliveryStart);
  assert.ok(instrumented.includes(source.slice(deliveryStart, deliveryEnd)));
  assert.ok(instrumented.includes('} finally { flushing--; }'));
  for (const prepared of [false, true]) {
    for (const ending of ['\n', '\r\n']) {
      assert.doesNotThrow(() => instrumentCatalogHost(source.replace(/\r?\n/g, ending), { prepared }));
    }
  }
  for (const anchor of ['      let delivery;', '      return await delivery;', '    } finally { flushing--; }']) {
    assert.throws(() => instrumentCatalogHost(source.replace(anchor, '')), /reviewed host anchor/);
    assert.throws(() => instrumentCatalogHost(source + '\n' + anchor), /reviewed host anchor/);
  }
});

test('catalog trace rejects unexpected content and an unreviewed host', () => {
  assert.throws(() => summarizeCatalogAudit('unexpected value\n'), /unexpected catalog/);
  assert.throws(() => summarizeCatalogAudit('initialize\n'.repeat(400)), /exceeds fixture limit/);
  assert.throws(() => instrumentCatalogHost('different host'), /reviewed host anchor/);
});

test('hosted canary gates distinguish discovery, actual invocation, and replay', () => {
  const digest = 'a'.repeat(64);
  const counts = labels => summarizeCatalogAudit(labels.join('\n'));
  const discovery = counts(['initialize', 'initialize', 'list-request', 'list-canary']);
  const invoked = counts(['initialize', 'canary-response']);
  assert.equal(hostedCanaryGate('discovery', discovery), true);
  assert.equal(hostedCanaryGate('invocation', discovery, digest, digest), false);
  assert.equal(hostedCanaryGate('discovery', invoked), false);
  assert.equal(hostedCanaryGate('invocation', invoked, digest, digest), true);
  assert.equal(hostedCanaryGate('invocation', invoked, digest, 'b'.repeat(64)), false);
  assert.equal(hostedCanaryGate('invocation', invoked, digest, null), false);
  for (const label of ['canary-response', 'canary-denied', 'list-error', 'list-send-failed']) {
    assert.equal(hostedCanaryGate('invocation', counts(['initialize', 'canary-response', label]), digest, digest), false);
  }
});

for (const mode of ['shell', 'append']) test('instrumented pinned host allows only the reviewed ' + mode + ' sequence', { timeout: 20000 }, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-catalog-positive-'));
  const root = path.join(scratch, 'state');
  let child, closed, timer;
  try {
    prepareState(root, { consent: 'full-account' });
    const env = { ...process.env };
    if (process.platform === 'win32') env.PATH = [path.dirname(process.execPath),
      path.join(process.env.SystemRoot, 'System32')].join(';');
    const launch = buildHostLaunch(root, env);
    const tool = 'agent_continue_start_process_exact';
    const command = process.platform === 'win32' ? 'Write-Output AC_GUARD_OK' : 'printf AC_GUARD_OK';
    const shell = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe').replaceAll('\\', '/') : '/bin/sh';
    const timeout_ms = 10000;
    const exact = { command, shell, timeout_ms, agent_continue_operation_id: 'c9189a67-b50a-4c58-8a0f-920ad80b8ddd',
      agent_continue_process_sha256: createHash('sha256').update(JSON.stringify([command, shell, timeout_ms])).digest('hex') };
    const file = path.join(root, 'work', 'append.txt');
    const write = {path: file, content: 'FIXTURE_APPEND', mode: 'append',
      agent_continue_operation_id: exact.agent_continue_operation_id};
    const read = {path: file, length: 10};
    if (mode === 'append') await fs.writeFile(file, 'FIXTURE_BASE\n', {flag: 'wx'});
    const instrument = mode === 'append' ? { append: {write, read} } : { shellRequest: exact };
    const target = new URL('../native/desktop-commander/host.mjs', import.meta.url).href;
    const preload = `
      import { registerHooks } from 'node:module';
      import { instrumentCatalogHost } from ${JSON.stringify(new URL('./hosted-catalog-fixture.mjs', import.meta.url).href)};
      registerHooks({ load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (url !== ${JSON.stringify(target)}) return loaded;
        return { ...loaded, source: instrumentCatalogHost(Buffer.from(loaded.source).toString('utf8'),
          ${JSON.stringify(instrument)}) };
      } });`;
    const diagnostic = hostDiagnostics();
    child = spawn(launch.command, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), ...launch.args],
      { ...launch, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', diagnostic.capture);
    closed = once(child, 'close');
    const lines = createInterface({ input: child.stdout });
    const send = (method, id, params = {}) => child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', ...(id == null ? {} : { id }), method, params,
    }) + '\n');
    const replies = (async () => {
      for await (const line of lines) {
        const reply = JSON.parse(line);
        if (reply.id === 1) {
          assert.ok(reply.result?.serverInfo);
          send('notifications/initialized');
          send('tools/list', 2);
        }
        if (reply.id === 2) {
          assert.ok(reply.result?.tools.some(item => item.name === tool));
          send('tools/call', 3, { name: 'read_file', arguments: mode === 'append' ? read : {} });
        } else if (reply.id === 3) {
          assert.equal(reply.error?.code, -32079);
          send('tools/call', 4, mode === 'append' ? { name: 'write_file', arguments: {...write, path: file + '.other'} } :
            { name: tool, arguments: { ...exact, command: 'UNAPPROVED_VALUE' } });
        } else if (reply.id === 4) {
          assert.equal(reply.error?.code, -32079);
          send('tools/call', 5, mode === 'append' ? { name: 'write_file', arguments: write } : { name: tool, arguments: exact });
        } else if (reply.id === 5) {
          if (mode === 'shell') return reply.result;
          assert.equal(reply.error, undefined);
          assert.notEqual(reply.result?.isError, true);
          send('tools/call', 6, { name: 'write_file', arguments: write });
        } else if (reply.id === 6) {
          assert.equal(reply.error?.code, -32079);
          send('tools/call', 7, { name: 'read_file', arguments: read });
        } else if (reply.id === 7) {
          assert.match(JSON.stringify(reply.result?.content), /FIXTURE_BASE.*FIXTURE_APPEND/);
          send('tools/call', 8, { name: 'read_file', arguments: read });
        } else if (reply.id === 8) {
          assert.equal(reply.error?.code, -32079);
          return reply;
        }
      }
      await closed;
      assert.fail('host exited before completing the reviewed sequence: ' + diagnostic.summary(child));
    })();
    send('initialize', 1, { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'catalog-positive-control', version: '1.0.0' } });
    const listed = await Promise.race([replies, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('catalog positive control timed out: ' + diagnostic.summary(child))), 12000);
    })]);
    if (mode === 'shell') assert.match(JSON.stringify(listed?.content), /AC_GUARD_OK/);
    else {
      assert.equal(await fs.readFile(file, 'utf8'), 'FIXTURE_BASE\nFIXTURE_APPEND');
      await assert.rejects(fs.access(file + '.other'), {code: 'ENOENT'});
    }
    child.stdin.end();
    assert.deepEqual(await closed, [0, null]);
    const events = await fs.readFile(path.join(root, catalogAuditFile), 'utf8');
    assert.deepEqual(events.trim().split('\n'), ['initialize', 'list-request', 'list-exact', 'list-prepared', ...(mode === 'append' ?
      ['append-denied', 'append-denied', 'append-write-forwarded', 'append-write-result', 'append-denied', 'append-read-forwarded', 'append-denied'] : [
      'shell-request-denied', 'shell-other-tool', 'shell-argument-shape', 'shell-request-denied',
      'shell-mismatch-command', 'shell-exact-forwarded'])]);
    assert.doesNotMatch(events, /UNAPPROVED_VALUE|AC_GUARD_OK|c9189a67|FIXTURE_/);
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await closed?.catch(() => {});
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
    assert.match(path.basename(scratch), /^ac-catalog-positive-/);
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
