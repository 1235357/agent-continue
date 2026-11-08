# Agent Continue Device Bootstrap (Experimental)

This private, zero-dependency bootstrap acquires a pinned native provider and
official runtime-only tunnel client and prepares a device profile after one
explicit informed consent. Its private package version is 0.3.0, separate from
the browser extension's release version.
Its preparation receipts alone do not establish a connected device, protected
installation, administrator/root setup, registered browser host or npm registry
release. The separate combined Windows setup route is described below.

For Windows, start with [Windows command installation](#windows-command-installation).
The current delivery candidate is **command-only**: use the reviewed, extracted
PowerShell/CMD setup bundle with current-account or administrator scope. Node.js
and the official tunnel client still execute outside the browser. The retained
custom launcher compiler/preparer is not the installation route; see
[Retired Custom Launcher Source](#retired-custom-launcher-source).
Instructions here do not establish a public release, npm publication or a
successful installation of the final artifacts.

The intended connected product is **not a sandbox**: after informed consent it
uses the selected OS account's full file, terminal and process permissions, with
no product directory allowlist. Administrator/root access requires actually
running under that authorized OS identity. Private installation configuration
and disposable test directories prevent accidental state reuse; they do not
restrict the connected account's filesystem access. Pause and revoke remain
user controls. One clear onboarding consent can describe the whole requested
workflow; the separate internal receipts below are not extra mandatory dialogs.

Build a reviewable package directory from this repository:

```sh
node build-package.mjs --output "<absolute-new-package-directory>"
```

From that directory, `npm pack --ignore-scripts` produces a local tarball. Review
its contents and digest before installing it in a disposable user prefix. No
registry command is advertised until a separate publication actually happens.
Node.js 22.12+ and a trusted existing npm installation are prerequisites.

The current source candidate includes seventeen runtime/pin/lock files, including
`device-owner.mjs`, `device-operations.mjs`, `device-native-host.mjs`,
`device-server.mjs` and `device-ssh.mjs`. A package
closure test checks their relative imports and an actual local npm tarball test
compares installed bytes. No binding, channel secret, operation journal or device
state is packaged. Inclusion of source is not host registration or activation;
the fixed adjacent native binding and private channel are runtime artifacts,
not browser inputs or released onboarding commands. The source `setup` candidate
now creates the local-target binding beside the staged bridge from the validated
extension ID and fixed state directory, without starting an owner or performing
Chrome registration. Remote Linux setup does not create a local Chrome binding.
Successful configuration still leaves all registration/authentication/activation
and platform-grant flags false.

The locally installed `agent-continue-device` bin supports `help`, `version`,
`stage`, `acquire`, `setup`, `setup-manager`, `start-manager`, `manager-status`, `enroll-ssh`,
`install-plan`, `uninstall`, `register`, `status` and `verify`.
This is not an npm registry release.
The combined acquisition command is:

```sh
agent-continue-device acquire --install-dir "<absolute-new-directory>" --consent full-account
```

This stages Desktop Commander 0.3.1 through the existing locked npm acquisition,
then downloads the pinned OpenAI tunnel-client **runtime-only v0.0.19**, verifies
the archive/executable/SBOM SHA-256 values, and retains the licenses. Supported
asset mappings are Windows, Linux and macOS, x64/arm64. Acquisition does not run
the client. It uses the official GitHub release directly, not a developer relay.
The receipt states `status: acquired` and `configured: false, activated: false`.
It does not bind an account or activate a tunnel. To turn the browser-produced
five-field request into a configured device, use the new setup command:

```sh
agent-continue-device setup --install-dir "<absolute-new-directory>" --consent full-account --setup-request "<absolute-browser-request.json>" --tunnel-id "<complete-service-returned-tunnel-id>" --runtime-key-file "<absolute-device-local-runtime-key-file>"
```

This single command performs acquisition, prepares `INSTALL/state` and writes a
fixed official-client profile there. It references the existing key file without
reading or copying its contents. Keep the key outside the install directory,
package, selected cache and toolchain; it cannot also be the request or ZIP.
Those input-collision checks are not connected-account permission restrictions.
The request contains only format/version/target/extension identity/native-host
identity, never a command, credential, arbitrary endpoint or permission grant.
It must be the exact UTF-8/LF JSON exported by the browser producer; it is not an
authentication token. A matching local platform is required.

The final `setup-receipt.json` reports `status: configured`. It explicitly leaves
activation, authentication, browser registration, chat authorization, protected
installation and native dependency usability **unverified**. The extension ID is
preserved for later native registration; merely recording it grants nothing.
The official account/tunnel and runtime key must already exist. Provisioning,
OS elevation, first native-host installation and startup integration remain
unfinished work, not extra mandatory consent dialogs. No service, task, browser
grant or actual tunnel connection is created by `setup`.

On macOS this is profile preparation, not executable-launch acceptance. The
[official client documentation](https://github.com/openai/tunnel-client/tree/v0.0.19#readme)
supports Homebrew for production installation and warns that direct ZIP binaries
are not notarized. Do not disable or bypass Gatekeeper to activate these files.

Use `--tunnel-archive "<absolute-official-runtime-zip>"` for an already downloaded
official ZIP. Its digest must match the same platform pin. No arbitrary download
URL, mutable latest version, shell extraction or executable override is accepted.
The client deadline is cooperative and bounded to 60 seconds. Provider npm has
no automatic total-time cutoff: it waits for completion, an error or your explicit
cancellation (Ctrl+C in the setup terminal). Neither step retries automatically. Partial client
failure preserves the valid staged provider and owned partial files, without an
acquired receipt. Existing destinations are never overwritten or auto-repaired.
ZIP work runs in a short-lived Node worker thread whose termination is awaited
on success or failure; it does not install a service or restrict the connected
account. This owns the decompressor's internal resources, including cancellation.

For provider-only preparation, the existing command remains available:

```sh
agent-continue-device stage --install-dir "<absolute-new-directory>" --consent acquire-provider
```

An optional `--offline-cache "<absolute-populated-npm-cache>"` uses offline
acquisition. That cache is deliberately writable: npm may update bookkeeping or
logs. Never select device state, credentials or an existing runtime as a cache.
Do not pass secrets on the command line. The bootstrap uses an isolated npm home
and empty configs, fixed public registry sources and disabled installation hooks.
It does not run upstream hosted `remote`, activate a tunnel or clear a pause.
Trusted Node/npm and package distribution remain prerequisites, not guarantees
provided by filename checks or a self-authenticating manifest.

`stage` success is `status: staged`; `acquire` success is `status: acquired`;
`setup` success is `status: configured`; `setup-manager` success is `status: prepared`.

After a reviewed local manager installation, `agent-continue start-manager
--install-dir "<absolute-install-directory>" --consent accept-install` starts the
fixed installed owner without a console and confirms authenticated local IPC.
By default it preserves pause, grants no chat access and does not configure a
tunnel. Optional `--connect true` is a **one-time installer reconnect** of an
already configured runtime. Before dispatch it exclusively creates and flushes
`state/installer-reconnect.json`. That receipt contains the operation UUID and
extension identity, not credentials. If the response is lost, the CLI and
Windows installer return nonzero with `manager_start_unconfirmed`,
`operationId` and `operationStatus` when the ID is known.

Query the same installation with
`agent-continue manager-status --install-dir "<absolute-install-directory>"`
or `./install.ps1 -DeviceAction installer-status -InstallDir <root>` from the
matching extracted Windows bundle. PowerShell can reuse the verified portable
Node without downloading anything. This queries the authenticated existing
owner with the saved ID; it does not launch one or issue a reconnect. Its `ok: true` means the owner
answered, not that the connection is ready. Read `operationStatus`, `connection`
and `paused` separately. `unobserved` is not proof of non-execution, and
`settled` is not itself success. Repeating `start-manager --connect true`
queries that same ID; it reports `connected: true` only with a settled operation
and an observed ready, unpaused connection. It does not undo a later pause or
replay even an unobserved operation. For an intentional later reconnect, use
the Devices control, not the installer. Keep the receipt, including an invalid
or interrupted one, for diagnosis rather than deleting it to force a retry.
`--connect false` keeps the normal startup/observation path.

Existing invalid/unreachable channel metadata returns `manager_start_unconfirmed`;
it is retained for diagnosis, not deleted or replaced automatically. Success means
the manager answered, not that ChatGPT/Dot tools work. Windows command-only
installation with tunnel inputs invokes it without Chrome registration.

Windows failure recovery: a repeated apply to an existing destination refuses
with `destination_exists` before Node provisioning. Do not delete or reinstall
over a partial root; use `install.ps1 -Verify` (and the original `-InstallDir` if
custom) for read-only checks. Known bootstrap error codes cross the wrapper
without raw exception text. `manager_start_unconfirmed` does not prove the owner
stopped, and wrapper timeouts remain `local_install_unconfirmed`.
`install.ps1 -Uninstall` is still a dry-run plan, not cleanup: its receipt
distinguishes directory presence from complete installation. Unknown registration
and uninspected autostart keep their review steps pending; they are not observed
as absent. A failed status invocation refuses the plan with
`uninstall_inspection_failed`, preserving the original root.
These receipts describe different
completed preparation steps, never successful authentication or a connected
device. Failed/interrupted targets retain intermediate receipts and partial
files, without a final setup success receipt, and cannot be automatically reused
or repaired. An unconfirmed
child exit is reported explicitly; it is not evidence that all effects stopped.

Desktop Commander 0.3.1 remains an upstream MIT-licensed dependency acquired by
npm, with its own licenses. OpenAI tunnel-client is Apache-2.0 licensed; its
LICENSE, NOTICE, third-party licenses and SPDX inventory remain with the client.
Pins trust the official HTTPS distribution, not independent signature checking.
Neither provider credentials nor user state are packaged. A successful receipt
commit wins over a subsequent cancellation or temporary-link cleanup error.

## Legacy Current-User Manual Uninstall (EXPERIMENTAL, Untested)

This section concerns inspection/removal of an existing legacy custom-launcher
installation. Its EXE/manifest layout is not a prerequisite or installation
guide for the current command-only modes. It does not describe removal of the
separate protected administrator runtime or the browser-managed CMD host.

There is **no implemented automatic uninstaller** for this candidate.
`install.ps1 -Uninstall` and the bin's `uninstall` command return dry-run plans;
they do not stop processes, unregister the host, remove startup entries or delete
the installation. `--keep-data true` is only a planning flag, not an implemented
backup or preservation operation. A plan's `satisfied` step or `owned` field is
not a substitute for the checks below. The PowerShell wrapper reports
`inspectionComplete: false` and does not inspect autostart. Use the already
extracted local release or source bundle for this inspection. A standalone
`install.ps1 -Uninstall` without adjacent local `bin.mjs` now returns
`uninstall_inspection_unavailable` before invoking Node; it never downloads a
payload or provisions Node for this check. Mixed uninstall/verify/mutation flags
are rejected. A complete local bundle still needs a supported existing Node.
When a checksum list is present it must cover the exact adjacent `bin.mjs`;
equivalent normal Windows path spellings do not replace checking its digest.
The wrapper validates the returned dry-run plan's schema and target before
reporting success; missing/invalid replies remain an inspection failure.

The following is a manual procedure for a user who has actually installed the
Windows candidate, not a claim of tested teardown or signing/distribution
approval. Read the whole sequence before making changes. If any ownership,
in-flight operation or process-exit check is uncertain, retain the installation
and its diagnostic state; do not force deletion or reinstall over it.

1. **Identify the exact installation without running it.** Work as the same
   Windows user who installed it. Recover the absolute `-InstallDir` from your
   installation record; the default is `%LOCALAPPDATA%\AgentContinue`, but that
   default or a directory name alone does not establish ownership. In File
   Explorer, verify the actual location and its parent directories, rejecting
   junctions, symbolic links or other unexpected reparse points. Inspect these
   existing files as text, without launching the EXE or importing its modules:

   | File under the verified install root | Required ownership correspondence |
   | --- | --- |
   | `native-host.json` | `name` is `com.agentcontinue.device_control`, `type` is `stdio`, `path` is this root's `native-launcher.exe`, and the sole `allowed_origins` entry is `chrome-extension://<your-actual-extension-id>/`. |
   | `app\device-native-binding.json` | `extensionId` matches that origin and your installed candidate extension; `stateRoot` is this root's `state` directory. |
   | `payload-manifest.json` and any `manager-receipt.json` / `setup-receipt.json` | Correspond to the package and setup you actually used; these records alone do not prove authenticity, process exit or registry ownership. |

   Record the real extension ID from its browser extension details, not a fixture
   ID. Missing or inconsistent records can indicate a partial installation, not
   an empty or disposable directory. Stop for review rather than manufacturing
   replacement manifests or deleting a partial root to retry installation.

2. **Settle work, pause access, then revoke grants if desired.** Stop issuing
   new tool calls and let existing file, shell and research operations finish or
   cancel them through their own controls. In the matching extension's Devices
   page select **This device**, not an enrolled remote target. Use **Disconnect
   and pause**, then **Check status** to reconcile that operation's ID/action.
   Require a confirmed pause and disconnection, not merely a `settled` receipt:
   `settled` does not mean success, and `not-executed` means the requested action
   was not performed. `in-progress`, `unknown-running`, `unknown`, timeouts or an
   unreachable bridge do not prove shutdown; do not clear pending records or
   replay an uncertain action. Pausing requests a stop of the controller's own
   runtime, not of arbitrary tool-spawned work or the persistent manager itself.
   You can separately revoke the relevant ChatGPT/Dot tool or connector grant
   through that platform's controls. Revocation is not local process teardown;
   neither pause nor local file removal proves that platform grants were revoked.

3. **Prevent relaunch and confirm process exit.** After settling work and
   observing pause, save browser work and close the Devices page. You may disable
   the matching extension through the browser's Manage extensions UI, then quit
   that browser normally. Closing the browser does not necessarily exit the
   separately started owner. The reviewed installer does not execute the login
   task described by the install plan; do not assume `AgentContinueTunnel`
   exists or belongs to this root. If you separately configured startup, inspect
   Task Scheduler's task properties or Windows Startup apps and disable only an
   entry whose account and full action/arguments identify this exact install.
   Leave similarly named tasks, services, registry startup entries and all
   unrelated software alone.

   In Task Manager's Details view, inspect PID, user name, command line and
   executable location for the owner, native bridge and runtime. Ownership must
   match this install's full script/executable paths and account, with the
   relevant parent/child relationship, not just a `node.exe` or tunnel-client
   image name. There is no exposed graceful owner-shutdown/uninstall command.
   If a background owner remains after confirmed pause and settled work, ending
   only its individually verified PID in Task Manager is a manual forced stop,
   **not** the source's graceful `owner.close()` path; cleanup is untested and
   must not be assumed. Recheck the separately identified bridge/runtime and any
   tool-created work for exit. Do not use broad `taskkill`, kill all Node
   processes, kill an unverified process tree, delete channel/lease files to
   simulate shutdown, or interrupt VPN, MCP, IDE or research processes. If exit
   cannot be confirmed, stop here and retain the files and registration.

4. **Preserve data before removing anything.** Once work and processes are
   quiescent, use File Explorer to back up wanted data outside the install root,
   including `state` (especially `state\work` and `state\home`), configuration
   and diagnostic receipts. Treat state/backups as private: they may contain
   channel secrets, local paths or tool output; do not attach them to a public
   signing request or issue. Keep externally supplied runtime-key files, SSH
   keys/agent configuration, known-hosts files, user projects and existing
   backups. Setup references the external runtime key; it does not own that file.
   Do not remove `%LOCALAPPDATA%\AgentContinueToolchain`, system/global Node,
   npm prefixes/caches, source checkouts or downloaded archives as part of
   deleting this install root. Removing a local SSH manager does not uninstall
   or pause an independently running remote device.

5. **Recheck current-user registration before any manual removal.** The
   installer's registration target is the default `REG_SZ` value at
   `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control`.
   Inspect the relevant 32-bit and 64-bit views independently. These optional
   commands only query the default value; they do not execute project code:

   ```powershell
   reg.exe query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:32
   reg.exe query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:64
   ```

   Compare each observed value with the exact absolute path of the manifest
   verified in step 1, and with your registration record's hive/view. Query
   errors, access failures or unsupported views are not proof of absence; one
   view's result says nothing about the other. Do not change a value pointing
   elsewhere; if the exact default value is already absent, leave that view
   unchanged. Only after all prior checks, in Registry Editor and the exact
   verified current-user view, recheck the path/type and remove only that matching
   default value. Leave the parent `NativeMessagingHosts` key, other values/hosts,
   other users and all `HKLM` registrations untouched. If the view or ownership
   cannot be established, make no registry change and retain the root for review.
   The registry adapter's removal method is used for registration rollback; it
   is not an implemented uninstall interface or a guarantee of manual teardown.

6. **Remove only the verified, inactive install root.** Recheck that no enabled
   owned startup entry or native registration still references it, that its location
   has not changed, that all candidate processes/work have exited, and that the
   private backup contains the data you intend to keep. Only then use File
   Explorer to delete that exact directory, never its parent or an external
   linked target. If Windows reports files in use or requires unexpected
   elevation, cancel rather than forcing deletion or broadening permissions.
   Browser-extension removal is separate and optional; it can affect extension
   settings, and it does not uninstall native files or revoke platform grants.

**Evidence limits:** this sequence was checked against the local
[installer](install.ps1), [bin](bin.mjs), [uninstall planner](install-plan.mjs),
[registration status](registration-status.mjs),
[registration writer](registration-writer.mjs) and [registry adapter](registry-win.mjs),
plus the repository's [device owner](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/device-owner.mjs),
[operation receipts](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/device-operations.mjs) and
[lifecycle controller](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/lifecycle.mjs). No project scripts,
builds, runtime tests, network requests, live registration queries, installed
Windows teardown, registry/task deletion, process termination or post-removal
browser check were performed for this documentation change. It does not establish a
released uninstaller, successful removal, security clearance or OSS signing
acceptance. Record any future manual removal and its unresolved checks separately
from source review or fixture results.

## Key-free local manager source candidate

### Windows command installation

Use the verified, extracted command-only setup bundle, not the retired custom
launcher preparation/registration route. Select the account scope in Setup and
retain its copied extension ID and any setup ID; copying a command does not run
it. The combined bundle must include its matching administrator installer,
stager and verified administrator archive before administrator setup is usable.
It is not interchangeable with a current-account source-only kit.

For administrator scope, the reviewed bundle's guided entry is:

```powershell
.\install.ps1 -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId '<actual extension ID>'
```

Use the complete command copied by Setup when it also supplies a browser setup
ID. Administrator setup separately requests Windows UAC and installs its
protected runtime/host/task; it finishes paused. Installation is not a chat
grant. A consented follow-up connection from the initiating Setup page is a
separate operation and may need another approval. Do not add the retired
`-PrepareNative` or `-RegisterNative` flags to these commands.

For standalone current-account scope, the default does not install a project EXE, register Chrome Native Messaging,
enable autostart, or elevate. Export the Windows setup JSON in the extension,
extract the reviewed source bundle, and select one entry. Use the actual paths
and an OpenAI tunnel ID; the key file stays on the machine.

```powershell
node .\bin.mjs install-local --consent accept-install --install-dir "$env:LOCALAPPDATA\AgentContinue" --setup-request "$HOME\Downloads\agent-continue-setup-request.json" --tunnel-id "YOUR_TUNNEL_ID" --runtime-key-file "C:\path\to\runtime-key.txt"
```

`install.cmd install-local ...` passes the same CLI flags to an existing Node;
use CMD path syntax. The root npm CLI runs that same Node code directly. Use an exact
reviewed local tarball until the package is actually published to npm.

```powershell
.\install.ps1 -InstallLocal -Consent accept-install -SetupRequest "$HOME\Downloads\agent-continue-setup-request.json" -TunnelId "YOUR_TUNNEL_ID" -RuntimeKeyFile "C:\path\to\runtime-key.txt"
```

Existing Node 22.13+ is preferred. The guided PowerShell and CMD entries use
the same consented PowerShell installer and can fall back to the pinned
portable Node ZIP. The installer checks the archive and
runtime, does not run an MSI/EXE installer, and leaves global PATH untouched.
The verified upstream tunnel client is a portable executable dependency, not
an Agent Continue installer. Node's `--tunnel-archive` accepts the matching
reviewed official archive instead of downloading it.

The Windows setup panel can copy either guided command with the actual
extension ID and no connection inputs. Run it from the verified, extracted
bundle in an interactive Windows PowerShell or PowerShell 7 console:

```powershell
.\install.ps1 -InstallLocal -Consent accept-install -PromptForConnection -ExtensionId '<actual extension ID>'
```

Or use an interactive Command Prompt, even when Node is not yet installed:

```cmd
install.cmd guided EXTENSION_ID
```

Use the ID included in the copied command. The CMD entry does not elevate,
change execution policy, or forward extra arguments to PowerShell.

Use the ZIP from a specific project release that lists both the archive and
its SHA-256 digest. In PowerShell, run
`Get-FileHash -Algorithm SHA256 -LiteralPath .\agent-continue-setup.zip` from
the download directory and compare it with the digest for that exact release
before extracting. Neither command downloads or executes an installer script
from a mutable latest-release URL. If [PowerShell execution policy](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)
blocks a downloaded script, stop and verify the source and digest; on a managed
machine, use the administrator-approved distribution. The installer does not
change policy or remove Internet-origin markers.

Check that the displayed extension ID matches Setup. Enter the official tunnel ID
and the absolute local runtime-key file path, never the secret itself. The
key path prompt is masked. Guided setup needs no JSON export; the advanced commands
still take the exported request. The terminal discloses automatic portable Node
provisioning before asking for consent. Type `CONNECT` to proceed; an empty
answer cancels before downloads or setup writes.
PowerShell checks the ID before provisioning Node. Node constructs the same
validated request in memory before writing install state, using only that ID.
The path is used locally and by the official client; it is not copied from or
saved by the extension. The guided command never falls back to stage-only
setup on a blank or rejected answer. Unattended use retains explicit flags.

After a confirmed connection, the same terminal offers optional `PAIR`.
Enter `PAIR` to open the temporary browser controls, or leave it blank to keep
the connection without opening a local listener. Use the displayed loopback
address and code in the extension's Windows setup panel. Browser pairing is not
ChatGPT authorization and does not need the runtime key. If pairing fails,
consult the already printed install receipt instead of repeating the install.

With both tunnel arguments, the command configures the direct official tunnel
and requests one connection. With neither, it only stages a key-free manager
and does not launch an owner. Use a new destination; no implicit overwrite,
recovery, or duplicate connection is attempted. A ready result does not prove
that either ChatGPT surface granted or successfully called the tools.

Use `node .\bin.mjs manager-control --install-dir <root> --action status` or
`.\install.ps1 -DeviceAction status`. Pass the original request ID as `--id`
or `-OperationId` for an unconfirmed command. Lifecycle actions
`disconnect-and-pause` and `reconnect` require `accept-control`. After the owner
exits, `-DeviceAction start -Consent accept-control` starts the owner without
clearing a saved manual pause. The owner may resume previously unpaused
intent. These commands do not download Node or repair existing state.
No new always-running service is created.

On Windows, if the PATH Node no longer matches the saved tunnel profile,
default start can use the verified portable cache from installation. An
explicit `-NodePath` does not fall back. A missing cache or a profile that
does not verify with either runtime is not repaired automatically. A manual
pause survives restarting the owner; reconnect explicitly when ready.

Windows can open a temporary local control page from the same extracted bundle:

```powershell
.\install.ps1 -DeviceAction browser -Consent accept-control
```

It requires an interactive terminal and a running, verified owner; it will not
start one. Paste the single short-lived `ACPAIR1:...` line in the matching
Agent Continue extension's Windows management panel. Alternatively, open the
printed loopback URL and enter the same ticket on that page. Do not record or
share the terminal contents. A hidden, isolated loopback frame relays signed
requests; it does not receive the ticket or pairing code. Only the extension
identity recorded at installation may embed it. The panel verifies signed
replies and the local session is bound to the current manager, so a replacement
manager requires pairing again. The extension clears the ticket field after
submission and does not save it to extension storage.

In the extension panel, a pending control action retains only its random
operation ID in browser session memory. Re-pair with the original device after
closing or refreshing the panel, then check that ID. An ordinary status or busy
reply does not settle the pending action. A matching terminal receipt releases
the controls; simultaneous tabs do not queue extra mutations. If the browser
restarts or the extension reloads, session memory is cleared. Use the saved ID
with `-DeviceAction status -OperationId <id>` on the original device when you
cannot recover the receipt in the panel. Do not interpret a missing receipt as
a failed action or retry it blindly. This browser-side coordination is separate
from the device's journal and does not cover the standalone loopback page.

The page offers status, pause and reconnect through the existing authenticated
owner IPC. It cannot run tools or expose the runtime key, and is not part of the
hosted MCP data path. Keep the terminal open during use. Enter, Ctrl+C or the
15-minute expiry closes this control session without dispatching a tunnel action. An
action already accepted may still finish; reconcile its request ID before
retrying a result that was not confirmed.

The release workflow now also prepares the root CLI tarball and
`NPM-SHA256SUMS.txt` as GitHub assets; it does not run `npm publish`. After a
release actually contains them, users can verify the downloaded archive and
install that exact tarball with `npm install -g <downloaded-archive.tgz>`, then
run `agent-continue install-local ...`. The extension and npm CLI have separate
version numbers; use assets from the same GitHub release rather than assuming
the numbers match. This workflow wiring is local until pushed and executed.

From the repository root, combined release preparation requires a separately
built, verified administrator archive:

```sh
python scripts/build-setup-release.py --combined --administrator-bundle <reviewed-administrator-archive.zip> --output <new-output-directory>
```

For a current-account-only development kit, explicitly use `--source-only`
instead of `--combined --administrator-bundle ...`; that kit is not combined
Windows delivery. The output includes `agent-continue-setup.zip`, `SHA256SUMS.txt`
and the matching PowerShell entry; combined delivery also includes the matched
administrator archive, installer and stager. The setup ZIP has the bootstrap
files at its root (no enclosing source directory). `python tests/setup-release-tests.py`
builds and extracts a fresh ZIP, checks every digest, executes extracted CLI
help and registration dry-run, and on Windows verifies that the extracted
installer refuses installation without consent. The release workflow runs this
check before release generation. Local passing results do not prove remote CI,
publication, native registration or authenticated device access.

The generated PowerShell entry defaults to the extension version's
`releases/download/vMAJOR.MINOR.PATCH` payload, not `latest`. Its ZIP copy
and standalone copy are identical and covered by the generated checksums.
The source checkout remains unpinned. An explicit `-PayloadBase` or
`AGENT_CONTINUE_PAYLOAD_BASE` still overrides this default for development;
that override is not evidence of an official same-version installation.
Without an explicit unverified-payload override, stamped release scripts
also refuse adjacent local payloads missing their checksum list; a source
checkout may still run in development without a release list.

### Configure a direct Linux server

On the target Linux server, use Node.js 22.13 or later and the verified,
extracted setup bundle. Select the OS account that should own the files and
run commands. Export a **Remote Linux server** setup request from the
extension. Use a separate official tunnel and runtime key for each server.
Keep the key in a file owned by that account with mode `0600`; never paste it
into a browser or pass its contents on the command line. The consent below permits
account-level filesystem, terminal and process access once a chat is
authorized, subject to the privileges of that OS account.

```sh
AC_SERVER_ROOT="$HOME/.agent-continue-server"
node /absolute/setup/bin.mjs setup-server \
  --install-dir "$AC_SERVER_ROOT" \
  --setup-request /absolute/path/agent-continue-setup-request.json \
  --tunnel-id tunnel_REPLACE_WITH_SERVER_TUNNEL_ID \
  --runtime-key-file /absolute/private/server-runtime-key.txt \
  --consent full-account
```

The destination must be new and its parent must already exist. Setup acquires the pinned provider and official
client, and writes a configured receipt. It installs no service, starts no
tunnel, and creates no Chrome bridge. It rejects local-desktop setup requests.
For an approved foreground smoke test, run the owner on the server:

```sh
node "$AC_SERVER_ROOT/app/device-server.mjs" serve --state-dir "$AC_SERVER_ROOT/state"
```

From another shell on that same server, set `AC_SERVER_ROOT` to the same
directory and request a connection explicitly:

```sh
node "$AC_SERVER_ROOT/app/device-server.mjs" request --state-dir "$AC_SERVER_ROOT/state" \
  --id "$(node -p "require('node:crypto').randomUUID()")" --action reconnect
```

Use `status` to check readiness and `disconnect-and-pause` to pause, with a
fresh ID per new operation. Keep the owner running for the foreground test.
The tool data goes from the server to the official tunnel; the browser and
Windows are not data relays. Verify chat authorization and a real tool call
separately. This candidate does not install a Linux service or SSH login hook.
Plain owner startup and noninteractive status checks cannot clear manual pause.

For optional management of an independent remote Linux owner, first export a
second five-field request matching the local Windows/macOS/Linux machine, not the
`linux-server` request used on the server. This source/private-package command
prepares a local manager without requiring a local tunnel or OpenAI runtime key:

```sh
agent-continue-device setup-manager --install-dir "<absolute-new-local-manager-directory>" --consent full-account --setup-request "<absolute-local-platform-request.json>"
```

The Windows source installer now exposes the same preparation operation. Run
from a reviewed source checkout or extracted release containing the bootstrap
payload (Node 22.13+ required):

```powershell
.\native\bootstrap\install.ps1 -ExtensionId "<actual-32-character-extension-id>" -InstallDir "<absolute-new-local-manager-directory>" -Apply -ManagerOnly -Consent accept-install -SetupRequest "<absolute-local-platform-request.json>"
```

The adjacent `install.cmd` forwards the same arguments for CMD users. Without
`-Apply` this mode is rejected; without the explicit consent it stops before
Node/payload acquisition. Do not combine it with `-Verify`, `-Uninstall`,
`-TunnelId` or `-RuntimeKeyFile`. It prepares files only: it does not build
a custom launcher, register Chrome's native host, or connect a tunnel. The request
must contain the candidate extension's actual identity, not a sample ID.

The old custom-launcher preparation and registration route is **retired and not
supported for current installation**. The retained `-PrepareNative`,
`-RegisterNative` and legacy `register --execute` interfaces refer to that old
EXE-based host. Normal command-only package generation omits its release assets;
retained helper/compatibility code does not establish an available signed
launcher or supported installer. Missing legacy assets can return
`native_release_unavailable`; do not respond by compiling a replacement,
bypassing verification or enabling legacy acceptance flags. Use the
[Windows command installation](#windows-command-installation) or
[browser-managed current-account mode](#browser-managed-windows-candidate)
instead, with its own scope and approvals.

Local regression coverage includes the actual root npm tarball, offline npm
installation of that tarball on Windows, and real PowerShell subprocesses for
invalid manager options and failed verification. These are not browser-native
handshake or authenticated ChatGPT/Dot acceptance results. The package has not
been published to npm merely because these tests pass.

It reuses one verified, pinned provider acquisition and the same optional
`--offline-cache`, then prepares `INSTALL/state` and the fixed adjacent
`INSTALL/app/device-native-binding.json`. The actual installed binding reader
checks the state and extension identity. No client is downloaded, no local tunnel
profile/key is consumed, and no provider tool, owner, SSH or browser is started.
It refuses runtime-key/tunnel-ID/archive inputs and headless-server requests.
The request is metadata, not a permission token. Consent applies to the intended
full-account manager; its state-directory protection is not a tool allowlist.

The final create-only `manager-receipt.json` reports `status: prepared` and
`localTunnelConfigured: false`. Authentication, activation, native registration,
chat authorization, protected installation and native dependency usability remain
false/unverified. A later authenticated, user-initiated check is still required.
No OS registration, launcher/service/login hook, elevation or platform grant is
performed. Existing/partial destinations are not automatically reused or repaired.
A changed request/binding/state or failed precommit receipt check refuses success;
a successful hard-link commit wins over later cancellation or temporary cleanup.
Actual local tarball acceptance exercises the installed `setup-manager` and
`enroll-ssh` commands with pinned provider bytes copied by a disposable test-only
npm fixture. This does not prove a production registry acquisition, real SSH,
registered Chrome, protected Windows installation or official tool authorization.

## Trusted local SSH enrollment source candidate

The extension selects a remote device with an opaque target ID; it does not
accept a hostname, credential or SSH command. The trusted local `enroll-ssh`
command creates that target record and returns a fixed Devices selection link:

```sh
agent-continue-device enroll-ssh --install-dir "<existing-local-manager-install>" --consent full-account --ssh-executable "<absolute-trusted-openssh>" --host "<verified-server-host>" --port 22 --user "<server-os-account>" --remote-node "<absolute-server-node>" --remote-install-dir "<server-install-directory>" --known-hosts "<private-local-verified-known-hosts-file>" --known-hosts-sha256 "<independently-checked-file-sha256>"
```

Run this only from a reviewed local package after the local manager is staged
and its private state and exact-origin native binding are prepared. Native
registration and first-install wrappers remain separate, unfinished gates;
`enroll-ssh` does not create them. A manager for remote-only use does not need
a local tunnel profile or local OpenAI runtime key. Use the source/private-package
`setup-manager` above to prepare it. Existing `setup` still prepares a local
device profile; a protected first-install/native-registration wrapper is not yet
provided. The server must separately have its own configured independent owner.

The first-install preview text is produced by `registration-render.mjs` from an
already-approved dry-run result. It prints the exact key path, `REG_SZ` value,
hive, view and `reg.exe` arguments, and refuses any other input shape. Printing
it writes nothing: no `reg add`, no registry contact, no host start and no
registration claim. Real registration remains a separate, unfinished gate.

The local binding supplies the extension ID; the command cannot override it.
Remote entry/state are fixed to `REMOTE_INSTALL/app/device-server.mjs` and
`REMOTE_INSTALL/state`. Independently verify the server's host-key identity and
prepare its private known-hosts file before providing the file's digest. Merely
hashing an unverified `ssh-keyscan` result does not authenticate a host. Keep SSH
private keys in the OS agent; no password, private-key path or key value is an
input to this command. Enrollment does not contact SSH or export an agent.

The registry is create-only at `INSTALL/app/device-ssh-targets.json`. Existing
records are never overwritten or automatically merged/repaired. Changed target
host/account/paths/host-key digest produce a different target ID. Errors may leave
private diagnostic pending files or an unusable partial published record; they
are not evidence of rollback or permission for an automatic retry. This is
ordinary-user validation, not protected Windows ACL verification.

A successful `status: enrolled` receipt returns only the opaque target/link and
false authentication, owner-reachability, native-registration, chat-authorization
and activation flags. Open that link manually in the matching installed
extension, then request browser permission and check status explicitly. The link
selects a target; it grants no authority. Optional lifecycle management uses the
installed local bridge plus one authenticated on-demand SSH request. Server MCP
tool data still goes directly to the official OpenAI service, not through the
browser, Windows or a developer relay. Enrollment source/package fixtures are
not real SSH, registered Chrome or a connected ChatGPT/Dot tool acceptance. The
supplemental Windows fresh-import side-effect probe was blocked by Defender as
`Trojan:Win32/SuspExec.SE` on its exact owned Node command line. Its default test
is explicitly skipped; keep `AGENT_CONTINUE_IMPORT_EFFECT_PROBE` unset pending
classification. Do not retry/re-encode it to evade detection or weaken security
settings. This is a separate finding from the launcher EXE below; neither is a
proven false positive. The blocked probe does not certify effect-free import.

## Browser-managed Windows candidate

For a fresh, verified and extracted source candidate, opt in explicitly:

```powershell
.\install.ps1 -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId EXTENSION_ID
```

`install.cmd guided-browser EXTENSION_ID` is equivalent. Type `REGISTER`
when prompted. This is separate from the existing `guided` mode. The installer
configures the tunnel and registers the Chrome wake host for the current
user and exactly that extension ID. It leaves the device paused, creates
no scheduled task or service, and does not open Chrome or start a detached
manager. It uses a CMD wrapper and Node, not an AgentContinue EXE installer.

On this source candidate, open **Devices > Browser-managed Windows** and
allow optional Native Messaging. Start a new browser session if Chrome had
already attempted startup before registration. Use **Check status**,
then **Reconnect** on that same page for the initial connection. You can
also issue the explicit local control command after Chrome starts the owner:

```powershell
.\install.ps1 -DeviceAction reconnect -Consent accept-control
```

Use the same install directory and Node executable as setup. Do not run
`-DeviceAction start` alongside this mode. To block future browser wakes,
revoke optional native messaging permission in Chrome. Disconnect and
pause remains a separate local operation and preserves the pause on disk.
This candidate does not yet have a browser-wake unregistration command.
Registration alone does not prove Chrome launch, upstream authentication,
or ChatGPT/Dot authorization. It has not been shipped in a release.

## Retired Custom Launcher Source

The repository retains `Build-NativeLauncher.ps1`, `NativeLauncher.cs` and the
related release preparer as legacy source. This is **not a supported installation
route**. Normal command-only package generation includes neither a
`native-launcher.exe` nor the compiler source files. A retained preparation helper
or historical test does not make the old host a current release dependency.
Do not compile, install, prepare or register that custom launcher for current
setup; use the PowerShell/CMD entries above. The current browser-managed mode
uses a CMD wrapper and Node, while administrator setup has its own protected
runtime/host/task and separate approvals.

**Historical execution/distribution acceptance was blocked.** During temporary-fixture tests,
Windows Defender recorded `Program:Win32/Contebrew.A!ml` and quarantined one
generated executable. Some earlier fixture launches passed; that does not prove
this detection is a false positive or that the candidate is safe to distribute.
Do not restore quarantine, add exclusions, disable protection or alter the source
merely to evade detection. Obtain a legitimate classification/release remediation
before further executable acceptance. Compiled launcher tests are explicit opt-in
(`AGENT_CONTINUE_WINDOWS_LAUNCHER=1`); leave this unset while the blocker remains.
Routine tests still verify source/package closure without executing these EXEs.

Tests: `npm test` runs synthetic and packed-bin checks. Set
`AGENT_CONTINUE_REAL_CACHE` to an explicitly writable populated npm cache for real
provider/MCP fixture acceptance; additionally set `AGENT_CONTINUE_OFFICIAL_CLIENT=1`
for actual installed-bin setup with official online acquisition, or
`AGENT_CONTINUE_OFFICIAL_ARCHIVE` for its local ZIP. That test uses the real
browser request producer, an opaque fake key, the generated profile and a
harmless owned-file MCP roundtrip, without account authentication or activation.
Without those options the corresponding real acceptance is skipped.
Tests do not imply privileged installation or a connected device.

Developer: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu).
Source: [GitHub](https://github.com/1235357/agent-continue).
Report bugs or suggest improvements: [GitHub Issues](https://github.com/1235357/agent-continue/issues/new/choose).
Attach only diagnostics you have reviewed; never attach keys, native state or raw tool transcripts.
Author: [LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/).
