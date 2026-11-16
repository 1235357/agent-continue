import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
after(() => browser.close());

async function pages(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://transaction-fixture.invalid') return route.abort();
    if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic state fixture</title>' });
    if (url.pathname !== '/transactional-state.js') return route.abort();
    let source;
    try { source = await fs.readFile(path.join(root, 'transactional-state.js'), 'utf8'); }
    catch { return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic state module is absent' }); }
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: source });
  });
  const name = `agent-continue-synthetic-${randomUUID()}`;
  const first = await context.newPage();
  const second = await context.newPage();
  for (const page of [first, second]) {
    await page.goto('https://transaction-fixture.invalid/');
    await page.evaluate(async name => {
      const module = await import('/transactional-state.js');
      globalThis.stateStore = await module.openStateStore({ name });
    }, name);
  }
  return { first, second, name };
}

test('clearing fences delayed old config, templates and jobs without overwriting later data', async t => {
  const { first, second } = await pages(t);
  const before = await first.evaluate(() => stateStore.initialize({
    config: { prompt: 'SYNTHETIC_OLD_PROMPT\n' },
    templates: [{ id: 'old', prompt: 'SYNTHETIC_OLD_TEMPLATE' }],
    job: { id: 'old-job', enabled: true, prompt: 'SYNTHETIC_OLD_JOB' },
    privatePresetImported: false,
  }));
  const cleared = await second.evaluate(() => stateStore.clear());
  assert.notEqual(cleared.generation, before.generation);
  assert.equal(cleared.config, null);
  assert.deepEqual(cleared.templates, []);
  assert.equal(cleared.job, null);
  assert.equal(cleared.privatePresetImported, true);
  const fresh = await second.evaluate(token => stateStore.commit(token, {
    config: { prompt: 'SYNTHETIC_NEW_PROMPT' },
    templates: [{ id: 'new', prompt: 'SYNTHETIC_NEW_TEMPLATE' }],
  }), { generation: cleared.generation, revision: cleared.revision });
  assert.equal(fresh.ok, true);
  const stale = await first.evaluate(token => stateStore.commit(token, {
    config: { prompt: 'SYNTHETIC_OLD_PROMPT\n' },
    templates: [{ id: 'old', prompt: 'SYNTHETIC_OLD_TEMPLATE' }],
    job: { id: 'old-job', enabled: true, prompt: 'SYNTHETIC_OLD_JOB' },
  }), { generation: before.generation, revision: before.revision });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'generation');
  const actual = await second.evaluate(() => stateStore.read());
  assert.deepEqual(actual.config, { prompt: 'SYNTHETIC_NEW_PROMPT' });
  assert.deepEqual(actual.templates, [{ id: 'new', prompt: 'SYNTHETIC_NEW_TEMPLATE' }]);
  assert.equal(actual.job, null);
});

test('a write already waiting behind an IndexedDB clear is rejected after the clear commits', async t => {
  const { first, second, name } = await pages(t);
  const before = await first.evaluate(() => stateStore.initialize({ config: { prompt: 'SYNTHETIC_BEFORE_CLEAR' }, templates: [], job: null }));
  await second.evaluate(async name => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('state', 'readwrite');
    const store = transaction.objectStore('state');
    const request = store.get('current');
    globalThis.releaseClear = false;
    globalThis.pendingClear = new Promise((resolve, reject) => {
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => reject(transaction.error);
      const poll = () => {
        const next = store.get('current');
        next.onsuccess = () => {
          if (!globalThis.releaseClear) { poll(); return; }
          store.put({ schema: 1, generation: crypto.randomUUID(), revision: 0, config: null,
            templates: [], job: null, privatePresetImported: true }, 'current');
        };
      };
      request.onsuccess = () => poll();
    });
  }, name);
  await first.evaluate(token => {
    globalThis.lateCommit = stateStore.commit(token, { config: { prompt: 'SYNTHETIC_STALE_WRITE' } });
  }, { generation: before.generation, revision: before.revision });
  await second.evaluate(() => { globalThis.releaseClear = true; });
  await second.evaluate(() => globalThis.pendingClear);
  const late = await first.evaluate(() => globalThis.lateCommit);
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'generation');
  const actual = await first.evaluate(() => stateStore.read());
  assert.equal(actual.config, null);
  assert.deepEqual(actual.templates, []);
  assert.equal(actual.job, null);
});

test('same-generation stale revisions conflict instead of losing another panel edit', async t => {
  const { first, second } = await pages(t);
  const base = await first.evaluate(() => stateStore.initialize({ config: { prompt: 'SYNTHETIC_BASE' }, templates: [], job: null }));
  const token = { generation: base.generation, revision: base.revision };
  const changed = await first.evaluate(token => stateStore.commit(token, { config: { prompt: 'SYNTHETIC_NEW' } }), token);
  assert.equal(changed.ok, true);
  const stale = await second.evaluate(token => stateStore.commit(token, { templates: [{ id: 'new', prompt: 'SYNTHETIC_TEMPLATE' }] }), token);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'revision');
  const current = await second.evaluate(() => stateStore.read());
  const retried = await second.evaluate(token => stateStore.commit(token, { templates: [{ id: 'new', prompt: 'SYNTHETIC_TEMPLATE' }] }),
    { generation: current.generation, revision: current.revision });
  assert.equal(retried.ok, true);
  assert.deepEqual(retried.state.config, { prompt: 'SYNTHETIC_NEW' });
  assert.deepEqual(retried.state.templates, [{ id: 'new', prompt: 'SYNTHETIC_TEMPLATE' }]);
});

test('each clear invalidates stale panels and survives a new connection', async t => {
  const { first, second, name } = await pages(t);
  const base = await first.evaluate(() => stateStore.initialize({ config: { prompt: 'SYNTHETIC_OLD' }, templates: [], job: null }));
  const firstClear = await second.evaluate(() => stateStore.clear());
  const secondClear = await second.evaluate(() => stateStore.clear());
  assert.notEqual(firstClear.generation, secondClear.generation);
  for (const value of [base, firstClear]) {
    const stale = await first.evaluate(token => stateStore.commit(token, { config: { prompt: 'SYNTHETIC_STALE' } }),
      { generation: value.generation, revision: value.revision });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'generation');
  }
  await first.evaluate(() => stateStore.close());
  const reopened = await first.evaluate(async name => {
    const module = await import('/transactional-state.js');
    globalThis.stateStore = await module.openStateStore({ name });
    return stateStore.read();
  }, name);
  assert.deepEqual(reopened, secondClear);
  const fresh = await first.evaluate(token => stateStore.commit(token, { config: { prompt: 'SYNTHETIC_FRESH' } }),
    { generation: reopened.generation, revision: reopened.revision });
  assert.equal(fresh.ok, true);
  assert.deepEqual((await second.evaluate(() => stateStore.read())).config, { prompt: 'SYNTHETIC_FRESH' });
});

test('a storage failure cannot report a successful clear or partial state change', async t => {
  const { first, second } = await pages(t);
  const before = await first.evaluate(() => stateStore.initialize({ config: { prompt: 'SYNTHETIC_SAVED' }, templates: [], job: null }));
  await first.evaluate(() => stateStore.close());
  const rejected = await first.evaluate(async () => {
    try { await stateStore.clear(); return false; } catch { return true; }
  });
  assert.equal(rejected, true);
  assert.deepEqual(await second.evaluate(() => stateStore.read()), before);
});

test('simultaneous writes using one revision allow only one commit', async t => {
  const { first, second } = await pages(t);
  const base = await first.evaluate(() => stateStore.initialize({ config: { prompt: 'SYNTHETIC_BASE' }, templates: [], job: null }));
  const token = { generation: base.generation, revision: base.revision };
  const [one, two] = await Promise.all([
    first.evaluate(token => stateStore.commit(token, { config: { prompt: 'SYNTHETIC_FIRST' } }), token),
    second.evaluate(token => stateStore.commit(token, { config: { prompt: 'SYNTHETIC_SECOND' } }), token),
  ]);
  assert.equal([one, two].filter(result => result.ok).length, 1);
  assert.equal([one, two].filter(result => result.reason === 'revision').length, 1);
  const actual = await first.evaluate(() => stateStore.read());
  assert.equal(actual.revision, base.revision + 1);
  assert.equal(actual.config.prompt, [one, two].find(result => result.ok).state.config.prompt);
});

test('read cannot return an uninitialized default while initial migration is pending', async t => {
  const { first, second, name } = await pages(t);
  await first.evaluate(async name => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('state', 'readwrite');
    const store = transaction.objectStore('state');
    const request = store.get('current');
    globalThis.releaseMigration = false;
    globalThis.pendingMigration = new Promise((resolve, reject) => {
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => reject(transaction.error);
      const poll = () => {
        const next = store.get('current');
        next.onsuccess = () => {
          if (!globalThis.releaseMigration) { poll(); return; }
          store.put({ schema: 1, generation: crypto.randomUUID(), revision: 0,
            config: { prompt: 'SYNTHETIC_MIGRATED' }, templates: [], job: null, privatePresetImported: false }, 'current');
        };
      };
      request.onsuccess = () => poll();
    });
  }, name);
  await second.evaluate(() => { globalThis.pendingRead = stateStore.read(); });
  await first.evaluate(() => { globalThis.releaseMigration = true; });
  await first.evaluate(() => globalThis.pendingMigration);
  const observed = await second.evaluate(() => globalThis.pendingRead);
  assert.deepEqual(observed.config, { prompt: 'SYNTHETIC_MIGRATED' });
});

test('a late legacy migration cannot overwrite an already-cleared generation', async t => {
  const { first, second } = await pages(t);
  const cleared = await first.evaluate(() => stateStore.clear());
  const migrated = await second.evaluate(() => stateStore.initialize({
    config: { prompt: 'SYNTHETIC_STALE_LEGACY' },
    templates: [{ id: 'old', prompt: 'SYNTHETIC_STALE_TEMPLATE' }],
    job: { id: 'old', enabled: true, prompt: 'SYNTHETIC_STALE_JOB' },
    privatePresetImported: false,
  }));
  assert.deepEqual(migrated, cleared);
  assert.equal((await first.evaluate(() => stateStore.read())).config, null);
});

test('transactional state persists exact synthetic data across page reload', async t => {
  const { first, second, name } = await pages(t);
  const seed = { config: { prompt: '  SYNTHETIC\r\n中文 🧭\t\n' }, templates: [], job: { id: 'synthetic', enabled: false }, privatePresetImported: true };
  const initialized = await first.evaluate(seed => stateStore.initialize(seed), seed);
  await second.reload();
  const restored = await second.evaluate(async name => {
    const module = await import('/transactional-state.js');
    const store = await module.openStateStore({ name });
    return store.read();
  }, name);
  assert.deepEqual(restored, initialized);
  assert.deepEqual(restored.config, seed.config);
});

test('a failed clone cannot partially commit a state transition', async t => {
  const { first } = await pages(t);
  const before = await first.evaluate(() => stateStore.initialize({ config: { prompt: 'SYNTHETIC_BASE' }, templates: [], job: null }));
  const failed = await first.evaluate(async token => {
    try {
      await stateStore.commit(token, { config: { prompt: 'SYNTHETIC_CHANGED' }, job: { invalid: () => 1 } });
      return false;
    } catch { return true; }
  }, { generation: before.generation, revision: before.revision });
  assert.equal(failed, true);
  assert.deepEqual(await first.evaluate(() => stateStore.read()), before);
});
