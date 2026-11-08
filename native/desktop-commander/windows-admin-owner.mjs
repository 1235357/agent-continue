import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openController as defaultController } from './lifecycle.mjs';
import { openDeviceOperations } from './device-operations.mjs';
import { hasExited as defaultHasExited } from './process-observation.mjs';
import { openWindowsAdministratorBrowserWitness } from './windows-admin-browser-session.mjs';

const sidPattern = /^S-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}$/;
const invalid = () => { throw new Error('admin_owner_authorization_invalid'); };
const digest = value => createHash('sha256').update(value).digest('hex');
const exact = (value, expected) => value && Object.keys(value).length === Object.keys(expected).length &&
  Object.entries(expected).every(([key, entry]) => Object.hasOwn(value, key) && value[key] === entry);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const revocationCheckMs = 500;

function absent(file) {
  try { fs.lstatSync(file); return false; }
  catch (error) { return error.code === 'ENOENT'; }
}

function privateDocument(file, limit) {
  const acceptable = info => info.isFile() && !info.isSymbolicLink() && info.nlink === 1n &&
    info.ino !== 0n && info.size <= BigInt(limit);
  const before = fs.lstatSync(file, { bigint: true });
  if (!acceptable(before)) invalid();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!acceptable(opened) || !same(before, opened)) invalid();
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = fs.readSync(fd, buffer, count, buffer.length - count, count);
      if (!n) break;
      count += n;
    }
    const after = fs.lstatSync(file, { bigint: true });
    if (count > limit || !acceptable(after) || !same(after, opened) || after.size !== BigInt(count) ||
        after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) invalid();
    const bytes = buffer.subarray(0, count);
    return { bytes, file, limit, info: after, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } finally { fs.closeSync(fd); }
}

function directory(dir) {
  const info = fs.lstatSync(dir, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n || fs.realpathSync.native(dir) !== dir) invalid();
  return info;
}

// The Windows launcher must establish native identity and the protected DACLs
// before calling this entry. These checks bind content, not Windows ACLs.
function pinActivation(bundle, selectedSid) {
  try {
    if (typeof bundle !== 'string' || !path.isAbsolute(bundle) || path.resolve(bundle) !== bundle ||
        !/^[a-f0-9]{24}$/.test(path.basename(bundle)) || !sidPattern.test(selectedSid)) invalid();
    const root = bundle + '.state', vault = bundle + '.secrets';
    const directories = [bundle, root, vault].map(dir => ({ dir, info: directory(dir) }));
    const revoked = path.join(vault, 'owner-revoked');
    if (!absent(revoked)) invalid();
    const identity = privateDocument(path.join(root, 'administrator.json'), 1024);
    const bundleSha256 = identity.value?.bundleSha256;
    if (typeof bundleSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(bundleSha256) ||
        !bundleSha256.startsWith(path.basename(bundle)) || !exact(identity.value, {
          format: 'agent-continue-administrator-state', version: 1, bundleSha256,
          userSid: selectedSid, scope: 'full-account', initiallyPaused: true,
        })) invalid();
    const profile = privateDocument(path.join(vault, 'owner-tunnel.yaml'), 16384);
    const profileSha256 = digest(profile.bytes);
    const control = profile.value?.control_plane;
    const commands = profile.value?.mcp?.commands;
    if (control?.base_url !== 'https://api.openai.com' ||
        typeof control.tunnel_id !== 'string' || !/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(control.tunnel_id) ||
        control.api_key !== 'file:' + path.join(vault, 'runtime.key') ||
        !Array.isArray(commands) || commands.length !== 1 || commands[0]?.channel !== 'main' ||
        typeof commands[0]?.command !== 'string' || !commands[0].command.endsWith(' --administrator-owner')) invalid();
    const binding = privateDocument(path.join(vault, 'binding.json'), 1024);
    const proof = privateDocument(path.join(vault, 'tunnel.yaml'), 16384);
    if (!exact(proof.value?.control_plane, control)) invalid();
    if (!exact(binding.value, { format: 'agent-continue-administrator-hosted-binding', version: 1, bundleSha256,
      userSid: selectedSid, profileSha256: digest(proof.bytes), activationAuthorized: false })) invalid();
    const grant = privateDocument(path.join(vault, 'owner-activation.json'), 1024);
    if (!exact(grant.value, { format: 'agent-continue-windows-admin-activation', version: 1, bundleSha256,
      userSid: selectedSid, profileSha256, scope: 'full-account' })) invalid();
    let denied = false;
    const stillAuthorized = () => {
      if (denied) return false;
      try {
        if (absent(revoked) && directories.every(({ dir, info }) => same(info, directory(dir))) &&
          [identity, profile, binding, grant, proof].every(record => {
            const current = privateDocument(record.file, record.limit);
            return same(record.info, current.info) && current.bytes.equals(record.bytes);
          }) && absent(revoked)) return true;
      } catch { /* A missing or unreadable authorization cannot allow a call. */ }
      denied = true;
      return false;
    };
    return { root, profile: profile.file, bundleSha256, stillAuthorized };
  } catch { invalid(); }
}

function hasRunningIntent(root) {
  try {
    const { value } = privateDocument(path.join(root, 'lifecycle.json'), 1024);
    return exact(value, { format: 'agent-continue-lifecycle', version: 1, paused: false });
  } catch { return false; }
}

function browserInstallation(bundle) {
  // A damaged/partial browser installation cannot silently become maintenance.
  try { fs.lstatSync(bundle + '.browser'); return true; }
  catch (error) { return error.code !== 'ENOENT'; }
}

function pinBrowserOrigin(bundle, bundleSha256) {
  const bridge = bundle + '.browser', info = directory(bridge);
  const record = privateDocument(path.join(bridge, 'binding.json'), 1024);
  const commit = privateDocument(path.join(bridge, 'enrolled.json'), 1024);
  const { value } = record;
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 4 || value.version !== 1 ||
      value.bundleSha256 !== bundleSha256 || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(value.origin ?? '') ||
      !/^[A-Z]:\\Windows\\System32$/i.test(value.systemDirectory ?? '')) invalid();
  if (!exact(commit.value, { version: 1, bundleSha256 }) ||
      !commit.bytes.equals(Buffer.from(JSON.stringify({ version: 1, bundleSha256 })))) invalid();
  let denied = false;
  const stillCurrent = () => {
    if (denied) return false;
    try {
      if (same(info, directory(bridge)) && absent(path.join(bridge, 'enrollment.pending')) &&
          [record, commit].every(pinned => {
            const now = privateDocument(pinned.file, pinned.limit);
            return same(pinned.info, now.info) && pinned.info.mtimeNs === now.info.mtimeNs &&
              pinned.info.ctimeNs === now.info.ctimeNs && pinned.bytes.equals(now.bytes);
          })) return true;
    } catch { /* Enrollment loss cannot authorize maintenance mode. */ }
    denied = true;
    return false;
  };
  if (!stillCurrent()) invalid();
  return { origin: value.origin, stillCurrent };
}

function normalizeAdministratorState(state) {
  if (typeof state !== 'string' || !state.endsWith('.state')) invalid();
  if (process.platform === 'win32') {
    // The sealed tunnel command uses forward slashes for its argv paths.
    // Translate only separators; pinActivation must still reject aliases and traversal.
    if (state.includes('/')) {
      if (state.includes('\\')) invalid();
      state = state.replaceAll('/', '\\');
    }
    if (!/^[a-z]:\\[^\\]/i.test(state) || /[\x00-\x1f<>:"|?*]/.test(state.slice(2))) invalid();
  }
  return state;
}

export function createWindowsAdministratorAdmission(state, selectedSid = currentWindowsSid(), browserWitness = null) {
  state = normalizeAdministratorState(state);
  const bundle = state.slice(0, -'.state'.length);
  const { root, stillAuthorized } = pinActivation(bundle, selectedSid);
  const needsBrowser = browserWitness !== null || browserInstallation(bundle);
  let denied = false;
  return () => {
    if (denied) return false;
    const browserLive = !needsBrowser ? !browserInstallation(bundle) : browserWitness && typeof browserWitness.isLive === 'function' &&
      /^[a-f0-9]{32}$/.test(browserWitness.generation ?? '') && browserWitness.isLive() === true;
    if (!browserLive || !stillAuthorized()) { denied = true; return false; }
    return hasRunningIntent(root);
  };
}

export async function openWindowsAdministratorAdmission(state, { selectedSid = currentWindowsSid(),
  generation = process.env.AC_ADMIN_BROWSER_GENERATION,
  openBrowserSession = openWindowsAdministratorBrowserWitness } = {}) {
  state = normalizeAdministratorState(state);
  const bundle = state.slice(0, -'.state'.length);
  const activation = pinActivation(bundle, selectedSid);
  if (!browserInstallation(bundle)) return { canAdmit: createWindowsAdministratorAdmission(state, selectedSid), close: async () => {} };
  if (!/^[a-f0-9]{32}$/.test(generation ?? '')) invalid();
  const enrollment = pinBrowserOrigin(bundle, activation.bundleSha256);
  const witness = await openBrowserSession({ bundle, selectedSid, generation, role: 'Provider',
    origin: enrollment.origin });
  try {
    if (!witness.isLive() || !activation.stillAuthorized() || !enrollment.stillCurrent()) invalid();
    const pinned = { generation, isLive: () => witness.isLive() && enrollment.stillCurrent() };
    return { canAdmit: createWindowsAdministratorAdmission(state, selectedSid, pinned),
      close: () => witness.close(), finished: witness.finished };
  } catch (error) { await witness.close(); throw error; }
}

export function verifyWindowsAdministratorControlAuthorization(bundle, expectedSid) {
  if (currentWindowsSid() !== expectedSid) invalid();
  return pinActivation(bundle, expectedSid).stillAuthorized;
}

export function observeWindowsAdministratorOwner(bundle, generation, readReady) {
  if (typeof generation !== 'string' || !/^[a-f0-9]{32}$/.test(generation)) invalid();
  const vault = bundle + '.secrets';
  const file = path.join(vault, 'owner-observation-' + generation + '.json');
  let sequence = 0, busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    let temporary;
    try {
      const ready = await readReady() === true;
      const proposed = path.join(vault, 'owner-observation-' + randomUUID() + '.tmp');
      fs.writeFileSync(proposed, JSON.stringify({ version: 1, generation, pid: process.pid, sequence: ++sequence,
        bootMs: Math.floor(os.uptime() * 1000), ready }) + '\n',
        { flag: 'wx', mode: 0o600 });
      temporary = proposed;
      fs.renameSync(temporary, file);
      temporary = undefined;
    } finally {
      busy = false;
      if (temporary) { try { fs.unlinkSync(temporary); } catch { /* No stale sample is renewed. */ } }
    }
  };
}

export async function startWindowsAdministratorOwner({ bundle, selectedSid, env, generation, browserRequired = false },
  { openController = defaultController, hasExited = defaultHasExited,
    openBrowserSession = openWindowsAdministratorBrowserWitness } = {}) {
  const activation = pinActivation(bundle, selectedSid);
  const { root, profile, stillAuthorized } = activation;
  const needsBrowser = browserRequired || browserInstallation(bundle);
  let exitVerified = false, browserLost = false, browser, controller, enrollment;
  let journal, shutdown, watch, report, settle;
  const finished = new Promise(resolve => { settle = resolve; });
  const browserLive = () => !needsBrowser ? !browserInstallation(bundle) :
    !browserLost && enrollment?.stillCurrent() === true && browser?.isLive() === true;
  const denial = () => !stillAuthorized() ? 'revoked' : !hasRunningIntent(root) ? 'paused' :
    !browserLive() ? 'browser-closed' : null;
  function close(reason = 'closed') {
    clearInterval(watch); clearInterval(report);
    const finalStatus = reason === 'tunnel-exited' ? denial() ?? reason : reason;
    browserLost = needsBrowser;
    return shutdown ??= (async () => {
      // Independent provider witnesses cannot see this root's local flag.
      // Start native-channel closure before waiting on controller disposal.
      let witnessClose;
      try { witnessClose = Promise.resolve(browser?.close()); }
      catch (error) { witnessClose = Promise.reject(error); }
      const controllerClose = (async () => {
        try { await controller?.dispose(); }
        finally { journal?.close(); }
      })();
      const settled = await Promise.allSettled([witnessClose, controllerClose]);
      const failure = settled.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      settle({ status: finalStatus });
    })().catch(error => { settle({ status: 'stop-unconfirmed' }); throw error; });
  }
  function stopIfDenied() {
    if (shutdown) return true;
    const reason = denial();
    if (!reason) return false;
    void close(reason).catch(() => {});
    return true;
  }
  try {
    if (needsBrowser) {
      if (!/^[a-f0-9]{32}$/.test(generation ?? '')) invalid();
      enrollment = pinBrowserOrigin(bundle, activation.bundleSha256);
      browser = await openBrowserSession({ bundle, selectedSid, generation, role: 'Owner',
        origin: enrollment.origin });
      void browser.finished.then(() => {
        browserLost = true;
        void close('browser-closed').catch(() => {});
      });
      if (!browserLive() || !stillAuthorized()) invalid();
    }
    controller = openController(root, {
    deferStartup: true, maxRestarts: 0,
    async hasExited(identity) {
      const exited = await hasExited(identity);
      if (exited === true) exitVerified = true;
      return exited;
    },
    launch() {
      if (!stillAuthorized() || !browserLive()) return { configured: false, reason: 'admin_owner_authorization_invalid' };
      return { configured: true, command: path.join(bundle, 'client', 'tunnel-client-runtime.exe'),
        args: ['run', '--profile-file', profile], cwd: path.join(root, 'work'),
        // The owner's preload consumes its own setting; the provider needs a new one.
        env: { ...env, AC_ADMIN_BOOT_APP_ROOT: path.join(bundle, 'app'),
          ...(needsBrowser ? { AC_ADMIN_BROWSER_GENERATION: generation } : {}) } };
    },
  });
    const stopped = async status => { await close(); return { status }; };
    const before = await controller.status();
    if (shutdown) return await finished;
    if (!browserLive()) return await stopped('browser-closed');
    if (before.paused !== false) return await stopped('paused');
    journal = openDeviceOperations(root, controller);
    if (!journal.canRestoreSavedIntent()) return await stopped('unsettled');
    watch = setInterval(stopIfDenied, revocationCheckMs);
    watch.unref();
    await controller.startSavedIntent(() => stillAuthorized() && browserLive() && journal.canRestoreSavedIntent());
    if (shutdown) return await finished;
    const after = await controller.status();
    if (shutdown) return await finished;
    if (!stillAuthorized()) return await stopped('unauthorized');
    if (!journal.canRestoreSavedIntent()) return await stopped('unsettled');
    if (after.paused !== false || after.runtime !== 'running' || after.ready !== true) return await stopped('not-ready');
    const readReady = async () => {
      if (stopIfDenied()) return false;
      const current = await controller.status();
      if (stopIfDenied()) return false;
      // A failed health stop can also report 'failed' without a terminal child.
      if (exitVerified && current.runtime === 'failed') {
        void close('tunnel-exited').catch(() => {});
        return false;
      }
      return current.paused === false && current.runtime === 'running' && current.ready === true;
    };
    const publish = generation === undefined ? readReady : observeWindowsAdministratorOwner(bundle, generation, readReady);
    let sampling = false;
    async function sample() {
      if (sampling) return;
      sampling = true;
      try { await publish(); }
      catch { /* No stale sample is renewed. */ }
      finally { sampling = false; }
    }
    // The child can be the last other handle. Keep sampling until disposal settles.
    report = setInterval(sample, 700);
    void sample();
    return { status: 'ready', close: () => close(), finished };
  } catch (error) {
    await close();
    throw error;
  }
}

function currentWindowsSid() {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || typeof systemRoot !== 'string' || !/^[A-Z]:\\[^"\r\n]+$/i.test(systemRoot)) invalid();
  const whoami = path.join(systemRoot, 'System32', 'whoami.exe');
  const options = { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 32768 };
  const user = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], options).trim();
  const groups = execFileSync(whoami, ['/groups', '/fo', 'csv', '/nh'], options);
  const sid = /,"(S-1-[0-9-]+)"$/.exec(user)?.[1];
  if (!sid || !sidPattern.test(sid) || !/,"S-1-16-12288",/.test(groups) || !/,"S-1-5-32-544",/.test(groups)) invalid();
  return sid;
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try {
    if (process.argv.length !== 2) invalid();
    const bundle = path.dirname(path.dirname(entry));
    if (process.execPath !== path.join(bundle, 'runtime', 'node.exe') || process.cwd() !== path.join(bundle + '.state', 'work')) invalid();
    const generation = process.env.AC_ADMIN_OWNER_GENERATION;
    if (!/^[a-f0-9]{32}$/.test(generation ?? '')) invalid();
    delete process.env.AC_ADMIN_OWNER_GENERATION;
    const owner = await startWindowsAdministratorOwner({ bundle, generation,
      selectedSid: currentWindowsSid(), env: { ...process.env } });
    process.stdout.write(JSON.stringify({ status: owner.status }) + '\n');
    if (owner.close) {
      const stop = () => void owner.close().catch(() => { process.exitCode = 1; process.stderr.write('admin_owner_stop_unconfirmed\n'); });
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      void owner.finished.then(outcome => {
        if (outcome.status === 'stop-unconfirmed') process.exitCode = 1;
        process.stdout.write(JSON.stringify(outcome) + '\n');
      });
    }
  } catch {
    process.exitCode = 1;
    process.stderr.write('admin_owner_unavailable\n');
  }
}
