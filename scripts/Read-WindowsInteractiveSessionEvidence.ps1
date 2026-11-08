[CmdletBinding()]
param(
    [switch]$RequireLogonAnchor,
    [switch]$CapturePauseBoundary,
    [string]$PriorRecordId,
    [string]$PriorRecordTag,
    [string]$PriorSessionTag,
    [string]$PriorOwnerTag,
    [string]$PauseRecordId,
    [string]$PauseRecordTag,
    [string]$PauseObservedUtcTicks
)

$ErrorActionPreference = 'Stop'
$provider = 'Microsoft-Windows-TerminalServices-LocalSessionManager'
$providerId = [guid]'5d896912-022d-40aa-a3a8-4fa5515c76d7'
$channel = $provider + '/Operational'
$anchorWindowSeconds = 30

function ConvertTo-LogonRecord($Event) {
    if ($Event.ProviderName -cne $provider -or $Event.ProviderId -ne $providerId -or
        $Event.LogName -cne $channel -or $Event.Id -ne 21) { return }
    $fields = $Event.Properties
    if ($Event.Version -ne 0 -or $null -eq $fields -or $fields.Count -ne 3 -or
        $fields[0].Value -isnot [string] -or $fields[1].Value -isnot [uint32] -or $fields[2].Value -isnot [string] -or
        $Event.TimeCreated -isnot [datetime] -or $Event.TimeCreated.Kind -eq [DateTimeKind]::Unspecified -or
        $Event.RecordId -isnot [long] -or $Event.RecordId -lt 1 -or $Event.RecordId -gt 9007199254740991) {
        throw 'logon_anchor_unavailable'
    }
    $account = $fields[0].Value
    $session = $fields[1].Value
    $address = $fields[2].Value
    if (-not $account -or $account.Length -gt 512 -or $account -match '[\x00-\x1f]' -or
        $address.Length -gt 512 -or $address -match '[\x00-\x1f]') { throw 'logon_anchor_unavailable' }
    $time = $Event.TimeCreated.ToUniversalTime()
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $fingerprint = [string]::Join("`n", @('agent-continue-wts-logon-record-v1', $channel, $providerId.ToString(),
        $Event.RecordId.ToString($culture), $time.Ticks.ToString($culture), $session.ToString($culture), $account, $address))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $tag = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprint))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    [ordered]@{ recordId = $Event.RecordId; recordTag = $tag; account = $account; sessionId = $session; timeUtc = $time }
}

function ConvertTo-MatchedLogonAnchor($Event, $Evidence) {
    $record = ConvertTo-LogonRecord $Event
    if ($null -eq $record -or $record.sessionId -ne $Evidence.SessionId -or
        -not [string]::Equals($record.account, $Evidence.Account, [StringComparison]::OrdinalIgnoreCase) -or
        [Math]::Abs(($record.timeUtc - $Evidence.LogonUtc).TotalSeconds) -gt $anchorWindowSeconds) { return }
    return $record
}

function Find-UniqueLogonAnchor($Evidence) {
    $rows = @()
    try {
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $lower = $Evidence.LogonUtc.AddSeconds(-$anchorWindowSeconds).ToString('o', $culture)
        $upper = $Evidence.LogonUtc.AddSeconds($anchorWindowSeconds).ToString('o', $culture)
        # Explicit UTC avoids PowerShell's time-zone conversion in hash filters.
        $query = "*[System[Provider[@Name='$provider'] and EventID=21 and TimeCreated[@SystemTime >= '$lower' and @SystemTime <= '$upper']]]"
        $rows = @(Get-WinEvent -LogName $channel -FilterXPath $query -MaxEvents 33 -Verbose:$false -Debug:$false)
        if ($rows.Count -gt 32) { throw 'logon_anchor_unavailable' }
        $candidates = @($rows | ForEach-Object { ConvertTo-MatchedLogonAnchor $_ $Evidence })
        if ($candidates.Count -ne 1) { throw 'logon_anchor_unavailable' }
        return $candidates[0]
    } finally {
        foreach ($row in $rows) { $row.Dispose() }
    }
}

function Read-LogonRecordById([long]$Id) {
    $retained = @()
    try {
        $recordId = $Id.ToString([Globalization.CultureInfo]::InvariantCulture)
        $retained = @(Get-WinEvent -LogName $channel -FilterXPath "*[System[EventRecordID=$recordId]]" -MaxEvents 2 -Verbose:$false -Debug:$false)
        if ($retained.Count -ne 1) { throw 'logon_anchor_unavailable' }
        $readback = ConvertTo-LogonRecord $retained[0]
        if ($null -eq $readback -or $readback.recordId -ne $Id) { throw 'logon_anchor_unavailable' }
        return $readback
    } finally {
        foreach ($row in $retained) { $row.Dispose() }
    }
}

function Get-CurrentLogonAnchor($Evidence) {
    $anchor = Find-UniqueLogonAnchor $Evidence
    $readback = Read-LogonRecordById $anchor.recordId
    if ($readback.recordTag -cne $anchor.recordTag) { throw 'logon_anchor_unavailable' }
    $latest = Find-UniqueLogonAnchor $Evidence
    if ($latest.recordId -ne $anchor.recordId -or $latest.recordTag -cne $anchor.recordTag) {
        throw 'logon_anchor_unavailable'
    }
    return $anchor
}

function Read-LogonHead {
    $rows = @()
    try {
        $query = "*[System[Provider[@Name='$provider'] and EventID=21]]"
        $rows = @(Get-WinEvent -LogName $channel -FilterXPath $query -MaxEvents 1 -Verbose:$false -Debug:$false)
        if ($rows.Count -ne 1) { throw 'logon_anchor_unavailable' }
        $record = ConvertTo-LogonRecord $rows[0]
        if ($null -eq $record) { throw 'logon_anchor_unavailable' }
        return $record
    } finally {
        foreach ($row in $rows) { $row.Dispose() }
    }
}

function Get-ObservationUtc { return [datetime]::UtcNow }

function Get-PauseBoundary($Evidence, $Anchor) {
    $head = Read-LogonHead
    $retained = Read-LogonRecordById $head.recordId
    $observed = Get-ObservationUtc
    $latest = Read-LogonHead
    $current = Read-LogonRecordById $Anchor.recordId
    if ($head.recordTag -cne $retained.recordTag -or $head.recordTag -cne $latest.recordTag -or
        $current.recordTag -cne $Anchor.recordTag -or
        $head.recordId -lt $Anchor.recordId -or
        ($head.recordId -eq $Anchor.recordId -and $head.recordTag -cne $Anchor.recordTag) -or
        $head.timeUtc -gt $observed -or $Anchor.timeUtc -gt $observed -or
        $Evidence.LogonUtc -gt $observed) { throw 'logon_anchor_unavailable' }
    [ordered]@{ recordId = $head.recordId; recordTag = $head.recordTag
        observedUtcTicks = $observed.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) }
}

function Read-RetainedPauseBoundary($Boundary) {
    $retained = Read-LogonRecordById $Boundary.recordId
    if ($retained.recordTag -cne $Boundary.recordTag -or $retained.timeUtc.Ticks -gt $Boundary.observedUtcTicks) {
        throw 'logon_anchor_unavailable'
    }
}

function Get-RetainedLogonOrder($Evidence, $Anchor, $Prior, $Boundary = $null) {
    if ($Prior.ownerTag -cne $Evidence.OwnerTag -or $Prior.recordId -gt $Anchor.recordId) {
        throw 'logon_anchor_unavailable'
    }
    if ($null -ne $Boundary) {
        $now = Get-ObservationUtc
        if ($Prior.recordId -gt $Boundary.recordId -or $Boundary.observedUtcTicks -gt $now.Ticks -or
            $Anchor.timeUtc -gt $now -or $Evidence.LogonUtc -gt $now) { throw 'logon_anchor_unavailable' }
        Read-RetainedPauseBoundary $Boundary
    }
    if ($Prior.recordId -eq $Anchor.recordId) {
        if ($Prior.recordTag -cne $Anchor.recordTag -or $Prior.sessionTag -cne $Evidence.SessionTag) {
            throw 'logon_anchor_unavailable'
        }
        if ($null -ne $Boundary -and ($Anchor.timeUtc.Ticks -gt $Boundary.observedUtcTicks -or
            $Evidence.LogonUtc.Ticks -gt $Boundary.observedUtcTicks)) { throw 'logon_anchor_unavailable' }
        return 'same'
    }
    if ($Prior.sessionTag -ceq $Evidence.SessionTag) { throw 'logon_anchor_unavailable' }
    if ($null -ne $Boundary -and ($Anchor.recordId -le $Boundary.recordId -or
        $Evidence.LogonUtc.Ticks -le $Boundary.observedUtcTicks -or
        $Anchor.timeUtc.Ticks -le $Boundary.observedUtcTicks)) { throw 'logon_anchor_unavailable' }

    # A larger record ID alone does not prove continuity: the previous record
    # must still be readable and unchanged on both sides of the current readback.
    $older = Read-LogonRecordById $Prior.recordId
    if ($older.recordTag -cne $Prior.recordTag -or $older.timeUtc -ge $Anchor.timeUtc -or
        ($null -ne $Boundary -and $older.timeUtc.Ticks -gt $Boundary.observedUtcTicks) -or
        -not [string]::Equals($older.account, $Evidence.Account, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'logon_anchor_unavailable'
    }
    $latest = Get-CurrentLogonAnchor $Evidence
    if ($latest.recordTag -cne $Anchor.recordTag) { throw 'logon_anchor_unavailable' }
    $retained = Read-LogonRecordById $Prior.recordId
    if ($retained.recordTag -cne $older.recordTag) { throw 'logon_anchor_unavailable' }
    if ($null -ne $Boundary) {
        Read-RetainedPauseBoundary $Boundary
        return 'candidate-after-pause'
    }
    return 'later'
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'windows_required' }
    $prior = $null
    if ($PSBoundParameters.ContainsKey('PriorRecordId') -or $PSBoundParameters.ContainsKey('PriorRecordTag') -or
        $PSBoundParameters.ContainsKey('PriorSessionTag') -or $PSBoundParameters.ContainsKey('PriorOwnerTag')) {
        if (-not $RequireLogonAnchor -or $PriorRecordId -cnotmatch '^[1-9][0-9]{0,15}\z' -or
            $PriorRecordTag -cnotmatch '^[a-f0-9]{64}\z' -or $PriorSessionTag -cnotmatch '^[a-f0-9]{64}\z' -or
            $PriorOwnerTag -cnotmatch '^[a-f0-9]{64}\z' -or [long]$PriorRecordId -gt 9007199254740991) {
            throw 'logon_anchor_unavailable'
        }
        $prior = @{ recordId = [long]$PriorRecordId; recordTag = $PriorRecordTag
            sessionTag = $PriorSessionTag; ownerTag = $PriorOwnerTag }
    }
    if ($CapturePauseBoundary -and (-not $RequireLogonAnchor -or $null -ne $prior)) {
        throw 'logon_anchor_unavailable'
    }
    $boundary = $null
    if ($PSBoundParameters.ContainsKey('PauseRecordId') -or $PSBoundParameters.ContainsKey('PauseRecordTag') -or
        $PSBoundParameters.ContainsKey('PauseObservedUtcTicks')) {
        if ($null -eq $prior -or $CapturePauseBoundary -or $PauseRecordId -cnotmatch '^[1-9][0-9]{0,15}\z' -or
            $PauseRecordTag -cnotmatch '^[a-f0-9]{64}\z' -or $PauseObservedUtcTicks -cnotmatch '^[1-9][0-9]{0,17}\z' -or
            [long]$PauseRecordId -gt 9007199254740991) { throw 'logon_anchor_unavailable' }
        $boundary = @{ recordId = [long]$PauseRecordId; recordTag = $PauseRecordTag
            observedUtcTicks = [long]$PauseObservedUtcTicks }
    }
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

namespace AgentContinue.Diagnostics {
    public static class DesktopSession {
        private enum WtsInfoClass { UserName = 5, DomainName = 7, ClientProtocolType = 16, SessionInfo = 24 }
        private enum WtsState { Active = 0 }
        private enum LogonType : uint { Interactive = 2, RemoteInteractive = 10, CachedInteractive = 11 }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WtsInfo {
            public WtsState State;
            public uint SessionId, IncomingBytes, OutgoingBytes, IncomingFrames, OutgoingFrames;
            public uint IncomingCompressedBytes, OutgoingCompressedBytes;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string WinStationName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 17)] public string Domain;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] public string UserName;
            public long ConnectTime, DisconnectTime, LastInputTime, LogonTime, CurrentTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Luid {
            public uint LowPart;
            public int HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TokenStatistics {
            public Luid TokenId, AuthenticationId;
            public long ExpirationTime;
            public int TokenType, ImpersonationLevel;
            public uint DynamicCharged, DynamicAvailable, GroupCount, PrivilegeCount;
            public Luid ModifiedId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LsaString {
            public ushort Length, MaximumLength;
            public IntPtr Buffer;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LogonDataPrefix {
            public uint Size;
            public Luid LogonId;
            public LsaString UserName, LogonDomain, AuthenticationPackage;
            public LogonType Type;
            public uint Session;
            public IntPtr Sid;
            public long LogonTime;
        }

        [DllImport("wtsapi32.dll", ExactSpelling = true)]
        private static extern bool WTSQuerySessionInformationW(IntPtr server, uint id, WtsInfoClass type,
            out IntPtr buffer, out uint bytes);
        [DllImport("wtsapi32.dll", ExactSpelling = true)]
        private static extern void WTSFreeMemory(IntPtr buffer);
        [DllImport("kernel32.dll", ExactSpelling = true)]
        private static extern uint WTSGetActiveConsoleSessionId();
        [DllImport("kernel32.dll", ExactSpelling = true)]
        private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", ExactSpelling = true)]
        private static extern bool CloseHandle(IntPtr handle);
        [DllImport("advapi32.dll", ExactSpelling = true)]
        private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", ExactSpelling = true)]
        private static extern bool GetTokenInformation(IntPtr token, int type, out TokenStatistics data,
            uint capacity, out uint actual);
        [DllImport("secur32.dll", ExactSpelling = true)]
        private static extern uint LsaGetLogonSessionData(ref Luid id, out IntPtr buffer);
        [DllImport("secur32.dll", ExactSpelling = true)]
        private static extern uint LsaFreeReturnBuffer(IntPtr buffer);

        public sealed class Evidence {
            public readonly string Kind, SessionTag, OwnerTag;
            public readonly string Account;
            public readonly uint SessionId;
            public readonly DateTime LogonUtc;
            internal Evidence(string kind, string sessionTag, string ownerTag, string account, uint sessionId, long logonTime) {
                Kind = kind; SessionTag = sessionTag; OwnerTag = ownerTag; Account = account; SessionId = sessionId;
                LogonUtc = DateTime.FromFileTimeUtc(logonTime);
            }
        }

        private static InvalidOperationException Unavailable() {
            return new InvalidOperationException("session_evidence_unavailable");
        }

        private static WtsInfo ReadSession(uint session) {
            IntPtr buffer;
            uint bytes;
            if (!WTSQuerySessionInformationW(IntPtr.Zero, session, WtsInfoClass.SessionInfo, out buffer, out bytes))
                throw Unavailable();
            try {
                if (buffer == IntPtr.Zero || bytes < Marshal.SizeOf(typeof(WtsInfo))) throw Unavailable();
                WtsInfo data = (WtsInfo)Marshal.PtrToStructure(buffer, typeof(WtsInfo));
                if (data.State != WtsState.Active || data.SessionId != session || data.LogonTime <= 0)
                    throw Unavailable();
                return data;
            } finally { if (buffer != IntPtr.Zero) WTSFreeMemory(buffer); }
        }

        private static string ReadAccountPart(uint session, WtsInfoClass field) {
            IntPtr buffer;
            uint bytes;
            if (!WTSQuerySessionInformationW(IntPtr.Zero, session, field, out buffer, out bytes))
                throw Unavailable();
            try {
                if (buffer == IntPtr.Zero || bytes < 4 || bytes > 1024 || bytes % 2 != 0 ||
                    Marshal.ReadInt16(buffer, (int)bytes - 2) != 0) throw Unavailable();
                string part = Marshal.PtrToStringUni(buffer, (int)bytes / 2 - 1);
                if (String.IsNullOrEmpty(part) || part.IndexOf('\0') >= 0) throw Unavailable();
                return part;
            } finally { if (buffer != IntPtr.Zero) WTSFreeMemory(buffer); }
        }

        private static ushort ReadProtocol(uint session) {
            IntPtr buffer;
            uint bytes;
            if (!WTSQuerySessionInformationW(IntPtr.Zero, session, WtsInfoClass.ClientProtocolType, out buffer, out bytes))
                throw Unavailable();
            try {
                if (buffer == IntPtr.Zero || bytes != sizeof(ushort)) throw Unavailable();
                return unchecked((ushort)Marshal.ReadInt16(buffer));
            } finally { if (buffer != IntPtr.Zero) WTSFreeMemory(buffer); }
        }

        private static string LsaText(LsaString value) {
            if (value.Buffer == IntPtr.Zero || value.Length == 0 || value.Length > 1024 ||
                value.Length > value.MaximumLength || value.Length % 2 != 0) throw Unavailable();
            string text = Marshal.PtrToStringUni(value.Buffer, value.Length / 2);
            if (String.IsNullOrEmpty(text) || text.IndexOf('\0') >= 0) throw Unavailable();
            return text;
        }

        private static bool SameAccount(string left, string right) {
            return String.Equals(left, right, StringComparison.OrdinalIgnoreCase);
        }

        private static string ReadOwnerSid(uint session, ushort protocol, string domain, string user) {
            IntPtr token;
            if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out token)) throw Unavailable(); // TOKEN_QUERY
            try {
                TokenStatistics stats;
                uint actual;
                uint capacity = (uint)Marshal.SizeOf(typeof(TokenStatistics));
                if (!GetTokenInformation(token, 10, out stats, capacity, out actual) || actual != capacity)
                    throw Unavailable(); // TokenStatistics
                IntPtr data;
                if (LsaGetLogonSessionData(ref stats.AuthenticationId, out data) != 0 || data == IntPtr.Zero)
                    throw Unavailable();
                try {
                    if (unchecked((uint)Marshal.ReadInt32(data)) < Marshal.SizeOf(typeof(LogonDataPrefix)))
                        throw Unavailable();
                    LogonDataPrefix logon = (LogonDataPrefix)Marshal.PtrToStructure(data, typeof(LogonDataPrefix));
                    bool localType = logon.Type == LogonType.Interactive || logon.Type == LogonType.CachedInteractive;
                    if (logon.Session != session || logon.LogonTime <= 0 ||
                        logon.LogonId.LowPart != stats.AuthenticationId.LowPart ||
                        logon.LogonId.HighPart != stats.AuthenticationId.HighPart ||
                        (protocol == 0 ? !localType : logon.Type != LogonType.RemoteInteractive) ||
                        !SameAccount(LsaText(logon.UserName), user) ||
                        !SameAccount(LsaText(logon.LogonDomain), domain) || logon.Sid == IntPtr.Zero)
                        throw Unavailable();
                    using (WindowsIdentity identity = new WindowsIdentity(token)) {
                        SecurityIdentifier sid = identity.User;
                        if (sid == null || !sid.Equals(new SecurityIdentifier(logon.Sid))) throw Unavailable();
                        return sid.Value;
                    }
                } finally { LsaFreeReturnBuffer(data); }
            } finally { CloseHandle(token); }
        }

        public static Evidence Read() {
            // The SDK's UTF-16 arrays precede the aligned LARGE_INTEGER fields.
            if (Marshal.SizeOf(typeof(WtsInfo)) != 216 ||
                Marshal.OffsetOf(typeof(WtsInfo), "LogonTime").ToInt32() != 200) throw Unavailable();
            uint session;
            using (Process current = Process.GetCurrentProcess()) {
                if (current.SessionId <= 0) throw Unavailable();
                session = (uint)current.SessionId;
            }
            WtsInfo first = ReadSession(session);
            ushort protocol = ReadProtocol(session);
            if ((protocol != 0 && protocol != 2) || (protocol == 0 && WTSGetActiveConsoleSessionId() != session))
                throw Unavailable();
            string domain = ReadAccountPart(session, WtsInfoClass.DomainName);
            string user = ReadAccountPart(session, WtsInfoClass.UserName);
            string sid = ReadOwnerSid(session, protocol, domain, user);
            if (!SameAccount(user, ReadAccountPart(session, WtsInfoClass.UserName)) ||
                !SameAccount(domain, ReadAccountPart(session, WtsInfoClass.DomainName))) throw Unavailable();
            WtsInfo last = ReadSession(session);
            if (last.LogonTime != first.LogonTime || ReadProtocol(session) != protocol ||
                (protocol == 0 && WTSGetActiveConsoleSessionId() != session)) throw Unavailable();

            // Identity equality only: the timestamp is not a monotonic login generation.
            string canonical = String.Join("|", "agent-continue-wts-session-v1", sid,
                session.ToString(CultureInfo.InvariantCulture), first.LogonTime.ToString(CultureInfo.InvariantCulture));
            using (SHA256 sha = SHA256.Create()) {
                string tag = BitConverter.ToString(sha.ComputeHash(Encoding.ASCII.GetBytes(canonical)))
                    .Replace("-", "").ToLowerInvariant();
                string ownerTag = BitConverter.ToString(sha.ComputeHash(Encoding.ASCII.GetBytes("agent-continue-wts-owner-v1|" + sid)))
                    .Replace("-", "").ToLowerInvariant();
                return new Evidence(protocol == 0 ? "console" : "remote-desktop", tag, ownerTag, domain + "\\" + user,
                    session, first.LogonTime);
            }
        }
    }
}
'@

    $evidence = [AgentContinue.Diagnostics.DesktopSession]::Read()
    $receipt = [ordered]@{ version = 1; available = $true; kind = $evidence.Kind; sessionTag = $evidence.SessionTag }
    if ($RequireLogonAnchor) {
        try {
            $anchor = Get-CurrentLogonAnchor $evidence
            $receipt.logonAnchor = [ordered]@{ recordId = $anchor.recordId; recordTag = $anchor.recordTag; ownerTag = $evidence.OwnerTag }
            if ($CapturePauseBoundary) { $receipt.pauseBoundary = Get-PauseBoundary $evidence $anchor }
            if ($null -ne $prior) { $receipt.logonOrder = Get-RetainedLogonOrder $evidence $anchor $prior $boundary }
            $current = [AgentContinue.Diagnostics.DesktopSession]::Read()
            if ($current.SessionTag -cne $evidence.SessionTag -or $current.Kind -cne $evidence.Kind) {
                throw 'logon_anchor_unavailable'
            }
        } catch { throw 'logon_anchor_unavailable' }
    }
    $receipt | ConvertTo-Json -Depth 3 -Compress
} catch {
    # No raw account identity, OS error, path, or event data goes to stdout/stderr.
    $reason = if ($_.Exception.Message -ceq 'logon_anchor_unavailable') { 'logon_anchor_unavailable' } else { 'session_evidence_unavailable' }
    [ordered]@{ version = 1; available = $false; reason = $reason } |
        ConvertTo-Json -Compress
    exit 1
}
