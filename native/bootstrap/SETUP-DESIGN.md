# Browser Request To Configured Device

## Outcome

Extend the private bootstrap to0.3.0 with one consented setup command. It consumes
the existing browser-produced five-field request, acquires both components,
prepares full-account runtime state and generates the official profile. This
closes the request-to-configuration handoff, not first native-host installation,
OS elevation, platform account provisioning, activation or per-chat tool grants.
Keep the complete original goal active. No product sandbox or directory allowlist
is introduced. Internal checkpoints do not require repeated user consent.

No production credentials, services, startup policies, registry entries, VPN,
existing device connections or research tasks are inputs to implementation/tests.
The official runtime connects directly to OpenAI; neither the extension nor a
developer endpoint forwards tool calls. macOS profile preparation does not prove
Gatekeeper execution approval. Official documentation supports Homebrew for its
production executable; do not bypass Gatekeeper or advertise a ZIP as notarized.

## Command And APIs

Preserve stage/acquire. Add:
`setup --install-dir ABS --consent full-account --setup-request ABS
--tunnel-id ID --runtime-key-file ABS [--offline-cache ABS] [--tunnel-archive ABS]`.
Help lists setup, version0.3.0. CLI syntax rejects unknown/duplicate/missing flags
before effects; API consent is checked before filesystem reads. No key value is
accepted on argv or from the browser. Only a device-local key-file reference is
accepted and its contents are never read by setup.

The original0.3.0 packed closure had21files total/12runtime payload files. The
November3 IPC source candidate adds `device-native-host.mjs`, `device-owner.mjs`
and `device-operations.mjs`:24files total/15runtime payload files. Generated local
bindings, channel secrets, journals and device state are never part of that
published source closure. API exports:
`validateSetupRequest(value, platform=process.platform)` (pure),
`readSetupRequest(file)` (bounded read),
`setupDevice(options, trusted={})` (async).
Options only installDir,consent,setupRequestFile,tunnelId,runtimeKeyFile,
offlineCache,offlineArchive,signal. Trusted in-process test composition only
packageRoot,npmCli,acquisitionTimeoutMs,fetchImpl; never browser/CLI overrides.
Reuse existing stageRuntime, acquireClient and their budgets/owned-process rules.

Export existing bootstrap localPath/overlap helpers under resolveLocalPath and
pathsOverlap, rather than duplicate physical-ancestor containment. Setup adds
strict Windows segment checks (no ADS/wildcards/trailing dot/space). Its bounded
reader opens one retained descriptor, verifies initial/fstat dev/ino/regular/
single-link/size, reads from that descriptor, validates unchanged size/mtime after
read and closes in finally. Reject symlink ancestors. This is finite ordinary-
user validation, not a protected privileged no-race filesystem attestation.
Within setup, compare the opened request/client descriptor against the saved
excluded key identity before reading any bytes, including replacement after the
earlier metadata preflight. npm discovery must reject redirected or nonregular
package metadata before reading it; root containment alone is insufficient.

readSetupRequest requires UTF-8 without BOM,1..4096bytes, JSON with exactly ordered
fields {format:"agent-continue-device-setup",version:1,target,extensionId,nativeHost},
canonical JSON.stringify(value,null,2)+LF bytes. Reject duplicate JSON keys via
canonical byte equality. target windows/macos/linux/linux-server; extensionId
exact32[a-p]; nativeHost com.agentcontinue.device_control for local targets and
null for linux-server. No command/path/key/approval/scope/account field allowed.
It returns exactly {request,sha256}; request is frozen. Pure validateSetupRequest
requires the same closed values and maps Windows->windows, Darwin->macos,
Linux->linux or linux-server; mismatch/unsupported platform rejects. The reader
checks schema without using the host platform; setup then checks actual platform.
Adopt the existing unchanged setup-model.js producer and its pure tests into main,
not the unrelated dirty UI/manifest/packaging changes. It remains out of released
extension packages until the separate UI release. Native tests compare actual
producer bytes with consumer acceptance; pure producer contains no native code.

## Preflight And Transitions

1. Require consent full-account; validate closed options/trusted/signal, complete
   tunnel ID /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/. Before any content read,
   resolve metadata-only paths for key, request, archive, cache, destination,
   package root, current Node installation and every selected npm candidate root.
2. Key metadata is
   regular/single-link/local1..65536bytes with positive inode. It must lie outside
   installDir and packageRoot (physical containment included). POSIX key owned by
   currentuid and mode&077=0. Windows ACL protection remains unverified, never
   advertised as administrator/protected. Reject key/request and key/archive
   identity or path collisions before reading request bytes. Exclude key from
   package, destination, selected cache, Node installation and selected npm roots;
   all checks use physical ancestry/identity, not only textual comparisons.
   Recheck key metadata before request reads. Then read request and validate actual
   platform; validateClientInput supplies destination/pin/archive checks. No key
   content is read on these refusal paths. Reject existing destinations before
   pin/request content reads. These are input-collision rules, not runtime scopes.
   Existing destination always rejects destination_exists, never resume/repair.
3. Stage provider once, then acquire client once using same signal/one consent.
   Pass cache only to provider, ZIP/fetch only to client. Recheck request bytes/hash
   and key metadata before configuration; any change fails without config success.
4. Revalidate provider stage. Import only verified own copied runtime/profile
   modules. Create fixed INSTALL/state using prepareState(full-account); verify its
   exact successful return {prepared:true,activated:false,protectedInstallationVerified:false}.
   writeTunnelProfile with provided tunnelId/keyreference and the fixed acquired
   INSTALL/client executable; verify exact return
   {configured:true,activated:false,authenticationVerified:false}. inspectTunnelProfile
   must return exactly configuredtrue/activationnot-observed/authenticationVerifiedfalse.
   No arbitrary state path/client/endpoint/command accepted.
5. Revalidate provider/client byte pins, request snapshot and key metadata again.
   After the last asynchronous verification, reinspect the state/profile before
   publication. This closes that avoidable stale-check interval, not all possible
   same-user concurrent filesystem mutations.
   Publish INSTALL/setup-receipt.json last via private pendingfile and synchronous
   create-only fs.linkSync. Abort immediately before link fails; successful link
   wins over subsequent abort or best-effort pending cleanup. No fallible work
   after commitment. Partial stage/client/state/profile remains diagnostic state,
   not a global rollback; retries never overwrite or repair it.

Final canonical UTF-8 JSON.stringify+LF receipt, property order exactly:
{format:"agent-continue-device-setup-result",version:1,status:"configured",
providerVersion:"0.3.1",tunnelRelease:"v0.0.19",target:REQUEST.target,
extensionId:REQUEST.extensionId,nativeHost:REQUEST.nativeHost,
requestSha256:RAW_HASH,configured:true,activated:false,authenticationVerified:false,
nativeRegistrationVerified:false,chatAuthorizationVerified:false,
protectedInstallationVerified:false,nativeDependenciesVerified:false}.
No key/path/tunnel ID in stdout or this receipt. Underlying private profile/binding
contains only the existing key path reference, not key bytes. CLI success
{ok:true,...receipt}, one stdoutJSONline/no stderr/exit0. Failure
{ok:false,error:CODE}, stdoutLF/no stderr/exit1. Errors are Error(CODE) without
cause/raw details. Add setup_request_invalid,setup_target_mismatch,
setup_input_invalid,setup_configuration_failed,setup_receipt_failed,
setup_cancelled; preserve known acquisition errors. Unknown errors map to
setup_configuration_failed. Invalid request/key/target precedes network/writes.

## Native Binding Integration Increment (2026-11-03)

The local-target setup success must also leave exactly one private create-only
`INSTALL/app/device-native-binding.json` beside the installed native bridge:
`{format:"agent-continue-native-binding",version:1,extensionId:REQUEST.extensionId,
stateRoot:INSTALL/state}` serialized JSON.stringify+LF. The browser request still
has only its five reviewed fields; it supplies neither a path nor a secret.
Remote Linux (`nativeHost:null`) must not gain a local Chrome binding.

Write this after successful profile preparation, before the final asynchronous
provider verification. Retain the file identity and expected bytes, revalidate
through the existing bounded/key-excluding reader after the final verification
and immediately before the setup-receipt link. Reject existing/changed/redirected
binding and unsafe POSIX ownership/mode. The saved opaque key identity must be
excluded before any new binding content read, not only by textual path.
Keep diagnostic partial files on failure; no overwrite, repair or rollback.
The final setup receipt shape and all authentication/activation/registration/
protected-install/grant flags remain unchanged and false. No owner, operation
journal, channel secret, registry entry, service or login hook is created.
This is source-only current-user preparation, not a protected installer or
universal filesystem-race guarantee.

Implementation evidence: five local binding tests first failed against the old
setup, then passed with the new create-only/write-and-recheck implementation.
They cover consumer compatibility, existing-file preservation, final asynchronous
replacement/removal, pending-receipt replacement and saved-key identity exclusion.
An additional actual configured-payload test reaches a deliberately injected
fixture owner through that payload's real native bridge without manually writing
a binding. It holds bridge stdin open and observes complete response and process
exit; this is not installed Chrome or official-runtime authorization. A Linux-only
remote-target setup test is explicitly skipped on Windows. Independent read-only
review checked helper/key exclusion, consumer schema, commit order and partial
state preservation and found no important increment defect; it did not run tests.

## Windows Native Launcher Increment — 2026-11-04

Goal: prepare a create-only Windows GUI executable and the five-field Chrome
manifest for the existing `device-native-host.mjs`; this is not OS registration
or activation. Keep the existing 15-file runtime payload unchanged. The compiler
and C# transport belong to the bootstrap package, not the long-lived MCP runtime.
The installed bridge continues to reach an explicitly started owner over private
IPC; native messages do not become arbitrary shell requests.

1. Add `native/bootstrap/native-launcher.test.mjs` first. Run it through exact
   child-process cwd (`node --test native-launcher.test.mjs`) and observe RED for
   missing `Build-NativeLauncher.ps1` / `NativeLauncher.cs`. Fixtures live only
   under `os.tmpdir()`, use no registry/service/key, and skip Windows execution
   explicitly on other platforms. Cover GUI PE/subsystem and hash readback,
   manifest exact name/path/stdio/origin, binary Chinese/NUL/newline frame transfer
   with Chrome stdin left open, exact origin and numeric optional parent argument,
   child diagnostic suppression, sanitized Node environment, bounded bytes and
   lifetime, no overwrite and invalid canonical paths. Include the actual packed
   `device-native-host.mjs` against a deliberately started fixture owner.
2. Implement `NativeLauncher.cs`: .NET Framework 4.8 GUI entrypoint, compiled
   exact Node/script/origin literals; one direct child, no shell or replay. Use
   byte streams plus checked Win32 writes, never Console text encoding. Input and
   output each cap at 4,100 bytes, child stderr at 65,536 bytes, lifetime 30s,
   post-exit drain 2s. Reject unexpected arguments before spawn; accept only
   `--parent-window=` plus 1–20 ASCII digits, not forwarded to Node. Remove Node,
   npm, UV, OpenSSL/certificate injection variables from the child environment.
3. Implement `Build-NativeLauncher.ps1`: Windows PowerShell 5.1, explicit output
   exe/manifest paths, exact extension ID, local `node.exe` and fixed host basename.
   Reject UNC/device/ADS/noncanonical/reserved/reparse paths and existing outputs.
   CodeDOM owns literal escaping. Compile hidden GUI PE, hash Node/script/source
   before and after compilation, publish via non-overwriting file operations,
   write only the exact `com.agentcontinue.device_control` manifest, and read back both.
   Emit one JSON success receipt only after all checks, with activation,
   registration and protected-install flags false. Preserve partial files on
   failure; never silently repair, elevate, write registry or start an owner.
4. Add only these two sources to `PACKAGE_FILES`, npm `files`, and the packed-file
   expectation; keep `RUNTIME_FILES` at 15. Add the new test to bootstrap `npm test`.
   Observe failing packaging checks before allowlist changes. Run complete native,
   Devices, bootstrap and pack regressions, then obtain a fresh read-only review.
5. Record exact counts, failures/skips and the source-only boundary in this design,
   existing README/handoff, AGENTS and current memory. Do not commit/publish or
   perform registration in this slice. Actual Chrome startup, protected OS install,
   Linux/macOS wrappers, account/tool grants and login recovery stay unverified.

Registration contract verified in the in-app browser against Chrome's official
native-messaging page: HKCU or HKLM `Software\\Google\\Chrome\\NativeMessagingHosts\\com.agentcontinue.device_control`, default REG_SZ = absolute manifest path;
Chrome queries 32-bit view first, then 64-bit. The future installer must select
scope explicitly and read back its actual write. This increment writes neither.

### First-install registration preview text (display only)

`native/bootstrap/registration-render.mjs` turns an already-approved dry-run
result into the first-install preview shown to the user. It accepts only the
seven-key dry-run record (`mode`, `hostName`, `hive`, `view`, `keyPath`,
`regSzValue`, `command`) and rejects missing or extra keys, wrong types, an
`executed` mode and any drift between key path, hive, view and the `reg.exe`
arguments. Example output for HKCU / 32-bit:

```text
Registration preview only - no registry write has been performed.
Host: com.agentcontinue.device_control
Hive: HKCU
View: 32-bit
Key: HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control
REG_SZ: <absolute path to native-host.json>
Command: reg.exe add HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control /ve /t REG_SZ /d <absolute path to native-host.json> /f /reg:32
```

Rendering is presentation only: nothing is executed, the registry is neither
read nor written, no host is started, and nothing is registered. Real execution
still needs two independent approvals, an explicit execute flag, read-back and
rollback, and separate user authorization.

### Launcher source checkpoint and execution blocker

Initial launcher RED:13 total/0 pass/2 expected missing-source-and-allowlist
failures/11 explicit missing-source skips. The actual tarball test separately
failed `package_file_closure_mismatch` before changing allowlists. The compiler
and byte transport are now present; the package contains26 files, still15 runtime
payload files. Host name is `com.agentcontinue.device_control`, matching the
existing Devices caller and setup producer; the draft's shorter name was a typo.

The combined launcher/packed run observed18 total/16 pass/1 fail/1 explicit
real-cache skip. PE/hash/manifest, binary Unicode/NUL/open-stdin, origin/parent,
sanitized environment, byte caps, no-overwrite/path checks and the actual packaged
compiler→staged bridge→explicit fixture owner cases passed. The failed case was
synchronous Windows `spawn UNKNOWN` before the idle child existed. Read-only
Defender Operational1116/1117 events matched an owned generated EXE and recorded
`Program:Win32/Contebrew.A!ml` / `Quarantine`. This is not a proven false positive.
Stop further compiled-EXE acceptance; do not restore quarantine, bypass protection,
add exclusions or change bytes to evade detection. Require legitimate
classification/release remediation before a future execution attempt.

An already-started isolated deadline run measured30,754ms launcher wall clock,
755ms before child input and29,999ms afterward, without natural child exit. This
supports that single30s post-spawn budget observation, not universal launch
readiness or a30s OS-startup SLA. Windows executable cases are now opt-in via
`AGENT_CONTINUE_WINDOWS_LAUNCHER=1`; keep unset while quarantine is unresolved.
Full unaffected bootstrap129 total/126 pass/3 explicit skips/0 fail (Linux-only,
missing six-archive directory,missing real provider cache), actual local npm
pack/install26-file closure included. Native114 total/113 pass/1 Linux-only skip,
Devices58 Node+12 syntheticUI and extensioncheck4 passed. No real Chrome
registration, official authentication, protected install or login recovery is
implied.

Independent source review found one Important: clipping the post-exit drain at
the30s child deadline. A new static source assertion failed before the one-line
`elapsed+DrainMs` correction, without compiling or executing the flagged binary.
A fresh independent follow-up confirmed the source correction and ran the default
launcher checks:14 total/3 pass/11 explicit skips/0 fail. It did not compile or
exercise the corrected C# bytes; near-deadline real pipe draining stays unverified.
Final full bootstrap with opt-in unset:143 total/129 pass/14 explicit skips/0 fail,
including26-file pack/install and all three source checks. Eleven skips are the
blocked Windows executable cases; the other three retain their original reasons.
No commit, publication, registration, startup or production activation occurred.
Next is legitimate Defender classification/release remediation, not another
compiled-EXE attempt or an assumption that green skipped tests resolved it.

## Server Owner Payload Increment — 2026-11-04

The source candidate now includes `device-server.mjs` for a binding-free headless
management owner; see `docs/DEVICE-CONTROL.md` Direct Server Owner Entry Increment
for the contract. It shares the existing owner body without weakening the native
origin/binding protocol. This supersedes only the current file-count expectation,
not the Windows launcher's historical15-file scope or Defender blocker.

A failing actual-tarball test first observed the missing16th runtime file. After
adding the entry, actual npm pack/local install verified27 package files and16
runtime files byte-for-byte. No binding, channel secret, operation journal, key or
production state is packaged. Including this source is not installing a server
service, native host, authorized SSH adapter, login hook or live official tunnel.
The Windows compiled-EXE opt-in remains unset.

## Trusted SSH Enrollment / Device Link Increment — 2026-11-04

This continues the approved extension + local manager + independent server
architecture. The SSH reader/adapter and target-scoped Devices UI already exist;
do not reimplement them. The missing first-use producer is a trusted local
bootstrap command, not another browser request field or a live deployment.

Alternatives: manually authoring the private registry leaves identity/hash/link
construction to the user; accepting host/key/command data from the browser breaks
the reviewed native boundary. Use one local Node enrollment entry instead. This
is source/test preparation under the existing continuation approval, not consent
to register a native host, connect a real server or start a service.

Contract:

- Add bootstrap-only `device-enrollment.mjs` exporting
  `enrollSshTarget(options, trusted={})`. Require data-only closed options
  `installDir,consent,sshExecutable,host,port,user,remoteNode,remoteInstallDir,
  knownHosts,knownHostsSha256`; only trusted override is `packageRoot` for the
  existing verified payload. Require `consent:full-account` before filesystem
  access. No private-key value/file, password, endpoint, browser-origin override,
  shell command or runtime-key input exists.
- Add `enroll-ssh --install-dir ABS --consent full-account --ssh-executable ABS
  --host HOST --port PORT --user USER --remote-node POSIX_ABS
  --remote-install-dir POSIX_ABS --known-hosts ABS --known-hosts-sha256 HEX64`.
  Validate exact/unique/complete flags and canonical decimal port before effects.
  Preserve stage/acquire/setup. No public npm command is advertised.
- Require an already staged, consented local manager with its fixed adjacent
  native binding and fixed INSTALL/state. A local tunnel profile/key is not
  required for managing a remote-only target. Verify the existing provider/payload,
  import that verified owner's reader, and derive the extension ID only from the
  local binding. A headless server setup cannot masquerade as a local manager.
- Derive remote entry/state as REMOTE_INSTALL/app/device-server.mjs and
  REMOTE_INSTALL/state. Serialize one descriptor in the reader's exact order;
  compute its SHA256 target ID with the derived extension identity. The explicit
  known-hosts SHA256 must come from independently checked host identity, not a
  network scan or this command's self-approval. Reuse `readSshTarget` for the
  complete private-file/path/descriptor/digest contract; no SSH process runs.
- First-use registration is create-only at
  INSTALL/app/device-ssh-targets.json. Refuse an existing destination rather than
  overwrite another target or its pending identity. Validate a private temporary
  candidate with the production reader; retain binding/candidate identity across
  the final asynchronous provider check. Publish via no-clobber hard link, remove
  the temporary link, then read back the final single-link record. Failure can
  leave diagnostic partial files or a published but unusable record; it is not a
  rollback and no automatic retry/repair is performed. Current-user validation
  is not a protected Windows DACL or hostile same-user race guarantee.
- Return one closed JSON receipt: format agent-continue-ssh-enrollment-result,
  version1,status enrolled,target,deviceUrl,sshAuthenticationVerified:false,
  ownerReachabilityVerified:false,nativeRegistrationVerified:false,
  chatAuthorizationVerified:false,activated:false. deviceUrl is exactly
  chrome-extension://DERIVED_ID/devices.html?target=TARGET. Do not print hosts,
  account names, paths, host-key contents or raw errors. Import is effect-free;
  failures use fixed codes only. This link conveys selection, never authority.
- Keep the five-field Setup export unchanged. Add bilingual remote-management
  guidance to the existing Setup page: server tool traffic is independent and
  direct to OpenAI; optional extension-driven lifecycle management separately
  needs the installed local native manager and authenticated on-demand SSH.
  Explain the source enrollment command/device link without download claims,
  automatic native calls, browser host/key inputs, grants or installation claims.
- Add the bootstrap module to explicit package files, not RUNTIME_FILES. Expected
  closure becomes29 package/17 runtime files. Never package generated registries,
  host keys or device state. Leave the Defender EXE opt-in unset.

Execution / acceptance:

- [x] Add missing-API/CLI RED and fixture tests in
  `native/bootstrap/device-enrollment.test.mjs`; cover consent-before-I/O,
  strict inputs, fixed binding, independently supplied host-key digest, immutable
  target/link, existing registry, replacement during final verification,
  single-link readback and fixed diagnostics. A supplemental effect-free-import
  test was added; its Windows execution is blocked as described below, not proved.
- [x] Implement the bootstrap API/CLI, then run exact-cwd Node fixture tests.
  All writable paths are under os.tmpdir; no genuine credentials, real SSH,
  registry/service/login hooks, compiled EXEs or production installs are inputs.
- [x] Add failing UI guidance and actual-tarball expectations before their
  implementation/allowlist changes. Verify the installed local package's real
  enroll command yields a target accepted by its actual packaged reader, with no
  tunnel/owner autostart. Run affected native/bootstrap/Devices/Setup checks.
- [x] Obtain a different non-implementer's bounded read-only review and bind it
  to exact bytes; update handoff/AGENTS/current memory. Real OpenSSH host-key/agent
  authentication, Linux/macOS/Windows launcher installation, platform grants,
  complete representative tool calls and real interactive-login recovery remain
  separate unfinished requirements of the unchanged full goal.

Bounded verification checkpoint (not full-goal or import certification):

- Initial enrollment RED3 failures/12 missing-API skips, then15/15 initial GREEN.
  Additional publication-failure probes cover unlink, extra hard link, identical-
  byte inode replacement and invalid final readback without false success/repair.
- The fresh-import side-effect probe initially blocked the normal Node24 ESM
  loader. After correcting that fixture distinction, Defender1116/1117 blocked
  its exact owned Windows Node command line as `Trojan:Win32/SuspExec.SE` (Remove),
  followed by EPERM. Stop it; keep `AGENT_CONTINUE_IMPORT_EFFECT_PROBE` unset.
  No retry/re-encoding/relocation to evade detection, exclusions, restoration or
  weakened protection. It is an explicit unverified default Windows skip, not a
  pass or a proven false positive; independent of the generated-EXE quarantine.
- Fresh fullbootstrap161 total/146 pass/15 explicit skips/0 fail (11 EXE,1 import
  probe,3 existing platform/assets/cache); actual local npm tarball/install29
  package/17 runtime files and installedCLI→actualpackagedreader passed. Native
  142 total/138 pass/4 Unix/Linux skips/0 fail; Devices60/60Node+13/13syntheticUI;
  Setup15/15Node+19/19syntheticUI; extensioncheck4/4. Synthetic UI is not installed
  Chrome. Final independent probe-gate/UI review confirmed skip-before-spawn,
  reran enrollment17 (16 pass/1 blocked skip) plus source/VM9/9, and found no
  confirmed production Critical/Important. In-app browser independently verified
  guide English→Chinese, Linux-server visibility and Windows hiding, fixed manual
  link, no new inputs and no simulated native calls on the owned loopback page.
  This adds real UI evidence, not installed-extension or SSH acceptance.

## Remote-Only Local Manager Preparation Increment — 2026-11-04

This source/test increment continues the approved architecture and closes the
missing local preparation prerequisite for `enroll-ssh`. It does not replace the
full device goal or install/register a protected native host. Manual state/binding
authoring is error-prone; using `setup` unnecessarily requires a local OpenAI key
and client. Compose the existing provider acquisition with manager-only state and
binding preparation instead. Do not duplicate acquisition or add a browser field.

Contract:

- Add `setupManager(options, trusted={})` to the existing `device-setup.mjs`.
  Closed data-only options are installDir,consent,setupRequestFile,offlineCache,
  signal; trusted overrides only packageRoot,npmCli,acquisitionTimeoutMs. Check
  data-property consent `full-account` before I/O, then schema/signal/budget.
  Reject runtimeKeyFile,tunnelId,offlineArchive,fetchImpl and arbitrary commands.
- Add `setup-manager --install-dir ABS --consent full-account --setup-request ABS
  [--offline-cache ABS]`. Reject duplicate/unknown/missing flags before effects.
  Preserve existing stage/acquire/setup/enroll-ssh and signal-handler cleanup.
  Use the unchanged canonical five-field request for the actual local platform;
  require its fixed non-null nativeHost. A linux-server request is not a local
  manager request, even on Linux. Obtain a second local-platform export when
  setting up optional management for a server; server setup stays independent.
- Require a new destination. Read the request with the existing bounded reader,
  validate platform and retain its digest before acquisition. Run stageRuntime
  exactly once with acquire-provider consent; reuse its fixed registry, disabled
  hooks, isolated environment and confirmed-child-exit rules. Never acquire the
  tunnel client, import profile code, consume a key or set a tunnel endpoint.
- Verify provider/payload, import only its verified runtime/owner modules, and
  prepare fixed INSTALL/state with the existing exact full-account prepareState
  result. Create-only INSTALL/app/device-native-binding.json with the same four
  fields as local setup. Validate it with the installed readNativeBinding reader;
  require exact extension ID and fixed state root. Retain install/app/binding/state
  identities, expected binding bytes and request digest across the final async
  provider verification. Recheck before the final receipt commit. Unsafe private
  mode, changed files, redirects or helper overclaims refuse success.
- Publish `INSTALL/manager-receipt.json` last, using a private pending receipt,
  identity/bytes readback and synchronous create-only hard link. Recheck cancellation,
  request and binding immediately before link. Once link succeeds, commitment wins
  over subsequent cancellation or best-effort temporary-link cleanup. Keep partial
  stage/state/binding on failure; no silent repair, reuse or rollback claim.
- Exact receipt order: format agent-continue-manager-setup-result,version1,
  status prepared,providerVersion0.3.1,target,extensionId,nativeHost,requestSha256,
  prepared true,localTunnelConfigured false,activated false,authenticationVerified
  false,nativeRegistrationVerified false,chatAuthorizationVerified false,
  protectedInstallationVerified false,nativeDependenciesVerified false. No paths,
  credentials, tunnel ID or host details in stdout. Use existing fixed setup error
  codes. No final device setup receipt, client, owner, journal, channel, launcher,
  OS registration/service/login hook, SSH connection or platform grant is created.
- Reuse existing module/package closure:29 package/17 runtime files. Update help,
  actual packed-installed CLI acceptance and bilingual optional remote-management
  guidance. Label source/private-package status accurately; no public npx/install
  or Windows executable acceptance is claimed. Both Defender opt-ins stay unset;
  do not rerun or re-encode the blocked import probe or compiled EXE tests.

Execution plan (single source owner; disjoint read-only review):

1. Add manager API/help and guidance assertions to existing tests, run exact-cwd
   Node tests and observe missing-API/command/guidance RED before implementation.
2. Add new-destination, actual producer/consumer, consent/schema-before-I/O,
   local-target-only, single acquisition/no-client/key, cancellation, mutation,
   helper-result, create-only binding/receipt and final commit-boundary fixtures.
   Fixtures stay under os.tmpdir; genuine pinned provider bytes, no real credentials.
3. Implement setupManager in device-setup and the closed CLI in bin; update help
   expectations and instructions without changing the five-field export. Replace
   manual binding preparation in actual local npm-tarball enrollment acceptance
   with the installed setup-manager CLI, then the installed enroll-ssh CLI and
   actual packaged readers. Use a fixture-only trusted npm copier, not a fake SSH
   executable invocation or a production install.
4. Run full affected setup/bootstrap/native/Devices/check suites with both blocked
   opt-ins unset. Obtain independent spec and quality review, reproduce/fix any
   confirmed defect with a failing test, and bind final evidence to exact bytes.
   Update handoff/AGENTS/current memory; keep real registration/SSH/platform/login
   acceptance unfinished and the original goal active. No commit or publication.

## Remote-Only Increment Evidence — 2026-11-04

Implemented within the existing module/29-file package/17-file runtime closure.
Observed missing API/help RED2+12skip and onboarding RED1/9pass, then manager14,
source guide10 pass. Additional RED cases exposed post-awaited-import payload/
receipt verification and pending-receipt same-byte replacement; verifier now
rechecks payload/lock/receipt and pending write retains its original fd identity.
Independent review confirmed non-enumerable validated fields lost by object
spread; normal test-runner RED2→GREEN2 now preserves all allowed own data
properties, including null-prototype/non-enumerable options/trusted values,
pre-abort-before-I/O and explicit offline cache. Final-await mutation fixtures
cover7 branches including install/app/state directory replacement. POSIX mode
execution is still a genuine-host gate, not inferred from Windows.

Fresh post-fix full bootstrap:176 total,161 pass,15 explicit skip,0fail
(11 blocked EXE,1 blocked import probe,3 platform/assets/cache). Actual local npm
pack/install acceptance uses installed setup-manager→installed enroll-ssh→actual
packaged readers with fixture-only pinned provider copying, no real SSH or live
provider registry acceptance. Setup16 Node+19 syntheticUI, Devices60 Node+13
syntheticUI, native142/138pass4UnixLinuxSkip, check4 passed. Independent spec found
no confirmedC/I, final independent reader reran2fix tests2pass0fail/no remaining
confirmedC/I in scope. Source/test byte vector is in DEVELOPMENT-HANDOFF.

The in-app owned-loopback page actually rendered both source commands, English→
Chinese local-request/no-key/registration boundaries, no new fields/authority
calls, and Windows hiding. Owned tab/server closed, processscan0. No installed
Chrome, protected native registration, actual SSH, platform grant, official
ChatGPT/Dot tools, production owner or real login-recovery acceptance is claimed.
Both Defender opt-ins remained unset; original blocked probes were not replayed.
No production install/registry/service/elevation/credentials/commit/publication.
The full original goal remains active beyond this bounded source increment.

## Implementation And Acceptance

Main owns module/API/CLI/allowlists/sharedexports/docs. A disjoint worker may own
device-setup.test.mjs only after reviewed contracts. Reviewer packets include
this file and referenced current sources; design freezes during review. Use
autonomous parallel-role adaptation, never vote/certification claims.

Observe RED before implementation. Cases: consent before reads; closed schema/
duplicatekeys/encoding/bounds/link/target; key contents never read; invalid key/
overlap before effects; no existing target reuse; cancellation and commit order;
source/request/key changes; malformed native helper results; partial profile and
receipt failures; fixed code JSON without paths/keys; imports are effect-free.
Trusted synthetic payload fixtures reseal byte manifest before provider staging,
never execute fake tunnel binaries. Genuine unzipper/dependency sources stay genuine.

Actual packed-installed-bin acceptance uses the real browser request producer,
fake opaque local key file outside install/source, one setup invocation, real
official runtime acquisition and pinned274-file provider inventory. Inspect the
actual profile without reading the key; assert no active runtime/registration/
service/task or browser grant is inferred. Existing harmless MCP fixture uses the
prepared state, lists25tools and writes/reads only its owned file. Retain owned
files if nestednpm exit is unknown. Windows/Linux/macOS CI executes configuration
acceptance; six ZIP metadata coverage does not establish six-architecture execution.
No real account keys, production connection or OS elevation are acceptance inputs.
