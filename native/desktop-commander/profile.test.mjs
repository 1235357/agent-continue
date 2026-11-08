import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareState } from './runtime.mjs';

const target = new URL('./profile.mjs', import.meta.url);
const api = fs.existsSync(target) ? await import(target) : null;
const here = path.dirname(fileURLToPath(import.meta.url));
test('official profile builder exists', () => assert.ok(api));
const check = (name, run) => test(name, { skip: !api }, run);
function scratch(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-profile-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "state, with spaces's $literal");
  prepareState(root, { consent: 'full-account' });
  return { base, root };
}
const tunnelId = 'tunnel_0123456789abcdef0123456789abcdef';

test('sealed Windows profile pins the interpreter, import fence and private credential reference', { skip: process.platform !== 'win32' }, t => {
  const { base } = scratch(t);
  const bundleRoot = path.join(base, "sealed [candidate] with space's");
  const options = { bundleRoot, tunnelId };
  const state = bundleRoot + '.state';
  const profile = api.createSealedWindowsProfileDocument(options);
  assert.deepEqual(profile.control_plane, { base_url: 'https://api.openai.com', tunnel_id: tunnelId,
    api_key: 'file:' + path.join(bundleRoot + '.secrets', 'runtime.key') });
  const argv = [path.join(bundleRoot, 'runtime', 'node.exe'), '--no-global-search-paths', '--import',
    pathToFileURL(path.join(state, 'startup-imports.mjs')).href, path.join(bundleRoot, 'app', 'host.mjs'), '--state-dir', state];
  assert.equal(profile.mcp.commands[0].command, argv.map(value => '"' + value.replaceAll('\\', '/') + '"').join(' '));
  assert.equal(profile.mcp.stdio_failure_policy, 'exit');
  assert.equal(profile.admin_ui.open_browser, false);
  assert.equal(profile.health.listen_addr, '127.0.0.1:0');
  assert.equal(fs.existsSync(bundleRoot), false);
  assert.equal(fs.existsSync(state), false);
  for (const extra of [{ endpoint: 'http://127.0.0.1:9000' }, { runtimeKeyFile: 'other.key' },
    { command: 'other.exe' }, { stateRoot: state + '-other' }]) {
    assert.throws(() => api.createSealedWindowsProfileDocument({ ...options, ...extra }), /invalid_profile_input/);
  }
});

check('profile points only to official API and fixed stdio core without embedded key data', t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key');
  const profile = api.createProfileDocument(root, { tunnelId, runtimeKeyFile: key });
  assert.equal(profile.config_version, 1);
  assert.equal(profile.control_plane.base_url, 'https://api.openai.com');
  assert.equal(profile.control_plane.api_key, 'file:' + key);
  assert.equal(profile.health.listen_addr, '127.0.0.1:0');
  assert.equal(profile.admin_ui.open_browser, false);
  assert.equal(profile.mcp.commands.length, 1);
  assert.equal(profile.mcp.commands[0].channel, 'main');
  assert.match(profile.mcp.commands[0].command, /host\.mjs/);
  assert.equal(profile.mcp.stdio_failure_policy, 'exit');
  assert.equal(profile.log.http_raw_unsafe, false);
  assert.ok(!fs.existsSync(path.join(root, 'tunnel.yaml')));
});

check('profile has no endpoint, command, credential or browser-setting override surface', t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key');
  for (const extra of [{ endpoint: 'https://example.invalid' }, { command: 'echo unexpected' },
    { apiKey: 'synthetic-secret' }, { allowRemoteUI: true }]) {
    assert.throws(() => api.createProfileDocument(root, { tunnelId, runtimeKeyFile: key, ...extra }), /invalid_profile_input/);
  }
  for (const value of ['../escape', 'tunnel_bad\ncommand', '', 123, 'tunnel_short123',
    'tunnel_' + 'A'.repeat(32), 'tunnel_longnamespace_' + 'a'.repeat(32)]) {
    assert.throws(() => api.createProfileDocument(root, { tunnelId: value, runtimeKeyFile: key }), /invalid_profile_input/);
  }
  const namespaced = 'tunnel_ab12_' + 'z'.repeat(32);
  assert.equal(api.createProfileDocument(root, { tunnelId: namespaced, runtimeKeyFile: key }).control_plane.tunnel_id, namespaced);
});

check('launch environment drops old endpoints, targets, proxy settings and browser/raw-log toggles', t => {
  const { base, root } = scratch(t);
  const env = api.profileEnvironment(root, { PATH: 'keep-path', NODE_OPTIONS: 'bad',
    CONTROL_PLANE_BASE_URL: 'https://example.invalid', MCP_COMMAND: 'unexpected', MCP_SERVER_URL: 'http://example.invalid',
    ALLOW_REMOTE_UI: 'true', OPEN_WEB_UI: 'true', LOG_HTTP_RAW_UNSAFE: 'true',
    HTTPS_PROXY: 'http://example.invalid', all_proxy: 'http://example.invalid',
    HEALTH_LISTEN_ADDR: '0.0.0.0:8080', CLOUDFLARED_MANAGED: 'true', TUNNEL_CLIENT_CONFIG: 'other-file' });
  assert.equal(env.PATH, 'keep-path');
  for (const key of ['NODE_OPTIONS', 'CONTROL_PLANE_BASE_URL', 'MCP_COMMAND', 'MCP_SERVER_URL', 'ALLOW_REMOTE_UI',
    'OPEN_WEB_UI', 'LOG_HTTP_RAW_UNSAFE', 'HTTPS_PROXY', 'all_proxy', 'HEALTH_LISTEN_ADDR', 'CLOUDFLARED_MANAGED', 'TUNNEL_CLIENT_CONFIG']) assert.equal(key in env, false, key);
});

async function fixtureAPI(base, compatible = false) {
  const copy = path.join(base, 'fixture-source'); fs.mkdirSync(copy);
  fs.copyFileSync(target, path.join(copy, 'profile.mjs'));
  fs.writeFileSync(path.join(copy, 'runtime.mjs'), `export * from ${JSON.stringify(new URL('./runtime.mjs', import.meta.url).href)};\n`);
  const executable = path.join(base, process.platform === 'win32' ? 'synthetic-client.exe' : 'synthetic-client');
  fs.writeFileSync(executable, 'inert-test-fixture-never-executed', { mode: 0o700 });
  const pin = JSON.parse(fs.readFileSync(new URL('./tunnel-pins.json', import.meta.url), 'utf8'));
  pin.platforms[process.platform + '-' + process.arch] = { ...pin.platforms['win32-x64'],
    executableSha256: compatible ? '0'.repeat(64) : crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    compatibleExecutableSha256: compatible ? [crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex')] : [] };
  fs.writeFileSync(path.join(copy, 'tunnel-pins.json'), JSON.stringify(pin));
  return { isolated: await import(pathToFileURL(path.join(copy, 'profile.mjs')).href), executable };
}

check('existing explicitly pinned compatible client remains verifiable without rewriting configuration', async t => {
  const { base } = scratch(t), { isolated, executable } = await fixtureAPI(base, true);
  assert.deepEqual(isolated.verifyTunnelExecutable(executable), { file: executable, release: 'v0.0.19' });
  fs.appendFileSync(executable, 'modified');
  assert.throws(() => isolated.verifyTunnelExecutable(executable), /^Error: tunnel_pin_mismatch$/);
});

check('configure/inspect roundtrip uses file metadata but never reads runtime-key contents', async t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key');
  fs.writeFileSync(key, 'SYNTHETIC_VALUE_NOT_FOR_EXPORT', { mode: 0o600 });
  const { isolated, executable } = await fixtureAPI(base);
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if (path.resolve(String(file)) === key) throw new Error('key_content_read');
    return Reflect.apply(read, this, [file, ...args]);
  };
  try {
    assert.deepEqual(isolated.inspectTunnelProfile(root), { configured: false, activation: 'not-observed', authenticationVerified: false });
    const result = isolated.writeTunnelProfile(root, { tunnelId, runtimeKeyFile: key, tunnelExecutable: executable });
    assert.equal(result.configured, true); assert.equal(result.activated, false);
    assert.deepEqual(isolated.inspectTunnelProfile(root), { configured: true, activation: 'not-observed', authenticationVerified: false });
    const launch = isolated.buildTunnelLaunch(root, {});
    assert.equal(launch.command, executable);
    assert.deepEqual(launch.args, ['run', '--profile-file', path.join(root, 'tunnel.yaml')]);
    assert.equal(launch.windowsHide, true);
    assert.ok(!read(path.join(root, 'tunnel.yaml'), 'utf8').includes('SYNTHETIC_VALUE_NOT_FOR_EXPORT'));
  } finally { fs.readFileSync = read; }
});

check('existing/partial/changed bindings never overwrite, repair or silently activate', async t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key');
  fs.writeFileSync(key, 'synthetic', { mode: 0o600 });
  const { isolated, executable } = await fixtureAPI(base);
  const options = { tunnelId, runtimeKeyFile: key, tunnelExecutable: executable };
  isolated.writeTunnelProfile(root, options);
  const before = fs.readFileSync(path.join(root, 'tunnel.yaml'));
  assert.throws(() => isolated.writeTunnelProfile(root, options), /binding_exists/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'tunnel.yaml')), before);
  fs.appendFileSync(path.join(root, 'tunnel.yaml'), '\n');
  assert.throws(() => isolated.inspectTunnelProfile(root), /binding_changed/);
  fs.rmSync(path.join(root, 'binding.json'));
  assert.throws(() => isolated.inspectTunnelProfile(root), /binding_incomplete/);
});

check('wrong executable rejects before writing a profile', t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key'), executable = path.join(base, 'fake-client');
  fs.writeFileSync(executable, 'not-the-reviewed-binary');
  fs.writeFileSync(key, 'synthetic', { mode: 0o600 });
  assert.throws(() => api.writeTunnelProfile(root, { tunnelId, runtimeKeyFile: key, tunnelExecutable: executable }));
  assert.ok(!fs.existsSync(path.join(root, 'tunnel.yaml')));
});
check('missing, empty, directory and redirected key references reject without profile writes', async t => {
  const { base, root } = scratch(t), keys = path.join(base, 'keys'); fs.mkdirSync(keys);
  const key = path.join(keys, 'runtime.key'); fs.writeFileSync(key, 'synthetic', { mode: 0o600 });
  const empty = path.join(keys, 'empty.key'); fs.writeFileSync(empty, '', { mode: 0o600 });
  const link = path.join(base, 'redirect'); fs.symlinkSync(keys, link, process.platform === 'win32' ? 'junction' : 'dir');
  const { isolated, executable } = await fixtureAPI(base);
  for (const reference of [path.join(keys, 'missing.key'), empty, keys, path.join(link, 'runtime.key')]) {
    assert.throws(() => isolated.writeTunnelProfile(root, { tunnelId, runtimeKeyFile: reference, tunnelExecutable: executable }));
    assert.ok(!fs.existsSync(path.join(root, 'tunnel.yaml')));
    assert.ok(!fs.existsSync(path.join(root, 'binding.json')));
  }
});
check('inspection rejects changed executable bytes and preserves external pause metadata', async t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key');
  fs.writeFileSync(key, 'synthetic', { mode: 0o600 });
  const { isolated, executable } = await fixtureAPI(base);
  isolated.writeTunnelProfile(root, { tunnelId, runtimeKeyFile: key, tunnelExecutable: executable });
  const paused = path.join(root, 'manual-pause'); fs.writeFileSync(paused, 'paused');
  isolated.inspectTunnelProfile(root);
  assert.equal(fs.readFileSync(paused, 'utf8'), 'paused');
  fs.appendFileSync(executable, 'changed');
  assert.throws(() => isolated.inspectTunnelProfile(root), /tunnel_pin_mismatch/);
  assert.equal(fs.readFileSync(paused, 'utf8'), 'paused');
});
check('dangling receipt destinations reject inspect and configure before either record is created', async t => {
  const { base, root } = scratch(t), key = path.join(base, 'runtime.key');
  fs.writeFileSync(key, 'synthetic', { mode: 0o600 });
  const { isolated, executable } = await fixtureAPI(base);
  const target = path.join(base, 'missing-target');
  if (process.platform === 'win32') {
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(root, 'binding.json'), 'junction');
    fs.rmdirSync(target);
  } else fs.symlinkSync(target, path.join(root, 'binding.json'));
  assert.throws(() => isolated.inspectTunnelProfile(root), /binding_incomplete|binding_changed/);
  assert.throws(() => isolated.writeTunnelProfile(root, { tunnelId, runtimeKeyFile: key, tunnelExecutable: executable }), /binding_exists/);
  assert.ok(!fs.existsSync(path.join(root, 'tunnel.yaml')));
  assert.equal(fs.lstatSync(path.join(root, 'binding.json')).isSymbolicLink(), true);
});
check('a key reference overlapping the client file is rejected before content validation', async t => {
  const { base, root } = scratch(t);
  const { isolated, executable } = await fixtureAPI(base);
  if (process.platform !== 'win32') fs.chmodSync(executable, 0o600);
  const read = fs.readFileSync;
  let keyReads = 0;
  fs.readFileSync = function (file, ...args) {
    if (path.resolve(String(file)).toLowerCase() === executable.toLowerCase()) { keyReads++; throw new Error('key_content_read'); }
    return Reflect.apply(read, this, [file, ...args]);
  };
  try {
    for (const candidate of [executable, ...(process.platform === 'win32' ? [executable.toUpperCase()] : [])]) {
      assert.throws(() => isolated.writeTunnelProfile(root, { tunnelId, runtimeKeyFile: executable, tunnelExecutable: candidate }), /overlapping_profile_inputs/);
    }
    assert.equal(keyReads, 0);
  } finally { fs.readFileSync = read; }
});
check('key references cannot name state or provider-source files', t => {
  const { root } = scratch(t);
  for (const key of [path.join(root, 'consent.json'), path.join(here, 'upstream-pin.json')]) {
    assert.throws(() => api.createProfileDocument(root, { tunnelId, runtimeKeyFile: key }), /overlapping_profile_inputs/);
  }
});
