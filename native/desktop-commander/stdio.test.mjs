import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareState, buildHostLaunch } from './runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('real pinned core initializes, lists tools, writes/reads an owned file and executes a harmless process',
  { timeout: 60000 }, async t => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-stdio-'));
    const root = path.join(scratch, 'state with spaces');
    prepareState(root, { consent: 'full-account' });
    const guardLog = path.join(scratch, 'guard.log');
    const env = { ...process.env, AGENT_CONTINUE_TEST_GUARD_LOG: guardLog };
    // Avoid WindowsApps Python aliases and unrelated developer PATH executables in discovery.
    if (process.platform === 'win32') env.PATH = [path.dirname(process.execPath),
      path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
    const launch = buildHostLaunch(root, env);
    const child = spawn(launch.command, ['--import', pathToFileURL(path.join(here, 'test-fixtures', 'startup-guard.mjs')).href, ...launch.args],
      { ...launch, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderrBytes = 0, buffer = '', protocolErrors = 0, id = 0;
    const waiting = new Map();
    const exited = new Promise(resolve => child.once('exit', (code, signal) => {
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('host_exit_' + code)); }
      waiting.clear(); resolve({ code, signal });
    }));
    async function waitForExit() {
      let timer;
      try { return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]); }
      finally { clearTimeout(timer); }
    }
    child.stderr.on('data', data => { stderrBytes += data.length; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 4 * 1024 * 1024) { protocolErrors++; child.kill(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const reply = JSON.parse(line);
          if (reply.jsonrpc !== '2.0') throw new Error('bad_rpc');
          if ('id' in reply && waiting.has(reply.id)) {
            const pending = waiting.get(reply.id); waiting.delete(reply.id); clearTimeout(pending.timer);
            if (reply.error) pending.reject(new Error('rpc_error')); else pending.resolve(reply.result);
          }
        } catch { protocolErrors++; }
      }
    });
    t.after(async () => {
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('test_closed')); }
      waiting.clear(); child.stdin.end();
      const stopped = await waitForExit();
      if (!stopped) { child.kill(); await exited; }
      fs.rmSync(scratch, { recursive: true, force: true });
    });
    function send(method, params) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('rpc_timeout_' + method)); }, 25000);
        waiting.set(requestId, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
      });
    }
    const initialized = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'agent-continue-isolated-test', version: '0.1.0' } });
    assert.equal(initialized.serverInfo.name, 'desktop-commander');
    assert.equal(initialized.serverInfo.version, '0.3.1');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await send('tools/list', {});
    const names = listed.tools.map(tool => tool.name);
    for (const name of ['write_file', 'read_file', 'start_process', 'read_process_output', 'force_terminate']) assert.ok(names.includes(name), name);
    const ownedFile = path.join(root, 'work', 'harmless.txt');
    const written = await send('tools/call', { name: 'write_file', arguments: { path: ownedFile, content: 'AGENT_CONTINUE_FILE_OK', mode: 'rewrite' } });
    assert.notEqual(written.isError, true);
    assert.equal(fs.readFileSync(ownedFile, 'utf8'), 'AGENT_CONTINUE_FILE_OK');
    const read = await send('tools/call', { name: 'read_file', arguments: { path: ownedFile, length: 10 } });
    assert.notEqual(read.isError, true);
    assert.match(JSON.stringify(read.content), /AGENT_CONTINUE_FILE_OK/);
    const command = process.platform === 'win32' ? 'Write-Output AGENT_CONTINUE_PROCESS_OK' : 'printf AGENT_CONTINUE_PROCESS_OK';
    const shell = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';
    const executed = await send('tools/call', { name: 'start_process', arguments: { command, shell, timeout_ms: 10000 } });
    assert.notEqual(executed.isError, true);
    assert.match(JSON.stringify(executed.content), /AGENT_CONTINUE_PROCESS_OK/);
    assert.equal(protocolErrors, 0);
    child.stdin.end();
    const stopped = await waitForExit();
    assert.deepEqual(stopped, { code: 0, signal: null });
    const events = fs.readFileSync(guardLog, 'utf8').trim().split('\n');
    assert.ok(events.includes('guard-loaded'));
    assert.ok(events.includes('hidden-child'));
    for (const event of ['network-attempt', 'browser-attempt', 'visible-child-attempt']) assert.equal(events.includes(event), false, event);
    t.diagnostic(JSON.stringify({ upstream: initialized.serverInfo.version, tools: names.length,
      rpcReplies: id, protocolErrors, hostNetworkAttempts: events.filter(x => x === 'network-attempt').length,
      directBrowserAttempts: events.filter(x => x === 'browser-attempt').length, stderrBytes,
      fileRoundtrip: true, harmlessProcess: true, stdinCloseExit: stopped.code }));
  });
