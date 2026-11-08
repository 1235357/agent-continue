import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSetupRequest, serializeSetupRequest, describeTarget } from '../setup-model.js';
import { resolveStatusView } from '../native/bootstrap/registration-status-view.mjs';
import { buildInstallPlan } from '../native/bootstrap/install-plan.mjs';

const source = await import('../setup-client.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const extensionId = 'abcdefghijklmnopabcdefghijklmnop', setupId = 'a'.repeat(32);
const types = Object.fromEntries(['BEGIN', 'OBSERVE', 'CONNECT', 'CANCEL']
  .map(name => [name, `WINDOWS_INSTALLATION_${name}_V1`]));
const receipt = { setupId, state: 'installed', bundleSha256: 'b'.repeat(64), target: 'c'.repeat(32) + ':idle' };
const reply = (state, extra = {}) => ({ setupId, state, receipt: null, operation: null, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => Promise.withResolvers();
const localCommand = ({ extensionId, shell, setupId, scope }) => {
  if (scope === 'administrator') return source.administratorSetupCommand(extensionId, shell, setupId);
  if (scope !== 'current-account' || !['browserPowerShell','browserCmd'].includes(shell)) return '';
  return `.\\install.ps1 -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId '${extensionId}'` +
    (setupId === undefined ? '' : ` -BrowserSetupId ${setupId}`);
};
function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: value => listeners.forEach(fn => fn(value)) };
}
function clock() {
  let time = 0, serial = 0;
  const jobs = new Map();
  return {
    now: () => time, jobs,
    setTimeout(fn, ms) { const id = ++serial; jobs.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    async advance(ms) {
      time += ms;
      for (const [id, job] of [...jobs]) if (job.at <= time && jobs.delete(id)) job.fn();
      for (let i = 0; i < 15; i++) await tick();
    },
  };
}
function fixture(options = {}) {
  assert.equal(typeof source.createSetupClient, 'function', 'setup client must exist');
  const timers = clock(), removed = event(), hidden = event();
  const context = { os: 'windows', scope: 'administrator', consent: true, epoch: 1, extensionId };
  Object.assign(context, options.context);
  const calls = [], copies = [], states = [];
  let granted = options.granted ?? true, requests = 0, generated = 0;
  const api = { permissions: {
    contains: options.contains ?? (async () => granted),
    request() { requests++; return options.request ? options.request() : Promise.resolve(granted = true); },
    onRemoved: removed,
  }, runtime: { sendMessage(message) {
    calls.push(structuredClone(message));
    if (options.send) return options.send(message);
    if (message.type === types.BEGIN) return Promise.resolve(reply('waiting', { automaticConnect: true }));
    if (message.type === types.OBSERVE) return Promise.resolve(reply('installed', { receipt }));
    return Promise.resolve(reply(message.type === types.CONNECT ? 'submitted' : 'cancelled'));
  } } };
  const client = source.createSetupClient({ api, getContext: () => ({ ...context }),
    ...(options.defaultBuilder ? {} : { buildCommand: options.buildCommand ?? localCommand }),
    permissionGranted: () => granted,
    clipboard: { async writeText(command) { copies.push(command); return options.copy?.(command); } },
    crypto: { getRandomValues(bytes) { generated++; bytes.fill(0xaa); return bytes; } },
    page: { addEventListener(name, fn) { assert.equal(name, 'pagehide'); hidden.addListener(fn); } },
    timers, now: timers.now, maxMs: options.maxMs ?? 60000, callTimeoutMs: 5000,
    onChange: state => { states.push(structuredClone(state)); options.onChange?.(state); },
  });
  return { client, api, context, calls, copies, states, timers, removed, hidden,
    get requests() { return requests; }, get generated() { return generated; },
    revoke() { granted = false; removed.emit({ permissions: ['nativeMessaging'] }); },
    click: (shell = 'browserPowerShell', isTrusted = true) => client.copy({ isTrusted }, shell),
    count: type => calls.filter(call => call.type === types[type]).length };
}

test('coordinator exports the client and administrator command builder', () => {
  assert.equal(typeof source.createSetupClient, 'function');
  assert.equal(typeof source.administratorSetupCommand, 'function');
});

test('one trusted administrator copy binds one ID, copies it, observes and requests once, never Ready', async () => {
  const f = fixture();
  await f.click();
  await tick();
  assert.match(f.copies[0], new RegExp(`-BrowserSetupId ${setupId}$`));
  assert.equal(f.count('BEGIN'), 1); assert.equal(f.count('OBSERVE'), 1); assert.equal(f.count('CONNECT'), 1);
  assert.equal(f.requests, 0); assert.equal(f.generated, 1);
  assert.equal(f.client.getState().state, 'requested');
  assert.equal(f.states.some(value => /ready/i.test(value.state)), false);
  for (const call of f.calls) assert.deepEqual(Object.keys(call).sort(), ['setupId', 'type']);
  assert.ok(f.calls.every(call => call.setupId === setupId));
  await f.click('browserCmd'); await f.timers.advance(60000);
  assert.equal(f.count('CONNECT'), 1); assert.equal(f.generated, 1); assert.equal(f.copies.length, 1);
});

test('untrusted, old current-account install consent, non-Windows or invalid extension cannot begin or copy', async () => {
  for (const change of [{ scope: 'current-account' }, { os: 'linux' }, { consent: false }, { extensionId: 'invalid' }, {}]) {
    const f = fixture(); Object.assign(f.context, change);
    await f.click('browserPowerShell', Object.keys(change).length > 0);
    assert.equal(f.calls.length, 0); assert.equal(f.copies.length, 0); assert.equal(f.requests, 0);
  }
  const f = fixture(); await f.click('cmd');
  assert.equal(f.calls.length, 0); assert.equal(f.requests, 0);
});

test('missing release metadata or a rejecting builder prevents permission, Begin, random IDs and clipboard', async () => {
  for (const options of [{ defaultBuilder:true }, { buildCommand:()=>'' },
    { buildCommand:()=>{throw Error('invalid release');} }]) {
    const f=fixture({...options,granted:false});await f.click();
    assert.equal(f.calls.length,0);assert.equal(f.copies.length,0);
    assert.equal(f.requests,0);assert.equal(f.generated,0);
  }
});

test('current-account fresh connection consent uses its own scope and exact command precomputed before Begin',async()=>{
  const observed=[];
  const currentProof={setupId,state:'installed',scope:'current-account',extensionId,bindingSha256:'b'.repeat(64)};
  const f=fixture({context:{scope:'current-account',connectionConsent:true,version:'2.3.4'},
    buildCommand:context=>{observed.push({...context});return localCommand(context);},
    send:async message=>{
      assert.equal(observed.at(-1).setupId,setupId,'bound command exists before Begin');
      return {...reply(message.type===types.BEGIN?'waiting':message.type===types.OBSERVE?'installed':'submitted',
        {automaticConnect:true,receipt:currentProof}),scope:'current-account'};
    }});
  await f.click();
  assert.equal(f.client.getState().state,'requested');assert.equal(f.count('CONNECT'),1);
  assert.match(f.copies[0],/-InstallLocal -BrowserManaged/);assert.match(f.copies[0],new RegExp(`-BrowserSetupId ${setupId}$`));
  for(const message of f.calls)assert.equal(message.scope,'current-account');
  assert.equal(observed.at(-1).version,'2.3.4');
  assert.equal(observed.at(-1).scope,'current-account');
});

test('current-account cannot use an administrator capability or proof and cannot silently fall back',async()=>{
  for(const stage of ['BEGIN','OBSERVE']){
    const f=fixture({context:{scope:'current-account',connectionConsent:true},send:async message=>{
      const state=message.type===types.BEGIN?'waiting':'installed';
      return {...reply(state,{automaticConnect:true,receipt}),
        ...(message.type===types[stage]?{}:{scope:'current-account'})};
    }});
    await f.click();assert.equal(f.count('CONNECT'),0);
    assert.equal(f.client.getState().state,'unconfirmed');
    if(stage==='BEGIN')assert.equal(f.copies.length,0);
  }
});

test('scope or fresh connection consent changes cancel current-account before a late observation',async()=>{
  for(const change of [{scope:'administrator'},{connectionConsent:false}]){
    const pending=deferred();
    const f=fixture({context:{scope:'current-account',connectionConsent:true},send:async message=>
      message.type===types.BEGIN?{...reply('waiting',{automaticConnect:true}),scope:'current-account'}:pending.promise});
    const work=f.click();for(let i=0;i<15&&f.count('OBSERVE')===0;i++)await tick();
    assert.equal(f.count('OBSERVE'),1);Object.assign(f.context,change);
    pending.resolve({...reply('installed',{receipt}),scope:'current-account'});await work;
    assert.equal(f.client.getState().state,'cancelled');assert.equal(f.count('CONNECT'),0);
    assert.equal(f.count('CANCEL'),1);
  }
});

test('current-account timeout invalidates future worker admission without replay or claiming rollback',async()=>{
  const pending=deferred();
  const currentProof={setupId,state:'installed',scope:'current-account',extensionId,bindingSha256:'b'.repeat(64)};
  const f=fixture({maxMs:300000,context:{scope:'current-account',connectionConsent:true},
    send:async message=>message.type===types.CONNECT?pending.promise:
      {...reply(message.type===types.BEGIN?'waiting':'installed',{automaticConnect:true,receipt:currentProof}),scope:'current-account'}});
  const work=f.click();for(let i=0;i<30&&f.count('CONNECT')===0;i++)await tick();
  assert.equal(f.count('CONNECT'),1);await f.timers.advance(120000);await work;
  assert.equal(f.client.getState().state,'unconfirmed');assert.equal(f.count('CANCEL'),1);
  pending.resolve({...reply('submitted'),scope:'current-account'});await tick();await f.click();
  assert.equal(f.client.getState().state,'unconfirmed');assert.equal(f.count('CONNECT'),1);
});

test('a matching unconfirmed current-account response closes its admission permit without replay',async()=>{
  const currentProof={setupId,state:'installed',scope:'current-account',extensionId,bindingSha256:'b'.repeat(64)};
  const f=fixture({context:{scope:'current-account',connectionConsent:true},send:async message=>
    ({...reply(message.type===types.BEGIN?'waiting':message.type===types.OBSERVE?'installed':'unconfirmed',
      {automaticConnect:true,receipt:currentProof}),scope:'current-account'})});
  await f.click();
  assert.equal(f.client.getState().state,'unconfirmed');assert.equal(f.count('CANCEL'),1);
  await f.click();assert.equal(f.count('CONNECT'),1);assert.equal(f.generated,1);
});

test('synchronous rendering cancellation cannot leave a new deadline timer or request permission',async()=>{
  const f=fixture({granted:false,onChange:state=>{if(state.state==='preparing')f.client.cancel();}});
  await f.click();
  assert.equal(f.client.getState().state,'cancelled');assert.equal(f.timers.jobs.size,0);
  assert.equal(f.requests,0);assert.equal(f.calls.length,0);
});

test('permission request starts synchronously in the trusted gesture and is read back before Begin', async () => {
  const permission = deferred();
  const f = fixture({ granted: false, request: () => permission.promise });
  const copy = f.click();
  assert.equal(f.requests, 1); assert.equal(f.calls.length, 0);
  f.api.permissions.contains = async () => true;
  permission.resolve(true); await copy; await tick();
  assert.equal(f.count('BEGIN'), 1); assert.equal(f.count('CONNECT'), 1);
});

test('human approval may take longer than an interface timeout while the same consent remains current', async () => {
  const permission = deferred();
  const f = fixture({ granted: false, request: () => permission.promise });
  const copy = f.click();
  await f.timers.advance(20000);
  assert.equal(f.client.getState().state, 'preparing');
  assert.equal(f.count('BEGIN'), 0); assert.equal(f.requests, 1);
  f.api.permissions.contains = async () => true;
  permission.resolve(true); await copy; await tick();
  assert.equal(f.count('BEGIN'), 1); assert.equal(f.count('CONNECT'), 1);
  assert.equal(f.client.getState().state, 'requested');
});

test('human approval still expires at the original setup deadline and a late grant cannot resume', async () => {
  const permission = deferred();
  const f = fixture({ granted: false, request: () => permission.promise });
  const copy = f.click();
  await f.timers.advance(60000); await copy;
  assert.equal(f.client.getState().state, 'unconfirmed');
  f.api.permissions.contains = async () => true;
  permission.resolve(true); await tick(); await f.click();
  assert.equal(f.count('BEGIN'), 0); assert.equal(f.count('CONNECT'), 0);
  assert.equal(f.requests, 1); assert.equal(f.copies.length, 0);
});

test('denied, unavailable or unconfirmed browser permission never begins or copies', async () => {
  for (const options of [{ granted: false, request: () => false },
    { granted: false, request: () => true, contains: async () => false },
    { granted: false, request: () => { throw new Error('denied'); } }]) {
    const f = fixture(options); await f.click();
    assert.equal(f.count('BEGIN'), 0); assert.equal(f.copies.length, 0);
    assert.equal(f.client.getState().state, 'permission-denied');
  }
  const f = fixture({ granted: false }); delete f.api.permissions.request;
  await f.click(); assert.equal(f.count('BEGIN'), 0); assert.equal(f.copies.length, 0);
});

test('clipboard failure cancels the bound intent and never observes, connects or regenerates', async () => {
  const f = fixture({ copy: () => { throw new Error('clipboard unavailable'); } });
  await f.click(); await tick();
  assert.equal(f.client.getState().state, 'copy-failed');
  assert.equal(f.count('CANCEL'), 1); assert.equal(f.count('OBSERVE'), 0); assert.equal(f.count('CONNECT'), 0);
  await f.click(); assert.equal(f.generated, 1); assert.equal(f.count('BEGIN'), 1);
});

test('old worker waiting without explicit capability copies a manual command and never polls', async () => {
  const f = fixture({ send: async () => reply('waiting') });
  await f.click(); await tick();
  assert.equal(f.client.getState().state, 'manual');
  assert.doesNotMatch(f.copies[0], /BrowserSetupId/);
  assert.equal(f.count('OBSERVE'), 0); assert.equal(f.count('CONNECT'), 0);
  await f.click(); assert.equal(f.count('BEGIN'), 1);
});

test('null, wrong-ID and rejected Begin keep copy/manual recovery honest and never auto-connect or retry', async () => {
  for (const value of [null, reply('waiting', { setupId: 'f'.repeat(32), automaticConnect: true })]) {
    const f = fixture({ send: async () => value });
    await f.click(); await tick();
    assert.equal(f.client.getState().state, 'unconfirmed');
    assert.equal(f.copies.length, 1); assert.doesNotMatch(f.copies[0], /BrowserSetupId/);
    await f.click(); assert.equal(f.count('BEGIN'), 1); assert.equal(f.count('CONNECT'), 0);
  }
  const f = fixture(); delete f.api.runtime.sendMessage;
  await f.click();
  assert.equal(f.client.getState().state, 'unconfirmed');
  assert.equal(f.copies.length, 1); assert.doesNotMatch(f.copies[0], /BrowserSetupId/);
});

test('leaving after submission cancels the document intent without claiming the submitted operation stopped', async () => {
  const f = fixture(); await f.click();
  assert.equal(f.client.getState().state, 'requested');
  f.hidden.emit(); await tick();
  assert.equal(f.count('CANCEL'), 1); assert.equal(f.client.getState().state, 'cancelled');
  await f.click(); assert.equal(f.count('CONNECT'), 1); assert.equal(f.generated, 1);
});

test('parallel and repeated clicks share one attempt even while Begin or Connect is unresolved', async () => {
  for (const pendingType of ['BEGIN', 'CONNECT']) {
    const pending = deferred();
    const f = fixture({ send: async message => message.type === types[pendingType] ? pending.promise :
      message.type === types.BEGIN ? reply('waiting', { automaticConnect: true }) : reply('installed', { receipt }) });
    const a = f.click(), b = f.click('browserCmd');
    for (let i = 0; i < 15; i++) await tick();
    assert.equal(f.generated, 1); assert.equal(f.count('BEGIN'), 1);
    pending.resolve(pendingType === 'BEGIN' ? reply('waiting', { automaticConnect: true }) : null);
    await a; await b; await tick(); await f.click();
    assert.equal(f.generated, 1); assert.equal(f.count('BEGIN'), 1); assert.equal(f.count('CONNECT'), 1);
  }
});

test('cancellation wins during permission, Begin, clipboard, Observe and Connect awaits', async () => {
  for (const stage of ['permission', 'BEGIN', 'clipboard', 'OBSERVE', 'CONNECT']) {
    const pending = deferred(); let entered = false;
    const f = fixture({ granted: stage !== 'permission',
      request: () => { entered = true; return pending.promise; },
      copy: stage === 'clipboard' ? () => { entered = true; return pending.promise; } : undefined,
      send: async message => {
        if (message.type === types[stage]) { entered = true; return pending.promise; }
        return message.type === types.BEGIN ? reply('waiting', { automaticConnect: true }) :
          message.type === types.OBSERVE ? reply('installed', { receipt }) : reply('submitted');
      },
    });
    const copy = f.click();
    for (let i = 0; i < 30 && !entered; i++) await tick();
    assert.ok(entered, stage);
    f.client.cancel();
    pending.resolve(stage === 'permission' ? true : stage === 'BEGIN' ? reply('waiting', { automaticConnect: true }) :
      stage === 'OBSERVE' ? reply('installed', { receipt }) : reply('submitted'));
    await copy; await tick(); await f.timers.advance(60000);
    assert.equal(f.client.getState().state, 'cancelled', stage);
    assert.equal(f.count('CONNECT'), stage === 'CONNECT' ? 1 : 0, stage);
    assert.equal(f.timers.jobs.size, 0, stage);
  }
});

test('pagehide, permission revocation and context changes stop waiting permanently', async () => {
  for (const stop of [f => f.hidden.emit(), f => f.revoke(),
    f => { f.context.scope = 'current-account'; }, f => { f.context.consent = false; },
    f => { f.context.epoch++; }]) {
    const f = fixture({ send: async message => reply('waiting', message.type === types.BEGIN ? { automaticConnect: true } : {}) });
    await f.click(); await tick(); stop(f); await f.timers.advance(1000);
    assert.equal(f.client.getState().state, 'cancelled'); assert.equal(f.count('CONNECT'), 0);
    assert.equal(f.count('CANCEL'), 1); assert.equal(f.timers.jobs.size, 0);
    await f.click(); assert.equal(f.count('BEGIN'), 1);
  }
});

test('permission loss observed immediately before Connect cancels even without an event', async () => {
  const f = fixture();
  f.api.runtime.sendMessage = async message => {
    f.calls.push(message);
    if (message.type === types.BEGIN) return reply('waiting', { automaticConnect: true });
    f.api.permissions.contains = async () => false;
    return reply('installed', { receipt });
  };
  await f.click(); await tick();
  assert.equal(f.count('CONNECT'), 0); assert.equal(f.client.getState().state, 'cancelled');
});

test('wrong envelope or receipt IDs, missing worker and invented Ready cannot authorize Connect', async () => {
  for (const observation of [null, reply('installed', { setupId: 'd'.repeat(32), receipt }),
    reply('installed', { receipt: { ...receipt, setupId: 'e'.repeat(32) } }), reply('ready'),
    reply('installed', { receipt: null })]) {
    const f = fixture({ send: async message => message.type === types.BEGIN ?
      reply('waiting', { automaticConnect: true }) : observation });
    await f.click(); await tick();
    assert.equal(f.count('CONNECT'), 0); assert.equal(f.client.getState().state, 'unconfirmed');
  }
});

test('unconfirmed, cancelled, wrong-ID or Ready Connect responses never mean ready or trigger a replay', async () => {
  for (const response of [null, reply('unconfirmed'), reply('cancelled'), reply('ready'),
    reply('submitted', { setupId: 'd'.repeat(32) })]) {
    const f = fixture({ send: async message => message.type === types.BEGIN ? reply('waiting', { automaticConnect: true }) :
      message.type === types.OBSERVE ? reply('installed', { receipt }) : response });
    await f.click(); await tick(); await f.click();
    assert.equal(f.count('CONNECT'), 1);
    assert.equal(f.client.getState().state, response?.state === 'cancelled' ? 'cancelled' : 'unconfirmed');
    assert.equal(f.states.some(value => /ready/i.test(value.state)), false);
  }
});

test('polling and individual stalled operations are bounded; late results cannot revive the intent', async () => {
  const waiting = fixture({ send: async () => reply('waiting', { automaticConnect: true }) });
  await waiting.click(); await tick(); await waiting.timers.advance(60000);
  assert.equal(waiting.client.getState().state, 'unconfirmed'); assert.equal(waiting.count('CONNECT'), 0);
  const pending = deferred();
  const stalled = fixture({ send: async () => pending.promise });
  const copy = stalled.click(); await tick(); await stalled.timers.advance(5000); await copy;
  assert.equal(stalled.client.getState().state, 'unconfirmed');
  pending.resolve(reply('waiting', { automaticConnect: true })); await tick();
  await stalled.click(); assert.equal(stalled.count('CONNECT'), 0); assert.equal(stalled.generated, 1);
});

test('Connect can await real approval beyond five seconds without cancellation or replay', async () => {
  const pending = deferred();
  const f = fixture({ maxMs: 300000, send: async message => message.type === types.BEGIN ?
    reply('waiting', { automaticConnect: true }) : message.type === types.OBSERVE ? reply('installed', { receipt }) : pending.promise });
  const copy = f.click();
  for (let i = 0; i < 20 && f.count('CONNECT') === 0; i++) await tick();
  assert.equal(f.count('CONNECT'), 1);
  await f.timers.advance(5001); const repeated = f.click('browserCmd');
  assert.equal(f.client.getState().state, 'connecting'); assert.equal(f.count('CANCEL'), 0);
  assert.equal(f.count('CONNECT'), 1); assert.equal(f.generated, 1);
  pending.resolve(reply('submitted')); await copy; await repeated;
  assert.equal(f.client.getState().state, 'requested'); assert.equal(f.timers.jobs.size, 0);
});

test('Connect response timeout preserves the original ID without Cancel, native kill or replay', async () => {
  const pending = deferred();
  const f = fixture({ maxMs: 300000, send: async message => message.type === types.BEGIN ?
    reply('waiting', { automaticConnect: true }) : message.type === types.OBSERVE ? reply('installed', { receipt }) : pending.promise });
  const copy = f.click();
  for (let i = 0; i < 20 && f.count('CONNECT') === 0; i++) await tick();
  await f.timers.advance(119999);
  assert.equal(f.client.getState().state, 'connecting');
  await f.timers.advance(1); await copy;
  assert.equal(f.client.getState().state, 'unconfirmed');
  assert.equal(f.client.getState().setupId, setupId); assert.equal(f.count('CANCEL'), 0);
  pending.resolve(reply('submitted', { operation: { operationId: 'd'.repeat(32) } })); await tick();
  await f.click(); assert.equal(f.count('CONNECT'), 1); assert.equal(f.generated, 1);
  assert.equal(f.client.getState().state, 'unconfirmed'); assert.equal(f.timers.jobs.size, 0);
});

test('Connect response budget is capped by the original overall document deadline', async () => {
  const pending = deferred(); let installed = false;
  const f = fixture({ send: async message => message.type === types.BEGIN ? reply('waiting', { automaticConnect: true }) :
    message.type === types.OBSERVE ? installed ? reply('installed', { receipt }) : reply('waiting') : pending.promise });
  await f.click(); installed = true; await f.timers.advance(59000);
  assert.equal(f.count('CONNECT'), 1); assert.equal(f.client.getState().state, 'connecting');
  await f.timers.advance(1000);
  assert.equal(f.client.getState().state, 'unconfirmed'); assert.equal(f.count('CANCEL'), 0);
  assert.equal(f.count('CONNECT'), 1); assert.equal(f.timers.jobs.size, 0);
  pending.resolve(reply('submitted')); await tick();
  assert.equal(f.client.getState().state, 'unconfirmed');
});

test('administrator command builder validates IDs and keeps manual commands free of setup IDs', () => {
  assert.equal(typeof source.administratorSetupCommand, 'function');
  assert.equal(source.administratorSetupCommand(extensionId, 'browserCmd', setupId),
    `install.cmd guided-administrator ${extensionId} ${setupId}`);
  assert.doesNotMatch(source.administratorSetupCommand(extensionId, 'browserPowerShell'), /BrowserSetupId/);
  for (const bad of ['A'.repeat(32), setupId + '\n', 'x', null]) {
    assert.equal(source.administratorSetupCommand(extensionId, 'browserPowerShell', bad), '');
  }
  assert.equal(source.administratorSetupCommand('bad', 'browserCmd', setupId), '');
});

async function setupPage(options = {}) {
  const nodes = new Map(), handlers = new Map(), life = new Map(), copies = [], messages = [];
  let language = 'en', granted = true;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, hidden: false, open: false, textContent: '',
      addEventListener: (name, fn) => handlers.set(id + ':' + name, fn), setAttribute() {},
      getAttribute() { return null; }, removeAttribute() {}, focus() {}, reset() {}, querySelector() { return this; },
      close() { this.open = false; }, showModal() { this.open = true; } });
    return nodes.get(id);
  };
  const script = fs.readFileSync(new URL('../setup.js', import.meta.url), 'utf8').replace(/^import .+ from '.+';\r?$/gm, '');
  const context = {
    createSetupClient: options => source.createSetupClient({ ...options, api: context.chrome,
      buildCommand:localCommand,
      clipboard: context.navigator.clipboard, crypto: context.crypto, page: context }),
    administratorSetupCommand: source.administratorSetupCommand,
    buildWindowsSetupCommand: localCommand,
    buildSetupRequest, serializeSetupRequest, describeTarget, resolveStatusView, buildInstallPlan,
    createTranslator: catalog => text => language === 'en' ? catalog[text] ?? text : text,
    initializeLanguage: async () => {}, subscribeLanguage() {}, getLanguage: () => language,
    setLanguage: async value => { language = value; },
    document: { getElementById: node, querySelectorAll: () => [], documentElement: {} },
    chrome: { runtime: { id: extensionId, async sendMessage(message) {
      messages.push(message);
      if (options.send) return options.send(message);
      return { ...reply(message.type === types.BEGIN ? 'waiting' : message.type === types.OBSERVE ? 'installed' : 'submitted',
        { automaticConnect: true, receipt: { ...receipt, setupId: message.setupId } }), setupId: message.setupId };
    } }, permissions: { contains: async () => granted, request: async () => (granted = true), onRemoved: event(), onAdded: event() },
    storage: { local: { get: async () => ({ installConsent: true }), set: async () => {} } } },
    navigator: { clipboard: { writeText: async command => { copies.push(command); } } },
    crypto: { getRandomValues(bytes) { return bytes.fill(0xaa); } }, performance, setTimeout, clearTimeout,
    TextEncoder, URL, Blob, addEventListener: (name, fn) => life.set(name, fn),
  };
  await vm.runInNewContext('(async () => {\n' + script + '\n})()', context);
  const emit = async (id, name, value = {}) => { await handlers.get(id + ':' + name)?.(value); await tick(); };
  return { node, copies, messages, life, emit, async administrator() {
    await emit('windowsAccessScope', 'change', { target: { value: 'administrator' } });
    await emit('installConsent', 'change', { target: { checked: true } });
  } };
}

test('page integrates the client using existing IDs and fresh administrator consent while standard copy stays unchanged', async () => {
  const f = await setupPage();
  await f.emit('copyWindowsBrowserPowerShell', 'click', { isTrusted: true });
  assert.match(f.copies[0], /-InstallLocal -BrowserManaged/); assert.equal(f.messages.length, 0);
  await f.administrator();
  assert.match(f.node('setupRisk').textContent, /installation and connection.*separate.*Windows/i);
  await f.emit('copyWindowsBrowserPowerShell', 'click', { isTrusted: true });
  for (let i = 0; i < 15; i++) await tick();
  assert.match(f.copies[1], new RegExp(`-BrowserSetupId ${setupId}$`));
  assert.equal(f.messages.filter(value => value.type === types.CONNECT).length, 1);
  assert.match(f.node('installFeedback').textContent, /requested.*unconfirmed/i);
});

test('page consent withdrawal, scope changes, OS switches and pagehide cancel without new HTML IDs', async () => {
  for (const stop of [f => f.emit('installConsent', 'change', { target: { checked: false } }),
    f => f.emit('windowsAccessScope', 'change', { target: { value: 'current-account' } }),
    f => f.emit('installOsMacos', 'click'), f => f.life.get('pagehide')?.()]) {
    const f = await setupPage({ send: async message => ({ ...reply('waiting', { automaticConnect: true }), setupId: message.setupId }) });
    await f.administrator(); await f.emit('copyWindowsBrowserCmd', 'click', { isTrusted: true });
    await stop(f); await tick();
    assert.equal(f.messages.filter(value => value.type === types.CANCEL).length, 1);
    assert.equal(f.messages.some(value => value.type === types.CONNECT), false);
  }
});
