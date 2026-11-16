import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sourceUrl = new URL('./background-v2-tests.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const boundary = source.indexOf('\nasync function scenario(');
assert.notEqual(boundary, -1);
const fixture = source.slice(0, boundary).replace('import.meta.url', JSON.stringify(sourceUrl.href));
const { harness, copy, deferred, until } = await import(`data:text/javascript;base64,${Buffer.from(`${fixture}\nexport { harness, copy, deferred, until };`).toString('base64')}`);
const alarmName = 'agent-continue-heartbeat';

for (const restartKind of ['worker', 'browser']) for (const mode of ['repeat', 'queue-loop']) {
  test(`${restartKind} restart during ${mode} sending fences until explicit recovery`, { timeout: 10000 }, async t => {
    const original = await harness();
    await original.start({ mode, prompt: 'SYNTHETIC_REPEAT', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    const receipt = deferred();
    original.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
    const sending = original.message({ type: 'SEND_NOW' });
    const realNow = Date.now;
    let restarted;
    try {
      await until(() => original.sends().length === 1, 'in-flight send');
      const { runId } = original.sends()[0].args[0];
      const deadline = original.state.session.job.runDeadline;
      assert.ok(deadline > realNow());
      assert.equal(original.state.local.resumeJob.runDeadline, deadline);
      assert.equal((await original.message({ type: 'CHECK_RUN', runId }, original.sender())).allowed, true);
      const seed = { local: copy(original.state.local) };
      if (restartKind === 'worker') seed.session = copy(original.state.session);
      restarted = await harness(seed);
      const restored = copy(restarted.state.session.job);
      const durable = copy(restarted.state.local.resumeJob);
      Date.now = () => deadline - 1;
      const oldPermit = await restarted.message({ type: 'CHECK_RUN', runId }, restarted.sender());
      const resumeBefore = await restarted.message({ type: 'RESUME' });
      const startBefore = await restarted.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_REPLACEMENT' } });
      const sendBefore = await restarted.message({ type: 'SEND_NOW' });
      t.diagnostic(JSON.stringify({ restartKind, mode, deadline, sessionFence: restored.submissionFenceUntil ?? null,
        durableFence: durable.submissionFenceUntil ?? null, oldPermit: oldPermit.allowed,
        resumeBefore: resumeBefore.ok, startBefore: startBefore.ok, sendBefore: sendBefore.ok }));
      assert.ok(realNow() < deadline);
      assert.equal(restored.enabled, false);
      assert.equal(restored.phase, 'idle');
      assert.equal(restored.unknownCount, 1);
      assert.equal(restored.sentCount, 0);
      assert.equal(restored.queueIndex, 0);
      assert.ok(restored.submissionFenceUntil >= deadline);
      assert.ok(durable.submissionFenceUntil >= deadline);
      assert.equal(oldPermit.allowed, false);
      assert.equal(resumeBefore.ok, false);
      assert.equal(startBefore.ok, false);
      assert.equal(sendBefore.ok, false);
      assert.equal(restarted.state.session.job.enabled, false);
      assert.equal(restarted.state.local.resumeJob.enabled, false);
      assert.equal(restarted.state.session.job.queueIndex, 0);
      assert.equal(restarted.state.alarms.has(alarmName), false);
      assert.equal(restarted.sends().length, 0);
      Date.now = () => deadline;
      await restarted.tick({ due: false });
      assert.equal((await restarted.message({ type: 'SEND_NOW' })).ok, false);
      assert.equal(restarted.sends().length, 0);
      assert.equal(restarted.state.session.job.enabled, false);
      const resumed = await restarted.message({ type: 'RESUME' });
      assert.equal(resumed.ok, true);
      assert.equal(restarted.sends().length, 0);
      assert.equal(restarted.state.alarms.has(alarmName), true);
      const sent = await restarted.message({ type: 'SEND_NOW' });
      assert.equal(sent.ok, true);
      assert.equal(restarted.sends().length, 1);
      assert.equal(restarted.sends()[0].args[0].prompt, mode === 'repeat' ? 'SYNTHETIC_REPEAT' : 'SYNTHETIC_FIRST');
      assert.equal(restarted.state.session.job.sentCount, 1);
      assert.equal(restarted.state.session.job.unknownCount, 1);
      assert.equal(restarted.state.session.job.queueIndex, mode === 'repeat' ? 0 : 1);
    } finally {
      Date.now = realNow;
      if (restarted) await restarted.message({ type: 'PAUSE' });
      globalThis.chrome = original.chrome;
      receipt.resolve({ status: 'unknown' });
      await sending;
      await original.message({ type: 'PAUSE' });
    }
  });
}

for (const restartKind of ['worker', 'browser']) {
  test(`${restartKind} restart during read-only reply check retains the reply gate without a submission fence`, { timeout: 10000 }, async t => {
    const original = await harness();
    await original.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }], scheduleMode: 'after-reply' });
    assert.equal((await original.message({ type: 'SEND_NOW' })).ok, true);
    const check = deferred();
    original.pageResult = args => args.mode === 'check' ? check.promise : { status: 'sent' };
    original.state.session.job.nextAt = Date.now() - 1;
    original.chrome.alarms.onAlarm.emit({ name: alarmName });
    let restarted;
    try {
      await until(() => original.state.session.job.runKind === 'reply-check' && original.state.injections.length >= 3, 'in-flight read-only check');
      const inFlight = copy(original.state.session.job);
      assert.equal(inFlight.phase, 'sending');
      assert.equal(inFlight.awaitingReply, true);
      assert.ok(inFlight.runDeadline > Date.now());
      const seed = { local: copy(original.state.local) };
      if (restartKind === 'worker') seed.session = copy(original.state.session);
      restarted = await harness(seed);
      const restored = copy(restarted.state.session.job);
      const durable = copy(restarted.state.local.resumeJob);
      const oldPermit = await restarted.message({ type: 'CHECK_RUN', runId: inFlight.runId }, restarted.sender());
      t.diagnostic(JSON.stringify({ restartKind, enabled: restored.enabled, awaitingReply: restored.awaitingReply,
        sessionFence: restored.submissionFenceUntil ?? null, durableFence: durable.submissionFenceUntil ?? null,
        unknownCount: restored.unknownCount, sentCount: restored.sentCount, queueIndex: restored.queueIndex }));
      assert.equal(restored.enabled, true);
      assert.equal(restored.phase, 'idle');
      assert.equal(restored.awaitingReply, true);
      assert.equal(restored.unknownCount, 0);
      assert.equal(restored.sentCount, 1);
      assert.equal(restored.queueIndex, 1);
      assert.ok(!(restored.submissionFenceUntil > Date.now()));
      assert.ok(!(durable.submissionFenceUntil > Date.now()));
      assert.equal(oldPermit.allowed, false);
      assert.equal(restarted.state.alarms.has(alarmName), true);
      await restarted.tick();
      assert.equal(restarted.sends().length, 0);
      assert.equal(restarted.state.session.job.awaitingReply, true);
      assert.equal(restarted.state.session.job.queueIndex, 1);
    } finally {
      if (restarted) await restarted.message({ type: 'PAUSE' });
      globalThis.chrome = original.chrome;
      check.resolve({ status: 'ready', assistantToken: 'synthetic-assistant-0', assistantCount: 1 });
      await original.message({ type: 'PAUSE' });
    }
  });
}
