import { formatTime, initials } from '../lib/format';

export function Poster({ title, children }) {
  return (
    <div className="poster">
      {title?.posterUrl ? (
        <img src={title.posterUrl} alt="" loading="lazy" />
      ) : (
        <div className="poster-fallback" aria-hidden="true">
          {initials(title?.name)}
        </div>
      )}
      {children}
    </div>
  );
}

export default function TitleCard({ title, footer, badges, style }) {
  return (
    <article className="title-card" style={style}>
      <Poster title={title}>
        <div className="poster-top">{badges}</div>
      </Poster>
      <div className="title-body">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <div className="title-name">{title?.name}</div>
          {title?.year && <span className="faint" style={{ fontSize: 11 }}>{title.year}</span>}
        </div>
        <div className="title-meta">
          <span>{formatTime(title?.durationSeconds)}</span>
          <span>·</span>
          <span>{title?.timelineCount ?? 0} timeline beats</span>
        </div>
        <div className="chips">
          {(title?.genres || []).slice(0, 3).map((genre) => (
            <span className="chip" key={genre}>
              {genre}
            </span>
          ))}
        </div>
        {title?.synopsis && <p className="title-synopsis">{title.synopsis}</p>}
        {footer}
      </div>
    </article>
  );
}
