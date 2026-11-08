using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

[assembly: TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]

// A build-selected binding supplies origin and fixed launch paths. Vendor release
// bindings derive installation paths at runtime; per-install builds embed them.
// This transport never interprets, creates, logs or retries a native frame.
internal static class NativeLauncher {
    private const int LifetimeMs = 30000;
    private const int DrainMs = 2000;
    private const int FrameBytes = 4100;
    private const int ErrorBytes = 65536;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(SafeFileHandle file, byte[] bytes, int count, out int written, IntPtr overlapped);

    private sealed class CheckedWriter : Stream {
        private readonly SafeFileHandle file;
        internal CheckedWriter(IntPtr handle) { file = new SafeFileHandle(handle, false); }
        public override bool CanRead { get { return false; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override int Read(byte[] bytes, int offset, int count) { throw new NotSupportedException(); }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long length) { throw new NotSupportedException(); }
        public override void Write(byte[] bytes, int offset, int count) {
            if (bytes == null || offset < 0 || count < 0 || offset > bytes.Length - count) throw new ArgumentException();
            if (count == 0) return;
            if (offset != 0) {
                var copy = new byte[count]; Buffer.BlockCopy(bytes, offset, copy, 0, count); bytes = copy;
            }
            int written;
            if (!WriteFile(file, bytes, count, out written, IntPtr.Zero) || written != count) throw new IOException();
        }
    }

    private static Stream Standard(int kind, bool writable) {
        IntPtr handle = GetStdHandle(kind);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) throw new IOException();
        // Do not own Chrome's handles or use text-mode Console streams.
        return writable ? (Stream)new CheckedWriter(handle) :
            new FileStream(new SafeFileHandle(handle, false), FileAccess.Read, 4096, false);
    }

    [STAThread]
    private static int Main(string[] args) {
        try {
            if (Authorized(args) && LocalFile(NativeLauncherBinding.NodePath, "node.exe") &&
                LocalFile(NativeLauncherBinding.HostScriptPath, "device-native-host.mjs") &&
                Run().GetAwaiter().GetResult()) return 0;
        } catch { }
        return Failure();
    }

    private static bool Authorized(string[] args) {
        if (args == null || args.Length < 1 || args.Length > 2 ||
            !String.Equals(args[0], NativeLauncherBinding.Origin, StringComparison.Ordinal)) return false;
        if (args.Length == 1) return true;
        const string prefix = "--parent-window=";
        string value = args[1];
        if (value == null || !value.StartsWith(prefix, StringComparison.Ordinal) ||
            value.Length <= prefix.Length || value.Length > prefix.Length + 20) return false;
        for (int index = prefix.Length; index < value.Length; index++)
            if (value[index] < '0' || value[index] > '9') return false;
        return true;
    }

    private static bool LocalFile(string value, string name) {
        if (String.IsNullOrEmpty(value) || value.Length < 4 || value.Length >= 260 ||
            value[1] != ':' || value[2] != '\\' || value.IndexOf('/', 0) >= 0 ||
            value.Substring(2).IndexOf(':') >= 0 ||
            !String.Equals(Path.GetFullPath(value), value, StringComparison.Ordinal) ||
            !String.Equals(Path.GetFileName(value), name, StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(value) || new DriveInfo(Path.GetPathRoot(value)).DriveType != DriveType.Fixed) return false;
        for (string cursor = value; cursor != null; cursor = Path.GetDirectoryName(cursor))
            if ((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) return false;
        return true;
    }

    private static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char letter in value) {
            if (letter == '\\') { slashes++; continue; }
            result.Append('\\', letter == '"' ? slashes * 2 + 1 : slashes);
            result.Append(letter); slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    private static void CleanEnvironment(ProcessStartInfo start) {
        var names = new string[start.EnvironmentVariables.Count];
        start.EnvironmentVariables.Keys.CopyTo(names, 0);
        foreach (string name in names) {
            if (name.StartsWith("NODE_", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("NPM_", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("UV_", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("OPENSSL_", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "ICU_DATA", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "SSL_CERT_FILE", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "SSL_CERT_DIR", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "SSLKEYLOGFILE", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "ELECTRON_RUN_AS_NODE", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "VSCODE_INSPECTOR_OPTIONS", StringComparison.OrdinalIgnoreCase))
                start.EnvironmentVariables.Remove(name);
        }
    }

    private static void Observe(Task task) {
        if (task != null) task.ContinueWith(failed => GC.KeepAlive(failed.Exception), CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }
    private static bool Failed(Task task) { return task.IsFaulted || task.IsCanceled; }

    private static async Task Pump(Stream source, Stream destination, int limit, bool closeAtEnd) {
        var bytes = new byte[4096]; int total = 0;
        while (true) {
            int count = await source.ReadAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
            if (count == 0) {
                if (destination != null) {
                    await destination.FlushAsync().ConfigureAwait(false);
                    if (closeAtEnd) destination.Close();
                }
                return;
            }
            if (count > limit - total) throw new IOException();
            total += count;
            if (destination != null) {
                await destination.WriteAsync(bytes, 0, count).ConfigureAwait(false);
                await destination.FlushAsync().ConfigureAwait(false);
            }
        }
    }

    private static async Task<bool> Run() {
        var start = new ProcessStartInfo {
            FileName = NativeLauncherBinding.NodePath,
            Arguments = Quote(NativeLauncherBinding.HostScriptPath) + " " + Quote(NativeLauncherBinding.Origin),
            WorkingDirectory = Path.GetDirectoryName(NativeLauncherBinding.HostScriptPath),
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        CleanEnvironment(start);
        var child = new Process { StartInfo = start };
        Task input = null, output = null, error = null; bool started = false;
        try {
            Stream chromeInput = Standard(-10, false), chromeOutput = Standard(-11, true);
            if (!child.Start()) return false;
            started = true; GC.KeepAlive(child.Handle);
            var clock = Stopwatch.StartNew();
            Stream childInput = child.StandardInput.BaseStream, childOutput = child.StandardOutput.BaseStream,
                childError = child.StandardError.BaseStream;
            // Framework anonymous pipes may block even on their first ReadAsync.
            input = Task.Run(() => Pump(chromeInput, childInput, FrameBytes, true));
            output = Task.Run(() => Pump(childOutput, chromeOutput, FrameBytes, false));
            error = Task.Run(() => Pump(childError, null, ErrorBytes, false));
            Observe(input); Observe(output); Observe(error);
            while (!child.HasExited) {
                if (clock.ElapsedMilliseconds >= LifetimeMs || Failed(input) || Failed(output) || Failed(error)) return false;
                await Task.Delay(10).ConfigureAwait(false);
            }
            long deadline = clock.ElapsedMilliseconds + DrainMs;
            while (!output.IsCompleted || !error.IsCompleted) {
                if (clock.ElapsedMilliseconds >= deadline || Failed(output) || Failed(error)) return false;
                await Task.Delay(10).ConfigureAwait(false);
            }
            // Chrome is allowed to retain its input pipe after the one-shot child exits.
            if (Failed(input) || Failed(output) || Failed(error)) return false;
            await output.ConfigureAwait(false); await error.ConfigureAwait(false);
            return child.ExitCode == 0;
        } finally {
            Observe(input); Observe(output); Observe(error);
            if (started) {
                try { if (!child.HasExited) { child.Kill(); child.WaitForExit(1000); } } catch { }
            }
            // Disposal cannot join a blocked synchronous Chrome input read.
            Observe(Task.Run(() => {
                try { if (started) child.StandardInput.Dispose(); } catch { }
                try { if (started) child.StandardOutput.Dispose(); } catch { }
                try { if (started) child.StandardError.Dispose(); } catch { }
                child.Dispose();
            }));
        }
    }

    private static int Failure() {
        Task message = Task.Run(() => {
            byte[] bytes = Encoding.ASCII.GetBytes("device_bridge_unavailable\n");
            Stream error = Standard(-12, true); error.Write(bytes, 0, bytes.Length); error.Flush();
        });
        Observe(message);
        try { message.Wait(100); } catch { }
        return 1;
    }
}
