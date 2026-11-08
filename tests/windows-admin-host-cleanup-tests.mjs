import assert from 'node:assert/strict';
import test from 'node:test';
import { closeHostResources } from '../native/desktop-commander/host.mjs';

test('host closes admission before a pending SDK shutdown and observes both completions', async () => {
  let resolveSdk, resolveWitness;
  const events = [];
  const sdk = new Promise(resolve => { resolveSdk = resolve; });
  const witness = new Promise(resolve => { resolveWitness = resolve; });
  const closing = closeHostResources({ close() { events.push('sdk'); return sdk; } },
    { close() { events.push('witness'); return witness; } });
  await Promise.resolve();
  assert.deepEqual(events, ['witness', 'sdk']);
  let settled = false; void closing.then(() => { settled = true; });
  resolveSdk(); await Promise.resolve();
  assert.equal(settled, false);
  resolveWitness(); await closing;
});

test('SDK failure cannot skip witness cleanup or hide unconfirmed cleanup', async () => {
  let closes = 0;
  await assert.rejects(closeHostResources({ close: async () => { throw new Error('SDK closed'); } },
    { close: async () => { closes++; throw new Error('browser_peer_cleanup_unconfirmed'); } }), /cleanup_unconfirmed/);
  assert.equal(closes, 1);
});
