import path from 'node:path';
import { spawn } from 'node:child_process';

const unavailable = () => new Error('browser_peer_unavailable');
const sidPattern = /^S-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}$/;
const generationPattern = /^[a-f0-9]{32}$/;

export function administratorBrowserPeerLaunch({ bundle, origin, generation, selectedSid, role }) {
  const win = path.win32;
  const systemRoot = process.env.SystemRoot;
  if (!['Server', 'Owner', 'Provider'].includes(role) || typeof bundle !== 'string' ||
      !/^[A-Z]:\\[^\\]/i.test(bundle) || win.normalize(bundle) !== bundle ||
      win.basename(win.dirname(bundle)) !== 'AgentContinueAdmin' || !/^[a-f0-9]{24}$/.test(win.basename(bundle)) ||
      /[\x00-\x1f<>:"|?*]/.test(bundle.slice(2)) ||
      typeof origin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin) ||
      typeof systemRoot !== 'string' || !/^[A-Z]:\\Windows$/i.test(systemRoot) ||
      (role !== 'Server' && (!generationPattern.test(generation ?? '') || !sidPattern.test(selectedSid ?? '')))) {
    throw unavailable();
  }
  const system = win.join(systemRoot, 'System32');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', win.join(bundle, 'app', 'windows-browser-peer.ps1'),
    '-Role', role, '-Bundle', bundle, '-Origin', origin];
  if (role !== 'Server') args.push('-Generation', generation, '-ExpectedSid', selectedSid);
  const env = { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: system, PATHEXT: '.EXE',
    ComSpec: win.join(system, 'cmd.exe') };
  // The high caller already verified this sealed state tree. No inherited
  // module/preload/profile settings reach PowerShell or its compiler.
  if (role !== 'Server') env.TEMP = env.TMP = win.join(bundle + '.state', 'temp');
  return { command: win.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args,
    options: { cwd: system, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env } };
}

function openPeer(options, { launch = plan => spawn(plan.command, plan.args, plan.options), acquisitionMs = 20000 } = {}, input) {
  const plan = administratorBrowserPeerLaunch(options);
  let child;
  try { child = launch(plan); } catch { return Promise.reject(unavailable()); }
  let live = false, accepted = false, ended = false, exited = false, closing;
  let output = '', outputBytes = 0, stderrBytes = 0, resolveReady, rejectReady, resolveLost, resolveExit;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const finished = new Promise(resolve => { resolveLost = resolve; });
  const exit = new Promise(resolve => { resolveExit = resolve; });
  const deadline = setTimeout(lose, acquisitionMs);
  const expected = options.role === 'Server' ? 'LISTENING' : 'READY';
  const evidence = Object.freeze({ isLive: () => live && !ended, finished, close });

  function lose() {
    if (ended) return;
    // Admission is withdrawn synchronously, before any asynchronous cleanup.
    live = false; ended = true;
    clearTimeout(deadline);
    resolveLost();
    if (!accepted) rejectReady(unavailable());
  }
  function observedExit() {
    if (exited) return;
    exited = true;
    lose(); resolveExit();
  }
  const within = async (promise, ms) => {
    let timer;
    try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
    finally { clearTimeout(timer); }
  };
  function close() {
    return closing ??= (async () => {
      lose();
      input?.off('end', inputClosed); input?.off('close', inputClosed);
      input?.off('error', inputClosed); input?.off('data', extraInput);
      try { child.stdin?.end(); } catch { /* Observe the exact owned process below. */ }
      if (!exited && !await within(exit, 3000)) {
        try { child.kill(); } catch { /* A kill request is not proof of exit. */ }
        if (!exited && !await within(exit, 3000)) throw new Error('browser_peer_cleanup_unconfirmed');
      }
    })();
  }
  function inputClosed() { lose(); void close().catch(() => {}); }
  function extraInput(bytes) { if (bytes.length) inputClosed(); }
  child.once('error', () => { lose(); void close().catch(() => {}); });
  child.once('exit', observedExit);
  child.once('close', observedExit);
  child.stdout.on('end', lose);
  child.stdout.on('error', lose);
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > 1024) lose(); });
  child.stderr.on('error', lose);
  child.stdin?.on('error', lose);
  child.stdout.on('data', bytes => {
    if (ended) return;
    if (live && bytes.length) return lose();
    outputBytes += bytes.length;
    if (outputBytes > 128 || bytes.some(byte => byte > 127)) return lose();
    output += bytes.toString('ascii');
    let pos;
    while ((pos = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, pos).replace(/\r$/, ''); output = output.slice(pos + 1);
      if (!live && line === expected) {
        live = true;
        // READY+CLOSED or duplicate READY in the same read cannot admit work.
        queueMicrotask(() => {
          if (live && !ended && !accepted) { accepted = true; clearTimeout(deadline); resolveReady(evidence); }
        });
      } else { lose(); break; }
    }
    if (live && output.length) lose();
  });
  if (input) {
    input.once('end', inputClosed); input.once('close', inputClosed); input.once('error', inputClosed);
    input.on('data', extraInput);
    if (input.readableEnded || input.destroyed) inputClosed();
    else input.resume();
  }
  return ready.catch(async error => { await close(); throw error; });
}

export const openAdministratorBrowserSessionServer = ({ bundle, origin, input }, dependencies) =>
  openPeer({ bundle, origin, role: 'Server' }, dependencies, input);

export const openWindowsAdministratorBrowserWitness = (options, dependencies) =>
  openPeer({ ...options, role: options.role ?? 'Owner' }, dependencies);
