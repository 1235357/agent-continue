import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readState } from './runtime.mjs';
import { openDeviceOperations, validateDeviceRequest } from './device-operations.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const encode = value => JSON.stringify(value) + '\n';
const fail = code => { throw new Error(code); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ownerIdOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const privateMode = info => process.platform === 'win32' || info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n;
const frameLimit = 4096;

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) ||
      value.startsWith('\\\\') || value.startsWith('//')) fail('invalid_device_binding');
  const resolved = path.resolve(value), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    if (process.platform === 'win32' && part.includes(':')) fail('invalid_device_binding');
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('invalid_device_binding');
  }
  return resolved;
}

function privateRecord(file, json = true) {
  let fd;
  try {
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino === 0n ||
        before.size > 16384n || !privateMode(before)) fail('invalid_device_binding');
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!same(before, fs.fstatSync(fd, { bigint: true }))) fail('invalid_device_binding');
    const buffer = Buffer.alloc(16385); let count = 0, size;
    while (count < buffer.length && (size = fs.readSync(fd, buffer, count, buffer.length - count, count)) > 0) count += size;
    if (count > 16384 || !same(before, fs.lstatSync(file, { bigint: true }))) fail('invalid_device_binding');
    const bytes = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
    if (!json) return { info: before, bytes };
    const value = JSON.parse(bytes);
    if (encode(value) !== bytes) fail('invalid_device_binding');
    return { info: before, bytes, value };
  } catch { fail('invalid_device_binding'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function readNativeBinding(file) {
  try {
    file = localPath(file);
    const retained = privateRecord(file), value = retained.value;
    if (!exact(value, ['format', 'version', 'extensionId', 'stateRoot']) ||
        value.format !== 'agent-continue-native-binding' || value.version !== 1 ||
        typeof value.extensionId !== 'string' || !/^[a-p]{32}$/.test(value.extensionId)) fail('invalid_device_binding');
    const root = readState(localPath(value.stateRoot)).root;
    const identity = fs.lstatSync(root, { bigint: true });
    if (!identity.isDirectory() || identity.ino === 0n || !privateMode(identity)) fail('invalid_device_binding');
    const assertCurrent = () => {
      const current = privateRecord(file), directory = fs.lstatSync(root, { bigint: true });
      if (!same(current.info, retained.info) || current.bytes !== retained.bytes ||
          !same(directory, identity) || !privateMode(directory) || readState(root).root !== root) fail('device_binding_changed');
    };
    return Object.freeze({ root, extensionId: value.extensionId, origin: 'chrome-extension://' + value.extensionId + '/', assertCurrent });
  } catch { fail('invalid_device_binding'); }
}

export function readServerBinding(root) {
  try {
    root = readState(localPath(root)).root;
    const identity = fs.lstatSync(root, { bigint: true });
    if (!identity.isDirectory() || identity.ino === 0n || !privateMode(identity)) fail('invalid_device_binding');
    const assertCurrent = () => {
      try {
        const directory = fs.lstatSync(localPath(root), { bigint: true });
        if (!directory.isDirectory() || !same(directory, identity) || !privateMode(directory) ||
            readState(root).root !== root) fail('device_binding_changed');
      } catch { fail('device_binding_changed'); }
    };
    return Object.freeze({ root, extensionId: null, origin: 'agent-continue-local://server/', assertCurrent });
  } catch { fail('invalid_device_binding'); }
}

export function readSshTarget(file, extensionId, target) {
  try {
    if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId) || !hex(target)) fail('invalid_device_binding');
    file = localPath(file);
    const retained = privateRecord(file), value = retained.value;
    if (!exact(value, ['format', 'version', 'extensionId', 'sshExecutable', 'targets']) ||
        value.format !== 'agent-continue-ssh-targets' || value.version !== 1 || value.extensionId !== extensionId ||
        !Array.isArray(value.targets) || !value.targets.length || value.targets.length > 16) fail('invalid_device_binding');
    const sshExecutable = localPath(value.sshExecutable), executable = fs.lstatSync(sshExecutable, { bigint: true });
    if (!executable.isFile() || executable.ino === 0n) fail('invalid_device_binding');
    const keys = ['host', 'port', 'user', 'node', 'entry', 'stateRoot', 'knownHosts', 'knownHostsSha256'];
    const ids = new Set(); let selected;
    for (const row of value.targets) {
      if (!exact(row, ['id', ...keys]) || !hex(row.id) || ids.has(row.id)) fail('invalid_device_binding');
      const descriptor = Object.fromEntries(keys.map(key => [key, row[key]]));
      const id = crypto.createHash('sha256').update(JSON.stringify([extensionId, descriptor])).digest('hex');
      if (id !== row.id || typeof row.host !== 'string' || !(net.isIP(row.host) ||
          row.host.length <= 253 && row.host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) ||
          !Number.isInteger(row.port) || row.port < 1 || row.port > 65535 || typeof row.user !== 'string' ||
          !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}\$?$/.test(row.user) || !hex(row.knownHostsSha256)) fail('invalid_device_binding');
      for (const key of ['node', 'entry', 'stateRoot']) {
        const remote = row[key];
        if (typeof remote !== 'string' || remote.length > 1024 || remote.startsWith('//') ||
            /[\x00-\x1f\x7f]/.test(remote) || !path.posix.isAbsolute(remote) || path.posix.normalize(remote) !== remote) fail('invalid_device_binding');
      }
      ids.add(id); if (id === target) selected = descriptor;
    }
    if (!selected) fail('invalid_device_binding');
    const knownHosts = localPath(selected.knownHosts);
    // OpenSSH expands tokens/environment even inside quoted UserKnownHostsFile.
    if (/[\x00-\x1f\x7f%$"\\]/.test(process.platform === 'win32' ? knownHosts.replace(/\\/g, '/') : knownHosts)) fail('invalid_device_binding');
    const key = privateRecord(knownHosts, false);
    if (!key.bytes.trim() || crypto.createHash('sha256').update(key.bytes).digest('hex') !== selected.knownHostsSha256) fail('invalid_device_binding');
    const assertCurrent = () => {
      try {
        localPath(file); localPath(knownHosts); localPath(sshExecutable);
        const record = privateRecord(file), currentKey = privateRecord(knownHosts, false);
        const currentExecutable = fs.lstatSync(sshExecutable, { bigint: true });
        if (!same(record.info, retained.info) || record.bytes !== retained.bytes ||
            !same(currentKey.info, key.info) || currentKey.bytes !== key.bytes ||
            !same(currentExecutable, executable) || currentExecutable.size !== executable.size ||
            currentExecutable.mtimeNs !== executable.mtimeNs || currentExecutable.ctimeNs !== executable.ctimeNs) fail('device_binding_changed');
      } catch { fail('device_binding_changed'); }
    };
    return Object.freeze({ target, extensionId, sshExecutable, ...selected, knownHosts, assertCurrent });
  } catch { fail('invalid_device_binding'); }
}

// All supported release targets are little-endian. Never silently misframe another architecture.
export function readFrame(stream, timeoutMs = 15000, signal) {
  if (os.endianness() !== 'LE') return Promise.reject(new Error('unsupported_device_byte_order'));
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0), length;
    const timer = timeoutMs === null ? null : setTimeout(() => finish(new Error('device_frame_timeout')), timeoutMs);
    const ended = () => finish(new Error('invalid_device_frame'));
    function finish(error, value) {
      clearTimeout(timer); stream.pause();
      stream.off('data', data); stream.off('end', ended); stream.off('close', ended); stream.off('error', ended);
      signal?.removeEventListener('abort', ended);
      if (error) reject(error); else resolve(value);
    }
    function data(chunk) {
      if (bytes.length + chunk.length > frameLimit + 4) return finish(new Error('invalid_device_frame'));
      bytes = Buffer.concat([bytes, chunk]);
      if (length === undefined && bytes.length >= 4) {
        length = bytes.readUInt32LE();
        if (!length || length > frameLimit) return finish(new Error('invalid_device_frame'));
      }
      if (length === undefined || bytes.length < length + 4) return;
      if (bytes.length !== length + 4) return finish(new Error('invalid_device_frame'));
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4)))); }
      catch { finish(new Error('invalid_device_frame')); }
    }
    stream.pause(); stream.on('data', data); stream.once('end', ended); stream.once('close', ended); stream.once('error', ended);
    signal?.addEventListener('abort', ended, { once: true });
    if (stream.destroyed || stream.readableEnded || signal?.aborted) ended(); else stream.resume();
  });
}

export function writeFrame(stream, value) {
  if (os.endianness() !== 'LE') return Promise.reject(new Error('unsupported_device_byte_order'));
  const body = Buffer.from(JSON.stringify(value)), length = Buffer.alloc(4);
  if (!body.length || body.length > frameLimit) return Promise.reject(new Error('invalid_device_frame'));
  length.writeUInt32LE(body.length);
  return new Promise((resolve, reject) => stream.write(Buffer.concat([length, body]), error => error ? reject(new Error('device_transport_failed')) : resolve()));
}

const mac = (secret, domain, nonce, ...values) => crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
  .update(JSON.stringify([domain, nonce, ...values])).digest('hex');
const authenticated = (a, b) => hex(a) && hex(b) && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const channelPath = binding => path.join(binding.root, 'device-channel.json');

function checkChannel(binding, record) {
  const value = record.value;
  const keys = ['format', 'version', 'extensionId', 'endpoint', 'secret'];
  const browserOwned = Object.hasOwn(value || {}, 'browserOwnerId');
  if (!exact(value, browserOwned ? [...keys, 'browserOwnerId'] : keys) ||
      browserOwned && (!ownerIdOK(value.browserOwnerId) || binding.extensionId === null) ||
      value.format !== 'agent-continue-device-channel' || value.version !== 1 || value.extensionId !== binding.extensionId ||
      typeof value.endpoint !== 'string' || !hex(value.secret)) fail('invalid_device_channel');
  if (process.platform === 'win32' ? !/^\\\\\.\\pipe\\agentcontinue-device-[a-f0-9]{32}$/.test(value.endpoint) :
    path.dirname(value.endpoint) !== binding.root || !/^device-[a-f0-9]{32}\.sock$/.test(path.basename(value.endpoint))) fail('invalid_device_channel');
  return value;
}

export function responseValid(response, request) {
  if (!exact(response, response?.ok === true ? ['version', 'id', 'action', 'ok', 'state'] : ['version', 'id', 'action', 'ok']) ||
      response.version !== 1 || response.id !== request.id || response.action !== request.action || typeof response.ok !== 'boolean') return false;
  if (!response.ok) return true;
  const state = response.state;
  if (!exact(state, Object.hasOwn(state || {}, 'operation') ? ['paused', 'connection', 'operation'] : ['paused', 'connection']) ||
      state.paused !== null && typeof state.paused !== 'boolean' || !['ready', 'disconnected', 'unknown'].includes(state.connection)) return false;
  if (Object.hasOwn(state, 'operation')) {
    const op = state.operation;
    if (!exact(op, ['id', 'action', 'status']) || op.id !== request.id || !['reconnect', 'disconnect-and-pause'].includes(op.action) ||
        request.action !== 'status' && op.action !== request.action || !['in-progress', 'unknown-running', 'settled', 'not-executed', 'unknown'].includes(op.status)) return false;
  } else if (request.action !== 'status') return false;
  return true;
}

export function pinDeviceChannel(binding) {
  binding.assertCurrent();
  const file = channelPath(binding), retained = privateRecord(file);
  checkChannel(binding, retained);
  const assertCurrent = () => {
    binding.assertCurrent();
    const current = privateRecord(file);
    if (!same(current.info, retained.info) || current.bytes !== retained.bytes) fail('device_channel_changed');
  };
  assertCurrent();
  return Object.freeze({ ...binding, assertCurrent });
}

export async function sendDeviceRequest(binding, value, options = {}) {
  return sendPinnedRequest(binding, value, options);
}

export async function sendExistingBrowserControl(binding, ownerId, value, options = {}) {
  const request = validateDeviceRequest(value);
  if (!ownerIdOK(ownerId) || !['status', 'disconnect-and-pause'].includes(request.action)) fail('invalid_browser_control');
  return sendPinnedRequest(binding, request, options, ownerId);
}

async function sendPinnedRequest(binding, value, options, browserOwnerId) {
  if ((!exact(options, []) && !exact(options, ['timeoutMs'])) ||
      (Object.hasOwn(options, 'timeoutMs') && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000))) fail('invalid_device_request_options');
  const request = validateDeviceRequest(value);
  binding.assertCurrent();
  const retained = privateRecord(channelPath(binding)), channel = checkChannel(binding, retained);
  // Association is checked on the exact snapshot used for endpoint and MAC, never a second adoption read.
  if (browserOwnerId !== undefined && channel.browserOwnerId !== browserOwnerId) fail('device_browser_owner_mismatch');
  const current = () => {
    binding.assertCurrent();
    const record = privateRecord(channelPath(binding));
    if (!same(record.info, retained.info) || record.bytes !== retained.bytes) fail('device_channel_changed');
  };
  const socket = net.createConnection(channel.endpoint); socket.on('error', () => {});
  let expired = false;
  // One deadline spans connect, challenge, write and reply; no command is replayed.
  const timer = options.timeoutMs === undefined ? null : setTimeout(() => {
    expired = true; socket.destroy();
  }, options.timeoutMs);
  try {
    const challenge = await readFrame(socket);
    if (!exact(challenge, ['version', 'nonce']) || challenge.version !== 1 || !hex(challenge.nonce)) fail('invalid_device_challenge');
    current();
    await writeFrame(socket, { version: 1, origin: binding.origin, request,
      mac: mac(channel.secret, 'device-request-v1', challenge.nonce, binding.origin, request) });
    const reply = await readFrame(socket);
    current();
    if (!exact(reply, ['version', 'response', 'mac']) || reply.version !== 1 || !responseValid(reply.response, request) ||
        !authenticated(reply.mac, mac(channel.secret, 'device-response-v1', challenge.nonce, binding.origin, request, reply.response))) fail('invalid_device_response');
    return reply.response;
  } catch (error) {
    if (expired) fail('device_request_timeout');
    throw error;
  } finally { if (timer !== null) clearTimeout(timer); socket.destroy(); }
}

// Explicit current-user owners; installation, OS elevation and native registration are separate.
export async function startDeviceOwner(bindingFile, options = {}) {
  return startOwner(readNativeBinding(bindingFile), options);
}

export async function startServerOwner(root, options = {}) {
  if (options?.resumeOnLogin === true) fail('device_server_login_unverified');
  return startOwner(readServerBinding(root), options);
}

async function startOwner(binding, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['controller', 'resumeOnLogin', 'signal', 'expectedOrigin', 'browserOwnerId'].includes(key)) ||
      Object.hasOwn(options, 'resumeOnLogin') && typeof options.resumeOnLogin !== 'boolean' ||
      Object.hasOwn(options, 'signal') && !(options.signal instanceof AbortSignal) ||
      Object.hasOwn(options, 'expectedOrigin') && options.expectedOrigin !== binding.origin ||
      Object.hasOwn(options, 'browserOwnerId') && (!ownerIdOK(options.browserOwnerId) || binding.extensionId === null ||
        options.expectedOrigin !== binding.origin || options.resumeOnLogin === true)) fail('invalid_device_owner_options');
  const signal = options.signal;
  if (signal?.aborted) fail('device_owner_unavailable');
  binding.assertCurrent();
  const file = channelPath(binding);
  let fd, controller, operations, server, socketIdentity, retained, closing = false, finalizing = false, closePromise, quiescence;
  const clients = new Set(), active = new Set();
  const id = crypto.randomBytes(16).toString('hex');
  const channel = { format: 'agent-continue-device-channel', version: 1, extensionId: binding.extensionId,
    endpoint: process.platform === 'win32' ? '\\\\.\\pipe\\agentcontinue-device-' + id : path.join(binding.root, 'device-' + id + '.sock'),
    secret: crypto.randomBytes(32).toString('hex'),
    ...(Object.hasOwn(options, 'browserOwnerId') ? { browserOwnerId: options.browserOwnerId } : {}) };
  const bytes = encode(channel);
  function owned(checkSocket = true) {
    binding.assertCurrent();
    const current = privateRecord(file);
    if (!same(current.info, retained.info) || !same(current.info, fs.fstatSync(fd, { bigint: true })) || current.bytes !== bytes) fail('device_channel_changed');
    if (checkSocket && process.platform !== 'win32') {
      const info = fs.lstatSync(channel.endpoint, { bigint: true });
      if (!info.isSocket() || !same(info, socketIdentity) || !privateMode(info)) fail('device_channel_changed');
    }
  }
  async function requestOwned(value) {
    const request = validateDeviceRequest(value);
    owned();
    if (finalizing || closing && request.action === 'reconnect') fail('device_owner_closing');
    const task = operations.handle(request); active.add(task);
    let response;
    try { response = await task; } finally { active.delete(task); }
    owned();
    if (!responseValid(response, request)) fail('invalid_device_response');
    return response;
  }
  async function serve(socket) {
    socket.on('error', () => {});
    if (finalizing || clients.size >= 32) { socket.destroy(); return; }
    clients.add(socket); socket.once('close', () => clients.delete(socket));
    try {
      owned();
      const nonce = crypto.randomBytes(32).toString('hex');
      await writeFrame(socket, { version: 1, nonce });
      const message = await readFrame(socket, 5000);
      if (!exact(message, ['version', 'origin', 'request', 'mac']) || message.version !== 1 || message.origin !== binding.origin) fail('invalid_device_authentication');
      const request = validateDeviceRequest(message.request);
      if (!authenticated(message.mac, mac(channel.secret, 'device-request-v1', nonce, binding.origin, request))) fail('invalid_device_authentication');
      const response = await requestOwned(request);
      await writeFrame(socket, { version: 1, response,
        mac: mac(channel.secret, 'device-response-v1', nonce, binding.origin, request, response) });
      socket.end();
    } catch { socket.destroy(); }
  }
  try {
    fd = fs.openSync(file, 'wx+', 0o600);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); retained = privateRecord(file);
    controller = options.controller || (await import('./lifecycle.mjs')).openController(binding.root, { deferStartup: true });
    if (typeof controller?.dispose !== 'function' || Object.hasOwn(options, 'browserOwnerId') &&
        typeof controller.beginQuiesce !== 'function') fail('invalid_device_controller');
    operations = openDeviceOperations(binding.root, controller);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); fail('device_owner_unavailable'); }
    if (options.resumeOnLogin === true && operations.canRestoreSavedIntent()) {
      const state = await controller.status();
      owned(false);
      // The legacy start flag carries no login evidence for a temporary pause.
      if (state.paused === true && state.pauseMode !== 'until-next-login' && operations.canRestoreSavedIntent()) {
        await controller.reconnect();
      }
      owned(false);
    }
    server = net.createServer(socket => { void serve(socket); });
    await new Promise((resolve, reject) => {
      const error = () => reject(new Error('device_channel_unavailable'));
      server.once('error', error); server.listen(channel.endpoint, () => { server.off('error', error); resolve(); });
    });
    server.on('error', () => { onAbort(); for (const socket of clients) socket.destroy(); });
    if (process.platform !== 'win32') {
      fs.chmodSync(channel.endpoint, 0o600); socketIdentity = fs.lstatSync(channel.endpoint, { bigint: true });
    }
    owned();
    if (signal?.aborted) fail('device_owner_unavailable');
    // An unfinished receipt or a changed journal must not trigger a fresh connection.
    const startup = Promise.resolve(controller.startSavedIntent?.(() => {
      if (closing || signal?.aborted) return false;
      try { owned(); } catch { return false; }
      return operations.canRestoreSavedIntent();
    }));
    active.add(startup);
    void startup.then(() => active.delete(startup), () => active.delete(startup));
  } catch {
    signal?.removeEventListener('abort', onAbort);
    for (const socket of clients) socket.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    let clean = true;
    try { await controller?.dispose(); operations?.close(); } catch { clean = false; }
    if (fd !== undefined) {
      try { if (clean && same(fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true }))) fs.unlinkSync(file); } catch { /* Retain changed or incomplete ownership. */ }
      fs.closeSync(fd);
    }
    fail('device_owner_unavailable');
  }
  function beginQuiesce() {
    if (closing) return quiescence;
    closing = true;
    // Admission is latched before calling a potentially reentrant lifecycle stop.
    let resolve, reject;
    quiescence = new Promise((yes, no) => { resolve = yes; reject = no; });
    try { Promise.resolve(controller.beginQuiesce?.()).then(resolve, reject); }
    catch (error) { reject(error); }
    void quiescence.catch(() => {});
    return quiescence;
  }
  function onAbort() { void beginQuiesce(); }
  async function confirmQuiescence() {
    const result = await quiescence;
    // Legacy injected controllers retain their dispose contract; native lifecycle owners supply stop proof.
    if (typeof controller.beginQuiesce !== 'function') return;
    const confirmed = value => value?.runtime === 'stopped' && value.ready === false && typeof value.paused === 'boolean';
    if (confirmed(result)) return;
    let timer;
    try {
      const observed = await Promise.race([Promise.resolve().then(() => controller.status()), new Promise(resolve => {
        timer = setTimeout(() => resolve(null), 1000);
      })]);
      if (!confirmed(observed)) fail('stop_unconfirmed');
    } finally { clearTimeout(timer); }
  }
  function close() {
    if (closePromise) return closePromise;
    beginQuiesce();
    closePromise = (async () => {
      await confirmQuiescence();
      // Keep authenticated observation/Pause alive while any admitted operation is unresolved.
      while (active.size) await Promise.allSettled(Array.from(active));
      finalizing = true;
      const stopped = new Promise(resolve => server.close(resolve));
      for (const socket of clients) socket.destroy();
      await stopped;
      try {
        // Stop only this owner's controller even when the IPC descriptor lost ownership.
        // Its own lifecycle lease decides whether stopping is still authorized.
        await controller.dispose();
        owned(false);
        operations.close();
        owned(false); fs.unlinkSync(file);
      } finally { signal?.removeEventListener('abort', onAbort); fs.closeSync(fd); }
    })().catch(error => {
      if (!finalizing) closePromise = undefined;
      throw error;
    });
    return closePromise;
  }
  return Object.freeze({ close, beginQuiesce, request: requestOwned });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let owner;
  try {
    const resumeOnLogin = process.argv.length === 3 && process.argv[2] === '--resume-on-login';
    if (process.argv.length !== 2 && !resumeOnLogin) fail('invalid_device_owner_arguments');
    owner = await startDeviceOwner(path.join(path.dirname(fileURLToPath(import.meta.url)), 'device-native-binding.json'), { resumeOnLogin });
    let stopping = false;
    const stop = () => {
      if (stopping) return; stopping = true;
      void owner.close().catch(() => { process.exitCode = 1; process.stderr.write('device_owner_stop_unconfirmed\n'); });
    };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } catch { process.exitCode = 1; process.stderr.write('device_owner_unavailable\n'); }
}
