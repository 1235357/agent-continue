import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { spawn as nodeSpawn } from 'node:child_process';
import { readState, buildHostLaunch } from './runtime.mjs';
import * as profile from './profile.mjs';
import { observeCore, hasExited } from './process-observation.mjs';

const fail = code => { throw new Error(code); };
const encode = value => JSON.stringify(value) + '\n';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

const SECRET_ENV = 'CONTROL_PLANE_API_KEY';
const TUNNEL_ID_ENV = 'CONTROL_PLANE_TUNNEL_ID';
const CLIENT_ENV = 'AGENT_CONTINUE_TUNNEL_CLIENT';

function quote(value) {
  if (/["\r\n\0]/.test(value)) fail('invalid_profile_input');
  return '"' + (process.platform === 'win32' ? value.replaceAll('\\', '/') : value.replaceAll('\\', '\\\\')) + '"';
}

// Credentials come from the local key file binding or, when no binding exists,
// from the current-user environment. Secrets never leave the child environment:
// the launch record carries env only and is never persisted or logged.
export function resolveTunnelLaunch(root, options = {}) {
  root = readState(root).root;
  const parent = options.env ?? process.env;
  let binding;
  try { binding = profile.buildTunnelLaunch(root, parent); }
  catch (error) { if (error?.message !== 'binding_missing') throw error; }
  if (binding) return { configured: true, source: 'key-file', ...binding };
  const tunnelId = parent[TUNNEL_ID_ENV], secret = parent[SECRET_ENV], client = parent[CLIENT_ENV];
  if (tunnelId === undefined && secret === undefined && client === undefined) {
    return { configured: false, source: 'none', reason: 'tunnel_not_configured' };
  }
  if (typeof tunnelId !== 'string' || !/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(tunnelId) ||
      typeof secret !== 'string' || !secret.length || secret.length > 4096 || /[\x00-\x1f\x7f]/.test(secret) ||
      typeof client !== 'string' || !path.isAbsolute(client)) {
    return { configured: false, source: 'environment', reason: 'tunnel_credentials_incomplete' };
  }
  // A missing pin table means the client cannot be verified; fail closed instead of running it.
  if (typeof profile.verifyTunnelExecutable !== 'function') fail('unsupported_tunnel_platform');
  const verified = (options.verifyClient ?? profile.verifyTunnelExecutable)(client);
  const host = buildHostLaunch(root, {});
  const env = typeof profile.profileEnvironment === 'function' ?
    profile.profileEnvironment(root, parent) : buildHostLaunch(root, parent).env;
  env[SECRET_ENV] = secret;
  return { configured: true, source: 'environment', tunnelId,
    command: verified.file,
    args: ['run', '--control-plane.base-url', 'https://api.openai.com',
      '--control-plane.tunnel-id', tunnelId, '--control-plane.api-key', 'env:' + SECRET_ENV,
      '--mcp.command', [host.command, ...host.args].map(quote).join(' '),
      '--health.listen-addr', '127.0.0.1:0'],
    cwd: path.join(root, 'work'), env, windowsHide: true };
}

function regular(file, limit) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino === 0n || info.size > BigInt(limit)) fail('invalid_lifecycle_state');
  return info;
}

const permanentIntent = paused => ({ format: 'agent-continue-lifecycle', version: 1, paused });
const temporaryIntent = loginGeneration => ({
  format: 'agent-continue-lifecycle', version: 2, paused: true, resumeOnLogin: true, loginGeneration,
});
const validLoginGeneration = value => Number.isSafeInteger(value) && value >= 0;

function intent(root) {
  const file = path.join(root, 'lifecycle.json');
  try {
    regular(file, 1024);
    const bytes = fs.readFileSync(file, 'utf8'), value = JSON.parse(bytes);
    if (exact(value, ['format', 'version', 'paused']) && value.format === 'agent-continue-lifecycle' &&
        value.version === 1 && typeof value.paused === 'boolean' && encode(value) === bytes) return value;
    if (validLoginGeneration(value?.loginGeneration) && encode(temporaryIntent(value.loginGeneration)) === bytes) return value;
    fail('invalid_lifecycle_state');
  } catch (error) {
    if (error.code === 'ENOENT') return permanentIntent(true);
    fail('invalid_lifecycle_state');
  }
}

async function bounded(promise, milliseconds, signal) {
  if (signal?.aborted) return undefined;
  let timer, cancel;
  try {
    return await Promise.race([promise, new Promise(resolve => {
      timer = setTimeout(resolve, milliseconds);
      cancel = () => resolve(undefined);
      signal?.addEventListener('abort', cancel, { once: true });
    })]);
  } finally { clearTimeout(timer); if (cancel) signal?.removeEventListener('abort', cancel); }
}

async function delay(milliseconds, signal) {
  return bounded(new Promise(() => {}), milliseconds, signal);
}

function dependencies(options) {
  const defaults = { spawn: nodeSpawn, fetch: globalThis.fetch, observeCore, hasExited,
    launch: root => resolveTunnelLaunch(root),
    deferStartup: false,
    readInteractiveLoginGeneration: () => null,
    readyTimeoutMs: 10000, stopTimeoutMs: 5000, pollIntervalMs: 100,
    maxRestarts: 2, restartBackoffMs: 200, healthIntervalMs: 1000, healthFailureThreshold: 3 };
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !Object.hasOwn(defaults, key))) fail('invalid_controller_options');
  const value = { ...defaults, ...options };
  if (typeof value.deferStartup !== 'boolean') fail('invalid_controller_options');
  for (const key of ['spawn', 'fetch', 'observeCore', 'hasExited', 'launch', 'readInteractiveLoginGeneration']) {
    if (typeof value[key] !== 'function') fail('invalid_controller_options');
  }
  for (const key of ['readyTimeoutMs', 'stopTimeoutMs', 'pollIntervalMs', 'restartBackoffMs', 'healthIntervalMs']) {
    if (!Number.isInteger(value[key]) || value[key] < 5 || value[key] > 30000) fail('invalid_controller_options');
  }
  if (!Number.isInteger(value.maxRestarts) || value.maxRestarts < 0 || value.maxRestarts > 10) fail('invalid_controller_options');
  if (!Number.isInteger(value.healthFailureThreshold) || value.healthFailureThreshold < 1 || value.healthFailureThreshold > 10) fail('invalid_controller_options');
  return value;
}

// Trusted in-process dependencies support tests. They are not browser inputs.
export function openController(root, options = {}) {
  const io = dependencies(options);
  root = readState(root).root;
  const rootIdentity = fs.lstatSync(root, { bigint: true });
  let saved = intent(root), paused = saved.paused, disposed = false, phase = 'stopped', ready = false;
  let current = null, starting = null, pausing = null, disposing = null, generation = 0;
  let startupChecked = false;
  let restarts = 0, configured = null;
  const lease = path.join(root, 'controller.lease');
  const leaseBytes = encode({ format: 'agent-continue-controller', version: 1, token: crypto.randomUUID() });
  let fd;
  try { fd = fs.openSync(lease, 'wx+', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('controller_owned'); fail('controller_lease_failed'); }
  try { fs.writeFileSync(fd, leaseBytes); }
  catch { fs.closeSync(fd); fail('controller_lease_failed'); }

  function startSavedIntent(authorize = () => true) {
    if (startupChecked) return Promise.resolve();
    startupChecked = true;
    owned();
    const allowed = () => !paused && authorize();
    if (!allowed()) return Promise.resolve();
    const startup = requestStart(null, allowed, true);
    const startupGeneration = generation;
    return startup.catch(error => {
      if (disposed || disposing || startupGeneration !== generation) return;
      try { owned(); } catch { return; }
      if (!allowed()) return;
      if (error?.message === 'tunnel_not_configured' || error?.message === 'tunnel_credentials_incomplete') {
        // Keep the pause truthful on disk as well: a later start must not keep
        // retrying an impossible launch, and status must re-read the same intent.
        try { persist(permanentIntent(true)); } catch { /* The in-memory pause below still reports it. */ }
        paused = true; configured = false; phase = 'stopped'; ready = false;
      } else if (error?.message !== 'controller_closed') { phase = 'failed'; ready = false; }
    });
  }

  function owned() {
    if (disposed) fail('controller_closed');
    try {
      let currentPath = path.parse(root).root;
      for (const part of root.slice(currentPath.length).split(path.sep).filter(Boolean)) {
        currentPath = path.join(currentPath, part);
        if (fs.lstatSync(currentPath).isSymbolicLink()) fail('controller_ownership_lost');
      }
      const directory = fs.lstatSync(root, { bigint: true });
      const opened = fs.fstatSync(fd, { bigint: true }), onDisk = regular(lease, 1024);
      if (!directory.isDirectory() || directory.dev !== rootIdentity.dev || directory.ino !== rootIdentity.ino ||
          opened.dev !== onDisk.dev || opened.ino !== onDisk.ino || fs.readFileSync(lease, 'utf8') !== leaseBytes) fail('controller_ownership_lost');
    } catch { fail('controller_ownership_lost'); }
    saved = intent(root);
    paused = saved.paused;
  }

  function persist(value) {
    owned();
    const temporary = path.join(root, 'intent.' + crypto.randomUUID() + '.tmp');
    let created = false;
    try {
      fs.writeFileSync(temporary, encode(value), { flag: 'wx', mode: 0o600 });
      created = true;
      fs.renameSync(temporary, path.join(root, 'lifecycle.json'));
    } catch {
      if (created) { try { fs.unlinkSync(temporary); } catch { /* Retain incomplete local state. */ } }
      fail('intent_publish_failed');
    }
    saved = value;
    paused = value.paused;
  }

  function loginGeneration() {
    try {
      const value = io.readInteractiveLoginGeneration();
      return validLoginGeneration(value) ? value : null;
    } catch { return null; }
  }

  const snapshot = () => ({ paused, runtime: phase, ready,
    pauseMode: !paused ? 'running' : saved.resumeOnLogin === true ? 'until-next-login' : 'stay-disconnected',
    loginRecoveryAvailable: loginGeneration() !== null,
    ...(restarts ? { restarts } : {}),
    ...(configured === false ? { configured: false } : {}),
    chatAuthorization: 'not-observed' });

  function canObserve(run, attempt) {
    return !disposed && !disposing && !paused && current === run && attempt === generation &&
      !run.exited && !run.cancel.signal.aborted && phase !== 'unknown' && phase !== 'stopping';
  }

  async function probe(run, attempt) {
    if (!canObserve(run, attempt)) return false;
    let address;
    try {
      regular(run.healthFile, 2048);
      address = new URL(fs.readFileSync(run.healthFile, 'utf8').trim());
      if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port ||
          address.username || address.password || address.pathname !== '/' || address.search || address.hash) return false;
      const signal = AbortSignal.any([run.cancel.signal, AbortSignal.timeout(500)]);
      const response = await bounded(io.fetch(new URL('/readyz', address), { redirect: 'error', signal }), 500, run.cancel.signal);
      if (response?.body) void response.body.cancel().catch(() => {});
      return response?.status === 200 && canObserve(run, attempt);
    } catch { return false; }
  }

  async function capture(run, deadline) {
    const parentLive = () => !run.exited && run.child.exitCode === null && run.child.signalCode === null;
    do {
      if (!parentLive()) return;
      try {
        const identity = await bounded(io.observeCore(run.child.pid, process.execPath), Math.max(1, deadline - performance.now()));
        if (!parentLive()) return;
        if (exact(identity, ['pid', 'startTime', 'executable']) && Number.isInteger(identity.pid) && identity.pid > 0 && identity.pid <= 2147483647 &&
            typeof identity.startTime === 'string' && /^[1-9]\d{0,23}$/.test(identity.startTime) && typeof identity.executable === 'string' &&
            (process.platform === 'win32' ? identity.executable.toLowerCase() === process.execPath.toLowerCase() : identity.executable === process.execPath)) {
          run.core = identity; return;
        }
      } catch { /* Missing or inaccessible process metadata remains unknown. */ }
      if (!parentLive()) return;
      await delay(io.pollIntervalMs);
    } while (performance.now() < deadline);
  }

  async function stopped(run, budget = io.stopTimeoutMs) {
    if (!run) return true;
    if (!run.exited || !run.core) return false;
    if (run.exitConfirmed) return true;
    // A confirmed exit belongs to this captured process identity, not a future run.
    try {
      if (await bounded(io.hasExited(run.core), Math.max(1, budget)) === true) run.exitConfirmed = true;
    } catch { /* An observation failure is not exit evidence. */ }
    return run.exitConfirmed;
  }

  async function status() {
    owned();
    const run = current, observedGeneration = generation;
    if (run?.exited) {
      const confirmed = await stopped(run);
      if (run === current && observedGeneration === generation) {
        phase = confirmed ? (paused ? 'stopped' : 'failed') : 'unknown'; ready = false;
      }
    } else if (run && phase !== 'stopping' && phase !== 'unknown') {
      const observedReady = Boolean(run.core) && await probe(run, observedGeneration);
      if (canObserve(run, observedGeneration)) {
        ready = observedReady;
        if (observedReady) { run.wasReady = true; monitor(run, observedGeneration); }
      }
    }
    return snapshot();
  }

  function reconnect() {
    return requestStart();
  }

  function mayResume(pausedAtLogin) {
    const observed = loginGeneration();
    return saved.resumeOnLogin === true && saved.loginGeneration === pausedAtLogin &&
      observed !== null && observed > pausedAtLogin;
  }

  function resumeAfterInteractiveLogin(...args) {
    if (args.length) fail('invalid_login_recovery_arguments');
    owned();
    if (saved.resumeOnLogin !== true || !mayResume(saved.loginGeneration)) return status();
    return requestStart(saved.loginGeneration);
  }

  function requestStart(pausedAtLogin = null, authorize = null, restoreRunning = false) {
    if (starting || pausing || disposing) return Promise.reject(new Error('operation_busy'));
    const requestedGeneration = current && !current.exited ? generation : ++generation;
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    starting = pending;
    void connect(requestedGeneration, pausedAtLogin, authorize, restoreRunning).then(resolve, reject);
    return pending.finally(() => { starting = null; });
  }

  async function connect(requestedGeneration, pausedAtLogin = null, authorize = null, restoreRunning = false) {
    owned();
    if (authorize && !authorize()) return snapshot();
    if (pausedAtLogin !== null && !mayResume(pausedAtLogin)) return snapshot();
    if (current && !current.exited) {
      if (paused || phase === 'unknown' || phase === 'stopping') fail('stop_unconfirmed');
      return status();
    }
    if (current && !await stopped(current)) fail('stop_unconfirmed');
    if (requestedGeneration !== generation) return snapshot();
    if (pausedAtLogin !== null) {
      owned();
      if (!mayResume(pausedAtLogin)) return snapshot();
    }
    // Resolve credentials before publishing intent: an unconfigured owner must
    // report that state explicitly and must not silently clear the pause. A sync
    // resolver keeps spawn synchronous for callers that inspect the launch.
    let launch = io.launch(root);
    if (launch && typeof launch.then === 'function') launch = await launch;
    owned();
    if (requestedGeneration !== generation || disposing || disposed ||
        restoreRunning && paused || pausedAtLogin !== null && !mayResume(pausedAtLogin) ||
        authorize && !authorize()) return snapshot();
    if (!launch.configured) { configured = false; phase = 'stopped'; ready = false; fail(launch.reason || 'tunnel_not_configured'); }
    configured = true;
    // A wake can restore running intent, but must never publish it over a concurrent pause.
    if (!restoreRunning) persist(permanentIntent(false));
    phase = 'starting'; ready = false;
    const run = { child: null, core: null, exited: false, exitConfirmed: false, wasReady: false, monitored: false, configured: true,
      cancel: new AbortController(), healthFile: path.join(root, 'health.' + crypto.randomUUID() + '.url') };
    current = run;
    let finish;
    run.exit = new Promise(resolve => { finish = resolve; });
    try {
      run.child = io.spawn(launch.command, [...launch.args, '--health.url-file', run.healthFile], {
        cwd: launch.cwd, env: launch.env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
      run.child.once('exit', () => { run.exited = true; if (current === run) ready = false; finish(); scheduleRestart(run); });
      run.child.once('error', () => { if (current === run) { phase = 'unknown'; ready = false; } });
      run.child.stdout?.resume(); run.child.stderr?.resume();
    } catch { phase = 'unknown'; fail('runtime_start_unconfirmed'); }
    const deadline = performance.now() + io.readyTimeoutMs;
    run.capture = capture(run, deadline);
    await run.capture;
    while (canObserve(run, requestedGeneration) && performance.now() < deadline) {
      if (run.core && await probe(run, requestedGeneration) && canObserve(run, requestedGeneration)) {
        ready = true; run.wasReady = true; monitor(run, requestedGeneration); break;
      }
      await delay(io.pollIntervalMs, run.cancel.signal);
    }
    if (paused || run.cancel.signal.aborted || requestedGeneration !== generation) { ready = false; return snapshot(); }
    const exitedConfirmed = run.exited && await stopped(run);
    if (requestedGeneration === generation && !paused && phase !== 'unknown') {
      phase = run.exited ? (exitedConfirmed ? 'failed' : 'unknown') : (run.core ? 'running' : 'unknown');
      if (!run.exited && run.core) monitor(run, requestedGeneration);
    }
    if (paused || phase === 'unknown' || run.cancel.signal.aborted || run.exited) ready = false;
    if (requestedGeneration === generation && !paused && !ready && !run.wasReady && exitedConfirmed) {
      // A confirmed failed start is reported as a code; it is never retried.
      fail('tunnel_start_failed');
    }
    return snapshot();
  }

  function scheduleRestart(run) {
    if (run !== current || paused || disposed || phase === 'stopping' || phase === 'unknown' || !run.configured || !run.wasReady) return;
    ready = false;
    if (restarts >= io.maxRestarts) { phase = 'failed'; return; }
    restarts += 1;
    const attempt = ++generation;
    void (async () => {
      await delay(io.restartBackoffMs);
      const ownsAttempt = () => !disposed && !disposing && !paused && attempt === generation && current === run;
      const deadline = performance.now() + io.stopTimeoutMs;
      // On Windows the launcher can exit before its stdio provider sees EOF.
      // Wait for positive exit evidence, not merely a dead launcher or pipe.
      while (ownsAttempt()) {
        if (await stopped(run, deadline - performance.now())) break;
        if (!ownsAttempt()) return;
        const remaining = deadline - performance.now();
        if (remaining <= 0) { phase = 'unknown'; return; }
        await delay(Math.min(io.pollIntervalMs, remaining));
      }
      if (!ownsAttempt()) return;
      try { await connect(attempt, null, () => !paused, true); }
      catch { if (attempt === generation && !paused) { phase = 'failed'; ready = false; } }
    })();
  }

  // Continue observing a verified live child even after the startup deadline.
  // Only supervise replacement once this run has actually become ready.
  function monitor(run, attempt) {
    if (run.monitored) return;
    run.monitored = true;
    void (async () => {
      let failures = 0;
      while (canObserve(run, attempt)) {
        await delay(io.healthIntervalMs, run.cancel.signal);
        if (!canObserve(run, attempt)) return;
        const previouslyReady = run.wasReady;
        const healthy = Boolean(run.core) && await probe(run, attempt);
        if (!canObserve(run, attempt)) return;
        if (healthy) { failures = 0; ready = true; run.wasReady = true; continue; }
        if (!previouslyReady) continue;
        ready = false;
        if (++failures < io.healthFailureThreshold) continue;
        try { run.child?.kill('SIGTERM'); } catch { phase = 'failed'; }
        return;
      }
    })();
  }

  function pause() {
    owned(); persist(permanentIntent(true));
    return stopRuntime();
  }

  function pauseUntilLogin(...args) {
    if (args.length) fail('invalid_login_recovery_arguments');
    owned();
    const observed = loginGeneration();
    if (observed === null) fail('login_recovery_unavailable');
    persist(temporaryIntent(observed));
    return stopRuntime();
  }

  function stopRuntime(closing = false) {
    if (pausing) return pausing;
    if (!closing) owned();
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pausing = pending;
    void stopOwnedRuntime().then(resolve, reject);
    return pending.finally(() => { pausing = null; });
  }

  async function stopOwnedRuntime() {
    generation++; ready = false;
    const run = current;
    run?.cancel.abort();
    phase = run ? 'stopping' : 'stopped';
    const deadline = performance.now() + io.stopTimeoutMs;
    if (run && !run.exited) {
      try { run.child?.kill('SIGTERM'); } catch { phase = 'unknown'; }
      await bounded(run.exit, Math.max(1, deadline - performance.now()));
    }
    if (run?.capture) await bounded(run.capture, Math.max(1, deadline - performance.now()));
    let confirmed = await stopped(run, deadline - performance.now());
    while (!confirmed && performance.now() < deadline) {
      await delay(Math.min(io.pollIntervalMs, Math.max(1, deadline - performance.now())));
      confirmed = await stopped(run, deadline - performance.now());
    }
    phase = confirmed ? 'stopped' : 'unknown';
    ready = false;
    return snapshot();
  }

  function dispose() {
    if (disposed) return Promise.resolve();
    if (disposing) return disposing;
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    disposing = pending;
    void closeRuntime().then(resolve, reject);
    return pending.finally(() => { disposing = null; });
  }

  async function closeRuntime() {
    // Stop through the retained child handle even if intent or exit
    // observation is broken. Unknown state still prevents lease release.
    await stopRuntime(true);
    if (!await stopped(current)) fail('stop_unconfirmed');
    if (starting) await starting;
    owned();
    try { fs.unlinkSync(lease); fs.closeSync(fd); }
    catch { fail('controller_release_failed'); }
    disposed = true;
  }

  if (!io.deferStartup) void startSavedIntent();
  return Object.freeze({ reconnect, pause, pauseUntilLogin, resumeAfterInteractiveLogin, status, dispose, startSavedIntent });
}
