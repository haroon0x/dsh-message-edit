# dsh-message-edit

Edit a message you have already sent in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web UI.

## What it does

Adds an **Edit** action above each of your sent user messages. Clicking it opens the message text in an inline editor. Press **Save & branch** to:

1. Fork the session at the event just before that message,
2. Open the resulting branch,
3. Send your edited text as the first prompt of the branch.

The original session and everything after the edited message stays untouched — DSH history is append-only, so editing is implemented as a branch (same semantics as Claude Code's message editing).

## File rewind (v2)

Forking branches the conversation, not the filesystem: without extra help the files the original turn touched stay modified on disk. For a message that was the session's **last user turn**, v2 adds an "Also revert the N files this turn changed" option. Reverting restores each file the turn changed to its turn-start content and deletes files the turn created, using the per-turn snapshots the DSH workspace-changes recorder already keeps.

A file is only restored when its current content still matches the recorded turn-end state; a file modified again afterwards is skipped, never clobbered. Binary and oversized files are skipped. An older message (not the last user turn) branches without the rewind option.

## Limitations

- Text-only messages (attachments are not carried over to the branch).
- Forks create a new session rather than rewriting history in place.
- Requires the DSH web UI (Client plugin); works with any provider route.
- Rewind covers files the workspace-changes recorder captured for that turn (shell edits outside git, binary or oversized files, and turns from before a Host restart are not covered).

## Install

Use the DSH plugin manager with this directory (or publish the package and install by name):

```
plugin_manager → install_bundle → /path/to/dsh-message-edit
```

Then refresh the DSH web page. The **Edit** button appears above sent user messages.

## Uninstall

Disable or remove the `@local/message-edit` bundle via the plugin manager.
