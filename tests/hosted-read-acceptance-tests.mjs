import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {prepareHostedAppendProbe, prepareHostedShellProbe, summarizeHostedReadEvidence, hostedReadGate} from '../scripts/hosted-read-acceptance.mjs';

const cli = fileURLToPath(new URL('../scripts/hosted-read-acceptance.mjs', import.meta.url));
const surfaces = ['chatgpt', 'dot'];
const stdinLimit = 64 * 1024;

function assertInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), 'expected a path inside the owned fixture directory');
}

function fixturePath(parent, candidate) {
  assert.ok(typeof candidate === 'string' && path.isAbsolute(candidate));
  assertInside(parent, candidate);
  assert.ok(realpathSync.native(candidate) === candidate, 'fixture paths must not be aliases');
  return candidate;
}

function fixture(t) {
  const temp = realpathSync.native(tmpdir());
  const scratch = mkdtempSync(path.join(temp, 'hosted-read-tests-'));
  t.after(() => {
    assertInside(temp, scratch);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, {recursive: true});
  });

  // Do not inherit credential, proxy, or Node preload configuration.
  const env = {TEMP: scratch, TMP: scratch, TMPDIR: scratch, HOME: scratch, USERPROFILE: scratch};
  if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;

  function invoke(args, input) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: scratch, env, input, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  }

  const challenges = new Set();
  function assertRedacted(result) {
    for (const challenge of challenges) {
      assert.ok(!result.stdout.includes(challenge) && !result.stderr.includes(challenge),
        'CLI output must not expose a probe challenge');
    }
  }

  function prepare(withComparison = false) {
    const result = invoke(withComparison ? ['prepare', '--comparison'] : ['prepare']);
    assert.equal(result.status, 0, 'prepare must succeed');
    const {ok, runDir, probes, toolInvocationVerified} = JSON.parse(result.stdout);
    assert.equal(ok, true);
    assert.equal(toolInvocationVerified, false);
    const names = withComparison ? ['chatgpt', 'chatgpt-control', 'dot'] : surfaces;
    assert.deepEqual(Object.keys(probes).sort(), names);
    const run = {dir: fixturePath(scratch, runDir), probes: {}};
    assert.ok(lstatSync(run.dir).isDirectory());
    for (const surface of names) {
      const {file, prompt} = probes[surface];
      const probe = fixturePath(run.dir, file);
      const stat = lstatSync(probe);
      assert.ok(stat.isFile() && stat.nlink === 1, 'probe must be an independent regular file');
      assert.ok(typeof prompt === 'string' && prompt.includes(file), 'prompt must name its probe');
      const other = surface === 'chatgpt' ? 'dot' : 'chatgpt';
      assert.ok(!prompt.includes(probes[other].file), 'prompt must not name the other probe');
      const raw = readFileSync(probe, 'utf8');
      const marker = raw.trim().match(new RegExp(`^AC_HOSTED_READ_${surface}_([0-9a-f]{64})$`));
      assert.ok(marker, 'probe must contain a single marker for its surface');
      const [, challenge] = marker;
      challenges.add(challenge);
      run.probes[surface] = {file: probe, raw, challenge};
    }
    for (const surface of names) {
      for (const challenge of challenges) {
        assert.ok(!probes[surface].prompt.includes(challenge), 'prompt must not expose a probe challenge');
      }
    }
    assertRedacted(result);
    return run;
  }

  function compare(run, surface, input, match, {allowError = false} = {}) {
    const result = invoke(['compare', run.dir, surface], input);
    assertRedacted(result);
    if (match) assert.equal(result.status, 0);
    else assert.ok(Number.isInteger(result.status) && result.status > 0, 'must exit nonzero');

    // Invalid input and damaged fixtures may produce a fixed error instead of a mismatch receipt.
    const receipt = JSON.parse(allowError ? result.stdout || result.stderr : result.stdout);
    if (allowError && receipt.ok === false) {
      assert.match(receipt.error, /^[a-z][a-z0-9_-]*$/i);
      if ('match' in receipt) assert.equal(receipt.match, false);
      if ('toolInvocationVerified' in receipt) assert.equal(receipt.toolInvocationVerified, false);
    } else {
      assert.deepEqual(receipt, {ok: true, match, surface, toolInvocationVerified: false});
    }
  }

  function history(run, surface, entries, expected) {
    const file = path.join(scratch, 'provider-history.jsonl');
    writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const result = invoke(['history', run.dir, surface, file, '1000', '2000']);
    assertRedacted(result);
    assert.equal(result.status, expected.markerMatched ? 0 : 1);
    assert.deepEqual(JSON.parse(result.stdout), { surface, otherReadCalls: 0,
      origins: {ui: 0, llm: 0, unattributed: expected.exactCalls}, ...expected });
  }

  return {prepare, compare, challenges, history};
}

test('prepare isolates the surface probes and does not reveal either challenge', t => {
  const {prepare} = fixture(t);
  const {probes: {chatgpt, dot}} = prepare();
  assert.notEqual(chatgpt.file, dot.file);
  assert.notEqual(chatgpt.challenge, dot.challenge);
});

test('one expected marker matches on each surface without verifying any hosted call', t => {
  const {prepare, compare} = fixture(t);
  const run = prepare();
  for (const surface of surfaces) {
    const result = JSON.stringify({content: [{type: 'text', text: run.probes[surface].raw}]});
    compare(run, surface, result, true);
  }
});

test('a valid marker for the other surface cannot match', t => {
  const {prepare, compare} = fixture(t);
  const run = prepare();
  compare(run, 'chatgpt', run.probes.dot.raw, false);
  compare(run, 'dot', run.probes.chatgpt.raw, false);
});

test('a marker from an earlier run cannot match the same surface', t => {
  const {prepare, compare} = fixture(t);
  const stale = prepare();
  const current = prepare();
  assert.notEqual(stale.dir, current.dir);
  for (const surface of surfaces) compare(current, surface, stale.probes[surface].raw, false);
});

test('missing, duplicate, or mixed markers cannot match', t => {
  const {prepare, compare} = fixture(t);
  const run = prepare();
  const {chatgpt, dot} = run.probes;
  compare(run, 'chatgpt', 'synthetic tool result without a marker', false);
  compare(run, 'chatgpt', `${chatgpt.raw}\n${chatgpt.raw}`, false);
  compare(run, 'chatgpt', `${chatgpt.raw}\n${dot.raw}`, false);
  compare(run, 'chatgpt', `${dot.raw}\n${chatgpt.raw}`, false);
});

test('stdin limit is measured in bytes even when the marker occurs first', t => {
  const {prepare, compare} = fixture(t);
  const run = prepare();
  const {raw} = run.probes.chatgpt;
  const prefix = raw + 'x'.repeat(stdinLimit - Buffer.byteLength(raw) - 1);
  compare(run, 'chatgpt', prefix + 'x', true);
  compare(run, 'chatgpt', prefix + '\u00e9', false, {allowError: true});
});

test('a well-formed replacement marker cannot match the retained digest', t => {
  const {prepare, compare, challenges} = fixture(t);
  const run = prepare();
  const {file, raw, challenge} = run.probes.chatgpt;
  compare(run, 'chatgpt', raw, true);
  const replacement = (challenge[0] === '0' ? '1' : '0') + challenge.slice(1);
  challenges.add(replacement);
  const mutated = raw.replace(challenge, replacement);
  writeFileSync(file, mutated, 'utf8');
  compare(run, 'chatgpt', raw, false, {allowError: true});
  compare(run, 'chatgpt', mutated, false, {allowError: true});
  compare(run, 'dot', run.probes.dot.raw, true);
});

test('local receipt requires one exact post-reopen read and matching result, with no raw output', t => {
  const {prepare, history} = fixture(t);
  const run = prepare();
  const {file, raw} = run.probes.chatgpt;
  const valid = { timestamp: new Date(1500).toISOString(), toolName: 'read_file', arguments: { path: file },
    output: {content: [{type: 'text', text: raw}]} };
  history(run, 'chatgpt', [valid], {exactCalls: 1, matchingCalls: 1, markerMatched: true});
  history(run, 'dot', [valid], {exactCalls: 0, matchingCalls: 0, markerMatched: false});
  history(run, 'chatgpt', [valid, valid], {exactCalls: 2, matchingCalls: 2, markerMatched: false});
  history(run, 'chatgpt', [{...valid, timestamp: new Date(999).toISOString()},
    {...valid, toolName: 'start_process'}, {...valid, arguments: {path: file, isUrl: true}}],
  {exactCalls: 0, matchingCalls: 0, markerMatched: false});
  history(run, 'chatgpt', [{...valid, output: {content: [{type: 'text', text: run.probes.dot.raw}]}}],
    {exactCalls: 1, matchingCalls: 0, markerMatched: false});
});

test('comparison separates preview attribution and catches alternate-tool reads of its probe', t => {
  const {prepare, history} = fixture(t);
  const run = prepare(true), surface = 'chatgpt-control';
  const {file, raw} = run.probes[surface];
  const valid = { timestamp: new Date(1500).toISOString(), toolName: 'read_multiple_files',
    arguments: { paths: [file], origin: 'llm' }, output: {content: [{type: 'text', text: raw}]} };
  const expected = {exactCalls: 1, matchingCalls: 1, markerMatched: true,
    origins: {ui: 0, llm: 1, unattributed: 0}};
  history(run, surface, [valid], expected);
  history(run, surface, [valid, {...valid, toolName: 'read_file', arguments: {path: file, origin: 'ui'}}],
    {...expected, otherReadCalls: 1, markerMatched: false});
  history(run, surface, [{...valid, arguments: {paths: [file, run.probes.dot.file]}}],
    {exactCalls: 0, otherReadCalls: 1, matchingCalls: 0, markerMatched: false});
});

test('hosted evidence separates working transport from repeated reads and untested surfaces', () => {
  const regular = {surface: 'chatgpt', exactCalls: 3, otherReadCalls: 0, matchingCalls: 3, markerMatched: false};
  const dot = {surface: 'dot', exactCalls: 0, otherReadCalls: 0, matchingCalls: 0, markerMatched: false};
  const actual = summarizeHostedReadEvidence([regular, dot], new Set(['chatgpt']));
  assert.deepEqual(actual.map(({surface, readPath, singleRead}) => ({surface, readPath, singleRead})), [
    {surface: 'chatgpt', readPath: 'verified', singleRead: 'failed'},
    {surface: 'dot', readPath: 'not-tested', singleRead: 'not-tested'},
  ]);
  assert.equal(summarizeHostedReadEvidence([dot], new Set(['dot']))[0].readPath, 'not-observed');
  assert.equal(summarizeHostedReadEvidence([{...dot, otherReadCalls: 1}], new Set())[0].readPath, 'unexpected-traffic');
  assert.equal(summarizeHostedReadEvidence([{...dot, exactCalls: 1}], new Set(['dot']))[0].readPath, 'unverified');
  assert.equal(summarizeHostedReadEvidence([{...regular, exactCalls: 1, matchingCalls: 1, markerMatched: true}],
    new Set(['chatgpt']))[0].singleRead, 'verified');
});

test('hosted release gate cannot pass missing, repeated, or out-of-scope reads', () => {
  const one = surface => ({surface, exactCalls: 1, matchingCalls: 1, otherReadCalls: 0, markerMatched: true});
  const selected = new Set(['chatgpt', 'dot']);
  const summarize = values => summarizeHostedReadEvidence(values, selected);
  assert.equal(hostedReadGate(summarize([one('chatgpt'), one('dot')]), selected), true);
  assert.equal(hostedReadGate(summarize([one('chatgpt')]), selected), false);
  assert.equal(hostedReadGate(summarize([one('chatgpt'), one('dot'), one('dot')]), selected), false);
  const repeated = {...one('chatgpt'), exactCalls: 3, matchingCalls: 3, markerMatched: false};
  const receipts = summarize([repeated, one('dot')]);
  assert.equal(hostedReadGate(receipts, selected), false);
  assert.equal(hostedReadGate(receipts, selected, {requireSingle: false}), true);
  assert.equal(hostedReadGate(summarize([one('chatgpt'), one('dot'), one('chatgpt-control')]), selected), false);
});

test('hosted append requires exact bytes, one timed write, and an independently created receipt', t => {
  const scratch = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'ac-browser-native-start-'));
  t.after(() => {
    assertInside(realpathSync.native(tmpdir()), scratch);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, {recursive: true});
  });
  const state = path.join(scratch, 'device', 'state');
  mkdirSync(path.join(state, 'work'), {recursive: true});
  const {request, verify} = prepareHostedAppendProbe(state);
  const time = {openedAt: 1000, closedAt: 2000};
  const initial = readFileSync(request.path, 'utf8');
  assert.equal(verify(time).fileState, 'unchanged');
  assert.equal(verify(time).verified, false);
  const receipts = path.join(state, 'mcp-operation-receipts');
  mkdirSync(receipts);
  const key = createHash('sha256').update(request.agent_continue_operation_id).digest('hex');
  writeFileSync(path.join(receipts, key + '.admitted'), 'admitted\nblocked-by-local-control\n');
  const blocked = verify(time);
  assert.equal(blocked.receiptState, 'blocked-by-local-control');
  assert.equal(blocked.fileState, 'unchanged');
  assert.equal(blocked.verified, false);
  writeFileSync(path.join(receipts, key + '.admitted'), 'admitted\nprovider-reported-result\n');
  writeFileSync(request.path, initial + request.content);
  assert.equal(verify(time).verified, false, 'matching receipt and bytes without a correlated write are insufficient');
  const logs = path.join(state, 'home', '.claude-server-commander');
  mkdirSync(logs, {recursive: true});
  const history = path.join(logs, 'tool-history.jsonl');
  const {agent_continue_operation_id, ...providerArgs} = request;
  const entry = {timestamp: new Date(1500).toISOString(), toolName: 'write_file', arguments: providerArgs,
    output: {content: [{type: 'text', text: 'ok'}]}};
  writeFileSync(history, JSON.stringify({...entry, timestamp: new Date(999).toISOString()}) + '\n');
  assert.equal(verify(time).verified, false);
  writeFileSync(history, JSON.stringify(entry) + '\n');
  const observed = verify(time);
  assert.deepEqual(observed, {fileState: 'appended-once', receiptState: 'provider-reported-result',
    targetWriteCalls: 1, matchingWriteCalls: 1, verified: true});
  assert.equal(JSON.stringify(observed).includes(agent_continue_operation_id), false);
  writeFileSync(request.path, initial + request.content.repeat(2));
  assert.equal(verify(time).fileState, 'appended-more-than-once');
  assert.equal(verify(time).verified, false);
  assert.throws(() => prepareHostedAppendProbe(path.join(scratch, 'device')));
});

test('guarded append also requires an ordered provider read and independently observed browser bytes', t => {
  const temp = realpathSync.native(tmpdir()), scratch = mkdtempSync(path.join(temp, 'ac-browser-native-start-'));
  t.after(() => {
    assertInside(temp, scratch);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, {recursive: true});
  });
  const state = path.join(scratch, 'device', 'state');
  mkdirSync(path.join(state, 'work'), {recursive: true});
  const {request, readRequest, verify} = prepareHostedAppendProbe(state, {requireReadback: true});
  assert.deepEqual(readRequest, {path: request.path, length: 10});
  const initial = readFileSync(request.path, 'utf8'), expected = initial + request.content;
  const window = {openedAt: 1000, closedAt: 2000};
  const browserDigest = createHash('sha256').update(expected).digest('hex');
  const receipts = path.join(state, 'mcp-operation-receipts');
  mkdirSync(receipts);
  const {agent_continue_operation_id: id, ...args} = request;
  writeFileSync(path.join(receipts, createHash('sha256').update(id).digest('hex') + '.admitted'),
    'admitted\nprovider-reported-result\n');
  writeFileSync(request.path, expected);
  const logs = path.join(state, 'home', '.claude-server-commander');
  mkdirSync(logs, {recursive: true});
  const record = (...entries) => writeFileSync(path.join(logs, 'tool-history.jsonl'), entries.map(row => JSON.stringify(row)).join('\n'));
  const write = {timestamp: new Date(1500).toISOString(), toolName: 'write_file', arguments: args,
    output: {content: [{type: 'text', text: 'ok'}]}};
  const read = {timestamp: new Date(1600).toISOString(), toolName: 'read_file', arguments: readRequest,
    output: {content: [{type: 'text', text: 'header\n' + expected}]}};
  for (const events of [[write], [read, write], [write, read, read], [write, {...read, output: write.output}]]) {
    record(...events);
    assert.equal(verify(window, {browserDigest}).verified, false);
  }
  record(write, read);
  assert.equal(verify(window).verified, false);
  assert.equal(verify(window, {browserDigest: '0'.repeat(64)}).verified, false);
  assert.deepEqual(verify(window, {browserDigest}), {fileState: 'appended-once', receiptState: 'provider-reported-result',
    targetWriteCalls: 1, matchingWriteCalls: 1, readCalls: 1, matchingReadCalls: 1, browserProof: true, verified: true});
});

test('hosted shell requires an exact command, finished output and a unique receipt', {skip: process.platform !== 'win32'}, t => {
  const scratch = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'ac-browser-native-start-'));
  t.after(() => {
    assertInside(realpathSync.native(tmpdir()), scratch);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, {recursive: true});
  });
  const state = path.join(scratch, 'device', 'state');
  mkdirSync(path.join(state, 'work'), {recursive: true});
  const {request, verify} = prepareHostedShellProbe(state);
  assert.match(request.shell, /^[A-Za-z]:\/[^\\]+\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe$/i);
  assert.equal(path.normalize(request.shell).toLowerCase(),
    path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').toLowerCase());
  const time = {openedAt: 1000, closedAt: 2000};
  const token = /'([a-f0-9]{32})'/.exec(request.command)?.[1];
  assert.ok(token);
  const marker = 'AC_WEB_SHELL_' + token;
  assert.equal(JSON.stringify(request).includes(marker), false);
  assert.equal(verify(time).verified, false);
  const receipts = path.join(state, 'mcp-operation-receipts');
  const logs = path.join(state, 'home', '.claude-server-commander');
  mkdirSync(receipts);
  mkdirSync(logs, {recursive: true});
  const {agent_continue_operation_id, ...providerArgs} = request;
  const key = createHash('sha256').update(agent_continue_operation_id).digest('hex');
  const history = path.join(logs, 'tool-history.jsonl');
  const row = {timestamp: new Date(1500).toISOString(), toolName: 'start_process', arguments: providerArgs,
    output: {content: [{type: 'text', text: `Process started with PID 55\nInitial output:\n${marker}\r\nProcess 55 has finished execution`}]}};
  const records = (...rows) => writeFileSync(history, rows.map(item => JSON.stringify(item)).join('\n') + '\n');
  records(row);
  assert.equal(verify(time).verified, false, 'output without the operation receipt is insufficient');
  writeFileSync(path.join(receipts, key + '.admitted'), 'admitted\nprovider-reported-result\n');
  const observed = verify(time);
  assert.deepEqual(observed, {receiptState: 'provider-reported-result', shellCalls: 1, exactCommandCalls: 1,
    exactShellCalls: 1, exactTimeoutCalls: 1, markerOutputCalls: 1, finishedProcessCalls: 1,
    finishedMarkerCalls: 1, matchingFinishedCalls: 1, verified: true});
  assert.equal(JSON.stringify(observed).includes(marker), false);
  records({...row, arguments: {...row.arguments, shell: 'cmd.exe'}});
  assert.equal(verify(time).verified, false);
  assert.equal(verify(time).exactShellCalls, 0);
  records({...row, arguments: {...row.arguments, command: "Write-Output '" + marker + "'"}});
  const normalized = verify(time);
  assert.equal(normalized.exactCommandCalls, 0, 'equivalent output does not prove exact command forwarding');
  assert.equal(normalized.finishedMarkerCalls, 1);
  assert.equal(normalized.matchingFinishedCalls, 0);
  assert.equal(normalized.verified, false);
  assert.equal(JSON.stringify(normalized).includes(marker), false);
  records({...row, arguments: {...row.arguments, timeout_ms: 9999}});
  assert.equal(verify(time).exactTimeoutCalls, 0);
  assert.equal(verify(time).verified, false);
  records({...row, output: {content: [{type: 'text', text: `Process started with PID 55\n${marker}\nProcess 56 has finished execution`}]}});
  assert.equal(verify(time).markerOutputCalls, 1);
  assert.equal(verify(time).finishedProcessCalls, 0);
  assert.equal(verify(time).finishedMarkerCalls, 0, 'start and finish must refer to the same process');
  assert.equal(verify(time).verified, false);
  records({...row, output: {content: [{type: 'text', text: 'Process started with PID 55\nProcess 55 has finished execution'}]}});
  assert.equal(verify(time).markerOutputCalls, 0);
  assert.equal(verify(time).finishedProcessCalls, 1);
  assert.equal(verify(time).verified, false, 'finished state alone does not prove the expected output');
  records({...row, output: {content: [{type: 'text', text: marker}]}});
  assert.equal(verify(time).verified, false, 'initial output alone is not completion');
  records(row, row);
  assert.equal(verify(time).verified, false, 'two process starts cannot pass');
});

test('the hosted shell scenario fails on a negative receipt after rechecking persistent pause', () => {
  const source = readFileSync(new URL('./windows-browser-native-startup-tests.mjs', import.meta.url), 'utf8');
  assert.match(source, /browser did not preserve explicit pause[^\n]*\n\s*if \(shellEvidence\) assert\.equal\(shellEvidence\.verified, true,/);
});

test('the guarded hosted shell probe supplies its exact tool name and independently computed digest',
  {skip: process.platform !== 'win32'}, t => {
    const scratch = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'ac-browser-native-start-'));
    t.after(() => {
      assertInside(realpathSync.native(tmpdir()), scratch);
      assert.equal(realpathSync.native(scratch), scratch);
      rmSync(scratch, {recursive: true});
    });
    const state = path.join(scratch, 'device', 'state');
    mkdirSync(path.join(state, 'work'), {recursive: true});
    const {tool, request, verify} = prepareHostedShellProbe(state, {exact: true});
    const expected = createHash('sha256').update(JSON.stringify([request.command, request.shell, request.timeout_ms]), 'utf8').digest('hex');
    assert.equal(tool, 'agent_continue_start_process_exact');
    assert.equal(request.agent_continue_process_sha256, expected);
    const plain = prepareHostedShellProbe(state);
    assert.equal(plain.tool, 'start_process');
    assert.equal(Object.hasOwn(plain.request, 'agent_continue_process_sha256'), false);
    const marker = 'AC_WEB_SHELL_' + /'([a-f0-9]{32})'/.exec(request.command)[1];
    const window = {openedAt: 1000, closedAt: 2000};
    const receipts = path.join(state, 'mcp-operation-receipts');
    const logs = path.join(state, 'home', '.claude-server-commander');
    mkdirSync(receipts);
    mkdirSync(logs, {recursive: true});
    const id = createHash('sha256').update(request.agent_continue_operation_id).digest('hex');
    const receipt = path.join(receipts, id + '.admitted');
    writeFileSync(path.join(logs, 'tool-history.jsonl'), JSON.stringify({
      timestamp: new Date(1500).toISOString(), toolName: 'start_process',
      arguments: {command: request.command, shell: request.shell, timeout_ms: request.timeout_ms},
      output: {content: [{type: 'text', text: `Process started with PID 55\n${marker}\nProcess 55 has finished execution`}]},
    }) + '\n');
    writeFileSync(receipt, 'admitted\nprovider-reported-result\n');
    assert.equal(verify(window).matchingFinishedCalls, 1);
    assert.equal(verify(window).exactReceipt, false);
    assert.equal(verify(window).verified, false, 'a perfect result from the legacy tool cannot pass');
    writeFileSync(receipt, 'admitted-exact\nprovider-reported-result\n');
    assert.equal(verify(window).exactReceipt, true);
    assert.equal(verify(window).verified, true);
    writeFileSync(receipt, 'admitted-exact\nprovider-reported-result\ncorrupt');
    assert.equal(verify(window).exactReceipt, false);
    assert.equal(verify(window).verified, false);
  });

test('token acceptance requires the selected account, actual elevation, high integrity and matching PID',
  {skip: process.platform !== 'win32'}, t => {
    const scratch = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'ac-browser-native-start-'));
    t.after(() => {
      assertInside(realpathSync.native(tmpdir()), scratch);
      assert.equal(realpathSync.native(scratch), scratch);
      rmSync(scratch, {recursive: true});
    });
    const state = path.join(scratch, 'device', 'state'), work = path.join(state, 'work');
    mkdirSync(work, {recursive: true});
    assert.throws(() => prepareHostedShellProbe(state, {expectedWindowsToken: 'administrator'}));
    assert.throws(() => prepareHostedShellProbe(state, {exact: true, expectedWindowsToken: 'unknown'}));
    const sid = 'S-1-5-21-100-200-300-1001';
    const {request, verify} = prepareHostedShellProbe(state, {
      exact: true, expectedWindowsToken: 'administrator', expectedWindowsSid: sid,
    });
    const nonce = /:([a-f0-9]{32}):'\+\$challenge/.exec(request.command)[1];
    assert.match(request.command, /\[IO\.Path\]::Combine\(\[Environment\]::CurrentDirectory,'ac-web-token-[a-f0-9]{32}\.proof'\)/);
    assert.doesNotMatch(request.command, /Base64/);
    assert.equal(request.command.includes(work), false);
    assert.equal(request.command.includes(sid), false);
    const challenge = '9'.repeat(32), marker = 'AC_WEB_SHELL_' + challenge;
    const browserDigest = createHash('sha256').update(marker).digest('hex');
    assert.equal(request.command.includes(challenge), false);
    const receipts = path.join(state, 'mcp-operation-receipts');
    const logs = path.join(state, 'home', '.claude-server-commander');
    mkdirSync(receipts);
    mkdirSync(logs, {recursive: true});
    const {agent_continue_operation_id: id, agent_continue_process_sha256: _, ...args} = request;
    const at = Date.now(), window = {openedAt: at - 1000, closedAt: at + 1000};
    writeFileSync(path.join(logs, 'tool-history.jsonl'), JSON.stringify({
      timestamp: new Date(at).toISOString(), toolName: 'start_process', arguments: args,
      output: {content: [{type: 'text', text: `Process started with PID 55\n${marker}\nProcess 55 has finished execution`}]},
    }) + '\n');
    writeFileSync(path.join(receipts, createHash('sha256').update(id).digest('hex') + '.admitted'),
      'admitted-exact\nprovider-reported-result\n');
    const proof = path.join(work, 'ac-web-token-' + nonce + '.proof');
    assert.equal(verify(window).childProof, 'missing');
    const claim = ({pid = 55, user = sid, elevated = 1, integrity = 12288, admin = 1, n = nonce, c = challenge} = {}) =>
      `v2:${pid}:${user}:${elevated}:${integrity}:${admin}:${n}:${c}`;
    for (const [bytes, status] of [
      ['55:administrator:' + nonce + ':' + challenge, 'invalid'],
      [claim({n: 'a'.repeat(32)}), 'invalid'],
      [claim({pid: 56}), 'pid-or-output-unconfirmed'],
      [claim({c: '8'.repeat(32)}), 'pid-or-output-unconfirmed'],
      [claim({user: sid.replace('1001', '1002')}), 'account-mismatch'],
      [claim({user: 'S-1-5-18'}), 'invalid'],
      [claim({elevated: 0}), 'token-mismatch'],
      [claim({integrity: 8192}), 'token-mismatch'],
      [claim({integrity: 16384}), 'token-mismatch'],
      [claim({admin: 0}), 'token-mismatch'],
    ]) {
      writeFileSync(proof, bytes);
      const result = verify(window);
      assert.equal(result.exactCommandCalls, 1);
      assert.equal(result.childProof, status);
      assert.equal(result.verified, false);
      assert.equal(JSON.stringify(result).includes(nonce), false);
      assert.equal(JSON.stringify(result).includes(sid), false);
    }
    writeFileSync(proof, claim());
    assert.equal(verify(window, {browserDigest: null}).verified, false);
    assert.equal(verify(window, {browserDigest: '0'.repeat(64)}).verified, false);
    assert.equal(verify(window, {browserDigest}).verified, true);
    assert.equal(verify(window, {browserDigest}).childAccountMatches, true);
    assert.equal(verify({openedAt: at - 5000, closedAt: at - 2500}).childProof, 'invalid');
  });
