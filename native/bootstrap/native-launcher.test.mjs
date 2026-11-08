import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUNTIME_FILES, PACKAGE_FILES } from './payload-layout.mjs';
import { HOST } from '../../device-control.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = ['Build-NativeLauncher.ps1', 'NativeLauncher.cs'];
const available = sources.every(name => fs.existsSync(path.join(here, name)));
const extensionId = 'a'.repeat(32), origin = `chrome-extension://${extensionId}/`;
const diagnostic = 'device_bridge_unavailable\n';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const windows = (name, run, timeout = 60000) => test(name, {
  skip: process.platform !== 'win32' ? 'Windows launcher execution requires Windows' :
    !available ? 'launcher source pair not implemented yet' :
      process.env.AGENT_CONTINUE_WINDOWS_LAUNCHER !== '1' ?
        'Generated Windows EXE execution is opt-in; current Defender quarantine is unresolved' : false, timeout,
}, run);

function frame(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes]);
}
function decode(bytes) {
  assert.ok(bytes.length >= 4, 'native response header missing');
  assert.equal(bytes.readUInt32LE() + 4, bytes.length, 'one complete native response required');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4)));
}

test('Windows native launcher compiler and transport sources exist', () => {
  for (const name of sources) assert.ok(fs.existsSync(path.join(here, name)), `missing ${name}`);
});

test('bootstrap package includes launcher sources and test outside the runtime payload', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(here, 'package.json')));
  for (const name of sources) {
    assert.ok(PACKAGE_FILES.includes(name), `builder allowlist missing ${name}`);
    assert.ok(meta.files.includes(name), `npm allowlist missing ${name}`);
  }
  assert.ok(meta.scripts.test.includes('native-launcher.test.mjs'));
  assert.equal(RUNTIME_FILES.length, 17);
  assert.ok(RUNTIME_FILES.includes('device-server.mjs'));
  assert.ok(RUNTIME_FILES.includes('device-ssh.mjs'));
  assert.ok(sources.every(name => !RUNTIME_FILES.includes(name)));
});

test('current builder uses a GUI PE without claiming Chrome requires one or signing clears detection', () => {
  const source = fs.readFileSync(path.join(here, 'Build-NativeLauncher.ps1'), 'utf8');
  assert.match(source, /also supports non-EXE hosts via CMD/);
  assert.doesNotMatch(source, /only accepts a PE|only way to clear/);
  assert.match(source, /if \(\[IO\.Path\]::GetExtension\(\$OutputPath\) -ine '\.exe'/,
    'the current compiler output contract remains executable-specific');
  assert.match(source, /path = \$OutputPath/);
});

test('source gives post-exit drain its own budget without clipping to child lifetime', { skip: !available }, () => {
  const source = fs.readFileSync(path.join(here, 'NativeLauncher.cs'), 'utf8');
  assert.ok(/long deadline = clock\.ElapsedMilliseconds \+ DrainMs;/.test(source),
    'a child exiting near 30 seconds still needs its full independent 2 second drain');
  assert.ok(!/Math\.Min\(LifetimeMs,\s*clock\.ElapsedMilliseconds \+ DrainMs\)/.test(source));
});

function fixture(t, { hostScript } = {}) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'ac-native-launcher-'));
  const identity = fs.lstatSync(root, { bigint: true });
  const app = path.join(root, "app '[quoted] ; \u6d4b\u8bd5");
  fs.mkdirSync(app);
  const marker = path.join(root, 'child-started.txt');
  const script = path.join(app, 'device-native-host.mjs');
  const output = path.join(root, 'native launcher.exe');
  const manifest = path.join(root, 'native-host.json');
  const children = new Set(), closers = [];
  let retain = false;
  fs.writeFileSync(script, hostScript ?? `import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(marker)}, 'started\\n');
const emergency = setTimeout(() => process.exit(0), 35000);
let bytes = Buffer.alloc(0);
const reply = value => {
  const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  header.writeUInt32LE(body.length); process.stdout.write(Buffer.concat([header, body]));
};
process.stdin.on('data', chunk => {
  bytes = Buffer.concat([bytes, chunk]);
  if (bytes.length < 4 || bytes.length !== bytes.readUInt32LE() + 4) return;
  process.stdin.destroy();
  let value; try { value = JSON.parse(bytes.subarray(4)); } catch {}
  if (value?.mode === 'idle') {
    fs.writeFileSync(${JSON.stringify(path.join(root, 'idle-entered.json'))}, JSON.stringify({at:Date.now(),pid:process.pid}));
    process.once('exit', () => fs.writeFileSync(${JSON.stringify(path.join(root, 'idle-exit.txt'))}, 'natural-exit'));
    return;
  }
  clearTimeout(emergency);
  if (value?.mode === 'environment') {
    reply({args: process.argv.slice(2), inherited: Object.keys(process.env).filter(key =>
      /^(NODE_|NPM_|UV_|OPENSSL_)/i.test(key) || /^(ICU_DATA|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|ELECTRON_RUN_AS_NODE|VSCODE_INSPECTOR_OPTIONS)$/i.test(key))});
  } else if (value?.mode === 'fail') {
    process.stderr.write('PRIVATE_CHILD_DETAILS_AND_PATHS'); process.exitCode = 7;
  } else if (value?.mode === 'output-overflow') {
    process.stdout.write(Buffer.alloc(4101, 65));
  } else if (value?.mode === 'stderr-overflow') {
    process.stderr.write(Buffer.alloc(65537, 66));
  } else if (value?.mode === 'stderr-at-limit') {
    process.stderr.write(Buffer.alloc(65536, 67)); process.stdout.write(bytes);
  } else {
    process.stderr.write('PRIVATE_CHILD_DETAILS_AND_PATHS'); process.stdout.write(bytes);
  }
});
`, { flag: 'wx' });

  function start(command, args, options = {}) {
    const child = spawn(command, args, { cwd: root, shell: false, windowsHide: true,
      env: { ...process.env, ...options.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], error = [];
    let outBytes = 0, errorBytes = 0, overflow = false, launchError = false, ended = false;
    child.stdin.on('error', () => {});
    child.stdout.on('data', bytes => {
      outBytes += bytes.length;
      if (outBytes > 1024 * 1024) overflow = true; else out.push(bytes);
    });
    child.stderr.on('data', bytes => {
      errorBytes += bytes.length;
      if (errorBytes > 1024 * 1024) overflow = true; else error.push(bytes);
    });
    child.once('error', () => { launchError = true; });
    const closed = new Promise(resolve => child.once('close', (code, signal) => {
      ended = true; children.delete(handle);
      resolve({ code, signal, launchError, overflow, out: Buffer.concat(out), error: Buffer.concat(error) });
    }));
    const wait = async milliseconds => {
      let timer;
      try { return await Promise.race([closed, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), milliseconds);
      })]); } finally { clearTimeout(timer); }
    };
    const handle = { child, closed, wait, async stop() {
      if (ended) return true;
      child.stdin.destroy();
      try { child.kill(); } catch { /* Retain the exact owned process until closure. */ }
      return Boolean(await wait(5000));
    } };
    children.add(handle);
    return handle;
  }

  const f = { root, app, marker, script, output, manifest, closers,
    async build(overrides = {}, sourceRoot = here) {
      const values = { OutputPath: output, ManifestPath: manifest, NodePath: process.execPath,
        HostScriptPath: script, ExtensionId: extensionId, ...overrides };
      const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = start(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        path.join(sourceRoot, 'Build-NativeLauncher.ps1'),
        ...Object.entries(values).flatMap(([key, value]) => [`-${key}`, value])]);
      child.child.stdin.end();
      const result = await child.wait(40000);
      if (!result) { retain = true; await child.stop(); throw new Error('compiler_fixture_timeout'); }
      assert.equal(result.launchError, false); assert.equal(result.overflow, false);
      return result;
    },
    async run(bytes, args = [origin], options = {}) {
      const started = Date.now(), handle = start(output, args, options);
      if (bytes !== undefined) handle.child.stdin.write(bytes);
      if (options.end) handle.child.stdin.end();
      const result = await handle.wait(options.timeout ?? 10000);
      if (!result) { retain = true; await handle.stop(); throw new Error('launcher_fixture_timeout'); }
      assert.equal(result.launchError, false); assert.equal(result.overflow, false);
      return { ...result, started, elapsed: Date.now() - started };
    },
  };
  t.after(async () => {
    for (const child of children) assert.ok(await child.stop(), 'owned process closure unconfirmed');
    for (const close of closers.reverse()) await close();
    if (retain) { t.diagnostic('Retained temporary fixture: nested child closure unconfirmed'); return; }
    const current = fs.lstatSync(root, { bigint: true });
    assert.equal(path.dirname(root), temporary); assert.match(path.basename(root), /^ac-native-launcher-/);
    assert.equal(fs.realpathSync(root), root); assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 });
  });
  return f;
}

function success(result) {
  assert.equal(result.code, 0, `compiler refused: stderrBytes=${result.error.length}`);
  assert.equal(result.signal, null); assert.equal(result.error.length, 0);
  assert.equal(result.out.toString('utf8').trim().split('\n').length, 1);
  assert.equal(result.out.at(-1), 10);
  const value = JSON.parse(result.out);
  assert.deepEqual(Object.keys(value), ['ok', 'format', 'version', 'status', 'nativeHost', 'extensionId',
    'launcherSha256', 'manifestSha256', 'nodeSha256', 'hostScriptSha256', 'sourceSha256',
    'registered', 'activated', 'protectedInstallationVerified']);
  assert.equal(value.ok, true); assert.equal(value.format, 'agent-continue-native-launcher');
  assert.equal(value.version, 1); assert.equal(value.status, 'prepared');
  assert.equal(value.nativeHost, HOST); assert.equal(value.extensionId, extensionId);
  assert.equal(value.registered, false); assert.equal(value.activated, false);
  assert.equal(value.protectedInstallationVerified, false);
  for (const key of ['launcherSha256', 'manifestSha256', 'nodeSha256', 'hostScriptSha256', 'sourceSha256']) {
    assert.match(value[key], /^[a-f0-9]{64}$/);
  }
  return value;
}
function failure(result) {
  assert.equal(result.code, 1); assert.equal(result.signal, null); assert.equal(result.error.length, 0);
  assert.equal(result.out.toString(), '{"ok":false,"error":"native_launcher_build_failed"}\n');
}
function unavailable(result) {
  assert.equal(result.code, 1); assert.equal(result.signal, null);
  assert.equal(result.error.toString(), diagnostic);
}

windows('compiler emits GUI PE, exact Chrome manifest, checked hashes and no activation', async t => {
  const f = fixture(t), value = success(await f.build());
  const executable = fs.readFileSync(f.output), bytes = fs.readFileSync(f.manifest);
  assert.equal(executable.readUInt16LE(), 0x5a4d);
  const offset = executable.readUInt32LE(0x3c);
  assert.equal(executable.readUInt32LE(offset), 0x4550);
  assert.equal(executable.readUInt16LE(offset + 24 + 68), 2);
  assert.equal(value.launcherSha256, hash(executable)); assert.equal(value.manifestSha256, hash(bytes));
  assert.equal(value.nodeSha256, hash(fs.readFileSync(process.execPath)));
  assert.equal(value.hostScriptSha256, hash(fs.readFileSync(f.script)));
  assert.equal(value.sourceSha256, hash(fs.readFileSync(path.join(here, 'NativeLauncher.cs'))));
  assert.deepEqual(JSON.parse(bytes), { name: HOST, description: 'Agent Continue device lifecycle bridge',
    path: f.output, type: 'stdio', allowed_origins: [origin] });
  assert.equal(fs.existsSync(f.marker), false, 'compilation must not launch the host');
  assert.deepEqual(fs.readdirSync(f.root).sort(), [path.basename(f.app), 'native launcher.exe', 'native-host.json'].sort());
});

windows('binary transport preserves Unicode NUL and newlines while Chrome stdin stays open', async t => {
  const f = fixture(t); success(await f.build());
  const bytes = frame(Buffer.from('\u4e2d\u6587\u539f\u751f\u0000line\nCRLF\r\n', 'utf8'));
  const result = await f.run(bytes);
  assert.equal(result.code, 0); assert.equal(result.error.length, 0);
  assert.deepEqual(result.out, bytes);
  assert.equal(fs.readFileSync(f.marker, 'utf8'), 'started\n', 'one direct invocation, no replay');
});

windows('origin and optional parent-window syntax are validated before child creation', async t => {
  const f = fixture(t); success(await f.build());
  for (const args of [[], [origin.slice(0, -1)], [origin.toUpperCase()], [origin + 'extra'],
    [`chrome-extension://${'b'.repeat(32)}/`], [origin, '--parent-window='],
    [origin, '--parent-window=-1'], [origin, '--parent-window=\uff11'],
    [origin, '--parent-window=' + '1'.repeat(21)], [origin, '--parent-window=0', 'extra']]) {
    const result = await f.run(frame({ mode: 'environment' }), args);
    unavailable(result); assert.equal(result.out.length, 0);
  }
  assert.equal(fs.existsSync(f.marker), false);
  for (const parent of ['0', '12345678901234567890']) {
    const result = await f.run(frame({ mode: 'environment' }), [origin, '--parent-window=' + parent]);
    assert.equal(result.code, 0); assert.deepEqual(decode(result.out).args, [origin]);
  }
});

windows('launcher removes inherited Node npm UV OpenSSL and certificate injection', async t => {
  const f = fixture(t); success(await f.build());
  const injected = path.join(f.root, 'must-not-execute.cjs'), marker = path.join(f.root, 'injected.txt');
  fs.writeFileSync(injected, `require('fs').writeFileSync(${JSON.stringify(marker)},'bad');`);
  const result = await f.run(frame({ mode: 'environment' }), [origin], { env: {
    NODE_OPTIONS: '--require ' + JSON.stringify(injected), NODE_PATH: f.root, NODE_EXTRA_CA_CERTS: injected,
    npm_config_node_options: '--require ' + JSON.stringify(injected), NPM_TOKEN: 'FAKE-NOT-A-CREDENTIAL',
    UV_THREADPOOL_SIZE: '2', OPENSSL_CONF: injected, ICU_DATA: f.root,
    SSL_CERT_FILE: injected, SSL_CERT_DIR: f.root, SSLKEYLOGFILE: marker,
    ELECTRON_RUN_AS_NODE: '1', VSCODE_INSPECTOR_OPTIONS: '{}',
  } });
  assert.equal(result.code, 0); assert.equal(result.error.length, 0);
  assert.deepEqual(decode(result.out), { args: [origin], inherited: [] });
  assert.equal(fs.existsSync(marker), false);
});

windows('input and output caps fail closed without forwarding child diagnostics', async t => {
  const f = fixture(t); success(await f.build());
  const input = await f.run(frame(Buffer.alloc(4097, 65)));
  unavailable(input); assert.equal(input.out.length, 0);
  const output = await f.run(frame({ mode: 'output-overflow' }));
  unavailable(output); assert.ok(output.out.length <= 4100);
  const childError = await f.run(frame({ mode: 'fail' }));
  unavailable(childError); assert.equal(childError.out.length, 0);
});

windows('stderr cap permits exactly 64 KiB and rejects overflow without exposing it', async t => {
  const f = fixture(t); success(await f.build());
  const bytes = frame({ mode: 'stderr-at-limit' }), permitted = await f.run(bytes);
  assert.equal(permitted.code, 0); assert.equal(permitted.error.length, 0); assert.deepEqual(permitted.out, bytes);
  const refused = await f.run(frame({ mode: 'stderr-overflow' }));
  unavailable(refused); assert.equal(refused.out.length, 0);
});

windows('launcher bounds one idle direct child to the fixed lifetime', async t => {
  const f = fixture(t); success(await f.build());
  const result = await f.run(frame({ mode: 'idle' }), [origin], { timeout: 40000 });
  unavailable(result); assert.equal(result.out.length, 0);
  const entered = JSON.parse(fs.readFileSync(path.join(f.root, 'idle-entered.json')));
  t.diagnostic(JSON.stringify({ launcherMs: result.elapsed, beforeChildInputMs: entered.at - result.started,
    afterChildInputMs: result.started + result.elapsed - entered.at,
    naturalChildExit: fs.existsSync(path.join(f.root, 'idle-exit.txt')) }));
  const afterInput = result.started + result.elapsed - entered.at;
  assert.ok(afterInput >= 25000 && afterInput < 33000, `child_lifetime_ms=${afterInput}`);
  assert.ok(result.elapsed < 40000, `launcher_wall_clock_ms=${result.elapsed}`);
  assert.equal(fs.existsSync(path.join(f.root, 'idle-exit.txt')), false, 'deadline must stop child before emergency natural exit');
  assert.equal(fs.readFileSync(f.marker, 'utf8'), 'started\n');
}, 60000);

windows('existing launcher or manifest is preserved and never silently repaired', async t => {
  for (const existing of ['output', 'manifest']) {
    const f = fixture(t); fs.writeFileSync(f[existing], 'preserve-existing');
    failure(await f.build());
    assert.equal(fs.readFileSync(f[existing], 'utf8'), 'preserve-existing');
    assert.equal(fs.existsSync(f[existing === 'output' ? 'manifest' : 'output']), false);
    assert.equal(fs.existsSync(f.marker), false);
  }
});

windows('compiler rejects noncanonical remote ADS reserved redirected and mismatched inputs', async t => {
  const f = fixture(t), alias = path.join(f.root, 'alias'), wrongNode = path.join(f.root, 'not-node.exe');
  fs.symlinkSync(f.app, alias, 'junction'); fs.writeFileSync(wrongNode, 'not a node executable');
  const invalid = [
    { OutputPath: 'relative.exe' }, { OutputPath: '\\\\server\\share\\launcher.exe' },
    { OutputPath: '\\\\?\\C:\\launcher.exe' }, { OutputPath: f.output + ':stream' },
    { OutputPath: f.output + '.' }, { OutputPath: path.join(f.root, 'CON.exe') },
    { OutputPath: f.root + '\\child\\..\\launcher.exe' },
    { OutputPath: path.join(f.root, 'x'.repeat(260) + '.exe') },
    { OutputPath: path.join(alias, 'launcher.exe') }, { OutputPath: path.join(f.root, 'launcher.cmd') },
    { ManifestPath: f.manifest + ':stream' }, { ManifestPath: path.join(f.root, 'host.txt') },
    { NodePath: wrongNode }, { HostScriptPath: path.join(alias, 'device-native-host.mjs') },
    { ExtensionId: 'A'.repeat(32) }, { ExtensionId: 'a'.repeat(31) },
  ];
  for (const values of invalid) {
    failure(await f.build(values));
    assert.equal(fs.existsSync(f.output), false); assert.equal(fs.existsSync(f.manifest), false);
    assert.equal(fs.existsSync(f.marker), false);
  }
}, 90000);

windows('runtime rejects removed or redirected fixed host before invoking it', async t => {
  const f = fixture(t); success(await f.build());
  fs.renameSync(f.script, path.join(f.app, 'saved.mjs'));
  const removed = await f.run(frame({ version: 1, id: 'missing', action: 'status' }));
  unavailable(removed); assert.equal(removed.out.length, 0);
  fs.renameSync(path.join(f.app, 'saved.mjs'), f.script);
  const saved = path.join(f.root, 'saved-app'); fs.renameSync(f.app, saved);
  fs.symlinkSync(saved, f.app, 'junction');
  const redirected = await f.run(frame({ version: 1, id: 'redirected', action: 'status' }));
  unavailable(redirected); assert.equal(redirected.out.length, 0);
  assert.equal(fs.existsSync(f.marker), false);
});

windows('actual staged native bridge reaches one explicitly started fixture owner through the exe', async t => {
  const f = fixture(t), { buildPackage } = await import('./build-package.mjs');
  const packaged = path.join(f.root, 'staged-package'); buildPackage(packaged);
  const app = path.join(packaged, 'payload'), state = path.join(f.root, 'state');
  const { prepareState } = await import(pathToFileURL(path.join(app, 'runtime.mjs')));
  const { startDeviceOwner } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')));
  prepareState(state, { consent: 'full-account' });
  const binding = path.join(app, 'device-native-binding.json');
  fs.writeFileSync(binding, JSON.stringify({ format: 'agent-continue-native-binding', version: 1,
    extensionId, stateRoot: state }) + '\n', { flag: 'wx', mode: 0o600 });
  const calls = []; let paused = true;
  const controller = {
    async status() { return { paused, runtime: paused ? 'stopped' : 'running', ready: !paused }; },
    async reconnect() { calls.push('reconnect'); paused = false; return this.status(); },
    async pause() { calls.push('pause'); paused = true; return this.status(); },
    async dispose() { paused = true; },
  };
  const owner = await startDeviceOwner(binding, { controller }); f.closers.push(() => owner.close());
  success(await f.build({ HostScriptPath: path.join(app, 'device-native-host.mjs') }, packaged));
  const ask = async (id, action = 'status') => {
    const result = await f.run(frame({ version: 1, id, action }));
    assert.equal(result.code, 0); assert.equal(result.error.length, 0);
    return decode(result.out);
  };
  assert.equal((await ask('initial')).state.paused, true);
  const connected = await ask('one-connect', 'reconnect');
  assert.equal(connected.state.connection, 'ready');
  assert.deepEqual(await ask('one-connect', 'reconnect'), connected);
  await ask('pause', 'disconnect-and-pause');
  assert.deepEqual((await ask('one-connect')).state.operation, connected.state.operation);
  assert.deepEqual(calls, ['reconnect', 'pause']);
  assert.equal(fs.existsSync(f.marker), false, 'staged bridge, not the echo fixture');
  t.diagnostic('Actual staged bridge + explicit fixture owner + Windows GUI executable; Chrome registration and official tunnel not exercised');
}, 90000);
