# Mandatory Composer Priority

Every SEND, whether scheduled or requested with **Send once now**, owns the
bound conversation's unsent composer text and uses the configured prompt.
Existing text is replaced, not preserved or appended. If the composer changes
while the prompt is prepared, the candidate reasserts it and continues subject
to the guards below. A continually changing page can prevent completion.
If the page replaces the editor or the entire composer, the extension reacquires
the unique composer inside the same verified conversation and refills it before
dispatch. A detached document can be replaced through a fresh, background-owned
admission only when non-submission is established; if it cannot be established,
the candidate pauses rather than replaying the attempt. Readiness preparation continues
without a fixed total waiting deadline while the job remains authorized. The
event adapter uses bounded per-pass settling, rechecks authorization afterward, and
delivers a final replacement through input events, not a silent DOM repaint.
For short text in a selected editor exposing Tiptap's documented `dom.editor.view`
owner, a fixed MAIN-world helper can apply a ProseMirror transaction and attempt
submission. Long or many-line text uses the event adapter: its initial source
segment is at most 1,000 UTF-16 units and prefers paragraph or line boundaries;
slow writes and rejected or mismatched chunks reduce the segment size on retry,
without splitting a Unicode surrogate pair. Segment boundaries do not intentionally
add newlines, including splits inside a line. The saved source is unchanged, but
CR and CRLF are normalized to LF in the prepared text. The adapter
does not intentionally create an attachment. If a segment is rejected or differs,
it retries a full replacement; prior text must remain a prefix after each write.
A final-segment difference is rechecked after a short authorized wait; if it
settles exactly to the prepared text, no second full selection is necessary.
When two complete passes have the same differences at the same chunk boundaries
and the same final text, the candidate pauses with `chunk-mismatch` and does not
dispatch that changed text. Stable corruption and site normalization cannot be
universally distinguished from DOM observations alone. A synthetic decoration
can become part of the editor model before its original node is removed; in that
case the current candidate stops instead of recovering automatically.
The content-free `rejectedChunks` counter records calls that did not report both
acceptance and an input event; it does not establish why the page rejected them.
`prefixRewriteRestarts` counts detected changes to an already verified prefix;
`chunkSettlementRestarts` counts a changed serializable draft after the
between-chunk wait. `chunkUnserializableChecks` counts each unsuccessful
post-write, between-chunk or final-settlement serialization, including repeats;
older exports lack this field and must not be interpreted as zero checks.
`chunkUnserializableRestarts` counts an unserializable
post-write or settled draft that triggers a restart. During persistent delivery,
an unreadable post-write or between-chunk draft is instead rechecked without
another write until it can be serialized or the run is cancelled.
`chunkUnserializableRecoveries` counts cases where the readable draft exactly
matches the expected post-write text or the prior verified prefix.
These counters do not identify the underlying website cause. A verified cancel
acknowledgement includes its current content-free snapshot; a missing or invalid
acknowledgement and events after that snapshot can still leave gaps.
`serializationMs` and `maxSerializationMs` measure local plain-text inspection
separately from synchronous write time; neither is a website CPU profile.
An exact DOM match does not establish an independent site send model is current;
an unresolved synthetic stale-model counterexample submitted wrong text despite
an exact DOM match. DOM checks do not guarantee that the intended text is sent.

The background validates the current job, frame, tab, URL, run and deadline,
records a one-attempt marker, and supplies the saved prompt rather than accepting
a page-supplied command or payload. Run identifiers are never injected into MAIN.
Only an explicit unsupported-view result before mutation allows event fallback;
an uncertain or attempted model submission does not. A helper attempt alone is
not a delivery receipt. The isolated adapter must still see a new user message.

The task controls display this notice in English or Simplified Chinese:

> Sending replaces drafts and removes pending attachments; CR/CRLF become LF. Wrong text or duplicate sends are possible; check the conversation.

> 发送会覆盖草稿并移除待发送附件；CR/CRLF 会规范为 LF。可能错发正文或重复发送，请核对会话。

There is no optional Extension Priority checkbox. **Start** and **Resume** are
explicit user actions; no new modal, permission request or runtime access grant
is introduced. **Resume** keeps the original task's prompt, target, interval and
counts, but cannot restore the retired draft-protection policy. Pausing still
allows a separate configuration draft to be edited; starting a new task uses
that draft without modifying the paused task's configuration.

## Configuration Compatibility

The legacy `extensionPriority` key remains accepted and boolean-validated.
Its default and normalized value are always `true`. Stored or imported `false`
cannot opt out; a non-boolean value is invalid. Reading old configuration does
not itself start a task. The popup does not read or write a checkbox, and its
configuration normalization cannot restore `false`. The adapter/background
must enforce the same mandatory policy for saved tasks independently of this
compatibility field.

## Unchanged Guards and Delivery Limits

Pending attachments do not end a round. Their website-scoped removal controls
are activated and pending file inputs are cleared before sending pure prompt
text. Original local files and account-stored files are not deleted. If a pending
attachment cannot yet be detached, readiness waits until it can be removed or
the user pauses; it must not accidentally upload that attachment. Manual Pause,
current run permission/authorization, and exact bound-target identity checks
remain in force. Mandatory text replacement does not authorize sending
to another conversation, bypassing a pause, or obtaining Windows/device access.

Automatic mode first uses an available Send button in the target composer;
otherwise it uses one Ctrl+Enter sequence in Dot or Enter in ordinary ChatGPT.
The button-only and Ctrl+Enter-only strategies remain explicit choices. There
is one actual submission mechanism per attempt; a missing receipt does not trigger
another method in that attempt. A control disappearing before dispatch is not an
attempt and can be recovered without waiting for the full scheduled interval.
In the current source candidate, a terminal unknown send result pauses without
incrementing confirmed sends, even without recorded dispatch evidence. Missing
evidence does not prove that nothing was sent: inspect the conversation before
explicitly selecting Resume, which may submit the unconfirmed prompt again.
An unknown reply-check result instead becomes a waiting error and is retried;
it is not a terminal unknown send result.
Manual-send uncertainty, mismatched or ambiguous receipts, attachment and some
interrupted-document cases also pause. An active receipt wait has no fixed
overall cutoff, so it may wait until Pause without reaching a terminal result.
Page-level confirmation is not a server receipt and is not exactly-once delivery.
On recovery, an enabled legacy idle task with a nonzero cumulative unknown count
can be conservatively paused even when the earlier unknown was already resolved.
The historical count alone does not prove a current unresolved submission; check
the conversation before deciding whether to resume. Historical entries are retained.
Pause preserves an in-flight send permit deadline before waiting for cancellation,
including when a MAIN commit is in flight. The deadline acts as a fence against
starting or resuming tasks while it remains in force; Clear Data may retain it.
An ACK reporting a dispatch without a receipt is recorded as unknown. Expiry only
ends the deadline-based block; it does not prove that the message was not sent.
Neither the fence nor a cancellation acknowledgement can retract a previously
issued operation. Check the conversation before resuming; recovery after all
storage writes fail remains unproven.

Historical activity entries and fixed diagnostic codes, including
`existing-draft` and `composer-changed`, remain readable for compatibility;
they do not define the current sending policy. Support exports omit draft
and prompt bodies.
An upgrade clears the retired warning from the current task status without
replaying a send or deleting historical entries.
The explicit no-send timing diagnostic requires a paused, bound task. It records
only bounded timing values, fixed result codes and boolean observations in the
existing local history. Export schema5 includes those fields; it does not include
prompt text, conversation content, raw exceptions or target URLs.

This document specifies the current source contract, not an installation,
release, submission or live-site acceptance receipt. UI/config fixture tests
do not establish adapter/background enforcement or actual web delivery.
