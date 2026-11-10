import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareState, buildHostLaunch } from './runtime.mjs';
import { buildTunnelLaunch, createSealedWindowsProfileDocument, profileEnvironment } from './profile.mjs';
import { openController } from './lifecycle.mjs';
import { observeCore, hasExited } from './process-observation.mjs';
import { observeTestProcessOutput } from './test-process-output.mjs';

const executable = process.env.TUNNEL_CLIENT_TEST_EXE;
const here = path.dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(fs.readFileSync(new URL('./tunnel-pins.json', import.meta.url), 'utf8'));
const run = promisify(execFile);
const packaged = process.env.TUNNEL_CLIENT_TEST_PACKAGED === '1';
const guided = process.env.TUNNEL_CLIENT_TEST_GUIDED === '1';
const coldCmd = process.env.TUNNEL_CLIENT_TEST_GUIDED_CMD_COLD === '1';
const guidedChromium = process.env.TUNNEL_CLIENT_TEST_GUIDED_CHROMIUM === '1';
const previewKit = process.env.TUNNEL_CLIENT_TEST_PREVIEW_KIT;
const sealedFixture = process.env.AC_SEALED_TUNNEL_FIXTURE;
if (packaged || guided || guidedChromium) assert.ok(executable && process.platform === 'win32' && pins.platforms['win32-' + process.arch],
  'packaged Windows acceptance requires the pinned executable for this architecture');
if (coldCmd) assert.ok(guided && process.arch === 'x64', 'cold CMD test requires guided Windows x64');
if (previewKit) assert.ok(guidedChromium && path.isAbsolute(previewKit), 'preview kit requires guided Chromium and an absolute path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function acquisitionDiagnostic(installDir) {
  try {
    const file = path.join(installDir, 'acquisition', 'process.json');
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return { observed: false };
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (report.format !== 'agent-continue-acquisition-process' || report.version !== 1) return { observed: false };
    const result = { observed: true };
    for (const key of ['exitObserved', 'closeObserved']) if (typeof report[key] === 'boolean') result[key] = report[key];
    for (const key of ['exitCode', 'closeCode', 'durationMs']) if (Number.isSafeInteger(report[key])) result[key] = report[key];
    if (['deadline', 'cancelled', null].includes(report.cancelReason)) result.cancelReason = report.cancelReason;
    return result;
  } catch { return { observed: false }; }
}

function terminalDiagnostic(root) {
  try {
    const file = path.join(root, 'guided-terminal-failure.json');
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2048) return { observed: false };
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!report || typeof report !== 'object' || Array.isArray(report)
      || Object.keys(report).sort().join(',') !== 'controls,cursorReplies,receivedBytes,startupPhase,state'
      || !['no_bytes', 'control_only', 'prompt_present', 'other_output'].includes(report.state)
      || !['not-observed', 'management', 'utility', 'archive', 'ready'].includes(report.startupPhase)
      || !Number.isInteger(report.receivedBytes) || report.receivedBytes < 0 || report.receivedBytes > 65536
      || !Number.isInteger(report.cursorReplies) || report.cursorReplies < 0 || report.cursorReplies > 8
      || !Array.isArray(report.controls) || report.controls.length > 6
      || new Set(report.controls).size !== report.controls.length
      || report.controls.some(value => !['cursor-hide', 'cursor-query', 'cursor-show',
        'erase-display', 'sgr', 'sync-output'].includes(value))) return { observed: false };
    return { observed: true, state: report.state, receivedBytes: report.receivedBytes,
      cursorReplies: report.cursorReplies, controls: report.controls, startupPhase: report.startupPhase };
  } catch { return { observed: false }; }
}

test('acquisition failure diagnostics disclose bounded process facts only', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-acquisition-diagnostic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(acquisitionDiagnostic(root), { observed: false });
  fs.mkdirSync(path.join(root, 'acquisition'));
  const file = path.join(root, 'acquisition', 'process.json');
  fs.writeFileSync(file, JSON.stringify({ format: 'agent-continue-acquisition-process', version: 1,
    exitObserved: true, closeObserved: false, exitCode: 1, closeCode: null, durationMs: 180001,
    cancelReason: 'deadline', command: 'PRIVATE_COMMAND', path: 'PRIVATE_PATH', key: 'PRIVATE_KEY' }));
  assert.deepEqual(acquisitionDiagnostic(root), { observed: true, exitObserved: true, closeObserved: false,
    exitCode: 1, durationMs: 180001, cancelReason: 'deadline' });
  for (const value of ['invalid json', JSON.stringify({ format: 'other', version: 1 }), ' '.repeat(4097)]) {
    fs.writeFileSync(file, value);
    assert.deepEqual(acquisitionDiagnostic(root), { observed: false });
  }
});

test('terminal failure diagnostics disclose closed protocol facts only', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-terminal-diagnostic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'guided-terminal-failure.json');
  assert.deepEqual(terminalDiagnostic(root), { observed: false });
  const valid = { state: 'control_only', receivedBytes: 18, cursorReplies: 1,
    controls: ['cursor-hide', 'cursor-query', 'sgr'], startupPhase: 'not-observed' };
  fs.writeFileSync(file, JSON.stringify(valid));
  assert.deepEqual(terminalDiagnostic(root), { observed: true, ...valid });
  for (const startupPhase of ['management', 'utility', 'archive', 'ready']) {
    fs.writeFileSync(file, JSON.stringify({ ...valid, startupPhase }));
    assert.deepEqual(terminalDiagnostic(root), { observed: true, ...valid, startupPhase });
  }
  for (const value of [
    { ...valid, command: 'PRIVATE_COMMAND' }, { ...valid, controls: ['PRIVATE_TEXT'] },
    { ...valid, controls: ['sgr', 'sgr'] }, { ...valid, cursorReplies: 9 },
    { ...valid, receivedBytes: 65537 }, { ...valid, receivedBytes: 1.5 },
    { ...valid, state: 'PRIVATE_MESSAGE' },
    { ...valid, startupPhase: 'PRIVATE_PATH' },
  ]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.deepEqual(terminalDiagnostic(root), { observed: false });
  }
  for (const text of ['invalid json', ' '.repeat(2049)]) {
    fs.writeFileSync(file, text);
    assert.deepEqual(terminalDiagnostic(root), { observed: false });
  }
});

for (const mode of ['arguments', 'generated-profile', 'owned-lifecycle', 'replayed-write', 'exact-shell', ...(sealedFixture ? ['sealed-profile'] : []), ...(packaged ? ['packaged-manager'] : []),
  ...(guided ? ['guided-installer-paired', 'guided-installer-cmd-unpaired'] : []),
  ...(guidedChromium ? ['guided-installer-chromium', 'guided-installer-browser-managed'] : [])]) test('official ' + process.platform + ' tunnel 0.0.19 supervises the real core via ' + mode + ' against a loopback-only fake control plane',
  { skip: !executable || !pins.platforms[process.platform + '-' + process.arch], timeout: mode === 'packaged-manager' || mode.startsWith('guided-installer-') ? 330000 : 45000 }, async t => {
    assert.ok(path.isAbsolute(executable));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
      pins.platforms[process.platform + '-' + process.arch].executableSha256);
    // Hosted Windows TEMP can use an 8.3 alias; every fixture peer requires the same canonical spelling.
    const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-tunnel-')));
    const guidedInstall = mode.startsWith('guided-installer-');
    const guidedCmd = mode === 'guided-installer-cmd-unpaired';
    const provisionNode = guidedCmd && coldCmd;
    const browserRoundtrip = mode === 'guided-installer-chromium';
    const browserManaged = mode === 'guided-installer-browser-managed';
    const fromPreview = browserRoundtrip || browserManaged;
    const replayedWrite = mode === 'replayed-write';
    const sealed = mode === 'sealed-profile';
    const guardedAcceptance = sealed && process.env.AC_SEALED_HOSTED_ADMISSION === '1';
    const bundle = sealed ? process.env.AC_WINDOWS_ADMIN_BUNDLE_SMOKE_ROOT : null;
    if (sealed) {
      assert.equal(process.platform + '-' + process.arch, 'win32-x64');
      assert.equal(process.env.AC_WINDOWS_ADMIN_BUNDLE_SMOKE, 'accept-disposable-standard-token-test');
      assert.equal(fs.realpathSync.native(bundle), bundle);
      assert.equal(path.dirname(bundle), fs.realpathSync.native(os.tmpdir()));
      assert.match(path.basename(bundle), /^ac-admin-smoke-[a-f0-9]{32}$/);
      assert.equal(executable, path.join(bundle, 'client', 'tunnel-client-runtime.exe'));
    }
    const guidedPairing = mode === 'guided-installer-paired' || browserRoundtrip;
    const installed = mode === 'packaged-manager' || guidedInstall;
    const home = path.join(scratch, 'home');
    const portableRoot = path.join(home, 'Local', 'AgentContinueToolchain', 'node-v22.23.4-win-x64');
    const runtimeNode = provisionNode ? path.join(portableRoot, 'node.exe') : process.execPath;
    const installDir = guidedCmd ? path.join(home, 'Local', 'AgentContinue') : path.join(scratch, "installed, with spaces's $literal");
    const root = sealed ? bundle + '.state' : installed ? path.join(installDir, 'state') : path.join(scratch, "state, with spaces's $literal");
    const ownedFile = path.join(root, 'work', 'through-tunnel.txt');
    const exactOutputRelease = path.join(root, 'work', 'exact-output-release');
    const exactOutputPhase = path.join(root, 'work', 'exact-output-phase');
    const coldOutputRelease = path.join(root, 'work', 'cold-output-release');
    const coldOutputPhase = path.join(root, 'work', 'cold-output-phase');
    const guardLog = path.join(scratch, 'guard.log');
    const system = process.env.SystemRoot;
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent-continue-loopback-test', version: '0.1.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'write_file', arguments: { path: ownedFile, content: 'AGENT_CONTINUE_TUNNEL_OK', mode: 'rewrite' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_file', arguments: { path: ownedFile, length: 10 } } },
    ];
    if (replayedWrite) {
      requests[3].params.arguments.mode = 'append';
      requests[3].params.arguments.content += '\n';
      requests[3].params.arguments.agent_continue_operation_id = 'abcdabcd-abcd-4abc-8abc-abcdabcdabcd';
      requests.splice(4, 0, { ...requests[3], id: 5 }, { ...requests[3], params: { ...requests[3].params,
        arguments: { ...requests[3].params.arguments, agent_continue_operation_id: 'abceabcd-abcd-4abc-8abc-abcdabcdabcd' } } });
      requests.push({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'agent_continue_operation_status',
        arguments: { agent_continue_operation_id: requests[3].params.arguments.agent_continue_operation_id } } });
    }
    const exactShell = mode === 'exact-shell' || browserRoundtrip || sealed;
    if (exactShell) {
      const operation = 'abcdabcd-abcd-4abc-8abc-abcdabcdabcd';
      const command = process.platform === 'win32'
        ? "$PSModuleAutoLoadingPreference = 'None'; $gate = '" + exactOutputRelease.replaceAll("'", "''") + "'; $phase = '" + exactOutputPhase.replaceAll("'", "''") + "'; " +
          "[IO.File]::WriteAllText($phase, 'started'); $clock = [Diagnostics.Stopwatch]::StartNew(); " +
          "while (-not [IO.File]::Exists($gate)) { if ($clock.ElapsedMilliseconds -ge 20000) { throw 'fixture_output_gate_timeout' }; [Threading.Thread]::Sleep(25) }; " +
          "[IO.File]::WriteAllText($phase, 'released'); [Console]::WriteLine(('AC_TUNNEL_' + 'EXACT'))"
        : "printf '%s' 'AC_TUNNEL_EXACT'";
      const shell = process.platform === 'win32'
        ? path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').replaceAll('\\', '/')
        : '/bin/sh';
      // The fixture releases Windows output only after the original start/replay sequence.
      const timeout_ms = process.platform === 'win32' ? 100 : 10000;
      const args = { command, shell, timeout_ms, agent_continue_operation_id: operation,
        agent_continue_process_sha256: crypto.createHash('sha256').update(JSON.stringify([command, shell, timeout_ms])).digest('hex') };
      const start = (id, arguments_) => ({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'agent_continue_start_process_exact', arguments: arguments_ } });
      const status = id => ({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'agent_continue_operation_status', arguments: { agent_continue_operation_id: operation } } });
      requests.push(start(5, { ...args, command: command + ' ' }), status(6), start(7, args), start(8, args), status(9));
    }
    if (provisionNode) requests.push({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
      name: 'start_process', arguments: {
        command: "$PSModuleAutoLoadingPreference = 'None'; $gate = '" + coldOutputRelease.replaceAll("'", "''") +
          "'; $phase = '" + coldOutputPhase.replaceAll("'", "''") + "'; " +
          "[IO.File]::WriteAllText($phase, 'started'); $clock = [Diagnostics.Stopwatch]::StartNew(); " +
          "while (-not [IO.File]::Exists($gate)) { if ($clock.ElapsedMilliseconds -ge 20000) { throw 'fixture_output_gate_timeout' }; [Threading.Thread]::Sleep(25) }; " +
          "[IO.File]::WriteAllText($phase, 'released'); [Console]::WriteLine(('AC_COLD_' + 'SHELL_OK'))",
        shell: path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        timeout_ms: 100,
      },
    } });
    const requestIdAt = index => 'fixture-' + index;
    const requestIds = new Set(requests.map((_, index) => requestIdAt(index)));
    const replies = [], errors = [], outputReads = new Map(), outputReadTimings = [];
    let exactShellOutput, coldShellOutput;
    let lastResponse, firstBrowserTunnel, guidedEnvironment, sealedRestart = false, firstSealedResponses = 0;
    let queued = 0, child, childExited, controller, owner, packageBin, installerOperation, browser;
    let forwardedNotifications = 0, mockRequests = 0, mockConnections = 0;
    let ownedStarts = 0, controllerReady = false, pauseCycleVerified = false;
    const cores = [];
    const sockets = new Set();
    const guidedAudit = path.join(scratch, 'guided-processes.jsonl');
    const guidedChannel = path.join(root, 'device-channel.json');
    const guidedReady = path.join(scratch, 'guided-roundtrip-ready');
    const guidedProcesses = () => fs.existsSync(guidedAudit) ? fs.readFileSync(guidedAudit, 'utf8').trim().split('\n').filter(Boolean).map(line => {
      const item = JSON.parse(line);
      assert.ok(['owner', 'tunnel'].includes(item.kind) && Number.isSafeInteger(item.pid) && item.pid > 0);
      return item;
    }) : [];
    async function stopGuidedOwner() {
      fs.writeFileSync(path.join(scratch, 'guided-stop'), 'stop\n');
      const lastOwner = guidedProcesses().findLast(item => item.kind === 'owner');
      if (!lastOwner) return;
      const exitReceipt = path.join(scratch, 'guided-owner-exit-' + lastOwner.pid);
      const deadline = Date.now() + 18000;
      while ((!fs.existsSync(exitReceipt) || fs.existsSync(guidedChannel)) && Date.now() < deadline) await delay(80);
      assert.ok(fs.existsSync(exitReceipt), 'fixture owner must exit before cleanup');
      assert.equal(fs.existsSync(guidedChannel), false, 'fixture owner must release its channel');
    }
    const mock = http.createServer(async (req, res) => {
      mockRequests++;
      try {
        if (req.method === 'GET' && req.url.split('?')[0].endsWith('/poll')) {
          if (mode !== 'arguments') assert.equal(req.headers.authorization, sealed ?
            'Bearer sk-agentcontinue-synthetic-never-valid' : 'Bearer not-a-real-key-from-file');
          if (queued === null) { res.writeHead(204); res.end(); return; }
          const index = queued; queued = null;
          const reading = outputReadTimings.find(item => item.index === index);
          if (reading) reading.deliveredMs = Math.round(performance.now() - reading.opened);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ commands: [{ request_id: requestIdAt(index), shard_token: 'fake-shard',
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
            assert.ok(requestIds.has(response.request_id));
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
          assert.equal(response.request_id, requestIdAt(index));
          assert.equal(response.channel, 'main');
          assert.ok([200, 202, 204].includes(response.resp_code));
          if ('id' in expected) {
            assert.equal(response.resp_json?.jsonrpc, '2.0');
            assert.equal(response.resp_json?.id, expected.id);
            if (replayedWrite && index === 4) {
              assert.equal(response.resp_json?.error?.code, -32070);
              assert.equal(fs.readFileSync(ownedFile, 'utf8'), 'AGENT_CONTINUE_TUNNEL_OK\n',
                'replay cannot append a second line');
            } else if (sealedRestart && !guardedAcceptance && index === 4) {
              assert.equal(response.resp_json?.error?.code, -32070);
            } else if (!sealedRestart && exactShell && (index === 5 || index === 8)) {
              assert.equal(response.resp_json?.error?.code, index === 5 ? -32072 : -32070);
            } else {
              assert.equal(response.resp_json?.error, undefined);
              assert.ok(response.resp_json?.result);
            }
          } else assert.equal(response.resp_type, 'notify_ack');
          replies.push(response);
          const outputRead = outputReads.get(index);
          if (outputRead) {
            const reading = outputReadTimings.find(item => item.index === index);
            reading.settledMs = Math.round(performance.now() - reading.opened);
            reading.providerError = response.resp_json.result.isError === true;
            outputReads.delete(index); outputRead(response.resp_json.result);
          }
          if (replies.length < requests.length) queued = replies.length;
          res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}');
          const coldOutput = provisionNode && index === 5;
          if (coldOutput || exactShell && !sealedRestart && index === 9) {
            // Keep the original start/replay/receipt sequence; append observation only.
            const release = coldOutput ? coldOutputRelease : exactOutputRelease;
            const phase = coldOutput ? coldOutputPhase : exactOutputPhase;
            if (process.platform === 'win32') fs.writeFileSync(release, 'release\n', { flag: 'wx' });
            const output = observeTestProcessOutput(replies[coldOutput ? 5 : 7].resp_json.result,
              coldOutput ? 'AC_COLD_SHELL_OK' : 'AC_TUNNEL_EXACT', params => {
              const index = requests.length;
              requests.push({ jsonrpc: '2.0', id: 10 + index, method: 'tools/call', params });
              requestIds.add(requestIdAt(index));
              outputReadTimings.push({ index, opened: performance.now(), timeoutMs: params.arguments.timeout_ms,
                deliveredMs: null, settledMs: null, providerError: null });
              const observed = new Promise(resolve => outputReads.set(index, resolve));
              queued = index;
              return observed;
            });
            if (coldOutput) coldShellOutput = output;
            else exactShellOutput = output;
            output.catch(error => {
              t.diagnostic(JSON.stringify({ phase: coldOutput ? 'cold-output-observation' : 'exact-output-observation',
                code: /^test_process_[a-z_]+$/.test(error.message) ? error.message : 'test_output_failed',
                received: replies.length, requested: requests.length, pendingReads: outputReads.size,
                outputGateExists: fs.existsSync(release),
                outputPhase: fs.existsSync(phase) && ['started', 'released'].includes(fs.readFileSync(phase, 'utf8'))
                  ? fs.readFileSync(phase, 'utf8') : 'not-observed',
                reads: outputReadTimings.map(({ opened, ...item }) => ({ ...item,
                  elapsedMs: Math.round(performance.now() - opened) })),
                lastResponse, exitCode: child?.exitCode, stderrBytes }));
            });
          }
          if (browserRoundtrip && index === 9) {
            await exactShellOutput;
            const launches = guidedProcesses();
            const first = launches.find(item => item.kind === 'tunnel');
            const manager = launches.find(item => item.kind === 'owner');
            const core = await observeCore(first?.pid, process.execPath);
            assert.ok(core, 'first provider must be observable before browser pause');
            firstBrowserTunnel = await observeCore(manager?.pid, path.join(installDir, 'client', 'tunnel-client-runtime.exe'));
            assert.equal(firstBrowserTunnel?.pid, first.pid, 'first official client must be observable before browser pause');
            cores.push(core);
            fs.writeFileSync(guidedReady, 'ready\n', { flag: 'wx' });
          }
          return;
        }
        res.writeHead(404); res.end();
      } catch (error) {
        errors.push({ code: 'fixture_response_invalid', assertion: error.message.slice(0, 180), at: lastResponse });
        if (!res.headersSent) { res.writeHead(400); res.end(); }
      }
    });
    mock.on('connection', socket => { mockConnections++; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      try {
        await browser?.close();
        if (guidedInstall) await stopGuidedOwner();
        else if (owner) await owner.close();
        else if (controller) await controller.dispose();
        else if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await childExited; }
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => mock.close(resolve));
      }
      // Windows can retain the child's working-directory handle briefly after
      // its parent exits. Retry owned fixture cleanup, not any MCP operation.
      await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const parentEnv = process.platform === 'win32' ? { SystemRoot: system, WINDIR: system, ComSpec: path.join(system, 'System32', 'cmd.exe'),
      PATH: [path.dirname(process.execPath), path.join(system, 'System32'), path.join(system, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD', AGENT_CONTINUE_TEST_GUARD_LOG: guardLog }
      : { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C.UTF-8', AGENT_CONTINUE_TEST_GUARD_LOG: guardLog };
    const key = path.join(sealed ? bundle + '.secrets' : scratch, 'runtime.key');
    if (mode !== 'arguments' && !sealed) fs.writeFileSync(key, 'not-a-real-key-from-file', { flag: 'wx', mode: 0o600 });
    if (guidedInstall) {
      const python = process.env.TUNNEL_CLIENT_TEST_PYTHON, archive = process.env.TUNNEL_CLIENT_TEST_ARCHIVE;
      const cache = process.env.TUNNEL_CLIENT_TEST_NPM_CACHE;
      for (const input of [python, archive, cache]) assert.ok(input && path.isAbsolute(input), 'guided fixture requires absolute Python, archive and cache paths');
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), pins.platforms['win32-' + process.arch].archiveSha256);
      const repo = path.resolve(here, '../..');
      const extracted = path.join(scratch, 'extension');
      const payload = fromPreview ? path.join(extracted, 'WindowsSetup') : path.join(scratch, 'package');
      if (fromPreview) {
        const builder = path.join(repo, 'scripts', 'build-windows-preview-kit.py');
        const output = path.join(scratch, 'preview-kit');
        const kit = previewKit ?? path.join(output, 'agent-continue-windows-preview-kit.zip');
        if (!previewKit) await run(python, [builder, '--output', output], { timeout: 30000, windowsHide: true });
        const expected = fs.readFileSync(kit + '.sha256', 'ascii');
        const bytes = fs.readFileSync(kit);
        assert.equal(expected, crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + path.basename(kit) + '\n');
        const testedKit = path.join(scratch, 'accepted-preview-kit.zip');
        fs.writeFileSync(testedKit, bytes, { flag: 'wx' });
        await run(python, [builder, '--verify', testedKit], { timeout: 15000, windowsHide: true });
        await run(python, ['-m', 'zipfile', '-e', testedKit, extracted], { timeout: 15000, windowsHide: true });
      } else {
        const release = path.join(scratch, 'release');
        await run(python, ['-B', path.join(repo, 'scripts', 'build-setup-release.py'), '--source-only', '--output', release], { timeout: 30000, windowsHide: true });
        await run(python, ['-m', 'zipfile', '-e', path.join(release, 'agent-continue-setup.zip'), payload], { timeout: 12000, windowsHide: true });
      }
      assert.deepEqual(fs.readdirSync(payload).filter(name => name.startsWith('guided-')), []);
      packageBin = path.join(payload, 'bin.mjs');
      let extensionId = 'a'.repeat(32);
      if (fromPreview) {
        const extension = path.join(extracted, 'AgentContinue');
        const manifestFile = path.join(extension, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        assert.equal(Object.hasOwn(manifest, 'key'), false, 'preview must not force the source development ID');
        const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { format: 'der', type: 'spki' } });
        manifest.key = publicKey.toString('base64');
        extensionId = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
          .replace(/[0-9a-f]/g, nibble => String.fromCharCode(97 + Number.parseInt(nibble, 16)));
        fs.writeFileSync(manifestFile, JSON.stringify(manifest) + '\n');
      }
      const { buildSetupRequest, serializeSetupRequest } = await import('../../setup-model.js');
      const config = path.join(scratch, 'guided-config.json');
      const shell = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      fs.writeFileSync(config, JSON.stringify({ shell, packageDir: payload, installDir, nodePath: process.execPath,
        keyPath: key, tunnelId: 'tunnel_0123456789abcdef0123456789abcdef', extensionId, pair: guidedPairing,
        ...(browserRoundtrip ? { browser: true } : {}), ...(guidedCmd ? { cmd: true } : {}),
        ...(browserManaged ? { browserManaged: true } : {}) }));
      for (const folder of ['', 'Local', 'Roaming', 'Temp']) fs.mkdirSync(path.join(home, folder), { recursive: true });
      let guidedPath = parentEnv.PATH;
      let npmOverride = {};
      if (provisionNode) {
        const oldNode = path.join(scratch, 'old-node');
        fs.mkdirSync(oldNode);
        fs.writeFileSync(path.join(oldNode, 'node.cmd'), '@echo off\r\necho v20.0.0\r\n');
        const fakeNpm = path.join(scratch, 'stale-npm');
        const fakeNpmScript = path.join(fakeNpm, 'bin', 'npm-cli.js');
        fs.mkdirSync(path.dirname(fakeNpmScript), { recursive: true });
        fs.writeFileSync(path.join(fakeNpm, 'package.json'), '{"name":"npm"}\n');
        fs.writeFileSync(fakeNpmScript, 'process.exit(41);\n');
        npmOverride = { npm_execpath: fakeNpmScript,
          AC_GUIDED_EXPECTED_NPM: path.join(portableRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js') };
        // Find an incompatible candidate without falling back to the real machine PATH.
        guidedPath = [oldNode, path.join(system, 'System32'), path.dirname(shell)].join(';');
        assert.equal(fs.existsSync(runtimeNode), false);
      }
      const preload = pathToFileURL(path.join(here, 'test-fixtures', 'guided-loopback-preload.mjs')).href;
      guidedEnvironment = { ...parentEnv, ...npmOverride, PATH: guidedPath, OS: 'Windows_NT', PROCESSOR_ARCHITECTURE: process.arch === 'arm64' ? 'ARM64' : 'AMD64',
        USERPROFILE: home, LOCALAPPDATA: path.join(home, 'Local'), APPDATA: path.join(home, 'Roaming'), TEMP: path.join(home, 'Temp'), TMP: path.join(home, 'Temp'),
        AC_GUIDED_ROOT: scratch, AC_GUIDED_INSTALL: installDir, AC_GUIDED_ARCHIVE: archive, AC_GUIDED_NPM_CACHE: cache,
        AC_GUIDED_ORIGIN: 'http://127.0.0.1:' + mock.address().port, NODE_OPTIONS: '--import=' + preload,
        ...(browserManaged ? { AC_GUIDED_CAPTURE_WAKE_REGISTRATION: '1' } : {}),
        ...(browserRoundtrip ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA, 'ms-playwright') } : {}) };
      let guidedResult;
      try {
        guidedResult = await run(python, [path.join(here, 'test-fixtures', 'guided-conpty.py'), config], {
          timeout: 270000, windowsHide: true, env: guidedEnvironment,
        });
      } catch (error) {
        const code = /^guided_conpty: ([a-z0-9_]+)\r?\n?$/.exec(error.stderr ?? '')?.[1];
        t.diagnostic(JSON.stringify({ phase: 'guided-installer', mode,
          code: code ?? 'unclassified_fixture_failure', acquisition: acquisitionDiagnostic(installDir),
          terminal: terminalDiagnostic(scratch) }));
        throw error;
      }
      const { stdout, stderr } = guidedResult;
      const terminalProtocol = JSON.parse(fs.readFileSync(path.join(scratch, 'guided-terminal-protocol.json'), 'utf8'));
      assert.deepEqual(Object.keys(terminalProtocol).sort(), ['cursorReplies', 'initialPromptObserved']);
      assert.equal(terminalProtocol.initialPromptObserved, true);
      assert.ok(Number.isInteger(terminalProtocol.cursorReplies) && terminalProtocol.cursorReplies >= 0 && terminalProtocol.cursorReplies <= 8);
      t.diagnostic(JSON.stringify({ phase: 'guided-terminal-protocol', ...terminalProtocol }));
      assert.equal(stderr, '');
      const result = JSON.parse(stdout);
      if (browserManaged) {
        const name = 'com.agentcontinue.device_wake';
        assert.deepEqual(result, { ok: true, action: 'install-local', mode: 'browser-managed',
          configured: true, registered: true, connected: false, browserLaunchVerified: false,
          chatAuthorizationVerified: false, registration: { ok: true, status: 'written', host: name,
            registered: true, launchVerified: false, activated: false, chatAuthorizationVerified: false } });
        const wake = path.join(installDir, 'app', 'browser-wake');
        const manifestFile = path.join(wake, 'host.json');
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(scratch, 'guided-wake-registry.json'), 'utf8')),
          { view: '32', value: manifestFile });
        assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
          { name, description: 'AgentContinue Windows browser wake', path: path.join(wake, 'wake.cmd'),
            type: 'stdio', allowed_origins: ['chrome-extension://' + extensionId + '/'] });
        const cmd = fs.readFileSync(path.join(wake, 'wake.cmd'), 'ascii');
        assert.ok(cmd.includes('"%~dp0..\\device-native-host.mjs" --browser-wake "%~1"'));
        assert.ok(!cmd.includes('%*'));
        const setupReceipt = JSON.parse(fs.readFileSync(path.join(installDir, 'setup-receipt.json'), 'utf8'));
        assert.equal(setupReceipt.extensionId, extensionId);
        assert.equal(setupReceipt.activated, false);
        assert.deepEqual(guidedProcesses(), [], 'REGISTER must not start a manager or tunnel');
        for (const name of ['device-channel.json', 'controller.lease', 'device-operations.lease']) {
          assert.equal(fs.existsSync(path.join(root, name)), false);
        }
        assert.equal(mockRequests, 0);
        t.diagnostic(JSON.stringify({ archiveVerified: true, actualGuidedRegister: true, registryCaptureOnly: true,
          exactExtensionOrigin: true, runtimeStarted: false, hostedAuthorizationTested: false }));
        return;
      }
      if (provisionNode) {
        const archive = portableRoot + '.zip';
        const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        assert.equal(sha256(archive), 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20');
        assert.equal(sha256(runtimeNode), 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f');
        assert.equal(fs.existsSync(path.join(portableRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')), true);
        assert.equal(fs.existsSync(path.join(installDir, 'native-host.json')), false);
      }
      installerOperation = result.manager?.operationId;
      assert.match(installerOperation, /^[0-9a-f-]{36}$/);
      assert.deepEqual(result, { ok: true, action: 'install-local', mode: 'command-only', configured: true,
        registered: false, connected: true, manager: { ok: true, managerRunning: true, connected: true, paused: false,
          operationId: installerOperation, operationStatus: 'settled' }, chatAuthorizationVerified: false });
      const setupReceipt = JSON.parse(fs.readFileSync(path.join(installDir, 'setup-receipt.json'), 'utf8'));
      const canonical = serializeSetupRequest(buildSetupRequest('windows', extensionId));
      assert.equal(setupReceipt.extensionId, extensionId);
      assert.equal(setupReceipt.requestSha256, crypto.createHash('sha256').update(canonical).digest('hex'));
      const launches = guidedProcesses();
      assert.deepEqual(launches.map(row => row.kind), browserRoundtrip ? ['owner', 'tunnel', 'tunnel'] : ['owner', 'tunnel']);
      if (browserRoundtrip) {
        assert.equal(await hasExited(cores[0]), true, 'browser pause stopped the first provider');
        assert.equal(await hasExited(firstBrowserTunnel), true, 'browser pause stopped the first official client');
      }
      const observedCore = await observeCore(launches.at(-1).pid, runtimeNode);
      assert.ok(observedCore, 'fixture must reach the actual provider subprocess');
      cores.push(observedCore);
      ownedStarts = launches.length - 1;
      controllerReady = true;
    } else if (installed) {
      const payload = path.join(scratch, 'package');
      const release = path.join(scratch, 'release');
      const python = process.env.TUNNEL_CLIENT_TEST_PYTHON || 'python';
      const request = path.join(scratch, 'browser-request.json');
      const { buildSetupRequest, serializeSetupRequest } = await import('../../setup-model.js');
      fs.writeFileSync(request, serializeSetupRequest(buildSetupRequest('windows', 'a'.repeat(32))));
      // The PowerShell status wrapper requires the stamped per-file checksum list.
      await run(python, ['-B', path.join(here, '../../scripts/build-setup-release.py'), '--source-only', '--output', release],
        { timeout: 30000, windowsHide: true });
      await run(python, ['-B', '-m', 'zipfile', '-e', path.join(release, 'agent-continue-setup.zip'), payload],
        { timeout: 12000, windowsHide: true });
      packageBin = path.join(payload, 'bin.mjs');
      const cache = process.env.TUNNEL_CLIENT_TEST_NPM_CACHE;
      const archive = process.env.TUNNEL_CLIENT_TEST_ARCHIVE;
      let result;
      try {
        result = await run(process.execPath, [packageBin, 'setup', '--install-dir', installDir, '--consent', 'full-account',
          '--setup-request', request, '--tunnel-id', 'tunnel_0123456789abcdef0123456789abcdef', '--runtime-key-file', key,
          ...(cache ? ['--offline-cache', cache] : []), ...(archive ? ['--tunnel-archive', archive] : [])],
          { timeout: 260000, windowsHide: true });
      } catch (error) {
        t.diagnostic(JSON.stringify({ phase: 'packaged-manager-setup', acquisition: acquisitionDiagnostic(installDir) }));
        throw error;
      }
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.configured, true);
      for (const field of ['activated', 'authenticationVerified', 'nativeRegistrationVerified', 'chatAuthorizationVerified']) assert.equal(receipt[field], false);
      assert.equal(mockConnections, 0);
    } else if (!sealed) prepareState(root, { consent: 'full-account' });
    const launch = installed ? null : buildHostLaunch(root, parentEnv);
    // The official client parses a command string, not an arbitrary argv array.
    // Forward slashes avoid POSIX-style quote parsing consuming Windows separators.
    const quote = value => {
      if (/["\r\n\0]/.test(value)) throw new Error('invalid_test_command');
      return '"' + value.replaceAll('\\', '/') + '"';
    };
    const command = installed ? '' : [process.execPath, '--import', pathToFileURL(path.join(here, 'test-fixtures', 'startup-guard.mjs')).href, ...launch.args].map(quote).join(' ');
    let args = ['run', '--control-plane.base-url', 'http://127.0.0.1:' + mock.address().port,
      '--control-plane.tunnel-id', 'tunnel_0123456789abcdef0123456789abcdef',
      '--control-plane.api-key', 'env:AGENT_CONTINUE_FAKE_KEY', '--mcp.command', command,
      '--health.listen-addr', '127.0.0.1:0', '--mcp.stdio-failure-policy', 'exit',
      '--log.level', 'warn', '--log.file', path.join(scratch, 'tunnel.log')];
    let childEnv = { ...launch?.env, AGENT_CONTINUE_FAKE_KEY: 'not-a-real-key' };
    if (sealed) {
      const profile = createSealedWindowsProfileDocument({ bundleRoot: bundle, tunnelId: 'tunnel_0123456789abcdef0123456789abcdef' });
      assert.equal(profile.control_plane.base_url, 'https://api.openai.com');
      assert.equal(profile.control_plane.api_key, 'file:' + key);
      const profilePath = path.join(bundle + '.secrets', 'tunnel.yaml');
      const actual = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      assert.equal(actual.mcp.commands.length, 1);
      assert.equal(actual.mcp.commands[0].channel, 'main');
      assert.equal(actual.mcp.stdio_failure_policy, 'exit');
      assert.equal(actual.mcp.commands[0].command.replace(/(?<= )(--[a-z-]+)(?= )/g, '"$1"'), profile.mcp.commands[0].command);
      assert.deepEqual({ ...actual, mcp: profile.mcp }, profile);
      const binding = JSON.parse(sealedFixture);
      assert.deepEqual(Object.keys(binding).sort(), ['command', 'cwd', 'env', 'profileFile']);
      assert.equal(binding.command, executable);
      assert.equal(binding.profileFile, profilePath);
      assert.equal(binding.cwd, path.join(root, 'work'));
      assert.equal(process.execPath.toLowerCase(), path.join(bundle, 'runtime', 'node.exe').toLowerCase());
      childEnv = binding.env;
      assert.equal(childEnv.AC_ADMIN_BOOT_APP_ROOT, path.join(bundle, 'app'));
      assert.equal(childEnv.HOME, path.join(root, 'home'));
      assert.ok(Object.keys(childEnv).every(name => /^(?:SystemRoot|WINDIR|ComSpec|PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|AC_ADMIN_BOOT_APP_ROOT)$/.test(name)));
      args = ['run', '--profile-file', binding.profileFile];
    } else if (!installed && mode !== 'arguments') {
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
    async function control(action) {
      const { stdout } = await run(runtimeNode, [packageBin, 'manager-control', '--install-dir', installDir, '--action', action,
        ...(action === 'status' ? [] : ['--consent', 'accept-control'])], { timeout: 35000, windowsHide: true });
      const result = JSON.parse(stdout);
      assert.equal(result.ok, true);
      if (action !== 'status') assert.equal(result.state.operation.status, 'settled');
      return result.state;
    }
    const installerStartArgs = ['start-manager', '--install-dir', installDir, '--consent', 'accept-install', '--connect', 'true'];
    async function installerStatus(phase) {
      const wrapper = path.join(path.dirname(packageBin), 'install.ps1');
      const ps = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const opened = performance.now();
      try {
        const { stdout } = await run(ps, ['-NoProfile', '-NonInteractive', '-File', wrapper,
          '-DeviceAction', 'installer-status', '-InstallDir', installDir, '-NodePath', runtimeNode],
        { timeout: 30000, windowsHide: true });
        const result = JSON.parse(stdout);
        t.diagnostic(JSON.stringify({ phase, action: 'installer-status', elapsedMs: Math.round(performance.now() - opened), exitCode: 0 }));
        return result;
      } catch (error) {
        t.diagnostic(JSON.stringify({ phase, action: 'installer-status', elapsedMs: Math.round(performance.now() - opened),
          exitCode: Number.isInteger(error.code) ? error.code : null, killed: error.killed === true,
          error: /^agent_continue_install_failed: payload_integrity_unverified\r?\n?$/.test(error.stderr ?? '')
            ? 'payload_integrity_unverified' : 'installer_status_failed' }));
        throw error;
      }
    }
    if (guidedInstall) {
      assert.deepEqual(await installerStatus('guided-ready'), { ok: true, operationId: installerOperation,
        operationStatus: 'settled', managerRunning: true, connection: 'ready', paused: false });
    } else if (mode === 'owned-lifecycle' || installed || sealed) {
      const profilePath = sealed ? args[2] : path.join(root, 'tunnel.yaml');
      const before = fs.readFileSync(profilePath);
      const app = path.join(sealed ? bundle : installDir, 'app');
      const open = installed || sealed ? (await import(pathToFileURL(path.join(app, 'lifecycle.mjs')).href)).openController : openController;
      if (sealed) queued = null;
      controller = open(root, {
        ...(sealed ? { maxRestarts: 0, launch() {
          assert.deepEqual(fs.readFileSync(profilePath), before, 'the protected profile must remain unchanged');
          return { configured: true, command: executable, args, cwd: path.join(root, 'work'), env: childEnv, windowsHide: true };
        } } : {}),
        spawn(command, argv, options) {
          if (installed) assert.equal(command, path.join(installDir, 'client', 'tunnel-client-runtime.exe'));
          ownedStarts++;
          return startClient(command, [...argv, '--control-plane.base-url', 'http://127.0.0.1:' + mock.address().port],
            installed ? options : { ...options, env: childEnv });
        },
        async observeCore(parent, node) {
          const identity = await observeCore(parent, node);
          if (identity) cores.push(identity);
          return identity;
        },
      });
      if (installed) {
        const { startDeviceOwner } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
        owner = await startDeviceOwner(path.join(app, 'device-native-binding.json'), { controller });
        assert.equal((await control('status')).connection, 'disconnected');
        const { stdout } = await run(process.execPath, [packageBin, ...installerStartArgs], { timeout: 35000, windowsHide: true });
        const result = JSON.parse(stdout);
        assert.equal(result.connected, true);
        assert.equal(result.operationStatus, 'settled');
        installerOperation = result.operationId;
        assert.match(installerOperation, /^[0-9a-f-]{36}$/);
        assert.deepEqual(await installerStatus('packaged-ready'), { ok: true, operationId: installerOperation,
          operationStatus: 'settled', managerRunning: true, connection: 'ready', paused: false });
      } else {
        if (sealed) {
          assert.equal((await controller.status()).paused, true);
          assert.equal(ownedStarts, 0);
          assert.equal(mockRequests, 0);
        }
        const connected = await controller.reconnect();
        assert.equal(connected.runtime, 'running'); assert.equal(connected.ready, true);
        assert.equal(connected.chatAuthorization, 'not-observed');
      }
      if (sealed) queued = 0;
      assert.deepEqual(fs.readFileSync(profilePath), before);
      controllerReady = true;
    } else startClient(executable, args, { cwd: launch.cwd, env: childEnv,
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const deadline = Date.now() + 30000;
    while (replies.length < requests.length && Date.now() < deadline && (!child || child.exitCode === null) && errors.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (errors.length || replies.length !== requests.length) t.diagnostic(JSON.stringify({ received: replies.length, errors, lastResponse, exitCode: child?.exitCode, stderrBytes }));
    assert.equal(errors.length, 0);
    assert.equal(replies.length, requests.length, 'all correlated tunnel responses required');
    assert.equal(replies[0].resp_json.result.serverInfo.version, '0.3.1');
    const toolNames = replies[2].resp_json.result.tools.map(tool => tool.name);
    for (const name of ['read_file', 'write_file', 'start_process']) assert.ok(toolNames.includes(name));
    assert.notEqual(replies[3].resp_json.result.isError, true);
    assert.notEqual(replies[replayedWrite ? 5 : 4].resp_json.result.isError, true);
    const observedFile = fs.readFileSync(ownedFile, 'utf8');
    if (replayedWrite) {
      assert.equal(observedFile, 'AGENT_CONTINUE_TUNNEL_OK\n'.repeat(2),
        'a different operation ID can intentionally repeat the same append despite a reused RPC ID');
      assert.ok(toolNames.includes('agent_continue_operation_status'));
      assert.deepEqual(replies[7].resp_json.result.structuredContent, { status: 'provider-reported-result' });
    } else assert.equal(observedFile, 'AGENT_CONTINUE_TUNNEL_OK');
    assert.match(JSON.stringify(replies[replayedWrite ? 6 : 4].resp_json.result.content), /AGENT_CONTINUE_TUNNEL_OK/);
    if (provisionNode) {
      const shellResult = replies[5].resp_json.result;
      assert.notEqual(shellResult.isError, true);
      assert.doesNotMatch(JSON.stringify(shellResult.content), /AC_COLD_SHELL_OK/,
        'the cold command output is held until its original start reply');
      assert.match(await coldShellOutput, /AC_COLD_SHELL_OK/);
      assert.ok(outputReadTimings.length > 0, 'cold shell output requires a correlated read');
      assert.equal(fs.readFileSync(coldOutputPhase, 'utf8'), 'released');
      assert.equal(requests.filter(request => request.params?.name === 'start_process').length, 1,
        'output observation must not replay the cold command');
    }
    if (exactShell) {
      assert.ok(toolNames.includes('agent_continue_start_process_exact'));
      assert.equal(replies[5].resp_json.error?.code, -32072);
      assert.deepEqual(replies[6].resp_json.result.structuredContent, { status: 'not-recorded' });
      assert.notEqual(replies[7].resp_json.result.isError, true);
      assert.match(await exactShellOutput, /AC_TUNNEL_EXACT/);
      if (process.platform === 'win32') {
        assert.ok(outputReadTimings.length > 0, 'delayed Windows output requires a correlated read');
        assert.equal(fs.readFileSync(exactOutputPhase, 'utf8'), 'released', 'the owned command observed its release gate');
      }
      assert.equal(replies[8].resp_json.error?.code, -32070);
      assert.deepEqual(replies[9].resp_json.result.structuredContent, { status: 'provider-reported-result', requestKind: 'exact-process' });
    }
    let loopbackReadyVerified = false;
    if (mode === 'generated-profile') {
      const address = new URL(fs.readFileSync(path.join(root, 'health.url'), 'utf8').trim());
      assert.equal(address.protocol, 'http:'); assert.equal(address.hostname, '127.0.0.1');
      assert.equal(address.username, ''); assert.equal(address.password, '');
      const ready = await fetch(new URL('/readyz', address), { signal: AbortSignal.timeout(3000) });
      assert.equal(ready.status, 200);
      loopbackReadyVerified = true;
    }
    if (guidedInstall) {
      const paused = await control('disconnect-and-pause');
      assert.equal(paused.connection, 'disconnected');
      assert.equal(paused.paused, true);
      assert.equal(await hasExited(cores.at(-1)), true);
      const count = mockRequests;
      await delay(500);
      assert.deepEqual(await installerStatus('guided-paused'), { ok: true, operationId: installerOperation,
        operationStatus: 'settled', managerRunning: true, connection: 'disconnected', paused: true });
      await assert.rejects(run(runtimeNode, [packageBin, ...installerStartArgs], { timeout: 35000, windowsHide: true }), error => {
        assert.equal(error.code, 1);
        assert.deepEqual(JSON.parse(error.stdout), { ok: false, error: 'manager_start_unconfirmed',
          operationId: installerOperation, operationStatus: 'settled' });
        return true;
      });
      assert.equal(mockRequests, count, 'readback and installer retry must not resume polling');
      assert.deepEqual(guidedProcesses().map(row => row.kind), browserRoundtrip ? ['owner', 'tunnel', 'tunnel'] : ['owner', 'tunnel']);
      if (provisionNode) {
        await stopGuidedOwner();
        fs.unlinkSync(path.join(scratch, 'guided-stop'));
        const retained = ['tunnel.yaml', 'binding.json', 'lifecycle.json', 'installer-reconnect.json'].map(file => path.join(root, file));
        const before = retained.map(file => fs.readFileSync(file));
        const ps = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const start = ['-NoProfile', '-NonInteractive', '-File', path.join(path.dirname(packageBin), 'install.ps1'),
          '-DeviceAction', 'start', '-InstallDir', installDir, '-Consent', 'accept-control'];
        const restartOptions = { timeout: 45000, windowsHide: true, env: { ...guidedEnvironment, PATH: parentEnv.PATH } };
        const mismatch = error => {
          assert.equal(error.code, 1);
          assert.deepEqual(JSON.parse(error.stdout), { ok: false, error: 'manager_profile_mismatch' });
          return true;
        };
        await assert.rejects(run(ps, [...start, '-NodePath', process.execPath], restartOptions), mismatch);
        const portableArchive = portableRoot + '.zip';
        fs.renameSync(portableArchive, portableArchive + '.held');
        try {
          await assert.rejects(run(ps, start, restartOptions), mismatch);
          assert.equal(fs.existsSync(portableArchive), false, 'missing cache must not be downloaded during restart');
        } finally { fs.renameSync(portableArchive + '.held', portableArchive); }
        assert.equal(fs.existsSync(guidedChannel), false, 'mismatched Node must not spawn an owner');
        assert.deepEqual(guidedProcesses().map(row => row.kind), ['owner', 'tunnel']);
        const restarted = JSON.parse((await run(ps, start, restartOptions)).stdout);
        assert.deepEqual(restarted, { ok: true, managerRunning: true, connected: false, paused: true });
        assert.equal(mockRequests, count, 'restarting the owner must not clear manual pause');
        assert.deepEqual(retained.map(file => fs.readFileSync(file)), before);
        assert.deepEqual(guidedProcesses().map(row => row.kind), ['owner', 'tunnel', 'owner']);
        assert.equal((await control('reconnect')).connection, 'ready');
        const afterRestart = guidedProcesses();
        assert.deepEqual(afterRestart.map(row => row.kind), ['owner', 'tunnel', 'owner', 'tunnel']);
        const restartedCore = await observeCore(afterRestart.at(-1).pid, runtimeNode);
        assert.ok(restartedCore, 'explicit reconnect must use the bound portable Node');
        assert.equal((await control('disconnect-and-pause')).paused, true);
        assert.equal(await hasExited(restartedCore), true);
      }
      pauseCycleVerified = true;
    } else if (controller) {
      const firstCore = cores.at(-1);
      assert.ok(firstCore);
      const pause = () => installed ? control('disconnect-and-pause') : controller.pause();
      const paused = await pause();
      assert.equal(paused.paused, true);
      if (installed) assert.equal(paused.connection, 'disconnected');
      else { assert.equal(paused.runtime, 'stopped'); assert.equal(paused.ready, false); }
      assert.equal(await hasExited(firstCore), true);
      const pollsWhenStopped = mockRequests;
      await new Promise(resolve => setTimeout(resolve, 150));
      const observed = installed ? await control('status') : await controller.status();
      assert.equal(observed.paused, true);
      if (installed) {
        assert.deepEqual(await installerStatus('packaged-paused'), { ok: true, operationId: installerOperation,
          operationStatus: 'settled', managerRunning: true, connection: 'disconnected', paused: true });
        await assert.rejects(run(process.execPath, [packageBin, ...installerStartArgs], { timeout: 35000, windowsHide: true }), error => {
          assert.equal(error.code, 1);
          assert.deepEqual(JSON.parse(error.stdout), { ok: false, error: 'manager_start_unconfirmed',
            operationId: installerOperation, operationStatus: 'settled' });
          return true;
        });
      }
      assert.equal(mockRequests, pollsWhenStopped); assert.equal(ownedStarts, 1);
      if (sealed) {
        firstSealedResponses = replies.length;
        sealedRestart = true;
        const [, , list, , read] = requests;
        const final = guardedAcceptance ? { ...read, id: 10 } : requests[9];
        requests.splice(0, requests.length, requests[0], requests[1], list, read, requests[7], final);
      }
      replies.length = 0; queued = sealed ? null : 0;
      let browserAction;
      if (installed) {
        const { openBrowserManager } = await import(pathToFileURL(path.join(path.dirname(packageBin), 'browser-control.mjs')).href);
        await assert.rejects(openBrowserManager(installDir, 'b'.repeat(32)), /setup_identity_mismatch/);
        browser = await openBrowserManager(installDir);
        assert.match(browser.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
        const embed = await fetch(browser.origin + '/embed', { signal: AbortSignal.timeout(3000) });
        assert.equal(embed.status, 200);
        assert.ok(embed.headers.get('content-security-policy').endsWith('frame-ancestors chrome-extension://' + 'a'.repeat(32)));
        assert.ok(!(await embed.text()).includes(browser.code));
        browserAction = async action => {
          const id = crypto.randomUUID();
          const result = await fetch(browser.origin + '/v1/control', { method: 'POST', signal: AbortSignal.timeout(30000),
            headers: { Origin: browser.origin, Authorization: 'Bearer ' + browser.code, 'Content-Type': 'application/json',
              'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ action, id }) });
          const receipt = await result.json();
          assert.equal(result.status, 200);
          assert.equal(receipt.id, id);
          if (action !== 'status') assert.equal(receipt.operationStatus, 'settled');
          return receipt;
        };
        assert.equal((await browserAction('status')).paused, true);
        assert.equal(mockRequests, pollsWhenStopped); assert.equal(ownedStarts, 1);
      }
      let stopAcceptance, acceptanceWindow, acceptanceCore;
      let reconnected;
      if (sealed) {
        await controller.dispose();
        const profilePath = path.join(bundle + '.secrets', 'tunnel.yaml');
        const fixtureProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        fixtureProfile.control_plane.base_url = 'http://127.0.0.1:' + mock.address().port;
        fs.writeFileSync(profilePath, JSON.stringify(fixtureProfile) + '\n');
        const id = crypto.randomBytes(16).toString('hex');
        const prefix = bundle + '.receipt-' + id;
        const ps = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const args = ['-NoProfile', '-NonInteractive', '-File', path.join(here, '../../tests/windows-hosted-window-fixture.ps1'),
          '-Bundle', bundle, '-ReceiptId', id];
        if (guardedAcceptance) {
          const plan = path.join(scratch, 'proof-plan.json');
          fs.writeFileSync(plan, JSON.stringify([{ id: crypto.randomBytes(16).toString('hex'), ...requests[3].params }]), { flag: 'wx' });
          args.push('-Plan', plan);
        }
        const options = { timeout: 50000, windowsHide: true };
        stopAcceptance = () => run(ps, [...args, '-Action', 'Stop'], options);
        acceptanceWindow = run(ps, args, options).then(({ stdout }) => JSON.parse(stdout));
        acceptanceWindow.catch(() => {});
        t.after(async () => {
          if (fs.existsSync(prefix + '.started.json')) await stopAcceptance().catch(() => {});
          await acceptanceWindow.catch(() => {});
        });
        const startDeadline = Date.now() + 17000;
        while (!fs.existsSync(prefix + '.ready') && Date.now() < startDeadline) {
          const ended = await Promise.race([acceptanceWindow.then(() => true), delay(50).then(() => false)]);
          if (ended) break;
        }
        reconnected = { ready: fs.existsSync(prefix + '.ready') };
        if (reconnected.ready) {
          const expectedPath = "'" + executable.replaceAll("'", "''") + "'";
          const find = `Get-Process -Name tunnel-client-runtime -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq ${expectedPath} } | ForEach-Object { $_.Id }`;
          const { stdout } = await run(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(find, 'utf16le').toString('base64')], options);
          assert.match(stdout.trim(), /^[1-9][0-9]*$/, 'exactly one fixture client must be present');
          acceptanceCore = await observeCore(Number(stdout.trim()), runtimeNode);
          assert.ok(acceptanceCore, 'record the second hosted provider identity before requesting stop');
        }
        ownedStarts++;
      } else reconnected = installed ? await browserAction('reconnect') : await controller.reconnect();
      if (installed) assert.equal(reconnected.connection, 'ready');
      else assert.equal(reconnected.ready, true);
      assert.equal(ownedStarts, 2);
      if (sealed) {
        assert.equal(replies.length, 0, 'reconnecting must not replay queued commands');
        queued = 0;
      }
      const secondDeadline = Date.now() + 10000;
      while (replies.length < requests.length && Date.now() < secondDeadline && !errors.length) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(replies.length, requests.length); assert.equal(errors.length, 0);
      if (sealed) {
        assert.notEqual(replies[3].resp_json.result.isError, true);
        if (guardedAcceptance) {
          assert.deepEqual(replies[2].resp_json.result.tools.map(tool => tool.name), ['read_file']);
          assert.match(JSON.stringify(replies[3].resp_json.result.content), /AGENT_CONTINUE_TUNNEL_OK/);
          assert.equal(replies[4].resp_json.result.isError, true, 'cached shell tool must not run');
          assert.equal(replies[5].resp_json.result.isError, true, 'same read must not replay');
        } else {
          assert.equal(replies[4].resp_json.error?.code, -32070);
          assert.deepEqual(replies[5].resp_json.result.structuredContent, {
            status: 'provider-reported-result', requestKind: 'exact-process',
          });
        }
      }
      if (sealed) {
        await stopAcceptance();
        assert.deepEqual(await acceptanceWindow, { outcome: 'stop-requested', wasReady: true, paused: true, controllerReleased: true });
        assert.equal(await hasExited(acceptanceCore), true);
        const pollsAfterStop = mockRequests;
        await delay(250);
        assert.equal(mockRequests, pollsAfterStop);
      } else assert.equal((installed ? await browserAction('disconnect-and-pause') : await pause()).paused, true);
      assert.equal(await hasExited(cores.at(-1)), true);
      if (owner) await owner.close();
      else await controller.dispose();
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
      upstream: '0.3.1', tools: toolNames.length, correlatedResponses: firstSealedResponses + replies.length, fileRoundtrip: true,
      sealedProfileVerified: sealed,
      boundedAcceptanceWindowVerified: sealed && pauseCycleVerified,
      guardedAcceptanceProfileVerified: guardedAcceptance && pauseCycleVerified,
      forwardedNotifications, generatedProfile: mode !== 'arguments', loopbackReadyVerified: loopbackReadyVerified || controllerReady,
      hostGuardInstrumented: mode === 'arguments', ownedStarts, pauseCycleVerified, packagedManagerIPC: installed,
      installerConnectAndReconcile: installed, packagedBrowserControl: installed && !guidedInstall, actualGuidedPowerShell: guidedInstall,
      guidedPairing, guidedPairingSkipped: guidedInstall && !guidedPairing, actualPackagedChromiumControl: browserRoundtrip,
      guidedCmd, portableNodeProvisioned: provisionNode, harmlessShellRoundtrip: provisionNode || exactShell,
      exactShellReceiptVerified: exactShell,
      pathDriftRestartVerified: provisionNode,
      realOpenAITunnelTested: false, realChatGrantTested: false, stderrBytes }));
  });
