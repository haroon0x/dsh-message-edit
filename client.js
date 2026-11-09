/**
 * Message edit plugin (client half).
 *
 * Registers the first-priority occupant of the `conversation.chat.user.before`
 * chain slot — the durable-source decoration seat above each user bubble —
 * and renders an "Edit" action there. Editing a sent message forks the
 * session at the event just before it, opens the branch, and sends the
 * edited text as the new turn's prompt. The original session is untouched.
 */
window.__ModuleLoader__.load({
  id: '@local/message-edit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'message-edit';
    const en = {
      edit: 'Edit',
      save: 'Save & branch',
      cancel: 'Cancel',
      failed: 'Edit failed.',
      empty: 'The edited message is empty.',
      notLoaded: 'This message is not in the loaded history yet.',
      attachments: 'Editing supports text-only messages.',
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

      const hit = React.useMemo(
        () => (rpcId ? findUserMessage(sessions, sessionId, rpcId) : undefined),
        [rpcId, sessions, sessionId, editing],
      );
      const content = hit?.event.data?.content ?? [];
      const textOnly = content.every((block) => block.type === 'text');

      if (!hit) return null;
      if (!textOnly) return null;

      const startEdit = () => {
        setError(null);
        setText(textOf(content));
        setEditing(true);
      };

      const cancel = () => {
        setEditing(false);
        setError(null);
      };

      const save = async () => {
        if (text.trim() === '') {
          setError(t('empty'));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const seq = hit.event.seq;
          if (typeof seq !== 'number') throw new Error(t('notLoaded'));
          const childId = await sessions.fork({
            sessionId,
            atSeq: Math.max(0, seq - 1),
            increaseTitle: true,
          });
          uiWorkspace.openSession(childId);
          const ref = sessions.retain(childId, { source: 'messageEdit' });
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
          setEditing(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : t('failed'));
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
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            width: '100%',
            minWidth: '260px',
          },
        },
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
          h(
            'button',
            {
              type: 'button',
              style: primaryStyle,
              disabled: busy,
              onClick: () => {
                void save();
              },
            },
            t('save'),
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
