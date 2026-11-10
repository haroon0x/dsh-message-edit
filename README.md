# dsh-message-edit

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Edit a message you have already sent in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web UI — in the same chat or as a branch, and optionally rewind what that turn did to your files.

## What it does

Adds an **Edit** action above each of your sent user messages. Clicking it opens an editor with two destinations:

- **Same chat** (default) — the corrected text is sent as the next message in the current conversation.
- **New branch** — the session is forked at the event just before that message, the branch opens, and the corrected text is sent there.

Both modes can first run **Rewind files** (see below), and the branch mode leaves the original session completely untouched.

### Why "Same chat" keeps the original visible

DSH's transcript is append-only. Model history is a folded surface that surface replacements can change, but replacement copies stay model-only: the chat keeps rendering what you actually sent, by design. So no plugin can rewrite a sent bubble in place — the honest same-conversation option is to send the corrected text as the next turn. Choose **New branch** when you want the conversation to actually continue from the edited message.

## File rewind

Branching (or correcting) does not touch the filesystem: without extra help the files the original turn touched stay modified on disk. For a message that was the session's **last user turn**, the editor adds an "Also revert the N files this turn changed" option. Reverting restores each file the turn changed to its turn-start content and deletes files the turn created, using the per-turn snapshots the DSH workspace-changes recorder already keeps.

A file is only restored when its current content still matches the recorded turn-end state; a file modified again afterwards is skipped, never clobbered. Binary and oversized files are skipped. An older message (not the last user turn) has no rewind option.

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

- Text-only messages (attachments are not carried into a correction or branch).
- Same-chat edits append the corrected message; the original stays in the transcript.
- Branches create a new session rather than rewriting history in place.
- Rewind covers files the workspace-changes recorder captured for that turn; shell edits outside git, binary or oversized files, and turns from before a Host restart are not covered.

## Uninstall

Disable or remove the `@haroon0x/dsh-message-edit` bundle via the plugin manager.

## License

MIT — see [LICENSE](LICENSE).
