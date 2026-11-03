# Agent Continue Device Bootstrap (Experimental)

This private, zero-dependency bootstrap acquires a pinned native provider and
official runtime-only tunnel client and prepares a device profile after one
explicit informed consent. Its private package version is 0.3.0, separate from
the browser extension's release version.
It is not a connected device, protected installer,
administrator/root setup, registered browser host, or npm registry release.

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

The installed `agent-continue-device` bin supports `help`, `version`, `stage`,
`acquire` and `setup`. The combined acquisition command is:

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
The client deadline is cooperative and bounded to 60 seconds; provider npm has
its own 180-second budget. Neither step retries automatically. Partial client
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
`setup` success is `status: configured`. These receipts describe different
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
