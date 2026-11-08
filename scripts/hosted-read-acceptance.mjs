import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prefix = 'ac-hosted-read-';
const surfaces = ['chatgpt', 'dot'];
const comparison = 'chatgpt-control';
const probeNames = [...surfaces, comparison];
const stdinLimit = 64 * 1024;
const markerPattern = /(?<![A-Za-z0-9_])AC_HOSTED_READ_(chatgpt-control|chatgpt|dot)_[0-9a-f]{64}(?![A-Za-z0-9_])/g;
const decoder = new TextDecoder('utf-8', { fatal: true });

class CanaryError extends Error {}

function requireValid(condition) {
  if (!condition) throw new Error();
}

function checked(code, operation) {
  try {
    return operation();
  } catch {
    throw new CanaryError(code);
  }
}

function digest(marker) {
  return createHash('sha256').update(marker, 'ascii').digest('hex');
}

function tempRoot() {
  const tmp = os.tmpdir();
  requireValid(path.isAbsolute(tmp));
  if (process.platform === 'win32') requireValid(/^[A-Za-z]:[\\/]/.test(tmp));
  const root = fs.realpathSync.native(tmp);
  requireValid(root !== path.parse(root).root && fs.statSync(root).isDirectory());
  requireValid(!/[\u0000-\u001f\u007f\u2028\u2029]/u.test(root));
  requireValid(process.platform !== 'win32' || /^[A-Za-z]:\\/.test(root));
  return root;
}

function directoryStat(runDir, root) {
  const name = path.basename(runDir);
  requireValid(/^ac-hosted-read-[A-Za-z0-9]{6}$/.test(name) && runDir === path.join(root, name));
  const stat = fs.lstatSync(runDir, { bigint: true });
  requireValid(stat.isDirectory() && fs.realpathSync.native(runDir) === runDir);
  if (process.getuid) {
    requireValid(stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n);
  }
  return stat;
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

function readRegular(file, maxBytes) {
  const before = fs.lstatSync(file, { bigint: true });
  requireValid(before.isFile() && before.nlink === 1n && before.size <= BigInt(maxBytes));
  requireValid(fs.realpathSync.native(file) === file);

  // Recheck the opened handle and cap the read even if the file grows.
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(file, flags);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    requireValid(opened.isFile() && opened.nlink === 1n && sameFile(before, opened));
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fs.lstatSync(file, { bigint: true });
    requireValid(after.isFile() && after.nlink === 1n && sameFile(opened, after));
    requireValid(length <= maxBytes);
    if (after.size !== BigInt(length) || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw Object.assign(new Error('evidence_changed_during_read'), { code: 'evidence_changed_during_read' });
    }
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

function prepare(names = surfaces) {
  const root = tempRoot();
  const runDir = fs.mkdtempSync(path.join(root, prefix));
  directoryStat(runDir, root);
  const probes = {};
  const hashes = {};
  for (const surface of names) {
    const file = path.join(runDir, `${surface}.txt`);
    const marker = `AC_HOSTED_READ_${surface}_${randomBytes(32).toString('hex')}`;
    fs.writeFileSync(file, `${marker}\n`, { flag: 'wx', mode: 0o600 });
    hashes[surface] = digest(marker);
    const tool = surface === comparison ? 'read_multiple_files tool with a paths array containing only the path below' :
      'read_file tool exactly once for the path below';
    const prompt = 'Call the private "AgentContinue Windows Acceptance" app\'s ' + tool + '. ' +
      'Do not access any other file, take any other action, or repeat the file contents in your reply.\n' + file;
    probes[surface] = { file, prompt };
  }
  fs.writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(hashes)}\n`, { flag: 'wx', mode: 0o600 });
  return { ok: true, runDir, probes, toolInvocationVerified: false };
}

function oneMarker(text, surface) {
  const matches = text.matchAll(markerPattern);
  const first = matches.next().value;
  return first?.[1] === surface && matches.next().done ? first[0] : undefined;
}

async function readStdin() {
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > stdinLimit) throw new CanaryError('STDIN_TOO_LARGE');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CanaryError) throw error;
    throw new CanaryError('STDIN_READ_FAILED');
  }
  return checked('INVALID_STDIN', () => decoder.decode(Buffer.concat(chunks, length)));
}

function probe(runDir, surface) {
  requireValid(probeNames.includes(surface));
  const root = checked('INVALID_RUN_DIR', tempRoot);
  const checkDir = () => checked('INVALID_RUN_DIR', () => directoryStat(runDir, root));
  const before = checkDir();

  const expected = checked('INVALID_MANIFEST', () => {
    const hashes = JSON.parse(decoder.decode(readRegular(path.join(runDir, 'manifest.json'), 1024)));
    const names = hashes && Object.hasOwn(hashes, comparison) ? probeNames : surfaces;
    requireValid(hashes && names.includes(surface) && Object.keys(hashes).length === names.length &&
      names.every((key) => Object.hasOwn(hashes, key) &&
        typeof hashes[key] === 'string' && /^[0-9a-f]{64}$/.test(hashes[key])));
    return hashes[surface];
  });

  const file = path.join(runDir, `${surface}.txt`);
  checked('INVALID_MARKER_FILE', () => {
    const bytes = readRegular(file, 128);
    const marker = oneMarker(decoder.decode(bytes), surface);
    requireValid(marker && bytes.equals(Buffer.from(`${marker}\n`)) && digest(marker) === expected);
  });
  const assertCurrent = () => checked('INVALID_RUN_DIR', () => requireValid(sameFile(before, checkDir())));
  assertCurrent();
  return { file, expected, assertCurrent };
}

async function compare(runDir, surface) {
  const { expected, assertCurrent } = probe(runDir, surface);
  const text = await readStdin();
  assertCurrent();
  const candidate = oneMarker(text, surface);
  return { ok: true, match: Boolean(candidate && digest(candidate) === expected), surface, toolInvocationVerified: false };
}

export function verifyHostedReadHistory(runDir, surface, logFile, { openedAt, closedAt }) {
  const { file, expected, assertCurrent } = probe(runDir, surface);
  const result = { surface, exactCalls: 0, otherReadCalls: 0, matchingCalls: 0, markerMatched: false,
    origins: { ui: 0, llm: 0, unattributed: 0 } };
  const expectedTool = surface === comparison ? 'read_multiple_files' : 'read_file';
  requireValid(Number.isSafeInteger(openedAt) && Number.isSafeInteger(closedAt) && openedAt <= closedAt);
  let log;
  try { log = decoder.decode(readRegular(logFile, stdinLimit)); }
  catch (error) { if (error?.code === 'ENOENT') return result; throw error; }
  const onPath = log.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(entry => {
    const at = Date.parse(entry?.timestamp);
    const args = entry?.arguments;
    const requested = entry?.toolName === 'read_file' ? [args?.path] :
      entry?.toolName === 'read_multiple_files' && Array.isArray(args?.paths) ? args.paths : [];
    return at >= openedAt && at <= closedAt && (args?.isUrl === undefined || args.isUrl === false) &&
      requested.some(name => typeof name === 'string' && path.isAbsolute(name) && path.normalize(name) === file);
  });
  const calls = onPath.filter(entry => entry.toolName === expectedTool &&
    (expectedTool === 'read_file' || entry.arguments.paths.length === 1));
  result.exactCalls = calls.length;
  result.otherReadCalls = onPath.length - calls.length;
  for (const {arguments: {origin}} of calls) result.origins[origin === 'ui' || origin === 'llm' ? origin : 'unattributed']++;
  result.matchingCalls = calls.filter(({ output }) => {
    if (!output || output.isError || !Array.isArray(output.content)) return false;
    const candidate = oneMarker(output.content.filter(item => item?.type === 'text' && typeof item.text === 'string')
      .map(item => item.text).join('\n'), surface);
    return Boolean(candidate && digest(candidate) === expected);
  }).length;
  result.markerMatched = result.exactCalls === 1 && result.otherReadCalls === 0 && result.matchingCalls === 1;
  assertCurrent();
  return result;
}

export function summarizeHostedReadEvidence(receipts, selected) {
  return receipts.map(receipt => {
    const observed = receipt.exactCalls + receipt.otherReadCalls > 0;
    if (!selected.has(receipt.surface)) {
      const status = observed ? 'unexpected-traffic' : 'not-tested';
      return { ...receipt, readPath: status, singleRead: status };
    }
    if (!observed) return { ...receipt, readPath: 'not-observed', singleRead: 'not-observed' };
    return { ...receipt, readPath: receipt.matchingCalls > 0 ? 'verified' : 'unverified',
      singleRead: receipt.markerMatched ? 'verified' : 'failed' };
  });
}

export function hostedReadGate(evidence, selected, { requireSingle = true } = {}) {
  const seen = new Set();
  for (const receipt of evidence) {
    if (seen.has(receipt.surface)) return false;
    seen.add(receipt.surface);
    if (!selected.has(receipt.surface)) {
      if (receipt.readPath !== 'not-tested') return false;
    } else if (receipt.readPath !== 'verified' || receipt.otherReadCalls !== 0 ||
        (requireSingle && receipt.singleRead !== 'verified')) return false;
  }
  return selected.size > 0 && [...selected].every(surface => seen.has(surface));
}

function prepareHostedMutationProbe(state) {
  const root = tempRoot();
  const scratch = path.dirname(path.dirname(state));
  const work = path.join(state, 'work');
  requireValid(path.dirname(scratch) === root && /^ac-browser-native-start-[A-Za-z0-9]{6}$/.test(path.basename(scratch)) &&
    state === path.join(scratch, 'device', 'state') && fs.realpathSync.native(work) === work);
  const identity = fs.lstatSync(work, { bigint: true });
  requireValid(identity.isDirectory() && identity.ino !== 0n);
  const assertCurrent = () => requireValid(sameFile(identity, fs.lstatSync(work, { bigint: true })) &&
    fs.realpathSync.native(work) === work);
  const readOptional = (file, max) => {
    try { return readRegular(file, max); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const operationId = randomUUID();
  const receiptFile = id => path.join(state, 'mcp-operation-receipts', digest(id) + '.admitted');
  const log = path.join(state, 'home', '.claude-server-commander', 'tool-history.jsonl');
  const assertFresh = id => requireValid(readOptional(receiptFile(id), 64) === null);
  assertFresh(operationId);
  const evidence = ({ openedAt, closedAt }, id = operationId) => {
    requireValid(Number.isSafeInteger(openedAt) && Number.isSafeInteger(closedAt) && openedAt <= closedAt);
    assertCurrent();
    const receipt = readOptional(receiptFile(id), 64)?.toString('utf8');
    const exact = receipt?.startsWith('admitted-exact\n') === true;
    const prepared = receipt?.startsWith('admitted-prepared\n') === true;
    const revoked = receipt === 'revoked-prepared\n';
    const admitted = prepared ? 'admitted-prepared\n' : exact ? 'admitted-exact\n' : 'admitted\n';
    const receiptState = revoked ? 'owner-revoked' : receipt === undefined ? 'not-recorded' : receipt === admitted ? 'admitted-outcome-unconfirmed' :
      receipt === admitted + 'provider-reported-result\n' ? 'provider-reported-result' :
      receipt === admitted + 'blocked-by-local-control\n' ? 'blocked-by-local-control' :
      receipt === admitted + 'provider-reported-error\n' ? 'provider-reported-error' : 'receipt-unavailable';
    const entries = (readOptional(log, stdinLimit)?.toString('utf8') ?? '').split('\n').filter(line => line.trim())
      .map(line => JSON.parse(line)).filter(entry => {
        const at = Date.parse(entry?.timestamp);
        return at >= openedAt && at <= closedAt;
      });
    assertCurrent();
    return { receiptState, exactReceipt: exact && receiptState !== 'receipt-unavailable',
      preparedReceipt: revoked || prepared && receiptState !== 'receipt-unavailable', entries };
  };
  return { work, operationId, readOptional, assertCurrent, assertFresh, evidence };
}

export function prepareHostedAppendProbe(state, { requireReadback = false } = {}) {
  requireValid(typeof requireReadback === 'boolean');
  const { work, operationId, readOptional, assertCurrent, evidence } = prepareHostedMutationProbe(state);
  const file = path.join(work, 'ac-web-append-' + randomBytes(12).toString('hex') + '.txt');
  const initial = 'AC_APPEND_BASE_' + randomBytes(12).toString('hex') + '\n';
  const content = 'AC_APPEND_PROBE_' + randomBytes(12).toString('hex') + (requireReadback ? '' : '\n');
  fs.writeFileSync(file, initial, { flag: 'wx', mode: 0o600 });
  const originalFile = fs.lstatSync(file, { bigint: true });
  assertCurrent();
  const requestPath = requireReadback && process.platform === 'win32' ? file.replaceAll('\\', '/') : file;
  const request = Object.freeze({ path: requestPath, content, mode: 'append', agent_continue_operation_id: operationId });
  const readRequest = Object.freeze({ path: requestPath, length: 10 });
  return { request, ...(requireReadback ? { readRequest } : {}), verify(window, { browserDigest } = {}) {
    const { receiptState, entries } = evidence(window);
    const bytes = readOptional(file, 4096);
    const text = bytes && decoder.decode(bytes);
    const unchangedIdentity = bytes && sameFile(originalFile, fs.lstatSync(file, { bigint: true }));
    const fileState = text === null ? 'missing' : !unchangedIdentity ? 'replaced' :
      text === initial ? 'unchanged' : text === initial + content ? 'appended-once' :
      text.startsWith(initial + content.repeat(2)) ? 'appended-more-than-once' : 'unexpected-bytes';
    const calls = entries.filter(entry => {
      const target = entry?.arguments?.path;
      return entry.toolName === 'write_file' &&
        typeof target === 'string' && path.isAbsolute(target) && path.normalize(target) === file;
    });
    const matching = calls.filter(({ arguments: args, output }) =>
      args.mode === 'append' && args.content === content && output && output.isError !== true &&
      Array.isArray(output.content));
    const matchingWriteCalls = matching.length;
    let readEvidence;
    if (requireReadback) {
      const reads = entries.filter(entry => entry.toolName === 'read_file' &&
        typeof entry.arguments?.path === 'string' && path.normalize(entry.arguments.path) === file);
      const matchingReads = reads.filter(entry => {
        if (matching.length !== 1 || entries.indexOf(entry) <= entries.indexOf(matching[0]) ||
            entry.arguments.isUrl === true || entry.output?.isError === true || !Array.isArray(entry.output?.content)) return false;
        const output = entry.output.content.filter(block => block?.type === 'text' && typeof block.text === 'string')
          .map(block => block.text).join('\n');
        const markers = output.match(/AC_APPEND_(?:BASE|PROBE)_[0-9a-f]{24}\b/g);
        return markers?.length === 2 && markers.join('\n') === initial + content;
      });
      readEvidence = { readCalls: reads.length, matchingReadCalls: matchingReads.length,
        browserProof: typeof browserDigest === 'string' && browserDigest === digest(initial + content) };
    }
    assertCurrent();
    return { fileState, receiptState, targetWriteCalls: calls.length, matchingWriteCalls,
      ...readEvidence,
      verified: fileState === 'appended-once' && receiptState === 'provider-reported-result' &&
        calls.length === 1 && matchingWriteCalls === 1 &&
        (!readEvidence || readEvidence.readCalls === 1 && readEvidence.matchingReadCalls === 1 && readEvidence.browserProof) };
  } };
}

const windowsUserSid = /^S-1-(?:5-21|12-1)(?:-\d{1,10}){4}$/;
const tokenFields = String.raw`using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public static class AgentContinueAcceptanceToken {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll",SetLastError=true)]
  static extern bool OpenProcessToken(IntPtr process,uint access,out SafeAccessTokenHandle token);
  [DllImport("advapi32.dll",SetLastError=true)]
  static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,IntPtr buffer,int size,out int returned);
  static Exception Unavailable() { return new InvalidOperationException("token_observation_failed"); }
  static string Sid(SafeAccessTokenHandle token,int kind) {
    int size;
    if(GetTokenInformation(token,kind,IntPtr.Zero,0,out size) ||
        Marshal.GetLastWin32Error()!=122 || size<IntPtr.Size || size>4096) throw Unavailable();
    IntPtr value=Marshal.AllocHGlobal(size);
    try {
      int actual;
      if(!GetTokenInformation(token,kind,value,size,out actual) || actual>size || actual<IntPtr.Size) throw Unavailable();
      return new SecurityIdentifier(Marshal.ReadIntPtr(value)).Value;
    } finally { Marshal.FreeHGlobal(value); }
  }
  public static string Read() {
    SafeAccessTokenHandle token;
    if(!OpenProcessToken(GetCurrentProcess(),8,out token)) throw Unavailable();
    using(token) using(var impersonation=WindowsIdentity.GetCurrent(true)) using(var identity=WindowsIdentity.GetCurrent()) {
      string user=Sid(token,1);
      if(impersonation!=null || identity.User.Value!=user) throw Unavailable();
      IntPtr value=Marshal.AllocHGlobal(4);
      int size, elevated;
      try {
        if(!GetTokenInformation(token,20,value,4,out size) || size!=4) throw Unavailable();
        elevated=Marshal.ReadInt32(value);
        if(elevated!=0 && elevated!=1) throw Unavailable();
      } finally { Marshal.FreeHGlobal(value); }
      string label=Sid(token,25);
      uint integrity;
      if(!label.StartsWith("S-1-16-",StringComparison.Ordinal) || !UInt32.TryParse(label.Substring(7),out integrity))
        throw Unavailable();
      bool admin=new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
      return user+":"+elevated+":"+integrity+":"+(admin?"1":"0");
    }
  }
}`;

function currentWindowsSid(system32) {
  const file = path.join(system32, 'whoami.exe');
  requireValid(fs.realpathSync.native(file).toLowerCase() === file.toLowerCase());
  const output = execFileSync(file, ['/user', '/fo', 'csv', '/nh'],
    { windowsHide: true, encoding: 'utf8', timeout: 3000, maxBuffer: 4096 });
  const match = /,"(S-1-[0-9-]+)"$/.exec(output.trim());
  requireValid(match && windowsUserSid.test(match[1]));
  return match[1];
}

export function prepareHostedShellProbe(state, { exact = false, expectedWindowsToken, expectedWindowsSid, stagePrepared } = {}) {
  requireValid(expectedWindowsToken === undefined || exact && ['standard', 'administrator'].includes(expectedWindowsToken));
  requireValid(expectedWindowsSid === undefined || expectedWindowsToken && typeof expectedWindowsSid === 'string' &&
    expectedWindowsSid.length <= 64 && windowsUserSid.test(expectedWindowsSid));
  requireValid(stagePrepared === undefined || exact && expectedWindowsToken && typeof stagePrepared === 'function');
  requireValid(process.platform === 'win32' && /^[A-Za-z]:\\[^\x00-\x1f]+$/.test(process.env.SystemRoot ?? ''));
  const system32 = path.join(process.env.SystemRoot, 'System32');
  const executable = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  requireValid(fs.realpathSync.native(executable).toLowerCase() === executable.toLowerCase());
  // Keep the absolute system path, without requiring chat to preserve JSON backslash escapes.
  const shell = executable.replaceAll('\\', '/');
  const { work, operationId, readOptional, assertCurrent, assertFresh, evidence } = prepareHostedMutationProbe(state);
  const token = randomBytes(16).toString('hex');
  const proof = expectedWindowsToken && path.join(work, 'ac-web-token-' + token + '.proof');
  const ownerSid = proof && (expectedWindowsSid ?? currentWindowsSid(system32));
  if (proof) requireValid(readOptional(proof, 192) === null);
  // Only the disposable probe writes a receipt. It measures its own effective
  // token in PowerShell, not the token of the browser, installer or Node owner.
  const proofCommand = proof ? [
    "$ErrorActionPreference='Stop'",
    "$PSModuleAutoLoadingPreference='None'",
    "Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1'))",
    "Add-Type -TypeDefinition @'\n" + tokenFields + "\n'@\n",
    "$observed=[AgentContinueAcceptanceToken]::Read()",
    "$random=[byte[]]::new(16)",
    "$rng=[Security.Cryptography.RandomNumberGenerator]::Create()",
    "try{$rng.GetBytes($random)}finally{$rng.Dispose()}",
    "$challenge=[BitConverter]::ToString($random).Replace('-','').ToLowerInvariant()",
    "$p=[IO.Path]::Combine([Environment]::CurrentDirectory,'" + path.basename(proof) + "')",
    "$data=[Text.Encoding]::ASCII.GetBytes(('v2:'+([string]$PID)+':'+$observed+':" + token + ":'+$challenge))",
    "$f=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)",
    "try{$f.Write($data,0,$data.Length);$f.Flush($true)}finally{$f.Dispose()}",
  ].join(';') + ';' : '';
  const command = proofCommand + "Write-Output ('AC_WEB_' + 'SHELL_' + " + (proof ? "$challenge" : "'" + token + "'") + ")";
  const timeout_ms = proof ? 15000 : 10000;
  const hash = createHash('sha256').update(JSON.stringify([command, shell, timeout_ms]), 'utf8').digest('hex');
  const request = Object.freeze(stagePrepared ? stagePrepared({ command, shell, timeout_ms }, hash) :
    { command, shell, timeout_ms, agent_continue_operation_id: operationId, ...(exact ? { agent_continue_process_sha256: hash } : {}) });
  if (stagePrepared) {
    requireValid(Object.keys(request).length === 2 && request.agent_continue_process_sha256 === hash &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.agent_continue_operation_id));
    assertFresh(request.agent_continue_operation_id);
  }
  const tool = stagePrepared ? 'agent_continue_start_prepared_process' : exact ? 'agent_continue_start_process_exact' : 'start_process';
  return { tool, request, verify(window, { browserDigest } = {}) {
    const { receiptState, exactReceipt, preparedReceipt, entries } = evidence(window, request.agent_continue_operation_id);
    let child = null, childProof = 'missing';
    if (proof) {
      try {
        const bytes = readOptional(proof, 192);
        if (bytes) {
          const match = /^v2:([1-9]\d{0,9}):(S-1-[0-9-]{1,60}):([01]):(\d{1,5}):([01]):([0-9a-f]{32}):([0-9a-f]{32})$/.exec(decoder.decode(bytes));
          const at = fs.statSync(proof).mtimeMs;
          if (!match || match[6] !== token || !windowsUserSid.test(match[2]) || Number(match[1]) > 0xffffffff ||
              at < window.openedAt || at > window.closedAt + 1) childProof = 'invalid';
          else {
            const integrity = Number(match[4]);
            const role = match[3] === '1' && match[5] === '1' && integrity >= 0x3000 && integrity < 0x4000 ? 'administrator' :
              match[3] === '0' && match[5] === '0' && integrity >= 0x2000 && integrity < 0x3000 ? 'standard' : null;
            child = { pid: match[1], sid: match[2], role, challenge: match[7] };
          }
        }
      } catch { childProof = 'invalid'; }
      assertCurrent();
    }
    const marker = proof ? child && 'AC_WEB_SHELL_' + child.challenge : 'AC_WEB_SHELL_' + token;
    const calls = entries.filter(entry => entry.toolName === 'start_process');
    const exactCommand = ({ arguments: args }) => args?.command === command;
    const exactShell = ({ arguments: args }) => args?.shell === shell;
    const exactTimeout = ({ arguments: args }) => args?.timeout_ms === timeout_ms;
    const observed = calls.map(call => {
      const { output } = call;
      if (output?.isError === true || !Array.isArray(output?.content)) {
        return { call, markerSeen: false, processFinished: false };
      }
      const lines = output.content.filter(part => part.type === 'text' && typeof part.text === 'string')
        .flatMap(part => part.text.split(/\r?\n/));
      const starts = lines.flatMap(line => /(?:^|\s)Process started with PID ([1-9]\d*)(?:\s|$)/.exec(line)?.[1] ?? []);
      const exits = lines.flatMap(line => /(?:^|\s)Process ([1-9]\d*) has finished execution\s*$/.exec(line)?.[1] ?? []);
      const processFinished = starts.length === 1 && exits.length === 1 && starts[0] === exits[0];
      return { call, markerSeen: Boolean(marker) && lines.filter(line => line.trim() === marker).length === 1,
        processFinished, pid: processFinished ? starts[0] : null };
    });
    const finished = observed.filter(item => item.markerSeen && item.processFinished);
    const matching = finished.filter(({ call }) => exactCommand(call) && exactShell(call) && exactTimeout(call));
    const matchingFinishedCalls = matching.length;
    let tokenEvidence;
    if (proof) {
      let childToken = null, childAccountMatches = false;
      if (child) {
        if (matching.length !== 1 || child.pid !== matching[0].pid) childProof = 'pid-or-output-unconfirmed';
        else {
          childAccountMatches = child.sid === ownerSid;
          childToken = child.role;
          childProof = !childAccountMatches ? 'account-mismatch' :
            childToken === expectedWindowsToken ? 'verified' : 'token-mismatch';
        }
      }
      tokenEvidence = { expectedWindowsToken, childToken, childAccountMatches, childProof };
    }
    const browserProof = browserDigest === undefined ? undefined : Boolean(proof && marker && browserDigest === digest(marker));
    return { receiptState, shellCalls: calls.length, exactCommandCalls: calls.filter(exactCommand).length,
      exactShellCalls: calls.filter(exactShell).length, exactTimeoutCalls: calls.filter(exactTimeout).length,
      markerOutputCalls: observed.filter(item => item.markerSeen).length,
      finishedProcessCalls: observed.filter(item => item.processFinished).length,
      finishedMarkerCalls: finished.length, matchingFinishedCalls,
      ...(stagePrepared ? { preparedReceipt } : exact ? { exactReceipt } : {}), ...tokenEvidence,
      ...(browserProof === undefined ? {} : { browserProof }),
      verified: (stagePrepared ? preparedReceipt : !exact || exactReceipt) && receiptState === 'provider-reported-result' &&
        calls.length === 1 && matchingFinishedCalls === 1 && browserProof !== false &&
        (!tokenEvidence || tokenEvidence.childProof === 'verified') };
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  const args = process.argv.slice(2);
  let result;
  if (args.length === 1 && args[0] === 'prepare') {
    result = checked('PREPARE_FAILED', prepare);
  } else if (args.length === 2 && args[0] === 'prepare' && args[1] === '--comparison') {
    result = checked('PREPARE_FAILED', () => prepare(probeNames));
  } else if (args.length === 3 && args[0] === 'compare' && probeNames.includes(args[2])) {
    result = await compare(args[1], args[2]);
  } else if (args.length === 6 && args[0] === 'history' && probeNames.includes(args[2]) &&
      args.slice(4).every(value => /^\d{1,16}$/.test(value))) {
    result = checked('INVALID_HISTORY', () => verifyHostedReadHistory(args[1], args[2], args[3],
      { openedAt: Number(args[4]), closedAt: Number(args[5]) }));
  } else {
    throw new CanaryError('INVALID_ARGUMENTS');
  }
  console.log(JSON.stringify(result));
  if (result.match === false || result.markerMatched === false) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof CanaryError ? error.message : 'INTERNAL_ERROR' }));
  process.exitCode = 2;
}
