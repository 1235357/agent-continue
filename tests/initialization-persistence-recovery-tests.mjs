import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sourceUrl = new URL('./background-v2-tests.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const boundary = source.indexOf('\nasync function scenario(');
assert.notEqual(boundary, -1, 'Existing harness boundary must be present');
const fixture = source.slice(0, boundary).replace('import.meta.url', JSON.stringify(sourceUrl.href));
const { harness, copy, deferred, delay, until } = await import(`data:text/javascript;base64,${Buffer.from(`${fixture}\nexport { harness, copy, deferred, delay, until };`).toString('base64')}`);
const alarmName = 'agent-continue-heartbeat';

for (const failureArea of ['session', 'local']) for (const restartKind of ['worker', 'browser']) {
  test(`initialization ${failureArea} persistence failure recovers in the same worker before ${restartKind} restart`, { timeout: 5000 }, async t => {
    const original = await harness();
    await original.start({ prompt: 'SYNTHETIC_RECOVERY', startImmediately: false });
    const sending = { ...copy(original.state.session.job), phase: 'sending', runKind: 'send',
      runDeadline: Date.now() + 30000, nextAt: Date.now() - 1000 };
    const gate = deferred();
    let failedWrites = 0, failedRemovals = 0;
    const worker = await harness({
      skipReady: true,
      session: { job: copy(sending) },
      local: { ...copy(original.state.local), resumeJob: copy(sending) },
      async beforeStorageSet(area, value) {
        const job = area === 'session' ? value.job : value.resumeJob;
        if (area === failureArea && job?.enabled === false && job.phase === 'idle') {
          failedWrites += 1;
          await gate.promise;
          throw new Error(`Synthetic initialization ${area} write failure`);
        }
      },
    });
    worker.beforeStorageRemove = (area, key) => {
      if (failureArea === 'local' && area === 'local' && key === 'resumeJob') {
        failedRemovals += 1;
        throw new Error('Synthetic initialization recovery removal failure');
      }
    };
    const initialRead = worker.message({ type: 'GET_STATE' });
    try {
      await until(() => failedWrites === 1, 'initialization recovery persistence failure');
    } finally {
      gate.resolve();
    }
    const failedRead = await initialRead;
    worker.beforeStorageSet = undefined;
    worker.beforeStorageRemove = undefined;
    const recoveredRead = await worker.message({ type: 'GET_STATE' });
    const paused = await worker.message({ type: 'PAUSE' });
    const readAfterPause = await worker.message({ type: 'GET_STATE' });
    const persisted = { session: copy(worker.state.session), local: copy(worker.state.local) };
    const restarted = await harness({ skipReady: true, local: persisted.local,
      ...(restartKind === 'worker' ? { session: persisted.session } : {}) });
    const restartRead = await restarted.message({ type: 'GET_STATE' });
    if (restartKind === 'browser') restarted.chrome.runtime.onStartup.emit();
    if (restarted.state.session.job?.enabled) restarted.state.session.job.nextAt = Date.now() - 1000;
    restarted.chrome.alarms.onAlarm.emit({ name: alarmName });
    await delay(100);
    t.diagnostic(JSON.stringify({ failureArea, restartKind, failedWrites, failedRemovals,
      initialReadOk: failedRead.ok, recoveredReadOk: recoveredRead.ok, pauseOk: paused.ok,
      readAfterPauseOk: readAfterPause.ok, sessionEnabledBeforeRestart: persisted.session.job?.enabled ?? null,
      localEnabledBeforeRestart: persisted.local.resumeJob?.enabled ?? null, restartReadOk: restartRead.ok,
      restartEnabled: restarted.state.session.job?.enabled ?? null, sendsBeforeRestart: worker.sends().length,
      sendsAfterRestart: restarted.sends().length, alarmAfterRestart: restarted.state.alarms.has(alarmName) }));
    assert.equal(failedWrites, 1, 'The intended initialization write must fail');
    assert.equal(failedRemovals, failureArea === 'local' ? 1 : 0);
    assert.equal(failedRead.ok, false, 'Initialization must expose the persistence failure');
    assert.equal(worker.sends().length, 0, 'The failing worker must not send');
    assert.equal(restarted.sends().length, 0, 'Restart must not automatically send the unconfirmed submission');
    assert.equal(restartRead.ok, true);
    assert.equal(restarted.state.session.job?.enabled, false);
    assert.equal(restarted.state.alarms.has(alarmName), false);
    assert.equal(recoveredRead.ok, true, 'GET_STATE must recover after storage is healthy in the same worker');
    assert.equal(paused.ok, true, 'Pause must recover after storage is healthy in the same worker');
    assert.equal(readAfterPause.ok, true);
    assert.equal(readAfterPause.job?.enabled, false);
    assert.equal(persisted.session.job?.enabled, false);
    assert.equal(persisted.local.resumeJob?.enabled, false);
  });
}

for (const failureArea of ['session', 'local']) for (const eventOrder of ['alarm-first', 'pause-first']) for (const restartKind of ['worker', 'browser']) {
  test(`initialization ${failureArea} failure: ${eventOrder} recovery preserves Pause through ${restartKind} restart`, { timeout: 5000 }, async t => {
    const original = await harness();
    await original.start({ prompt: 'SYNTHETIC_RECOVERY_RACE', startImmediately: false });
    const sending = { ...copy(original.state.session.job), phase: 'sending', runKind: 'send',
      runDeadline: Date.now() + 30000, nextAt: Date.now() - 1000 };
    const failureGate = deferred();
    let failedWrites = 0, failedRemovals = 0;
    const worker = await harness({
      skipReady: true,
      session: { job: copy(sending) },
      local: { ...copy(original.state.local), resumeJob: copy(sending) },
      alarms: [[alarmName, { name: alarmName, periodInMinutes: 1 }]],
      async beforeStorageSet(area, value) {
        const job = area === 'session' ? value.job : value.resumeJob;
        if (area === failureArea && job?.enabled === false && job.phase === 'idle') {
          failedWrites += 1;
          await failureGate.promise;
          throw new Error(`Synthetic initialization ${area} race failure`);
        }
      },
    });
    worker.beforeStorageRemove = (area, key) => {
      if (failureArea === 'local' && area === 'local' && key === 'resumeJob') {
        failedRemovals += 1;
        throw new Error('Synthetic initialization race removal failure');
      }
    };
    const initialRead = worker.message({ type: 'GET_STATE' });
    try {
      await until(() => failedWrites === 1, 'initialization race persistence failure');
    } finally {
      failureGate.resolve();
    }
    const failedRead = await initialRead;
    worker.beforeStorageSet = undefined;
    worker.beforeStorageRemove = undefined;
    let pauseRequest;
    if (eventOrder === 'alarm-first') {
      worker.chrome.alarms.onAlarm.emit({ name: alarmName });
      pauseRequest = worker.message({ type: 'PAUSE' });
    } else {
      pauseRequest = worker.message({ type: 'PAUSE' });
      worker.chrome.alarms.onAlarm.emit({ name: alarmName });
    }
    const paused = await Promise.race([pauseRequest, delay(500).then(() => null)]);
    const recoveredRead = await Promise.race([worker.message({ type: 'GET_STATE' }), delay(500).then(() => null)]);
    await delay(100);
    const persisted = { session: copy(worker.state.session), local: copy(worker.state.local) };
    const restarted = await harness({ skipReady: true, local: persisted.local,
      alarms: [[alarmName, { name: alarmName, periodInMinutes: 1 }]],
      ...(restartKind === 'worker' ? { session: persisted.session } : {}) });
    const restartRead = await Promise.race([restarted.message({ type: 'GET_STATE' }), delay(500).then(() => null)]);
    if (restartKind === 'browser') restarted.chrome.runtime.onStartup.emit();
    restarted.chrome.alarms.onAlarm.emit({ name: alarmName });
    await delay(100);
    t.diagnostic(JSON.stringify({ failureArea, eventOrder, restartKind, failedWrites, failedRemovals,
      initialReadOk: failedRead.ok, pauseOk: paused?.ok ?? null, recoveredReadOk: recoveredRead?.ok ?? null,
      recoveredEnabled: recoveredRead?.job?.enabled ?? null, sessionEnabled: persisted.session.job?.enabled ?? null,
      localEnabled: persisted.local.resumeJob?.enabled ?? null, restartReadOk: restartRead?.ok ?? null,
      restartEnabled: restarted.state.session.job?.enabled ?? null, sendsBeforeRestart: worker.sends().length,
      sendsAfterRestart: restarted.sends().length, alarmBeforeRestart: worker.state.alarms.has(alarmName),
      alarmAfterRestart: restarted.state.alarms.has(alarmName) }));
    assert.equal(failedWrites, 1, 'The intended initialization write must fail before the race');
    assert.equal(failedRemovals, failureArea === 'local' ? 1 : 0);
    assert.equal(failedRead.ok, false, 'Initialization must expose the injected storage failure');
    assert.equal(worker.sends().length, 0, 'Neither alarm ordering may send after Pause is requested');
    assert.equal(restarted.sends().length, 0, 'Restart and a stale alarm must not send');
    assert.equal(paused?.ok, true, 'Pause must succeed when storage recovers, even when an alarm races it');
    assert.equal(recoveredRead?.ok, true, 'The same worker must recover after storage becomes healthy');
    assert.equal(recoveredRead.job?.enabled, false, 'Pause must win over the alarm');
    assert.equal(persisted.session.job?.enabled, false);
    assert.equal(persisted.local.resumeJob?.enabled, false);
    assert.equal(worker.state.alarms.has(alarmName), false);
    assert.equal(restartRead?.ok, true);
    assert.equal(restarted.state.session.job?.enabled, false);
    assert.equal(restarted.state.alarms.has(alarmName), false);
  });
}

for (const failureArea of ['session', 'local']) for (const eventOrder of [
  ['GET_STATE', 'PAUSE', 'alarm'], ['GET_STATE', 'alarm', 'PAUSE'],
  ['PAUSE', 'GET_STATE', 'alarm'], ['PAUSE', 'alarm', 'GET_STATE'],
  ['alarm', 'GET_STATE', 'PAUSE'], ['alarm', 'PAUSE', 'GET_STATE'],
]) {
  test(`initialization ${failureArea} failure shares recovery for ${eventOrder.join('/')} and prioritizes Pause`, { timeout: 5000 }, async t => {
    const original = await harness();
    await original.start({ prompt: 'SYNTHETIC_SHARED_RECOVERY', startImmediately: false });
    const due = { ...copy(original.state.session.job), nextAt: Date.now() - 1000 };
    let failedWrites = 0;
    const worker = await harness({
      skipReady: true,
      session: { job: copy(due) },
      local: { ...copy(original.state.local), resumeJob: copy(due) },
      alarms: [[alarmName, { name: alarmName, periodInMinutes: 1 }]],
      async beforeStorageSet(area, value) {
        const job = area === 'session' ? value.job : value.resumeJob;
        if (area === failureArea && job?.enabled && job.phase === 'idle') {
          failedWrites += 1;
          throw new Error(`Synthetic initialization ${area} shared recovery failure`);
        }
      },
    });
    const failedRead = await worker.message({ type: 'GET_STATE' });
    assert.equal(failedWrites, 1);
    assert.equal(failedRead.ok, false);
    worker.beforeStorageSet = undefined;
    const gate = deferred();
    let recoveryAttempts = 0;
    worker.beforeStorageGet = async (area, key) => {
      if (area === 'local' && key === 'draftClearPending') {
        recoveryAttempts += 1;
        await gate.promise;
      }
    };
    let readRequest, pauseRequest, readSettled = false, pauseSettled = false;
    try {
      for (const event of eventOrder) {
        if (event === 'alarm') worker.chrome.alarms.onAlarm.emit({ name: alarmName });
        else if (event === 'GET_STATE') readRequest = worker.message({ type: event }).then(value => { readSettled = true; return value; });
        else pauseRequest = worker.message({ type: event }).then(value => { pauseSettled = true; return value; });
      }
      await until(() => recoveryAttempts > 0, 'shared recovery to enter storage');
      await delay(30);
      assert.equal(recoveryAttempts, 1, 'All concurrent events must join one in-flight initialization');
      assert.equal(readSettled, false);
      assert.equal(pauseSettled, false);
      assert.equal(worker.state.session.job.enabled, true, 'The due job must still be enabled while recovery is held');
      assert.ok(worker.state.session.job.nextAt < Date.now(), 'The alarm must have a due job to contend with');
      assert.equal(worker.state.injections.length, 0);
    } finally {
      gate.resolve();
    }
    const [read, paused] = await Promise.all([readRequest, pauseRequest]);
    await delay(100);
    const finalRead = await worker.message({ type: 'GET_STATE' });
    t.diagnostic(JSON.stringify({ failureArea, eventOrder, recoveryAttempts, readOk: read.ok,
      pauseOk: paused.ok, finalEnabled: finalRead.job?.enabled, sends: worker.sends().length,
      injections: worker.state.injections.length, alarm: worker.state.alarms.has(alarmName) }));
    assert.equal(recoveryAttempts, 1, 'No additional initialization should occur after recovery');
    assert.equal(read.ok, true);
    assert.equal(paused.ok, true);
    assert.equal(finalRead.ok, true);
    assert.equal(finalRead.job?.enabled, false, 'Pause must win over a due alarm');
    assert.equal(worker.state.session.job?.enabled, false);
    assert.equal(worker.state.local.resumeJob?.enabled, false);
    assert.equal(worker.state.alarms.has(alarmName), false);
    assert.equal(worker.state.injections.length, 0, 'The alarm must not invoke the page after Pause is requested');
  });
}

for (const failureArea of ['session', 'local']) {
  test(`initialization ${failureArea} failure: failed Pause prevents a due alarm from sending after recovery`, { timeout: 5000 }, async t => {
    const original = await harness();
    await original.start({ prompt: 'SYNTHETIC_FAILED_PAUSE', startImmediately: false });
    const due = { ...copy(original.state.session.job), nextAt: Date.now() - 1000 };
    let failedWrites = 0;
    const worker = await harness({
      skipReady: true,
      session: { job: copy(due) },
      local: { ...copy(original.state.local), resumeJob: copy(due) },
      alarms: [[alarmName, { name: alarmName, periodInMinutes: 1 }]],
      async beforeStorageSet(area, value) {
        const job = area === 'session' ? value.job : value.resumeJob;
        if (area === failureArea && job?.enabled && job.phase === 'idle') {
          failedWrites += 1;
          throw new Error(`Synthetic initialization ${area} failed Pause persistence failure`);
        }
      },
    });
    const initialRead = await worker.message({ type: 'GET_STATE' });
    const paused = await worker.message({ type: 'PAUSE' });
    assert.equal(initialRead.ok, false, 'Cold initialization must encounter the injected storage failure');
    assert.equal(paused.ok, false, 'Pause must return failure while recovery storage is still failing');
    assert.ok(failedWrites >= 2, 'The failure must persist through the Pause recovery attempt');
    assert.equal(worker.sends().length, 0, 'The failing worker must not send before storage recovers');
    worker.beforeStorageSet = undefined;
    const recovered = await worker.message({ type: 'GET_STATE' });
    assert.equal(recovered.ok, true, 'Initialization must recover when storage is healthy');
    worker.chrome.alarms.onAlarm.emit({ name: alarmName });
    await delay(200);
    const finalRead = await worker.message({ type: 'GET_STATE' });
    t.diagnostic(JSON.stringify({ failureArea, failedWrites, pauseOk: paused.ok, recoveredOk: recovered.ok,
      recoveredEnabled: recovered.job?.enabled ?? null, finalEnabled: finalRead.job?.enabled ?? null,
      sends: worker.sends().length, injections: worker.state.injections.length }));
    assert.equal(worker.sends().length, 0, 'A failed Pause must not allow a later alarm to send automatically');
    assert.equal(worker.state.injections.length, 0, 'A later alarm must not invoke the page after a failed Pause');
  });
}

for (const failureArea of ['session', 'local']) {
  test(`initialization ${failureArea} failure control: a due alarm sends after recovery without Pause`, { timeout: 5000 }, async () => {
    const original = await harness();
    await original.start({ prompt: 'SYNTHETIC_SHARED_RECOVERY_CONTROL', startImmediately: false });
    const due = { ...copy(original.state.session.job), nextAt: Date.now() - 1000 };
    let failedWrites = 0;
    const worker = await harness({
      skipReady: true,
      session: { job: copy(due) },
      local: { ...copy(original.state.local), resumeJob: copy(due) },
      async beforeStorageSet(area, value) {
        const job = area === 'session' ? value.job : value.resumeJob;
        if (area === failureArea && job?.enabled && job.phase === 'idle') {
          failedWrites += 1;
          throw new Error(`Synthetic initialization ${area} control failure`);
        }
      },
    });
    assert.equal((await worker.message({ type: 'GET_STATE' })).ok, false);
    assert.equal(failedWrites, 1);
    worker.beforeStorageSet = undefined;
    worker.chrome.alarms.onAlarm.emit({ name: alarmName });
    await until(() => worker.sends().length === 1, 'due alarm to send after recovery');
    assert.equal((await worker.message({ type: 'PAUSE' })).ok, true);
  });
}

test('alarm fixture sends a due enabled synthetic job', async () => {
  const worker = await harness();
  await worker.start({ prompt: 'SYNTHETIC_CONTROL', startImmediately: false });
  await worker.tick();
  assert.equal(worker.sends().length, 1);
  await worker.message({ type: 'PAUSE' });
});
