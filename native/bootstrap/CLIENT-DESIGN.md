# Official Client Acquisition And Unified Bootstrap

## Problem

Provider staging alone cannot connect a device. The official tunnel executable
is still a manually supplied prerequisite. Add one consented acquisition command
that stages Desktop Commander and the official runtime-only client; subsequent
account/tunnel binding and activation remain observable unfinished states. This
is not a sandbox or directory allowlist. The eventual device uses its actual OS
account's full permissions; real elevation and platform grants use real flows.
Internal states must not create repeated consent dialogs.

## Technical Plan

The private bootstrap version becomes 0.2.0. Keep existing `stage` behavior, and
add `acquire --install-dir ABS --consent full-account [--offline-cache ABS]
[--tunnel-archive ABS]`. One informed consent covers acquiring both components;
it does not imply that an account was bound, a tunnel was created or commands
were enabled. The CLI translates that consent into provider acquisition, then
official-client acquisition. No keys, credential reads, services, startup/login
changes, native-host registration or actual tunnel activation occur here.

The domain/CLI coordinates the transitions. The provider adapter owns npm; the
official-client adapter owns release acquisition/extraction. Neither adapter
decides identity or enables a connection. Provider success followed by client
failure is partial preparation, not a global success or an atomic rollback.
Existing working installations, configuration and pauses are not migration
inputs. No developer relay is introduced.

Add `client-acquisition.mjs` to the bootstrap's packed base allowlist (20 total
files, unchanged twelve runtime payload files). Runtime `tunnel-pins.json`
records v0.0.19 runtime-only assets for win32/linux/darwin x64/arm64: asset,
archiveSha256, executableSha256, spdxSha256. Source is the official fixed tag.
Windows x64 also retains the previous full-client executable hash in a single
`compatibleExecutableSha256` array, for existing profile verification only.
Acquisition always uses the primary runtime-only pin. New pin values come from
the official SHA256SUMS plus hash-verified SPDX file executable records. These
checks trust the official HTTPS distribution, not an independent signature.
Update profile verification to accept primary or explicitly pinned compatible
hashes; reject missing/unsupported platforms. Do not rewrite existing profiles.

Export `verifyProviderStage(installDir, packageRoot?)` from bootstrap.mjs. It
validates absolute nonredirected paths, the packaged manifest, copied payload
hashes and lock, exact canonical provider receipt, and the staged own runtime's
positive verifyUpstream result. No upstream code runs. Return exactly
`{providerVersion:"0.3.1",files:12}` or throw provider_stage_invalid; do not expose
paths or raw exceptions. A successful receipt may retain its own pending link
after best-effort cleanup; that alone is not a failed stage. Verify regular
receipt bytes and canonical content, not an assumption that its link count is1.

Export async `acquireClient({installDir,consent,offlineArchive?,signal?},
{packageRoot?,fetchImpl?,platform?})`. The second object is trusted in-process
test/build composition, not browser/CLI data. Platform is one of the six exact
keys above, default process.platform + '-' + process.arch. Validate option keys,
signal type, platform and pins, and require consent full-account before any
read/write/network. Revalidate the provider stage before claiming INSTALL/client
with exclusive nonrecursive mkdir. Existing or partial client targets are never
overwritten, deleted, repaired or automatically retried. The provider receipt
remains staged on a later client failure. No acquired client receipt is emitted.

An offlineArchive must be an absolute, local, nonredirected, regular single-link
file outside INSTALL/client. Read at most64MiB and copy bytes into the newly
owned client/release.zip. Online mode fetches only the fixed official release
asset URL. Follow at most3 redirects, HTTPS/default443/no userinfo only; hosts
are github.com (fixed release path) or release-assets.githubusercontent.com or
objects.githubusercontent.com. Signed CDN queries are permitted but never logged.
No Authorization, Cookie, inherited headers, credentials or caller URL is sent.
Use manual redirects, credentials omit and cache no-store. Accept status200 only,
reject oversized declared Content-Length, and count the streaming body to64MiB.
Missing length is allowed; counting is authoritative. Write exclusively.

Use one60-second AbortSignal deadline for client acquisition/decompression,
combined with the caller signal. On cancellation/deadline, abort owned fetch and
stream pipelines, emit no acquired receipt and retain partial owned files. No
retry, alternate URL, shell, child process or raw exception output is permitted.
In-memory ZIP metadata parsing is raced against cancellation; it owns no process
or file handle. This is a finite ordinary-user helper, not protection against
parent SIGKILL or hostile same-account filesystem races.

Verify release.zip SHA256 before parsing. Use the already locked and installed
unzipper0.10.14 library from the staged app via createRequire, not a hand-written
ZIP parser, a new npx dependency or a shell extraction command. Check its package
name/version and nonredirected path first. Installed dependency authenticity
comes from npm's lock/integrity acquisition; this is not ongoing privileged
attestation against same-account package modification.

Parse with unzipper.Open.buffer, limited to64MiB archive input. Require exactly
five unique regular entries: tunnel-client-runtime[.exe], LICENSE, NOTICE,
ASSET_BASE-licenses.txt and ASSET_BASE.spdx.json. No directories, symlinks,
special files, duplicate names, encryption, other entries or compression methods
besides0/8. The executable has positive declared/actual size at most128MiB;
each document at most2MiB. Read each entry stream through an actual byte counter
to its predetermined exclusive filename, never a generic extract-to-path API.
Check declared size against actual, executable SHA256 and SPDX SHA256. Archive
hash already covers license/NOTICE bytes. Keep the archive and all license/SBOM
files. POSIX executable mode is0700; no ACL/elevation changes on Windows.
Revalidate the provider stage after acquisition and before publishing success.

Publish client/receipt.json last via a private pending file and create-only
atomic link, following the provider receipt's cancellation/commit semantics.
Its closed canonical shape is:
`{format:"agent-continue-device-acquisition",version:1,status:"acquired",
providerVersion:"0.3.1",tunnelRelease:"v0.0.19",platform:PLATFORM,
executableSha256:PIN,configured:false,activated:false,
protectedInstallationVerified:false,nativeDependenciesVerified:false}`.
Acquiring a client does not run it. Return that receipt. CLI acquire success is
`{ok:true,...receipt}`; stdout one JSON line, no stderr. Existing help now lists
help/version/stage/acquire; version reports0.2.0. Existing stage success stays
the v1 staged-only receipt. CLI error codes additionally include
provider_stage_invalid, unsupported_tunnel_platform, client_input_invalid,
client_exists, client_acquisition_failed, client_archive_invalid,
client_verification_failed and client_receipt_failed. Unknown errors map to
client_acquisition_failed; no paths, URLs, credentials or raw exceptions appear.

## Alternatives

Do not ship the GUI/full/cloudflared client by default, fetch mutable latest,
silently change an existing tunnel, run package hooks, use a developer relay, or
pretend a local consent creates platform grants. Keep actual account binding,
official authentication and connection controls as the next domain operations.
Missing-Node PowerShell/CMD adapters and npm publication remain future work, not
prerequisites for implementing this actual combined command.

## Detailed Implementation And Acceptance

- Main owns bootstrap/client modules, CLI, allowlists, pins/profile compatibility
  and documentation. A worker may own only client-acquisition.test.mjs after
  current design readiness. Independent reviewers read this exact frozen input.
- RED cases cover refusal before effects, invalid options/platform, partial or
  changed provider stage, existing client target, bad archive digest, missing/
  duplicate/traversal/symlink/encrypted ZIP entry, invalid executable/SBOM digest,
  oversized body/entry, malformed ZIP, failed HTTP and disallowed redirect before
  following it, timeout/cancellation, publication failure and source changes.
- Use bounded trusted synthetic pins resealed into disposable package fixtures
  for malformed ZIP/network tests. This is not official-artifact authenticity.
  Synthetic extraction tests never execute their fake executable.
- Actual npm packed/installed-bin acceptance uses one acquire invocation and a
  pinned official offline archive. Assert receipt closure, payload hashes,
  retained licenses, byte pin, no binding/activation, no changed source or user
  state and no leaked owned processes. No credentials or production are inputs.
- Actual CI opts in via AGENT_CONTINUE_OFFICIAL_CLIENT=1 to the fixed official
  public download path. Local tests may use AGENT_CONTINUE_OFFICIAL_ARCHIVE.
  Without either, real-client acquisition is explicitly skipped, not passed.
- Windows/Linux and a new macOS bootstrap-only CI job execute ordinary-user
  acquisition and existing harmless MCP file roundtrip. Add macOS acquisition
  coverage without claiming its owned lifecycle/login/elevation is implemented.
  x64/arm64 pin metadata is checked, but non-host architecture execution remains
  unverified. No stable release/store submission is implied by source/CI success.

## Review Reconciliation Contract

This section resolves the initial three independent document reviews. It is
authoritative where the earlier proposal imported an implicit contract.

- Source: https://github.com/openai/tunnel-client/releases/tag/v0.0.19 . Initial
  download is exactly https://github.com/openai/tunnel-client/releases/download/v0.0.19/ASSET .
  ASSET_BASE is `tunnel-client-runtime-v0.0.19-` plus one of windows-amd64,
  windows-arm64, linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, respectively
  mapped to win32-x64, win32-arm64, linux-x64, linux-arm64, darwin-x64, darwin-arm64.
  ASSET is ASSET_BASE plus `.zip`. Member executable is
  tunnel-client-runtime.exe for win32, otherwise tunnel-client-runtime. All
  hashes are lowercase 64-digit SHA256 hex. The six records are committed in
  native/desktop-commander/tunnel-pins.json; official SHA256SUMS and hash-checked
  SPDX executable records supply their provenance. No mutable latest endpoint.
- Existing provider contract lives in bootstrap.mjs, payload-layout.mjs and
  bootstrap.test.mjs; these are explicit implementation/test dependencies, not
  hidden review inputs. `verifyProviderStage` is async because own runtime is
  imported. Provider receipt is the ordered staged object in stageRuntime,
  serialized by JSON.stringify plus LF in UTF-8 without BOM. The provider verifier
  returns exactly {version:"0.3.1",verifiedFiles:PIN.files}. Test fixtures may
  replace runtime.mjs with this literal-return function and reseal its manifest
  record's byte count and SHA256, or copy the genuine pinned provider inventory
  as existing bootstrap tests do. Fixture pins are private test composition,
  never alternate CLI download inputs.
- Combined CLI validates syntax, consent, absolute archive input and supported
  platform before provider effects. Absent destination: stage once then acquire.
  Any existing destination, including a valid provider-only stage: reject
  destination_exists, unchanged. API acquireClient can explicitly consume a valid
  provider-only stage, but CLI does not silently repair/resume. Forward cache only
  to stageRuntime, archive only to acquireClient, one shared caller AbortSignal
  to both; provider has no automatic total-time cutoff and client starts its own 60s
  cooperative budget on API entry. No automatic second consent or retry.
- Cancellation is cooperative, not a hard preemption of synchronous parsing.
  An abort before commit rejects client_acquisition_failed. Active fetch readers
  and extraction pipelines must be cancelled/destroyed and settled before return.
  The success linearization point is successful synchronous fs.linkSync of the
  private pending receipt to client/receipt.json. Check abort immediately before
  this call; once it succeeds, commitment wins over cancellation, deadline or
  pending-link cleanup failure. Never throw after commitment. Pending-file
  removal is best-effort on failure and success; retain owned partial files,
  never remove a committed receipt. Tests intercept fs.linkSync/writeFileSync
  to deterministically trigger pre- and post-commit aborts and cleanup failure.
- Client receipt property order is exactly the object shown above, UTF-8,
  JSON.stringify plus LF, no BOM, lowercase hash. API errors are new Error(CODE)
  with message exactly the whitelisted fixed code, no cause/raw diagnostics.
  CLI failure is {ok:false,error:CODE} plus LF on stdout, empty stderr, exit1;
  success exits0. No partial paths or receipts appear in failure JSON.
  Consent failure precedes all other checks. Malformed API options/local path:
  client_input_invalid. Missing/changed provider: provider_stage_invalid.
  Existing client target: client_exists. HTTP/deadline/abort/I/O:
  client_acquisition_failed. Malformed/extra/unsafe ZIP metadata:
  client_archive_invalid. Archive/executable/SPDX hash or stream size mismatch:
  client_verification_failed. Pending receipt or publication I/O:
  client_receipt_failed. All errors before provider stage in CLI use those codes
  or existing invalid_arguments/invalid_install_path as appropriate.
- ZIP member paths must match the five exact case-sensitive ASCII names, with
  no separators or alternative encodings. flags bit0 rejects encryption; only
  compressionMethod0/8 and diskNumber0 accepted. type must be File. POSIX type
  bits in externalFileAttributes must be 0 (unspecified, including DOS creator)
  or 0100000 (regular); DOS directory/device attribute bits0x10/0x40 reject.
  A zero POSIX type is accepted, not misclassified as a symlink. Other types
  reject even when name/type disagree. Declared sizes must be positive integers
  within bounds. All six official archives must pass validation/extraction/hash
  and receipt tests using trusted platform override without executing foreign
  binaries before any six-platform acceptance claim.
- Tests run with Node>=22.12 and existing local npm, node --test
  --test-concurrency=1 native/bootstrap/bootstrap.test.mjs
  native/bootstrap/client-acquisition.test.mjs native/bootstrap/packed.test.mjs.
  Existing packed.test.mjs owns npm pack/install, temp home/config/cache and MCP
  roundtrip; update that harness to invoke acquire when official opt-in is set.
  Its allowed write set remains its disposable fixture plus explicit writable
  cache; no credentials/source/production inputs. The separately labeled MCP
  initialize/tools-list/write_file/read_file test uses only an owned fixture file,
  not the acquired tunnel binary or an activated connection. New macOS CI runs
  bootstrap tests only. Without official archive/download opt-in, real client
  acceptance is skipped explicitly. Synthetic cases never execute their exe.

### Code Review Amendment: Extraction Ownership

Actual dependency source review found that unzipper0.10.14 destroys its source
on normal finish, but does not propagate outer PassThrough destruction into all
internal pull/inflate streams. The adapter therefore owns the complete bounded
ZIP extraction in a finite Node worker thread, implemented in the same module
(no extra packed file or eval). The parent must await worker termination before
returning either success or failure. It passes only verified archive bytes,
fixed platform pins and owned extraction paths; env is empty, execArgv empty,
stdout/stderr consumed privately. Fixed progress messages permit cancellation
tests against the real deflated library path. No synthetic executable runs.
This is resource lifecycle ownership, not a product sandbox or a background
service. Parsing/extraction no longer relies on outer-stream destruction as
proof that hidden library work settled. The parent still revalidates the
provider and commits the receipt after successful extraction-worker exit.

Resolve existing path ancestors to filesystem-canonical spelling before source,
destination and cache containment checks (including case-insensitive macOS).
Do not lowercase all POSIX paths. Packed-test teardown retains its disposable
fixture whenever nested npm closure is unconfirmed, even if the outer CLI exited.
