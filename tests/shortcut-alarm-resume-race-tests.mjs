import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sourceUrl = new URL('./background-v2-tests.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const boundary = source.indexOf('\nasync function scenario(');
assert.notEqual(boundary, -1);
const fixture = source.slice(0, boundary).replace('import.meta.url', JSON.stringify(sourceUrl.href));
const { harness, deferred, until, copy } = await import(`data:text/javascript;base64,${Buffer.from(`${fixture}\nexport { harness, deferred, until, copy };`).toString('base64')}`);
const alarmName = 'agent-continue-heartbeat';

async function delayedShortcut(h) {
  const entered = deferred();
  const release = deferred();
  let held = false;
  h.beforeStorageGet = async (area, key) => {
    if (!held && area === 'session' && key === 'job') {
      held = true;
      entered.resolve();
      await release.promise;
    }
  };
  h.chrome.commands.onCommand.emit('toggle-running');
  await until(() => held, 'shortcut job read');
  await entered.promise;
  return release;
}

test('a due alarm cannot send the old run after the Pause shortcut', { timeout: 5000 }, async t => {
  const h = await harness();
  await h.start({ prompt: 'SYNTHETIC_OLD' });
  h.state.session.job.nextAt = Date.now() - 1;
  const release = await delayedShortcut(h);
  try {
    h.chrome.alarms.onAlarm.emit({ name: alarmName });
  } finally {
    release.resolve();
  }
  await until(() => h.state.session.job.enabled === false, 'shortcut pause');
  await h.message({ type: 'GET_STATE' });
  t.diagnostic(JSON.stringify({ sends: h.sends().map(item => item.args[0].prompt), session: h.state.session.job.enabled,
    durable: h.state.local.resumeJob.enabled, alarm: h.state.alarms.has(alarmName) }));
  assert.equal(h.sends().length, 0, 'No old alarm send is allowed after the shortcut');
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.alarms.has(alarmName), false);
});

test('a newer Resume wins over a delayed Pause shortcut and its old alarm', { timeout: 5000 }, async t => {
  const h = await harness();
  await h.start({ prompt: 'SYNTHETIC_OLD' });
  const original = copy(h.state.session.job);
  h.state.session.job.nextAt = Date.now() - 1;
  const release = await delayedShortcut(h);
  let resume;
  try {
    h.chrome.alarms.onAlarm.emit({ name: alarmName });
    resume = h.message({ type: 'RESUME' });
  } finally {
    release.resolve();
  }
  const response = await resume;
  const settled = await h.message({ type: 'GET_STATE' });
  const session = copy(h.state.session.job);
  const durable = copy(h.state.local.resumeJob);
  t.diagnostic(JSON.stringify({ resumeOk: response.ok, sends: h.sends().map(item => item.args[0].prompt),
    sessionEnabled: session.enabled, durableEnabled: durable.enabled, alarm: h.state.alarms.has(alarmName),
    sessionRunChanged: session.runId !== original.runId, sentCount: session.sentCount }));
  assert.equal(settled.ok, true);
  assert.equal(response.ok, true, 'The newer Resume must be accepted');
  assert.equal(h.sends().length, 0, 'The old alarm must not send');
  assert.equal(session.sentCount, 0);
  assert.equal(session.enabled, true, 'The older shortcut must not overwrite the newer Resume');
  assert.equal(durable.enabled, true, 'Recovery state must retain the newer Resume');
  assert.equal(h.state.alarms.has(alarmName), true);
});
