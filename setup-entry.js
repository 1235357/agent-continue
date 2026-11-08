import { SETUP_ENTRY_RELEASE } from './setup-entry-release.js';

const keys = ['format', 'version', 'releaseTag', 'entryUrl', 'entrySha256', 'sumsSha256'];
const id = value => typeof value === 'string' && /^[a-p]{32}$/.test(value) && value.length === 32;
const operation = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) && value.length === 32;
const pin = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
const ps = value => `'${value.replaceAll("'", "''")}'`;
const osPowerShell = "([IO.Path]::Combine([Environment]::GetFolderPath('System'),'WindowsPowerShell\\v1.0\\powershell.exe'))";

export function validSetupEntryMetadata(value, version) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join() &&
    value.format === 'agent-continue-windows-setup-entry' && value.version === 1 &&
    typeof version === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) &&
    value.releaseTag === `v${version}` &&
    value.entryUrl === `https://github.com/1235357/agent-continue/releases/download/v${version}/install.ps1` &&
    pin(value.entrySha256) && pin(value.sumsSha256);
}

function localCommand(extensionId, shell, setupId, scope) {
  const suffix = setupId === undefined ? '' : ` -BrowserSetupId ${setupId}`;
  if (shell === 'browserPowerShell') return scope === 'administrator'
    ? `.\\install.ps1 -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId '${extensionId}'${suffix}`
    : `.\\install.ps1 -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId '${extensionId}'${suffix}`;
  return `install.cmd guided-${scope === 'administrator' ? 'administrator' : 'browser'} ${extensionId}` +
    (setupId === undefined ? '' : ` ${setupId}`);
}

// This is the fixed acquisition program, not remotely supplied PowerShell.
// The downloaded entry executes only as a separate OS PowerShell -File child.
export function windowsEntryBootstrapSource({ extensionId, setupId, scope, metadata }) {
  if (!id(extensionId) || (setupId !== undefined && !operation(setupId)) ||
      !['current-account', 'administrator'].includes(scope) ||
      !validSetupEntryMetadata(metadata, metadata?.releaseTag?.slice(1))) return '';
  const args = scope === 'administrator'
    ? '-Administrator -Apply -Consent accept-administrator-browser-installation'
    : '-InstallLocal -BrowserManaged -Consent accept-install';
  return String.raw`
$ErrorActionPreference='Stop';$code=1;$held=$null;$file=$null;$dir=$null;
$watch=[Diagnostics.Stopwatch]::StartNew();
function Budget { $left=90000-$watch.ElapsedMilliseconds;if($left -le 0){throw 'entry_deadline'};return [int]$left; };
function EntryUri([uri]$u) { if(-not $u.IsAbsoluteUri -or $u.Scheme -cne 'https' -or $u.Port -ne 443 -or $u.UserInfo -or $u.Fragment -or $u.DnsSafeHost -cnotin @('github.com','release-assets.githubusercontent.com','objects.githubusercontent.com')){throw 'entry_destination'}; };
function EntryRequest([uri]$url) { return [Net.HttpWebRequest]::Create($url); };
function Download([uri]$url,[IO.Stream]$output) {
for($hop=0;$hop -le 3;$hop++) {
EntryUri $url;$request=EntryRequest $url;$request.AllowAutoRedirect=$false;$request.UseDefaultCredentials=$false;$request.Timeout=(Budget);$response=$null;
try {
$response=$request.GetResponse();$status=[int]$response.StatusCode;
if($status -in @(301,302,303,307,308)) { if($hop -eq 3 -or -not $response.Headers['Location']){throw 'entry_redirect'};$url=[uri]::new($url,$response.Headers['Location']);continue; };
if($status -ne 200 -or $response.ContentLength -gt 4194304){throw 'entry_response'};
$network=$response.GetResponseStream();$buffer=[byte[]]::new(65536);$total=0;
while($true) { $network.ReadTimeout=(Budget);$count=$network.Read($buffer,0,$buffer.Length);if($count -eq 0){break};$total+=$count;if($total -gt 4194304){throw 'entry_size'};$output.Write($buffer,0,$count); };
if($total -lt 1 -or ($response.ContentLength -ge 0 -and $response.ContentLength -ne $total)){throw 'entry_size'};return;
} finally { if($response){$response.Close()};$request.Abort(); };
};throw 'entry_redirect';
};
function VerifyEntry([IO.Stream]$held,[string]$expected,[string]$tag) {
if($held.Length -lt 1 -or $held.Length -gt 4194304){throw 'entry_size'};
$reader=[IO.BinaryReader]::new($held,[Text.Encoding]::UTF8,$true);$bytes=$reader.ReadBytes([int]$held.Length);$reader.Dispose();
$hash=[Security.Cryptography.SHA256]::Create();try{$actual=[BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant();}finally{$hash.Dispose();};
if($actual -cne $expected){throw 'entry_hash'};
$text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes).TrimStart([char]0xfeff);
$stamps=[regex]::Matches($text,'(?im)^[ \t]*\$script:acReleaseTag[ \t]*=[^\r\n]*');
if($stamps.Count -ne 1 -or $stamps[0].Value.Trim() -cne ('$script:acReleaseTag = '+[char]39+$tag+[char]39)){throw 'entry_stamp'};
};
try {
$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());
for($p=[IO.DirectoryInfo]::new($base);$null -ne $p;$p=$p.Parent){if(-not $p.Exists -or ($p.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'entry_temp'};};
$dir=[IO.Path]::Combine($base,('agent-continue-entry-'+[guid]::NewGuid().ToString('N')));
if([IO.Directory]::Exists($dir) -or [IO.File]::Exists($dir)){throw 'entry_exists'};
$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl.SetOwner($user);
 $sids=@($user,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));
foreach($sid in $sids){$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);};
Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop;
Add-Type ('using System;using System.Runtime.InteropServices;public static class AcEntryDir{[DllImport('+[char]34+'kernel32.dll'+[char]34+',CharSet=CharSet.Unicode,SetLastError=true,ExactSpelling=true)]public static extern bool CreateDirectoryW(string path,IntPtr security);}');
$security=$attributes=[IntPtr]::Zero;
try{$bytes=$acl.GetSecurityDescriptorBinaryForm();$security=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length);[Runtime.InteropServices.Marshal]::Copy($bytes,0,$security,$bytes.Length);$size=3*[IntPtr]::Size;$attributes=[Runtime.InteropServices.Marshal]::AllocHGlobal($size);[Runtime.InteropServices.Marshal]::WriteInt32($attributes,$size);[Runtime.InteropServices.Marshal]::WriteIntPtr($attributes,[IntPtr]::Size,$security);[Runtime.InteropServices.Marshal]::WriteInt32($attributes,2*[IntPtr]::Size,0);if(-not [AcEntryDir]::CreateDirectoryW($dir,$attributes)){throw 'entry_exists'};}finally{if($attributes -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($attributes)};if($security -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($security)};};
$info=[IO.DirectoryInfo]::new($dir);$actualAcl=$info.GetAccessControl();
if(-not $actualAcl.AreAccessRulesProtected -or $actualAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user.Value){throw 'entry_acl'};
$rules=$actualAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);if($rules.Count -ne 3){throw 'entry_acl'};
foreach($rule in $rules){if($rule.IdentityReference.Value -cnotin $sids.Value -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl' -or $rule.IsInherited -or $rule.InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or $rule.PropagationFlags -ne 'None'){throw 'entry_acl'};};
if($info.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'entry_temp'};
$file=[IO.Path]::Combine($dir,'install.ps1');$output=[IO.File]::Open($file,'CreateNew','Write','None');
try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Download ([uri]${ps(metadata.entryUrl)}) $output;$output.Flush($true);}finally{$output.Dispose();};
$held=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);
VerifyEntry $held ${ps(metadata.entrySha256)} ${ps(metadata.releaseTag)};
Remove-Item Env:AGENT_CONTINUE_PAYLOAD_BASE -ErrorAction SilentlyContinue;
$engine=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::System),'WindowsPowerShell\v1.0\powershell.exe');
& $engine -NoLogo -NoProfile -File $file ${args} -PromptForConnection -ExtensionId ${ps(extensionId)}${setupId === undefined ? '' : ` -BrowserSetupId ${setupId}`} -ExpectedSumsSha256 ${ps(metadata.sumsSha256)};
$code=$LASTEXITCODE;if($null -eq $code){$code=1};
}catch{[Console]::Error.WriteLine('agent_continue_entry_failed');$code=1;}finally{
if($held){try{$held.Dispose()}catch{}};
if($file -and $dir -and [IO.Path]::GetDirectoryName($file) -ceq $dir -and [IO.Path]::GetDirectoryName($dir).TrimEnd('\') -ceq $base.TrimEnd('\')){try{[IO.File]::Delete($file);[IO.Directory]::Delete($dir,$false);}catch{}};
};exit $code;
`.trim().split(/\r?\n/).map(line => line.trim()).join(' ');
}

export function buildWindowsSetupCommand({ extensionId, shell, setupId, scope, version,
  entryMetadata = SETUP_ENTRY_RELEASE, mode = 'release' } = {}) {
  if (!id(extensionId) || (setupId !== undefined && !operation(setupId)) ||
      !['current-account', 'administrator'].includes(scope) ||
      !['browserPowerShell', 'browserCmd'].includes(shell)) return '';
  if (mode === 'local') return localCommand(extensionId, shell, setupId, scope);
  if (mode !== 'release' || !validSetupEntryMetadata(entryMetadata, version)) return '';
  const source = windowsEntryBootstrapSource({ extensionId, setupId, scope, metadata: entryMetadata });
  if (!source || /["%!\r\n]/.test(source)) return '';
  const command = shell === 'browserPowerShell'
    ? `& ${osPowerShell} -NoLogo -NoProfile -Command ${ps(source)}`
    : `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -Command "${source}"`;
  return command.length < 8191 ? command : '';
}
