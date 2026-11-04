import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import TitleCard from '../components/TitleCard';
import { useToast } from '../components/Toast';

const EMPTY_FORM = {
  name: '',
  visibility: 'invite',
  maxParticipants: 25,
  aiVerbosity: 'normal',
  votingEnabled: true,
  subtitlesEnabled: true,
};

export default function Browse() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [titles, setTitles] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('All');
  const [code, setCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);

  const canHost = user?.role === 'host' || user?.role === 'admin';

  useEffect(() => {
    api('/titles')
      .then((data) => setTitles(data.titles))
      .catch((requestError) => setError(requestError.message));
  }, []);

  const genres = useMemo(() => {
    const set = new Set();
    for (const title of titles || []) for (const item of title.genres || []) set.add(item);
    return ['All', ...Array.from(set).sort()];
  }, [titles]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (titles || []).filter((title) => {
      const matchesGenre = genre === 'All' || (title.genres || []).includes(genre);
      const matchesTerm =
        !term ||
        title.name.toLowerCase().includes(term) ||
        (title.synopsis || '').toLowerCase().includes(term);
      return matchesGenre && matchesTerm;
    });
  }, [titles, query, genre]);

  const openCreate = (title) => {
    setSelected(title);
    setForm({ ...EMPTY_FORM, name: `${title.name} watch party` });
  };

  const createRoom = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setCreateBusy(true);
    try {
      const data = await api('/watch-spaces', {
        method: 'POST',
        body: {
          titleId: selected.id,
          name: form.name.trim() || undefined,
          visibility: form.visibility,
          maxParticipants: Number(form.maxParticipants),
          aiVerbosity: form.aiVerbosity,
          votingEnabled: form.votingEnabled,
          subtitlesEnabled: form.subtitlesEnabled,
        },
      });
      toast(`Room created — invite code ${data.inviteCode}`, 'success');
      navigate(`/watch/${data.watchSpaceId}`);
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setCreateBusy(false);
    }
  };

  const joinByCode = async (event) => {
    event.preventDefault();
    const inviteCode = code.trim().toUpperCase();
    if (!inviteCode) return;
    setJoinBusy(true);
    try {
      const found = await api(`/watch-spaces/by-code/${encodeURIComponent(inviteCode)}`);
      await api(`/watch-spaces/${found.watchSpace.id}/join`, { method: 'POST' });
      navigate(`/watch/${found.watchSpace.id}`);
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Catalogue</div>
          <h1>Pick something worth pausing for</h1>
          <p className="sub">
            Every title ships with an authored timeline: scene beats, trivia, characters, glossary
            and pre-approved variation points.
          </p>
        </div>
        <div className="head-actions">
          <form className="join-strip" onSubmit={joinByCode} style={{ padding: 0, border: 0 }}>
            <input
              aria-label="Invite code"
              placeholder="NX-XXXX"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={12}
            />
            <button className="btn btn-ghost btn-sm" type="submit" disabled={joinBusy || !code.trim()}>
              {joinBusy ? 'Joining…' : 'Join with code'}
            </button>
          </form>
        </div>
      </header>

      <div className="filters">
        <input
          className="filter"
          style={{ minWidth: 220, textAlign: 'left' }}
          placeholder="Search titles…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search titles"
        />
        {genres.map((item) => (
          <button
            type="button"
            key={item}
            className={`filter ${genre === item ? 'active' : ''}`}
            onClick={() => setGenre(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {!canHost && (
        <div className="notice" style={{ marginBottom: 16 }}>
          You are signed in as a <strong>viewer</strong>. Join any public room or use an invite
          code. To host, sign in with the host demo account or register a host account.
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {!titles ? (
        <div className="page-loading">
          <div className="spinner" />
          <span>Loading catalogue…</span>
        </div>
      ) : (
        <div className="catalog-grid">
          {filtered.map((title) => (
            <TitleCard
              key={title.id}
              title={title}
              badges={
                <span className="badge">
                  {title.license ? 'Open license' : 'Catalogue'}
                </span>
              }
              footer={
                <div className="title-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={() => openCreate(title)}
                    disabled={!canHost}
                    title={canHost ? 'Create a watch space' : 'Host accounts can create rooms'}
                  >
                    Host a room
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      setSelected(title);
                      setForm({ ...EMPTY_FORM, name: `${title.name} watch party` });
                    }}
                  >
                    Details
                  </button>
                </div>
              }
            />
          ))}
          {!filtered.length && <div className="empty">No titles match that filter.</div>}
        </div>
      )}

      {selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="modal-head">
              <h2 id="create-title">{canHost ? 'Host a watch space' : selected.name}</h2>
              <button className="btn btn-quiet" type="button" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>

            <form onSubmit={createRoom}>
              <div className="modal-body">
                <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                  <div className="room-thumb" style={{ width: 120 }}>
                    {selected.posterUrl ? <img src={selected.posterUrl} alt="" /> : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title-name">{selected.name}</div>
                    <div className="title-meta">
                      {selected.year} · {Math.round(selected.durationSeconds / 60)} min ·{' '}
                      {selected.timelineCount} timeline beats
                    </div>
                    <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                      {selected.synopsis}
                    </p>
                  </div>
                </div>

                {!canHost ? (
                  <div className="notice">
                    Only host or admin accounts can create a Watch Space. You can still join with
                    an invite code from the catalogue header.
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="room-name">Room name</label>
                      <input
                        id="room-name"
                        value={form.name}
                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                        maxLength={120}
                        required
                      />
                    </div>

                    <div className="row" style={{ gap: 12 }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label htmlFor="visibility">Visibility</label>
                        <select
                          id="visibility"
                          value={form.visibility}
                          onChange={(event) => setForm({ ...form, visibility: event.target.value })}
                        >
                          <option value="invite">Invite only</option>
                          <option value="public">Public</option>
                        </select>
                      </div>
                      <div className="field" style={{ flex: 1 }}>
                        <label htmlFor="max">Max participants</label>
                        <input
                          id="max"
                          type="number"
                          min={2}
                          max={50}
                          value={form.maxParticipants}
                          onChange={(event) =>
                            setForm({ ...form, maxParticipants: event.target.value })
                          }
                        />
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor="verbosity">Co-pilot verbosity</label>
                      <select
                        id="verbosity"
                        value={form.aiVerbosity}
                        onChange={(event) => setForm({ ...form, aiVerbosity: event.target.value })}
                      >
                        <option value="minimal">Minimal — high-priority trivia only</option>
                        <option value="normal">Normal — all authored trivia</option>
                        <option value="chatty">Chatty — trivia + character cues</option>
                      </select>
                    </div>

                    <label className="row" style={{ fontSize: 13, color: 'var(--muted)' }}>
                      <input
                        type="checkbox"
                        checked={form.votingEnabled}
                        onChange={(event) =>
                          setForm({ ...form, votingEnabled: event.target.checked })
                        }
                      />
                      Group variation voting
                    </label>
                  </>
                )}
              </div>

              <div className="modal-foot">
                <button className="btn btn-ghost" type="button" onClick={() => setSelected(null)}>
                  Close
                </button>
                {canHost && (
                  <button className="btn btn-primary" type="submit" disabled={createBusy}>
                    {createBusy ? 'Creating…' : 'Create & enter room'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
