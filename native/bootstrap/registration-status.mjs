// `status` / `verify` subcommands for bin.mjs. Both are read-only wrappers over
// precheckInstall: no registry write, no install, no host or owner start. The
// produced text/JSON never contains channel secrets, MACs or key material.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createRegQueryRegistry, formatReport, precheckInstall } from './runtime-precheck.mjs';

export const STATUS_FORMAT = 'agent-continue-registration-status';
export const VERIFY_FORMAT = 'agent-continue-registration-verify';
// Registration is per-user by design: the two HKCU views decide the state.
const USER_VIEWS = Object.freeze(['registry:HKCU/32', 'registry:HKCU/64']);

const byId = (report, id) => report.checks.find(check => check.id === id);

// Allowed outcomes: registered | not-registered | drift | error. HKLM is
// reported as not-applicable by precheckInstall and never affects this value.
function registryState(report) {
  const views = USER_VIEWS.map(id => byId(report, id));
  if (views.some(view => !view) || views.every(view => view.status === 'SKIP')) return 'unknown';
  if (views.some(view => view.kind === 'drift')) return 'drift';
  if (views.some(view => view.kind === 'error')) return 'error';
  if (views.every(view => view.kind === 'match')) return 'registered';
  if (views.every(view => view.kind === 'absent')) return 'not-registered';
  // One HKCU view points at our manifest and the other does not: an
  // inconsistent write, reported as drift rather than a partial state.
  return 'drift';
}

export function statusFromReport(report) {
  const pass = id => byId(report, id)?.status === 'PASS';
  const bindingCheck = byId(report, 'binding');
  const binding = bindingCheck?.status === 'PASS' ? 'present'
    : bindingCheck?.kind === 'missing' ? 'missing' : 'invalid';
  const installed = ['install_root', 'install_layout', 'manifest'].every(pass)
    && bindingCheck?.status === 'PASS' && byId(report, 'runtime_files')?.status !== 'FAIL';
  const hostStartable = ['binding', 'state_root', 'manifest',
    'device-native-host.mjs_syntax', 'device-owner.mjs_syntax'].every(pass);
  return Object.freeze({ format: STATUS_FORMAT, version: 1, root: report.root, installed, binding,
    registered: registryState(report), hostStartable, failed: report.failed, counts: report.counts });
}

export function buildRegistrationStatus(options = {}) {
  return statusFromReport(precheckInstall(options));
}

export function renderStatusText(status) {
  return [
    'install root: ' + (status.root || '<missing>'),
    'installed: ' + (status.installed ? 'yes' : 'no'),
    'binding: ' + status.binding,
    'registered: ' + status.registered,
    'host startable: ' + (status.hostStartable ? 'yes' : 'no'),
    'checks: pass=' + status.counts.pass + ' fail=' + status.counts.fail + ' skip=' + status.counts.skip,
    'note: not proof of Chrome registration, a live tunnel or chat authorization',
  ].join('\n') + '\n';
}

export function renderStatusJson(status) {
  return JSON.stringify({ format: status.format, version: status.version, root: status.root,
    installed: status.installed, binding: status.binding, registered: status.registered,
    hostStartable: status.hostStartable, failed: status.failed, counts: status.counts }) + '\n';
}

export function renderVerifyText(report) {
  return [...formatReport(report),
    'VERIFY RESULT pass=' + report.counts.pass + ' fail=' + report.counts.fail + ' skip=' + report.counts.skip,
    'note: not proof of Chrome registration, a live tunnel or chat authorization'].join('\n') + '\n';
}

export function renderVerifyJson(report) {
  return JSON.stringify({ format: VERIFY_FORMAT, version: 1, root: report.root, failed: report.failed,
    counts: report.counts, checks: report.checks }) + '\n';
}

function nodeCheck(file, run = spawnSync) {
  const result = run(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.error) return { ok: false, reason: 'node --check failed: ' + result.error.message };
  if (result.status !== 0) return { ok: false, reason: 'node --check: ' + String(result.stderr || '').trim().split('\n')[0] };
  return { ok: true, reason: 'parses as an ES module (node --check)' };
}

export function executeStatusCommand(args, deps = {}) {
  const command = args[0];
  if (command !== 'status' && command !== 'verify') throw new Error('invalid_arguments');
  let root = null, seenRoot = false, json = false, reference, seenReference = false;
  for (let index = 1; index < args.length; index++) {
    const token = args[index];
    if (token === '--json') {
      if (json) throw new Error('invalid_arguments');
      json = true; continue;
    }
    if (token === '--install-dir') {
      const value = args[index + 1];
      if (seenRoot || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      root = value; seenRoot = true; index++; continue;
    }
    if (token === '--reference') {
      const value = args[index + 1];
      if (seenReference || typeof value !== 'string' || !value || value.startsWith('--') ||
          !path.isAbsolute(value)) throw new Error('invalid_arguments');
      reference = value; seenReference = true; index++; continue;
    }
    throw new Error('invalid_arguments');
  }
  if (!root || !path.isAbsolute(root)) throw new Error('invalid_arguments');
  // The six sequential child waits share a budget; filesystem inspection is not timed here.
  const now = deps.monotonicNow ?? (() => performance.now());
  const deadline = now() + 45000;
  const runner = deps.processRunner ?? spawnSync;
  const run = (file, argv, options) => {
    const remaining = Math.floor(deadline - now());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return { error: new Error('status_process_budget_exhausted') };
    }
    const result = runner(file, argv, { ...options, timeout: Math.min(options.timeout, remaining) });
    return now() > deadline ? { error: new Error('status_process_budget_exhausted') } : result;
  };
  const report = precheckInstall({ root,
    registry: deps.registry === undefined ? createRegQueryRegistry(run) : deps.registry,
    verifySyntax: deps.verifySyntax === undefined ? file => nodeCheck(file, run) : deps.verifySyntax,
    ...(deps.reference !== undefined ? { reference: deps.reference } : seenReference ? { reference } : {}) });
  if (command === 'status') {
    const status = statusFromReport(report);
    return Object.freeze({ output: json ? renderStatusJson(status) : renderStatusText(status), exitCode: 0, status });
  }
  return Object.freeze({ output: json ? renderVerifyJson(report) : renderVerifyText(report),
    exitCode: report.failed ? 1 : 0, report });
}
