import { readCurrentAccountSetupStatus, validCurrentAccountSetupReceipt } from './setup-handoff.js';
import { validPreparedReference } from './browser-wake.js';

export const CURRENT_ACCOUNT_SETUP_PREFIX = 'currentAccountSetupOperationV1:';
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
const validExtension = value => typeof value === 'string' && value.length === 32 && /^[a-p]{32}$/.test(value);
const validSetup = (value,extensionId) => exact(value,['setupId','scope','extensionId','bindingSha256']) &&
  typeof value.setupId === 'string' && value.setupId.length === 32 && /^[a-f0-9]{32}$/.test(value.setupId) &&
  value.scope === 'current-account' && value.extensionId === extensionId &&
  typeof value.bindingSha256 === 'string' && value.bindingSha256.length === 64 && /^[a-f0-9]{64}$/.test(value.bindingSha256);
const same = (value,expected) => exact(value,Object.keys(expected)) && Object.keys(expected).every(key=>value[key]===expected[key]);
const project = value => {
  const { version, ...operation } = value;
  return Object.freeze(operation);
};
function validRecord(value,setup) {
  return exact(value,['version','setupId','scope','extensionId','bindingSha256','operationId','action','outcome']) &&
    value.version === 1 && Object.keys(setup).every(key=>value[key]===setup[key]) &&
    validPreparedReference(value.operationId,value.bindingSha256) && value.action === 'reconnect' &&
    ['requested','unconfirmed'].includes(value.outcome);
}
function admitted(result,id) {
  const reply=result?.response,state=reply?.state,row=state?.operation;
  return exact(result,['ownerId','response']) && typeof result.ownerId === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(result.ownerId) && exact(reply,['version','id','action','ok','state']) &&
    reply.version === 1 && reply.id === id && reply.action === 'reconnect' && reply.ok === true &&
    exact(state,['paused','connection','operation']) && (state.paused === null || typeof state.paused === 'boolean') &&
    ['ready','disconnected','unknown'].includes(state.connection) && exact(row,['id','action','status']) &&
    row.id === id && row.action === 'reconnect' &&
    ['in-progress','unknown-running','settled','not-executed','unknown'].includes(row.status);
}

export function bindCurrentAccountSetup(api,{wake,locks=globalThis.navigator?.locks,
  createOperationId=()=>crypto.randomUUID(),captureGlobalPermit=()=>()=>true}={}) {
  const { runtime,permissions,storage }=api??{},local=storage?.local;
  if (api?.extension?.inIncognitoContext || !validExtension(runtime?.id) || !runtime?.sendNativeMessage ||
      !permissions?.contains || !local?.get || !local?.set || !locks?.request ||
      typeof createOperationId !== 'function' || typeof captureGlobalPermit !== 'function' ||
      ['captureSetupPermit','cancelSetupPreparation','prepareSetupObserver','connectFromSetup']
        .some(key=>typeof wake?.[key] !== 'function')) return null;
  const attempts=new Map();let epoch=0,disposed=false;
  function captureStartupPermit() {
    const started=epoch,transport=wake.captureSetupPermit(),global=captureGlobalPermit();
    return ()=>!disposed && started === epoch && typeof transport === 'function' && transport() === true &&
      typeof global === 'function' && global() === true;
  }
  function cancelPendingStartup() { epoch++;wake.cancelSetupPreparation(); }
  const guarded = (permit,admit) => () => { try { return permit() === true && admit() === true; } catch { return false; } };
  async function permitted(current) {
    try { return current() && await permissions.contains({permissions:['nativeMessaging']}) === true && current(); }
    catch { return false; }
  }
  const observe=(reader,setupId)=>reader === api ? readCurrentAccountSetupStatus(api,setupId) : Promise.resolve(null);
  async function proofMatches(setup,current) {
    if (!await permitted(current)) return false;
    const value=await readCurrentAccountSetupStatus(api,setup.setupId);
    return current() && validCurrentAccountSetupReceipt(value,setup.setupId,runtime.id) &&
      value.state === 'installed' && value.bindingSha256 === setup.bindingSha256;
  }
  function connectFromSetup(setup,admit) {
    if (!validSetup(setup,runtime.id) || typeof admit !== 'function') return Promise.resolve(null);
    const original=Object.freeze({...setup}),key=CURRENT_ACCOUNT_SETUP_PREFIX+original.setupId;
    if (attempts.has(key)) {
      const previous=attempts.get(key);
      return same(previous.setup,original) ? previous.work : Promise.resolve(null);
    }
    const current=guarded(captureStartupPermit(),admit);
    let pending=null;
    const work=Promise.resolve().then(()=>locks.request(key,async()=>{
      const saved=(await local.get(key))?.[key];
      if (saved !== undefined) return validRecord(saved,original) ? project(saved) : null;
      if (!await permitted(current)) return null;
      const operationId=createOperationId();
      if (!validPreparedReference(operationId,original.bindingSha256)) return null;
      pending=Object.freeze({version:1,...original,operationId,action:'reconnect',outcome:'unconfirmed'});
      await local.set({[key]:pending});
      if (!same((await local.get(key))?.[key],pending) || !await proofMatches(original,current)) return project(pending);
      const result=await wake.connectFromSetup(original,operationId,current);
      if (!current() || !admitted(result,operationId)) return project(pending);
      const requested={...pending,outcome:'requested'};
      await local.set({[key]:requested});
      return same((await local.get(key))?.[key],requested) && current() ? project(requested) : project(pending);
    })).catch(()=>pending ? project(pending) : null);
    attempts.set(key,{setup:original,work});
    return work;
  }
  permissions.onRemoved?.addListener?.(change=>{
    if(change?.permissions?.includes('nativeMessaging'))cancelPendingStartup();
  });
  return Object.freeze({
    observe,captureStartupPermit,cancelPendingStartup,connectFromSetup,
    async checkStopSupport(receipt) {
      if (!validCurrentAccountSetupReceipt(receipt,receipt?.setupId,runtime.id) || receipt.state !== 'installed') return false;
      return proofMatches({setupId:receipt.setupId,scope:receipt.scope,extensionId:receipt.extensionId,
        bindingSha256:receipt.bindingSha256},guarded(captureStartupPermit(),()=>true));
    },
    async prepareObserver(admit) {
      if (typeof admit !== 'function') return false;
      const current=guarded(captureStartupPermit(),admit);
      return await permitted(current) && await wake.prepareSetupObserver(current) === true && current();
    },
    dispose() { disposed=true;cancelPendingStartup(); },
  });
}
