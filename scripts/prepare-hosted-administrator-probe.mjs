import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const id = () => randomBytes(16).toString('hex');
const sha = value => createHash('sha256').update(value).digest('hex');
const selectedSurface = process.argv[2];

// Read the command child's own process token; do not infer elevation from a
// group list, parent process, or the tunnel's launch mode.
const tokenCheck = String.raw`
$thread=[Security.Principal.WindowsIdentity]::GetCurrent($true)
if($thread){$thread.Dispose();exit 32}
$x=[Security.Principal.WindowsIdentity]::GetCurrent()
$buffer=[IntPtr]::Zero
try {
  $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
  $assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly(
    [Reflection.AssemblyName]::new('AgentContinueHostedProof'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
  $type=$assembly.DefineDynamicModule('Native').DefineType('ProofToken')
  $method=$type.DefinePInvokeMethod('GetTokenInformation',[IO.Path]::Combine($system,'advapi32.dll'),
    [Reflection.MethodAttributes]'Public, Static, PinvokeImpl',[Reflection.CallingConventions]::Standard,
    [int],[Type[]]@([IntPtr],[int],[IntPtr],[int],[int].MakeByRefType()),
    [Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::None)
  $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
  $native=$type.CreateType()
  $marshal=[Runtime.InteropServices.Marshal]
  $token=$x.Token
  $buffer=$marshal::AllocHGlobal(256)
  $size=0
  if($native::GetTokenInformation($token,20,$buffer,4,[ref]$size) -eq 0 -or $size -ne 4){exit 32}
  $elevated=$marshal::ReadInt32($buffer)
  $required=0
  if($native::GetTokenInformation($token,25,[IntPtr]::Zero,0,[ref]$required) -ne 0 -or
    $required -lt [IntPtr]::Size -or $required -gt 256){exit 32}
  if($native::GetTokenInformation($token,25,$buffer,$required,[ref]$size) -eq 0 -or $size -ne $required){exit 32}
  $label=[Security.Principal.SecurityIdentifier]::new($marshal::ReadIntPtr($buffer)).Value
  if(!([Security.Principal.WindowsPrincipal]::new($x)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    [Console]::WriteLine('AC_ADMIN_PROBE_REQUIRES_ELEVATION');exit 31
  }
  if($elevated -ne 1 -or $label -cne 'S-1-16-12288'){exit 32}
  $sid=$x.User.Value
} catch {exit 32}
finally {
  if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
  $x.Dispose()
}`.trim();

if (process.platform !== 'win32' || process.argv.length > 3 ||
    (selectedSurface !== undefined && !['chatgpt', 'dot'].includes(selectedSurface)) ||
    !/^[A-Za-z]:\\[^\r\n"]+$/.test(process.env.SystemRoot ?? '')) {
  throw new Error('Run on the Windows test host with no argument, chatgpt, or dot.');
}

const system = path.join(process.env.SystemRoot, 'System32');
const shell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe').replaceAll('\\', '/');
const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ac-hosted-admin-plan-'));
const receiptId = id();
const steps = (selectedSurface ? [selectedSurface] : ['chatgpt', 'dot']).map(surface => {
  const stepId = id();
  const proof = 'ac-hosted-admin-' + stepId + '.proof';
  // The challenge is generated in the actual command child, not in the plan.
  const command = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    tokenCheck,
    "$m='AC_ADMIN_'+[Guid]::NewGuid().ToString('N')",
    "$f=[IO.File]::Open('" + proof + "','CreateNew','Write','None')",
    "try{$b=[Text.Encoding]::ASCII.GetBytes('v2:'+$PID+':'+$sid+':'+$elevated+':'+$label+':'+$m);$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}",
    "[IO.File]::ReadAllText('" + proof + "').Split(':')[-1]",
  ].join(';');
  const timeout_ms = 15000;
  const operationId = randomUUID();
  const args = { command, shell, timeout_ms, agent_continue_operation_id: operationId,
    agent_continue_process_sha256: sha(JSON.stringify([command, shell, timeout_ms])) };
  return { surface, proof, plan: { id: stepId, name: 'agent_continue_start_process_exact', arguments: args } };
});
const file = path.join(dir, 'plan.json');
const body = JSON.stringify(steps.map(step => step.plan));
fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600, flush: true });
process.stdout.write(JSON.stringify({ file, sha256: sha(body), receiptId, steps }) + '\n');
