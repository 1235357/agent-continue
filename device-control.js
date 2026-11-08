import { BROWSER_DEVICE_MESSAGE } from './browser-wake.js';

export const HOST = 'com.agentcontinue.device_control';
export const PENDING_KEY = 'deviceControlPendingV1';
export const PRIORITY_PAUSE_KEY = 'deviceControlPriorityPauseV1';
export const REVISION_KEY = 'deviceControlRevisionV1';
const LOCK = 'agent-continue-device-control-v1';
const browserScope = ':browser-managed';
const validTarget = value => value === null || typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const actions = new Set(['status', 'disconnect-and-pause', 'reconnect']);
const mutations = new Set(['disconnect-and-pause', 'reconnect']);
const validID = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const exactKeys = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const validPending = (value, browserManaged) => exactKeys(value, ['version', 'id', 'action'], browserManaged ? ['ownerId'] : []) &&
  value.version === 1 && validID(value.id) && mutations.has(value.action) &&
  (!Object.hasOwn(value, 'ownerId') || validID(value.ownerId));

export function decodeResponse(value, id, action, target = null) {
  const invalid = () => { throw new Error('invalid_response'); };
  if (!validTarget(target) || !validID(id) || !actions.has(action) ||
      !exactKeys(value, ['version', 'id', 'action', 'ok', ...(target ? ['target'] : [])], ['state']) ||
      value.version !== (target ? 2 : 1) || target && value.target !== target ||
      value.id !== id || value.action !== action || typeof value.ok !== 'boolean') invalid();
  if (!value.ok) {
    if (Object.hasOwn(value, 'state')) invalid();
    return { kind: 'rejected' };
  }
  const s = value.state;
  if (!exactKeys(s, ['paused', 'connection'], ['operation']) || (s.paused !== null && typeof s.paused !== 'boolean') ||
      !['ready', 'disconnected', 'unknown'].includes(s.connection)) invalid();
  let operation;
  if (Object.hasOwn(s, 'operation')) {
    const op = s.operation;
    if (!exactKeys(op, ['id', 'action', 'status']) || !validID(op.id) || !mutations.has(op.action) ||
        !['in-progress', 'unknown-running', 'settled', 'not-executed', 'unknown'].includes(op.status)) invalid();
    operation = { id: op.id, action: op.action, status: op.status };
  }
  return { kind: 'observed', paused: s.paused, connection: s.connection, ...(operation ? { operation } : {}) };
}

export async function controlDevice(runtime, action, id = crypto.randomUUID(), timeoutMs = 15000, target = null) {
  if (!actions.has(action)) throw new Error('invalid_action');
  if (!validTarget(target) || !validID(id) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('invalid_request');
  let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => runtime.sendNativeMessage(HOST, target ? { version: 2, target, id, action } : { version: 1, id, action })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    try { return decodeResponse(response, id, action, target); }
    catch { return { kind: 'unavailable', reason: 'invalid-response' }; }
  } catch (error) {
    // Native errors can contain local paths. Return only these bounded codes.
    const reason = error?.message === 'Specified native messaging host not found.' ? 'host-absent' :
      error?.message === 'timeout' ? 'timeout' : 'transport';
    return { kind: 'unavailable', reason };
  } finally { clearTimeout(timer); }
}

async function browserControl(runtime, action, id, ownerId, timeoutMs) {
  const unavailable = { kind: 'unavailable', reason: 'transport' };
  let timer;
  try {
    const reply = await Promise.race([
      Promise.resolve().then(() => runtime.sendMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId,
        request: { version: 1, id, action } })),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (!exactKeys(reply, ['ownerId', 'response']) || !validID(reply.ownerId) ||
        (ownerId !== null && reply.ownerId !== ownerId)) return unavailable;
    try { return { ...decodeResponse(reply.response, id, action), ownerId: reply.ownerId }; }
    catch { return { kind: 'unavailable', reason: 'invalid-response' }; }
  } catch { return unavailable; }
  finally { clearTimeout(timer); }
}

export function deviceScope(target, browserManaged) {
  if (!validTarget(target) || typeof browserManaged !== 'boolean' || browserManaged && target !== null) throw new Error('invalid_request');
  return browserManaged ? browserScope : target ? ':' + target : '';
}

export function createDeviceController({ runtime, permissions, storage, locks, target = null, browserManaged = false,
  timeoutMs = 15000, onChange = () => {} }) {
  const scope = deviceScope(target, browserManaged);
  const pendingKey = PENDING_KEY + scope;
  const priorityKey = PRIORITY_PAUSE_KEY + scope;
  const revisionKey = REVISION_KEY + scope;
  const lock = LOCK + scope;
  const state = {
    target, initialized: false, permission: 'unknown', registration: 'unchecked', observation: null, observedAt: null,
    pending: null, priorityPause: null, ownerId: null, journalHealthy: false, statusBusy: false,
    mutationBusy: false, pauseBusy: false, requestingPermission: false,
    feedback: 'not-checked',
  };
  let sequence = 0, applied = 0, revision = null, observedRevision;
  let permissionRevision = 0, permissionEpoch = 0;
  const quarantines = { pending: null, priorityPause: null };
  const slots = browserManaged ? ['pending', 'priorityPause'] : ['pending'];
  const keyFor = slot => slot === 'priorityPause' ? priorityKey : pendingKey;
  const known = () => state.permission === 'granted' && state.registration === 'reachable' &&
    typeof state.observation?.paused === 'boolean' && (!browserManaged || validID(state.observation.ownerId));
  const eligible = () => state.initialized && known() && observedRevision === revision &&
    state.journalHealthy && !state.pending && !state.priorityPause && Boolean(locks?.request);
  const pauseEligible = () => browserManaged && state.initialized && state.permission === 'granted' &&
    state.journalHealthy && validID(state.ownerId) && Boolean(locks?.request) &&
    !state.priorityPause && state.pending?.action !== 'disconnect-and-pause';
  const getState = () => structuredClone({ ...state,
    canMutate: eligible() && !state.statusBusy && !state.mutationBusy && !state.pauseBusy && !state.requestingPermission,
    canPause: browserManaged ? pauseEligible() && !state.pauseBusy && !state.requestingPermission :
      eligible() && !state.statusBusy && !state.mutationBusy && !state.requestingPermission,
  });
  const notify = () => onChange(getState());
  const exclusive = callback => locks?.request ? locks.request(lock, callback) : callback();

  async function readPending() {
    try {
      const values = await storage.get([pendingKey, revisionKey, ...(browserManaged ? [priorityKey] : [])]);
      const storedRevision = values[revisionKey] ?? null;
      for (const slot of slots) {
        const value = values[keyFor(slot)];
        if (value != null && (!validPending(value, browserManaged) ||
            slot === 'priorityPause' && (value.action !== 'disconnect-and-pause' || !validID(value.ownerId)))) throw new Error('invalid_journal');
      }
      if (storedRevision !== null && (typeof storedRevision !== 'string' || storedRevision.length !== 36 ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(storedRevision))) throw new Error('invalid_journal');
      revision = storedRevision;
      for (const slot of slots) {
        const value = values[keyFor(slot)];
        let quarantinedPending = quarantines[slot];
        // A transition of the other browser slot does not settle this intent.
        const replacement = value && quarantinedPending &&
          (value.id !== quarantinedPending.pending.id || value.action !== quarantinedPending.pending.action ||
            value.ownerId !== quarantinedPending.pending.ownerId);
        if (quarantinedPending && ![quarantinedPending.before, quarantinedPending.attempt].includes(revision) &&
            (!browserManaged || replacement)) {
          quarantines[slot] = quarantinedPending = null;
        }
        if (browserManaged && quarantinedPending?.terminalProof) {
          // The exact terminal host receipt was validated before the failed
          // metadata clear. Preserve a replacement, never restore settled work.
          const pending = quarantinedPending.pending;
          state[slot] = value ? structuredClone(value) : null;
          observedRevision = undefined;
          if (value && value.id === pending.id && value.action === pending.action && value.ownerId === pending.ownerId) {
            await writePending(null, false, slot, true);
          }
          quarantines[slot] = null;
        } else if (quarantinedPending?.knownUnsent) {
          // Only source-known unsent metadata can retire without a host receipt.
          const pending = quarantinedPending.pending;
          state[slot] = value ? structuredClone(value) : null;
          observedRevision = undefined;
          if (value && value.id === pending.id && value.action === pending.action && value.ownerId === pending.ownerId) await writePending(null, true, slot);
          quarantines[slot] = null;
        } else if (quarantinedPending) {
          const pending = quarantinedPending.pending;
          state[slot] = pending;
          if (value && (value.id !== pending.id || value.action !== pending.action || value.ownerId !== pending.ownerId)) throw new Error('journal_conflict');
          if (!value) await writePending(pending, false, slot);
          quarantines[slot] = null;
        } else state[slot] = value ? structuredClone(value) : null;
      }
      const owners = new Set(slots.map(slot => state[slot]?.ownerId).filter(Boolean));
      if (owners.size > 1) throw new Error('journal_conflict');
      if (browserManaged && owners.size) state.ownerId = owners.values().next().value;
      state.journalHealthy = true;
    } catch { state.journalHealthy = false; }
  }
  async function writePending(value, knownUnsent = false, slot = 'pending', terminalProof = false) {
    // Failed writes may have committed. Unsent evidence is local to failed
    // admission; it is never persisted or inferred from a transport failure.
    const nextRevision = crypto.randomUUID();
    const pending = value || state[slot];
    quarantines[slot] = { pending, before: revision, attempt: nextRevision, knownUnsent,
      terminalProof: browserManaged && value === null && terminalProof === true };
    state[slot] = pending;
    try {
      // Fence old replies before changing the pending key. These are separate
      // awaited writes: no multi-key transaction or storage-event ordering assumed.
      await storage.set({ [revisionKey]: nextRevision });
      revision = nextRevision;
      await storage.set({ [keyFor(slot)]: value });
      state[slot] = value;
      quarantines[slot] = null;
    } catch { state.journalHealthy = false; throw new Error('journal_unavailable'); }
  }
  function applyPermission(permission) {
    if (state.permission !== permission) permissionEpoch++;
    state.permission = permission;
    if (permission !== 'granted') {
      state.observation = null;
      state.observedAt = null;
      state.registration = 'unchecked';
      state.ownerId = null;
      observedRevision = undefined;
    }
  }
  async function readPermission() {
    const current = ++permissionRevision;
    let permission;
    try { permission = await permissions.contains({ permissions: ['nativeMessaging'] }) ? 'granted' : 'absent'; }
    catch { permission = 'unknown'; }
    if (current !== permissionRevision) return false;
    applyPermission(permission);
    return state.permission === 'granted';
  }
  async function initialize() {
    try { await exclusive(readPending); }
    catch { state.journalHealthy = false; }
    await readPermission();
    state.initialized = true;
    notify();
  }
  async function refreshPending() {
    try { await exclusive(readPending); }
    catch { state.journalHealthy = false; }
    notify();
  }
  async function requestPermission(consented) {
    if (consented !== true || !state.initialized || state.pending || state.priorityPause || !state.journalHealthy ||
        state.requestingPermission || state.statusBusy || state.mutationBusy || state.pauseBusy) return;
    state.requestingPermission = true;
    const current = ++permissionRevision;
    try {
      // No await before request: preserve the explicit button's user gesture.
      const request = permissions.request({ permissions: ['nativeMessaging'] });
      notify();
      const granted = await request;
      if (current === permissionRevision) {
        applyPermission(granted ? 'granted' : 'absent');
        state.feedback = state.permission === 'granted' ? 'permission-granted' : 'permission-denied';
      }
    } catch {
      if (current === permissionRevision) { applyPermission('unknown'); state.feedback = 'permission-unavailable'; }
    }
    finally { state.requestingPermission = false; notify(); }
  }
  async function observe(result, id, action, order, requestRevision, requestPermissionEpoch) {
    await exclusive(async () => {
      if (order < applied) return;
      applied = order;
      await readPending();
      if (requestPermissionEpoch !== permissionEpoch || state.permission !== 'granted') {
        state.registration = 'unchecked';
        state.observation = null;
        state.observedAt = null;
        observedRevision = undefined;
        state.feedback = state.permission === 'granted' ? 'not-checked' : 'permission-required';
        return;
      }
      if (!state.journalHealthy || requestRevision !== revision) {
        state.registration = 'unchecked';
        state.observation = null;
        state.observedAt = null;
        observedRevision = undefined;
        state.feedback = !state.journalHealthy ? 'local-unavailable' : state.pending ? 'unconfirmed' : 'not-checked';
        return;
      }
      state.registration = result.kind === 'observed' || result.kind === 'rejected' ? 'reachable' :
        result.reason === 'host-absent' ? 'absent' : 'unknown';
      state.observation = result.kind === 'observed' ? result : null;
      if (browserManaged && result.kind === 'observed') state.ownerId = result.ownerId;
      state.observedAt = result.kind === 'observed' ? Date.now() : null;
      observedRevision = requestRevision;
      state.feedback = result.kind === 'observed' ? 'observed' : result.kind === 'rejected' ? 'rejected' : result.reason;
      if (!state.journalHealthy || result.kind !== 'observed') return;
      const op = result.operation;
      const matchingSlot = op && slots.find(slot => state[slot] && op.id === state[slot].id && op.action === state[slot].action &&
        (!state[slot].ownerId || state[slot].ownerId === result.ownerId));
      // A generic healthy status or an unrelated receipt never releases an unknown mutation.
      if (matchingSlot && ['settled', 'not-executed'].includes(op.status)) await writePending(null, false, matchingSlot, true);
      else if (!matchingSlot && op && !['settled', 'not-executed'].includes(op.status)) {
        const slot = browserManaged && op.action === 'disconnect-and-pause' && state.pending ? 'priorityPause' : 'pending';
        if (!state[slot]) await writePending({ version: 1, id: op.id, action: op.action,
          ...(browserManaged ? { ownerId: result.ownerId } : {}) }, false, slot);
      }
      observedRevision = revision;
      if (action !== 'status' && (!op || op.id !== id || op.action !== action)) state.feedback = 'unconfirmed';
    });
  }
  async function run(action) {
    if (!actions.has(action)) throw new Error('invalid_action');
    const mutation = action !== 'status';
    const priorityAction = browserManaged && action === 'disconnect-and-pause';
    if (!state.initialized || state.requestingPermission || (mutation ?
      !(priorityAction ? getState().canPause : getState().canMutate) : state.statusBusy)) return;
    const busyKey = priorityAction ? 'pauseBusy' : mutation ? 'mutationBusy' : 'statusBusy';
    state[busyKey] = true;
    state.feedback = mutation ? 'requesting-mutation' : 'checking';
    notify();
    try {
      const queried = new Set();
      const deadline = Date.now() + Math.min(timeoutMs, 14500);
      const maxReads = browserManaged && !mutation ? 2 : 1;
      for (let read = 0; read < maxReads; read++) {
        const order = ++sequence;
        let id = crypto.randomUUID();
        let send = false, requestRevision, requestPermissionEpoch, ownerId = null;
        await exclusive(async () => {
          await readPending();
          if (!await readPermission()) { state.feedback = 'permission-required'; return; }
          requestPermissionEpoch = permissionEpoch;
          if (mutation) {
            if (!(priorityAction ? pauseEligible() : eligible())) { state.feedback = state.pending ? 'unconfirmed' : 'not-checked'; return; }
            if (browserManaged) ownerId = state.ownerId;
            // Transport is reached only after both admission writes succeed.
            await writePending({ version: 1, id, action, ...(browserManaged ? { ownerId } : {}) }, true,
              priorityAction && state.pending ? 'priorityPause' : 'pending');
          } else {
            const pending = [state.priorityPause, state.pending].find(value => value && !queried.has(value.id));
            if (read && !pending) return;
            if (pending) id = pending.id;
            if (browserManaged) ownerId = pending?.ownerId || state.ownerId;
            if (Date.now() >= deadline) return;
          }
          requestRevision = revision;
          send = true;
        });
        notify();
        if (send) {
          queried.add(id);
          const result = browserManaged ? await browserControl(runtime, action, id, ownerId,
            mutation ? timeoutMs : Math.max(1, Math.min(5000, deadline - Date.now()))) :
            await controlDevice(runtime, action, id, timeoutMs, target);
          await observe(result, id, action, order, requestRevision, requestPermissionEpoch);
        } else break;
      }
    } catch { state.journalHealthy = false; state.feedback = 'local-unavailable'; }
    finally { state[busyKey] = false; notify(); }
  }
  return { initialize, refreshPending, requestPermission, run, getState };
}
