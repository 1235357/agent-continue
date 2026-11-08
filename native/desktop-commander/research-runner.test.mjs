import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareState } from './runtime.mjs';
import { executeResearchRun, inspectResearchRun } from './research-runner.mjs';
import { validateRunReview } from './research-handoff.mjs';

const entry = fileURLToPath(new URL('./research-runner.mjs', import.meta.url));
function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'ac-research-runner-'));
  const state = path.join(scratch, 'state');
  prepareState(state, { consent: 'full-account' });
  t.after(() => {
    assert.equal(path.dirname(scratch), parent);
    assert.match(path.basename(scratch), /^ac-research-runner-/);
    fs.rmSync(scratch, { force: true, recursive: true });
  });
  const projectId = randomUUID();
  const plan = (source, overrides = {}) => ({
    version: 1, projectId, runId: randomUUID(), parentRunId: null,
    revision: createHash('sha256').update(source).digest('hex'),
    program: process.execPath, argv: ['-e', source], cwd: scratch, maxOutputBytes: 4096, review: null, ...overrides,
  });
  const status = runId => inspectResearchRun(state, projectId, runId);
  const dir = runId => path.join(state, 'research-runs', projectId, runId);
  const cli = (...args) => {
    const child = spawnSync(process.execPath, [entry, ...args], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.error, undefined);
    return { status: child.status, output: JSON.parse(child.stdout) };
  };
  const submit = request => {
    const file = path.join(scratch, 'plan.json');
    fs.writeFileSync(file, JSON.stringify(request));
    return cli('run', '--state-dir', state, '--plan', file);
  };
  return { state, projectId, plan, status, dir, cli, submit };
}

test('separate CLI invocations run, verify actual artifacts, bind a reviewed retry and prevent duplicate starts', t => {
  const f = fixture(t);
  const first = f.plan("require('node:fs').appendFileSync('launch-count.txt','1'); console.error('failed benchmark'); process.exitCode=7;");
  assert.deepEqual(f.status(first.runId), { status: 'not-found' });
  assert.equal(fs.existsSync(path.join(f.state, 'research-runs')), false, 'status must not create state');
  const failed = f.submit(first);
  assert.equal(failed.status, 0, 'the CLI reports the execution result rather than hiding its failed exit');
  assert.equal(failed.output.report.termination.exitCode, 7);
  assert.equal(fs.readFileSync(path.join(f.dir(first.runId), 'stderr.log'), 'utf8').trim(), 'failed benchmark');
  assert.deepEqual(f.submit(first), failed);
  assert.equal(fs.readFileSync(path.join(first.cwd, 'launch-count.txt'), 'utf8'), '1');
  assert.deepEqual(f.submit({ ...first, maxOutputBytes: 2048 }), { status: 1, output: { error: 'research_run_conflict' } });
  const corrected = f.plan("console.log('corrected benchmark');", { parentRunId: first.runId });
  const review = { version: 1, projectId: f.projectId, runId: first.runId,
    reportSha256: failed.output.reportSha256, action: 'retry', nextRunId: corrected.runId };
  assert.deepEqual(f.submit({ ...corrected, review: { ...review, reportSha256: 'f'.repeat(64) } }),
    { status: 1, output: { error: 'research_review_does_not_match_parent' } });
  const retried = f.submit({ ...corrected, review });
  assert.equal(retried.status, 0);
  assert.equal(retried.output.report.termination.exitCode, 0);
  assert.equal(retried.output.report.parentRunId, first.runId);
  assert.notEqual(retried.output.report.revision, failed.output.report.revision);
  assert.deepEqual(f.cli('status', '--state-dir', f.state, '--project', f.projectId, '--run', corrected.runId), retried);
  assert.deepEqual(f.submit({ ...corrected, review }), retried);
  const duplicate = f.plan("require('node:fs').appendFileSync('launch-count.txt','2');", { parentRunId: first.runId });
  const secondReview = { ...review, nextRunId: duplicate.runId };
  assert.deepEqual(f.submit({ ...duplicate, review: secondReview }),
    { status: 1, output: { error: 'research_parent_already_has_successor' } });
  assert.equal(fs.readFileSync(path.join(first.cwd, 'launch-count.txt'), 'utf8'), '1');
  assert.deepEqual(f.status(duplicate.runId), { status: 'not-found' });
  assert.equal(validateRunReview(retried.output.report, { ...review, runId: corrected.runId,
    reportSha256: retried.output.reportSha256, action: 'request-final-acceptance', nextRunId: null }).action,
  'request-final-acceptance');
  fs.appendFileSync(path.join(f.dir(corrected.runId), 'stdout.log'), 'tampered');
  assert.throws(() => f.status(corrected.runId), /research_artifact_changed/);
});

test('a pre-upgrade successor without a claim still blocks a new dispatch', t => {
  const f = fixture(t);
  const parent = f.plan("process.exitCode=2;");
  const result = f.submit(parent).output;
  const next = f.plan("console.log('first retry');", { parentRunId: parent.runId });
  const review = { version: 1, projectId: f.projectId, runId: parent.runId, reportSha256: result.reportSha256,
    action: 'retry', nextRunId: next.runId };
  assert.equal(f.submit({ ...next, review }).status, 0);
  fs.unlinkSync(path.join(f.dir(parent.runId), 'successor.json'));
  const replacement = f.plan("console.log('must not run');", { parentRunId: parent.runId });
  assert.deepEqual(f.submit({ ...replacement, review: { ...review, nextRunId: replacement.runId } }),
    { status: 1, output: { error: 'research_parent_already_has_successor' } });
});

test('an orphaned successor claim cannot be re-used or replaced after interruption', t => {
  const f = fixture(t);
  const parent = f.plan("process.exitCode=3;");
  const result = f.submit(parent).output;
  const next = f.plan("console.log('must not run');", { parentRunId: parent.runId });
  const review = { version: 1, projectId: f.projectId, runId: parent.runId, reportSha256: result.reportSha256,
    action: 'retry', nextRunId: next.runId };
  fs.writeFileSync(path.join(f.dir(parent.runId), 'successor.json'), JSON.stringify({
    format: 'agent-continue-research-run', version: 1, parentReportSha256: result.reportSha256,
    nextRunId: next.runId, nextPlanSha256: '1'.repeat(64),
  }) + '\n', { flag: 'wx' });
  assert.deepEqual(f.submit({ ...next, review }),
    { status: 1, output: { error: 'research_successor_outcome_unconfirmed' } });
  const replacement = f.plan("console.log('must not run');", { parentRunId: parent.runId });
  assert.deepEqual(f.submit({ ...replacement, review: { ...review, nextRunId: replacement.runId } }),
    { status: 1, output: { error: 'research_successor_outcome_unconfirmed' } });
  assert.deepEqual(f.status(next.runId), { status: 'not-found' });
  assert.deepEqual(f.status(replacement.runId), { status: 'not-found' });
});

test('one project admits only one live run; repeated requests expose unknown rather than retrying', async t => {
  const f = fixture(t);
  const first = f.plan("setTimeout(() => console.log('completed'), 450);");
  const live = executeResearchRun(f.state, first);
  await assert.rejects(executeResearchRun(f.state, f.plan("console.log('must not run');")), /research_project_busy_or_unconfirmed/);
  assert.equal((await executeResearchRun(f.state, first)).status, 'outcome-unknown');
  assert.equal((await live).status, 'settled');
  assert.equal((await executeResearchRun(f.state, f.plan("console.log('next');"))).status, 'settled');
});

test('ambiguous launch retains its fence across CLI exit, and bounded output cannot pass final acceptance', async t => {
  const f = fixture(t);
  const capped = f.plan("process.stdout.write('x'.repeat(1024));", { maxOutputBytes: 19 });
  const result = await executeResearchRun(f.state, capped);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.report.artifacts.find(item => item.name === 'stdout').bytes, 19);
  assert.ok(result.report.artifacts.every(item => item.kind === 'log'));
  const uncertain = f.plan('', { program: path.join(capped.cwd, 'absent-test-program.exe') });
  assert.deepEqual(f.submit(uncertain), { status: 1, output: { error: 'research_outcome_unknown' } });
  assert.equal(f.status(uncertain.runId).status, 'outcome-unknown');
  assert.equal(f.submit(uncertain).output.status, 'outcome-unknown');
  assert.deepEqual(f.submit(f.plan("console.log('must not run');")),
    { status: 1, output: { error: 'research_project_busy_or_unconfirmed' } });
});

test('real Windows PowerShell fails, then a digest-bound retry succeeds without inheriting tunnel credentials',
  { skip: process.platform !== 'win32' }, async t => {
    const f = fixture(t);
    const name = 'CONTROL_PLANE_RESEARCH_TEST';
    const saved = process.env[name];
    process.env[name] = 'synthetic-control-value';
    try {
      const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const powershell = (script, overrides = {}) => f.plan(script, { program: shell,
        argv: ['-NoProfile', '-NonInteractive', '-Command', script], ...overrides });
      const failedPlan = powershell("[Console]::Error.WriteLine('AC_RESEARCH_BAD_PARAMETER'); exit 17");
      const failed = f.submit(failedPlan);
      assert.equal(failed.status, 0);
      assert.equal(failed.output.report.termination.exitCode, 17);
      assert.equal(fs.readFileSync(path.join(f.dir(failedPlan.runId), 'stderr.log'), 'utf8').trim(), 'AC_RESEARCH_BAD_PARAMETER');
      const corrected = powershell("if ($env:CONTROL_PLANE_RESEARCH_TEST) { exit 9 }; Write-Output 'AC_RESEARCH_OK'",
        { parentRunId: failedPlan.runId });
      const request = { ...corrected, review: { version: 1, projectId: f.projectId, runId: failedPlan.runId,
        reportSha256: failed.output.reportSha256, action: 'retry', nextRunId: corrected.runId } };
      const result = f.submit(request);
      assert.equal(result.status, 0);
      assert.equal(result.output.report.termination.exitCode, 0);
      assert.equal(fs.readFileSync(path.join(f.dir(corrected.runId), 'stdout.log'), 'utf8').trim(), 'AC_RESEARCH_OK');
      assert.deepEqual(f.submit(request), result);
    } finally {
      if (saved === undefined) delete process.env[name]; else process.env[name] = saved;
    }
  });

test('Windows research criteria survive a zero-exit failed benchmark, exact retry and artifact readback',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const criteria = [{ metric: 'accuracy', operator: 'gte', threshold: 0.9 }];
    function planFor(value, overrides = {}) {
      const body = "[Console]::WriteLine('" + JSON.stringify({ metrics: [{ name: 'accuracy', value }] }) + "')";
      return f.plan(body, { program: shell, argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', body],
        acceptanceCriteria: criteria, ...overrides });
    }
    const first = planFor(0.7);
    const baseline = f.submit(first).output;
    assert.equal(baseline.report.termination.exitCode, 0);
    assert.equal(baseline.acceptance.status, 'criteria-not-met');
    const retry = planFor(0.95, { parentRunId: first.runId });
    const proposal = { version: 1, projectId: f.projectId, runId: first.runId,
      reportSha256: baseline.reportSha256, action: 'retry', nextRunId: retry.runId };
    assert.throws(() => validateRunReview(baseline.report,
      { ...proposal, action: 'request-final-acceptance', nextRunId: null }, criteria), /review_requires_criteria/);
    const review = request => {
      const file = path.join(first.cwd, 'proposal.json');
      fs.writeFileSync(file, JSON.stringify(request));
      return f.cli('review', '--state-dir', f.state, '--proposal', file);
    };
    assert.deepEqual(review({ ...proposal, action: 'request-final-acceptance', nextRunId: null }),
      { status: 1, output: { error: 'review_requires_criteria' } });
    assert.deepEqual(f.submit({ ...retry, review: proposal,
      acceptanceCriteria: [{ ...criteria[0], threshold: 0.5 }] }),
    { status: 1, output: { error: 'research_acceptance_criteria_changed' } });
    const result = f.submit({ ...retry, review: proposal });
    assert.equal(result.status, 0);
    assert.equal(result.output.acceptance.status, 'ready-for-owner-review');
    assert.deepEqual(result.output.report.metrics, [{ name: 'accuracy', value: 0.95 }]);
    assert.deepEqual(f.submit({ ...retry, review: proposal }), result);
    const ownerProposal = { ...proposal, runId: retry.runId, reportSha256: result.output.reportSha256,
      action: 'request-final-acceptance', nextRunId: null };
    assert.deepEqual(review(ownerProposal), { status: 0, output: {
      review: ownerProposal, dispatched: false, ownerAccepted: false, acceptance: result.output.acceptance,
    } });
    const settled = path.join(f.dir(retry.runId), 'settled.json');
    const forged = JSON.parse(fs.readFileSync(settled, 'utf8'));
    forged.report.metrics[0].value = 0.97;
    forged.reportSha256 = createHash('sha256').update(JSON.stringify(forged.report)).digest('hex');
    fs.writeFileSync(settled, JSON.stringify(forged) + '\n');
    assert.throws(() => f.status(retry.runId), /research_metrics_do_not_match_artifact/);
  });

test('governed research does not accept malformed or truncated stdout as evidence', t => {
  const f = fixture(t);
  const criteria = [{ metric: 'loss', operator: 'lte', threshold: 0.1 }];
  for (const [source, maxOutputBytes] of [
    ["console.log('plain unstructured success')", 1000],
    ["console.log(JSON.stringify({metrics:[{name:'loss',value:0.01}]}))", 10],
    ["console.log(JSON.stringify({metrics:[{name:'loss',value:0.01},{name:'loss',value:0.02}]}))", 1000],
  ]) {
    const result = f.submit(f.plan(source, { maxOutputBytes, acceptanceCriteria: criteria }));
    assert.equal(result.status, 0);
    assert.equal(result.output.acceptance.status, 'result-unavailable');
    assert.deepEqual(result.output.report.metrics, []);
    assert.ok(result.output.report.artifacts.every(item => item.kind === 'log'));
  }
});
