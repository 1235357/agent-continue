# Scheduler Queue Logic

This document explains the autonomous background scheduling engine, designed for continuous cognitive tasks without human supervision.

## 1. Dual-Store State Machine
Manifest V3 Service Workers have short lifecycles. Agent Continue persists state through a dual-store mechanism:
* **`chrome.storage.session`**: Ephemeral, fast-access store for volatile run-time data (permit tokens, active tab ID).
* **`chrome.storage.local`**: Durable store for staged prompt queues, intervals, and sanitised logs.

## 2. Cyclic Queue Loop Engine
For long-running tasks (e.g., continuous research iteration), the scheduler supports cyclic queues:
1. **Prompt Staging**: Multiple prompts are added to an ordered queue.
2. **Interval Management**: Each prompt has an associated interval (default 20m).
3. **Looping**: Upon completion of the final prompt, the scheduler automatically resets the pointer to the first prompt, creating a `Continuous Loop`.

## 3. Mathematical Cycle Display
The UI dynamically calculates the total cycle duration:
`Full Cycle = (Interval * Number of Prompts)`.
This value is surfaced to the user to maintain predictability during overnight or long-term task execution.
