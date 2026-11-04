import { useEffect, useState } from 'react';
import { formatTime } from '../lib/format';

function Countdown({ closesAt }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(closesAt) - Date.now()));
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(Math.max(0, new Date(closesAt) - Date.now()));
    }, 500);
    return () => clearInterval(timer);
  }, [closesAt]);
  return <span>{Math.ceil(remaining / 1000)}s left</span>;
}

export default function VariationPanel({
  variations = [],
  activeVote,
  applied,
  isHost,
  votingEnabled,
  onOpen,
  onVote,
  onClose,
  myBallot,
  busy,
  canSeek,
  onSeek,
}) {
  const total = activeVote?.totalBallots || activeVote?.ballotCount || 0;

  return (
    <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
      {!votingEnabled && (
        <div className="notice">Group voting is disabled for this room. The host can re-enable it in room settings.</div>
      )}

      {applied && (
        <div className="applied">
          <div className="row" style={{ gap: 8 }}>
            <span className="badge badge-green">Applied</span>
            <span className="faint" style={{ fontSize: 10 }}>
              {formatTime(applied.tsSeconds)}
            </span>
          </div>
          <strong>{applied.winningOption?.label}</strong>
          {applied.winningOption?.description && (
            <span className="muted" style={{ fontSize: 11 }}>
              {applied.winningOption.description}
            </span>
          )}
          {applied.winningOption?.subtitle?.text && (
            <blockquote>“{applied.winningOption.subtitle.text}”</blockquote>
          )}
        </div>
      )}

      {activeVote ? (
        <div className="variation-card">
          <div className="row" style={{ gap: 8 }}>
            <span className="badge badge-red">Vote open</span>
            <span className="vote-meta" style={{ marginLeft: 'auto' }}>
              <Countdown closesAt={activeVote.closesAt} /> · {total} ballot{total === 1 ? '' : 's'}
            </span>
          </div>
          <h4>{activeVote.question || 'Choose this moment’s approved variant'}</h4>
          <div className="stack" style={{ gap: 6 }}>
            {(activeVote.options || []).map((option) => {
              const count = activeVote.counts?.[option.id] || 0;
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <button
                  type="button"
                  key={option.id}
                  className={`vote-option ${myBallot === option.id ? 'chosen' : ''}`}
                  onClick={() => onVote(option.id)}
                  disabled={busy || !votingEnabled}
                  title={option.description || option.label}
                >
                  <span className="fill" style={{ width: `${pct}%` }} />
                  <span className="label">{option.label}</span>
                  <span className="pct">
                    {count} · {pct}%
                  </span>
                </button>
              );
            })}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span className="vote-meta">
              {myBallot ? 'Ballot recorded — you can change it' : 'One ballot per person'}
            </span>
            {isHost && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onClose} disabled={busy}>
                Close & apply
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="notice">
          {isHost
            ? 'Open a vote when the room reaches a variation point. The room chooses from pre-approved options only.'
            : 'When the host opens a variation vote, ballots appear here for everyone in the room.'}
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">Authored variation points</div>
        {!variations.length && (
          <div className="side-empty">This title has no authored variation points.</div>
        )}
        {variations.map((variation) => {
          const closedVotes = (variation.votes || []).filter((vote) => vote.status === 'closed');
          return (
            <div key={variation.id} className="card" style={{ padding: 11 }}>
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                <span className="badge">{variation.variationKind}</span>
                <button
                  type="button"
                  className="citation"
                  style={{ marginLeft: 'auto', cursor: canSeek ? 'pointer' : 'default' }}
                  onClick={() => canSeek && onSeek?.(variation.ts)}
                >
                  {formatTime(variation.ts)}
                </button>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>{variation.title}</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                {(variation.options || []).length} approved options
                {closedVotes.length ? ` · ${closedVotes.length} past vote${closedVotes.length === 1 ? '' : 's'}` : ''}
              </div>
              {isHost && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 8 }}
                  type="button"
                  onClick={() => onOpen(variation.id)}
                  disabled={busy || !votingEnabled || Boolean(activeVote)}
                >
                  {activeVote ? 'Another vote is open' : 'Open vote'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="faint" style={{ fontSize: 11, lineHeight: 1.5 }}>
        Options are authored and approved ahead of time — the room chooses among them, nothing is
        generated live. The winning caption or framing applies to every screen.
      </p>
    </div>
  );
}
