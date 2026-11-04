# API reference

Base URL: `/api/v1`. All JSON. Authenticated requests use `Authorization: Bearer <accessToken>`.

Error shape:

```json
{ "error": { "code": "forbidden", "message": "Only the host of this Watch Space can do that" } }
```

| Status | Meaning |
| --- | --- |
| 400 | malformed request |
| 401 | missing/invalid/expired access token |
| 403 | authenticated but not allowed (role, membership or host) |
| 404 | resource not found |
| 409 | conflict (duplicate account, room full, vote already open, room ended) |
| 422 | Zod validation failed; `details[]` has `path` and `message` |
| 429 | rate limited |

Rate limits: 600 requests/min per IP for `/api`; 30/min for login, register and refresh. Socket commands have per-socket buckets (playback 20/s, chat 6/3 s, AI 3/5 s).

---

## Auth

### `POST /auth/register`

```json
{
  "email": "ada@example.com",
  "password": "CorrectHorse1",
  "displayName": "Ada Lovelace",
  "accountType": "host"
}
```

`accountType` is `viewer` (default) or `host`. Returns `201`:

```json
{
  "accessToken": "…",
  "refreshToken": "…",
  "tokenType": "Bearer",
  "expiresIn": "45m",
  "user": { "id": "…", "email": "ada@example.com", "displayName": "Ada Lovelace", "role": "host", "preferences": { "subtitleLocale": "en", "genreAffinity": [] } }
}
```

### `POST /auth/login`

`{ "email", "password" }` → same token envelope. Invalid credentials return `401`.

### `POST /auth/refresh`

`{ "refreshToken" }` → a new pair. The used token is revoked and linked to its replacement; reuse returns `401`.

### `POST /auth/logout`

`{ "refreshToken" }` → `204`. Revokes that token.

### `GET /auth/me`

Returns `{ "user": … }` for the bearer token.

### `PATCH /auth/me`

`{ "displayName"?: string, "preferences"?: { "subtitleLocale"?: string, "genreAffinity"?: string[] } }`.

### `GET /auth/users/lookup?email=…`

Returns `{ user: { id, displayName, role } }` or `404`. Used to invite by email.

---

## Health and metadata

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | `{ status: "ok", uptimeSeconds, version, timestamp }` |
| `GET` | `/readyz` | none | database/realtime status, `activeRooms`; `503` when DB is down |
| `GET` | `/meta/ai` | none | active provider, model, fallback and grounding description |

---

## Titles and timelines

### `GET /titles?q=&genre=`

Up to 60 titles, sorted by name. Each item is the public title shape (`id`, `name`, `slug`, `year`, `synopsis`, `durationSeconds`, `genres`, `videoAssetUrl`, `posterUrl`, `accentColor`, `license`, `timelineCount`).

### `GET /titles/:titleId`

Public title plus `genres` and `timelineSummary` counts (`total`, `trivia`, `characters`, `glossary`, `variationPoints`).

### `GET /titles/:titleId/timeline?from=0&to=600&types=trivia,character`

Events within a range, sorted by `ts`. Types are `trivia`, `character`, `glossary`, `variation_point`, `beat`. Variation points are returned as `type: "variationPoint"` with `variationId`, `variationKind` and `options[]`.

```json
{
  "titleId": "…",
  "from": 0,
  "to": 600,
  "count": 2,
  "events": [
    { "id": "st_002", "ts": 20, "endTs": 888, "type": "character", "character": "Sintel", "text": "Sintel — a young woman…", "tags": ["protagonist"], "priority": "high" }
  ]
}
```

---

## Watch spaces

### `POST /watch-spaces`

Role: `host` or `admin`.

```json
{
  "titleId": "…",
  "name": "Friday night",
  "visibility": "invite",
  "maxParticipants": 25,
  "aiVerbosity": "normal",
  "votingEnabled": true,
  "subtitlesEnabled": true
}
```

`201`:

```json
{
  "watchSpaceId": "…",
  "inviteCode": "NX-ZJU4",
  "status": "scheduled",
  "hostUserId": "…",
  "joinUrl": "/watch/…?code=NX-ZJU4",
  "watchSpace": { "…": "public shape with settings, participantIds, counters" },
  "title": { "…": "public title" }
}
```

### `GET /watch-spaces?scope=mine|live|upcoming|public`

Lists up to 40 spaces. `mine` includes hosted and joined rooms; `live` returns status `live`; `upcoming` returns the caller's scheduled rooms; `public` returns public non-ended rooms. Each row includes `title` and `live`.

### `GET /watch-spaces/by-code/:inviteCode`

Case-insensitive invite lookup. Returns `{ watchSpace, title, isMember }`.

### `GET /watch-spaces/:id`

Members and admins get full room data. Public rooms are visible to any signed-in user; invite-only rooms return `403` with the hint to use an invite link. Response:

```json
{
  "watchSpace": { "…": "public shape", "isMember": true },
  "title": { "…": "public title" },
  "host": { "id": "…", "displayName": "Hari Host", "role": "host" },
  "participants": [{ "userId": "…", "displayName": "Hari Host", "role": "host", "joinedAt": "…", "muted": false, "connections": 1 }],
  "playback": { "status": "paused", "positionSeconds": 0, "durationSeconds": 888, "revision": 3, "serverNow": 0 },
  "live": true
}
```

### `POST /watch-spaces/:id/join`

Adds durable membership, returns the room, title, `isHost`, playback and presence. Joining an ended or locked room returns `409`/`403`; a full room returns `409`.

### `POST /watch-spaces/:id/leave` → `204`

Removes membership. If the host leaves, the room hands over to the longest-present connected participant when possible.

### `PATCH /watch-spaces/:id`

Host/admin. `{ "name"?, "settings"?: { maxParticipants?, aiVerbosity?, votingEnabled?, subtitlesEnabled? } }`. Changes are broadcast to the room.

### `POST /watch-spaces/:id/end`

Host/admin. Marks the room ended, pauses the clock, broadcasts `room.ended`, writes a system message and removes the runtime.

### `POST /watch-spaces/:id/moderate`

Host/admin.

```json
{ "action": "mute | unmute | remove | lock | unlock | transfer-host", "targetUserId": "…" }
```

`targetUserId` is required for mute/unmute/remove/transfer-host.

### `GET /watch-spaces/:id/chat?limit=80&before=<ISO date>`

Member only. Returns messages ascending, including `chat`, `system` and `ai_answer` types.

### `GET /watch-spaces/:id/variations`

Member only. Returns all authored variation points with their options and any recorded votes (public shape: counts, status, winner).

### `POST /watch-spaces/:id/ai/ask`

Member, not muted.

```json
{ "question": "Who is the dragon hatchling?", "currentTs": 60 }
```

`currentTs` is optional; the room clock is used when absent. Response:

```json
{
  "answer": "That's Scales. The wounded dragon hatchling Sintel finds in the ravine…",
  "grounded": true,
  "sourceEvents": ["st_005", "title:…"],
  "sources": [{ "id": "st_005", "ts": 108, "type": "character", "text": "…", "character": "Scales" }],
  "provider": "grounded-synthesizer",
  "confidence": 0.82,
  "latencyMs": 22,
  "generatedAt": "2026-11-04T…",
  "questionId": "q_ab12cd34"
}
```

When retrieval cannot support an answer: `grounded: false`, `sourceEvents: []`, and an explicit decline message. The same payload is broadcast as `room.ai.answer` and persisted as an `ai_answer` chat message.

### Votes

| Method | Path | Role | Body |
| --- | --- | --- | --- |
| `POST` | `/watch-spaces/:id/votes` | host/admin | `{ variationId, durationSeconds? }` → `201 { vote }` |
| `POST` | `/watch-spaces/:id/votes/:voteId/ballot` | member | `{ optionId }` → `{ vote }` |
| `POST` | `/watch-spaces/:id/votes/:voteId/close` | host/admin | `{}` → `{ vote }` |
| `GET` | `/watch-spaces/:id/votes/:voteId` | member | `{ vote }` |
| `POST` | `/watch-spaces/:id/variations/:variationId/apply` | host/admin | `{ optionId }` → `{ applied }` (direct apply, no vote) |

Vote shape:

```json
{
  "id": "…",
  "watchSpaceId": "…",
  "variationId": "st_014",
  "question": "Choose the caption for the moment Sintel calms the hatchling",
  "options": [{ "id": "opt_en", "label": "Original English", "description": "…" }],
  "status": "open",
  "closesAt": "2026-11-04T…",
  "winningOptionId": "",
  "ballotCount": 1,
  "counts": { "opt_en": 0, "opt_hi": 1, "opt_es": 0 },
  "totalBallots": 1
}
```

### `GET /watch-spaces/:id/analytics`

Host/admin. Returns the event-log summary, cached counters, per-metric reconciliation, duration, connected count and live playback position.

```json
{
  "analytics": {
    "eventCount": 40,
    "chatMessages": 1,
    "aiQuestions": 3,
    "triviaSurfaced": 1,
    "peakConcurrentParticipants": 2,
    "observedDurationSeconds": 358,
    "countsByType": { "chat": 1, "participant_joined": 5, "…": 0 },
    "counters": { "chatCount": 1, "aiQuestionCount": 3, "triviaCount": 1, "peakParticipants": 2 },
    "reconciled": { "chatMessages": true, "aiQuestions": true, "triviaSurfaced": true, "peakParticipants": true }
  }
}
```

---

## Engagement

### `GET /recommendations?limit=10`

```json
{
  "recommendations": [
    {
      "titleId": "…",
      "title": { "…": "public title" },
      "score": 0.4812,
      "components": { "content": 0.62, "collaborative": 0.21, "popularity": 0.34 },
      "reasons": ["Matches your Fantasy affinity"]
    }
  ],
  "method": "hybrid-content-cf",
  "weights": { "content": 0.6, "collaborative": 0.35, "popularity": 0.05 },
  "model": { "items": 6, "interactions": 27, "precisionAt5": 1, "builtAt": "…" },
  "latencyMs": 3
}
```

### `POST /interactions`

```json
{
  "titleId": "…",
  "watchedSeconds": 620,
  "completed": false,
  "rating": 4,
  "watchSpaceId": "…",
  "coWatchedWith": ["…"]
}
```

`completionRatio` is derived from the title duration; `completed` also becomes true at ≥95%. Invalidates the recommender cache.

### `GET /dashboard`

Returns the current user, stats (`titlesWatched`, `hoursWatched`, `aiQuestionsAsked`, `sessionsHosted`), up to 8 `recentlyWatched` entries, `activeRooms`, `upcomingRooms` and an 8-item recommendation rail.

---

## Admin

All routes require role `admin`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/titles` | all titles **including** timelines |
| `POST` | `/admin/titles` | create title (validated timeline optional) |
| `PATCH` | `/admin/titles/:id` | update metadata (not the timeline) |
| `POST` | `/admin/titles/:id/timeline/validate` | dry-run validation; `200` valid or `422` with `errors[]` and counts |
| `PUT` | `/admin/titles/:id/timeline` | validate + publish; live rooms on the title receive `room.timeline.updated` |
| `GET` | `/admin/users` | users + interaction counts |
| `PATCH` | `/admin/users/:id/role` | `{ role: "viewer"|"host"|"admin" }` |
| `POST` | `/admin/recommendations/retrain` | rebuild + evaluate, persist a `RecommendationRun` |
| `GET` | `/admin/recommendations/report` | latest run + live model metrics |

Timeline validation errors:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Timeline failed validation",
    "details": [{ "path": "timeline[3].options", "message": "Variation points need at least two pre-approved options" }]
  }
}
```

---

## Socket.io

Path `/socket.io`. Authenticate in the handshake:

```js
io({ auth: { token: accessToken } })
// or headers: { Authorization: `Bearer ${token}` }
```

An invalid token rejects with `Error("unauthorized")`.

### Envelopes

Server broadcasts:

```json
{ "event": "room.playback.update", "watchSpaceId": "…", "payload": { }, "ts": 1760000000000 }
```

Commands use an acknowledgement callback:

```js
socket.emit('room.join', { watchSpaceId }, (response) => {
  // { ok: true, ... } or { ok: false, error: { code, message } }
});
```

### Client → server

| Event | Auth | Payload |
| --- | --- | --- |
| `room.join` | member | `{ watchSpaceId }` or `{ inviteCode }` |
| `room.leave` | connected | `{ watchSpaceId }` |
| `room.playback.update` | **host only** | `{ watchSpaceId, action: "play"\|"pause"\|"seek"\|"buffer"\|"ready"\|"seekEnd", positionSeconds? }` |
| `room.sync.ping` | member | `{ watchSpaceId, clientSentAt, positionSeconds }` |
| `room.chat.message` | member, not muted | `{ watchSpaceId, body, clientMessageId? }` |
| `room.typing` | member | `{ watchSpaceId, isTyping }` |
| `room.reaction` | member | `{ watchSpaceId, emoji }` |
| `room.ai.ask` | member | `{ watchSpaceId, question, currentTs }` |
| `room.variation.open` | host/admin | `{ watchSpaceId, variationId, durationSeconds? }` |
| `room.variation.vote` | member | `{ watchSpaceId, voteId, optionId }` |
| `room.variation.close` | host/admin | `{ watchSpaceId, voteId }` |
| `room.subtitle.set` | member | `{ watchSpaceId, locale, subtitle? }` (echoed to the caller) |

### Server → client

| Event | Payload |
| --- | --- |
| `room.state.snapshot` | `{ watchSpace, title, playback, presence, serverNow, you: { userId, role, isHost } }` |
| `room.playback.update` | `{ action, status, positionSeconds, durationSeconds, revision, updatedAt, serverNow, issuedBy, reason? }` |
| `room.sync.ping` ack | `{ authoritativePositionSeconds, status, revision, driftMs, correction, hostUserId, serverNow }` |
| `room.presence.update` | `{ participants, participantCount, hostUserId, locked, mutedUserIds, action, participantId }` |
| `room.host.changed` | `{ previousHostUserId, hostUserId, displayName, reason, playback }` |
| `room.host.disconnected` | `{ hostUserId, paused, graceMs, playback, policy }` |
| `room.host.reconnected` | `{ hostUserId }` |
| `room.chat.message` | public chat message |
| `room.typing` | `{ userId, displayName, isTyping }` |
| `room.reaction` | `{ userId, displayName, emoji, tsSeconds }` |
| `room.ai.trivia` | `{ eventId, text, title, character, scene, tsSeconds, priority, auto }` |
| `room.ai.character` | `{ eventId, character, text, tsSeconds }` (chatty rooms) |
| `room.ai.answer` | same as the REST AI ask payload plus message ids and `tsSeconds` |
| `room.variation.available` | `{ variationId, tsSeconds, question, options, variationKind }` |
| `room.variation.voteOpen` | `{ voteId, variationId, question, options, closesAt, durationSeconds, tsSeconds }` |
| `room.variation.voteUpdate` | `{ voteId, variationId, counts, totalBallots }` |
| `room.variation.applied` | `{ voteId, variationId, winningOptionId, winningOption, variationKind, counts, tsSeconds, appliedAt }` |
| `room.system.message` | `{ body }` |
| `room.moderated` | `{ action: "muted"\|"unmuted", by }` (sent only to the target) |
| `room.lock.update` | `{ locked, by }` |
| `room.ended` | `{ endedBy, endedAt, playback }` |
| `room.timeline.updated` | `{ titleId, eventCount }` |
| `room.subtitle.variant` | `{ locale, subtitle }` |

### Socket error codes

`unauthorized`, `not_found`, `not_joined`, `not_member`, `not_host`, `forbidden`, `muted`, `rate_limited`, `empty_message`, `room_ended`, `room_full`, `room_locked`.
