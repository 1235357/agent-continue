import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Manual owner-authorized acceptance only. No account pages, credentials or
// simulated native replies; the browser contacts the installed protected host.
const consent = process.argv.includes('--consent=owner-authorized-d940-browser-acceptance');
assert.equal(consent, true, 'explicit owner acceptance consent required');
assert.equal(process.platform, 'win32');
const command = process.argv[2];
assert.ok(['prepare', 'serve'].includes(command));
const digest = 'd94052eccd6d90bb08f6de78cdf97dee3d50cad4c4d88f5fcacae2b6d15bde5f';
const repo = fileURLToPath(new URL('../', import.meta.url));
const control = path.join(os.homedir(), 'AppData', 'Local', 'AgentContinueD940BrowserAcceptance', 'd940-20261107');
const planFile = path.join(control, 'plan.json');
const sha = data => createHash('sha256').update(data).digest('hex');
const reg = promisify(execFile);
const regExe = path.join(process.env.SystemRoot, 'System32', 'reg.exe');
const registryKey = 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.agentcontinue.administrator_owner';
const host = path.join(process.env.ProgramFiles, 'AgentContinueAdmin', digest.slice(0, 24) + '.browser', 'host.json');
const emit = row => process.stdout.write(JSON.stringify(row) + '\n');

if (command === 'prepare') {
  await fs.mkdir(path.dirname(control), { recursive: true });
  await fs.mkdir(control, { recursive: false });
  const source = path.join(repo, 'dist', 'windows-20261107-d940-browser-kit', 'unpacked', 'AgentContinue');
  const extension = path.join(control, 'extension');
  await fs.cp(source, extension, { recursive: true, force: false, errorOnExist: true });
  const original = await fs.readFile(path.join(extension, 'manifest.json'));
  const manifest = JSON.parse(original);
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const id = sha(der).slice(0, 32).replace(/./g, ch => 'abcdefghijklmnop'[parseInt(ch, 16)]);
  manifest.key = der.toString('base64');
  manifest.permissions = [...new Set([...manifest.permissions, 'nativeMessaging'])];
  manifest.optional_permissions = manifest.optional_permissions.filter(p => p !== 'nativeMessaging');
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const files = {};
  for (const name of ['background.js', 'admin-browser.js', 'browser-wake.js', 'devices.js', 'devices.html']) {
    const originalBytes = await fs.readFile(path.join(source, name));
    const bytes = await fs.readFile(path.join(extension, name));
    assert.deepEqual(bytes, originalBytes);
    files[name] = sha(bytes);
  }
  const plan = { format: 'agent-continue-d940-actual-browser-acceptance', digest, id,
    control, extension, profile: path.join(control, 'profile'), host,
    manifestSourceSha256: sha(original), manifestAcceptanceSha256: sha(await fs.readFile(path.join(extension, 'manifest.json'))), files,
    manifestDifferences: ['random isolated test public key', 'nativeMessaging declared at test-extension installation instead of optional prompt'],
    optionalPermissionPromptVerified: false, accountBrowser: false, productionCodeReplaced: false };
  await fs.writeFile(planFile, JSON.stringify(plan, null, 2), { flag: 'wx' });
  emit({ state: 'prepared', id, control, planFile, manifestDifferences: plan.manifestDifferences });
} else {
  const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
  assert.equal(plan.digest, digest);
  assert.equal(plan.control, control);
  assert.match(plan.id, /^[a-p]{32}$/);
  assert.equal(sha(await fs.readFile(path.join(plan.extension, 'manifest.json'))), plan.manifestAcceptanceSha256);
  for (const [name, pin] of Object.entries(plan.files)) assert.equal(sha(await fs.readFile(path.join(plan.extension, name))), pin);
  const native = JSON.parse(await fs.readFile(host, 'utf8'));
  assert.equal(native.name, 'com.agentcontinue.administrator_owner');
  assert.deepEqual(native.allowed_origins, ['chrome-extension://' + plan.id + '/']);
  assert.ok(native.path.startsWith(path.dirname(host) + path.sep));
  let context, page, registered = false;
  const history = [];
  const record = async row => {
    const event = { at: new Date().toISOString(), ...row }; history.push(event);
    await fs.appendFile(path.join(control, 'browser-observations.jsonl'), JSON.stringify(event) + '\n'); emit(event);
  };
  const registry = (...args) => reg(regExe, [...args, '/reg:64'], { windowsHide: true, timeout: 5000 });
  const open = async () => {
    assert.equal(context, undefined, 'already open');
    context = await chromium.launchPersistentContext(plan.profile, { headless: false,
      args: ['--disable-extensions-except=' + plan.extension, '--load-extension=' + plan.extension,
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking'] });
    await context.route('**/*', route => route.request().url().startsWith('chrome-extension://' + plan.id + '/')
      ? route.continue() : route.abort());
    const worker = context.serviceWorkers().find(w => w.url().endsWith('/background.js')) ??
      await context.waitForEvent('serviceworker', { predicate: w => w.url().endsWith('/background.js'), timeout: 15000 });
    assert.equal(worker.url(), 'chrome-extension://' + plan.id + '/background.js');
    page = context.pages()[0] ?? await context.newPage();
    await page.goto('chrome-extension://' + plan.id + '/devices.html?mode=browser-managed');
    await page.locator('#administrator-check').waitFor();
    await page.screenshot({ path: path.join(control, 'devices-' + history.length + '.png'), fullPage: true });
    await record({ state: 'browser-open', nativePeerVerified: false, id: plan.id,
      platform: await worker.evaluate(() => chrome.runtime.getPlatformInfo()),
      nativePermission: await worker.evaluate(() => chrome.permissions.contains({ permissions: ['nativeMessaging'] })) });
  };
  const close = async () => {
    if (context) { await context.close(); context = undefined; page = undefined; await record({ state: 'browser-closed' }); }
  };
  const operation = async name => {
    if (name === 'status') {
      assert.ok(page);
      await page.locator('#administrator-check').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#administrator-check').disabled);
      await page.locator('#administrator-check').click();
      await page.waitForFunction(() => !document.querySelector('#administrator-check').disabled);
      await record({ state: 'status', text: await page.locator('#administrator-status').innerText() });
    } else if (name === 'arm') {
      assert.ok(page); await page.locator('#administrator-restore').check();
      await record({ state: 'restore-selected', checked: await page.locator('#administrator-restore').isChecked() });
    } else if (name === 'pause') {
      assert.ok(page); await page.locator('#administrator-pause').click();
      await page.locator('#administrator-pause-confirm').click();
      await record({ state: 'pause-requested', text: await page.locator('#administrator-pause-request-feedback').innerText() });
    } else if (name === 'pause-readback') {
      assert.ok(page);
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-check').disabled);
      await page.locator('#administrator-pause-check').click();
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-check').disabled);
      await record({ state: 'pause-readback', operationId: await page.locator('#administrator-pause-id').inputValue(),
        text: await page.locator('#administrator-pause-feedback').innerText() });
    } else if (name === 'close') await close();
    else if (name === 'reopen') await open();
    else if (name === 'screenshot') {
      assert.ok(page); const file = path.join(control, 'devices-latest.png');
      await page.screenshot({ path: file, fullPage: true }); await record({ state: 'screenshot', file });
    } else throw new Error('unknown_acceptance_command');
  };
  try {
    await assert.rejects(registry('query', registryKey), { code: 1 });
    await registry('add', registryKey, '/ve', '/t', 'REG_SZ', '/d', host);
    registered = true;
    assert.ok((await registry('query', registryKey)).stdout.includes(host));
    await record({ state: 'temporary-chromium-registration', id: plan.id, protectedManifest: host });
    await open();
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of input) {
      const action = line.trim();
      if (action === 'stop') { input.close(); break; }
      try { await operation(action); }
      catch (error) { await record({ state: 'command-error', action, error: String(error.message).slice(0, 160) }); }
    }
  } finally {
    await close();
    if (registered) {
      assert.ok((await registry('query', registryKey)).stdout.includes(host));
      await registry('delete', registryKey, '/f');
      await assert.rejects(registry('query', registryKey), { code: 1 });
      await record({ state: 'temporary-chromium-registration-removed' });
    }
  }
}
