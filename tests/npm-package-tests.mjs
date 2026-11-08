import test from 'node:test';
import { installationOperationFailure, requireSupportedNode } from '../cli.mjs';

test('CLI rejects unsupported Node versions before install dispatch', () => {
  for (const version of ['20.20.2','22.12.0','18.20.0','invalid','22.13.0-beta']) {
    assert.throws(() => requireSupportedNode(version), /node_version_too_old/);
  }
  for (const version of ['22.13.0','22.23.1','24.0.0']) assert.doesNotThrow(() => requireSupportedNode(version));
});

test('npm installer returns only bounded original-operation failures from PowerShell', () => {
  const receipt={ok:false,error:'manager_start_unconfirmed',operationId:'12345678-1234-4321-8123-123456789abc',
    operationStatus:'unobserved'};
  const error={code:1,stdout:JSON.stringify(receipt)};
  assert.deepEqual(installationOperationFailure(error),receipt);
  for (const invalid of [
    {...error,killed:true}, {...error,signal:'SIGTERM'}, {...error,code:'ETIMEDOUT'},
    {...error,stdout:' '.repeat(1024)+error.stdout},
    ...[[receipt],{...receipt,path:'private'},{...receipt,operationId:receipt.operationId+'\n'},
      {...receipt,operationStatus:'replayed'},{...receipt,operationStatus:['unobserved']}]
      .map(value=>({...error,stdout:JSON.stringify(value)})),
  ]) assert.equal(installationOperationFailure(invalid),null);
});
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('standalone Windows uninstall inspection never acquires a remote payload or provisions Node',
  {skip:process.platform !== 'win32',timeout:20000},async()=>{
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-uninstall-offline-'));
    const requests=[];
    const server=http.createServer((request,response)=>{
      requests.push(request.url);response.writeHead(503);response.end('fixture refuses downloads');
    });
    try {
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const standalone=path.join(scratch,'install.ps1');
      fs.copyFileSync(path.join(repo,'native/bootstrap/install.ps1'),standalone);
      const launchMarker=path.join(scratch,'node-launched.txt');
      const nodeProbe=path.join(scratch,'node-probe.cmd');
      fs.writeFileSync(nodeProbe,`@echo off\r\n>>"${launchMarker}" echo launched\r\necho v22.23.4\r\n`);
      const destination=path.join(scratch,'partial-install');fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination,'keep.txt'),'preserve partial installation');
      const localApp=path.join(scratch,'local'),temporary=path.join(scratch,'temporary');
      fs.mkdirSync(localApp);fs.mkdirSync(temporary);
      const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
      for (const node of [process.execPath,nodeProbe,path.join(scratch,'missing-node.exe')]) {
        let failure;
        try {
          await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',standalone,
            '-Uninstall','-InstallDir',destination,'-NodePath',node,
            '-PayloadBase',`http://127.0.0.1:${server.address().port}`],
          {windowsHide:true,timeout:8000,env:{...process.env,LOCALAPPDATA:localApp,TEMP:temporary,TMP:temporary}});
        } catch (error) {failure=error;}
        assert.equal(requests.length,0,'read-only uninstall inspection must never fetch a payload');
        assert.equal(failure?.code,1);
        assert.equal(failure.stdout,'');
        assert.equal(failure.stderr.trim(),'agent_continue_install_failed: uninstall_inspection_unavailable');
        assert.equal(failure.stderr.includes(scratch),false,'diagnostics must not expose local paths');
        assert.deepEqual(fs.readdirSync(destination),['keep.txt']);
        assert.equal(fs.readFileSync(path.join(destination,'keep.txt'),'utf8'),'preserve partial installation');
        assert.deepEqual(fs.readdirSync(localApp),[]);
        assert.deepEqual(fs.readdirSync(temporary),[]);
        assert.equal(fs.existsSync(launchMarker),false,'unavailable inspection must not launch Node');
      }
      for (const mixed of [['-Verify'],['-Apply','-Consent','accept-install'],['-PrepareNative'],['-RegisterNative'],['-ManagerOnly']]) {
        await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',standalone,
          '-Uninstall','-InstallDir',destination,'-NodePath',path.join(scratch,'missing-node.exe'),
          '-PayloadBase',`http://127.0.0.1:${server.address().port}`,...mixed],
        {windowsHide:true,timeout:8000,env:{...process.env,LOCALAPPDATA:localApp,TEMP:temporary,TMP:temporary}}),error=>{
          assert.equal(error.code,1);assert.equal(error.stdout,'');
          assert.equal(error.stderr.trim(),'agent_continue_install_failed: invalid_manager_arguments');return true;
        });
      }
      assert.equal(requests.length,0);
      assert.deepEqual(fs.readdirSync(destination),['keep.txt']);
      assert.deepEqual(fs.readdirSync(localApp),[]);
      assert.deepEqual(fs.readdirSync(temporary),[]);
      await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',standalone,
        '-Uninstall','-NodePath',nodeProbe],
      {windowsHide:true,timeout:8000,env:{...process.env,LOCALAPPDATA:'',PROCESSOR_ARCHITECTURE:'unsupported',PROCESSOR_ARCHITEW6432:''}}),error=>{
        assert.equal(error.code,1);assert.equal(error.stdout,'');
        assert.equal(error.stderr.trim(),'agent_continue_install_failed: uninstall_inspection_unavailable');return true;
      });
      assert.equal(fs.existsSync(launchMarker),false);
    } finally {
      await new Promise(resolve=>server.close(resolve));
      assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()));
      fs.rmSync(scratch,{recursive:true,force:true});
    }
  });

test('Windows uninstall requires a listed bootstrap entry before executing a local inspection payload',
  {skip:process.platform !== 'win32',timeout:10000},async()=>{
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-uninstall-manifest-'));
    try {
      fs.copyFileSync(path.join(repo,'native/bootstrap/install.ps1'),path.join(scratch,'install.ps1'));
      const marker=path.join(scratch,'payload-ran');
      fs.writeFileSync(path.join(scratch,'bin.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');console.log('{}');`);
      const readme=Buffer.from('fixture not the executable entry');
      fs.writeFileSync(path.join(scratch,'README.md'),readme);
      fs.writeFileSync(path.join(scratch,'SHA256SUMS.txt'),crypto.createHash('sha256').update(readme).digest('hex')+'  README.md\n');
      let failure;
      try {
        await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
          ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(scratch,'install.ps1'),
            '-Uninstall','-InstallDir',path.join(scratch,'missing-install'),'-NodePath',process.execPath],
        {windowsHide:true,timeout:8000});
      } catch (error) {failure=error;}
      assert.equal(fs.existsSync(marker),false,'an unlisted bin.mjs must never run');
      assert.equal(failure?.code,1);
      assert.equal(failure.stdout,'');
      assert.equal(failure.stderr.trim(),'agent_continue_install_failed: payload_incomplete');
    } finally {
      assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()));fs.rmSync(scratch,{recursive:true,force:true});
    }
  });

test('Windows payload entry coverage compares the executed entry digest, not case-folded path spelling alone',
  {skip:process.platform !== 'win32',timeout:10000},async()=>{
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-entry-case-model-'));
    try {
      // Model two distinct NTFS-case-sensitive names without changing filesystem
      // policy. Only the private script copy receives this hash observation stub.
      const source=fs.readFileSync(path.join(repo,'native/bootstrap/install.ps1'),'utf8');
      const anchor=/function Assert-Payload \{\r?\n/;
      assert.match(source,anchor);
      const injected="function Assert-Payload {\nfunction Get-FileHash([string]$LiteralPath, [string]$Algorithm) {\n"+
        "    $hash = if ([IO.Path]::GetFileName($LiteralPath) -ceq 'BIN.MJS') { '"+'1'.repeat(64)+"' } else { '"+'2'.repeat(64)+"' }\n"+
        "    return [pscustomobject]@{ Hash = $hash }\n}\n";
      fs.writeFileSync(path.join(scratch,'install.ps1'),source.replace(anchor,injected));
      const marker=path.join(scratch,'payload-ran');
      fs.writeFileSync(path.join(scratch,'bin.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');console.log('{}');`);
      fs.writeFileSync(path.join(scratch,'SHA256SUMS.txt'),'1'.repeat(64)+'  BIN.MJS\n');
      let failure;
      try {
        await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
          ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(scratch,'install.ps1'),
            '-Uninstall','-InstallDir',path.join(scratch,'missing-install'),'-NodePath',process.execPath],
        {windowsHide:true,timeout:8000});
      } catch (error) {failure=error;}
      assert.equal(fs.existsSync(marker),false,'a different case-sensitive file digest must not cover the executed entry');
      assert.equal(failure?.code,1);assert.equal(failure.stdout,'');
      assert.equal(failure.stderr.trim(),'agent_continue_install_failed: payload_incomplete');
    } finally {
      assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()));fs.rmSync(scratch,{recursive:true,force:true});
    }
  });

test('Windows uninstall wrapper rejects invalid or mismatched dry-run result instead of reporting success',
  {skip:process.platform !== 'win32',timeout:60000},async()=>{
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ac-uninstall-result-'));
    try {
      fs.copyFileSync(path.join(repo,'native/bootstrap/install.ps1'),path.join(scratch,'install.ps1'));
      fs.writeFileSync(path.join(scratch,'bin.mjs'),
        `console.log(process.argv[2]==='status'?JSON.stringify({format:'agent-continue-registration-status',installed:false,registered:'not-registered'}):process.env.AC_UNINSTALL_FIXTURE);`);
      fs.writeFileSync(path.join(scratch, 'SHA256SUMS.txt'),
        crypto.createHash('sha256').update(fs.readFileSync(path.join(scratch, 'bin.mjs'))).digest('hex') + '  bin.mjs\n');
      const destination=path.join(scratch,'partial-install');fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination,'keep.txt'),'preserve');
      const {buildUninstallPlan}=await import('../native/bootstrap/install-plan.mjs');
      const valid={ok:true,dryRun:true,plan:buildUninstallPlan({os:'windows',installRoot:destination,
        inspection:{installed:true,manifestPresent:false,registered:false,autostart:true}})};
      const altered=change=>{const value=structuredClone(valid);change(value);return JSON.stringify(value);};
      for (const response of ['not a removal plan','{"ok":false,"error":"invalid_arguments"}',
        '{"ok":true,"dryRun":true,"plan":{"format":"agent-continue-uninstall-plan","version":1}}',
        altered(value=>{value.plan.installRoot+='-other';}),
        altered(value=>{value.plan.paths.host='C:\\another\\host.mjs';}),
        altered(value=>{value.plan.owned=true;}),
        altered(value=>{value.plan.steps[0].state='satisfied';}),
        altered(value=>{value.plan.steps.reverse();}),
        altered(value=>{value.extra='unexpected';}),
        altered(value=>{value.plan.format=[value.plan.format];}),
        altered(value=>{value.plan.os=[value.plan.os];}),
        altered(value=>{value.plan.installRoot=[value.plan.installRoot];}),
        altered(value=>{value.plan.paths.host=[value.plan.paths.host];}),
        altered(value=>{value.plan.steps[0].id=[value.plan.steps[0].id];}),
        altered(value=>{value.plan.steps[0].action=[value.plan.steps[0].action];}),
        altered(value=>{value.plan.steps[0].state=[value.plan.steps[0].state];}),
        altered(value=>{value.OK=value.ok;delete value.ok;}),
        altered(value=>{value.plan.OS=value.plan.os;delete value.plan.os;}),
        altered(value=>{value.plan.paths.Host=value.plan.paths.host;delete value.plan.paths.host;}),
        altered(value=>{value.plan.steps[0].State=value.plan.steps[0].state;delete value.plan.steps[0].state;})]) {
        let failure;
        try {
          await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
            ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(scratch,'install.ps1'),
              '-Uninstall','-InstallDir',destination,'-NodePath',process.execPath],
          {windowsHide:true,timeout:8000,env:{...process.env,AC_UNINSTALL_FIXTURE:response}});
        } catch (error) {failure=error;}
        assert.equal(failure?.code,1,'an invalid removal result must not be a successful wrapper receipt');
        assert.equal(failure.stdout,'');
        assert.equal(failure.stderr.trim(),'agent_continue_install_failed: uninstall_inspection_failed');
        assert.deepEqual(fs.readdirSync(destination),['keep.txt']);
        assert.equal(fs.readFileSync(path.join(destination,'keep.txt'),'utf8'),'preserve');
      }
      const success=await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(scratch,'install.ps1'),
          '-Uninstall','-InstallDir',destination,'-NodePath',process.execPath],
      {windowsHide:true,timeout:8000,env:{...process.env,AC_UNINSTALL_FIXTURE:JSON.stringify(valid)}});
      assert.equal(success.stderr,'');
      assert.equal(JSON.parse(success.stdout).ok,true);
      assert.deepEqual(JSON.parse(JSON.parse(success.stdout).output),valid);
      const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(scratch,'bin.mjs'))).digest('hex');
      for (const name of ['bin.mjs','.\\bin.mjs','./bin.mjs','BIN.MJS']) {
        fs.writeFileSync(path.join(scratch,'SHA256SUMS.txt'),digest+'  '+name+'\n');
        for (const mode of [['-Uninstall'],['-ExtensionId','a'.repeat(32)]]) {
          const equivalent=await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
            ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(scratch,'install.ps1'),...mode,
              '-InstallDir',destination,'-NodePath',process.execPath],
          {windowsHide:true,timeout:8000,env:{...process.env,AC_UNINSTALL_FIXTURE:JSON.stringify(valid)}});
          assert.equal(equivalent.stderr,'');
          assert.equal(JSON.parse(equivalent.stdout).ok,true);
          assert.equal(JSON.parse(equivalent.stdout).payloadChecked,1);
        }
      }
    } finally {
      assert.equal(path.dirname(scratch),path.resolve(os.tmpdir()));fs.rmSync(scratch,{recursive:true,force:true});
    }
  });

test('installer uncertainty is never classified as an ordinary refusal', async () => {
  const { installationFailureCode } = await import('../cli.mjs');
  for (const error of [{ killed: true }, { signal: 'SIGTERM' }, { code: 'ETIMEDOUT' },
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }]) assert.equal(installationFailureCode(error), 'local_install_unconfirmed');
  for (const error of [{ code: 1 }, { code: 'ENOENT' }, undefined]) assert.equal(installationFailureCode(error), 'local_install_failed');
  assert.equal(installationFailureCode({ code: 1, stderr: 'agent_continue_install_failed: node_not_found\r\n' }), 'node_not_found');
  assert.equal(installationFailureCode({ code: 1, stderr: 'agent_continue_install_failed: C:\\private\\file\n' }), 'local_install_failed');
  assert.equal(installationFailureCode({ killed: true, stderr: 'agent_continue_install_failed: node_not_found\n' }), 'local_install_unconfirmed');
  for (const code of ['destination_exists','manager_start_unconfirmed','node_archive_digest_mismatch',
    'native_manifest_invalid','client_acquisition_failed','client_verification_failed','npm_unavailable',
    'uninstall_inspection_failed','uninstall_inspection_unavailable','bootstrap_failed_exit_1','native_release_unavailable',
    'native_release_invalid','native_release_signature_invalid','native_release_node_mismatch',
    'native_release_payload_mismatch','native_release_destination_exists',
    'native_release_consent_required','native_release_preparation_failed']) {
    assert.equal(installationFailureCode({code:1,stderr:`agent_continue_install_failed: ${code}\r\n`}),code);
  }
});

test('Windows PowerShell installer classifiers retain bounded diagnostics only',
  {skip:process.platform !== 'win32',timeout:10000}, async () => {
    const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',
      path.join(repo,'tests/installer-failure-tests.ps1')],{windowsHide:true,timeout:8000});
    assert.match(result.stdout,/installer_failure_classifiers=PASS checks=\d+\b/);
    assert.match(result.stdout,/manager_operation_failure_receipt=PASS/);
    assert.equal(result.stderr,'');
  });

test('PowerShell bootstrap forwards a redacted operation failure and exits nonzero',
  {skip:process.platform !== 'win32',timeout:15000}, async () => {
    const temporary=fs.realpathSync(os.tmpdir());
    const scratch=fs.mkdtempSync(path.join(temporary,'ac-operation-wrapper-'));
    try {
      const receipt={ok:false,error:'manager_start_unconfirmed',operationId:'12345678-1234-4321-8123-123456789abc',
        operationStatus:'unknown-running'};
      fs.writeFileSync(path.join(scratch,'bin.mjs'),`console.log(${JSON.stringify(JSON.stringify(receipt))});process.exitCode=1;`);
      const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
      await assert.rejects(run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',
        path.join(repo,'tests/installer-failure-tests.ps1'),'-FixtureRoot',scratch,'-NodePath',process.execPath],
        {windowsHide:true,timeout:8000}),error=>{
        assert.equal(error.code,1);
        assert.equal(error.stderr,'');
        assert.deepEqual(JSON.parse(error.stdout),receipt);
        assert.deepEqual(installationOperationFailure(error),receipt);
        return true;
      });
    } finally {
      assert.equal(path.dirname(fs.realpathSync(scratch)),temporary);
      fs.rmSync(scratch,{recursive:true,force:true});
    }
  });

test('actual root npm tarball contains verified payload and a runnable CLI', { timeout: 60000 }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-root-package-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const packed = process.platform === 'win32'
      ? await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npm} pack --json`],
        { cwd: repo, windowsHide: true, timeout: 45000, env: { ...process.env, npm_config_pack_destination: scratch } })
      : await run(npm, ['pack', '--json', '--pack-destination', scratch], { cwd: repo, timeout: 45000 });
    const json = packed.stdout.slice(packed.stdout.indexOf('[\n'));
    const [receipt] = JSON.parse(json);
    const names = receipt.files.map(file => file.path);
    if (process.platform === 'win32') {
      const install = path.join(scratch, 'npm-install');
      fs.mkdirSync(install);
      fs.copyFileSync(path.join(scratch, receipt.filename), path.join(install, 'candidate.tgz'));
      await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
        'npm.cmd install ./candidate.tgz --ignore-scripts --no-audit --no-fund --offline'],
      { cwd: install, windowsHide: true, timeout: 20000 });
      assert.equal(fs.existsSync(path.join(install, 'node_modules/.bin/agent-continue.cmd')), true);
      const bin = await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
        'node_modules\\.bin\\agent-continue.cmd version'], { cwd: install, windowsHide: true, timeout: 10000 });
      assert.equal(JSON.parse(bin.stdout).version, '0.3.0');
      await assert.rejects(run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
        'node_modules\\.bin\\agent-continue.cmd setup --setup-request missing-request.json --runtime-key-file missing-key.txt --tunnel-id tunnel_0123456789abcdef0123456789abcdef --consent accept-install'],
      { cwd: install, windowsHide: true, timeout: 10000 }), error => {
        assert.equal(error.code, 1);
        const result = JSON.parse(error.stdout);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'setup_input_invalid');
        return true;
      });
    }
    assert.ok(names.includes('native/bootstrap/payload-manifest.json'));
    assert.equal(names.includes('native/bootstrap/NativeLauncher.cs'),false);
    assert.equal(names.includes('native/bootstrap/Build-NativeLauncher.ps1'),false);
    assert.ok(names.includes('native/bootstrap/Prepare-ReleaseNative.ps1'));
    assert.ok(names.includes('native/bootstrap/native-publishers.json'));
    await run('tar', ['-xf', path.join(scratch, receipt.filename), '-C', scratch], { windowsHide: true });
    const root = path.join(scratch, 'package');
    const bootstrap = path.join(root, 'native', 'bootstrap');
    assert.ok(names.includes('native/bootstrap/windows-release.mjs'));
    const { validateWindowsRelease, WINDOWS_RELEASE_ASSETS } = await import(pathToFileURL(path.join(bootstrap, 'windows-release.mjs')));
    const releaseMetadata = validateWindowsRelease(path.join(bootstrap, 'windows-release'));
    const originalReceipt = JSON.parse(fs.readFileSync(process.env.AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT, 'utf8'));
    assert.deepEqual(releaseMetadata.assets, originalReceipt.assets, 'the shipped six-file closure matches the original builder receipt');
    assert.equal(releaseMetadata.releaseTag, originalReceipt.releaseTag);
    for (const asset of WINDOWS_RELEASE_ASSETS) assert.ok(names.includes('native/bootstrap/windows-release/' + asset));
    const deniedWindows = await run(process.execPath, [path.join(root, 'cli.mjs'), 'help'], { windowsHide: true });
    assert.match(JSON.parse(deniedWindows.stdout).usage, /agent-continue windows --account/);
    await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'windows', '--account', 'current',
      '--extension-id', 'a'.repeat(32), '--consent', 'accept-install'], { windowsHide: true }), error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).error, process.platform === 'win32' ? 'interactive_terminal_required' : 'unsupported_platform');
      return true;
    });
    const api = await import(pathToFileURL(path.join(bootstrap, 'bootstrap.mjs')));
    const expectedRuntimeFiles = [
      'device-native-host.mjs', 'device-operations.mjs', 'device-owner.mjs', 'device-server.mjs', 'device-ssh.mjs',
      'host.mjs', 'lifecycle.mjs', 'operation-receipts.mjs', 'package-lock.json', 'package.json', 'prepared-process.mjs',
      'process-observation.mjs', 'profile.mjs', 'research-handoff.mjs', 'research-runner.mjs', 'runtime.mjs', 'setup-cli.mjs',
      'tunnel-pins.json', 'upstream-pin.json', 'windows-child.mjs', 'windows-process-query.cs',
    ];
    assert.deepEqual(fs.readdirSync(path.join(bootstrap, 'payload')).sort(), expectedRuntimeFiles.toSorted());
    assert.equal(api.verifyPayload(bootstrap).files, expectedRuntimeFiles.length);
    const version = await run(process.execPath, [path.join(root, 'cli.mjs'), 'version'], { windowsHide: true });
    assert.equal(JSON.parse(version.stdout).ok, true);
    for (const [args, expected] of [
      [['install-local'], 'consent_required'],
      [['install-local', '--consent', 'accept-install'], 'setup_request_required'],
      [['install-local', '--conset', 'accept-install'], 'invalid_arguments'],
    ]) {
      await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), ...args], { windowsHide: true }), error => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).error, expected);
        return true;
      });
    }
    for (const args of [
      ['setup', '--extension-id', 'a'.repeat(32), '--extension-id', 'b'.repeat(32)],
      ['setup', '--extension-id', 'a'.repeat(32), '--conset', 'accept-install'],
      ['setup', '--setup-request', 'not-read.json', '--extension-id', 'a'.repeat(32)],
    ]) {
      await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), ...args], { windowsHide: true }), error => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).error, 'invalid_arguments');
        return true;
      });
    }
    if (process.platform === 'win32') {
      const absentDestination = path.join(scratch, 'must-not-install');
      await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'install-local',
        '--setup-request', path.join(scratch, 'missing-private-request.json'), '--consent', 'accept-install',
        '--install-dir', absentDestination], { windowsHide: true, timeout: 15000 }), error => {
        assert.equal(error.code, 1);
        assert.deepEqual(JSON.parse(error.stdout), { ok: false, error: 'install_file_missing' });
        assert.equal(error.stderr, '');
        assert.equal(error.stdout.includes(scratch), false);
        return true;
      });
      assert.equal(fs.existsSync(absentDestination), false);
    }
    const registrationRoot = path.join(scratch, 'registration-fixture');
    fs.mkdirSync(registrationRoot);
    fs.writeFileSync(path.join(registrationRoot, 'native-host.json'), '{}');
    const registration = await run(process.execPath, [path.join(root, 'cli.mjs'), 'register',
      '--os', 'windows', '--install-dir', registrationRoot,
      '--extension-id', 'a'.repeat(32), '--view', '64'], { windowsHide: true });
    assert.equal(JSON.parse(registration.stdout).mode, 'dry-run');
    for (const os of ['linux', 'macos']) {
      await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'register',
        '--os', os, '--install-dir', registrationRoot, '--extension-id', 'a'.repeat(32), '--view', '64'],
      { windowsHide: true }), error => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).error, 'invalid_arguments');
        return true;
      });
    }
    const assertRejectedManifest = async () => {
    await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'register',
      '--os', 'windows', '--install-dir', registrationRoot,
      '--extension-id', 'a'.repeat(32), '--view', '64', '--execute', '--consent', 'accept-install'],
    { windowsHide: true }), error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).error, 'native_manifest_invalid');
      return true;
    });
    };
    await assertRejectedManifest();
    for (const origins of [['chrome-extension://' + 'b'.repeat(32) + '/'], ['*'],
      ['chrome-extension://' + 'a'.repeat(32) + '/', 'chrome-extension://' + 'b'.repeat(32) + '/']]) {
      fs.writeFileSync(path.join(registrationRoot, 'native-host.json'), JSON.stringify({
        name: 'com.agentcontinue.device_control', type: 'stdio', allowed_origins: origins,
        path: path.join(registrationRoot, 'native-launcher.exe'),
      }));
      await assertRejectedManifest();
    }
    fs.writeFileSync(path.join(registrationRoot, 'native-host.json'), JSON.stringify({
      name: 'com.agentcontinue.device_control', type: 'stdio',
      allowed_origins: ['chrome-extension://' + 'a'.repeat(32) + '/'],
      path: path.join(registrationRoot, 'native-launcher.exe'),
    }));
    await assertRejectedManifest(); // Correct origin still requires a real launcher file.
    await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'register',
      '--os', 'windows', '--install-dir', path.join(scratch, 'not-installed'),
      '--extension-id', 'a'.repeat(32), '--view', '64', '--execute'], { windowsHide: true }), error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).error, 'consent_required');
      return true;
    });
    const status = await run(process.execPath, [path.join(root, 'cli.mjs'), 'status', '--json',
      '--install-dir', path.join(scratch, 'not-installed')], { windowsHide: true });
    assert.equal(JSON.parse(status.stdout).installed, false);
    assert.equal(Object.hasOwn(JSON.parse(status.stdout), 'output'), false);
    await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'verify', '--json',
      '--install-dir', path.join(scratch, 'not-installed')], { windowsHide: true }), error => {
      assert.equal(error.code, 1);
      assert.ok(JSON.parse(error.stdout).failed > 0);
      return true;
    });
    await assert.rejects(run(process.execPath, [path.join(root, 'cli.mjs'), 'setup'], { windowsHide: true }), error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).error, 'extension_id_required');
      return true;
    });
    for (const file of receipt.files) {
      assert.ok(!/(^|\/)(node_modules|\.env|private)(\/|$)/.test(file.path), file.path);
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('actual Windows installer refuses unsafe retries and preserves partial-install recovery evidence',
  { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ps-verify-'));
    try {
      const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const requestFile = path.join(scratch, 'request.json');
      await assert.rejects(run(powershell, ['-NoProfile','-NonInteractive','-File',
        path.join(repo,'native/bootstrap/install.ps1'),'-InstallLocal','-Consent','accept-install',
        '-TunnelId','tunnel_' + 'a'.repeat(32),'-SetupRequest',requestFile],
      {windowsHide:true,timeout:10000}),error => {
        assert.ok(error.stderr.includes('install_argument_missing'));return true;
      });
      for (const target of ['linux', 'linux-server', 'macos']) {
        fs.writeFileSync(requestFile, JSON.stringify({ format: 'agent-continue-device-setup', version: 1,
          target, extensionId: 'a'.repeat(32), nativeHost: 'com.agentcontinue.device_control' }));
        await assert.rejects(run(powershell, ['-NoProfile', '-NonInteractive', '-File',
          path.join(repo, 'native/bootstrap/install.ps1'), '-InstallLocal', '-Consent', 'accept-install',
          '-SetupRequest', requestFile, '-InstallDir', path.join(scratch, 'absent'),
          '-NodePath', path.join(scratch, 'missing-node.exe')],
        { windowsHide: true, timeout: 10000 }), error => {
          assert.equal(error.code, 1);
          assert.ok(error.stderr.includes('setup_request_invalid'), error.stderr);
          return true;
        });
        assert.equal(fs.existsSync(path.join(scratch, 'absent')), false);
      }
      fs.writeFileSync(requestFile, JSON.stringify({ format: 'agent-continue-device-setup', version: 1,
        target: 'windows', extensionId: 'a'.repeat(32), nativeHost: 'com.agentcontinue.device_control' }));
      const existing = path.join(scratch,'existing');
      fs.mkdirSync(existing);
      fs.writeFileSync(path.join(existing,'sentinel'),'preserve');
      await assert.rejects(run(powershell, ['-NoProfile','-NonInteractive','-File',
        path.join(repo,'native/bootstrap/install.ps1'),'-InstallLocal','-Consent','accept-install',
        '-SetupRequest',requestFile,'-InstallDir',existing,'-NodePath',path.join(scratch,'missing-node.exe')],
      {windowsHide:true,timeout:10000}),error => {
        assert.equal(error.code,1);
        assert.match(error.stderr,/agent_continue_install_failed: destination_exists/);
        return true;
      });
      assert.deepEqual(fs.readdirSync(existing),['sentinel']);
      assert.equal(fs.readFileSync(path.join(existing,'sentinel'),'utf8'),'preserve');
      // Recovery must use a checksum-listed package, not an unverified source
      // checkout. It still only inspects the disposable partial root.
      const verified = path.join(scratch, 'verified-bootstrap');
      const { buildPackage } = await import('../native/bootstrap/build-package.mjs');
      buildPackage(verified);
      const entries = [];
      function checksums(folder, prefix = '') {
        for (const name of fs.readdirSync(folder)) {
          const file = path.join(folder, name), relative = prefix + name;
          if (fs.statSync(file).isDirectory()) checksums(file, relative + '/');
          else entries.push(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + relative);
        }
      }
      checksums(verified);
      fs.writeFileSync(path.join(verified, 'SHA256SUMS.txt'), entries.sort().join('\n') + '\n');
      const recovery=JSON.parse((await run(powershell,['-NoProfile','-NonInteractive','-File',
        path.join(verified,'install.ps1'),'-Uninstall','-InstallDir',existing,'-NodePath',process.execPath],
      {windowsHide:true,timeout:15000})).stdout);
      assert.equal(recovery.dryRun,true);
      assert.equal(recovery.directoryPresent,true);
      assert.equal(recovery.installationComplete,false);
      assert.equal(recovery.autostartObservation,'not-inspected');
      const removal=JSON.parse(recovery.output).plan;
      assert.equal(removal.steps.find(step=>step.id==='remove-files').state,'pending');
      assert.equal(removal.steps.find(step=>step.id==='disable-autostart').state,'pending');
      assert.equal(removal.owned,false,'a partial root does not establish ownership');
      assert.deepEqual(fs.readdirSync(existing),['sentinel']);
      await assert.rejects(run(powershell, ['-NoProfile', '-NonInteractive', '-File',
        path.join(verified, 'install.ps1'), '-InstallLocal', '-Consent', 'accept-install',
        '-SetupRequest', requestFile, '-InstallDir', path.join(scratch, 'absent'),
        '-NodePath', path.join(scratch, 'missing-node.exe')],
      { windowsHide: true, timeout: 10000 }), error => {
        assert.equal(error.code, 1);
        assert.ok(error.stderr.includes('node_not_found'), error.stderr);
        return true;
      });
      await assert.rejects(run(powershell, ['-NoProfile', '-NonInteractive', '-File',
        path.join(verified, 'install.ps1'), '-Apply', '-Consent', 'accept-install',
        '-ExtensionId', 'b'.repeat(32), '-SetupRequest', requestFile,
        '-InstallDir', path.join(scratch, 'absent'), '-NodePath', path.join(scratch, 'missing-node.exe')],
      { windowsHide: true, timeout: 10000 }), error => {
        assert.equal(error.code, 1);
        assert.ok(error.stderr.includes('setup_identity_mismatch'), error.stderr);
        return true;
      });
      assert.equal(fs.existsSync(path.join(scratch, 'absent')), false);
      for (const [flags, expected] of [
        [['-ManagerOnly'], 'invalid_manager_arguments'],
        [['-InstallLocal'], 'consent_required'],
        [['-InstallLocal', '-Consent', 'accept-install'], 'install_file_missing'],
        [['-InstallLocal', '-Consent', 'accept-install', '-Verify'], 'invalid_manager_arguments'],
        [['-RegisterNative'], 'invalid_manager_arguments'],
        [['-ManagerOnly', '-Apply', '-RegisterNative', '-Consent', 'accept-install'], 'invalid_manager_arguments'],
        [['-ManagerOnly', '-Apply'], 'consent_required'],
        [['-ManagerOnly', '-Apply', '-Consent', 'accept-install', '-TunnelId', 'not-used'], 'invalid_manager_arguments'],
        [['-ManagerOnly', '-Apply', '-Consent', 'accept-install', '-Verify'], 'invalid_manager_arguments'],
        [['-ManagerOnly', '-Apply', '-Consent', 'accept-install', '-Uninstall'], 'invalid_manager_arguments'],
      ]) {
        await assert.rejects(run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive',
          '-File', path.join(repo, 'native/bootstrap/install.ps1'),
          '-ExtensionId', 'a'.repeat(32), '-NodePath', path.join(scratch, 'missing-node.exe'),
          '-InstallDir', path.join(scratch, 'absent'), ...flags],
        { cwd: repo, windowsHide: true, timeout: 10000 }), error => {
          assert.equal(error.code, 1);
          assert.ok(error.stderr.includes(expected), error.stderr);
          assert.equal(error.stdout.trim(), '');
          return true;
        });
        assert.equal(fs.existsSync(path.join(scratch, 'absent')), false);
      }
      await assert.rejects(run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(repo, 'native/bootstrap/install.ps1'), '-ExtensionId', 'z'.repeat(32),
        '-NodePath', path.join(scratch, 'missing-node.exe')], { cwd: repo, windowsHide: true, timeout: 10000 }), error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /invalid_extension_id/);
        return true;
      });
      await assert.rejects(run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(verified, 'install.ps1'), '-Verify', '-NodePath', process.execPath,
        '-InstallDir', path.join(scratch, 'absent')], { cwd: repo, windowsHide: true, timeout: 20000 }), error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /bootstrap_failed_exit_1/);
        assert.equal(error.stdout.trim(), '');
        return true;
      });
      assert.equal(fs.existsSync(path.join(scratch, 'absent')), false);
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });
