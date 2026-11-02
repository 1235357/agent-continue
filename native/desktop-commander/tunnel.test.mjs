import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareState, buildHostLaunch } from './runtime.mjs';

const executable = process.env.TUNNEL_CLIENT_TEST_EXE;
const here = path.dirname(fileURLToPath(import.meta.url));

test('official Windows tunnel 0.0.19 supervises the real core against a loopback-only fake control plane',
  { skip: !executable || process.platform !== 'win32', timeout: 45000 }, async t => {
    assert.ok(path.isAbsolute(executable));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
      '7e93a39a567c87154a0aef2091b81100d78f9093c4603412cc2b55bed3dfe5ea');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-tunnel-'));
    const root = path.join(scratch, 'state with spaces');
    prepareState(root, { consent: 'full-account' });
    const ownedFile = path.join(root, 'work', 'through-tunnel.txt');
    const guardLog = path.join(scratch, 'guard.log');
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent-continue-loopback-test', version: '0.1.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'write_file', arguments: { path: ownedFile, content: 'AGENT_CONTINUE_TUNNEL_OK', mode: 'rewrite' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_file', arguments: { path: ownedFile, length: 10 } } },
    ];
    const replies = [], errors = [];
    let lastResponse;
    let queued = 0, child, childExited, forwardedNotifications = 0;
    const sockets = new Set();
    const mock = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url.split('?')[0].endsWith('/poll')) {
          if (queued === null) { res.writeHead(204); res.end(); return; }
          const index = queued; queued = null;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ commands: [{ request_id: 'fixture-' + index, shard_token: 'fake-shard',
            command_type: 'jsonrpc', channel: 'main', created_at: new Date().toISOString(),
            response_timeout: '15s', jsonrpc: requests[index] }] }));
          return;
        }
        if (req.method === 'POST' && req.url.endsWith('/response')) {
          let bytes = '';
          for await (const part of req) { bytes += part; if (bytes.length > 4 * 1024 * 1024) throw new Error('oversize'); }
          const response = JSON.parse(bytes), index = replies.length, expected = requests[index];
          lastResponse = { index, requestId: response.request_id, respCode: response.resp_code, respType: response.resp_type,
            rpcId: response.resp_json?.id, rpcMethod: response.resp_json?.method, rpcErrorCode: response.resp_json?.error?.code };
          if (response.resp_type === 'jsonrpc_notify') {
            assert.equal(req.headers['x-tunnel-shard-token'], 'fake-shard');
            assert.match(response.request_id, /^fixture-[0-4]$/);
            assert.equal(response.channel, 'main');
            assert.equal(response.resp_code, 200);
            assert.equal(response.resp_json?.jsonrpc, '2.0');
            assert.equal(response.resp_json?.id, undefined);
            assert.equal(response.resp_json?.method, 'notifications/message');
            forwardedNotifications++;
            res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}'); return;
          }
          assert.ok(expected);
          assert.equal(req.headers['x-tunnel-shard-token'], 'fake-shard');
          assert.equal(response.request_id, 'fixture-' + index);
          assert.equal(response.channel, 'main');
          assert.ok([200, 202, 204].includes(response.resp_code));
          if ('id' in expected) {
            assert.equal(response.resp_json?.jsonrpc, '2.0');
            assert.equal(response.resp_json?.id, expected.id);
            assert.equal(response.resp_json?.error, undefined);
            assert.ok(response.resp_json?.result);
          } else assert.equal(response.resp_type, 'notify_ack');
          replies.push(response);
          if (replies.length < requests.length) queued = replies.length;
          res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}'); return;
        }
        res.writeHead(404); res.end();
      } catch (error) { errors.push({ code: 'fixture_response_invalid', assertion: error.message.slice(0, 180), at: lastResponse }); res.writeHead(400); res.end(); }
    });
    mock.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      if (child && child.exitCode === null) { child.kill(); await childExited; }
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => mock.close(resolve));
      fs.rmSync(scratch, { recursive: true, force: true });
    });
    const system = process.env.SystemRoot;
    const parentEnv = { SystemRoot: system, WINDIR: system, ComSpec: path.join(system, 'System32', 'cmd.exe'),
      PATH: [path.dirname(process.execPath), path.join(system, 'System32'), path.join(system, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD', AGENT_CONTINUE_TEST_GUARD_LOG: guardLog };
    const launch = buildHostLaunch(root, parentEnv);
    // The official client parses a command string, not an arbitrary argv array.
    // Forward slashes avoid POSIX-style quote parsing consuming Windows separators.
    const quote = value => {
      if (/["\r\n\0]/.test(value)) throw new Error('invalid_test_command');
      return '"' + value.replaceAll('\\', '/') + '"';
    };
    const command = [process.execPath, '--import', pathToFileURL(path.join(here, 'test-fixtures', 'startup-guard.mjs')).href, ...launch.args].map(quote).join(' ');
    const args = ['run', '--control-plane.base-url', 'http://127.0.0.1:' + mock.address().port,
      '--control-plane.tunnel-id', 'tunnel_0123456789abcdef0123456789abcdef',
      '--control-plane.api-key', 'env:AGENT_CONTINUE_FAKE_KEY', '--mcp.command', command,
      '--health.listen-addr', '127.0.0.1:0', '--mcp.stdio-failure-policy', 'exit',
      '--log.level', 'warn', '--log.file', path.join(scratch, 'tunnel.log')];
    child = spawn(executable, args, { cwd: launch.cwd, env: { ...launch.env, AGENT_CONTINUE_FAKE_KEY: 'not-a-real-key' },
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrBytes = 0;
    child.stderr.on('data', data => { stderrBytes += data.length; });
    childExited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + 30000;
    while (replies.length < requests.length && Date.now() < deadline && child.exitCode === null && errors.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (errors.length || replies.length !== requests.length) t.diagnostic(JSON.stringify({ received: replies.length, errors, lastResponse, exitCode: child.exitCode, stderrBytes }));
    assert.equal(errors.length, 0);
    assert.equal(replies.length, requests.length, 'all correlated tunnel responses required');
    assert.equal(replies[0].resp_json.result.serverInfo.version, '0.3.1');
    const toolNames = replies[2].resp_json.result.tools.map(tool => tool.name);
    for (const name of ['read_file', 'write_file', 'start_process']) assert.ok(toolNames.includes(name));
    assert.notEqual(replies[3].resp_json.result.isError, true);
    assert.notEqual(replies[4].resp_json.result.isError, true);
    assert.equal(fs.readFileSync(ownedFile, 'utf8'), 'AGENT_CONTINUE_TUNNEL_OK');
    assert.match(JSON.stringify(replies[4].resp_json.result.content), /AGENT_CONTINUE_TUNNEL_OK/);
    child.kill(); await childExited;
    const exitDeadline = Date.now() + 5000;
    while (!fs.readFileSync(guardLog, 'utf8').includes('guard-exit') && Date.now() < exitDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const events = fs.readFileSync(guardLog, 'utf8').trim().split('\n');
    assert.ok(events.includes('guard-exit'), 'host exit hook required; the outer owned Job verifies actual process-tree exit');
    for (const name of ['network-attempt', 'browser-attempt', 'visible-child-attempt']) assert.equal(events.includes(name), false, name);
    t.diagnostic(JSON.stringify({ loopbackOnlyMock: true, productionCredentials: false, tunnelVersion: '0.0.19',
      upstream: '0.3.1', tools: toolNames.length, correlatedResponses: replies.length, fileRoundtrip: true,
      forwardedNotifications, realOpenAITunnelTested: false, realChatGrantTested: false, stderrBytes }));
  });
