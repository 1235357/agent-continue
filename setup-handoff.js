const HOST = 'com.agentcontinue.administrator_owner';
// Observations are advisory. Only the initiating-document worker coordinator and
// its durable operation admission can continue setup; stored tickets are not used.
const KEY = 'windowsSetupHandoffV1:';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const validTarget = value => typeof value === 'string' && [37,65].includes(value.length) &&
  /^[a-f0-9]{32}:(?:[a-f0-9]{32}|idle)$/.test(value);
const validExtension = value => typeof value === 'string' && value.length === 32 && /^[a-p]{32}$/.test(value);

export function validCurrentAccountSetupReceipt(value, setupId, extensionId) {
  if (!hex(setupId,32) || !validExtension(extensionId) ||
      !exact(value,['setupId','state','scope','extensionId','bindingSha256']) ||
      value.setupId !== setupId || value.scope !== 'current-account' || value.extensionId !== extensionId) return false;
  return value.state === 'installed' ? hex(value.bindingSha256,64) :
    value.state === 'unconfirmed' && value.bindingSha256 === null;
}

// This projection is not an adoption receipt or permission to start an owner.
// The dedicated adapter must also enforce fresh-only native admission and receipts.
export async function readCurrentAccountSetupStatus(api, setupId) {
  const extensionId = api?.runtime?.id;
  if (!hex(setupId,32) || !validExtension(extensionId) || !api?.permissions?.contains ||
      !api?.runtime?.sendNativeMessage) return null;
  let timer, expired = false;
  try {
    return await Promise.race([
      new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); },5000); }),
      (async () => {
        if (!await api.permissions.contains({permissions:['nativeMessaging']}) || expired) return null;
        const id = crypto.randomUUID();
        const request = {version:1,id,action:'current-account-setup-status',scope:'current-account',extensionId,setupId};
        const value = await api.runtime.sendNativeMessage('com.agentcontinue.device_wake',request);
        if (expired || !exact(value,[...Object.keys(request),'state','bindingSha256']) ||
            Object.keys(request).some(key => value[key] !== request[key])) return null;
        const receipt = {setupId:value.setupId,state:value.state,scope:value.scope,
          extensionId:value.extensionId,bindingSha256:value.bindingSha256};
        if (!validCurrentAccountSetupReceipt(receipt,setupId,extensionId) ||
            !await api.permissions.contains({permissions:['nativeMessaging']}) || expired) return null;
        return receipt;
      })(),
    ]);
  } catch { return null; }
  finally { expired = true; clearTimeout(timer); }
}

export function validSetupReceipt(value, setupId) {
  if (!hex(setupId,32) || !exact(value,['setupId','state','bundleSha256','target']) || value.setupId !== setupId) return false;
  if (value.state === 'unconfirmed') return value.bundleSha256 === null && value.target === null;
  return value.state === 'installed' && hex(value.bundleSha256,64) && validTarget(value.target);
}

export async function readSetupStatus(api, setupId) {
  if (!hex(setupId,32) || !api?.permissions?.contains || !api?.runtime?.sendNativeMessage) return null;
  let timer, expired = false;
  try {
    return await Promise.race([
      new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); },5000); }),
      (async () => {
        if (!await api.permissions.contains({permissions:['nativeMessaging']}) || expired) return null;
        const id = crypto.randomUUID();
        const value = await api.runtime.sendNativeMessage(HOST,{version:1,id,action:'setup-status',setupId});
        if (expired || !exact(value,['version','id','action','setupId','state','bundleSha256','target']) ||
            value.version !== 1 || value.id !== id || value.action !== 'setup-status') return null;
        const receipt = {setupId:value.setupId,state:value.state,bundleSha256:value.bundleSha256,target:value.target};
        if (!validSetupReceipt(receipt,setupId) ||
            !await api.permissions.contains({permissions:['nativeMessaging']}) || expired) return null;
        return receipt;
      })(),
    ]);
  } catch { return null; }
  finally { expired = true; clearTimeout(timer); }
}

export function watchSetupInstallation({setupId,observe,onInstalled,onStop=()=>{},timers=globalThis,
  now=()=>performance.now(),maxMs=900000}) {
  if (!hex(setupId,32) || typeof observe !== 'function' || typeof onInstalled !== 'function' ||
      !Number.isFinite(maxMs) || maxMs < 1000 || maxMs > 900000) throw new Error('invalid_setup_watch');
  const deadline = now() + maxMs;
  let state = 'waiting',timer,attempt = 0;
  const stop = reason => {
    if (state !== 'waiting') return;
    state = reason;timers.clearTimeout(timer);
    try { onStop(reason); } catch { /* UI feedback cannot revive observation. */ }
  };
  async function check() {
    if (state !== 'waiting') return;
    if (now() >= deadline) { stop('expired');return; }
    let value;
    try { value = await observe(setupId); } catch { /* A read failure is not an installation retry. */ }
    if (state !== 'waiting') return;
    if (now() >= deadline) { stop('expired');return; }
    if (validSetupReceipt(value,setupId) && value.state === 'installed') {
      state = 'finished';timers.clearTimeout(timer);
      try { await onInstalled(value); } catch { try { onStop('handoff-unconfirmed'); } catch { } }
      return;
    }
    const delay = Math.min([1000,2500,5000,10000,20000][Math.min(attempt++,4)],deadline-now());
    timer = timers.setTimeout(()=>{void check();},delay);
  }
  void check();
  return Object.freeze({cancel:()=>stop('cancelled'),getState:()=>state});
}

function validHandoff(value,setupId,now) {
  return exact(value,['version','setupId','bundleSha256','target','createdAt','expiresAt']) && value.version === 1 &&
    validSetupReceipt({setupId:value.setupId,state:'installed',bundleSha256:value.bundleSha256,target:value.target},setupId) &&
    Number.isSafeInteger(now) && Number.isSafeInteger(value.createdAt) && Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt-value.createdAt === 60000 && now >= value.createdAt && now < value.expiresAt;
}

export async function putSetupHandoff(session,receipt,setupId,now=Date.now) {
  if (!session?.get || !session?.set || !session?.remove || !validSetupReceipt(receipt,setupId) || receipt.state !== 'installed') {
    throw new Error('setup_handoff_unavailable');
  }
  const createdAt = now();
  const value = {version:1,setupId,bundleSha256:receipt.bundleSha256,target:receipt.target,createdAt,expiresAt:createdAt+60000};
  if (!validHandoff(value,setupId,createdAt)) throw new Error('invalid_setup_handoff');
  const key = KEY+setupId;
  if ((await session.get(key))?.[key] !== undefined) throw new Error('setup_handoff_exists');
  await session.set({[key]:value});
  if (JSON.stringify((await session.get(key))?.[key]) !== JSON.stringify(value)) throw new Error('setup_handoff_unconfirmed');
}

export async function consumeSetupHandoff({session,locks,setupId,now=Date.now}) {
  if (!session?.get || !session?.remove || !locks?.request || !hex(setupId,32)) return null;
  try {
    return await locks.request(KEY+setupId,{ifAvailable:true},async lock => {
      if (!lock) return null;
      const key = KEY+setupId;
      const value = (await session.get(key))?.[key];
      if (!validHandoff(value,setupId,now())) return null;
      await session.remove(key);
      if ((await session.get(key))?.[key] !== undefined || !validHandoff(value,setupId,now())) return null;
      return value;
    });
  } catch { return null; }
}
