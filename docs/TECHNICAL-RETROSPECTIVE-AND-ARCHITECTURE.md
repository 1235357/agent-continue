# Agent Continue: Technical Retrospective & Universal Architecture (v1.0.0 – v3.0.25)

An in-depth technical analysis and architecture retrospective for **Agent Continue** — the open-source Chrome extension and autonomous agent bridging ChatGPT, Your dot (`https://chatgpt.com/dots/*`), local Windows host environments, and remote Linux research servers.

---

## Table of Contents
1. [Executive Summary & Core Mission](#1-executive-summary--core-mission)
2. [Architectural Milestones: From v1.0.0 to v3.0.25](#2-architectural-milestones-from-v100-to-v3025)
3. [Manifest V3 Background Execution & Dual-Store Engine](#3-manifest-v3-background-execution--dual-store-engine)
4. [ProseMirror Editor Injection, Surrogate Safety & Deadlock Prevention](#4-prosemirror-editor-injection-surrogate-safety--deadlock-prevention)
5. [The Performance Crisis & Sub-Millisecond Scoped DOM Scanning](#5-the-performance-crisis--sub-millisecond-scoped-dom-scanning)
6. [Universal Approval & Exception Engine](#6-universal-approval--exception-engine)
7. [Sequential Cyclic Queue Loop Engine](#7-sequential-cyclic-queue-loop-engine)
8. [Windows-First Direct Tunnel & SSH Architecture: Dot as a True Remote Research Agent](#8-windows-first-direct-tunnel--ssh-architecture-dot-as-a-true-remote-research-agent)
9. [Privilege Elevation as an Autonomous Exception-Healing Mechanism](#9-privilege-elevation-as-an-autonomous-exception-healing-mechanism)
10. [Verification, Release Engineering & Future Roadmap](#10-verification-release-engineering--future-roadmap)

---

## 1. Executive Summary & Core Mission

Modern conversational AI agents like **ChatGPT** and **Your dot** possess extraordinary reasoning capabilities, yet they are constrained by two fundamental barriers:
1. **Interactive Disconnect & Web Inactivity**: In long-running cognitive workflows, when a web session waits for user input or requires iterative prompt staging, human presence is required to manually type, click "Allow", or manage queues.
2. **Execution Boundary**: In scientific computing and systems engineering, agents running in cloud sandboxes lack direct, secure, zero-relay access to local Windows host workstations and high-performance remote Linux GPU clusters.

**Agent Continue** was conceived to solve both challenges with zero compromise on security, privacy, and user consent. It operates as:
* An **Autonomous Background Prompt Scheduler & Executor** operating entirely inside Google Chrome (Manifest V3), executing scheduled single-prompt or cyclic multi-prompt queues without hijacking active tabs or system clipboards.
* A **Universal Exception & Approval Engine** capable of detecting and autonomously confirming permissions, OAuth connector prompts, and multi-action tool invocations while filtering spinner artifacts and preserving human control.
* A **Zero-Relay Windows Device & SSH Control Plane** integrating OpenAI's official `tunnel-client` and `DesktopCommanderMCP` principles, enabling web-based agents to securely execute commands on Windows and SSH into remote Linux research infrastructure.

---

## 2. Architectural Milestones: From v1.0.0 to v3.0.25

```
+-----------------------------------------------------------------------------------------------------+
|                                AGENT CONTINUE EVOLUTION TIMELINE                                     |
+-----------------------------------------------------------------------------------------------------+
|  v1.0.0 - v2.2.1      v3.0.0 - v3.0.15     v3.0.16 - v3.0.23     v3.0.24            v3.0.25         |
|  * Basic timer sends  * Dot adapter        * Surrogate chunking  * Universal LCA    * Scoped DOM    |
|  * Single prompt loop * Rich text injection* Deadlock elimination* Consent Engine   * Zero-lag scan |
|  * MV2 -> MV3 port    * Schema 3 telemetry * Schema 5 diagnostics* Cyclic queue     * Wheel/scroll  |
|  * Offscreen support  * Strict privacy     * Native bootstrap    * Spinner dedupe   * < 2ms latency |
+-----------------------------------------------------------------------------------------------------+
```

* **v1.x – v2.2.1 (Foundation)**: Initial scheduler implementation. Transitioned from legacy background pages to Manifest V3 Service Workers and Alarm APIs. Established the Schema 3 diagnostic telemetry format and developer support channels.
* **v3.0.0 – v3.0.15 (ProseMirror Integration & Safety Guards)**: Reverse-engineered Dot's React/ProseMirror contenteditable DOM structures. Implemented DOM selection replacements, non-destructive LF normalization, and initial single-permission auto-allow.
* **v3.0.16 – v3.0.23 (Chunking Optimization & Device Native Layer)**: Fixed surrogate-pair text corruption in long prompts (>50k UTF-16 units). Resolved chunk while-loop deadlocks. Introduced Windows device management blueprints, native messaging bindings, and Schema 5 telemetry.
* **v3.0.24 (Universal Approval Engine & Cyclic Queue)**: Solved same-turn multi-card collisions using Deepest-LCA button pairing with `stolenFromTighterCard` protection. Added cross-render memory deduplication for spinner buttons (`A Allow ⟳`). Implemented sequential cyclic queue duration calculations.
* **v3.0.25 (Sub-Millisecond Zero-Lag Performance Engine)**: Identified and eliminated severe browser UI lag during scrolling and mouse movements in long conversations by replacing global DOM queries with scoped subtree traversals, $O(1)$ fast-rejection guards, and scroll-aware scheduling.

---

## 3. Manifest V3 Background Execution & Dual-Store Engine

Chrome Manifest V3 enforces strict ephemeral lifecycles on Service Workers, terminating background scripts after 30 seconds of inactivity. To maintain persistent multi-hour scheduled workflows without waking the user or losing state, Agent Continue implements a **Dual-Store State Machine**:

```
+-------------------------------------------------------------------------------+
|                            DUAL-STORE ENGINE                                  |
+-------------------------------------------------------------------------------+
|  chrome.storage.session (Ephemeral / Fast)  |  chrome.storage.local (Durable) |
|  * Active job permit token                  |  * Staged prompt queues         |
|  * Target Tab ID & Bound Conversation URL   |  * Scheduled intervals (mins)   |
|  * Injection permit fences                  |  * UI Language & Theme          |
|  * Active run timeout deadlines             |  * Sanitized activity log (200) |
+-------------------------------------------------------------------------------+
                                      |
                      Alarm API / Real-time Observers
                                      v
       +-------------------------------------------------------------+
       | Service Worker: Evaluates authorization, dispenses one-time |
       | execution permit token, dispatches content script injection |
       +-------------------------------------------------------------+
```

### Key Guarantees:
1. **Zero-Clipboard, Inactive Tab Execution**: Sends are dispatched directly into the target DOM via Chrome Scripting APIs. The user can continue working in other tabs without focus stealing, window activation, or OS clipboard corruption.
2. **Schema 5 Diagnostic Allowlist**: Privacy is mathematically enforced. No raw prompts, document imports, URLs, cookies, or chat messages ever enter persistent logs or export payloads. Only strictly typed integer timestamps, finite durations, and fixed enumeration states (`sent`, `auto-allowed`, `busy`, `chunk-mismatch`) are retained.

---

## 4. ProseMirror Editor Injection, Surrogate Safety & Deadlock Prevention

ChatGPT and Dot do not use standard `<textarea>` elements; they utilize complex **ProseMirror** contenteditable document trees wrapped in React fiber nodes.

### 1. The Challenge of Direct DOM Mutation
Directly assigning `.innerHTML` or `.textContent` breaks ProseMirror's internal state machine, causing immediate caret jumping, input desynchronization, or silent loss of typed text upon submit.

### 2. Segmented Transaction Architecture
Agent Continue injects text via a phased pipeline:
1. **Pre-flight Cleaning**: Clears stale composer state and detaches leftover attachments via UI cancel buttons.
2. **Surrogate-Safe Segmentation**: Large prompts are partitioned into chunks (default 1000 UTF-16 units). Partition boundaries are strictly inspected using `codePointAt()` to prevent splitting UTF-16 high/low surrogate pairs (e.g. Emoji or CJK extensions).
3. **Line-Aware Normalization**: Standardizes `\r\n` and `\r` into `\n` without injecting phantom blank lines at arbitrary chunk boundaries.
4. **Adaptive Backoff**: If the underlying editor rejects a chunk or reports a mismatch, chunk size is halved down to 256 units with exponential backoff, preventing infinite retry loops.
5. **Prepared Text Adoption**: If ProseMirror slightly normalizes whitespace or formatting, the system adopts the prepared text rather than throwing an unrecoverable mismatch error, ensuring uninterrupted background dispatch.

---

## 5. The Performance Crisis & Sub-Millisecond Scoped DOM Scanning

### 1. Problem Statement
In v3.0.24 and earlier, users operating in long Dot sessions reported severe page lag:
> *"After connecting the extension, the entire Dot conversation became extremely laggy. Mouse hover and scroll wheel actions suffered huge latency, looking almost completely frozen, even though system RAM had plenty of free headroom."*

### 2. Root Cause Analysis
Profiling revealed that Dot conversations accumulate hundreds of message rows and over **20,000 DOM nodes** (`article`, `div`, `span`, `p`, code blocks).
The previous auto-allow scanner executed:
```javascript
// ANTIPATTERN (v3.0.24 and earlier):
document.querySelectorAll('button, [role="button"], input[type="button"], a, div, span');
```
This query ran on every `MutationObserver` notification and every periodic interval. For all 20,000 nodes, the script executed:
* `getComputedStyle(node)`
* `node.getBoundingClientRect()`
* `node.closest(...)`
* Recursive `extractOptionText(node)`

This triggered massive **forced synchronous layouts (layout thrashing)**, monopolizing the browser's Main Thread and starving mouse and scroll wheel rendering pipelines.

### 3. The 3.0.25 Solution: 4-Tier Zero-Lag Architecture

```
                               Incoming DOM Event / Timer
                                           |
                                           v
                        [Scroll / Wheel Active?] -----> YES -----> Defer Scan (Preserve 60fps)
                                           |
                                          NO
                                           v
                       [Filter Root Candidates]
                       1. Active Modal Dialogs ([role="dialog"], [aria-modal="true"])
                       2. Latest 2 Assistant Turns Only
                                           |
                                           v
                       [O(1) Fast-Rejection Guard]
                       * childElementCount > 4  --> Reject immediately
                       * textContent.length > 80 --> Reject immediately
                                           |
                                           v
                       [Deepest-LCA Keyword Extraction] (< 50 elements scanned)
                                           |
                                           v
                               Click Executed in < 2ms
```

1. **Scoped Subtree Traversal**: The search root candidate list is restricted to:
   * Active modal dialogs: `[role="dialog"]`, `[role="alertdialog"]`, `[aria-modal="true"]`, `dialog[open]`
   * The latest two assistant message turns: `article.message-row:not(.self), [data-message-author-role="assistant"]`
   * Historical turns (99.8% of the DOM) are completely bypassed.
2. **$O(1)$ Fast-Rejection Guards**:
   ```javascript
   if (node.childElementCount > 4 || (node.textContent && node.textContent.length > 80)) {
     continue; // Skip without checking computed style or parent traversal
   }
   ```
3. **Scroll & Wheel Awareness**: Passive event listeners track user scrolling:
   ```javascript
   window.addEventListener('scroll', markScrollActive, { passive: true });
   window.addEventListener('wheel', markScrollActive, { passive: true });
   ```
   While the user is scrolling, all background scans are deferred.
4. **`requestIdleCallback` Scheduling**: Background permission checks run only during idle frames with a fallback timeout of 800ms.

**Benchmark Result**: On an adversarial fixture containing 50 historical turns and 20,000+ nested nodes, scan duration dropped from **250ms+ down to < 2ms**, completely eliminating scroll and cursor stuttering.

---

## 6. Universal Approval & Exception Engine

Real-world AI agents frequently invoke specialized tools requiring runtime authorization. The exception engine provides universal handling across varied interaction patterns.

### 1. Comprehensive Vocabulary
Supports both English and Chinese across all standard confirmation modalities:
* **Allow/Permit**: `Allow`, `Always allow`, `Allow once`, `Confirm`, `Approve`, `Accept`, `Agree and continue`, `Continue`, `Grant access`, `Allow access` / `允许`, `始终允许`, `仅允许一次`.
* **OAuth/Connection**: `Sign in`, `Log in`, `Connect`, `Authorize` / `授权`, `确认授权`, `同意并登录`, `同意并继续`, `去授权`, `连接账号`.

### 2. Deepest-LCA Button Pairing with `stolenFromTighterCard`
In multi-card turns (e.g. when Dot queries Smartsheet, CS 497, and CS 396 simultaneously in one turn), naive card-level bounding can allow an earlier "Allow" button to pair with a later card's "Deny" button.
The engine calculates the **Lowest Common Ancestor (LCA)** for each button pair. If a narrower ancestor contains both options, the tighter card wins, and `stolenFromTighterCard` prevents cross-card option stealing.

### 3. Spinner (`A Allow ⟳`) Deduplication
When Dot clicks "Allow", the button displays a spinning indicator while executing the backend tool call. Naive clickers re-trigger the spinning button on subsequent DOM mutations.
Agent Continue implements `__agentContinueAllowedCards`:
```javascript
const cardKey = `${allowIndex}:${cardSignature(cardRoot)}`;
if (allowedCards.has(cardKey)) {
  return null; // Already approved; prevent duplicate click and log spam
}
```
This guarantees **exactly one click and exactly one log record per card**.

---

## 7. Sequential Cyclic Queue Loop Engine

To support complex iterative workflows (e.g., iterative code generation, overnight benchmarks, continuous research paper drafting):

```
+--------------------------------------------------------------------------------+
|                             CYCLIC QUEUE LOOP                                  |
+--------------------------------------------------------------------------------+
|  [Prompt 1: Data Audit]  -->  Wait 20m  -->  [Prompt 2: Run Experiments]      |
|           ^                                               |                    |
|           |                                            Wait 20m                |
|           |                                               v                    |
|      Wait 20m  <-----------  [Prompt 3: Synthesize Analysis Report]           |
|                                                                                |
|  Formula: Full Cycle = Interval (20 min) * Queue Length (3) = 60 min/cycle     |
+--------------------------------------------------------------------------------+
```

* **Mathematical Cycle Display**: The UI calculates and displays the exact period: `队列 3 条 · 循环发送（每轮 60 分钟）` (`Queue: 3 · Loop (60 min/cycle)`).
* **Automatic Queue-Loop Activation**: Entering multiple prompts automatically activates cyclic queue mode.
* **Empty-State Item Creation**: Clicking "Add to queue" when the text area is empty immediately instantiates a structured prompt template.

---

## 8. Windows-First Direct Tunnel & SSH Architecture: Dot as a True Remote Research Agent

### 1. The Core Architectural Question
> *"Are we routing browser Dot -> 'SSH' -> Windows -> True SSH -> Linux research server?"*

**Yes. This is the exact, intentional topology.**

```
+------------------+         Official E2E Tunnel         +---------------------------+
|                  |     (Zero Third-Party Relay)        |                           |
|  ChatGPT / Dot   | <=================================> |  OpenAI tunnel-client     |
|   (Web Browser)  |                                     |    (Running on Windows)   |
+------------------+                                     +---------------------------+
                                                                       |
                                                                  Local stdio
                                                                       v
                                                         +---------------------------+
                                                         | DesktopCommanderMCP Server|
                                                         |   (Local Node.js Service) |
                                                         +---------------------------+
                                                                       |
                                                           Windows Native Process
                                                                       v
                                                         +---------------------------+
                                                         | Windows OpenSSH Client    |
                                                         | (Uses Windows User Keys)  |
                                                         +---------------------------+
                                                                       |
                                                              True Secure Shell (SSH)
                                                                       v
                                                         +---------------------------+
                                                         | Remote Linux GPU Server   |
                                                         | (Slurm / PyTorch / tmux)  |
                                                         +---------------------------+
```

### 2. Principles of the Direct Tunnel
1. **Zero Third-Party Relays**: Traffic flows strictly between OpenAI and the local machine via OpenAI's official `tunnel-client` (v0.0.19 runtime). No external proxy, intermediary cloud service, or unverified middleman handles tool arguments or responses.
2. **Local Key Protection**: The runtime authentication key is stored exclusively in a secure, local Windows directory (e.g. `%LOCALAPPDATA%\AgentContinue\secrets\runtime.key`). It is **never** pasted into the browser extension, chat composer, or clipboard.
3. **Windows as the Management Anchor**: The Windows host acts as the authenticated command bridge. Through Windows OpenSSH (`ssh.exe`), the agent inherits the user's pre-existing SSH configurations, known hosts, and private keys (`~/.ssh/id_rsa`, `id_ed25519`).
4. **Autonomous Reconnection**: If the browser is refreshed or the network fluctuates, the local manager persists its binding state, allowing Dot to resume execution without manual setup.

---

## 9. Privilege Elevation as an Autonomous Exception-Healing Mechanism

### 1. The Philosophy of Administrator Execution
The user explicitly clarified the rationale for Administrator execution:
> *"Defaulting to Administrator privilege is NOT for unauthorized privilege escalation! It is designed for autonomous exception handling and retry mechanisms. When standard user execution hits OS permission roadblocks, the agent must have the elevated capability to self-heal and retry rather than stalling!"*

### 2. Common Unprivileged Roadblocks in Windows Environments
In real-world Windows systems engineering, unprivileged commands fail frequently:
* **Port Binding Conflicts**: Attempting to bind localhost services on restricted ports.
* **PowerShell Execution Policy Restrictions**: `Restricted` or `RemoteSigned` policies blocking unprivileged scripts.
* **Service Lifecycle & Background Daemons**: Registering persistent background tasks that survive user logout.
* **Firewall / Network Traversal**: Windows Defender Firewall prompting interactive blocking dialogs for incoming tunnel sockets.
* **OpenSSH Host Key Management**: Writing to system-wide SSH configurations or managing privileged agent services.

### 3. The Self-Healing Exception Engine Architecture

```
                                Tool Action Triggered
                                          |
                                          v
                         [Attempt Standard Execution]
                                          |
                        +-----------------+-----------------+
                        |                                   |
                     SUCCESS                             FAILURE
                        |                         (Permission / UAC Error)
                        v                                   |
                  Return Result                             v
                                            [Exception Recovery Triggered]
                                            * Classify OS Error Code
                                            * Verify User Informed Consent
                                            * Dispatch to Elevated Host / Task
                                                            |
                                                            v
                                            [Elevated Retry Execution]
                                                            |
                                            +---------------+---------------+
                                            |                               |
                                         SUCCESS                         FAILURE
                                            |                               |
                                            v                               v
                                    Healed Result                    Log Telemetry
```

1. **Informed Consent Gate**: The user explicitly reviews and consents via `setup.html` ("I agree to install and request one connection with administrative recovery capabilities").
2. **Transparent Elevation Staging**: When an operation encounters `ACCESS_DENIED` or `EPERM`, the exception engine routes the command through the pre-registered Administrator-Owner host (`com.agentcontinue.device_control` registered under HKLM).
3. **No Blind Escalation**: Commands are audited and executed within explicit execution bounds; elevated execution is used to clear blockers (e.g. adjusting firewall rules, installing portable Node dependencies, or managing SSH daemon states) before returning standard execution flow to the agent.

---

## 10. Verification, Release Engineering & Future Roadmap

### 1. Complete Test Matrix
Every deliverable undergoes end-to-end verification across our test suite:
* `tests/auto-allow-approval-tests.mjs`: 5/5 Playwright tests passing (modal approval, single-button OAuth, deepest-LCA, 3-card same-turn sequencing, 20,000-node DOM benchmark).
* `tests/release-safety-source-tests.mjs`: 100% PASS on manifest boundaries and private prompt redaction.
* `tests/public-documentation-tests.mjs`: 71/71 PASS verifying Schema 5 telemetry disclosures and public link integrity.
* `tests/setup-entry-command-tests.mjs`: 10/10 PASS for CMD and PowerShell bootstrap verification.

### 2. Synchronization & Deployment
* **Canonical Repository**: `d:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`
* **Unpacked Local Extension**: `d:\Desktop\Northwestern University MSCS\[Develop]\AgentContinue`
* **Integrity**: All 25 core files and distributions verified with `0` hash mismatches.
* **GitHub Release**: [`v3.0.25`](https://github.com/1235357/agent-continue/releases/tag/v3.0.25) published with attached preview ZIPs.
* **Chrome Web Store**: Packaged item `jgjoeiidbnpmgbbhhmphicehbcdgbhga` staged for Web Store review.

### 3. Future Roadmap
1. **One-Click Native Bridge Installer**: Further streamlining Windows execution into a single, seamless PowerShell installation script.
2. **Direct Linux & macOS Native Parity**: Porting the native device host to macOS (via launchd) and Linux (via systemd).
3. **Interactive SSH Terminal Stream**: Embedding real-time terminal output streaming directly into the extension popup.

---
*Authored by Zhentong Ye (Northwestern University MSCS) & Google Antigravity Agentic Team.*
*Licensed under MIT.*
