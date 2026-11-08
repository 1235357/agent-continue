// Read-only install pre-check. This module never writes a registry value, never
// installs, never starts the native host or an owner and never creates files.
// Registry access is injected: tests pass a fake, the CLI passes structured reads
// (a missing key is the normal pre-registration state, not a failure).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { registrationPlan } from './registration-plan.mjs';
import { createWinRegistry } from './registry-win.mjs';

export const HOST_NAME = 'com.agentcontinue.device_control';
export const HOST_DESCRIPTION = 'Agent Continue device lifecycle bridge';
export const PAYLOAD_MANIFEST = 'payload-manifest.json';
const PAYLOAD_FORMAT = 'agent-continue-payload';
const TARGETS = Object.freeze([Object.freeze(['HKCU', '32']), Object.freeze(['HKCU', '64']),
  Object.freeze(['HKLM', '32']), Object.freeze(['HKLM', '64'])]);
const BINDING_KEYS = 'extensionId,format,stateRoot,version';
const CHANNEL_KEYS = 'endpoint,extensionId,format,secret,version';
const MANIFEST_KEYS = 'allowed_origins,description,name,path,type';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const keysOf = value => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.keys(value).sort().join(',') : '<not an object>');
const samePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

function regular(file) {
  const info = fs.lstatSync(file, { bigint: true });
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('not a regular file');
  return info;
}

function readBinding(file) {
  let bytes;
  try { bytes = fs.readFileSync(file, 'utf8'); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? 'missing device-native-binding.json' : 'unreadable device-native-binding.json'); }
  const value = JSON.parse(bytes);
  if (bytes !== JSON.stringify(value) + '\n') throw new Error('bytes are not canonical JSON+newline');
  if (keysOf(value) !== BINDING_KEYS) throw new Error('keys are ' + keysOf(value));
  if (value.format !== 'agent-continue-native-binding' || value.version !== 1) throw new Error('format/version');
  if (typeof value.extensionId !== 'string' || !/^[a-p]{32}$/.test(value.extensionId)) throw new Error('extensionId is not 32 chars in a-p');
  if (typeof value.stateRoot !== 'string' || !path.isAbsolute(value.stateRoot)) throw new Error('stateRoot is not absolute');
  return value;
}

// The only integrity truth is the payload manifest staged next to the install
// root: [{path, bytes, sha256}]. No directory is ever used as an implicit
// reference; `options.reference` is an absolute path to another manifest file.
function readPayloadManifest(file) {
  const bytes = fs.readFileSync(file, 'utf8');
  const value = JSON.parse(bytes);
  if (bytes !== JSON.stringify(value) + '\n') throw new Error('bytes are not canonical JSON+newline');
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== PAYLOAD_FORMAT ||
      value.version !== 1 || !Array.isArray(value.files) || !value.files.length ||
      value.files.length > 4096) throw new Error('shape (format/version/files)');
  const records = new Map();
  for (const record of value.files) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).sort().join(',') !== 'bytes,path,sha256' ||
        typeof record.path !== 'string' || !record.path || path.isAbsolute(record.path) ||
        record.path.includes('/') || record.path.includes('\\') || records.has(record.path) ||
        !Number.isInteger(record.bytes) || record.bytes < 0 || record.bytes > 4 * 1024 * 1024 ||
        typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('entry');
    records.set(record.path, record);
  }
  return records;
}

function finish(checks, root) {
  const pass = checks.filter(check => check.status === 'PASS').length;
  const fail = checks.filter(check => check.status === 'FAIL').length;
  const skip = checks.filter(check => check.status === 'SKIP').length;
  return Object.freeze({ root: root || null, checks: Object.freeze(checks.map(check => Object.freeze(check))),
    failed: fail, counts: Object.freeze({ pass, fail, skip }) });
}

export function formatReport(report) {
  return report.checks.map(check => check.status + ' ' + check.id + ': ' + check.reason);
}

// Share structured read semantics with registration, but expose no write methods.
export function createRegQueryRegistry(run = spawnSync) {
  const registry = createWinRegistry(run);
  return Object.freeze({
    get(plan) {
      if (process.platform !== 'win32') throw new Error('registry_query_unsupported');
      return registry.get(plan);
    },
  });
}

export function precheckInstall(options = {}) {
  const checks = [];
  const add = (id, status, reason, kind) => checks.push({ id, status, reason, ...(kind ? { kind } : {}) });
  let root = null, app = null, state = null, binding = null, origin = null, manifest = null;

  try {
    if (typeof options.root !== 'string' || !path.isAbsolute(options.root)) throw new Error('install root must be an absolute path');
    root = path.resolve(options.root);
    const info = fs.lstatSync(root, { bigint: true });
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('install root is not a directory');
    add('install_root', 'PASS', root);
  } catch (error) {
    add('install_root', 'FAIL', error.message);
    return finish(checks, options.root);
  }

  app = path.join(root, 'app');
  state = path.join(root, 'state');
  try {
    for (const dir of [app, state]) {
      const info = fs.lstatSync(dir, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(dir + ' is not a directory');
    }
    add('install_layout', 'PASS', 'app and state directories are present');
  } catch (error) { add('install_layout', 'FAIL', error.message); }

  const reference = options.reference === undefined ? path.join(root, PAYLOAD_MANIFEST) : options.reference;
  try {
    if (reference === null) {
      add('runtime_files', 'SKIP', 'no payload manifest reference; pass --reference <payload-manifest.json>');
    } else {
      if (typeof reference !== 'string' || !path.isAbsolute(reference)) {
        throw new Error('reference must be an absolute path to a payload manifest');
      }
      const records = readPayloadManifest(reference);
      const missing = [], mismatch = [];
      let verified = 0;
      for (const [name, record] of records) {
        const target = path.join(app, name);
        let bytes;
        try { regular(target); bytes = fs.readFileSync(target); }
        catch { missing.push(name); continue; }
        const digest = sha256(bytes);
        if (bytes.length !== record.bytes || digest !== record.sha256) {
          mismatch.push(name + ' expected bytes=' + record.bytes + ' sha256=' + record.sha256 +
            ' actual bytes=' + bytes.length + ' sha256=' + digest);
        } else verified++;
      }
      if (missing.length) add('runtime_files', 'FAIL', 'missing: ' + missing.join(', '));
      else if (mismatch.length) add('runtime_files', 'FAIL', 'hash mismatch: ' + mismatch.join('; '));
      else add('runtime_files', 'PASS', verified + ' files match the payload manifest ' + reference);
    }
  } catch (error) { add('runtime_files', 'FAIL', 'payload manifest: ' + error.message); }

  for (const name of ['device-native-host.mjs', 'device-owner.mjs']) {
    if (typeof options.verifySyntax !== 'function') { add(name + '_syntax', 'SKIP', 'syntax verification not requested'); continue; }
    try {
      const output = options.verifySyntax(path.join(app, name)) || {};
      add(name + '_syntax', output.ok === true ? 'PASS' : 'FAIL', output.reason || 'no reason reported');
    } catch (error) { add(name + '_syntax', 'FAIL', error.message); }
  }

  try {
    binding = readBinding(path.join(app, 'device-native-binding.json'));
    origin = 'chrome-extension://' + binding.extensionId + '/';
    add('binding', 'PASS', 'canonical; extensionId=' + binding.extensionId + '; stateRoot=' + binding.stateRoot);
  } catch (error) {
    add('binding', 'FAIL', error.message, error.message.startsWith('missing ') ? 'missing' : 'invalid');
  }

  if (binding && samePath(binding.stateRoot) === samePath(state)) {
    add('state_root', 'PASS', 'binding stateRoot resolves to the install state directory');
  } else if (binding) {
    add('state_root', 'FAIL', 'binding stateRoot=' + binding.stateRoot + ' != ' + state);
  } else add('state_root', 'SKIP', 'binding is invalid');

  const channelFile = path.join(state, 'device-channel.json');
  try {
    let present = true;
    try { regular(channelFile); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      present = false;
    }
    if (!present) {
      add('channel', 'PASS', 'absent: no channel metadata; owner liveness and tunnel connectivity unverified');
    } else {
      const value = JSON.parse(fs.readFileSync(channelFile, 'utf8'));
      if (keysOf(value) !== CHANNEL_KEYS) throw new Error('keys are ' + keysOf(value));
      if (value.format !== 'agent-continue-device-channel' || value.version !== 1) throw new Error('format/version');
      if (typeof value.extensionId !== 'string' || !/^[a-p]{32}$/.test(value.extensionId)) throw new Error('extensionId');
      if (binding && value.extensionId !== binding.extensionId) throw new Error('extensionId does not match binding');
      const endpoint = process.platform === 'win32' ? /^\\\\\.\\pipe\\agentcontinue-device-[0-9a-f]{32}$/ : /^\/.*[^/]$/;
      if (typeof value.endpoint !== 'string' || !endpoint.test(value.endpoint)) throw new Error('endpoint shape');
      if (typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)) throw new Error('secret is not 64 lowercase hex');
      add('channel', 'PASS', 'present with valid shape; owner liveness and tunnel connectivity unverified');
    }
  } catch (error) { add('channel', 'FAIL', 'present but invalid: ' + error.message); }

  const manifestFile = path.join(root, 'native-host.json');
  try {
    regular(manifestFile);
    const value = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (keysOf(value) !== MANIFEST_KEYS) throw new Error('keys are ' + keysOf(value));
    if (value.name !== HOST_NAME) throw new Error('name=' + JSON.stringify(value.name));
    if (value.description !== HOST_DESCRIPTION) throw new Error('description mismatch');
    if (typeof value.path !== 'string' || !path.isAbsolute(value.path)) throw new Error('path is not absolute');
    if (value.type !== 'stdio') throw new Error('type is ' + JSON.stringify(value.type));
    if (!Array.isArray(value.allowed_origins) || value.allowed_origins.length !== 1) throw new Error('allowed_origins must hold exactly one origin');
    if (!origin) throw new Error('binding origin unavailable');
    if (value.allowed_origins[0] !== origin) throw new Error('allowed_origins[0]=' + JSON.stringify(value.allowed_origins[0]) + ' != ' + origin);
    manifest = manifestFile;
    add('manifest', 'PASS', 'five fields exact; path=' + value.path + '; origin=' + origin);
  } catch (error) { add('manifest', 'FAIL', error.message); }

  const registry = options.registry;
  for (const [hive, view] of TARGETS) {
    const id = 'registry:' + hive + '/' + view;
    if (!registry || typeof registry.get !== 'function') { add(id, 'SKIP', 'registry reader not provided'); continue; }
    if (!manifest || !origin) { add(id, 'SKIP', 'manifest or binding unavailable'); continue; }
    // A per-user install only writes HKCU; HKLM is not part of the design. Any
    // HKLM value is reported as information, never as a pass or a failure.
    if (hive === 'HKLM') {
      const base = 'not applicable: per-user install never writes HKLM';
      try {
        const plan = registrationPlan({ name: HOST_NAME, hive, view, manifestPath: manifest, origin });
        const value = registry.get(plan);
        if (value === null) add(id, 'SKIP', base, 'not-applicable');
        else if (typeof value !== 'string') add(id, 'SKIP', base + '; residual present (informational)', 'not-applicable');
        else if (value === plan.regSzValue) add(id, 'SKIP', base + '; residual with the same value (informational)', 'not-applicable');
        else add(id, 'SKIP', base + '; residual with a different value (informational)', 'not-applicable');
      } catch (error) { add(id, 'SKIP', base + '; query failed (informational): ' + error.message, 'not-applicable'); }
      continue;
    }
    try {
      const plan = registrationPlan({ name: HOST_NAME, hive, view, manifestPath: manifest, origin });
      const value = registry.get(plan);
      if (value === null) add(id, 'PASS', 'not registered (normal pre-registration state)', 'absent');
      else if (typeof value !== 'string') add(id, 'FAIL', 'registry returned ' + typeof value, 'error');
      else if (value === plan.regSzValue) add(id, 'PASS', 'registered; default value matches the manifest path', 'match');
      else add(id, 'FAIL', 'value drift: ' + JSON.stringify(value) + ' != ' + JSON.stringify(plan.regSzValue), 'drift');
    } catch (error) { add(id, 'FAIL', 'query failed: ' + error.message, 'error'); }
  }

  return finish(checks, root);
}
