import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {buildPackage} from '../native/bootstrap/build-package.mjs';

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

for(const [manifestState,failure] of [['valid','node_not_found'],
  ['missing','payload_file_missing'],['tampered','payload_digest_mismatch']]) {
test(manifestState==='valid'
  ? 'command install respects an explicit Node path without native release or provisioning fallback'
  : `command install rejects a ${manifestState} generated payload manifest before resolving Node`,
  {skip:process.platform!=='win32',timeout:15000},async()=>{
    const temporary=fs.realpathSync.native(os.tmpdir());
    const scratch=fs.mkdtempSync(path.join(temporary,'ac-native-release-entry-'));
    try {
      // Build only the declared closure; never inherit generated checkout artifacts.
      const bootstrap=path.join(scratch,'bootstrap');
      buildPackage(bootstrap);
      const files=fs.readdirSync(bootstrap,{recursive:true})
        .filter(name=>fs.statSync(path.join(bootstrap,name)).isFile());
      fs.writeFileSync(path.join(bootstrap,'SHA256SUMS.txt'),files.map(name=>
        crypto.createHash('sha256').update(fs.readFileSync(path.join(bootstrap,name))).digest('hex')+
        '  '+name.split(path.sep).join('/')).join('\n')+'\n');
      const manifest=path.join(bootstrap,'payload-manifest.json');
      if(manifestState==='missing') fs.unlinkSync(manifest);
      if(manifestState==='tampered') fs.appendFileSync(manifest,' ');
      const localApp=path.join(scratch,'local');fs.mkdirSync(localApp);
      const destination=path.join(scratch,'must-not-install');
      const request=path.join(scratch,'request.json');
      fs.writeFileSync(request,JSON.stringify({format:'agent-continue-device-setup',version:1,
        target:'windows',extensionId:'a'.repeat(32),nativeHost:'com.agentcontinue.device_control'})+'\n');
      const before=fs.readdirSync(scratch,{recursive:true}).sort().map(name=>[name,
        fs.statSync(path.join(scratch,name)).isDirectory()?null:fs.readFileSync(path.join(scratch,name))]);
      const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
      await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',
        path.join(bootstrap,'install.ps1'),'-InstallLocal','-Consent','accept-install',
        '-SetupRequest',request,'-InstallDir',destination,'-NodePath',path.join(scratch,'missing-node.exe')],
      {windowsHide:true,timeout:10000,env:{...process.env,LOCALAPPDATA:localApp}}),error=>{
        assert.equal(error.code,1);assert.equal(error.stdout,'');
        assert.equal(error.stderr.trim(),'agent_continue_install_failed: '+failure);
        return true;
      });
      assert.equal(fs.existsSync(destination),false);
      assert.deepEqual(fs.readdirSync(localApp),[]);
      assert.deepEqual(fs.readdirSync(scratch,{recursive:true}).sort().map(name=>[name,
        fs.statSync(path.join(scratch,name)).isDirectory()?null:fs.readFileSync(path.join(scratch,name))]),before);
    } finally {
      assert.equal(path.dirname(fs.realpathSync.native(scratch)),temporary);
      assert.match(path.basename(scratch),/^ac-native-release-entry-[A-Za-z0-9]+$/);
      fs.rmSync(scratch,{recursive:true,force:true});
    }
  });
}
