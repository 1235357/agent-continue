import { validSetupReceipt } from './setup-handoff.js';

const TYPES = Object.freeze(Object.fromEntries(['BEGIN', 'OBSERVE', 'CONNECT', 'CANCEL']
  .map(name => [name, `WINDOWS_INSTALLATION_${name}_V1`])));
const validId = value => typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const validExtension = value => typeof value === 'string' && value.length === 32 && /^[a-p]{32}$/.test(value);
const eligible = value => value?.os === 'windows' && value.scope === 'administrator' &&
  value.consent === true && validExtension(value.extensionId);
const UNKNOWN = Symbol('unconfirmed');

export function administratorSetupCommand(extensionId, shell, setupId = undefined) {
  if (!validExtension(extensionId) || (setupId !== undefined && !validId(setupId))) return '';
  if (shell === 'browserPowerShell') return `.\\install.ps1 -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId '${extensionId}'` +
    (setupId === undefined ? '' : ` -BrowserSetupId ${setupId}`);
  if (shell === 'browserCmd') return `install.cmd guided-administrator ${extensionId}` +
    (setupId === undefined ? '' : ` ${setupId}`);
  return '';
}

// Intent exists only in this document. Even an unknown Begin/clipboard/Connect
// result consumes this page's attempt; a repeat click must never mint a new ID.
export function createSetupClient({ api = globalThis.chrome, getContext, permissionGranted = () => false,
  clipboard = globalThis.navigator?.clipboard, crypto = globalThis.crypto, page = globalThis,
  timers = globalThis, now = () => performance.now(), maxMs = 900000, callTimeoutMs = 5000,
  connectTimeoutMs = 120000,
  onChange = () => {} } = {}) {
  if (typeof getContext !== 'function' || !Number.isFinite(maxMs) || maxMs < 1000 || maxMs > 900000 ||
      !Number.isFinite(callTimeoutMs) || callTimeoutMs < 1 || callTimeoutMs > 10000 ||
      !Number.isFinite(connectTimeoutMs) || connectTimeoutMs < 1 || connectTimeoutMs > 120000) throw new Error('invalid_setup_client');
  let attempt = null, closed = false;
  let view = Object.freeze({ state: 'idle', setupId: null, extensionId: null, shell: null, command: '', copied: false });
  const getState = () => view;
  function publish(state, extra = {}) {
    view = Object.freeze({ ...view, ...extra, state });
    try { onChange(view); } catch { /* Rendering cannot authorize or replay an operation. */ }
  }
  function cancelWorker() {
    if (!attempt?.beginSent || attempt.cancelSent) return;
    attempt.cancelSent = true;
    try { Promise.resolve(api.runtime.sendMessage({ type: TYPES.CANCEL, setupId: attempt.setupId })).catch(() => {}); }
    catch { /* Best effort only; worker document/permit/expiry checks still apply. */ }
  }
  function finish(state, cancel = !attempt?.connectSent) {
    if (!attempt || attempt.terminal) return;
    attempt.terminal = true;
    timers.clearTimeout(attempt.poll);
    timers.clearTimeout(attempt.deadlineTimer);
    for (const release of [...attempt.waiters]) release(UNKNOWN);
    if (cancel) cancelWorker();
    publish(state);
  }
  function cancel() {
    if (!attempt) return;
    if (!attempt.terminal) finish('cancelled', true);
    else { cancelWorker(); publish('cancelled'); }
  }
  function current() {
    if (!attempt || attempt.terminal) return false;
    let value;
    try { value = getContext(); } catch { cancel(); return false; }
    if (closed || !eligible(value) || value.epoch !== attempt.context.epoch ||
        value.extensionId !== attempt.context.extensionId) { cancel(); return false; }
    const at = now();
    if (!Number.isFinite(at) || at < attempt.started || at >= attempt.deadline) { finish('unconfirmed'); return false; }
    return true;
  }
  function bounded(work, budgetMs = callTimeoutMs) {
    if (!current()) return Promise.resolve(UNKNOWN);
    return new Promise(resolve => {
      let timer, done = false;
      const release = value => {
        if (done) return;
        done = true; timers.clearTimeout(timer); attempt.waiters.delete(release); resolve(value);
      };
      attempt.waiters.add(release);
      timer = timers.setTimeout(() => release(UNKNOWN), Math.min(budgetMs, attempt.deadline - now()));
      try { Promise.resolve(work()).then(release, () => release(UNKNOWN)); }
      catch { release(UNKNOWN); }
    });
  }
  const message = type => bounded(() => api.runtime.sendMessage({ type, setupId: attempt.setupId }),
    type === TYPES.CONNECT ? connectTimeoutMs : callTimeoutMs);
  const matching = value => value && value !== UNKNOWN && value.setupId === attempt.setupId;
  async function permitted() {
    const granted = await bounded(() => api.permissions.contains({ permissions: ['nativeMessaging'] }));
    if (!current()) return false;
    if (granted !== true) { cancel(); return false; }
    return true;
  }
  async function observe() {
    if (!current() || !await permitted() || !current()) return;
    const value = await message(TYPES.OBSERVE);
    if (!current()) return;
    if (!matching(value)) { finish('unconfirmed'); return; }
    if (value.state === 'cancelled' || value.state === 'expired') { finish('cancelled'); return; }
    if (value.state === 'waiting') {
      const delay = [1000, 2500, 5000, 10000, 20000][Math.min(attempt.reads++, 4)];
      attempt.poll = timers.setTimeout(() => { void observe(); }, Math.min(delay, attempt.deadline - now()));
      return;
    }
    if (value.state !== 'installed' || !validSetupReceipt(value.receipt, attempt.setupId) ||
        value.receipt.state !== 'installed') { finish('unconfirmed'); return; }
    if (!await permitted() || !current() || attempt.connectSent) return;
    attempt.connectSent = true;
    publish('connecting');
    const connected = await message(TYPES.CONNECT);
    if (!current()) return;
    if (!matching(connected)) { finish('unconfirmed'); return; }
    // A worker submission is an operation request, never a readiness observation.
    finish(connected.state === 'submitted' ? 'requested' :
      connected.state === 'cancelled' || connected.state === 'expired' ? 'cancelled' : 'unconfirmed',
    false);
  }
  async function prepare(authorization) {
    const authorized = await authorization;
    if (!current()) return;
    if (authorized !== true) { finish('permission-denied'); return; }
    const granted = await bounded(() => api.permissions.contains({ permissions: ['nativeMessaging'] }));
    if (!current()) return;
    if (granted !== true) { finish('permission-denied'); return; }
    let begun = UNKNOWN;
    if (typeof api?.runtime?.sendMessage === 'function') {
      attempt.beginSent = true;
      begun = await message(TYPES.BEGIN);
    }
    if (!current()) return;
    if (matching(begun) && (begun.state === 'cancelled' || begun.state === 'expired')) { finish('cancelled'); return; }
    // Waiting alone is the old source-only contract, not permission to continue.
    const automatic = matching(begun) && begun.state === 'waiting' && begun.automaticConnect === true;
    const fallback = matching(begun) && begun.state === 'waiting' ? 'manual' : 'unconfirmed';
    const command = administratorSetupCommand(attempt.context.extensionId, attempt.shell,
      automatic ? attempt.setupId : undefined);
    publish('preparing', { command });
    const copied = await bounded(() => clipboard.writeText(command).then(() => true));
    if (!current()) return;
    if (copied !== true) { finish('copy-failed'); return; }
    publish(automatic ? 'waiting' : fallback, { copied: true });
    if (!automatic) { finish(fallback); return; }
    await observe();
  }
  function copy(event, shell) {
    if (attempt) return attempt.work ?? Promise.resolve(view);
    let context;
    try { context = getContext(); } catch { return Promise.resolve(view); }
    if (closed || event?.isTrusted !== true || !eligible(context) ||
        !administratorSetupCommand(context.extensionId, shell)) return Promise.resolve(view);
    const started = now();
    if (!Number.isFinite(started)) return Promise.resolve(view);
    attempt = { context: { ...context }, shell, started, deadline: started + maxMs, waiters: new Set(),
      terminal: false, beginSent: false, connectSent: false, cancelSent: false, reads: 0 };
    publish('preparing', { shell, extensionId: context.extensionId });
    attempt.deadlineTimer = timers.setTimeout(() => finish('unconfirmed'), maxMs);
    // Invoke the browser UI request before the first await, preserving the Copy gesture.
    // Human approval uses the original setup deadline, not the short IPC budget.
    const authorization = bounded(() => permissionGranted() === true ? true :
      api.permissions.request({ permissions: ['nativeMessaging'] }), maxMs);
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      attempt.setupId = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      if (!validId(attempt.setupId)) throw new Error('invalid_setup_id');
      publish('preparing', { setupId: attempt.setupId });
    } catch { finish('unconfirmed'); return Promise.resolve(view); }
    attempt.work = prepare(authorization).catch(() => { if (current()) finish('unconfirmed'); });
    return attempt.work;
  }
  page?.addEventListener?.('pagehide', () => { closed = true; cancel(); });
  api?.permissions?.onRemoved?.addListener(change => {
    if (change?.permissions?.includes('nativeMessaging')) cancel();
  });
  return Object.freeze({ copy, cancel, getState });
}
