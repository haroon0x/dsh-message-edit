/**
 * Message edit plugin (client half).
 *
 * Registers a high-priority occupant of the `conversation.chat.user.before`
 * chain slot — the decoration seat above each user bubble — and renders an
 * "Edit" action there. The editor offers two destinations, same chat first:
 *
 * - "Same chat" sends the corrected text as the next turn of this session.
 *   DSH's transcript is append-only (surface replacement copies stay
 *   model-only), so the original message cannot be rewritten in place; this
 *   is the same-conversation alternative to a branch.
 * - "New branch" forks the session at the event just before the message,
 *   opens the branch, and sends the corrected text there.
 *
 * When the edited message is the session's last user turn, the editor also
 * offers to rewind the files that turn changed (Host
 * `/api/message-edit.rewind` route) before either destination runs.
 */
window.__ModuleLoader__.load({
  id: '@haroon0x/dsh-message-edit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'message-edit';
    const en = {
      edit: 'Edit',
      save: 'Save & branch',
      rewind: 'Rewind files',
      branchSend: 'Branch & send',
      hereSend: 'Send here',
      cancel: 'Cancel',
      failed: 'Edit failed.',
      empty: 'The edited message is empty.',
      notLoaded: 'This message is not in the loaded history yet.',
      attachments: 'Editing supports text-only messages.',
      rewindLabel: 'Also revert the {n} file(s) this turn changed.',
      rewound: 'Reverted {n} file(s); skipped {m}.',
      rewindFailed: 'Rewind failed — nothing was sent.',
      mode: 'Where should the corrected message go',
      modeHere: 'Same chat',
      modeHereHint: 'Sends the corrected text as the next message in this conversation.',
      modeBranch: 'New branch',
      modeBranchHint: 'Forks the conversation at this message and opens the branch.',
      hereNote: 'The transcript is append-only, so the original message stays visible.',
    };

    function findUserMessage(sessions, sessionId, rpcId) {
      const binding = sessions.binding(sessionId);
      const entries = binding?.eventSource.getSnapshot().entries ?? [];
      return entries.find(
        (entry) =>
          entry.type === 'event' &&
          entry.event.type === 'user/message' &&
          entry.event.data?.source?.rpcId === rpcId,
      );
    }

    /**
     * For the last user turn only, find the `workspace/changes` event that
     * recorded what that turn touched. Returns its seq, or `undefined` for
     * an older message, an earlier turn, or when the window is partial.
     */
    function findLastTurnChangesSeq(sessions, sessionId, hit) {
      const binding = sessions.binding(sessionId);
      const window = binding?.eventSource.getSnapshot();
      const entries = window?.entries ?? [];
      if (window?.hasMore === true) return undefined;
      let laterUserMessage = false;
      let turn = undefined;
      let changesSeq = undefined;
      for (const entry of entries) {
        if (entry.type !== 'event') continue;
        const event = entry.event;
        if (event.seq === hit.event.seq) {
          // Track the turn this message belongs to by scanning the turn
          // markers seen so far. If the log has none, fall through and
          // accept the first changes event past the message below.
          continue;
        }
        if (event.type === 'turn/start' && typeof event.data?.turn === 'number') {
          turn = event.data.turn;
        }
        if (event.seq > hit.event.seq && event.type === 'user/message') {
          laterUserMessage = true;
        }
        if (
          event.seq > hit.event.seq &&
          event.type === 'workspace/changes' &&
          typeof event.data?.turn === 'number' &&
          (turn === undefined || event.data.turn === turn) &&
          changesSeq === undefined
        ) {
          changesSeq = event.seq;
        }
      }
      return laterUserMessage ? undefined : changesSeq;
    }

    function textOf(content) {
      return (content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n');
    }

    function EditRow(props) {
      const { sessionId, sessions, uiWorkspace, t } = props;
      const owner = props.matched ?? {};
      const source = owner.source ?? props.source;
      const rpcId = source?.rpcId;
      const [editing, setEditing] = React.useState(false);
      const [text, setText] = React.useState('');
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [rewind, setRewind] = React.useState(true);
      const [rewound, setRewound] = React.useState(null);
      const [summary, setSummary] = React.useState(undefined);
      const [mode, setMode] = React.useState('here');

      const hit = React.useMemo(
        () => (rpcId ? findUserMessage(sessions, sessionId, rpcId) : undefined),
        [rpcId, sessions, sessionId, editing],
      );
      const content = hit?.event.data?.content ?? [];
      const textOnly = content.every((block) => block.type === 'text');
      const changesSeq = React.useMemo(
        () => (hit ? findLastTurnChangesSeq(sessions, sessionId, hit) : undefined),
        [hit, sessions, sessionId, editing],
      );

      React.useEffect(() => {
        if (!editing || changesSeq === undefined) return undefined;
        let cancelled = false;
        fetch(`api/changes.summary?sessionId=${encodeURIComponent(sessionId)}&seq=${changesSeq}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((json) => {
            if (!cancelled) setSummary(json);
          })
          .catch(() => {
            if (!cancelled) setSummary(null);
          });
        return () => {
          cancelled = true;
        };
      }, [editing, changesSeq, sessionId]);

      if (!hit) return null;
      if (!textOnly) return null;

      const startEdit = () => {
        setError(null);
        setRewound(null);
        setRewind(true);
        setMode('here');
        setText(textOf(content));
        setEditing(true);
      };

      const cancel = () => {
        setEditing(false);
        setError(null);
        setRewound(null);
      };

      /** Send the edited text into one session through a short-lived reference. */
      const sendPrompt = async (targetId) => {
        const ref = sessions.retain(targetId, { source: 'messageEdit' });
        try {
          const res = await ref.binding.session.prompt(
            [{ type: 'text', text }],
            'queue',
          );
          if (res && res.ok === false) {
            throw new Error(res.error?.message ?? t('failed'));
          }
        } finally {
          ref.release();
        }
      };

      const submit = async () => {
        setBusy(true);
        setError(null);
        try {
          if (mode === 'branch') {
            const seq = hit.event.seq;
            if (typeof seq !== 'number') throw new Error(t('notLoaded'));
            const childId = await sessions.fork({
              sessionId,
              atSeq: Math.max(0, seq - 1),
              increaseTitle: true,
            });
            uiWorkspace.openSession(childId);
            await sendPrompt(childId);
          } else {
            await sendPrompt(sessionId);
          }
          setEditing(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : t('failed'));
        } finally {
          setBusy(false);
        }
      };

      const doRewind = async () => {
        setBusy(true);
        setError(null);
        try {
          const response = await fetch('api/message-edit.rewind', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, changesSeq }),
          });
          if (!response.ok) throw new Error(t('rewindFailed'));
          const json = await response.json();
          setRewound({
            reverted: json.reverted ?? 0,
            skipped: json.skipped ?? 0,
          });
        } catch (err) {
          setError(err instanceof Error && err.message ? err.message : t('rewindFailed'));
        } finally {
          setBusy(false);
        }
      };

      const buttonStyle = {
        borderRadius: 'var(--dsw-radius-sm, 4px)',
        border: '1px solid var(--dsw-alias-border-l2, #0000001f)',
        background: 'var(--dsw-specific-input-major, transparent)',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        padding: '2px 8px',
      };
      const primaryStyle = {
        ...buttonStyle,
        background: 'var(--dsw-alias-state-business-primary, #247bbf)',
        borderColor: 'transparent',
        color: '#fff',
      };

      if (!editing) {
        return h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } },
          h(
            'button',
            { type: 'button', style: buttonStyle, onClick: startEdit },
            t('edit'),
          ),
        );
      }

      const fileCount =
        summary !== null && summary !== undefined && Array.isArray(summary.files)
          ? summary.files.length
          : undefined;
      const hasRewind = fileCount !== undefined && fileCount > 0 && rewound === null;
      const branches = mode === 'branch';

      const noteStyle = {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-tertiary)',
      };

      const modeOption = (value, labelKey, hintKey) =>
        h(
          'label',
          {
            key: value,
            style: {
              display: 'flex',
              gap: '6px',
              alignItems: 'flex-start',
              cursor: 'pointer',
              fontSize: '12px',
              lineHeight: '18px',
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          h('input', {
            type: 'radio',
            name: `message-edit-mode-${rpcId ?? 'row'}`,
            checked: mode === value,
            disabled: busy,
            onChange: () => setMode(value),
            style: { marginTop: '3px' },
          }),
          h(
            'span',
            { style: { display: 'flex', flexDirection: 'column', gap: '1px' } },
            h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, t(labelKey)),
            h('span', { style: noteStyle }, t(hintKey)),
          ),
        );

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            width: '100%',
            minWidth: '260px',
          },
        },
        h('div', { style: { ...noteStyle, fontWeight: 500 } }, t('mode')),
        modeOption('here', 'modeHere', 'modeHereHint'),
        modeOption('branch', 'modeBranch', 'modeBranchHint'),
        !branches ? h('div', { style: noteStyle }, t('hereNote')) : null,
        h('textarea', {
          value: text,
          rows: 4,
          autoFocus: true,
          onChange: (event) => setText(event.target.value),
          style: {
            width: '100%',
            boxSizing: 'border-box',
            font: 'inherit',
            fontSize: '14px',
            lineHeight: '20px',
            padding: '6px 8px',
            borderRadius: 'var(--dsw-radius-md, 6px)',
            border: '1px solid var(--dsw-alias-border-l2, #0000001f)',
            background: 'var(--dsw-specific-input-major, transparent)',
            color: 'var(--dsw-alias-label-primary)',
          },
        }),
        hasRewind
          ? h(
              'label',
              {
                style: {
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  fontSize: '12px',
                  lineHeight: '18px',
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              h('input', {
                type: 'checkbox',
                checked: rewind,
                onChange: (event) => setRewind(event.target.checked),
              }),
              t('rewindLabel').replace('{n}', String(fileCount)),
            )
          : null,
        rewound
          ? h(
              'div',
              {
                style: {
                  fontSize: '12px',
                  lineHeight: '18px',
                  color: 'var(--dsw-alias-state-success-primary, #2e9e62)',
                  textAlign: 'right',
                },
              },
              t('rewound')
                .replace('{n}', String(rewound.reverted))
                .replace('{m}', String(rewound.skipped)),
            )
          : null,
        error
          ? h(
              'div',
              {
                style: {
                  color: 'var(--dsw-alias-state-error-primary)',
                  fontSize: '12px',
                  lineHeight: '18px',
                  textAlign: 'right',
                },
              },
              error,
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
          h(
            'button',
            {
              type: 'button',
              style: buttonStyle,
              disabled: busy,
              onClick: cancel,
            },
            t('cancel'),
          ),
          rewind && hasRewind && rewound === null
            ? h(
                'button',
                {
                  type: 'button',
                  style: primaryStyle,
                  disabled: busy || text.trim() === '',
                  onClick: () => {
                    void doRewind();
                  },
                },
                t('rewind'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              style: primaryStyle,
              // A pending rewind runs first, so the send waits for it or for
              // the user to clear the option.
              disabled:
                busy ||
                text.trim() === '' ||
                (rewind && hasRewind && rewound === null),
              onClick: () => {
                void submit();
              },
            },
            branches
              ? rewind && hasRewind
                ? t('branchSend')
                : t('save')
              : t('hereSend'),
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en }), 'message-edit: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('conversation.chat.user.before', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.user.before',
              priority: 10,
              locale: NS,
              select: (owner) =>
                owner.kind === 'user' && owner.source?.kind === 'user' ? owner : null,
              inject: () => ({
                t,
                sessions: ctx.get('sessions'),
                uiWorkspace: ctx.get('uiWorkspace'),
              }),
            },
            EditRow,
          ),
        );
      },
    };
  },
});
