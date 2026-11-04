import { useCallback, useEffect, useRef, useState } from 'react';
import { emitAck } from '../lib/socket';
import { formatTime } from '../lib/format';

const SOFT_DRIFT_MS = 250;
const HARD_DRIFT_MS = 1200;

/**
 * The participant player. Playback intent (play/pause/seek) only leaves this
 * component for the host; everyone else treats the server snapshot as truth and
 * corrects local drift with a rate nudge (soft) or a seek (hard).
 */
export default function VideoStage({
  title,
  playback,
  isHost,
  watchSpaceId,
  socket,
  onIntent,
  reactions = [],
  ended,
}) {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const applyingRef = useRef(false);
  const lastTargetRef = useRef(0);
  const rateTimerRef = useRef(null);
  const seekTimerRef = useRef(null);
  const playbackRef = useRef(playback);
  const hostRef = useRef(isHost);

  const [currentTime, setCurrentTime] = useState(playback?.positionSeconds || 0);
  const [duration, setDuration] = useState(title?.durationSeconds || 0);
  const [paused, setPaused] = useState(true);
  const [driftMs, setDriftMs] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [muted, setMuted] = useState(false);

  playbackRef.current = playback;
  hostRef.current = isHost;

  const targetPosition = useCallback(() => {
    const state = playbackRef.current;
    if (!state) return 0;
    const base = Number(state.positionSeconds) || 0;
    if (state.status !== 'playing') return base;
    const serverNow = Number(state.serverNow || state.serverTs || Date.now());
    const elapsed = Math.max(0, Date.now() - serverNow) / 1000;
    return base + elapsed;
  }, []);

  const applyPlayback = useCallback(
    (state, { force = false } = {}) => {
      const video = videoRef.current;
      if (!video || !state) return;
      const target = targetPosition();
      lastTargetRef.current = target;

      const drift = Math.abs(video.currentTime - target) * 1000;
      const shouldSeek = force || drift > 700;
      if (shouldSeek && Number.isFinite(target)) {
        applyingRef.current = true;
        try {
          video.currentTime = Math.max(0, Math.min(target, (video.duration || title?.durationSeconds || target) - 0.05));
        } catch {
          /* media not seekable yet */
        }
        setTimeout(() => {
          applyingRef.current = false;
        }, 350);
        setCurrentTime(target);
      }

      if (state.status === 'playing') {
        if (video.paused) {
          video.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
        }
        if (video.playbackRate !== 1 && !applyingRef.current && !rateTimerRef.current) {
          video.playbackRate = 1;
        }
      } else if (!video.paused) {
        video.pause();
      }
    },
    [targetPosition, title?.durationSeconds]
  );

  // Apply every snapshot / remote update.
  useEffect(() => {
    if (!playback) return;
    applyPlayback(playback, {
      force: playback.lastAction === 'seek' || playback.lastAction === 'seekEnd',
    });
  }, [playback?.revision, playback?.status, playback?.positionSeconds, applyPlayback]);

  // Drift measurement + correction. Non-hosts nudge playbackRate rather than
  // jumping the picture for small errors.
  useEffect(() => {
    if (!socket || !playback) return undefined;
    const timer = setInterval(async () => {
      const video = videoRef.current;
      if (!video || document.hidden) return;
      try {
        const response = await emitAck(
          socket,
          'room.sync.ping',
          {
            watchSpaceId,
            clientSentAt: Date.now(),
            positionSeconds: video.currentTime,
          },
          5000
        );
        setDriftMs(response.driftMs || 0);
        const correction = response.correction;
        if (!correction?.apply) return;
        if (correction.mode === 'hard') {
          applyingRef.current = true;
          video.currentTime = correction.targetPositionSeconds;
          setTimeout(() => {
            applyingRef.current = false;
          }, 300);
        } else if (correction.mode === 'soft' && !hostRef.current) {
          video.playbackRate = correction.targetRate;
          clearTimeout(rateTimerRef.current);
          rateTimerRef.current = setTimeout(() => {
            if (videoRef.current) videoRef.current.playbackRate = 1;
            rateTimerRef.current = null;
          }, 4500);
        }
      } catch {
        /* a missed ping is not fatal; the next snapshot will resync */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [socket, watchSpaceId]);

  useEffect(
    () => () => {
      clearTimeout(rateTimerRef.current);
      clearTimeout(seekTimerRef.current);
    },
    []
  );

  const emitIntent = (action, positionSeconds) => {
    if (!isHost || ended) return;
    Promise.resolve(onIntent?.(action, positionSeconds)).catch(() => {});
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || !isHost || ended) return;
    if (video.paused) {
      video
        .play()
        .then(() => {
          setBlocked(false);
          emitIntent('play', video.currentTime);
        })
        .catch(() => setBlocked(true));
    } else {
      video.pause();
      emitIntent('pause', video.currentTime);
    }
  };

  const skip = (delta) => {
    const video = videoRef.current;
    if (!video || !isHost || ended) return;
    const next = Math.max(0, Math.min(video.currentTime + delta, duration || video.duration || 0));
    video.currentTime = next;
    setCurrentTime(next);
    emitIntent('seek', next);
  };

  const handleScrub = (event) => {
    const next = Number(event.target.value);
    const video = videoRef.current;
    setCurrentTime(next);
    if (video) video.currentTime = next;
    if (!isHost) return;
    clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => emitIntent('seek', next), 220);
  };

  const toggleFullscreen = () => {
    const node = wrapRef.current;
    if (!node) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else node.requestFullscreen?.().catch(() => {});
  };

  const statusLabel =
    playback?.status === 'playing'
      ? 'Playing in sync'
      : playback?.status === 'buffering'
        ? 'Host is buffering'
        : playback?.status === 'seeking'
          ? 'Seeking'
          : playback?.status === 'idle'
            ? 'Waiting to start'
            : 'Paused';

  const driftTone = Math.abs(driftMs) <= SOFT_DRIFT_MS ? 'good' : Math.abs(driftMs) <= HARD_DRIFT_MS ? 'warn' : '';

  return (
    <section className="stage" aria-label="Synchronised player">
      <div className="video-wrap" ref={wrapRef}>
        <video
          ref={videoRef}
          src={title?.videoAssetUrl}
          poster={title?.posterUrl || undefined}
          playsInline
          preload="metadata"
          muted={muted}
          onTimeUpdate={(event) => {
            if (!applyingRef.current) setCurrentTime(event.currentTarget.currentTime);
          }}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value)) setDuration(value);
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onError={() => setMediaError(true)}
          onClick={() => {
            if (isHost) togglePlay();
          }}
        />

        {mediaError && (
          <div className="video-overlay">
            <div className="stack" style={{ maxWidth: 360, textAlign: 'center', padding: 20 }}>
              <strong>The sample video could not load.</strong>
              <p className="muted" style={{ fontSize: 13 }}>
                The open-licensed stream may be blocked by your network. Playback sync, the
                co-pilot and variation votes still work against the authored timeline.
              </p>
            </div>
          </div>
        )}

        {!mediaError && (blocked || (paused && isHost && playback?.status !== 'playing' && !ended)) && (
          <div className="video-overlay">
            <button
              type="button"
              className="big-play"
              aria-label={isHost ? 'Start playback for the room' : 'Join playback'}
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  video
                    .play()
                    .then(() => {
                      setBlocked(false);
                      if (isHost && playback?.status !== 'playing') emitIntent('play', video.currentTime);
                    })
                    .catch(() => setBlocked(true));
                }
              }}
            >
              ▶
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              {isHost ? 'Start the film for everyone' : 'Tap to enable audio — the host controls playback'}
            </p>
          </div>
        )}

        {ended && (
          <div className="video-overlay">
            <div className="stack" style={{ textAlign: 'center' }}>
              <span className="badge badge-red">Space ended</span>
              <p className="muted">Thanks for watching together.</p>
            </div>
          </div>
        )}

        <div className="video-hint">
          <span className="badge badge-red">
            <span className="dot dot-live" /> {isHost ? 'You are hosting' : 'Synced room'}
          </span>
          {!isHost && <span className="badge">Host controls playback</span>}
        </div>

        <div className="float-layer" aria-hidden="true">
          {reactions.map((reaction) => (
            <span
              key={reaction.key}
              className="float-emoji"
              style={{ left: `${reaction.left}%`, animationDelay: `${reaction.delay || 0}ms` }}
            >
              {reaction.emoji}
            </span>
          ))}
        </div>

        <div className="reaction-bar" aria-label="Send a reaction">
          {['❤️', '😂', '😮', '🔥', '👏'].map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => onIntent?.('reaction', emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="control-bar">
        <div className="progress-row">
          <span className="time">{formatTime(currentTime)}</span>
          <input
            className="scrub"
            type="range"
            min={0}
            max={Math.max(1, Math.floor(duration || title?.durationSeconds || 1))}
            step={1}
            value={Math.min(currentTime, Math.floor(duration || title?.durationSeconds || 1))}
            onChange={handleScrub}
            disabled={!isHost || ended}
            aria-label="Seek"
          />
          <span className="time" style={{ textAlign: 'right' }}>
            {formatTime(duration || title?.durationSeconds)}
          </span>
        </div>

        <div className="control-row">
          <button
            type="button"
            className="play-toggle"
            onClick={togglePlay}
            disabled={!isHost || ended}
            aria-label={paused ? 'Play' : 'Pause'}
            title={isHost ? (paused ? 'Play for everyone' : 'Pause for everyone') : 'Only the host can control playback'}
          >
            {playback?.status === 'playing' && !paused ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => skip(-10)}
            disabled={!isHost || ended}
            aria-label="Back 10 seconds"
          >
            −10
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => skip(10)}
            disabled={!isHost || ended}
            aria-label="Forward 10 seconds"
          >
            +10
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
            ⛶
          </button>

          <span className="spacer" />

          <span className={`sync-pill ${driftTone}`} title="Measured against the authoritative room clock">
            <span className="dot" />
            {statusLabel}
            {!isHost && Number.isFinite(driftMs) && (
              <span style={{ opacity: 0.75 }}>· {Math.abs(Math.round(driftMs))}ms</span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
