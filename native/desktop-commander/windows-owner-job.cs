using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace AgentContinue
{
    public sealed class WindowsOwnerJob : IDisposable
    {
        const int BasicAccounting = 1, ExtendedLimits = 9;
        const int JobListAttribute = 0x0002000D;
        const uint KillOnClose = 0x2000, Suspended = 0x4, UnicodeEnvironment = 0x400;
        const uint ExtendedStartup = 0x80000, NoWindow = 0x08000000, WaitTimeout = 258;
        SafeFileHandle job, root;
        bool used;
        public uint RootProcessId { get; private set; }
        public static ulong BootMilliseconds() { return GetTickCount64(); }

        public WindowsOwnerJob()
        {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException();
            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job.IsInvalid) throw LastError();
            try
            {
                var limits = new JobExtendedLimits();
                limits.Basic.LimitFlags = KillOnClose;
                if (!SetInformationJobObject(job, ExtendedLimits, ref limits, SizeOf(typeof(JobExtendedLimits))))
                    throw LastError();
            }
            catch { job.Dispose(); throw; }
        }

        public void Start(ProcessStartInfo plan)
        {
            if (used || plan == null || plan.UseShellExecute || !plan.CreateNoWindow ||
                plan.RedirectStandardInput || plan.RedirectStandardOutput || plan.RedirectStandardError ||
                !Path.IsPathRooted(plan.FileName) || !Path.IsPathRooted(plan.WorkingDirectory) ||
                plan.FileName.IndexOfAny(new[] { '"', '\0' }) >= 0 || plan.Arguments.IndexOf('\0') >= 0)
                throw new ArgumentException("invalid owner launch");
            used = true;

            var attrs = IntPtr.Zero;
            var jobValue = IntPtr.Zero;
            var env = IntPtr.Zero;
            var initialized = false;
            var child = new ProcessInformation();
            try
            {
                var bytes = IntPtr.Zero;
                // The first sizing call is expected to return insufficient buffer.
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes);
                if (bytes.ToInt64() <= 0 || bytes.ToInt64() > 65536) throw LastError();
                attrs = Marshal.AllocHGlobal(bytes);
                if (!InitializeProcThreadAttributeList(attrs, 1, 0, ref bytes)) throw LastError();
                initialized = true;
                jobValue = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobValue, job.DangerousGetHandle());
                if (!UpdateProcThreadAttribute(attrs, 0, new IntPtr(JobListAttribute), jobValue,
                    new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw LastError();

                var startup = new StartupInfoEx();
                startup.Startup.Size = SizeOf(typeof(StartupInfoEx));
                startup.Attributes = attrs;
                env = Marshal.StringToHGlobalUni(EnvironmentBlock(plan));
                var command = new StringBuilder("\"" + plan.FileName + "\" " + plan.Arguments);
                // Kernel assignment is part of creation; suspension allows checking it
                // before any user code can run. No handles are inherited.
                if (!CreateProcessW(plan.FileName, command, IntPtr.Zero, IntPtr.Zero, false,
                    Suspended | UnicodeEnvironment | ExtendedStartup | NoWindow, env,
                    plan.WorkingDirectory, ref startup, out child)) throw LastError();
                root = new SafeFileHandle(child.Process, true);
                RootProcessId = child.ProcessId;
                if (!ContainsProcess(root)) throw new InvalidOperationException("owner is not assigned to its job");
                if (ResumeThread(child.Thread) != 1) throw LastError();
            }
            catch
            {
                // Also covers a failed membership check with an unreleased suspended child.
                if (root != null) TerminateProcess(root, 1);
                throw;
            }
            finally
            {
                if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
                if (initialized) DeleteProcThreadAttributeList(attrs);
                if (attrs != IntPtr.Zero) Marshal.FreeHGlobal(attrs);
                if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
                if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
                GC.KeepAlive(job);
            }
        }

        public bool WaitForRoot(int timeoutMs)
        {
            if (root == null || timeoutMs < 0) throw new ArgumentException("invalid root wait");
            uint result = WaitForSingleObject(root, (uint)timeoutMs);
            if (result == 0) return true;
            if (result == WaitTimeout) return false;
            throw LastError();
        }

        public uint RootExitCode()
        {
            uint result;
            if (!WaitForRoot(0)) throw new InvalidOperationException("owner has not exited");
            if (!GetExitCodeProcess(root, out result)) throw LastError();
            return result;
        }

        public uint ActiveCount()
        {
            var data = new JobBasicAccounting();
            if (!QueryInformationJobObject(job, BasicAccounting, out data, SizeOf(typeof(JobBasicAccounting)), IntPtr.Zero))
                throw LastError();
            return data.ActiveProcesses;
        }

        public bool ContainsProcess(SafeHandle process)
        {
            bool belongs;
            if (!IsProcessInJob(process, job, out belongs)) throw LastError();
            return belongs;
        }

        public bool Drain(int timeoutMs)
        {
            if (timeoutMs < 0) throw new ArgumentOutOfRangeException("timeoutMs");
            used = true;
            var watch = Stopwatch.StartNew();
            if (ActiveCount() == 0) return true;
            if (!TerminateJobObject(job, 1)) throw LastError();
            while (ActiveCount() != 0)
            {
                long remaining = timeoutMs - watch.ElapsedMilliseconds;
                if (remaining <= 0) return false;
                Thread.Sleep((int)Math.Min(remaining, 25));
            }
            return true;
        }

        public void Dispose()
        {
            if (job != null) job.Dispose();
            if (root != null) root.Dispose();
        }

        static string EnvironmentBlock(ProcessStartInfo plan)
        {
            var entries = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry item in plan.EnvironmentVariables)
            {
                var key = (string)item.Key;
                var value = (string)item.Value;
                if (String.IsNullOrEmpty(key) || key.IndexOfAny(new[] { '=', '\0' }) >= 0 ||
                    value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("invalid owner environment");
                entries.Add(key, value);
            }
            var block = new StringBuilder();
            foreach (var item in entries) block.Append(item.Key).Append('=').Append(item.Value).Append('\0');
            // StringToHGlobalUni appends the second terminator.
            if (block.Length == 0) block.Append('\0');
            return block.ToString();
        }

        static uint SizeOf(Type type) { return (uint)Marshal.SizeOf(type); }
        static Win32Exception LastError() { return new Win32Exception(Marshal.GetLastWin32Error()); }

        [StructLayout(LayoutKind.Sequential)]
        struct JobBasicLimits
        {
            public long ProcessTime, JobTime;
            public uint LimitFlags;
            public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct JobExtendedLimits
        {
            public JobBasicLimits Basic;
            public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct JobBasicAccounting
        {
            public long User, Kernel, PeriodUser, PeriodKernel;
            public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct StartupInfo
        {
            public uint Size;
            public IntPtr Reserved, Desktop, Title;
            public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
            public ushort ShowWindow, ReservedLength;
            public IntPtr ReservedBytes, StandardInput, StandardOutput, StandardError;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct StartupInfoEx { public StartupInfo Startup; public IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        static extern SafeFileHandle CreateJobObjectW(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(SafeFileHandle job, int info, ref JobExtendedLimits limits, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool QueryInformationJobObject(SafeFileHandle job, int info, out JobBasicAccounting data, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(SafeFileHandle job, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool IsProcessInJob(SafeHandle process, SafeFileHandle job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value,
            IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")]
        static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
            ref StartupInfoEx startup, out ProcessInformation child);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateProcess(SafeFileHandle process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern uint WaitForSingleObject(SafeFileHandle handle, uint timeout);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")]
        static extern ulong GetTickCount64();
    }
}
