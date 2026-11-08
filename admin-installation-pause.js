import { ADMIN_BROWSER_HOST, ADMIN_BROWSER_PAUSE_LAST, adminBrowserPauseRecord } from './admin-browser.js';
import { administratorControlSupport, ADMIN_CONTROL_SETUP_INSTALLATION } from './admin-control.js';

export const INSTALLATION_PAUSE_ASSOCIATIONS='windowsAdministratorInstallationPauseV1';
const archiveKey=id=>INSTALLATION_PAUSE_ASSOCIATIONS+':'+id;
const legacyKey=id=>INSTALLATION_PAUSE_ASSOCIATIONS+':legacy:'+id;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hex=(v,n)=>typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v);
const receiptStates=['unconfirmed','pause-recorded','stopped','fenced','superseded'];
function associations(value) {
  if(value===undefined)return {};
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=256&&
    Object.entries(value).every(([id,digest])=>hex(id,32)&&hex(digest,64))?value:null;
}

// New installations have an untargeted stop contract. Existing installations and
// their original Pause IDs retain the legacy protocol; no request is migrated.
export function bindInstallationPause(api,{timers=globalThis}={}) {
  const {runtime,permissions,storage}=api??{};
  if(api?.extension?.inIncognitoContext||!runtime?.sendNativeMessage||!runtime.getPlatformInfo||
    !permissions?.contains||!storage?.local?.get||!storage.local.set)return null;
  let epoch=0,queue=Promise.resolve();
  permissions.onRemoved?.addListener?.(change=>{if(change?.permissions?.includes('nativeMessaging'))epoch++;});
  const permitted=async at=>(await runtime.getPlatformInfo()).os==='win'&&epoch===at&&
    await permissions.contains({permissions:['nativeMessaging']})&&epoch===at;
  const serial=fn=>{const work=queue.then(fn,fn);queue=work.catch(()=>{});return work;};
  async function read() {
    const values=await storage.local.get([ADMIN_BROWSER_PAUSE_LAST,INSTALLATION_PAUSE_ASSOCIATIONS,ADMIN_CONTROL_SETUP_INSTALLATION]);
    const last=values[ADMIN_BROWSER_PAUSE_LAST],record=adminBrowserPauseRecord(last);
    const map=associations(values[INSTALLATION_PAUSE_ASSOCIATIONS]);
    const saved=values[ADMIN_CONTROL_SETUP_INSTALLATION];
    const installation=saved===undefined?null:exact(saved,['version','setupId','bundleSha256'])&&saved.version===1&&
      hex(saved.setupId,32)&&hex(saved.bundleSha256,64)?saved:false;
    return map&&installation!==false&&(last===undefined||record)?{record,map,installation}:null;
  }
  async function request(action,fields,at) {
    let timer;
    try {
      if(!await permitted(at))return null;
      const id=crypto.randomUUID();
      const reply=await Promise.race([
        runtime.sendNativeMessage(ADMIN_BROWSER_HOST,{version:1,id,action,...fields}),
        new Promise(resolve=>{timer=timers.setTimeout(()=>resolve(null),action==='pause-installation'?30000:
          action==='control-support'?25000:5000);timer?.unref?.();}),
      ]);
      if(!await permitted(at)||reply?.version!==1||reply.id!==id||reply.action!==action)return null;
      const {version,id:ignoredId,action:ignoredAction,...body}=reply;
      if(action==='control-support')return administratorControlSupport(body,'revoke');
      const support=action==='pause-installation-support';
      if(!exact(body,support?['bundleSha256','state']:['bundleSha256','operationId','state'])||
        body.bundleSha256!==fields.bundleSha256||!support&&body.operationId!==fields.operationId)return null;
      const states=support?['supported','unconfirmed']:action==='pause-installation'?
        [...receiptStates,'requested','cancelled']:receiptStates;
      return states.includes(body.state)?body:null;
    }catch{return null;}finally{timers.clearTimeout(timer);}
  }
  async function available(digest,at=epoch) {
    try {
      const saved=await read();
      return !!saved&&Object.keys(saved.map).length<256&&hex(digest,64)&&
        (await request('pause-installation-support',{bundleSha256:digest},at))?.state==='supported';
    }catch{return false;}
  }
  async function archived(operationId) {
    const value=(await storage.local.get(archiveKey(operationId)))[archiveKey(operationId)];
    if(value===undefined)return undefined;
    return exact(value,['version','operationId','bundleSha256'])&&value.version===1&&
      value.operationId===operationId&&hex(value.bundleSha256,64)?value.bundleSha256:null;
  }
  async function retire(operationId,map) {
    const value={version:1,operationId,bundleSha256:map[operationId]};
    const old=await archived(operationId);
    if(old!==undefined&&old!==value.bundleSha256)return false;
    await storage.local.set({[archiveKey(operationId)]:value});
    if(await archived(operationId)!==value.bundleSha256)return false;
    delete map[operationId];
    return true;
  }
  async function observe(operationId,at=epoch) {
    if(!hex(operationId,32))return null;
    const saved=await read();
    if(!saved)return null;
    const digest=saved.map[operationId]??await archived(operationId);
    if(digest===undefined)return undefined;
    if(!digest)return null;
    const reply=await request('pause-installation-status',{bundleSha256:digest,operationId},at);
    return reply?{operationId,state:reply.state}:null;
  }
  return Object.freeze({available,
    observe:operationId=>observe(operationId).catch(()=>null),
    async reconcile(operationId) {
      // New installation Pause is never sent through legacy target fencing.
      try{const saved=await read();return !saved||saved.map[operationId]||await archived(operationId)!==undefined?null:undefined;}catch{return null;}
    },
    pause:()=>serial(async()=>{
      const at=epoch;
      try {
        const saved=await read();if(!saved)return null;
        const {record:previous,map,installation}=saved;
        const previousDigest=previous?(map[previous.operationId]??await archived(previous.operationId)):undefined;
        if(previousDigest===null)return null;
        if(previous&&!previousDigest&&!installation)return undefined;
        // Setup atomically saved this installation with the Connect admission.
        // Manual denial must not depend on a fresh target or liveness sample.
        const support=installation??await request('control-support',{control:'revoke'},at);
        if(!installation&&(support?.state!=='supported'||!await available(support.bundleSha256,at)))return undefined;
        let consumed=false;
        if(previous&&previousDigest===support.bundleSha256&&previous.outcome!=='cancelled') {
          const receipt=await observe(previous.operationId,at);
          if(!receipt||receipt.state==='unconfirmed')return previous;
          consumed=true;
        }
        // LAST may belong to a different installation. Returning to this bundle
        // must still read its original outstanding operation, never replace it.
        for(const [originalId,originalBundle] of Object.entries(map)) {
          if(originalBundle!==support.bundleSha256||originalId===previous?.operationId)continue;
          const receipt=await observe(originalId,at);
          if(!receipt||receipt.state==='unconfirmed') {
            if(!await permitted(at))return null;
            const original={operationId:originalId,outcome:'unconfirmed'};
            await storage.local.set({[ADMIN_BROWSER_PAUSE_LAST]:original});
            const checked=await read();
            return checked?.record?.operationId===originalId&&checked.record.outcome==='unconfirmed'&&
              checked.map[originalId]===originalBundle&&epoch===at?original:null;
          }
          if(!await retire(originalId,map))return null;
        }
        // Retain original-ID routing before removing a settled active association.
        // Pending operations in another installation never prevent this denial.
        if(previous&&map[previous.operationId]&&(consumed||previous.outcome==='cancelled')) {
          if(!await retire(previous.operationId,map))return null;
        }
        if(!await permitted(at)||Object.keys(map).length>=256)return null;
        const operationId=crypto.randomUUID().replaceAll('-','');
        const pending={operationId,outcome:'unconfirmed'};
        const next={...map,[operationId]:support.bundleSha256};
        const priorLegacy=previous&&previousDigest===undefined?{[legacyKey(previous.operationId)]:previous}:{};
        await storage.local.set({[ADMIN_BROWSER_PAUSE_LAST]:pending,[INSTALLATION_PAUSE_ASSOCIATIONS]:next,...priorLegacy});
        const checked=await read();
        if(!checked||checked.record?.operationId!==operationId||checked.record.outcome!=='unconfirmed'||
          checked.map[operationId]!==support.bundleSha256||!await permitted(at))return null;
        const reply=await request('pause-installation',{bundleSha256:support.bundleSha256,operationId},at);
        if(!reply||reply.state==='unconfirmed')return pending;
        const result={operationId,outcome:reply.state==='cancelled'?'cancelled':'requested'};
        await storage.local.set({[ADMIN_BROWSER_PAUSE_LAST]:result});
        return epoch===at?result:null;
      }catch{return null;}
    }),
  });
}
