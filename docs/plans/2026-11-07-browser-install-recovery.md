# Browser-Managed Installation Readback

## Problem

The primary browser-managed setup configures a provider and registers a wake
bridge without reserving the standalone installer's reconnect operation. Its
documented `installer-status` command therefore cannot reconcile registration.
Reinstalling an existing root is deliberately refused, and must not be used as
an observation mechanism.

## Technical Plan

Add an explicit, read-only `browser-install-status --install-dir PATH` command.
Verify the existing provider, device binding and tunnel-profile metadata first.
Inspect the fixed wake wrapper/manifest and all four Chrome registry hive/view
combinations. Report configuration, bundle and registration separately. Do not
start Chrome, Node owners, tunnels or commands; do not write a registration or
clear a pause. An unknown registry read is not an absent registration. A matching
pointer without the expected file bytes is not a verified registration.

## Alternatives

Do not repurpose the standalone reconnect receipt: it records a different action.
Do not retry installation or call the idempotent publisher from an inspector,
because either may mutate state. Keep `manager-status` behavior unchanged.

## Implementation And Acceptance

Use the existing wake layout/byte contract and provider verifier, with an
independent read-only inspector in `browser-wake-registration.mjs`. Add closed
CLI dispatch in bootstrap and npm entrypoints, then the PowerShell device-action
alias. Tests must cover absent, matching, conflicting and unreadable registry
states, missing/tampered bundle, binding changes and refusal of command/consent
arguments. Snapshot fixture state to prove no publication or file changes.

Read every hive/view even if another slot is unreadable. Preserve known conflicts
and incomplete coverage separately. Recheck the binding after the last bundle
read and the tunnel configuration after registry inspection. When the inspecting
Node differs from the exact stored wrapper's interpreter, report that mismatch
and leave configuration unverified; do not execute the inferred interpreter or
declare the unchanged wrapper broken.

The existing administrator bundle and browser enrollment are out of scope.
Synthetic inspection tests and temporary Chromium protocol tests do not prove
ordinary ChatGPT/Dot access. An inspection result describes current observations,
not the outcome of a particular interrupted registry write or a live connection.
