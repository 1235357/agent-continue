import { ADMIN_BROWSER_HOST, administratorDevicesSender } from './admin-browser.js';

export const ADMIN_CONTROL_SUPPORT = 'WINDOWS_ADMINISTRATOR_CONTROL_SUPPORT_V1';
export const ADMIN_CONTROL = 'WINDOWS_ADMINISTRATOR_CONTROL_V1';
export const ADMIN_CONTROL_STATUS = 'WINDOWS_ADMINISTRATOR_CONTROL_STATUS_V1';
export const ADMIN_CONTROL_FENCE = 'WINDOWS_ADMINISTRATOR_CONTROL_FENCE_V1';
export const ADMIN_CONTROL_RECONCILE = 'WINDOWS_ADMINISTRATOR_CONTROL_RECONCILE_V1';
export const ADMIN_CONTROL_JOURNAL = 'windowsAdministratorControlJournalV1';
export const ADMIN_CONTROL_ARCHIVE = 'windowsAdministratorControlArchiveV1';
export const ADMIN_CONTROL_SETUP = 'windowsAdministratorSetupAdmissionV1:';
export const ADMIN_CONTROL_SETUP_INSTALLATION = 'windowsAdministratorSetupInstallationV1';
export const ADMIN_CONTROL_ALARM = 'agent-continue-administrator-control-readback';
export const ADMIN_CONTROL_MESSAGES = Object.freeze([
  ADMIN_CONTROL_SUPPORT, ADMIN_CONTROL, ADMIN_CONTROL_STATUS, ADMIN_CONTROL_FENCE, ADMIN_CONTROL_RECONCILE,
]);
const kinds = ['connect', 'resume-saved', 'revoke'];
const outcomes = ['requested', 'cancelled', 'unconfirmed'];
const states = ['unconfirmed', 'reserved', 'intent-saved', 'launch-requested', 'launch-unconfirmed',
  'revocation-recorded', 'stopped', 'superseded', 'rejected', 'fenced', 'abandoned', 'recovered-paused'];
const terminal = ['launch-requested', 'revocation-recorded', 'stopped', 'superseded', 'rejected',
  'fenced', 'abandoned', 'recovered-paused'];
const phases = ['verifying-full', 'verifying-control', 'waiting-owner', 'waiting-stop', 'settled'];
const ownerStates = ['unobserved', 'paused', 'running', 'revoked'];
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hex = (v, n) => typeof v === 'string' && v.length === n && /^[a-f0-9]+$/.test(v);
const validTarget = v => typeof v === 'string' && [37, 65].includes(v.length) &&
  /^[a-f0-9]{32}:(?:[a-f0-9]{32}|idle)$/.test(v);
const same = (a, b) => a.bundleSha256 === b.bundleSha256 && a.operationId === b.operationId && a.control === b.control;
const recoverable = (record, action) => record && (!terminal.includes(record.state) ||
  action === 'control-reconcile' && record.control === 'revoke' && record.state === 'revocation-recorded');
const validIdentity = v => hex(v.bundleSha256, 64) && hex(v.operationId, 32) && kinds.includes(v.control);
const validState = (state, control) => states.includes(state) &&
  (control === 'revoke' ? !['intent-saved', 'launch-requested', 'launch-unconfirmed', 'recovered-paused'].includes(state) :
    !['revocation-recorded', 'stopped'].includes(state));
const validSetup = value => exact(value, ['setupId', 'bundleSha256', 'target']) &&
  hex(value.setupId, 32) && hex(value.bundleSha256, 64) && validTarget(value.target);
const validAssociation = (value, setup) => exact(value,
  ['version', 'setupId', 'bundleSha256', 'operationId', 'target']) && value.version === 1 &&
  hex(value.setupId, 32) && hex(value.bundleSha256, 64) && hex(value.operationId, 32) && validTarget(value.target) &&
  value.setupId === setup.setupId && value.bundleSha256 === setup.bundleSha256 && value.target === setup.target;
const snapshot = value => JSON.stringify([value.bundleSha256, value.operationId, value.control, value.target,
  value.createdAt, value.outcome, value.state, value.progress &&
  [value.progress.phase, value.progress.verifiedFiles, value.progress.totalFiles]]);

export function administratorControlProgress(value) {
  if (value === null) return null;
  if (!exact(value, ['phase', 'verifiedFiles', 'totalFiles']) || !phases.includes(value.phase)) return undefined;
  const { verifiedFiles: done, totalFiles: total } = value;
  if (done === null && total === null) return value;
  return value.phase === 'verifying-full' && Number.isSafeInteger(done) && Number.isSafeInteger(total) &&
    done >= 0 && total >= done ? value : undefined;
}

export function administratorControlSupport(value, control) {
  if (!kinds.includes(control) || !exact(value,
    ['control', 'state', 'bundleSha256', 'target', 'ownerState', 'eligible']) ||
    value.control !== control || !ownerStates.includes(value.ownerState) || typeof value.eligible !== 'boolean') return null;
  if (value.state === 'unconfirmed') return value.bundleSha256 === null && value.target === null &&
    value.eligible === false && value.ownerState === 'unobserved' ? value : null;
  if (value.state !== 'supported' || !hex(value.bundleSha256, 64)) return null;
  if (control === 'revoke') return value.target === null ? value : null;
  if (!value.eligible) return value.target === null ? value : null;
  if (control === 'resume-saved' ? value.ownerState !== 'running' :
    !['paused', 'running'].includes(value.ownerState)) return null;
  return validTarget(value.target) ? value : null;
}

export function administratorControlStatus(value, expected) {
  return exact(value, ['bundleSha256', 'operationId', 'control', 'state', 'progress']) && validIdentity(value) &&
    (!expected || same(value, expected)) && validState(value.state, value.control) &&
    administratorControlProgress(value.progress) !== undefined ? value : null;
}

export function administratorControlRecord(value) {
  return exact(value, ['bundleSha256', 'operationId', 'control', 'target', 'outcome', 'state', 'progress', 'createdAt']) &&
    validIdentity(value) && (value.control === 'revoke' ? value.target === null : validTarget(value.target)) &&
    outcomes.includes(value.outcome) && validState(value.state, value.control) &&
    administratorControlProgress(value.progress) !== undefined && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 ? value : null;
}

export function administratorControlJournal(value) {
  if (value === undefined) return { version: 1, operations: [] };
  if (!exact(value, ['version', 'operations']) || value.version !== 1 || !Array.isArray(value.operations) ||
      value.operations.length > 256) return null;
  const ids = new Set();
  for (const record of value.operations) {
    if (!administratorControlRecord(record)) return null;
    const id = record.bundleSha256 + ':' + record.operationId;
    if (ids.has(id)) return null;
    ids.add(id);
  }
  return value;
}

export function bindAdministratorControls(api, { now = Date.now, timers = globalThis, prepareObserver = null } = {}) {
  const { runtime, permissions, storage, alarms } = api;
  if (api.extension?.inIncognitoContext || !runtime?.sendNativeMessage || !runtime?.getPlatformInfo ||
      !permissions?.contains || !storage?.local?.get || !storage.local.set) return null;
  let queue = Promise.resolve(), epoch = 0, startupEpoch = 0, disposed = false, timer, observing;
  const submitted = new Map();
  const reads = new Map();
  const background = fn => { void Promise.resolve().then(fn).catch(() => undefined); };
  const serial = fn => { const work = queue.then(fn, fn); queue = work.catch(() => undefined); return work; };
  const permitted = async (admit = () => true) => !disposed && admit() &&
    (await runtime.getPlatformInfo()).os === 'win' && !disposed && admit() &&
    await permissions.contains({ permissions: ['nativeMessaging'] }) && !disposed && admit();
  const senderAllowed = sender => administratorDevicesSender(runtime, sender);
  async function readJournal() {
    return administratorControlJournal((await storage.local.get(ADMIN_CONTROL_JOURNAL))[ADMIN_CONTROL_JOURNAL]);
  }
  async function persist(journal) {
    if (!administratorControlJournal(journal)) throw new Error('invalid_administrator_control_journal');
    await storage.local.set({ [ADMIN_CONTROL_JOURNAL]: journal });
  }
  const archiveKey = record => ADMIN_CONTROL_ARCHIVE + ':' + record.bundleSha256 + ':' + record.operationId;
  async function archivedRecord(identity) {
    const key = archiveKey(identity);
    const value = (await storage.local.get(key))[key];
    return administratorControlRecord(value) && same(value, identity) && terminal.includes(value.state) ? value : null;
  }
  async function setupAdmission(setup, admit) {
    if (!admit()) return null;
    const key = ADMIN_CONTROL_SETUP + setup.setupId;
    const values = await storage.local.get([ADMIN_CONTROL_JOURNAL, key]);
    if (!admit()) return null;
    const journal = administratorControlJournal(values[ADMIN_CONTROL_JOURNAL]);
    if (!journal) return null;
    const saved = values[key];
    if (saved === undefined) return { journal };
    if (!validAssociation(saved, setup)) return null;
    const identity = { bundleSha256: saved.bundleSha256, operationId: saved.operationId, control: 'connect' };
    const record = journal.operations.find(r => r.bundleSha256 === saved.bundleSha256 && r.operationId === saved.operationId) ??
      await archivedRecord(identity);
    if (!admit() || !record || !same(record, identity) || record.target !== saved.target) return null;
    return { journal, record };
  }
  async function archiveTerminal(journal, admit = () => true) {
    const index = journal.operations.findIndex(record => terminal.includes(record.state));
    if (index < 0) return false;
    const record = journal.operations[index], key = archiveKey(record);
    const saved = (await storage.local.get(key))[key];
    if (!admit()) return false;
    if (saved !== undefined && (!administratorControlRecord(saved) || !terminal.includes(saved.state) ||
        !same(saved, record) || saved.target !== record.target || saved.createdAt !== record.createdAt ||
        saved.state !== record.state && !(saved.state === 'revocation-recorded' && record.state === 'stopped'))) return false;
    // Archive and verify first. A crash before the active-journal commit leaves a harmless duplicate.
    // A duplicate may receive a legal terminal refinement before migration resumes.
    if (saved === undefined || snapshot(saved) !== snapshot(record)) await storage.local.set({ [key]: record });
    if (!admit()) return false;
    const checked = await archivedRecord(record);
    if (!admit() || !checked || snapshot(checked) !== snapshot(record)) return false;
    journal.operations.splice(index, 1);
    return true;
  }
  async function native(action, fields, started, admit = () => true, dispatchGuard = null) {
    const id = crypto.randomUUID();
    let deadline, expired = false;
    const current = () => !expired && !disposed && epoch === started && admit();
    try {
      // One native-call budget covers both permission checks; caller receipt admission stays separate.
      const timeout = new Promise(resolve => { deadline = timers.setTimeout(() => { expired = true; resolve(null); },
        action === 'control' || action === 'control-fence' || action === 'control-reconcile' ? 30000 :
          action === 'control-support' ? 25000 : 4500); deadline?.unref?.(); });
      if (!current() || !await Promise.race([permitted(current), timeout]) || !current()) return null;
      const send = () => runtime.sendNativeMessage(ADMIN_BROWSER_HOST, { version: 1, action, id, ...fields });
      const reply = await Promise.race([
        dispatchGuard ? dispatchGuard(send, current, timeout).then(sent => sent?.reply ?? null) : send(),
        timeout,
      ]);
      if (!current() || !await Promise.race([permitted(current), timeout]) || !current() ||
          reply?.version !== 1 || reply.action !== action || reply.id !== id) return null;
      const { version, action: ignoredAction, id: ignoredId, ...body } = reply;
      if (action === 'control-support') return administratorControlSupport(body, fields.control);
      if (action === 'control-status') return administratorControlStatus(body, fields);
      return exact(body, ['bundleSha256', 'operationId', 'control', 'outcome']) && validIdentity(body) &&
        same(body, fields) && outcomes.includes(body.outcome) ? body : null;
    } catch { return null; }
    finally { expired = true; timers.clearTimeout(deadline); }
  }
  function stopObservation() {
    timers.clearTimeout(timer); timer = undefined;
    background(() => alarms?.clear?.(ADMIN_CONTROL_ALARM));
  }
  function schedule(records) {
    timers.clearTimeout(timer); timer = undefined;
    if (disposed) return;
    const pending = records.filter(r => !terminal.includes(r.state) && now() >= r.createdAt && now() - r.createdAt < 600000);
    if (!pending.length) { background(() => alarms?.clear?.(ADMIN_CONTROL_ALARM)); return; }
    const delay = pending.some(r => now() - r.createdAt < 30000) ? 2000 : 5000;
    // The alarm is a coarse worker-restart fallback, not a two-second scheduling guarantee.
    background(() => alarms?.create?.(ADMIN_CONTROL_ALARM, { when: now() + 30000 }));
    timer = timers.setTimeout(() => { timer = undefined; void observePending(); }, delay);
    timer?.unref?.();
  }
  async function observeOnce(record, started) {
    const result = await native('control-status', { bundleSha256: record.bundleSha256,
      operationId: record.operationId, control: record.control }, started);
    if (!result) return null;
    await serial(async () => {
      if (disposed || started !== epoch) return;
      const journal = await readJournal();
      const existing = journal?.operations.find(r => same(r, record));
      const refinesRevocation = existing?.state === 'revocation-recorded' && result.state === 'stopped';
      if (!existing || terminal.includes(existing.state) && result.state !== existing.state && !refinesRevocation ||
          result.state === 'unconfirmed') return;
      Object.assign(existing, { state: result.state, progress: result.progress });
      await persist(journal);
    });
    return result;
  }
  function observe(record, started) {
    const key = record.bundleSha256 + ':' + record.operationId + ':' + started;
    if (!reads.has(key)) {
      const work = observeOnce(record, started).finally(() => { reads.delete(key); });
      reads.set(key, work);
    }
    return reads.get(key);
  }
  function observePending() {
    if (observing) {
      if (observing.epoch !== epoch) observing.rerun = true;
      return observing.work;
    }
    const started = epoch;
    const run = { epoch: started, rerun: false };
    run.work = Promise.resolve().then(async () => {
      if (!await permitted() || started !== epoch) return;
      const journal = await readJournal();
      if (!journal) return;
      for (const record of journal.operations) {
        if (started !== epoch || disposed) return;
        if (!terminal.includes(record.state) && now() >= record.createdAt && now() - record.createdAt < 600000) {
          await observe(record, started);
        }
      }
      if (started === epoch && !disposed) schedule((await readJournal())?.operations ?? []);
    }).catch(() => undefined).finally(() => {
      if (observing === run) observing = null;
      if (run.rerun && !disposed) void observePending();
    });
    observing = run;
    return run.work;
  }
  async function submit(message, setup = null, admit = () => true) {
    const control = message.control;
    const keys = control === 'revoke' ? ['type', 'bundleSha256', 'control'] : ['type', 'bundleSha256', 'control', 'target'];
    if (!exact(message, keys) || !kinds.includes(control) || !hex(message.bundleSha256, 64) ||
        control !== 'revoke' && !validTarget(message.target)) return null;
    // A validated Revoke intent cancels earlier startup preparation before any await.
    if (control === 'revoke') startupEpoch++;
    const startup = startupEpoch;
    const started = epoch;
    const startupCurrent = () => !disposed && started === epoch &&
      (control === 'revoke' || startup === startupEpoch) && admit();
    if (setup) {
      // Duplicate lookup shares the journal queue and precedes even read-only native support.
      const previous = await serial(() => setupAdmission(setup, startupCurrent));
      if (!startupCurrent() || started !== epoch || !previous) return null;
      if (previous.record) return previous.record;
    }
    if (!await permitted(startupCurrent) || started !== epoch || !startupCurrent()) return null;
    // Revoke reduces authority for a fixed installation; its high adapter verifies identity, not fresh liveness.
    const support = control === 'revoke' ? { bundleSha256: message.bundleSha256 } :
      await native('control-support', { control }, started, startupCurrent);
    const supported = support && (control === 'revoke' || support.state === 'supported' && support.eligible &&
      support.bundleSha256 === message.bundleSha256 && support.target === message.target);
    if (!startupCurrent() || started !== epoch || !setup && !supported) return null;
    if (!setup && control !== 'revoke') {
      // The host may have been absent when this browser worker first loaded.
      // A manual startup needs a live observer, not another startup-wake request.
      if (typeof prepareObserver !== 'function' || await prepareObserver(startupCurrent) !== true ||
          !startupCurrent() || started !== epoch) return null;
    }
    const reserved = await serial(async () => {
      if (!await permitted(startupCurrent) || started !== epoch || !startupCurrent()) return null;
      const admission = setup ? await setupAdmission(setup, startupCurrent) : { journal: await readJournal() };
      if (!admission || !startupCurrent() || started !== epoch) return null;
      const { journal } = admission;
      if (!journal) return null;
      if (admission.record) return { record: admission.record, dispatch: false };
      if (!supported) return null;
      const previousRevoke = control === 'revoke' && journal.operations.find(r => r.control === 'revoke' &&
        r.bundleSha256 === support.bundleSha256 && !terminal.includes(r.state));
      if (previousRevoke) return { record: previousRevoke, dispatch: false };
      if (control !== 'revoke' && journal.operations.some(r => !terminal.includes(r.state))) return null;
      if (journal.operations.length >= 256 && !await archiveTerminal(journal, startupCurrent)) return null;
      if (!await permitted(startupCurrent) || started !== epoch || !startupCurrent()) return null;
      const operationId = crypto.randomUUID().replaceAll('-', '');
      const pending = { bundleSha256: support.bundleSha256, operationId, control,
        target: control === 'revoke' ? null : message.target, outcome: 'unconfirmed', state: 'unconfirmed',
        progress: null, createdAt: now() };
      if (!administratorControlRecord(pending) || journal.operations.some(r => r.bundleSha256 === pending.bundleSha256 &&
          r.operationId === pending.operationId)) return null;
      journal.operations.push(pending);
      if (setup) {
        const key = ADMIN_CONTROL_SETUP + setup.setupId;
        const association = { version: 1, ...setup, operationId };
        // One commit binds the setup to the original ID. Uncertain writes/readbacks never dispatch.
        try {
          const installation = { version: 1, setupId: setup.setupId, bundleSha256: setup.bundleSha256 };
          await storage.local.set({ [ADMIN_CONTROL_JOURNAL]: journal, [key]: association,
            [ADMIN_CONTROL_SETUP_INSTALLATION]: installation });
          if (!startupCurrent() || started !== epoch) return { record: pending, dispatch: false };
          const checked = await storage.local.get([ADMIN_CONTROL_JOURNAL, key, ADMIN_CONTROL_SETUP_INSTALLATION]);
          if (!startupCurrent() || started !== epoch) return { record: pending, dispatch: false };
          const checkedJournal = administratorControlJournal(checked[ADMIN_CONTROL_JOURNAL]);
          if (!exact(checked[ADMIN_CONTROL_SETUP_INSTALLATION], ['version', 'setupId', 'bundleSha256']) ||
              checked[ADMIN_CONTROL_SETUP_INSTALLATION].version !== 1 ||
              checked[ADMIN_CONTROL_SETUP_INSTALLATION].setupId !== setup.setupId ||
              checked[ADMIN_CONTROL_SETUP_INSTALLATION].bundleSha256 !== setup.bundleSha256 ||
              !validAssociation(checked[key], setup) || checked[key].operationId !== operationId || !checkedJournal ||
              checkedJournal.operations.length !== journal.operations.length ||
              checkedJournal.operations.some((r, i) => snapshot(r) !== snapshot(journal.operations[i]))) {
            return { record: pending, dispatch: false };
          }
        } catch { return { record: pending, dispatch: false }; }
      } else await persist(journal);
      return { record: pending, dispatch: true };
    });
    if (!reserved) return null;
    const { record } = reserved;
    if (!reserved.dispatch) return record;
    try {
      // A stored ID survives every uncertain return, including permission removal before dispatch.
      if (!await permitted(startupCurrent) || started !== epoch || !startupCurrent()) return record;
      const fields = { bundleSha256: record.bundleSha256, operationId: record.operationId, control };
      if (control !== 'revoke') fields.target = record.target;
      const work = native('control', fields, started, startupCurrent);
      submitted.set(record.operationId, work);
      schedule([record]);
      const reply = await work;
      submitted.delete(record.operationId);
      if (!startupCurrent() || started !== epoch) return record;
      await serial(async () => {
        if (started !== epoch || !startupCurrent()) return;
        const journal = await readJournal();
        if (started !== epoch || !startupCurrent()) return;
        const existing = journal?.operations.find(r => same(r, record));
        if (existing && reply) { existing.outcome = reply.outcome; await persist(journal); }
        if (started !== epoch || !startupCurrent()) return;
        if (journal) schedule(journal.operations);
      });
      if (started !== epoch || !startupCurrent()) return record;
      const stored = (await readJournal())?.operations.find(r => same(r, record));
      return startupCurrent() && started === epoch ? stored ?? record : record;
    } catch (error) {
      if (setup) return record;
      throw error;
    }
  }
  async function receipt(message, action) {
    if (!exact(message, ['type', 'bundleSha256', 'operationId', 'control']) || !validIdentity(message)) return null;
    const started = epoch;
    if (!await permitted() || started !== epoch) return null;
    const journal = await readJournal();
    const activeRecord = journal?.operations.find(r => same(r, message));
    const record = activeRecord ?? (journal && await archivedRecord(message));
    if (!record) return null;
    if (action === 'control-status') return observe(record, started);
    // Revocation releases the startup slot, but same-ID reconciliation may still verify stop.
    if (!recoverable(activeRecord, action) || submitted.has(record.operationId)) return null;
    // Reconciliation and fencing are explicit requests for this ID, never control resubmission.
    const key = record.operationId;
    if (submitted.has(key)) return null;
    const fields = { bundleSha256: record.bundleSha256, operationId: record.operationId, control: record.control };
    const dispatchGuard = (send, current, timeout) => serial(async () => {
      if (!current()) return null;
      const latest = await Promise.race([readJournal(), timeout]);
      const active = latest?.operations.find(r => same(r, fields));
      if (!current() || !recoverable(active, action)) return null;
      // Keep check and dispatch ordered with journal commits, but never await native work in this queue.
      return { reply: send() };
    });
    const work = native(action, fields, started, () => true, dispatchGuard);
    submitted.set(key, work);
    try { return await work; }
    finally { submitted.delete(key); void observePending(); }
  }
  permissions.onRemoved?.addListener?.(change => {
    if (!change?.permissions?.includes('nativeMessaging')) return;
    epoch++; stopObservation();
  });
  permissions.onAdded?.addListener?.(change => {
    if (change?.permissions?.includes('nativeMessaging')) void observePending();
  });
  alarms?.onAlarm?.addListener?.(alarm => { if (alarm?.name === ADMIN_CONTROL_ALARM) void observePending(); });
  runtime.onStartup?.addListener?.(() => { void observePending(); });
  void observePending();
  return Object.freeze({
    // Denial only. Already-dispatched native operations still require their exact receipt/Pause.
    cancelPendingStartup() { startupEpoch++; },
    captureStartupPermit() {
      const startup = startupEpoch, transport = epoch;
      return () => !disposed && startup === startupEpoch && transport === epoch;
    },
    async connectFromSetup(setup, admit) {
      if (!validSetup(setup) || typeof admit !== 'function') return null;
      const original = { ...setup };
      return submit({ type: ADMIN_CONTROL, control: 'connect', bundleSha256: original.bundleSha256,
        target: original.target }, original, admit).catch(() => null);
    },
    async handleMessage(message, sender) {
      if (!senderAllowed(sender)) return null;
      if (message?.type === ADMIN_CONTROL_SUPPORT) {
        if (!exact(message, ['type', 'control']) || !kinds.includes(message.control)) return null;
        const started = epoch;
        return await permitted() && started === epoch ? native('control-support', { control: message.control }, started) : null;
      }
      if (message?.type === ADMIN_CONTROL) return submit(message).catch(() => null);
      const action = { [ADMIN_CONTROL_STATUS]: 'control-status', [ADMIN_CONTROL_FENCE]: 'control-fence',
        [ADMIN_CONTROL_RECONCILE]: 'control-reconcile' }[message?.type];
      return action ? receipt(message, action).catch(() => null) : null;
    },
    dispose() { disposed = true; epoch++; stopObservation(); },
  });
}
