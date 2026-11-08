import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const project = new URL('../', import.meta.url);
const native = new URL('native/desktop-commander/windows-admin-browser-host.mjs', project).href;
const generation = 'f'.repeat(32);
const pauseOperation = 'a'.repeat(32);
const target = generation + ':' + pauseOperation;
const idleTarget = generation + ':idle';

test('disposable Windows Chromium routes fixed Pause and reconcile across tabs and restarts',
  { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
    const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ac-admin-chromium-'));
    const extension = path.join(scratch, 'extension'), profile = path.join(scratch, 'profile');
    const trace = path.join(scratch, 'wake.log'), launcher = path.join(scratch, 'launcher.cmd');
    const recorded = path.join(scratch, 'recorded');
    const manifest = path.join(scratch, 'host.json');
    const host = 'com.agentcontinue.admin_fixture_' + randomBytes(12).toString('hex');
    const key = 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\' + host;
    const reg = (...args) => execFileSync(path.join(process.env.SystemRoot, 'System32', 'reg.exe'), args,
      { windowsHide: true, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const der = publicKey.export({ type: 'spki', format: 'der' });
    const id = createHash('sha256').update(der).digest('hex').slice(0, 32)
      .replace(/[a-f0-9]/g, ch => 'abcdefghijklmnop'[Number.parseInt(ch, 16)]);
    const origin = 'chrome-extension://' + id + '/';
    const traceRows = async () => (await fs.readFile(trace, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    })).trim().split('\n').filter(Boolean);
    const open = () => chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check',
        '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-gcm',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    let context, registered = false;
    try {
      await fs.mkdir(extension);
      const module = await fs.readFile(new URL('admin-browser.js', project), 'utf8');
      const fixedHost = "'com.agentcontinue.administrator_owner'";
      assert.equal(module.split(fixedHost).length, 2);
      await fs.writeFile(path.join(extension, 'admin-browser.js'), module.replace(fixedHost, JSON.stringify(host)));
      for (const file of ['background.js', 'i18n.js', 'i18n-runtime.js', 'config.js', 'adapter.js']) {
        await fs.copyFile(new URL(file, project), path.join(extension, file));
      }
      // Isolate the real background dispatcher from the other native host and private preset.
      await fs.writeFile(path.join(extension, 'browser-wake.js'),
        "export const BROWSER_DEVICE_MESSAGE = 'BROWSER_DEVICE_CONTROL_V1'; export const bindBrowserWake = () => null;");
      await fs.writeFile(path.join(extension, 'preset.js'), 'export const BUNDLED_PROMPT = null;');
      await fs.writeFile(path.join(extension, 'devices.html'), '<!doctype html><title>Administrator bridge fixture</title>');
      await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({
        name: 'AgentContinue disposable administrator bridge test', version: '1.0.0',
        manifest_version: 3, key: der.toString('base64'), permissions: ['storage', 'nativeMessaging', 'alarms'],
        action: {}, commands: { 'toggle-running': { description: 'Fixture command' } },
        background: { service_worker: 'background.js', type: 'module' },
      }));
      assert.ok([process.execPath, launcher].every(file => !/[%!\r\n"]/.test(file)));
      await fs.writeFile(launcher, '@echo off\r\n"' + process.execPath + '" "%~dp0host.mjs" "%~1"\r\n');
      await fs.writeFile(path.join(scratch, 'host.mjs'), [
        "import fs from 'node:fs';",
        'import { serveAdministratorBrowser } from ' + JSON.stringify(native) + ';',
        'const trace = ' + JSON.stringify(trace) + ';',
        'const recorded = ' + JSON.stringify(recorded) + ';',
        "const rows = () => fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\\n') : [];",
        'await serveAdministratorBrowser({ input: process.stdin, output: process.stdout,',
        '  args: process.argv.slice(2), origin: ' + JSON.stringify(origin) + ',',
        '  async openSession(wake, input) {',
        "    if (wake) fs.appendFileSync(trace, 'wake\\n');",
        "    let finish; const finished = new Promise(resolve => { finish = resolve; });",
        "    input.once('end', finish); input.once('close', finish); input.once('error', finish); input.resume();",
        "    return { isLive: () => !input.destroyed && !input.readableEnded, finished, close: async () => { finish(); } }; },",
        "  async start() { fs.appendFileSync(trace, 'wake\\n'); },",
        "  async readStatus() { return fs.existsSync(trace) ? { state: 'ready', generation: " +
          JSON.stringify(generation) + " } : { state: 'unobserved', generation: null }; },",
        "  async readPauseStatus(operationId) { return { operationId, state: operationId === " +
          JSON.stringify(pauseOperation) + " ? 'stopped' : rows().includes('fence:' + operationId) ? 'fenced' :",
        "    fs.existsSync(recorded) && fs.readFileSync(recorded, 'utf8') === operationId ? 'pause-recorded' : 'unconfirmed' }; },",
        "  async readPauseSupport() { return { state: 'supported', target: rows().some(row => row.startsWith('fence:')) ? " +
          JSON.stringify(idleTarget) + ' : ' + JSON.stringify(target) + ' }; },',
        "  async requestPause(operationId, target) { fs.appendFileSync(trace, 'pause:' + operationId + ':' + target + '\\n');",
        "    return { operationId, state: 'requested' }; },",
        "  async requestPauseFence(operationId) {",
        "    await new Promise(resolve => setTimeout(resolve, 500));",
        "    fs.appendFileSync(trace, 'fence:' + operationId + '\\n');",
        "    throw new Error('fixture: lost fence result'); },",
        '});',
        'process.stdin.destroy();',
      ].join('\n'));
      await fs.writeFile(manifest, JSON.stringify({ name: host, description: 'Disposable fixture',
        path: launcher, type: 'stdio', allowed_origins: [origin] }));
      assert.throws(() => reg('query', key, '/ve'), 'unexpected native host already exists');
      reg('add', key, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f');
      registered = true;
      const send = async (page, message) => {
        let timer;
        try {
          return await Promise.race([
            page.evaluate(message => chrome.runtime.sendMessage(message), message),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('No fixture reply to ' + message.type)), 15000);
            }),
          ]);
        } finally { clearTimeout(timer); }
      };
      const requestStatus = page => send(page, { type: 'WINDOWS_ADMINISTRATOR_STATUS_V1' });
      const requestPause = (page, operationId) => send(page, { type: 'WINDOWS_ADMINISTRATOR_PAUSE_STATUS_V1', operationId });
      const initiatePause = page => send(page, { type: 'WINDOWS_ADMINISTRATOR_PAUSE_V1' });
      const reconcile = (page, operationId, extra = {}) =>
        send(page, { type: 'WINDOWS_ADMINISTRATOR_PAUSE_RECONCILE_V1', operationId, ...extra });
      const previous = page => page.evaluate(async () =>
        (await chrome.storage.local.get('windowsAdministratorPauseLastV1')).windowsAdministratorPauseLastV1);
      context = await open();
      let page = await context.newPage();
      await page.goto(origin + 'devices.html?mode=browser-managed');
      assert.deepEqual(await requestStatus(page), { state: 'unobserved', generation: null });
      assert.deepEqual(await requestPause(page, pauseOperation), { operationId: pauseOperation, state: 'stopped' });
      const unknown = 'b'.repeat(32);
      assert.deepEqual(await requestPause(page, unknown), { operationId: unknown, state: 'unconfirmed' });
      assert.deepEqual(await traceRows(), [], 'checking status must not wake the fixture');
      await page.evaluate(() => chrome.storage.local.set({ windowsAdministratorBrowserRestoreV1: true }));
      await context.close(); context = null;
      assert.deepEqual(await traceRows(), [], 'opt-in is a setting, not an immediate launch');
      context = await open();
      const deadline = performance.now() + 12000;
      while (!(await traceRows()).length && performance.now() < deadline) await delay(80);
      assert.deepEqual(await traceRows(), ['wake']);
      page = await context.newPage();
      await page.goto(origin + 'devices.html?mode=browser-managed');
      assert.deepEqual(await requestStatus(page), { state: 'ready', generation });
      assert.deepEqual(await requestPause(page, pauseOperation), { operationId: pauseOperation, state: 'stopped' });
      await page.goto(origin + 'devices.html');
      assert.equal(await requestStatus(page), null);
      assert.equal(await requestPause(page, pauseOperation), null);
      assert.equal(await initiatePause(page), null);
      assert.equal(await reconcile(page, pauseOperation), null);
      assert.deepEqual(await traceRows(), ['wake']);
      await page.goto(origin + 'devices.html?mode=browser-managed');
      await page.evaluate(() => chrome.storage.local.set({ windowsAdministratorBrowserRestoreV1: false }));
      const other = await context.newPage();
      await other.goto(origin + 'devices.html?mode=browser-managed');
      const [first, duplicate] = await Promise.all([initiatePause(page), initiatePause(other)]);
      assert.equal(first.outcome, 'requested');
      assert.match(first.operationId, /^[a-f0-9]{32}$/);
      assert.deepEqual(duplicate, first);
      const submitted = ['wake', 'pause:' + first.operationId + ':' + target];
      assert.deepEqual(await traceRows(), submitted);
      await context.close(); context = null;
      context = await open();
      page = await context.newPage();
      await page.goto(origin + 'devices.html?mode=browser-managed');
      assert.deepEqual(await requestPause(page, first.operationId), { operationId: first.operationId, state: 'unconfirmed' });
      assert.deepEqual(await initiatePause(page), first);
      assert.equal(await reconcile(page, unknown), null);
      assert.equal(await reconcile(page, first.operationId, { target }), null);
      assert.equal(await reconcile(page, first.operationId, { command: 'Wake' }), null);
      assert.equal(await reconcile(page, first.operationId + '\n'), null);
      assert.deepEqual(await traceRows(), submitted);
      const secondTab = await context.newPage();
      await secondTab.goto(origin + 'devices.html');
      assert.equal(await reconcile(secondTab, first.operationId), null);
      const [child] = await Promise.all([
        secondTab.waitForEvent('framenavigated', {
          predicate: frame => frame.parentFrame() && frame.url() === origin + 'devices.html?mode=browser-managed',
          timeout: 5000,
        }),
        secondTab.evaluate(() => {
          const frame = document.createElement('iframe');
          frame.src = 'devices.html?mode=browser-managed';
          document.body.append(frame);
        }),
      ]);
      assert.equal(await reconcile(child, first.operationId), null);
      assert.deepEqual(await traceRows(), submitted);
      await secondTab.goto(origin + 'devices.html?mode=browser-managed');
      const results = await Promise.all([reconcile(page, first.operationId), reconcile(secondTab, first.operationId)]);
      assert.ok(results.some(result => result?.outcome === 'unconfirmed'));
      for (const result of results) {
        if (result !== null) assert.deepEqual(result, { operationId: first.operationId, outcome: 'unconfirmed' });
      }
      const fenced = [...submitted, 'fence:' + first.operationId];
      assert.deepEqual(await traceRows(), fenced);
      assert.deepEqual(await previous(page), first);
      await context.close(); context = null;
      context = await open();
      page = await context.newPage();
      await page.goto(origin + 'devices.html?mode=browser-managed');
      assert.deepEqual(await previous(page), first);
      assert.deepEqual(await requestPause(page, first.operationId), { operationId: first.operationId, state: 'fenced' });
      assert.equal(await reconcile(page, first.operationId), null);
      assert.deepEqual(await traceRows(), fenced, 'restart, readback and terminal reconcile must not fence or pause');
      const fresh = await initiatePause(page);
      assert.equal(fresh.outcome, 'requested');
      assert.notEqual(fresh.operationId, first.operationId);
      const freshTrace = [...fenced, 'pause:' + fresh.operationId + ':' + idleTarget];
      assert.deepEqual(await initiatePause(page), fresh, 'unconfirmed still blocks a new Pause');
      assert.deepEqual(await traceRows(), freshTrace);
      await fs.writeFile(recorded, fresh.operationId, { flag: 'wx' });
      const recordedReceipt = { operationId: fresh.operationId, state: 'pause-recorded' };
      assert.deepEqual(await requestPause(page, fresh.operationId), recordedReceipt);
      assert.equal(await reconcile(page, fresh.operationId), null);
      assert.deepEqual(await traceRows(), freshTrace, 'recorded status and reconcile must not submit anything');
      assert.deepEqual(await previous(page), fresh);
      const afterRecorded = await initiatePause(page);
      assert.equal(afterRecorded.outcome, 'requested');
      assert.notEqual(afterRecorded.operationId, fresh.operationId);
      assert.deepEqual(await traceRows(), [...freshTrace, 'pause:' + afterRecorded.operationId + ':' + idleTarget]);
      assert.deepEqual(await previous(page), afterRecorded);
      assert.deepEqual(await requestPause(page, fresh.operationId), recordedReceipt);
      assert.equal(await fs.readFile(recorded, 'utf8'), fresh.operationId);
    } finally {
      try { await context?.close(); }
      finally {
        try {
          if (registered) {
            assert.ok(reg('query', key, '/ve').includes(manifest), 'fixture registration changed');
            reg('delete', key, '/f');
            assert.throws(() => reg('query', key, '/ve'));
          }
        } finally {
          assert.match(path.basename(scratch), /^ac-admin-chromium-[a-zA-Z0-9]{6}$/);
          assert.equal(await fs.realpath(scratch), scratch);
          await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      }
    }
  });
