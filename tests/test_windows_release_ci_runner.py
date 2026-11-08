"""CI adapter contracts and real pure-helper/benign-process tests, never account creation."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts/Invoke-WindowsReleaseOrdinaryTokenCI.ps1"
PWSH = shutil.which("pwsh")
SID = "S-1-5-21-1-2-3-1001"


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


class CiRunnerSourceTests(unittest.TestCase):
    def setUp(self):
        self.source = RUNNER.read_text(encoding="utf-8")

    def test_fixed_child_has_no_arbitrary_command_or_elevation_switch(self):
        for value in ("-Mode','Child'", "ordinary_windows_token_required", "$identity.User.Value -cne $ExpectedSid",
                      "build-windows-administrator-bundle.mjs", "Test-WindowsAdministratorBundleSmoke.ps1"):
            self.assertIn(value, self.source)
        for value in ("Invoke-Expression", "CreateRestrictedToken", "-Verb RunAs", "Set-Service", "Start-Service",
                      "Register-ScheduledTask", "-ExerciseInstalledReadOnly", "-ExerciseTunnelProfile"):
            self.assertNotIn(value, self.source)

    def test_parent_explicitly_launches_ephemeral_standard_account_without_inheritance(self):
        for value in ("New-LocalUser", "-AccountExpires", "-UserMayNotChangePassword", "GetBytes(48)",
                      "S-1-5-32-545", "S-1-5-32-544", "ci_child_account_is_administrator",
                      "$start.Environment.Clear()", "$start.UseShellExecute = $false", "$start.LoadUserProfile = $false",
                      "$start.UserName = $name", "$start.Password = $password", "$start.WorkingDirectory =",
                      "$start.UseCredentialsForNetworkingOnly = $false", "ProcessWindowStyle]::Hidden"):
            self.assertIn(value, self.source)
        self.assertNotIn("PasswordInClearText", self.source)

    def test_inputs_are_sealed_and_only_exact_output_is_promoted(self):
        for value in ("SetAccessRuleProtection($true, $false)", "'ReadAndExecute'", "'Modify'",
                      "Set-CiAcl $root $sid", "Set-CiAcl (Join-Path $root 'work') $sid -Writable",
                      "inputs\\cache\\_cacache", "ci_output_inventory", "ci_child_receipt_invalid"):
            self.assertIn(value, self.source)
        self.assertLess(self.source.index("$hash = Assert-CiResult"), self.source.index("[IO.File]::Copy((Join-Path $root"))

    def test_cleanup_is_account_sid_and_owned_path_scoped_even_after_failure(self):
        for value in ("finally {", "Disable-LocalUser -SID $account.SID", "Stop-CiAccountProcesses $account.SID.Value",
                      "Remove-LocalUser -SID $account.SID", "$password.Dispose()", "ci_cleanup_path_invalid",
                      "$target = Assert-CiPath $root $temp", "Remove-Item -LiteralPath $target -Recurse -Force"):
            self.assertIn(value, self.source)
        self.assertNotIn("taskkill", self.source.lower())
        self.assertNotIn("Remove-Item -LiteralPath $temp", self.source)


class CiWorkflowRouteSourceTests(unittest.TestCase):
    def test_separate_explicit_routes_retain_the_shared_disposable_host_and_token_guards(self):
        source = RUNNER.read_text(encoding="utf-8")
        predicate = re.search(r"(?ms)^function Test-CiWorkflowRoute\b(.*?)^function Assert-CiHost", source)
        self.assertIsNotNone(predicate, "Missing separately testable CI workflow route predicate")
        predicate = predicate.group(1)
        for value in ("'windows-sidecar'", "'push'", r"\Arefs/tags/v[0-9]+\.[0-9]+\.[0-9]+\z",
                      "'workflow_dispatch'", "'refs/heads/main'", "'1235357/agent-continue'",
                      "'1235357/agent-continue/.github/workflows/verify-windows-delivery.yml@refs/heads/main'"):
            self.assertIn(value, predicate)
        host = source.split("function Assert-CiHost", 1)[1].split("function Set-CiAcl", 1)[0]
        for value in ("Test-CiWorkflowRoute", "$IsWindows", "ProcessArchitecture", "'X64'",
                      "$PSVersionTable.PSVersion.Major -lt 7", "$env:GITHUB_ACTIONS -cne 'true'",
                      "$env:RUNNER_ENVIRONMENT -cne 'github-hosted'", "$env:RUNNER_OS -cne 'Windows'",
                      "WindowsIdentity]::GetCurrent()", "$identity.IsSystem", "Administrator"):
            self.assertIn(value, host)
        self.assertNotIn("New-LocalUser", predicate + host)
        self.assertNotRegex(source, r"\$env:(?:GITHUB_|RUNNER_|ACTIONS_)\w*\s*=(?!=)")


@unittest.skipUnless(PWSH, "PowerShell 7 required for isolated route predicate fixtures")
class CiWorkflowRouteTests(unittest.TestCase):
    def evaluate(self, contexts):
        # Load only this pure function AST, never Assert-CiHost or the adapter entrypoint.
        script = f"""
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$errors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile({ps_quote(RUNNER)}, [ref]$tokens, [ref]$errors)
if ($errors.Count) {{ throw ($errors | Out-String) }}
$functions = @($ast.FindAll({{param($n)
    $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Test-CiWorkflowRoute'
}}, $false))
if ($functions.Count -ne 1) {{ throw 'ci_route_predicate_missing' }}
. ([scriptblock]::Create($functions[0].Extent.Text))
$contexts = ConvertFrom-Json -AsHashtable -InputObject {ps_quote(json.dumps(contexts))}
$results = @(foreach ($context in $contexts) {{ Test-CiWorkflowRoute $context }})
ConvertTo-Json -InputObject $results -Compress
"""
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        result = subprocess.run([PWSH, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
                                capture_output=True, text=True, timeout=20, **options)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def manual_context(self):
        return {"job": "windows-sidecar", "event": "workflow_dispatch", "ref": "refs/heads/main",
                "repository": "1235357/agent-continue",
                "workflowRef": "1235357/agent-continue/.github/workflows/verify-windows-delivery.yml@refs/heads/main"}

    def test_exact_manual_route_is_accepted_without_forging_environment(self):
        self.assertEqual(self.evaluate([self.manual_context()]), [True])

    def test_release_tag_push_route_is_retained_and_other_tags_or_events_rejected(self):
        release = {"job": "windows-sidecar", "event": "push", "ref": "refs/tags/v2.2.1"}
        cases = [release]
        for field, value in (("job", "other"), ("event", "workflow_dispatch"),
                             ("ref", "refs/heads/main"), ("ref", "refs/tags/v2.2"),
                             ("ref", "refs/tags/v2.2.1\n"), ("ref", "refs/tags/v2.2.1-extra")):
            cases.append({**release, field: value})
        self.assertEqual(self.evaluate(cases), [True] + [False] * (len(cases) - 1))

    def test_manual_route_rejects_every_changed_or_missing_identity_field(self):
        manual = self.manual_context()
        cases = [None, {}]
        for field in manual:
            cases.append({key: value for key, value in manual.items() if key != field})
            for value in ("", manual[field] + "\n", manual[field].upper(), "wrong"):
                cases.append({**manual, field: value})
        self.assertEqual(self.evaluate(cases), [False] * len(cases))

    def test_manual_route_rejects_forks_tags_other_workflows_branches_and_event_substitutions(self):
        manual = self.manual_context()
        cases = []
        for field, value in (
            ("event", "pull_request"), ("event", "workflow_call"), ("event", "push"),
            ("ref", "refs/heads/feature"), ("ref", "refs/tags/v2.2.1"),
            ("repository", "fork/agent-continue"), ("job", "release"),
            ("workflowRef", manual["workflowRef"].replace("1235357/", "fork/")),
            ("workflowRef", manual["workflowRef"].replace("@refs/heads/main", "@refs/heads/feature")),
            ("workflowRef", manual["workflowRef"].replace("@refs/heads/main", "@refs/tags/v2.2.1")),
            ("workflowRef", manual["workflowRef"].replace("verify-windows-delivery.yml", "release.yml")),
        ):
            cases.append({**manual, field: value})
        self.assertEqual(self.evaluate(cases), [False] * len(cases))


@unittest.skipUnless(os.name == "nt" and PWSH, "Windows PowerShell 7 required for actual helper tests")
class CiRunnerHelperTests(unittest.TestCase):
    def run_ps(self, body, functions, timeout=20, origin=None):
        # Extract function ASTs only. The script entrypoint and all account operations are never dot-sourced.
        prelude = f"""
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$errors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile({ps_quote(RUNNER)}, [ref]$tokens, [ref]$errors)
if ($errors.Count) {{ throw ($errors | Out-String) }}
$wanted = @({','.join(ps_quote(f) for f in functions)})
foreach ($fn in $ast.FindAll({{param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]}}, $false)) {{
    if ($fn.Name -in $wanted) {{
        $definition = [Management.Automation.Language.Parser]::ParseInput($fn.Extent.Text, {ps_quote(origin or RUNNER)}, [ref]$tokens, [ref]$errors)
        if ($errors.Count) {{ throw ($errors | Out-String) }}
        . $definition.GetScriptBlock()
    }}
}}
"""
        result = subprocess.run([PWSH, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", prelude + body],
                                capture_output=True, text=True, timeout=timeout,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def test_complete_script_parses_without_running_it(self):
        self.assertEqual(self.run_ps("'parsed'", []), "parsed")

    def test_real_owner_host_is_rejected_before_any_account_operation(self):
        result = self.run_ps("""
$env:GITHUB_ACTIONS = 'false'
function New-LocalUser { throw 'TEST_ACCOUNT_CREATION_MUST_NOT_RUN' }
try { Assert-CiHost; throw 'expected rejection' }
catch { if ($_.Exception.Message -cne 'disposable_github_windows_release_runner_required') { throw }; 'rejected' }
""", ["Test-CiWorkflowRoute", "Assert-CiHost"])
        self.assertEqual(result, "rejected")

    def test_environment_is_allowlisted_not_parent_derived(self):
        result = self.run_ps("""
$env:GITHUB_TOKEN = 'synthetic-never-valid'; $env:NODE_OPTIONS = '--invalid-fixture'
New-CiEnvironment 'C:\\ci root' 'C:\\Windows' | ConvertTo-Json -Compress
""", ["New-CiEnvironment"])
        env = json.loads(result)
        self.assertEqual(set(env), {"SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "HOME",
                                    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PSModulePath"})
        self.assertNotIn("synthetic-never-valid", result)
        self.assertIn(r"C:\ci root\inputs\node", env["PATH"])
        self.assertEqual(env["TEMP"], r"C:\ci root\work\temp")

    def test_acl_is_read_only_for_inputs_and_modify_only_for_work_without_setting_real_acl(self):
        body = f"""
$script:seenAcl = $null
function Set-Acl {{ param($LiteralPath,$AclObject) $script:seenAcl = $AclObject }}
foreach ($writable in @($false,$true)) {{
    Set-CiAcl 'C:\\synthetic' '{SID}' -Writable:$writable
    if (-not $script:seenAcl.AreAccessRulesProtected) {{ throw 'inherited ACL retained' }}
    $rules = @($script:seenAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 3) {{ throw 'unexpected principals' }}
    $rule = @($rules | Where-Object {{ $_.IdentityReference.Value -ceq '{SID}' }})
    $expected = if ($writable) {{ [Security.AccessControl.FileSystemRights]::Modify }} else {{ [Security.AccessControl.FileSystemRights]::ReadAndExecute }}
    if ($rule.Count -ne 1 -or ($rule[0].FileSystemRights -band $expected) -ne $expected -or
        ($rule[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::ChangePermissions)) {{ throw 'child ACL mismatch' }}
}}
'sealed'
"""
        self.assertEqual(self.run_ps(body, ["Set-CiAcl"]), "sealed")

    def test_staging_failure_runs_mocked_account_cleanup_and_removes_only_owned_scratch(self):
        with tempfile.TemporaryDirectory(prefix="ac-ci-cleanup-fixture-") as temp:
            root = Path(temp).resolve()
            for relative in ("repo/scripts", "repo/native/bootstrap", "repo/native/desktop-commander", "temp"):
                (root / relative).mkdir(parents=True)
            sentinel = root / "temp/do-not-delete.txt"
            sentinel.write_text("unrelated fixture", encoding="ascii")
            body = f"""
$env:RUNNER_TEMP = {ps_quote(root / 'temp')}; $env:GITHUB_WORKSPACE = {ps_quote(root / 'repo')}
$script:events = @()
function Assert-CiHost {{}}
function New-LocalUser {{
    $script:events += 'create-mocked'
    [pscustomobject]@{{SID=[Security.Principal.SecurityIdentifier]::new('{SID}')}}
}}
function Add-LocalGroupMember {{}}
function Get-LocalGroupMember {{}}
function Set-CiAcl {{}}
function Copy-CiFile {{ throw 'TEST_staging_failed' }}
function Disable-LocalUser {{ $script:events += 'disable-mocked'; throw 'TEST_disable_failed' }}
function Stop-CiAccountProcesses {{ $script:events += 'stop-mocked' }}
function Remove-LocalUser {{ $script:events += 'remove-mocked' }}
try {{ Invoke-CiRunner; throw 'failure not propagated' }}
catch {{ if ($_.Exception.Message -cne 'TEST_disable_failed') {{ throw ($_.Exception.Message + "`n" + $_.ScriptStackTrace) }} }}
if (($script:events -join ',') -cne 'create-mocked,disable-mocked,stop-mocked,remove-mocked') {{ throw 'cleanup order' }}
if (@(Get-ChildItem -LiteralPath $env:RUNNER_TEMP).Count -ne 1) {{ throw 'scratch left behind' }}
'cleaned'
"""
            self.assertEqual(self.run_ps(body, ["Assert-CiPath", "Invoke-CiRunner"],
                                         origin=root / "repo/scripts/fixture.ps1"), "cleaned")
            self.assertEqual(sentinel.read_text(encoding="ascii"), "unrelated fixture")

    def test_paths_reject_relative_unc_ads_quotes_and_sibling_prefix(self):
        result = self.run_ps("""
foreach ($bad in @('relative', '\\\\server\\share', 'C:\\path:stream', "C:\\quote'path", 'C:\\bad"path')) {
    try { $null = Assert-CiPath $bad; throw 'accepted invalid path' }
    catch { if ($_.Exception.Message -cne 'ci_path_invalid') { throw } }
}
foreach ($bad in @('C:\\ci-other\\out', 'C:\\ci\\..\\escape', 'C:\\ci')) {
    try { $null = Assert-CiPath $bad 'C:\\ci'; throw 'accepted escaping path' }
    catch { if ($_.Exception.Message -cne 'ci_path_outside_root') { throw } }
}
'rejected'
""", ["Assert-CiPath"])
        self.assertEqual(result, "rejected")

    def test_receipt_requires_exact_inventory_digest_account_and_success_flags(self):
        with tempfile.TemporaryDirectory(prefix="ac-ci-receipt-fixture-") as temp:
            root = Path(temp).resolve()
            output = root / "work/output"
            output.mkdir(parents=True)
            (output / "agent-continue-windows-administrator-x64.zip").write_bytes(b"non-executable fixture")
            body = f"""
$root = {ps_quote(root)}; $sid = '{SID}'
$output = Join-Path $root 'work\\output'
$receiptPath = Join-Path $output 'ordinary-token.json'
$hash = (Get-FileHash -LiteralPath (Join-Path $output 'agent-continue-windows-administrator-x64.zip') -Algorithm SHA256).Hash.ToLowerInvariant()
$receipt = @{{format='agent-continue-release-ordinary-token-ci';version=1;accountSid=$sid;windowsToken='standard';
    builderPassed=$true;smokePassed=$true;sha256=$hash;installed=$false;published=$false}}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
if ((Assert-CiResult $root $sid) -cne $hash) {{ throw 'matching receipt failed' }}
foreach ($field in @('accountSid','windowsToken','sha256','smokePassed','builderPassed','installed','published')) {{
    $old = $receipt[$field]
    $receipt[$field] = if ($old -is [bool]) {{ -not $old }} else {{ 'wrong' }}
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
    try {{ $null = Assert-CiResult $root $sid; throw 'bad receipt accepted' }}
    catch {{ if ($_.Exception.Message -cne 'ci_child_receipt_invalid') {{ throw }} }}
    $receipt[$field] = $old
}}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
foreach ($bad in @('false', 0, $null)) {{
    $receipt.installed = $bad
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
    try {{ $null = Assert-CiResult $root $sid; throw 'wrongly typed receipt accepted' }}
    catch {{ if ($_.Exception.Message -cne 'ci_child_receipt_invalid') {{ throw }} }}
}}
$receipt.installed = $false
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath
Set-Content -LiteralPath (Join-Path $output 'extra') -Value 'extra'
try {{ $null = Assert-CiResult $root $sid; throw 'extra output accepted' }}
catch {{ if ($_.Exception.Message -cne 'ci_output_inventory') {{ throw }} }}
'verified'
"""
            self.assertEqual(self.run_ps(body, ["Assert-CiPath", "Assert-CiResult"]), "verified")

    def process_case(self, command, expected, *, limit=1048576, deadline=5000):
        body = f"""
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = (Join-Path $PSHOME 'pwsh.exe'); $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
foreach ($arg in @('-NoProfile','-NonInteractive','-Command',{ps_quote(command)})) {{ $start.ArgumentList.Add($arg) }}
$p = [Diagnostics.Process]::new(); $p.StartInfo = $start
try {{
    $null = $p.Start()
    try {{ $result = Read-CiProcess $p -TimeoutMs {deadline} -CharacterLimit {limit}; $result | ConvertTo-Json -Compress }}
    catch {{ if ($_.Exception.Message -cne {ps_quote(expected)}) {{ throw }}; {ps_quote(expected)} }}
}} finally {{ if (-not $p.HasExited) {{ $p.Kill($true); $null = $p.WaitForExit(5000) }}; $p.Dispose() }}
"""
        return self.run_ps(body, ["Read-CiProcess"])

    def test_real_benign_process_drains_both_streams_and_preserves_nonzero_status(self):
        result = json.loads(self.process_case("[Console]::Out.Write('out'); [Console]::Error.Write('err'); exit 7", "unused"))
        self.assertEqual(result, {"exitCode": 7, "stdout": "out", "stderr": "err"})

    def test_real_benign_process_starts_with_clean_environment_and_builtin_commands(self):
        with tempfile.TemporaryDirectory(prefix="ac-ci-env-fixture-") as temp:
            for relative in ("work/temp", "work/home/AppData/Roaming", "work/home/AppData/Local"):
                (Path(temp) / relative).mkdir(parents=True)
            command = ("$ErrorActionPreference='Stop'; "
                       "if ($env:GITHUB_TOKEN -or $env:NODE_OPTIONS) { throw 'inherited environment' }; "
                       f"$hash = Get-FileHash -LiteralPath {ps_quote(RUNNER)} -Algorithm SHA256; "
                       "if ($hash.Hash.Length -ne 64) { throw 'builtin command unavailable' }; "
                       "[Console]::Out.Write('clean')")
            body = f"""
$env:GITHUB_TOKEN = 'synthetic-never-valid'; $env:NODE_OPTIONS = '--invalid-fixture'
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = Join-Path $PSHOME 'pwsh.exe'
$start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
$start.WorkingDirectory = {ps_quote(temp)}
$start.Environment.Clear()
foreach ($entry in (New-CiEnvironment {ps_quote(temp)} $env:SystemRoot).GetEnumerator()) {{
    $start.Environment[$entry.Key] = $entry.Value
}}
foreach ($arg in @('-NoProfile','-NonInteractive','-Command',{ps_quote(command)})) {{ $start.ArgumentList.Add($arg) }}
$p = [Diagnostics.Process]::new(); $p.StartInfo = $start
try {{ $null = $p.Start(); Read-CiProcess $p -TimeoutMs 5000 | ConvertTo-Json -Compress }}
finally {{ if (-not $p.HasExited) {{ $p.Kill($true); $null = $p.WaitForExit(5000) }}; $p.Dispose() }}
"""
            result = json.loads(self.run_ps(body, ["New-CiEnvironment", "Read-CiProcess"]))
            self.assertEqual(result, {"exitCode": 0, "stdout": "clean", "stderr": ""})

    def test_real_benign_process_output_and_wallclock_are_bounded(self):
        self.assertEqual(self.process_case("[Console]::Out.Write('x' * 20000)", "ci_child_output_limit", limit=100),
                         "ci_child_output_limit")
        self.assertEqual(self.process_case("Start-Sleep -Seconds 10", "ci_child_timeout", deadline=100),
                         "ci_child_timeout")

    def test_cleanup_only_targets_mocked_matching_sid_never_real_processes(self):
        body = f"""
$script:killed = @()
function Get-CimInstance {{
    if (1 -notin $script:killed) {{ [pscustomobject]@{{Id=1}} }}
    [pscustomobject]@{{Id=2}}
}}
function Invoke-CimMethod {{ param($InputObject,$MethodName,$Arguments,$ErrorAction)
    if ($MethodName -ceq 'GetOwnerSid') {{
        return [pscustomobject]@{{ ReturnValue=0; Sid=$(if ($InputObject.Id -eq 1) {{ '{SID}' }} else {{ 'S-1-5-18' }}) }}
    }}
    $script:killed += $InputObject.Id; return [pscustomobject]@{{ReturnValue=0}}
}}
Stop-CiAccountProcesses '{SID}'
if ($script:killed.Count -ne 1 -or $script:killed[0] -ne 1) {{ throw 'wrong cleanup selection' }}
'matched'
"""
        self.assertEqual(self.run_ps(body, ["Stop-CiAccountProcesses"]), "matched")


if __name__ == "__main__":
    unittest.main()
