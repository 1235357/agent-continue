import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readState } from './runtime.mjs';

const encode = value => JSON.stringify(value) + '\n';
const header = encode({ format: 'agent-continue-device-operations', version: 1 });
const limit = 2 * 1024 * 1024;
const maxOperations = 4096;
const actions = new Set(['status', 'reconnect', 'disconnect-and-pause']);
const mutations = new Set(['reconnect', 'disconnect-and-pause']);
const statuses = new Set(['in-progress', 'unknown-running', 'settled', 'not-executed', 'unknown']);
const terminal = new Set(['settled', 'not-executed']);
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = code => { throw new Error(code); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

export function validateDeviceRequest(value) {
  if (!exact(value, ['version', 'id', 'action']) || value.version !== 1 || !idOK(value.id) || !actions.has(value.action)) {
    fail('invalid_device_request');
  }
  return { version: 1, id: value.id, action: value.action };
}

function regular(file, maximum, code) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.ino === 0n || info.size > BigInt(maximum)) fail(code);
  return info;
}

function readJournal(bytes) {
  try {
    if (!bytes.startsWith(header) || !bytes.endsWith('\n') || Buffer.byteLength(bytes) > limit) fail('invalid_device_journal');
    const operations = new Map();
    for (const line of bytes.slice(header.length).split('\n').slice(0, -1)) {
      const row = JSON.parse(line);
      if (!exact(row, ['id', 'action', 'status']) || !idOK(row.id) || !mutations.has(row.action) ||
          !statuses.has(row.status) || encode(row) !== line + '\n') fail('invalid_device_journal');
      const previous = operations.get(row.id);
      if (!previous ? row.status !== 'in-progress' : previous.action !== row.action ||
          !(previous.status === 'in-progress' && row.status !== 'in-progress' ||
            previous.status === 'unknown-running' && row.status === 'settled')) fail('invalid_device_journal');
      operations.set(row.id, row);
      if (operations.size > maxOperations) fail('invalid_device_journal');
    }
    for (const row of operations.values()) {
      if (row.status === 'in-progress' || row.status === 'unknown-running') row.status = 'unknown';
    }
    return operations;
  } catch { fail('invalid_device_journal'); }
}

export function deviceOperationRecoverySettled(root) {
  const journal = path.join(root, 'device-operations.jsonl');
  let fd;
  try {
    let before;
    try { before = regular(journal, limit, 'invalid_device_journal'); }
    catch (error) { return error.code === 'ENOENT'; }
    fd = fs.openSync(journal, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const matches = info => same(before, info) && info.nlink === 1n && info.size === before.size &&
      info.mtimeNs === before.mtimeNs && info.ctimeNs === before.ctimeNs;
    if (!matches(fs.fstatSync(fd, { bigint: true }))) return false;
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const size = fs.readSync(fd, buffer, count, buffer.length - count, count);
      if (!size) break;
      count += size;
    }
    if (count !== buffer.length - 1 || !matches(fs.fstatSync(fd, { bigint: true })) ||
        !matches(regular(journal, limit, 'invalid_device_journal'))) return false;
    const data = buffer.subarray(0, count);
    const bytes = data.toString('utf8');
    if (!Buffer.from(bytes).equals(data)) return false;
    return Array.from(readJournal(bytes).values()).every(row => terminal.has(row.status));
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Current-user source integration; protected installer/OS ACL verification is separate.
export function openDeviceOperations(root, controller) {
  if (!controller || ['status', 'reconnect', 'pause'].some(key => typeof controller[key] !== 'function')) fail('invalid_device_controller');
  root = readState(root).root;
  const rootIdentity = fs.lstatSync(root, { bigint: true });
  const lease = path.join(root, 'device-operations.lease');
  const journal = path.join(root, 'device-operations.jsonl');
  const leaseBytes = encode({ format: 'agent-continue-device-operation-owner', version: 1, token: crypto.randomUUID() });
  let leaseFD, journalFD, journalIdentity, bytes, operations, closed = false, poisoned = false;
  const active = new Set(), reconcilable = new Set(), notApplied = new Map();
  try { leaseFD = fs.openSync(lease, 'wx+', 0o600); }
  catch (error) { fail(error.code === 'EEXIST' ? 'device_operations_owned' : 'device_lease_failed'); }
  try {
    fs.writeFileSync(leaseFD, leaseBytes);
    fs.fsyncSync(leaseFD);
    try {
      journalFD = fs.openSync(journal, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeFileSync(journalFD, header);
      fs.fsyncSync(journalFD);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      regular(journal, limit, 'invalid_device_journal');
      journalFD = fs.openSync(journal, fs.constants.O_RDWR | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0));
    }
    journalIdentity = regular(journal, limit, 'invalid_device_journal');
    if (!same(journalIdentity, fs.fstatSync(journalFD, { bigint: true }))) fail('invalid_device_journal');
    bytes = fs.readFileSync(journal, 'utf8');
    operations = readJournal(bytes);
  } catch {
    if (journalFD !== undefined) fs.closeSync(journalFD);
    try {
      if (same(fs.fstatSync(leaseFD, { bigint: true }), fs.lstatSync(lease, { bigint: true }))) fs.unlinkSync(lease);
    } finally { fs.closeSync(leaseFD); }
    fail('invalid_device_journal');
  }

  function owned() {
    if (closed) fail('device_operations_closed');
    try {
      if (readState(root).root !== root || !same(rootIdentity, fs.lstatSync(root, { bigint: true })) ||
          !same(fs.fstatSync(leaseFD, { bigint: true }), regular(lease, 1024, 'device_ownership_lost')) ||
          fs.readFileSync(lease, 'utf8') !== leaseBytes) fail('device_ownership_lost');
    } catch { fail('device_ownership_lost'); }
  }

  function journalOwned() {
    owned();
    const info = regular(journal, limit, 'invalid_device_journal');
    if (!same(info, journalIdentity) || !same(info, fs.fstatSync(journalFD, { bigint: true })) ||
        fs.readFileSync(journal, 'utf8') !== bytes) fail('device_journal_changed');
  }

  function canRestoreSavedIntent() {
    if (poisoned) return false;
    try { journalOwned(); }
    catch { poisoned = true; return false; }
    return Array.from(operations.values()).every(row => terminal.has(row.status));
  }

  function append(row, recoveringUnsent = false) {
    if (poisoned && !recoveringUnsent) fail('device_journal_unavailable');
    try {
      journalOwned();
      const addition = encode(row);
      if (Buffer.byteLength(bytes) + Buffer.byteLength(addition) > limit) fail('device_journal_full');
      fs.writeFileSync(journalFD, addition);
      bytes += addition;
      fs.fsyncSync(journalFD);
      operations.set(row.id, row);
    } catch { poisoned = true; fail('device_journal_unavailable'); }
  }

  async function observe() {
    let timer;
    try {
      owned();
      const value = await Promise.race([Promise.resolve().then(() => controller.status()), new Promise(resolve => {
        timer = setTimeout(() => resolve(null), 1000);
      })]);
      owned();
      if (typeof value?.paused !== 'boolean' || typeof value.ready !== 'boolean' ||
          !['stopped', 'failed', 'running', 'unknown', 'starting', 'stopping'].includes(value.runtime)) return null;
      return value;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function response(request, observed, row) {
    const paused = typeof observed?.paused === 'boolean' ? observed.paused : null;
    const connection = ['stopped', 'failed'].includes(observed?.runtime) ? 'disconnected' :
      paused === false && observed?.runtime === 'running' && observed.ready === true ? 'ready' : 'unknown';
    return { ...request, ok: true, state: { paused, connection, ...(row ? { operation: { ...row } } : {}) } };
  }

  async function observedResponse(request) {
    const observed = await observe();
    const unsent = notApplied.get(request.id);
    if (unsent) {
      try {
        journalOwned();
        const retained = readJournal(bytes).get(unsent.id);
        if (retained && retained.action !== unsent.action) fail('device_journal_changed');
        if (!retained) append({ ...unsent, status: 'in-progress' }, true);
        else {
          fs.fsyncSync(journalFD);
          operations.set(unsent.id, { ...unsent, status: retained.status === 'not-executed' ? 'not-executed' : 'in-progress' });
        }
        if (operations.get(unsent.id).status !== 'not-executed') append({ ...unsent, status: 'not-executed' }, true);
        // Only this living owner can prove the failed admission never reached a controller.
        if (notApplied.size === 1 && Array.from(operations.values()).every(row => terminal.has(row.status))) {
          journalOwned();
          fs.fsyncSync(journalFD);
          poisoned = false;
        }
        notApplied.delete(unsent.id);
      } catch { return { ...request, ok: false }; }
    }
    let row = operations.get(request.id);
    if (row?.status === 'unknown-running' && reconcilable.has(row.id) && observed &&
        (row.action === 'disconnect-and-pause' ? observed.paused && observed.runtime === 'stopped' :
          ['running', 'stopped', 'failed'].includes(observed.runtime))) {
      try {
        append({ ...row, status: 'settled' });
        reconcilable.delete(row.id);
        row = operations.get(row.id);
      } catch { row = { ...row, status: 'unknown' }; operations.set(row.id, row); }
    }
    try { journalOwned(); }
    catch { poisoned = true; return { ...request, ok: false }; }
    return response(request, observed, row);
  }

  async function handle(value) {
    const request = validateDeviceRequest(value);
    const rejected = () => ({ ...request, ok: false });
    try { journalOwned(); } catch { poisoned = true; return rejected(); }
    if (request.action === 'status') return observedResponse(request);
    const previous = operations.get(request.id);
    if (previous) return previous.action === request.action ? observedResponse(request) : rejected();
    const unsettled = Array.from(operations.values()).filter(row => !terminal.has(row.status));
    if (poisoned || operations.size >= maxOperations || Buffer.byteLength(bytes) + 4096 > limit ||
        unsettled.length && (request.action !== 'disconnect-and-pause' || unsettled.some(row => row.action === 'disconnect-and-pause'))) return rejected();
    try { append({ id: request.id, action: request.action, status: 'in-progress' }); }
    catch { notApplied.set(request.id, { id: request.id, action: request.action }); return rejected(); }
    active.add(request.id);
    let observed = null, status = 'unknown';
    try {
      observed = await controller[request.action === 'reconnect' ? 'reconnect' : 'pause']();
      owned();
      if (typeof observed?.paused !== 'boolean' || typeof observed.ready !== 'boolean' ||
          !['stopped', 'failed', 'running', 'unknown', 'starting', 'stopping'].includes(observed.runtime)) fail('invalid_device_observation');
      status = ['unknown', 'starting', 'stopping'].includes(observed.runtime) ? 'unknown-running' : 'settled';
      if (status === 'unknown-running') reconcilable.add(request.id);
    } catch { observed = await observe(); }
    finally { active.delete(request.id); }
    const row = { id: request.id, action: request.action, status };
    try { append(row); }
    catch { row.status = 'unknown'; operations.set(row.id, row); reconcilable.delete(row.id); }
    try { journalOwned(); }
    catch { poisoned = true; return rejected(); }
    return response(request, observed, row);
  }

  function close() {
    if (closed) return;
    if (active.size) fail('device_operation_running');
    owned();
    let intact = true;
    try { journalOwned(); } catch { intact = false; }
    if (intact) for (const unsent of Array.from(notApplied.values())) {
      try {
        const retained = readJournal(bytes).get(unsent.id);
        if (retained && retained.action !== unsent.action) fail('device_journal_changed');
        if (!retained) append({ ...unsent, status: 'in-progress' }, true);
        else operations.set(unsent.id, { ...unsent, status: retained.status === 'not-executed' ? 'not-executed' : 'in-progress' });
        if (operations.get(unsent.id).status !== 'not-executed') append({ ...unsent, status: 'not-executed' }, true);
        notApplied.delete(unsent.id);
      } catch { break; }
    }
    try { journalOwned(); } catch { intact = false; }
    // A changed journal must retain its owner fence, even after descriptors close.
    if (intact) fs.unlinkSync(lease);
    fs.closeSync(journalFD);
    fs.closeSync(leaseFD);
    closed = true;
  }
  return Object.freeze({ handle, close, canRestoreSavedIntent });
}
