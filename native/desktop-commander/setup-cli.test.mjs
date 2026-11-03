import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'setup-cli.mjs');
const failure = { ok: false, error: 'setup_failed' };

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-setup-cli-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('agentcontinue-setup-cli-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function run(root, args, entry = cli) {
  const env = {
    PATH: path.dirname(process.execPath),
    HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
    TEMP: root, TMP: root, TMPDIR: root,
  };
  for (const key of ['SystemRoot', 'WINDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 4096,
  });
}

function output(result, expected) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, expected.ok ? 0 : 1);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, JSON.stringify(expected) + '\n');
  assert.ok(Buffer.byteLength(result.stdout) < 160);
}

function snapshot(root) {
  const entries = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      entries.push([path.relative(root, file), item.isDirectory() ? null : fs.readFileSync(file, 'hex')]);
      if (item.isDirectory()) walk(file);
    }
  }
  walk(root);
  return entries;
}

function copiedCLI(root) {
  const entry = path.join(root, 'setup-cli.mjs');
  fs.copyFileSync(cli, entry);
  return entry;
}

function guardedCLI(root) {
  const entry = copiedCLI(root);
  for (const name of ['runtime.mjs', 'profile.mjs']) {
    fs.writeFileSync(path.join(root, name), `
import fs from 'node:fs';
fs.writeFileSync(new URL('./unexpected-import', import.meta.url), 'imported');
throw new Error('unexpected-import');
`);
  }
  return entry;
}

test('prepare creates only isolated inactive state with explicit full-account consent', t => {
  const root = scratch(t);
  const state = path.join(root, 'state');
  output(run(root, ['prepare', '--state-dir', state, '--consent', 'full-account']),
    { ok: true, prepared: true, activated: false });
  assert.deepEqual(fs.readdirSync(state).sort(), ['consent.json', 'home', 'temp', 'work']);
  const files = snapshot(root).filter(([, bytes]) => bytes !== null).map(([name]) => name);
  assert.deepEqual(files.sort(), [path.join('state', 'consent.json'),
    path.join('state', 'home', '.claude-server-commander', 'config.json')].sort());
  const consent = JSON.parse(fs.readFileSync(path.join(state, 'consent.json'), 'utf8'));
  assert.equal(consent.scope, 'full-account');
  assert.equal(consent.activated, false);
  assert.equal(consent.protectedInstallationVerified, false);
  const config = JSON.parse(fs.readFileSync(path.join(state, 'home', '.claude-server-commander', 'config.json'), 'utf8'));
  assert.equal(config.telemetryEnabled, false);
  assert.deepEqual(config.allowedDirectories, []);
  assert.deepEqual(config.blockedCommands, []);
});

test('prepare refuses missing or substituted consent without filesystem effects', t => {
  const root = scratch(t);
  const state = path.join(root, 'state');
  for (const tail of [[], ['--consent'], ['--consent', ''], ['--consent', 'yes'],
    ['--consent', 'true'], ['--consent', 'browser'], ['--consent', 'Full-account']]) {
    output(run(root, ['prepare', '--state-dir', state, ...tail]), failure);
    assert.deepEqual(snapshot(root), []);
  }
});

test('existing state and filesystem errors are sanitized and never repaired', t => {
  const root = scratch(t);
  const state = path.join(root, 'state');
  const args = ['prepare', '--state-dir', state, '--consent', 'full-account'];
  output(run(root, args), { ok: true, prepared: true, activated: false });
  const before = snapshot(root);
  output(run(root, args), failure);
  output(run(root, ['prepare', '--state-dir', path.join(root, 'missing', 'state'),
    '--consent', 'full-account']), failure);
  assert.deepEqual(snapshot(root), before);
});

test('only exact subcommands, options and one value per flag are accepted', t => {
  const root = scratch(t);
  const entry = guardedCLI(root);
  const before = snapshot(root);
  const state = path.join(root, 'state');
  const prepare = ['prepare', '--state-dir', state, '--consent', 'full-account'];
  const inspect = ['inspect', '--state-dir', state];
  const configure = ['configure', '--state-dir', state, '--tunnel-id', 'fixture-id',
    '--runtime-key-file', path.join(root, 'not-a-key'), '--tunnel-client', path.join(root, 'not-a-client')];
  const cases = [[], ['help'], ['--help'], ['PREPARE'], ['prepare'], ['inspect'], ['configure'],
    ['prepare', '--state-dir'], ['inspect', '--state-dir', ''],
    ['prepare', '--state-dir', 'relative', '--consent', 'full-account'],
    ['inspect', '--state-dir', 'relative'], ['inspect', '--state-dir=' + state],
    [...prepare, '--state-dir', state], [...prepare, '--consent', 'full-account'],
    [...prepare, 'extra'], [...prepare, '--'], [...inspect, '--consent', 'full-account'],
    [...inspect, '--tunnel-id', 'fixture-id'], [...configure, '--consent', 'full-account'],
    ['prepare', '--consent', '--state-dir', state], ['inspect', '--state-dir', '--help']];
  for (let index = 1; index < configure.length; index += 2) {
    cases.push([...configure, configure[index], configure[index + 1]]);
    cases.push(configure.filter((_, position) => position !== index && position !== index + 1));
    cases.push([...configure.slice(0, index + 1)]);
  }
  for (const flag of ['--start', '--install', '--elevation', '--registration', '--command', '--commands',
    '--__proto__', '--prototype', '--constructor', '--toString', '--hasOwnProperty']) {
    for (const args of [prepare, inspect, configure]) cases.push([...args, flag, 'true']);
    cases.push([flag.slice(2), '--state-dir', state]);
  }
  for (const args of cases) {
    output(run(root, args, entry), failure);
    assert.deepEqual(snapshot(root), before);
  }
});

test('configure rejects relative key or client paths before importing a profile', t => {
  const root = scratch(t);
  const entry = guardedCLI(root);
  const before = snapshot(root);
  for (const [key, client] of [['relative-key', path.join(root, 'client')],
    [path.join(root, 'key'), 'relative-client'], ['', path.join(root, 'client')]]) {
    output(run(root, ['configure', '--state-dir', path.join(root, 'state'), '--tunnel-id', 'fixture-id',
      '--runtime-key-file', key, '--tunnel-client', client], entry), failure);
    assert.deepEqual(snapshot(root), before);
  }
});

test('local runtime import failures stay inside the sanitized JSON boundary', t => {
  const root = scratch(t);
  const entry = copiedCLI(root);
  for (const mode of ['missing-runtime', 'missing-pin', 'malformed-pin', 'throwing-runtime']) {
    fs.rmSync(path.join(root, 'runtime.mjs'), { force: true });
    fs.rmSync(path.join(root, 'upstream-pin.json'), { force: true });
    if (mode !== 'missing-runtime') fs.copyFileSync(path.join(here, 'runtime.mjs'), path.join(root, 'runtime.mjs'));
    if (mode === 'malformed-pin') fs.writeFileSync(path.join(root, 'upstream-pin.json'), '{');
    if (mode === 'throwing-runtime') fs.writeFileSync(path.join(root, 'runtime.mjs'), "throw new Error('synthetic-private-value');\n");
    output(run(root, ['prepare', '--state-dir', path.join(root, 'state'), '--consent', 'full-account'], entry), failure);
    assert.equal(fs.existsSync(path.join(root, 'state')), false);
  }
});

test('missing, malformed and throwing profile modules produce only setup_failed', t => {
  const root = scratch(t);
  const entry = copiedCLI(root);
  for (const source of [null, 'export function {', "throw new Error('synthetic-private-value');\n"]) {
    if (source !== null) fs.writeFileSync(path.join(root, 'profile.mjs'), source);
    for (const args of [['inspect', '--state-dir', path.join(root, 'state')],
      ['configure', '--state-dir', path.join(root, 'state'), '--tunnel-id', 'fixture-id',
        '--runtime-key-file', path.join(root, 'key'), '--tunnel-client', path.join(root, 'client')]]) {
      output(run(root, args, entry), failure);
      assert.equal(fs.existsSync(path.join(root, 'state')), false);
    }
  }
});

test('isolated profile delegation uses exact arguments and closes output fields', t => {
  const root = scratch(t);
  const entry = copiedCLI(root);
  const state = path.join(root, 'state');
  const key = path.join(root, 'key');
  const client = path.join(root, 'client');
  // This fixture checks CLI routing only; it never verifies or executes a tunnel binary.
  fs.writeFileSync(path.join(root, 'profile.mjs'), `
import assert from 'node:assert/strict';
export function writeTunnelProfile(root, options) {
  assert.equal(root, ${JSON.stringify(state)});
  assert.deepEqual(options, ${JSON.stringify({ tunnelId: 'fixture-id', runtimeKeyFile: key, tunnelExecutable: client })});
  return { configured: true, activated: false, authenticationVerified: false,
    privateValue: 'synthetic-private-value' };
}
export function inspectTunnelProfile(root) {
  assert.equal(root, ${JSON.stringify(state)});
  return { configured: false, activation: 'not-observed', authenticationVerified: false,
    activated: true, privateValue: 'synthetic-private-value', root };
}
`);
  const before = snapshot(root);
  output(run(root, ['configure', '--tunnel-client', client, '--runtime-key-file', key,
    '--tunnel-id', 'fixture-id', '--state-dir', state], entry),
  { ok: true, configured: true, activated: false, authenticationVerified: false });
  output(run(root, ['inspect', '--state-dir', state], entry),
    { ok: true, configured: false, activation: 'not-observed', authenticationVerified: false });
  assert.deepEqual(snapshot(root), before);
});

for (const contract of [
  { command: 'prepare', moduleFile: 'runtime.mjs', exportName: 'prepareState',
    success: { prepared: true, activated: false, protectedInstallationVerified: false },
    output: { ok: true, prepared: true, activated: false } },
  { command: 'configure', moduleFile: 'profile.mjs', exportName: 'writeTunnelProfile',
    success: { configured: true, activated: false, authenticationVerified: false },
    output: { ok: true, configured: true, activated: false, authenticationVerified: false } },
]) {
  test(`${contract.command} requires every success field and rejects false, unknown or activated results`, t => {
    const root = scratch(t);
    const entry = copiedCLI(root);
    const args = [contract.command, '--state-dir', path.join(root, 'state'),
      ...(contract.command === 'prepare' ? ['--consent', 'full-account'] :
        ['--tunnel-id', 'fixture-id', '--runtime-key-file', path.join(root, 'key'),
          '--tunnel-client', path.join(root, 'client')])];
    const rejected = [undefined, null, false, true, 'unknown', [], {},
      { ok: false, error: 'synthetic-private-value' }];
    for (const [field, value] of Object.entries(contract.success)) {
      for (const invalid of [undefined, null, 'unknown', !value, value ? 1 : 0, String(value)]) {
        rejected.push({ ...contract.success, [field]: invalid });
      }
    }
    const moduleFile = path.join(root, contract.moduleFile);
    for (const result of rejected) {
      fs.writeFileSync(moduleFile,
        `export function ${contract.exportName}() { return ${JSON.stringify(result)}; }\n`);
      const before = snapshot(root);
      output(run(root, args, entry), failure);
      assert.deepEqual(snapshot(root), before);
    }
    fs.writeFileSync(moduleFile, `export function ${contract.exportName}() { return ${JSON.stringify({
      ...contract.success, privateValue: 'synthetic-private-value', root,
    })}; }\n`);
    const before = snapshot(root);
    output(run(root, args, entry), contract.output);
    assert.deepEqual(snapshot(root), before);
  });
}

test('inspect accepts only boolean configuration with unobserved activation and unverified authentication', t => {
  const root = scratch(t);
  const entry = copiedCLI(root);
  for (const result of [null, {}, { configured: 'true', activation: 'not-observed', authenticationVerified: false },
    { configured: 1, activation: 'not-observed', authenticationVerified: false },
    { configured: true, activated: false, authenticationVerified: false },
    { configured: true, activated: true, authenticationVerified: false },
    { configured: true, activation: false, authenticationVerified: false },
    { configured: true, activation: 'inactive', authenticationVerified: false },
    { configured: true, activation: 'active', authenticationVerified: false },
    { configured: true, activation: 'not-observed', authenticationVerified: true }]) {
    fs.writeFileSync(path.join(root, 'profile.mjs'),
      `export function inspectTunnelProfile() { return ${JSON.stringify(result)}; }\n`);
    output(run(root, ['inspect', '--state-dir', path.join(root, 'state')], entry), failure);
  }
  fs.writeFileSync(path.join(root, 'profile.mjs'),
    "export function inspectTunnelProfile() { return { configured: true, activation: 'not-observed', authenticationVerified: false }; }\n");
  output(run(root, ['inspect', '--state-dir', path.join(root, 'state')], entry),
    { ok: true, configured: true, activation: 'not-observed', authenticationVerified: false });
});
