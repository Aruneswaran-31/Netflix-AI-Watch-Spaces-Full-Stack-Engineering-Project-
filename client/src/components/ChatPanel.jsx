import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/format';

export default function ChatPanel({ messages, onSend, typingNames = [], selfId, muted, disabled }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  const handleTyping = () => {
    onSend?.('typing', true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onSend?.('typing', false), 1800);
  };

  const submit = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend('message', body);
      setDraft('');
      onSend?.('typing', false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="chat-scroll" ref={scrollRef} aria-live="polite">
        {!messages.length && (
          <div className="side-empty">
            No messages yet. Say hello — chat is timestamped against the film, so you can always
            find the moment someone reacted to.
          </div>
        )}
        {messages.map((message) => {
          if (message.type === 'system') {
            return (
              <div key={message.id} className="msg msg-system">
                {message.body}
              </div>
            );
          }
          return (
            <div
              key={message.id}
              className={`msg ${String(message.userId) === String(selfId) ? 'msg-mine' : ''}`}
            >
              <div className="msg-head">
                <span className="msg-name">{message.displayName}</span>
                <span className="msg-time">{formatTime(message.tsSeconds)}</span>
              </div>
              <div className="msg-body">{message.body}</div>
            </div>
          );
        })}
      </div>

      <div className="msg-typing">
        {typingNames.length ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…` : ''}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            handleTyping();
          }}
          placeholder={muted ? 'You are muted by the host' : 'Message the room…'}
          maxLength={1000}
          disabled={muted || disabled}
          aria-label="Chat message"
        />
        <button
          className="btn btn-primary btn-sm"
          type="submit"
          disabled={!draft.trim() || sending || muted || disabled}
        >
          Send
        </button>
      </form>
    </div>
  );
}
