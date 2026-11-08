import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile);

test('legacy native preparation validates a vendor release before resolving Node without a compiler fallback',()=>{
  const source=fs.readFileSync(path.join(root,'native/bootstrap/install.ps1'),'utf8');
  assert.ok(source.includes('Prepare-ReleaseNative.ps1'));
  assert.doesNotMatch(source,/Build-NativeLauncher\.ps1|CompileAssemblyFromSource/);
  const installStart = source.indexOf('$script:acNativePlan = $null');
  assert.ok(installStart >= 0, 'standard installation flow must exist');
  const install = source.slice(installStart);
  const nativePlan = install.indexOf('$script:acNativePlan = Invoke-NativeRelease $false $false');
  const resolveNode = install.indexOf('$resolvedNode = Resolve-Node');
  assert.ok(nativePlan >= 0 && resolveNode >= 0 && nativePlan < resolveNode,
    'validate the vendor release before resolving or provisioning Node');
  assert.match(install, /if \(\$PrepareNative\) \{\s*\$script:acNativePlan = Invoke-NativeRelease \$false \$false/);
  assert.match(install, /\$resolvedNode = Resolve-Node\s*\$script:acNode = \$resolvedNode\.Path\s*\$script:acNodeVersion = \$resolvedNode\.Version/);
  assert.match(install, /\$script:acNodeVersion -cne \$script:acNativePlan\.nodeVersion -or\s*\(Get-FileHash -LiteralPath \$script:acNode -Algorithm SHA256\)\.Hash\.ToLowerInvariant\(\) -cne \$script:acNativePlan\.nodeSha256\) \{\s*throw 'native_release_node_mismatch'/);
  assert.ok(source.includes('$nativeReceipt = Invoke-NativeRelease $true $true'));
  assert.ok(source.includes("$script:acNode = Join-Path $InstallDir 'runtime\\node.exe'"));
  assert.match(source, /@\('install-local', '--install-dir', \$InstallDir/);
  const cli=fs.readFileSync(path.join(root,'cli.mjs'),'utf8');
  const local=cli.slice(cli.indexOf("if (first === 'install-local')"),cli.indexOf("if (['status'"));
  assert.doesNotMatch(local,/powershell\.exe|execFile|PrepareNative|RegisterNative/);
  assert.match(local,/return main\(/);
});

test('command install respects an explicit Node path without native release or provisioning fallback',
  {skip:process.platform!=='win32',timeout:15000},async()=>{
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-native-release-entry-'));
    try {
      const localApp=path.join(scratch,'local');fs.mkdirSync(localApp);
      const destination=path.join(scratch,'must-not-install');
      const request=path.join(scratch,'request.json');
      fs.writeFileSync(request,JSON.stringify({format:'agent-continue-device-setup',version:1,
        target:'windows',extensionId:'a'.repeat(32),nativeHost:'com.agentcontinue.device_control'})+'\n');
      const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
      await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',
        path.join(root,'native/bootstrap/install.ps1'),'-InstallLocal','-Consent','accept-install',
        '-SetupRequest',request,'-InstallDir',destination,'-NodePath',path.join(scratch,'missing-node.exe')],
      {windowsHide:true,timeout:10000,env:{...process.env,LOCALAPPDATA:localApp}}),error=>{
        assert.equal(error.code,1);assert.equal(error.stdout,'');
        assert.equal(error.stderr.trim(),'agent_continue_install_failed: node_not_found');
        return true;
      });
      assert.equal(fs.existsSync(destination),false);
      assert.deepEqual(fs.readdirSync(localApp),[]);
    } finally {fs.rmSync(scratch,{recursive:true,force:true});}
  });
