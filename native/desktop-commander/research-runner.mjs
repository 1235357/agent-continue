import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessRunCriteria, normalizeAcceptanceCriteria, normalizeRunReport, runReportDigest, validateRunReview } from './research-handoff.mjs';
import { readState } from './runtime.mjs';

const format = 'agent-continue-research-run';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const maximumCapture = 1024 * 1024;
const maximumRecord = 64 * 1024;
const streams = ['stdout', 'stderr'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = record => JSON.stringify(record) + '\n';
const fail = code => { throw new Error(code); };
const missing = error => error.code === 'ENOENT';
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (missing(error)) return false; throw error; } };
const same = (a, b) => a.ino === b.ino && a.dev === b.dev;
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const validId = value => typeof value === 'string' && value.length === 36 && uuid.test(value);

function ensureDirectory(dir, create) {
  if (create) {
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const info = fs.lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('invalid_research_directory');
}

function readBounded(file, limit = maximumRecord) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.ino === 0n || before.size > BigInt(limit)) fail('invalid_research_file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!same(before, opened) || opened.size !== before.size) fail('research_file_changed');
    const buf = Buffer.alloc(Number(opened.size) + 1);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const after = fs.fstatSync(fd, { bigint: true });
    if (bytes !== Number(before.size) || after.mtimeNs !== before.mtimeNs ||
        !same(after, fs.lstatSync(file, { bigint: true }))) fail('research_file_changed');
    return buf.subarray(0, bytes);
  } finally { fs.closeSync(fd); }
}

function writeNew(file, content) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function projectDirectory(stateRoot, projectId, create) {
  if (!validId(projectId)) fail('invalid_research_project');
  const base = path.join(readState(stateRoot).root, 'research-runs');
  const project = path.join(base, projectId);
  if (!create && !exists(base)) return null;
  ensureDirectory(base, create);
  if (!create && !exists(project)) return null;
  ensureDirectory(project, create);
  return project;
}

function text(value, max) {
  return typeof value === 'string' && value.length <= max && !value.includes('\0');
}

function localPath(value) {
  return text(value, 2048) && path.isAbsolute(value) && !/^[\\/]{2}/.test(value) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value));
}

function runPlan(value) {
  const fields = ['version', 'projectId', 'runId', 'parentRunId', 'revision', 'program', 'argv', 'cwd', 'maxOutputBytes', 'review'];
  const governed = value != null && Object.hasOwn(value, 'acceptanceCriteria');
  if (!exact(value, governed ? [...fields, 'acceptanceCriteria'] : fields) ||
      !localPath(value.program) || !localPath(value.cwd) || !Array.isArray(value.argv) || value.argv.length > 64 ||
      !Array.from(value.argv).every(arg => text(arg, 4096)) || !Number.isSafeInteger(value.maxOutputBytes) ||
      value.maxOutputBytes < 1 || value.maxOutputBytes > maximumCapture) fail('invalid_research_plan');
  const { version, projectId, runId, parentRunId, revision } = value;
  const report = normalizeRunReport({ version, projectId, runId, parentRunId, revision,
    termination: { state: 'unknown', exitCode: null }, metrics: [], artifacts: [] });
  const reviewKeys = ['version', 'projectId', 'runId', 'reportSha256', 'action', 'nextRunId'];
  const proposed = value.review;
  if (parentRunId === null ? proposed !== null : !exact(proposed, reviewKeys) ||
      proposed.version !== 1 || proposed.projectId !== projectId || proposed.runId !== parentRunId ||
      proposed.nextRunId !== runId || !['retry', 'advance'].includes(proposed.action) ||
      typeof proposed.reportSha256 !== 'string' || !digest.test(proposed.reportSha256)) fail('invalid_research_review');
  return { report, program: path.resolve(value.program), argv: [...value.argv], cwd: path.resolve(value.cwd),
    maxOutputBytes: value.maxOutputBytes, review: proposed === null ? null :
      Object.fromEntries(reviewKeys.map(name => [name, proposed[name]])),
    ...(governed ? { acceptanceCriteria: normalizeAcceptanceCriteria(value.acceptanceCriteria) } : {}) };
}

function readRecord(file) {
  const bytes = readBounded(file).toString('utf8');
  const parsed = JSON.parse(bytes);
  if (encode(parsed) !== bytes) fail('invalid_research_record');
  return parsed;
}

function readAdmission(dir, projectId, runId) {
  ensureDirectory(dir, false);
  const reservation = path.join(dir, 'admitted.json');
  if (!exists(reservation)) return null;
  const admitted = readRecord(reservation);
  const governed = admitted?.version === 2;
  const fields = ['format', 'version', 'planSha256', 'report'];
  if (!exact(admitted, governed ? [...fields, 'acceptanceCriteria'] : fields) || admitted.format !== format ||
      ![1, 2].includes(admitted.version) || typeof admitted.planSha256 !== 'string' || !digest.test(admitted.planSha256)) fail('invalid_research_record');
  const baseline = normalizeRunReport(admitted.report);
  if (baseline.runId !== runId || baseline.projectId !== projectId || baseline.termination.state !== 'unknown' ||
      baseline.metrics.length || baseline.artifacts.length) fail('invalid_research_record');
  return { planSha256: admitted.planSha256, baseline,
    acceptanceCriteria: governed ? normalizeAcceptanceCriteria(admitted.acceptanceCriteria) : undefined };
}

function metricsFromStdout(bytes, truncated, baseline) {
  if (truncated || !bytes.length) return null;
  try {
    const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!exact(document, ['metrics'])) return null;
    const metrics = normalizeRunReport({ ...baseline, metrics: document.metrics }).metrics;
    return metrics.length ? metrics : null;
  } catch { return null; }
}

function inspectRun(project, projectId, runId) {
  const dir = path.join(project, runId);
  if (!exists(dir)) return { status: 'not-found' };
  const admission = readAdmission(dir, projectId, runId);
  if (!admission) return { status: 'outcome-unknown' };
  const { planSha256, baseline, acceptanceCriteria } = admission;
  const settled = path.join(dir, 'settled.json');
  if (!exists(settled)) return { status: 'outcome-unknown', planSha256, report: baseline };
  const record = readRecord(settled);
  if (!exact(record, ['report', 'reportSha256', 'outputTruncated']) ||
      typeof record.outputTruncated !== 'boolean') fail('invalid_research_record');
  const report = normalizeRunReport(record.report);
  if (['version', 'projectId', 'runId', 'parentRunId', 'revision'].some(key => report[key] !== baseline[key]) ||
      report.termination.state !== 'exited' || runReportDigest(report) !== record.reportSha256 ||
      report.artifacts.length !== 2) fail('invalid_research_record');
  for (const name of streams) {
    const artifact = report.artifacts.find(item => item.name === name);
    const data = readBounded(path.join(dir, name + '.log'), maximumCapture);
    if (artifact?.bytes !== data.length || artifact?.sha256 !== hash(data)) fail('research_artifact_changed');
    if (name === 'stdout' && acceptanceCriteria) {
      const metrics = metricsFromStdout(data, record.outputTruncated, baseline);
      if (encode(metrics ?? []) !== encode(report.metrics) ||
          artifact.kind !== (metrics ? 'output' : 'log')) fail('research_metrics_do_not_match_artifact');
    }
  }
  return { status: 'settled', planSha256, ...record, report,
    ...(acceptanceCriteria ? { acceptanceCriteria, acceptance: assessRunCriteria(report, acceptanceCriteria) } : {}) };
}

function prepareSuccessorClaim(project, parent) {
  const { projectId, runId } = parent.report;
  const file = path.join(project, runId, 'successor.json');
  if (exists(file)) {
    const record = readRecord(file);
    if (!exact(record, ['format', 'version', 'parentReportSha256', 'nextRunId', 'nextPlanSha256']) ||
        record.format !== format || record.version !== 1 || record.parentReportSha256 !== parent.reportSha256 ||
        !validId(record.nextRunId) || record.nextRunId === runId || typeof record.nextPlanSha256 !== 'string' ||
        !digest.test(record.nextPlanSha256)) fail('invalid_research_record');
    const successor = inspectRun(project, projectId, record.nextRunId);
    if (successor.status !== 'settled' || successor.planSha256 !== record.nextPlanSha256 ||
        successor.report.parentRunId !== runId) fail('research_successor_outcome_unconfirmed');
    fail('research_parent_already_has_successor');
  }

  // Older ledgers had no claim file. Read their admissions without loading logs.
  const entries = fs.opendirSync(project);
  try {
    for (let entry; (entry = entries.readSync()) !== null;) {
      if (!validId(entry.name) || entry.name === runId) continue;
      const admission = readAdmission(path.join(project, entry.name), projectId, entry.name);
      if (!admission) fail('research_successor_outcome_unconfirmed');
      if (admission.baseline.parentRunId === runId) fail('research_parent_already_has_successor');
    }
  } finally { entries.closeSync(); }
  return file;
}

export function inspectResearchRun(stateRoot, projectId, runId) {
  if (!validId(runId)) fail('invalid_research_run');
  const project = projectDirectory(stateRoot, projectId, false);
  return project ? inspectRun(project, projectId, runId) : { status: 'not-found' };
}

export function inspectResearchReview(stateRoot, proposal) {
  const run = inspectResearchRun(stateRoot, proposal?.projectId, proposal?.runId);
  if (!run.report) fail('research_review_evidence_unavailable');
  const review = validateRunReview(run.report, proposal, run.acceptanceCriteria);
  return { review, dispatched: false, ownerAccepted: false,
    ...(run.acceptance ? { acceptance: run.acceptance } : {}) };
}

function releaseProject(lease, fd) {
  try {
    if (!same(fs.fstatSync(fd, { bigint: true }), fs.lstatSync(lease, { bigint: true }))) fail('research_lease_changed');
    fs.unlinkSync(lease);
  } finally { fs.closeSync(fd); }
}

function captureChild(plan, dir) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|CONTROL_PLANE_.*|TUNNEL_.*|OPENAI_.*)$/i.test(name)));
    let remaining = plan.maxOutputBytes, truncated = false, lost = false;
    const records = Object.fromEntries(streams.map(name => [name, []]));
    const child = spawn(plan.program, plan.argv, { cwd: plan.cwd, env, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => { lost = true; });
    for (const name of streams) {
      child[name].on('error', () => { lost = true; });
      child[name].on('data', data => {
        const bytes = Math.min(remaining, data.length);
        if (bytes > 0) records[name].push(Buffer.from(data.subarray(0, bytes)));
        remaining -= bytes;
        if (bytes < data.length) truncated = true;
      });
    }
    child.once('close', (exitCode, signal) => {
      if (lost || signal || !Number.isInteger(exitCode)) { reject(new Error('research_outcome_unknown')); return; }
      try {
        const stdout = Buffer.concat(records.stdout);
        const metrics = plan.acceptanceCriteria ? metricsFromStdout(stdout, truncated, plan.report) : null;
        const artifacts = streams.map(name => {
          const data = name === 'stdout' ? stdout : Buffer.concat(records.stderr);
          writeNew(path.join(dir, name + '.log'), data);
          return { name, kind: name === 'stdout' && (plan.acceptanceCriteria ? Boolean(metrics) : !truncated && data.length > 0) ? 'output' : 'log',
            bytes: data.length, sha256: hash(data) };
        });
        const report = normalizeRunReport({ ...plan.report, termination: { state: 'exited', exitCode }, metrics: metrics ?? [], artifacts });
        resolve({ report, reportSha256: runReportDigest(report), outputTruncated: truncated });
      } catch (error) { reject(error); }
    });
  });
}

// This is an explicit local CLI, not a new browser command channel or unattended worker.
export async function executeResearchRun(stateRoot, request) {
  const plan = runPlan(request);
  const { projectId, runId, parentRunId } = plan.report;
  const planSha256 = hash(encode(plan));
  const project = projectDirectory(stateRoot, projectId, true);
  const previous = () => {
    const record = inspectRun(project, projectId, runId);
    if (record.status === 'not-found') return null;
    if (record.planSha256 && record.planSha256 !== planSha256) fail('research_run_conflict');
    return record;
  };
  const existing = previous();
  if (existing) return existing;
  const lease = path.join(project, 'launch.lease');
  let leaseFD;
  try { leaseFD = fs.openSync(lease, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') return previous() ?? fail('research_project_busy_or_unconfirmed');
    throw error;
  }
  let releasable = true;
  try {
    const raced = previous();
    if (raced) return raced;
    let claimFile;
    if (parentRunId !== null) {
      const parent = inspectRun(project, projectId, parentRunId);
      if (parent.status !== 'settled') fail('research_parent_not_settled');
      if (encode(parent.acceptanceCriteria) !== encode(plan.acceptanceCriteria)) fail('research_acceptance_criteria_changed');
      try { validateRunReview(parent.report, plan.review, parent.acceptanceCriteria); } catch { fail('research_review_does_not_match_parent'); }
      claimFile = prepareSuccessorClaim(project, parent);
    }
    fs.writeFileSync(leaseFD, encode({ format, version: 1, runId }));
    fs.fsyncSync(leaseFD);
    const dir = path.join(project, runId);
    releasable = false;
    if (claimFile) writeNew(claimFile, encode({ format, version: 1, parentReportSha256: plan.review.reportSha256,
      nextRunId: runId, nextPlanSha256: planSha256 }));
    fs.mkdirSync(dir, { mode: 0o700 });
    writeNew(path.join(dir, 'admitted.json'), encode({ format, version: plan.acceptanceCriteria ? 2 : 1, planSha256, report: plan.report,
      ...(plan.acceptanceCriteria ? { acceptanceCriteria: plan.acceptanceCriteria } : {}) }));
    const result = await captureChild(plan, dir);
    writeNew(path.join(dir, 'settled.json'), encode(result));
    const observed = inspectRun(project, projectId, runId);
    releasable = observed.status === 'settled';
    return observed;
  } finally {
    // A crash, ambiguous exit or failed write keeps the project fenced.
    if (releasable) releaseProject(lease, leaseFD);
    else fs.closeSync(leaseFD);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [verb, rootFlag, root, firstFlag, first, secondFlag, second] = process.argv.slice(2);
    if (rootFlag !== '--state-dir') fail('invalid_research_arguments');
    let result;
    if (verb === 'run' && firstFlag === '--plan' && process.argv.length === 7 && localPath(first)) {
      result = await executeResearchRun(root, JSON.parse(readBounded(first).toString('utf8')));
    } else if (verb === 'review' && firstFlag === '--proposal' && process.argv.length === 7 && localPath(first)) {
      result = inspectResearchReview(root, JSON.parse(readBounded(first).toString('utf8')));
    } else if (verb === 'status' && firstFlag === '--project' && secondFlag === '--run' && process.argv.length === 9) {
      result = inspectResearchRun(root, first, second);
    } else fail('invalid_research_arguments');
    process.stdout.write(encode(result));
  } catch (error) {
    const code = /^(?:research|review|invalid_(?:research|run|termination|exit|review))_[a-z_]+$/.test(error.message)
      ? error.message : 'research_runner_failed';
    process.stdout.write(encode({ error: code }));
    process.exitCode = 1;
  }
}
