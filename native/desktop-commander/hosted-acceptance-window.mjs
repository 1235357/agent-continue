import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stopped = state => state?.paused === true && state.ready === false && state.runtime === 'stopped';

// Maintainer acceptance only. The owner supplies an already verified controller.
export async function runHostedAcceptanceWindow(controller, { windowMs, pollMs = 250, shouldStop, onReady }) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 900000 ||
      !Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 1000 ||
      typeof shouldStop !== 'function' || typeof onReady !== 'function') throw new Error('invalid_acceptance_window');
  if (!stopped(await controller.status())) throw new Error('acceptance_requires_paused_owner');

  let outcome = 'stop-requested', wasReady = false;
  const deadline = performance.now() + windowMs;
  const cancelWait = new AbortController();
  const waitForEnd = async () => {
    while (!cancelWait.signal.aborted) {
      if (shouldStop()) return { outcome: 'stop-requested' };
      const remaining = deadline - performance.now();
      if (remaining <= 0) return { outcome: 'window-expired' };
      try { await delay(Math.min(remaining, pollMs), undefined, { signal: cancelWait.signal }); }
      catch (error) { if (!cancelWait.signal.aborted) throw error; }
    }
    return { outcome: 'stop-requested' };
  };
  try {
    if (!shouldStop()) {
      const end = waitForEnd();
      const started = Promise.resolve().then(async () => {
        if (shouldStop()) return { outcome: 'stop-requested' };
        if (performance.now() >= deadline) return { outcome: 'window-expired' };
        return { state: await controller.reconnect() };
      });
      const first = await Promise.race([started, end]);
      if (first.outcome) {
        outcome = first.outcome;
      } else if (first.state?.ready !== true || first.state.paused !== false || first.state.runtime !== 'running') {
        outcome = 'start-unconfirmed';
      } else {
        wasReady = true;
        if (!shouldStop() && performance.now() < deadline) onReady();
        outcome = (await end).outcome;
      }
    }
  } catch {
    outcome = 'acceptance-error';
  } finally {
    cancelWait.abort();
    // Never release an uncertain lease or claim that a failed stop was clean.
    try {
      if (!stopped(await controller.pause())) throw new Error('stop');
      await controller.dispose();
    } catch { throw new Error('acceptance_stop_unconfirmed'); }
  }
  return { outcome, wasReady, paused: true, controllerReleased: true };
}

// Called only from the digest-pinned Windows stager, before installing the
// candidate's module fence. The tunnel child gets only the original clean env.
export async function runProtectedHostedWindow({ bundle, receiptId, windowMs, guarded = false }, write) {
  if (!path.isAbsolute(bundle) || !/^[a-f0-9]{32}$/.test(receiptId) ||
      !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 900000 || typeof guarded !== 'boolean') throw new Error('invalid_acceptance_window');
  const root = bundle + '.state';
  const app = path.join(bundle, 'app');
  const env = { ...process.env };
  if (env.AC_ADMIN_BOOT_APP_ROOT !== app || process.cwd() !== path.join(root, 'work')) throw new Error('invalid_acceptance_environment');
  const stop = bundle + '.receipt-' + receiptId + '.stop';
  const shouldStop = () => fs.existsSync(stop);
  const profileFile = guarded ? path.join(root, 'work', 'acceptance-' + receiptId + '.profile.yaml') : path.join(bundle + '.secrets', 'tunnel.yaml');
  await import(pathToFileURL(path.join(root, 'startup-imports.mjs')).href);
  const { openController } = await import(pathToFileURL(path.join(app, 'lifecycle.mjs')).href);
  const controller = openController(root, {
    deferStartup: true, maxRestarts: 0,
    launch: () => ({ configured: true, command: path.join(bundle, 'client', 'tunnel-client-runtime.exe'),
      args: ['run', '--profile-file', profileFile], cwd: process.cwd(), env }),
  });
  return runHostedAcceptanceWindow(controller, { windowMs, shouldStop, onReady: () => write({ state: 'ready' }) });
}
