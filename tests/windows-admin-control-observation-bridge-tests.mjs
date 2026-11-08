import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs, { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAdministratorBrowserActions, isAdministratorControlStatus, serveAdministratorBrowser } from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

const fixture = fileURLToPath(new URL('./windows-admin-control-observation-bridge.ps1', import.meta.url));
const stager = fileURLToPath(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url));
const runFile = promisify(execFile);
const digest = 'a'.repeat(64), operationId = 'b'.repeat(32), origin = `chrome-extension://${'c'.repeat(32)}/`;
const system = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const bundle = `C:\\Program Files\\AgentContinueAdmin\\${digest.slice(0, 24)}`;
const binding = { version: 1, origin, bundleSha256: digest, systemDirectory: system };
const windows = { skip: process.platform !== 'win32', timeout: 30_000 };
const observationNames = ['Test-AdministratorControlFields', 'Assert-AdministratorControlIdentity', 'Get-AdministratorControlStates',
  'Get-AdministratorControlReceiptBytes', 'Get-AdministratorControlProgressBytes',
  'Assert-AdministratorControlObservationParameters', 'Read-AdministratorBrowserControlStatus'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validatePreparedManifest(manifest, source, payload) {
  assert.ok(exact(manifest, ['version', 'sourceSha256', 'payloadSha256', 'functions']) && manifest.version === 1 &&
    manifest.sourceSha256 === hash(source) && manifest.payloadSha256 === hash(payload) &&
    Array.isArray(manifest.functions) && manifest.functions.length === observationNames.length, 'fixture_manifest');
  const text = source.toString('utf8').replace(/^\uFEFF+/, '');
  const bodies = manifest.functions.map((fn, i) => {
    assert.ok(exact(fn, ['name', 'start', 'end', 'sha256']) && fn.name === observationNames[i] &&
      Number.isSafeInteger(fn.start) && Number.isSafeInteger(fn.end) && fn.start >= 0 && fn.end > fn.start && fn.end <= text.length,
    'fixture_manifest_function');
    const body = text.slice(fn.start, fn.end);
    assert.ok(new RegExp(`^function ${fn.name}(?:\\s*\\(|\\s*\\{)`).test(body) && body.endsWith('}') &&
      hash(Buffer.from(body)) === fn.sha256, 'fixture_manifest_source');
    return body;
  });
  // The preparation subprocess supplies actual AST extents. Independently
  // reject overlaps here; matching recomputed hashes alone cannot prove that.
  const spans = [...manifest.functions].sort((a, b) => a.start - b.start);
  assert.ok(spans.every((fn, index) => index === 0 || spans[index - 1].end <= fn.start), 'fixture_manifest_overlap');
  assert.ok(Buffer.from(bodies.join('\n')).equals(payload), 'fixture_manifest_payload');
  return manifest;
}

function assertPreparedSemanticSource(source) {
  assert.doesNotMatch(source, /Parser\s*\]\s*::\s*Parse(?:File|Input)|\.FindAll\s*\(|Join-Path/i);
}

function checkPreparedRoot(prepared) {
  assert.ok(path.isAbsolute(prepared.root) && path.isAbsolute(prepared.parent) &&
    path.dirname(prepared.root) === prepared.parent && /^ac-observation-fixture-[a-f0-9]{32}$/.test(path.basename(prepared.root)),
  'fixture_scope');
  for (let cursor = prepared.root; ; cursor = path.dirname(cursor)) {
    const item = fs.lstatSync(cursor);
    assert.ok(item.isDirectory() && !item.isSymbolicLink(), 'fixture_scope');
    if (path.dirname(cursor) === cursor) break;
  }
  assert.ok(fs.realpathSync.native(prepared.root) === prepared.root, 'fixture_scope');
}

function loadPrepared(prepared) {
  checkPreparedRoot(prepared);
  const file = path.join(prepared.root, 'helpers.ps1');
  const item = fs.lstatSync(file);
  assert.ok(item.isFile() && !item.isSymbolicLink(), 'fixture_scope');
  return validatePreparedManifest(prepared.manifest, readFileSync(stager), readFileSync(file));
}

function createPreparedRoot(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = path.join(parent, 'ac-observation-fixture-' + randomUUID().replaceAll('-', ''));
  fs.mkdirSync(root);
  const prepared = { parent, root, signal: t.signal, active: new Set() };
  t.after(async () => {
    await Promise.allSettled([...prepared.active]);
    checkPreparedRoot(prepared);
    for (const name of fs.readdirSync(root)) {
      const item = fs.lstatSync(path.join(root, name));
      assert.ok(name === 'helpers.ps1' && item.isFile() && !item.isSymbolicLink(), 'fixture_cleanup_scope');
    }
    fs.rmSync(root, { recursive: true, force: false });
  });
  return prepared;
}

async function runPreparedChild(prepared, exe, args, options, execute) {
  const work = execute(exe, args, { ...options, signal: prepared.signal });
  prepared.active.add(work);
  try { return await work; } finally { prepared.active.delete(work); }
}

function assertObservationCompletion(execution, phases) {
  assert.equal(execution?.state, 'completed', 'PS5.1 fixture must finish before semantic assertions: ' + JSON.stringify(execution));
  assert.deepEqual(execution.phases, phases);
}

async function prepareObservation(t, execute = runFile) {
  const prepared = createPreparedRoot(t);
  const started = performance.now();
  let result, execution;
  try {
    result = await runPreparedChild(prepared, path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture, '-Prepare',
        '-PreparedRoot', prepared.root, '-FixtureTempRoot', prepared.parent],
      { cwd: system, windowsHide: true, timeout: 10_000, maxBuffer: 16384,
        env: { SystemRoot: path.win32.dirname(system), WINDIR: path.win32.dirname(system), PATH: system } }, execute);
    execution = fixtureEvidence({ state: 'completed', started, stderr: result.stderr });
  } catch (error) { execution = fixtureEvidence({ state: 'failed', started, error, stderr: error.stderr }); }
  assertObservationCompletion(execution, ['prepare-entry', 'source-parsed', 'source-indexed', 'payload-written', 'prepare-complete']);
  try { prepared.manifest = JSON.parse(result.stdout); } catch { assert.fail('fixture_manifest_json'); }
  loadPrepared(prepared);
  return prepared;
}

function fixtureEvidence({ state, started, error, stderr = '' }) {
  return { state, durationMs: Math.floor(performance.now() - started),
    code: Number.isInteger(error?.code) ? error.code :
      ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM'].includes(error?.code) ? error.code : null,
    killed: error?.killed === true,
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(error?.signal) ? error.signal : null,
    phases: [...stderr.matchAll(/^OBSERVATION_FIXTURE (entry|prepare-entry|source-parsed|source-indexed|payload-written|prepare-complete|source-verified|prepared-source-loaded|receipt-read|complete)\r?$/gm)]
      .map(match => match[1]).slice(-8) };
}

test('fixture diagnostics keep fixed completion evidence without raw errors or private paths', () => {
  const evidence = fixtureEvidence({ state: 'failed', started: performance.now(),
    error: { code: 'private-code', killed: true, signal: 'private-signal', message: 'private-path' },
    stderr: 'OBSERVATION_FIXTURE entry\nprivate-path\nOBSERVATION_FIXTURE private-secret\nOBSERVATION_FIXTURE source-parsed\nOBSERVATION_FIXTURE source-indexed\nOBSERVATION_FIXTURE payload-written\n' });
  assert.deepEqual({ ...evidence, durationMs: 0 }, { state: 'failed', durationMs: 0, code: null,
    killed: true, signal: null, phases: ['entry', 'source-parsed', 'source-indexed', 'payload-written'] });
  assert.equal(Number.isInteger(evidence.durationMs) && evidence.durationMs >= 0, true);
  assert.doesNotMatch(JSON.stringify(evidence), /private-/);
});

function manifestExample() {
  const names = ['Test-AdministratorControlFields', 'Assert-AdministratorControlIdentity', 'Get-AdministratorControlStates',
    'Get-AdministratorControlReceiptBytes', 'Get-AdministratorControlProgressBytes',
    'Assert-AdministratorControlObservationParameters', 'Read-AdministratorBrowserControlStatus'];
  const bodies = names.map((name, i) => `function ${name}${name === 'Get-AdministratorControlStates' ? '' : '()'} { '${i}' }`);
  const source = Buffer.from('# current source\n' + bodies.join('\n'));
  const payload = Buffer.from(bodies.join('\n'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = { version: 1, sourceSha256: hash(source), payloadSha256: hash(payload), functions: names.map((name, i) => {
    const start = source.toString('utf8').indexOf(bodies[i]);
    return { name, start, end: start + bodies[i].length, sha256: hash(Buffer.from(bodies[i])) };
  }) };
  return { source, payload, manifest };
}

test('source-only observation preparation rejects stale source and incomplete or tampered extraction manifests', () => {
  assert.equal(typeof validatePreparedManifest, 'function');
  const { source, payload, manifest } = manifestExample();
  assert.doesNotThrow(() => validatePreparedManifest(manifest, source, payload));
  for (const prefix of ['\uFEFF', '\uFEFF\uFEFF']) {
    const encoded = Buffer.concat([Buffer.from(prefix), source]);
    assert.doesNotThrow(() => validatePreparedManifest({ ...manifest, sourceSha256: hash(encoded) }, encoded, payload));
  }
  assert.throws(() => validatePreparedManifest(null, source, payload));
  assert.throws(() => validatePreparedManifest(manifest, Buffer.concat([source, Buffer.from('changed')]), payload));
  assert.throws(() => validatePreparedManifest(manifest, source, Buffer.concat([payload, Buffer.from('changed')])));
  for (const changed of [{ ...manifest, version: 2 }, { ...manifest, functions: manifest.functions.slice(1) },
    { ...manifest, functions: [...manifest.functions.slice(0, 6), manifest.functions[0]] }, { ...manifest, extra: true },
    { ...manifest, functions: manifest.functions.map((fn, i) => i === 0 ? { ...fn, start: fn.start + 1 } : fn) },
    { ...manifest, functions: manifest.functions.map((fn, i) => i === 0 ? { ...fn, sha256: '0'.repeat(64) } : fn) }]) {
    assert.throws(() => validatePreparedManifest(changed, source, payload));
  }
});

test('source-only observation rejects enlarged overlapping definitions even with recomputed hashes', () => {
  const { source, manifest } = manifestExample();
  const text = source.toString('utf8');
  const functions = manifest.functions.map(fn => ({ ...fn }));
  functions[0].end = functions[1].end;
  functions[0].sha256 = hash(Buffer.from(text.slice(functions[0].start, functions[0].end)));
  const payload = Buffer.from(functions.map(fn => text.slice(fn.start, fn.end)).join('\n'));
  const enlarged = { ...manifest, functions, payloadSha256: hash(payload) };
  assert.throws(() => validatePreparedManifest(enlarged, source, payload), /fixture_manifest/);
});

test('source-only observation preparation requires bounded child success and a verified manifest before semantic calls', async () => {
  const { manifest, source, payload } = manifestExample();
  const phases = ['prepare-entry', 'source-parsed', 'source-indexed', 'payload-written', 'prepare-complete']
    .map(phase => 'OBSERVATION_FIXTURE ' + phase).join('\n');
  const make = () => {
    const prepared = { root: 'C:\\fixture', parent: 'C:\\temp', active: new Set() };
    let verified = 0;
    const prepare = new Function('dependencies', `const {createPreparedRoot,runPreparedChild,path,system,fixture,performance,fixtureEvidence,assertObservationCompletion,loadPrepared,runFile}=dependencies; return (${prepareObservation.toString()});`)({
      createPreparedRoot: () => prepared, runPreparedChild, path, system, fixture, performance, fixtureEvidence, assertObservationCompletion,
      loadPrepared: item => { verified++; return validatePreparedManifest(item.manifest, source, payload); },
      runFile: () => assert.fail('pure test must never execute a native child'),
    });
    return { prepared, prepare, verified: () => verified };
  };
  const good = make();
  assert.equal(await good.prepare({}, async (_exe, args, options) => {
    assert.equal(options.timeout, 10_000);
    assert.equal(options.windowsHide, true);
    assert.ok(args.includes('-Prepare'));
    return { stdout: JSON.stringify(manifest), stderr: phases };
  }), good.prepared);
  assert.equal(good.verified(), 1);
  for (const execute of [
    async () => { throw Object.assign(Error('private-path'), { code: 'ETIMEDOUT', killed: true, stderr: 'OBSERVATION_FIXTURE prepare-entry' }); },
    async () => { throw Object.assign(Error('private-path'), { code: 'ETIMEDOUT', killed: true,
      stdout: JSON.stringify(manifest), stderr: phases }); },
    async () => ({ stdout: JSON.stringify(manifest), stderr: 'OBSERVATION_FIXTURE prepare-entry' }),
    ...['source-indexed', 'payload-written'].map(phase => async () => ({ stdout: JSON.stringify(manifest),
      stderr: phases.replace('OBSERVATION_FIXTURE ' + phase, '') })),
    async () => ({ stdout: 'not-json', stderr: phases }),
    async () => ({ stdout: JSON.stringify({ ...manifest, sourceSha256: '0'.repeat(64) }), stderr: phases }),
  ]) {
    const bad = make();
    await assert.rejects(() => bad.prepare({}, execute), error => {
      assert.doesNotMatch(error.message, /private-path/);
      return true;
    });
    assert.equal(bad.prepared.active.size, 0);
  }
});

test('source-only observation completion rejects failed and truncated children outside native fallback', async () => {
  assert.equal(typeof loadPrepared, 'function');
  const { manifest } = manifestExample();
  const prepared = { root: 'C:\\fixture', parent: 'C:\\temp', manifest, active: new Set() };
  const phases = ['entry', 'source-verified', 'prepared-source-loaded', 'receipt-read', 'complete']
    .map(phase => 'OBSERVATION_FIXTURE ' + phase).join('\n');
  const unknown = { bundleSha256: digest, operationId, control: 'connect', state: 'unconfirmed', progress: null };
  const success = async (_exe, args, options) => {
    assert.equal(options.timeout, 3200);
    assert.ok(args.includes('-PreparedRoot'));
    return { stdout: JSON.stringify(unknown), stderr: phases };
  };
  assert.equal((await request('connect', 'corrupt', prepared, success, () => manifest)).result.state, 'unconfirmed');
  for (const code of ['ETIMEDOUT', 'ENOENT', 1]) {
    const failure = async () => { throw Object.assign(new Error('private-path'), { code, killed: true, signal: 'SIGTERM', stderr: 'OBSERVATION_FIXTURE entry' }); };
    await assert.rejects(() => request('connect', 'corrupt', prepared, failure, () => manifest), error => {
      assert.match(error.message, /fixture must finish/);
      assert.doesNotMatch(error.message, /private-path/);
      return true;
    });
  }
  await assert.rejects(() => request('connect', 'corrupt', prepared, async () => {
    throw Object.assign(Error('private-path'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM',
      stdout: JSON.stringify(unknown), stderr: phases });
  }, () => manifest), /fixture must finish/);
  await assert.rejects(() => request('connect', 'absent', prepared,
    async () => ({ stdout: JSON.stringify(unknown), stderr: phases.replace('OBSERVATION_FIXTURE complete', '') }), () => manifest));
  await assert.rejects(() => request('connect', 'corrupt', prepared,
    async () => ({ stdout: 'not-json', stderr: phases }), () => manifest));
  await assert.rejects(() => request('connect', 'absent', prepared,
    () => assert.fail('stale preparation must fail before executor entry'), () => { throw Error('fixture_manifest'); }));
});

test('source-only observation separates bounded preparation from unchanged semantic and outer budgets', () => {
  assert.equal(typeof prepareObservation, 'function');
  assert.match(prepareObservation.toString(), /timeout: 10_000/);
  assert.equal(windows.timeout, 30_000);
  assert.ok(10_000 + 5 * 3200 < windows.timeout);
  const source = readFileSync(fixture, 'utf8');
  assert.match(source, /ParameterSetName='Prepare'/);
  assert.match(source, /ParameterSetName='Semantic'/);
  const prepareEnd = source.indexOf("'OBSERVATION_FIXTURE prepare-complete'");
  const semantic = source.slice(prepareEnd);
  assert.ok(prepareEnd > 0);
  assertPreparedSemanticSource(semantic);
  assert.match(semantic, /OBSERVATION_FIXTURE prepared-source-loaded/);
});

test('source-only observation preparation indexes the exact recursive AST closure without per-node PowerShell callbacks', () => {
  const source = readFileSync(fixture, 'utf8');
  const names = source.match(/\$names=@\(([\s\S]*?)\)\r?\nif \(\$Prepare\)/);
  assert.ok(names, 'fixture must retain the explicit function closure');
  assert.deepEqual([...names[1].matchAll(/'([^']+)'/g)].map(match => match[1]), observationNames);
  const prepare = source.slice(source.indexOf('if ($Prepare)'), source.indexOf("'OBSERVATION_FIXTURE prepare-complete'"));
  assert.doesNotMatch(prepare, /\.FindAll\s*\(\s*\{|\bWhere-Object\b/,
    'preparation must not enter PowerShell once per AST node or rescan definitions through a pipeline');
  assert.match(prepare, /\[Linq\.Expressions\.Expression\]::TypeIs\(\$node,\[Management\.Automation\.Language\.FunctionDefinitionAst\]\)/);
  assert.match(prepare, /\[Linq\.Expressions\.Expression\]::Lambda\([\s\S]*?\[Func\[Management\.Automation\.Language\.Ast,bool\]\][\s\S]*?\)\.Compile\(\)/);
  assert.match(prepare, /Dictionary\[string,Management\.Automation\.Language\.FunctionDefinitionAst\]\]::new\(\[StringComparer\]::Ordinal\)/);
  assert.match(prepare, /foreach \(\$definition in \$ast\.FindAll\(\$predicate,\$true\)\)/);
  assert.match(prepare, /if \(\$names -ccontains \$definition\.Name\)/);
  assert.match(prepare, /if \(\$definitions\.ContainsKey\(\$definition\.Name\)\) \{ throw 'fixture_function' \}/);
  assert.match(prepare, /if \(-not \$definitions\.ContainsKey\(\$name\)\) \{ throw 'fixture_function' \}/);
  assert.match(prepare, /\$extent=\$definitions\[\$name\]\.Extent/);
  assert.match(prepare, /OBSERVATION_FIXTURE source-indexed/);
  assert.match(prepare, /OBSERVATION_FIXTURE payload-written/);
});

test('source-only semantic source guard rejects both parser APIs and source discovery mutations', () => {
  const clean = "[Console]::Error.WriteLine('OBSERVATION_FIXTURE complete')";
  assert.doesNotThrow(() => assertPreparedSemanticSource(clean));
  for (const mutation of ['[Management.Automation.Language.Parser]::ParseFile($source)',
    '[Management.Automation.Language.Parser]::ParseInput($source)',
    '[Management.Automation.Language.Parser] :: parseinput($source)',
    '$ast.FindAll({})', 'Join-Path $root $source']) {
    assert.throws(() => assertPreparedSemanticSource(clean + '\n' + mutation));
  }
});

async function request(control, mode, prepared, execute = runFile, load = loadPrepared) {
  // Reject stale source/extraction before entering the native transport's fallback catch.
  const manifest = load(prepared);
  const calls = [];
  let execution, helperStdout;
  const actions = createAdministratorBrowserActions(bundle, binding, async (exe, args, options) => {
    calls.push({ exe, args, options });
    // Execute only an AST-extracted helper fixture; not the requested stager or installed path.
    const started = performance.now();
    try {
      const result = await runPreparedChild(prepared, exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture,
        '-Digest', digest, '-Operation', operationId, '-Control', control, '-Fixture', mode,
        '-PreparedRoot', prepared.root, '-FixtureTempRoot', prepared.parent,
        '-SourceSha256', manifest.sourceSha256, '-PayloadSha256', manifest.payloadSha256], options, execute);
      execution = fixtureEvidence({ state: 'completed', started, stderr: result.stderr });
      helperStdout = result.stdout;
      return result;
    } catch (error) {
      execution = fixtureEvidence({ state: 'failed', started, error, stderr: error.stderr });
      throw error;
    }
  });
  const input = new PassThrough(), output = new PassThrough();
  const wire = { version: 1, action: 'control-status', id: '11111111-2222-3333-4444-555555555555',
    bundleSha256: digest, operationId, control };
  try {
    await writeFrame(input, wire);
    await serveAdministratorBrowser({ input, output, args: [origin], origin, ...actions });
    const result = await readFrame(output, 4000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].exe, path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    assert.deepEqual(calls[0].args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', `${bundle}.browser\\stager.ps1`,
      '-Action', 'ObserveHostedOwnerControl', '-Archive', `${bundle}.browser\\bundle.zip`,
      '-ExpectedSha256', digest, '-ControlKind', control, '-ControlOperationId', operationId]);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].options.timeout, 3200);
    assertObservationCompletion(execution, ['entry', 'source-verified', 'prepared-source-loaded', 'receipt-read', 'complete']);
    let helper;
    try { helper = JSON.parse(helperStdout); } catch { assert.fail('fixture_response_json'); }
    assert.ok(isAdministratorControlStatus(helper, wire), 'fixture_response');
    const { version, action, id, ...body } = result;
    assert.deepEqual(body, helper, 'fixture_response_must_reach_wire');
    return { wire, result };
  } finally { input.destroy(); output.destroy(); }
}

test('native framing to prepared PS5.1 source helper preserves receipts, not cold installed latency', windows, async t => {
  const prepared = await prepareObservation(t);
  for (const control of ['connect', 'resume-saved', 'revoke']) {
    const { wire, result } = await request(control, 'receipt', prepared);
    assert.deepEqual(result, { ...wire, state: control === 'revoke' ? 'stopped' : 'launch-unconfirmed',
      progress: { phase: 'settled', verifiedFiles: null, totalFiles: null } });
  }
});

test('prepared PS5.1 helper absence/corruption/identity/extra-field/progress failures stay original-ID unknown', windows, async t => {
  const prepared = await prepareObservation(t);
  for (const mode of ['absent', 'corrupt', 'mismatch', 'extra', 'bad-progress']) {
    const { wire, result } = await request('connect', mode, prepared);
    assert.deepEqual(result, { ...wire, state: 'unconfirmed', progress: null });
    const text = JSON.stringify(result);
    assert.equal(text.includes('private-fixture'), false);
    assert.equal(text.includes('path'), false);
  }
});
