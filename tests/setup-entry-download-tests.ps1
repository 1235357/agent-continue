$ErrorActionPreference='Stop'
$text=[Console]::In.ReadToEnd()
$tokens=$errorsFound=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errorsFound)
if($errorsFound.Count){throw 'fixture_parse'}
$names=@('Budget','EntryUri','Download','VerifyEntry')
foreach($name in $names){
    $matches=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
    if($matches.Count -ne 1){throw ('fixture_function_'+$name)}
    . ([scriptblock]::Create($matches[0].Extent.Text))
}
$checks=0
function Assert([bool]$value,[string]$name){if(-not $value){throw $name};$script:checks++}
function Refuse([scriptblock]$work,[string]$code){
    $caught='';try{& $work}catch{$caught=$_.Exception.Message}
    Assert ($caught -ceq $code) $code
}
foreach($url in @('https://github.com/a','https://release-assets.githubusercontent.com/a?token=fixture','https://objects.githubusercontent.com/a')){
    EntryUri ([uri]$url);$checks++
}
foreach($url in @('http://github.com/a','https://github.com:444/a','https://u:p@github.com/a',
    'https://github.com/a#fragment','https://github.com.evil.invalid/a','file:///a','/relative')){
    Refuse {EntryUri ([uri]$url)} 'entry_destination'
}

# Stub only network objects. The actual source downloader enforces all limits.
$script:queue=@();$script:requests=@();$script:aborts=0;$script:closed=0
function EntryRequest([uri]$url){
    $script:requests+=,$url.AbsoluteUri
    if($script:queue.Count -lt 1){throw 'fixture_no_response'}
    $response=$script:queue[0];$script:queue=@($script:queue | Select-Object -Skip 1)
    $request=[pscustomobject]@{AllowAutoRedirect=$true;UseDefaultCredentials=$true;Timeout=0;Response=$response}
    $request | Add-Member ScriptMethod GetResponse {
        Assert (-not $this.AllowAutoRedirect -and -not $this.UseDefaultCredentials -and
            $this.Timeout -gt 0 -and $this.Timeout -le 90000) 'request_policy'
        return $this.Response
    }
    $request | Add-Member ScriptMethod Abort {$script:aborts++}
    return $request
}
function Response([int]$status,[long]$length,[string]$location='', [int[]]$chunks=@(2,0)){
    $stream=[pscustomobject]@{ReadTimeout=0;Chunks=$chunks;Index=0}
    $stream | Add-Member ScriptMethod Read {param($buffer,$offset,$count)
        if($this.Index -ge $this.Chunks.Count){throw 'fixture_no_chunk'}
        $read=$this.Chunks[$this.Index];$this.Index++
        if($read -gt 0){[Array]::Clear($buffer,0,[Math]::Min($read,$buffer.Length))};return $read
    }
    $response=[pscustomobject]@{StatusCode=$status;ContentLength=$length;Headers=@{Location=$location};Stream=$stream}
    $response | Add-Member ScriptMethod GetResponseStream {return $this.Stream}
    $response | Add-Member ScriptMethod Close {$script:closed++}
    return $response
}
function RunDownload([object[]]$responses,[string]$failure='', [int]$expectedRequests=1){
    $script:queue=$responses;$script:requests=@();$script:aborts=0;$script:closed=0
    $script:watch=[Diagnostics.Stopwatch]::StartNew();$output=[IO.MemoryStream]::new()
    try{
        if($failure){Refuse {Download ([uri]'https://github.com/fixture') $output} $failure}
        else{Download ([uri]'https://github.com/fixture') $output;Assert ($output.Length -eq 2) 'output_length'}
        Assert ($script:requests.Count -eq $expectedRequests) 'request_count'
        Assert ($script:aborts -eq $expectedRequests -and $script:closed -eq $expectedRequests) 'responses_disposed'
    }finally{$output.Dispose()}
}
RunDownload @((Response 200 2))
RunDownload @((Response 200 -1))
RunDownload @((Response 200 4194305)) 'entry_response'
RunDownload @((Response 200 3)) 'entry_size'
RunDownload @((Response 200 0 '' @(0))) 'entry_size'
RunDownload @((Response 200 -1 '' (@(65536)*65+@(0)))) 'entry_size'
RunDownload @((Response 503 2)) 'entry_response'
RunDownload @((Response 302 -1 'https://evil.invalid/file')) 'entry_destination'
RunDownload @((Response 302 -1 'http://github.com/file')) 'entry_destination'
RunDownload @((Response 302 -1 'https://release-assets.githubusercontent.com/file'),(Response 200 2)) '' 2
RunDownload @((Response 302 -1 '/a'),(Response 302 -1 '/b'),(Response 302 -1 '/c'),(Response 200 2)) '' 4
RunDownload @((Response 302 -1 '/a'),(Response 302 -1 '/b'),(Response 302 -1 '/c'),(Response 302 -1 '/d')) 'entry_redirect' 4
RunDownload @((Response 302 -1 '')) 'entry_redirect'
$watch=[pscustomobject]@{ElapsedMilliseconds=90001}
Refuse {Budget} 'entry_deadline'
foreach($case in @(
    @{Text='$script:acReleaseTag = ''v3.0.0''';Code=''},
    @{Text='$script:acReleaseTag = ''v3.0.1''';Code='entry_stamp'},
    @{Text='$script:acReleaseTag = (''v3.0.0'')';Code='entry_stamp'},
    @{Text=('$script:acReleaseTag = ''v3.0.0'''+[char]10+'$script:acReleaseTag = ''v3.0.0''');Code='entry_stamp'},
    @{Text='no release stamp';Code='entry_stamp'})) {
    $bytes=[Text.Encoding]::UTF8.GetBytes($case.Text);$hash=[Security.Cryptography.SHA256]::Create()
    try{$pin=[BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $stream=[IO.MemoryStream]::new($bytes)
    try{if($case.Code){Refuse {VerifyEntry $stream $pin 'v3.0.0'} $case.Code}
        else{VerifyEntry $stream $pin 'v3.0.0';$checks++}}
    finally{$stream.Dispose()}
    $stream=[IO.MemoryStream]::new($bytes)
    try{Refuse {VerifyEntry $stream ('0'*64) 'v3.0.0'} 'entry_hash'}finally{$stream.Dispose()}
}
# Compile only the fixed declaration; never invoke its filesystem primitive.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$declarations=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Add-Type'},$true))
Assert ($declarations.Count -eq 1) 'declaration_unique'
. ([scriptblock]::Create($declarations[0].Extent.Text))
$method=[AcEntryDir].GetMethod('CreateDirectoryW')
Assert ($method.ReturnType -eq [bool] -and $method.GetParameters().Count -eq 2 -and
    $method.GetParameters()[1].ParameterType -eq [IntPtr]) 'declaration_compiled'
$imports=@($method.GetCustomAttributes([Runtime.InteropServices.DllImportAttribute],$false))
Assert ($imports.Count -eq 1 -and $imports[0].Value -ceq 'kernel32.dll' -and
    $imports[0].ExactSpelling -and $imports[0].CharSet -eq 'Unicode') 'declaration_fixed_import'
$main=@($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})
Assert ($main.Count -eq 1) 'main_try_unique'
$dispose=@($main[0].Finally.Statements | Where-Object {
    $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -ceq '$held'
})
Assert ($dispose.Count -eq 1) 'cleanup_unique'
$held=[pscustomobject]@{}
$held | Add-Member ScriptMethod Dispose {throw 'fixture_disposal_failed'}
$code=37
. ([scriptblock]::Create($dispose[0].Extent.Text))
Assert ($code -eq 37) 'cleanup_preserves_exit'
[Console]::WriteLine((ConvertTo-Json -Compress @{ok=$true;checks=$checks;network=$false;entryExecuted=$false;aclTouched=$false;declarationCompiled=$true;cleanupExitPreserved=$true}))
