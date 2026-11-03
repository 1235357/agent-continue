# Agent Continue Device Bootstrap (Experimental)

This private, zero-dependency package stages a pinned native runtime after
explicit acquisition consent. It is not a connected device, protected installer,
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

The installed `agent-continue-device` bin supports `help`, `version`, and:

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
npm, with its own licenses. The official OpenAI tunnel is a later separately
verified component. Neither provider credentials nor user state are packaged.

Developer: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu).
Source: [GitHub](https://github.com/1235357/agent-continue).
Report bugs or suggest improvements: [GitHub Issues](https://github.com/1235357/agent-continue/issues/new/choose).
Attach only diagnostics you have reviewed; never attach keys, native state or raw tool transcripts.
Author: [LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/).
