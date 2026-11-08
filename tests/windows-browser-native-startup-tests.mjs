import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { prepareState } from '../native/desktop-commander/runtime.mjs';
import { publishBrowserWake } from '../native/bootstrap/browser-wake-registration.mjs';
import { readNativeBinding, sendDeviceRequest } from '../native/desktop-commander/device-owner.mjs';
import { hostedReadGate, prepareHostedAppendProbe, prepareHostedShellProbe, summarizeHostedReadEvidence, verifyHostedReadHistory } from '../scripts/hosted-read-acceptance.mjs';
import { catalogAuditFile, hostedCanaryGate, instrumentCatalogHost, summarizeCatalogAudit } from './hosted-catalog-fixture.mjs';

const ownerModule = new URL('../native/desktop-commander/device-owner.mjs', import.meta.url).href;
const lifecycleModule = new URL('../native/desktop-commander/lifecycle.mjs', import.meta.url).href;
const hostModule = new URL('../native/desktop-commander/device-native-host.mjs', import.meta.url).href;
const project = new URL('../', import.meta.url);
const encode = value => JSON.stringify(value) + '\n';
const exec = promisify(execFile);
const hostedRequested = process.env.AC_HOSTED_BROWSER_ACCEPTANCE === 'accept-dedicated-test-tunnel';
const requestedWebWindow = process.env.AC_HOSTED_WEB_WINDOW_SECONDS;
assert.ok(requestedWebWindow === undefined || hostedRequested && /^(?:[1-9]|[1-9][0-9]|1[0-7][0-9]|180)$/.test(requestedWebWindow),
  'the hosted web window requires the dedicated tunnel opt-in and lasts at most 180 seconds');
const webWindowMs = Number(requestedWebWindow ?? 0) * 1000;
const webProbeDirectory = process.env.AC_HOSTED_WEB_PROBES;
assert.ok(webProbeDirectory === undefined || webWindowMs > 0, 'web probes require a hosted web window');
const readGate = process.env.AC_HOSTED_READ_GATE;
assert.ok(readGate === undefined || webProbeDirectory && ['single', 'transport'].includes(readGate),
  'an explicit read gate requires prepared probes and must be single or transport');
const webComparison = process.env.AC_HOSTED_WEB_COMPARISON === 'true';
assert.ok(!webComparison || webProbeDirectory, 'web comparison requires a prepared probe directory');
const webSelection = process.env.AC_HOSTED_WEB_SURFACES;
assert.ok(webSelection === undefined || webProbeDirectory && ['chatgpt', 'dot', 'both'].includes(webSelection),
  'an explicit surface requires a prepared probe directory and must be chatgpt, dot or both');
assert.ok(!webComparison || webSelection !== 'dot', 'comparison requires the ordinary ChatGPT surface');
const injectHostedExit = process.env.AC_HOSTED_INJECT_TUNNEL_EXIT === 'true';
assert.ok(!injectHostedExit || hostedRequested,
  'exit injection requires a dedicated hosted tunnel');
const webAppendMode = process.env.AC_HOSTED_WEB_APPEND;
assert.ok(webAppendMode === undefined || webAppendMode === 'accept-one-disposable-append' && webWindowMs && !webProbeDirectory,
  'append requires an explicit dedicated hosted web window without unrelated probes');
const webShellMode = process.env.AC_HOSTED_WEB_SHELL;
const exactWebShell = webShellMode === 'accept-one-exact-token-attested-process';
assert.ok(webShellMode === undefined ||
  (webShellMode === 'accept-one-output-only-process' || exactWebShell) && webWindowMs && !webProbeDirectory && !webAppendMode,
  'shell requires an explicit dedicated hosted web window without unrelated probes');
const catalogAudit = process.env.AC_HOSTED_CATALOG_AUDIT;
const catalogCanary = catalogAudit === 'accept-fixed-output-catalog-canary';
const canaryExpectation = process.env.AC_HOSTED_CATALOG_EXPECT;
assert.ok(canaryExpectation === undefined || catalogCanary && ['discovery', 'invocation'].includes(canaryExpectation),
  'a catalog gate requires the dedicated fixed-output canary');
assert.ok(catalogAudit === undefined || (catalogAudit === 'accept-catalog-metadata' || catalogCanary) && webWindowMs &&
  !webProbeDirectory && !webAppendMode && !webShellMode && !injectHostedExit,
  'catalog metadata requires its own dedicated hosted web window');

async function stageHostedFixture(scratch, extensionId) {
  const { AC_HOSTED_SETUP, AC_HOSTED_KEY_FILE, AC_HOSTED_TUNNEL_ID, AC_HOSTED_TUNNEL_ARCHIVE,
    AC_HOSTED_NPM_CACHE } = process.env;
  assert.ok(AC_HOSTED_SETUP && AC_HOSTED_KEY_FILE && AC_HOSTED_TUNNEL_ID && AC_HOSTED_TUNNEL_ARCHIVE && AC_HOSTED_NPM_CACHE,
    'dedicated hosted acceptance inputs are required');
  const request = path.join(scratch, 'setup-request.json');
  await fs.writeFile(request, JSON.stringify({ format: 'agent-continue-device-setup', version: 1, target: 'windows',
    extensionId, nativeHost: 'com.agentcontinue.device_control' }, null, 2) + '\n', { flag: 'wx' });
  let stdout;
  try {
    ({ stdout } = await exec(process.execPath, [path.join(AC_HOSTED_SETUP, 'bin.mjs'), 'setup',
      '--install-dir', path.join(scratch, 'device'), '--consent', 'full-account', '--setup-request', request,
      '--tunnel-id', AC_HOSTED_TUNNEL_ID, '--runtime-key-file', AC_HOSTED_KEY_FILE,
      '--tunnel-archive', AC_HOSTED_TUNNEL_ARCHIVE, '--offline-cache', AC_HOSTED_NPM_CACHE],
    { windowsHide: true, timeout: 180000, maxBuffer: 16384 }));
  } catch (error) {
    let code;
    try { code = JSON.parse(error.stdout).error; } catch { /* Do not expose child output. */ }
    throw new Error(typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : 'fixture_setup_unconfirmed');
  }
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.status, 'configured');
  assert.equal(receipt.activated, false);
  assert.equal(receipt.nativeRegistrationVerified, false);
  assert.equal(receipt.extensionId, extensionId);
}

async function within(operation, ms, message) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(operation, message, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs;
  do {
    const value = await within(operation, Math.max(1, deadline - performance.now()), message);
    if (value) return value;
    await delay(100);
  } while (performance.now() < deadline);
  assert.fail(message);
}

function fixtureExited(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

async function hostedReadyFiles(state) {
  const ready = [];
  for (const name of await fs.readdir(state)) {
    if (!/^health\.[a-f0-9-]{36}\.url$/.test(name)) continue;
    const file = path.join(state, name), info = await fs.lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 2048);
    const url = (await fs.readFile(file, 'utf8')).trim();
    const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(url);
    assert.ok(match && Number(match[1]) <= 65535);
    const response = await fetch(url.replace(/\/$/, '') + '/readyz',
      { redirect: 'error', signal: AbortSignal.timeout(500) }).catch(() => null);
    if (response?.status === 200) ready.push(name);
    await response?.body?.cancel();
  }
  return ready;
}

async function hostedFixtureClientIdentity(install, stop = false) {
  const image = path.join(install, 'client', 'tunnel-client-runtime.exe');
  assert.equal(await fs.realpath(image), image);
  // Hold the verified Windows process handle across the identity check and optional kill.
  const script = `$ErrorActionPreference='Stop'
$image = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(image).toString('base64')}'))
[Console]::WriteLine('process')
$candidates = @(Get-Process -Name 'tunnel-client-runtime' | Where-Object { [string]::Equals($_.Path, $image, [StringComparison]::OrdinalIgnoreCase) })
if ($candidates.Count -ne 1) { throw 'fixture_process_not_unique' }
$child = $candidates[0]
try {
  $null = $child.Handle
  if ($child.HasExited -or -not [string]::Equals($child.Path, $image, [StringComparison]::OrdinalIgnoreCase)) { throw 'fixture_process_mismatch' }
  $identity = [string]$child.Id + ':' + [string]$child.StartTime.ToUniversalTime().Ticks
  if ($${stop}) {
    [Console]::WriteLine('exit')
    $child.Kill()
    if (-not $child.WaitForExit(5000)) { throw 'fixture_process_exit_unconfirmed' }
  }
  [Console]::WriteLine($identity)
} finally { $child.Dispose() }`;
  let stdout;
  try {
    ({ stdout } = await exec(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 20000 }));
  } catch (error) {
    const stage = String(error.stdout ?? '').trim().split(/\r?\n/).at(-1);
    const label = ['process', 'exit'].includes(stage) ? stage : 'launch';
    assert.fail('could not verify fixture tunnel client at stage: ' + label);
  }
  const identity = stdout.trim().split(/\r?\n/).at(-1);
  assert.ok(/^[1-9]\d*:[1-9]\d+$/.test(identity), 'invalid fixture process identity');
  return identity;
}

async function openHostedWebWindow(scratch, status, appendProbe, shellProbe, catalogFile) {
  const openedAt = Date.now();
  const stopFile = path.join(scratch, 'finish-web-window');
  const canaryProofFile = path.join(scratch, 'canary-browser-marker.sha256');
  const shellProofFile = exactWebShell ? path.join(scratch, 'shell-browser-marker.sha256') : null;
  const canaryDigest = catalogCanary ? createHash('sha256').update((await fs.readFile(
    path.join(path.dirname(catalogFile), 'acceptance-catalog.marker'), 'utf8')).trimEnd()).digest('hex') : null;
  const deadline = performance.now() + webWindowMs;
  console.log(JSON.stringify({ phase: injectHostedExit ? 'browser-recovered-ready' : 'browser-reopened-ready',
    finishFile: stopFile, windowSeconds: webWindowMs / 1000,
    ...(appendProbe ? { appendRequest: appendProbe.request } : {}),
    ...(shellProbe ? { shellTool: shellProbe.tool, shellRequest: shellProbe.request } : {}),
    ...(shellProofFile ? { shellProofFile } : {}),
    ...(catalogFile ? { catalogFile, catalogBaseline: await catalogCounts(catalogFile) } : {}),
    ...(catalogCanary ? { canaryTool: 'agent_continue_catalog_canary',
      canaryMarkerSha256: canaryDigest,
      ...(canaryExpectation === 'invocation' ? { canaryProofFile } : {}) } : {}) }));
  while (performance.now() < deadline) {
    const ended = await fs.lstat(stopFile).then(info => info.isFile() && !info.isSymbolicLink() && info.size === 0,
      error => { if (error.code === 'ENOENT') return false; throw error; });
    if (ended) break;
    await delay(Math.min(250, Math.max(0, deadline - performance.now())));
  }
  // The pinned provider batches history once a second. Do not stop its
  // process immediately after the browser returns a completed tool result.
  if (appendProbe || shellProbe || webProbeDirectory) await delay(1200);
  const closedAt = Date.now();
  assert.equal((await waitFor(() => status('ready'), 'the reopened hosted tunnel was not ready after the web window')).paused, false);
  return { openedAt, closedAt, canaryDigest, canaryProofFile, shellProofFile };
}

async function browserResultDigest(file) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 66) return null;
    const digest = (await fs.readFile(file, 'utf8')).trim();
    return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function catalogCounts(file) {
  try {
    const info = await fs.lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 4096);
    return summarizeCatalogAudit(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return summarizeCatalogAudit('');
  }
}

const scenarios = hostedRequested ? ['dedicated hosted tunnel'] : ['pause', 'running intent', 'unfinished pause receipt'];
for (const mode of scenarios) {
const hosted = mode === 'dedicated hosted tunnel';
const paused = mode === 'pause', interrupted = mode === 'unfinished pause receipt';
const productWorker = mode === 'running intent';
const workerName = productWorker ? 'background.js' : 'worker.js';
const expectedConnection = paused || interrupted ? 'disconnected' : 'ready';
test('Windows Chromium startup respects ' + mode,
  { skip: process.platform !== 'win32', timeout: hosted ? 285000 + webWindowMs : productWorker ? 90000 : 60000 }, async () => {
    const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ac-browser-native-start-'));
    const extension = path.join(scratch, 'extension');
    const browserProfile = path.join(scratch, 'browser');
    const install = hosted ? path.join(scratch, 'device') : scratch;
    const state = path.join(install, 'state');
    const app = path.join(install, 'app');
    const hostManifest = path.join(scratch, 'host.json');
    const bindingFile = hosted ? path.join(app, 'device-native-binding.json') : path.join(scratch, 'binding.json');
    const report = path.join(scratch, 'startup.json');
    const entry = path.join(app, 'device-native-host.mjs');
    const host = 'com.agentcontinue.fixture_' + randomBytes(12).toString('hex');
    const regKey = 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\' + host;
    const reg = (...args) => spawnSync(path.join(process.env.SystemRoot, 'System32', 'reg.exe'), args,
      { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = publicKey.export({ type: 'spki', format: 'der' });
    const id = createHash('sha256').update(key).digest('hex').slice(0, 32)
      .replace(/[a-f0-9]/g, ch => 'abcdefghijklmnop'[Number.parseInt(ch, 16)]);
    const origin = 'chrome-extension://' + id + '/';
    const channel = path.join(state, 'device-channel.json');
    const fences = [channel, ...['controller.lease', 'device-operations.lease'].map(name => path.join(state, name))];
    const released = () => Promise.all(fences.map(file => fs.access(file).then(() => false, error => {
      if (error.code === 'ENOENT') return true;
      throw error;
    }))).then(values => values.every(Boolean));
    let context, registered = false;
    const open = () => chromium.launchPersistentContext(browserProfile, {
      channel: 'chromium', headless: true,
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AC_HOSTED_'))),
      args: ['--disable-background-networking', '--no-first-run',
        `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });

    try {
      await fs.mkdir(extension);
      if (hosted) {
        await stageHostedFixture(scratch, id);
        if (catalogAudit) {
          const host = path.join(app, 'host.mjs');
          if (catalogCanary) {
            const fixture = new URL('../native/desktop-commander/test-fixtures/hosted-catalog-canary.mjs', import.meta.url);
            await fs.writeFile(path.join(state, 'acceptance-catalog.marker'),
              'AC_CANARY_' + randomBytes(16).toString('hex') + '\n', { flag: 'wx' });
            await fs.copyFile(fixture, host);
          } else await fs.writeFile(host, instrumentCatalogHost(await fs.readFile(host, 'utf8')));
        }
      }
      else {
        await fs.mkdir(app);
        prepareState(state, { consent: 'full-account' });
      }
      const savedIntent = encode({ format: 'agent-continue-lifecycle', version: 1, paused });
      const intentFile = path.join(state, 'lifecycle.json');
      if (!hosted) await fs.writeFile(intentFile, savedIntent, { flag: 'wx' });
      const journalFile = path.join(state, 'device-operations.jsonl');
      const journal = encode({ format: 'agent-continue-device-operations', version: 1 }) +
        encode({ id: 'interrupted-pause', action: 'disconnect-and-pause', status: 'in-progress' });
      if (interrupted) await fs.writeFile(journalFile, journal, { flag: 'wx' });
      if (!hosted) await fs.writeFile(bindingFile, encode({
        format: 'agent-continue-native-binding', version: 1, extensionId: id, stateRoot: state,
      }), { flag: 'wx' });
      let staged;
      const registry = {
        inspect(plan) { return plan.keyPath.startsWith('HKCU') && staged ?
          { present: true, value: staged } : { present: false }; },
        createOnly(plan) { staged = plan.regSzValue; return true; },
      };
      assert.equal(publishBrowserWake({ app, node: process.execPath, registry,
        binding: { extensionId: id, assertCurrent() {} } }).status, 'written');
      const stagedManifest = JSON.parse(await fs.readFile(staged, 'utf8'));
      // Use the actual installer CMD, remapping only the host ID and registry path for isolation.
      await fs.writeFile(hostManifest, encode({ ...stagedManifest, name: host }), { flag: 'wx' });
      if (!hosted) await fs.writeFile(entry, `
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readNativeBinding, sendDeviceRequest, startDeviceOwner } from ${JSON.stringify(ownerModule)};
import { openController } from ${JSON.stringify(lifecycleModule)};
import { serveBrowserWake } from ${JSON.stringify(hostModule)};
const bindingFile = ${JSON.stringify(bindingFile)};
const binding = readNativeBinding(bindingFile);
assert.deepEqual(process.argv.slice(2), ['--browser-wake', binding.origin]);
let launches = 0, child;
// Only the tunnel child and its health are synthetic; Chromium, CMD, the
// controller, ownership lease and named-pipe request path are real.
await serveBrowserWake({input:process.stdin, output:process.stdout, origin:binding.origin, binding, args:process.argv.slice(3),
async startOwner(signal, browserOwnerId) {
const controller = openController(binding.root, {
  deferStartup: true,
  launch: () => ({ configured:true, command:'fixture', args:[] }),
  spawn(_command, args) {
    launches++;
    child = Object.assign(new EventEmitter(), {pid:12345, exitCode:null, signalCode:null});
    child.kill = () => { child.exitCode=0; child.emit('exit',0); };
    writeFileSync(args.at(-1), 'http://127.0.0.1:32112/');
    return child;
  },
  observeCore: async () => ({pid:12345,startTime:'1',executable:process.execPath}),
  hasExited: async () => child?.exitCode === 0,
  fetch: async () => ({status:200}),
});
const owner = await startDeviceOwner(bindingFile, {controller, signal, browserOwnerId, expectedOrigin:binding.origin});
try {
  const request = {version:1,id:'fixture-status',action:'status'};
  let response;
  for (let i=0;i<25;i++) {
    response = await sendDeviceRequest(binding, request);
    if (response.state?.connection === ${JSON.stringify(expectedConnection)}) break;
    await delay(100);
  }
  await fs.writeFile(${JSON.stringify(report)}, JSON.stringify({pid: process.pid, launches, response}), {flag:'wx'});
  if (${productWorker}) {
    const timer = setInterval(() => {
      if (existsSync(${JSON.stringify(path.join(scratch, 'disconnect-'))} + process.pid)) process.stdin.destroy();
    }, 50);
    timer.unref();
    signal.addEventListener('abort', () => clearInterval(timer), {once:true});
  }
  return owner;
} catch (error) {
  await owner.close();
  throw error;
}
}});
`, { flag: 'wx' });
      await fs.writeFile(path.join(extension, 'manifest.json'), encode({
        manifest_version: 3, name: 'AgentContinue startup fixture', version: '1.0.0',
        key: key.toString('base64'),
        permissions: ['nativeMessaging', 'storage', ...(productWorker ? ['alarms'] : [])],
        background: { service_worker: workerName, type: 'module' },
        ...(productWorker ? { action: {}, commands: { 'toggle-running': { description: 'Toggle task' } } } : {}),
      }));
      for (const name of ['browser-wake.js', 'admin-browser.js', 'admin-control.js', 'devices.html', 'devices.css', 'devices.js', 'device-control.js', 'i18n.js',
        ...(productWorker ? ['background.js', 'config.js', 'adapter.js', 'preset.js', 'i18n-runtime.js',
          'current-account-setup.js', 'setup-handoff.js', 'admin-installation-pause.js', 'setup-controller.js'] : [])]) {
        const source = hosted ? path.join(path.dirname(process.env.AC_HOSTED_SETUP), 'AgentContinue', name) : new URL(name, project);
        await fs.copyFile(source, path.join(extension, name));
      }
      if (productWorker) {
        // Change only the fixture destination; never invoke the installed production host.
        const wake = path.join(extension, 'browser-wake.js');
        const source = await fs.readFile(wake, 'utf8');
        const binding = "export const BROWSER_WAKE_HOST = 'com.agentcontinue.device_wake';";
        assert.equal(source.split(binding).length, 2, 'cannot safely remap the product host');
        await fs.writeFile(wake, source.replace(binding, `export const BROWSER_WAKE_HOST = '${host}';`));
      } else await fs.writeFile(path.join(extension, workerName), `
import { bindBrowserWake, BROWSER_DEVICE_MESSAGE } from './browser-wake.js';
let wake;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== BROWSER_DEVICE_MESSAGE) return;
  Promise.resolve(wake?.handleMessage(message, sender)).then(reply);
  return true;
});
void chrome.storage.local.get('armed').then(({armed}) => {
  if (!armed) return chrome.storage.local.set({disarmedChecked: true});
  wake = bindBrowserWake(chrome, {host: ${JSON.stringify(host)}, onResult: startup => chrome.storage.local.set({startup})});
});
`);

      assert.equal(reg('query', regKey).status, 1, 'fixture registry path must be absent');
      assert.equal(reg('add', regKey, '/ve', '/t', 'REG_SZ', '/d', hostManifest).status, 0);
      registered = true;
      assert.ok(reg('query', regKey, '/ve').stdout.includes(hostManifest), 'fixture registry readback failed');

      if (!productWorker) {
        context = await open();
        const first = context.serviceWorkers().find(worker => worker.url() === origin + workerName) ??
          await context.waitForEvent('serviceworker', { timeout: 12000 });
        assert.equal(first.url(), origin + workerName);
        await waitFor(() => first.evaluate(async () => (await chrome.storage.local.get('disarmedChecked')).disarmedChecked),
          'fixture worker did not acknowledge the initial disarmed state');
        await within(() => first.evaluate(() => chrome.storage.local.set({ armed: true })), 5000,
          'fixture worker did not persist the armed state');
        await context.close();
        context = undefined;
      }
      await assert.rejects(fs.access(report), { code: 'ENOENT' });
      await assert.rejects(fs.access(channel), { code: 'ENOENT' });

      if (hosted) {
        const binding = readNativeBinding(bindingFile);
        const status = async expected => {
          try {
            const result = await sendDeviceRequest(binding, { version: 1, id: 'hosted-' + randomBytes(8).toString('hex'),
              action: 'status' });
            return result.ok === true && result.state.connection === expected ? result.state : false;
          } catch { return false; }
        };
        const control = async (action, expected) => {
          const page = await context.newPage();
          try {
            await page.goto(origin + 'devices.html?mode=browser-managed', { timeout: 10000 });
            await page.locator('[data-action=status]').click({ timeout: 8000 });
            await page.locator(`[data-action=${action}]`).click({ timeout: 8000 });
            await page.locator('#confirmOperation').click({ timeout: 8000 });
            await page.waitForFunction(label => document.getElementById('connection').textContent === label,
              expected === 'ready' ? 'Ready' : 'Disconnected', { timeout: 20000 });
            return await waitFor(() => status(expected), 'hosted tunnel did not reach ' + expected);
          } finally { await page.close(); }
        };
        context = await open();
        assert.equal((await waitFor(() => status('disconnected'), 'browser did not start paused owner')).paused, true);
        assert.equal((await control('reconnect', 'ready')).paused, false);
        const previousChannel = (await fs.stat(channel, { bigint: true })).ino;
        await context.close(); context = undefined;
        await waitFor(released, 'browser did not stop its hosted owner cleanly');

        context = await open();
        assert.equal((await waitFor(() => status('ready'), 'browser alone did not restore official tunnel')).paused, false);
        assert.notEqual((await fs.stat(channel, { bigint: true })).ino, previousChannel);
        if (injectHostedExit) {
          const owner = (await fs.stat(channel, { bigint: true })).ino;
          const oldReadyFiles = await hostedReadyFiles(state);
          assert.equal(oldReadyFiles.length, 1, 'one existing readiness record must be live');
          const started = performance.now();
          const oldIdentity = await hostedFixtureClientIdentity(install, true);
          await waitFor(async () => {
            const files = await hostedReadyFiles(state);
            return files.length === 1 && !oldReadyFiles.includes(files[0]);
          }, 'official tunnel did not publish fresh readiness without user action');
          const elapsedMs = Math.round(performance.now() - started);
          assert.notEqual(await hostedFixtureClientIdentity(install), oldIdentity);
          assert.equal((await waitFor(() => status('ready'), 'replacement was not reported ready')).paused, false);
          assert.equal((await fs.stat(channel, { bigint: true })).ino, owner);
          console.log(JSON.stringify({ phase: 'browser-owned-tunnel-recovered', uniqueReplacement: true, elapsedMs }));
        }
        const appendProbe = webAppendMode ? prepareHostedAppendProbe(state) : null;
        const shellProbe = webShellMode ? prepareHostedShellProbe(state, {
          exact: exactWebShell, expectedWindowsToken: exactWebShell ? 'standard' : undefined,
        }) : null;
        const catalogFile = catalogAudit ? path.join(state, catalogAuditFile) : null;
        const webWindow = webWindowMs ? await openHostedWebWindow(scratch, status, appendProbe, shellProbe, catalogFile) : null;
        assert.equal((await control('disconnect-and-pause', 'disconnected')).paused, true);
        let canaryVerified;
        if (catalogFile) {
          const evidence = await catalogCounts(catalogFile);
          const observedDigest = canaryExpectation === 'invocation' ? await browserResultDigest(webWindow.canaryProofFile) : null;
          if (canaryExpectation) canaryVerified = hostedCanaryGate(canaryExpectation, evidence, webWindow.canaryDigest, observedDigest);
          console.log(JSON.stringify({ phase: 'web-catalog-audit', evidence,
            ...(canaryExpectation ? { gate: canaryExpectation, verified: canaryVerified } : {}) }));
        }
        if (appendProbe) console.log(JSON.stringify({ phase: 'web-append-receipt', evidence: appendProbe.verify(webWindow) }));
        const shellEvidence = shellProbe?.verify(webWindow, exactWebShell
          ? { browserDigest: await browserResultDigest(webWindow.shellProofFile) } : undefined);
        if (shellEvidence) console.log(JSON.stringify({ phase: 'web-shell-receipt', evidence: shellEvidence }));
        let readEvidenceVerified;
        if (webProbeDirectory) {
          const log = path.join(state, 'home', '.claude-server-commander', 'tool-history.jsonl');
          const probes = webComparison ? ['chatgpt', 'dot', 'chatgpt-control'] : ['chatgpt', 'dot'];
          const receipts = probes.map(surface => verifyHostedReadHistory(webProbeDirectory, surface, log, webWindow));
          const selected = new Set(webSelection === 'chatgpt' ? probes.filter(surface => surface !== 'dot') :
            webSelection === 'dot' ? ['dot'] : probes);
          const evidence = summarizeHostedReadEvidence(receipts, selected);
          readEvidenceVerified = hostedReadGate(evidence, selected, { requireSingle: readGate !== 'transport' });
          console.log(JSON.stringify({ phase: 'web-tool-receipts', gate: readGate ?? 'single',
            verified: readEvidenceVerified, receipts: evidence }));
        }
        await context.close(); context = undefined;
        await waitFor(released, 'browser did not release the paused hosted owner');
        context = await open();
        assert.equal((await waitFor(() => status('disconnected'), 'browser did not preserve explicit pause')).paused, true);
        if (shellEvidence) assert.equal(shellEvidence.verified, true, 'hosted shell invocation did not match its acceptance contract');
        if (webProbeDirectory) assert.equal(readEvidenceVerified, true, 'hosted read evidence did not meet its acceptance gate');
        if (canaryExpectation) assert.equal(canaryVerified, true, 'hosted canary did not meet its discovery or invocation gate');
        return;
      }

      // The second launch does not navigate to an extension page or evaluate a
      // startup function. The browser alone must load and wake the extension.
      context = await open();
      const readStartup = () => fs.readFile(report, 'utf8').then(JSON.parse, error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const opened = await waitFor(readStartup, 'Chrome startup never reached the registered CMD host').catch(async error => {
        const worker = !productWorker && context.serviceWorkers().find(worker => worker.url() === origin + workerName);
        if (!worker) throw error;
        const startup = await within(() => worker.evaluate(() => chrome.storage.local.get('startup')),
          3000, 'fixture worker was unresponsive during startup diagnostics').catch(() => null);
        throw new Error('Chrome startup fixture did not receive a native reply: ' +
          JSON.stringify(startup));
      });
      assert.ok(opened.pid > 0 && opened.pid !== process.pid);
      assert.equal(opened.response.ok, true);
      assert.equal(opened.launches, expectedConnection === 'ready' ? 1 : 0);
      assert.equal(opened.response.state.paused, paused);
      assert.equal(opened.response.state.connection, expectedConnection);
      const second = await waitFor(() => context.serviceWorkers().find(worker => worker.url() === origin + workerName),
        'startup service worker not observed');
      if (!productWorker) {
        const readback = await waitFor(() => second.evaluate(async () => (await chrome.storage.local.get('startup')).startup),
          'Chrome did not receive the framed reply');
        assert.equal(readback, 'acknowledged');
      }
      if (paused) {
        let page = await context.newPage();
        await page.goto(origin + 'devices.html?mode=browser-managed', { timeout: 10000 });
        await page.locator('[data-action=status]').click({ timeout: 8000 });
        await page.waitForFunction(() => document.getElementById('pause').textContent === 'Paused');
        await page.locator('[data-action=reconnect]').click({ timeout: 8000 });
        await page.locator('#confirmOperation').click({ timeout: 8000 });
        await page.waitForFunction(() => document.getElementById('connection').textContent === 'Ready');
        await page.close();
        await second.evaluate(() => chrome.storage.local.remove('startup'));
        await context.close();
        context = undefined;
        await waitFor(() => fs.access(channel).then(() => false, error => {
          if (error.code === 'ENOENT') return true;
          throw error;
        }), 'browser did not release its connected owner');
        await fs.unlink(report);
        context = await open();
        const reopened = await waitFor(() => fs.readFile(report, 'utf8').then(JSON.parse, error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }), 'browser alone did not restore the device connected through Devices');
        assert.equal(reopened.launches, 1);
        assert.notEqual(reopened.pid, opened.pid);
        assert.equal(reopened.response.state.connection, 'ready');
        const restartedWorker = await waitFor(() => context.serviceWorkers().find(worker => worker.url() === origin + 'worker.js'),
          'browser restart worker not observed');
        await waitFor(() => restartedWorker.evaluate(async () => (await chrome.storage.local.get('startup')).startup === 'acknowledged'),
          'browser restart did not acknowledge the new owner');
        page = await context.newPage();
        await page.goto(origin + 'devices.html?mode=browser-managed', { timeout: 10000 });
        await page.locator('[data-action=status]').click({ timeout: 8000 });
        await page.waitForFunction(() => document.getElementById('connection').textContent === 'Ready');
        await page.locator('[data-action=disconnect-and-pause]').click({ timeout: 8000 });
        await page.locator('#confirmOperation').click({ timeout: 8000 });
        await page.waitForFunction(() => document.getElementById('connection').textContent === 'Disconnected' &&
          document.getElementById('pause').textContent === 'Paused').catch(async () => {
            const observed = await page.evaluate(() => Object.fromEntries(['connection', 'pause', 'feedback']
              .map(id => [id, document.getElementById(id)?.textContent?.slice(0, 500) ?? null])));
            assert.fail('Devices did not confirm the fixture Pause: ' + JSON.stringify(observed));
          });
        await page.close();
      }
      await context.close();
      context = undefined;
      await waitFor(() => fs.access(channel).then(() => false, error => {
        if (error.code === 'ENOENT') return true;
        throw error;
      }), 'Chrome shutdown did not release the fixture owner');
      await waitFor(() => fixtureExited(opened.pid), 'Chrome shutdown left the fixture host process running');
      if (productWorker) {
        assert.equal(await released(), true, 'previous browser owner must release all fences');
        await fs.unlink(report);
        context = await open();
        const reopened = await waitFor(readStartup, 'browser reopen did not start the product background worker and device');
        assert.notEqual(reopened.pid, opened.pid);
        assert.equal(reopened.launches, 1);
        assert.equal(reopened.response.ok, true);
        assert.equal(reopened.response.state.connection, 'ready');
        assert.equal(reopened.response.state.paused, false);
        await fs.unlink(report);
        const faultAt = performance.now();
        // Ask only the fixture PID to drop its native pipe and close cleanly.
        await fs.writeFile(path.join(scratch, 'disconnect-' + reopened.pid), '', { flag: 'wx' });
        await waitFor(released, 'the interrupted fixture did not release its ownership');
        await waitFor(() => fixtureExited(reopened.pid), 'the interrupted fixture process did not exit');
        const recovered = await waitFor(readStartup, 'Chrome did not recover the dropped native port in the same session', 45000);
        assert.ok(recovered.pid !== reopened.pid && recovered.pid !== opened.pid);
        assert.equal(recovered.launches, 1);
        assert.equal(recovered.response.ok, true);
        assert.equal(recovered.response.state.connection, 'ready');
        assert.equal(recovered.response.state.paused, false);
        console.log(JSON.stringify({ phase: 'browser-recovered-native-port', elapsedMs: Math.round(performance.now() - faultAt) }));
        // Check the product message handler only after browser-only recovery.
        const page = await context.newPage();
        await page.goto(origin + 'devices.html?mode=browser-managed', { timeout: 10000 });
        await page.locator('[data-action=status]').click({ timeout: 8000 });
        await page.waitForFunction(() => document.getElementById('connection').textContent === 'Ready', undefined,
          { timeout: 5000 }).catch(async () => assert.fail('Devices did not see the recovered owner: ' +
            await page.locator('#feedback').textContent({ timeout: 1000 })));
        await context.close();
        context = undefined;
        await waitFor(released, 'reopened browser did not release the fixture owner');
      }
      assert.equal(await fs.readFile(intentFile, 'utf8'), savedIntent);
      if (interrupted) assert.equal(await fs.readFile(journalFile, 'utf8'), journal);
    } finally {
      await context?.close();
      if (registered) {
        const current = reg('query', regKey, '/ve');
        assert.ok(current.status === 0 && current.stdout.includes(hostManifest),
          'fixture registration changed; refusing to remove it');
        assert.equal(reg('delete', regKey, '/f').status, 0);
        assert.equal(reg('query', regKey).status, 1);
      }
      if (hosted) await waitFor(released, 'hosted ownership is unconfirmed; preserving the disposable test state');
      assert.equal(await fs.realpath(scratch), scratch);
      await fs.rm(scratch, { recursive: true, maxRetries: 4, retryDelay: 100 });
    }
  });
}

test('Windows Chromium native CMD launch preserves Unicode app and Node paths',
  { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
    const { createWinRegistry } = await import('../native/bootstrap/registry-win.mjs');
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const ps = script => exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from("$ErrorActionPreference='Stop'\n" + script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
    const installedNode = await fs.realpath(process.execPath);
    assert.match(installedNode, /^[A-Za-z]:\\[\x20-\x7e]+\\node\.exe$/i,
      'this regression requires the existing ASCII-path installed Node');
    const signature = await ps(`
$image = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(installedNode).toString('base64')}'))
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1')
$signature = Get-AuthenticodeSignature -LiteralPath $image
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=(OpenJS Foundation|Node.js Foundation)(,|$)') {
  throw 'fixture_requires_official_signed_node'
}
[Console]::WriteLine('official-node')`);
    assert.equal(signature.stdout.trim(), 'official-node');
    const nodeSha256 = createHash('sha256').update(await fs.readFile(installedNode)).digest('hex');

    // Fixed inert host: consume one bounded native frame, not stdin-to-EOF.
    const nativeHost = `
const deadline = setTimeout(() => process.exit(1), 8000);
let input = Buffer.alloc(0), answered = false;
process.stdin.on('data', chunk => {
  if (answered || input.length + chunk.length > 4100) return process.exit(1);
  input = Buffer.concat([input, chunk]);
  if (input.length < 4) return;
  const length = input.readUInt32LE(0);
  if (length < 2 || length > 4096) return process.exit(1);
  if (input.length < length + 4) return;
  if (input.length !== length + 4) return process.exit(1);
  let request;
  try { request = JSON.parse(input.subarray(4).toString('utf8')); }
  catch { return process.exit(1); }
  answered = true;
  process.stdin.pause();
  const body = Buffer.from(JSON.stringify({ echo: request, execPath: process.execPath,
    argv: process.argv, version: process.version, pid: process.pid }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.end(Buffer.concat([header, body]), () => {
    clearTimeout(deadline);
    process.stdin.destroy();
  });
});
process.stdin.on('end', () => { if (!answered) process.exit(1); });
`;

    for (const copied of [false, true]) await t.test(copied ? 'copied official Unicode Node' : 'installed ASCII Node',
      { timeout: 40000 }, async () => {
        const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ac-native-unicode-'));
        const profile = path.join(scratch, 'profile-\u7528\u6237');
        const app = path.join(profile, 'app');
        const extension = path.join(scratch, 'extension');
        const browserCwd = path.join(scratch, 'browser-cwd');
        const browserProfile = path.join(scratch, 'browser');
        const entry = path.join(app, 'device-native-host.mjs');
        const launcher = path.join(app, 'browser-wake', 'wake.cmd');
        const hostManifest = path.join(app, 'browser-wake', 'fixture-host.json');
        const node = copied ? path.join(profile, 'Node', 'node.exe') : installedNode;
        const host = 'com.agentcontinue.unicode_fixture_' + randomBytes(12).toString('hex');
        const subkey = 'Software\\Chromium\\NativeMessagingHosts\\' + host;
        const plan = { keyPath: 'HKCU\\' + subkey, hive: 'HKCU', view: '32', regSzValue: hostManifest };
        const registry = createWinRegistry();
        const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const key = publicKey.export({ type: 'spki', format: 'der' });
        const id = createHash('sha256').update(key).digest('hex').slice(0, 32)
          .replace(/[a-f0-9]/g, ch => 'abcdefghijklmnop'[Number.parseInt(ch, 16)]);
        const origin = 'chrome-extension://' + id + '/';

        // Compare Unicode entirely inside PowerShell; its stdout is ASCII only.
        const checkRegistry = async action => {
          const result = await ps(`
$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(hostManifest).toString('base64')}'))
$name = '${subkey}'
${action === 'absent' ? `
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    $key = $null
    try {
      $key = $base.OpenSubKey($name, $false)
      if ($null -ne $key) { throw 'fixture_registry_must_be_absent' }
    } finally { if ($key) { $key.Dispose() }; $base.Dispose() }
  }
}` : `
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry32)
$key = $null
try {
  $key = $base.OpenSubKey($name, $false)
  if ($null -eq $key) {
    ${action === 'cleanup' ? "[Console]::WriteLine('absent'); exit 0" : "throw 'fixture_registry_missing'"}
  }
  if ($key.SubKeyCount -ne 0 -or $key.ValueCount -ne 1 -or
      $key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or
      -not [string]::Equals($key.GetValue(''), $expected, [StringComparison]::Ordinal)) {
    throw 'fixture_registry_changed_refusing_cleanup'
  }
  ${action === 'cleanup' ? `$key.Dispose(); $key = $null
  $base.DeleteSubKey($name, $true)
  $key = $base.OpenSubKey($name, $false)
  if ($null -ne $key) { throw 'fixture_registry_cleanup_unconfirmed' }` : ''}
} finally { if ($key) { $key.Dispose() }; $base.Dispose() }
`}
[Console]::WriteLine('${action}')`);
          assert.ok([action, ...(action === 'cleanup' ? ['absent'] : [])].includes(result.stdout.trim()),
            'scratch registry operation was not confirmed: ' + action);
        };
        let context, registrationAttempted = false, registrationCreated = false, nativePid;
        try {
          for (const directory of [app, extension, browserCwd]) await fs.mkdir(directory, { recursive: true });
          assert.match(app, /[^\x00-\x7f]/);
          if (copied) {
            await fs.mkdir(path.dirname(node));
            await fs.copyFile(installedNode, node);
            assert.equal(createHash('sha256').update(await fs.readFile(node)).digest('hex'), nodeSha256,
              'the Unicode fixture must run the exact official installed Node binary');
            assert.match(node, /[^\x00-\x7f]/);
          }
          assert.equal(await fs.realpath(app), app);
          assert.equal(await fs.realpath(node), node);
          await fs.writeFile(entry, nativeHost, { flag: 'wx' });
          let staged;
          const stagingRegistry = {
            inspect(view) { return view.hive === 'HKCU' && staged ?
              { present: true, value: staged } : { present: false }; },
            createOnly(view) { staged = view.regSzValue; return true; },
          };
          assert.equal(publishBrowserWake({ app, node, registry: stagingRegistry,
            binding: { extensionId: id, assertCurrent() {} } }).status, 'written');
          const manifest = JSON.parse(await fs.readFile(staged, 'utf8'));
          assert.equal(manifest.path, launcher);
          assert.deepEqual(manifest.allowed_origins, [origin]);
          const cmd = await fs.readFile(launcher);
          assert.equal(cmd.some(byte => byte > 127), false, 'CMD must remain ASCII without a BOM');
          const token = copied ? '%~dp0..\\..\\Node\\node.exe' : installedNode;
          assert.ok(cmd.toString('ascii').endsWith('"' + token +
            '" "%~dp0..\\device-native-host.mjs" --browser-wake "%~1"\r\n'),
          'the actual generated launcher must use the expected Node token and exact origin argument');
          // Remap only the manifest host ID; execute the generated CMD unchanged.
          await fs.writeFile(hostManifest, encode({ ...manifest, name: host }), { flag: 'wx' });
          await fs.writeFile(path.join(extension, 'manifest.json'), encode({
            manifest_version: 3, name: 'Unicode native launch fixture', version: '1.0.0',
            key: key.toString('base64'), permissions: ['nativeMessaging'],
            background: { service_worker: 'worker.js' },
          }), { flag: 'wx' });
          await fs.writeFile(path.join(extension, 'worker.js'),
            'chrome.runtime.onInstalled.addListener(() => {});\n', { flag: 'wx' });
          await checkRegistry('absent');
          registrationAttempted = true;
          assert.equal(registry.createOnly(plan), true, 'scratch registration must be create-only');
          registrationCreated = true;
          await checkRegistry('verify');

          assert.notEqual(browserCwd, path.dirname(launcher));
          const previousCwd = process.cwd();
          try {
            process.chdir(browserCwd);
            context = await chromium.launchPersistentContext(browserProfile, {
              channel: 'chromium', headless: true, chromiumSandbox: true, timeout: 15000,
              env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AC_HOSTED_'))),
              args: ['--disable-background-networking', '--no-first-run',
                `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
            });
          } finally { process.chdir(previousCwd); }
          const worker = context.serviceWorkers().find(item => item.url() === origin + 'worker.js') ??
            await context.waitForEvent('serviceworker', { timeout: 10000 });
          assert.equal(worker.url(), origin + 'worker.js');
          const challenge = { nonce: randomBytes(24).toString('hex'), text: '\u6d4b\u8bd5 native stdio \u00e9' };
          const observed = await within(() => worker.evaluate(async ({ host, challenge }) => {
            try { return { response: await chrome.runtime.sendNativeMessage(host, challenge) }; }
            catch (error) { return { error: String(error.message) }; }
          }, { host, challenge }), 12000, 'Unicode CMD native messaging did not finish one framed request');
          assert.equal(observed.error, undefined, 'Chromium failed to launch the generated Unicode CMD: ' + observed.error);
          const response = observed.response;
          nativePid = response.pid;
          assert.ok(Number.isSafeInteger(nativePid) && nativePid > 0 && nativePid !== process.pid);
          assert.deepEqual(response.echo, challenge, 'binary native stdio must echo the fresh Unicode challenge');
          assert.equal(response.execPath, node);
          assert.equal(response.version, process.version);
          assert.deepEqual(response.argv, [node, entry, '--browser-wake', origin]);
          await waitFor(() => fixtureExited(nativePid), 'single-request native fixture did not exit', 5000);
        } finally {
          try {
            await within(() => context?.close(), 10000, 'scratch Chromium did not close');
          } finally {
            if (registrationCreated) {
              await checkRegistry('cleanup');
              await checkRegistry('absent');
            } else if (registrationAttempted) {
              assert.fail('scratch registration ownership was not confirmed; preserving key and files at ' + scratch);
            }
            if (nativePid) await waitFor(() => fixtureExited(nativePid), 'scratch native fixture survived cleanup', 5000);
            assert.equal(await fs.realpath(scratch), scratch);
            await fs.rm(scratch, { recursive: true, maxRetries: 4, retryDelay: 100 });
          }
        }
      });
  });
