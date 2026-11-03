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

Add device-setup.mjs to the exact packed base allowlist:21files total,12runtime
payload files unchanged. API exports:
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
