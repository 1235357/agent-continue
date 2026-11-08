export const BROWSER_WAKE_HOST = 'com.agentcontinue.device_wake';
export const BROWSER_DEVICE_PAGE = 'devices.html?mode=browser-managed';
export const BROWSER_DEVICE_MESSAGE = 'BROWSER_DEVICE_CONTROL_V1';
const ATTEMPT = 'deviceBrowserWakeAttemptV1';
const RECOVERY = 'deviceBrowserWakeRecoveryV1';
const OWNER = 'deviceBrowserWakeOwnerV1';
const MUTATION = 'deviceBrowserWakeMutationV1';
const RECOVERY_PREFIX = 'agent-continue-native-recovery-';
const NATIVE_PERMISSION = { permissions: ['nativeMessaging'] };
const actions = new Set(['status', 'reconnect', 'disconnect-and-pause']);
const preparedActions = new Set(['prepared-review', 'prepared-revoke']);
const preparedStatuses = new Set(['staged', 'expired', 'owner-revoked', 'admitted-outcome-unconfirmed',
  'provider-reported-result', 'provider-reported-error', 'receipt-unavailable']);
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

export function bindBrowserWake(api, { host = BROWSER_WAKE_HOST, onResult = () => {} } = {}) {
  const { runtime, permissions, storage, alarms } = api;
  const session = storage?.session;
  if (api.extension?.inIncognitoContext || !session?.get || !session?.set ||
      !runtime?.connectNative || !runtime?.getPlatformInfo || !permissions?.contains) return null;

  let current, revision = 0, pending = Promise.resolve();
  const nativeChanged = change => change?.permissions?.includes('nativeMessaging');
  const enqueue = work => (pending = pending.then(work).catch(() => { onResult('unavailable'); return null; }));
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
      try { attempt.port.disconnect(); } catch { /* Already closed. */ }
    }
  }
  function scheduleRecovery(id) {
    if (!alarms?.create || !alarms.onAlarm?.addListener) return;
    const requested = revision;
    enqueue(async () => {
      if (current || requested !== revision || !await permissions.contains(NATIVE_PERMISSION) ||
          (await session.get(RECOVERY))[RECOVERY] !== undefined || requested !== revision) return;
      const name = RECOVERY_PREFIX + id;
      // One recovery budget per browser session, even if the service worker sleeps.
      await session.set({ [RECOVERY]: name });
      if (requested === revision) await alarms.create(name, { delayInMinutes: 0.5 });
    });
  }
  function wake(mode = 'initial', alarmName, allowed = () => true) {
    const requested = revision;
    return enqueue(async () => {
      if (current || requested !== revision || !allowed()) return null;
      if ((await runtime.getPlatformInfo()).os !== 'win' || !await permissions.contains(NATIVE_PERMISSION)) return;
      if ((await session.get(OWNER))[OWNER] != null ||
          ![undefined, false].includes((await session.get(MUTATION))[MUTATION])) return null;
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
      await session.set({ [OWNER]: id });
      if (requested !== revision || !allowed()) return null;
      let resolveReady;
      const ready = new Promise(resolve => { resolveReady = resolve; });
      const attempt = { id, port: runtime.connectNative(host), acknowledged: false, command: null,
        ready, resolveReady, uncertain: false };
      current = attempt;
      const unavailable = () => { end(attempt, true); onResult('unavailable'); };
      attempt.port.onDisconnect.addListener(() => {
        void runtime.lastError;
        if (!attempt.uncertain) enqueue(async () => {
          if ((await session.get(OWNER))[OWNER] === id) await session.set({ [OWNER]: null });
        });
        if (current !== attempt) return;
        const safeToWake = attempt.acknowledged && !attempt.uncertain;
        end(attempt, false);
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
          if (!readOnly(command.request.action) && (message.ok === false ||
              (command.request.action === 'prepared-revoke' ?
                !['admitted-outcome-unconfirmed', 'receipt-unavailable'].includes(message.status) :
                ['settled', 'not-executed'].includes(message.state.operation.status)))) {
            enqueue(async () => {
              try { await session.set({ [MUTATION]: false }); attempt.uncertain = false; finish(); }
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
  async function dispatch(message, attempt, allowed = () => true) {
    const requested = revision;
    if (!await permissions.contains(NATIVE_PERMISSION) || requested !== revision || current !== attempt ||
        !allowed() || !attempt?.acknowledged || attempt.command ||
        (message.request.action === 'status' ? message.ownerId !== null : message.ownerId !== attempt.id)) return null;
    return new Promise(resolve => {
      const command = { request: message.request, resolve, timer: null };
      attempt.command = command;
      // A UI timeout does not settle a mutation or release its slot.
      command.timer = setTimeout(() => resolve(null), 14500);
      const post = () => {
        if (current !== attempt || requested !== revision || !allowed()) { end(attempt, true); return; }
        try { attempt.port.postMessage(command.request); }
        catch { end(attempt, true); }
      };
      if (readOnly(command.request.action)) post();
      else {
        attempt.uncertain = true;
        enqueue(async () => {
          try {
            await session.set({ [MUTATION]: true });
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
    async handleMessage(message, sender) {
      if (!runtime.id || sender?.id !== runtime.id || sender.tab?.incognito === true ||
          (sender.frameId !== undefined && sender.frameId !== 0) ||
          typeof sender.url !== 'string' || sender.url.split('#', 1)[0] !== runtime.getURL(BROWSER_DEVICE_PAGE) ||
          !exact(message, ['type', 'ownerId', 'request']) || message.type !== BROWSER_DEVICE_MESSAGE ||
          !validRequest(message.request)) return null;
      if (message.request.action !== 'status') return current ? dispatch(message, current) : null;
      if (message.ownerId !== null) return null;
      if (current?.acknowledged) return dispatch(message, current);
      let timer, expired = false;
      try {
        return await Promise.race([
          (async () => {
            const attempt = current ?? await wake('status', undefined, () => !expired);
            if (!attempt || !await attempt.ready || expired) return null;
            return dispatch(message, attempt, () => !expired);
          })(),
          new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 14500); }),
        ]);
      } finally { clearTimeout(timer); }
    },
  });
}
