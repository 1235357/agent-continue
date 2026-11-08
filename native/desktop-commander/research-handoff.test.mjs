import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { normalizeRunReport, runReportDigest, validateRunReview } from './research-handoff.mjs';

const makeReport = (state, exitCode) => ({
  version: 1, projectId: randomUUID(), runId: randomUUID(), parentRunId: null, revision: 'a'.repeat(40),
  termination: { state, exitCode }, metrics: [{ name: 'loss', value: 0.4 }, { name: 'accuracy', value: 0.8 }],
  artifacts: [{ name: 'stderr', kind: 'log', sha256: 'b'.repeat(64), bytes: 120 }],
});
const review = (report, action, nextRunId = null) => ({ version: 1, projectId: report.projectId,
  runId: report.runId, reportSha256: runReportDigest(report), action, nextRunId });

test('canonical reports bind run, revision and evidence without depending on list order', () => {
  const report = makeReport('exited', 7);
  const original = runReportDigest(report);
  assert.equal(runReportDigest({ ...report, metrics: report.metrics.toReversed() }), original);
  assert.notEqual(runReportDigest({ ...report, revision: 'b'.repeat(40) }), original);
  assert.notEqual(runReportDigest({ ...report, artifacts: [{ ...report.artifacts[0], bytes: 121 }] }), original);
  assert.throws(() => normalizeRunReport({ ...report, command: 'untrusted' }), /invalid_run_report/);
  assert.throws(() => normalizeRunReport({ ...report, artifacts: [{ ...report.artifacts[0], name: '../secret' }] }), /invalid_artifacts/);
  assert.throws(() => normalizeRunReport({ ...report, metrics: [report.metrics[0], report.metrics[0]] }), /invalid_metrics/);
});

test('unsettled work can only reconcile and cannot be mistaken for exit zero', () => {
  for (const state of ['unknown', 'running']) {
    const report = makeReport(state, null);
    assert.deepEqual(validateRunReview(report, review(report, 'reconcile')).action, 'reconcile');
    for (const action of ['retry', 'advance', 'request-final-acceptance']) {
      assert.throws(() => validateRunReview(report, review(report, action, randomUUID())));
    }
    assert.throws(() => normalizeRunReport({ ...report, termination: { state, exitCode: 0 } }), /invalid_termination/);
  }
});

test('a failed revision can propose a fresh run; only settled output can request final review', () => {
  const failed = makeReport('exited', 17);
  const nextRunId = randomUUID();
  const retry = review(failed, 'retry', nextRunId);
  assert.equal(validateRunReview(failed, retry).nextRunId, nextRunId);
  assert.throws(() => validateRunReview(failed, review(failed, 'retry', failed.runId)), /invalid_next_run/);
  assert.throws(() => validateRunReview({ ...failed, revision: 'b'.repeat(40) }, retry), /review_does_not_match_run/);
  const succeeded = { ...failed, runId: nextRunId, parentRunId: failed.runId, revision: 'b'.repeat(40),
    termination: { state: 'exited', exitCode: 0 } };
  assert.throws(() => validateRunReview(succeeded, review(succeeded, 'request-final-acceptance')), /success_and_output/);
  succeeded.artifacts = [{ name: 'metrics', kind: 'output', sha256: 'c'.repeat(64), bytes: 12 }];
  assert.equal(validateRunReview(succeeded, review(succeeded, 'request-final-acceptance')).action, 'request-final-acceptance');
  assert.throws(() => validateRunReview(succeeded, review(succeeded, 'advance', succeeded.parentRunId)), /invalid_next_run/);
});

test('real child failure evidence can hand off a corrected child result for final review', () => {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const projectId = randomUUID();
  const run = (source, runId, parentRunId) => {
    const child = spawnSync(process.execPath, ['-e', source], { windowsHide: true,
      encoding: 'utf8', timeout: 4000, maxBuffer: 16384 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    const output = child.status === 0 ? child.stdout : child.stderr;
    return normalizeRunReport({ version: 1, projectId, runId, parentRunId, revision: hash(source),
      termination: { state: 'exited', exitCode: child.status },
      metrics: child.status === 0 ? [{ name: 'score', value: JSON.parse(output).score }] : [],
      artifacts: [{ name: child.status === 0 ? 'metrics' : 'stderr', kind: child.status === 0 ? 'output' : 'log',
        sha256: hash(output), bytes: Buffer.byteLength(output) }] });
  };
  const first = run("console.error('missing metric'); process.exitCode = 7;", randomUUID(), null);
  assert.equal(first.termination.exitCode, 7);
  const proposal = validateRunReview(first, review(first, 'retry', randomUUID()));
  const next = run('console.log(JSON.stringify({ score: 0.875 }));', proposal.nextRunId, first.runId);
  assert.notEqual(next.revision, first.revision);
  assert.notEqual(next.artifacts[0].sha256, first.artifacts[0].sha256);
  assert.equal(next.metrics[0].value, 0.875);
  assert.equal(validateRunReview(next, review(next, 'request-final-acceptance')).nextRunId, null);
});
