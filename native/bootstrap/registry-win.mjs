// Windows registry adapter. The existing signed-host path and the create-only
// browser wake path share typed reads, but not the legacy overwrite/delete API.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const viewFlag = plan => (plan.view === '32' ? '/reg:32' : '/reg:64');

function call(args) {
  return spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
}

const registryInterop = `
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
public static class AgentContinueCreateKey {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int RegCreateKeyEx(IntPtr root, string key, int reserved, string cls,
    int options, int access, IntPtr security, out SafeRegistryHandle handle, out int disposition);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  private static extern int RegQueryValueEx(SafeRegistryHandle key, string name, IntPtr reserved,
    out uint type, [Out] byte[] data, ref uint length);
  public static string ReadLiteral(SafeRegistryHandle key) {
    byte[] data = new byte[16384];
    uint type, length = (uint)data.Length;
    int code = RegQueryValueEx(key, "", IntPtr.Zero, out type, data, ref length);
    if (code == 2) return null;
    if (code != 0) throw new InvalidOperationException();
    if (type != 1) return null;
    if (length < 2 || length > data.Length || length % 2 != 0 ||
        data[length - 2] != 0 || data[length - 1] != 0) throw new InvalidOperationException();
    string value = new UnicodeEncoding(false, false, true).GetString(data, 0, (int)length - 2);
    if (value.IndexOf((char)0) >= 0) throw new InvalidOperationException();
    return value;
  }
  public static bool Write(string name, string value, int view) {
    SafeRegistryHandle handle;
    int disposition;
    int code = RegCreateKeyEx(new IntPtr(unchecked((int)0x80000001)), name, 0, null, 0,
      (view == 32 ? 0x0200 : 0x0100) | 3, IntPtr.Zero, out handle, out disposition);
    if (code != 0) throw new InvalidOperationException();
    using (handle) {
      if (disposition != 1) return false;
      using (var key = RegistryKey.FromHandle(handle, view == 32 ? RegistryView.Registry32 : RegistryView.Registry64)) {
        if (Array.IndexOf(key.GetValueNames(), "") >= 0) return false;
        key.SetValue("", value, RegistryValueKind.String);
        key.Flush();
      }
      return true;
    }
  }
}
`;
const loadInterop = "Add-Type -TypeDefinition @'\n" + registryInterop + "\n'@\n";

export function createWinRegistry(queryProcess = spawnSync) {
  function run(script, code) {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = queryProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536 });
    if (result.error || result.signal || result.status !== 0) throw new Error(code);
    try { return JSON.parse(result.stdout); }
    catch { throw new Error(code); }
  }
  function read(plan, inspect) {
    const target = /^(HKCU|HKLM)\\([A-Za-z0-9_.\\]+)$/.exec(plan.keyPath);
    if (!target || !['32', '64'].includes(plan.view)) throw new Error('registry_query_failed');
    const hive = target[1] === 'HKCU' ? 'CurrentUser' : 'LocalMachine';
    const script = "$ErrorActionPreference='Stop';$base=$null;$key=$null;try{\n" +
      (inspect ? loadInterop : '') +
      '$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::' + hive +
      ',[Microsoft.Win32.RegistryView]::Registry' + plan.view + ');' +
      "$key=$base.OpenSubKey('" + target[2] + "',$false);" +
      (inspect ?
        "if($null -eq $key){@{missing=$true}|ConvertTo-Json -Compress}else{" +
        "$v=[AgentContinueCreateKey]::ReadLiteral($key.Handle);if($null -eq $v){@{empty=$true}|ConvertTo-Json -Compress}" +
        "else{@{value=$v}|ConvertTo-Json -Compress}}" :
        "if($null -eq $key -or -not ($key.GetValueNames() -contains '')){@{missing=$true}|ConvertTo-Json -Compress}else{" +
        "if($key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String){throw 'kind'};" +
        "@{value=$key.GetValue('')}|ConvertTo-Json -Compress}") +
      "}catch{exit 1}finally{if($key){$key.Dispose()};if($base){$base.Dispose()}}";
    const value = run(script, 'registry_query_failed');
    if (value && Object.keys(value).length === 1 && value.missing === true) return { present: false };
    if (inspect && value && Object.keys(value).length === 1 && value.empty === true) return { present: true, value: null };
    if (value && Object.keys(value).length === 1 && typeof value.value === 'string') return { present: true, value: value.value };
    throw new Error('registry_query_failed');
  }
  return Object.freeze({
    get(plan) { return read(plan, false).value ?? null; },
    inspect(plan) { return read(plan, true); },
    createOnly(plan) {
      const target = /^HKCU\\(Software\\[A-Za-z0-9_.\\]+)$/.exec(plan.keyPath);
      if (!target || !['32', '64'].includes(plan.view) || typeof plan.regSzValue !== 'string' ||
          !path.win32.isAbsolute(plan.regSzValue) || /[\x00-\x1f]/.test(plan.regSzValue) || plan.regSzValue.length > 4096) {
        throw new Error('registry_create_failed');
      }
      const literal = "'" + plan.regSzValue.replaceAll("'", "''") + "'";
      const script = "$ErrorActionPreference='Stop'\ntry {\n" + loadInterop +
        " @{written=[AgentContinueCreateKey]::Write('" + target[1] + "'," + literal + ',' + plan.view +
        ')}|ConvertTo-Json -Compress\n} catch { exit 1 }';
      const result = run(script, 'registry_create_failed');
      if (!result || Object.keys(result).length !== 1 || typeof result.written !== 'boolean') throw new Error('registry_create_failed');
      return result.written;
    },
    set(plan) {
      const result = call(['add', plan.keyPath, '/ve', '/t', 'REG_SZ', '/d', plan.regSzValue, '/f', viewFlag(plan)]);
      if (result.status !== 0) throw new Error('registry_set_failed');
    },
    remove(plan) {
      const result = call(['delete', plan.keyPath, '/ve', '/f', viewFlag(plan)]);
      if (result.status !== 0) throw new Error('registry_remove_failed');
    },
  });
}
