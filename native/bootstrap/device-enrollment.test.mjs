import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from './build-package.mjs';

const source = new URL('./device-enrollment.mjs', import.meta.url);
const api = fs.existsSync(source) ? await import(source) : null;
const check = (name, run) => test(name, { skip: api ? false : 'enrollment API not implemented', timeout: 30000 }, run);
const extensionId = 'a'.repeat(32), encode = value => JSON.stringify(value) + '\n';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const stageReceipt = { format: 'agent-continue-acquisition', version: 1, status: 'staged', providerVersion: '0.3.1',
  configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
const runtimeRoot = fileURLToPath(new URL('../desktop-commander/', import.meta.url));

test('trusted local enrollment API exists', () => assert.equal(typeof api?.enrollSshTarget, 'function'));
test('a fresh process imports enrollment without application filesystem, child or network effects', {
  skip: !api ? 'enrollment API not implemented' : process.platform === 'win32' && process.env.AGENT_CONTINUE_IMPORT_EFFECT_PROBE !== '1'
    ? 'Defender blocked the Windows command-line import probe; classification required before opt-in execution' : false,
}, t => {
  const script = `
    import fs from 'node:fs';
    import cp from 'node:child_process';
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    import assert from 'node:assert/strict';
    const attempts = [];
    const deny = (target, names) => {
      for (const name of names) target[name] = () => { attempts.push(name); throw new Error('fixture_forbidden_effect'); };
    };
    for (const name of ['lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'openSync']) {
      const original = fs[name];
      fs[name] = (...args) => {
        const caller = new Error().stack.split('\\n')[2] ?? '';
        if (caller.includes('node:internal/modules/')) return Reflect.apply(original, fs, args);
        attempts.push(name); throw new Error('fixture_forbidden_effect');
      };
    }
    deny(fs, ['writeFileSync', 'mkdirSync', 'linkSync', 'unlinkSync', 'renameSync', 'chmodSync']);
    deny(fs.promises, ['writeFile', 'mkdir', 'link', 'unlink', 'rename', 'chmod']);
    deny(cp, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
    deny(net.Socket.prototype, ['connect']); deny(net.Server.prototype, ['listen']);
    deny(http, ['get', 'request']); deny(https, ['get', 'request']);
    syncBuiltinESMExports();
    const imported = await import(${JSON.stringify(source.href)});
    assert.equal(typeof imported.enrollSshTarget, 'function'); assert.deepEqual(attempts, []);
    assert.throws(() => fs.statSync('/fixture-read-probe'), /fixture_forbidden_effect/);
    assert.throws(() => cp.spawn('fixture-child-probe'), /fixture_forbidden_effect/);
    assert.deepEqual(attempts, ['statSync', 'spawn']);
    process.stdout.write('effect-free-import\\n');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 65536,
  });
  assert.equal(result.status, 0, JSON.stringify({ error: result.error?.code, signal: result.signal,
    stdout: result.stdout?.slice(0, 2000), stderr: result.stderr?.slice(0, 4000) })); assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'effect-free-import\n');
});
test('bootstrap help exposes the distinct trusted local enrollment command', async () => {
  const { main } = await import('./bin.mjs');
  const help = await main(['help']);
  assert.equal(help.ok, true);
  for (const command of ['help', 'version', 'stage', 'acquire', 'setup', 'setup-manager', 'enroll-ssh']) assert.ok(help.commands.includes(command));
});
test('enrollment source is in bootstrap package and default tests, not device runtime payload', async () => {
  const { PACKAGE_FILES, RUNTIME_FILES } = await import('./payload-layout.mjs');
  assert.ok(PACKAGE_FILES.includes('device-enrollment.mjs'));
  assert.equal(RUNTIME_FILES.includes('device-enrollment.mjs'), false);
  const meta = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
  assert.ok(meta.files.includes('device-enrollment.mjs'));
  assert.ok(meta.scripts.test.includes('device-enrollment.test.mjs'));
});

async function fixture(t) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'agent-enrollment-'));
  fs.chmodSync(root, 0o700);
  const identity = fs.lstatSync(root, { bigint: true });
  t.after(() => {
    assert.equal(fs.realpathSync(root), root);
    const current = fs.lstatSync(root, { bigint: true });
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    assert.equal(path.dirname(root), temporary);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const packageRoot = path.join(root, 'package'); buildPackage(packageRoot);
  const installDir = path.join(root, 'manager'), app = path.join(installDir, 'app');
  fs.mkdirSync(installDir, { mode: 0o700 }); fs.cpSync(path.join(packageRoot, 'payload'), app, { recursive: true });
  fs.chmodSync(app, 0o700);
  const provider = path.join(runtimeRoot, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const out = path.join(app, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(path.join(provider, 'package.json'), path.join(out, 'package.json'));
  fs.cpSync(path.join(provider, 'dist'), path.join(out, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'receipt.json'), encode(stageReceipt), { mode: 0o600 });
  const runtime = await import(pathToFileURL(path.join(app, 'runtime.mjs')));
  const owner = await import(pathToFileURL(path.join(app, 'device-owner.mjs')));
  const state = path.join(installDir, 'state'); runtime.prepareState(state, { consent: 'full-account' });
  const binding = path.join(app, 'device-native-binding.json');
  fs.writeFileSync(binding, encode({ format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: state }), { mode: 0o600 });
  const knownHosts = path.join(root, 'verified known hosts');
  const hostBytes = 'server.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly\n';
  fs.writeFileSync(knownHosts, hostBytes, { mode: 0o600 });
  const options = { installDir, consent: 'full-account', sshExecutable: process.execPath, host: 'server.example', port: 22,
    user: 'researcher', remoteNode: '/usr/bin/node', remoteInstallDir: "/srv/owner's research", knownHosts,
    knownHostsSha256: digest(hostBytes) };
  const descriptor = { host: options.host, port: options.port, user: options.user, node: options.remoteNode,
    entry: options.remoteInstallDir + '/app/device-server.mjs', stateRoot: options.remoteInstallDir + '/state', knownHosts,
    knownHostsSha256: options.knownHostsSha256 };
  const target = digest(JSON.stringify([extensionId, descriptor]));
  const registry = path.join(app, 'device-ssh-targets.json');
  const trusted = { packageRoot };
  return { root, packageRoot, installDir, app, state, binding, knownHosts, hostBytes, options, descriptor, target, registry, trusted, owner };
}

function expected(f) {
  return { format: 'agent-continue-ssh-enrollment-result', version: 1, status: 'enrolled', target: f.target,
    deviceUrl: 'chrome-extension://' + extensionId + '/devices.html?target=' + f.target,
    sshAuthenticationVerified: false, ownerReachabilityVerified: false, nativeRegistrationVerified: false,
    chatAuthorizationVerified: false, activated: false };
}

function noIO(run) {
  const names = ['lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'openSync', 'writeFileSync', 'mkdirSync', 'linkSync'];
  const saved = names.map(name => [name, fs[name]]), attempts = [];
  for (const [name] of saved) fs[name] = () => { attempts.push(name); throw new Error('fixture_forbidden_io'); };
  return Promise.resolve().then(run).finally(() => {
    for (const [name, original] of saved) fs[name] = original;
    assert.deepEqual(attempts, [], 'refused input must not attempt filesystem I/O');
  });
}

check('consent and closed data-only options reject before filesystem access', async () => {
  await noIO(async () => {
    for (const options of [undefined, {}, { consent: 'yes' }, { get consent() { throw new Error('getter_must_not_run'); } }]) {
      await assert.rejects(api.enrollSshTarget(options), /^Error: consent_required$/);
    }
    const base = { installDir: '/missing', consent: 'full-account', sshExecutable: '/ssh', host: 'server.example',
      port: 22, user: 'researcher', remoteNode: '/usr/bin/node', remoteInstallDir: '/srv/research',
      knownHosts: '/keys', knownHostsSha256: 'a'.repeat(64) };
    for (const options of [{ ...base, password: 'never' }, { ...base, extensionId }, { ...base, port: '22' },
      { ...base, port: 0 }, { ...base, port: 65536 }, { ...base, host: '-oProxyCommand=x' },
      { ...base, user: 'a;private' }, { ...base, remoteNode: 'node' }, { ...base, remoteInstallDir: '/srv/../other' },
      { ...base, remoteInstallDir: '/' }, { ...base, knownHostsSha256: 'bad' }, { ...base, [Symbol('extra')]: true }]) {
      await assert.rejects(api.enrollSshTarget(options), /^Error: enrollment_input_invalid$/);
    }
    await assert.rejects(api.enrollSshTarget(base, { command: 'private' }), /^Error: enrollment_input_invalid$/);
  });
});

check('one local enrollment emits a fixed device link accepted by the installed production reader', async t => {
  const f = await fixture(t);
  const receipt = await api.enrollSshTarget(f.options, f.trusted);
  assert.deepEqual(receipt, expected(f));
  assert.equal(fs.lstatSync(f.registry).nlink, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.registry)), { format: 'agent-continue-ssh-targets', version: 1,
    extensionId, sshExecutable: process.execPath, targets: [{ id: f.target, ...f.descriptor }] });
  const binding = f.owner.readSshTarget(f.registry, extensionId, f.target); binding.assertCurrent();
  assert.equal(binding.entry, f.descriptor.entry); assert.equal(binding.stateRoot, f.descriptor.stateRoot);
  assert.equal(new URL(receipt.deviceUrl).searchParams.get('target'), f.target);
  assert.equal(fs.existsSync(path.join(f.state, 'device-channel.json')), false);
  assert.equal(fs.existsSync(path.join(f.state, 'device-operations.jsonl')), false);
  assert.equal(fs.existsSync(path.join(f.state, 'tunnel.yaml')), false, 'remote-only manager needs no local tunnel key');
  assert.deepEqual(fs.readdirSync(f.app).filter(name => name.startsWith('device-ssh-targets')), ['device-ssh-targets.json']);
  assert.doesNotMatch(JSON.stringify(receipt), /server\.example|researcher|\/srv\/|known.hosts/i);
});

check('changed target identity produces a different device link rather than reusing another device pending ID', async t => {
  const first = await fixture(t), second = await fixture(t);
  second.options.host = 'other.example';
  const a = await api.enrollSshTarget(first.options, first.trusted);
  const b = await api.enrollSshTarget(second.options, second.trusted);
  assert.notEqual(a.target, b.target); assert.notEqual(a.deviceUrl, b.deviceUrl);
});

check('existing registry is never overwritten, repaired or contacted', async t => {
  const f = await fixture(t), sentinel = 'existing private record\n';
  fs.writeFileSync(f.registry, sentinel, { mode: 0o600 });
  await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_exists$/);
  assert.equal(fs.readFileSync(f.registry, 'utf8'), sentinel);
});

check('missing native binding and a binding to another state cannot enroll a headless server as a manager', async t => {
  for (const replacement of [null, 'other-state']) {
    const f = await fixture(t);
    if (replacement === null) fs.unlinkSync(f.binding);
    else {
      const runtime = await import(pathToFileURL(path.join(f.app, 'runtime.mjs')));
      const state = path.join(f.root, replacement); runtime.prepareState(state, { consent: 'full-account' });
      fs.writeFileSync(f.binding, encode({ format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: state }));
    }
    await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_install_invalid$/);
    assert.equal(fs.existsSync(f.registry), false);
  }
});

check('changed provider bytes cannot supply executable enrollment helpers', async t => {
  const f = await fixture(t); fs.appendFileSync(path.join(f.app, 'device-owner.mjs'), '\n// fixture tamper\n');
  await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_install_invalid$/);
  assert.equal(fs.existsSync(f.registry), false);
});

check('independently supplied host-key digest and private known-host evidence are required', async t => {
  const f = await fixture(t);
  for (const change of [{ knownHostsSha256: 'f'.repeat(64) }, { knownHosts: path.join(f.root, 'missing') }]) {
    await assert.rejects(api.enrollSshTarget({ ...f.options, ...change }, f.trusted), /^Error: enrollment_input_invalid$/);
    assert.equal(fs.existsSync(f.registry), false);
  }
  const alias = path.join(f.root, 'alias'); fs.linkSync(f.knownHosts, alias);
  await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_input_invalid$/);
  assert.equal(fs.existsSync(f.registry), false);
});

check('OpenSSH token expansion cannot redirect enrolled known-host evidence', async t => {
  const f = await fixture(t), knownHosts = path.join(f.root, '%h keys');
  fs.writeFileSync(knownHosts, f.hostBytes, { mode: 0o600 });
  await assert.rejects(api.enrollSshTarget({ ...f.options, knownHosts }, f.trusted), /^Error: enrollment_input_invalid$/);
  assert.equal(fs.existsSync(f.registry), false);
});

check('binding, candidate and known-host replacement during final async verification prevent publication', async t => {
  for (const kind of ['binding', 'candidate', 'known-host']) {
    const f = await fixture(t), write = fs.writeFileSync; let scheduled = false, replaced = false;
    fs.writeFileSync = function(file, ...args) {
      const result = Reflect.apply(write, this, [file, ...args]);
      if (!scheduled && path.dirname(String(file)) === f.app && path.basename(String(file)).startsWith('device-ssh-targets.pending.')) {
        scheduled = true;
        queueMicrotask(() => {
          const selected = kind === 'binding' ? f.binding : kind === 'candidate' ? String(file) : f.knownHosts;
          const bytes = fs.readFileSync(selected); fs.renameSync(selected, selected + '.held');
          Reflect.apply(write, fs, [selected, bytes, { flag: 'wx', mode: 0o600 }]); replaced = true;
        });
      }
      return result;
    };
    try { await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_changed$/); }
    finally { fs.writeFileSync = write; }
    assert.equal(replaced, true, kind); assert.equal(fs.existsSync(f.registry), false, kind);
  }
});

check('a concurrent destination wins without being overwritten', async t => {
  const f = await fixture(t), link = fs.linkSync; let injected = false;
  fs.linkSync = function(from, to) {
    if (to === f.registry && !injected) { fs.writeFileSync(to, 'concurrent record\n', { flag: 'wx', mode: 0o600 }); injected = true; }
    return Reflect.apply(link, this, [from, to]);
  };
  try { await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_exists$/); }
  finally { fs.linkSync = link; }
  assert.equal(injected, true); assert.equal(fs.readFileSync(f.registry, 'utf8'), 'concurrent record\n');
});

check('publication cleanup and readback failures never return an enrollment success or repair a record', async t => {
  for (const kind of ['unlink-failure', 'extra-hardlink', 'same-byte-inode', 'invalid-readback']) {
    const f = await fixture(t), unlink = fs.unlinkSync; let injected = false;
    fs.unlinkSync = function(file) {
      if (path.dirname(String(file)) !== f.app || !path.basename(String(file)).startsWith('device-ssh-targets.pending.')) {
        return Reflect.apply(unlink, this, [file]);
      }
      injected = true;
      if (kind === 'unlink-failure') throw new Error('fixture_sensitive_cleanup_failure');
      const result = Reflect.apply(unlink, this, [file]);
      if (kind === 'extra-hardlink') fs.linkSync(f.registry, f.registry + '.alias');
      if (kind === 'same-byte-inode') {
        const bytes = fs.readFileSync(f.registry); fs.renameSync(f.registry, f.registry + '.held');
        fs.writeFileSync(f.registry, bytes, { flag: 'wx', mode: 0o600 });
      }
      if (kind === 'invalid-readback') fs.writeFileSync(f.registry, '{}\n', { mode: 0o600 });
      return result;
    };
    try { await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_write_failed$/); }
    finally { fs.unlinkSync = unlink; }
    assert.equal(injected, true, kind); assert.equal(fs.existsSync(f.registry), true, kind);
    const bytes = fs.readFileSync(f.registry);
    await assert.rejects(api.enrollSshTarget(f.options, f.trusted), /^Error: enrollment_exists$/);
    assert.ok(fs.readFileSync(f.registry).equals(bytes), kind);
    assert.equal(fs.existsSync(path.join(f.state, 'device-channel.json')), false);
  }
});

function cliArgs(f) {
  return ['enroll-ssh', '--install-dir', f.installDir, '--consent', 'full-account', '--ssh-executable', process.execPath,
    '--host', f.options.host, '--port', '22', '--user', f.options.user, '--remote-node', f.options.remoteNode,
    '--remote-install-dir', f.options.remoteInstallDir, '--known-hosts', f.knownHosts,
    '--known-hosts-sha256', f.options.knownHostsSha256];
}

check('CLI syntax rejects duplicate, unknown, missing and noncanonical port flags before I/O', async t => {
  const f = await fixture(t), { main } = await import('./bin.mjs'), valid = cliArgs(f);
  const port = value => valid.map((item, index) => valid[index - 1] === '--port' ? value : item);
  await noIO(async () => {
    for (const args of [[...valid, '--host', 'duplicate'], [...valid, '--command', 'private'], valid.slice(0, -2),
      port('022'), port('+22'), port('22.0'), port('0'), port('65536')]) {
      await assert.rejects(main(args), /^Error: invalid_arguments$/);
    }
  });
});

check('direct CLI failures emit only one fixed JSON code, no raw host/path diagnostics', async t => {
  const f = await fixture(t);
  const args = cliArgs(f).map((value, index, all) => all[index - 1] === '--install-dir' ? path.join(f.root, 'missing-install') : value);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./bin.mjs', import.meta.url)), ...args], {
    cwd: f.root, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 65536,
  });
  // Explicitly absent install keeps this independent of npm prepack's generated payload.
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  assert.equal(result.stdout, encode({ ok: false, error: 'enrollment_install_invalid' }));
});
