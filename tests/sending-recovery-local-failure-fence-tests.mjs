import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sourceUrl = new URL('./background-v2-tests.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const boundary = source.indexOf('\nasync function scenario(');
assert.notEqual(boundary, -1, 'Existing harness boundary must be present');
const harnessSource = source.slice(0, boundary).replace('import.meta.url', JSON.stringify(sourceUrl.href));
const { harness, deferred, until, copy } = await import(`data:text/javascript;base64,${Buffer.from(`${harnessSource}\nexport { harness, deferred, until, copy };`).toString('base64')}`);

test('sending recovery must fence START after paused local write failure and session loss', { timeout: 5000 }, async t => {
  const first = await harness();
  await first.start({ prompt: 'SYNTHETIC_OLD_RUN', startImmediately: false });
  const receipt = deferred();
  first.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = first.message({ type: 'SEND_NOW' });
  let recovered, restarted;
  try {
    await until(() => first.sends().length === 1, 'in-flight synthetic send');
    const deadline = first.state.session.job.runDeadline;
    assert.ok(Number.isFinite(deadline) && deadline > Date.now());
    assert.equal(first.state.local.resumeJob.phase, 'sending');
    assert.equal(first.state.local.resumeJob.runDeadline, deadline);

    const release = deferred();
    let failedWrites = 0, removals = 0;
    recovered = await harness({
      skipReady: true,
      local: copy(first.state.local),
      async beforeStorageSet(area, value) {
        if (area === 'local' && value.resumeJob?.enabled === false && value.resumeJob.submissionFenceUntil >= deadline) {
          failedWrites += 1;
          await release.promise;
          throw new Error('Synthetic paused local recovery write failure');
        }
      },
    });
    recovered.beforeStorageRemove = (area, key) => {
      if (area === 'local' && key === 'resumeJob') removals += 1;
    };
    try {
      await until(() => failedWrites === 1, 'paused local recovery write');
    } finally {
      release.resolve();
    }
    const recoveryResponse = await recovered.message({ type: 'GET_STATE' });
    assert.equal(recoveryResponse.ok, true);
    assert.equal(failedWrites, 1);
    assert.equal(removals, 1);
    assert.equal(recovered.state.local.resumeJob, undefined);
    assert.equal(recovered.state.session.job.enabled, false);
    assert.ok(recovered.state.session.job.submissionFenceUntil >= deadline);

    restarted = await harness({ local: copy(recovered.state.local) });
    assert.equal(restarted.state.session.job, undefined);
    assert.ok(Date.now() < deadline, 'The original submission deadline must still be live');
    const start = await restarted.message({ type: 'START', tabId: 7,
      config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: false } });
    t.diagnostic(JSON.stringify({ failedWrites, removals, deadlineStillLive: Date.now() < deadline,
      localResumeJobRemoved: recovered.state.local.resumeJob === undefined,
      sessionFenceBeforeLoss: recovered.state.session.job.submissionFenceUntil,
      durableFence: recovered.state.local.submissionFenceUntil ?? null,
      startOk: start.ok, newJobEnabled: restarted.state.session.job?.enabled ?? false,
      newSends: restarted.sends().length }));
    assert.ok(Date.now() < deadline, 'START must be evaluated before the original deadline');
    assert.equal(start.ok, false, 'START must be rejected while the original submission deadline is live');
  } finally {
    if (restarted) await restarted.message({ type: 'PAUSE' });
    globalThis.chrome = first.chrome;
    receipt.resolve({ status: 'unknown' });
    await sending;
    await first.message({ type: 'PAUSE' });
  }
});

for (const fenceFailure of ['read', 'write']) {
  test(`sending recovery preserves the old record when paused snapshot and durable fence ${fenceFailure} fail`, { timeout: 5000 }, async t => {
    const first = await harness();
    await first.start({ prompt: 'SYNTHETIC_OLD_RUN', startImmediately: false });
    const receipt = deferred();
    first.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
    const sending = first.message({ type: 'SEND_NOW' });
    const release = deferred();
    let recovered, restarted;
    try {
      await until(() => first.sends().length === 1, 'in-flight synthetic send');
      const deadline = first.state.session.job.runDeadline;
      const oldRecord = copy(first.state.local.resumeJob);
      assert.ok(Number.isFinite(deadline) && deadline > Date.now());
      assert.equal(oldRecord.phase, 'sending');
      assert.equal(oldRecord.runDeadline, deadline);
      assert.equal(first.state.local.submissionFenceUntil, undefined);

      let failedSnapshots = 0, failedFences = 0, removals = 0;
      recovered = await harness({
        skipReady: true,
        local: copy(first.state.local),
        async beforeStorageSet(area, value) {
          if (area === 'local' && value.resumeJob?.enabled === false && value.resumeJob.submissionFenceUntil >= deadline) {
            failedSnapshots += 1;
            await release.promise;
            throw new Error('Synthetic paused local recovery write failure');
          }
          if (area === 'local' && fenceFailure === 'write' && failedSnapshots && Object.hasOwn(value, 'submissionFenceUntil')) {
            failedFences += 1;
            throw new Error('Synthetic durable fence write failure');
          }
        },
        beforeStorageGet(area, key) {
          if (area === 'local' && fenceFailure === 'read' && failedSnapshots && key === 'submissionFenceUntil') {
            failedFences += 1;
            throw new Error('Synthetic durable fence read failure');
          }
        },
      });
      recovered.beforeStorageRemove = (area, keys) => {
        if (area === 'local' && (keys === 'resumeJob' || Array.isArray(keys) && keys.includes('resumeJob'))) removals += 1;
      };
      try {
        await until(() => failedSnapshots === 1, 'paused local recovery write');
      } finally {
        release.resolve();
      }
      const recoveryResponse = await recovered.message({ type: 'GET_STATE' });
      const persisted = copy(recovered.state.local);
      assert.ok(Date.now() < deadline, 'The original submission deadline must still be live at restart');
      restarted = await harness({ local: copy(persisted) });
      const start = await restarted.message({ type: 'START', tabId: 7,
        config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: false } });
      t.diagnostic(JSON.stringify({ fenceFailure, failedSnapshots, failedFences, removals,
        recoveryOk: recoveryResponse.ok, oldRecordPreserved: JSON.stringify(persisted.resumeJob) === JSON.stringify(oldRecord),
        durableFence: persisted.submissionFenceUntil ?? null, deadlineStillLive: Date.now() < deadline,
        startOk: start.ok, restoredEnabled: restarted.state.session.job?.enabled ?? false,
        restoredFence: restarted.state.session.job?.submissionFenceUntil ?? null, newSends: restarted.sends().length }));
      assert.equal(failedSnapshots, 1);
      assert.equal(failedFences, 1);
      assert.equal(recoveryResponse.ok, false);
      assert.equal(removals, 0, 'The old recovery record must not be removed without a durable fence');
      assert.deepEqual(persisted.resumeJob, oldRecord, 'The previous sending recovery record must remain intact');
      assert.equal(persisted.submissionFenceUntil, undefined);
      assert.ok(Date.now() < deadline, 'START must be evaluated before the original deadline');
      assert.equal(start.ok, false, 'START must be rejected while the original submission deadline is live');
      assert.equal(restarted.state.session.job.enabled, false);
      assert.ok(restarted.state.session.job.submissionFenceUntil >= deadline);
      assert.equal(restarted.sends().length, 0);
    } finally {
      release.resolve();
      if (restarted) await restarted.message({ type: 'PAUSE' });
      globalThis.chrome = first.chrome;
      receipt.resolve({ status: 'unknown' });
      await sending;
      await first.message({ type: 'PAUSE' });
    }
  });
}

test('failed recovery restart fences START until the longer old local sending deadline', { timeout: 5000 }, async t => {
  const first = await harness();
  await first.start({ prompt: 'SYNTHETIC_OLD_RUN', startImmediately: false });
  const receipt = deferred();
  first.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = first.message({ type: 'SEND_NOW' });
  const release = deferred();
  const realNow = Date.now;
  let recovered, restarted;
  try {
    await until(() => first.sends().length === 1, 'in-flight synthetic send');
    const local = copy(first.state.local);
    const session = copy(first.state.session);
    const localDeadline = local.resumeJob.runDeadline;
    const sessionDeadline = realNow() + 5000;
    assert.equal(local.resumeJob.phase, 'sending');
    assert.equal(session.job.phase, 'sending');
    assert.equal(session.job.runDeadline, localDeadline);
    assert.ok(sessionDeadline < localDeadline);
    session.job.runDeadline = sessionDeadline;
    assert.equal(local.submissionFenceUntil, undefined);

    let failedSnapshots = 0, removals = 0;
    recovered = await harness({
      skipReady: true,
      session,
      local,
      async beforeStorageSet(area, value) {
        if (area === 'local' && value.resumeJob?.enabled === false) {
          failedSnapshots += 1;
          await release.promise;
          throw new Error('Synthetic paused local recovery write failure');
        }
      },
    });
    recovered.beforeStorageRemove = (area, keys) => {
      if (area === 'local' && (keys === 'resumeJob' || Array.isArray(keys) && keys.includes('resumeJob'))) removals += 1;
    };
    try {
      await until(() => failedSnapshots === 1, 'paused local recovery write');
    } finally {
      release.resolve();
    }
    const recoveryResponse = await recovered.message({ type: 'GET_STATE' });
    const persisted = copy(recovered.state.local);
    assert.equal(failedSnapshots, 1);
    assert.equal(recoveryResponse.ok, true);
    assert.ok(realNow() < sessionDeadline);
    Date.now = () => sessionDeadline + 1;
    assert.ok(Date.now() > sessionDeadline && Date.now() < localDeadline);
    restarted = await harness({ local: persisted });
    const start = await restarted.message({ type: 'START', tabId: 7,
      config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: false } });
    t.diagnostic(JSON.stringify({ failedSnapshots, removals, sessionDeadline, localDeadline,
      now: Date.now(), oldRecordPreserved: persisted.resumeJob?.phase === 'sending',
      durableFence: persisted.submissionFenceUntil ?? null, startOk: start.ok,
      newJobEnabled: restarted.state.session.job?.enabled ?? false, newSends: restarted.sends().length }));
    assert.ok(Date.now() > sessionDeadline && Date.now() < localDeadline);
    assert.equal(start.ok, false, 'START must be rejected before the longer old local sending deadline');
    assert.equal(restarted.sends().length, 0);
  } finally {
    release.resolve();
    Date.now = realNow;
    if (restarted) await restarted.message({ type: 'PAUSE' });
    globalThis.chrome = first.chrome;
    receipt.resolve({ status: 'unknown' });
    await sending;
    await first.message({ type: 'PAUSE' });
  }
});

test('successful recovery restart fences START until the longer old local sending deadline', { timeout: 5000 }, async t => {
  const first = await harness();
  await first.start({ prompt: 'SYNTHETIC_OLD_RUN', startImmediately: false });
  const receipt = deferred();
  first.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = first.message({ type: 'SEND_NOW' });
  const realNow = Date.now;
  let recovered, restarted;
  try {
    await until(() => first.sends().length === 1, 'in-flight synthetic send');
    const local = copy(first.state.local);
    const session = copy(first.state.session);
    const localDeadline = local.resumeJob.runDeadline;
    const sessionDeadline = realNow() + 5000;
    assert.equal(local.resumeJob.phase, 'sending');
    assert.equal(session.job.phase, 'sending');
    assert.equal(session.job.runDeadline, localDeadline);
    assert.ok(realNow() < sessionDeadline && sessionDeadline < localDeadline);
    assert.equal(local.submissionFenceUntil, undefined);
    session.job.runDeadline = sessionDeadline;

    let pausedWrites = 0;
    recovered = await harness({
      session,
      local,
      beforeStorageSet(area, value) {
        if (area === 'local' && value.resumeJob?.enabled === false) pausedWrites += 1;
      },
    });
    const persisted = copy(recovered.state.local);
    assert.ok(pausedWrites > 0, 'The paused recovery snapshot must be persisted successfully');
    assert.equal(recovered.state.session.job.enabled, false);
    assert.equal(persisted.resumeJob.enabled, false);
    assert.equal(persisted.resumeJob.runId, recovered.state.session.job.runId);
    assert.ok(realNow() < sessionDeadline);
    Date.now = () => sessionDeadline + 1;
    assert.ok(Date.now() > sessionDeadline && Date.now() < localDeadline);
    restarted = await harness({ local: persisted });
    const start = await restarted.message({ type: 'START', tabId: 7,
      config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: false } });
    t.diagnostic(JSON.stringify({ pausedWrites, sessionDeadline, localDeadline, now: Date.now(),
      persistedFence: persisted.resumeJob.submissionFenceUntil ?? null,
      durableFence: persisted.submissionFenceUntil ?? null, startOk: start.ok,
      newJobEnabled: restarted.state.session.job?.enabled ?? false, newSends: restarted.sends().length }));
    assert.ok(Date.now() > sessionDeadline && Date.now() < localDeadline);
    assert.equal(start.ok, false, 'START must be rejected before the longer old local sending deadline');
    assert.equal(restarted.sends().length, 0);
  } finally {
    Date.now = realNow;
    if (restarted) await restarted.message({ type: 'PAUSE' });
    globalThis.chrome = first.chrome;
    receipt.resolve({ status: 'unknown' });
    await sending;
    await first.message({ type: 'PAUSE' });
  }
});
