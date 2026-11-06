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
conversation. Auto uses an available Send button in the target composer
before considering a keyboard shortcut. There is one submission attempt per
cycle; a missing receipt does not trigger another method in that cycle.
Manual pause and run authorization still apply.

Support exports can distinguish an existing draft from a detected composer
change with fixed event codes, without including the draft or prompt.
