# Extension Priority

The default preserves an existing draft. Equivalent paragraph rendering
changes are no longer treated as edits: the adapter compares the actual
plain text, including whitespace, instead of display-dependent line breaks.

To allow the extension to replace unsent text, pause the current task, turn on
**Extension priority: allow replacing unsent text** in Settings, and start a
new task on the intended conversation. **Resume** intentionally reuses the
original task's settings. This setting is not granted by imported JSON.

Priority mode sends only the configured prompt. It may replace unsent text,
never submits existing attachments, and does not move to a different
conversation. Auto uses one Ctrl+Enter sequence in Dot and an available Send
button in ordinary ChatGPT. The button-only and Ctrl+Enter-only strategies
remain explicit choices. There is one submission attempt per cycle; a missing
receipt does not trigger another method in that cycle.
Manual pause and run authorization still apply.

Support exports can distinguish an existing draft from a detected composer
change with fixed event codes, without including the draft or prompt.
The explicit no-send timing diagnostic requires a paused, bound task. It records
only bounded timing values, fixed result codes and boolean observations in the
existing local history. Export schema4 includes those fields; it does not include
prompt text, conversation content, raw exceptions or target URLs.
