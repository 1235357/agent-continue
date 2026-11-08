import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const keys = ['extensionDir', 'profileDir', 'extensionId', 'origin', 'ticket'];
const maxInputBytes = 16 * 1024;
const nonTestIds = new Set([
  'jpioilmpbolfokedaefmbfbjeaahfdkl', // Chrome Web Store
  'kpjgmkakklpdhjmbfahlkffgkcphebkc', // Registered development identity
]);

function requireCondition(condition) {
  if (!condition) throw new Error();
}

async function readInput() {
  const timer = setTimeout(() => process.stdin.destroy(new Error()), 10000);
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      requireCondition(bytes <= maxInputBytes);
      chunks.push(chunk);
    }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const input = JSON.parse(json);
    requireCondition(input && !Array.isArray(input) && Object.keys(input).length === keys.length &&
      keys.every(key => Object.hasOwn(input, key) && typeof input[key] === 'string'));
    // A valid flat string object has exactly two string tokens per field, even with escapes.
    requireCondition(json.match(/"(?:[^"\\]|\\[\s\S])*"/g)?.length === keys.length * 2);
    const port = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/.exec(input.origin)?.[1];
    requireCondition(port && Number(port) >= 1024 && Number(port) <= 65535 &&
      input.origin === 'http://127.0.0.1:' + port);
    const code = input.ticket.slice(-43);
    requireCondition(input.ticket === 'ACPAIR1:' + port + ':' + code && /^[A-Za-z0-9_-]{43}$/.test(code));
    requireCondition(input.extensionId.length === 32 && /^[a-p]{32}$/.test(input.extensionId) &&
      !nonTestIds.has(input.extensionId));
    return { ...input, code };
  } finally {
    clearTimeout(timer);
  }
}

function absoluteLocalPath(value) {
  requireCondition(value && path.isAbsolute(value) && !/^[\\/]{2}|[\x00-\x1f]/.test(value) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value)));
  return path.resolve(value);
}

function below(root, child) {
  const relative = path.relative(root, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function existingDirectory(directory) {
  const real = await fs.realpath(directory);
  requireCondition(path.relative(directory, real) === '' && (await fs.lstat(directory)).isDirectory());
  return real;
}

async function scopedDirectories(input) {
  const root = await existingDirectory(absoluteLocalPath(process.env.AC_GUIDED_ROOT));
  requireCondition(root !== path.parse(root).root);
  const extension = absoluteLocalPath(input.extensionDir);
  const profile = absoluteLocalPath(input.profileDir);
  requireCondition(below(root, extension) && below(root, profile) && path.relative(extension, profile) !== '' &&
    !below(extension, profile) && !below(profile, extension) && !extension.includes(','));
  const extensionDir = await existingDirectory(extension);
  try {
    await fs.lstat(profile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await existingDirectory(path.dirname(profile));
    await fs.mkdir(profile);
  }
  const profileDir = await existingDirectory(profile);
  requireCondition((await fs.readdir(profileDir)).length === 0);
  return { extensionDir, profileDir };
}

async function verifyTestManifest(extensionDir, extensionId) {
  const filename = path.join(extensionDir, 'manifest.json');
  const stat = await fs.lstat(filename);
  requireCondition(stat.isFile() && stat.size <= 64 * 1024);
  const manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
  requireCondition(manifest?.manifest_version === 3 && manifest.background?.service_worker === 'background.js' &&
    typeof manifest.key === 'string');
  const der = Buffer.from(manifest.key, 'base64');
  requireCondition(der.length > 0 && der.toString('base64') === manifest.key);
  const id = createHash('sha256').update(der).digest('hex').slice(0, 32)
    .replace(/./g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
  requireCondition(id === extensionId);
}

async function sessionNotStored(page, input) {
  return page.evaluate(async ({ origin, code, ticket }) => {
    const values = await Promise.all(['local', 'sync', 'session'].map(area => chrome.storage[area].get(null)));
    values.push(Object.entries(localStorage), Object.entries(sessionStorage));
    const serialized = JSON.stringify(values);
    return !serialized.includes(origin) && !serialized.includes(code) && !serialized.includes(ticket);
  }, { origin: input.origin, code: input.code, ticket: input.ticket });
}

async function main() {
  let context, failure;
  let phase = 'input';
  try {
    const input = await readInput();
    phase = 'scope';
    const { extensionDir, profileDir } = await scopedDirectories(input);
    phase = 'manifest';
    await verifyTestManifest(extensionDir, input.extensionId);

    phase = 'launch';
    requireCondition(process.env.PLAYWRIGHT_BROWSERS_PATH);
    // Protocol debug logs can include field values. Do not enable them in this helper.
    delete process.env.DEBUG;
    delete process.env.DEBUG_FILE;
    process.env.PWDEBUG = '0';
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      locale: 'en-US',
      timeout: 15000,
      args: [
        '--disable-background-networking', '--no-first-run', '--disable-quic',
        '--proxy-server=http://guided-browser.invalid:1',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--proxy-bypass-list=<-loopback>;' + new URL(input.origin).host,
        `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
      ],
    });
    context.setDefaultTimeout(5000);
    const extensionOrigin = 'chrome-extension://' + input.extensionId;
    const setupUrl = extensionOrigin + '/setup.html';
    const workerUrl = extensionOrigin + '/background.js';

    phase = 'identity';
    if (!context.serviceWorkers().some(worker => worker.url() === workerUrl)) {
      await context.waitForEvent('serviceworker', { predicate: worker => worker.url() === workerUrl, timeout: 10000 });
    }
    await context.route('**/*', route => {
      const request = route.request();
      const url = request.url();
      const method = request.method();
      if ((method === 'GET' && (url === setupUrl ||
          (url.startsWith(extensionOrigin + '/') && !request.isNavigationRequest()) ||
          (url === input.origin + '/embed' && request.isNavigationRequest()))) ||
          (method === 'POST' && url === input.origin + '/v1/signed-control' && request.resourceType() === 'fetch')) {
        return route.continue();
      }
      return route.abort();
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(setupUrl);
    requireCondition(page.url() === setupUrl && await page.evaluate(() => chrome.runtime.id) === input.extensionId);

    phase = 'setup';
    await page.locator('#target').selectOption('windows');
    await page.locator('#installOsWindows').click();
    await page.locator('#installConsent').check();
    await page.locator('#windowsStandaloneInstall > summary').click();
    await page.locator('#openWindowsLocalControls').click();
    const ticket = page.locator('#localControlTicket');
    const status = page.locator('#localControlStatus');
    const waitForStatus = (text, timeout) => status.and(page.getByText(text, { exact: true }))
      .waitFor({ state: 'visible', timeout });
    await ticket.fill(input.ticket);

    phase = 'pair';
    // The setup page exposes the buttons and ready state only after verifying the signed reply.
    await page.locator('#localControlForm button[type=submit]').click();
    await waitForStatus('Local runtime ready.', 12000);
    await page.locator('#localControlButtons').waitFor({ state: 'visible' });

    phase = 'pause';
    await page.locator('#localControlPause').click();
    await waitForStatus('Local runtime paused.', 35000);

    phase = 'reconnect';
    await page.locator('#localControlReconnect').click();
    await waitForStatus('Local runtime ready.', 35000);

    phase = 'persistence';
    requireCondition(await ticket.inputValue() === '' && await sessionNotStored(page, input));
    await page.reload();
    requireCondition(await ticket.inputValue() === '' &&
      await page.locator('#localControlFrame').getAttribute('src') === null &&
      await page.locator('#localControlButtons').isHidden() && await sessionNotStored(page, input));
  } catch (error) {
    failure = 'guided_browser_' + phase + (error?.name === 'TimeoutError' ? '_timeout' : '_failed');
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        failure ??= 'guided_browser_close_failed';
      }
    }
  }
  if (failure) {
    process.stderr.write(failure + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('guided_browser_pass\n');
  }
}

await main();
