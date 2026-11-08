import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'win32');
assert.ok(['chatgpt', 'dot'].includes(process.argv[2]));
const surface = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-d940-process-plan-'));
const nonce = randomBytes(16).toString('hex');
const witness = path.join(directory, 'owned-process.json');
assert.equal(fs.existsSync(witness), false);
const marker = 'AC_D940_PROCESS_' + nonce;
const command = "$ErrorActionPreference='Stop';" +
  "$i=[Security.Principal.WindowsIdentity]::GetCurrent();$p=[Diagnostics.Process]::GetCurrentProcess();" +
  "$o=[ordered]@{marker='" + marker + "';pid=$PID;startTicks=$p.StartTime.ToUniversalTime().Ticks;" +
  "sid=$i.User.Value;administrator=([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)};" +
  "$i.Dispose();$b=[Text.Encoding]::UTF8.GetBytes(($o|ConvertTo-Json -Compress));" +
  "$f=[IO.File]::Open('" + witness.replaceAll("'", "''") + "','CreateNew','Write','None');" +
  "try{$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()};" +
  "[Console]::WriteLine('" + marker + "');$clock=[Diagnostics.Stopwatch]::StartNew();" +
  'while($clock.ElapsedMilliseconds -lt 300000){[Threading.Thread]::Sleep(250)}';
const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').replaceAll('\\', '/');
const timeout_ms = 3000;
const request = { command, shell, timeout_ms, agent_continue_operation_id: randomUUID(),
  agent_continue_process_sha256: createHash('sha256').update(JSON.stringify([command, shell, timeout_ms])).digest('hex') };
const plan = { surface, marker, witness, lifetimeMs: 300000, request, stopId: randomUUID() };
const file = path.join(directory, 'plan.json');
fs.writeFileSync(file, JSON.stringify(plan, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ file, surface, marker, witness, operationId: request.agent_continue_operation_id, stopId: plan.stopId }));
