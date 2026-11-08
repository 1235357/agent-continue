// Test preload for the extracted guided installer, not a network sandbox.
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

const absolute = value => typeof value === 'string' && path.isAbsolute(value) &&
  !/^[\\/]{2}|[\x00-\x1f]/.test(value) && (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value));
const samePath = (a, b) => absolute(a) && absolute(b) && path.relative(a, b) === '';
function below(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function requireFixture(condition, code) {
  if (!condition) throw new Error('guided_fixture_' + code);
}

const root = process.env.AC_GUIDED_ROOT;
const install = process.env.AC_GUIDED_INSTALL;
const entry = process.argv[1];
const app = absolute(install) ? path.join(install, 'app') : undefined;
const owner = app && path.join(app, 'device-owner.mjs');
const isBin = absolute(root) && absolute(entry) && path.basename(entry) === 'bin.mjs' && below(root, entry);
const isOwner = samePath(entry, owner);
if (isMainThread && (isBin || isOwner)) installHooks();

function installHooks() {
  const archive = process.env.AC_GUIDED_ARCHIVE;
  const cache = process.env.AC_GUIDED_NPM_CACHE;
  const origin = process.env.AC_GUIDED_ORIGIN;
  const port = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(origin ?? '')?.[1];
  requireFixture(absolute(root) && /^agentcontinue-tunnel-.+/.test(path.basename(root)) &&
    samePath(root, fs.realpathSync(root)) && absolute(install) && below(root, install) &&
    samePath(path.dirname(install), fs.realpathSync(path.dirname(install))) &&
    samePath(entry, fs.realpathSync(entry)), 'invalid_scope');
  requireFixture(absolute(archive) && absolute(cache) && port && Number(port) <= 65535, 'invalid_inputs');

  if (isBin) {
    const argv = process.argv.slice(3);
    const target = argv.indexOf('--install-dir');
    requireFixture(target === -1 || samePath(argv[target + 1], install), 'unexpected_install');
  }

  const pins = JSON.parse(fs.readFileSync(new URL('../tunnel-pins.json', import.meta.url), 'utf8'));
  const pin = pins.platforms[process.platform + '-' + process.arch];
  requireFixture(pins.release === 'v0.0.19' && pin, 'unsupported_pin');
  const releaseURL = 'https://github.com/openai/tunnel-client/releases/download/' + pins.release + '/' + pin.asset;
  const client = path.join(install, 'client', 'tunnel-client-runtime' + (process.platform === 'win32' ? '.exe' : ''));
  const state = path.join(install, 'state');
  if (isBin && process.env.AC_GUIDED_CAPTURE_WAKE_REGISTRATION === '1') {
    const key = 'Software\\Google\\Chrome\\NativeMessagingHosts\\com.agentcontinue.device_wake';
    const record = path.join(root, 'guided-wake-registry.json');
    const manifest = path.join(app, 'browser-wake', 'host.json');
    const encodedFlags = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'];
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const reply = result => ({ status: 0, stdout: JSON.stringify(result) + '\n' });
    childProcess.spawnSync = (command, args) => {
      requireFixture(samePath(command, powershell) && Array.isArray(args) && args.length === 5 &&
        encodedFlags.every((flag, i) => args[i] === flag) && typeof args[4] === 'string' &&
        args[4].length <= 16000, 'registry_capture_denied');
      const script = Buffer.from(args[4], 'base64').toString('utf16le');
      const write = "@{written=[AgentContinueCreateKey]::Write('" + key + "','" + manifest.replaceAll("'", "''") + "',32)}";
      if (script.includes(write)) {
        requireFixture(fs.lstatSync(manifest).isFile(), 'registry_capture_missing_manifest');
        try { fs.writeFileSync(record, JSON.stringify({ view: '32', value: manifest }), { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code === 'EEXIST') return reply({ written: false }); throw error; }
        return reply({ written: true });
      }
      const read = /OpenBaseKey\(\[Microsoft\.Win32\.RegistryHive\]::(CurrentUser|LocalMachine),\[Microsoft\.Win32\.RegistryView\]::Registry(32|64)\)/.exec(script);
      requireFixture(read && script.includes("OpenSubKey('" + key + "',$false)"), 'registry_capture_denied');
      return reply(read[1] === 'CurrentUser' && read[2] === '32' && fs.existsSync(record)
        ? { value: manifest } : { missing: true });
    };
  }
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = input instanceof URL ? input.href : input;
    requireFixture(!options?.method || options.method === 'GET', 'fetch_denied');
    if (isBin && url === releaseURL) {
      const info = fs.lstatSync(archive);
      requireFixture(info.isFile() && info.size > 0 && info.size <= 64 * 1024 * 1024, 'invalid_archive');
      // The actual acquisition code still hashes and extracts these bytes.
      return new Response(await fs.promises.readFile(archive, { signal: options?.signal }));
    }
    if (isOwner && typeof url === 'string' && /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/readyz$/.test(url)) {
      return nativeFetch(url, { signal: options?.signal, redirect: 'error', credentials: 'omit' });
    }
    throw new Error('guided_fixture_fetch_denied');
  };

  const spawn = childProcess.spawn;
  const ledger = path.join(root, 'guided-processes.jsonl');
  function spawnTracked(kind, command, args, options) {
    const fd = fs.openSync(ledger, 'a', 0o600);
    try {
      const child = spawn(command, args, options);
      if (child.pid) fs.writeSync(fd, JSON.stringify({ kind, pid: child.pid }) + '\n');
      return child;
    } finally { fs.closeSync(fd); }
  }

  childProcess.spawn = function (command, args, options) {
    requireFixture(Array.isArray(args) && options?.shell === false && options.windowsHide === true, 'spawn_denied');
    if (isBin && command === process.execPath && samePath(options.cwd, app)) {
      if (args.length === 1 && samePath(args[0], owner) && options.detached === true && options.stdio === 'ignore') {
        // managerEnvironment intentionally strips NODE_OPTIONS from the detached launch.
        return spawnTracked('owner', command, ['--import', import.meta.url, ...args], options);
      }
      const [npm, action, ...flags] = args;
      const expectedNpm = process.env.AC_GUIDED_EXPECTED_NPM;
      requireFixture(!expectedNpm || (below(root, expectedNpm) && samePath(npm, expectedNpm)), 'unexpected_npm_path');
      const acquisition = path.join(path.dirname(options.cwd), 'acquisition');
      const expected = ['--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/',
        '--prefix', options.cwd, '--workspaces=false', '--logs-dir', path.join(acquisition, 'logs'), '--logs-max=2',
        '--update-notifier=false', '--userconfig', path.join(acquisition, 'user.npmrc'),
        '--globalconfig', path.join(acquisition, 'global.npmrc'), '--cache'];
      requireFixture(absolute(npm) && path.basename(npm) === 'npm-cli.js' && path.basename(path.dirname(npm)) === 'bin' &&
        action === 'ci' && !options.detached && options.env && expected.every((arg, i) => flags[i] === arg) &&
        absolute(flags[expected.length]) && (flags.length === expected.length + 1 ||
          flags.length === expected.length + 2 && flags.at(-1) === '--offline'), 'unexpected_npm_launch');
      const env = Object.fromEntries(Object.entries(options.env).filter(([key]) => !/^(NODE_OPTIONS$|NPM_CONFIG_)/i.test(key)));
      return spawn(command, [npm, action, ...expected, cache, '--offline'], { ...options, env });
    }
    if (isOwner && samePath(command, client) && samePath(options.cwd, path.join(state, 'work'))) {
      requireFixture(args.length === 5 && args[0] === 'run' && args[1] === '--profile-file' &&
        samePath(args[2], path.join(state, 'tunnel.yaml')) && args[3] === '--health.url-file' && absolute(args[4]) &&
        samePath(path.dirname(args[4]), state) && /^health\.[a-f0-9-]{36}\.url$/.test(path.basename(args[4])), 'unexpected_client_launch');
      const info = fs.lstatSync(command);
      requireFixture(info.isFile() && info.size > 0 && info.size <= 128 * 1024 * 1024 &&
        samePath(command, fs.realpathSync(command)) &&
        createHash('sha256').update(fs.readFileSync(command)).digest('hex') === pin.executableSha256, 'client_pin_mismatch');
      return spawnTracked('tunnel', command, [...args, '--control-plane.base-url', origin], options);
    }
    throw new Error('guided_fixture_spawn_denied');
  };
  // Leave execFile unchanged so Windows process observation still queries real PIDs.
  syncBuiltinESMExports();

  if (isOwner) {
    const marker = path.join(root, 'guided-stop');
    const deadline = performance.now() + 330_000;
    const stop = setInterval(() => {
      if (process.listenerCount('SIGTERM') && (fs.existsSync(marker) || performance.now() >= deadline)) {
        clearInterval(stop);
        process.emit('SIGTERM');
      }
    }, 100).unref();
    process.once('exit', () => fs.writeFileSync(path.join(root, 'guided-owner-exit-' + process.pid), '', { mode: 0o600 }));
  }
}
