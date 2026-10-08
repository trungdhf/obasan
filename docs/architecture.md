# Architecture

## Components

| Component | Role |
| --- | --- |
| Tablet (web app, Android Chrome kiosk) | Avatar, MediaPipe face detection, Gemini Live client, Wake Lock |
| Cloud Run (`backend/`) | Agent backend: ephemeral tokens, call/alert logic, family API (`/family`), serves `web/` |
| Gemini Live (native-audio dialog model) | Realtime voice conversation |
| Gemini Flash TTS | Pre-generated proactive-call lines |
| Firestore | Conversation summaries, reminders, health log, game results, agent log |
| Cloud Scheduler | Fires `/jobs/due` every minute + `/jobs/health-check` 3×/day |
| Gmail SMTP / LINE API | Family alerts out (email default; LINE optional, messages in) |
| Secret Manager / env | SMTP/LINE credentials, API keys, `JOB_SECRET`, `FAMILY_TOKEN` |

## Runtime flows

### Conversation
1. Camera sees a face (MediaPipe, on-device) → tablet goes **active**.
2. Tablet fetches `GET /api/token` (ephemeral, single-use, 30 min) and opens a
   Gemini Live WebSocket (`BidiGenerateContentConstrained`, v1alpha).
3. Mic PCM 16 kHz streams up; model audio 24 kHz streams down → speaker + avatar
   lip-sync (playback RMS → mouth opening). `outputAudioTranscription` feeds the
   speech bubble.
4. The model calls tools; the tablet executes them locally (`set_emotion`) or via
   the backend (`notify_family`, `schedule_reminder`, `get_weather_alert`,
   `save_memory`).
5. No face for `IDLE_TO_STANDBY_SEC` (default 45 s) → say goodbye → **standby**:
   Live session closed (billing stops), avatar sleeps. Face/voice → wake and
   resume with the saved memory summary.

### Proactive call
1. Source: a due reminder (`POST /jobs/due` ← Cloud Scheduler), a weather alert,
   a family message, or the model's own decision.
2. Backend publishes a `call` event over SSE → tablet enters **calling** state.
3. Up to `CALL_ATTEMPTS` (3) attempts, ~9 s apart: chime + call line via
   `POST /api/tts` (Gemini Flash TTS, cached).
4. Face or voice detected → `POST /api/call-result {responded:true}` → active.
   Otherwise after the last attempt → `{responded:false}` → backend pushes a
   email/LINE alert to the family. **A human decides what happens next.**

### Family message
`POST /webhook/line` (signature verified) → stored as data → SSE to the tablet.
If a conversation is live, the text is injected as a system turn so Hinata
relays it naturally; otherwise it triggers a call. Family text is never executed
as a command.

## Data (Firestore)

| Collection | Shape |
| --- | --- |
| `memories` | `{summary, kind, at}` — last one loaded into the system prompt |
| `reminders` | `{at, label, fired, source}` |
| `agent_log` | `{type, ...}` — every decision the agent takes, incl. `game_result` (きおくゲーム scores) |
| `family_messages` | `{text, from, at}` |
| `health_log` | `{date, meal, ate, medicine, condition, mood, note}` |
| `alerts` | `{hasAlert, title, detail, level, at}` — injected weather/heat alerts |

Without `GOOGLE_CLOUD_PROJECT` the same interface is served by an in-memory
store — the whole demo runs on a laptop with zero GCP setup.

## Safety rails

- On-device vision only; no frames leave the tablet.
- Quiet hours 22:00–07:00 JST: `/jobs/due` skips firing.
- `JOB_SECRET` header gates the Scheduler endpoints.
- `/family` read API gated by `FAMILY_TOKEN` when set.
- LINE signature verification on the webhook.
- The 471-story bank (`src/stories.json`) is public-domain 青空文庫 text.
- Ephemeral tokens: single-use, expire in 30 min; no long-lived key on device.
- Escalation is notify-only; humans act.
