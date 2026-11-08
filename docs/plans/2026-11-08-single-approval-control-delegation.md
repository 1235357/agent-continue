# One Setup Approval, Fixed Windows Controls

## Delivery Priority Clarification (Checkpoint58)

The owner asked for one practical setup command, not a literal one-UAC promise.
Do not block the minimal consented installation/continuation pipeline on building
a new privileged broker. The existing checked runas path is the near-term route;
disclose that Windows may approve installation and connection separately.
Fixed delegation below remains a future hardening option, not a current release
prerequisite, a deployed task, or permission to bypass Windows authorization.
Installation-wide Pause and exact original-operation admission remain required.

## Observed Gap

The command-only installer requests one UAC for installation. This is NOT proof
that the whole install-and-connect flow requests only one UAC: the current
New-AdministratorBrowserControlLaunchPlan and Pause launch plans separately use
Verb=runas. The combined UX must not conceal or miscount those later approvals.
An extension checkbox cannot elevate an ordinary process by itself.

The existing protected installation already grants browser-owner task execution
for an exact origin/account. The next bounded change should delegate ONLY the
fixed Connect, Pause and Revoke control protocol during the explicit install
approval, without creating another resident watchdog or accepting arbitrary
PowerShell from extension messages. Remote shell capability remains the separate
owner-approved MCP tool boundary.

## Required Implementation Contract

1. Register a fixed, sealed per-installation on-demand control entry during the
   existing elevated installation transaction. Keep ordinary-account setup and
   the scheduler independent. Preserve exact origin, account, session and bundle
   identities, real high-token checks and the current durable control ledger.
2. Do not interpolate untrusted task arguments into PowerShell, cmd, an encoded
   command or another executable selector. A fixed no-argument task plus bounded
   authenticated local IPC is a candidate, not an accepted implementation.
   Validate the actual IPC peer process, token and native-host/browser ancestry,
   not a PID supplied in JSON. Clear unsafe inherited runtime environment before
   launching Node, as the existing protected paths do.
3. Dispatch only the existing closed control actions and original operation IDs.
   The broker must hand off quickly rather than hold a long Connect audit that
   prevents a concurrent manual Pause. No unknown outcome may create a new ID,
   replay a task action, or be reported as stopped/connected.
4. Installation-wide Pause must record denial under the control gate even if an
   earlier Connect changed its target. Preserve legacy targeted-Pause semantics
   for explicit callers. Stop is established only after owned leases/Jobs settle.
5. Use the same-document setup coordinator and atomic setup association, not URL
   flags or stored consent alone. Worker replacement does not implicitly resume
   an unadmitted install. A later explicit manual Connect remains available.

## Acceptance Before Activation

- Count actual UAC requests in a fresh combined install/connection trial. Do not
  call an installer-only count the total. Windows denial must stop the sequence.
- Verify ordinary and high tokens, exact task/ACL/source readback, wrong origin,
  SID, session, bundle, peer PID reuse, environment injection and malformed IPC.
- Race full Connect verification with manual Pause/Revoke and a second control
  request. Confirm original IDs, denial, then actual owned-process shutdown.
- Exercise browser close/reopen, saved-running intent, manual pause preservation,
  key revocation, partial install and compatible existing-install behavior.
- Rebuild the complete sealed runtime after any native source change. Test the
  exact final package through ordinary ChatGPT and Dot before Release/Store.

This is a development plan, not deployed delegation, a passing UAC test or a new
authorization receipt. Current acceptance installation and production connections
remain untouched. No new service/task is created merely by writing this plan.
