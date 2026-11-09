# Mandatory Composer Priority

Every SEND, whether scheduled or requested with **Send once now**, owns the
bound conversation's unsent composer text and uses the configured prompt.
Existing text is replaced, not preserved or appended. Text changed after
filling, including while authorization is pending, must never abort the send:
the configured prompt is reasserted and sending proceeds subject to the
unchanged guards below. Composer text changes are not a reason to defer a cycle.
If the page replaces the text editor inside the same composer, the extension
refills it before dispatch. It does not follow an editor to another composer.

The task controls display this notice in English or Simplified Chinese:

> Scheduled sends replace unsent text in the bound conversation. Attachments are not submitted.

> 定时发送会替换绑定会话中的未发送文字，不会提交附件。

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

Detected attachments still block sending; they are not submitted. Manual
Pause, current run permission/authorization, and exact bound-target identity
checks remain in force. Mandatory text replacement does not authorize sending
to another conversation, bypassing a pause, or obtaining Windows/device access.

Automatic mode first uses an available Send button in the target composer;
otherwise it uses one Ctrl+Enter sequence in Dot or Enter in ordinary ChatGPT.
The button-only and Ctrl+Enter-only strategies remain explicit choices. There
is one submission attempt per cycle; a missing receipt does not trigger
another method in that cycle. Reasserting the configured text is not permission
to replay an already dispatched submission. An unconfirmed result remains
unknown, and a later attempt waits for the full normal interval.

Historical activity entries and fixed diagnostic codes, including
`existing-draft` and `composer-changed`, remain readable for compatibility;
they do not define the current sending policy. Support exports omit draft
and prompt bodies.
An upgrade clears the retired warning from the current task status without
replaying a send or deleting historical entries.
The explicit no-send timing diagnostic requires a paused, bound task. It records
only bounded timing values, fixed result codes and boolean observations in the
existing local history. Export schema4 includes those fields; it does not include
prompt text, conversation content, raw exceptions or target URLs.

This document specifies the current source contract, not an installation,
release, submission or live-site acceptance receipt. UI/config fixture tests
do not establish adapter/background enforcement or actual web delivery.
