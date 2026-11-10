import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { observeDirectChild, hasExited } from './process-observation.mjs';
import { prepareHostedShellProbe } from '../../scripts/hosted-read-acceptance.mjs';
import { observeTestProcessOutput } from './test-process-output.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('real pinned core initializes, lists tools, writes/reads an owned file and executes a harmless process',
  { timeout: 180000 }, async t => {
    if (process.platform === 'win32') {
      const original = childProcess.execFile;
      childProcess.execFile = function(file, args, options, callback) {
        const encoded = args.indexOf('-EncodedCommand');
        const metadataQuery = encoded >= 0 && Buffer.from(args[encoded + 1], 'base64')
          .toString('utf16le').includes('[AgentContinueProcessQuery]::Query(');
        if (!metadataQuery) return Reflect.apply(original, this, arguments);
        const began = performance.now();
        return Reflect.apply(original, this, [file, args, options, (error, stdout, stderr) => {
          t.diagnostic(JSON.stringify({ processMetadataQuery: true, elapsedMs: Math.round(performance.now() - began),
            killed: error?.killed === true, failed: Boolean(error), stderrPresent: Boolean(stderr),
            errorKind: ['ENOENT', 'EACCES', 'ETIMEDOUT'].includes(error?.code) ? error.code : (error ? 'other' : 'none') }));
          callback(error, stdout, stderr);
        }]);
      };
      syncBuiltinESMExports();
      t.after(() => { childProcess.execFile = original; syncBuiltinESMExports(); });
    }
    let app = here, interpreter = process.execPath;
    const extracted = process.env.AC_WINDOWS_ADMIN_BUNDLE_SMOKE_ROOT;
    if (extracted !== undefined) {
      assert.equal(process.platform + '-' + process.arch, 'win32-x64');
      assert.equal(process.env.AC_WINDOWS_ADMIN_BUNDLE_SMOKE, 'accept-disposable-standard-token-test');
      assert.equal(fs.realpathSync.native(extracted), extracted);
      assert.equal(path.dirname(extracted), fs.realpathSync.native(os.tmpdir()));
      assert.match(path.basename(extracted), /^ac-admin-smoke-[a-f0-9]{32}$/);
      app = path.join(extracted, 'app');
      interpreter = path.join(extracted, 'runtime', 'node.exe');
      assert.equal(fs.realpathSync.native(app), app);
      assert.equal(fs.realpathSync.native(interpreter), interpreter);
      assert.equal(createHash('sha256').update(fs.readFileSync(interpreter)).digest('hex'),
        'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f');
      const node = spawnSync(interpreter, ['--version'], { encoding: 'utf8', windowsHide: true,
        timeout: 5000, env: { SystemRoot: process.env.SystemRoot } });
      assert.equal(node.status, 0);
      assert.equal(node.stdout.trim(), 'v22.23.4');
    }
    const { prepareState, buildHostLaunch } = await import(pathToFileURL(path.join(app, 'runtime.mjs')).href);
    const scratch = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ac-browser-native-start-'));
    const root = path.join(scratch, 'device', 'state');
    fs.mkdirSync(path.dirname(root));
    prepareState(root, { consent: 'full-account' });
    const guardLog = path.join(scratch, 'guard.log');
    const env = { ...process.env, AGENT_CONTINUE_TEST_GUARD_LOG: guardLog };
    // Avoid WindowsApps Python aliases and unrelated developer PATH executables in discovery.
    if (process.platform === 'win32') env.PATH = [path.dirname(interpreter),
      path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
    const launch = buildHostLaunch(root, env);
    let child, exited, stderrBytes = 0, buffer = '', protocolErrors = 0, id = 0;
    const waiting = new Map(), replyCount = new Map();
    function openHost() {
      child = spawn(interpreter, ['--import', pathToFileURL(path.join(here, 'test-fixtures', 'startup-guard.mjs')).href, ...launch.args],
        { ...launch, stdio: ['pipe', 'pipe', 'pipe'] });
      exited = new Promise(resolve => child.once('close', (code, signal) => {
        for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('host_exit_' + code)); }
        waiting.clear(); resolve({ code, signal });
      }));
      child.stderr.on('data', data => { stderrBytes += data.length; });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', consume);
    }
    async function waitForExit() {
      let timer;
      try { return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]); }
      finally { clearTimeout(timer); }
    }
    function consume(data) {
      buffer += data;
      if (buffer.length > 4 * 1024 * 1024) { protocolErrors++; child.kill(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const reply = JSON.parse(line);
          if (reply.jsonrpc !== '2.0') throw new Error('bad_rpc');
          if ('id' in reply && ('result' in reply || 'error' in reply)) {
            replyCount.set(reply.id, (replyCount.get(reply.id) ?? 0) + 1);
          }
          if ('id' in reply && waiting.has(reply.id)) {
            const pending = waiting.get(reply.id); waiting.delete(reply.id); clearTimeout(pending.timer);
            if (reply.error) pending.reject(Object.assign(new Error('rpc_error'), { code: reply.error.code }));
            else pending.resolve(reply.result);
          }
        } catch { protocolErrors++; }
      }
    }
    openHost();
    t.after(async () => {
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('test_closed')); }
      waiting.clear(); child.stdin.end();
      const stopped = await waitForExit();
      if (!stopped) { child.kill(); await exited; }
      fs.rmSync(scratch, { recursive: true, force: true });
    });
    function send(method, params, requestId = ++id, copies = 1) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('rpc_timeout_' + method)); }, 25000);
        waiting.set(requestId, { resolve, reject, timer });
        child.stdin.write((JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n').repeat(copies));
      });
    }
    async function initialize() {
      const response = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'agent-continue-isolated-test', version: '0.1.0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      return response;
    }
    const initialized = await initialize();
    assert.equal(initialized.serverInfo.name, 'desktop-commander');
    assert.equal(initialized.serverInfo.version, '0.3.1');
    const listed = await send('tools/list', {});
    const names = listed.tools.map(tool => tool.name);
    for (const name of ['write_file', 'read_file', 'start_process', 'read_process_output', 'list_sessions', 'force_terminate']) assert.ok(names.includes(name), name);
    assert.equal(listed.tools.find(tool => tool.name === 'write_file').inputSchema.properties.agent_continue_operation_id.type, 'string');
    assert.equal(Object.hasOwn(listed.tools.find(tool => tool.name === 'read_file').inputSchema.properties,
      'agent_continue_operation_id'), false);
    const receiptTool = 'agent_continue_operation_status';
    assert.equal(listed.tools.find(tool => tool.name === receiptTool)?.annotations?.readOnlyHint, true);
    const exactProcess = 'agent_continue_start_process_exact';
    const preparedProcess = 'agent_continue_start_prepared_process';
    const preparedSchema = listed.tools.find(tool => tool.name === preparedProcess)?.inputSchema;
    assert.deepEqual(preparedSchema?.required, ['agent_continue_operation_id', 'agent_continue_process_sha256']);
    assert.equal(preparedSchema.additionalProperties, false);
    assert.equal(listed.tools.find(tool => tool.name === preparedProcess)?.annotations?.destructiveHint, true);
    const exactSchema = listed.tools.find(tool => tool.name === exactProcess)?.inputSchema;
    assert.deepEqual(exactSchema?.required, ['command', 'shell', 'timeout_ms',
      'agent_continue_operation_id', 'agent_continue_process_sha256']);
    assert.equal(exactSchema.additionalProperties, false);
    assert.equal(listed.tools.find(tool => tool.name === exactProcess)?.annotations?.readOnlyHint, false);
    const receipt = async operationId => (await send('tools/call', { name: receiptTool,
      arguments: { agent_continue_operation_id: operationId } })).structuredContent;
    assert.deepEqual(await receipt('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), { status: 'not-recorded' });
    assert.equal(fs.existsSync(path.join(root, 'mcp-operation-receipts')), false, 'lookup alone does not write');
    const ownedFile = path.join(root, 'work', 'harmless file.txt');
    const written = await send('tools/call', { name: 'write_file', arguments: { path: ownedFile, content: 'AGENT_CONTINUE_FILE_OK', mode: 'rewrite' } });
    assert.notEqual(written.isError, true);
    assert.equal(fs.readFileSync(ownedFile, 'utf8'), 'AGENT_CONTINUE_FILE_OK');
    const read = await send('tools/call', { name: 'read_file', arguments: { path: ownedFile, length: 10 } });
    assert.notEqual(read.isError, true);
    assert.match(JSON.stringify(read.content), /AGENT_CONTINUE_FILE_OK/);
    const replayFile = path.join(root, 'work', 'replay.txt');
    const append = { name: 'write_file', arguments: { path: replayFile, content: 'test\n', mode: 'append',
      agent_continue_operation_id: 'abcdabcd-abcd-4abc-8abc-abcdabcdabcd' } };
    assert.notEqual((await send('tools/call', append, 'append-test', 2)).isError, true);
    await assert.rejects(send('tools/call', { ...append, arguments: { ...append.arguments, content: 'different\n' } },
      'different-rpc-id'), { code: -32070 });
    assert.equal(replyCount.get('append-test'), 1, 'the in-flight duplicate must not steal the first response');
    assert.equal(fs.readFileSync(replayFile, 'utf8'), 'test\n');
    assert.deepEqual(await receipt(append.arguments.agent_continue_operation_id), { status: 'provider-reported-result' });
    await assert.rejects(send('tools/call', { ...append, arguments: { ...append.arguments, agent_continue_operation_id: 'invalid' } },
      'append-test'), { code: -32602 });
    const another = { ...append, arguments: { ...append.arguments,
      agent_continue_operation_id: 'abceabcd-abcd-4abc-8abc-abcdabcdabcd' } };
    assert.notEqual((await send('tools/call', another, 'append-test')).isError, true);
    assert.equal(fs.readFileSync(replayFile, 'utf8'), 'test\ntest\n');
    const unkeyed = { ...append, arguments: { path: replayFile, content: 'unkeyed\n', mode: 'append' } };
    await send('tools/call', unkeyed, 'reusable-rpc');
    await send('tools/call', unkeyed, 'reusable-rpc');
    assert.equal(fs.readFileSync(replayFile, 'utf8'), 'test\ntest\nunkeyed\nunkeyed\n');
    const cancelled = { name: 'write_file', arguments: { path: path.join(root, 'work', 'cancelled.txt'),
      content: 'cancelled\n', mode: 'append', agent_continue_operation_id: 'abcfabcd-abcd-4abc-8abc-abcdabcdabcd' } };
    const cancelledId = 'cancelled-rpc';
    child.stdin.write([
      { jsonrpc: '2.0', id: cancelledId, method: 'tools/call', params: cancelled },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: cancelledId } },
    ].map(frame => JSON.stringify(frame) + '\n').join(''));
    await send('ping', {});
    await assert.rejects(send('tools/call', cancelled, cancelledId), { code: -32070 });
    assert.equal(replyCount.get(cancelledId), 1, 'cancelled operation has no success response and is not re-admitted');
    assert.deepEqual(await receipt(cancelled.arguments.agent_continue_operation_id), { status: 'admitted-outcome-unconfirmed' });
    const rejected = { ...append, arguments: { ...append.arguments, path: path.join(root, 'work'),
      agent_continue_operation_id: 'abddabcd-abcd-4abc-8abc-abcdabcdabcd' } };
    assert.equal((await send('tools/call', rejected)).isError, true);
    assert.deepEqual(await receipt(rejected.arguments.agent_continue_operation_id), { status: 'provider-reported-error' });
    const command = process.platform === 'win32' ? 'Write-Output AGENT_CONTINUE_PROCESS_OK' : 'printf AGENT_CONTINUE_PROCESS_OK';
    const shell = process.platform === 'win32'
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').replaceAll('\\', '/')
      : '/bin/sh';
    const processCall = { name: 'start_process', arguments: { command, shell, timeout_ms: 10000,
      agent_continue_operation_id: 'abdfabcd-abcd-4abc-8abc-abcdabcdabcd' } };
    const executed = await send('tools/call', processCall);
    assert.notEqual(executed.isError, true);
    const processOutput = (started, marker) => observeTestProcessOutput(started, marker,
      request => send('tools/call', request));
    assert.match(await processOutput(executed, 'AGENT_CONTINUE_PROCESS_OK'), /AGENT_CONTINUE_PROCESS_OK/);
    const exactCommand = process.platform === 'win32' ? "Write-Output ('AC_' + 'EXACT_OK')" : "printf '%s' 'AC_EXACT_OK'";
    const exactId = 'abc1abcd-abcd-4abc-8abc-abcdabcdabcd';
    const exactArgs = { command: exactCommand, shell, timeout_ms: 10000, agent_continue_operation_id: exactId,
      agent_continue_process_sha256: createHash('sha256').update(JSON.stringify([exactCommand, shell, 10000])).digest('hex') };
    const exact = arguments_ => send('tools/call', { name: exactProcess, arguments: arguments_ });
    let managedStop;
    if (['win32', 'linux'].includes(process.platform)) {
      const marker = 'ac-owned-' + randomUUID();
      const witnessFile = path.join(root, 'work', marker);
      const lifetime = 45000, timeout = 1000;
      const managedCommand = process.platform === 'win32'
        ? "$ErrorActionPreference='Stop';$file=[IO.File]::Open('" + marker + "',[IO.FileMode]::CreateNew);" +
          "try{$bytes=[Text.Encoding]::ASCII.GetBytes([string]$PID);$file.Write($bytes,0,$bytes.Length)}finally{$file.Dispose()};" +
          "[Threading.Thread]::Sleep(" + lifetime + ");"
        : "set -C; printf '%s' \"$$\" > '" + marker + "'; sleep " + lifetime / 1000;
      const began = performance.now();
      const managedStart = randomUUID();
      const launched = await exact({
        command: managedCommand, shell, timeout_ms: timeout, agent_continue_operation_id: managedStart,
        agent_continue_process_sha256: createHash('sha256').update(JSON.stringify([managedCommand, shell, timeout])).digest('hex'),
      });
      assert.notEqual(launched.isError, true);
      const match = /(?:^|\n)Process started with PID ([1-9]\d{0,9})\b/.exec(
        launched.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
      assert.ok(match, 'a PID from this exact tool result is required');
      const pid = Number(match[1]), proofDeadline = performance.now() + 3000;
      while (!fs.existsSync(witnessFile) && performance.now() < proofDeadline) await delay(25);
      assert.equal(fs.readFileSync(witnessFile, 'utf8'), match[1]);
      const executable = fs.realpathSync.native(shell);
      const identity = await observeDirectChild(child.pid, pid, executable);
      assert.ok(identity, 'only the independently observed child of this MCP instance may be stopped');
      const sessions = async () => {
        const reply = await send('tools/call', { name: 'list_sessions', arguments: {} });
        assert.notEqual(reply.isError, true);
        assert.equal(reply.content.length, 1);
        assert.equal(reply.content[0].type, 'text');
        const snapshot = reply.content[0].text;
        if (snapshot === 'No active sessions') return [];
        return snapshot.split(/\r?\n/).map(line => {
          const session = /^PID: ([1-9]\d{0,9}), Blocked: (?:true|false), Runtime: \d+s$/.exec(line);
          assert.ok(session, 'unrecognized session output cannot prove absence');
          return Number(session[1]);
        });
      };
      const first = (await sessions()).filter(session => session === pid);
      assert.equal(first.length, 1);
      assert.equal(await hasExited(identity), false);
      assert.ok(performance.now() - began < lifetime - 10000, 'no stop near the natural expiry of the fixture');
      const stop = { name: 'force_terminate', arguments: { pid, agent_continue_operation_id: randomUUID() } };
      const stopped = await send('tools/call', stop);
      assert.notEqual(stopped.isError, true);
      assert.match(stopped.content.map(block => block.text).join('\n'), new RegExp('termination of session ' + pid + '$'));
      assert.equal(await hasExited(identity), true, 'the OS must positively observe the original generation exited');
      assert.ok(performance.now() - began < lifetime);
      assert.equal((await sessions()).includes(pid), false);
      assert.deepEqual(await receipt(stop.arguments.agent_continue_operation_id), { status: 'provider-reported-result' });
      await assert.rejects(send('tools/call', stop), { code: -32070 });
      managedStop = stop;
    }
    await assert.rejects(exact({ ...exactArgs, agent_continue_process_sha256: undefined }), { code: -32602 });
    await assert.rejects(exact({ ...exactArgs, agent_continue_operation_id: undefined }), { code: -32602 });
    await assert.rejects(exact({ ...exactArgs, extra: true }), { code: -32602 });
    await assert.rejects(send('tools/call', { name: 'start_process', arguments: exactArgs }), { code: -32602 });
    const unintended = process.platform === 'win32'
      ? "Set-Content -LiteralPath 'exact-mismatch.txt' -Value 'must not execute'"
      : "printf 'must not execute' > exact-mismatch.txt";
    await assert.rejects(exact({ ...exactArgs, command: unintended }), { code: -32072 });
    await assert.rejects(exact({ ...exactArgs, command: exactCommand + ' ' }), { code: -32072 });
    await assert.rejects(exact({ ...exactArgs, shell: shell + '-changed' }), { code: -32072 });
    await assert.rejects(exact({ ...exactArgs, timeout_ms: 9999 }), { code: -32072 });
    assert.equal(fs.existsSync(path.join(root, 'work', 'exact-mismatch.txt')), false);
    assert.deepEqual(await receipt(exactId), { status: 'not-recorded' });
    const exactResult = await exact(exactArgs);
    assert.notEqual(exactResult.isError, true);
    assert.match(await processOutput(exactResult, 'AC_EXACT_OK'), /AC_EXACT_OK/);
    const exactReceipt = { status: 'provider-reported-result', requestKind: 'exact-process' };
    assert.deepEqual(await receipt(exactId), exactReceipt);
    const exactKey = createHash('sha256').update(exactId).digest('hex');
    assert.equal(fs.readFileSync(path.join(root, 'mcp-operation-receipts', exactKey + '.admitted'), 'utf8'),
      'admitted-exact\nprovider-reported-result\n');
    await assert.rejects(exact(exactArgs), { code: -32070 });
    const stagingCLI = path.join(app, 'prepared-process.mjs');
    const requestFile = path.join(scratch, 'prepared request.json');
    const effect = path.join(root, 'work', 'prepared-replay.txt');
    const preparedCommand = process.platform === 'win32'
      ? "Add-Content -LiteralPath 'prepared-replay.txt' -Value ('AC_' + 'PREPARED_OK'); Write-Output AC_PREPARED_OK"
      : "printf '%s\\n' 'AC_PREPARED_OK' >> prepared-replay.txt; printf '%s\\n' 'AC_PREPARED_OK'";
    const localRequest = { command: preparedCommand, shell, timeout_ms: 10000 };
    fs.writeFileSync(requestFile, JSON.stringify(localRequest), { flag: 'wx' });
    const local = (...args) => spawnSync(interpreter, [stagingCLI, ...args],
      { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    const review = JSON.parse(local('inspect', '--request-file', requestFile).stdout);
    const reviewed = createHash('sha256').update(JSON.stringify([preparedCommand, shell, 10000])).digest('hex');
    assert.deepEqual(review, { agent_continue_process_sha256: reviewed, staged: false, executed: false });
    const stage = digest => local('stage', '--state-dir', root, '--request-file', requestFile, '--reviewed-sha256', digest);
    assert.equal(stage('0'.repeat(64)).status, 1);
    assert.equal(fs.existsSync(path.join(root, 'prepared-processes')), false);
    const { staged, executed: stagedExecuted, expiresAt, ...reference } = JSON.parse(stage(reviewed).stdout);
    assert.equal(staged, true);
    assert.equal(stagedExecuted, false);
    assert.ok(expiresAt > Date.now());
    assert.equal(fs.existsSync(effect), false);
    const prepared = args => send('tools/call', { name: preparedProcess, arguments: args });
    await assert.rejects(prepared({ ...reference, command: 'different' }), { code: -32602 });
    await assert.rejects(prepared({ ...reference, agent_continue_process_sha256: '1'.repeat(64) }), { code: -32073 });
    const retainedPlan = path.join(root, 'prepared-processes', reference.agent_continue_operation_id + '.json');
    const retainedBytes = fs.readFileSync(retainedPlan);
    const plan = JSON.parse(retainedBytes);
    plan.expiresAt = Date.now() - 1000;
    fs.writeFileSync(retainedPlan, JSON.stringify(plan));
    await assert.rejects(prepared(reference), { code: -32073 });
    plan.expiresAt = expiresAt;
    plan.request.command = 'different';
    fs.writeFileSync(retainedPlan, JSON.stringify(plan));
    await assert.rejects(prepared(reference), { code: -32073 });
    assert.equal(fs.existsSync(effect), false);
    assert.deepEqual(await receipt(reference.agent_continue_operation_id), { status: 'not-recorded' });
    fs.writeFileSync(retainedPlan, retainedBytes);
    fs.writeFileSync(requestFile, JSON.stringify({ ...localRequest, command: 'different' }));
    let windowsToken = null;
    if (process.platform === 'win32') {
      const probe = "$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); " +
        "Write-Output ('AC_' + 'OS_TOKEN_' + $(if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'ADMIN' } else { 'STANDARD' }))";
      const direct = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', probe],
        { windowsHide: true, encoding: 'utf8', timeout: 10000 });
      assert.equal(direct.status, 0, 'direct Windows token probe did not complete');
      const observed = direct.stdout.trim();
      assert.match(observed, /^AC_OS_TOKEN_(ADMIN|STANDARD)$/);
      const args = { ...exactArgs, command: probe, agent_continue_operation_id: 'abc2abcd-abcd-4abc-8abc-abcdabcdabcd',
        agent_continue_process_sha256: createHash('sha256').update(JSON.stringify([probe, shell, 10000])).digest('hex') };
      const result = await exact(args);
      assert.notEqual(result.isError, true);
      const output = await processOutput(result, observed);
      assert.deepEqual(output.match(/\bAC_OS_TOKEN_(?:ADMIN|STANDARD)\b/g), [observed]);
      windowsToken = observed === 'AC_OS_TOKEN_ADMIN' ? 'administrator' : 'standard';
      if (extracted !== undefined) assert.equal(windowsToken, 'standard');
      async function exerciseTokenProbe(expectedWindowsToken) {
        const hostedProbe = prepareHostedShellProbe(root, { exact: true, expectedWindowsToken });
        const openedAt = Date.now();
        const attested = await send('tools/call', { name: hostedProbe.tool, arguments: hostedProbe.request });
        assert.notEqual(attested.isError, true);
        const marker = (await processOutput(attested, /\bAC_WEB_SHELL_[a-f0-9]{32}\b/)).match(/\bAC_WEB_SHELL_[a-f0-9]{32}\b/g) ?? [];
        assert.equal(marker.length, 1);
        assert.equal(hostedProbe.request.command.includes(marker[0].slice(-32)), false);
        const browserDigest = createHash('sha256').update(marker[0]).digest('hex');
        let proof;
        const deadline = performance.now() + 3000;
        do {
          try {
            proof = hostedProbe.verify({ openedAt, closedAt: Date.now() }, { browserDigest });
            if (proof.shellCalls > 0) break;
          } catch (error) {
            // A provider history flush may overlap the read. Reobserve only;
            // never dispatch the token probe again.
            if (error.code !== 'evidence_changed_during_read') throw error;
          }
          await delay(50);
        } while (performance.now() < deadline);
        assert.ok(proof, 'token evidence never stabilized');
        assert.equal(proof.browserProof, true);
        await assert.rejects(exact(hostedProbe.request), { code: -32070 });
        return proof;
      }
      const proof = await exerciseTokenProbe(windowsToken);
      assert.equal(proof.childProof, 'verified', JSON.stringify(proof));
      assert.equal(proof.childToken, windowsToken);
      assert.equal(proof.childAccountMatches, true);
      assert.equal(proof.verified, true);
      const mismatch = await exerciseTokenProbe(windowsToken === 'administrator' ? 'standard' : 'administrator');
      assert.equal(mismatch.childToken, windowsToken);
      assert.equal(mismatch.childAccountMatches, true);
      assert.equal(mismatch.childProof, 'token-mismatch');
      assert.equal(mismatch.verified, false);

      const generator = path.resolve(here, '../../scripts/prepare-hosted-administrator-probe.mjs');
      const generated = JSON.parse(spawnSync(process.execPath, [generator, 'chatgpt'],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 }).stdout);
      const planDir = path.dirname(generated.file);
      assert.equal(path.dirname(planDir), fs.realpathSync.native(os.tmpdir()));
      assert.match(path.basename(planDir), /^ac-hosted-admin-plan-[a-zA-Z0-9]{6}$/);
      try {
        const [step] = generated.steps;
        assert.equal(step.plan.name, exactProcess);
        const result = await exact(step.plan.arguments);
        assert.notEqual(result.isError, true);
        const text = await processOutput(result, windowsToken === 'standard'
          ? 'AC_ADMIN_PROBE_REQUIRES_ELEVATION' : /\bAC_ADMIN_[a-f0-9]{32}\b/);
        const proofPath = path.join(root, 'work', step.proof);
        if (windowsToken === 'standard') {
          assert.match(text, /\bAC_ADMIN_PROBE_REQUIRES_ELEVATION\b/);
          assert.equal(fs.existsSync(proofPath), false);
        } else {
          const witness = fs.readFileSync(proofPath, 'ascii');
          assert.match(witness, /^v2:[1-9]\d{0,9}:S-1-[\d-]+:1:S-1-16-12288:AC_ADMIN_[a-f0-9]{32}$/);
          const [, pid] = witness.split(':');
          assert.match(text, new RegExp('^Process started with PID ' + pid + '\\b', 'm'));
          assert.ok(text.includes(witness.split(':').at(-1)));
        }
        assert.deepEqual(await receipt(step.plan.arguments.agent_continue_operation_id), exactReceipt);
        await assert.rejects(exact(step.plan.arguments), { code: -32070 });
      } finally {
        fs.rmSync(generated.file);
        fs.rmdirSync(planDir);
      }
    }
    assert.equal(protocolErrors, 0);
    child.stdin.end();
    const stopped = await waitForExit();
    assert.deepEqual(stopped, { code: 0, signal: null });
    openHost();
    await initialize();
    if (managedStop) {
      await assert.rejects(send('tools/call', managedStop), { code: -32070 });
      assert.deepEqual(await receipt(managedStop.arguments.agent_continue_operation_id), { status: 'provider-reported-result' });
    }
    const firstPrepared = await prepared(reference);
    assert.notEqual(firstPrepared.isError, true);
    assert.match(await processOutput(firstPrepared, 'AC_PREPARED_OK'), /AC_PREPARED_OK/);
    assert.equal(fs.readFileSync(effect, 'utf8').trim(), 'AC_PREPARED_OK');
    const preparedReceipt = { status: 'provider-reported-result', requestKind: 'prepared-process' };
    assert.deepEqual(await receipt(reference.agent_continue_operation_id), preparedReceipt);
    await assert.rejects(prepared(reference), { code: -32070 });
    const revokeArgs = ({ agent_continue_operation_id: id, agent_continue_process_sha256: digest }) =>
      ['revoke', '--state-dir', root, '--operation-id', id, '--reviewed-sha256', digest];
    const alreadyAdmitted = local(...revokeArgs(reference));
    assert.equal(alreadyAdmitted.status, 2);
    assert.deepEqual(JSON.parse(alreadyAdmitted.stdout), { agent_continue_operation_id: reference.agent_continue_operation_id,
      revoked: false, status: 'provider-reported-result' });
    function stageAnother(file) {
      const command = preparedCommand.replaceAll('prepared-replay.txt', file);
      fs.writeFileSync(requestFile, JSON.stringify({ ...localRequest, command }));
      const digest = createHash('sha256').update(JSON.stringify([command, shell, 10000])).digest('hex');
      const { agent_continue_operation_id, agent_continue_process_sha256 } = JSON.parse(stage(digest).stdout);
      return { agent_continue_operation_id, agent_continue_process_sha256 };
    }
    const cancelledPrepared = stageAnother('prepared-revoked.txt');
    const revokeAttempt = { ...cancelledPrepared, agent_continue_process_sha256: '1'.repeat(64) };
    assert.equal(local(...revokeArgs(revokeAttempt)).status, 1);
    assert.deepEqual(await receipt(cancelledPrepared.agent_continue_operation_id), { status: 'not-recorded' });
    const revokedReceipt = { status: 'owner-revoked', requestKind: 'prepared-process' };
    for (let n = 0; n < 2; n++) {
      const revoked = local(...revokeArgs(cancelledPrepared));
      assert.equal(revoked.status, 0);
      assert.deepEqual(JSON.parse(revoked.stdout), { agent_continue_operation_id: cancelledPrepared.agent_continue_operation_id,
        revoked: true, status: 'owner-revoked' });
    }
    assert.deepEqual(await receipt(cancelledPrepared.agent_continue_operation_id), revokedReceipt);
    await assert.rejects(prepared(cancelledPrepared), { code: -32074 });
    await assert.rejects(exact({ ...exactArgs,
      agent_continue_operation_id: cancelledPrepared.agent_continue_operation_id }), { code: -32074 });
    assert.equal(fs.existsSync(path.join(root, 'work', 'prepared-revoked.txt')), false);

    const raced = stageAnother('prepared-race.txt');
    const [raceRevocation, raceExecution] = await Promise.all([
      new Promise((resolve, reject) => execFile(interpreter, [stagingCLI, ...revokeArgs(raced)],
        { windowsHide: true, encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
          if (error && error.code !== 2) reject(error);
          else resolve(JSON.parse(stdout));
        })),
      prepared(raced).then(async result => {
        if (result.isError === true) return false;
        // A provider start reply settles admission, not the child's file effect.
        // Observe only this returned PID before checking the winning effect.
        assert.match(await processOutput(result, 'AC_PREPARED_OK'), /AC_PREPARED_OK/);
        return true;
      }, error => {
        assert.ok([-32070, -32074].includes(error.code));
        return false;
      }),
    ]);
    assert.notEqual(raceRevocation.revoked, raceExecution);
    assert.equal(fs.existsSync(path.join(root, 'work', 'prepared-race.txt')), raceExecution);
    assert.deepEqual(await receipt(raced.agent_continue_operation_id), raceExecution ? preparedReceipt : revokedReceipt);
    assert.deepEqual(await receipt(append.arguments.agent_continue_operation_id), { status: 'provider-reported-result' });
    assert.deepEqual(await receipt(cancelled.arguments.agent_continue_operation_id), { status: 'admitted-outcome-unconfirmed' });
    assert.deepEqual(await receipt(rejected.arguments.agent_continue_operation_id), { status: 'provider-reported-error' });
    assert.deepEqual(await receipt(processCall.arguments.agent_continue_operation_id), { status: 'provider-reported-result' });
    assert.deepEqual(await receipt(exactId), exactReceipt);
    await assert.rejects(send('tools/call', append, 'after-restart'), { code: -32070 });
    await assert.rejects(send('tools/call', cancelled, 'cancelled-after-restart'), { code: -32070 });
    await assert.rejects(send('tools/call', processCall, 'shell-after-restart'), { code: -32070 });
    await assert.rejects(exact(exactArgs), { code: -32070 });
    const hash = createHash('sha256').update(append.arguments.agent_continue_operation_id).digest('hex');
    const retained = path.join(root, 'mcp-operation-receipts', hash + '.admitted');
    assert.equal(fs.readFileSync(retained, 'utf8'), 'admitted\nprovider-reported-result\n');
    fs.appendFileSync(retained, 'corrupt\n');
    assert.deepEqual(await receipt(append.arguments.agent_continue_operation_id), { status: 'receipt-unavailable' });
    await assert.rejects(send('tools/call', append), { code: -32070 });
    assert.equal(fs.readFileSync(replayFile, 'utf8'), 'test\ntest\nunkeyed\nunkeyed\n');
    child.stdin.end();
    assert.deepEqual(await waitForExit(), { code: 0, signal: null });
    openHost();
    await initialize();
    assert.deepEqual(await receipt(reference.agent_continue_operation_id), preparedReceipt);
    await assert.rejects(prepared(reference), { code: -32070 });
    assert.deepEqual(await receipt(cancelledPrepared.agent_continue_operation_id), revokedReceipt);
    await assert.rejects(prepared(cancelledPrepared), { code: -32074 });
    assert.equal(fs.existsSync(path.join(root, 'work', 'prepared-revoked.txt')), false);
    assert.equal(fs.readFileSync(effect, 'utf8').trim(), 'AC_PREPARED_OK');
    child.stdin.end();
    assert.deepEqual(await waitForExit(), { code: 0, signal: null });
    const events = fs.readFileSync(guardLog, 'utf8').trim().split('\n');
    assert.ok(events.includes('guard-loaded'));
    assert.ok(events.includes('hidden-child'));
    for (const event of ['network-attempt', 'browser-attempt', 'visible-child-attempt']) assert.equal(events.includes(event), false, event);
    t.diagnostic(JSON.stringify({ upstream: initialized.serverInfo.version, tools: names.length,
      rpcReplies: id, protocolErrors, hostNetworkAttempts: events.filter(x => x === 'network-attempt').length,
      directBrowserAttempts: events.filter(x => x === 'browser-attempt').length, stderrBytes,
      fileRoundtrip: true, harmlessProcess: true, preparedProcess: true, preparedRevocation: true,
      managedProcessVerified: Boolean(managedStop), windowsToken, extractedBundle: extracted !== undefined,
      stdinCloseExit: stopped.code }));
  });
