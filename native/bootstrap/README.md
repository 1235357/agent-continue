# Agent Continue Device Bootstrap (Experimental)

This private, zero-dependency bootstrap acquires a pinned native provider and
official runtime-only tunnel client after one explicit informed consent.
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

The installed `agent-continue-device` bin supports `help`, `version`, and a
combined preparation command:

```sh
agent-continue-device acquire --install-dir "<absolute-new-directory>" --consent full-account
```

This stages Desktop Commander 0.3.1 through the existing locked npm acquisition,
then downloads the pinned OpenAI tunnel-client **runtime-only v0.0.19**, verifies
the archive/executable/SBOM SHA-256 values, and retains the licenses. Supported
asset mappings are Windows, Linux and macOS, x64/arm64. Acquisition does not run
the client. It uses the official GitHub release directly, not a developer relay.
The receipt states `status: acquired` and `configured: false, activated: false`.
Actual account/tunnel binding, OS elevation, browser registration and startup
integration remain separate unfinished work, not another consent dialog.

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
It does not run upstream hosted `remote`, configure a tunnel or clear a pause.
Trusted Node/npm and package distribution remain prerequisites, not guarantees
provided by filename checks or a self-authenticating manifest.

Success is only `status: staged`: source/provider inventory verified, but
configuration, activation, protected installation and native dependency usability
remain false/unverified. Failed/interrupted targets are retained without a
success receipt and cannot be automatically reused or repaired. An unconfirmed
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
for official online acquisition, or `AGENT_CONTINUE_OFFICIAL_ARCHIVE` for its local
ZIP. Without those options the corresponding real acceptance is skipped.
Tests do not imply privileged installation or a connected device.

Developer: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu).
Source: [GitHub](https://github.com/1235357/agent-continue).
Report bugs or suggest improvements: [GitHub Issues](https://github.com/1235357/agent-continue/issues/new/choose).
Attach only diagnostics you have reviewed; never attach keys, native state or raw tool transcripts.
Author: [LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/).
