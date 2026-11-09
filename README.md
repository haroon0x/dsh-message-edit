# dsh-message-edit

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Edit a message you have already sent in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web UI — and optionally rewind what that turn did to your files.

## What it does

Adds an **Edit** action above each of your sent user messages. Clicking it opens the message text in an inline editor. Press **Save & branch** to:

1. Fork the session at the event just before that message,
2. Open the resulting branch,
3. Send your edited text as the first prompt of the branch.

The original session and everything after the edited message stays untouched — DSH history is append-only, so editing is implemented as a branch (same semantics as Claude Code's message editing).

## File rewind (v2)

Forking branches the conversation, not the filesystem: without extra help the files the original turn touched stay modified on disk. For a message that was the session's **last user turn**, v2 adds an "Also revert the N files this turn changed" option. Reverting restores each file the turn changed to its turn-start content and deletes files the turn created, using the per-turn snapshots the DSH workspace-changes recorder already keeps.

A file is only restored when its current content still matches the recorded turn-end state; a file modified again afterwards is skipped, never clobbered. Binary and oversized files are skipped. An older message (not the last user turn) branches without the rewind option.

## Requirements

- DSH web profile (`dsh web`) — plugin is a Web bundle (Host + Client halves).
- Works with any provider route; no keys of its own.

## Install

From a checkout of this repository, use the DSH plugin manager with this directory as the target, then refresh the web page and look for the **Edit** button above sent user messages:

```
install_bundle → /path/to/dsh-message-edit
```

Once the package is published on npm (this package name is reserved for that), the same command accepts the spec `@haroon0x/dsh-message-edit` instead of a directory.

## Limitations

- Text-only messages (attachments are not carried over to the branch).
- Forks create a new session rather than rewriting history in place.
- Rewind covers files the workspace-changes recorder captured for that turn; shell edits outside git, binary or oversized files, and turns from before a Host restart are not covered.

## Uninstall

Disable or remove the `@haroon0x/dsh-message-edit` bundle via the plugin manager.

## License

MIT — see [LICENSE](LICENSE).
