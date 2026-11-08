// Read-only runtime acceptance probe: one temp owner fixture, the real native host,
// one status frame. It never writes the registry, never installs anything, never
// starts a tunnel and removes its own temp directory unless --keep is passed.
//
// What a pass proves: the host accepted one frame for this binding origin, reached
// the local owner over IPC, authenticated the challenge/request/reply MACs and
// emitted exactly one reply frame. It does not prove Chrome registration, a live
// tunnel, MCP tool authorization or chat authorization.

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareState } from './runtime.mjs';
import { createRegQueryRegistry, formatReport, precheckInstall } from '../bootstrap/runtime-precheck.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');
// Real lifecycle intent defaults to paused when lifecycle.json is absent. This
// flag stages the opposite intent so the probe shows a controller-derived state
// rather than a constant.
const resume = process.argv.includes('--resume');
const extensionId = 'a'.repeat(32);
const origin = 'chrome-extension://' + extensionId + '/';
const precheckIndex = process.argv.indexOf('--precheck');
const precheckMode = precheckIndex > -1;
const precheckRoot = precheckMode ? process.argv[precheckIndex + 1] : null;
const scratch = precheckMode ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'ac-runtime-acceptance-'));
const app = scratch && path.join(scratch, 'app'), stateRoot = scratch && path.join(scratch, 'state');
const bindingFile = scratch && path.join(app, 'device-native-binding.json');
const channelFile = scratch && path.join(stateRoot, 'device-channel.json');
const results = [];
const problems = [];

const log = line => process.stdout.write('[acceptance] ' + line + '\n');
const fail = message => { problems.push(message); log('FAIL ' + message); };
const pass = message => { results.push(message); log('PASS ' + message); };
const encode = value => JSON.stringify(value) + '\n';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function copySources() {
  fs.mkdirSync(app, { mode: 0o700 });
  for (const name of fs.readdirSync(here)) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs')
      || name === 'runtime-acceptance.mjs' || name === 'runtime-precheck.mjs') continue;
    fs.copyFileSync(path.join(here, name), path.join(app, name));
  }
  for (const name of fs.readdirSync(here)) {
    if (name.endsWith('.json')) fs.copyFileSync(path.join(here, name), path.join(app, name));
  }
  const helper = 'windows-process-query.cs';
  fs.copyFileSync(path.join(here, helper), path.join(app, helper));
  if (hash(fs.readFileSync(path.join(here, helper))) !== hash(fs.readFileSync(path.join(app, helper)))) {
    throw new Error('process_helper_copy_not_identical');
  }
  const source = fs.readFileSync(path.join(here, 'device-native-host.mjs'));
  const copy = fs.readFileSync(path.join(app, 'device-native-host.mjs'));
  if (hash(source) !== hash(copy)) throw new Error('host_copy_not_identical');
  log('host_copy_sha256=' + hash(copy));
}

function writeOwnerEntry() {
  const entry = path.join(app, 'acceptance-owner.mjs');
  fs.writeFileSync(entry, `import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDeviceOwner } from './device-owner.mjs';
const binding = path.join(path.dirname(fileURLToPath(import.meta.url)), 'device-native-binding.json');
let owner;
try { owner = await startDeviceOwner(binding); }
catch (error) { process.stderr.write('acceptance_owner_unavailable:' + error.message + '\\n'); process.send?.({ failed: true, message: error.message }); process.exit(1); }
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try { await owner.close(); process.send?.({ closed: true }); } catch { process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}
process.on('message', value => { if (value === 'close') void close(); });
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
process.send?.({ ready: true });
`, { flag: 'wx' });
  return entry;
}

function waitMessage(child, predicate, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('fixture_message_timeout')), milliseconds);
    const received = value => { if (predicate(value)) finish(null, value); };
    const gone = () => finish(new Error('fixture_exited_early'));
    function finish(error, value) {
      clearTimeout(timer); child.off('message', received); child.off('exit', gone);
      if (error) reject(error); else resolve(value);
    }
    child.on('message', received); child.once('exit', gone);
  });
}

function waitExit(child, milliseconds) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    const timer = setTimeout(() => resolve(null), milliseconds);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

function readFrame(stream, milliseconds = 15000) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0), length;
    const timer = setTimeout(() => finish(new Error('frame_timeout')), milliseconds);
    const ended = () => finish(new Error('frame_incomplete'));
    function finish(error, value) {
      clearTimeout(timer); stream.pause();
      stream.off('data', data); stream.off('end', ended); stream.off('close', ended);
      if (error) reject(error); else resolve(value);
    }
    function data(chunk) {
      bytes = Buffer.concat([bytes, chunk]);
      if (length === undefined && bytes.length >= 4) length = bytes.readUInt32LE();
      if (length === undefined || bytes.length < length + 4) return;
      if (bytes.length !== length + 4) return finish(new Error('frame_extra_bytes'));
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4)))); }
      catch { finish(new Error('frame_json')); }
    }
    stream.pause(); stream.on('data', data); stream.once('end', ended); stream.once('close', ended); stream.resume();
  });
}

function frame(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function mac(secret, domain, nonce, ...values) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify([domain, nonce, ...values])).digest('hex');
}

function readChannel() {
  const value = JSON.parse(fs.readFileSync(channelFile, 'utf8'));
  if (!value || value.format !== 'agent-continue-device-channel' || value.version !== 1 ||
      value.extensionId !== extensionId || !/^[a-f0-9]{64}$/.test(value.secret)) {
    throw new Error('channel_shape');
  }
  return value;
}

async function connectOwner(endpoint) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const socket = net.createConnection(endpoint);
    socket.on('error', () => {});
    const connected = await new Promise(resolve => {
      socket.once('connect', () => resolve(true));
      socket.once('error', () => resolve(false));
    });
    if (connected) return socket;
    socket.destroy();
    await sleep(50);
  }
  throw new Error('owner_connect_timeout');
}

// Direct owner probe: this is the only place the reply MAC can be recomputed,
// because the one-time nonce exists only between owner and host.
async function ownerMacProbe(channel) {
  const socket = await connectOwner(channel.endpoint);
  try {
    const challenge = await readFrame(socket, 5000);
    if (!challenge || Object.keys(challenge).sort().join(',') !== 'nonce,version' ||
        challenge.version !== 1 || !/^[a-f0-9]{64}$/.test(challenge.nonce)) {
      throw new Error('challenge_shape');
    }
    const request = { version: 1, id: 'acceptance-mac-probe', action: 'status' };
    await new Promise((resolve, reject) => socket.write(frame({ version: 1, origin, request,
      mac: mac(channel.secret, 'device-request-v1', challenge.nonce, origin, request) }),
    error => error ? reject(error) : resolve()));
    const reply = await readFrame(socket, 15000);
    const keys = Object.keys(reply || {}).sort().join(',');
    if (keys !== 'mac,response,version' || reply.version !== 1) throw new Error('reply_shape');
    if (!reply.response || reply.response.version !== 1 || reply.response.id !== request.id ||
        reply.response.action !== request.action || typeof reply.response.ok !== 'boolean') throw new Error('reply_echo');
    const expected = mac(channel.secret, 'device-response-v1', challenge.nonce, origin, request, reply.response);
    if (reply.mac !== expected) throw new Error('reply_mac');
    pass('owner_mac_recomputed domain=device-request-v1,device-response-v1 ok=' + reply.response.ok);
  } finally { socket.destroy(); }
}

function runHost(args, payload) {
  const child = spawn(process.execPath, [path.join(app, 'device-native-host.mjs'), ...args],
    { cwd: scratch, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  const out = [], error = [];
  child.stdin.on('error', () => {});
  child.stdout.on('data', bytes => out.push(bytes));
  child.stderr.on('data', bytes => error.push(bytes));
  return new Promise(resolve => {
    child.once('error', () => resolve({ code: null, signal: null, out: Buffer.alloc(0), error: 'launch_error' }));
    child.once('close', (code, signal) => resolve({ code, signal,
      out: Buffer.concat(out), error: Buffer.concat(error).toString('utf8') }));
    if (payload !== undefined) child.stdin.write(payload, () => child.stdin.end());
  });
}

function parseReply(result, request) {
  if (result.code !== 0) throw new Error('host_exit_' + result.code);
  if (result.error !== '') throw new Error('host_stderr');
  if (!result.out.length || result.out.length < 4) throw new Error('host_empty_stdout');
  const length = result.out.readUInt32LE();
  if (length < 1 || length > 4096 || result.out.length !== length + 4) throw new Error('host_frame_shape');
  const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.out.subarray(4)));
  const allowed = reply.ok === true
    ? 'action,id,ok,state,version' : 'action,id,ok,version';
  if (Object.keys(reply).sort().join(',') !== allowed) throw new Error('host_reply_keys');
  if (reply.version !== 1 || reply.id !== request.id || reply.action !== request.action ||
      typeof reply.ok !== 'boolean' || 'mac' in reply) throw new Error('host_reply_echo');
  if (reply.ok === true) {
    const state = reply.state;
    const keys = Object.keys(state || {}).sort().join(',');
    if (keys !== 'connection,paused' && keys !== 'connection,operation,paused') throw new Error('host_reply_state_keys');
    if (!['ready', 'disconnected', 'unknown'].includes(state.connection) ||
        !(state.paused === null || typeof state.paused === 'boolean')) throw new Error('host_reply_state');
  }
  return reply;
}

function expectRefusal(result, name) {
  if (result.code !== 1) return fail(name + ': expected exit 1, got ' + result.code + '/' + result.signal);
  if (result.error !== 'device_bridge_unavailable\n') return fail(name + ': stderr=' + JSON.stringify(result.error));
  if (result.out.length !== 0) return fail(name + ': expected empty stdout, got ' + result.out.length + ' bytes');
  return pass(name + ': exit 1 + device_bridge_unavailable + empty stdout');
}

function verifySyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.error) return { ok: false, reason: 'node --check failed: ' + result.error.message };
  if (result.status !== 0) return { ok: false, reason: 'node --check: ' + String(result.stderr || '').trim().split('\n')[0] };
  return { ok: true, reason: 'parses as an ES module (node --check)' };
}

// Read-only: validates a real install root and reads registry defaults. It never
// writes, installs, starts a host or creates a scratch directory.
async function runPrecheck(root) {
  if (!root) throw new Error('--precheck requires an install root path');
  const report = precheckInstall({ root, registry: createRegQueryRegistry(), verifySyntax });
  for (const line of formatReport(report)) log(line);
  log('PRECHECK RESULT pass=' + report.counts.pass + ' fail=' + report.counts.fail
    + ' skip=' + report.counts.skip + ' root=' + report.root);
  log('not proof of Chrome registration, a live tunnel or chat authorization');
  return report.failed ? 1 : 0;
}

async function main() {
  log('scratch=' + scratch);
  copySources();
  prepareState(stateRoot, { consent: 'full-account' });
  if (resume) {
    fs.writeFileSync(path.join(stateRoot, 'lifecycle.json'),
      encode({ format: 'agent-continue-lifecycle', version: 1, paused: false }), { flag: 'wx', mode: 0o600 });
    log('lifecycle_intent=paused:false');
  } else log('lifecycle_intent=default(paused:true)');
  fs.writeFileSync(bindingFile, encode({ format: 'agent-continue-native-binding', version: 1,
    extensionId, stateRoot }), { mode: 0o600, flag: 'wx' });
  const bindingBytes = fs.readFileSync(bindingFile);

  const entry = writeOwnerEntry();
  const owner = fork(entry, [], { cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  ownerChild = owner;
  let ownerError = '';
  owner.stderr.on('data', bytes => { ownerError += bytes.toString('utf8'); });
  await waitMessage(owner, value => value && (value.ready === true || value.failed === true), 10000)
    .then(value => { if (value.failed) throw new Error('owner_fixture_failed:' + value.message); });
  if (ownerError) log('owner_stderr=' + JSON.stringify(ownerError));
  const channel = readChannel();
  const channelBytes = fs.readFileSync(channelFile);
  log('owner_ready endpoint=' + channel.endpoint);

  const request = { version: 1, id: 'acceptance-' + crypto.randomBytes(6).toString('hex'), action: 'status' };
  await ownerMacProbe(channel);

  const extra = process.platform === 'win32' ? ['--parent-window=123456'] : [];
  const result = await runHost([origin, ...extra], frame(request));
  const reply = parseReply(result, request);
  log('host_status_reply=' + JSON.stringify(reply));
  pass('host_handshake exit 0 one frame id+action echo mac-shape ok (request id ' + request.id + ')');

  if (!fs.readFileSync(channelFile).equals(channelBytes)) fail('channel_bytes_changed');
  else pass('channel_bytes_unchanged');
  if (!fs.readFileSync(bindingFile).equals(bindingBytes)) fail('binding_bytes_changed');
  else pass('binding_bytes_unchanged');
  log('channel_file=' + channelFile + ' binding_file=' + bindingFile);

  expectRefusal(await runHost(['chrome-extension://' + 'b'.repeat(32) + '/'], frame(request)), 'wrong_origin');
  expectRefusal(await runHost([origin, '--parent-window=1', 'extra'], frame(request)), 'extra_argument');
  const oversized = Buffer.from(JSON.stringify({ version: 1, id: 'oversized', action: 'status',
    pad: 'x'.repeat(5000) }));
  expectRefusal(await runHost([origin], frame(oversized)), 'oversized_frame');

  if (!fs.readFileSync(channelFile).equals(channelBytes)) fail('channel_changed_after_refusals');
  else pass('channel_unchanged_after_refusals');
  if (!fs.readFileSync(bindingFile).equals(bindingBytes)) fail('binding_changed_after_refusals');
  else pass('binding_unchanged_after_refusals');

  owner.send('close');
  const closed = await waitExit(owner, 10000);
  if (!closed || closed.code !== 0) fail('owner_clean_exit ' + JSON.stringify(closed) + ' stderr=' + JSON.stringify(ownerError));
  else pass('owner_clean_exit code=0');
  if (fs.existsSync(channelFile)) fail('channel_left_behind');
  else pass('channel_removed_on_close');
  for (const name of fs.readdirSync(stateRoot).sort()) log('state_after_close=' + name);
  const leftovers = fs.readdirSync(stateRoot).filter(name => /device-channel\.json|controller\.lease|device-operations\.lease/.test(name));
  if (leftovers.length) fail('transient_files_left ' + leftovers.join(','));
  else pass('no_transient_files_left');

  log('RESULT pass=' + results.length + ' fail=' + problems.length + ' scratch=' + scratch);
  return problems.length ? 1 : 0;
}

let ownerChild = null;

async function shutdown() {
  if (ownerChild && ownerChild.exitCode === null && ownerChild.signalCode === null) {
    try { ownerChild.send('close'); } catch { /* Already gone. */ }
    if (!await waitExit(ownerChild, 3000)) ownerChild.kill();
  }
}

try {
  const code = precheckMode ? await runPrecheck(precheckRoot) : await main();
  process.exitCode = code;
} catch (error) {
  log('ABORT ' + error.message + ' scratch=' + (scratch || '<none>'));
  process.exitCode = 1;
} finally {
  await shutdown();
  if (scratch && !keep) {
    try { fs.rmSync(scratch, { recursive: true, force: true }); log('scratch_removed=' + scratch); }
    catch { log('scratch_cleanup_failed=' + scratch); }
  } else if (scratch) log('scratch_kept=' + scratch);
}
