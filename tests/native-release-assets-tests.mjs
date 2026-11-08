import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as packager from '../native/bootstrap/build-package.mjs';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('bundled publisher policy has a matching independent preparer code pin',()=>{
  const bytes=fs.readFileSync(new URL('../native/bootstrap/native-publishers.json',import.meta.url));
  const source=fs.readFileSync(new URL('../native/bootstrap/Prepare-ReleaseNative.ps1',import.meta.url),'utf8');
  const packagerSource=fs.readFileSync(new URL('../native/bootstrap/build-package.mjs',import.meta.url),'utf8');
  assert.ok(source.includes("$record.Hash -cne '"+hash(bytes)+"'"));
  assert.ok(packagerSource.includes("const publisherPolicySha256 = '"+hash(bytes)+"'"));
  assert.ok(source.includes("[IO.Path]::Combine($PSScriptRoot, 'native-publishers.json')"));
  assert.ok(source.includes('$signature.TimeStamperCertificate'));
});

test('Windows Git checkout preserves the independently pinned publisher policy bytes',t=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'ac-publisher-checkout-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const policy='native/bootstrap/native-publishers.json';
  const bytes=fs.readFileSync(new URL('../'+policy,import.meta.url));
  const attributes=new URL('../.gitattributes',import.meta.url);
  fs.mkdirSync(path.join(root,'native/bootstrap'),{recursive:true});
  fs.writeFileSync(path.join(root,policy),bytes);
  fs.writeFileSync(path.join(root,'.gitattributes'),fs.existsSync(attributes)?fs.readFileSync(attributes):'');
  const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true,stdio:'pipe',timeout:10000});
  git('init','--quiet');
  git('-c','core.autocrlf=false','add','--','.gitattributes',policy);
  fs.unlinkSync(path.join(root,policy));
  git('-c','core.autocrlf=true','checkout-index','--all','--force');
  assert.equal(hash(fs.readFileSync(path.join(root,policy))),hash(bytes));
});

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ac-release-assets-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const releaseRoot=path.join(root,'native-release');
  fs.mkdirSync(path.join(releaseRoot,'x64'),{recursive:true});
  // Package bytes only: not a PE, signature fixture or executable acceptance.
  const launcher=Buffer.from('inert release asset fixture');
  const manifest=Buffer.from('{"fixture":"payload manifest"}\n');
  const policy={format:'agent-continue-windows-native-release',version:1,releaseVersion:'0.3.0',arch:'x64',
    nodeVersion:'22.23.4',nodeSha256:'a'.repeat(64),launcherSha256:hash(launcher),
    signerThumbprint:'b'.repeat(40),payloadManifestSha256:hash(manifest)};
  const policyFile=path.join(releaseRoot,'x64','release.json');
  const launcherFile=path.join(releaseRoot,'x64','native-launcher.exe');
  const publisherFile=path.join(root,'trusted-publishers.json');
  fs.writeFileSync(publisherFile,JSON.stringify({format:'agent-continue-windows-native-publishers',version:1,thumbprints:['b'.repeat(40)]})+'\n');
  fs.writeFileSync(policyFile,JSON.stringify(policy)+'\n');fs.writeFileSync(launcherFile,launcher);
  return {root,releaseRoot,launcher,manifest,policy,policyFile,launcherFile,publisherFile,
    read(bytes=manifest){return packager.readNativeReleaseAssets(releaseRoot,bytes,publisherFile);},
    policyValue(value){fs.writeFileSync(policyFile,JSON.stringify(value)+'\n');}};
}

test('optional native release packaging has an explicit validated snapshot API',t=>{
  assert.equal(typeof packager.readNativeReleaseAssets,'function');
  const f=fixture(t);
  assert.deepEqual(packager.readNativeReleaseAssets(path.join(f.root,'absent'),f.manifest),[]);
  const result=f.read();
  assert.deepEqual(result.map(file=>file.name),['native-release/x64/release.json','native-release/x64/native-launcher.exe']);
  assert.deepEqual(result[1].bytes,f.launcher);
  fs.writeFileSync(f.launcherFile,'changed after snapshot');
  assert.deepEqual(result[1].bytes,f.launcher);
});

test('packaging refuses stale, malformed or duplicate release policy and changed binary bytes',t=>{
  assert.equal(typeof packager.readNativeReleaseAssets,'function');
  const f=fixture(t);
  for(const policy of [{...f.policy,payloadManifestSha256:'0'.repeat(64)},
    {...f.policy,launcherSha256:'0'.repeat(64)},{...f.policy,arch:'arm64'},
    {...f.policy,signerThumbprint:'not-a-certificate'},{...f.policy,unexpected:true},
    {...f.policy,releaseVersion:'00.3.0'},{...f.policy,signerThumbprint:'c'.repeat(40)}]) {
    f.policyValue(policy);
    assert.throws(()=>f.read(),/invalid_native_release_assets/);
  }
  fs.writeFileSync(f.policyFile,JSON.stringify(f.policy).replace('"version":1','"version":0,"version":1')+'\n');
  assert.throws(()=>f.read(),/invalid_native_release_assets/);
  const {version,...reordered}=f.policy;
  f.policyValue({...reordered,version});
  assert.throws(()=>f.read(),/invalid_native_release_assets/);
  f.policyValue(f.policy);fs.appendFileSync(f.launcherFile,'changed');
  assert.throws(()=>f.read(),/invalid_native_release_assets/);
});

test('packaging never sweeps unexpected files, alternate targets or linked release files',t=>{
  assert.equal(typeof packager.readNativeReleaseAssets,'function');
  const f=fixture(t);
  fs.writeFileSync(path.join(f.releaseRoot,'x64','private.txt'),'not for release');
  assert.throws(()=>f.read(),/invalid_native_release_assets/);
  fs.unlinkSync(path.join(f.releaseRoot,'x64','private.txt'));
  fs.mkdirSync(path.join(f.releaseRoot,'unknown'));
  assert.throws(()=>f.read(),/invalid_native_release_assets/);
  fs.rmdirSync(path.join(f.releaseRoot,'unknown'));
  fs.linkSync(f.launcherFile,path.join(f.root,'linked-launcher'));
  assert.throws(()=>f.read(),/invalid_native_release_assets/);
});

test('actual bootstrap package refuses a publisher self-declared only by candidate assets',t=>{
  const f=fixture(t);
  const baseline=path.join(f.root,'baseline');
  packager.buildPackage(baseline,{releaseRoot:path.join(f.root,'no-release')});
  const manifest=fs.readFileSync(path.join(baseline,'payload-manifest.json'));
  f.policyValue({...f.policy,payloadManifestSha256:hash(manifest)});
  assert.equal(fs.existsSync(path.join(baseline,'Prepare-ReleaseNative.ps1')),true);
  assert.equal(fs.existsSync(path.join(baseline,'native-publishers.json')),true);
  assert.equal(fs.existsSync(path.join(baseline,'Build-NativeLauncher.ps1')),false);
  assert.equal(fs.existsSync(path.join(baseline,'NativeLauncher.cs')),false);
  const refused=path.join(f.root,'must-not-package');
  assert.throws(()=>packager.buildPackage(refused,{releaseRoot:f.releaseRoot}),/build_failed/);
  assert.equal(fs.existsSync(refused),false);
});

test('unchanged packager rejects substituted adjacent publisher bytes even without release assets',async t=>{
  const f=fixture(t), tooling=path.join(f.root,'tooling');
  fs.mkdirSync(tooling);
  for(const name of ['build-package.mjs','payload-layout.mjs','bootstrap.mjs']) {
    fs.copyFileSync(new URL('../native/bootstrap/'+name,import.meta.url),path.join(tooling,name));
  }
  fs.copyFileSync(f.publisherFile,path.join(tooling,'native-publishers.json'));
  const isolated=await import(pathToFileURL(path.join(tooling,'build-package.mjs')).href);
  assert.throws(()=>isolated.readNativeReleaseAssets(f.releaseRoot,f.manifest),/invalid_native_release_assets/);
  assert.throws(()=>isolated.readNativeReleaseAssets(path.join(f.root,'absent'),f.manifest),/invalid_native_release_assets/);
});
