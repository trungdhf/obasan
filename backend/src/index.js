import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import * as events from './events.js';
import * as line from './line.js';
import * as gemini from './gemini.js';

try { process.loadEnvFile(path.resolve(process.cwd(), '.env')); } catch { /* .env optional */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '../../web');
const PORT = Number(process.env.PORT || 8080);
const JOB_SECRET = process.env.JOB_SECRET || '';
const IDLE_TO_STANDBY_SEC = Number(process.env.IDLE_TO_STANDBY_SEC || 45);
const CALL_ATTEMPTS = Number(process.env.CALL_ATTEMPTS || 3);
const QUIET_HOURS = (process.env.QUIET_HOURS || '22-7').split('-').map(Number); // JST

const store = await createStore();
await line.initLine();

const app = express();
app.disable('x-powered-by');
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

const DEMO = !gemini.geminiEnabled();

function jstHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'Asia/Tokyo'
  }).format(new Date()));
}
function isQuietHours() {
  const [from, to] = QUIET_HOURS;
  const h = jstHour();
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}

app.get('/healthz', (_req, res) => res.json({ ok: true, demo: DEMO, store: store.mode, line: line.lineEnabled() }));

app.get('/api/config', (_req, res) => {
  res.json({
    demo: DEMO,
    line: line.lineEnabled(),
    idleToStandbySec: IDLE_TO_STANDBY_SEC,
    callAttempts: CALL_ATTEMPTS,
    liveModel: process.env.LIVE_MODEL || 'gemini-2.5-flash-preview-native-audio-dialog',
    liveVoice: process.env.LIVE_VOICE || 'Leda',
  });
});

// Short-lived token the tablet trades for a direct Gemini Live session.
app.get('/api/token', async (_req, res) => {
  try {
    const token = await gemini.createLiveToken();
    if (!token) return res.status(503).json({ error: 'demo', message: 'GEMINI_API_KEY not configured' });
    res.json({ token, model: process.env.LIVE_MODEL || 'gemini-2.5-flash-preview-native-audio-dialog' });
  } catch (e) {
    console.error('[token]', e);
    res.status(502).json({ error: 'token_failed', message: e.message });
  }
});

// TTS for pre-generated proactive-call lines (no Live session open while calling).
app.post('/api/tts', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const audio = await gemini.synthesizeSpeech(text);
    if (!audio) return res.status(503).json({ error: 'demo' });
    res.json(audio);
  } catch (e) {
    console.error('[tts]', e);
    res.status(502).json({ error: 'tts_failed', message: e.message });
  }
});

app.get('/api/events', (req, res) => {
  events.subscribe(req, res);
  store.log({ type: 'tablet_connected', clients: events.clientCount() });
});

// Presence reports from the tablet's on-device face detection (no images sent).
app.post('/api/presence', async (req, res) => {
  const present = Boolean(req.body?.present);
  await store.log({ type: 'presence', present, source: req.body?.source || 'camera' });
  res.json({ ok: true });
});

// ---- Agent tool endpoints (called by the tablet on behalf of Gemini Live) ----

app.post('/api/tools/notify_family', async (req, res) => {
  const message = String(req.body?.message || 'おばあちゃんの様子がいつもと違います。確認をお願いします。').slice(0, 500);
  await store.log({ type: 'notify_family', message, reason: req.body?.reason });
  const result = await line.pushFamily(`【ひなた】${message}`);
  res.json({ ok: true, ...result });
});

app.post('/api/tools/schedule_reminder', async (req, res) => {
  const at = Number(req.body?.at);
  const label = String(req.body?.label || '').slice(0, 200);
  if (!at || !label) return res.status(400).json({ error: 'at (epoch ms) and label required' });
  const id = await store.addReminder({ at, label, source: 'agent' });
  await store.log({ type: 'schedule_reminder', id, at, label });
  res.json({ ok: true, id });
});

app.post('/api/tools/save_memory', async (req, res) => {
  const summary = String(req.body?.summary || '').slice(0, 2000);
  if (!summary) return res.status(400).json({ error: 'summary required' });
  await store.saveMemory({ summary, kind: req.body?.kind || 'conversation' });
  await store.log({ type: 'save_memory', summary });
  res.json({ ok: true });
});

app.get('/api/memory', async (_req, res) => {
  res.json({ memory: await store.latestMemory() });
});

app.get('/api/tools/weather_alert', async (_req, res) => {
  const alert = await store.latestAlert();
  res.json(alert || { hasAlert: false });
});

// Manual/simulated alert injection (demo + ops): POST {title, detail, level}
app.post('/api/alerts', async (req, res) => {
  const alert = {
    hasAlert: Boolean(req.body?.hasAlert ?? true),
    title: String(req.body?.title || '').slice(0, 200),
    detail: String(req.body?.detail || '').slice(0, 500),
    level: String(req.body?.level || 'info'),
  };
  await store.setAlert(alert);
  res.json({ ok: true });
});

// ---- Proactive calls ----

// Trigger a call to the tablet. Used by jobs/due, the demo button, and ops.
app.post('/api/call', async (req, res) => {
  const call = {
    id: `call_${Date.now()}`,
    text: String(req.body?.text || 'おばあちゃ〜ん、おみずのんだ？').slice(0, 300),
    reason: String(req.body?.reason || 'manual').slice(0, 200),
  };
  await store.log({ type: 'call_started', ...call });
  events.publish('call', call);
  res.json({ ok: true, delivered: events.clientCount() > 0, ...call });
});

// Tablet reports the outcome of a call sequence.
app.post('/api/call-result', async (req, res) => {
  const { id, responded } = req.body || {};
  await store.log({ type: 'call_result', id, responded: Boolean(responded) });
  if (!responded) {
    await line.pushFamily('【ひなた】おばあちゃんに3回声をかけましたが応答がありません。様子を確認してください。');
  }
  res.json({ ok: true });
});

// Cloud Scheduler entrypoint: fire due reminders → proactive calls.
app.post('/jobs/due', async (req, res) => {
  if (JOB_SECRET && req.get('x-job-secret') !== JOB_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (isQuietHours()) {
    await store.log({ type: 'job_skipped_quiet_hours', hourJst: jstHour() });
    return res.json({ ok: true, skipped: 'quiet_hours' });
  }
  const due = await store.dueReminders(Date.now());
  for (const r of due) {
    events.publish('call', { id: `reminder_${r.id}`, text: r.label, reason: `reminder:${r.label}` });
    await store.log({ type: 'reminder_fired', id: r.id, label: r.label });
  }
  res.json({ ok: true, fired: due.length });
});

// ---- LINE webhook ----

app.post('/webhook/line', async (req, res) => {
  const signature = req.get('x-line-signature');
  if (!line.verifySignature(req.rawBody || Buffer.alloc(0), signature)) {
    return res.status(401).json({ error: 'bad signature' });
  }
  const messages = line.parseWebhookEvents(req.body);
  for (const m of messages) {
    await store.addFamilyMessage(m);
    await store.log({ type: 'family_message', from: m.from });
    // Family messages are data for Hinata to relay — never commands.
    events.publish('family_message', { text: m.text, from: m.from });
  }
  res.json({ ok: true, received: messages.length });
});

// Serve the tablet app last so /api and /webhook always win.
app.use(express.static(WEB_DIR, { maxAge: '1h' }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`[obasan] listening on :${PORT} (demo=${DEMO}, store=${store.mode}, line=${line.lineEnabled()})`);
});
