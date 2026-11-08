# Device Bootstrap: Acquisition Increment

## Problem

The runtime is source-only. A first `npx` installation of a dependency-bearing
package can execute dependency hooks before our consent screen. The browser
cannot launch its first native host by itself. This increment packages a reusable
ordinary-user acquisition path, not a connected device or privileged installer.
The product goal is informed-consent full-account access, not a filesystem
sandbox, VM or directory allowlist. Temporary test roots and isolated acquisition
configuration protect existing state during development/install; they do not
reduce the eventual connected account's file/terminal/process permissions.
Receipt states separate implementation facts, not mandatory repeated consent
dialogs. Actual OS elevation and platform grants still follow their real flows.

## Technical Plan

Create a private, zero-dependency `agent-continue-device-bootstrap` package with
one `agent-continue-device` bin. No lifecycle hooks, dynamic downloads on import,
keys, user state, services or browser registration belong in the package.

`build-package.mjs --output ABS_NEW_DIRECTORY` assembles only an exact allowlist:
bootstrap bin/library/README/LICENSE/package metadata and a `payload/` containing
the runtime source/pin/lock files listed in `payload-layout.mjs`:
`device-native-host.mjs`, `device-operations.mjs`, `device-owner.mjs`,
`device-server.mjs`, `device-ssh.mjs`,
`host.mjs`, `lifecycle.mjs`, `package-lock.json`, `package.json`,
`process-observation.mjs`, `profile.mjs`, `research-handoff.mjs`,
`research-runner.mjs`, `runtime.mjs`, `setup-cli.mjs`,
`tunnel-pins.json`, `upstream-pin.json`, `windows-child.mjs`, and
`windows-process-query.cs`. `build-package.mjs` exports
`buildPackage(destination, {runtimeRoot?})`; runtimeRoot is a trusted build/test
input, not a CLI argument. It is excluded from packed runtime files.
A canonical `payload-manifest.json` records their sizes and SHA-256 hashes.
The packed bin hashbang has LF even after a Windows CRLF source checkout, so
npm's normal bin-links newline fix does not change installed package bytes.
Its exact closed JSON shape is `{format:"agent-continue-payload",version:1,
provider:{name:"@wonderwhy-er/desktop-commander",version:"0.3.1"},
files:[{path,bytes,sha256},...]}`. Files are exactly the fifteen names above,
lexically sorted, with nonnegative integer sizes and lowercase 64-hex digests.
Encoding is UTF-8 JSON.stringify output plus one LF; extra/duplicate keys or
entries and noncanonical bytes reject. It detects changes
relative to the packaged manifest (32 entries is a defensive ceiling, not the
required count; 4 MiB per file, 8 MiB total;
regular single-link files, no symlink ancestors or extra payload entries).
Authenticity still depends on the reviewed
package distribution. It is not a self-authenticating signature.

`bootstrap.mjs` exports `verifyPayload(packageRoot)` and
`stageRuntime({installDir, consent, offlineCache?, signal?},
{packageRoot?, npmCli?, acquisitionTimeoutMs?})`.
The second argument is trusted in-process composition/test input, not CLI or
browser data. Only consent `acquire-provider` permits any staging or npm action.
Installation targets must be absolute, new, local and nonredirected. Claim the
final directory atomically with nonrecursive mkdir; an existing destination or
losing concurrent call fails before any copy or npm action. Parent must exist.
Do not use check-then-recursive-create as ownership. Existing or partial
targets are never repaired, overwritten or deleted. Failure retains owned partial
staging without a success receipt; it does not touch an existing runtime or pause.

Staging copies the verified payload to `INSTALL/app`, makes private bootstrap
home/config/cache directories under `INSTALL/acquisition`, then invokes Node
with a verified-shape local npm CLI and fixed `ci --ignore-scripts --no-audit
--no-fund` arguments. Public registry URLs, exact provider version, a v3 lock and
the child working directory exactly INSTALL/app are mandatory, independent of
the caller's cwd. No ambient project `.npmrc` is copied or used.
Pass --prefix INSTALL/app and --workspaces=false explicitly so an enclosing
workspace cannot redirect npm's project root, lockfile or node_modules.
Package integrity is required. Git/file/linked dependency sources are rejected
except the single declared vendored dependency below, shipped inside its parent.
Explicit `offlineCache` selects `--offline --cache ABS_DIRECTORY`; otherwise
acquisition requests the public npm registry. Every non-root locked package must
have integrity and an HTTPS resolved URL with hostname registry.npmjs.org,
default port, no userinfo/query/fragment, with one exact exception:
`node_modules/@wonderwhy-er/desktop-commander/node_modules/@desktop-commander/telemetry-contract`
version 0.1.1, inBundle=true, without separate resolved/integrity or link fields.
The pinned provider must declare exactly that bundleDependencies entry and
`file:vendor/telemetry-contract` for that dependency. Its bytes are acquired
inside the registry tarball validated by the pinned parent's integrity, not from
a local file dependency. Require parent and child consistency independently of
iterating that child; a dangling declaration rejects. No other inBundle exception
is allowed.
This trusts the registry, TLS, npm's redirect handling and integrity validation;
it is not OS-level egress enforcement. No inherited npm config,
auth tokens, Node preloads, proxy settings or personal home is passed to npm.
Empty user/global npm configs and the fixed registry are passed explicitly.
Acquisition declares CI=true to require noninteractive package-manager behavior.
Windows gets the selected Node directory plus the system System32 path, fixed
system cmd.exe as ComSpec and standard executable suffixes, not inherited PATH
or user shell/module configuration. These OS prerequisites are not a runtime
filesystem sandbox.
Npm's at-most-two diagnostic logs stay in INSTALL/acquisition/logs, not a shared
cache log directory, and npm's update notifier is disabled. CLI output remains
fixed-code only. These acquisition logs contain public dependency/install paths,
not user conversation data; they are not automatically uploaded.
A best-effort private acquisition/process.json contains only format/version,
fixed result code, exit/close observed flags and integer codes (or null), a fixed
cancel reason and monotonic duration. It never carries PID, command, URL, path,
credentials or raw npm output. Diagnostic write failure does not change receipts.
Npm CLI discovery checks `npm_execpath`, then Node's sibling
`node_modules/npm/bin/npm-cli.js`, then its prefix's `lib/node_modules/npm/bin/`
entry. Resolve links once, require a regular `npm-cli.js` in `npm/bin` with
parent package metadata `name=npm`, and invoke it through `process.execPath`,
never a shell or arbitrary command. This is runtime discovery, not a signature
or privileged trust proof. Trusted installed Node/npm is a prerequisite; an
attacker-controlled npm_execpath or modified toolchain is outside this ordinary-
user installer's guarantees. Shape checks do not authenticate executable code.
Raw errors remain fixed-code failures.
Reject overlap between install directory and packaged sources. Recheck staged
source hashes after acquisition. Timeout does not authorize a second npm attempt.
An offline cache must be an existing absolute local directory, with nonredirected
ancestors and `_cacache` directory, outside the package/install/toolchain roots.
It is explicitly selected as a writable npm cache, not read-only input: npm may
write cache bookkeeping/logs there. Preservation of unrelated state excludes
this deliberately selected cache; users must not select device/runtime state.

After npm exits successfully, recheck copied source hashes and call only our
staged `runtime.mjs`'s `verifyUpstream()`. It verifies provider files without
importing upstream code. Import exactly INSTALL/app/runtime.mjs as a file URL;
its returned object must have exactly `{version,verifiedFiles}`, version must
equal 0.3.1 and verifiedFiles must equal the positive integer files count in the
hashed upstream-pin.json. A throw, negative, missing or extra result rejects.
Publish `INSTALL/receipt.json` last with closed fields:
`format=agent-continue-acquisition, version=1, status=staged,
providerVersion=0.3.1, configured=false, activated=false,
protectedInstallationVerified=false, nativeDependenciesVerified=false`.
Skipped hooks do not prove all native/search/PDF dependencies work.
Write the receipt to a new private pending file, recheck cancellation, then
atomically link it create-only as receipt.json. Publication is the commit point;
no await occurs between the cancellation recheck and publication. A cancellation
observed before commit cannot succeed. After commit it cannot retract the receipt.
Failed publication leaves no consumable final receipt. Removing the pending link
after commit is best-effort and cannot turn committed success into a failure.

CLI commands are exactly `help`, `version`, and
`stage --install-dir ABS --consent acquire-provider [--offline-cache ABS]`.
Help/import/version have no staging, network or launch effects. Failures print a
closed fixed-code JSON result, never raw exceptions, npm output, keys or paths.
Normal npm acquisition has no total elapsed-time deadline. It remains one
attempt, with no shell or arbitrary script/command option, until npm finishes,
reports an error or the caller cancels. Only explicit trusted in-process test
composition can request a deadline (a safe integer of at least 20 ms, no 180-second
ceiling); long deadlines use Node-safe timer chunks rather than overflowing into
an immediate timeout. CLI/browser input cannot set that fixture-only override.
On explicit fixture deadline or AbortSignal/SIGINT/SIGTERM, signal only the
retained npm child with SIGTERM, wait two seconds, then SIGKILL if still live,
wait two seconds for close. Never kill by process name or enumerate unrelated
tasks. If close remains unconfirmed, return acquisition_exit_unconfirmed, retain
the reserved target and do not claim effects have stopped. No success receipt or
automatic retry occurs. This does not attest arbitrary descendants or survive
parent SIGKILL; future protected installation needs OS-specific containment.
It cannot configure or start a tunnel.

Library results: verifyPayload returns exactly `{files:12,providerVersion:"0.3.1"}`;
buildPackage returns `{built:true,files:12}`. stageRuntime returns the exact receipt
above only after all checks pass. Library failures throw Error with one fixed
message from: consent_required, payload_invalid, invalid_install_path,
destination_exists, npm_unavailable, dependency_acquisition_failed,
acquisition_exit_unconfirmed, provider_verification_failed, receipt_write_failed,
bootstrap_failed, build_failed. Unknown filesystem/process exceptions become
bootstrap_failed (builder: build_failed), without raw messages.
CLI stdout is one JSON line: stage success `{ok:true,...receipt}`, failure
`{ok:false,error:CODE}` (exit 1), help `{ok:true,commands:["help","version","stage"]}`,
version `{ok:true,version:"0.1.0"}` (exit 0). Invalid options use invalid_arguments.
CLI errors never print stderr. Build CLI accepts only --output ABS and returns
`{ok:true,built:true,files:12}` or `{ok:false,error:"build_failed"}`, exits 0/1.

## Alternatives

Do not use upstream hosted `remote`, mutable `@latest` runtime starts, a developer
relay, automatic npm rebuild, or a dependency-bearing first-stage bootstrap.
PowerShell/CMD/Unix Node installers and missing-Node consent are separate later
adapters. Npm publication/account creation, OS elevation, lifecycle/login policy,
official-client acquisition and ChatGPT grants remain explicit later gates.

## Detailed Implementation And Acceptance

- Main owns bootstrap library, CLI, allowlist builder and unit tests. A worker may
  own only `packed.test.mjs`, testing the declared public contracts.
- Verify refusal before any destination creation/npm call; import/help/version
  do nothing; paths/links/extra payload files and modified hashes reject.
- Offline fixture archives carry install-hook sentinels. Actual npm acquisition
  must leave them unexecuted. Tests may build a trusted synthetic provider pin;
  these fixtures are not real-provider acceptance.
- Test interrupted/failed acquisition, no receipt or silent retry, source changes
  during acquisition, secrets excluded from npm's child environment, and Unicode
  paths. Existing user state and credentials are not test inputs.
- Inject cancellation during pending-receipt writing and a publication failure;
  neither may leave a final success receipt. Post-commit cancellation does not
  retract an already published receipt.
- Two concurrent attempts at the same new destination must produce one claimant;
  only it may invoke npm. Test an owned npm child ignoring graceful termination;
  deadline/cancellation must not produce success, replacement or a false stop.
- Use actual npm pack/install in disposable prefixes and verify packed closure,
  installed help/refusal and bin metadata. No registry publication occurs.
- An opt-in installed-tarball test uses an explicitly selected already-populated
  npm cache for the real pinned provider, offline. CI supplies its disposable
  cache after runtime npm ci. Count it only when actually executed successfully.
- Integrate bounded bootstrap checks into Windows/Linux native CI. Browser/store
  release packages and current production device connections remain unchanged.
