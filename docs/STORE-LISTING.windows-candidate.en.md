# Windows Workflow Listing: 3.0.0 Unreleased Candidate

Upcoming identity: **3.0.0, UNRELEASED / candidate**. This is not the existing Store
listing or evidence of a release, saved draft, submission, approval or installation.
The [canonical English listing source](STORE-LISTING.en.md) and
[canonical privacy policy](../PRIVACY.md) now include the Windows disclosures;
this companion retains the candidate summary and concrete submission gates.
Do not upload until those gates are verified. Preserve the historical scheduler
v2.2.1 release and its assets; a new identity does not publish or approve itself.

## Name

Agent Continue - ChatGPT Workflow Tools

## Short Description

Schedule ChatGPT prompts and optionally connect Windows file, shell and process tools with explicit consent.

## Candidate Description Summary

Use the complete Description in [STORE-LISTING.en.md](STORE-LISTING.en.md) for the
eventual new listing draft, including its developer/support block. This summary
does not replace that disclosure or certify saved Store privacy-form answers.

Agent Continue helps you continue work in a chosen ChatGPT or Your dot
conversation. Schedule your own prompts, manage local queues, pause scheduled
sends, and inspect bounded local diagnostics. The interface defaults to English,
with Simplified Chinese available in Settings. Your prompts, file text and custom
names are not translated.

Optional Windows device tools require a separately installed local runtime and
explicit access choices. Run one reviewed PowerShell or CMD setup command, choose
current-account or administrator scope, and complete the required browser,
Windows and conversation approvals. No custom Agent Continue EXE/MSI installer
is required. Node.js and the official OpenAI tunnel client execute outside the
browser; a browser extension alone cannot operate your Windows shell.

An authorized conversation can use the selected Windows account to read and
write files, execute PowerShell or other shell commands and manage processes. Administrator
mode requests Windows elevation and grants administrator-level capability.
Tools are account-wide, not restricted to the extension folder; this is not a
sandbox. Operating-system protections still apply. Requests and returned data
travel through OpenAI to the selected conversation, not through a developer
relay. Arguments/results can include command text, sensitive file contents and
paths, terminal output and process details. Only enable this feature when you
intend that access. Browser permission, OS elevation and per-conversation tool
authorization are separate; success in ordinary ChatGPT does not establish Dot.

Standalone current-account setup does not register a browser host. Browser-managed
current-account setup registers the confirmed extension under HKCU; administrator
setup uses protected HKLM registration and an administrator-owner task. Installation
is not chat authorization. The administrator installer itself finishes paused.
Standalone current-account setup can request one connection with tunnel inputs
and connection consent (`CONNECT` in the guided prompt). Browser-managed guided
setup instead confirms `REGISTER` without starting the tunnel in that step. After exact installation
readback, the consented fresh-administrator flow may request one connection from
the unchanged initiating Setup page. Installation and connection can require
separate UAC approvals. Setup may download verified Node.js, npm dependencies and
the official client from nodejs.org, the npm registry and GitHub.

Device connection and prompt scheduling have separate Pause controls. You can
revoke the local administrator installation's future-start authorization and
revoke conversation access or runtime keys separately through OpenAI. Pausing
cannot undo earlier commands, retract transmitted results or necessarily stop
deliberately detached programs. Ordinary Disconnect and pause does not stop the
separate administrator runtime. Administrator Pause needs an exact receipt and
observed stop outcome; a request acknowledgement or revocation marker alone is
not proof every process stopped. Administrator browser-reopen restoration is off
unless explicitly enabled, must preserve manual Pause/Revoke, and may restore
only still-authorized saved-running intent.

File import and prompt scheduling do not require an API key or a separate
extension account. Optional hosted Windows tools require your own configured
OpenAI workspace/app, tunnel and local runtime key. Platform availability,
approvals, quotas and provider terms remain separate. The extension does not
increase quotas or guarantee delivery, exactly-once execution, task completion
or permanent website compatibility.

Keep the runtime key in a locally protected device file and enter only its path
in the local terminal. Never put the key in the extension, clipboard, copied
command, chat or issue. Current-account configuration references the file;
administrator binding copies it to protected `<bundle-root>.secrets/runtime.key`.
The original remains your responsibility. Access controls are not encryption or
a promise that plaintext secrets never exist in memory/on disk.

The pinned Desktop Commander dependency includes upstream telemetry, enabled by
default independently. Agent Continue disables it before provider imports using
both `telemetryEnabled: false` and `DESKTOP_COMMANDER_DISABLE_TELEMETRY=1`, and
validates that launch policy. Setup acquires dependencies with npm lifecycle
scripts disabled. This does not disable OpenAI traffic, downloads or network
activity requested through an authorized shell, and is not an all-traffic audit.

Local Windows tool history can retain arguments/results and sensitive content;
it is not the content-reduced extension activity log. Warning-level tunnel logs,
prepared-command files when used, device receipts and persistent administrator
control records are separate stores. Bounded control journals omit tool bodies
and results, but tool history/prepared requests can retain them. Expiry of a
prepared reference does not delete its command file. Durable browser operation
evidence survives Clear Data to prevent replay after uncertainty; deleting a
browser record does not cancel an OS operation. Check the original ID instead.

Clear Data removes the administrator restore preference but retains language
and durable operation evidence; it does not issue Windows Pause/Revoke. Clearing
browser data or uninstalling the extension does not remove the Windows runtime,
task/host registrations, protected credentials, original key file, local history
or already transmitted content. OpenAI access must be revoked separately. The
setup uninstall option currently produces a plan, not completed removal; review
and verify the applicable removal steps separately.

Free and open source under the MIT license.

Developer: Zhentong Ye
Email: zhentongye2028@u.northwestern.edu
Open-source project: https://github.com/1235357/agent-continue
Issues and suggestions: https://github.com/1235357/agent-continue/issues/new/choose
Author's LinkedIn: https://www.linkedin.com/in/tony-zhentong-ye/

Export diagnostics locally and review them before voluntarily attaching a
sanitized copy to a GitHub issue. Export does not upload or contact support.
GitHub issues are public. Do not share keys, cookies, configuration backups,
private documents, conversation bodies, prepared commands, native state
directories or raw runtime tool history.

Independent personal project; not an official OpenAI product. A university email
address does not imply university endorsement or support.

## Additional Permission Disclosure

Optional nativeMessaging lets the extension communicate with the separately
installed local Windows bridge for bounded status, connection, pause, revoke and
recovery operations and prepared-process reference checks. It does not install
software, elevate Windows or grant a conversation access. Hosted file/shell/process
requests use the official tunnel, not arbitrary commands in the browser bridge.
Host/scripting/storage/alarms/power uses and the complete optional-permission table
are in the canonical listing. No all-site, browser-cookie, clipboard or debugger
permission is added. Setup's user-gesture command copy can use the clipboard API;
the scheduler's send path does not use it. Browser permissions do not sandbox
the separately authorized Windows tools.

The privacy form must disclose actual website interaction, locally stored prompt/
task metadata and optional tool arguments/results transmitted through OpenAI.
Do not declare that Windows data never leaves the device: authorized tool results
can contain file contents, command output and process details. The developer has
no analytics/collection backend, but that does not eliminate the hosted data flow.
Use the final code/package and policy to determine exact store-form categories;
this draft does not certify those categories or legal/policy compliance.

## Evidence and Remaining Gates

Checkpoint65 records actual dedicated current-account installation, read-only
existing-install adoption and a reachable/paused native-bridge browser result.
Checkpoint64 independently cross-checked ordinary-web and Dot administrator
command/file/owned-process proof; an earlier GUI Pause was also observed. These
bounded results do not establish permanent readiness or full lifecycle delivery.
See [Runtime Acceptance](RUNTIME-ACCEPTANCE.md) for the dated evidence. This source
update does not reconnect the runtime or replay a settled operation.

- Finalize the upcoming 3.0.0 assets without replacing scheduler v2.2.1 assets.
- Verify one source revision and matching GitHub/store extension payloads.
- Verify the matching administrator runtime/helper/stager/setup checksum closure
  and the independently versioned npm installation contract from actual artifacts.
- Preserve the separate authenticated Dot, current-account and existing-install
  evidence; do not infer general reliability from these bounded trials.
- Complete new-runtime Revoke and reconnect/browser-reopen saved-running behavior
  with manual Pause/Revoke precedence; reconcile the recorded GUI stop with the
  final frozen artifact instead of repeating a settled operation.
- Verify final-artifact installation and acceptance, and reconcile canonical data
  handling and saved Store privacy/permission fields with those exact bytes.
- Replace screenshots with the actual final-candidate English-first UI, matching
  the submitted package rather than a historical scheduler or synthetic runtime.
- Verify public GitHub downloads/checksums and the real new Store submission
  receipt separately; submission is not approval. No publication is performed
  by this documentation-only update.
