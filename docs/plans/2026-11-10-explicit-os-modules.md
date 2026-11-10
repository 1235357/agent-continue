# Explicit Installer Module Initialization

## Problem And Evidence

Two hosted Windows runs stop before the first guided prompt after the fixed
utility preparation marker. That marker precedes Join-Path, not just Import-Module.
The current test loads Management itself, masking the initializer's dependency.
This observation motivates a cold dependency regression; it does not prove the
intermittent hosted symptom's cause.

## Red And Green

Remove the test's Management preload, keep discovery disabled and a missing
PSModulePath. The unmodified initializer fails with Join-Path unavailable.
Replacing Join-Path alone allows imports but Get-FileHash fails because Resolve-Path
is also in Management. Import OS Management, Utility and Archive explicitly,
constructing paths with System.IO.Path before any dependency cmdlet is used.
Retain the no-preload assertion, fixed phase diagnostics and all refusal checks.

## Scope

Do not change caller module paths or autoload preferences, security verification,
installer consent, native access, terminal deadlines or scheduler waiting rules.
No production deployment or new grants. Paired and cold-CMD loopback tests,
complete setup-release tests and the future hosted CI result remain separate
evidence. Rebuild the combined setup and public pair before any publication.
