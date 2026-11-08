import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const windowsOnly = { skip: process.platform !== 'win32' };
const generator = fileURLToPath(new URL('../scripts/prepare-hosted-administrator-probe.mjs', import.meta.url));
const reader = fileURLToPath(new URL('../scripts/Read-HostedAdministratorProbe.ps1', import.meta.url));
const ps = () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const digest = body => createHash('sha256').update(body).digest('hex');

function run(file, args, cwd) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.stderr, '');
  return result;
}

function shell(command, cwd) {
  return run(ps(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64')], cwd);
}

function cleanFixture(dir, files) {
  for (const name of files) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmdirSync(dir);
}

test('generated command verifies the actual Windows token before writing a proof', windowsOnly, () => {
  const generated = run(process.execPath, [generator, 'chatgpt']);
  assert.equal(generated.status, 0);
  const plan = JSON.parse(generated.stdout);
  const planDir = path.dirname(plan.file);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-admin-token-test-'));
  try {
    const body = fs.readFileSync(plan.file);
    assert.equal(digest(body), plan.sha256);
    assert.equal(plan.steps.length, 1);
    const [{ arguments: args }] = JSON.parse(body);
    assert.equal(args.agent_continue_process_sha256, digest(JSON.stringify([args.command, args.shell, args.timeout_ms])));
    assert.match(args.command, /GetTokenInformation/);
    assert.match(args.command, /GetTokenInformation\(\$token,20,\$buffer,4,/);
    const identity = shell(String.raw`$x=[Security.Principal.WindowsIdentity]::GetCurrent()
if ([Security.Principal.WindowsPrincipal]::new($x).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 42 }`);
    assert.ok([0, 42].includes(identity.status));
    const child = shell(args.command, fixture);
    if (identity.status === 0) {
      assert.equal(child.status, 31);
      assert.deepEqual(fs.readdirSync(fixture), []);
    } else {
      assert.equal(child.status, 0);
      const proof = fs.readFileSync(path.join(fixture, plan.steps[0].proof), 'ascii');
      assert.match(proof, /^v2:[1-9]\d{0,9}:S-1-[\d-]+:1:S-1-16-12288:AC_ADMIN_[a-f0-9]{32}$/);
      assert.equal(proof.split(':').at(-1), child.stdout.trim());
    }
  } finally {
    cleanFixture(fixture, [plan.steps[0].proof]);
    cleanFixture(planDir, ['plan.json']);
  }
});

test('readback distinguishes legacy identity from independently checked elevation', windowsOnly, () => {
  const cmd = String.raw`$ErrorActionPreference='Stop'
$reader='__READER__'
$ast=[Management.Automation.Language.Parser]::ParseFile($reader,[ref]$null,[ref]$null)
$parser=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Read-AdministratorChildWitness'},$true)
if (-not $parser) { exit 70 }
. ([scriptblock]::Create($parser.Extent.Text))
$sid='S-1-5-21-1-2-3-1001'
$marker='AC_ADMIN_0123456789abcdef0123456789abcdef'
$legacy='17:'+$sid+':'+$marker
$v2='v2:17:'+$sid+':1:S-1-16-12288:'+$marker
$values=@($legacy,$v2,$v2.Replace(':1:S-1-16-',':0:S-1-16-'),$v2.Replace('12288','8192'),$v2.Replace($sid,'S-1-5-21-1-2-3-1002'))
foreach ($value in $values) {
    $result=Read-AdministratorChildWitness $value $sid
    if ($null -eq $result) { 'invalid' }
    else { "$($result.Pid),$($result.TokenElevationVerified),$($result.Marker)" }
}`.replace('__READER__', () => reader.replaceAll("'", "''"));
  const result = shell(cmd);
  assert.equal(result.status, 0);
  const marker = 'AC_ADMIN_0123456789abcdef0123456789abcdef';
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    '17,False,' + marker, '17,True,' + marker, 'invalid', 'invalid', 'invalid',
  ]);
});
