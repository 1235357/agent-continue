import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const consent = process.env.AC_HIGH_BROWSER_JOB_ACCEPTANCE === 'accept-two-disposable-high-jobs';

async function waitFor(fn, label, ms = 15000) {
  const end = performance.now() + ms;
  do { const result = await fn(); if (result) return result; await delay(50); } while (performance.now() < end);
  throw new Error(label);
}
async function json(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function highRoot({ bundle, origin, sid, control }) {
  const generation = process.argv[2];
  if (!/^[a-f0-9]{32}$/.test(generation)) throw new Error('generation');
  let owner, provider;
  let phase = 'owner';
  let proof = null;
  const safety = setTimeout(() => { process.exitCode = 2; void stop(); }, 110000);
  const stop = async () => { await Promise.all([owner?.close(), provider?.close()]); };
  try {
    owner = await openWindowsAdministratorBrowserWitness({ bundle, origin, selectedSid: sid, generation, role: 'Owner' });
    phase = 'provider';
    provider = await openWindowsAdministratorBrowserWitness({ bundle, origin, selectedSid: sid, generation, role: 'Provider' });
    phase = 'command_child';
    const script = "$ProgressPreference='SilentlyContinue';$i=[Security.Principal.WindowsIdentity]::GetCurrent();" +
      "$g=(& (Join-Path ([Environment]::SystemDirectory) 'whoami.exe') /groups /fo csv /nh | Out-String);" +
      "[Console]::WriteLine((ConvertTo-Json -Compress @{pid=$PID;sid=$i.User.Value;admin=([Security.Principal.WindowsPrincipal]::new($i).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator));high=$g.Contains('S-1-16-12288')}))";
    proof = JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim());
    if (!proof.admin || !proof.high || proof.sid !== sid || !Number.isSafeInteger(proof.pid)) throw new Error('actual high command child failed');
    writeFileSync(path.join(control, 'ready-' + generation + '.json'), JSON.stringify({ generation, rootPid: process.pid, proof }), { flag: 'wx' });
    phase = 'lifetime';
    await Promise.all([owner.finished, provider.finished]);
    if (owner.isLive() || provider.isLive()) throw new Error('witness survived');
  } catch (error) {
    writeFileSync(path.join(control, 'root-error-' + generation + '.json'), JSON.stringify({ phase, rootPid: process.pid,
      errorType: error.name, proof, code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : null,
      childStatus: Number.isInteger(error.status) ? error.status : null }), { flag: 'wx' });
    throw error;
  } finally { clearTimeout(safety); await stop(); }
}

async function mediumHost({ bundle, origin, control }) {
  let server;
  const rows = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
  const until = async (file, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await rows(path.join(control, 'broker-error.json'))) throw new Error('high broker failed');
      const result = await rows(file); if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('high fixture observation deadline');
  };
  await serveAdministratorBrowser({ input: process.stdin, output: process.stdout, args: process.argv.slice(2), origin,
    start() { throw new Error('no legacy wake'); }, readStatus: () => ({ state: 'unobserved', generation: null }),
    async openSession(wake, input) {
      server = await openAdministratorBrowserSessionServer({ bundle, origin, input });
      if (!wake) return server;
      const generation = randomBytes(16).toString('hex');
      const first = path.join(control, 'request-1.txt');
      const index = existsSync(first) ? 2 : 1;
      await writeFile(path.join(control, 'request-' + index + '.txt'), generation, { flag: 'wx' });
      const ready = await until(path.join(control, 'job-ready-' + generation + '.json'), 55000);
      await writeFile(path.join(control, 'attached-' + index + '.json'), JSON.stringify({ ...ready, index, wake }), { flag: 'wx' });
      return { isLive: server.isLive, finished: server.finished,
        async close() { await server.close(); await until(path.join(control, 'settled-' + generation + '.json'), 15000); } };
    } });
}

test('manual high fixture directory rules are inheritable and files remain protected',
  { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
    const file = path.join(repo, 'tests', 'windows-high-browser-job-fixture.ps1').replaceAll("'", "''");
    const script = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" +
      "$a=[Management.Automation.Language.Parser]::ParseFile('" + file + "',[ref]$null,[ref]$null);" +
      "$f=@($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Fixture-Acl'},$true));" +
      "if($f.Count -ne 1){throw 'fixture function'};.([scriptblock]::Create($f[0].Extent.Text));" +
      "$d=Fixture-Acl $true;$f=Fixture-Acl $false;" +
      "[Console]::WriteLine((ConvertTo-Json -Compress @{directoryProtected=$d.AreAccessRulesProtected;fileProtected=$f.AreAccessRulesProtected;inherit=@($d.Access | ForEach-Object {[string]$_.InheritanceFlags});fileInherit=@($f.Access | ForEach-Object {[string]$_.InheritanceFlags})}))";
    const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = JSON.parse((await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 10000 })).stdout.trim());
    assert.equal(result.directoryProtected, true); assert.equal(result.fileProtected, true);
    assert.deepEqual(result.inherit, Array(3).fill('ContainerInherit, ObjectInherit'));
    assert.deepEqual(result.fileInherit, Array(3).fill('None'));
  });

test('protected high Job follows real offline Chromium lifetime and reopens with a different generation',
  { skip: !consent || process.platform !== 'win32' || process.arch !== 'x64', timeout: 300000 }, async t => {
    const id = randomBytes(12).toString('hex');
    const scratch = path.join(await fs.realpath(os.tmpdir()), 'ac-high-browser-job-' + id);
    const input = path.join(scratch, 'input'), extension = path.join(scratch, 'extension'), profile = path.join(scratch, 'profile');
    const bundle = path.join(process.env.ProgramFiles, 'AgentContinueAdmin', id);
    const node = path.join(bundle, 'runtime', 'node.exe');
    const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const regExe = path.join(process.env.SystemRoot, 'System32', 'reg.exe');
    const host = 'com.agentcontinue.high_job_fixture_' + id;
    const key = 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\' + host;
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const der = publicKey.export({ type: 'spki', format: 'der' });
    const extensionId = hash(der).slice(0, 32).replace(/[a-f0-9]/g, ch => 'abcdefghijklmnop'[parseInt(ch, 16)]);
    const origin = 'chrome-extension://' + extensionId + '/';
    let context, launcher, launcherExit, registered = false, releaseSent = false;
    const reg = (...args) => exec(regExe, [...args, '/reg:64'], { windowsHide: true, timeout: 5000 });
    const exists = file => fs.access(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    await fs.mkdir(input, { recursive: true }); await fs.mkdir(extension);
    const identity = JSON.parse((await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$i=[Security.Principal.WindowsIdentity]::GetCurrent();[Console]::WriteLine((ConvertTo-Json -Compress @{sid=$i.User.Value;admin=([Security.Principal.WindowsPrincipal]::new($i).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))}))"],
      { windowsHide: true, timeout: 10000 })).stdout.trim());
    assert.equal(identity.admin, false, 'launch this acceptance from the ordinary owner session');
    const files = [];
    const put = async (name, bytes) => {
      await fs.writeFile(path.join(input, name), bytes, { flag: 'wx' }); files.push({ name, sha256: hash(bytes) });
    };
    for (const name of ['windows-admin-browser-session.mjs', 'windows-browser-peer.cs', 'windows-browser-peer.ps1', 'windows-owner-job.cs']) {
      await put(name, await fs.readFile(path.join(repo, 'native', 'desktop-commander', name)));
    }
    await put('inert-root.mjs', Buffer.from([
      "import { writeFileSync } from 'node:fs';", "import { execFileSync } from 'node:child_process';", "import path from 'node:path';",
      "import { openWindowsAdministratorBrowserWitness } from './windows-admin-browser-session.mjs';",
      'await (' + highRoot.toString() + ')(' + JSON.stringify({ bundle, origin, sid: identity.sid, control: scratch }) + ');',
    ].join('\n')));
    const nativeModule = new URL('../native/desktop-commander/windows-admin-browser-host.mjs', import.meta.url).href;
    await put('windows-admin-browser-host.mjs', Buffer.from([
      "import { existsSync } from 'node:fs';", "import { readFile, writeFile } from 'node:fs/promises';",
      "import { randomBytes } from 'node:crypto';", "import path from 'node:path';",
      'import { serveAdministratorBrowser } from ' + JSON.stringify(nativeModule) + ';',
      "import { openAdministratorBrowserSessionServer } from './windows-admin-browser-session.mjs';",
      'try { await (' + mediumHost.toString() + ')(' + JSON.stringify({ bundle, origin, control: scratch }) + '); } catch { process.exitCode=1; }',
    ].join('\n')));
    const plan = { format: 'ac-high-browser-job-fixture-v1', id, sid: identity.sid, origin, files,
      nodeSource: path.join(process.env.ProgramFiles, 'AgentContinueAdmin', 'd94052eccd6d90bb08f6de78', 'runtime', 'node.exe'),
      nodeSha256: 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f' };
    const planBytes = Buffer.from(JSON.stringify(plan)), planFile = path.join(scratch, 'plan.json');
    await fs.writeFile(planFile, planBytes, { flag: 'wx' });
    const fixtureScript = path.join(repo, 'tests', 'windows-high-browser-job-fixture.ps1');
    const fixtureSha = hash(await fs.readFile(fixtureScript));
    const data = Buffer.from(JSON.stringify({ script: fixtureScript, scriptSha: fixtureSha, plan: planFile, planSha: hash(planBytes) })).toString('base64');
    const worker = `$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json;$s=[IO.File]::Open($p.script,'Open','Read','Read');try{$b=[byte[]]::new([int]$s.Length);$n=0;while($n -lt $b.Length){$r=$s.Read($b,$n,$b.Length-$n);if($r -le 0){throw 'read'};$n+=$r};$h=[Security.Cryptography.SHA256]::Create();try{$v=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};if($v -cne $p.scriptSha){throw 'hash'};&([ScriptBlock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($b))) -PlanFile $p.plan -ExpectedPlanSha256 $p.planSha;exit 3}finally{$s.Dispose()}`;
    const encodedWorker = Buffer.from(worker, 'utf16le').toString('base64');
    const launchScript = `$p=[Diagnostics.ProcessStartInfo]::new('${ps.replaceAll("'", "''")}','-NoLogo -NoProfile -NonInteractive -EncodedCommand ${encodedWorker}');$p.UseShellExecute=$true;$p.WindowStyle='Hidden';$p.Verb='runas';$p.WorkingDirectory=[Environment]::SystemDirectory;$c=[Diagnostics.Process]::Start($p);try{if(-not $c.WaitForExit(260000)){[Console]::WriteLine('outcome-unconfirmed');exit 4};exit $c.ExitCode}finally{$c.Dispose()}`;
    const source = (await fs.readFile(path.join(repo, 'admin-browser.js'), 'utf8')).replace("'com.agentcontinue.administrator_owner'", JSON.stringify(host));
    await fs.writeFile(path.join(extension, 'admin-browser.js'), source);
    await fs.writeFile(path.join(extension, 'worker.js'), "import {bindAdministratorBrowser} from './admin-browser.js';bindAdministratorBrowser(chrome);");
    await fs.writeFile(path.join(extension, 'devices.html'), '<!doctype html><title>Disposable high Job fixture</title>');
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Disposable high Job acceptance', version: '1.0.0', key: der.toString('base64'),
      permissions: ['storage', 'nativeMessaging'], background: { service_worker: 'worker.js', type: 'module' },
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'none'" } }));
    const cmd = path.join(scratch, 'launcher.cmd'), manifest = path.join(scratch, 'host.json');
    await fs.writeFile(cmd, '@echo off\r\nset NODE_OPTIONS=\r\nset NODE_PATH=\r\n"' + node + '" "' + path.join(bundle, 'app', 'windows-admin-browser-host.mjs') + '" "%~1"\r\n');
    await fs.writeFile(manifest, JSON.stringify({ name: host, description: 'Disposable no-network high Job fixture', path: cmd, type: 'stdio', allowed_origins: [origin] }));
    const open = async () => {
      context = await chromium.launchPersistentContext(profile, { headless: false, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run', '--no-default-browser-check'] });
      await context.route('**/*', route => route.abort());
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
      assert.equal(worker.url(), origin + 'worker.js');
      return worker;
    };
    try {
      launcher = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launchScript, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      launcherExit = new Promise((resolve, reject) => { launcher.once('error', reject); launcher.once('close', (code, signal) => resolve({ code, signal })); });
      let output = ''; launcher.stdout.on('data', b => { output += b; }); launcher.stderr.on('data', b => { output += b; });
      const broker = await waitFor(async () => {
        if (await json(path.join(scratch, 'broker-error.json'))) throw new Error('high broker initialization failed');
        return json(path.join(scratch, 'broker-ready.json'));
      }, 'high broker not observed; inspect same launcher, never replay', 60000);
      assert.equal(broker.sid, identity.sid); assert.ok(broker.session > 0); assert.equal(broker.sealedFixture, true);
      await assert.rejects(reg('query', key), { code: 1 });
      registered = true; await reg('add', key, '/ve', '/t', 'REG_SZ', '/d', manifest);
      assert.ok((await reg('query', key)).stdout.includes(manifest));
      let worker = await open();
      await worker.evaluate(() => chrome.storage.local.set({ windowsAdministratorBrowserRestoreV1: true }));
      await context.close(); context = null;
      const observations = [];
      for (let index = 1; index <= 2; index++) {
        worker = await open();
        const attached = await waitFor(async () => {
          const error = await json(path.join(scratch, 'broker-error.json'));
          if (error) throw new Error('high broker failed at ' + error.phase + ' (' + error.errorType + ')');
          return json(path.join(scratch, 'attached-' + index + '.json'));
        }, 'native high attachment absent', 60000);
        const ready = await json(path.join(scratch, 'ready-' + attached.generation + '.json'));
        assert.equal(ready.rootPid, attached.rootPid); assert.equal(ready.proof.sid, identity.sid);
        assert.equal(ready.proof.high, true); assert.equal(ready.proof.admin, true); assert.ok(ready.proof.pid > 0);
        assert.ok(attached.active >= 3); assert.equal(attached.outsideAlive, true);
        const aclScript = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" +
          "Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1');" +
          "$a=Get-Acl -LiteralPath '" + path.join(bundle, 'app', 'inert-root.mjs').replaceAll("'", "''") + "';[Console]::WriteLine($a.Owner+'|'+$a.AreAccessRulesProtected)";
        const rootAcl = (await exec(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(aclScript, 'utf16le').toString('base64')],
          { windowsHide: true, timeout: 10000 })).stdout.trim();
        assert.equal(rootAcl, 'BUILTIN\\Administrators|True');
        await context.close(); context = null;
        const settled = await waitFor(() => json(path.join(scratch, 'settled-' + attached.generation + '.json')), 'high Job did not settle after browser close', 20000);
        assert.equal(settled.rootPid, attached.rootPid); assert.equal(settled.rootExit, 0);
        assert.equal(settled.jobActive, 0); assert.equal(settled.outsideAlive, true);
        observations.push({ ...attached, proof: ready.proof, settled });
      }
      assert.notEqual(observations[0].generation, observations[1].generation);
      assert.notEqual(observations[0].rootPid, observations[1].rootPid);
      await fs.writeFile(path.join(scratch, 'release'), '', { flag: 'wx' }); releaseSent = true;
      const final = await waitFor(() => json(path.join(scratch, 'broker-complete.json')), 'high cleanup receipt missing', 20000);
      assert.deepEqual({ ok: final.ok, settled: final.settled, fixtureRemoved: final.fixtureRemoved }, { ok: true, settled: 2, fixtureRemoved: true });
      assert.deepEqual(await launcherExit, { code: 0, signal: null }); assert.equal(output, '');
      assert.equal(await exists(bundle), false); assert.equal(await exists(bundle + '.state'), false);
      console.log(JSON.stringify({ format: 'ac-actual-high-browser-job-result', observations, sealedFixture: true,
        broker: final, realScheduler: false, productionOwner: false, hosted: false, productionChanged: false, evidenceDirectory: scratch }));
    } finally {
      if (context) await context.close();
      if (registered) { await reg('delete', key, '/f'); await assert.rejects(reg('query', key), { code: 1 }); }
      if (launcher) {
        if (!releaseSent) await fs.writeFile(path.join(scratch, 'stop'), '', { flag: 'wx' }).catch(() => {});
        let timer;
        const result = await Promise.race([launcherExit, new Promise(resolve => { timer = setTimeout(() => resolve(null), 30000); })]);
        clearTimeout(timer);
        if (result === null) t.diagnostic('High fixture cleanup UNCONFIRMED; keep its existing handle and evidence, never replay or kill by PID.');
      }
    }
  });
