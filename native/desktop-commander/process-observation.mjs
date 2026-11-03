import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const invalid = () => { throw new Error('invalid_process_identity'); };
const unknown = () => { throw new Error('process_observation_failed'); };
const pidOK = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const timeOK = value => typeof value === 'string' && /^[1-9]\d{0,23}$/.test(value);
function executable(value) {
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) invalid();
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function parseLinuxStat(bytes, expectedPid) {
  const end = bytes.lastIndexOf(')'), start = bytes.indexOf('(');
  if (!pidOK(expectedPid) || start < 1 || end < start || Number(bytes.slice(0, start).trim()) !== expectedPid) unknown();
  const fields = bytes.slice(end + 1).trim().split(/\s+/), parentPid = Number(fields[1]);
  if (fields.length < 20 || fields[0].length !== 1 || !Number.isInteger(parentPid) || parentPid < 0 || !timeOK(fields[19])) unknown();
  return { pid: expectedPid, parentPid, startTime: fields[19], state: fields[0] };
}

function procText(file, limit = 65536) {
  const info = fs.statSync(file);
  if (!info.isFile() || info.size > limit) unknown();
  const value = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(value) > limit) unknown();
  return value;
}

async function windowsQuery(field, pid) {
  const root = process.env.SystemRoot;
  if (!root || !path.isAbsolute(root)) unknown();
  const source = fs.readFileSync(new URL('./windows-process-query.cs', import.meta.url), 'utf8');
  if (Buffer.byteLength(source) > 65536 || source.includes("\n'@")) unknown();
  const script = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$PSModuleAutoLoadingPreference='None';Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1'));[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -TypeDefinition @'\n${source}\n'@\n$r=[AgentContinueProcessQuery]::Query(${pid},$${field === 'ParentProcessId' ? 'true' : 'false'});[Console]::WriteLine((ConvertTo-Json -InputObject @($r) -Compress))`;
  const stdout = await new Promise((resolve, reject) => execFile(path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, shell: false, timeout: 5000, maxBuffer: 65536, encoding: 'utf8',
      env: { SystemRoot: root, WINDIR: root,
        PSModulePath: path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
    }, (error, out, stderr) => error || stderr ? reject(new Error('process_observation_failed')) : resolve(out)));
  const rows = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!Array.isArray(rows) || rows.length > 256) unknown();
  for (const row of rows) {
    if (!row || !pidOK(row.pid) || !Number.isInteger(row.parentPid) || row.parentPid < 0 || !timeOK(row.startTime)) unknown();
    executable(row.executable);
  }
  return rows;
}

async function processIdentity(pid) {
  if (process.platform === 'linux') {
    // An unavailable /proc mount is not evidence that a particular PID exited.
    try { parseLinuxStat(procText('/proc/self/stat'), process.pid); } catch { unknown(); }
    let stat;
    try { stat = parseLinuxStat(procText('/proc/' + pid + '/stat'), pid); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; unknown(); }
    try { return { ...stat, executable: fs.readlinkSync('/proc/' + pid + '/exe') }; }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') unknown();
      try { stat = parseLinuxStat(procText('/proc/' + pid + '/stat'), pid); }
      catch (again) { if (again.code === 'ENOENT' || again.code === 'ESRCH') return null; unknown(); }
      return { ...stat, executable: null };
    }
  }
  try {
    if (process.platform === 'win32') {
      const rows = await windowsQuery('ProcessId', pid);
      if (rows.length > 1 || (rows[0] && rows[0].pid !== pid)) unknown();
      return rows[0] || null;
    }
    unknown();
  } catch { unknown(); }
}

export async function observeCore(parentPid, nodeExecutable) {
  if (!pidOK(parentPid)) invalid();
  const expected = executable(nodeExecutable);
  try {
    let rows;
    if (process.platform === 'win32') rows = await windowsQuery('ParentProcessId', parentPid);
    else if (process.platform === 'linux') {
      parseLinuxStat(procText('/proc/self/stat'), process.pid);
      const children = new Set(), taskRoot = '/proc/' + parentPid + '/task';
      let threads;
      try { threads = fs.readdirSync(taskRoot); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (threads.length > 4096) unknown();
      for (const tid of threads) {
        if (!/^\d+$/.test(tid)) continue;
        let bytes;
        try { bytes = procText(taskRoot + '/' + tid + '/children'); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const item of bytes.trim().split(/\s+/).filter(Boolean)) {
          const pid = Number(item); if (!pidOK(pid)) unknown(); children.add(pid);
        }
      }
      if (children.size > 256) unknown();
      rows = [];
      for (const pid of children) {
        const row = await processIdentity(pid);
        if (row && !['Z', 'X', 'x'].includes(row.state)) rows.push(row);
      }
    } else unknown();
    const matching = rows.filter(row => row.parentPid === parentPid && executable(row.executable) === expected);
    if (matching.length > 1) unknown();
    if (!matching.length) return null;
    return { pid: matching[0].pid, startTime: matching[0].startTime, executable: nodeExecutable };
  } catch { unknown(); }
}

export async function hasExited(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity) || Object.keys(identity).length !== 3 ||
      !['pid', 'startTime', 'executable'].every(key => Object.hasOwn(identity, key)) || !pidOK(identity.pid) || !timeOK(identity.startTime)) invalid();
  const expected = executable(identity.executable), observed = await processIdentity(identity.pid);
  if (!observed || observed.startTime !== identity.startTime) return true;
  if (process.platform === 'linux' && ['Z', 'X', 'x'].includes(observed.state)) return true;
  if (!observed.executable) unknown();
  if (executable(observed.executable) !== expected) unknown();
  return false;
}
