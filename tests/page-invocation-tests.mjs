import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.EXTENSION_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const { pageAction, pageInvocationState } = await import(pathToFileURL(path.join(root, 'adapter.js')));

function harness() {
  const listeners = new Set();
  const context = vm.createContext({ URL, chrome: { runtime: { id: 'synthetic-extension',
    onMessage: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
  } } });
  const invoke = vm.runInContext(`(${pageAction.toString()})`, context);
  const observe = vm.runInContext(`(${pageInvocationState.toString()})`, context);
  const args = { mode: 'send', runId: 'synthetic-run', resultToken: 'synthetic-token', expectedUrl: 'invalid-url' };
  return { invoke, observe, args, listeners, size: () => vm.runInContext('__agentContinuePageInvocationsV1.size', context) };
}

test('uncaught page setup failure settles the exact invocation without exposing exception data', async () => {
  const h = harness();
  const first = await h.invoke(h.args);
  assert.equal(first.status, 'unknown');
  const observed = h.observe(h.args);
  assert.equal(observed.state, 'settled');
  assert.equal(observed.result, first);
  assert.equal(await h.invoke(h.args), first);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(Object.keys(observed).sort(), ['result', 'state']);
  assert.deepEqual(Object.keys(first).sort(), ['diagnosticProgress', 'message', 'status']);
  assert.equal(first.diagnosticProgress.counters.pageAdmissions, 1);
  assert.equal(JSON.stringify(first).includes('invalid-url'), false);
});

test('invocation tokens cannot join another run and unknown tokens expose no registry data', async () => {
  const h = harness();
  await h.invoke(h.args);
  const foreign = { ...h.args, runId: 'different-run' };
  assert.equal((await h.invoke(foreign)).status, 'cancelled');
  assert.equal(h.observe(foreign).state, 'absent');
  assert.equal(h.observe({ ...h.args, resultToken: 'missing-token' }).state, 'absent');
  assert.equal(h.size(), 1);
});

test('settled page entries remain bounded while the newest result stays readable', async () => {
  const h = harness();
  for (let index = 0; index < 20; index++) await h.invoke({ ...h.args, resultToken: `synthetic-${index}` });
  assert.equal(h.size(), 8);
  assert.equal(h.observe({ ...h.args, resultToken: 'synthetic-0' }).state, 'absent');
  assert.equal(h.observe({ ...h.args, resultToken: 'synthetic-19' }).state, 'settled');
  assert.equal(h.listeners.size, 0);
});
