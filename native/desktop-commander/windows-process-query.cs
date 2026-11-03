using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentContinueProcessQuery {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Entry {
        public uint dwSize, cntUsage, th32ProcessID;
        public UIntPtr th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    public sealed class Row {
        public int pid;
        public int parentPid;
        public string startTime;
        public string executable;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref uint capacity);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static Exception Unknown() { return new InvalidOperationException("process_observation_failed"); }

    private static Row Read(Entry entry) {
        // QUERY_LIMITED_INFORMATION only; no VM read, write, terminate or debug rights.
        IntPtr process = OpenProcess(0x1000, false, entry.th32ProcessID);
        if (process == IntPtr.Zero) throw Unknown();
        try {
            long created, exited, kernel, user;
            uint capacity = 32768;
            StringBuilder image = new StringBuilder((int)capacity);
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user) || created <= 0 ||
                !QueryFullProcessImageName(process, 0, image, ref capacity)) throw Unknown();
            if (entry.th32ProcessID > Int32.MaxValue || entry.th32ParentProcessID > Int32.MaxValue) throw Unknown();
            return new Row { pid = (int)entry.th32ProcessID, parentPid = (int)entry.th32ParentProcessID,
                startTime = created.ToString(CultureInfo.InvariantCulture), executable = image.ToString() };
        } finally { CloseHandle(process); }
    }

    public static Row[] Query(uint processId, bool byParent) {
        if (processId == 0 || processId > Int32.MaxValue) throw Unknown();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw Unknown();
        try {
            Entry entry = new Entry();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(Entry));
            List<Row> rows = new List<Row>();
            bool found = Process32First(snapshot, ref entry);
            int walked = 0;
            while (found) {
                if (++walked > 65536) throw Unknown();
                if (byParent ? entry.th32ParentProcessID == processId : entry.th32ProcessID == processId) {
                    if (rows.Count >= 256) throw Unknown();
                    rows.Add(Read(entry));
                }
                found = Process32Next(snapshot, ref entry);
            }
            // Only a complete snapshot with no match proves absence. Access/race errors do not.
            if (Marshal.GetLastWin32Error() != 18) throw Unknown();
            return rows.ToArray();
        } finally { CloseHandle(snapshot); }
    }
}
