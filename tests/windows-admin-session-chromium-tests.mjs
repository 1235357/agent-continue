import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const project = new URL('../', import.meta.url);
const nativeModule = new URL('native/desktop-commander/windows-admin-browser-host.mjs', project).href;

async function within(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(check, label, ms = 12000) {
  const deadline = performance.now() + ms;
  do {
    const result = await within(Promise.resolve().then(check), Math.max(1, deadline - performance.now()), label);
    if (result) return result;
    await delay(75);
  } while (performance.now() < deadline);
  assert.fail(label);
}

function exited(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

// These functions are serialized into temporary native fixtures, never installed product code.
async function peerRootFixture({ trace, generation, bundle, origin, selectedSid }) {
  const log = (event, extra = {}) => appendFileSync(trace,
    JSON.stringify({ event, generation, pid: process.pid, ...extra }) + '\n');
  log('root-start');
  process.on('exit', code => appendFileSync(trace,
    JSON.stringify({ event: 'root-exit', generation, pid: process.pid, code }) + '\n'));
  const safety = setTimeout(() => { log('root-safety-timeout'); process.exit(2); }, 90000);
  let owner, provider;
  const closePeers = async () => {
    const results = await Promise.allSettled([provider?.close(), owner?.close()]);
    if (results.some(result => result.status === 'rejected')) throw new Error('fixture_peer_cleanup_unconfirmed');
  };
  process.stdin.on('end', () => {
    log('root-parent-eof');
    void closePeers().catch(() => { process.exitCode = 1; });
  });
  process.stdin.on('error', () => { log('root-stdin-error'); void closePeers().catch(() => {}); process.exitCode = 1; });
  process.stdin.resume();
  try {
    owner = await openWindowsAdministratorBrowserWitness({ bundle, origin, selectedSid, generation, role: 'Owner' });
    log('owner-ready', { live: owner.isLive() });
    provider = await openWindowsAdministratorBrowserWitness({ bundle, origin, selectedSid, generation, role: 'Provider' });
    if (!owner.isLive() || !provider.isLive()) throw new Error('fixture_witness_not_live');
    log('provider-ready', { live: provider.isLive() });
    process.stdout.write('READY\n');
    await Promise.all([owner.finished, provider.finished]);
    log('witness-loss', { ownerLive: owner.isLive(), providerLive: provider.isLive() });
    if (owner.isLive() || provider.isLive()) throw new Error('fixture_witness_survived');
  } catch (error) {
    log('root-error', { message: error.message });
    process.exitCode = 1;
  } finally {
    try { await closePeers(); log('witnesses-closed'); }
    catch (error) { log('root-cleanup-error', { message: error.message }); process.exitCode = 1; }
    finally { clearTimeout(safety); process.stdin.destroy(); }
  }
}

async function nativeHostFixture({ trace, rootScript, origin, bundle }) {
  const log = (event, extra = {}) => appendFileSync(trace,
    JSON.stringify({ event, hostPid: process.pid, launcherPid: process.ppid, ...extra }) + '\n');
  log('host-start');
  process.on('exit', code => log('host-exit', { code }));
  let owned;
  try {
    await serveAdministratorBrowser({ input: process.stdin, output: process.stdout,
      args: process.argv.slice(2), origin,
      start() { log('forbidden-legacy-wake'); throw new Error('fixture_session_required'); },
      readStatus() { log('one-shot-status'); return { state: 'unobserved', generation: null }; },
      async openSession(wake, input) {
        const generation = randomBytes(16).toString('hex');
        let lost = false;
        const loss = kind => {
          if (lost) return;
          lost = true;
          log('input-loss', { generation, kind });
        };
        const onEnd = () => loss('end'), onClose = () => loss('close'), onError = () => loss('error');
        input.once('end', onEnd); input.once('close', onClose); input.once('error', onError);
        const server = await openAdministratorBrowserSessionServer({ bundle, origin, input });
        log('server-listening', { generation });
        const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP']
          .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
        const root = spawn(process.execPath, [rootScript, generation],
          { cwd: path.dirname(rootScript), windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
        const ready = Promise.withResolvers(), finished = Promise.withResolvers();
        let live = true, stopping, output = '';
        const stop = () => { live = false; if (!root.stdin.destroyed) root.stdin.end(); };
        root.stdin.on('error', () => { live = false; });
        root.once('error', error => { live = false; ready.reject(error); });
        root.once('close', (code, signal) => {
          live = false;
          log('observed-root-exit', { generation, rootPid: root.pid, code, signal });
          ready.reject(new Error('fixture_root_closed'));
          finished.resolve({ code, signal });
        });
        root.stderr.on('data', () => { ready.reject(new Error('fixture_root_stderr')); stop(); });
        root.stdout.on('data', data => {
          output += data.toString('ascii');
          if (output === 'READY\n') ready.resolve();
          else if (!'READY\n'.startsWith(output)) { ready.reject(new Error('fixture_root_output')); stop(); }
        });
        owned = { isLive: () => live && server.isLive(), finished: server.finished,
          close() {
            if (stopping) return stopping;
            stopping = (async () => {
              live = false;
              await server.close();
              log('server-closed', { generation });
              // The root must observe actual witness loss, not a simulated parent-stdin shutdown.
              const timer = setTimeout(() => { log('forced-root-stop', { generation }); root.kill(); }, 10000);
              try {
                const result = await finished.promise;
                if (result.code !== 0 || result.signal !== null) throw new Error('fixture_root_exit_unconfirmed');
              } finally {
                clearTimeout(timer);
                input.removeListener('end', onEnd); input.removeListener('close', onClose); input.removeListener('error', onError);
              }
            })();
            return stopping;
          } };
        let timer;
        try {
          await Promise.race([ready.promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('fixture_root_start_timeout')), 45000);
          })]);
          if (!live) throw new Error('fixture_session_closed');
          log('attached', { generation, wake, rootPid: root.pid });
          return owned;
        } catch (error) { await owned.close(); throw error; }
        finally { clearTimeout(timer); }
      } });
  } catch {
    log('host-error');
    process.exitCode = 1;
  } finally {
    try { if (owned) await owned.close(); }
    finally { process.stdin.destroy(); }
  }
}

async function ownedProcesses(scratch, images, stop = false) {
  const encoded = value => Buffer.from(value).toString('base64');
  const script = `$ErrorActionPreference='Stop'
$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(scratch)}'))
$images=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(JSON.stringify(images))}')))
$rows=@()
$candidates=@(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach($candidate in $candidates) {
  $p=Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
  if($null -eq $p) { continue }
  try {
    if($p.HasExited) { continue }
    $null=$p.Handle
    if($p.HasExited) { continue }
    $image=$p.Path
    if(-not ($images -contains $image)) { throw 'unexpected_fixture_process_image' }
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.Id)
    if($p.HasExited) { continue }
    if($current.CommandLine -ne $candidate.CommandLine -or $current.ExecutablePath -ne $image) { throw 'fixture_process_identity_changed' }
    $rows+=@{pid=$p.Id; started=$p.StartTime.ToUniversalTime().Ticks.ToString(); image=$image}
    if($${stop}) {
      $p.Kill()
      if(-not $p.WaitForExit(5000)) { throw 'fixture_process_exit_unconfirmed' }
    }
  } finally { $p.Dispose() }
}
[Console]::WriteLine((ConvertTo-Json -InputObject @($rows) -Compress))`;
  const { stdout } = await exec(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  return JSON.parse(stdout.trim());
}

test('disposable Chromium actual medium PS peers lose liveness on browser exit and reopen with a fresh generation',
  { skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 240000 }, async t => {
    const temp = await fs.realpath(os.tmpdir());
    const scratch = await fs.mkdtemp(path.join(temp, 'ac-admin-session-chromium-'));
    const extension = path.join(scratch, 'extension'), profile = path.join(scratch, 'profile');
    const trace = path.join(scratch, 'trace.jsonl'), launcher = path.join(scratch, 'launcher.cmd');
    const manifest = path.join(scratch, 'native-host.json');
    const bundle = path.join(scratch, 'AgentContinueAdmin', randomBytes(12).toString('hex'));
    const app = path.join(bundle, 'app'), node = path.join(bundle, 'runtime', 'node.exe');
    const rootScript = path.join(app, 'inert-root.mjs'), entry = path.join(app, 'windows-admin-browser-host.mjs');
    const host = 'com.agentcontinue.admin_session_fixture_' + randomBytes(16).toString('hex');
    const key = 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\' + host;
    const cmd = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const images = [process.execPath, node, chromium.executablePath(), cmd, powershell,
      path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')];
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'PATH', 'COMSPEC', 'PATHEXT']
      .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
    env.COMSPEC = cmd;
    const reg = (...args) => exec(path.join(process.env.SystemRoot, 'System32', 'reg.exe'),
      [...args, '/reg:64'], { windowsHide: true, timeout: 5000, encoding: 'utf8', env });
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const der = publicKey.export({ type: 'spki', format: 'der' });
    const id = createHash('sha256').update(der).digest('hex').slice(0, 32)
      .replace(/[a-f0-9]/g, ch => 'abcdefghijklmnop'[Number.parseInt(ch, 16)]);
    const origin = 'chrome-extension://' + id + '/';
    let context, registrationAttempted = false, registryReadback;
    const browserPids = new Set(), requests = [], browserMessages = [];
    const rows = async () => (await fs.readFile(trace, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const attachments = async () => (await rows()).filter(row => row.event === 'attached');
    const attachment = async index => {
      const row = await waitFor(async () => (await attachments())[index], 'missing retained attachment ' + index, 55000);
      assert.match(row.generation, /^[a-f0-9]{32}$/);
      assert.equal(exited(row.rootPid), false, 'attachment root already exited');
      return row;
    };
    const observeBrowser = async () => {
      const session = await context.browser().newBrowserCDPSession();
      try {
        const { processInfo } = await session.send('SystemInfo.getProcessInfo');
        assert.ok(processInfo.some(info => info.type === 'browser'));
        for (const info of processInfo) browserPids.add(info.id);
      } finally { await session.detach(); }
    };
    const open = async () => {
      context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, offline: true,
        env, timeout: 15000,
        args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check',
          '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-gcm',
          '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND',
          '--disable-extensions-except=' + extension, '--load-extension=' + extension] });
      context.setDefaultTimeout(8000);
      context.on('console', message => browserMessages.push({ type: message.type(), text: message.text() }));
      context.on('weberror', error => browserMessages.push({ type: 'error', text: error.error().message }));
      await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
      await observeBrowser();
    };
    const settled = async record => {
      const observed = await waitFor(async () => (await rows()).find(row =>
        row.event === 'observed-root-exit' && row.generation === record.generation), 'root exit was not observed');
      assert.deepEqual([observed.rootPid, observed.code, observed.signal], [record.rootPid, 0, null]);
      await waitFor(() => exited(record.rootPid) && exited(record.hostPid) && exited(record.launcherPid),
        'owned root, native host or launcher survived port loss');
      const evidence = (await rows()).filter(row => row.generation === record.generation);
      assert.equal(evidence.filter(row => row.event === 'owner-ready' && row.live).length, 1);
      assert.equal(evidence.filter(row => row.event === 'provider-ready' && row.live).length, 1);
      assert.deepEqual(evidence.filter(row => row.event === 'witness-loss').map(row => [row.ownerLive, row.providerLive]), [[false, false]]);
      assert.equal(evidence.filter(row => row.event === 'witnesses-closed').length, 1);
      assert.equal(evidence.filter(row => row.event === 'input-loss').length, 1);
      assert.equal(evidence.find(row => row.event === 'root-exit')?.code, 0);
    };
    const close = async record => {
      await observeBrowser();
      await within(context.close(), 12000, 'fixture browser did not close');
      context = null;
      await settled(record);
      await waitFor(() => [...browserPids].every(exited), 'fixture Chromium process survived browser close');
    };
    try {
      const identityScript = `$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$groups=& (Join-Path ([Environment]::SystemDirectory) 'whoami.exe') /groups /fo csv | ConvertFrom-Csv
$integrity=@($groups | ForEach-Object { $_.PSObject.Properties.Value } | Where-Object { $_ -cmatch '\\AS-1-16-[0-9]+\\z' })
if($integrity.Count -ne 1) { throw 'fixture_integrity_unconfirmed' }
[Console]::WriteLine((ConvertTo-Json -Compress @{sid=$identity.User.Value; session=[Diagnostics.Process]::GetCurrentProcess().SessionId; integrity=$integrity[0]}))`;
      const identity = JSON.parse((await exec(powershell,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(identityScript, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 15000, env })).stdout.trim());
      assert.equal(identity.integrity, 'S-1-16-8192', 'this fixture requires medium integrity, never UAC');
      assert.ok(identity.session > 0);
      const selectedSid = identity.sid;
      await fs.mkdir(app, { recursive: true });
      await fs.mkdir(path.dirname(node));
      await fs.mkdir(path.join(bundle + '.state', 'temp'), { recursive: true });
      await fs.copyFile(process.execPath, node);
      assert.equal(createHash('sha256').update(await fs.readFile(node)).digest('hex'),
        createHash('sha256').update(await fs.readFile(process.execPath)).digest('hex'));
      for (const file of ['windows-browser-peer.cs', 'windows-browser-peer.ps1', 'windows-admin-browser-session.mjs']) {
        const source = await fs.readFile(new URL('native/desktop-commander/' + file, project));
        await fs.writeFile(path.join(app, file), source);
        assert.deepEqual(await fs.readFile(path.join(app, file)), source);
      }
      await fs.mkdir(extension);
      const source = await fs.readFile(new URL('admin-browser.js', project), 'utf8');
      const fixedHost = "'com.agentcontinue.administrator_owner'";
      assert.equal(source.split(fixedHost).length, 2);
      const copied = source.replace(fixedHost, JSON.stringify(host));
      assert.equal(copied.replace(JSON.stringify(host), fixedHost), source);
      await fs.writeFile(path.join(extension, 'admin-browser.js'), copied);
      await fs.writeFile(path.join(extension, 'worker.js'), [
        "import { bindAdministratorBrowser } from './admin-browser.js';",
        'const controller = bindAdministratorBrowser(chrome);',
        'chrome.runtime.onMessage.addListener((message, sender, respond) => {',
        '  Promise.resolve(controller.handleMessage(message, sender)).then(respond); return true;',
        '});',
      ].join('\n'));
      await fs.writeFile(path.join(extension, 'devices.html'), '<!doctype html><title>Disposable retained session fixture</title>');
      await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({
        name: 'AgentContinue disposable retained session fixture', version: '1.0.0', manifest_version: 3,
        key: der.toString('base64'), permissions: ['storage', 'nativeMessaging'],
        background: { service_worker: 'worker.js', type: 'module' },
        content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'none'" },
      }));
      await fs.writeFile(rootScript, ["import { appendFileSync } from 'node:fs';",
        "import { openWindowsAdministratorBrowserWitness } from './windows-admin-browser-session.mjs';",
        'await (' + peerRootFixture.toString() + ')({... ' + JSON.stringify({ trace, bundle, origin, selectedSid }) +
          ', generation:process.argv[2]});',
      ].join('\n'));
      await fs.writeFile(entry, [
        "import { appendFileSync } from 'node:fs';", "import { spawn } from 'node:child_process';",
        "import { randomBytes } from 'node:crypto';", "import path from 'node:path';",
        'import { serveAdministratorBrowser } from ' + JSON.stringify(nativeModule) + ';',
        "import { openAdministratorBrowserSessionServer } from './windows-admin-browser-session.mjs';",
        'await (' + nativeHostFixture.toString() + ')(' + JSON.stringify({ trace, rootScript, origin, bundle }) + ');',
      ].join('\n'));
      assert.ok([node, entry, launcher].every(file => !/[%!\r\n"]/.test(file)));
      await fs.writeFile(launcher, '@echo off\r\nset NODE_OPTIONS=\r\nset NODE_PATH=\r\n"' + node +
        '" "' + entry + '" "%~1"\r\n');
      await fs.writeFile(manifest, JSON.stringify({ name: host, description: 'Disposable inert session fixture only',
        path: launcher, type: 'stdio', allowed_origins: [origin] }));
      await assert.rejects(reg('query', key), { code: 1 });
      registrationAttempted = true;
      await reg('add', key, '/ve', '/t', 'REG_SZ', '/d', manifest);
      registryReadback = (await reg('query', key, '/s')).stdout;
      assert.ok(registryReadback.includes(manifest));

      await open();
      const disarmed = await attachment(0);
      assert.equal(disarmed.wake, false);
      let page = await context.newPage();
      await page.goto(origin + 'devices.html?mode=browser-managed');
      await page.evaluate(() => chrome.storage.local.set({ windowsAdministratorBrowserRestoreV1: true }));
      assert.equal((await attachments()).length, 1, 'changing opt-in must not launch a second session');
      await close(disarmed);

      await open();
      const first = await attachment(1);
      assert.equal(first.wake, true);
      const peers = (await ownedProcesses(scratch, images)).filter(row => row.image.toLowerCase() === powershell.toLowerCase());
      assert.equal(peers.length, 3, 'real Server, Owner and Provider helpers must all be retained');
      await close(first);
      await open();
      const reopened = await attachment(2);
      assert.equal(reopened.wake, true);
      assert.notEqual(reopened.generation, first.generation);
      assert.notEqual(reopened.rootPid, first.rootPid);
      assert.deepEqual(await ownedProcesses(scratch, images).then(list => list.filter(row => row.pid === first.rootPid)), []);
      let final = reopened;
      await t.test('forced service-worker replacement attaches wake false without another browser-start wake', async sub => {
        page = await context.newPage();
        await page.goto(origin + 'devices.html?mode=browser-managed');
        const cdp = await context.newCDPSession(page), versions = new Map();
        try {
          cdp.on('ServiceWorker.workerVersionUpdated', event => {
            for (const version of event.versions) versions.set(version.versionId, version);
          });
          await cdp.send('ServiceWorker.enable');
          const worker = await waitFor(() => [...versions.values()].find(version =>
            version.scriptURL === origin + 'worker.js' && version.runningStatus === 'running'), 'worker version not observed');
          try { await within(cdp.send('ServiceWorker.stopWorker', { versionId: worker.versionId }), 8000, 'worker stop timed out'); }
          catch (error) {
            if (/wasn't found|method.*not found/i.test(error.message)) { sub.skip('CDP worker stopping is unavailable'); return; }
            throw error;
          }
          await settled(reopened);
          assert.equal(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FIXTURE_PING' })), null);
          final = await attachment(3);
          assert.equal(final.wake, false);
          assert.notEqual(final.generation, reopened.generation);
          assert.equal(await page.evaluate(async () =>
            (await chrome.storage.session.get('windowsAdministratorBrowserWakeAttemptV1')).windowsAdministratorBrowserWakeAttemptV1), true);
        } finally { await cdp.detach(); }
      });
      await close(final);
      const all = await rows(), attached = await attachments();
      assert.deepEqual(attached.map(row => row.wake), final === reopened ? [false, true, true] : [false, true, true, false]);
      assert.equal(new Set(attached.map(row => row.generation)).size, attached.length);
      assert.equal(all.filter(row => row.event === 'root-start').length, attached.length);
      assert.equal(all.filter(row => row.event === 'observed-root-exit').length, attached.length);
      assert.equal(all.filter(row => row.event === 'host-start').length, attached.length);
      assert.equal(all.filter(row => row.event === 'host-exit').length, attached.length);
      assert.ok(all.filter(row => row.event === 'host-exit').every(row => row.code === 0));
      assert.deepEqual(all.filter(row => /error|timeout|forced|forbidden|one-shot|parent-eof/.test(row.event)), []);
      assert.deepEqual(requests, [], 'fixture attempted an HTTP request');
      t.diagnostic(JSON.stringify({ scope: 'actual medium PS peer liveness; unsealed fixture, not elevated-native proof',
        generations: attached.map(({ generation, wake, rootPid }) => ({ generation, wake, rootPid })),
        observedRootExits: attached.length, realOwnerProviderPairs: attached.length, integrity: identity.integrity }));
    } catch (error) {
      t.diagnostic('Fixture trace at failure: ' + JSON.stringify(await rows()));
      t.diagnostic('Fixture worker messages: ' + JSON.stringify(browserMessages));
      if (context) {
        const worker = context.serviceWorkers()[0];
        t.diagnostic('Fixture workers: ' + JSON.stringify(context.serviceWorkers().map(item => item.url())));
        if (worker) {
          try {
            const probe = await within(worker.evaluate(async host => {
              try { return await chrome.runtime.sendNativeMessage(host, { version: 1, action: 'status', id: 'fixture-diagnostic' }); }
              catch (failure) { return { error: failure.message }; }
            }, host), 5000, 'fixture diagnostic timed out');
            t.diagnostic('Disposable host launch diagnostic: ' + JSON.stringify(probe));
          } catch (failure) { t.diagnostic('Disposable host diagnostic failed: ' + failure.message); }
        }
      }
      throw error;
    } finally {
      const failures = [];
      try { if (context) await within(context.close(), 12000, 'cleanup browser close timed out'); }
      catch (error) { failures.push(error); }
      try {
        await waitFor(async () => (await ownedProcesses(scratch, images)).length === 0, 'owned processes did not settle', 8000);
      } catch (error) {
        failures.push(error);
        try {
          const stopped = await ownedProcesses(scratch, images, true);
          t.diagnostic('Emergency cleanup stopped exact scratch-bound processes: ' + JSON.stringify(stopped));
        } catch (cleanupError) { failures.push(cleanupError); }
      }
      try { assert.deepEqual(await ownedProcesses(scratch, images), []); }
      catch (error) { failures.push(error); }
      try { await waitFor(() => [...browserPids].every(exited), 'cleanup left an observed Chromium process'); }
      catch (error) { failures.push(error); }
      if (registrationAttempted) {
        try {
          let current;
          try { current = (await reg('query', key, '/s')).stdout; }
          catch (error) { if (error.code !== 1) throw error; }
          if (current !== undefined) {
            assert.ok(current.includes(manifest) && current.includes('REG_SZ'));
            if (registryReadback !== undefined) assert.equal(current, registryReadback, 'fixture registry key changed');
            else assert.equal(current.trim().split(/\r?\n/).filter(Boolean).length, 2);
            await reg('delete', key, '/f');
          }
          await assert.rejects(reg('query', key), { code: 1 });
        } catch (error) { failures.push(error); }
      }
      if (failures.length === 0) {
        assert.equal(path.dirname(scratch), temp);
        assert.match(path.basename(scratch), /^ac-admin-session-chromium-[a-zA-Z0-9]{6}$/);
        assert.equal(await fs.realpath(scratch), scratch);
        await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        t.diagnostic('Cleanup verified: zero scratch-bound processes, random HKCU host removed, disposable files removed; no other processes signalled.');
      }
      if (failures.length) throw new AggregateError(failures, 'disposable session fixture cleanup failed; scratch retained at ' + scratch);
    }
  });
