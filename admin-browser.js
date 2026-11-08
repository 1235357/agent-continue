export const ADMIN_BROWSER_HOST = 'com.agentcontinue.administrator_owner';
export const ADMIN_BROWSER_MESSAGE = 'WINDOWS_ADMINISTRATOR_STATUS_V1';
export const ADMIN_BROWSER_PAUSE_STATUS = 'WINDOWS_ADMINISTRATOR_PAUSE_STATUS_V1';
export const ADMIN_BROWSER_PAUSE = 'WINDOWS_ADMINISTRATOR_PAUSE_V1';
export const ADMIN_BROWSER_PAUSE_RECONCILE = 'WINDOWS_ADMINISTRATOR_PAUSE_RECONCILE_V1';
export const ADMIN_BROWSER_PAUSE_LAST = 'windowsAdministratorPauseLastV1';
export const ADMIN_BROWSER_RESTORE = 'windowsAdministratorBrowserRestoreV1';
const SESSION_WAKE = 'windowsAdministratorBrowserWakeAttemptV1';
const OBSERVER_RETRY_DELAYS = [1000, 5000, 15000];
const PAGE = 'devices.html?mode=browser-managed';
const nativePermission = { permissions: ['nativeMessaging'] };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hexId = value => typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const validPauseTarget = value => typeof value === 'string' && (value.length === 37 || value.length === 65) &&
  /^[a-f0-9]{32}:(?:[a-f0-9]{32}|idle)$/.test(value);
const pauseOutcomes = ['requested', 'cancelled', 'unconfirmed'];
const consumedPauseStates = ['pause-recorded', 'stopped', 'fenced', 'superseded'];
const pauseReceiptStates = ['unconfirmed', ...consumedPauseStates];

export function administratorDevicesSender(runtime, sender) {
  // Chrome only supplies frameId when tab exists; extension popups omit both.
  return !!runtime.id && sender?.id === runtime.id && sender.tab?.incognito !== true &&
    (sender.frameId === 0 || (sender.frameId === undefined && sender.tab === undefined)) &&
    typeof sender.url === 'string' && sender.url.split('#', 1)[0] === runtime.getURL(PAGE);
}

export function adminBrowserPauseRecord(value) {
  return exact(value, ['operationId', 'outcome']) && hexId(value.operationId) &&
    pauseOutcomes.includes(value.outcome) ? value : null;
}

export function adminBrowserObservation(value) {
  if (!exact(value, ['state', 'generation'])) return null;
  if (value.state === 'unobserved' && value.generation === null) return value;
  return value.state === 'ready' && hexId(value.generation) ? value : null;
}

export function bindAdministratorBrowser(api, { timers = globalThis, onPauseIntent = () => {}, installationPause = null } = {}) {
  const { runtime, permissions, storage } = api;
  const session = storage?.session;
  if (api.extension?.inIncognitoContext || !runtime?.sendNativeMessage || !runtime?.getPlatformInfo ||
      !permissions?.contains || !session?.get || !session?.set || !storage?.local?.get) return null;

  const permitted = async () => (await runtime.getPlatformInfo()).os === 'win' &&
    await permissions.contains(nativePermission);
  let attaching, current, pausing, reconciling, statusRequest, revision = 0;
  let permissionMissing = false, sealed = false, grantObserved = false, grantAttachment;
  let recoveryTimer, recoveryAttempts = 0, recoveryStopped = false;
  function endSession(attempt, disconnect) {
    if (current !== attempt) return;
    attempt.resolveAttachment?.(false);
    current = null;
    if (disconnect) {
      try { attempt.port.disconnect(); } catch { /* Already closed. */ }
    }
  }
  function stopRecovery() {
    recoveryStopped = true;
    if (recoveryTimer) timers.clearTimeout(recoveryTimer.handle);
    recoveryTimer = null;
  }
  function scheduleObserverRecovery() {
    if (recoveryStopped || current || recoveryTimer || recoveryAttempts >= OBSERVER_RETRY_DELAYS.length) return;
    const started = revision;
    const ticket = { handle: null };
    recoveryTimer = ticket;
    ticket.handle = timers.setTimeout(async () => {
      if (recoveryTimer !== ticket || recoveryStopped || started !== revision) return;
      recoveryTimer = null;
      try {
        if (!await permitted()) { stopRecovery(); return; }
      } catch { stopRecovery(); return; }
      if (recoveryStopped || started !== revision || current) return;
      // A replacement only observes: the initial startup demand must never be replayed.
      openObserver(false, true);
    }, OBSERVER_RETRY_DELAYS[recoveryAttempts++]);
    ticket.handle?.unref?.();
  }
  function openObserver(wake, recovering = false) {
    let attempt;
    try {
      const id = crypto.randomUUID();
      attempt = { port: runtime.connectNative(ADMIN_BROWSER_HOST), acknowledged: false, recovering };
      attempt.attachment = new Promise(resolve => { attempt.resolveAttachment = resolve; });
      current = attempt;
      attempt.port.onDisconnect.addListener(() => {
        void runtime.lastError;
        if (current !== attempt) return;
        endSession(attempt, false);
        if (attempt.acknowledged || attempt.recovering) scheduleObserverRecovery();
      });
      attempt.port.onMessage.addListener(reply => {
        if (current !== attempt) return;
        if (attempt.acknowledged || !exact(reply, ['version', 'action', 'id', 'outcome']) ||
            reply.version !== 1 || reply.action !== 'session' || reply.id !== id || reply.outcome !== 'attached') {
          stopRecovery();
          endSession(attempt, true);
          return;
        }
        // A correlated attachment is not a ready or administrator observation.
        attempt.acknowledged = true;
        attempt.resolveAttachment(true);
      });
      attempt.port.postMessage({ version: 1, action: 'session', id, wake });
    } catch {
      if (attempt) endSession(attempt, true);
      if (recovering) scheduleObserverRecovery();
    }
  }
  permissions.onRemoved?.addListener?.(change => {
    if (!change?.permissions?.includes('nativeMessaging')) return;
    revision++;
    sealed = true;
    stopRecovery();
    if (current) endSession(current, true);
  });
  async function request(action, operationId, target) {
    const id = crypto.randomUUID();
    const started = performance.now();
    const envelope = { version: 1, action, id };
    if (action === 'pause-status' || action === 'pause-reconcile' || action === 'pause') envelope.operationId = operationId;
    if (action === 'pause') envelope.target = target;
    const timeout = action === 'pause' || action === 'pause-reconcile' ? 22500 : 4500;
    let timer;
    try {
      const reply = await Promise.race([
        runtime.sendNativeMessage(ADMIN_BROWSER_HOST, envelope),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); }),
      ]);
      if (reply?.version !== 1 || reply.id !== id || reply.action !== action) return null;
      if (action === 'pause-status' || action === 'pause-reconcile' || action === 'pause') {
        const states = action === 'pause-status' ? pauseReceiptStates : pauseOutcomes;
        if (!exact(reply, ['version', 'action', 'id', 'operationId', 'state']) ||
            reply.operationId !== operationId || !states.includes(reply.state)) return null;
        return action === 'pause-status' ? { operationId, state: reply.state } : reply.state;
      }
      if (action === 'pause-support') {
        return exact(reply, ['version', 'action', 'id', 'state', 'target']) && reply.state === 'supported' &&
          validPauseTarget(reply.target) ? reply.target : null;
      }
      if (performance.now() - started > 2500 ||
          !exact(reply, ['version', 'action', 'id', 'state', 'generation'])) return null;
      return adminBrowserObservation({ state: reply.state, generation: reply.generation });
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function pause() {
    if (pausing) return pausing;
    if (reconciling) return null;
    const started = revision;
    pausing = Promise.resolve().then(async () => {
      if (!storage.local.set || !storage.local.remove || !await permitted() || started !== revision) return null;
      if (installationPause) {
        const result = await installationPause.pause();
        if (started !== revision) return null;
        if (result !== undefined) return result;
      }
      const saved = (await storage.local.get(ADMIN_BROWSER_PAUSE_LAST))[ADMIN_BROWSER_PAUSE_LAST];
      const previous = adminBrowserPauseRecord(saved);
      if (saved !== undefined && !previous) return null;
      if (previous && previous.outcome !== 'cancelled') {
        const receipt = await request('pause-status', previous.operationId);
        if (started !== revision) return null;
        if (!consumedPauseStates.includes(receipt?.state)) return previous;
      }
      const target = await request('pause-support');
      if (!target || !await permitted() || started !== revision) return null;
      const operationId = crypto.randomUUID().replaceAll('-', '');
      const pending = { operationId, outcome: 'unconfirmed' };
      // Persist before dispatch so losing the worker or reply cannot replay the request.
      await storage.local.set({ [ADMIN_BROWSER_PAUSE_LAST]: pending });
      if (!await permitted() || started !== revision) {
        // No call was made; restore the earlier browser record rather than claim OS cancellation.
        if (previous) await storage.local.set({ [ADMIN_BROWSER_PAUSE_LAST]: previous });
        else await storage.local.remove(ADMIN_BROWSER_PAUSE_LAST);
        return null;
      }
      const outcome = await request('pause', operationId, target);
      if (started !== revision) return null;
      if (!outcome || outcome === 'unconfirmed') return pending;
      const result = { operationId, outcome };
      await storage.local.set({ [ADMIN_BROWSER_PAUSE_LAST]: result });
      return started === revision ? result : null;
    }).catch(() => null).finally(() => { pausing = null; });
    return pausing;
  }

  async function isCurrentPause(operationId) {
    const saved = (await storage.local.get(ADMIN_BROWSER_PAUSE_LAST))[ADMIN_BROWSER_PAUSE_LAST];
    const previous = adminBrowserPauseRecord(saved);
    return previous?.operationId === operationId && previous.outcome !== 'cancelled';
  }

  function reconcile(operationId) {
    if (pausing) return null;
    if (reconciling) return reconciling.operationId === operationId ? reconciling.result : null;
    const started = revision;
    const result = Promise.resolve().then(async () => {
      if (!await permitted() || started !== revision || !await isCurrentPause(operationId) || started !== revision) return null;
      if (installationPause) {
        const result = await installationPause.reconcile(operationId);
        if (started !== revision) return null;
        if (result !== undefined) return result;
      }
      const receipt = await request('pause-status', operationId);
      if (receipt?.state !== 'unconfirmed' || started !== revision ||
          !await isCurrentPause(operationId) || !await permitted() || started !== revision) return null;
      const outcome = await request('pause-reconcile', operationId);
      // The durable browser record describes the original submission, not the fence.
      return started === revision ? { operationId, outcome: outcome ?? 'unconfirmed' } : null;
    }).catch(() => null).finally(() => { reconciling = null; });
    reconciling = { operationId, result };
    return result;
  }

  function attachSession() {
    if (attaching) return attaching;
    const started = revision;
    attaching = Promise.resolve().then(async () => {
      const attempted = (await session.get(SESSION_WAKE))[SESSION_WAKE] !== undefined;
      // Check once even if disarmed: enabling the setting is not an immediate wake.
      await session.set({ [SESSION_WAKE]: true });
      const wake = !attempted && (await storage.local.get(ADMIN_BROWSER_RESTORE))[ADMIN_BROWSER_RESTORE] === true;
      if (!runtime.connectNative || sealed || started !== revision) return;
      if (!await permitted()) {
        permissionMissing = !sealed && started === revision;
        return;
      }
      if (sealed || started !== revision) return;
      sealed = true;
      openObserver(wake && !grantObserved);
    }).catch(() => { if (current) endSession(current, true); });
    // Keep startup demand latched; acknowledged losses use bounded observer-only recovery.
    return attaching;
  }
  permissions.onAdded?.addListener?.(change => {
    if (!change?.permissions?.includes('nativeMessaging') || sealed) return;
    // A grant can attach an observer, including during startup, but never authorize a wake.
    grantObserved = true;
    return grantAttachment ??= Promise.resolve(attaching).then(() => {
      if (!permissionMissing || sealed) return;
      permissionMissing = false;
      attaching = null;
      return attachSession();
    });
  });
  runtime.onStartup?.addListener?.(attachSession);
  // Chromium may instantiate the worker after the profile startup event.
  void attachSession();

  return Object.freeze({
    async prepareSetupObserver(admit) {
      if (typeof admit !== 'function' || !admit() || !runtime.connectNative) return false;
      const started = revision;
      let deadline;
      try {
        await attaching;
        if (!admit() || !await permitted() || started !== revision || !admit()) return false;
        if (!current) {
          stopRecovery();
          recoveryStopped = false;
          recoveryAttempts = 0;
          sealed = true;
          // An explicit, verified fresh setup can attach after the original
          // pre-install host lookup failed. This never requests startup demand.
          openObserver(false, true);
        }
        const observer = current;
        if (!observer) return false;
        const attached = observer.acknowledged || await Promise.race([
          observer.attachment,
          new Promise(resolve => { deadline = timers.setTimeout(() => resolve(false), 9000); deadline?.unref?.(); }),
        ]);
        const granted = await permitted();
        return granted && attached === true && current === observer && observer.acknowledged &&
          started === revision && admit();
      } catch { return false; }
      finally { timers.clearTimeout(deadline); }
    },
    async handleMessage(message, sender) {
      if (!administratorDevicesSender(runtime, sender)) return null;
      if (message?.type === ADMIN_BROWSER_PAUSE) {
        if (!exact(message, ['type'])) return null;
        onPauseIntent();
        return pause();
      }
      if (message?.type === ADMIN_BROWSER_PAUSE_RECONCILE) {
        return exact(message, ['type', 'operationId']) && hexId(message.operationId) ?
          reconcile(message.operationId) : null;
      }
      if (message?.type === ADMIN_BROWSER_PAUSE_STATUS) {
        if (!exact(message, ['type', 'operationId']) || !hexId(message.operationId)) return null;
        const { operationId } = message;
        const started = revision;
        try {
          if (!await permitted() || started !== revision) return null;
          if (installationPause) {
            const result = await installationPause.observe(operationId);
            if (started !== revision) return null;
            if (result !== undefined) return result;
          }
          // Historical receipts are not owner observations and never share the current status request.
          const result = await request('pause-status', operationId);
          return started === revision ? result : null;
        } catch { return null; }
      }
      if (!exact(message, ['type']) || message.type !== ADMIN_BROWSER_MESSAGE) return null;
      if (!statusRequest) {
        const started = revision;
        statusRequest = Promise.resolve().then(async () => {
          if (!await permitted() || started !== revision) return null;
          const result = await request('status');
          return started === revision ? result : null;
        }).catch(() => null).finally(() => { statusRequest = null; });
      }
      return statusRequest;
    },
  });
}
