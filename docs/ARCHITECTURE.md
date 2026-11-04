# Architecture

## 1. Shape of the system

```
┌──────────────────────────────┐        ┌──────────────────────────────────────┐
│ React SPA (Vite)             │        │ Node.js / Express                    │
│                              │  HTTP  │  /api/v1/*                           │
│  Auth context + refresh      │───────▶│  auth · RBAC · Zod · rate limits     │
│  Room page                   │        │                                      │
│   ├─ VideoStage              │  WS    │  Socket.io gateway (JWT handshake)   │
│   ├─ Chat / CoPilot          │◀──────▶│   room.join / playback / chat / AI    │
│   ├─ VariationPanel          │        │   votes / reactions / presence        │
│   └─ People + report         │        └───────────────┬──────────────────────┘
└──────────────────────────────┘                        │
                                                        ▼
                                        ┌──────────────────────────────────┐
                                        │ Room runtime (single process)    │
                                        │  clock · presence · ticker       │
                                        │  host grace · vote timers        │
                                        └───────┬───────────────┬──────────┘
                                                │               │
                                   ┌────────────▼───┐   ┌───────▼───────────┐
                                   │ MongoDB        │   │ AI + recommender  │
                                   │ durable state  │   │ pure services     │
                                   └────────────────┘   └───────────────────┘
```

The SPA is served from the same origin as the API in production, so cookies are unnecessary and the Socket.io upgrade is same-origin. In development Vite proxies `/api` and `/socket.io` to Express.

## 2. Responsibilities

| Layer | Location | Owns |
| --- | --- | --- |
| Transport | `server/src/app.js`, `server/src/sockets/index.js` | routing, validation, auth, rate limits, event framing |
| Domain services | `server/src/services` | playback rules, retrieval, voting, recommendations, analytics |
| Persistence | `server/src/models` | durable entities and indexes |
| Runtime | `roomRuntime.js` | authoritative ephemeral room state |
| UI | `client/src` | server-state application, local media control, presentation |

Controllers are deliberately thin: routes parse input, call one service, and shape a response. Socket handlers reuse the same services as REST (`coPilot.askInRoom`, `voteService.*`) so permissions and side effects cannot drift between transports.

## 3. Data model

### User
`email` (unique, lowercase), `passwordHash` (bcrypt, cost 10), `displayName`, `role` (`viewer|host|admin`), `preferences.subtitleLocale`, `preferences.genreAffinity`, timestamps. `toPublic()` never exposes the hash.

### Title
`name`, `slug` (unique), `year`, `synopsis`, `durationSeconds`, `genres[]`, `videoAssetUrl`, `posterUrl`, `accentColor`, `license`, `createdBy`, and an **embedded timeline**:

| Field | Meaning |
| --- | --- |
| `id` | stable authored id (e.g. `st_014`) |
| `ts`, `endTs` | playhead markers in seconds |
| `type` | `beat`, `character`, `glossary`, `trivia`, `variation_point` |
| `title`, `text`, `scene`, `character`, `term`, `definition`, `tags[]`, `priority` | content |
| `variationKind`, `options[]`, `defaultOptionId` | only for variation points |

Options carry `id`, `label`, `description`, optional `subtitle {locale, text}`, `assetRef`. The timeline is validated by Zod plus semantic checks before storage; duplicate ids, out-of-duration timestamps, invalid ranges, missing glossary fields and votes without two options are rejected with path-level errors.

### WatchSpace
`titleId`, `hostUserId`, `name`, `inviteCode` (unique, `NX-XXXX`), `status` (`scheduled|live|ended`), `visibility` (`public|invite`), `locked`, `settings { maxParticipants, aiVerbosity, votingEnabled, subtitlesEnabled }`, `participantIds[]`, `peakParticipants`, denormalised counters (`chatCount`, `aiQuestionCount`, `triviaCount`), timestamps. Membership is durable; live presence is not.

### Vote
`watchSpaceId`, `titleId`, `variationId`, `question`, `options[]`, `status`, `closesAt`, `openedBy`, `ballots[{userId, optionId, createdAt}]`, `winningOptionId`, `closedAt`. A unique-by-convention open vote per `(room, variation)` is enforced in the service.

### ChatMessage
`watchSpaceId`, `userId` (nullable for AI/system), `displayName`, `type` (`chat|system|ai_answer`), `body`, `tsSeconds`, `payload` (citations, question id, provider), timestamps.

### Interaction
`userId`, `titleId`, `watchSpaceId`, `watchedSeconds`, `completionRatio`, `completed`, `rating`, `coWatchedWith[]`, `source` (`room|manual|seed`). Drives history and the recommender.

### SessionEvent
Append-only event log: `room_created`, `room_started`, `room_ended`, `participant_joined`, `participant_left`, `chat`, `ai_question`, `ai_answer`, `trivia_surfaced`, `variation_opened`, `variation_vote`, `variation_applied`, `host_disconnected`, `host_reconnected`, `host_changed`, `subtitle_swapped`. Each has `watchSpaceId`, optional `userId`, flexible `payload`, `createdAt`.

### RefreshToken / RecommendationRun
Refresh tokens store only SHA-256 hashes, revocation and rotation links. Recommendation runs persist model metadata and leave-one-out metrics for the admin report.

Indexes: unique user email, unique title slug, `timeline.ts`, `WatchSpace.hostUserId/participantIds/status`, `Vote.watchSpaceId+variationId+status`, `Interaction.userId+createdAt`, `SessionEvent.watchSpaceId+createdAt`.

## 4. Realtime room lifecycle

### Join

1. Client performs `GET /watch-spaces/:id` (membership, public visibility, invite code fallback).
2. If needed, `POST /watch-spaces/:id/join` adds durable membership.
3. Client opens a socket with `auth.token`; the gateway verifies the access token via the same service as REST.
4. `room.join` loads the room and title, ensures membership, attaches presence, and replies with an ack plus a `room.state.snapshot` broadcast containing watch space, title, playback snapshot, presence and `you.isHost`.

An ack contract is used for every socket command: `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`. The client surfaces failures as toasts rather than silently diverging.

### Playback

Only the host may emit `room.playback.update`; the runtime checks `hostUserId` before transitioning. Every accepted intent increments `revision` and broadcasts the new snapshot with `issuedBy`. Seeks enter `seeking` and settle 300 ms later (or on `seekEnd`), which prevents a burst of seek positions from becoming the room clock.

Participants do not write playback. They emit `room.sync.ping` with their local position; the server returns the authoritative position, drift and a correction decision. The client owns media execution only.

### Trivia

A 1 s interval compares the last tick position with the current authoritative position. Markers crossed in the window are emitted at most once per room (`triviaSeen`), with a 5 s catch-up window so a seek does not replay the whole film. `aiVerbosity` controls whether only high-priority trivia (`minimal`), all trivia (`normal`) or trivia plus character cues (`chatty`) is emitted.

### Host loss

Disconnect pauses playback immediately and emits `host.disconnected` with the grace period. After `HOST_DISCONNECT_GRACE_MS` (15 s) the runtime promotes the longest-present connected participant, persists the new host, emits `host.changed` and a system message. Playback deliberately stays paused so the new host chooses when to resume. A reconnecting host within the grace window cancels promotion and emits `host.reconnected`.

### Votes

`voteService.openVote` validates the variation exists, refuses a second open vote for the same point, creates a timed vote and emits `voteOpen`. `castBallot` upserts one ballot per user, emits counts, and reschedules the auto-close timer. `closeVote` tallies (ties resolve deterministically to the first option by count then authored order), persists the winner, broadcasts `variation.applied` and writes a system chat line. Live rooms receive the applied subtitle through the same event.

## 5. Grounded AI pipeline

`aiEngine.retrieveContext` is pure and synchronous:

1. Corpus = title synopsis + every timeline entry (character, beat, trivia, glossary, variation options).
2. Query terms are lowercased, stopword-filtered and lightly stemmed; two-word phrases are also checked.
3. Intent detection picks boosts (`who` favours characters, `glossary` favours glossary rows, `variation` favours variation points).
4. Only entries at or before `currentTs + lookahead` and after `currentTs - lookback` are eligible; glossary rows are timeless but still must share a term.
5. Score = Σ IDF·(1 + 0.35·min(tf,4)) + phrase bonus + type boost + recency decay + priority bonus.
6. Grounding requires `bestScore ≥ AI_MIN_SCORE` and (`coverage ≥ AI_MIN_COVERAGE` or an intent-aligned top entry). Coverage is matched content terms / query content terms.

The deterministic composer builds at most three sentences and returns the source ids. If a provider is configured, the model receives only the retrieved context and must return JSON with `citationIds`; responses with no valid citations are discarded. Failures fall back to the deterministic answer.

## 6. Recommendation model

- **Content:** per-title TF-IDF over genres, tags and title tokens; user profile is the weighted mean of interacted title vectors.
- **Collaborative:** cosine similarity between title interaction vectors, weighted by recency/completion; user score is similarity × interaction weight, normalised.
- **Popularity:** normalised interaction count.
- Final score `0.60·content + 0.35·cf + 0.05·popularity`; completed titles excluded, partially watched items multiplied by 0.6.
- Reasons are generated from the components (affinity, co-watch, popularity, continue).
- The model cache is invalidated by new interactions and rebuilt on demand. `evaluatePrecisionAtK` performs leave-one-out evaluation using a model rebuilt without each held-out interaction, so the metric is not leaking the answer.

## 7. Security model

- Access tokens are short-lived (45 min default); refresh tokens are hashed, rotated on use and revoked on logout.
- Passwords are bcrypt-hashed; registration enforces 8–128 characters and Zod validates every payload.
- REST RBAC: `requireRole` for host/admin areas; `assertRoomHost` for room-scoped mutations; `assertMember` for room data, AI and chat.
- Socket handlers repeat membership/host checks server-side; client claims are never trusted.
- Text input is stripped of control characters and length-limited; React escapes output.
- Helmet, compression, CORS allowlist, request IDs, auth rate limiting (30/min) and API rate limiting (600/min).
- Production boot refuses default JWT secrets.

## 8. Observability

- Structured JSON logs with scope, event name, request id, user id, route, status and duration.
- `/healthz` liveness and `/readyz` readiness (database + realtime gateway + active rooms).
- Session events enable post-hoc reconciliation; the host report compares counters to the log and shows a match/drift flag per metric.

## 9. Deliberate trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| Embedded Mongo fallback | zero-setup demo, deterministic tests | data under `server/.mongo`, not for production |
| In-memory room runtime | authoritative low-latency clock, simple reasoning | single process; no horizontal scale without Redis/sharding |
| Socket and REST both expose AI/vote paths | resilient clients, testability | two entry points; mitigated by shared services |
| Authored timelines with approximate timestamps | no frame-accurate source metadata for open films | markers can be a few seconds early/late |
| Deterministic AI fallback | demo works without keys; no hallucinated plot | less fluent than an LLM |
| No client state library | small, explicit state surface | Room component is large; acceptable for this scope |
| Single vote per person, no proxies | simple fairness model | no weighted or delegated voting |
