using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace AgentContinue
{
    // Kernel identity and liveness only. The stager seals these paths/bytes;
    // these witnesses neither read keys nor authorize an operation by themselves.
    public static class WindowsBrowserPeer
    {
        const int HandshakeMs = 5000, MaxFrame = 96, MaxProviders = 16;
        const uint StillRunning = 258;
        static readonly Regex Origin = new Regex(@"\Achrome-extension://[a-p]{32}/\z", RegexOptions.CultureInvariant);
        static readonly Regex Generation = new Regex(@"\A[a-f0-9]{32}\z", RegexOptions.CultureInvariant);
        static readonly Regex Frame = new Regex(@"\AACB1 (owner|provider) ([a-f0-9]{32})\n\z", RegexOptions.CultureInvariant);

        static Exception Refused() { return new InvalidOperationException("browser_peer_unavailable"); }
        static Exception NativeError() { return new Win32Exception(Marshal.GetLastWin32Error()); }
        static void Require(bool value) { if (!value) throw Refused(); }
        static bool SamePath(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase); }

        static string CanonicalBundle(string bundle)
        {
            Require(bundle != null && bundle.Length >= 4 && bundle.Length <= 1024 &&
                Regex.IsMatch(bundle, @"\A[A-Za-z]:\\[^\\]", RegexOptions.CultureInvariant) &&
                bundle.IndexOfAny(new[] { '"', '<', '>', '|', '?', '*', '/' }) < 0 &&
                bundle.IndexOf(':', 2) < 0);
            foreach (char c in bundle) Require(c >= 32);
            Require(String.Equals(Path.GetFullPath(bundle), bundle, StringComparison.Ordinal) && !bundle.EndsWith("\\", StringComparison.Ordinal));
            foreach (string part in bundle.Substring(3).Split('\\'))
            {
                Require(part.Length > 0 && !part.EndsWith(" ", StringComparison.Ordinal) && !part.EndsWith(".", StringComparison.Ordinal));
                Require(!Regex.IsMatch(part, @"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\z)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));
            }
            return bundle;
        }

        public static string PipeName(string bundle)
        {
            // Both roles derive the endpoint without any filesystem/key read.
            using (var hash = SHA256.Create())
                return "AgentContinue.AdminBrowser." + BitConverter.ToString(hash.ComputeHash(
                    Encoding.UTF8.GetBytes(CanonicalBundle(bundle).ToUpperInvariant()))).Replace("-", "").ToLowerInvariant();
        }

        static string SystemDirectory()
        {
            var value = new StringBuilder(1024);
            uint n = GetSystemDirectoryW(value, value.Capacity);
            Require(n > 0 && n < value.Capacity);
            return value.ToString();
        }
        static string PowerShellImage() { return Path.Combine(SystemDirectory(), @"WindowsPowerShell\v1.0\powershell.exe"); }

        static void CheckServerArguments(string[] argv, string bundle, string origin)
        {
            string[] expected = { PowerShellImage(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
                Path.Combine(bundle, @"app\windows-browser-peer.ps1"), "-Role", "Server", "-Bundle", bundle, "-Origin", origin };
            Require(argv != null && argv.Length == expected.Length);
            for (int i = 0; i < expected.Length; i++)
                Require(i == 0 || i == 5 || i == 9 ? SamePath(argv[i], expected[i]) : argv[i] == expected[i]);
        }

        static void CheckNodeArguments(string[] argv, string bundle, string origin)
        {
            Require(argv != null && (argv.Length == 3 || argv.Length == 4));
            Require(SamePath(argv[0], Path.Combine(bundle, @"runtime\node.exe")) &&
                SamePath(argv[1], Path.Combine(bundle, @"app\windows-admin-browser-host.mjs")) && argv[2] == origin);
            if (argv.Length == 4) Require(Regex.IsMatch(argv[3], @"\A--parent-window=[0-9]{1,20}\z", RegexOptions.CultureInvariant));
        }
        static void CheckPackagedCodexImage(string image, string family, string packageRoot)
        {
            Require(family == "OpenAI.Codex_2p2nqsd0c76g0");
            CanonicalBundle(packageRoot);
            Require(SamePath(image, Path.Combine(packageRoot, @"app\ChatGPT.exe")));
        }
        static string ReadProcessPackage(SafeFileHandle process, bool family)
        {
            uint length = 0;
            int result = family ? GetPackageFamilyName(process, ref length, null) : GetPackageFullName(process, ref length, null);
            Require(result == 122 && length >= 2 && length <= 1024);
            uint capacity = length;
            var value = new StringBuilder((int)capacity);
            result = family ? GetPackageFamilyName(process, ref length, value) : GetPackageFullName(process, ref length, value);
            Require(result == 0 && length <= capacity && length == value.Length + 1);
            return value.ToString();
        }
        static string ReadPackageRoot(string fullName)
        {
            uint length = 0;
            int result = GetPackagePathByFullName(fullName, ref length, null);
            Require(result == 122 && length >= 2 && length <= 4096);
            uint capacity = length;
            var value = new StringBuilder((int)capacity);
            result = GetPackagePathByFullName(fullName, ref length, value);
            Require(result == 0 && length <= capacity && length == value.Length + 1);
            return value.ToString();
        }
        static void CheckIdentity(string sid, int session, string expectedSid, int expectedSession)
        {
            Require(sid == expectedSid && session > 0 && session == expectedSession);
        }
        static void CheckParentTime(long parent, long child) { Require(parent > 0 && parent < child); }

        static void CheckControlContract(string bundle, string digest, string id, string control, string mode, string target)
        {
            CanonicalBundle(bundle);
            Require(digest != null && Regex.IsMatch(digest, @"\A[a-f0-9]{64}\z", RegexOptions.CultureInvariant) &&
                Path.GetFileName(bundle) == digest.Substring(0, 24) && id != null && Generation.IsMatch(id));
            Require(control == "connect" || control == "resume-saved" || control == "revoke");
            Require(mode == "control" || mode == "fence" || mode == "reconcile");
            if (mode == "control" && control != "revoke")
                Require(target != null && Regex.IsMatch(target, @"\A[a-f0-9]{32}:(?:idle|[a-f0-9]{32})\z", RegexOptions.CultureInvariant));
            else Require(target == null);
        }

        static void CheckControlCallerClaims(uint pid, string started, int session, string sid)
        {
            long ticks;
            Require(pid > 0 && pid <= Int32.MaxValue && session > 0 && started != null &&
                Regex.IsMatch(started, @"\A[1-9][0-9]{0,18}\z", RegexOptions.CultureInvariant) &&
                Int64.TryParse(started, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out ticks) &&
                ticks <= DateTime.MaxValue.Ticks);
            Require(sid != null && Regex.IsMatch(sid, @"\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z", RegexOptions.CultureInvariant) &&
                new SecurityIdentifier(sid).Value == sid);
        }

        static void ValidateControlRequest(string bundle, string digest, string origin, string id, string control,
            string mode, string target, uint callerPid, string callerStarted, int expectedSession, string expectedSid)
        {
            Require(IntPtr.Size == 8 && origin != null && Origin.IsMatch(origin));
            CheckControlContract(bundle, digest, id, control, mode, target);
            CheckControlCallerClaims(callerPid, callerStarted, expectedSession, expectedSid);
        }

        static string[] ControlArguments(string bundle, string digest, string id, string control, string mode,
            string target, bool high, uint callerPid, string callerStarted, int expectedSession, string expectedSid)
        {
            CheckControlContract(bundle, digest, id, control, mode, target);
            CheckControlCallerClaims(callerPid, callerStarted, expectedSession, expectedSid);
            string action, consent;
            if (mode == "fence") { action = high ? "FenceBrowserHostedOwnerControl" : "RequestBrowserHostedOwnerControlFence"; consent = "fence-browser-administrator-control"; }
            else if (mode == "reconcile") { action = high ? "ReconcileBrowserHostedOwnerControl" : "RequestBrowserHostedOwnerControlReconcile"; consent = "reconcile-browser-administrator-control"; }
            else
            {
                action = high ? (control == "connect" ? "ConnectBrowserHostedOwner" : control == "resume-saved" ? "ResumeBrowserHostedOwner" : "RevokeBrowserHostedOwner") : "RequestBrowserHostedOwnerControl";
                consent = control == "connect" ? "connect-browser-administrator-owner" : control == "resume-saved" ? "resume-browser-administrator-owner" : "revoke-browser-administrator-owner";
            }
            var argv = new List<string> { PowerShellImage(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
                Path.Combine(bundle + ".browser", "stager.ps1"), "-Action", action,
                "-Archive", Path.Combine(bundle + ".browser", "bundle.zip"), "-ExpectedSha256", digest,
                "-ControlKind", control, "-ControlOperationId", id };
            if (high) argv.AddRange(new[] { "-ExpectedUserSid", expectedSid, "-Consent", consent,
                "-ControlCallerPid", callerPid.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "-ControlCallerCreated", callerStarted,
                "-ExpectedSessionId", expectedSession.ToString(System.Globalization.CultureInfo.InvariantCulture) });
            if (target != null) argv.AddRange(new[] { "-BrowserControlTarget", target });
            return argv.ToArray();
        }

        static void CheckControlArguments(string[] actual, string[] expected)
        {
            Require(actual != null && actual.Length == expected.Length);
            for (int i = 0; i < expected.Length; i++)
                Require(i == 0 || i == 5 || i == 9 ? SamePath(actual[i], expected[i]) : actual[i] == expected[i]);
        }

        static void CheckControlRole(bool high, string sid, int session, int integrity, bool elevated,
            bool administrator, string expectedSid, int expectedSession)
        {
            CheckIdentity(sid, session, expectedSid, expectedSession);
            Require(integrity == (high ? 12288 : 8192) && elevated == high && administrator == high);
        }

        static string ControlStarted(NativeProcess process)
        {
            return DateTime.FromFileTimeUtc(process.Created).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        static void NoThreadImpersonation()
        {
            using (var identity = WindowsIdentity.GetCurrent(true)) Require(identity == null);
        }

        public sealed class ControlCallerIdentity : IDisposable
        {
            NativeProcess process;
            readonly object gate = new object();
            public readonly uint ProcessId;
            public readonly string Started, UserSid;
            public readonly int SessionId;
            internal ControlCallerIdentity()
            {
                Require(IntPtr.Size == 8);
                NoThreadImpersonation();
                var self = new NativeProcess(GetCurrentProcessId());
                try
                {
                    CheckControlRole(false, self.Sid, self.Session, self.Integrity, self.Elevated, self.Administrator, self.Sid, self.Session);
                    Require(SamePath(self.Image, PowerShellImage()));
                    ProcessId = self.Id; Started = ControlStarted(self); SessionId = self.Session; UserSid = self.Sid;
                    CheckControlCallerClaims(ProcessId, Started, SessionId, UserSid);
                    Require(self.Alive);
                    process = self;
                }
                catch { self.Dispose(); throw; }
            }
            public bool Alive { get { lock (gate) return process != null && process.Alive; } }
            public void Dispose() { lock (gate) { if (process != null) process.Dispose(); process = null; } }
        }

        public static ControlCallerIdentity CaptureControlCallerIdentity() { return new ControlCallerIdentity(); }

        public sealed class ControlSession : IDisposable
        {
            VerifiedServer processes;
            readonly object gate = new object();
            public readonly uint MediumPid, HighPid;
            public readonly string MediumStarted, HighStarted, UserSid;
            public readonly int SessionId;
            internal ControlSession(string bundle, string digest, string origin, string id, string control,
                string mode, string target, uint callerPid, string callerStarted, int expectedSession, string expectedSid)
            {
                ValidateControlRequest(bundle, digest, origin, id, control, mode, target, callerPid, callerStarted, expectedSession, expectedSid);
                NoThreadImpersonation();
                var held = new VerifiedServer();
                try
                {
                    var high = new NativeProcess(GetCurrentProcessId()); held.Chain.Add(high);
                    CheckControlRole(true, high.Sid, high.Session, high.Integrity, high.Elevated, high.Administrator, expectedSid, expectedSession);
                    Require(high.Id != callerPid && SamePath(high.Image, PowerShellImage()));
                    CheckControlArguments(high.Arguments(), ControlArguments(bundle, digest, id, control, mode, target, true, callerPid, callerStarted, expectedSession, expectedSid));
                    var medium = new NativeProcess(callerPid); held.Chain.Add(medium);
                    CheckControlRole(false, medium.Sid, medium.Session, medium.Integrity, medium.Elevated, medium.Administrator, expectedSid, expectedSession);
                    Require(SamePath(medium.Image, PowerShellImage()) && ControlStarted(medium) == callerStarted);
                    CheckParentTime(medium.Created, high.Created);
                    CheckControlArguments(medium.Arguments(), ControlArguments(bundle, digest, id, control, mode, target, false, callerPid, callerStarted, expectedSession, expectedSid));
                    uint parent = medium.ParentId;
                    for (int i = 0; i < 3; i++)
                    {
                        var process = new NativeProcess(parent); held.Chain.Add(process);
                        CheckControlRole(false, process.Sid, process.Session, process.Integrity, process.Elevated, process.Administrator, expectedSid, expectedSession);
                        CheckParentTime(process.Created, held.Chain[held.Chain.Count - 2].Created);
                        if (i == 0)
                        {
                            Require(SamePath(process.Image, Path.Combine(bundle, @"runtime\node.exe")));
                            CheckNodeArguments(process.Arguments(), bundle, origin);
                        }
                        else if (i == 1) Require(SamePath(process.Image, Path.Combine(SystemDirectory(), "cmd.exe")));
                        else process.CheckBrowserImage();
                        parent = process.ParentId;
                    }
                    Require(held.Alive);
                    MediumPid = medium.Id; MediumStarted = ControlStarted(medium);
                    HighPid = high.Id; HighStarted = ControlStarted(high);
                    SessionId = expectedSession; UserSid = expectedSid; processes = held;
                }
                catch { held.Dispose(); throw; }
            }
            public bool Alive { get { lock (gate) return processes != null && processes.Alive; } }
            public void Dispose() { lock (gate) { if (processes != null) processes.Dispose(); processes = null; } }
        }

        public static ControlSession OpenControlSession(string bundle, string digest, string origin, string id, string control,
            string mode, string target, uint callerPid, string callerStarted, int expectedSession, string expectedSid)
        {
            return new ControlSession(bundle, digest, origin, id, control, mode, target, callerPid, callerStarted, expectedSession, expectedSid);
        }

        public static int Run(string role, string bundle, string origin, string generation, string expectedSid)
        {
            Require(IntPtr.Size == 8);
            CanonicalBundle(bundle);
            Require(origin != null && Origin.IsMatch(origin));
            Require(role == "Server" || role == "Owner" || role == "Provider");
            if (role == "Server") Require(String.IsNullOrEmpty(generation) && String.IsNullOrEmpty(expectedSid));
            else
            {
                Require(generation != null && Generation.IsMatch(generation) && expectedSid != null);
                Require(new SecurityIdentifier(expectedSid).Value == expectedSid);
            }
            using (var control = new StdioLifetime())
                return role == "Server" ? RunServer(bundle, control) : RunClient(role, bundle, origin, generation, expectedSid, control);
        }

        // Native PeekNamedPipe makes stdin cancellation observable without an
        // unjoinable blocking Console.Read task. Input bytes are not a protocol.
        sealed class StdioLifetime : IDisposable
        {
            readonly ManualResetEvent stop = new ManualResetEvent(false);
            readonly Thread thread;
            public volatile bool Failed;
            public bool Stopped { get { return stop.WaitOne(0); } }
            public StdioLifetime()
            {
                IntPtr input = GetStdHandle(-10);
                uint flags;
                Require(input != IntPtr.Zero && input != new IntPtr(-1) && GetFileType(input) == 3 && GetHandleInformation(input, out flags));
                thread = new Thread(() =>
                {
                    while (!stop.WaitOne(10))
                    {
                        uint available;
                        if (!PeekInput(input, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero))
                        {
                            int error = Marshal.GetLastWin32Error();
                            Failed = error != 109 && error != 233;
                            stop.Set(); return;
                        }
                        if (available != 0) { Failed = true; stop.Set(); return; }
                    }
                });
                thread.IsBackground = true;
                thread.Start();
            }
            public void Dispose()
            {
                stop.Set();
                Require(thread.Join(1000));
                stop.Dispose();
            }
        }

        static NamedPipeServerStream CreateServer(string name, bool first, string sid)
        {
            var security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.SetOwner(new SecurityIdentifier(sid));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier("S-1-5-2"), PipeAccessRights.FullControl, AccessControlType.Deny));
            foreach (string principal in new[] { sid, "S-1-5-18", "S-1-5-32-544" })
                security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(principal), PipeAccessRights.FullControl, AccessControlType.Allow));
            byte[] descriptor = security.GetSecurityDescriptorBinaryForm();
            var pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
            try
            {
                var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = pin.AddrOfPinnedObject(), Inherit = false };
                // Byte mode, overlapped, explicit non-inherited DACL, deny remote
                // connections as well as Network SID; one owner + 16 + listener.
                var handle = CreateNamedPipeW(@"\\.\pipe\" + name, 3U | 0x40000000U | (first ? 0x80000U : 0U),
                    8, MaxProviders + 2, MaxFrame, MaxFrame, HandshakeMs, ref attributes);
                if (handle.IsInvalid)
                {
                    int error = Marshal.GetLastWin32Error();
                    handle.Dispose(); throw new Win32Exception(error);
                }
                try { return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle); }
                catch { handle.Dispose(); throw; }
            }
            finally { pin.Free(); }
        }

        static NamedPipeServerStream CreateFirstServer(string name, string sid, Func<bool> stopped)
        {
            var deadline = Stopwatch.StartNew();
            while (true)
            {
                Require(!stopped() && deadline.ElapsedMilliseconds < HandshakeMs);
                try { return CreateServer(name, true, sid); }
                catch (Win32Exception error)
                {
                    // FirstPipeInstance reports ERROR_ACCESS_DENIED for an
                    // existing name (ERROR_PIPE_BUSY is also a pipe collision).
                    // No handle was created; never retry a connection or task.
                    if ((error.NativeErrorCode != 5 && error.NativeErrorCode != 231) ||
                        deadline.ElapsedMilliseconds >= HandshakeMs) throw;
                }
                Thread.Sleep(10);
            }
        }

        sealed class PeerRead : IDisposable
        {
            public readonly PipeStream Pipe;
            public readonly bool Owner;
            public readonly byte[] Buffer = new byte[1];
            public readonly Task<int> Read;
            public PeerRead(PipeStream pipe, bool owner)
            {
                Pipe = pipe; Owner = owner;
                Read = pipe.ReadAsync(Buffer, 0, 1);
            }
            public void Dispose()
            {
                Pipe.Dispose();
                Join(Read);
            }
        }
        static void Join(Task task)
        {
            try { Require(task.Wait(1000)); }
            catch (AggregateException) { Require(task.IsCompleted); }
        }
        static void WaitOperation(Task task, PipeStream pipe, Stopwatch deadline, Func<bool> stopped)
        {
            try
            {
                while (!task.IsCompleted)
                {
                    if (stopped() || deadline.ElapsedMilliseconds >= HandshakeMs) throw Refused();
                    Thread.Sleep(10);
                }
                Require(!stopped() && deadline.ElapsedMilliseconds < HandshakeMs);
                task.GetAwaiter().GetResult();
            }
            catch { pipe.Dispose(); Join(task); throw; }
        }
        static bool HasExtra(PipeStream pipe)
        {
            uint available;
            if (!PeekPipe(pipe.SafePipeHandle, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero)) throw NativeError();
            return available != 0;
        }
        static string ReadFrame(PipeStream pipe, Stopwatch deadline, Func<bool> stopped)
        {
            var bytes = new byte[MaxFrame];
            int total = 0;
            while (total < bytes.Length)
            {
                var read = pipe.ReadAsync(bytes, total, bytes.Length - total);
                WaitOperation(read, pipe, deadline, stopped);
                int count = read.GetAwaiter().GetResult();
                Require(count > 0);
                for (int i = total; i < total + count; i++)
                {
                    Require(bytes[i] >= 32 && bytes[i] <= 126 || bytes[i] == 10);
                    if (bytes[i] == 10)
                    {
                        Require(i == total + count - 1 && !HasExtra(pipe));
                        string line = Encoding.ASCII.GetString(bytes, 0, i + 1);
                        Require(Frame.IsMatch(line));
                        return line;
                    }
                }
                total += count;
            }
            throw Refused();
        }
        static void WriteFrame(PipeStream pipe, string frame, Stopwatch deadline, Func<bool> stopped)
        {
            byte[] bytes = Encoding.ASCII.GetBytes(frame);
            WaitOperation(pipe.WriteAsync(bytes, 0, bytes.Length), pipe, deadline, stopped);
        }

        sealed class ServerSession : IDisposable
        {
            readonly StdioLifetime control;
            readonly List<PeerRead> peers = new List<PeerRead>();
            public string Generation;
            public int ActiveProviders;
            public bool Ended, Failed;
            public ServerSession(StdioLifetime input) { control = input; }
            public bool Poll()
            {
                if (Ended) return true;
                if (control.Stopped) { Ended = true; Failed |= control.Failed; return true; }
                for (int i = peers.Count - 1; i >= 0; i--)
                {
                    PeerRead peer = peers[i];
                    if (!peer.Read.IsCompleted) continue;
                    int count;
                    try { count = peer.Read.GetAwaiter().GetResult(); }
                    catch { Ended = true; Failed = true; return true; }
                    if (peer.Owner || count != 0)
                    {
                        Ended = true; Failed |= count != 0;
                        return true;
                    }
                    peer.Dispose(); peers.RemoveAt(i);
                    ActiveProviders--;
                }
                return false;
            }
            public void Add(PipeStream pipe, bool owner) { peers.Add(new PeerRead(pipe, owner)); }
            public void Dispose()
            {
                foreach (var peer in peers) peer.Pipe.Dispose();
                foreach (var peer in peers) peer.Dispose();
                peers.Clear();
            }
        }

        static int RunServer(string bundle, StdioLifetime control)
        {
            using (var self = new NativeProcess(GetCurrentProcessId()))
            using (var session = new ServerSession(control))
            {
                Require(self.Integrity == 8192 && self.Session > 0 && SamePath(self.Image, PowerShellImage()));
                NamedPipeServerStream listener = null;
                Task accept = null;
                try
                {
                    if (session.Poll()) return control.Failed ? 1 : 0;
                    string name = PipeName(bundle);
                    listener = CreateFirstServer(name, self.Sid, session.Poll);
                    Console.Out.Write("LISTENING\n"); Console.Out.Flush();
                    while (!session.Poll())
                    {
                        accept = listener.WaitForConnectionAsync();
                        while (!accept.IsCompleted && !session.Poll()) Thread.Sleep(10);
                        if (session.Poll()) break;
                        accept.GetAwaiter().GetResult(); accept = null;
                        var deadline = Stopwatch.StartNew();
                        string line = ReadFrame(listener, deadline, session.Poll);
                        Match match = Frame.Match(line);
                        bool owner = match.Groups[1].Value == "owner";
                        string generation = match.Groups[2].Value;
                        if (session.Generation == null)
                        {
                            Require(owner);
                            session.Generation = generation;
                        }
                        else Require(!owner && generation == session.Generation && session.ActiveProviders < MaxProviders);
                        WriteFrame(listener, line, deadline, session.Poll);
                        session.Add(listener, owner);
                        if (!owner) session.ActiveProviders++;
                        listener = null;
                        listener = CreateServer(name, false, self.Sid);
                    }
                    return session.Failed ? 1 : 0;
                }
                catch { return session.Poll() && !session.Failed ? 0 : 1; }
                finally
                {
                    if (listener != null) listener.Dispose();
                    if (accept != null) Join(accept);
                }
            }
        }

        sealed class VerifiedServer : IDisposable
        {
            public readonly List<NativeProcess> Chain = new List<NativeProcess>();
            public bool Alive { get { foreach (var process in Chain) if (!process.Alive) return false; return true; } }
            public void Dispose() { foreach (var process in Chain) process.Dispose(); Chain.Clear(); }
        }
        static VerifiedServer VerifyServer(NamedPipeClientStream pipe, string bundle, string origin, string expectedSid)
        {
            var witness = new VerifiedServer();
            try
            {
                using (var self = new NativeProcess(GetCurrentProcessId()))
                {
                    CheckIdentity(self.Sid, self.Session, expectedSid, self.Session);
                    uint pid;
                    if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid)) throw NativeError();
                    for (int i = 0; i < 4; i++)
                    {
                        var process = new NativeProcess(pid);
                        witness.Chain.Add(process);
                        CheckIdentity(process.Sid, process.Session, expectedSid, self.Session);
                        if (i != 0) CheckParentTime(process.Created, witness.Chain[i - 1].Created);
                        if (i == 0)
                        {
                            Require(process.Integrity == 8192 && SamePath(process.Image, PowerShellImage()));
                            CheckServerArguments(process.Arguments(), bundle, origin);
                        }
                        else if (i == 1)
                        {
                            Require(SamePath(process.Image, Path.Combine(bundle, @"runtime\node.exe")));
                            CheckNodeArguments(process.Arguments(), bundle, origin);
                        }
                        else if (i == 2) Require(SamePath(process.Image, Path.Combine(SystemDirectory(), "cmd.exe")));
                        else process.CheckBrowserImage();
                        pid = process.ParentId;
                    }
                    uint again;
                    Require(GetNamedPipeServerProcessId(pipe.SafePipeHandle, out again) && again == witness.Chain[0].Id && witness.Alive);
                }
                return witness;
            }
            catch { witness.Dispose(); throw; }
        }

        static int RunClient(string role, string bundle, string origin, string generation, string expectedSid, StdioLifetime control)
        {
            bool ready = false;
            NamedPipeClientStream pipe = null;
            VerifiedServer server = null;
            PeerRead watch = null;
            try
            {
                pipe = new NamedPipeClientStream(".", PipeName(bundle), PipeDirection.InOut, PipeOptions.Asynchronous,
                    TokenImpersonationLevel.Anonymous, HandleInheritability.None);
                var connect = Stopwatch.StartNew();
                while (!pipe.IsConnected)
                {
                    if (control.Stopped) return control.Failed ? 1 : 0;
                    long remaining = HandshakeMs - connect.ElapsedMilliseconds;
                    Require(remaining > 0);
                    try { pipe.Connect((int)Math.Min(50L, remaining)); }
                    catch (TimeoutException) { }
                }
                var deadline = Stopwatch.StartNew();
                server = VerifyServer(pipe, bundle, origin, expectedSid);
                Func<bool> stopped = () => control.Stopped || !server.Alive;
                Require(!stopped());
                string frame = "ACB1 " + role.ToLowerInvariant() + " " + generation + "\n";
                WriteFrame(pipe, frame, deadline, stopped);
                Require(ReadFrame(pipe, deadline, stopped) == frame && !stopped());
                watch = new PeerRead(pipe, false);
                Require(!watch.Read.IsCompleted && !stopped());
                Console.Out.Write("READY\n"); Console.Out.Flush(); ready = true;
                while (!watch.Read.IsCompleted && !stopped()) Thread.Sleep(10);
                if (control.Stopped) return control.Failed ? 1 : 0;
                if (!server.Alive) return 1;
                return watch.Read.GetAwaiter().GetResult() == 0 ? 0 : 1;
            }
            catch { return control.Stopped && !control.Failed ? 0 : 1; }
            finally
            {
                if (pipe != null) pipe.Dispose();
                if (watch != null) watch.Dispose();
                if (server != null) server.Dispose();
                if (ready) { Console.Out.Write("CLOSED\n"); Console.Out.Flush(); }
            }
        }

        sealed class NativeProcess : IDisposable
        {
            public readonly uint Id, ParentId;
            public readonly string Image, Sid;
            public readonly int Session, Integrity;
            public readonly bool Elevated, Administrator;
            public readonly long Created;
            readonly SafeFileHandle handle;
            public bool Alive { get { return WaitForSingleObject(handle, 0) == StillRunning; } }
            public NativeProcess(uint id)
            {
                Id = id;
                handle = OpenProcess(0x1000 | 0x100000, false, id);
                if (handle.IsInvalid) { handle.Dispose(); throw NativeError(); }
                try
                {
                    Require(Alive);
                    var image = new StringBuilder(32768);
                    int length = image.Capacity;
                    if (!QueryFullProcessImageNameW(handle, 0, image, ref length)) throw NativeError();
                    Image = image.ToString();
                    var info = new ProcessBasicInformation();
                    int needed;
                    Require(NtQueryBasic(handle, 0, ref info, Marshal.SizeOf(info), out needed) == 0 && info.ProcessId.ToInt64() == id);
                    long parent = info.ParentId.ToInt64();
                    Require(parent > 0 && parent <= UInt32.MaxValue);
                    ParentId = (uint)parent;
                    long exit, kernel, user, created;
                    if (!GetProcessTimes(handle, out created, out exit, out kernel, out user)) throw NativeError();
                    Created = created;
                    SafeFileHandle token;
                    if (!OpenProcessToken(handle, 8, out token)) throw NativeError();
                    using (token)
                    {
                        Sid = TokenSid(token, 1);
                        string integrity = TokenSid(token, 25);
                        Integrity = Int32.Parse(integrity.Substring(integrity.LastIndexOf('-') + 1), System.Globalization.CultureInfo.InvariantCulture);
                        var data = new byte[4];
                        if (!GetTokenBytes(token, 12, data, data.Length, out needed) || needed != 4) throw NativeError();
                        Session = BitConverter.ToInt32(data, 0);
                        uint nativeSession;
                        Require(ProcessIdToSessionId(id, out nativeSession) && nativeSession == Session);
                        if (!GetTokenBytes(token, 20, data, data.Length, out needed) || needed != 4) throw NativeError();
                        int elevation = BitConverter.ToInt32(data, 0);
                        Require(elevation == 0 || elevation == 1);
                        Elevated = elevation != 0;
                        Administrator = TokenAdministrator(token);
                    }
                    Require(Alive);
                }
                catch { handle.Dispose(); throw; }
            }
            public void CheckBrowserImage()
            {
                Require(Alive);
                if (SamePath(Path.GetFileName(Image), "chrome.exe")) return;
                Require(SamePath(Path.GetFileName(Image), "ChatGPT.exe"));
                // Package identity comes from this held process, not a name or caller-supplied path.
                string family = ReadProcessPackage(handle, true);
                string fullName = ReadProcessPackage(handle, false);
                CheckPackagedCodexImage(Image, family, ReadPackageRoot(fullName));
                Require(Alive);
            }
            static string TokenSid(SafeFileHandle token, int kind)
            {
                int bytes;
                GetTokenPointer(token, kind, IntPtr.Zero, 0, out bytes);
                Require(bytes >= IntPtr.Size && bytes <= 65536);
                IntPtr buffer = Marshal.AllocHGlobal(bytes);
                try
                {
                    if (!GetTokenPointer(token, kind, buffer, bytes, out bytes)) throw NativeError();
                    return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            static bool TokenAdministrator(SafeFileHandle token)
            {
                int bytes;
                GetTokenPointer(token, 2, IntPtr.Zero, 0, out bytes);
                int offset = IntPtr.Size, stride = IntPtr.Size == 8 ? 16 : 8;
                Require(bytes >= offset && bytes <= 65536);
                IntPtr buffer = Marshal.AllocHGlobal(bytes);
                try
                {
                    int allocated = bytes;
                    if (!GetTokenPointer(token, 2, buffer, allocated, out bytes)) throw NativeError();
                    Require(bytes <= allocated && bytes >= offset);
                    int count = Marshal.ReadInt32(buffer);
                    Require(count >= 0 && count <= 4096 && count <= (bytes - offset) / stride);
                    for (int i = 0; i < count; i++)
                    {
                        int entry = offset + i * stride;
                        IntPtr sid = Marshal.ReadIntPtr(buffer, entry);
                        long at = sid.ToInt64() - buffer.ToInt64();
                        Require(at >= offset + count * stride && at <= bytes - 8 && Marshal.ReadByte(sid) == 1);
                        int subauthorities = Marshal.ReadByte(sid, 1);
                        Require(subauthorities <= 15 && 8 + 4 * subauthorities <= bytes - at);
                        uint attributes = unchecked((uint)Marshal.ReadInt32(buffer, entry + IntPtr.Size));
                        if (new SecurityIdentifier(sid).Value == "S-1-5-32-544")
                            return (attributes & 4U) != 0 && (attributes & 16U) == 0;
                    }
                    return false;
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            public string[] Arguments()
            {
                // ProcessCommandLineInformation is obtained through the held
                // handle; no WMI/PID re-query or remote-memory dereference.
                int needed;
                NtQueryBuffer(handle, 60, IntPtr.Zero, 0, out needed);
                Require(needed >= 16 && needed <= 131072);
                IntPtr buffer = Marshal.AllocHGlobal(needed);
                try
                {
                    int allocated = needed;
                    Require(NtQueryBuffer(handle, 60, buffer, allocated, out needed) == 0 && needed <= allocated);
                    int length = (ushort)Marshal.ReadInt16(buffer);
                    IntPtr text = Marshal.ReadIntPtr(buffer, 8);
                    long offset = text.ToInt64() - buffer.ToInt64();
                    Require(length > 0 && length % 2 == 0 && offset >= 16 && offset <= allocated - length);
                    string command = Marshal.PtrToStringUni(text, length / 2);
                    Require(command.IndexOf('\0') < 0 && Alive);
                    int count;
                    IntPtr argv = CommandLineToArgvW(command, out count);
                    if (argv == IntPtr.Zero) throw NativeError();
                    try
                    {
                        Require(count >= 1 && count <= 64);
                        var result = new string[count];
                        for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, i * IntPtr.Size));
                        return result;
                    }
                    finally { LocalFree(argv); }
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            public void Dispose() { handle.Dispose(); }
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessBasicInformation { public IntPtr Reserved1, Peb, Reserved2, Reserved3, ProcessId, ParentId; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafePipeHandle CreateNamedPipeW(string name, uint openMode, uint mode, int instances, int outSize, int inSize, int timeout, ref SecurityAttributes attributes);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
        [DllImport("kernel32.dll", EntryPoint = "PeekNamedPipe", SetLastError = true)]
        static extern bool PeekPipe(SafePipeHandle pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr left);
        [DllImport("kernel32.dll", EntryPoint = "PeekNamedPipe", SetLastError = true)]
        static extern bool PeekInput(IntPtr pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr left);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int handle);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetFileType(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetHandleInformation(IntPtr handle, out uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetSystemDirectoryW(StringBuilder buffer, int size);
        [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
        [DllImport("kernel32.dll", SetLastError = true)] static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint id);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        static extern int GetPackageFamilyName(SafeFileHandle process, ref uint length, StringBuilder value);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        static extern int GetPackageFullName(SafeFileHandle process, ref uint length, StringBuilder value);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        static extern int GetPackagePathByFullName(string fullName, ref uint length, StringBuilder value);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(SafeFileHandle handle, uint timeout);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(SafeFileHandle handle, uint flags, StringBuilder image, ref int length);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(SafeFileHandle handle, out long created, out long exit, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ProcessIdToSessionId(uint pid, out uint session);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(SafeFileHandle process, uint access, out SafeFileHandle token);
        [DllImport("advapi32.dll", EntryPoint = "GetTokenInformation", SetLastError = true)] static extern bool GetTokenPointer(SafeFileHandle token, int kind, IntPtr data, int size, out int needed);
        [DllImport("advapi32.dll", EntryPoint = "GetTokenInformation", SetLastError = true)] static extern bool GetTokenBytes(SafeFileHandle token, int kind, byte[] data, int size, out int needed);
        [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")] static extern int NtQueryBasic(SafeFileHandle process, int kind, ref ProcessBasicInformation data, int size, out int needed);
        [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")] static extern int NtQueryBuffer(SafeFileHandle process, int kind, IntPtr data, int size, out int needed);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    }
}
