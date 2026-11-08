import test from 'node:test';
import assert from 'node:assert/strict';
import { runHostedAcceptanceWindow } from './hosted-acceptance-window.mjs';

const paused = { paused: true, ready: false, runtime: 'stopped' };
const ready = { paused: false, ready: true, runtime: 'running' };
const unknown = { paused: true, ready: false, runtime: 'unknown' };

function fixture(overrides = {}) {
  const calls = [];
  const controller = Object.fromEntries(Object.entries({
    status: () => paused, reconnect: () => ready, pause: () => paused, dispose() {}, ...overrides,
  }).map(([name, action]) => [name, () => { calls.push(name); return action(); }]));
  const options = { windowMs: 100, pollMs: 10, shouldStop: () => false, onReady: () => { calls.push('ready'); } };
  return { controller, calls, options };
}

test('operator stop releases only after confirmed pause', async () => {
  const { controller, calls, options } = fixture();
  options.shouldStop = () => calls.includes('ready');
  assert.deepEqual(await runHostedAcceptanceWindow(controller, options), {
    outcome: 'stop-requested', wasReady: true, paused: true, controllerReleased: true,
  });
  assert.deepEqual(calls, ['status', 'reconnect', 'ready', 'pause', 'dispose']);
});

test('expiry persists pause and an initial stop never connects', async () => {
  const one = fixture();
  assert.equal((await runHostedAcceptanceWindow(one.controller, { ...one.options, windowMs: 15 })).outcome, 'window-expired');
  assert.deepEqual(one.calls.slice(-2), ['pause', 'dispose']);
  const two = fixture();
  assert.equal((await runHostedAcceptanceWindow(two.controller, { ...two.options, shouldStop: () => true })).wasReady, false);
  assert.deepEqual(two.calls, ['status', 'pause', 'dispose']);
});

test('failed readiness and exceptions still pause without leaking raw errors', async () => {
  for (const [overrides, outcome] of [[{ reconnect: () => unknown }, 'start-unconfirmed'],
    [{ reconnect() { throw new Error('private failure'); } }, 'acceptance-error']]) {
    const { controller, calls, options } = fixture(overrides);
    assert.deepEqual(await runHostedAcceptanceWindow(controller, options), {
      outcome, wasReady: false, paused: true, controllerReleased: true,
    });
    assert.deepEqual(calls, ['status', 'reconnect', 'pause', 'dispose']);
  }
});

test('stop interrupts connection startup and never publishes a late ready', async () => {
  let finishStartup;
  const pending = new Promise(resolve => { finishStartup = resolve; });
  const { controller, calls, options } = fixture({ reconnect: () => pending, pause() { finishStartup(ready); return paused; } });
  options.shouldStop = () => calls.includes('reconnect');
  const result = await runHostedAcceptanceWindow(controller, options);
  assert.equal(result.outcome, 'stop-requested');
  assert.equal(result.wasReady, false);
  assert.deepEqual(calls, ['status', 'reconnect', 'pause', 'dispose']);
});

test('active state is not taken over and an unconfirmed stop retains ownership', async () => {
  const one = fixture({ status: () => ready });
  await assert.rejects(runHostedAcceptanceWindow(one.controller, one.options), /acceptance_requires_paused_owner/);
  assert.deepEqual(one.calls, ['status']);
  const two = fixture({ pause: () => unknown });
  two.options.shouldStop = () => two.calls.includes('ready');
  await assert.rejects(runHostedAcceptanceWindow(two.controller, two.options), /acceptance_stop_unconfirmed/);
  assert.deepEqual(two.calls, ['status', 'reconnect', 'ready', 'pause']);
});
