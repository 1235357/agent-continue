import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { spawn as nodeSpawn } from 'node:child_process';
import { readState } from './runtime.mjs';
import { buildTunnelLaunch } from './profile.mjs';
import { observeCore, hasExited } from './process-observation.mjs';

const fail = code => { throw new Error(code); };
const encode = value => JSON.stringify(value) + '\n';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function regular(file, limit) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino === 0n || info.size > BigInt(limit)) fail('invalid_lifecycle_state');
  return info;
}

function intent(root) {
  const file = path.join(root, 'lifecycle.json');
  try {
    regular(file, 1024);
    const bytes = fs.readFileSync(file, 'utf8'), value = JSON.parse(bytes);
    if (!exact(value, ['format', 'version', 'paused']) || value.format !== 'agent-continue-lifecycle' ||
        value.version !== 1 || typeof value.paused !== 'boolean' || encode(value) !== bytes) fail('invalid_lifecycle_state');
    return value.paused;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
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
    readyTimeoutMs: 10000, stopTimeoutMs: 5000, pollIntervalMs: 100 };
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !Object.hasOwn(defaults, key))) fail('invalid_controller_options');
  const value = { ...defaults, ...options };
  for (const key of ['spawn', 'fetch', 'observeCore', 'hasExited']) if (typeof value[key] !== 'function') fail('invalid_controller_options');
  for (const key of ['readyTimeoutMs', 'stopTimeoutMs', 'pollIntervalMs']) {
    if (!Number.isInteger(value[key]) || value[key] < 5 || value[key] > 30000) fail('invalid_controller_options');
  }
  return value;
}

// Trusted in-process dependencies support tests. They are not browser inputs.
export function openController(root, options = {}) {
  const io = dependencies(options);
  root = readState(root).root;
  const rootIdentity = fs.lstatSync(root, { bigint: true });
  let paused = intent(root), disposed = false, phase = 'stopped', ready = false;
  let current = null, starting = null, pausing = null, disposing = null, generation = 0;
  const lease = path.join(root, 'controller.lease');
  const leaseBytes = encode({ format: 'agent-continue-controller', version: 1, token: crypto.randomUUID() });
  let fd;
  try { fd = fs.openSync(lease, 'wx+', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('controller_owned'); fail('controller_lease_failed'); }
  try { fs.writeFileSync(fd, leaseBytes); }
  catch { fs.closeSync(fd); fail('controller_lease_failed'); }

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
    paused = intent(root);
  }

  function persist(value) {
    owned();
    const temporary = path.join(root, 'intent.' + crypto.randomUUID() + '.tmp');
    let created = false;
    try {
      fs.writeFileSync(temporary, encode({ format: 'agent-continue-lifecycle', version: 1, paused: value }), { flag: 'wx', mode: 0o600 });
      created = true;
      fs.renameSync(temporary, path.join(root, 'lifecycle.json'));
    } catch {
      if (created) { try { fs.unlinkSync(temporary); } catch { /* Retain incomplete local state. */ } }
      fail('intent_publish_failed');
    }
    paused = value;
  }

  const snapshot = () => ({ paused, runtime: phase, ready, chatAuthorization: 'not-observed' });

  async function probe(run) {
    if (paused || run.exited || run.cancel.signal.aborted) return false;
    let address;
    try {
      regular(run.healthFile, 2048);
      address = new URL(fs.readFileSync(run.healthFile, 'utf8').trim());
      if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port ||
          address.username || address.password || address.pathname !== '/' || address.search || address.hash) return false;
      const signal = AbortSignal.any([run.cancel.signal, AbortSignal.timeout(500)]);
      const response = await bounded(io.fetch(new URL('/readyz', address), { redirect: 'error', signal }), 500, run.cancel.signal);
      if (response?.body) void response.body.cancel().catch(() => {});
      return response?.status === 200 && !paused && !run.exited && !run.cancel.signal.aborted;
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
    try { return await bounded(io.hasExited(run.core), Math.max(1, budget)) === true; }
    catch { return false; }
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
      const observedReady = Boolean(run.core) && await probe(run);
      if (run === current && observedGeneration === generation) ready = observedReady;
    }
    return snapshot();
  }

  function reconnect() {
    if (starting || pausing || disposing) return Promise.reject(new Error('operation_busy'));
    const requestedGeneration = ++generation;
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    starting = pending;
    void connect(requestedGeneration).then(resolve, reject);
    return pending.finally(() => { starting = null; });
  }

  async function connect(requestedGeneration) {
    owned();
    if (current && !current.exited) {
      if (paused || phase === 'unknown' || phase === 'stopping') fail('stop_unconfirmed');
      return status();
    }
    if (current && !await stopped(current)) fail('stop_unconfirmed');
    if (requestedGeneration !== generation) return snapshot();
    const launch = buildTunnelLaunch(root);
    persist(false);
    phase = 'starting'; ready = false;
    const run = { child: null, core: null, exited: false, cancel: new AbortController(),
      healthFile: path.join(root, 'health.' + crypto.randomUUID() + '.url') };
    current = run;
    let finish;
    run.exit = new Promise(resolve => { finish = resolve; });
    try {
      run.child = io.spawn(launch.command, [...launch.args, '--health.url-file', run.healthFile], {
        cwd: launch.cwd, env: launch.env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
      run.child.once('exit', () => { run.exited = true; if (current === run) ready = false; finish(); });
      run.child.once('error', () => { if (current === run) { phase = 'unknown'; ready = false; } });
      run.child.stdout?.resume(); run.child.stderr?.resume();
    } catch { phase = 'unknown'; fail('runtime_start_unconfirmed'); }
    const deadline = performance.now() + io.readyTimeoutMs;
    run.capture = capture(run, deadline);
    await run.capture;
    while (!run.exited && !paused && phase !== 'unknown' && !run.cancel.signal.aborted && performance.now() < deadline) {
      if (run.core && await probe(run)) { ready = true; break; }
      await delay(io.pollIntervalMs, run.cancel.signal);
    }
    if (paused || run.cancel.signal.aborted || requestedGeneration !== generation) { ready = false; return snapshot(); }
    const exitedConfirmed = run.exited && await stopped(run);
    if (requestedGeneration === generation && !paused && phase !== 'unknown') {
      phase = run.exited ? (exitedConfirmed ? 'failed' : 'unknown') : (run.core ? 'running' : 'unknown');
    }
    if (paused || phase === 'unknown' || run.cancel.signal.aborted || run.exited) ready = false;
    return snapshot();
  }

  function pause() {
    if (pausing) return pausing;
    owned(); persist(true); generation++; ready = false;
    const run = current;
    run?.cancel.abort();
    phase = run ? 'stopping' : 'stopped';
    pausing = (async () => {
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
    })();
    return pausing.finally(() => { pausing = null; });
  }

  function dispose() {
    if (disposed) return Promise.resolve();
    if (disposing) return disposing;
    disposing = (async () => {
      owned();
      if (phase === 'unknown' && !await stopped(current)) fail('stop_unconfirmed');
      await pause();
      if (!await stopped(current)) fail('stop_unconfirmed');
      if (starting) await starting;
      owned();
      try { fs.unlinkSync(lease); fs.closeSync(fd); }
      catch { fail('controller_release_failed'); }
      disposed = true;
    })();
    return disposing.finally(() => { disposing = null; });
  }

  return Object.freeze({ reconnect, pause, status, dispose });
}
