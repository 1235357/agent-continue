# Windows Tunnel & SSH Security Architecture

This document details how Agent Continue enables secure, direct host-to-host connectivity between web-based AI agents (Dot/ChatGPT) and local/remote infrastructure.

## 1. Zero Third-Party Relay Topology
Our architecture strictly adheres to **End-to-End Tunneling**.
* **Traffic Flow**: OpenAI Tunnel Runtime (`openai/tunnel-client`) $\leftrightarrow$ `DesktopCommanderMCP` $\leftrightarrow$ Local Windows Host.
* **Security Constraint**: **NO** external cloud relay, third-party proxy, or unverified middleman handles tool arguments or responses.

## 2. Windows-First Control Anchor
The Windows host serves as the authenticated anchor. The extension does not manage keys; it only orchestrates commands that invoke native OS tools.
* **SSH Authority**: The system leverages the native Windows OpenSSH client (`ssh.exe`).
* **Key Integrity**: SSH keys and the OpenAI runtime key remain exclusively in protected Windows local storage (`%LOCALAPPDATA%\AgentContinue\secrets\`). They are never transferred to the browser extension memory space.

## 3. Administrator Elevation as Self-Healing
Elevation is reserved strictly for autonomous exception handling:
* **Roadblock Clearance**: If standard user execution fails (e.g., Firewall rules, PowerShell Execution Policies, Task Scheduler registration), the exception engine triggers an elevated retry.
* **Informed Consent**: Elevation is never default. It requires explicit user approval through the extension setup UI.
* **Auditability**: Administrative actions are audited and restricted to pre-defined "Healing" command paths.
