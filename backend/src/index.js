import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import * as events from './events.js';
import * as line from './line.js';
import * as email from './email.js';
import * as gemini from './gemini.js';
import * as jma from './jma.js';
import * as news from './news.js';

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
email.initEmail();

// Family alerts: email first (simpler setup), LINE when configured.
async function notifyFamily(text) {
  if (email.emailEnabled()) return email.pushFamilyEmail('【ひなた】見守りアラート', text);
  return line.pushFamily(text);
}

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

app.get('/healthz', (_req, res) => res.json({ ok: true, demo: DEMO, store: store.mode, line: line.lineEnabled(), email: email.emailEnabled() }));

app.get('/api/config', (_req, res) => {
  res.json({
    demo: DEMO,
    line: line.lineEnabled(),
    email: email.emailEnabled(),
    vertex: gemini.isVertex(),
    idleToStandbySec: IDLE_TO_STANDBY_SEC,
    callAttempts: CALL_ATTEMPTS,
    liveModel: liveModel(),
    liveVoice: process.env.LIVE_VOICE || 'Zephyr',
  });
});

// Short-lived token the tablet trades for a direct Gemini Live session.
function liveModel() {
  return process.env.LIVE_MODEL || (gemini.isVertex()
    ? 'gemini-live-2.5-flash'   // verified on the global Vertex endpoint
    : 'gemini-2.5-flash-preview-native-audio-dialog');
}

app.get('/api/token', async (_req, res) => {
  try {
    const tok = await gemini.createLiveToken();
    if (!tok) return res.status(503).json({ error: 'demo', message: 'no GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT configured' });
    res.json({ ...tok, model: liveModel() });
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
    const audio = await gemini.synthesizeSpeech(text, req.body?.voice);
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
let lastPresence = null;
app.post('/api/presence', async (req, res) => {
  const present = Boolean(req.body?.present);
  lastPresence = { present, at: Date.now(), source: req.body?.source || 'camera' };
  await store.log({ type: 'presence', present, source: lastPresence.source });
  res.json({ ok: true });
});

// ---- Agent tool endpoints (called by the tablet on behalf of Gemini Live) ----

app.post('/api/tools/notify_family', async (req, res) => {
  const message = String(req.body?.message || 'おばあちゃんの様子がいつもと違います。確認をお願いします。').slice(0, 500);
  await store.log({ type: 'notify_family', message, reason: req.body?.reason });
  const result = await notifyFamily(`【ひなた】${message}`);
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

// ---- Health log (meal + medicine check-ins, one record per date+period) ----

function jstPeriod() { // meal period from the JST clock
  const h = jstHour();
  if (h >= 5 && h < 11) return { period: 'asa', label: 'あさ' };
  if (h >= 11 && h < 16) return { period: 'hiru', label: 'ひる' };
  if (h >= 16 && h < 22) return { period: 'yoru', label: 'ゆうがた' };
  return { period: 'other', label: 'よる' };
}
function jstDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date()); // YYYY-MM-DD
}

app.post('/api/tools/record_health', async (req, res) => {
  const b = req.body || {};
  const valid = v => ['yes', 'no', 'little', 'unknown'].includes(v) ? v : 'unknown';
  const entry = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : jstDate(),
    period: ['asa', 'hiru', 'yoru', 'other'].includes(b.period) ? b.period : jstPeriod().period,
    ate: valid(b.ate),
    medicine: valid(b.medicine),
    condition: ['genki', 'tired', 'bad', 'unknown'].includes(b.condition) ? b.condition : 'unknown',
    mood: ['happy', 'calm', 'lonely', 'sad', 'worried', 'unknown'].includes(b.mood) ? b.mood : 'unknown',
    note: String(b.note || '').slice(0, 300),
  };
  const id = await store.saveHealthLog(entry);
  await store.log({ type: 'health_log', ...entry });
  res.json({ ok: true, id, ...entry });
});

// Family view of the daily meal/medicine log.
app.get('/api/health-log', async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  res.json({ days, entries: await store.listHealthLog(days) });
});

// ---- Family dashboard (/family) ----
// Optional shared secret: set FAMILY_TOKEN and the page needs ?key=<token>.
const FAMILY_TOKEN = process.env.FAMILY_TOKEN || '';

app.get('/api/family', async (req, res) => {
  if (FAMILY_TOKEN && req.query.key !== FAMILY_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({
    at: Date.now(),
    dateJst: jstDate(),
    presence: lastPresence,                    // {present, at, source} or null
    health: await store.listHealthLog(7),      // last 7 days of meal/medicine records
    memory: await store.latestMemory(),        // Hinata's latest conversation summary
    reminders: await store.listReminders(),    // still pending
    events: await store.listLog(40),           // newest first
  });
});

// Cloud Scheduler entrypoint: at meal times, call the tablet and have
// Hinata ask grandma whether she ate and took her medicine.
app.post('/jobs/health-check', async (req, res) => {
  if (JOB_SECRET && req.get('x-job-secret') !== JOB_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (isQuietHours()) return res.json({ ok: true, skipped: 'quiet_hours' });
  const { period, label } = jstPeriod();
  if (period === 'other') return res.json({ ok: true, skipped: 'not_a_meal_time' });
  const call = {
    id: `health_${Date.now()}`,
    text: `おばあちゃ〜ん、${label}のごはんたべた？おくすりものんだ？きょうはげんき？ひなたにおしえて〜`,
    reason: `health_check:${period}`,
  };
  await store.log({ type: 'health_check_call', ...call });
  events.publish('call', call);
  res.json({ ok: true, delivered: events.clientCount() > 0, ...call });
});

app.get('/api/tools/weather', async (_req, res) => {
  const w = jma.getWeather();
  if (Date.now() - (w.updatedAt || 0) > 15 * 60_000) await jma.refreshWeather();
  res.json(jma.getWeather());
});

app.get('/api/tools/news', async (_req, res) => {
  res.json(await news.getNews());
});

app.get('/api/tools/weather_alert', async (_req, res) => {
  const jmaAlert = jma.getAlerts();
  if (jmaAlert.hasAlert) return res.json(jmaAlert);
  const alert = await store.latestAlert(); // manual/demo alerts still work
  res.json(alert || jmaAlert);
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
  let result = {};
  if (!responded) {
    result = await notifyFamily('【ひなた】おばあちゃんに3回声をかけましたが応答がありません。様子を確認してください。');
  }
  res.json({ ok: true, ...result });
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

// JMA weather loop: refresh forecast/warnings; proactively call the tablet
// (and LINE the family on severe alerts) when a new warning appears.
jma.startWeatherLoop(async fresh => {
  const names = [...new Set(fresh.map(a => a.name))].join('・');
  const severe = fresh.some(a => a.level === 'severe');
  await store.log({ type: 'jma_warning', warnings: fresh.map(a => `${a.name}(${a.area})`), severe });
  events.publish('call', {
    id: `jma_${Date.now()}`,
    text: `おばあちゃ〜ん、きしょうちょうから「${names}」が出たよ！気をつけてね！`,
    reason: `weather:${names}`,
  });
  if (severe) {
    await notifyFamily(`【ひなた】気象庁から「${names}」が発表されました。おばあちゃんの様子を確認してください。`);
  }
});

// Serve the tablet app last so /api and /webhook always win.
// No persistent cache for app files — every reload revalidates via ETag so
// a normal refresh always picks up a new deploy (the 1h cache kept serving
// stale JS on the tablet). The VRM model keeps a long cache.
app.use('/models', express.static(path.join(WEB_DIR, 'models'), { maxAge: '7d' }));
app.use(express.static(WEB_DIR, { maxAge: 0 }));
app.get('/family', (_req, res) => res.sendFile(path.join(WEB_DIR, 'family.html')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`[obasan] listening on :${PORT} (demo=${DEMO}, store=${store.mode}, line=${line.lineEnabled()})`);
});
