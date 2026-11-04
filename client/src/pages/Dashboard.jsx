import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatTime, relativeTime } from '../lib/format';
import { Poster } from '../components/TitleCard';

function Stat({ value, label }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function RoomRow({ room }) {
  return (
    <Link className="room-row" to={`/watch/${room.id}`}>
      <div className="room-thumb">
        {room.title?.posterUrl ? <img src={room.title.posterUrl} alt="" /> : null}
      </div>
      <div className="room-row-main">
        <div className="name">{room.name}</div>
        <div className="meta">
          {room.title?.name || 'Unknown title'} · {room.participantCount ?? room.participantIds?.length} in room
          {room.status === 'live' ? ' · playing' : ' · waiting to start'}
        </div>
      </div>
      {room.live ? (
        <span className="badge badge-red">
          <span className="dot dot-live" /> Live
        </span>
      ) : (
        <span className="badge">Scheduled</span>
      )}
      <span className="faint" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/dashboard')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="page">
        <div className="center-card">
          <div className="icon">!</div>
          <h1>Could not load your dashboard</h1>
          <p>{error}</p>
          <button className="btn btn-ghost" onClick={() => navigate('/browse')}>
            Browse the catalogue
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <span>Loading your rooms and rail…</span>
      </div>
    );
  }

  const firstName = user?.displayName?.split(' ')[0] || 'there';
  const rooms = [...data.activeRooms, ...data.upcomingRooms];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Your evening</div>
          <h1>Hi {firstName}, who are you watching with?</h1>
          <p className="sub">
            Rooms stay in sync to the second. The co-pilot only knows what has played.
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-ghost" to="/browse">
            Join with a code
          </Link>
          <Link className="btn btn-primary" to="/browse">
            Host a watch space
          </Link>
        </div>
      </header>

      <div className="kpis">
        <Stat value={data.stats.titlesWatched} label="Titles watched" />
        <Stat value={`${data.stats.hoursWatched}h`} label="Hours in rooms" />
        <Stat value={data.stats.aiQuestionsAsked} label="Co-pilot questions" />
        <Stat value={data.stats.sessionsHosted} label="Spaces hosted" />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Your rooms</h2>
          <Link className="link" to="/browse">
            Start another →
          </Link>
        </div>
        {rooms.length ? (
          <div className="room-list">
            {rooms.map((room) => (
              <RoomRow key={room.id} room={room} />
            ))}
          </div>
        ) : (
          <div className="empty">
            No rooms yet. <Link to="/browse">Pick a film and host the first one →</Link>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>For you</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            Hybrid content + collaborative · explains itself
          </span>
        </div>
        {data.recommendations.length ? (
          <div className="rail">
            {data.recommendations.map((rec) => (
              <article className="title-card" key={rec.titleId}>
                <Poster
                  title={rec.title}
                  badges={
                    <span className="badge badge-red">{Math.round(rec.score * 100)}% fit</span>
                  }
                />
                <div className="title-body">
                  <div className="title-name">{rec.title?.name}</div>
                  <div className="title-meta">
                    {rec.title?.year} · {formatTime(rec.title?.durationSeconds)}
                  </div>
                  <p className="reason">{rec.reasons[0]}</p>
                  <div className="score-bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.round(rec.score * 100))}%` }} />
                  </div>
                  <div className="title-actions">
                    <Link className="btn btn-sm btn-ghost" to={`/browse?title=${rec.titleId}`}>
                      Open
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">Watch a title to start your personalised rail.</div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Continue watching</h2>
        </div>
        {data.recentlyWatched.length ? (
          <div className="room-list">
            {data.recentlyWatched.map((entry) => (
              <Link
                key={`${entry.title?.id}-${entry.lastWatchedAt}`}
                className="room-row"
                to={entry.watchSpaceId ? `/watch/${entry.watchSpaceId}` : '/browse'}
              >
                <div className="room-thumb">
                  {entry.title?.posterUrl ? <img src={entry.title.posterUrl} alt="" /> : null}
                </div>
                <div className="room-row-main">
                  <div className="name">{entry.title?.name}</div>
                  <div className="meta">
                    {Math.round((entry.completionRatio || 0) * 100)}% watched ·{' '}
                    {relativeTime(entry.lastWatchedAt)}
                    {entry.rating ? ` · ${entry.rating}★` : ''}
                  </div>
                  <div className="score-bar" style={{ marginTop: 6, maxWidth: 240 }}>
                    <span style={{ width: `${Math.round((entry.completionRatio || 0) * 100)}%` }} />
                  </div>
                </div>
                <span className="badge">{entry.watchSpaceId ? 'Rejoin' : 'Details'}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">Nothing watched yet — your history will appear here.</div>
        )}
      </section>
    </div>
  );
}
