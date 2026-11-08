import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'scripts/Sign-WindowsRelease.ps1');
const run=promisify(execFile);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('release signing entry never executes artifacts or changes endpoint trust',()=>{
  const source=fs.readFileSync(script,'utf8');
  assert.doesNotMatch(source,/Start-Process|Invoke-Expression|New-SelfSignedCertificate|Import-Certificate|Set-MpPreference|Add-MpPreference|Remove-MpThreat/);
  for(const marker of ['Set-AuthenticodeSignature','Get-AuthenticodeSignature',"'SHA256'",'accept-sign','CreateNew','localSignatureValid','classificationVerified','runtimeVerified']) assert.ok(source.includes(marker),marker);
});

test('reusable release launcher derives identity locally rather than compiling user paths',()=>{
  const source=fs.readFileSync(path.join(root,'native/bootstrap/ReleaseLauncherBinding.cs'),'utf8');
  for(const term of ['Assembly.GetExecutingAssembly().Location','"runtime", "node.exe"',
    '"app", "device-native-host.mjs"','device-native-binding.json','native-host.json',
    'JsonReaderWriterFactory.CreateJsonReader','MaxDepth = 8','NativeLauncherReleasePins.NodeSha256',
    'FileShare.Read','expected.Remove','entries.Count != 1']) assert.ok(source.includes(term),term);
  assert.doesNotMatch(source,/Environment\.GetEnvironmentVariable|Process\.Start|args\[/);
  assert.match(source,/CreateJsonReader\(bytes, 0, bytes\.Length, utf8, quotas, null\)/);
  assert.doesNotMatch(source,/CreateJsonReader\(bytes, quotas\)/);
  const build=fs.readFileSync(path.join(root,'scripts/Build-ReleaseNativeLauncher.ps1'),'utf8');
  assert.ok(build.includes("if (-not $Compile)"));
  assert.ok(build.includes('perInstallPathsEmbedded=$false'));
  assert.ok(build.includes('System.Runtime.Serialization.dll'));
  assert.match(build,/DriveInfo\(\[IO\.Path\]::GetPathRoot\(\$OutputPath\)\)/);
  assert.ok(build.indexOf("$outputDrive.DriveType -ne [IO.DriveType]::Fixed") < build.indexOf('$provider.CompileAssemblyFromSource'));
  assert.ok(build.indexOf('Clear-ReleaseTemporaries $provider $compiled $temporary') <
    build.indexOf('[Console]::Out.WriteLine'));
  assert.ok(build.includes('release_launcher_cleanup_failed'));
  assert.doesNotMatch(build,/ExtensionId|Set-MpPreference|Add-MpPreference|Start-Process/);
});

test('reusable launcher release plan verifies sources without compiling or creating an output',
  {skip:process.platform!=='win32',timeout:15000},async()=>{
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const builder=path.join(root,'scripts/Build-ReleaseNativeLauncher.ps1');
    const digest=hash(fs.readFileSync(process.execPath));
    const result=JSON.parse((await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',builder,
      '-NodePath',process.execPath,'-ExpectedNodeSha256',digest,'-Version','0.0.0'],{windowsHide:true,timeout:10000})).stdout);
    assert.equal(result.ok,true);assert.equal(result.mode,'plan');assert.equal(result.runtimePins,17);
    assert.equal(result.artifactCreated,false);assert.equal(result.signed,false);
    assert.equal(result.perInstallPathsEmbedded,false);assert.equal(result.runtimeVerified,false);
    await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',builder,'-Compile'],
      {windowsHide:true,timeout:5000}),error=>{
        assert.equal(JSON.parse(error.stdout).error,'release_launcher_consent_required');return true;
      });
  });

test('Windows framework JSON reader accepts UTF-8 and rejects UTF-16 without compiling the launcher',
  {skip:process.platform!=='win32',timeout:15000},async()=>{
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const fixture=path.join(root,'tests/windows-json-reader-tests.ps1');
    const result=JSON.parse((await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',fixture],
      {windowsHide:true,timeout:10000})).stdout);
    assert.deepEqual(result,{ok:true,utf8Accepted:true,utf16Rejected:true,malformedUtf8Rejected:true,
      launcherCompiled:false,launcherExecuted:false});
  });

test('release cleanup failures are bounded and reported before the only final receipt',
  {skip:process.platform!=='win32',timeout:15000},async()=>{
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const builder=path.join(root,'scripts/Build-ReleaseNativeLauncher.ps1');
    const fixture=path.join(root,'tests/windows-release-cleanup-tests.ps1');
    const actual=JSON.parse((await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',fixture,'-Builder',builder],
      {windowsHide:true,timeout:5000})).stdout);
    assert.deepEqual(actual,{ok:true,failuresReported:true,allCleanupAttempted:true,launcherCompiled:false,launcherExecuted:false});
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-cleanup-receipt-'));
    try {
      const entry=path.join(scratch,'plan.ps1');
      const source=fs.readFileSync(builder,'utf8').replace(
        "$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))",
        "$root = '"+root.replaceAll("'","''")+"'").replace(
        '$cleanupComplete = Clear-ReleaseTemporaries $provider $compiled $temporary',
        '$cleanupComplete = $false');
      fs.writeFileSync(entry,source);
      await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',entry,
        '-NodePath',process.execPath,'-ExpectedNodeSha256',hash(fs.readFileSync(process.execPath)),'-Version','0.0.0'],
      {windowsHide:true,timeout:8000}),error=>{
        assert.equal(error.code,1);assert.equal(error.stderr,'');
        assert.equal(error.stdout.trim().split(/\r?\n/).length,1);
        assert.deepEqual(JSON.parse(error.stdout),{ok:false,error:'release_launcher_cleanup_failed',
          artifactVerified:false,classificationVerified:false,runtimeVerified:false,cleanupComplete:false});
        return true;
      });
    } finally {fs.rmSync(scratch,{recursive:true,force:true});}
  });

test('Windows signing plan and refusal paths preserve original bytes and create no artifact',
  {skip:process.platform!=='win32',timeout:30000},async()=>{
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-signing-plan-'));
    const input=path.join(scratch,'fixture.ps1'),output=path.join(scratch,'signed-fixture.ps1');
    const bytes=Buffer.from("throw 'this file must never execute'\r\n");
    fs.writeFileSync(input,bytes);
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const base=['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-FilePath',input,'-ExpectedSha256',hash(bytes)];
    try {
      const plan=JSON.parse((await run(powershell,base,{windowsHide:true,timeout:10000})).stdout);
      assert.equal(plan.ok,true);assert.equal(plan.mode,'plan');assert.equal(plan.artifactChanged,false);
      assert.equal(plan.certificateAvailable,false);assert.equal(plan.classificationVerified,false);
      assert.equal(plan.runtimeVerified,false);assert.equal(plan.sourceSha256,hash(bytes));
      for(const [args,code] of [
        [['-Sign','-OutputPath',output],'signing_consent_required'],
        [['-Sign','-Consent','accept-sign','-OutputPath',output],'signing_certificate_required'],
        [['-Sign','-Consent','accept-sign','-OutputPath',output,'-CertificateThumbprint','0'.repeat(40),'-TimestampServer','http://timestamp.invalid'],'signing_certificate_unavailable'],
        [['-ExpectedSha256','0'.repeat(64)],'signing_input_invalid'],
      ]) {
        const command=args[0]==='-ExpectedSha256' ? [...base.slice(0,-2),...args] : [...base,...args];
        await assert.rejects(run(powershell,command,{windowsHide:true,timeout:10000}),error=>{
          const failure=JSON.parse(error.stdout);assert.equal(failure.ok,false);assert.equal(failure.error,code);
          assert.equal(error.stderr,'');return true;
        });
        assert.deepEqual(fs.readFileSync(input),bytes);
        assert.equal(fs.existsSync(output),false);
      }
    } finally { fs.rmSync(scratch,{recursive:true,force:true}); }
  });
