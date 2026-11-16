import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sourceUrl = new URL('./background-v2-tests.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const boundary = source.indexOf('\nasync function scenario(');
assert.notEqual(boundary, -1, 'Existing harness boundary must be present');
const fixture = source.slice(0, boundary).replace('import.meta.url', JSON.stringify(sourceUrl.href));
const { harness, copy } = await import(`data:text/javascript;base64,${Buffer.from(`${fixture}\nexport { harness, copy };`).toString('base64')}`);
const alarmName = 'agent-continue-heartbeat';

for (const action of ['RESUME', 'PAUSE']) {
  test(`failed sending claim local write can safely ${action.toLowerCase()} after storage recovers`, { timeout: 5000 }, async t => {
    const worker = await harness();
    await worker.start({ prompt: 'SYNTHETIC_CLAIM_RECOVERY', startImmediately: false });
    const before = copy(worker.state.local.resumeJob);
    worker.state.injections.length = 0;
    let failedWrites = 0;
    let sessionAtFailure;
    worker.beforeStorageSet = (area, value) => {
      if (area === 'local' && value.resumeJob?.phase === 'sending') {
        failedWrites += 1;
        sessionAtFailure = copy(worker.state.session.job);
        throw new Error('Synthetic local sending claim write failure');
      }
    };
    const failed = await worker.message({ type: 'SEND_NOW' });
    assert.equal(failed.ok, false, 'The failed local claim must be reported');
    assert.equal(failedWrites, 1, 'The local sending claim must actually fail');
    assert.equal(sessionAtFailure?.phase, 'sending', 'Session must be written before local fails');
    assert.equal(sessionAtFailure.runKind, 'send');
    assert.equal(sessionAtFailure.runId, worker.state.session.job.runId);
    assert.deepEqual(worker.state.local.resumeJob, before, 'The local recovery record must remain unchanged');
    assert.equal(worker.state.injections.length, 0, 'The page must not be injected before the claim is durable');
    assert.equal(worker.state.session.job.sentCount, 0);
    assert.equal(worker.state.session.job.queueIndex, 0);

    worker.beforeStorageSet = undefined;
    const result = await worker.message({ type: action });
    const state = await worker.message({ type: 'GET_STATE' });
    const session = copy(worker.state.session.job);
    const local = copy(worker.state.local.resumeJob);
    const stuckSend = action === 'RESUME' && session?.phase === 'sending'
      ? await worker.message({ type: 'SEND_NOW' }) : null;
    t.diagnostic(JSON.stringify({ action, failedWrites, failedOk: failed.ok,
      sessionAtFailure: sessionAtFailure.phase, localBefore: before.phase,
      injectionCount: worker.state.injections.length, resultOk: result.ok,
      stateOk: state.ok, sessionPhase: session?.phase, sessionEnabled: session?.enabled,
      localPhase: local?.phase, localEnabled: local?.enabled, sentCount: session?.sentCount,
      stuckSendOk: stuckSend?.ok ?? null }));
    assert.equal(state.ok, true);
    assert.equal(worker.state.injections.length, 0, 'Recovery must not automatically inject the page');
    assert.equal(session.sentCount, 0);
    assert.equal(session.queueIndex, 0);
    assert.equal(session.phase, 'idle', 'The unissued claim must not leave the task stuck sending');
    assert.equal(local.phase, 'idle', 'The durable recovery record must not remain sending');
    if (action === 'PAUSE') {
      assert.equal(result.ok, true, 'PAUSE must succeed once storage is healthy');
      assert.equal(session.enabled, false);
    }
    assert.equal(local.enabled, session.enabled);
    assert.equal(worker.state.alarms.has(alarmName), session.enabled);

    if (action === 'RESUME' && session.enabled) {
      assert.equal(result.ok, true);
      const sent = await worker.message({ type: 'SEND_NOW' });
      assert.equal(sent.ok, true, 'A recovered task must accept a new explicit send');
      assert.equal(worker.sends().length, 1);
      assert.equal(worker.sends()[0].args[0].prompt, 'SYNTHETIC_CLAIM_RECOVERY');
      assert.equal(worker.state.session.job.sentCount, 1);
      await worker.message({ type: 'PAUSE' });
    } else {
      for (const restartKind of ['worker', 'browser']) {
        const restarted = await harness({ local: copy(worker.state.local),
          ...(restartKind === 'worker' ? { session: copy(worker.state.session) } : {}) });
        assert.equal(restarted.state.session.job.enabled, false);
        assert.equal(restarted.state.session.job.phase, 'idle');
        assert.equal(restarted.state.local.resumeJob.enabled, false);
        assert.equal(restarted.state.alarms.has(alarmName), false);
        assert.equal(restarted.state.injections.length, 0);
      }
    }
  });
}
