# Windows Tunnel & SSH Security Architecture

The optional Windows runtime uses the official OpenAI tunnel service to carry
authorized tool requests and results. There is no Agent Continue relay, but
tool data passes through OpenAI; this is not peer-to-peer browser-to-Windows SSH.

Current-account tools run with that account's existing privileges. Administrator
setup is separate and requires Windows elevation. Browser native messaging,
local runtime setup, and conversation tool access are separate grants. A
permission or connectivity error never grants an elevated retry.

Remote Linux SSH is outside the Windows-first delivery gate. This extension
does not enroll remote hosts, manage SSH keys, or establish remote SSH sessions.
See the [architecture and acceptance criteria](WINDOWS-DIRECT-TUNNEL-SSH-ARCHITECTURE.md)
and the [privacy disclosure](../PRIVACY.md).
