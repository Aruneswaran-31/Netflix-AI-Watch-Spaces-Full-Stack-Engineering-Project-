# Test and verification report

Run on 6 November 2026, Node 22 (Windows 11), MongoDB 7 in-memory for tests. Raw output is committed alongside this report:

- [jest.log](evidence/jest.log) — full unit/integration suite
- [loadtest.log](evidence/loadtest.log) — dashboard load test
- [recommender-eval.log](evidence/recommender-eval.log) — offline recommender evaluation

## 1. Automated suite

```
cd server && npm test
```

```
Test Suites: 8 passed, 8 total
Tests:       60 passed, 60 total
Time:        28.885 s
```

| Suite | What it proves |
| --- | --- |
| `playbackStateMachine.test.js` (8) | The clock only advances while playing; pause/resume keeps position; seek freezes and restores the previous status; buffering → ready restores paused; clamping; revision monotonicity; drift sign and the soft/hard correction thresholds. |
| `timeline.test.js` (8) | Timeline validation rejects overlapping trivia, out-of-range timestamps, duplicate ids, malformed variation options and missing approved options; valid authored timelines pass; in-range retrieval and window filtering are correct. |
| `aiEngine.test.js` (9) | Grounded answers cite only ids that exist and have already played; no answer is invented when retrieval fails; off-timeline and prompt-injection questions are declined; glossary questions resolve to the timeless entry; variation questions return only pre-approved options; catalogue-level questions fall back to the synopsis. |
| `realtime.test.js` (7) | Two real Socket.io clients synchronise on host play/seek with bounded drift; non-host playback intents are rejected; non-members cannot join; chat is persisted and broadcast; disconnect removes presence; host drop pauses the room and hands the host to the longest-present participant. |
| `api.rbac.test.js` (15) | Register/login/refresh/logout, duplicate-account conflict, viewer cannot create a room or open a vote, non-host cannot moderate or end, private rooms hide from non-members, invite codes join correctly, ballots are unique per user, vote tally and winner application, admin-only title editing, 401/403/422 shapes. |
| `analytics.test.js` (2) | Event-log aggregation, peak-concurrency computation, reconciliation against denormalised counters, observed duration and the live-playback position. |
| `recommendations.test.js` (5) | Hybrid scoring uses content + collaborative + popularity, unseen titles outrank already-watched ones, reasons are produced, cold-start users still get a sensible rail, and precision@5 computes correctly on a synthetic case. |
| `media.test.js` (6) | The committed sample clips are served with a `video/mp4` content type, Range requests answer `206` with a `Content-Range` (the browser needs this to seek), unknown assets `404`, every local media reference in the seed resolves to a file that exists, every title has a locally served JPEG poster over 4 kB, and every full film carries a local fallback. Added after real defects: the app streamed every title from a third-party host and playback died outright on networks that block it, and the catalogue shipped `posterUrl: ''` so every card rendered a blank tile. |

The suite runs against a real Express app (Supertest) and a real MongoDB (`mongodb-memory-server`), not mocks, so routing, JWT auth, Mongoose queries and Socket.io all execute.

## 2. Browser walkthrough (manual, two participants)

Driven in a Chromium session against the Vite client and the real API, signed in as the seeded host, viewer and admin accounts.

| Check | Result |
| --- | --- |
| Register/login, session restore, role-aware navigation | Pass — the viewer's shell hides host actions; the admin gets the Admin workspace. |
| Browse and title detail | Pass — catalogue loads from the seeded titles with timeline counts. |
| Create a Watch Space as host, open it | Pass — invite code issued, player mounts, presence lists the host. |
| Play/pause/seek propagation to a second signed-in viewer | Pass — viewer received the host action; the sync badge measured **≈200 ms** drift on localhost and the viewer's controls were disabled. |
| Viewer attempts to control playback | Pass — server rejected the intent, no state change. |
| Pause at 0:20, wait for scene trivia | Pass — the excerpt's trivia fired automatically once the clock crossed its timestamp, with the exact scene text. |
| Ask the co-pilot "who is this character" | Pass — grounded answer, cited the character event id, no repeated name artifact after the fix. |
| Ask an off-timeline question | Pass — explicit decline instead of an invented answer. |
| Open a variation vote as host, vote as viewer | Pass — options, live tally and countdown rendered; closing applied the winning caption to the stage and broadcast `room.variation.applied`. |
| Host session report | Pass after a real fix — joins were not written to the event log, so peak concurrency could not reconcile. `participant_joined` is now recorded at join time and the report's `reconciled` flags are all true. |
| Host closes the tab | Pass — the room paused, showed the grace banner, then handed hosting to the longest-present participant and broadcast `room.host.changed`. |
| Non-member opening an invite-only room URL | Pass — 403 with an invite-code prompt. |
| Ended room | Pass — join rejected, UI shows the ended state. |
| Play a room backed by a committed clip | Pass — `The Ridge — Short` streamed from `/api/v1/media/sintel-10s.mp4` through the Vite proxy (`206 Partial Content`), the host's play propagated and the sync pill read **Playing in sync**. |
| Simulated upstream failure on a full film | Pass — dispatching a media `error` on the Sintel stage replaced the source with the local clip (`duration 10`, `loop`, **Sample clip** badge) and playback resumed in sync instead of leaving a dead stage. |

## 3. Performance

### API load test

`npm run loadtest` — 120 requests to `GET /api/v1/dashboard` (auth + Mongo reads + cached recommendation rail), concurrency 12, in-process against the real database:

| Metric | Value |
| --- | --- |
| Requests | 120 (100% `200`) |
| Throughput | 20.9 req/s |
| p50 | 542 ms |
| p95 | 801 ms |
| p99 | 826 ms |

This is a single Node process on a developer laptop with `mongodb-memory-server`-free but local MongoDB, and each dashboard request performs several aggregate queries. It is a regression baseline, not a capacity claim. The realtime path is push-based and does not poll; sync pings are opt-in to detect large drift.

### Realtime behaviour

- Playback sync is computed from a server-authoritative clock (`position = base + (now - baseAt)`) and sent as responses to per-client pings, so no per-tick broadcast load.
- Trivia is scheduled once per room from the current position; the scheduler recomputes on seek/pause and never fires events twice.
- The AI co-pilot answers from the in-process grounded retriever; a local answer costs **~15–40 ms** (recorded per answer in `latencyMs`). With a provider key, the model call is the dominant cost and is reported honestly as `provider: "openai"`; the grounded retriever still gates what context can be used.

### Recommender evaluation

`npm run eval:recs` — leave-one-out over the seeded interaction history:

```json
{ "catalogueItems": 10, "interactions": 38, "users": 9, "evaluatedUsers": 9,
  "precisionAt5": 0.8889, "recallAt5": 0.8889, "buildMs": 55 }
```

Eight of nine held-out interactions come back in the top five across a ten-title catalogue. The score was 1.00 on the earlier six-title catalogue; the drop is the honest cost of a sparse interaction matrix, not a regression — it is a correctness check of the ranking pipeline, not evidence of production quality. The same number is surfaced in the admin panel.

## 4. Known limitations

- Playback is coordinated, not DRM-protected. The client plays openly licensed MP4s (Sintel, Big Buck Bunny, Elephants Dream, Tears of Steel, Caminandes: Llamigos, Spring, Sprite Fright) and committed short excerpts served by the API; a production Netflix integration would need their player SDK and licence handshake, which is out of scope for a public demo.
- The full films stream from archive.org, which some ISPs block. The player then falls back to a committed sample clip (10 or 20 seconds, badge shown), so the timeline features keep working but the picture is not the full film.
- Socket.io runs in a single process. Horizontal scaling needs the Redis adapter and a shared room clock store; the runtime is isolated in `roomRuntime.js` so that swap is contained.
- The grounded retriever is an in-process lexical/index hybrid over the authored timeline, sized for a curated catalogue. Larger catalogues want a vector store behind the same `retrieve()` interface.
- The recommender's collaborative signal is thin at demo scale; it is blended with content and popularity and evaluated offline rather than A/B tested.
- Moderation covers mute/remove/lock/host transfer; it does not include automated abuse classification.
