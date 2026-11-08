import { readSetupStatus, validSetupReceipt, readCurrentAccountSetupStatus,
  validCurrentAccountSetupReceipt } from './setup-handoff.js';
import { administratorControlRecord } from './admin-control.js';

export const SETUP_BEGIN = 'WINDOWS_INSTALLATION_BEGIN_V1';
export const SETUP_OBSERVE = 'WINDOWS_INSTALLATION_OBSERVE_V1';
export const SETUP_CONNECT = 'WINDOWS_INSTALLATION_CONNECT_V1';
export const SETUP_CANCEL = 'WINDOWS_INSTALLATION_CANCEL_V1';
export const SETUP_MESSAGES = Object.freeze([SETUP_BEGIN, SETUP_OBSERVE, SETUP_CONNECT, SETUP_CANCEL]);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const validId = value => typeof value === 'string' && value.length===32 && /^[a-f0-9]{32}$/.test(value);

// Automatic dispatch requires the exact native installation Pause contract.
// No URL or stored receipt can create an intent here.
export function bindSetupInstallation(api,{controls,observe=readSetupStatus,checkStopSupport=async()=>false,
  prepareObserver=async()=>false,
  currentAccount=null,
  now=()=>performance.now()}={}) {
  const {runtime,permissions,tabs}=api??{};
  if (api?.extension?.inIncognitoContext || !runtime?.id || !runtime.getURL || !permissions?.contains ||
      !tabs?.onRemoved?.addListener || !tabs?.onUpdated?.addListener ||
      !controls?.captureStartupPermit || !controls.connectFromSetup) return null;
  const intents=new Map();
  let disposed=false;
  const senderAllowed=sender=>sender?.id===runtime.id && sender.frameId===0 && sender.tab?.incognito!==true &&
    Number.isSafeInteger(sender.tab?.id) && sender.tab.id>=0 && typeof sender.documentId==='string' &&
    sender.documentId.length>0 && sender.documentId.length<=128 && typeof sender.url==='string' &&
    sender.url.split('#',1)[0]===runtime.getURL('setup.html');
  const sameDocument=(intent,sender)=>intent.tabId===sender.tab.id && intent.documentId===sender.documentId;
  const cancel=intent=>{intent.cancelled=true;};
  function current(intent) {
    if (disposed || intent.cancelled || intents.get(intent.setupId)!==intent || !intent.permit()) return false;
    const at=now();
    return Number.isFinite(at) && at>=intent.createdAt && at<intent.deadline;
  }
  const inactiveState=intent=>!intent.cancelled && !disposed && now()>=intent.deadline?'expired':'cancelled';
  const result=(intent,state,receipt=null)=>({setupId:intent.setupId,state,receipt,operation:intent.operation??null,
    ...(intent.explicitScope?{scope:intent.scope}:{})});
  async function permitted() {
    let timer;
    try {
      return await Promise.race([
        permissions.contains({permissions:['nativeMessaging']}),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);timer?.unref?.();}),
      ])===true;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }
  async function proof(intent) {
    if (!current(intent) || !await permitted() || !current(intent)) return null;
    let value;
    try { value=Object.freeze({...await intent.observe(api,intent.setupId)}); } catch { return null; }
    const valid=intent.scope==='current-account'?
      validCurrentAccountSetupReceipt(value,intent.setupId,runtime.id):validSetupReceipt(value,intent.setupId);
    if (!current(intent) || !valid || value.state!=='installed' ||
        !await permitted() || !current(intent)) return null;
    return value;
  }
  function matchesOperation(value,receipt,intent) {
    if (intent.scope==='current-account') return exact(value,['setupId','scope','extensionId','bindingSha256',
      'operationId','action','outcome']) && value.setupId===intent.setupId && value.scope==='current-account' &&
      value.extensionId===runtime.id && value.bindingSha256===receipt.bindingSha256 &&
      typeof value.operationId==='string' && value.operationId.length===36 &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.operationId) &&
      value.action==='reconnect' && ['requested','unconfirmed'].includes(value.outcome);
    return administratorControlRecord(value) && value.control==='connect' &&
      value.bundleSha256===receipt.bundleSha256 && value.target===receipt.target;
  }
  function connect(intent) {
    if (intent.consumed) return intent.work??Promise.resolve(result(intent,'unconfirmed'));
    // Consume before any await, including proof reads. Uncertainty is not a retry.
    intent.consumed=true;
    intent.work=Promise.resolve().then(async()=>{
      const receipt=await proof(intent);
      if (!current(intent)) return result(intent,inactiveState(intent));
      if (!receipt) return result(intent,'unconfirmed');
      const canStop=await intent.checkStopSupport(intent.scope==='current-account'?receipt:receipt.bundleSha256);
      if (!current(intent)) return result(intent,inactiveState(intent));
      if (canStop!==true) return result(intent,'unconfirmed');
      const observer=await intent.prepareObserver(()=>current(intent));
      if (!current(intent)) return result(intent,inactiveState(intent));
      if (observer!==true) return result(intent,'unconfirmed');
      if (!await permitted() || !current(intent)) {cancel(intent);return result(intent,inactiveState(intent));}
      const setup=intent.scope==='current-account'?{setupId:intent.setupId,scope:intent.scope,
        extensionId:runtime.id,bindingSha256:receipt.bindingSha256}:
        {setupId:intent.setupId,bundleSha256:receipt.bundleSha256,target:receipt.target};
      const value=await intent.controls.connectFromSetup(setup,()=>current(intent));
      if (matchesOperation(value,receipt,intent)) intent.operation=Object.freeze({...value});
      if (!current(intent)) return result(intent,inactiveState(intent));
      const submitted=intent.operation && (intent.operation.outcome==='requested' || intent.operation.state==='launch-requested');
      return result(intent,submitted?'submitted':'unconfirmed');
    }).catch(()=>result(intent,current(intent)?'unconfirmed':inactiveState(intent)));
    return intent.work;
  }
  const cancelTab=tabId=>{for(const intent of intents.values())if(intent.tabId===tabId)cancel(intent);};
  tabs.onRemoved.addListener(cancelTab);
  tabs.onUpdated.addListener((tabId,change)=>{if(change?.status==='loading'||Object.hasOwn(change??{},'url'))cancelTab(tabId);});
  permissions.onRemoved?.addListener?.(change=>{
    if(change?.permissions?.includes('nativeMessaging'))for(const intent of intents.values())cancel(intent);
  });
  return Object.freeze({
    cancelAll(){for(const intent of intents.values())cancel(intent);},
    dispose(){disposed=true;for(const intent of intents.values())cancel(intent);},
    async handleMessage(message,sender) {
      const explicitScope=Object.hasOwn(message??{},'scope');
      if (disposed || !senderAllowed(sender) || !exact(message,explicitScope?['type','setupId','scope']:['type','setupId']) ||
          explicitScope && !['administrator','current-account'].includes(message.scope) ||
          !SETUP_MESSAGES.includes(message.type) || !validId(message.setupId)) return null;
      const {setupId}=message;
      const scope=explicitScope?message.scope:'administrator';
      if (message.type===SETUP_BEGIN) {
        if (intents.has(setupId) || intents.size>=32) return null;
        // Current account never inherits administrator transport or stop support.
        if (scope==='current-account' && (!currentAccount || ['captureStartupPermit','connectFromSetup',
          'checkStopSupport','prepareObserver'].some(key=>typeof currentAccount[key]!=='function'))) return null;
        const adapter=scope==='current-account'?currentAccount:controls;
        // Cancel this document's older copy attempt, not another user's connection.
        cancelTab(sender.tab.id);
        const createdAt=now(),permit=adapter.captureStartupPermit();
        if (!Number.isFinite(createdAt) || typeof permit!=='function' || !permit()) return null;
        const intent={setupId,scope,explicitScope,controls:adapter,
          observe:scope==='current-account'?(currentAccount.observe??readCurrentAccountSetupStatus):observe,
          checkStopSupport:scope==='current-account'?currentAccount.checkStopSupport:checkStopSupport,
          prepareObserver:scope==='current-account'?currentAccount.prepareObserver:prepareObserver,
          tabId:sender.tab.id,documentId:sender.documentId,createdAt,
          deadline:createdAt+900000,permit,cancelled:false,consumed:false,operation:null,work:null};
        intents.set(setupId,intent);
        if (!await permitted() || !current(intent)) {cancel(intent);return result(intent,'cancelled');}
        return {...result(intent,'waiting'),automaticConnect:true};
      }
      const intent=intents.get(setupId);
      if (!intent || intent.scope!==scope || !sameDocument(intent,sender)) return null;
      if (message.type===SETUP_CANCEL) {cancel(intent);return result(intent,'cancelled');}
      if (!current(intent)) return result(intent,inactiveState(intent));
      if (!await permitted() || !current(intent)) {cancel(intent);return result(intent,'cancelled');}
      if (message.type===SETUP_CONNECT) return connect(intent);
      if (intent.consumed) return intent.work??result(intent,'unconfirmed');
      const receipt=await proof(intent);
      if (!current(intent)) return result(intent,inactiveState(intent));
      return result(intent,receipt?'installed':'waiting',receipt);
    },
  });
}
