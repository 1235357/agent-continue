import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { openBrowserControl } from '../native/bootstrap/browser-control.mjs';

test('installed test extension embeds only its loopback panel and keeps pairing out of extension storage', { timeout: 45000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const base = await fs.realpath(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(base, 'agent-continue-embed-'));
  let context, session, unrelated, releaseHeld;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [
      '--disable-background-networking', '--no-first-run', `--disable-extensions-except=${root}`, `--load-extension=${root}`,
    ] });
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js')) ||
      await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 12000 });
    const extensionOrigin = 'chrome-extension://' + new URL(worker.url()).hostname;
    const actions = [], requests = [];
    const pendingKey = 'agentContinueLoopbackPendingV1';
    let uncertain = false, revealReceipt = false, operation, held, completed;
    let paused = false, connected = false;
    const handle = async ({ id, action }) => {
      actions.push(action);
      requests.push({ id, action });
      if (action !== 'status' && held) {
        const gate = held;
        held = undefined;
        gate.arrived();
        await gate.wait;
      }
      if (action === 'reconnect') { paused = false; connected = true; }
      if (action === 'disconnect-and-pause') { paused = true; connected = false; }
      if (action !== 'status') operation = id;
      if (action !== 'status' && completed) { completed(); completed = undefined; }
      if (action !== 'status' && uncertain) return { ok: false, id };
      const receipt = operation === id && (!uncertain || revealReceipt) ? { operation: { status: 'settled' } } : {};
      return { ok: true, id, state: { paused, connection: connected ? 'ready' : 'disconnected', ...receipt } };
    };
    session = await openBrowserControl(handle, { extensionOrigin });
    unrelated = await openBrowserControl(async () => { throw new Error('other extension reached'); }, {
      extensionOrigin: 'chrome-extension://' + (extensionOrigin.endsWith('a'.repeat(32)) ? 'b' : 'a').repeat(32),
    });
    const page = await context.newPage();
    await page.goto(extensionOrigin + '/setup.html');
    await page.locator('#managementSection summary').click();
    const ticket = page.getByLabel('Pairing ticket from terminal', { exact: true });
    const open = page.getByRole('button', { name: 'Open controls', exact: true });
    for (const invalid of ['https://external.invalid:52817', session.pairingTicket + '?extra', session.code]) {
      await ticket.fill(invalid);
      await open.click();
      await page.getByText('Invalid pairing ticket.', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.locator('#localControlFrame').getAttribute('src'), null);
      assert.equal(await ticket.inputValue(), '');
      assert.equal(await ticket.getAttribute('aria-invalid'), 'true');
    }
    await ticket.fill(unrelated.pairingTicket);
    await open.click();
    await page.getByText('Local session could not be authenticated.', { exact: true }).waitFor({ state: 'visible', timeout: 12000 });
    assert.equal(await page.locator('#localControlFrame').getAttribute('src'), null);
    const forged = session.origin + '/embed';
    await page.route(forged, route => route.fulfill({ status: 200, contentType: 'text/html', body: `<script>
      addEventListener('message', e => { const port = e.ports[0]; port.onmessage = () => port.postMessage(JSON.stringify({payload:'{}',mac:'0'.repeat(64)})); });
      </script>` }));
    await ticket.fill(session.pairingTicket);
    await open.click();
    await page.getByText('Local session could not be authenticated.', { exact: true }).waitFor({ state: 'visible', timeout: 12000 });
    assert.ok(!(await page.locator('#localControlButtons').isVisible()));
    assert.deepEqual(actions, []);
    await page.unroute(forged);
    await ticket.fill(session.pairingTicket);
    await open.click();
    await page.getByText('Local runtime disconnected.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await ticket.inputValue(), '');
    assert.equal(await page.locator('#localControlFrame').getAttribute('src'), session.origin + '/embed');
    for (const [button, state] of [['Reconnect', 'Local runtime ready.'], ['Disconnect and pause', 'Local runtime paused.']]) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await page.getByText(state, { exact: true }).waitFor({ state: 'visible' });
    }
    assert.deepEqual(actions, ['status', 'reconnect', 'disconnect-and-pause']);
    assert.equal(await page.evaluate(() => document.querySelector('#localControlFrame').contentDocument), null);

    uncertain = true;
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await page.getByText('Local operation unconfirmed.', { exact: true }).waitFor();
    const pending = operation;
    assert.equal(await page.evaluate(async key => (await chrome.storage.session.get(key))[key], pendingKey), pending);
    await page.reload();
    await page.locator('#managementSection summary').click();
    await session.close();
    session = await openBrowserControl(handle, { extensionOrigin });
    await ticket.fill(session.pairingTicket);
    await open.click();
    await page.locator('#localControlButtons').waitFor();
    assert.deepEqual(requests.at(-1), { id: pending, action: 'status' });
    assert.equal(await page.locator('#localControlReconnect').isDisabled(), true);
    assert.equal(await page.locator('#localControlPause').isDisabled(), true);
    assert.equal(await page.evaluate(async key => (await chrome.storage.session.get(key))[key], pendingKey), pending);
    revealReceipt = true;
    await page.locator('#localControlCheck').click();
    await page.waitForFunction(() => !document.getElementById('localControlReconnect').disabled);
    assert.deepEqual(requests.slice(-3), [
      { id: pending, action: 'reconnect' }, { id: pending, action: 'status' }, { id: pending, action: 'status' },
    ]);
    assert.equal(await page.evaluate(async key => (await chrome.storage.session.get(key))[key] ?? null, pendingKey), null);

    uncertain = false;
    const second = await context.newPage();
    await second.goto(extensionOrigin + '/setup.html');
    await second.locator('#managementSection summary').click();
    await second.locator('#localControlTicket').fill(session.pairingTicket);
    await second.locator('#localControlForm button[type=submit]').click();
    await second.locator('#localControlButtons').waitFor();
    const started = new Promise(arrived => {
      held = { arrived, wait: new Promise(resolve => { releaseHeld = resolve; }) };
    });
    const ended = new Promise(resolve => { completed = resolve; });
    const before = actions.length;
    await page.locator('#localControlPause').click();
    await started;
    await second.locator('#localControlReconnect').click();
    await second.getByText('Local controls are busy. Check status before starting another action.', { exact: true }).waitFor();
    const heldId = requests.at(-1).id;
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    const busyStatus = second.waitForResponse(response => response.status() === 409 &&
      response.url() === session.origin + '/v1/signed-control');
    await second.locator('#localControlCheck').click();
    await busyStatus;
    assert.equal(await second.evaluate(async key => (await chrome.storage.session.get(key))[key], pendingKey), heldId);
    assert.equal(await second.locator('#localControlReconnect').isDisabled(), true);
    releaseHeld();
    assert.deepEqual(actions.slice(before), ['disconnect-and-pause']);
    await ended;
    await second.locator('#localControlCheck').click();
    await second.getByText('Local runtime paused.', { exact: true }).waitFor();
    await second.waitForFunction(() => !document.getElementById('localControlReconnect').disabled);
    assert.deepEqual(actions.slice(before), ['disconnect-and-pause', 'status']);

    await second.evaluate(key => chrome.storage.session.set({ [key]: 'invalid-journal-record' }), pendingKey);
    await second.locator('#localControlCheck').click();
    await second.getByText('The local session journal is unavailable. Only status checks are allowed.', { exact: true }).waitFor();
    assert.equal(await second.locator('#localControlPause').isDisabled(), true);
    assert.equal(await second.locator('#localControlReconnect').isDisabled(), true);
    assert.equal(requests.at(-1).action, 'status');
    await second.evaluate(key => chrome.storage.session.remove(key), pendingKey);

    const persisted = await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    assert.ok(!persisted.includes(session.code) && !persisted.includes(session.origin));
    const volatile = await page.evaluate(async () => JSON.stringify(await chrome.storage.session.get(null)));
    assert.ok(!volatile.includes(session.code) && !volatile.includes(session.origin));
    await second.setViewportSize({ width: 340, height: 720 });
    assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await second.getByRole('button', { name: 'Close panel', exact: true }).click();
    assert.equal(await second.locator('#localControlFrame').getAttribute('src'), null);
    assert.equal(await second.locator('#localControlTicket').inputValue(), '');
  } finally {
    releaseHeld?.();
    await context?.close();
    await session?.close();
    await unrelated?.close();
    if (path.dirname(await fs.realpath(profile)) !== base || !path.basename(profile).startsWith('agent-continue-embed-')) throw new Error('unsafe_profile_cleanup');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
});
