import { createHash } from 'node:crypto';

const id = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[0-9a-f]{64}$/;
const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const key = /^[a-z][a-z0-9_-]{0,63}$/;

function requireThat(condition, code) {
  if (!condition) throw new TypeError(code);
}

function fields(value, expected, code) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).length === expected.length && expected.every(name => Object.hasOwn(value, name)), code);
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function normalizeNamed(values, limit, convert, code) {
  requireThat(Array.isArray(values) && values.length <= limit, code);
  const unique = new Set();
  const normalized = Array.from(values, value => {
    const result = convert(value);
    requireThat(matches(key, result.name) && !unique.has(result.name), code);
    unique.add(result.name);
    return result;
  });
  return normalized.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

// Reports carry evidence references, never executable input or a grant.
export function normalizeRunReport(value) {
  fields(value, ['version', 'projectId', 'runId', 'parentRunId', 'revision', 'termination', 'metrics', 'artifacts'], 'invalid_run_report');
  requireThat(value.version === 1 && matches(id, value.projectId) && matches(id, value.runId) &&
    (value.parentRunId === null || matches(id, value.parentRunId) && value.parentRunId !== value.runId) &&
    matches(revision, value.revision), 'invalid_run_identity');

  const { termination } = value;
  fields(termination, ['state', 'exitCode'], 'invalid_termination');
  if (termination.state === 'exited') {
    requireThat(Number.isInteger(termination.exitCode) && termination.exitCode >= 0 &&
      termination.exitCode <= 0xffffffff, 'invalid_exit_code');
  } else requireThat(['running', 'cancelled', 'unknown'].includes(termination.state) && termination.exitCode === null,
    'invalid_termination');

  const metrics = normalizeNamed(value.metrics, 64, metric => {
    fields(metric, ['name', 'value'], 'invalid_metric');
    requireThat(Number.isFinite(metric.value), 'invalid_metric');
    return { name: metric.name, value: metric.value };
  }, 'invalid_metrics');
  const artifacts = normalizeNamed(value.artifacts, 32, artifact => {
    fields(artifact, ['name', 'kind', 'sha256', 'bytes'], 'invalid_artifact');
    requireThat(['log', 'output', 'checkpoint'].includes(artifact.kind) && matches(sha256, artifact.sha256) &&
      Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0, 'invalid_artifact');
    return { name: artifact.name, kind: artifact.kind, sha256: artifact.sha256, bytes: artifact.bytes };
  }, 'invalid_artifacts');
  return { version: 1, projectId: value.projectId, runId: value.runId, parentRunId: value.parentRunId,
    revision: value.revision, termination: { state: termination.state, exitCode: termination.exitCode }, metrics, artifacts };
}

export function runReportDigest(value) {
  return createHash('sha256').update(JSON.stringify(normalizeRunReport(value))).digest('hex');
}

export function normalizeAcceptanceCriteria(value) {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 16, 'invalid_research_acceptance_criteria');
  const seen = new Set();
  return Array.from(value, rule => {
    const code = 'invalid_research_acceptance_criteria';
    fields(rule, ['metric', 'operator', 'threshold'], code);
    requireThat(matches(key, rule.metric) && !seen.has(rule.metric) && ['gte', 'lte'].includes(rule.operator) &&
      Number.isFinite(rule.threshold), code);
    seen.add(rule.metric);
    return { metric: rule.metric, operator: rule.operator, threshold: rule.threshold };
  }).sort((a, b) => a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0);
}

export function assessRunCriteria(value, criteria) {
  const report = normalizeRunReport(value);
  const metrics = new Map(report.metrics.map(metric => [metric.name, metric.value]));
  const checks = normalizeAcceptanceCriteria(criteria).map(rule => {
    const observed = metrics.get(rule.metric) ?? null;
    return { ...rule, observed, passed: observed === null ? null :
      rule.operator === 'gte' ? observed >= rule.threshold : observed <= rule.threshold };
  });
  let status = 'result-unavailable';
  if (report.termination.state === 'exited' && report.termination.exitCode !== 0) status = 'run-failed';
  else if (report.termination.state === 'exited' && report.artifacts.some(item => item.kind === 'output') &&
      checks.every(check => check.passed !== null)) {
    status = checks.every(check => check.passed) ? 'ready-for-owner-review' : 'criteria-not-met';
  }
  return { status, checks };
}

export function validateRunReview(value, proposal, criteria) {
  const report = normalizeRunReport(value);
  fields(proposal, ['version', 'projectId', 'runId', 'reportSha256', 'action', 'nextRunId'], 'invalid_review');
  requireThat(proposal.version === 1 && proposal.projectId === report.projectId && proposal.runId === report.runId &&
    proposal.reportSha256 === runReportDigest(report), 'review_does_not_match_run');
  const { state, exitCode } = report.termination;
  const acceptance = criteria === undefined ? null : assessRunCriteria(report, criteria);
  switch (proposal.action) {
    case 'reconcile':
      requireThat(state === 'unknown' || state === 'running', 'reconcile_requires_unsettled_run');
      break;
    case 'retry':
      requireThat(state === 'cancelled' || state === 'exited' &&
        (exitCode !== 0 || acceptance && acceptance.status !== 'ready-for-owner-review'),
      'retry_requires_confirmed_non_success');
      break;
    case 'advance':
    case 'request-final-acceptance':
      requireThat(state === 'exited' && exitCode === 0 && report.artifacts.some(item => item.kind === 'output'),
        'review_requires_success_and_output');
      requireThat(!acceptance || acceptance.status === 'ready-for-owner-review', 'review_requires_criteria');
      break;
    default: throw new TypeError('invalid_review_action');
  }
  const dispatch = proposal.action === 'retry' || proposal.action === 'advance';
  requireThat(dispatch ? matches(id, proposal.nextRunId) && proposal.nextRunId !== report.runId &&
    proposal.nextRunId !== report.parentRunId : proposal.nextRunId === null, 'invalid_next_run');
  // A validated proposal still needs the owner journal, budget and admission checks.
  return { ...proposal };
}
