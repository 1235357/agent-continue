[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'stager_parse' }

$script:checks = 0
$script:cases = 0
$script:failures = [Collections.Generic.List[string]]::new()
function Check([bool]$Value,[string]$Why) {
    if (-not $Value) { throw $Why }
    $script:checks++
}
function Find-Functions([string]$Name) {
    return @($script:ast.FindAll({param($n)
        $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $Name
    },$true))
}
function Commands($Node) {
    return @($Node.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true))
}
function Fields($Value,[string[]]$Expected,[string]$Why) {
    Check ($null -ne $Value) ($Why + '_nonnull')
    $actual = if ($Value -is [Collections.IDictionary]) { @($Value.Keys) }
        elseif ($Value -is [pscustomobject]) { @($Value.PSObject.Properties.Name) }
        else { throw ($Why + '_object') }
    Check ($actual.Count -eq $Expected.Count) ($Why + '_count')
    foreach ($name in $Expected) {
        Check ([Array]::IndexOf($actual,$name) -ge 0) ($Why + '_ordinal_field_' + $name)
    }
}

# Only this closed, pure call graph is loaded. No stager dispatch or real reader runs.
$names = @('Test-AdministratorControlFields','Assert-AdministratorControlIdentity',
    'Get-AdministratorControlStates','Get-AdministratorControlReceiptBytes',
    'Get-AdministratorControlProgressBytes','Assert-AdministratorControlObservationParameters',
    'Read-AdministratorBrowserControlStatus')
$allowedCommands = @($names + @('ConvertTo-Json','Read-AdministratorControlReceipt'))
$allowedMethods = @('IndexOf','Equals','GetFullPath','GetFileName','Substring','GetBytes')
foreach ($name in $names) {
    $definitions = @(Find-Functions $name)
    if ($definitions.Count -ne 1) { throw ('function_count:' + $name) }
    foreach ($command in (Commands $definitions[0])) {
        $commandName = $command.GetCommandName()
        if ($null -eq $commandName) {
            if ($name -cne 'Read-AdministratorBrowserControlStatus' -or
                $command.InvocationOperator -ne [Management.Automation.Language.TokenKind]::Ampersand -or
                $command.CommandElements.Count -ne 1 -or
                $command.CommandElements[0] -isnot [Management.Automation.Language.VariableExpressionAst] -or
                $command.CommandElements[0].VariablePath.UserPath -cne 'Verify') { throw ('unsafe_dynamic_call:' + $name) }
        } elseif ([Array]::IndexOf($allowedCommands,$commandName) -lt 0) { throw ('unsafe_command:' + $commandName) }
    }
    foreach ($member in $definitions[0].FindAll({param($n)
        $n -is [Management.Automation.Language.InvokeMemberExpressionAst]
    },$true)) {
        if ([Array]::IndexOf($allowedMethods,$member.Member.Value) -lt 0) { throw ('unsafe_member:' + $member.Extent.Text) }
    }
    . ([scriptblock]::Create($definitions[0].Extent.Text))
}

$script:digest = 'a' * 64
$script:id = 'b' * 32
$script:sid = 'S-1-5-21-1-2-3-1001'
# A syntactic fixture only: this path is never created, inspected or opened.
$script:root = 'C:\ac-observation-in-memory\' + $digest.Substring(0,24)
$script:bound = @('Action','Archive','ExpectedSha256','ControlKind','ControlOperationId')
$script:secret = 'PRIVATE-OBSERVATION-SENTINEL'
$legacyActions = @('Plan','Stage','Verify','PrepareState','VerifyState','ProbeLocal','AcceptLocal','InstallBrowserOwner',
    'BindHosted','VerifyHosted','RunHostedWindow','StopHostedWindow','AuthorizeHostedOwner','ReauthorizeHostedOwner',
    'RevokeHostedOwner','StartHostedOwner','ObserveHostedOwner','EnrollBrowserOwner','UnenrollBrowserOwner',
    'InspectFailedBrowserOwner','RetireFailedBrowserOwner','ConnectHostedOwner','PauseHostedOwner',
    'ObserveHostedOwnerPause','CheckBrowserHostedOwnerPause','RequestBrowserHostedOwnerPause',
    'RequestBrowserHostedOwnerPauseFence','PauseBrowserHostedOwner','FenceBrowserHostedOwnerPause',
    'RepairBrowserHostedOwnerPauseTarget')
$controlEntryActions=@('RequestBrowserHostedOwnerControl','RequestBrowserHostedOwnerControlFence',
    'RequestBrowserHostedOwnerControlReconcile','ConnectBrowserHostedOwner','ResumeBrowserHostedOwner',
    'RevokeBrowserHostedOwner','FenceBrowserHostedOwnerControl','ReconcileBrowserHostedOwnerControl')
$script:states = @('reserved','intent-saved','launch-requested','launch-unconfirmed','revocation-recorded',
    'stopped','superseded','rejected','fenced','abandoned','recovered-paused')
$script:phases = @('verifying-full','verifying-control','waiting-owner','waiting-stop','settled')
$script:controls = @('connect','resume-saved','revoke')

function Reset-Fixture {
    $script:fixture = @{
        Control='connect';Target=@{Root=$script:root;Sid=$script:sid;Digest=$script:digest}
        ExpectedSid=$script:sid;VerifyCalls=0;ReadCalls=0;VerifyThrows=$false;ReadThrows=$false
        ReadError=[IO.InvalidDataException]::new($script:secret + $script:root)
        Receipt=@{bundleSha256=$script:digest;operationId=$script:id;control='connect';state='reserved';progress=$null}
        Violations=[Collections.Generic.List[string]]::new()
        Pending=@{bundleSha256=$script:digest;operationId=$script:id;control='connect';state='launch-requested';progress=$null}
    }
}
function Run-Case([string]$Name,[scriptblock]$Work) {
    $script:cases++
    Reset-Fixture
    try {
        $null = & $Work
        Check ($script:fixture.Violations.Count -eq 0) 'stub_contract_violated'
        [Console]::WriteLine('PASS ' + $Name)
    } catch {
        $script:failures.Add($Name + ': ' + $_.Exception.Message)
        [Console]::WriteLine('FAIL ' + $Name + ': ' + $_.Exception.Message)
    }
}
$script:verify = {
    $script:fixture.VerifyCalls++
    if ($args.Count) { $script:fixture.Violations.Add('verify_arguments'); throw 'verify_arguments' }
    if ($script:fixture.VerifyThrows) { throw ([UnauthorizedAccessException]::new($script:secret + $script:root)) }
    return $script:fixture.Target
}
function Read-AdministratorControlReceipt {
    [CmdletBinding()]
    param([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,[string]$Control)
    $script:fixture.ReadCalls++
    if ($PSBoundParameters.Count -ne 5 -or $Directory -cne ($script:root + '.status') -or
        $Digest -cne $script:digest -or $Sid -cne $script:fixture.ExpectedSid -or
        $Id -cne $script:id -or $Control -cne $script:fixture.Control) {
        $script:fixture.Violations.Add('receipt_arguments')
        throw 'receipt_arguments'
    }
    if ($script:fixture.ReadThrows) { throw $script:fixture.ReadError }
    return ,$script:fixture.Receipt
}
function Select-Control([string]$Control) {
    $script:fixture.Control = $Control
    $script:fixture.Receipt.control = $Control
}
function Check-Projection($Value,[string]$State,$Progress=$null) {
    Fields $Value @('bundleSha256','operationId','control','state','progress') 'public_projection'
    foreach ($field in @('bundleSha256','operationId','control','state')) {
        Check ($Value.$field -is [string]) ('scalar_string_' + $field)
    }
    Check ([string]::Equals($Value.bundleSha256,$script:digest,[StringComparison]::Ordinal)) 'original_digest'
    Check ([string]::Equals($Value.operationId,$script:id,[StringComparison]::Ordinal)) 'original_id'
    Check ([string]::Equals($Value.control,$script:fixture.Control,[StringComparison]::Ordinal)) 'original_control'
    Check ([string]::Equals($Value.state,$State,[StringComparison]::Ordinal)) 'exact_state'
    if ($null -eq $Progress) { Check ($null -eq $Value.progress) 'null_progress' }
    else {
        Fields $Value.progress @('phase','verifiedFiles','totalFiles') 'public_progress'
        Check ($Value.progress.phase -is [string] -and
            [string]::Equals($Value.progress.phase,$Progress.phase,[StringComparison]::Ordinal)) 'exact_phase'
        foreach ($field in @('verifiedFiles','totalFiles')) {
            if ($null -eq $Progress.$field) { Check ($null -eq $Value.progress.$field) ('null_' + $field) }
            else {
                Check (($Value.progress.$field -is [int] -or $Value.progress.$field -is [long]) -and
                    $Value.progress.$field -eq $Progress.$field) ('integer_' + $field)
            }
        }
    }
    $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
    foreach ($private in @($script:secret,$script:root,$script:sid,'pending','runnerIdentity','sessionEvidence')) {
        Check (-not $json.Contains($private)) 'no_private_projection'
    }
}
function Observe([string]$State='unconfirmed',$Progress=$null,[int]$Reads=1,[int]$Verifies=1) {
    $outputs = @(Read-AdministratorBrowserControlStatus $script:digest $script:id $script:fixture.Control $script:bound $script:verify *>&1)
    Check ($outputs.Count -eq 1) 'one_output_without_error_or_diagnostic_streams'
    Check-Projection $outputs[0] $State $Progress
    Check ($script:fixture.VerifyCalls -eq $Verifies) 'exact_verify_calls'
    Check ($script:fixture.ReadCalls -eq $Reads) 'exact_receipt_calls_no_retry_or_fallback'
    return $outputs[0]
}
function Refuse-Parameters([string]$Action,[string[]]$Keys,[string]$Digest=$script:digest,
    [string]$Id=$script:id,[string]$Control='connect') {
    $threw = $false
    try { $null = Assert-AdministratorControlObservationParameters $Action $Keys $Digest $Id $Control }
    catch { $threw = $true }
    Check $threw 'invalid_parameter_contract_must_throw'
    Check ($script:fixture.VerifyCalls -eq 0 -and $script:fixture.ReadCalls -eq 0) 'assertion_has_no_callbacks'
}
function Refuse-Status([string[]]$Keys,[string]$Digest=$script:digest,[string]$Id=$script:id,[string]$Control='connect') {
    $threw = $false
    try { $null = Read-AdministratorBrowserControlStatus $Digest $Id $Control $Keys $script:verify }
    catch { $threw = $true }
    Check $threw 'invalid_status_parameters_must_throw'
    Check ($script:fixture.VerifyCalls -eq 0) 'invalid_status_before_verify'
    Check ($script:fixture.ReadCalls -eq 0) 'invalid_status_before_receipt'
}

Run-Case 'source_action_set_and_parameters_remain_closed' {
    $action = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq 'Action' })
    Check ($action.Count -eq 1) 'action_parameter_unique'
    $validate = @($action[0].Attributes | Where-Object { $_.TypeName.FullName -ceq 'ValidateSet' })
    Check ($validate.Count -eq 1) 'action_validateset_unique'
    $actual = @($validate[0].PositionalArguments | ForEach-Object { $_.Value })
    $installationPauseActions = @('CheckBrowserHostedOwnerInstallationPause','RequestBrowserHostedOwnerInstallationPause',
        'ObserveBrowserHostedOwnerInstallationPause','PauseBrowserHostedOwnerInstallation')
    $expected = @($legacyActions + 'ObserveHostedOwnerControl' + $controlEntryActions + 'CheckBrowserHostedOwnerControl' +
        'ObserveBrowserSetup' + $installationPauseActions)
    Check ($actual.Count -eq $expected.Count) 'only_fixed_control_readonly_setup_and_installation_pause_actions'
    foreach ($value in $expected) { Check ([Array]::IndexOf($actual,$value) -ge 0) ('action_' + $value) }
    foreach ($name in @('ControlKind','ControlOperationId','PreviousRevocationId','ReauthorizationId')) {
        $parameter = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq $name })
        Check ($parameter.Count -eq 1 -and $parameter[0].StaticType -eq [string]) ('string_parameter_' + $name)
    }
    $main = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
    Check ($main.Count -eq 1) 'reauthorization_main_unique'
    $reauthorization = @($main[0].Body.Statements | Where-Object {
        $_ -is [Management.Automation.Language.IfStatementAst] -and
        $_.Clauses[0].Item1.Extent.Text -ceq '$reauthorizeHostedOwner'
    })
    $allowed = @(foreach ($branch in $reauthorization) {
        $branch.Clauses[0].Item2.Statements | Where-Object {
            $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$allowed'
        }
    })
    Check ($allowed.Count -eq 1) 'reauthorization_allowed_parameters_unique'
    $actualParameters = @($allowed[0].Right.FindAll({param($n)
        $n -is [Management.Automation.Language.StringConstantExpressionAst]
    },$true) | ForEach-Object { $_.Value })
    $expectedParameters = @('Action','Archive','ExpectedSha256','ExpectedUserSid','HostedTunnelId','BrowserExtensionId',
        'ExpectedStagerSha256','PreviousRevocationId','ReauthorizationId','Consent')
    Check ($actualParameters.Count -eq $expectedParameters.Count) 'reauthorization_parameters_closed'
    foreach ($name in $expectedParameters) {
        Check ([Array]::IndexOf($actualParameters,$name) -ge 0) ('reauthorization_parameter_' + $name)
    }
}
Run-Case 'source_early_parameter_guard_before_pause_and_main_dispatch' {
    $guards = @($ast.EndBlock.Statements | Where-Object {
        $_ -is [Management.Automation.Language.IfStatementAst] -and
        $_.Clauses[0].Item1.Extent.Text.Contains("ContainsKey('ControlKind')") -and
        $_.Clauses[0].Item1.Extent.Text.Contains("ContainsKey('ControlOperationId')")
    })
    Check ($guards.Count -eq 1) 'one_top_level_new_parameter_guard'
    $guard = $guards[0]
    Check ($guard.Clauses[0].Item1.Extent.Text -match '\$Action\s+-ieq\s+''ObserveHostedOwnerControl''') 'guard_covers_all_binder_action_spellings_before_ordinal_validation'
    $calls = @((Commands $guard) | Where-Object { $_.GetCommandName() -ceq 'Assert-AdministratorControlObservationParameters' })
    Check ($calls.Count -eq 1) 'guard_uses_real_parameter_validator'
    Check ($calls[0].Extent.Text -match '\$Action\s+@\(\$PSBoundParameters.Keys\)\s+\$ExpectedSha256\s+\$ControlOperationId\s+\$ControlKind') 'guard_validates_actual_bound_keys'
    $rejects = @($guard.FindAll({param($n)
        $n -is [Management.Automation.Language.ExitStatementAst] -and $n.Pipeline.Extent.Text -ceq '2'
    },$true))
    Check ($rejects.Count -eq 1) 'guard_exits_on_rejected_legacy_or_extra_parameter'
    $pauseCalls = @((Commands $ast.EndBlock) | Where-Object { $_.GetCommandName() -ceq 'Invoke-AdministratorBrowserPauseAction' })
    Check ($pauseCalls.Count -eq 1 -and $guard.Extent.EndOffset -lt $pauseCalls[0].Extent.StartOffset) 'guard_precedes_pause_effects'
    $main = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
    Check ($main.Count -eq 1 -and $guard.Extent.EndOffset -lt $main[0].Extent.StartOffset) 'guard_precedes_main_try'
}
Run-Case 'source_actual_observation_dispatch_reaches_helper_before_archive' {
    $main = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })[0]
    $calls = @((Commands $main.Body) | Where-Object { $_.GetCommandName() -ceq 'Read-AdministratorBrowserControlStatus' })
    Check ($calls.Count -eq 1) 'one_actual_dispatch_helper_call'
    $call = $calls[0]
    Check ($call.Extent.Text -match '^Read-AdministratorBrowserControlStatus\s+\$ExpectedSha256\s+\$ControlOperationId\s+\$ControlKind\s+@\(\$PSBoundParameters.Keys\)') 'dispatch_binds_original_request'
    $branch = $call.Parent
    while ($null -ne $branch -and $branch -isnot [Management.Automation.Language.IfStatementAst]) { $branch = $branch.Parent }
    Check ($null -ne $branch -and $branch.Clauses[0].Item1.Extent.Text -ceq '$observeHostedOwnerControl') 'helper_in_control_observation_branch'
    $flags = @($main.Body.FindAll({param($n)
        $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$observeHostedOwnerControl'
    },$true))
    Check ($flags.Count -eq 1 -and $flags[0].Right.Extent.Text -ceq "`$Action -ceq 'ObserveHostedOwnerControl'") 'actual_action_selects_helper_branch'
    $verifyBlocks = @($call.CommandElements | Where-Object { $_ -is [Management.Automation.Language.ScriptBlockExpressionAst] })
    Check ($verifyBlocks.Count -eq 1) 'trusted_verifier_is_internal_scriptblock'
    $verifyCalls = @((Commands $verifyBlocks[0]) | ForEach-Object { $_.GetCommandName() })
    Check ([Array]::IndexOf($verifyCalls,'Get-AdministratorBrowserPauseTarget') -ge 0 -and
        [Array]::IndexOf($verifyCalls,'Get-AdministratorBrowserPauseIdentity') -ge 0) 'dispatch_reuses_sealed_selected_medium_preflight'
    $observation = $branch.Parent
    while ($null -ne $observation -and ($observation -isnot [Management.Automation.Language.IfStatementAst] -or
        -not $observation.Clauses[0].Item1.Extent.Text.Contains('$observeHostedOwnerPause'))) { $observation = $observation.Parent }
    Check ($null -ne $observation -and $observation.Clauses[0].Item1.Extent.Text.Contains('$observeHostedOwnerControl')) 'actual_observation_branch_includes_control'
    $exits = @($observation.Clauses[0].Item2.Statements | Where-Object { $_ -is [Management.Automation.Language.ExitStatementAst] })
    Check ($exits.Count -eq 1 -and $exits[0].Pipeline.Extent.Text -ceq '0') 'observation_exits_before_staging'
    $archive = @($main.Body.Statements | Where-Object {
        $_ -is [Management.Automation.Language.AssignmentStatementAst] -and
        $_.Left.Extent.Text -ceq '$phase' -and $_.Right.Extent.Text -ceq "'archive'"
    })
    Check ($archive.Count -eq 1 -and $observation.Extent.EndOffset -lt $archive[0].Extent.StartOffset) 'observation_before_archive_path'
    $imports = @((Commands $observation) | Where-Object { $_.GetCommandName() -ceq 'Import-Module' })
    Check ($imports.Count -eq 1 -and $imports[0].Extent.StartOffset -lt $call.Extent.StartOffset -and
        $imports[0].Extent.Text.Contains('WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) 'qualified_utility_before_json'
    $effectCalls = @((Commands $observation) | Where-Object {
        $_.GetCommandName() -match '^(?:Request|Publish|Write|Set|Register|Start|Stop|Fence|Reserve|Repair|Recover|New|Open)-'
    })
    Check ($effectCalls.Count -eq 0) 'no_observation_mutation_task_fence_or_fallback'
    Check ($observation.Extent.Text -notmatch '(?i)runas|\.pending|state\s*=\s*[''"]supported|CheckBrowserHostedOwnerControl') 'no_support_uac_or_pending_fallback'
}
Run-Case 'source_entry_guard_rejects_case_variants_without_new_parameters' {
    $guard=@($ast.EndBlock.Statements | Where-Object {
        $_ -is [Management.Automation.Language.IfStatementAst] -and
        $_.Clauses[0].Item1.Extent.Text.Contains("ContainsKey('ControlKind')") -and
        $_.Clauses[0].Item1.Extent.Text.Contains("ContainsKey('ControlOperationId')")
    })
    Check ($guard.Count -eq 1) 'one_entry_guard_for_case_variant_test'
    $condition=[scriptblock]::Create('param($Action,$BoundForGuard) ' +
        $guard[0].Clauses[0].Item1.Extent.Text.Replace('$PSBoundParameters','$BoundForGuard'))
    foreach ($action in @('ObserveHostedOwnerControl','observehostedownercontrol','OBSERVEHOSTEDOWNERCONTROL')) {
        $keys=@{Action=$action;Archive='virtual';ExpectedSha256=$digest}
        $selected=@(& $condition $action $keys)
        Check ($selected.Count -eq 1 -and $selected[0] -is [bool] -and $selected[0]) 'incomplete_observation_enters_early_guard'
        Refuse-Parameters $action @($keys.Keys)
    }
    foreach ($action in $legacyActions) {
        Check (-not (& $condition $action @{Action=$action;Archive='virtual';ExpectedSha256=$digest})) 'unchanged_legacy_request_skips_new_guard'
        foreach ($name in @('ControlKind','ControlOperationId','BrowserControlTarget','ControlCallerPid','ControlCallerCreated','ExpectedSessionId')) {
            $keys=@{Action=$action;Archive='virtual';ExpectedSha256=$digest}; $keys[$name]=''
            Check ([bool](& $condition $action $keys)) 'explicit_empty_new_parameter_still_selects_guard'
        }
    }
}

foreach ($control in $controls) {
    Run-Case ('valid_parameters_' + $control) {
        $outputs = @(Assert-AdministratorControlObservationParameters 'ObserveHostedOwnerControl' $bound $digest $id $control)
        Check ($outputs.Count -eq 0) 'valid_parameters_no_output'
        $reordered = @('ControlOperationId','ControlKind','ExpectedSha256','Archive','Action')
        Assert-AdministratorControlObservationParameters 'ObserveHostedOwnerControl' $reordered $digest $id $control
    }
    foreach ($state in @($states + 'unconfirmed')) {
        Run-Case ('state_' + $control + '_' + $state) {
            Select-Control $control
            $fixture.Receipt.state = $state
            $allowed = if ($control -ceq 'revoke') { @('reserved','fenced','revocation-recorded','stopped','unconfirmed') }
                else { @('reserved','intent-saved','launch-requested','launch-unconfirmed','superseded','rejected','fenced','abandoned','recovered-paused','unconfirmed') }
            $expected = if ([Array]::IndexOf($allowed,$state) -ge 0) { $state } else { 'unconfirmed' }
            $null = Observe $expected
        }
    }
    foreach ($phase in $phases) {
        Run-Case ('progress_' + $control + '_' + $phase) {
            Select-Control $control
            $progress = @{phase=$phase;verifiedFiles=$null;totalFiles=$null}
            $fixture.Receipt.progress = $progress
            $null = Observe 'reserved' $progress
        }
    }
}
foreach ($action in @($legacyActions + $controlEntryActions + @('CheckBrowserHostedOwnerControl','ObserveBrowserSetup','observehostedownercontrol','ObserveHostedOwnerControl ',
    ('ObserveHostedOwner' + [char]0x00ad + 'Control'),([string][char]0xfeff+'ObserveHostedOwnerControl'),''))) {
    Run-Case ('refuse_action_' + $action) { Refuse-Parameters $action $bound }
}
foreach ($action in $legacyActions) {
    foreach ($newParameter in @('ControlKind','ControlOperationId')) {
        Run-Case ('legacy_new_parameter_' + $action + '_' + $newParameter) {
            Refuse-Parameters $action @('Action','Archive','ExpectedSha256',$newParameter)
        }
    }
}
foreach ($key in $bound) {
    Run-Case ('missing_bound_' + $key) {
        $keys = @($bound | Where-Object { $_ -cne $key })
        Refuse-Parameters 'ObserveHostedOwnerControl' $keys
        Refuse-Status $keys
    }
    Run-Case ('ordinal_bound_' + $key) {
        $keys = @($bound | ForEach-Object { if ($_ -ceq $key) { $_.ToLowerInvariant() } else { $_ } })
        Refuse-Parameters 'ObserveHostedOwnerControl' $keys
        Refuse-Status $keys
    }
    Run-Case ('duplicate_replaces_required_' + $key) {
        $keys = @($bound | Where-Object { $_ -cne $key })
        $keys += $keys[0]
        Refuse-Parameters 'ObserveHostedOwnerControl' $keys
        Refuse-Status $keys
    }
    Run-Case ('duplicate_extra_' + $key) { Refuse-Status @($bound + $key) }
}
foreach ($key in @('Consent','ExpectedUserSid','PauseOperationId','BrowserPauseTarget','BrowserWake',
    'OperationReceiptId','RuntimeKeyFile','PreviousRevocationId','ReauthorizationId',
    'Verbose','ErrorAction','Verify','Root','Sid','Unused','controlkind',
    'BrowserControlTarget','ControlCallerPid','ControlCallerCreated','ExpectedSessionId',
    ('Control' + [char]0x00ad + 'Kind'),([string][char]0xfeff + 'ControlKind'))) {
    Run-Case ('extra_bound_' + $key) {
        Refuse-Parameters 'ObserveHostedOwnerControl' @($bound + $key)
        Refuse-Status @($bound + $key)
    }
    Run-Case ('unused_bound_replaces_required_' + $key) {
        $keys=@('Action','Archive','ExpectedSha256','ControlKind',$key)
        Refuse-Parameters 'ObserveHostedOwnerControl' $keys
        Refuse-Status $keys
    }
}
Run-Case 'null_bound_parameters' { Refuse-Status $null }
Run-Case 'empty_bound_parameters' { Refuse-Status @() }
Run-Case 'null_bound_entry_replaces_required' { Refuse-Status @('Action','Archive','ExpectedSha256','ControlKind',$null) }
foreach ($field in @('Digest','Id','Control')) {
    $values = if ($field -ceq 'Digest') { @($null,'',('A'*64),('a'*63),('a'*65),('g'*64),($digest + "`n"),('../' + $digest)) }
        elseif ($field -ceq 'Id') { @($null,'',('B'*32),('b'*31),('b'*33),('g'*32),($id + "`n"),('../' + $id)) }
        else { @($null,'','CONNECT','resume','pause','revoke ',('con'+[char]0x00ad+'nect'),
            ([string][char]0xfeff+'connect'),('connect'+[char]0x200b)) }
    $index = 0
    foreach ($value in $values) {
        Run-Case ('invalid_request_' + $field + '_' + $index) {
            $request = @{Digest=$digest;Id=$id;Control='connect'}
            $request[$field] = $value
            Refuse-Parameters 'ObserveHostedOwnerControl' $bound @request
            Refuse-Status $bound @request
        }
        $index++
    }
}

Run-Case 'verify_exception_is_private_no_read' { $fixture.VerifyThrows=$true; $null = Observe -Reads 0 }
Run-Case 'read_exception_is_private_no_retry_or_pending_fallback' { $fixture.ReadThrows=$true; $null = Observe }
Run-Case 'inaccessible_receipt_is_private_no_retry_or_pending_fallback' {
    $fixture.ReadError=[UnauthorizedAccessException]::new($secret + $root)
    $fixture.ReadThrows=$true
    $null = Observe
}
Run-Case 'null_verify_callback' {
    $actual = @(Read-AdministratorBrowserControlStatus $digest $id 'connect' $bound $null *>&1)
    Check ($actual.Count -eq 1) 'null_callback_single_output'
    Check-Projection $actual[0] 'unconfirmed'
    Check ($fixture.VerifyCalls -eq 0 -and $fixture.ReadCalls -eq 0) 'null_callback_no_effects'
}
Run-Case 'null_target' { $fixture.Target=$null; $null = Observe -Reads 0 }
Run-Case 'valid_azure_sid_binding' {
    $fixture.Target.Sid = 'S-1-12-1-1-2-3-4'
    $fixture.ExpectedSid = $fixture.Target.Sid
    $null = Observe 'reserved'
}
Run-Case 'trusted_target_private_metadata_is_not_projected' {
    $fixture.Target.Archive=$secret
    $fixture.Target.sessionEvidence=@{userSid=$sid;private=$secret}
    $null = Observe 'reserved'
}
foreach ($field in @('Digest','Sid','Root')) {
    $values = if ($field -ceq 'Digest') { @($null,'',('f'*64),('A'*64),@($digest),$true,1) }
        elseif ($field -ceq 'Sid') { @($null,'','S-1-5-18','s-1-5-21-1-2-3-1001',($sid + "`n"),@($sid),$true,1) }
        else { @($null,'',('relative\'+$digest.Substring(0,24)),('C:relative\'+$digest.Substring(0,24)),
            ('\\server\share\'+$digest.Substring(0,24)),($root+'\'),($root+'.status'),
            ('C:\ac-observation-in-memory\..\'+$digest.Substring(0,24)),($root.Replace('\','/')),
            ($root.Substring(0,$root.Length-1)+'f'),@($root),$true,1) }
    $index = 0
    foreach ($value in $values) {
        Run-Case ('bad_verified_target_' + $field + '_' + $index) {
            $fixture.Target[$field] = $value
            $null = Observe -Reads 0
        }
        $index++
    }
    Run-Case ('missing_target_' + $field) { $fixture.Target.Remove($field); $null = Observe -Reads 0 }
}

Run-Case 'missing_receipt_no_pending_fallback' { $fixture.Receipt=$null; $null = Observe }
Run-Case 'corrupt_receipt_scalar' { $fixture.Receipt='{broken:'+$secret; $null = Observe }
Run-Case 'receipt_array_is_not_object' { $fixture.Receipt=@($fixture.Receipt,$fixture.Receipt); $null = Observe }
Run-Case 'single_element_receipt_array_is_not_object' { $fixture.Receipt=@($fixture.Receipt); $null = Observe }
foreach ($field in @('bundleSha256','operationId','control','state','progress')) {
    Run-Case ('missing_receipt_field_' + $field) { $fixture.Receipt.Remove($field); $null = Observe }
    Run-Case ('wrong_case_receipt_field_' + $field) {
        $row = [Collections.Hashtable]::new([StringComparer]::Ordinal)
        foreach ($key in $fixture.Receipt.Keys) { $row.Add($key,$fixture.Receipt[$key]) }
        $value = $row[$field]; $row.Remove($field); $row.Add($field.ToUpperInvariant(),$value)
        $fixture.Receipt=$row
        $null = Observe
    }
}
foreach ($field in @('bundleSha256','operationId','control','state','progress')) {
    Run-Case ('invisible_receipt_field_name_' + $field) {
        $row=[ordered]@{}
        foreach ($key in $fixture.Receipt.Keys) { $row[$key]=$fixture.Receipt[$key] }
        $value=$row[$field]; $row.Remove($field); $row.Add(($field+[char]0xfeff),$value)
        $fixture.Receipt=$row
        $null=Observe
    }
}
foreach ($field in @('version','userSid','Root','pending','runnerIdentity','sessionEvidence','extra')) {
    Run-Case ('extra_private_receipt_field_' + $field) { $fixture.Receipt[$field]=$secret; $null = Observe }
}
foreach ($field in @('bundleSha256','operationId','control','state')) {
    $original = @{bundleSha256=$digest;operationId=$id;control='connect';state='reserved'}[$field]
    $index = 0
    foreach ($value in @($null,$true,1,1.0,@($original),@($original,$original),@{value=$original},
        $original.ToUpperInvariant(),($original+' '),([string][char]0xfeff+$original),
        ($original.Substring(0,1)+[char]0x00ad+$original.Substring(1)))) {
        Run-Case ('invalid_receipt_type_or_spelling_' + $field + '_' + $index) {
            $fixture.Receipt[$field]=$value
            $null = Observe
        }
        $index++
    }
}
foreach ($change in @(@{bundleSha256=('f'*64)},@{operationId=('e'*32)},@{control='revoke'},
    @{state='ready'},@{state='supported'},@{state='requested'},@{state='cancelled'},@{state='unknown'})) {
    Run-Case ('mismatched_receipt_' + @($change.Keys)[0] + '_' + @($change.Values)[0]) {
        foreach ($key in $change.Keys) { $fixture.Receipt[$key]=$change[$key] }
        $null = Observe
    }
}
Run-Case 'unconfirmed_receipt_discards_even_valid_progress' {
    $fixture.Receipt.state='unconfirmed'
    $fixture.Receipt.progress=@{phase='verifying-full';verifiedFiles=10;totalFiles=100}
    $null = Observe
}
foreach ($counts in @(@(0,0),@(0,40000),@(40000,40000),@([long]42,[long]100))) {
    Run-Case ('valid_integer_progress_' + $counts[0] + '_' + $counts[1]) {
        $progress=@{phase='verifying-full';verifiedFiles=$counts[0];totalFiles=$counts[1]}
        $fixture.Receipt.progress=$progress
        $null = Observe 'reserved' $progress
    }
}
$index = 0
foreach ($counts in @(@(-1,10),@(11,10),@(0,40001),@(40001,40001),@('0',10),@(0,'10'),
    @($null,10),@(0,$null),@(0.5,10),@(0,10.0),@($true,10),@(0,$false),
    @([decimal]0,10),@(0,[decimal]10),@([long]::MaxValue,[long]::MaxValue),
    @(@(0),10),@(0,@(10)),@([double]::NaN,10),@(0,[double]::PositiveInfinity))) {
    Run-Case ('malformed_progress_counts_' + $index) {
        $fixture.Receipt.progress=@{phase='verifying-full';verifiedFiles=$counts[0];totalFiles=$counts[1]}
        $null = Observe
    }
    $index++
}
foreach ($phase in @('verifying-control','waiting-owner','waiting-stop','settled')) {
    Run-Case ('counts_forbidden_outside_full_verification_' + $phase) {
        $fixture.Receipt.progress=@{phase=$phase;verifiedFiles=0;totalFiles=0}
        $null = Observe
    }
}
$index = 0
foreach ($phase in @($null,1,$true,@('verifying-full'),'VERIFYING-FULL','verifying-full ','ready',
    ([string][char]0xfeff+'verifying-full'),('verifying-'+[char]0x00ad+'full'),('settled'+[char]0x200b))) {
    Run-Case ('invalid_progress_phase_' + $index) {
        $fixture.Receipt.progress=@{phase=$phase;verifiedFiles=$null;totalFiles=$null}
        $null = Observe
    }
    $index++
}
foreach ($field in @('phase','verifiedFiles','totalFiles')) {
    Run-Case ('missing_progress_field_' + $field) {
        $progress=@{phase='verifying-full';verifiedFiles=0;totalFiles=10}
        $progress.Remove($field); $fixture.Receipt.progress=$progress
        $null = Observe
    }
    Run-Case ('wrong_case_progress_field_' + $field) {
        $progress=[Collections.Hashtable]::new([StringComparer]::Ordinal)
        $progress.Add('phase','verifying-full'); $progress.Add('verifiedFiles',0); $progress.Add('totalFiles',10)
        $value=$progress[$field]; $progress.Remove($field); $progress.Add($field.ToUpperInvariant(),$value)
        $fixture.Receipt.progress=$progress
        $null = Observe
    }
}
foreach ($field in @('phase','verifiedFiles','totalFiles')) {
    Run-Case ('invisible_progress_field_name_' + $field) {
        $progress=[ordered]@{phase='settled';verifiedFiles=$null;totalFiles=$null}
        $value=$progress[$field]; $progress.Remove($field); $progress.Add(($field+[char]0xfeff),$value)
        $fixture.Receipt.progress=$progress
        $null=Observe
    }
}
foreach ($field in @('version','bundleSha256','operationId','control','path','extra')) {
    Run-Case ('extra_progress_field_' + $field) {
        $fixture.Receipt.progress=@{phase='verifying-full';verifiedFiles=0;totalFiles=10}
        $fixture.Receipt.progress[$field]=$secret
        $null = Observe
    }
}
Run-Case 'scalar_progress' { $fixture.Receipt.progress=$secret; $null = Observe }
Run-Case 'array_progress' { $fixture.Receipt.progress=@(@{phase='settled';verifiedFiles=$null;totalFiles=$null}); $null = Observe }
Run-Case 'pscustomobject_receipt_and_progress' {
    $progress=[pscustomobject]@{phase='verifying-full';verifiedFiles=64;totalFiles=40000}
    $fixture.Receipt=[pscustomobject]@{bundleSha256=$digest;operationId=$id;control='connect';state='intent-saved';progress=$progress}
    $null = Observe 'intent-saved' $progress
}
Run-Case 'repeated_reads_and_detached_projection_do_not_mutate_source' {
    $fixture.Receipt.progress=@{phase='verifying-full';verifiedFiles=64;totalFiles=40000}
    $sourceReceipt=ConvertTo-Json -InputObject $fixture.Receipt -Depth 8 -Compress
    $sourceTarget=ConvertTo-Json -InputObject $fixture.Target -Depth 8 -Compress
    $sourcePending=ConvertTo-Json -InputObject $fixture.Pending -Depth 8 -Compress
    $sourceParameters=ConvertTo-Json -InputObject $bound -Compress
    $first=Observe 'reserved' $fixture.Receipt.progress
    Check (-not [object]::ReferenceEquals($first,$fixture.Receipt)) 'receipt_projection_is_detached'
    Check (-not [object]::ReferenceEquals($first.progress,$fixture.Receipt.progress)) 'progress_projection_is_detached'
    $first.state='fenced'; $first.progress.verifiedFiles=0
    $second=Observe 'reserved' $fixture.Receipt.progress -Reads 2 -Verifies 2
    Check ($second.progress.verifiedFiles -eq 64) 'caller_cannot_change_next_observation'
    Check ((ConvertTo-Json -InputObject $fixture.Receipt -Depth 8 -Compress) -ceq $sourceReceipt) 'receipt_source_unchanged'
    Check ((ConvertTo-Json -InputObject $fixture.Target -Depth 8 -Compress) -ceq $sourceTarget) 'target_source_unchanged'
    Check ((ConvertTo-Json -InputObject $fixture.Pending -Depth 8 -Compress) -ceq $sourcePending) 'pending_source_unchanged'
    Check ((ConvertTo-Json -InputObject $bound -Compress) -ceq $sourceParameters) 'bound_parameter_source_unchanged'
}

$summary=[ordered]@{ok=($failures.Count -eq 0);scope='ast-only-in-memory-observation-not-protected-runtime-os-peer-or-full-stager-proof';
    powershell=$PSVersionTable.PSVersion.ToString();cases=$cases;assertions=$checks;failures=$failures.Count}
[Console]::WriteLine((ConvertTo-Json -InputObject $summary -Compress))
if ($failures.Count) { throw ('control_observation_failures:' + $failures.Count) }
