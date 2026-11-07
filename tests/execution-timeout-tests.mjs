import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8')
  .match(/async function executePage\([\s\S]*?(?=\r?\nasync function probe\()/)?.[0];
assert.ok(source, 'Execute the actual complete worker injection function.');

function fixture() {
  let resolve, reject, clock = 1000, scheduled, cleared = 0, requests = 0;
  const injection = new Promise((yes, no) => { resolve = yes; reject = no; });
  const execute = vm.runInNewContext(`${source}\nexecutePage`, {
    chrome: { scripting: { executeScript() { requests++; return injection; } } },
    pageAction() {}, translatePageResult: value => value,
    RESULT_STATUSES: new Set(['ready', 'sent', 'busy', 'draft', 'done', 'blocked', 'cancelled', 'unknown', 'error']),
    EXECUTION_MS: 20000, Date: { now: () => clock }, t: value => value,
    fail: message => new Error(message),
    setTimeout(callback, milliseconds) { scheduled = { callback, milliseconds }; return 1; },
    clearTimeout() { cleared++; },
  });
  return { run: () => execute({ mode: 'send', prompt: 'SYNTHETIC_ONLY' }, 7, 21000),
    resolve, reject, expire() { clock = 21000; scheduled.callback(); },
    advance() { clock = 22000; }, state: () => ({ requests, cleared, milliseconds: scheduled?.milliseconds }) };
}

test('only the worker watchdog produces execution-timeout; late injection never replays', async () => {
  const h = fixture();
  const pending = h.run();
  h.expire();
  const result = await pending;
  assert.equal(result.status, 'unknown');
  assert.equal(result.diagnosticCode, 'execution-timeout');
  assert.equal(h.state().milliseconds, 20000);
  h.resolve([{ frameId: 0, result: { status: 'sent', message: 'SYNTHETIC_LATE' } }]);
  await Promise.resolve();
  assert.deepEqual(h.state(), { requests: 1, cleared: 1, milliseconds: 20000 });
  assert.equal(result.diagnosticCode, 'execution-timeout');
});

test('API rejection stays an API exception even when wall-clock time passes the deadline', async () => {
  const h = fixture();
  const pending = h.run();
  h.advance();
  const error = new Error('SYNTHETIC_REJECTION');
  h.reject(error);
  await assert.rejects(pending, value => value === error);
  assert.equal(h.state().requests, 1);
  assert.equal(h.state().cleared, 1);
});

test('an accepted injection preserves its bounded result and clears the watchdog', async () => {
  const h = fixture();
  const pending = h.run();
  h.resolve([{ frameId: 0, result: { status: 'sent', message: 'Synthetic result', privateField: 'MUST_NOT_RETURN' } }]);
  const result = await pending;
  assert.equal(result.status, 'sent');
  assert.equal(Object.hasOwn(result, 'privateField'), false);
  assert.equal(h.state().cleared, 1);
});
