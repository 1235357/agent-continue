import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {RUNTIME_FILES} from '../native/bootstrap/payload-layout.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'native/bootstrap/Prepare-ReleaseNative.ps1');
const publisherPath = path.join(root, 'native/bootstrap/native-publishers.json');
const emptyPublishers = {format: 'agent-continue-windows-native-publishers', version: 1, thumbprints: []};
const run = promisify(execFile);
const windows = process.platform === 'win32';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value) + '\n';
const id = 'abcdefghijklmnopabcdefghijklmnop';
const safeCodes = ['native_release_unavailable', 'native_release_invalid', 'native_release_signature_invalid',
  'native_release_node_mismatch', 'native_release_payload_mismatch', 'native_release_destination_exists',
  'native_release_consent_required', 'native_release_preparation_failed'];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-release-source-'));
  const release = path.join(dir, 'release'), payload = path.join(dir, 'package'), install = path.join(dir, 'install');
  fs.mkdirSync(path.join(release, 'x64'), {recursive: true});
  fs.mkdirSync(path.join(payload, 'payload'), {recursive: true});
  fs.mkdirSync(path.join(install, 'app'), {recursive: true});
  fs.mkdirSync(path.join(install, 'state'));
  const manifest = {format: 'agent-continue-payload', version: 1,
    provider: {name: '@wonderwhy-er/desktop-commander', version: '0.3.1'},
    files: RUNTIME_FILES.map(name => {
      const bytes = Buffer.from(`inert payload: ${name}\n`);
      fs.writeFileSync(path.join(payload, 'payload', name), bytes);
      fs.writeFileSync(path.join(install, 'app', name), bytes);
      return {path: name, bytes: bytes.length, sha256: digest(bytes)};
    })};
  const manifestPath = path.join(payload, 'payload-manifest.json');
  fs.writeFileSync(manifestPath, encode(manifest));
  const policy = {format: 'agent-continue-windows-native-release', version: 1, releaseVersion: '2.3.4',
    arch: 'x64', nodeVersion: '22.23.4', nodeSha256: digest(fs.readFileSync(process.execPath)),
    launcherSha256: '1'.repeat(64), signerThumbprint: 'A'.repeat(40),
    payloadManifestSha256: digest(fs.readFileSync(manifestPath))};
  const policyPath = path.join(release, 'x64', 'release.json');
  fs.writeFileSync(policyPath, encode(policy));
  const binding = {format: 'agent-continue-native-binding', version: 1, extensionId: id, stateRoot: path.join(install, 'state')};
  const bindingPath = path.join(install, 'app', 'device-native-binding.json');
  fs.writeFileSync(bindingPath, encode(binding));
  return {dir, release, payload, install, policy, policyPath, manifest, manifestPath, binding, bindingPath,
    args: ['-ReleaseRoot', release, '-PayloadRoot', payload, '-InstallDir', install, '-ExtensionId', id, '-Arch', 'x64']};
}

function tree(dir) {
  return fs.readdirSync(dir, {recursive: true}).sort().map(name => {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    return [name, stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? digest(fs.readFileSync(file)) : 'directory'];
  });
}

async function invoke(args, env, entry = script) {
  try {
    const result = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', entry, ...args],
      {windowsHide: true, timeout: 15000, env: env || process.env});
    return {...result, exitCode: 0};
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return {stdout: error.stdout, stderr: error.stderr, exitCode: error.code};
  }
}

function failure(result, code, label) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  assert.deepEqual(JSON.parse(result.stdout), {ok: false, error: code}, label);
  assert.ok(safeCodes.includes(code));
}

// Load only the production helper definitions into an isolated PS5.1 process.
// This never evaluates the entry point or replaces trust/identity checks.
async function helpers(body, args = []) {
  const command = `
    $ErrorActionPreference='Stop'
    $PSModuleAutoLoadingPreference='None'
    Import-Module ([IO.Path]::Combine($PSHOME,'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1'))
    $tokens=$null; $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
    if ($errors.Count -ne 0) { throw 'parse_failed' }
    foreach ($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
      . ([scriptblock]::Create($fn.Extent.Text))
    }
    Set-StrictMode -Version 2.0
    $script:records=[Collections.ArrayList]::new()
    $script:utf8=[Text.UTF8Encoding]::new($false,$true)
    $script:runtimeFiles=@(${RUNTIME_FILES.map(name => `'${name}'`).join(',')})
    try { ${body} } finally { foreach ($record in $script:records) { $record.Stream.Dispose() } }
  `;
  return run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64'), ...args], {windowsHide: true, timeout: 15000});
}

test('preparation source is standalone, create-only, and cannot build, run, sign, or register', () => {
  assert.ok(fs.existsSync(script), 'the bounded preparation entry point must exist');
  const source = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /CompileAssembly|CodeDom|Add-Type|Start-Process|Invoke-Expression|Set-AuthenticodeSignature|Set-MpPreference|Add-MpPreference|New-SelfSignedCertificate|Import-Certificate|Invoke-WebRequest|WebClient|HttpClient|reg\.exe|RegistryKey|Remove-Item|\[IO\.File\]::Delete/);
  for (const marker of ['Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Utility', '$PSHOME',
    'Get-AuthenticodeSignature', 'FileShare]::Read', 'FileMode]::CreateNew', 'classificationVerified',
    'Agent Continue', 'FileVersion', 'same-user', 'ACL']) assert.ok(source.includes(marker), marker);
  assert.ok(source.indexOf("$Consent -cne 'accept-install'") < source.indexOf('Import-Module'));
  assert.equal((source.match(/\[Console\]::Out\.Write/g) || []).length, 1);
});

test('publisher trust is empty, byte-pinned in trusted code, and checked before launcher acceptance', () => {
  const bytes = fs.readFileSync(publisherPath);
  assert.equal(bytes.toString('utf8'), encode(emptyPublishers));
  const source = fs.readFileSync(script, 'utf8');
  assert.ok(source.includes(`$record.Hash -cne '${digest(bytes)}'`), 'the exact policy SHA256 must be a literal');
  assert.ok(source.includes("[IO.Path]::Combine($PSScriptRoot, 'native-publishers.json')"));
  const gate = source.indexOf('Assert-TrustedPublisher $policy.signerThumbprint $publishers');
  assert.ok(gate > source.indexOf('$publishers = @(Read-NativePublishers)'));
  assert.ok(gate < source.indexOf('Assert-Launcher $launcher $policy.releaseVersion'));
  assert.ok(source.includes('$null -eq $signature.TimeStamperCertificate'));
  assert.ok(source.includes('[int]$part -gt 9999'));
});

test('PS5.1 unchanged preparer refuses publisher-policy substitution and self-selected signers',
  {skip: !windows, timeout: 30000}, async () => {
    const f = fixture(), entry = path.join(f.dir, 'Prepare-ReleaseNative.ps1');
    const policyFile = path.join(f.dir, 'native-publishers.json');
    const source = fs.readFileSync(script), pinnedBytes = fs.readFileSync(publisherPath);
    fs.writeFileSync(entry, source);
    try {
      // These are untrusted attacker-controlled files, never provisioned trust.
      const substituted = encode({...emptyPublishers, thumbprints: [f.policy.signerThumbprint]});
      const override = path.join(f.release, 'native-publishers.json');
      fs.writeFileSync(override, substituted);
      const env = {...process.env, AGENT_CONTINUE_NATIVE_PUBLISHERS: override};
      for (const bytes of [pinnedBytes, substituted, ' ' + encode(emptyPublishers),
        encode(emptyPublishers).replace(/\n$/, '\r\n'), Buffer.alloc(16385, 0x20)]) {
        fs.writeFileSync(policyFile, bytes);
        const before = tree(f.dir);
        failure(await invoke(f.args, env, entry), 'native_release_signature_invalid');
        failure(await invoke([...f.args, '-Apply', '-Consent', 'accept-install'], env, entry), 'native_release_signature_invalid');
        assert.deepEqual(tree(f.dir), before);
        assert.deepEqual(fs.readFileSync(entry), source, 'the trusted preparer stayed byte-for-byte unchanged');
      }
      fs.unlinkSync(policyFile);
      failure(await invoke(f.args, env, entry), 'native_release_signature_invalid');
      assert.deepEqual(fs.readFileSync(script), source);
      assert.deepEqual(fs.readFileSync(publisherPath), pinnedBytes);
    } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
  });

test('PS5.1 publisher helpers enforce closed canonical unique bounded lists and retain the pinned file',
  {skip: !windows, timeout: 15000}, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-publisher-helpers-'));
    const policyFile = path.join(dir, 'native-publishers.json');
    fs.copyFileSync(publisherPath, policyFile);
    const q = value => `'${value.replaceAll("'", "''")}'`;
    const unrelated = 'A'.repeat(40);
    const invalid = [encode({...emptyPublishers, extra: 1}), encode({...emptyPublishers, version: '1'}),
      encode({...emptyPublishers, thumbprints: null}), encode({...emptyPublishers, thumbprints: unrelated}),
      encode({...emptyPublishers, thumbprints: [unrelated, unrelated.toLowerCase()]}),
      encode({...emptyPublishers, thumbprints: ['Z'.repeat(40)]}),
      encode({...emptyPublishers, thumbprints: [false]}),
      encode({...emptyPublishers, thumbprints: Array.from({length: 17}, (_, i) => i.toString(16).padStart(40, '0'))}),
      encode(emptyPublishers).replace('"version":1', '"version":1,"version":1'),
      encode(emptyPublishers).replace('"thumbprints":', '"thumb\\u0070rints":'),
      encode(emptyPublishers).trimEnd(), ' ' + encode(emptyPublishers)];
    try {
      const body = `
        $record=Open-Record ${q(policyFile)} 16384 1 'native_release_signature_invalid'
        $json=Read-JsonRecord $record
        $publishers=@(Assert-Publishers $json.Value $json.Text)
        if ($publishers.Count -ne 0 -or $script:records.Count -ne 1) { throw 'policy_not_empty_or_retained' }
        if ($script:records[0].Path -cne ${q(policyFile)}) { throw 'wrong_policy_source' }
        $locked=$false
        try { [IO.File]::WriteAllText(${q(policyFile)},'tamper') } catch { $locked=$true }
        if (-not $locked) { throw 'policy_not_locked' }
        Assert-CurrentRecords
        try { Assert-TrustedPublisher '${unrelated}' $publishers; throw 'self_selected_signer_accepted' }
        catch { if ($_.Exception.Message -cne 'native_release_signature_invalid') { throw } }
        $rejected=0
        foreach ($text in @(${invalid.map(q).join(',')})) {
          $value=Microsoft.PowerShell.Utility\\ConvertFrom-Json -InputObject $text
          try { $null=Assert-Publishers $value $text; throw 'invalid_publisher_schema_accepted' }
          catch { if ($_.Exception.Message -cne 'native_release_signature_invalid') { throw } }
          $rejected++
        }
        if ($rejected -ne ${invalid.length}) { throw 'missing_schema_case' }
        [Console]::Out.WriteLine('publishers_refused_and_retained')
      `;
      assert.equal((await helpers(body)).stdout.trim(), 'publishers_refused_and_retained');
      assert.equal(fs.readFileSync(policyFile, 'utf8'), encode(emptyPublishers));
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

test('PS5.1 consent and missing vendor assets fail closed without writes', {skip: !windows, timeout: 30000}, async () => {
  const f = fixture();
  try {
    fs.unlinkSync(f.policyPath);
    const before = tree(f.dir);
    failure(await invoke(['-Apply', '-ReleaseRoot', '\\\\unreachable.invalid\\share']), 'native_release_consent_required');
    failure(await invoke([...f.args]), 'native_release_unavailable');
    const preflightOnly = ['-ReleaseRoot', f.release, '-PayloadRoot', f.payload, '-ExtensionId', id, '-Arch', 'x64'];
    failure(await invoke(preflightOnly), 'native_release_unavailable');
    failure(await invoke([...f.args, '-Apply', '-Consent', 'accept-install', '-NodePath', process.execPath]), 'native_release_unavailable');
    assert.deepEqual(tree(f.dir), before);
    fs.writeFileSync(f.policyPath, encode(f.policy));
    const candidate = tree(f.dir);
    failure(await invoke(f.args), 'native_release_signature_invalid');
    failure(await invoke([...f.args, '-Apply', '-Consent', 'accept-install', '-NodePath', process.execPath]), 'native_release_signature_invalid');
    assert.deepEqual(tree(f.dir), candidate);
  } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
});

test('PS5.1 rejects noncanonical, duplicate, mistyped, unbounded, and malformed release policy',
  {skip: !windows, timeout: 120000}, async () => {
    const f = fixture();
    try {
      const base = encode(f.policy);
      const cases = [
        base.trimEnd(), base.replace(/\n$/, '\r\n'), ' ' + base, base + '{}',
        base.replace('"version":1', '"version":1,"version":1'),
        base.replace('"arch":', '"ar\\u0063h":'),
        base.replace('"version":1', '"version":"1"'),
        base.replace('"version":1', '"version":1.0'),
        base.replace('"version":1', '"version":true'),
        base.replace('"version":1', '"version":null'),
        encode({...f.policy, extra: 1}), encode({...f.policy, arch: 'arm64'}),
        encode({...f.policy, nodeVersion: '22.0.0'}), encode({...f.policy, nodeSha256: 'A'.repeat(64)}),
        encode({...f.policy, signerThumbprint: 'Z'.repeat(40)}),
        encode({...f.policy, releaseVersion: '2.3.4-beta'}), encode({...f.policy, releaseVersion: '02.3.4'}),
        encode({...f.policy, releaseVersion: '65536.3.4'}), encode({...f.policy, releaseVersion: '10000.3.4'}),
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(base)]),
        Buffer.from(base, 'utf16le'), Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
        Buffer.alloc(16385, 0x20), Buffer.alloc(0),
      ];
      for (let index = 0; index < cases.length; index++) {
        fs.writeFileSync(f.policyPath, cases[index]);
        const before = tree(f.dir);
        failure(await invoke(f.args), 'native_release_invalid', `policy case ${index}`);
        assert.deepEqual(tree(f.dir), before, `policy case ${index} changed files`);
      }
    } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
  });

test('PS5.1 validates local canonical names without touching nonlocal sources', {skip: !windows, timeout: 60000}, async () => {
  const f = fixture();
  try {
    for (const value of ['relative', '\\\\unreachable.invalid\\share', '\\\\?\\C:\\release',
      f.release + ':stream', f.release + '\\..\\release', f.release + '\\CON.txt',
      f.release + '\\aux', f.release + '\\COM1', f.release + '\\bad.', f.release + '\\bad ',
      f.release + '/child', f.release + '\\']) {
      failure(await invoke(['-ReleaseRoot', value, ...f.args.slice(2)]), 'native_release_invalid');
    }
    failure(await invoke([...f.args.slice(0, -2), '-Arch', 'x86']), 'native_release_invalid');
    assert.equal(fs.existsSync(path.join(f.install, 'native-host.json')), false);
  } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
});

test('PS5.1 payload and installed-binding validators use actual current bytes and closed schemas',
  {skip: !windows, timeout: 30000}, async () => {
    const f = fixture();
    const q = value => `'${value.replaceAll("'", "''")}'`;
    try {
      const body = `
        $record=Open-Record ${q(f.manifestPath)} 65536 1 'native_release_payload_mismatch'
        $json=Read-JsonRecord $record
        $entries=@(Assert-PayloadManifest $json.Value $json.Text)
        Assert-PayloadFiles ${q(path.join(f.payload, 'payload'))} $entries
        Assert-Install ${q(f.install)} '${id}' $entries
        Assert-CurrentRecords
        [Console]::Out.WriteLine('validated')
      `;
      assert.equal((await helpers(body)).stdout.trim(), 'validated');
      for (const name of ['native-host.json', 'native-launcher.exe', 'runtime/node.exe']) {
        const destination = path.join(f.install, name);
        fs.mkdirSync(destination, {recursive: true});
        await assert.rejects(helpers(`Assert-NewDestination ${q(destination)}`), /native_release_destination_exists/);
        fs.rmdirSync(destination);
      }
      fs.writeFileSync(path.join(f.install, 'app', RUNTIME_FILES[0]), 'tampered');
      await assert.rejects(helpers(body), /native_release_payload_mismatch/);
      fs.copyFileSync(path.join(f.payload, 'payload', RUNTIME_FILES[0]), path.join(f.install, 'app', RUNTIME_FILES[0]));
      for (const binding of [encode({...f.binding, extensionId: 'a'.repeat(32)}),
        encode({...f.binding, stateRoot: f.dir}), encode({...f.binding, extra: false}),
        encode(f.binding).replace('"version":1', '"version":1,"version":1')]) {
        fs.writeFileSync(f.bindingPath, binding);
        await assert.rejects(helpers(body), /native_release_payload_mismatch/);
      }
      fs.writeFileSync(f.bindingPath, encode(f.binding));
      for (const manifest of [encode({...f.manifest, extra: 1}),
        encode({...f.manifest, files: f.manifest.files.slice(1)}),
        encode({...f.manifest, files: [...f.manifest.files].reverse()}),
        encode({...f.manifest, files: f.manifest.files.map((entry, index) => index ? entry : {...entry, bytes: '1'})}),
        encode(f.manifest).replace('"version":1', '"version":1,"version":1')]) {
        fs.writeFileSync(f.manifestPath, manifest);
        await assert.rejects(helpers(body), /native_release_payload_mismatch/);
      }
      fs.writeFileSync(f.manifestPath, encode(f.manifest));
      fs.writeFileSync(path.join(f.payload, 'payload', 'ignored.txt'), 'not in the trusted list');
      assert.equal((await helpers(body)).stdout.trim(), 'validated');
      fs.writeFileSync(path.join(f.payload, 'payload', RUNTIME_FILES[0]), 'changed');
      await assert.rejects(helpers(body), /native_release_payload_mismatch/);
    } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
  });

test('PS5.1 never mistakes the existing Node executable for an Agent Continue launcher',
  {skip: !windows, timeout: 30000}, async t => {
    const node = process.execPath.replaceAll("'", "''");
    const body = `
      Import-Module ([IO.Path]::Combine($PSHOME,'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'))
      $record=Open-Record '${node}' 536870912 1 'native_release_unavailable'
      $signature=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $record.Path
      $info=[Diagnostics.FileVersionInfo]::GetVersionInfo($record.Path)
      try { Assert-Launcher $record '2.3.4' '${'A'.repeat(40)}'; throw 'accepted_node_as_launcher' }
      catch { if ($_.Exception.Message -cne 'native_release_signature_invalid') { throw } }
      [Console]::Out.WriteLine((Microsoft.PowerShell.Utility\\ConvertTo-Json -Compress -InputObject ([ordered]@{
        refused=$true; signatureStatus=[string]$signature.Status; product=$info.ProductName})))
    `;
    const result = JSON.parse((await helpers(body)).stdout);
    assert.equal(result.refused, true);
    assert.notEqual(result.product, 'Agent Continue');
    t.diagnostic(`Existing Node Authenticode status: ${result.signatureStatus}; product: ${result.product}`);
  });

test('inert PS5.1 create-only staging refuses overwrite and retains partial output',
  {skip: !windows, timeout: 15000}, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-release-inert-'));
    const source = path.join(dir, 'source.txt'), target = path.join(dir, 'destination.txt');
    const partial = path.join(dir, 'partial.txt'), written = path.join(dir, 'written.json');
    fs.writeFileSync(source, 'inert data only\n');
    try {
      const body = `
        $record=Open-Record '${source.replaceAll("'", "''")}' 4096 1 'native_release_preparation_failed'
        $blocked=$false
        try { [IO.File]::WriteAllText($record.Path,'must be blocked') } catch { $blocked=$true }
        if (-not $blocked) { throw 'retained_handle_did_not_block_write' }
        Copy-NewFile $record '${target.replaceAll("'", "''")}'
        try { Copy-NewFile $record '${target.replaceAll("'", "''")}'; throw 'overwritten' }
        catch { if ($_.Exception.Message -cne 'native_release_destination_exists') { throw } }
        try { Write-NewFile ([byte[]]@(1,2)) '${target.replaceAll("'", "''")}'; throw 'overwritten' }
        catch { if ($_.Exception.Message -cne 'native_release_destination_exists') { throw } }
        $broken=[IO.MemoryStream]::new([byte[]]@(1,2,3)); $broken.Dispose()
        $interrupted=[pscustomobject]@{Stream=$broken; Length=3; Hash='not reached'}
        try { Copy-NewFile $interrupted '${partial.replaceAll("'", "''")}'; throw 'interruption_ignored' }
        catch { if ($_.Exception.Message -cne 'native_release_preparation_failed') { throw } }
        if (-not [IO.File]::Exists('${partial.replaceAll("'", "''")}')) { throw 'partial_output_removed' }
        try { Assert-NewDestination '${partial.replaceAll("'", "''")}'; throw 'partial_overwritable' }
        catch { if ($_.Exception.Message -cne 'native_release_destination_exists') { throw } }
        Write-NewFile ([Text.Encoding]::UTF8.GetBytes('{"inert":true}'+[char]10)) '${written.replaceAll("'", "''")}'
        Assert-CurrentRecords
        [Console]::Out.WriteLine('staged_inert_only')
      `;
      assert.equal((await helpers(body)).stdout.trim(), 'staged_inert_only');
      assert.equal(fs.readFileSync(target, 'utf8'), 'inert data only\n');
      assert.equal(fs.statSync(partial).size, 0);
      assert.equal(fs.readFileSync(written, 'utf8'), '{"inert":true}\n');
      assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.exe')), false);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

test('PS5.1 refuses reparse ancestors even when the leaf is absent',
  {skip: !windows, timeout: 15000}, async () => {
    const f = fixture(), link = path.join(f.dir, 'redirect');
    try {
      fs.symlinkSync(f.release, link, 'junction');
      failure(await invoke(['-ReleaseRoot', link, ...f.args.slice(2)]), 'native_release_invalid');
      const leaf = path.join(link, 'not-present', 'child.json').replaceAll("'", "''");
      const body = `
        try { Assert-NewDestination '${leaf}'; throw 'redirect_accepted' }
        catch { if ($_.Exception.Message -cne 'native_release_invalid') { throw }; [Console]::Out.WriteLine('refused_reparse') }
      `;
      assert.equal((await helpers(body)).stdout.trim(), 'refused_reparse');
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.rmSync(f.dir, {recursive: true, force: true});
    }
  });
