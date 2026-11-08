import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const admittedBytes = 'admitted\n';
const exactAdmittedBytes = 'admitted-exact\n';
const preparedAdmittedBytes = 'admitted-prepared\n';
const revokedPreparedBytes = 'revoked-prepared\n';
export const providerResult = 'provider-reported-result';
export const providerError = 'provider-reported-error';
const blockedByLocalControl = 'blocked-by-local-control';

function inspectDirectory(dir) {
  const info = fs.lstatSync(dir, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n) throw new Error('invalid_operation_directory');
  return info;
}

function expectDirectory(dir, identity) {
  const current = inspectDirectory(dir);
  if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('operation_directory_changed');
}

function operationFile(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.ino === 0n || info.nlink !== 1n || info.size > 64n) {
    throw new Error('invalid_operation_receipt');
  }
  return info;
}

function expectFile(info, expected) {
  operationFile(info);
  if (info.ino !== expected.ino || info.dev !== expected.dev) throw new Error('operation_receipt_changed');
}

function readReceipt(fd) {
  const bytes = Buffer.alloc(65);
  const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
  if (size >= bytes.length) throw new Error('invalid_operation_receipt');
  return bytes.toString('utf8', 0, size);
}

export function createOperationReceipts(root) {
  const directory = path.join(root, 'mcp-operation-receipts');
  const rootIdentity = inspectDirectory(root);
  let directoryIdentity, count;
  function ensureDirectory(create) {
    expectDirectory(root, rootIdentity);
    if (!directoryIdentity) {
      if (create) {
        try { fs.mkdirSync(directory, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      try { directoryIdentity = inspectDirectory(directory); }
      catch (error) { if (!create && error.code === 'ENOENT') return false; throw error; }
    }
    expectDirectory(directory, directoryIdentity);
    return true;
  }
  const fileFor = id => path.join(directory, createHash('sha256').update(id).digest('hex') + '.admitted');
  function reserve(id, kind) {
    ensureDirectory(true);
    count ??= fs.readdirSync(directory).length;
    const file = fileFor(id);
    if (count >= 16384) {
      if (fs.existsSync(file)) return false;
      throw new Error('operation_receipt_limit');
    }
    let fd, identity;
    try { fd = fs.openSync(file, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    count++;
    const prefix = kind === 'revoke-prepared-process' ? revokedPreparedBytes :
      kind === 'prepared-process' ? preparedAdmittedBytes :
      kind === 'exact-process' ? exactAdmittedBytes : admittedBytes;
    try {
      fs.writeFileSync(fd, prefix);
      fs.fsyncSync(fd);
      identity = operationFile(fs.fstatSync(fd, { bigint: true }));
    } finally { fs.closeSync(fd); }
    if (process.platform !== 'win32') {
      for (const dir of [directory, root]) {
        const handle = fs.openSync(dir, 'r');
        try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
      }
    }
    ensureDirectory(false);
    expectFile(fs.lstatSync(file, { bigint: true }), identity);
    return { file, identity, prefix };
  }
  function lookup(id) {
    try {
      if (!ensureDirectory(false)) return { status: 'not-recorded' };
      const file = fileFor(id);
      let identity;
      try { identity = operationFile(fs.lstatSync(file, { bigint: true })); }
      catch (error) { if (error.code === 'ENOENT') return { status: 'not-recorded' }; throw error; }
      const fd = fs.openSync(file, 'r');
      try {
        expectFile(fs.fstatSync(fd, { bigint: true }), identity);
        const bytes = readReceipt(fd);
        ensureDirectory(false);
        expectFile(fs.lstatSync(file, { bigint: true }), identity);
        if (bytes === revokedPreparedBytes) return { status: 'owner-revoked', requestKind: 'prepared-process' };
        const prefix = bytes.startsWith(preparedAdmittedBytes) ? preparedAdmittedBytes :
          bytes.startsWith(exactAdmittedBytes) ? exactAdmittedBytes : admittedBytes;
        const kind = prefix === preparedAdmittedBytes ? { requestKind: 'prepared-process' } :
          prefix === exactAdmittedBytes ? { requestKind: 'exact-process' } : {};
        if (bytes === prefix) return { status: 'admitted-outcome-unconfirmed', ...kind };
        for (const status of [providerResult, providerError, blockedByLocalControl]) {
          if (bytes === prefix + status + '\n') return { status, ...kind };
        }
      } finally { fs.closeSync(fd); }
    } catch { /* An inaccessible or changed receipt is not negative evidence. */ }
    return { status: 'receipt-unavailable' };
  }
  function settle({ file, identity, prefix }, status) {
    if (prefix === revokedPreparedBytes) {
      throw new Error('invalid_operation_receipt_response');
    }
    ensureDirectory(false);
    expectFile(fs.lstatSync(file, { bigint: true }), identity);
    const fd = fs.openSync(file, 'r+');
    try {
      expectFile(fs.fstatSync(fd, { bigint: true }), identity);
      if (readReceipt(fd) !== prefix) throw new Error('operation_receipt_changed');
      const suffix = Buffer.from(status + '\n');
      if (fs.writeSync(fd, suffix, 0, suffix.length, prefix.length) !== suffix.length) {
        throw new Error('operation_receipt_write_incomplete');
      }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  function recordResponse(receipt, status) {
    if (![providerResult, providerError].includes(status)) throw new Error('invalid_operation_receipt_response');
    settle(receipt, status);
  }
  const recordBlocked = receipt => settle(receipt, blockedByLocalControl);
  return { reserve, lookup, recordResponse, recordBlocked };
}
