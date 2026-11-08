import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceOperationRecoverySettled } from './device-operations.mjs';

const fail = code => { throw new Error(code); };
const encode = paused => Buffer.from(JSON.stringify({ format: 'agent-continue-lifecycle', version: 1, paused }) + '\n');
const pausedBytes = encode(true);
const runningBytes = encode(false);
const unchanged = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

function stateIdentity(file) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.ino === 0n || info.nlink !== 1n ||
      ![pausedBytes.length, runningBytes.length].includes(Number(info.size))) fail('admin_intent_state');
  return info;
}

function readIntent(file) {
  const identity = stateIdentity(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!unchanged(identity, fs.fstatSync(fd, { bigint: true }))) fail('admin_intent_state');
    const buffer = Buffer.alloc(Number(identity.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const length = fs.readSync(fd, buffer, count, buffer.length - count, count);
      if (!length) break;
      count += length;
    }
    const bytes = buffer.subarray(0, count);
    if ((!bytes.equals(pausedBytes) && !bytes.equals(runningBytes)) ||
        !unchanged(identity, fs.fstatSync(fd, { bigint: true })) ||
        !unchanged(identity, stateIdentity(file))) fail('admin_intent_state');
    return { paused: bytes.equals(pausedBytes), identity };
  } finally { fs.closeSync(fd); }
}

function missing(file) {
  try { fs.lstatSync(file); return false; }
  catch (error) { return error.code === 'ENOENT'; }
}

function directories(root, vault) {
  if (typeof root !== 'string' || typeof vault !== 'string' ||
      !path.isAbsolute(root) || !path.isAbsolute(vault) ||
      path.basename(root).match(/^[0-9a-f]{24}\.state$/) === null ||
      vault !== root.slice(0, -6) + '.secrets') fail('admin_intent_layout');
  for (const directory of [root, vault]) {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        fs.realpathSync.native(directory) !== directory) fail('admin_intent_layout');
  }
}

function assertConnectEligible(root, vault, stillAuthorized) {
  if (stillAuthorized() !== true || !missing(path.join(vault, 'owner-revoked'))) fail('admin_intent_unauthorized');
  if (!missing(path.join(vault, 'owner-job.lease')) ||
      !missing(path.join(root, 'controller.lease')) ||
      !missing(path.join(root, 'device-operations.lease')) ||
      !deviceOperationRecoverySettled(root)) fail('admin_intent_unsettled');
}

export function checkAdministratorOwnerConnect(root, vault, stillAuthorized = () => false) {
  directories(root, vault);
  const before = readIntent(path.join(root, 'lifecycle.json'));
  assertConnectEligible(root, vault, stillAuthorized);
  return before.paused;
}

// The elevated caller must hold the protected intent lock across this operation.
export function changeAdministratorOwnerIntent(root, vault, action, stillAuthorized = () => false) {
  if (action !== 'connect' && action !== 'pause') fail('admin_intent_action');
  directories(root, vault);
  const file = path.join(root, 'lifecycle.json');
  const nextPaused = action === 'pause';
  const previous = readIntent(file);
  const assertConnect = () => { if (!nextPaused) assertConnectEligible(root, vault, stillAuthorized); };
  assertConnect();
  if (previous.paused === nextPaused) return nextPaused ? 'already-paused-intent' : 'already-running-intent';

  const candidate = path.join(root, '.admin-intent-' + crypto.randomUUID() + '.tmp');
  let created = false;
  try {
    const fd = fs.openSync(candidate, 'wx', 0o600);
    created = true;
    try {
      fs.writeFileSync(fd, nextPaused ? pausedBytes : runningBytes);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    assertConnect();
    if (!unchanged(previous.identity, stateIdentity(file))) fail('admin_intent_changed');
    fs.renameSync(candidate, file);
    created = false;
    if (readIntent(file).paused !== nextPaused) fail('admin_intent_readback');
  } finally {
    if (created) fs.unlinkSync(candidate);
  }
  return nextPaused ? 'paused-intent-saved' : 'running-intent-saved';
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try {
    const bundle = path.dirname(path.dirname(entry));
    const root = bundle + '.state';
    if (process.argv.length !== 3 || process.execPath !== path.join(bundle, 'runtime', 'node.exe') ||
        process.cwd() !== path.join(root, 'work')) fail('admin_intent_layout');
    const { verifyWindowsAdministratorControlAuthorization } = await import('./windows-admin-owner.mjs');
    const authorized = verifyWindowsAdministratorControlAuthorization(bundle, process.argv[2]);
    checkAdministratorOwnerConnect(root, bundle + '.secrets', authorized);
    process.stdout.write('connect-eligible\n');
  } catch {
    process.exitCode = 2;
  }
}
