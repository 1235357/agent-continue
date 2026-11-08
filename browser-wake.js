export const BROWSER_WAKE_HOST = 'com.agentcontinue.device_wake';
export const BROWSER_DEVICE_PAGE = 'devices.html?mode=browser-managed';
export const BROWSER_DEVICE_MESSAGE = 'BROWSER_DEVICE_CONTROL_V1';
const ATTEMPT = 'deviceBrowserWakeAttemptV1';
const RECOVERY = 'deviceBrowserWakeRecoveryV1';
const OWNER = 'deviceBrowserWakeOwnerV1';
const MUTATION = 'deviceBrowserWakeMutationV1';
const PRIORITY_PAUSE = 'deviceBrowserWakePriorityPauseV1';
const RECOVERY_PREFIX = 'agent-continue-native-recovery-';
const NATIVE_PERMISSION = { permissions: ['nativeMessaging'] };
const actions = new Set(['status', 'reconnect', 'disconnect-and-pause']);
const preparedActions = new Set(['prepared-review', 'prepared-revoke']);
const preparedStatuses = new Set(['staged', 'expired', 'owner-revoked', 'admitted-outcome-unconfirmed',
  'provider-reported-result', 'provider-reported-error', 'blocked-by-local-control', 'receipt-unavailable']);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const baseKeys = ['version', 'id', 'action'];
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
export const validPreparedReference = (operationId, sha256) => typeof operationId === 'string' && operationId.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId) &&
  typeof sha256 === 'string' && sha256.length === 64 && /^[0-9a-f]{64}$/.test(sha256);
const validRequest = request => request?.version === 1 && validId(request.id) &&
  (actions.has(request.action) ? exact(request, baseKeys) : preparedActions.has(request.action) &&
    exact(request, [...baseKeys, 'operationId', 'sha256']) && validPreparedReference(request.operationId, request.sha256));
const readOnly = action => action === 'status' || action === 'prepared-review';
const sameRecord = (value, expected) => exact(value, Object.keys(expected)) &&
  Object.keys(expected).every(key => value[key] === expected[key]);
const terminalOperation = status => ['settled', 'not-executed'].includes(status);
const terminalPrepared = status => ['owner-revoked', 'provider-reported-result', 'provider-reported-error',
  'blocked-by-local-control'].includes(status);
const emptyFence = value => value === undefined || value === false;
function validFence(value, ownerId, priority = false) {
  if (emptyFence(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ownerId !== ownerId) return false;
  const { ownerId: ignored, ...request } = value;
  return validRequest(request) && !readOnly(request.action) && (!priority || request.action === 'disconnect-and-pause');
}

function settlesMutation(mutation, request, reply) {
  // A generic rejection does not prove that the mutation was never admitted.
  if (!mutation || reply.ok !== true) return false;
  if (!readOnly(request.action)) {
    if (!sameRecord(mutation, { ownerId: mutation.ownerId, ...request })) return false;
    return request.action === 'prepared-revoke' ?
      terminalPrepared(reply.status) : terminalOperation(reply.state.operation.status);
  }
  if (request.action === 'status') {
    const operation = reply.state.operation;
    return request.id === mutation.id && operation?.id === mutation.id &&
      operation.action === mutation.action && terminalOperation(operation.status);
  }
  return mutation.action === 'prepared-revoke' && request.operationId === mutation.operationId &&
    request.sha256 === mutation.sha256 && terminalPrepared(reply.status);
}

function validControlReply(reply, request) {
  if (reply?.version !== 1 || reply.id !== request.id || reply.action !== request.action) return false;
  if (reply.ok === false) return exact(reply, [...baseKeys, 'ok']);
  if (reply.ok !== true || !exact(reply, [...baseKeys, 'ok', 'state'])) return false;
  const state = reply.state, operation = state?.operation;
  return exact(state, operation === undefined ? ['paused', 'connection'] : ['paused', 'connection', 'operation']) &&
    (state.paused === null || typeof state.paused === 'boolean') &&
    ['ready', 'disconnected', 'unknown'].includes(state.connection) &&
    (operation === undefined ? request.action === 'status' :
      exact(operation, ['id', 'action', 'status']) && operation.id === request.id &&
      ['reconnect', 'disconnect-and-pause'].includes(operation.action) &&
      (request.action === 'status' || operation.action === request.action) &&
      ['in-progress', 'unknown-running', 'settled', 'not-executed', 'unknown'].includes(operation.status));
}

function validPreparedReply(reply, request) {
  if (reply?.version !== 1 || reply.id !== request.id || reply.action !== request.action) return false;
  if (reply.ok === false) return exact(reply, [...baseKeys, 'ok']);
  return reply.ok === true && exact(reply, [...baseKeys, 'ok', 'status', 'expiresAt']) &&
    preparedStatuses.has(reply.status) &&
    (request.action === 'prepared-review' || !['staged', 'expired'].includes(reply.status)) &&
    Number.isSafeInteger(reply.expiresAt) && reply.expiresAt > 0 && reply.expiresAt <= 8640000000000000;
}

export async function controlPrepared(runtime, action, ownerId, operationId, sha256) {
  if (!validId(ownerId) || !preparedActions.has(action) || !validPreparedReference(operationId, sha256)) return null;
  const request = { version: 1, id: crypto.randomUUID(), action, operationId, sha256 };
  let timer;
  try {
    const result = await Promise.race([
      runtime.sendMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId, request }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 15000); }),
    ]);
    if (exact(result, ['ownerId', 'response']) && result.ownerId === ownerId &&
        validPreparedReply(result.response, request) && result.response.ok) {
      const { status, expiresAt } = result.response;
      return { status, expiresAt };
    }
  } catch { /* Never surface raw host errors in the extension. */ }
  finally { clearTimeout(timer); }
  return null;
}

export function bindBrowserWake(api, { host = BROWSER_WAKE_HOST, onResult = () => {}, onPauseIntent = () => {} } = {}) {
  const { runtime, permissions, storage, alarms } = api;
  const session = storage?.session;
  if (api.extension?.inIncognitoContext || !session?.get || !session?.set ||
      !runtime?.connectNative || !runtime?.getPlatformInfo || !permissions?.contains) return null;

  let current, revision = 0, pending = Promise.resolve(), statuses = Promise.resolve();
  let setupEpoch = 0, setupPrepared = null;
  const cancelSetupPreparation = () => { setupEpoch++; setupPrepared = null; };
  const captureSetupPermit = () => {
    const transport = revision, startup = setupEpoch;
    return () => transport === revision && startup === setupEpoch;
  };
  const nativeChanged = change => change?.permissions?.includes('nativeMessaging');
  const enqueue = work => (pending = pending.then(work).catch(() => { onResult('unavailable'); return null; }));
  const live = (requested, allowed) => requested === revision && allowed();
  async function ownerRecords() {
    const values = await session.get([OWNER, MUTATION, PRIORITY_PAUSE]);
    const ownerId = values[OWNER];
    // A rejected retirement can have committed. Retain its live record until exact terminal proof is reread.
    const mutation = emptyFence(values[MUTATION]) && current?.id === ownerId && current.mutation ?
      current.mutation : values[MUTATION];
    const priorityPause = emptyFence(values[PRIORITY_PAUSE]) && current?.id === ownerId && current.priorityPause ?
      current.priorityPause : values[PRIORITY_PAUSE];
    if (!validId(ownerId) || current && current.id !== ownerId || !validFence(mutation, ownerId) ||
        !validFence(priorityPause, ownerId, true) ||
        !emptyFence(mutation) && !emptyFence(priorityPause) && mutation.id === priorityPause.id) return null;
    return { ownerId, mutation, priorityPause };
  }
  async function permittedOwner(ownerId, requested, allowed) {
    if (!live(requested, allowed) || !await permissions.contains(NATIVE_PERMISSION) || !live(requested, allowed)) return null;
    const records = await ownerRecords();
    return live(requested, allowed) && records?.ownerId === ownerId ? records : null;
  }
  async function retireOwner(id) {
    const values = await session.get([OWNER, MUTATION, PRIORITY_PAUSE]);
    if (values[OWNER] === id && emptyFence(values[MUTATION]) && emptyFence(values[PRIORITY_PAUSE])) {
      await session.set({ [OWNER]: null });
    }
  }
  async function retireMutation(key, mutation, request, reply, attempt, allowed = () => true) {
    if (!settlesMutation(mutation, request, reply)) return true;
    if (!allowed()) return false;
    const values = await session.get([OWNER, key]);
    const field = key === MUTATION ? 'mutation' : 'priorityPause';
    if (values[OWNER] !== mutation.ownerId || !allowed()) return false;
    if (sameRecord(values[key], mutation)) await session.set({ [key]: false });
    else if (!emptyFence(values[key]) || !sameRecord(attempt?.[field], mutation)) return false;
    if (attempt && sameRecord(attempt[field], mutation)) attempt[field] = null;
    if (attempt?.closed && !attempt.mutation && !attempt.priorityPause) await retireOwner(attempt.id);
    return true;
  }
  function bounded(work) {
    const requested = revision;
    let timer, expired = false;
    const allowed = () => !expired && requested === revision;
    const deadline = new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 14500); });
    return Promise.race([Promise.resolve().then(() => work(requested, allowed, deadline)), deadline])
      .catch(() => null).finally(() => { expired = true; clearTimeout(timer); });
  }
  async function attachControl(message, records, requested, allowed, deadline, pause = false) {
    if (!runtime.sendNativeMessage || !live(requested, allowed)) return null;
    const { ownerId } = records, request = message.request;
    const mutationKey = records.mutation?.action === 'reconnect' ? PRIORITY_PAUSE : MUTATION;
    const field = mutationKey === MUTATION ? 'mutation' : 'priorityPause';
    let mutation, timer, expired = false;
    const active = () => !expired && live(requested, allowed);
    try {
      if ((await runtime.getPlatformInfo()).os !== 'win' || !active()) return null;
      if (pause) {
        mutation = await enqueue(async () => {
          const fresh = await permittedOwner(ownerId, requested, active);
          if (!fresh || message.ownerId !== ownerId || current && !current.acknowledged ||
              !emptyFence(fresh.priorityPause) || current?.priorityPause ||
              (mutationKey === MUTATION ? !emptyFence(fresh.mutation) || current?.mutation :
                fresh.mutation?.action !== 'reconnect' || request.id === fresh.mutation.id)) return null;
          const record = { ownerId, ...request };
          if (current?.id === ownerId) current[field] = record;
          await session.set({ [mutationKey]: record });
          return record;
        });
        if (!mutation) return null;
      }
      const fresh = await permittedOwner(ownerId, requested, active);
      if (!fresh || pause && !sameRecord(fresh[field], mutation) || !active()) return null;
      const result = await Promise.race([
        runtime.sendNativeMessage(host, { version: 2, action: 'attach-control', ownerId, request }),
        new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 5000); }),
        deadline,
      ]);
      if (!active() || !exact(result, ['version', 'action', 'ownerId', 'response']) || result.version !== 2 ||
          result.action !== 'attach-control' || result.ownerId !== ownerId || !validControlReply(result.response, request) ||
          !await permittedOwner(ownerId, requested, active)) return null;
      const settled = await enqueue(async () => {
        if (!await permittedOwner(ownerId, requested, active)) return false;
        const attempt = current?.id === ownerId ? current : null;
        // A receipt may settle only its captured record, never the other lane.
        for (const [key, record] of [[MUTATION, pause && mutationKey === MUTATION ? mutation : records.mutation],
          [PRIORITY_PAUSE, pause && mutationKey === PRIORITY_PAUSE ? mutation : records.priorityPause]]) {
          if (!emptyFence(record) && !await retireMutation(key, record, request, result.response, attempt, active)) return false;
        }
        return active();
      });
      return settled && active() ? { ownerId, response: result.response } : null;
    } catch { return null; }
    finally { expired = true; clearTimeout(timer); }
  }
  function end(attempt, disconnect) {
    clearTimeout(attempt.timer);
    attempt.resolveReady(false);
    if (attempt.command) {
      clearTimeout(attempt.command.timer);
      attempt.command.resolve(null);
      attempt.command = null;
    }
    if (current === attempt) current = null;
    if (disconnect) {
      try { attempt.port.disconnect(); attempt.closed = true; } catch { /* Closure is unconfirmed. */ }
    } else attempt.closed = true;
    // Local Port.disconnect does not emit this port's onDisconnect event.
    if (attempt.closed && !attempt.mutation && !attempt.priorityPause) enqueue(() => retireOwner(attempt.id));
  }
  function scheduleRecovery(id) {
    if (!alarms?.create || !alarms.onAlarm?.addListener) return;
    const requested = revision;
    enqueue(async () => {
      if (current || requested !== revision || !await permissions.contains(NATIVE_PERMISSION) ||
          (await session.get(RECOVERY))[RECOVERY] !== undefined || requested !== revision) return;
      const fences = await session.get([MUTATION, PRIORITY_PAUSE]);
      if (!emptyFence(fences[MUTATION]) || !emptyFence(fences[PRIORITY_PAUSE])) return;
      const name = RECOVERY_PREFIX + id;
      // One recovery budget per browser session, even if the service worker sleeps.
      await session.set({ [RECOVERY]: name });
      if (requested === revision) await alarms.create(name, { delayInMinutes: 0.5 });
    });
  }
  function wake(mode = 'initial', alarmName, allowed = () => true) {
    const requested = revision;
    return enqueue(async () => {
      if (requested !== revision || !allowed()) return null;
      if (current) return mode === 'status' ? current : null;
      if ((await runtime.getPlatformInfo()).os !== 'win' || !await permissions.contains(NATIVE_PERMISSION)) return;
      if ((await session.get(OWNER))[OWNER] != null ||
          !emptyFence((await session.get(MUTATION))[MUTATION]) ||
          !emptyFence((await session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE])) return null;
      if (mode === 'recovery') {
        if ((await session.get(RECOVERY))[RECOVERY] !== alarmName || requested !== revision) return;
        await session.set({ [RECOVERY]: true });
      } else if (mode === 'initial' && (await session.get(ATTEMPT))[ATTEMPT] === true) return;
      // Persist before attempting. A worker wake after host failure must not spin.
      await session.set({ [ATTEMPT]: true });
      if (requested !== revision || !await permissions.contains(NATIVE_PERMISSION) || requested !== revision || !allowed()) return;
      const id = crypto.randomUUID();
      const request = { version: 1, action: 'wake', id };
      // A sleeping/restarted worker cannot infer that its previous owner closed.
      let port;
      try {
        await session.set({ [OWNER]: id });
        if (requested !== revision || !allowed()) { await retireOwner(id); return null; }
        port = runtime.connectNative(host);
      } catch { await retireOwner(id); return null; }
      let resolveReady;
      const ready = new Promise(resolve => { resolveReady = resolve; });
      const attempt = { id, port, acknowledged: false, command: null,
        ready, resolveReady, mutation: null, priorityPause: null, closed: false };
      current = attempt;
      const unavailable = () => { end(attempt, true); onResult('unavailable'); };
      attempt.port.onDisconnect.addListener(() => {
        void runtime.lastError;
        const owned = current === attempt;
        const safeToWake = owned && attempt.acknowledged && !attempt.mutation && !attempt.priorityPause;
        end(attempt, false);
        if (!owned) return;
        if (!attempt.acknowledged) onResult('unavailable');
        // A lost mutation may include Pause. Never replay it or start around it.
        if (safeToWake) scheduleRecovery(attempt.id);
      });
      attempt.port.onMessage.addListener(message => {
        if (current !== attempt) return;
        if (attempt.acknowledged) {
          const command = attempt.command;
          if (!command || message?.version !== 1 || message.id !== command.request.id ||
              message.action !== command.request.action || typeof message.ok !== 'boolean') {
            unavailable(); return;
          }
          if (!(preparedActions.has(command.request.action) ? validPreparedReply(message, command.request) :
            validControlReply(message, command.request))) {
            unavailable(); return;
          }
          const finish = () => {
            if (current !== attempt || attempt.command !== command) return;
            clearTimeout(command.timer);
            attempt.command = null;
            command.resolve({ ownerId: id, response: message });
          };
          const mutation = attempt.mutation;
          if (settlesMutation(mutation, command.request, message)) {
            enqueue(async () => {
              try {
                if (!await retireMutation(MUTATION, mutation, command.request, message, attempt)) { unavailable(); return; }
                finish();
              }
              catch { unavailable(); }
            });
          } else finish();
          return;
        }
        if (!exact(message, ['version', 'action', 'id', 'ok']) ||
            message.version !== 1 || message.action !== 'wake' || message.id !== id || message.ok !== true) {
          unavailable(); return;
        }
        clearTimeout(attempt.timer);
        attempt.acknowledged = true;
        attempt.resolveReady(true);
        onResult('acknowledged');
      });
      attempt.timer = setTimeout(unavailable, 15000);
      try { attempt.port.postMessage(request); } catch { unavailable(); }
      return attempt;
    });
  }
  async function dispatch(message, attempt, allowed = () => true, setup = null) {
    const requested = revision;
    if (!await permissions.contains(NATIVE_PERMISSION) || requested !== revision || current !== attempt ||
        !allowed() || !attempt?.acknowledged || attempt.command ||
        (!readOnly(message.request.action) && (attempt.mutation || attempt.priorityPause)) ||
        (message.request.action === 'status' ? message.ownerId !== null : message.ownerId !== attempt.id)) return null;
    return new Promise(resolve => {
      const command = { request: message.request, resolve, allowed, timer: null };
      attempt.command = command;
      // A UI timeout does not settle a mutation or release its slot.
      command.timer = setTimeout(() => {
        resolve(null);
        if (readOnly(command.request.action) && attempt.command === command) end(attempt, true);
      }, 14500);
      const post = () => {
        if (current !== attempt || requested !== revision || !allowed()) { end(attempt, true); return; }
        try { attempt.port.postMessage(setup ? { ...command.request, action: 'current-account-setup-connect', ...setup } : command.request); }
        catch { end(attempt, true); }
      };
      if (readOnly(command.request.action)) post();
      else {
        attempt.mutation = { ownerId: attempt.id, ...command.request };
        enqueue(async () => {
          try {
            const fences = await session.get([OWNER, MUTATION, PRIORITY_PAUSE]);
            if (fences[OWNER] !== attempt.id || !emptyFence(fences[MUTATION]) ||
                !emptyFence(fences[PRIORITY_PAUSE])) { end(attempt, true); return; }
            await session.set({ [MUTATION]: attempt.mutation });
            if (!await permissions.contains(NATIVE_PERMISSION)) { end(attempt, true); return; }
            post();
          }
          catch { end(attempt, true); }
        });
      }
    });
  }
  runtime.onStartup?.addListener?.(() => wake());
  alarms?.onAlarm?.addListener?.(alarm => {
    if (alarm?.name?.startsWith(RECOVERY_PREFIX)) wake('recovery', alarm.name);
  });
  permissions.onAdded?.addListener?.(change => { if (nativeChanged(change)) wake('grant'); });
  permissions.onRemoved?.addListener?.(change => {
    if (!nativeChanged(change)) return;
    revision++;
    cancelSetupPreparation();
    if (current) end(current, true);
    enqueue(async () => {
      const name = (await session.get(RECOVERY))[RECOVERY];
      if (typeof name !== 'string' || !name.startsWith(RECOVERY_PREFIX)) return;
      await session.set({ [RECOVERY]: true });
      await alarms?.clear?.(name);
    });
  });
  wake();
  return Object.freeze({
    captureSetupPermit,
    cancelSetupPreparation,
    async prepareSetupObserver(admit) {
      if (typeof admit !== 'function') return false;
      const permit = captureSetupPermit();
      const allowed = () => { try { return permit() && admit() === true; } catch { return false; } };
      return await bounded(async (requested, active, deadline) => {
        const attempt = current ?? await wake('status', undefined, () => active() && allowed());
        if (!attempt || !await Promise.race([attempt.ready, deadline]) || !active() || !allowed()) return false;
        const records = await permittedOwner(attempt.id, requested, () => active() && allowed());
        if (!records || current !== attempt || attempt.command || !attempt.acknowledged ||
            !emptyFence(records.mutation) || !emptyFence(records.priorityPause) || !active() || !allowed()) return false;
        setupPrepared = { attempt, permit };
        return true;
      }) === true;
    },
    async connectFromSetup(setup, operationId, admit) {
      if (!exact(setup, ['setupId', 'scope', 'extensionId', 'bindingSha256']) || setup.scope !== 'current-account' ||
          setup.extensionId !== runtime.id || typeof setup.setupId !== 'string' || setup.setupId.length !== 32 ||
          !/^[a-f0-9]{32}$/.test(setup.setupId) || !validPreparedReference(operationId, setup.bindingSha256) ||
          typeof admit !== 'function') return null;
      const prepared = setupPrepared;
      setupPrepared = null;
      const allowed = () => { try { return prepared?.permit() === true && admit() === true; } catch { return false; } };
      if (!prepared || prepared.attempt !== current || !allowed()) return null;
      return dispatch({ ownerId: prepared.attempt.id, request: { version: 1, id: operationId, action: 'reconnect' } },
        prepared.attempt, allowed, Object.freeze({ ...setup }));
    },
    async handleMessage(message, sender) {
      if (!runtime.id || sender?.id !== runtime.id || sender.tab?.incognito === true ||
          (sender.frameId !== undefined && sender.frameId !== 0) ||
          typeof sender.url !== 'string' || sender.url.split('#', 1)[0] !== runtime.getURL(BROWSER_DEVICE_PAGE) ||
          !exact(message, ['type', 'ownerId', 'request']) || message.type !== BROWSER_DEVICE_MESSAGE ||
          !validRequest(message.request)) return null;
      if (message.request.action === 'disconnect-and-pause' || message.request.action === 'prepared-revoke') {
        cancelSetupPreparation();
        try { onPauseIntent(); } catch { /* Preparation denial must not prevent the requested control. */ }
      }
      if (message.request.action === 'disconnect-and-pause') return bounded(async (requested, allowed, deadline) => {
        const records = await enqueue(() => ownerRecords());
        return records ? attachControl(message, records, requested, allowed, deadline, true) : null;
      });
      if (message.request.action !== 'status') return current ? dispatch(message, current) : null;
      if (message.ownerId !== null && !validId(message.ownerId)) return null;
      let timer, attempt, expired = false;
      const allowed = () => !expired;
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => {
          expired = true;
          if (attempt?.command?.allowed === allowed) end(attempt, true);
          resolve(null);
        }, 14500);
      });
      try {
        return await Promise.race([
          (async () => {
            if (message.ownerId !== null || !current || current.command) {
              const requested = revision;
              const records = await enqueue(() => ownerRecords());
              if (records) return message.ownerId === null || message.ownerId === records.ownerId ?
                attachControl(message, records, requested, allowed, deadline) : null;
              if (message.ownerId !== null || current || expired) return null;
            }
            attempt = current ?? await wake('status', undefined, allowed);
            if (!attempt || !await attempt.ready || expired) return null;
            const status = statuses.then(() => dispatch(message, attempt, allowed));
            // Do not hold the storage queue while waiting for a native reply.
            statuses = Promise.race([status, deadline]).catch(() => null);
            return statuses;
          })(),
          deadline,
        ]);
      } finally { clearTimeout(timer); }
    },
  });
}
