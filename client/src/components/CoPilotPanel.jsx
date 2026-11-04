import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/format';

export default function CoPilotPanel({ feed, onAsk, asking, onSeek, canSeek, disabled, title, suggestions = [] }) {
  const [question, setQuestion] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [feed.length, asking]);

  const submit = async (event) => {
    event.preventDefault();
    const value = question.trim();
    if (value.length < 2 || asking || disabled) return;
    setQuestion('');
    await onAsk(value);
  };

  return (
    <div>
      <div className="feed" ref={scrollRef}>
        {!feed.length && (
          <div className="side-empty">
            <div className="badge badge-blue" style={{ marginBottom: 8 }}>
              Retrieval-grounded
            </div>
            Ask about the scene you are watching. The co-pilot answers only from
            {title ? ` “${title.name}”` : ' this title'}&apos;s authored timeline and cites what it
            used. If the metadata does not cover it, it says so.
          </div>
        )}

        {feed.map((item) => (
          <div key={item.id} className={`feed-item ${item.kind}`}>
            <div className="feed-top">
              <span className="who">
                {item.kind === 'trivia' ? 'Scene trivia' : item.kind === 'character' ? 'Character cue' : 'Co-pilot'}
              </span>
              <span className="faint" style={{ fontSize: 10 }}>
                {formatTime(item.tsSeconds)}
              </span>
              {item.kind === 'answer' &&
                (item.grounded ? (
                  <span className="badge badge-green" style={{ marginLeft: 'auto' }}>
                    grounded
                  </span>
                ) : (
                  <span className="badge badge-gold" style={{ marginLeft: 'auto' }}>
                    declined
                  </span>
                ))}
            </div>

            {item.question && <div className="feed-question">“{item.question}”</div>}
            <div className="feed-answer">{item.answer || item.text}</div>

            {item.sources?.length > 0 && (
              <div className="citations">
                {item.sources.slice(0, 4).map((source) => (
                  <button
                    key={`${item.id}-${source.id}`}
                    type="button"
                    className="citation"
                    title={source.text || source.term || source.type}
                    onClick={() => canSeek && onSeek?.(source.ts)}
                    style={{ cursor: canSeek ? 'pointer' : 'default' }}
                  >
                    {formatTime(source.ts)} · {source.type.replace('_', ' ')}
                  </button>
                ))}
              </div>
            )}

            {item.kind === 'answer' && (
              <div className="feed-top" style={{ marginTop: 7, marginBottom: 0 }}>
                <span className="faint" style={{ fontSize: 10 }}>
                  {item.provider && item.provider !== 'none'
                    ? item.provider === 'grounded-synthesizer'
                      ? 'deterministic synthesizer'
                      : item.provider
                    : item.grounded
                      ? 'grounded'
                      : 'no source found'}
                  {item.latencyMs ? ` · ${item.latencyMs}ms` : ''}
                </span>
              </div>
            )}
          </div>
        ))}

        {asking && (
          <div className="feed-item answer">
            <div className="feed-top">
              <span className="who">Co-pilot</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="spinner" />
              <span className="muted" style={{ fontSize: 12 }}>
                Retrieving authored entries…
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="copilot-form">
        <div className="suggestions">
          {suggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion"
              onClick={() => onAsk(suggestion)}
              disabled={asking || disabled}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form className="copilot-input" onSubmit={submit}>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about this exact scene…"
            maxLength={500}
            disabled={disabled}
            aria-label="Ask the co-pilot"
          />
          <button
            className="btn btn-primary btn-sm"
            type="submit"
            disabled={question.trim().length < 2 || asking || disabled}
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
