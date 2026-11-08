using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using System.Runtime.Serialization.Json;

// Install-specific data is never compiled into a vendor release. Browser input
// supplies only its origin; executable, script and state paths are fixed here.
internal static class NativeLauncherBinding {
    internal static readonly string NodePath;
    internal static readonly string HostScriptPath;
    internal static readonly string Origin;
    private static readonly List<FileStream> Retained = new List<FileStream>();

    static NativeLauncherBinding() {
        string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        NodePath = Path.Combine(root, "runtime", "node.exe");
        HostScriptPath = Path.Combine(root, "app", "device-native-host.mjs");
        Pin(NodePath, NativeLauncherReleasePins.NodeSha256);
        if (NativeLauncherReleasePins.Names.Length != NativeLauncherReleasePins.Digests.Length ||
            NativeLauncherReleasePins.Names.Length != 17) throw new InvalidDataException();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int index = 0; index < NativeLauncherReleasePins.Names.Length; index++) {
            string name = NativeLauncherReleasePins.Names[index];
            if (String.IsNullOrEmpty(name) || name == "." || name == ".." || Path.GetFileName(name) != name ||
                !seen.Add(name)) throw new InvalidDataException();
            Pin(Path.Combine(root, "app", name), NativeLauncherReleasePins.Digests[index]);
        }
        if (!seen.Contains("device-native-host.mjs")) throw new InvalidDataException();
        XElement binding = ReadObject(Path.Combine(root, "app", "device-native-binding.json"));
        Fields(binding, "format", "version", "extensionId", "stateRoot");
        if (Value(binding, "format", "string") != "agent-continue-native-binding" ||
            Value(binding, "version", "number") != "1") throw new InvalidDataException();
        string extensionId = Value(binding, "extensionId", "string");
        if (extensionId.Length != 32) throw new InvalidDataException();
        foreach (char letter in extensionId) if (letter < 'a' || letter > 'p') throw new InvalidDataException();
        string state = Value(binding, "stateRoot", "string");
        if (!String.Equals(state, Path.Combine(root, "state"), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException();
        CheckPath(state, false);
        Origin = "chrome-extension://" + extensionId + "/";
        XElement manifest = ReadObject(Path.Combine(root, "native-host.json"));
        Fields(manifest, "name", "description", "path", "type", "allowed_origins");
        if (Value(manifest, "name", "string") != "com.agentcontinue.device_control" ||
            Value(manifest, "description", "string") != "Agent Continue device lifecycle bridge" ||
            Value(manifest, "type", "string") != "stdio" ||
            !String.Equals(Value(manifest, "path", "string"), Assembly.GetExecutingAssembly().Location, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException();
        XElement origins = manifest.Element("allowed_origins");
        if (new List<XAttribute>(origins.Attributes()).Count != 1 || (string)origins.Attribute("type") != "array") throw new InvalidDataException();
        var entries = new List<XElement>(origins.Elements());
        if (entries.Count != 1 || entries[0].Name != "item" || entries[0].HasElements || new List<XAttribute>(entries[0].Attributes()).Count != 1 ||
            (string)entries[0].Attribute("type") != "string" || entries[0].Value != Origin) throw new InvalidDataException();
    }

    private static void CheckPath(string file, bool regular) {
        if (String.IsNullOrEmpty(file) || file.Length >= 260 || file.Length < 4 ||
            file[1] != ':' || file[2] != '\\' || file.IndexOf('/') >= 0 || file.Substring(2).IndexOf(':') >= 0 ||
            Path.GetFullPath(file) != file || new DriveInfo(Path.GetPathRoot(file)).DriveType != DriveType.Fixed ||
            (regular ? !File.Exists(file) : !Directory.Exists(file))) throw new InvalidDataException();
        for (string cursor = file; cursor != null; cursor = Path.GetDirectoryName(cursor))
            if ((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
    }

    private static FileStream Open(string file, long limit) {
        CheckPath(file, true);
        var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        try {
            if (stream.Length < 1 || stream.Length > limit) throw new InvalidDataException();
            Retained.Add(stream);
            return stream;
        } catch { stream.Dispose(); throw; }
    }

    private static void Pin(string file, string expected) {
        FileStream stream = Open(file, 536870912);
        byte[] bytes;
        using (var sha = SHA256.Create()) bytes = sha.ComputeHash(stream);
        stream.Position = 0;
        string actual = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        if (actual != expected) throw new InvalidDataException();
    }

    private static XElement ReadObject(string file) {
        FileStream stream = Open(file, 16384);
        var bytes = new byte[(int)stream.Length]; int offset = 0;
        while (offset < bytes.Length) {
            int count = stream.Read(bytes, offset, bytes.Length - offset);
            if (count == 0) throw new InvalidDataException();
            offset += count;
        }
        stream.Position = 0;
        // Strict UTF-8 and bounded framework JSON parsing, not source evaluation.
        var utf8 = new UTF8Encoding(false, true);
        utf8.GetString(bytes);
        var quotas = new XmlDictionaryReaderQuotas { MaxDepth = 8, MaxStringContentLength = 16384,
            MaxArrayLength = 16384, MaxBytesPerRead = 16384, MaxNameTableCharCount = 16384 };
        using (var reader = JsonReaderWriterFactory.CreateJsonReader(bytes, 0, bytes.Length, utf8, quotas, null)) {
            XElement value = XElement.Load(reader);
            if (value.Name != "root" || new List<XAttribute>(value.Attributes()).Count != 1 ||
                (string)value.Attribute("type") != "object") throw new InvalidDataException();
            return value;
        }
    }

    private static void Fields(XElement value, params string[] names) {
        var expected = new HashSet<string>(names, StringComparer.Ordinal);
        foreach (XElement entry in value.Elements())
            if (entry.Name.NamespaceName.Length != 0 || !expected.Remove(entry.Name.LocalName)) throw new InvalidDataException();
        if (expected.Count != 0) throw new InvalidDataException();
    }

    private static string Value(XElement root, string name, string type) {
        XElement element = root.Element(name);
        if (element == null || element.HasElements || new List<XAttribute>(element.Attributes()).Count != 1 ||
            (string)element.Attribute("type") != type) throw new InvalidDataException();
        return element.Value;
    }
}
