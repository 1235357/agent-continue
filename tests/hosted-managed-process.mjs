import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { observeDirectChild, hasExited } from '../native/desktop-commander/process-observation.mjs';

const startTool = 'agent_continue_start_prepared_process';
const proofName = /^ac-managed-[0-9a-f]{32}\.pid$/;
const id = 'agent_continue_operation_id';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (actual, expected) => actual && typeof actual === 'object' && !Array.isArray(actual) &&
  Object.keys(actual).length === Object.keys(expected).length &&
  Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);

export function prepareManagedProcess(stage) {
  assert.equal(process.platform, 'win32');
  const nonce = randomBytes(16).toString('hex');
  const witness = 'ac-managed-' + nonce + '.pid';
  const marker = 'AC_MANAGED_' + nonce;
  const lifetime = 150000, timeout_ms = 3000;
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  assert.equal(fs.realpathSync.native(executable).toLowerCase(), executable.toLowerCase());
  const shell = executable.replaceAll('\\', '/');
  const command = "$ErrorActionPreference='Stop';$p=[IO.Path]::Combine([Environment]::CurrentDirectory,'" + witness + "');" +
    "$f=[IO.File]::Open($p,[IO.FileMode]::CreateNew);try{$b=[Text.Encoding]::ASCII.GetBytes([string]$PID);" +
    "$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()};[Console]::WriteLine('" + marker + "');" +
    "$clock=[Diagnostics.Stopwatch]::StartNew();while($clock.ElapsedMilliseconds -lt " + lifetime +
    " -and [IO.File]::Exists($p)){[Threading.Thread]::Sleep(250)}";
  const start = stage({ command, shell, timeout_ms }, hash(JSON.stringify([command, shell, timeout_ms])));
  const stopId = randomUUID();
  return { config: { start, stopId, executable, witness, marker, lifetime }, startTool, request: start, stopId,
    verify(browserDigest, counts, receiptState) {
      return { browserProof: browserDigest === hash(marker), receiptState,
        verified: browserDigest === hash(marker) && receiptState === 'provider-reported-result' &&
          ['start', 'identified', 'list-before', 'listed', 'stop', 'exited', 'list-after', 'empty']
            .every(name => counts['process-' + name] === 1) };
    } };
}

export function createManagedProcessGate(config, root, audit, {
  observe = observeDirectChild, exited = hasExited, now = () => performance.now(),
} = {}) {
  assert.match(config.witness, proofName);
  const file = path.join(root, 'work', config.witness);
  let state = 'new', expectedReply, started, identity;
  const admitted = (next, message, event) => {
    state = next;
    expectedReply = message.id;
    audit('process-' + event);
    return true;
  };
  const reject = () => { audit('process-denied'); return false; };
  const witnessMatches = pid => {
    try {
      const st = fs.lstatSync(file);
      return st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size <= 10 &&
        fs.readFileSync(file, 'ascii') === String(pid);
    } catch { return false; }
  };
  return {
    async admit(message) {
      const { name, arguments: args } = message.params ?? {};
      if (state === 'new' && name === startTool && same(args, config.start)) {
        started = now();
        return admitted('starting', message, 'start');
      }
      if (name === 'list_sessions' && (args === undefined || same(args, {}))) {
        if (state === 'running') return admitted('listing-before', message, 'list-before');
        if (state === 'exited') return admitted('listing-after', message, 'list-after');
      }
      if (state !== 'listed' || name !== 'force_terminate' ||
          !same(args, { pid: identity.pid, [id]: config.stopId }) ||
          now() - started >= config.lifetime - 10000) return reject();
      state = 'verifying-stop'; // Reserve before the asynchronous OS read.
      try {
        const current = await observe(process.pid, identity.pid, config.executable);
        if (current?.startTime === identity.startTime && witnessMatches(identity.pid) &&
            now() - started < config.lifetime - 10000) return admitted('stopping', message, 'stop');
      } catch { /* Inaccessible or changed identity never permits a stop. */ }
      state = 'failed';
      return reject();
    },
    async observeReply(message, mutationReceipt) {
      if (expectedReply !== message.id) return;
      expectedReply = undefined;
      const before = state;
      state = 'failed';
      if (message.error || message.result?.isError === true || !Array.isArray(message.result?.content)) return;
      const lines = message.result.content.filter(block => block?.type === 'text' && typeof block.text === 'string')
        .flatMap(block => block.text.split(/\r?\n/));
      try {
        if (before === 'starting' && mutationReceipt && lines.filter(line => line.trim() === config.marker).length === 1) {
          const pids = lines.flatMap(line => /^Process started with PID ([1-9]\d{0,9})\b/.exec(line)?.[1] ?? []);
          if (pids.length !== 1 || !witnessMatches(Number(pids[0]))) return;
          identity = await observe(process.pid, Number(pids[0]), config.executable);
          if (identity) { state = 'running'; audit('process-identified'); }
        } else if (before === 'listing-before' && lines.length === 1 &&
            new RegExp('^PID: ' + identity.pid + ', Blocked: (?:true|false), Runtime: \\d+s$').test(lines[0])) {
          state = 'listed'; audit('process-listed');
        } else if (before === 'stopping' && mutationReceipt && lines.length === 1 &&
            lines[0] === 'Successfully initiated termination of session ' + identity.pid &&
            now() - started < config.lifetime && await exited(identity) && now() - started < config.lifetime) {
          state = 'exited'; audit('process-exited');
        } else if (before === 'listing-after' && lines.length === 1 && lines[0] === 'No active sessions') {
          state = 'complete'; audit('process-empty');
        }
      } catch { /* Report the unmodified provider response; the gate remains closed. */ }
    },
  };
}
