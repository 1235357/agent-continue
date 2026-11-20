# Performance Engine Optimization (v3.0.25)

This document explains the technical architecture behind the **3.0.25 Zero-Lag Performance Engine**, which solved severe browser UI stuttering in long Dot conversations.

## 1. The Performance Crisis
In earlier versions, the auto-allow scanner executed `document.querySelectorAll()` across the entire DOM tree of thousands of nodes on every mutation. This triggered:
* **Forced Synchronous Reflows**: `getComputedStyle()` calls on 20,000+ nodes caused layout thrashing.
* **Main Thread Starvation**: The browser's main thread was monopolized, rendering mouse movement, hovers, and scroll wheel actions unresponsive (laggy/frozen feel).

## 2. The 3.0.25 Solution: 4-Tier Zero-Lag Architecture
We implemented a multi-tiered filtering system to ensure scan operations consume < 2ms of main thread time.

### A. Scoped Subtree Traversal
Instead of scanning the whole DOM, the search root is restricted:
1. **Modal Dialogs**: Only scans `[role="dialog"]`, `[aria-modal="true"]`, etc.
2. **Latest Assistant Turns**: Only the last 2 assistant turns (`article.message-row:not(.self)`) are processed. 
*Historical nodes are bypassed entirely.*

### B. $O(1)$ Fast-Rejection Guards
```javascript
if (node.childElementCount > 4 || (node.textContent && node.textContent.length > 80)) {
  continue; // Skip node without heavy style/geometry computation
}
```

### C. Scroll & Wheel Awareness
We attach passive event listeners to `window`:
```javascript
window.addEventListener('scroll', markScrollActive, { passive: true });
window.addEventListener('wheel', markScrollActive, { passive: true });
```
When active scrolling is detected, all background scans are deferred to preserve 60fps scrolling performance.

### D. Idle Scheduling
All scans are scheduled via `requestIdleCallback` to run only when the browser is idle.
