import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWindowsSetupCommand } from '../setup-entry.js';

const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const origin = 'https://setup-fixture.invalid';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const otherExtensionId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const storeId = 'jpioilmpbolfokedaefmbfbjeaahfdkl';
const guidedCommand = id => String.raw`.\install.ps1 -InstallLocal -Consent accept-install -PromptForConnection -ExtensionId '${id}'`;
const entryMetadata = { format: 'agent-continue-windows-setup-entry', version: 1, releaseTag: 'v3.0.0',
  entryUrl: 'https://github.com/1235357/agent-continue/releases/download/v3.0.0/install.ps1',
  entrySha256: 'a'.repeat(64), sumsSha256: 'b'.repeat(64) };
const browserCommand = (id, scope = 'current-account', shell = 'browserPowerShell', setupId = undefined) =>
  buildWindowsSetupCommand({ extensionId: id, scope, shell, setupId, version: '3.0.0', entryMetadata });
const administratorCommand = (id, setupId) => browserCommand(id, 'administrator', 'browserPowerShell', setupId);
const targets = ['windows', 'macos', 'linux', 'linux-server'];
const resources = new Set(['setup.html', 'setup.js', 'setup-client.js', 'setup-handoff.js', 'setup-model.js', 'setup.css', 'devices.css',
  'setup-entry.js', 'setup-entry-release.js',
  'i18n.js', 'device-control.js', 'browser-wake.js', 'icons/icon-32.png', 'native/bootstrap/registration-status-view.mjs',
  'native/bootstrap/install-plan.mjs']);
const officialLinks = new Set([
  'https://github.com/1235357/agent-continue/releases',
  'https://chatgpt.com/plugins',
  'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels',
  'https://github.com/openai/tunnel-client',
  'https://github.com/wonderwhy-er/DesktopCommanderMCP',
  'https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/PRIVACY.md',
  'https://platform.openai.com/settings/organization/tunnels',
  'https://platform.openai.com/settings/organization/api-keys',
  'https://github.com/openai/tunnel-client/blob/master/docs/connectors.md',
  'https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging',
]);
const screenshotDir = process.env.SETUP_SCREENSHOT_DIR;
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + name); };
assert.match(extensionId, /^[a-p]{32}$/);
assert.match(otherExtensionId, /^[a-p]{32}$/);
assert.notEqual(extensionId, otherExtensionId);

for (const name of resources) {
  assert.ok((await fs.stat(path.join(root, name)).catch(() => null))?.isFile(), `Setup fixture input is missing: ${name}`);
}
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href) : await import('playwright');
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined });

function expectedRequest(target, id = extensionId) {
  return {
    format: 'agent-continue-device-setup', version: 1, target, extensionId: id,
    nativeHost: target === 'linux-server' ? null : 'com.agentcontinue.device_control',
  };
}

async function createFixture(options = {}) {
  const config = {
    runtimeId: Object.hasOwn(options, 'runtimeId') ? options.runtimeId : extensionId,
    uiLanguage: options.uiLanguage, granted: options.granted ?? false,
    permissionFailure: options.permissionFailure ?? false,
    nativeStatus: options.nativeStatus ?? false,
    clipboardMode: options.clipboardMode ?? 'forbidden',
    installConsent: options.installConsent === true,
    deferConsentRead: options.deferConsentRead === true,
    setupMode: options.setupMode ?? 'missing',
  };
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1100, height: 820 }, locale: 'zh-CN',
    colorScheme: options.colorScheme || 'light', acceptDownloads: true, serviceWorkers: 'block',
  });
  const fixture = { context, page: null, errors: [], network: [], downloads: [], popups: [] };
  context.setDefaultTimeout(5000);
  context.on('page', page => { if (fixture.page && page !== fixture.page) fixture.popups.push(page.url()); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(1);
    if (url.origin !== origin || url.search || route.request().method() !== 'GET' || !resources.has(name)) {
      fixture.network.push(route.request().url());
      await route.abort();
      return;
    }
    try {
      const contentType = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css'
        : name.endsWith('.png') ? 'image/png' : 'application/javascript';
      await route.fulfill({ status: 200, contentType, body: name === 'setup-entry-release.js'
        ? `export const SETUP_ENTRY_RELEASE = Object.freeze(${JSON.stringify(options.noEntryMetadata ? null : entryMetadata)});`
        : await fs.readFile(path.join(root, name)) });
    } catch (error) {
      fixture.errors.push(`Cannot serve ${name}: ${error.message}`);
      await route.abort();
    }
  });
  await context.addInitScript(({ runtimeId, uiLanguage, granted, permissionFailure, nativeStatus, clipboardMode, installConsent, deferConsentRead, setupMode, fixtureOrigin }) => {
    const clone = value => structuredClone(value);
    const mock = {
      data: { ...(uiLanguage ? { uiLanguage } : {}), ...(installConsent ? { installConsent } : {}), schedulerPrompt: 'SYNTHETIC_PRIVATE_PROMPT', runtimeKey: 'SYNTHETIC_PRIVATE_KEY' },
      granted, permissionFailure, reads: [], writes: [], permissionChecks: [], forbidden: [],
      objectURLs: [], revokedURLs: [], exportClicks: [], exportGestures: [],
      languageListeners: [], addedListeners: [], removedListeners: [],
      nativeCalls: [], nativeMode: 'ready', clipboardWrites: [],
      setupMode, setupMessages: [], permissionRequests: [],
    };
    globalThis.__setupMock = mock;
    const forbid = name => (...args) => {
      mock.forbidden.push(name);
      throw new Error(`Forbidden synthetic setup operation: ${name}`);
    };
    const emit = (listeners, value) => { for (const listener of [...listeners]) listener(clone(value)); };
    const event = listeners => ({
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) { const index = listeners.indexOf(listener); if (index !== -1) listeners.splice(index, 1); },
    });
    const allowedStorageKeys = keys => Array.isArray(keys) && keys.length > 0
      && keys.every(key => ['uiLanguage', 'installConsent'].includes(key));
    const runtime = {
      getManifest: () => ({ version: '3.0.0' }),
      async sendMessage(message) {
        const { type, setupId } = message ?? {};
        if (Object.keys(message ?? {}).sort().join(',') !== 'setupId,type' ||
            !/^WINDOWS_INSTALLATION_(BEGIN|OBSERVE|CONNECT|CANCEL)_V1$/.test(type) ||
            typeof setupId !== 'string' || setupId.length !== 32 || !/^[a-f0-9]{32}$/.test(setupId)) {
          return forbid('unrelated runtime.sendMessage')();
        }
        if (type.endsWith('BEGIN_V1') && (!mock.granted ||
            !document.getElementById('installConsent').checked ||
            document.getElementById('windowsAccessScope').value !== 'administrator')) {
          return forbid('unconsented setup Begin')();
        }
        mock.setupMessages.push(clone(message));
        const result = state => ({ setupId, state, receipt: null, operation: null });
        if (type.endsWith('CANCEL_V1')) return result('cancelled');
        if (mock.setupMode === 'missing') return null;
        if (type.endsWith('BEGIN_V1')) return { ...result('waiting'),
          ...(mock.setupMode === 'automatic' ? { automaticConnect: true } : {}) };
        if (mock.setupMode !== 'automatic') return forbid('automatic continuation without capability')();
        if (type.endsWith('OBSERVE_V1')) {
          if (mock.deferSetupObserve) await new Promise(resolve => { mock.finishSetupObserve = resolve; });
          return { ...result('installed'), receipt: {
            setupId: mock.invalidSetupReceipt ? '0'.repeat(32) : setupId,
            state: 'installed', bundleSha256: 'b'.repeat(64), target: 'c'.repeat(32) + ':idle',
          } };
        }
        if (mock.deferSetupConnect) await new Promise(resolve => { mock.finishSetupConnect = resolve; });
        return result(mock.setupConnectState ?? 'submitted');
      }, connect: forbid('runtime.connect'),
      sendNativeMessage: forbid('runtime.sendNativeMessage'), connectNative: forbid('runtime.connectNative'),
      getPlatformInfo: forbid('runtime.getPlatformInfo'),
      getURL(name) { return new URL(name, fixtureOrigin + '/').href; },
    };
    if (nativeStatus) {
      const reply = async (host, request) => {
        mock.nativeCalls.push({ host, request: clone(request) });
        if (!mock.granted || host !== 'com.agentcontinue.device_control' ||
          request.action !== 'status' || request.version !== 1) return forbid('invalid native status call')();
        const value = { ...request, ok: true, state: { connection: 'ready', paused: false } };
        if (mock.nativeMode === 'defer') return new Promise(resolve => { mock.finishNative = () => resolve(value); });
        if (mock.nativeMode === 'wrong-id') return { ...value, id: 'different-request' };
        if (mock.nativeMode === 'host-absent') throw new Error('Specified native messaging host not found.');
        if (mock.nativeMode === 'rejected') return { ...request, ok: false };
        if (mock.nativeMode === 'transport') throw new Error('SYNTHETIC_PRIVATE_TRANSPORT');
        return value;
      };
      runtime.sendNativeMessage = reply;
      runtime.connectNative = host => {
        const messages = [], disconnected = [];
        return {
          onMessage: event(messages), onDisconnect: event(disconnected), disconnect() {},
          postMessage(request) { reply(host, request).then(value => emit(messages, value), () => emit(disconnected)); },
        };
      };
    }
    if (runtimeId !== undefined) runtime.id = runtimeId;
    globalThis.chrome = {
      runtime,
      storage: {
        onChanged: event(mock.languageListeners),
        local: {
          async get(keys) {
            mock.reads.push(clone(keys));
            if (!allowedStorageKeys(keys)) return forbid('storage.local.get private keys')();
            if (deferConsentRead && keys.length === 1 && keys[0] === 'installConsent') {
              const snapshot = { installConsent: mock.data.installConsent === true };
              await new Promise(resolve => { mock.finishConsentRead = resolve; });
              return snapshot;
            }
            return Object.fromEntries(keys.filter(key => Object.hasOwn(mock.data, key)).map(key => [key, mock.data[key]]));
          },
          async set(values) {
            mock.writes.push(clone(values));
            if (!values || Object.keys(values).length !== 1) {
              return forbid('storage.local.set non-allowlisted data')();
            }
            if (Object.hasOwn(values, 'installConsent')) {
              if (typeof values.installConsent !== 'boolean') return forbid('storage.local.set invalid consent')();
              mock.data.installConsent = values.installConsent;
              return;
            }
            if (!['en', 'zh_CN'].includes(values.uiLanguage)) {
              return forbid('storage.local.set non-language data')();
            }
            const oldValue = mock.data.uiLanguage;
            mock.data.uiLanguage = values.uiLanguage;
            for (const listener of [...mock.languageListeners]) {
              listener({ uiLanguage: { oldValue, newValue: values.uiLanguage } }, 'local');
            }
          },
          remove: forbid('storage.local.remove'), clear: forbid('storage.local.clear'),
        },
        sync: { get: forbid('storage.sync.get'), set: forbid('storage.sync.set') },
        session: { get: forbid('storage.session.get'), set: forbid('storage.session.set') },
      },
      permissions: {
        async contains(value) {
          mock.permissionChecks.push(clone(value));
          if (JSON.stringify(value) !== JSON.stringify({ permissions: ['nativeMessaging'] })) {
            return forbid('permissions.contains unrelated permissions')();
          }
          if (mock.permissionFailure) throw new Error('SYNTHETIC_PRIVATE_PERMISSION_FAILURE');
          return mock.granted;
        },
        async request(value) {
          const active = navigator.userActivation.isActive;
          if (!active || JSON.stringify(value) !== JSON.stringify({ permissions: ['nativeMessaging'] }) ||
              !document.getElementById('installConsent').checked ||
              document.getElementById('windowsAccessScope').value !== 'administrator') {
            return forbid('unconsented permissions.request')();
          }
          mock.permissionRequests.push({ value: clone(value), active });
          if (mock.denyPermission) return false;
          mock.granted = true;
          emit(mock.addedListeners, { permissions: ['nativeMessaging'] });
          return true;
        }, remove: forbid('permissions.remove'), getAll: forbid('permissions.getAll'),
        onAdded: event(mock.addedListeners), onRemoved: event(mock.removedListeners),
      },
      tabs: Object.fromEntries(['query', 'get', 'sendMessage', 'create', 'update', 'remove', 'executeScript'].map(name => [name, forbid('tabs.' + name)])),
      windows: { create: forbid('windows.create') },
      processes: Object.fromEntries(['getProcessInfo', 'getProcessIdForTab', 'terminate'].map(name => [name, forbid('processes.' + name)])),
      scripting: { executeScript: forbid('scripting.executeScript'), registerContentScripts: forbid('scripting.registerContentScripts') },
      alarms: Object.fromEntries(['create', 'clear', 'clearAll', 'get', 'getAll'].map(name => [name, forbid('alarms.' + name)])),
      downloads: { download: forbid('downloads.download') },
    };
    mock.changeLanguage = value => {
      const oldValue = mock.data.uiLanguage;
      mock.data.uiLanguage = value;
      for (const listener of [...mock.languageListeners]) listener({ uiLanguage: { oldValue, newValue: value } }, 'local');
    };
    mock.changePermission = value => {
      mock.granted = value;
      emit(value ? mock.addedListeners : mock.removedListeners, { permissions: ['nativeMessaging'] });
    };
    globalThis.fetch = forbid('fetch');
    globalThis.XMLHttpRequest = forbid('XMLHttpRequest');
    globalThis.WebSocket = forbid('WebSocket');
    globalThis.EventSource = forbid('EventSource');
    globalThis.Worker = forbid('Worker');
    globalThis.SharedWorker = forbid('SharedWorker');
    globalThis.open = forbid('window.open');
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: forbid('sendBeacon') });
    const clipboard = {
      ...Object.fromEntries(['read', 'readText', 'write'].map(name => [name, forbid('clipboard.' + name)])),
      writeText: clipboardMode === 'forbidden' ? forbid('clipboard.writeText') : async text => {
        mock.clipboardWrites.push({ text, active: navigator.userActivation.isActive });
        if (mock.deferClipboard) await new Promise((resolve, reject) => {
          mock.finishClipboard = () => mock.rejectClipboard ? reject(new Error('Synthetic clipboard denial')) : resolve();
        });
        if (clipboardMode === 'denied') throw new DOMException('Synthetic clipboard denial', 'NotAllowedError');
      },
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboardMode === 'missing' ? undefined : clipboard });
    document.execCommand = forbid('document.execCommand');
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[name] = forbid('Storage.' + name);
    indexedDB.open = forbid('indexedDB.open');
    indexedDB.deleteDatabase = forbid('indexedDB.deleteDatabase');
    const createURL = URL.createObjectURL.bind(URL);
    const revokeURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      if (!(blob instanceof Blob)) return forbid('non-Blob object URL')();
      const url = createURL(blob);
      mock.objectURLs.push({ url, blob });
      return url;
    };
    URL.revokeObjectURL = url => { mock.revokedURLs.push(url); revokeURL(url); };
    document.addEventListener('click', event => {
      const button = event.target.closest?.('#downloadSetup');
      if (button) mock.exportGestures.push({ trusted: event.isTrusted, consent: document.querySelector('#exportConsent')?.checked === true });
      const anchor = event.target.closest?.('a[download]');
      if (anchor) mock.exportClicks.push({ href: anchor.href, filename: anchor.download, active: navigator.userActivation.isActive });
    }, true);
  }, { ...config, fixtureOrigin: origin });
  try {
    fixture.page = await context.newPage();
    fixture.page.on('pageerror', error => fixture.errors.push(error.message));
    fixture.page.on('download', download => fixture.downloads.push(download));
    await fixture.page.goto(origin + '/setup.html' + (options.hash || ''));
    if (options.deferConsentRead) {
      await fixture.page.waitForFunction(() => typeof __setupMock.finishConsentRead === 'function');
      await fixture.page.evaluate(() => __setupMock.changeLanguage('zh_CN'));
    }
    await fixture.page.waitForFunction(() => document.getElementById('language')?.disabled === false);
    if (!options.deferConsentRead) await fixture.page.waitForFunction(() => globalThis.__setupMock?.permissionChecks.length > 0);
    return fixture;
  } catch (error) { await context.close(); throw error; }
}

async function assertUnverified(page) {
  const expected = await page.locator('html').getAttribute('lang') === 'zh-CN' ? '未验证' : 'Not verified';
  assert.equal(await page.locator('#installation-status').textContent(), expected);
  assert.equal(await page.locator('#chat-status').textContent(), expected);
}

async function assertSafety(fixture) {
  const state = await fixture.page.evaluate(() => ({
    forbidden: __setupMock.forbidden, reads: __setupMock.reads, writes: __setupMock.writes,
    permissionChecks: __setupMock.permissionChecks,
    permissionRequests: __setupMock.permissionRequests, setupMessages: __setupMock.setupMessages,
  }));
  assert.deepEqual(state.forbidden, [], 'no unapproved native, permission, chat, scheduler, credential, clipboard or network operations');
  assert.ok(state.reads.every(keys => Array.isArray(keys) && keys.length > 0
    && keys.every(key => ['uiLanguage', 'installConsent'].includes(key))));
  assert.ok(state.writes.every(value => Object.keys(value).length === 1
    && (['en', 'zh_CN'].includes(value.uiLanguage) || typeof value.installConsent === 'boolean')));
  assert.ok(state.permissionChecks.length > 0, 'permission is observed directly');
  for (const value of state.permissionChecks) assert.deepEqual(value, { permissions: ['nativeMessaging'] });
  for (const request of state.permissionRequests) assert.deepEqual(request,
    { value: { permissions: ['nativeMessaging'] }, active: true });
  for (const message of state.setupMessages) {
    assert.deepEqual(Object.keys(message).sort(), ['setupId', 'type']);
    assert.match(message.setupId, /^[a-f0-9]{32}$/);
  }
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(fixture.network, [], 'all requests stay within explicitly served synthetic resources');
  assert.deepEqual(fixture.popups, [], 'no automatic tabs/windows');
  assert.equal(fixture.context.pages().length, 1);
  assert.doesNotMatch(await fixture.page.locator('body').innerText(), /SYNTHETIC_PRIVATE_/);
  assert.doesNotMatch(await fixture.page.locator('body').textContent(), /SYNTHETIC_PRIVATE_/);
  await assertUnverified(fixture.page);
}

async function withFixture(options, run) {
  const fixture = await createFixture(options);
  try { await run(fixture); await assertSafety(fixture); }
  finally { await fixture.context.close(); }
}

async function effects(fixture) {
  return {
    ...await fixture.page.evaluate(() => ({ writes: __setupMock.writes.length, objectURLs: __setupMock.objectURLs.length,
      exportClicks: __setupMock.exportClicks.length, forbidden: [...__setupMock.forbidden] })),
    downloads: fixture.downloads.length, popups: fixture.popups.length,
  };
}

async function clipboardWrites(page) {
  return page.evaluate(() => __setupMock.clipboardWrites);
}

async function assertLinks(page) {
  const links = await page.locator('a[href]').evaluateAll(elements => elements.map(element => ({
    href: element.href, target: element.target, rel: element.rel, download: element.hasAttribute('download'),
  })));
  const external = [];
  for (const link of links) {
    const url = new URL(link.href);
    if (url.origin === origin) continue;
    assert.equal(url.protocol, 'https:');
    assert.ok(officialLinks.has(link.href), `unapproved official link: ${link.href}`);
    assert.equal(url.search, '', 'official links carry no query values');
    assert.equal(url.username + url.password + url.port, '');
    assert.equal(link.target, '_blank');
    assert.deepEqual(link.rel.split(/\s+/).filter(Boolean).sort(), ['noopener', 'noreferrer']);
    assert.equal(link.download, false, 'official documentation is not an installer download');
    assert.equal(link.href.includes(extensionId), false);
    external.push(link.href);
  }
  assert.deepEqual(external.sort(), [...officialLinks].sort());
  assert.equal(await page.locator('link[rel~="prefetch"],link[rel~="preconnect"],link[rel~="dns-prefetch"],link[rel~="prerender"],link[rel~="modulepreload"],script[type="speculationrules"]').count(), 0);
  assert.deepEqual(await page.locator('input:not([type="checkbox"]),textarea,[contenteditable="true"],iframe')
    .evaluateAll(elements => elements.map(element => element.id)), ['localControlTicket', 'localControlFrame']);
  assert.equal(await page.locator('#localControlFrame').getAttribute('src'), null);
}

async function openDetails(page, id) {
  if (!await page.locator('#' + id).evaluate(element => element.open)) {
    await page.locator('#' + id + ' > summary').click();
  }
}

async function assertPrimarySetupFlow(page) {
  const visibleControls = await page.locator('main button, main select, main input').evaluateAll(elements =>
    elements.filter(element => element.checkVisibility()).map(element => element.id));
  assert.deepEqual(visibleControls, ['windowsAccessScope', 'installConsent', 'copyWindowsBrowserPowerShell'],
    'the normal flow has one scope selector, consent and one copy action');
  for (const id of ['setupRisk', 'setupGrantBoundary', 'installDetection', 'openBrowserManagedDevices']) {
    assert.equal(await page.locator('#' + id).isVisible(), true, id + ' remains in the normal flow');
  }
  for (const id of ['windowsSetupSteps', 'windowsRunGuidance', 'windowsConnectGuidance', 'hosted-prepare-title',
    'windowsBrowserPowerShell', 'windowsBrowserCmd', 'localControlTicket', 'localControlReceipt', 'request-preview']) {
    assert.equal(await page.locator('#' + id).isVisible(), false, id + ' is disclosed only on demand');
  }
  assert.equal(await page.locator('#windowsSetupSteps').evaluate(element =>
    element.closest('details')?.id), 'windowsCommandDetails', 'manual prerequisites share the command disclosure');
  const status = page.locator('#installDetection');
  assert.equal(await status.count(), 1, 'there is one current result, not a stale duplicate');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('#detectInstall').getAttribute('aria-controls'), 'installDetection');
  assert.equal(await page.locator('#detectInstall').getAttribute('aria-describedby'), 'installDetection');
  assert.notEqual((await status.textContent()).trim(), '', 'the result has an honest initial state');
  const text = await page.locator('#installSection').innerText();
  assert.doesNotMatch(text, /tunnel ID|key-file path|runtime-key|REGISTER|ACPAIR1|YOUR_TUNNEL_ID|--setup-request|隧道 ID|密钥文件路径/i,
    'manual preparation and credentials are not part of the primary workflow');
}

async function chooseTarget(fixture, target) {
  const before = await effects(fixture);
  await openDetails(fixture.page, 'setupAdvanced');
  await fixture.page.locator('#target').selectOption(target);
  assert.deepEqual(await effects(fixture), before, 'target selection has no external or storage effects');
  if (target === 'windows') {
    assert.equal(await fixture.page.locator('#localControls').isVisible(), true);
    assert.equal(await fixture.page.locator('#localControls').getAttribute('href'), '#localControlDetails');
  } else assert.equal(await fixture.page.locator('#localControls').isVisible(), false);
  await assertUnverified(fixture.page);
}

async function openReview(fixture, target) {
  await openDetails(fixture.page, 'setupAdvanced');
  await fixture.page.locator('#reviewSetup').click();
  await fixture.page.locator('#setupReview').waitFor({ state: 'visible' });
  const preview = await fixture.page.locator('#request-preview').textContent();
  assert.deepEqual(JSON.parse(preview), expectedRequest(target));
  assert.equal(await fixture.page.locator('#exportConsent').isChecked(), false);
  assert.equal(await fixture.page.locator('#downloadSetup').isDisabled(), true);
  return preview;
}

async function waitForReviewClosed(page) {
  // dialog.close() and its cleanup event are not the same observation.
  await page.waitForFunction(() => !document.getElementById('setupReview').open &&
    !document.getElementById('exportConsent').checked && document.getElementById('downloadSetup').disabled &&
    document.getElementById('request-preview').textContent === '');
}

async function readDownload(download) {
  assert.equal(download.suggestedFilename(), 'agent-continue-setup-request.json');
  const stream = await download.createReadStream();
  assert.ok(stream, 'the actual browser download exposes readable bytes');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.length > 0 && bytes.length <= 4096);
  assert.equal(await download.failure(), null);
  return bytes.toString('utf8');
}

async function layout(page, colorScheme) {
  const result = await page.evaluate(() => {
    const visible = element => element.getClientRects().length > 0;
    const controls = [...document.querySelectorAll('button,select,input,pre')].filter(visible).filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1;
    }).map(element => element.id);
    const dialog = document.getElementById('setupReview');
    const rect = dialog.open ? dialog.getBoundingClientRect() : null;
    const bg = getComputedStyle(document.documentElement).backgroundColor;
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1, controls,
      dialogFits: !rect || (rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1),
      dark: matchMedia('(prefers-color-scheme: dark)').matches, bg,
      radii: [...document.querySelectorAll('section,button,dialog')].filter(visible)
        .filter(element => parseFloat(getComputedStyle(element).borderTopLeftRadius) > 8).map(element => element.id || element.tagName),
    };
  });
  assert.equal(result.overflow, false, 'no horizontal document overflow');
  assert.deepEqual(result.controls, [], 'controls and request text fit');
  assert.equal(result.dialogFits, true, 'review dialog stays inside the viewport');
  assert.deepEqual(result.radii, []);
  assert.equal(result.dark, colorScheme === 'dark');
  const rgb = result.bg.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  assert.ok(rgb, 'theme supplies a solid readable root background');
  const brightness = rgb.slice(1, 4).reduce((sum, value) => sum + Number(value), 0) / 3;
  assert.ok(colorScheme === 'dark' ? brightness < 100 : brightness > 180, `${colorScheme} theme background: ${result.bg}`);
}

async function capture(page, name, fullPage = true) {
  if (!screenshotDir) return;
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage });
}

async function probeQueuedCloseRace() {
  const results = [];
  await withFixture({}, async fixture => {
    const { page } = fixture;
    await openDetails(page, 'setupAdvanced');
    await chooseTarget(fixture, 'windows');
    await page.evaluate(() => {
      __setupMock.raceEvents = [];
      const snapshot = type => {
        const dialog = document.getElementById('setupReview');
        return {
          type, open: dialog.open, previewLength: document.getElementById('request-preview').textContent.length,
          consent: document.getElementById('exportConsent').checked,
          downloadDisabled: document.getElementById('downloadSetup').disabled,
          focus: document.activeElement?.id || '',
        };
      };
      __setupMock.raceSnapshot = snapshot;
      document.addEventListener('click', event => {
        const id = event.target.closest?.('#reviewSetup,#cancelSetup')?.id;
        if (id) __setupMock.raceEvents.push({ ...snapshot('click:' + id), trusted: event.isTrusted });
      });
      document.addEventListener('close', event => {
        if (event.target.id !== 'setupReview') return;
        __setupMock.raceEvents.push(snapshot('close:before-handler'));
      }, true);
      document.getElementById('setupReview').addEventListener('close', () => {
        __setupMock.raceEvents.push(snapshot('close:after-handler'));
      });
    });
    const before = await effects(fixture);
    for (const method of ['escape-enter', 'cancel-click-enter', 'cancel-click-review-click']) {
      let reopened = 0;
      let witness = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const reviewBox = await page.locator('#reviewSetup').boundingBox();
        await openReview(fixture, 'windows');
        const cancelBox = await page.locator('#cancelSetup').boundingBox();
        assert.ok(reviewBox && cancelBox);
        await page.evaluate(() => { __setupMock.raceEvents = []; });
        // Raw input avoids locator actionability's animation-frame wait between close and reopen.
        if (method === 'escape-enter') await page.keyboard.press('Escape');
        else await page.mouse.click(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
        if (method === 'cancel-click-review-click') {
          await page.mouse.click(reviewBox.x + reviewBox.width / 2, reviewBox.y + reviewBox.height / 2);
        } else await page.keyboard.press('Enter');
        await page.waitForFunction(() => __setupMock.raceEvents.some(event => event.type === 'close:after-handler'));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const observation = await page.evaluate(() => ({
          state: __setupMock.raceSnapshot('settled'), events: __setupMock.raceEvents,
          preview: document.getElementById('request-preview').textContent,
        }));
        const reviewClicks = observation.events.filter(event => event.type === 'click:reviewSetup');
        assert.equal(reviewClicks.length, 1, `${method} must actually reactivate Review with browser input`);
        assert.equal(reviewClicks[0].trusted, true);
        assert.equal(observation.state.open, true, `${method} must leave the reopened dialog visible`);
        reopened++;
        if (!observation.preview) {
          witness = { attempt: attempt + 1, state: observation.state, events: observation.events };
          await page.locator('#exportConsent').check();
          assert.equal(await page.locator('#downloadSetup').isDisabled(), true, 'lost review state fails closed');
        } else assert.deepEqual(JSON.parse(observation.preview), expectedRequest('windows'));
        await page.locator('#cancelSetup').click();
        await waitForReviewClosed(page);
        if (witness) break;
      }
      results.push({ method, reopened, witness });
    }
    assert.deepEqual(await effects(fixture), before, 'race attempts neither export nor acquire authority');
    await openReview(fixture, 'windows');
    await page.locator('#exportConsent').check();
    assert.equal(await page.locator('#downloadSetup').isEnabled(), true, 'normal close cleanup followed by fresh Review recovers');
    await page.locator('#cancelSetup').click();
    await waitForReviewClosed(page);
  });
  console.log('QUEUED_CLOSE_BROWSER_PROBE ' + JSON.stringify(results));
  assert.equal(results.filter(result => result.witness).length, 0,
    'trusted browser close/reopen must not let a queued old close callback erase the new review');
  pass('trusted keyboard/pointer close-reopen paths preserve fresh review state and fresh-consent export reachability');
}

try {
  if (process.env.SETUP_RACE_PROBE_ONLY === '1') {
    await probeQueuedCloseRace();
    console.log(`Setup race probe: ${checks}/${checks} checks passed (synthetic browser only).`);
  } else {
  for (const backToStandard of [false, true]) {
    await withFixture({ installConsent: true, deferConsentRead: true }, async ({ page }) => {
      await page.locator('#windowsAccessScope').selectOption('administrator');
      if (backToStandard) await page.locator('#windowsAccessScope').selectOption('current-account');
      assert.equal(await page.locator('#installConsent').isChecked(), false);
      await page.evaluate(() => __setupMock.finishConsentRead());
      await page.waitForFunction(() => __setupMock.permissionChecks.length > 0);
      assert.equal(await page.locator('#installConsent').isChecked(), false, 'late saved consent cannot override a fresh scope decision');
      assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
      pass(`late saved consent cannot authorize ${backToStandard ? 'a changed-back standard scope' : 'an administrator scope'}`);
    });
  }
  for (const uiLanguage of ['en', 'zh_CN']) {
    await withFixture({ uiLanguage, installConsent: true, clipboardMode: 'allowed', nativeStatus: true, granted: true }, async fixture => {
      const { page } = fixture;
      const chinese = uiLanguage === 'zh_CN';
      const scope = page.locator('#windowsAccessScope');
      assert.equal(await scope.count(), 1, 'Windows access has one rendered scope selector');
      assert.equal(await scope.inputValue(), 'current-account');
      assert.equal(await scope.getAttribute('aria-describedby'), 'setupRisk setupGrantBoundary');
      assert.deepEqual(await scope.locator('option').allTextContents(), chinese
        ? ['当前账户', '管理员'] : ['Current account', 'Administrator']);
      const permissionChecks = await page.evaluate(() => __setupMock.permissionChecks.length);
      const unchangedCommands = await page.locator('#windowsNodeCommand, #windowsPowerShellCommand, #windowsCmdCommand').allTextContents();
      await page.locator('#copyWindowsBrowserPowerShell').click();
      assert.notEqual(await page.locator('#windowsBrowserPowerShellFeedback').textContent(), '');
      await scope.selectOption('administrator');
      assert.equal(await page.locator('#installConsent').isChecked(), false, 'stored standard consent cannot authorize administrator access');
      for (const id of ['copyWindowsBrowserPowerShell', 'copyWindowsBrowserCmd', 'copyWindowsGuidedCommand', 'copyWindowsGuidedCmdCommand']) {
        assert.equal(await page.locator('#' + id).isDisabled(), true, id + ' needs new scope consent');
      }
      assert.equal(await page.locator('#windowsBrowserPowerShellFeedback').textContent(), '');
      assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), '');
      await page.locator('#language').selectOption(chinese ? 'en' : 'zh_CN');
      assert.equal(await page.locator('#installConsent').isChecked(), false, 'translation cannot restore stored consent for administrator scope');
      assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
      await page.locator('#language').selectOption(uiLanguage);
      assert.match(await page.locator('#setupRisk').innerText(), chinese ? /管理员.*安装和连接.*分别.*UAC/ : /administrator.*installation and connection.*separate Windows approvals.*UAC/i);
      await openDetails(page, 'windowsCommandDetails');
      assert.match(await page.locator('#windowsSetupSteps').innerText(), chinese ? /设备页.*连接/ : /Devices[\s\S]*Connect/);
      assert.doesNotMatch(await page.locator('#windowsSetupSteps').innerText(), /\bREGISTER\b/);
      assert.equal(await page.locator('#windowsStandaloneInstall').isVisible(), false, 'current-account fallback is not an administrator route');
      assert.equal(await page.locator('#windowsBrowserRecovery').isVisible(), false, 'current-account recovery is not administrator recovery');
      await page.locator('#installConsent').check();
      assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), administratorCommand(extensionId));
      assert.equal(await page.locator('#windowsBrowserCmd').textContent(), browserCommand(extensionId, 'administrator', 'browserCmd'));
      assert.equal(await page.evaluate(() => __setupMock.data.installConsent), false, 'administrator consent is never saved as standard consent');
      assert.equal((await clipboardWrites(page)).length, 1, 'scope, language and consent changes never copy a command');
      const beforeCopy = await effects(fixture);
      await page.locator('#copyWindowsBrowserPowerShell').click();
      await page.waitForFunction(() => __setupMock.clipboardWrites.length === 2 && document.getElementById('installFeedback').textContent !== '');
      assert.deepEqual((await clipboardWrites(page)).at(-1), { text: administratorCommand(extensionId), active: true });
      await openDetails(page, 'windowsBrowserCmdDetails');
      assert.equal(await page.locator('#copyWindowsBrowserCmd').isDisabled(), true, 'an unknown Begin locks this document rather than creating another ID');
      assert.equal((await clipboardWrites(page)).length, 2);
      for (const language of [chinese ? 'en' : 'zh_CN', uiLanguage]) {
        await page.locator('#language').selectOption(language);
        assert.equal(await scope.inputValue(), 'administrator');
        assert.equal(await page.locator('#installConsent').isChecked(), true);
        assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), administratorCommand(extensionId));
        assert.match(await page.locator('#windowsBrowserPowerShellFeedback').textContent(), language === 'en' ? /unconfirmed.*no retry/ : /未确认.*不会重试/);
        assert.match(await page.locator('#windowsCommandScope').textContent(), language === 'en' ? /installation and connection.*separate Windows approvals.*UAC/i : /安装和连接.*分别.*UAC/);
        assert.match(await page.locator('#windowsSetupSteps').innerText(), language === 'en' ? /request does not mean ready/ : /请求不代表就绪/);
        assert.match(await page.locator('#availability').innerText(), language === 'en' ? /source candidate.*no released installer/ : /源码候选.*尚无已发布安装器/);
      }
      assert.deepEqual({ ...await effects(fixture), writes: beforeCopy.writes }, beforeCopy, 'copy and translation do not export or launch anything');
      await scope.selectOption('current-account');
      assert.equal(await page.locator('#installConsent').isChecked(), false, 'returning to standard scope also needs fresh consent');
      assert.equal(await page.locator('#windowsBrowserCmdFeedback').textContent(), '');
      assert.equal(await page.locator('#windowsBrowserPowerShellFeedback').textContent(), '');
      await page.locator('#installConsent').check();
      assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), browserCommand(extensionId));
      assert.equal(await page.locator('#windowsGuidedCommand').textContent(), guidedCommand(extensionId));
      assert.deepEqual(await page.locator('#windowsNodeCommand, #windowsPowerShellCommand, #windowsCmdCommand').allTextContents(), unchangedCommands);
      await scope.selectOption('administrator');
      assert.equal(await page.locator('#installConsent').isChecked(), false, 'a second administrator selection cannot revive earlier consent');
      assert.equal(await page.evaluate(() => __setupMock.permissionChecks.length), permissionChecks + 1, 'only the explicit administrator Copy rechecks browser permission');
      assert.deepEqual(await page.evaluate(() => __setupMock.permissionRequests), [], 'an existing permission does not trigger a browser UI request');
      assert.deepEqual(await page.evaluate(() => __setupMock.setupMessages.map(value => value.type)),
        ['WINDOWS_INSTALLATION_BEGIN_V1', 'WINDOWS_INSTALLATION_CANCEL_V1']);
      assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
      assert.deepEqual(await page.evaluate(() => __setupMock.writes.filter(value => !Object.hasOwn(value, 'uiLanguage'))),
        [{ installConsent: false }, { installConsent: false }, { installConsent: false }, { installConsent: true }, { installConsent: false }]);
      assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
      pass(`${uiLanguage}: administrator commands require fresh scope consent, translate without changing authority and leave standard commands intact`);
    });
  }
  await withFixture({ clipboardMode: 'allowed', nativeStatus: true, granted: true }, async fixture => {
    const { page } = fixture;
    await page.locator('#windowsAccessScope').selectOption('administrator');
    await page.locator('#installConsent').check();
    await page.locator('#copyWindowsBrowserPowerShell').evaluate(button => button.click());
    assert.deepEqual(await clipboardWrites(page), [], 'synthetic clicks cannot copy administrator commands');
    await page.evaluate(id => { chrome.runtime.id = id; }, otherExtensionId);
    await page.locator('#copyWindowsBrowserPowerShell').click();
    assert.deepEqual(await clipboardWrites(page), [], 'identity drift refreshes the preview without copying a stale administrator binding');
    assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), administratorCommand(otherExtensionId));
    const before = await effects(fixture);
    await page.locator('#copyWindowsBrowserPowerShell').click();
    await page.waitForFunction(() => __setupMock.clipboardWrites.length === 1 && document.getElementById('copyWindowsBrowserPowerShell').disabled);
    assert.deepEqual(await clipboardWrites(page), [{ text: administratorCommand(otherExtensionId), active: true }]);
    await page.evaluate(() => { chrome.runtime.id = 'invalid'; });
    await page.locator('#language').selectOption('zh_CN');
    assert.equal((await clipboardWrites(page)).length, 1, 'invalid identity never copies or falls back to the store ID');
    assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), '');
    assert.equal(await page.locator('#windowsBrowserCmd').textContent(), '');
    assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
    assert.equal(await page.locator('#copyWindowsBrowserCmd').isDisabled(), true);
    assert.equal(await page.locator('#windowsBrowserPowerShellFeedback').textContent(), '');
    assert.deepEqual({ ...await effects(fixture), writes: before.writes }, before);
    assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
    pass('administrator copy requires a trusted gesture and the exact current runtime identity; drift and malformed identity never copy stale scope');
  });
  for (const rejectClipboard of [false, true]) {
    await withFixture({ clipboardMode: 'allowed' }, async ({ page }) => {
      await page.locator('#installConsent').check();
      await page.evaluate(reject => { __setupMock.deferClipboard = true; __setupMock.rejectClipboard = reject; }, rejectClipboard);
      await page.locator('#copyWindowsBrowserPowerShell').click();
      await page.waitForFunction(() => typeof __setupMock.finishClipboard === 'function');
      await page.locator('#windowsAccessScope').selectOption('administrator');
      await page.locator('#installConsent').check();
      await page.evaluate(() => __setupMock.finishClipboard());
      assert.equal(await page.locator('#windowsBrowserPowerShellFeedback').textContent(), '', 'late clipboard completion cannot restore old-scope feedback');
      assert.equal(await page.locator('#windowsCommandDetails').evaluate(element => element.open), false, 'stale clipboard failure cannot reveal the new scope command');
      assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), administratorCommand(extensionId));
      pass(`scope change invalidates a pending clipboard ${rejectClipboard ? 'failure' : 'success'}`);
    });
  }
  for (const granted of [false, true]) {
    await withFixture({ granted, setupMode: 'automatic', clipboardMode: 'allowed', uiLanguage: 'en' }, async fixture => {
      const { page } = fixture;
      assert.deepEqual(await page.evaluate(() => [__setupMock.setupMessages, __setupMock.permissionRequests]), [[], []]);
      await page.locator('#windowsAccessScope').selectOption('administrator');
      assert.deepEqual(await page.evaluate(() => [__setupMock.setupMessages, __setupMock.permissionRequests]), [[], []]);
      assert.match(await page.locator('#setupRisk').innerText(), /installation and connection.*separate Windows approvals/i);
      assert.match(await page.locator('#setupGrantBoundary').innerText(), /request one connection after installation.*withdrawing consent cancels/i);
      await page.locator('#installConsent').check();
      assert.deepEqual(await page.evaluate(() => [__setupMock.setupMessages, __setupMock.permissionRequests]), [[], []]);
      await page.locator('#copyWindowsBrowserPowerShell').click();
      await page.waitForFunction(() => /Connection requested; readiness is unconfirmed/.test(document.getElementById('installFeedback').textContent));
      const messages = await page.evaluate(() => __setupMock.setupMessages);
      assert.deepEqual(messages.map(value => value.type), ['BEGIN', 'OBSERVE', 'CONNECT'].map(name => `WINDOWS_INSTALLATION_${name}_V1`));
      const setupId = messages[0].setupId;
      assert.ok(messages.every(value => value.setupId === setupId));
      assert.deepEqual(await clipboardWrites(page), [{ text: administratorCommand(extensionId, setupId), active: true }]);
      assert.equal(await page.evaluate(() => __setupMock.permissionRequests.length), granted ? 0 : 1);
      assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), [], 'the page only sends the worker protocol, never native directly');
      assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
      await page.locator('#copyWindowsBrowserPowerShell').evaluate(button => button.click());
      assert.deepEqual(await page.evaluate(() => __setupMock.setupMessages), messages, 'a repeated or synthetic click cannot replay Connect');
      await page.locator('#language').selectOption('zh_CN');
      assert.match(await page.locator('#installFeedback').innerText(), /已请求连接.*尚未确认/);
      assert.match(await page.locator('#setupRisk').innerText(), /安装和连接.*分别.*Windows/);
      await page.locator('#installConsent').uncheck();
      await page.waitForFunction(() => __setupMock.setupMessages.at(-1).type === 'WINDOWS_INSTALLATION_CANCEL_V1');
      assert.match(await page.locator('#installFeedback').innerText(), /已取消.*已提交的操作仍可能完成/);
      assert.equal(await page.evaluate(() => __setupMock.setupMessages.filter(value => value.type.endsWith('CONNECT_V1')).length), 1);
      pass(`administrator automatic setup uses one document ID and one requested-not-ready Connect with permission ${granted ? 'already granted' : 'requested only by Copy'}`);
    });
  }
  for (const uiLanguage of ['en', 'zh_CN']) {
    const installationVerified = uiLanguage === 'en'
      ? 'Installation verified; connection readiness is unconfirmed. Authorize ChatGPT and Dot separately.'
      : '安装已验证；连接就绪尚未确认。ChatGPT 和 Dot 仍需分别授权。';
    for (const connectState of ['submitted', 'unconfirmed', 'cancelled']) {
      await withFixture({ granted: true, setupMode: 'automatic', clipboardMode: 'allowed', uiLanguage,
        viewport: { width: 320, height: 600 } }, async fixture => {
        const { page } = fixture;
        const initialResult = await page.locator('#installDetection').textContent();
        await page.locator('#windowsAccessScope').selectOption('administrator');
        await page.locator('#installConsent').check();
        await page.evaluate(state => {
          __setupMock.deferSetupObserve = true;
          __setupMock.deferSetupConnect = true;
          __setupMock.setupConnectState = state;
        }, connectState);
        await page.locator('#copyWindowsBrowserPowerShell').click();
        await page.waitForFunction(() => typeof __setupMock.finishSetupObserve === 'function');
        assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'waiting for a receipt is not installation proof');
        await page.evaluate(() => __setupMock.finishSetupObserve());
        await page.waitForFunction(() => typeof __setupMock.finishSetupConnect === 'function');
        assert.equal(await page.locator('#installDetection').textContent(), installationVerified, 'connecting shows installation proof, not readiness');
        await assertPrimarySetupFlow(page);
        await layout(page, 'light');
        await assertUnverified(page);
        const messages = await page.evaluate(() => __setupMock.setupMessages);
        assert.deepEqual(messages.map(value => value.type), ['BEGIN', 'OBSERVE', 'CONNECT'].map(name => `WINDOWS_INSTALLATION_${name}_V1`));
        const before = await effects(fixture);
        await page.evaluate(() => __setupMock.finishSetupConnect());
        const expectedFeedback = connectState === 'submitted' ? /Connection requested|已请求连接/
          : connectState === 'cancelled' ? /intent.*cancelled|意图已取消/ : /Installation or connection is unconfirmed|安装或连接结果未确认/;
        await page.waitForFunction(pattern => new RegExp(pattern).test(document.getElementById('installFeedback').textContent), expectedFeedback.source);
        for (const language of [uiLanguage === 'en' ? 'zh_CN' : 'en', uiLanguage]) {
          await page.evaluate(value => __setupMock.changeLanguage(value), language);
          const verified = language === 'en'
            ? 'Installation verified; connection readiness is unconfirmed. Authorize ChatGPT and Dot separately.'
            : '安装已验证；连接就绪尚未确认。ChatGPT 和 Dot 仍需分别授权。';
          const unchecked = language === 'en' ? 'Not checked yet.' : '尚未检测。';
          assert.equal(await page.locator('#installDetection').textContent(), connectState === 'submitted' ? verified : unchecked,
            'only connecting/requested can show this installation proof, including after a language rerender');
          assert.equal(await page.locator('#managementConnection').textContent(), language === 'en' ? 'Unknown' : '未知');
          await assertUnverified(page);
        }
        assert.deepEqual(await effects(fixture), before, 'feedback rendering has no additional effects');
        assert.deepEqual(await page.evaluate(() => __setupMock.setupMessages), messages, 'rendering never polls, connects or replays');
        assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
        if (connectState === 'submitted') {
          await page.locator('#installConsent').uncheck();
          assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'cancellation clears installation proof from the view');
          await page.locator('#windowsAccessScope').selectOption('current-account');
          assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'standard scope never inherits automatic setup proof');
        }
        pass(`${uiLanguage}: connecting then ${connectState} keeps installation, readiness and chat authorization distinct without new effects`);
      });
    }
    for (const scenario of ['manual', 'unconfirmed', 'copy-failed', 'permission-denied', 'invalid-receipt']) {
      await withFixture({ granted: scenario !== 'permission-denied', uiLanguage,
        setupMode: scenario === 'manual' ? 'legacy' : scenario === 'unconfirmed' ? 'missing' : 'automatic',
        clipboardMode: scenario === 'copy-failed' ? 'denied' : 'allowed' }, async ({ page }) => {
        const initialResult = await page.locator('#installDetection').textContent();
        await page.locator('#windowsAccessScope').selectOption('administrator');
        await page.locator('#installConsent').check();
        await page.evaluate(value => {
          __setupMock.denyPermission = value === 'permission-denied';
          __setupMock.invalidSetupReceipt = value === 'invalid-receipt';
          __setupMock.deferClipboard = value !== 'permission-denied';
        }, scenario);
        await page.locator('#copyWindowsBrowserPowerShell').click();
        if (scenario !== 'permission-denied') {
          await page.waitForFunction(() => typeof __setupMock.finishClipboard === 'function');
          assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'preparing is not installation proof');
          await page.evaluate(() => __setupMock.finishClipboard());
        }
        const feedback = scenario === 'manual' ? /does not support automatic connection|不支持本页自动连接/
          : scenario === 'copy-failed' ? /Automatic copy failed|自动复制失败/
            : scenario === 'permission-denied' ? /permission was not granted|未获得浏览器本机通信权限/
              : /Installation or connection is unconfirmed|安装或连接结果未确认/;
        await page.waitForFunction(pattern => new RegExp(pattern).test(document.getElementById('installFeedback').textContent), feedback.source);
        assert.equal(await page.locator('#installDetection').textContent(), initialResult, scenario + ' must not claim verified installation');
        assert.equal(await page.evaluate(() => __setupMock.setupMessages.filter(value => value.type.endsWith('CONNECT_V1')).length), 0);
        assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
      });
    }
    pass(`${uiLanguage}: preparing, manual fallback, missing/invalid receipt, copy failure and permission denial never claim installation proof`);
  }
  await withFixture({ granted: true, setupMode: 'legacy', clipboardMode: 'allowed', uiLanguage: 'en' }, async ({ page }) => {
    await page.locator('#windowsAccessScope').selectOption('administrator');
    await page.locator('#installConsent').check();
    await page.locator('#copyWindowsBrowserCmd').evaluate(button => button.click());
    assert.deepEqual(await page.evaluate(() => __setupMock.setupMessages), [], 'an untrusted CMD click cannot begin');
    await openDetails(page, 'windowsBrowserCmdDetails');
    await page.locator('#copyWindowsBrowserCmd').click();
    await page.waitForFunction(() => /does not support automatic connection/.test(document.getElementById('installFeedback').textContent));
    assert.deepEqual(await clipboardWrites(page), [{ text: browserCommand(extensionId, 'administrator', 'browserCmd'), active: true }]);
    assert.deepEqual(await page.evaluate(() => __setupMock.setupMessages.map(value => value.type)),
      ['WINDOWS_INSTALLATION_BEGIN_V1', 'WINDOWS_INSTALLATION_CANCEL_V1']);
    assert.deepEqual(await page.evaluate(() => __setupMock.permissionRequests), []);
    pass('legacy worker waiting without capability copies a manual CMD command without polling or Connect');
  });
  for (const uiLanguage of ['en', 'zh_CN']) {
    for (const colorScheme of ['light', 'dark']) {
      for (const typography of ['monospace', 'wide-fallback']) {
        await withFixture({ uiLanguage, colorScheme, viewport: { width: 320, height: 600 }, granted: true, nativeStatus: true }, async ({ page }) => {
          // Load an actual wider face so Windows also exercises Linux-like extra wrapping.
          await page.addStyleTag({ content: typography === 'monospace' ? ':root { font-family: monospace; }' : `
            @font-face {
              font-family: "Setup wide fallback";
              src: local("DejaVu Sans Mono"), local("Liberation Mono"), local("Courier New");
              size-adjust: 105%;
            }
            :root { font-family: "Setup wide fallback", monospace; }
          ` });
          if (typography === 'wide-fallback') {
            const loaded = await page.evaluate(async () => {
              const faces = await document.fonts.load('14px "Setup wide fallback"');
              return faces.length > 0 && faces.every(face => face.status === 'loaded');
            });
            assert.equal(loaded, true, 'the wider fallback face must load, not silently use the generic font');
          }
          await page.evaluate(() => document.fonts.ready);
          for (const scope of ['administrator', 'current-account']) {
            await page.locator('#windowsAccessScope').selectOption(scope);
            await assertPrimarySetupFlow(page);
            assert.equal(await page.locator('#setupAdvanced').evaluate(element => element.open), false);
            const screen = await page.evaluate(() => ({
              width: innerWidth, height: innerHeight, scrollY,
              bounds: ['setupRisk', 'setupGrantBoundary', 'installConsentLabel', 'copyWindowsBrowserPowerShell'].map(id => {
                const { top, bottom, left, right, height } = document.getElementById(id).getBoundingClientRect();
                return { id, top, bottom, left, right, height };
              }),
            }));
            assert.equal(screen.scrollY, 0, 'the compact flow fits without scrolling');
            for (const [index, bounds] of screen.bounds.entries()) {
              assert.ok(bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= screen.height &&
                bounds.left >= 0 && bounds.right <= screen.width,
              `${uiLanguage} ${colorScheme} ${scope} ${typography}: complete risk, boundary, consent and Copy fit with fallback typography: ${JSON.stringify(screen)}`);
              if (index > 0) assert.ok(screen.bounds[index - 1].bottom <= bounds.top, 'consent-first content never overlaps');
            }
            assert.ok(screen.bounds.at(-1).height >= 44, 'Copy keeps its full-size hit target');
            for (const id of ['language', 'windowsAccessScope']) {
              assert.ok(await page.locator('#' + id).evaluate(element => element.getBoundingClientRect().height >= 44),
                id + ' keeps its full-size hit target');
            }
            for (const id of ['setupRisk', 'setupGrantBoundary', 'installConsentLabel', 'copyWindowsBrowserPowerShell']) {
              assert.equal(await page.locator('#' + id).evaluate(element => {
                const text = element.querySelector('span') || element;
                const range = document.createRange();
                range.selectNodeContents(text);
                const bounds = element.getBoundingClientRect();
                return element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1 &&
                  [...range.getClientRects()].every(rect => rect.top >= bounds.top && rect.bottom <= bounds.bottom &&
                    rect.left >= bounds.left && rect.right <= bounds.right);
              }), true, id + ' shows its complete text without clipping');
            }
            await layout(page, colorScheme);
            await capture(page, `setup-compact-${uiLanguage}-${colorScheme}-${typography}-${scope}.png`, false);
            console.log('SETUP_COMPACT_VIEWPORT ' + JSON.stringify({ uiLanguage, colorScheme, scope, typography, ...screen }));
          }
          pass(`320x600 ${uiLanguage} ${colorScheme} ${typography}: both Windows scopes fit full risk, consent and Copy without scrolling or expanding Advanced`);
        });
      }
    }
  }
  for (const uiLanguage of ['en', 'zh_CN']) {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [{ width: 1100, height: 820 }, { width: 320, height: 600 }]) {
        await withFixture({ uiLanguage, colorScheme, viewport, clipboardMode: 'allowed', nativeStatus: true, granted: true }, async fixture => {
          const { page } = fixture;
          assert.equal(await page.locator('#target').inputValue(), 'windows');
          assert.equal(await page.locator('#installOsWindows').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('#installConsent').isChecked(), false);
          assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isVisible(), true);
          assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
          assert.equal(await page.locator('#windowsSetupSteps > li').count(), 3);
          await assertPrimarySetupFlow(page);
          for (const id of ['setupAdvanced', 'setupResources', 'localControlDetails', 'windowsCommandDetails', 'windowsBrowserCmdDetails', 'windowsStandaloneInstall', 'windowsBrowserRecovery', 'windowsInstallCheck']) {
            assert.equal(await page.locator('#' + id).evaluate(element => element.open), false, id + ' starts collapsed');
          }
          assert.equal(await page.locator('#managementSection summary').isVisible(), true, 'existing loopback entry remains directly reachable');
          for (const id of ['reviewSetup', 'target', 'windowsNodeCommand', 'windowsReleaseCheck', 'windowsInstallerStatusCommand']) {
            assert.equal(await page.locator('#' + id).isVisible(), false, id + ' is outside the normal flow');
          }
          const firstScreen = await page.evaluate(() => {
            const bottom = id => document.getElementById(id).getBoundingClientRect().bottom;
            return { risk: bottom('setupRisk'), consent: bottom('installConsentLabel'), copy: bottom('copyWindowsBrowserPowerShell'), height: innerHeight };
          });
          assert.ok(firstScreen.risk < firstScreen.consent && firstScreen.consent < firstScreen.copy);
          assert.ok(firstScreen.copy <= firstScreen.height, 'risk, consent and primary action fit the first viewport: ' + JSON.stringify(firstScreen));
          const text = await page.locator('#installSection').innerText();
          assert.match(text, uiLanguage === 'en' ? /source candidate.*no released installer/ : /源码候选.*尚无已发布安装器/);
          assert.doesNotMatch(text, uiLanguage === 'en' ? /reviewed, extracted setup source bundle/ : /已审阅并解压的安装源码包/);
          assert.doesNotMatch(text, /SHA-256|OperationId|operation ID|ACPAIR1|YOUR_TUNNEL_ID|--setup-request/);
          assert.deepEqual(await effects(fixture), { writes: 0, objectURLs: 0, exportClicks: 0, forbidden: [], downloads: 0, popups: 0 });
          assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
          assert.deepEqual(await clipboardWrites(page), []);
          await layout(page, colorScheme);
          await capture(page, `setup-simple-${uiLanguage}-${colorScheme}-${viewport.width}.png`);
          const initialResult = await page.locator('#installDetection').textContent();
          await page.locator('#installConsent').check();
          await page.locator('#copyWindowsBrowserPowerShell').click();
          await page.waitForFunction(() => __setupMock.clipboardWrites.length === 1 && document.getElementById('windowsBrowserPowerShellFeedback').textContent !== '');
          await assertPrimarySetupFlow(page);
          assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'standard copying never invents installation progress');
          assert.deepEqual((await clipboardWrites(page)).at(-1), {
            text: browserCommand(extensionId), active: true,
          });
          await page.locator('#windowsAccessScope').selectOption('administrator');
          assert.equal(await page.locator('#installConsent').isChecked(), false);
          assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
          const administratorScreen = await page.evaluate(() => ({
            copy: document.getElementById('copyWindowsBrowserPowerShell').getBoundingClientRect().bottom, height: innerHeight,
          }));
          await capture(page, `setup-administrator-${uiLanguage}-${colorScheme}-${viewport.width}.png`);
          assert.ok(administratorScreen.copy <= administratorScreen.height, 'administrator risk, consent and copy fit the first viewport: ' + JSON.stringify(administratorScreen));
          await layout(page, colorScheme);
          await page.locator('#installConsent').check();
          await page.locator('#copyWindowsBrowserPowerShell').click();
          await page.waitForFunction(() => __setupMock.clipboardWrites.length === 2 &&
            /unconfirmed|未确认/.test(document.getElementById('windowsBrowserPowerShellFeedback').textContent));
          await assertPrimarySetupFlow(page);
          assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'copying never invents installation progress');
          assert.equal(await page.locator('#windowsBrowserPowerShellFeedback').isVisible(), true, 'copy result remains visible');
          assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), [], 'an unsupported worker cannot probe native state or connect');
          assert.deepEqual((await clipboardWrites(page)).at(-1), { text: administratorCommand(extensionId), active: true });
          const before = await effects(fixture);
          await page.locator('#windowsCommandDetails > summary').press('Enter');
          assert.equal(await page.locator('#windowsSetupSteps').isVisible(), true, 'manual setup is keyboard reachable');
          await page.locator('a[href="#hosted-prepare-title"]').click();
          assert.equal(await page.locator('#setupAdvanced').evaluate(element => element.open), true);
          assert.equal(await page.locator('#hosted-prepare-title').isVisible(), true);
          assert.deepEqual(await effects(fixture), before, 'opening preparation instructions has no side effects');
        });
        pass(`${uiLanguage} ${colorScheme} ${viewport.width}: both Windows scopes fit the consent-first viewport with collapsed advanced content and no install requests`);
      }
    }
  }
  await withFixture({ installConsent: true, nativeStatus: true, granted: true }, async fixture => {
    assert.equal(await fixture.page.locator('#copyWindowsBrowserPowerShell').isEnabled(), true);
    assert.deepEqual(await fixture.page.evaluate(() => __setupMock.nativeCalls), []);
    assert.deepEqual(await clipboardWrites(fixture.page), []);
    assert.deepEqual(await effects(fixture), { writes: 0, objectURLs: 0, exportClicks: 0, forbidden: [], downloads: 0, popups: 0 });
    pass('restoring existing consent only enables copying; never installs, probes, grants or connects');
  });
  for (const hash of ['#handoff-title', '#chat-connection-title', '#hosted-prepare-title', '#windows-handoff-title', '#references-title', '#windowsRunGuidance', '#windowsBrowserPowerShell', '#localControlDetails']) {
    await withFixture({ hash }, async fixture => {
      const destination = hash === '#windowsBrowserPowerShell' ? '#windowsCommandDetails' : hash;
      await fixture.page.locator(destination).waitFor({ state: 'visible' });
      assert.equal(await fixture.page.locator(destination).isVisible(), true, hash + ' opens its collapsed ancestors');
      if (hash === '#windowsBrowserPowerShell') {
        assert.equal(await fixture.page.locator('#windowsCommandDetails').evaluate(element => element.open), true);
        assert.equal(await fixture.page.locator(hash).textContent(), '', 'a command deep link cannot bypass consent');
      }
      assert.equal(await fixture.page.locator('#target').inputValue(), 'windows');
      assert.equal(await fixture.page.locator('#installConsent').isChecked(), false);
      assert.deepEqual(await effects(fixture), { writes: 0, objectURLs: 0, exportClicks: 0, forbidden: [], downloads: 0, popups: 0 });
      assert.deepEqual(await fixture.page.evaluate(() => __setupMock.nativeCalls), []);
    });
  }
  pass('existing request, chat, Windows handoff and resource deep links open without granting, exporting or installing');
  await withFixture({ granted: true, nativeStatus: true }, async ({ page }) => {
    await page.locator('#windowsInstallCheck summary').click();
    const read = selector => page.locator(selector).textContent();
    const check = async () => {
      await page.locator('#detectInstall').click();
      await page.waitForFunction(() => !document.querySelector('#detectInstall').disabled);
    };
    assert.equal(await page.evaluate(() => __setupMock.nativeCalls.length), 0);
    await check();
    assert.equal(await read('#managementRegistered'), 'registered');
    for (const mode of ['wrong-id', 'rejected', 'transport', 'host-absent']) {
      await page.evaluate(value => { __setupMock.nativeMode = value; }, mode);
      await check();
      assert.equal(await read('#managementRegistered'), mode === 'host-absent' ? 'host not detected' : 'Unknown', mode);
      assert.equal(await read('#managementHost'), 'Unknown', mode);
      assert.equal(await read('#managementConnection'), 'Unknown', mode);
    }
    await page.evaluate(() => { __setupMock.nativeMode = 'ready'; });
    await check();
    assert.equal(await read('#managementConnection'), 'Ready (local runtime)');
    await page.evaluate(() => { __setupMock.nativeMode = 'defer'; });
    await page.locator('#detectInstall').click();
    await page.waitForFunction(() => typeof __setupMock.finishNative === 'function');
    await page.evaluate(() => { __setupMock.changePermission(false); __setupMock.finishNative(); });
    await page.waitForFunction(() => document.querySelector('#browser-permission').textContent === 'Not granted');
    await page.waitForFunction(() => !document.querySelector('#detectInstall').disabled);
    assert.equal(await read('#managementConnection'), 'Unknown');
    assert.equal(await page.evaluate(() => __setupMock.nativeCalls.length), 7);
    await check();
    assert.equal(await page.evaluate(() => __setupMock.nativeCalls.length), 7);
    assert.match(await read('#installDetection'), /permission.*Devices/i);
    await page.locator('#windowsInstallCheck summary').click();
    assert.equal(await page.locator('#installDetection').isVisible(), true, 'the current result survives collapsing diagnostics');
    assert.equal(await page.evaluate(() => __setupMock.nativeCalls.length), 7, 'collapsing diagnostics never probes');
    await openDetails(page, 'setupAdvanced');
    await page.locator('#installOsLinux').click();
    assert.equal(await page.locator('#detectInstall').isVisible(), false);
    pass('Windows post-install status correlates native responses, clears stale state and never probes without permission');
  });
  await withFixture({ clipboardMode: 'allowed' }, async fixture => {
    const { page } = fixture;
    await chooseTarget(fixture, 'windows');
    const browserCommandElement = page.locator('#windowsBrowserPowerShell');
    const standalone = page.locator('#windowsStandaloneInstall');
    const existingDevice = page.locator('#openBrowserManagedDevices');
    assert.equal(await browserCommandElement.textContent(), '', 'consent is required');
    assert.equal(await existingDevice.isVisible(), true, 'existing devices do not need install consent');
    assert.equal(await existingDevice.innerText(), 'Already installed? Open Devices');
    assert.equal(await existingDevice.getAttribute('href'), 'devices.html?mode=browser-managed');
    await page.locator('#installConsent').check();
    assert.equal(await browserCommandElement.isVisible(), false, 'command preview is advanced, not required for copying');
    assert.equal(await standalone.locator('#windowsGuidedCommand').isVisible(), false);
    assert.equal(await standalone.locator('#windowsNodeCommand').isVisible(), false);
    assert.equal(await page.locator('#windowsSetupSteps').isVisible(), false);
    await openDetails(page, 'windowsCommandDetails');
    assert.match(await page.locator('#windowsSetupSteps').innerText(), /REGISTER[\s\S]*Check status[\s\S]*Reconnect/);
    await page.locator('#windowsCommandDetails > summary').click();
    assert.doesNotMatch(await page.locator('#windowsBrowserInstall').innerText(), /\bPAIR\b|\bCONNECT\b/);
    const before = await effects(fixture);
    await page.locator('#copyWindowsBrowserPowerShell').click();
    assert.deepEqual(await clipboardWrites(page), [{
      text: browserCommand(extensionId), active: true,
    }]);
    await page.locator('#windowsBrowserCmdDetails > summary').click();
    await page.locator('#copyWindowsBrowserCmd').click();
    assert.deepEqual((await clipboardWrites(page)).at(-1), { text: browserCommand(extensionId, 'current-account', 'browserCmd'), active: true });
    assert.deepEqual(await effects(fixture), before, 'copy does not start setup or request a browser permission');
    await standalone.locator(':scope > summary').click();
    assert.equal(await standalone.locator('#windowsGuidedCommand').isVisible(), true);
    assert.match(await standalone.innerText(), /CONNECT[\s\S]*PAIR/);
    await page.locator('#installOsLinux').click();
    assert.equal(await existingDevice.isVisible(), false);
    pass('browser-managed Windows is the primary consented route and standalone remains a separate fallback');
  });

  for (const uiLanguage of [undefined, 'zh_CN']) {
    await withFixture({ uiLanguage }, async fixture => {
      const { page } = fixture;
      const chinese = uiLanguage === 'zh_CN';
      const open = page.getByRole('button', { name: chinese ? '打开扩展控制面板' : 'Open extension controls', exact: true });
      const details = page.locator('#localControlDetails');
      const ticket = page.locator('#localControlTicket');
      const frame = page.locator('#localControlFrame');
      await page.locator('#installConsent').check();
      await page.locator('#windowsStandaloneInstall > summary').click();
      const guidance = await page.locator('#windowsSourceInstall').innerText();
      assert.match(guidance, chinese ? /输入 PAIR.*按 Enter.*保留连接.*不配对/ : /Type PAIR to open extension controls; Enter keeps the connection without pairing/);
      assert.match(guidance, chinese ? /同一终端.*临时配对凭证.*整行 ACPAIR1/ : /temporary pairing ticket in the same terminal.*entire ACPAIR1 line/);
      assert.match(guidance, chinese ? /不会自动打开浏览器/ : /No browser opens automatically/);
      assert.equal(await open.getAttribute('type'), 'button');
      assert.equal(await open.getAttribute('aria-controls'), 'localControlDetails');
      assert.equal(await ticket.isVisible(), false);
      const before = await effects(fixture);
      const requests = [], navigations = [];
      page.on('request', request => requests.push(request.url()));
      page.on('framenavigated', frame => navigations.push(frame.url()));

      await open.press('Enter');
      assert.equal(await details.getAttribute('open'), '');
      assert.equal(await ticket.isVisible(), true);
      assert.equal(await ticket.evaluate(element => element === document.activeElement), true);
      assert.equal(await ticket.inputValue(), '');
      assert.equal(await frame.getAttribute('src'), null);
      assert.equal(await page.locator('#localControlButtons').isVisible(), false);
      assert.equal(await page.getByRole('heading', {
        name: chinese ? '重新打开临时控制会话' : 'Reopen a temporary control session',
      }).isVisible(), true);
      assert.equal(await page.locator('#windowsBrowserControlCommand').innerText(), String.raw`.\install.ps1 -DeviceAction browser -Consent accept-control`);

      await ticket.fill('http://127.0.0.1:50000');
      await ticket.press('Enter');
      assert.equal(await frame.getAttribute('src'), null, 'an invalid ticket cannot initiate host access');
      assert.equal(await ticket.inputValue(), '');
      await ticket.fill('ACPAIR1:50000:' + 'A'.repeat(43));
      assert.equal(await frame.getAttribute('src'), null, 'typing a ticket is not a submission');
      await page.locator('#closeLocalControl').click();
      assert.equal(await ticket.inputValue(), '');
      assert.equal(await ticket.isVisible(), false);
      assert.equal(await details.locator('summary').evaluate(element => element === document.activeElement), true);

      await open.click();
      assert.equal(await ticket.evaluate(element => element === document.activeElement), true);
      for (const os of ['Macos', 'Linux']) {
        await page.locator('#installOs' + os).click();
        assert.equal(await open.isVisible(), false);
        assert.equal(await details.isVisible(), false);
      }
      await page.locator('#installOsWindows').click();
      assert.equal(await ticket.isVisible(), false, 'switching away closes the panel');
      assert.equal(page.url(), origin + '/setup.html');
      assert.deepEqual(navigations, []);
      assert.deepEqual(requests, []);
      assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
      assert.deepEqual(await effects(fixture), before, 'revealing and dismissing controls does not persist data or launch anything');
      pass(`${chinese ? 'Chinese' : 'English'} Windows pairing guidance reveals and focuses local controls without navigation, host access, or credential persistence`);
    });
  }

  await withFixture({ clipboardMode: 'allowed' }, async fixture => {
    const { page } = fixture;
    await chooseTarget(fixture, 'windows');
    const copy = page.locator('#copyWindowsGuidedCommand');
    const preview = page.locator('#windowsGuidedCommand');
    const feedback = page.locator('#windowsCopyFeedback');
    const dispatchUntrusted = () => copy.evaluate(button => {
      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.locator('#installConsent').uncheck();
    assert.equal(await page.locator('#windowsSourceInstall').isVisible(), true, 'instructions remain available before consent');
    assert.equal(await copy.isDisabled(), true);
    assert.equal(await preview.textContent(), '');
    assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(), '');
    await dispatchUntrusted();
    await page.locator('#installConsent').check();
    await page.locator('#windowsStandaloneInstall > summary').click();
    await openDetails(page, 'windowsCommandDetails');
    assert.equal(await page.locator('#windowsSourceInstall').isVisible(), true);
    assert.equal(await copy.isEnabled(), true);
    assert.equal(await copy.innerText(), 'Copy PowerShell command');
    assert.equal(await preview.innerText(), guidedCommand(extensionId));
    assert.equal(await page.locator('#windowsBrowserPowerShell').textContent(),
      browserCommand(extensionId));
    assert.equal(await page.locator('#windowsBrowserCmd').textContent(), browserCommand(extensionId, 'current-account', 'browserCmd'));
    await page.locator('#windowsBrowserRecovery > summary').click();
    const browserInstallStatus = await page.locator('#windowsBrowserInstallerStatusCommand').innerText();
    assert.match(browserInstallStatus, /^\.\\install\.ps1 -DeviceAction browser-installer-status -InstallDir /);
    assert.doesNotMatch(browserInstallStatus, /accept-control|accept-install|OperationId|RuntimeKeyFile/);
    assert.match(await page.locator('#windowsBrowserRecoveryHelp').innerText(), /read-only.*does not connect.*not proof/i);
    assert.equal(await page.locator('#windowsSourceInstall input,#windowsSourceInstall textarea').count(), 0);
    assert.match(await page.locator('#windowsSourceInstall').innerText(),
      /then enter the official tunnel ID and absolute path to the runtime-key file/);
    await dispatchUntrusted();
    assert.equal(await page.locator('#copyInstallCommand').count(), 0);
    assert.deepEqual(await clipboardWrites(page), [], 'checking consent and synthetic clicks do not copy');
    assert.equal(await feedback.textContent(), '');
    const beforeCopy = await effects(fixture);
    await copy.click();
    await page.waitForFunction(() => document.getElementById('windowsCopyFeedback').textContent === 'Install command copied.');
    assert.deepEqual(await clipboardWrites(page), [{ text: guidedCommand(extensionId), active: true }]);
    assert.deepEqual(await effects(fixture), beforeCopy, 'copy does not export, write storage, or launch anything');
    assert.equal(page.url(), origin + '/setup.html');
    assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
    assert.equal(await page.locator('#managementSection').isVisible(), true);
    assert.equal(await page.locator('#localControlForm').count(), 1);
    const command = await page.locator('#windowsNodeCommand').innerText();
    assert.match(command, /^node .+ install-local --consent accept-install/);
    assert.match(command, /--tunnel-id "YOUR_TUNNEL_ID" --runtime-key-file/);
    const verify = await page.locator('#windowsVerifyCommand').innerText();
    assert.match(verify, /manager-control.+--action status$/);
    const installerStatus = await page.locator('#windowsInstallerStatusCommand').innerText();
    assert.match(installerStatus, /^\.\\install\.ps1 -DeviceAction installer-status -InstallDir /);
    assert.doesNotMatch(installerStatus, /accept-control|accept-install|OperationId/);
    assert.match(await page.locator('#windowsRecoveryHelp').innerText(),/do not delete the directory or reinstall/);
    const shellCommand = await page.locator('#windowsPowerShellCommand').innerText();
    for (const flag of ['-InstallLocal', '-Consent accept-install', '-SetupRequest', '-TunnelId', '-RuntimeKeyFile']) assert.ok(shellCommand.includes(flag));
    assert.match(await page.locator('#windowsCmdCommand').innerText(), /^install\.cmd install-local /);
    assert.match(await page.locator('#windowsSourceInstall').innerText(), /portable Node ZIP/);
    assert.match(await page.locator('#windowsGuidedInputs').innerText(), /no JSON export is needed.*Check the extension ID/);
    assert.match(await page.locator('#windowsNodeProvisioning').innerText(), /after you confirm.*automatically downloads and verifies.*No EXE\/MSI installer/);
    assert.match(await page.locator('#windowsPolicyHelp').innerText(), /verify its source and SHA-256.*do not bypass/);
    assert.match(await page.locator('#windowsReleaseCheck').innerText(), /Before extracting, compare the ZIP hash with the checksum for that exact release/);
    await page.locator('#language').selectOption('zh_CN');
    assert.equal(await copy.innerText(), '复制 PowerShell 命令');
    assert.equal(await preview.innerText(), guidedCommand(extensionId));
    assert.equal(await feedback.textContent(), '已复制安装命令。');
    assert.match(await page.locator('#windowsGuidedInputs').innerText(), /无需导出 JSON.*核对终端显示的扩展 ID/);
    assert.match(await page.locator('#windowsNodeProvisioning').innerText(), /确认后会自动下载并校验.*不运行 EXE\/MSI 安装器/);
    assert.match(await page.locator('#windowsPolicyHelp').innerText(), /核对来源与 SHA-256.*不要绕过策略/);
    assert.match(await page.locator('#windowsReleaseCheck').innerText(), /解压前.*与该版本公布的校验值完全一致/);
    assert.equal(await page.locator('#windowsNodeCommand').innerText(), command);
    assert.equal(await page.locator('#windowsVerifyCommand').innerText(), verify);
    assert.equal(await page.locator('#windowsInstallerStatusCommand').innerText(), installerStatus);
    assert.equal(await page.locator('#windowsBrowserInstallerStatusCommand').innerText(), browserInstallStatus);
    assert.match(await page.locator('#windowsBrowserRecoveryHelp').innerText(), /只读.*不会连接.*不证明/);
    assert.match(await page.locator('#windowsRecoveryHelp').innerText(),/不要删除目录或重复安装/);
    assert.equal(await page.locator('#windowsPowerShellCommand').innerText(), shellCommand);
    assert.match(await page.locator('#windowsSourceInstall').innerText(), /仅浏览器管理模式注册 Chrome 主机/);
    for (const os of ['Macos', 'Linux']) {
      await page.locator('#installOs' + os).click();
      assert.equal(await page.locator('#windowsSourceInstall').isVisible(), false);
      assert.match(await page.locator('#otherInstallPlan').innerText(), /尚未提供/);
      assert.doesNotMatch(await page.locator('#installSection').innerText(), /npx|@latest|ExecutionPolicy/);
      assert.equal(await copy.isDisabled(), true);
      await dispatchUntrusted();
    }
    await page.locator('#installOsWindows').click();
    assert.equal(await page.locator('#windowsSourceInstall').isVisible(), true);
    assert.equal(await feedback.textContent(), '');
    await page.evaluate(id => { chrome.runtime.id = id; }, otherExtensionId);
    await copy.click();
    assert.equal(await preview.innerText(), guidedCommand(otherExtensionId), 'a stale preview is refreshed before copying');
    assert.equal((await clipboardWrites(page)).length, 1);
    await copy.press('Enter');
    await page.waitForFunction(() => document.getElementById('windowsCopyFeedback').textContent === '已复制安装命令。');
    assert.deepEqual(await clipboardWrites(page), [
      { text: guidedCommand(extensionId), active: true },
      { text: guidedCommand(otherExtensionId), active: true },
    ]);
    await page.locator('#installConsent').uncheck();
    assert.equal(await page.locator('#windowsSourceInstall').isVisible(), true, 'revocation disables copying without hiding setup instructions');
    await dispatchUntrusted();
    assert.equal((await clipboardWrites(page)).length, 2);
    pass('Windows guided copy requires consent and a trusted gesture, binds the current runtime ID, and preserves advanced commands and local controls');
  });

  await withFixture({ clipboardMode: 'allowed' }, async fixture => {
    const { page } = fixture;
    await chooseTarget(fixture, 'windows');
    const copy = page.locator('#copyWindowsGuidedCmdCommand');
    const preview = page.locator('#windowsGuidedCmdCommand');
    const feedback = page.locator('#windowsCmdCopyFeedback');
    await page.locator('#installConsent').uncheck();
    assert.equal(await copy.isDisabled(), true);
    assert.equal(await preview.textContent(), '');
    await page.locator('#installConsent').check();
    await page.locator('#windowsStandaloneInstall > summary').click();
    await page.getByText('Standalone CMD command', { exact: true }).click();
    assert.equal(await preview.innerText(), 'install.cmd guided ' + extensionId);
    await copy.evaluate(button => button.click());
    assert.deepEqual(await clipboardWrites(page), []);
    await page.evaluate(id => { chrome.runtime.id = id; }, otherExtensionId);
    await copy.click();
    assert.deepEqual(await clipboardWrites(page), [], 'identity drift prevents copying a stale command');
    assert.equal(await preview.innerText(), 'install.cmd guided ' + otherExtensionId);
    await copy.click();
    await page.waitForFunction(() => document.getElementById('windowsCmdCopyFeedback').textContent === 'Install command copied.');
    assert.deepEqual(await clipboardWrites(page), [{ text: 'install.cmd guided ' + otherExtensionId, active: true }]);
    assert.equal(await page.locator('#windowsCopyFeedback').textContent(), '');
    await page.locator('#language').selectOption('zh_CN');
    assert.equal(await copy.innerText(), '复制 CMD 命令');
    assert.equal(await feedback.textContent(), '已复制安装命令。');
    assert.equal(await preview.innerText(), 'install.cmd guided ' + otherExtensionId);
    await page.locator('#installOsLinux').click();
    assert.equal(await copy.isDisabled(), true);
    assert.equal(await preview.textContent(), '');
    assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
    pass('guided CMD copy shares consent and fresh identity without invoking native commands');
  });

  for (const clipboardMode of ['denied', 'missing']) {
    for (const uiLanguage of ['en', 'zh_CN']) {
      for (const scope of ['current-account', 'administrator']) {
        await withFixture({ clipboardMode, uiLanguage, viewport: { width: 320, height: 600 }, nativeStatus: true, granted: true }, async fixture => {
          const { page } = fixture;
          if (scope === 'administrator') await page.locator('#windowsAccessScope').selectOption(scope);
          await page.locator('#installConsent').check();
          await assertPrimarySetupFlow(page);
          const initialResult = await page.locator('#installDetection').textContent();
          await page.locator('#copyWindowsBrowserPowerShell').click();
          const message = scope === 'administrator'
            ? uiLanguage === 'zh_CN' ? '自动复制失败，本页自动连接已取消。请手动复制命令，安装后在设备页连接。'
              : 'Automatic copy failed and automatic connection from this page is cancelled. Copy the command manually, then connect in Devices after installation.'
            : uiLanguage === 'zh_CN' ? '无法自动复制，请选择命令文本手动复制。'
              : 'Automatic copy failed; select the command text and copy it manually.';
          await page.waitForFunction(text => document.getElementById('windowsBrowserPowerShellFeedback').textContent === text, message);
          const command = scope === 'administrator' ? administratorCommand(extensionId)
            : browserCommand(extensionId);
          assert.equal(await page.locator('#windowsBrowserPowerShell').innerText(), command);
          assert.equal(await page.locator('#windowsBrowserPowerShell').isVisible(), true, 'copy failure reveals the command for manual copying');
          assert.equal(await page.locator('#windowsSetupSteps').isVisible(), true, 'copy failure also reveals manual prerequisites');
          assert.equal(await page.locator('#installDetection').isVisible(), true);
          assert.equal(await page.locator('#installDetection').textContent(), initialResult, 'copy failure is not an installation result');
          assert.deepEqual(await clipboardWrites(page), clipboardMode === 'missing' ? [] : [{ text: command, active: true }]);
          assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
          await layout(page, 'light');
        });
      }
    }
  }
  pass('clipboard denial and unavailability reveal the manual fallback in both languages and scopes without probing or retrying');
  await withFixture({}, async fixture => {
    const { page } = fixture;
    assert.equal(await page.locator('#remoteManagement').count(), 1, 'optional remote management section exists');
    assert.equal(await page.locator('#remoteManagement').isVisible(), false);
    for (const uiLanguage of ['en', 'zh_CN']) {
      await page.locator('#language').selectOption(uiLanguage);
      for (const target of [...targets, '']) {
        await chooseTarget(fixture, target);
        assert.equal(await page.locator('#remoteManagement').isVisible(), target === 'linux-server');
        if (target !== 'linux-server') continue;
        const text = await page.locator('#remoteManagement').innerText();
        const boundary = await page.locator('#target-boundary').innerText();
        if (uiLanguage === 'en') {
          for (const term of ['Optional remote management', 'directly to official OpenAI', 'pause and reconnect',
            'installed local native manager', 'nativeMessaging', 'independently verified SSH host keys', 'OS agent',
            'trusted local entry', 'not added to the browser request', 'selection only',
            'not connected, authenticated or authorized', 'no released installer or runnable public npx command',
            'local-platform request', 'not the linux-server request', 'no local OpenAI runtime key',
            'does not download a tunnel client', 'native registration remains separate']) {
            assert.ok(text.includes(term), 'Missing visible remote-management detail: ' + term);
          }
          assert.match(boundary, /directly on the server.*without a Windows relay.*optional.*local bridge.*SSH/i);
          assert.doesNotMatch(text, /[\u3400-\u9fff]/u);
        } else {
          for (const term of ['可选远程管理', '直接连接官方 OpenAI', '暂停与重连', '已安装的本机 native manager',
            'nativeMessaging', '独立核验的 SSH 主机密钥', 'OS agent', '本机可信入口', '不会加入浏览器请求',
            '仅选择设备', '不表示已连接、已认证或已授权', '没有已发布安装器或可运行的公共 npx 命令',
            '本机平台请求', '而不是 linux-server 请求', '不需要本机 OpenAI 运行密钥', '不下载隧道客户端',
            '本机原生注册仍需单独完成']) {
            assert.ok(text.includes(term), 'Missing visible Chinese remote-management detail: ' + term);
          }
          assert.match(boundary, /工具数据不用桥接.*可选生命周期管理另需本机桥接和SSH/);
        }
        assert.equal(await page.locator('#remoteManagement pre').count(), 2);
        const manager = await page.locator('#remoteManagement pre').filter({ hasText: 'setup-manager' }).innerText();
        for (const flag of ['setup-manager', '--install-dir', '--consent full-account', '--setup-request']) {
          assert.ok(manager.includes(flag), 'Missing source manager flag: ' + flag);
        }
        assert.doesNotMatch(manager, /--runtime-key-file|--tunnel-id|--tunnel-archive/);
        const command = await page.locator('#remoteManagement pre').filter({ hasText: 'enroll-ssh' }).innerText();
        for (const flag of ['enroll-ssh', '--install-dir', '--consent full-account', '--ssh-executable', '--host',
          '--port', '--user', '--remote-node', '--remote-install-dir', '--known-hosts', '--known-hosts-sha256']) {
          assert.ok(command.includes(flag), 'Missing source enrollment flag: ' + flag);
        }
        assert.equal(await page.locator('#remoteManagement input,#remoteManagement textarea,#remoteManagement button').count(), 0);
        assert.equal(await page.locator('#remoteManagement a').getAttribute('href'), 'devices.html#access-title');
        const before = await effects(fixture);
        await openReview(fixture, target);
        assert.deepEqual(Object.keys(JSON.parse(await page.locator('#request-preview').textContent())),
          ['format', 'version', 'target', 'extensionId', 'nativeHost']);
        await page.locator('#cancelSetup').click();
        await waitForReviewClosed(page);
        assert.deepEqual(await effects(fixture), before, 'guidance and review never enroll, connect or grant permissions');
      }
    }
    pass('bilingual optional remote management is Linux-server-only, documents trusted enrollment and selection-only links without browser authority');
  });

  await withFixture({}, async fixture => {
    await chooseTarget(fixture, 'linux-server');
    const sequence = await fixture.page.locator('section[aria-labelledby="sequence-title"]').innerText();
    assert.doesNotMatch(sequence, /review and install the local component|request optional browser permission|after local bridge installation/i,
      'Remote Linux must not instruct the user to install a local bridge or acquire browser-native permission');
    assert.match(sequence, /direct(?:ly)? (?:on|from|to) (?:the )?(?:Linux )?server|direct[- ]device|直接|直连/i,
      'Remote Linux needs a target-device direct connection sequence');
    pass('Remote Linux visible connection sequence uses direct server setup, not local bridge installation or browser permission');
  });

  await withFixture({}, async fixture => {
    const { page } = fixture;
    await chooseTarget(fixture, 'windows');
    const section = page.locator('section[aria-labelledby="chat-connection-title"]');
    assert.equal(await section.isVisible(), true);
    const before = await effects(fixture);
    assert.equal(await section.locator('#hostedPluginLink').getAttribute('href'), 'https://chatgpt.com/plugins');
    assert.equal(await section.locator('input,textarea,iframe').count(), 0);
    assert.match(await section.innerText(), /ordinary ChatGPT chat and separately in Dot/);
    assert.match(await section.innerText(), /actual read_file tool result/);
    assert.match(await section.innerText(), /Do not include the expected contents in the request/);
    assert.match(await section.innerText(), /Do not paste the runtime key/i);
    await section.locator('summary').click();
    assert.match(await section.innerText(), /Tunnels Read \+ Use/);
    assert.match(await section.innerText(), /Dot remains unverified/i);
    assert.deepEqual(await effects(fixture), before, 'reading the guide never opens, grants, or modifies anything');
    assert.deepEqual(await page.evaluate(() => __setupMock.nativeCalls), []);
    assert.equal(await page.locator('#chat-status').textContent(), 'Not verified');
    await page.locator('#localControls').click();
    assert.equal(await page.locator('#localControlTicket').evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('#localControlFrame').getAttribute('src'), null);
    assert.deepEqual(await effects(fixture), before, 'revealing Windows controls does not start the bridge or pair');
    await page.locator('#language').selectOption('zh_CN');
    assert.match(await section.innerText(), /普通 ChatGPT 对话与 Dot.*分别/);
    assert.match(await section.innerText(), /Dot 仍未验证/);
    assert.equal(await page.locator('#chat-status').textContent(), '未验证');
    pass('bilingual hosted guide separates device readiness, private plugin setup and a real tool check in each chat surface');
  });

  await withFixture({}, async fixture => {
    const { page } = fixture;
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'English default does not follow browser locale');
    assert.equal(await page.title(), 'Agent Continue | Device Setup');
    assert.doesNotMatch(await page.locator('body').innerText(), /[\u3400-\u9fff]/u);
    assert.deepEqual(await page.locator('#target option').evaluateAll(options => options.map(option => option.value)), ['', ...targets]);
    assert.equal(await page.locator('#target').inputValue(), 'windows');
    assert.equal(await page.locator('#extension-id').textContent(), extensionId);
    assert.notEqual(extensionId, storeId, 'fixture identity must expose hardcoded store-ID fallbacks');
    await page.waitForFunction(() => document.getElementById('browser-permission').textContent === 'Not granted');
    assert.equal(await page.locator('#reviewSetup').isEnabled(), true);
    assert.equal(await page.locator('#setupReview').isVisible(), false);
    assert.deepEqual(await page.locator('input[type="checkbox"]').evaluateAll(elements => elements.map(element => element.id)), ['installConsent', 'exportConsent']);
    assert.deepEqual(await effects(fixture), { writes: 0, objectURLs: 0, exportClicks: 0, forbidden: [], downloads: 0, popups: 0 });
    await assertLinks(page);
    for (const target of targets) {
      await chooseTarget(fixture, target);
      assert.equal(await page.locator('#reviewSetup').isEnabled(), true);
      const text = await page.locator('#availability').innerText();
      if (target === 'windows') assert.match(text, /source candidate.*no released installer/i);
      if (target === 'macos') assert.match(text, /not implemented.*no released installer/i);
      if (target === 'linux') assert.match(text, /offline source-kit.*not an installer/i);
      if (target === 'linux-server') {
        assert.match(text, /configured on the target server.*source candidate.*no installer has been released/i);
        assert.match(await page.locator('#linuxServerSetupCommand').innerText(), /bin\.mjs setup-server/);
        assert.match(await page.locator('#linuxServerSetupCommand').innerText(), /--runtime-key-file \/absolute\/private\/server-runtime-key\.txt/);
        assert.match(await page.locator('#target-boundary').innerText(), /directly on the server.*without a Windows relay/i);
      }
      await assertLinks(page);
    }
    await chooseTarget(fixture, '');
    assert.equal(await page.locator('#reviewSetup').isDisabled(), true);
    pass('Windows-default four-target choice, actual runtime ID, honest availability, local-only permission, no selection effects and fixed official links');
  });

  for (const runtimeId of [undefined, null, '', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'q'.repeat(32), extensionId + '\n', 123, [extensionId]]) {
    await withFixture({ runtimeId }, async fixture => {
      for (const target of targets) {
        await chooseTarget(fixture, target);
        assert.equal(await fixture.page.locator('#reviewSetup').isDisabled(), true);
      }
      assert.equal(await fixture.page.locator('#extension-id').textContent(), 'Unknown');
      await fixture.page.locator('#installConsent').check();
      assert.equal(await fixture.page.locator('#copyWindowsGuidedCommand').isDisabled(), true);
      assert.equal(await fixture.page.locator('#windowsGuidedCommand').textContent(), '');
      assert.equal((await fixture.page.locator('body').innerText()).includes(storeId), false);
      assert.equal(fixture.downloads.length, 0);
    });
  }
  pass('missing and malformed runtime IDs never fall back to the store ID or permit review/export');

  await withFixture({}, async fixture => {
    const { page } = fixture;
    await chooseTarget(fixture, 'windows');
    const before = await effects(fixture);
    await openReview(fixture, 'windows');
    assert.deepEqual(await effects(fixture), before, 'review is not export');
    await page.locator('#exportConsent').check();
    assert.equal(await page.locator('#downloadSetup').isEnabled(), true);
    await page.locator('#exportConsent').uncheck();
    assert.equal(await page.locator('#downloadSetup').isDisabled(), true);
    await page.locator('#cancelSetup').click();
    await waitForReviewClosed(page);
    assert.deepEqual(await effects(fixture), before, 'declining consent and cancellation have no effects');
    await openReview(fixture, 'windows');
    await page.keyboard.press('Escape');
    await waitForReviewClosed(page);
    assert.deepEqual(await effects(fixture), before, 'Escape does not export');
    await openReview(fixture, 'windows');
    await page.locator('#exportConsent').check();
    await page.evaluate(() => {
      const target = document.getElementById('target');
      target.value = 'linux-server'; target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitForReviewClosed(page);
    assert.deepEqual(await effects(fixture), before, 'a changed target invalidates review and consent');
    assert.equal(await page.locator('#localControls').isVisible(), false);
    pass('review requires fresh consent; denial, cancellation, Escape and target invalidation never export or open anything');
  });

  await withFixture({}, async fixture => {
    const { page } = fixture;
    for (const target of targets) {
      await chooseTarget(fixture, target);
      const preview = await openReview(fixture, target);
      const previousDownloads = fixture.downloads.length;
      await page.locator('#exportConsent').check();
      assert.equal(await page.locator('#downloadSetup').isEnabled(), true);
      const pendingDownload = page.waitForEvent('download');
      pendingDownload.catch(() => {});
      await page.locator('#downloadSetup').click();
      const download = await pendingDownload;
      await waitForReviewClosed(page);
      const actual = await readDownload(download);
      assert.deepEqual(JSON.parse(actual), expectedRequest(target));
      assert.equal(actual, preview, 'download is exactly the reviewed payload');
      assert.equal(actual, JSON.stringify(expectedRequest(target), null, 2) + '\n');
      assert.doesNotMatch(actual, /timestamp|hostname|userSid|api.key|password|token|path|approved|consent|powershell|command/i);
      assert.equal(fixture.downloads.length, previousDownloads + 1, 'one click produces exactly one download');
      const details = await page.evaluate(async () => ({
        blobs: await Promise.all(__setupMock.objectURLs.map(async ({ url, blob }) => ({ url, text: await blob.text(), type: blob.type }))),
        clicks: __setupMock.exportClicks, gestures: __setupMock.exportGestures,
      }));
      assert.equal(details.blobs.length, previousDownloads + 1);
      assert.equal(details.clicks.length, previousDownloads + 1);
      assert.equal(details.gestures.length, previousDownloads + 1);
      assert.equal(details.blobs.at(-1).text, actual);
      assert.match(details.blobs.at(-1).type, /^application\/json(?:;\s*charset=utf-8)?$/i);
      assert.equal(details.clicks.at(-1).href, details.blobs.at(-1).url);
      assert.match(details.clicks.at(-1).href, /^blob:https:\/\/setup-fixture\.invalid\//);
      assert.equal(details.clicks.at(-1).filename, 'agent-continue-setup-request.json');
      assert.equal(details.clicks.at(-1).active, true, 'export is initiated within user activation');
      assert.deepEqual(details.gestures.at(-1), { trusted: true, consent: true });
      assert.equal(await page.locator('#export-feedback').textContent(), 'Export initiated; saving, installation and authorization are not verified.');
      await assertUnverified(page);
    }
    assert.deepEqual(await page.evaluate(() => __setupMock.writes), []);
    pass('all four targets export one actual consented Blob with the fixed filename and exactly five reviewed fields; no authority receipt');
  });

  await withFixture({}, async fixture => {
    const { page } = fixture;
    await chooseTarget(fixture, 'windows');
    await openReview(fixture, 'windows');
    await page.locator('#exportConsent').check();
    await page.evaluate(id => { chrome.runtime.id = id; }, otherExtensionId);
    await page.locator('#downloadSetup').click();
    await waitForReviewClosed(page);
    assert.equal(fixture.downloads.length, 0);
    assert.equal((await effects(fixture)).objectURLs, 0);
    assert.match(await page.locator('#export-feedback').innerText(), /^Export was not initiated\./);
    pass('identity drift after review invalidates export instead of downloading a stale binding');
  });

  await withFixture({}, async fixture => {
    const { page } = fixture;
    await page.locator('#language').selectOption('zh_CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(await page.evaluate(() => __setupMock.data.uiLanguage), 'zh_CN');
    assert.equal(await page.title(), 'Agent Continue | 设备设置');
    await chooseTarget(fixture, 'windows');
    const preview = await openReview(fixture, 'windows');
    const before = await effects(fixture);
    for (const language of ['en', 'zh_CN']) {
      await page.evaluate(value => __setupMock.changeLanguage(value), language);
      await page.waitForFunction(value => document.documentElement.lang === value, language === 'en' ? 'en' : 'zh-CN');
      assert.equal(await page.locator('#language').inputValue(), language);
      assert.equal(await page.locator('#setupReview').isVisible(), true);
      assert.equal(await page.locator('#request-preview').textContent(), preview);
      assert.equal(await page.locator('#exportConsent').isChecked(), false);
      assert.equal(await page.locator('#downloadSetup').isDisabled(), true);
      assert.equal(await page.locator('#review-title').textContent(), language === 'en' ? 'Review setup request' : '审阅配置请求');
      await assertUnverified(page);
      await assertLinks(page);
    }
    await page.locator('#exportConsent').check();
    await page.evaluate(() => __setupMock.changeLanguage('en'));
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('#request-preview').textContent(), preview);
    assert.equal(await page.locator('#exportConsent').isChecked(), true);
    assert.equal(await page.locator('#downloadSetup').isEnabled(), true);
    assert.deepEqual(await effects(fixture), before, 'language events do not export or rewrite setup state');
    await page.locator('#cancelSetup').click();
    await waitForReviewClosed(page);
    await page.locator('#language').selectOption('zh_CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    const dynamic = ['extension-id', 'browser-permission', 'availability', 'target-boundary', 'export-feedback'];
    const untranslated = await page.locator('[data-i18n]').evaluateAll((elements, excluded) => elements
      .filter(element => !excluded.includes(element.id) && element.textContent !== element.dataset.i18n).map(element => element.dataset.i18n), dynamic);
    assert.deepEqual(untranslated, []);
    pass('shared bilingual preference and live language changes preserve the open review payload, consent boundary and unverified status');
  });

  await withFixture({ uiLanguage: 'zh_CN', granted: true }, async fixture => {
    const { page } = fixture;
    await page.waitForFunction(() => document.getElementById('browser-permission').textContent === '已授权');
    const labels = {
      windows: /源码候选.*尚无已发布安装器/,
      macos: /尚未实现.*尚无已发布安装器/,
      linux: /离线源码包候选.*不是安装器/,
      'linux-server': /目标服务器上用候选源码包配置.*没有已发布的安装器/,
    };
    for (const target of targets) {
      await chooseTarget(fixture, target);
      assert.match(await page.locator('#availability').innerText(), labels[target]);
      assert.equal(await page.locator('#browser-permission').textContent(), '已授权');
    }
    assert.match(await page.locator('#target-boundary').innerText(), /服务器上直接运行隧道.*不经过 Windows 中转/);
    await chooseTarget(fixture, 'windows');
    const preview = await openReview(fixture, 'windows');
    await page.locator('#exportConsent').check();
    const pendingDownload = page.waitForEvent('download');
    pendingDownload.catch(() => {});
    await page.locator('#downloadSetup').click();
    const download = await pendingDownload;
    await waitForReviewClosed(page);
    assert.equal(await readDownload(download), preview, 'Chinese labels never translate request keys, enums or identity');
    assert.deepEqual(JSON.parse(preview), expectedRequest('windows'));
    assert.equal(await page.locator('#export-feedback').textContent(), '已发起导出；尚未验证是否保存、安装或授权。');
    await page.evaluate(() => __setupMock.changePermission(false));
    await page.waitForFunction(() => document.getElementById('browser-permission').textContent === '未授权');
    await page.evaluate(() => { __setupMock.permissionFailure = true; __setupMock.changePermission(true); });
    await page.waitForFunction(() => document.getElementById('browser-permission').textContent === '未知');
    await page.locator('#language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('#export-feedback').textContent(), 'Export initiated; saving, installation and authorization are not verified.');
    assert.equal(await page.locator('#extension-id').textContent(), extensionId);
    assert.equal(fixture.downloads.length, 1);
    pass('Chinese dynamic labels, consented download and translated receipt never translate metadata or claim saving, installation or grants');
  });

  for (const permissionFailure of [false, true]) {
    await withFixture({ granted: true, permissionFailure }, async fixture => {
      const { page } = fixture;
      await page.waitForFunction(text => document.getElementById('browser-permission').textContent === text, permissionFailure ? 'Unknown' : 'Granted');
      await chooseTarget(fixture, 'linux-server');
      assert.equal(await page.locator('#reviewSetup').isEnabled(), true, 'handoff export does not require native permission');
      await page.evaluate(() => { __setupMock.permissionFailure = false; __setupMock.changePermission(false); });
      await page.waitForFunction(() => document.getElementById('browser-permission').textContent === 'Not granted');
      await page.evaluate(() => __setupMock.changePermission(true));
      await page.waitForFunction(() => document.getElementById('browser-permission').textContent === 'Granted');
      await page.evaluate(() => { __setupMock.permissionFailure = true; __setupMock.changePermission(false); });
      await page.waitForFunction(() => document.getElementById('browser-permission').textContent === 'Unknown');
      assert.equal(await page.locator('#reviewSetup').isEnabled(), true);
      assert.equal(fixture.downloads.length, 0);
    });
  }
  pass('permission failure, grant and revocation remain distinct read-only browser observations, never target or chat acceptance');

  for (const uiLanguage of ['en', 'zh_CN']) {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [{ width: 1100, height: 820 }, { width: 320, height: 600 }]) {
        await withFixture({ uiLanguage, colorScheme, viewport }, async fixture => {
          const { page } = fixture;
          assert.equal(await page.locator('html').getAttribute('lang'), uiLanguage === 'en' ? 'en' : 'zh-CN');
          for (const target of targets) {
            await chooseTarget(fixture, target);
            await layout(page, colorScheme);
          }
          await chooseTarget(fixture, 'windows');
          await page.locator('#installConsent').check();
          await layout(page, colorScheme);
          await capture(page, `setup-${uiLanguage}-${colorScheme}-${viewport.width}.png`);
          await page.locator('#windowsStandaloneInstall > summary').click();
          await page.locator('#openWindowsLocalControls').click();
          await layout(page, colorScheme);
          await page.locator('#closeLocalControl').click();
          await openReview(fixture, 'windows');
          await layout(page, colorScheme);
          await capture(page, `setup-review-${uiLanguage}-${colorScheme}-${viewport.width}.png`);
          await page.locator('#cancelSetup').click();
          await waitForReviewClosed(page);
        });
        pass(`${uiLanguage} ${colorScheme} ${viewport.width}x${viewport.height}: all targets and review fit without overlap or overflow`);
      }
    }
  }
  for (const uiLanguage of ['en', 'zh_CN']) {
    await withFixture({ uiLanguage, noEntryMetadata: true }, async ({ page }) => {
      await page.locator('#installConsent').check();
      for (const scope of ['current-account', 'administrator']) {
        await page.locator('#windowsAccessScope').selectOption(scope);
        await page.locator('#installConsent').check();
        assert.equal(await page.locator('#copyWindowsBrowserPowerShell').isDisabled(), true);
        assert.equal(await page.locator('#copyWindowsBrowserCmd').isDisabled(), true);
        assert.match(await page.locator('#installFeedback').innerText(), uiLanguage === 'en' ? /no verified release entry/ : /未包含已核验/);
      }
      assert.deepEqual(await clipboardWrites(page), []);
      assert.deepEqual(await page.evaluate(() => __setupMock.setupMessages), []);
      assert.deepEqual(await page.evaluate(() => __setupMock.permissionRequests), []);
    });
    pass(`${uiLanguage}: absent entry metadata disables remote setup before permission, BEGIN or copy`);
  }
  await probeQueuedCloseRace();
  console.log(`Setup UI: ${checks}/${checks} checks passed (synthetic only; no real websites, accounts, installed extension, installer or native host).`);
  }
} finally { await browser.close(); }
