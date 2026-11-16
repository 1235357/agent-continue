import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sourceUrl = new URL('./background-v2-tests.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const boundary = source.indexOf('\nasync function scenario(');
assert.notEqual(boundary, -1, 'Existing harness boundary must be present');
const harnessSource = source.slice(0, boundary).replace('import.meta.url', JSON.stringify(sourceUrl.href));
const { harness, copy, delay, until } = await import(`data:text/javascript;base64,${Buffer.from(`${harnessSource}\nexport { harness, copy, delay, until };`).toString('base64')}`);
const alarmName = 'agent-continue-heartbeat';

function snapshot(job) {
  if (!job) return null;
  return {
    enabled: job.enabled,
    phase: job.phase,
    lastResult: job.lastResult,
    unknownCount: job.unknownCount,
    sentCount: job.sentCount,
    queueIndex: job.queueIndex,
    nextAt: job.nextAt,
    unknownRecoveryVersion: job.unknownRecoveryVersion ?? null,
    needsAttention: job.needsAttention ?? null,
  };
}

for (const initial of ['worker', 'browser']) for (const failure of ['session', 'local']) for (const restart of ['worker', 'browser']) {
  test(`legacy unknown: ${initial} migration, ${failure} write failure, ${restart} restart`, async t => {
    const first = await harness();
    const started = await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_UNCONFIRMED' }, { text: 'SYNTHETIC_NEXT' }] });
    const legacy = { ...started, enabled: true, phase: 'idle', lastResult: 'unknown', unknownCount: 1,
      sentCount: 0, queueIndex: 0, nextAt: Date.now() - 1000 };
    delete legacy.needsAttention;
    delete legacy.unknownRecoveryVersion;
    const attempts = [];
    let failures = 0;
    const failed = await harness({
      skipReady: true,
      local: { ...copy(first.state.local), resumeJob: copy(legacy) },
      ...(initial === 'worker' ? { session: { job: copy(legacy) } } : {}),
      beforeStorageSet(name, value) {
        const job = name === 'session' ? value.job : value.resumeJob;
        if (!job || job.unknownRecoveryVersion !== 1 || job.enabled !== false) return;
        attempts.push(name);
        if (name === failure && failures === 0) {
          failures += 1;
          throw new Error(`Synthetic ${name} migration write failure`);
        }
      },
    });
    const response = await failed.message({ type: 'GET_STATE' });
    assert.equal(failures, 1, 'The intended migration write must fail');
    assert.equal(failed.sends().length, 0, 'Failed migration must not submit');
    assert.equal(response.ok, failure !== 'session');
    const persisted = { session: copy(failed.state.session), local: copy(failed.state.local) };
    if (failure === 'local') {
      assert.equal(persisted.session.job.enabled, false);
      assert.equal(persisted.local.resumeJob, undefined);
    } else {
      assert.equal(persisted.local.resumeJob.enabled, true);
      assert.equal(persisted.local.resumeJob.unknownRecoveryVersion, undefined);
    }
    failed.chrome.alarms.onAlarm.emit({ name: alarmName });
    const retried = await failed.message({ type: 'GET_STATE' });
    assert.equal(retried.ok, true, 'A new event must retry initialization after a transient failure');
    assert.ok(!failed.state.session.job?.enabled);
    assert.ok(!failed.state.local.resumeJob?.enabled);
    assert.equal(failed.sends().length, 0, 'The retrying alarm must not submit');
    const recovered = await harness({ local: persisted.local, ...(restart === 'worker' ? { session: persisted.session } : {}) });
    if (restart === 'browser') recovered.chrome.runtime.onStartup.emit();
    recovered.chrome.alarms.onAlarm.emit({ name: alarmName });
    await delay(2700);
    const after = await recovered.message({ type: 'GET_STATE' });
    const evidence = {
      attempts,
      failedResponseOk: response.ok,
      retryResponseOk: retried.ok,
      beforeRestart: { session: snapshot(persisted.session.job), local: snapshot(persisted.local.resumeJob) },
      afterRestart: { session: snapshot(recovered.state.session.job), local: snapshot(recovered.state.local.resumeJob) },
      sendsBeforeRestart: failed.sends().length,
      sendsAfterRestart: recovered.sends().length,
      alarmAfterRestart: recovered.state.alarms.has(alarmName),
    };
    t.diagnostic(JSON.stringify(evidence));
    assert.equal(after.ok, true);
    assert.equal(recovered.sends().length, 0, 'An unconfirmed legacy submission must never be resent by recovery');
    assert.ok(!recovered.state.session.job?.enabled);
    assert.ok(!recovered.state.local.resumeJob?.enabled);
    assert.equal(recovered.state.alarms.has(alarmName), false);
    if (recovered.state.session.job) {
      assert.equal(recovered.state.session.job.lastResult, 'unknown');
      assert.equal(recovered.state.session.job.unknownCount, 1);
      assert.equal(recovered.state.session.job.sentCount, 0);
      assert.equal(recovered.state.session.job.queueIndex, 0);
    }
  });
}

for (const restart of ['worker', 'browser']) {
  test(`legacy unknown: paused local write and removal fail, ${restart} restart`, async t => {
    const first = await harness();
    const started = await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_UNCONFIRMED' }, { text: 'SYNTHETIC_NEXT' }] });
    const legacy = { ...started, enabled: true, phase: 'idle', lastResult: 'unknown', unknownCount: 1,
      sentCount: 0, queueIndex: 0, nextAt: Date.now() - 1000 };
    delete legacy.needsAttention;
    delete legacy.unknownRecoveryVersion;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let failedWrites = 0, failedRemovals = 0;
    const failed = await harness({
      skipReady: true,
      local: { ...copy(first.state.local), resumeJob: copy(legacy) },
      session: { job: copy(legacy) },
      async beforeStorageSet(name, value) {
        if (name === 'local' && value.resumeJob?.unknownRecoveryVersion === 1 && !value.resumeJob.enabled) {
          failedWrites += 1;
          await gate;
          throw new Error('Synthetic paused recovery write failure');
        }
      },
    });
    failed.beforeStorageRemove = (name, key) => {
      if (name === 'local' && key === 'resumeJob') {
        failedRemovals += 1;
        throw new Error('Synthetic stale recovery removal failure');
      }
    };
    const pending = failed.message({ type: 'GET_STATE' });
    try {
      await until(() => failedWrites === 1, 'initial migration write failure');
    } finally {
      release();
    }
    const response = await pending;
    assert.equal(failedWrites, 1);
    assert.equal(failedRemovals, 1);
    assert.equal(response.ok, false);
    assert.equal(failed.sends().length, 0);
    const persisted = { session: copy(failed.state.session), local: copy(failed.state.local) };
    assert.equal(persisted.session.job.enabled, false);
    assert.equal(persisted.local.resumeJob.enabled, true);
    assert.equal(persisted.local.resumeJob.unknownRecoveryVersion, undefined);
    failed.chrome.alarms.onAlarm.emit({ name: alarmName });
    await until(() => failedRemovals === 2, 'alarm retry of the failed migration');
    assert.equal(failedWrites, 2, 'The new alarm must retry the failed write');
    assert.equal(failed.sends().length, 0, 'The retrying alarm must not submit while storage fails');
    const recovered = await harness({ local: persisted.local, ...(restart === 'worker' ? { session: persisted.session } : {}) });
    if (restart === 'browser') recovered.chrome.runtime.onStartup.emit();
    recovered.chrome.alarms.onAlarm.emit({ name: alarmName });
    await delay(2700);
    t.diagnostic(JSON.stringify({ failedWrites, failedRemovals,
      beforeRestart: { session: snapshot(persisted.session.job), local: snapshot(persisted.local.resumeJob) },
      afterRestart: { session: snapshot(recovered.state.session.job), local: snapshot(recovered.state.local.resumeJob) },
      sendsBeforeRestart: failed.sends().length, sendsAfterRestart: recovered.sends().length }));
    assert.equal(recovered.sends().length, 0);
    assert.equal(recovered.state.session.job.enabled, false);
    assert.equal(recovered.state.local.resumeJob.enabled, false);
    assert.equal(recovered.state.alarms.has(alarmName), false);
  });
}

test('the harness records a due enabled job send', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_CONTROL' }, { text: 'SYNTHETIC_NEXT' }] });
  await h.tick();
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});
