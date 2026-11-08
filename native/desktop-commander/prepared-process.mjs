import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOperationReceipts } from './operation-receipts.mjs';

export const operationField = 'agent_continue_operation_id';
export const processDigestField = 'agent_continue_process_sha256';
export const operationPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const processDigestPattern = '^[0-9a-f]{64}$';
const idPattern = new RegExp(operationPattern), digestPattern = new RegExp(processDigestPattern);
export const validOperationId = value => typeof value === 'string' && value.length === 36 && idPattern.test(value);
const validDigest = value => typeof value === 'string' && value.length === 64 && digestPattern.test(value);
const commandFields = ['command', 'shell', 'timeout_ms'];
const referenceFields = [operationField, processDigestField];
const limit = 256 * 1024;
const lifetime = 30 * 60 * 1000;
const format = 'agent-continue-prepared-process';
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const invalid = () => { throw new Error('prepared_process_invalid'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const same = (a, b) => a.ino === b.ino && a.dev === b.dev;

function validateCommand(value) {
  if (!exact(value, commandFields)) invalid();
  const { command, shell, timeout_ms } = value;
  if (typeof command !== 'string' || !command.trim() || command.length > 24000 || command.includes('\0') ||
      !command.isWellFormed() || typeof shell !== 'string' || shell.length > 4096 || shell !== shell.trim() ||
      /[\x00-\x1f]/.test(shell) || !shell.isWellFormed() ||
      !(process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(shell) : path.isAbsolute(shell)) ||
      !Number.isSafeInteger(timeout_ms) || timeout_ms < 1) invalid();
  return { command, shell, timeout_ms };
}

function digestOf({ command, shell, timeout_ms }) { return hash(JSON.stringify([command, shell, timeout_ms])); }

export function validateProcessReference(value) {
  return exact(value, referenceFields) && validOperationId(value[operationField]) && validDigest(value[processDigestField]);
}

function directory(dir) {
  const info = fs.lstatSync(dir, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n) invalid();
  return info;
}

function readJson(file) {
  const isFile = info => info.isFile() && !info.isSymbolicLink() && info.ino !== 0n && info.nlink === 1n && info.size <= BigInt(limit);
  const before = fs.lstatSync(file, { bigint: true });
  if (!isFile(before)) invalid();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!isFile(opened) || !same(before, opened)) invalid();
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!n) break;
      length += n;
    }
    const after = fs.lstatSync(file, { bigint: true });
    if (length > limit || !isFile(after) || !same(opened, after) || after.size !== BigInt(length) ||
        after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) invalid();
    return JSON.parse(decoder.decode(bytes.subarray(0, length)));
  } finally { fs.closeSync(fd); }
}

export function reviewProcessFile(file) {
  if (!path.isAbsolute(file)) invalid();
  return digestOf(validateCommand(readJson(file)));
}

export function openPreparedProcesses(root) {
  const rootIdentity = directory(root);
  const dir = path.join(root, 'prepared-processes');
  function observe(create = false) {
    if (!same(directory(root), rootIdentity)) invalid();
    if (create) {
      try { fs.mkdirSync(dir, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return directory(dir);
  }
  const filename = id => path.join(dir, id + '.json');
  function stage(file, reviewedDigest) {
    if (!path.isAbsolute(file) || !validDigest(reviewedDigest)) invalid();
    const command = validateCommand(readJson(file));
    if (digestOf(command) !== reviewedDigest) invalid();
    const dirIdentity = observe(true);
    if (fs.readdirSync(dir).length >= 4096) invalid();
    const id = randomUUID(), expiresAt = Date.now() + lifetime;
    const reference = { [operationField]: id, [processDigestField]: reviewedDigest };
    const entry = { format, version: 1, ...reference, expiresAt, request: command };
    const bytes = JSON.stringify(entry) + '\n';
    if (Buffer.byteLength(bytes) > limit) invalid();
    const fd = fs.openSync(filename(id), 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    if (!same(observe(), dirIdentity)) invalid();
    if (process.platform !== 'win32') for (const name of [dir, root]) {
      const handle = fs.openSync(name, 'r');
      try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    }
    return { ...reference, expiresAt };
  }
  function review(reference) {
    if (!validateProcessReference(reference)) invalid();
    const id = reference[operationField], digest = reference[processDigestField];
    const identity = observe();
    const entry = readJson(filename(id));
    if (!same(observe(), identity) ||
        !exact(entry, ['format', 'version', ...referenceFields, 'expiresAt', 'request']) ||
        entry.format !== format || entry.version !== 1 || entry[operationField] !== id ||
        entry[processDigestField] !== digest || !Number.isSafeInteger(entry.expiresAt)) invalid();
    const args = validateCommand(entry.request);
    if (digestOf(args) !== digest) invalid();
    return { args, expiresAt: entry.expiresAt };
  }
  function lookup(reference) {
    const { args, expiresAt } = review(reference);
    const now = Date.now();
    if (expiresAt <= now || expiresAt > now + lifetime) invalid();
    const id = reference[operationField];
    return { ...args, [operationField]: id };
  }
  function revoke(reference) {
    review(reference);
    const id = reference[operationField];
    const receipts = createOperationReceipts(root);
    // The same create-only slot is claimed by dispatch. Never stop or
    // relabel a process once an execution path already owns the slot.
    const reserved = receipts.reserve(id, 'revoke-prepared-process');
    const { status } = receipts.lookup(id);
    if (reserved && status !== 'owner-revoked') invalid();
    return { [operationField]: id, revoked: status === 'owner-revoked', status };
  }
  function inspect(reference) {
    const { expiresAt } = review(reference);
    const { status } = createOperationReceipts(root).lookup(reference[operationField]);
    const now = Date.now();
    return { expiresAt, status: status !== 'not-recorded' ? status :
      expiresAt <= now || expiresAt > now + lifetime ? 'expired' : 'staged' };
  }
  return Object.freeze({ stage, lookup, revoke, inspect });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, ...args] = process.argv.slice(2);
    let result;
    if (action === 'inspect' && args.length === 2 && args[0] === '--request-file') {
      result = { [processDigestField]: reviewProcessFile(args[1]), staged: false, executed: false };
    } else if (action === 'stage' && args.length === 6 && args[0] === '--state-dir' &&
        args[2] === '--request-file' && args[4] === '--reviewed-sha256') {
      const { readState } = await import('./runtime.mjs');
      result = { ...openPreparedProcesses(readState(args[1]).root).stage(args[3], args[5]), staged: true, executed: false };
    } else if (action === 'revoke' && args.length === 6 && args[0] === '--state-dir' &&
        args[2] === '--operation-id' && args[4] === '--reviewed-sha256') {
      const { readState } = await import('./runtime.mjs');
      result = openPreparedProcesses(readState(args[1]).root).revoke(
        { [operationField]: args[3], [processDigestField]: args[5] });
      if (!result.revoked) process.exitCode = 2;
    } else invalid();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    process.stderr.write('prepared_process_invalid\n');
    process.exitCode = 1;
  }
}
