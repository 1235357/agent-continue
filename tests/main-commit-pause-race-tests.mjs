import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function loadFixture(file, boundary, exports, substitutions = []) {
  const url = new URL(file, import.meta.url);
  let source = await readFile(url, 'utf8');
  const end = source.indexOf(boundary);
  assert.notEqual(end, -1);
  source = source.slice(0, end).replace('import.meta.url', JSON.stringify(url.href));
  for (const [from, to] of substitutions) source = source.replace(from, to);
  return import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { ${exports} };`).toString('base64')}`);
}

const { harness, deferred, until, copy } = await loadFixture('./background-v2-tests.mjs', '\nasync function scenario(', 'harness, deferred, until, copy');
const { fixture } = await loadFixture('./editor-commit-tests.mjs', '\nfunction noDispatch(', 'fixture', [
  ["'../editor-commit.js'", JSON.stringify(new URL('../editor-commit.js', import.meta.url).href)],
  ["'../adapter.js'", JSON.stringify(new URL('../adapter.js', import.meta.url).href)],
]);

for (const boundaryMode of ['synthetically-accept-after-revocation', 'reject-after-revocation']) {
  test(`in-flight MAIN commit after zero-dispatch Pause ACK: ${boundaryMode}`, { timeout: 5000 }, async t => {
    const h = await harness();
    const page = fixture();
    const heldCommit = deferred();
    const order = [];
    let revoked = false;
    let commitResponse;
    let mainOutcome;
    let observedArgs;
    let cancelAck;
    let sendResponse;
    const execute = h.chrome.scripting.executeScript;
    const sendMessage = h.chrome.tabs.sendMessage;
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    h.chrome.tabs.sendMessage = async (id, message) => {
      if (message.type === 'GRANT_RUN') {
        order.push('grant');
        return { granted: true, runId: message.runId, resultToken: message.resultToken, runDeadline: message.runDeadline };
      }
      if (message.type === 'CANCEL_RUN') {
        revoked = true;
        order.push('cancel-ack-zero');
        cancelAck = { revoked: true, runId: message.runId, resultToken: message.resultToken,
          diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } };
        return cancelAck;
      }
      return sendMessage(id, message);
    };
    h.chrome.scripting.executeScript = async request => {
      if (request.world !== 'MAIN') return execute(request);
      const args = request.args[0];
      page.state.setTime(Date.now());
      if (args.phase === 'prepare') {
        page.state.document.addEventListener(`agent-continue-receipt-${args.receiptBoundaryToken}`, event => {
          order.push(revoked ? 'boundary-after-cancel' : 'boundary-before-cancel');
          if (!revoked || boundaryMode === 'synthetically-accept-after-revocation') event.preventDefault();
        });
      }
      if (args.phase === 'commit') {
        observedArgs = args;
        order.push('main-commit-issued');
        await heldCommit.promise;
        page.state.setTime(Date.now());
      }
      const result = page.run({ ...args, expectedUrl: page.args.expectedUrl });
      if (args.phase === 'commit') {
        mainOutcome = result;
        order.push(result.dispatched ? 'main-dispatched' : `main-${result.code}`);
      }
      return [{ frameId: 0, result }];
    };
    h.pageResult = async args => {
      if (args.mode !== 'send') return { status: 'ready' };
      commitResponse = await h.message({ type: 'COMMIT_RUN', runId: args.runId,
        receiptBoundaryToken: '00000000-0000-0000-0000-000000000001' }, h.sender());
      return { status: 'unknown', diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } };
    };
    const sending = h.message({ type: 'SEND_NOW' });
    let paused, afterPause, resume, afterResume, deadline;
    try {
      await until(() => order.includes('main-commit-issued'), 'issued MAIN commit');
      assert.equal(page.state.metrics.clicks, 0);
      assert.ok(observedArgs.deadline > Date.now());
      deadline = h.state.session.job.runDeadline;
      assert.equal(observedArgs.deadline, deadline);
      paused = await h.message({ type: 'PAUSE' });
      afterPause = { session: copy(h.state.session.job), local: copy(h.state.local.resumeJob) };
      order.push('pause-returned');
      assert.equal(paused.ok, true);
      assert.equal(afterPause.session.enabled, false);
      assert.equal(afterPause.local.enabled, false);
      assert.equal(page.state.metrics.clicks, 0);
      resume = await h.message({ type: 'RESUME' });
      afterResume = { session: copy(h.state.session.job), local: copy(h.state.local.resumeJob),
        alarms: h.state.alarms.size, clicks: page.state.metrics.clicks };
    } finally {
      heldCommit.resolve();
      sendResponse = await sending;
    }
    await until(() => mainOutcome && commitResponse, 'MAIN completion');
    const afterCompletion = { session: copy(h.state.session.job), local: copy(h.state.local.resumeJob) };
    const restarted = await harness({ local: copy(h.state.local) });
    const afterRestart = copy(restarted.state.session.job);
    const restartResume = await restarted.message({ type: 'RESUME' });
    const restartAfterResume = copy(restarted.state.session.job);
    await restarted.message({ type: 'PAUSE' });
    globalThis.chrome = h.chrome;
    const accepted = boundaryMode === 'synthetically-accept-after-revocation';
    const evidence = {
      boundaryMode, order, ackDispatchAttempts: cancelAck.diagnosticProgress.counters.dispatchAttempts,
      deadlineStillLive: observedArgs.deadline > Date.now(),
      pause: { enabled: afterPause.session.enabled, fence: afterPause.session.submissionFenceUntil ?? null,
        localFence: afterPause.local.submissionFenceUntil ?? null, lastResult: afterPause.session.lastResult,
        unknownCount: afterPause.session.unknownCount, sentCount: afterPause.session.sentCount },
      resume: { ok: resume.ok, enabled: afterResume.session.enabled, alarms: afterResume.alarms },
      restart: { lastResult: afterRestart.lastResult, unknownCount: afterRestart.unknownCount,
        fence: afterRestart.submissionFenceUntil ?? null, resumeOk: restartResume.ok },
      main: { dispatched: mainOutcome.dispatched, code: mainOutcome.code, clicks: page.state.metrics.clicks },
      workerReply: commitResponse, sendNowOk: sendResponse.ok,
    };
    t.diagnostic(JSON.stringify(evidence));
    assert.deepEqual(order.slice(0, 5), ['grant', 'main-commit-issued', 'cancel-ack-zero', 'pause-returned', 'boundary-after-cancel']);
    assert.equal(evidence.deadlineStillLive, true);
    assert.equal(cancelAck.diagnosticProgress.counters.dispatchAttempts, 0);
    assert.equal(mainOutcome.dispatched, accepted);
    assert.equal(page.state.metrics.clicks, accepted ? 1 : 0);
    assert.deepEqual(page.state.metrics.sent, accepted ? ['SYNTHETIC_FIRST'] : []);
    assert.equal(mainOutcome.code, accepted ? 'dispatched' : 'receipt-unavailable');
    await t.test('unknown is persisted through Pause and late MAIN completion', () => {
      for (const state of [afterPause.session, afterPause.local, afterCompletion.session, afterCompletion.local, afterRestart]) {
        assert.equal(state.enabled, false);
        assert.equal(state.lastResult, 'unknown');
        assert.equal(state.unknownCount, 1);
        assert.equal(state.needsAttention, true);
        assert.equal(state.sentCount, 0);
        assert.equal(state.queueIndex, 0);
      }
    });
    await t.test('original deadline fence survives Pause and restart', () => {
      for (const state of [afterPause.session, afterPause.local, afterCompletion.session, afterCompletion.local, afterRestart]) {
        assert.ok(state.submissionFenceUntil >= deadline, 'The old MAIN deadline must remain fenced');
      }
    });
    await t.test('Resume is rejected while the original deadline is live', () => {
      assert.ok(deadline > Date.now());
      assert.equal(resume.ok, false);
      assert.equal(afterResume.session.enabled, false);
      assert.equal(afterResume.local.enabled, false);
      assert.equal(afterResume.alarms, 0);
      assert.equal(afterResume.clicks, 0);
      assert.equal(restartResume.ok, false);
      assert.equal(restartAfterResume.enabled, false);
      assert.equal(restarted.sends().length, 0);
    });
  });
}
