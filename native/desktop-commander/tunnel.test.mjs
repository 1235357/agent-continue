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
import { buildTunnelLaunch, profileEnvironment } from './profile.mjs';
import { openController } from './lifecycle.mjs';
import { observeCore, hasExited } from './process-observation.mjs';

const executable = process.env.TUNNEL_CLIENT_TEST_EXE;
const here = path.dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(fs.readFileSync(new URL('./tunnel-pins.json', import.meta.url), 'utf8'));

for (const mode of ['arguments', 'generated-profile', 'owned-lifecycle']) test('official ' + process.platform + ' tunnel 0.0.19 supervises the real core via ' + mode + ' against a loopback-only fake control plane',
  { skip: !executable || !pins.platforms[process.platform + '-' + process.arch], timeout: 45000 }, async t => {
    assert.ok(path.isAbsolute(executable));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
      pins.platforms[process.platform + '-' + process.arch].executableSha256);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-tunnel-'));
    const root = path.join(scratch, "state, with spaces's $literal");
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
    let queued = 0, child, childExited, controller, forwardedNotifications = 0, mockRequests = 0, mockConnections = 0;
    let ownedStarts = 0, controllerReady = false, pauseCycleVerified = false;
    const cores = [];
    const sockets = new Set();
    const mock = http.createServer(async (req, res) => {
      mockRequests++;
      try {
        if (req.method === 'GET' && req.url.split('?')[0].endsWith('/poll')) {
          if (mode !== 'arguments') assert.equal(req.headers.authorization, 'Bearer not-a-real-key-from-file');
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
    mock.on('connection', socket => { mockConnections++; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await childExited; }
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => mock.close(resolve));
      // Windows can retain the child's working-directory handle briefly after
      // its parent exits. Retry owned fixture cleanup, not any MCP operation.
      await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const system = process.env.SystemRoot;
    const parentEnv = process.platform === 'win32' ? { SystemRoot: system, WINDIR: system, ComSpec: path.join(system, 'System32', 'cmd.exe'),
      PATH: [path.dirname(process.execPath), path.join(system, 'System32'), path.join(system, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD', AGENT_CONTINUE_TEST_GUARD_LOG: guardLog }
      : { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C.UTF-8', AGENT_CONTINUE_TEST_GUARD_LOG: guardLog };
    const launch = buildHostLaunch(root, parentEnv);
    // The official client parses a command string, not an arbitrary argv array.
    // Forward slashes avoid POSIX-style quote parsing consuming Windows separators.
    const quote = value => {
      if (/["\r\n\0]/.test(value)) throw new Error('invalid_test_command');
      return '"' + value.replaceAll('\\', '/') + '"';
    };
    const command = [process.execPath, '--import', pathToFileURL(path.join(here, 'test-fixtures', 'startup-guard.mjs')).href, ...launch.args].map(quote).join(' ');
    let args = ['run', '--control-plane.base-url', 'http://127.0.0.1:' + mock.address().port,
      '--control-plane.tunnel-id', 'tunnel_0123456789abcdef0123456789abcdef',
      '--control-plane.api-key', 'env:AGENT_CONTINUE_FAKE_KEY', '--mcp.command', command,
      '--health.listen-addr', '127.0.0.1:0', '--mcp.stdio-failure-policy', 'exit',
      '--log.level', 'warn', '--log.file', path.join(scratch, 'tunnel.log')];
    let childEnv = { ...launch.env, AGENT_CONTINUE_FAKE_KEY: 'not-a-real-key' };
    if (mode !== 'arguments') {
      const key = path.join(scratch, 'runtime.key');
      fs.writeFileSync(key, 'not-a-real-key-from-file', { mode: 0o600 });
      const setup = spawn(process.execPath, [path.join(here, 'setup-cli.mjs'), 'configure', '--state-dir', root,
        '--tunnel-id', 'tunnel_0123456789abcdef0123456789abcdef', '--runtime-key-file', key, '--tunnel-client', executable],
        { cwd: launch.cwd, env: profileEnvironment(root, parentEnv), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let setupOut = '', setupErr = '';
      const setupTimer = setTimeout(() => setup.kill(), 10000);
      setup.stdout.on('data', bytes => { setupOut += bytes; if (setupOut.length > 65536) setup.kill(); });
      setup.stderr.on('data', bytes => { setupErr += bytes; if (setupErr.length > 65536) setup.kill(); });
      const setupExit = await new Promise((resolve, reject) => {
        setup.once('close', code => { clearTimeout(setupTimer); resolve(code); });
        setup.once('error', error => { clearTimeout(setupTimer); reject(error); });
      });
      assert.equal(setupExit, 0);
      assert.equal(setupErr, '');
      assert.deepEqual(JSON.parse(setupOut), { ok: true, configured: true, activated: false, authenticationVerified: false });
      assert.equal(mockConnections, 0, 'configure must not connect to the loopback fixture');
      assert.equal(mockRequests, 0, 'configure must not contact the loopback fixture');
      assert.equal(replies.length, 0);
      const generated = buildTunnelLaunch(root, { ...parentEnv, OPEN_WEB_UI: 'true', HEALTH_LISTEN_ADDR: '0.0.0.0:8080',
        CONTROL_PLANE_BASE_URL: 'https://example.invalid', MCP_COMMAND: 'unexpected', LOG_HTTP_RAW_UNSAFE: 'true' });
      args = [...generated.args, '--control-plane.base-url', 'http://127.0.0.1:' + mock.address().port];
      childEnv = generated.env;
    }
    let stderrBytes = 0;
    function startClient(command, argv, options) {
      child = spawn(command, argv, options);
      child.stderr.on('data', data => { stderrBytes += data.length; });
      childExited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      return child;
    }
    if (mode === 'owned-lifecycle') {
      const before = fs.readFileSync(path.join(root, 'tunnel.yaml'));
      controller = openController(root, {
        spawn(command, argv, options) {
          ownedStarts++;
          return startClient(command, [...argv, '--control-plane.base-url', 'http://127.0.0.1:' + mock.address().port], { ...options, env: childEnv });
        },
        async observeCore(parent, node) {
          const identity = await observeCore(parent, node);
          if (identity) cores.push(identity);
          return identity;
        },
      });
      const connected = await controller.reconnect();
      assert.equal(connected.runtime, 'running'); assert.equal(connected.ready, true);
      assert.equal(connected.chatAuthorization, 'not-observed');
      assert.deepEqual(fs.readFileSync(path.join(root, 'tunnel.yaml')), before);
      controllerReady = true;
    } else startClient(executable, args, { cwd: launch.cwd, env: childEnv,
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
    let loopbackReadyVerified = false;
    if (mode === 'generated-profile') {
      const address = new URL(fs.readFileSync(path.join(root, 'health.url'), 'utf8').trim());
      assert.equal(address.protocol, 'http:'); assert.equal(address.hostname, '127.0.0.1');
      assert.equal(address.username, ''); assert.equal(address.password, '');
      const ready = await fetch(new URL('/readyz', address), { signal: AbortSignal.timeout(3000) });
      assert.equal(ready.status, 200);
      loopbackReadyVerified = true;
    }
    if (controller) {
      const firstCore = cores.at(-1);
      assert.ok(firstCore);
      const paused = await controller.pause();
      assert.equal(paused.paused, true); assert.equal(paused.runtime, 'stopped'); assert.equal(paused.ready, false);
      assert.equal(await hasExited(firstCore), true);
      const pollsWhenStopped = mockRequests;
      await new Promise(resolve => setTimeout(resolve, 150));
      await controller.status();
      assert.equal(mockRequests, pollsWhenStopped); assert.equal(ownedStarts, 1);
      replies.length = 0; queued = 0;
      const reconnected = await controller.reconnect();
      assert.equal(reconnected.ready, true); assert.equal(ownedStarts, 2);
      const secondDeadline = Date.now() + 10000;
      while (replies.length < requests.length && Date.now() < secondDeadline && !errors.length) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(replies.length, requests.length); assert.equal(errors.length, 0);
      assert.equal((await controller.pause()).runtime, 'stopped');
      assert.equal(await hasExited(cores.at(-1)), true);
      await controller.dispose();
      assert.equal(fs.existsSync(path.join(root, 'controller.lease')), false);
      pauseCycleVerified = true;
    } else { child.kill(); await childExited; }
    if (mode === 'arguments') {
      const exitDeadline = Date.now() + 5000;
      while (!fs.readFileSync(guardLog, 'utf8').includes('guard-exit') && Date.now() < exitDeadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const events = fs.readFileSync(guardLog, 'utf8').trim().split('\n');
      assert.ok(events.includes('guard-exit'), 'host exit hook required; the outer owned Job verifies actual process-tree exit');
      for (const name of ['network-attempt', 'browser-attempt', 'visible-child-attempt']) assert.equal(events.includes(name), false, name);
    }
    t.diagnostic(JSON.stringify({ loopbackOnlyMock: true, productionCredentials: false, tunnelVersion: '0.0.19',
      upstream: '0.3.1', tools: toolNames.length, correlatedResponses: replies.length, fileRoundtrip: true,
      forwardedNotifications, generatedProfile: mode !== 'arguments', loopbackReadyVerified: loopbackReadyVerified || controllerReady,
      hostGuardInstrumented: mode === 'arguments', ownedStarts, pauseCycleVerified,
      realOpenAITunnelTested: false, realChatGrantTested: false, stderrBytes }));
  });
