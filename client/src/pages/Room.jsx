import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { connectRoomSocket, emitAck } from '../lib/socket';
import { formatTime, initials, relativeTime } from '../lib/format';
import { useToast } from '../components/Toast';
import VideoStage from '../components/VideoStage';
import ChatPanel from '../components/ChatPanel';
import CoPilotPanel from '../components/CoPilotPanel';
import VariationPanel from '../components/VariationPanel';

const REACTION_TTL = 2400;

function currentPosition(playback) {
  if (!playback) return 0;
  const base = Number(playback.positionSeconds) || 0;
  if (playback.status !== 'playing') return base;
  const serverNow = Number(playback.serverNow || playback.serverTs || Date.now());
  return base + Math.max(0, Date.now() - serverNow) / 1000;
}

export default function Room() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get('code') || '';
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const socketRef = useRef(null);
  const tabRef = useRef('copilot');
  const typingTimers = useRef({});
  const reactionTimers = useRef({});
  const hostWasMissing = useRef(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [connected, setConnected] = useState(false);
  const [playback, setPlayback] = useState(null);
  const [you, setYou] = useState({ userId: user?.id, isHost: false });
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [feed, setFeed] = useState([]);
  const [variations, setVariations] = useState([]);
  const [activeVote, setActiveVote] = useState(null);
  const [myBallot, setMyBallot] = useState(null);
  const [applied, setApplied] = useState(null);
  const [voteBusy, setVoteBusy] = useState(false);
  const [tab, setTab] = useState('copilot');
  const [unread, setUnread] = useState(0);
  const [asking, setAsking] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [banner, setBanner] = useState(null);
  const [ended, setEnded] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [typing, setTyping] = useState({});
  const [muted, setMuted] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(null);

  tabRef.current = tab;

  useEffect(() => {
    let cancelled = false;
    let socket = null;

    const pushFeed = (item) => setFeed((current) => [...current.slice(-40), item]);

    const addSystemMessage = (body) => {
      setMessages((current) => [
        ...current,
        {
          id: `sys-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          type: 'system',
          body,
          tsSeconds: currentPosition(playback),
          createdAt: new Date().toISOString(),
        },
      ]);
    };

    const loadVariations = async () => {
      try {
        const payload = await api(`/watch-spaces/${id}/variations`);
        if (cancelled) return;
        setVariations(payload.variations || []);
        const open = (payload.variations || [])
          .flatMap((variation) => variation.votes || [])
          .find((vote) => vote.status === 'open');
        if (open) {
          setActiveVote({ ...open, voteId: open.id, counts: open.counts || {} });
        }
        const lastClosed = (payload.variations || [])
          .flatMap((variation) =>
            (variation.votes || [])
              .filter((vote) => vote.status === 'closed' && vote.winningOptionId)
              .map((vote) => ({
                ...vote,
                variation,
                winningOption: (variation.options || []).find(
                  (option) => option.id === vote.winningOptionId
                ),
              }))
          )
          .sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))[0];
        if (lastClosed && !applied) {
          setApplied({
            winningOption: lastClosed.winningOption,
            tsSeconds: lastClosed.variation?.ts || 0,
            winningOptionId: lastClosed.winningOptionId,
            stale: true,
          });
        }
      } catch {
        /* non-fatal: the panel will re-fetch after the next vote event */
      }
    };

    (async () => {
      try {
        let payload;
        try {
          payload = await api(`/watch-spaces/${id}`);
        } catch (error) {
          if (error.status === 403 && inviteCode) {
            const found = await api(`/watch-spaces/by-code/${encodeURIComponent(inviteCode)}`);
            await api(`/watch-spaces/${found.watchSpace.id}/join`, { method: 'POST' });
            payload = await api(`/watch-spaces/${id}`);
          } else {
            throw error;
          }
        }

        if (!payload.watchSpace.isMember) {
          await api(`/watch-spaces/${id}/join`, { method: 'POST' });
          payload = await api(`/watch-spaces/${id}`);
        }

        if (cancelled) return;
        setData(payload);
        setPlayback(payload.playback);
        setParticipants(payload.participants || []);
        setEnded(payload.watchSpace.status === 'ended');
        setYou((current) => ({
          ...current,
          userId: user?.id,
          isHost: String(payload.watchSpace.hostUserId) === String(user?.id),
        }));
        setLoading(false);

        const [chatPayload, , timelinePayload] = await Promise.all([
          api(`/watch-spaces/${id}/chat`),
          loadVariations(),
          api(
            `/titles/${payload.title.id}/timeline?from=0&to=${payload.title.durationSeconds}&types=character,glossary,variation_point`
          ).catch(() => null),
        ]);
        if (cancelled) return;
        setMessages(chatPayload.messages || []);

        // Grounded starter questions built from authored metadata the engine can
        // actually retrieve, rather than generic prompts that would be declined.
        const events = timelinePayload?.events || [];
        const character = events.find((event) => event.type === 'character' && event.character);
        const glossary = events.find((event) => event.type === 'glossary' && event.term);
        const variation = events.find((event) => event.type === 'variationPoint');
        setSuggestions(
          [
            character && `Who is ${character.character}?`,
            glossary && `What does ${glossary.term.toLowerCase()} mean?`,
            `What is ${payload.title.name} about?`,
            variation && 'Is there an alternate subtitle version?',
          ].filter(Boolean)
        );

        socket = connectRoomSocket();
        socketRef.current = socket;

        socket.on('connect', async () => {
          setConnected(true);
          try {
            const ack = await emitAck(socket, 'room.join', { watchSpaceId: id });
            if (cancelled) return;
            setPlayback(ack.playback);
            setParticipants(ack.presence?.participants || []);
            setYou((current) => ({ ...current, isHost: ack.isHost }));
          } catch (error) {
            if (!cancelled) toast(error.message, 'error');
          }
        });

        socket.on('connect_error', (error) => {
          setConnected(false);
          if (error?.message === 'unauthorized') toast('Session expired — sign in again', 'error');
        });

        socket.on('disconnect', () => setConnected(false));

        socket.on('room.state.snapshot', ({ payload: snapshot, ts }) => {
          setData((current) => ({
            ...current,
            watchSpace: snapshot.watchSpace,
            title: snapshot.title,
            participants: snapshot.presence?.participants || [],
          }));
          setPlayback({ ...snapshot.playback, serverNow: snapshot.serverNow, serverTs: ts });
          setParticipants(snapshot.presence?.participants || []);
          if (snapshot.you) setYou({ userId: snapshot.you.userId, isHost: snapshot.you.isHost });
          if (snapshot.watchSpace?.status === 'ended') setEnded(true);
        });

        socket.on('room.playback.update', ({ payload: update, ts }) => {
          setPlayback({ ...update, serverNow: update.serverNow || ts, serverTs: ts });
          if (update.action === 'end') setEnded(true);
        });

        socket.on('room.presence.update', ({ payload: presence }) => {
          setParticipants(presence.participants || []);
          setYou((current) => ({
            ...current,
            isHost: String(presence.hostUserId) === String(current.userId),
          }));
        });

        socket.on('room.host.changed', ({ payload: change }) => {
          hostWasMissing.current = false;
          const promoted = String(change.hostUserId) === String(user?.id);
          setYou((current) => ({ ...current, isHost: promoted }));
          setData((current) =>
            current
              ? {
                  ...current,
                  watchSpace: { ...current.watchSpace, hostUserId: change.hostUserId },
                  host: {
                    id: change.hostUserId,
                    displayName:
                      change.displayName ||
                      current.participants?.find(
                        (person) => String(person.userId) === String(change.hostUserId)
                      )?.displayName ||
                      current.host?.displayName,
                  },
                }
              : current
          );
          setBanner({
            tone: promoted ? 'info' : '',
            text: promoted
              ? 'You are now the host. Playback is paused — press play to continue for the room.'
              : `${change.displayName || 'A participant'} is now the host. Playback is paused.`,
          });
        });

        socket.on('room.host.disconnected', ({ payload: dropped }) => {
          hostWasMissing.current = true;
          setBanner({
            tone: 'danger',
            text: `The host disconnected. Playback paused for everyone; a new host is promoted after ${Math.round(
              (dropped.graceMs || 15000) / 1000
            )}s if they do not return.`,
          });
          if (dropped.playback) {
            setPlayback({ ...dropped.playback, serverNow: Date.now(), serverTs: Date.now() });
          }
        });

        socket.on('room.host.reconnected', () => {
          if (!hostWasMissing.current) return;
          hostWasMissing.current = false;
          setBanner({ tone: 'info', text: 'The host is back. Playback stays paused until they resume.' });
        });

        socket.on('room.chat.message', (envelope) => {
          const message = envelope.payload;
          setMessages((current) =>
            current.some((item) => item.id === message.id) ? current : [...current, message]
          );
          if (tabRef.current !== 'chat') setUnread((count) => count + 1);
        });

        socket.on('room.typing', ({ payload: typingEvent }) => {
          const key = typingEvent.userId;
          setTyping((current) => {
            if (!typingEvent.isTyping) {
              const next = { ...current };
              delete next[key];
              return next;
            }
            return { ...current, [key]: typingEvent.displayName };
          });
          clearTimeout(typingTimers.current[key]);
          if (typingEvent.isTyping) {
            typingTimers.current[key] = setTimeout(() => {
              setTyping((current) => {
                const next = { ...current };
                delete next[key];
                return next;
              });
            }, 3500);
          }
        });

        socket.on('room.ai.trivia', ({ payload: trivia }) => {
          pushFeed({
            id: `trivia-${trivia.eventId}`,
            kind: 'trivia',
            title: trivia.title,
            text: trivia.text,
            tsSeconds: trivia.tsSeconds,
          });
        });

        socket.on('room.ai.character', ({ payload: cue }) => {
          pushFeed({
            id: `character-${cue.eventId}`,
            kind: 'character',
            title: cue.character,
            text: cue.text,
            tsSeconds: cue.tsSeconds,
          });
        });

        socket.on('room.ai.answer', ({ payload: answer }) => {
          setAsking(false);
          pushFeed({
            id: `answer-${answer.questionId || Date.now()}`,
            kind: 'answer',
            question: answer.question,
            answer: answer.answer,
            grounded: answer.grounded,
            sources: answer.sources,
            provider: answer.provider,
            latencyMs: answer.latencyMs,
            tsSeconds: answer.tsSeconds,
          });
        });

        socket.on('room.variation.available', ({ payload: available }) => {
          toast(`Variation point reached at ${formatTime(available.tsSeconds)} — the host can open a vote`, 'info', 5200);
        });

        socket.on('room.variation.voteOpen', ({ payload: vote }) => {
          setActiveVote({ ...vote, counts: vote.counts || {} });
          setMyBallot(null);
          setTab('variations');
          setUnread(0);
          toast('A variation vote is open', 'info', 3000);
        });

        socket.on('room.variation.voteUpdate', ({ payload: update }) => {
          setActiveVote((current) =>
            current && current.voteId === update.voteId
              ? { ...current, counts: update.counts, totalBallots: update.totalBallots }
              : current
          );
        });

        socket.on('room.variation.applied', ({ payload: result }) => {
          setApplied(result);
          setActiveVote(null);
          setMyBallot(null);
          loadVariations();
          toast(`Applied: ${result.winningOption?.label || 'variation'}`, 'success', 4500);
        });

        socket.on('room.system.message', ({ payload: system }) => {
          addSystemMessage(system.body);
        });

        socket.on('room.moderated', ({ payload: moderation }) => {
          if (moderation.action === 'muted') {
            setMuted(true);
            toast('The host muted you in this room', 'error');
          }
          if (moderation.action === 'unmuted') {
            setMuted(false);
            toast('You can chat again', 'success');
          }
        });

        socket.on('room.ended', () => {
          setEnded(true);
          setBanner({ tone: 'danger', text: 'The host ended this Watch Space.' });
        });

        socket.on('room.reaction', ({ payload: reaction }) => {
          const key = `${reaction.userId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const item = {
            key,
            emoji: reaction.emoji,
            left: 12 + Math.round(Math.random() * 70),
            delay: 0,
          };
          setReactions((current) => [...current.slice(-9), item]);
          reactionTimers.current[key] = setTimeout(() => {
            setReactions((current) => current.filter((entry) => entry.key !== key));
            delete reactionTimers.current[key];
          }, REACTION_TTL);
        });

        socket.on('room.timeline.updated', ({ payload: update }) => {
          toast(`Timeline metadata updated live (${update.eventCount} entries)`, 'info');
        });
      } catch (error) {
        if (!cancelled) {
          setFatal(
            error.status === 403
              ? 'This Watch Space is invite-only. Open the invite link or join with its code.'
              : error.message
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      Object.values(typingTimers.current).forEach(clearTimeout);
      Object.values(reactionTimers.current).forEach(clearTimeout);
      if (socket) {
        socket.emit('room.leave', { watchSpaceId: id });
        socket.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab === 'chat') setUnread(0);
  }, [tab]);

  const isHost = Boolean(you.isHost);

  const openAnalytics = async () => {
    setAnalyticsOpen(true);
    setAnalytics(null);
    try {
      const payload = await api(`/watch-spaces/${id}/analytics`);
      setAnalytics(payload.analytics);
    } catch (error) {
      toast(error.message, 'error');
      setAnalyticsOpen(false);
    }
  };

  const handleIntent = useCallback(
    async (action, value) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (action === 'reaction') {
        socket.emit('room.reaction', { watchSpaceId: id, emoji: value });
        return;
      }
      try {
        await emitAck(socket, 'room.playback.update', {
          watchSpaceId: id,
          action,
          positionSeconds: value,
        });
      } catch (error) {
        toast(error.message, 'error');
      }
    },
    [id, toast]
  );

  const sendChat = async (kind, value) => {
    const socket = socketRef.current;
    if (kind === 'typing') {
      socket?.emit('room.typing', { watchSpaceId: id, isTyping: value });
      return;
    }
    if (!socket?.connected) {
      toast('Reconnecting — try again in a moment', 'error');
      throw new Error('not connected');
    }
    try {
      await emitAck(socket, 'room.chat.message', { watchSpaceId: id, body: value });
    } catch (error) {
      toast(error.message, 'error');
      throw error;
    }
  };

  const askCoPilot = async (question) => {
    const ts = Math.round(currentPosition(playback));
    setAsking(true);
    const socket = socketRef.current;
    try {
      if (socket?.connected) {
        await emitAck(
          socket,
          'room.ai.ask',
          { watchSpaceId: id, question, currentTs: ts },
          20000
        );
        // The answer arrives as a room.ai.answer broadcast.
      } else {
        const payload = await api(`/watch-spaces/${id}/ai/ask`, {
          method: 'POST',
          body: { question, currentTs: ts },
        });
        setFeed((current) => [
          ...current.slice(-40),
          {
            id: `answer-${Date.now()}`,
            kind: 'answer',
            question,
            answer: payload.answer,
            grounded: payload.grounded,
            sources: payload.sources,
            provider: payload.provider,
            latencyMs: payload.latencyMs,
            tsSeconds: ts,
          },
        ]);
        setAsking(false);
      }
    } catch (error) {
      setAsking(false);
      toast(error.message, 'error');
    }
  };

  const openVote = async (variationId) => {
    const socket = socketRef.current;
    if (!socket?.connected) return toast('Reconnecting — try again in a moment', 'error');
    setVoteBusy(true);
    try {
      const ack = await emitAck(socket, 'room.variation.open', {
        watchSpaceId: id,
        variationId,
        durationSeconds: 45,
      });
      setActiveVote({ ...ack.vote, voteId: ack.vote.id, counts: ack.vote.counts || {} });
      setMyBallot(null);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setVoteBusy(false);
    }
  };

  const castBallot = async (optionId) => {
    const socket = socketRef.current;
    if (!socket?.connected || !activeVote) return;
    setVoteBusy(true);
    try {
      const ack = await emitAck(socket, 'room.variation.vote', {
        watchSpaceId: id,
        voteId: activeVote.voteId || activeVote.id,
        optionId,
      });
      setMyBallot(optionId);
      setActiveVote((current) =>
        current
          ? {
              ...current,
              counts: ack.vote?.counts || current.counts,
              totalBallots: ack.vote?.totalBallots || current.totalBallots,
            }
          : current
      );
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setVoteBusy(false);
    }
  };

  const closeVote = async () => {
    const socket = socketRef.current;
    if (!socket?.connected || !activeVote) return;
    setVoteBusy(true);
    try {
      await emitAck(socket, 'room.variation.close', {
        watchSpaceId: id,
        voteId: activeVote.voteId || activeVote.id,
      });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setVoteBusy(false);
    }
  };

  const copyInvite = async () => {
    const code = data?.watchSpace?.inviteCode;
    if (!code) return;
    const link = `${window.location.origin}/watch/${id}?code=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied', 'success');
    } catch {
      toast(`Invite code: ${code}`, 'info');
    }
  };

  const endSpace = async () => {
    if (!window.confirm('End this Watch Space for everyone?')) return;
    try {
      await api(`/watch-spaces/${id}/end`, { method: 'POST' });
      setEnded(true);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const leaveRoom = async () => {
    socketRef.current?.emit('room.leave', { watchSpaceId: id });
    await api(`/watch-spaces/${id}/leave`, { method: 'POST' }).catch(() => {});
    navigate('/');
  };

  const seek = (ts) => {
    if (!isHost) return;
    handleIntent('seek', ts);
  };

  const typingNames = useMemo(() => Object.values(typing).filter(Boolean), [typing]);
  const participantCount = participants.length || data?.watchSpace?.participantIds?.length || 0;

  if (loading) {
    return (
      <div className="page-loading" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>Joining the watch space…</span>
      </div>
    );
  }

  if (fatal || !data) {
    return (
      <div className="page">
        <div className="center-card">
          <div className="icon">⏻</div>
          <h1>Cannot open this room</h1>
          <p>{fatal || 'The Watch Space could not be loaded.'}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/browse">
              Browse the catalogue
            </Link>
            <Link className="btn btn-ghost" to="/">
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { watchSpace, title } = data;
  const hostName =
    data.host?.displayName ||
    participants.find((person) => String(person.userId) === String(watchSpace.hostUserId))?.displayName ||
    'the host';

  return (
    <div className="room-page">
      <div className="room-top">
        <Link className="icon-btn" to="/" aria-label="Back to dashboard">
          ←
        </Link>
        <div className="room-top-title">
          <h1>{watchSpace.name}</h1>
          <div className="meta">
            <span>{title.name}</span>
            <span>·</span>
            <span>{formatTime(title.durationSeconds)}</span>
            <span>·</span>
            <span>{participantCount} in the room</span>
            <span>·</span>
            <span>Host: {hostName}</span>
            {watchSpace.inviteCode && (
              <button
                type="button"
                className="citation"
                onClick={copyInvite}
                title="Copy the invite link"
              >
                {watchSpace.inviteCode} ⧉
              </button>
            )}
            {!connected && <span className="badge badge-gold">Reconnecting…</span>}
          </div>
        </div>
        <div className="room-top-actions">
          {isHost && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={openAnalytics}>
              Session report
            </button>
          )}
          {isHost && !ended && (
            <button type="button" className="btn btn-danger btn-sm" onClick={endSpace}>
              End space
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </div>

      {banner && (
        <div className={`room-banner ${banner.tone || ''}`}>
          <span style={{ flex: 1 }}>{banner.text}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="room-grid">
        <div>
          <VideoStage
            title={title}
            playback={playback}
            isHost={isHost}
            watchSpaceId={id}
            socket={socketRef.current}
            onIntent={handleIntent}
            reactions={reactions}
            ended={ended}
          />

          <div className="card" style={{ marginTop: 12, padding: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Now watching
                </div>
                <div style={{ fontWeight: 600 }}>
                  {title.name} <span className="faint">({title.year})</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {title.genres?.join(' · ')} · {title.timelineCount} authored timeline beats
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`badge ${isHost ? 'badge-red' : 'badge-blue'}`}>
                  {isHost ? 'Host' : 'Participant'}
                </span>
                <span className="badge">
                  {watchSpace.settings.aiVerbosity} co-pilot
                </span>
                <span className={`badge ${watchSpace.settings.votingEnabled ? 'badge-green' : ''}`}>
                  voting {watchSpace.settings.votingEnabled ? 'on' : 'off'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <aside className="room-side">
          <div className="panel">
            <div className="tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'copilot'}
                className={`tab ${tab === 'copilot' ? 'active' : ''}`}
                onClick={() => setTab('copilot')}
              >
                Co-pilot
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'chat'}
                className={`tab ${tab === 'chat' ? 'active' : ''}`}
                onClick={() => setTab('chat')}
              >
                Chat
                {unread > 0 && <span className="count">{unread}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'people'}
                className={`tab ${tab === 'people' ? 'active' : ''}`}
                onClick={() => setTab('people')}
              >
                People
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'variations'}
                className={`tab ${tab === 'variations' ? 'active' : ''}`}
                onClick={() => setTab('variations')}
              >
                Variants
                {activeVote && <span className="count">1</span>}
              </button>
            </div>

            {tab === 'copilot' && (
              <CoPilotPanel
                feed={feed}
                onAsk={askCoPilot}
                asking={asking}
                onSeek={seek}
                canSeek={isHost}
                disabled={ended || muted}
                title={title}
                suggestions={suggestions}
              />
            )}

            {tab === 'chat' && (
              <ChatPanel
                messages={messages}
                onSend={sendChat}
                typingNames={typingNames}
                selfId={user?.id}
                muted={muted}
                disabled={ended}
              />
            )}

            {tab === 'people' && (
              <div className="people">
                {participants.map((person) => (
                  <div className="person" key={person.userId}>
                    <div className="avatar">{initials(person.displayName)}</div>
                    <span className="name">{person.displayName}</span>
                    {String(person.userId) === String(watchSpace.hostUserId) ? (
                      <span className="crown" title="Host">
                        ♛ host
                      </span>
                    ) : person.muted ? (
                      <span className="tag">muted</span>
                    ) : (
                      <span className="tag">{person.role}</span>
                    )}
                  </div>
                ))}
                {!participants.length && <div className="side-empty">You are the first one here.</div>}
                <div className="side-empty" style={{ textAlign: 'left', paddingTop: 8 }}>
                  Room opened {relativeTime(watchSpace.createdAt)}. Playback is owned by the host;
                  if they drop, the longest-present participant is promoted after a grace period.
                </div>
              </div>
            )}

            {tab === 'variations' && (
              <VariationPanel
                variations={variations}
                activeVote={activeVote}
                applied={applied}
                isHost={isHost}
                votingEnabled={watchSpace.settings.votingEnabled && !ended}
                onOpen={openVote}
                onVote={castBallot}
                onClose={closeVote}
                myBallot={myBallot}
                busy={voteBusy}
                canSeek={isHost}
                onSeek={seek}
              />
            )}
          </div>
        </aside>
      </div>

      {analyticsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAnalyticsOpen(false);
        }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
            <div className="modal-head">
              <h2 id="report-title">Session report</h2>
              <button className="btn btn-quiet" type="button" onClick={() => setAnalyticsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {!analytics ? (
                <div className="row">
                  <span className="spinner" /> <span className="muted">Reconciling the event log…</span>
                </div>
              ) : (
                <>
                  <div className="kpis">
                    <div className="kpi">
                      <div className="kpi-value">{analytics.chatMessages}</div>
                      <div className="kpi-label">Chat messages</div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-value">{analytics.aiQuestions}</div>
                      <div className="kpi-label">Co-pilot questions</div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-value">{analytics.triviaSurfaced}</div>
                      <div className="kpi-label">Trivia surfaced</div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-value">{analytics.peakConcurrentParticipants}</div>
                      <div className="kpi-label">Peak participants</div>
                    </div>
                  </div>

                  <div className="notice">
                    <strong>Event-log reconciliation:</strong>{' '}
                    {Object.entries(analytics.reconciled || {})
                      .map(([key, ok]) => `${key}: ${ok ? 'match' : 'drift'}`)
                      .join(' · ')}
                    <br />
                    Observed session {formatTime(analytics.observedDurationSeconds)} ·{' '}
                    {analytics.eventCount} events · playback at{' '}
                    {formatTime(analytics.playbackPositionSeconds)}
                  </div>

                  <div>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>
                      Checklist for this room
                    </div>
                    <div className="stack" style={{ gap: 4 }}>
                      {Object.entries(analytics.countsByType || {}).map(([type, count]) => (
                        <div key={type} className="row" style={{ justifyContent: 'space-between' }}>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {type.replaceAll('_', ' ')}
                          </span>
                          <span className="citation">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" type="button" onClick={() => setAnalyticsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
