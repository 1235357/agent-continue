# Hosted Launcher Cold Module Boundary

## Evidence

The Windows workflow now passes both guided installer cases, then fails at
the hosted-launcher fixture's fifteen-second Start calls. The local baseline
passes, so the hosted watchdog's exact cause remains unproven. Inspection finds
another implicit-module dependency in the real acceptance launcher.

## Red And Green

Run a temporary launcher copy with PowerShell module auto-discovery disabled and
an absent module path. Old code cannot return a JSON Plan receipt. Explicit OS
Management/Utility imports using System.IO.Path fix that reproducible failure.
If import itself fails, return only a fixed JSON refusal before any staging.
Test real preview ZIP preflight, one-shot Start, unknown child results without
retry, key-reference preservation, invalid digests and archive safety as before.

## Scope And Remaining Evidence

No timeout, security check, receipt invariant or user consent is removed. No
production system or real hosted tunnel is changed by the disposable fixtures.
This repair is not proof the hosted-runner watchdog failure is fixed; inspect
the next exact CI run and keep installed-browser and publication gates open.
