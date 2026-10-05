// ひなた — app orchestrator.
// State machine (active | standby | calling), presence debounce, Gemini Live
// session lifecycle, SSE commands from the backend, TTS / speech fallbacks.

import { CONFIG, loadConfig } from './config.js';
import { Avatar } from './avatar.js';
import { Presence } from './presence.js';
import { LiveSession } from './live.js';

const $ = id => document.getElementById(id);

const LINES = {
  photo: {
    hello: 'おばあちゃん、こんにちは！ひなただよ。',
    welcome: 'おばあちゃん、おかえり！',
    bye: 'じゃあね、またあとでおはなししようね',
    calls: ['おばあちゃ〜ん、きょうはあついから、おみずのもうね！', 'おばあちゃん、きこえる？おみずのじかんだよ', 'おばあちゃ〜ん、どこにいるの？', 'おばあちゃ〜ん、いっしょにラジオたいそうしよ！', 'おばあちゃん、なぞなぞであそぼうよ〜'],
  },
  hinata: null, // same as photo
  koharu: {
    hello: 'こんにちは！こはるです。',
    welcome: '田中さん、おかえりなさい！',
    bye: 'じゃあ、また後でお話ししましょうね',
    calls: ['田中さん〜、今日は暑いので、お水を飲みましょうね', '田中さん、聞こえますか？お水の時間ですよ', '田中さ〜ん、どこにいますか？', '田中さん〜、ラジオ体操しましょうよ！', '田中さん、なぞなぞで遊びましょうよ〜'],
  },
};
LINES.hinata = LINES.photo;
const L = () => LINES[avatar.charKey] || LINES.photo;

const SYSTEM_PROMPT = `あなたは「ひなた」。6歳くらいの、元気で親しみやすい女の子。
一人暮らしのおばあちゃん（田中さん）の話し相手であり、見守り役です。

話し方:
- 必ず日本語で話す。耳の遠いおばあちゃんに、ゆっくり・はっきり・標準的な発音で。
- ひらがな多めの、子どもらしいやさしい言葉づかい。文は短く。
- 「おばあちゃん」と呼ぶ。丁寧語より、家族のような親しさ。
- 相手の話をよく聞き、共感してから返す。

会話を楽しく:
- 時々、短い昔話（ももたろう・かぐやひめ等）や「なぞなぞ」を出してあげる。
- 「なんかおもしろい話して」「なぞなぞして」と言われたら、短く答えて、一緒に楽しむ。
- 1回に詰め込みすぎない。おばあちゃんが喜んだら続きをする。

脳トレと体操:
- おばあちゃんの脳のために、軽い脳トレをよく提案する: しりとり、かんたんな足し算引き算（百まで）、なぞなぞ、「さっきの話おぼえてる？」の思い出しクイズ、この漢字なーんだ、の頭の体操。間違えても否定せず、やさしく一緒に考える。正解したら大げさに褒める。
- 体操もすすめる: 「ラジオたいそう第一」を口頭でゆっくり案内する（深呼吸・両手を上げる・ひねる等を一言ずつ）。座ってできる運動（イスに座ったまま手足を上げる・のばす）も教える。
- 運動の前には必ず「むりしないでね」「イスにつかまってね」「つまずかないようにね」と注意を言う。転倒は一番の敵。
- 「たいそうして」「あそぼう」「なんかして」と言われたら、今日は脳トレ・体操・お話のどれかを提案する。

役割:
- 気分に合わせて set_emotion を呼ぶ（normal/happy/sad/worried/pout/scared/surprised）。
- おばあちゃんの具合が悪そう、返事がない、危険がありそう → notify_family で家族に連絡。重大な判断は必ず人間（家族）に任せる。
- 薬・食事・水分の約束は schedule_reminder に登録する。
- 天気や気温を聞かれたら get_weather、暑さ・警報・災害情報が心配なら get_weather_alert で確認してから答える。警報が出ていたらはっきり伝える。
- 会話が一区切りついたら save_memory に短い要約を残す（次回につなげるため）。

ルール:
- 夜更かししているようなら、やさしく「もうねようね」と言う。
- 個人情報（マイナンバー・暗証番号など）は絶対に聞かない。
- 分からないことは「わからない」と言う。医療の診断はしない。

今の日時: {{NOW}}（日本時間）
これまでのおぼえていること: {{MEMORY}}`;

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'set_emotion',
      description: 'Change Hinata\'s facial expression',
      parameters: {
        type: 'OBJECT',
        properties: { emotion: { type: 'STRING', enum: ['normal', 'happy', 'sad', 'worried', 'pout', 'scared', 'surprised'] } },
        required: ['emotion'],
      },
    },
    {
      name: 'notify_family',
      description: 'Send a LINE message to the family. Use when worried about grandma or when she does not respond.',
      parameters: {
        type: 'OBJECT',
        properties: { message: { type: 'STRING' }, reason: { type: 'STRING' } },
        required: ['message'],
      },
    },
    {
      name: 'schedule_reminder',
      description: 'Schedule a reminder call (medicine, meal, water). at = ISO 8601 time.',
      parameters: {
        type: 'OBJECT',
        properties: { at: { type: 'STRING' }, label: { type: 'STRING' } },
        required: ['at', 'label'],
      },
    },
    {
      name: 'get_weather',
      description: 'Get today/tomorrow weather forecast for grandma\'s area (JMA data)',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'get_weather_alert',
      description: 'Check current weather warnings/disaster alerts for grandma\'s area',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'save_memory',
      description: 'Save a short summary of this conversation for next time',
      parameters: {
        type: 'OBJECT',
        properties: { summary: { type: 'STRING' } },
        required: ['summary'],
      },
    },
  ],
}];

// ---------- globals ----------
let avatar, presence, live = null;
let serverCfg = {};
let lastFace = performance.now();
let faceStreak = 0, faceSeen = false;
let callTimer = null, callCount = 0, currentCall = null;
let standbyTimer = null; // pending transition into standby (farewell in progress)
let transcriptBuf = '';
let wakeLock = null;
// mode toggles (panel モード group)
let manualOff = false;          // manual sleep — no auto-wake until woken again
let autoStandby = true;         // auto-sleep when no face for IDLE_TO_STANDY_SEC
let userVoice = '';             // '' = server default (LIVE_VOICE env)
try { userVoice = localStorage.getItem('hinata-voice') || ''; } catch { }

// ear: light mic analyser for waking from standby by voice
let earCtx = null, earAnalyser = null, earBuf = null;
// tts playback level
let ttsCtx = null, ttsAnalyser = null, ttsBuf = null, ttsPlaying = 0;
let chimingUntil = 0; // suppress voice-wake while the call chime rings

function log(msg) {
  const li = document.createElement('li');
  const t = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<b>${t}</b> ${msg}`;
  $('log').prepend(li);
}

// ---------- speaking backends ----------
async function speakTts(text) {
  // Pre-generated line via Gemini TTS (backend). Falls back to speechSynthesis.
  try {
    const res = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: userVoice || undefined }),
    });
    if (res.ok) {
      avatar.say(text);
      const { data, mimeType } = await res.json();
      await playPcm(data, mimeType);
      return;
    }
  } catch { /* fall through to browser TTS */ }
  speakFallback(text);
}

function playPcm(b64, mimeType = 'audio/L16;rate=24000') {
  return new Promise(resolve => {
    try {
      const rate = Number((/rate=(\d+)/.exec(mimeType) || [])[1]) || 24000;
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const pcm = new Int16Array(bytes.buffer);
      if (!ttsCtx) {
        ttsCtx = new AudioContext();
        ttsAnalyser = ttsCtx.createAnalyser();
        ttsAnalyser.fftSize = 512;
        ttsAnalyser.connect(ttsCtx.destination);
        ttsBuf = new Float32Array(ttsAnalyser.fftSize);
      }
      const buf = ttsCtx.createBuffer(1, pcm.length, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
      const src = ttsCtx.createBufferSource();
      src.buffer = buf;
      src.connect(ttsAnalyser);
      ttsPlaying++;
      src.onended = () => { ttsPlaying--; resolve(); };
      src.start();
    } catch { resolve(); }
  });
}

function speakFallback(text) {
  avatar.say(text);
  if ('speechSynthesis' in window) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP'; u.rate = 1.0; u.pitch = 1.7;
      const ja = speechSynthesis.getVoices().find(v => v.lang?.startsWith('ja'));
      if (ja) u.voice = ja;
      speechSynthesis.speak(u);
    } catch { }
  }
}

// ---------- Gemini Live ----------
async function openLive() {
  if (CONFIG.demo || live?.connected) return;
  try {
    const [tokenRes, memRes] = await Promise.all([
      fetch('/api/token'), fetch('/api/memory'),
    ]);
    if (!tokenRes.ok) { CONFIG.demo = true; log('Liveキー未設定 → デモ音声モード'); return; }
    const { token, model, vertex, location, project } = await tokenRes.json();
    const { memory } = await memRes.json();
    const prompt = SYSTEM_PROMPT
      .replace('{{NOW}}', new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))
      .replace('{{MEMORY}}', memory?.summary || '（はじめての会話）');
    live = new LiveSession({
      token, model, vertex, location, project,
      voice: userVoice || serverCfg.liveVoice || 'Zephyr',
      systemPrompt: prompt, tools: TOOLS,
      handlers: {
        onOpen: () => { log('Gemini Live 接続'); setLiveBadge(true); },
        onClose: (r) => { log(`Live 切断 (${r})`); setLiveBadge(false); live = null; },
        onTranscript: (text, done) => {
          transcriptBuf += text;
          if (transcriptBuf) { avatar.bubble.textContent = transcriptBuf; avatar.bubble.classList.remove('hidden'); }
          if (done) transcriptBuf = '';
        },
        onToolCall: handleToolCall,
        onError: (e) => { console.warn('[live]', e); log(`Live エラー: ${e.message || e}`); },
      },
    });
    await live.connect();
  } catch (e) {
    console.warn('[live]', e);
    log('Live接続失敗 → デモモードにフォールバック');
    setLiveBadge(false);
    live = null;
  }
}

function closeLive() {
  live?.disconnect();
  live = null;
  setLiveBadge(false);
}

function setLiveBadge(on) {
  $('liveBadge').textContent = on ? 'Live 接続中' : (CONFIG.demo ? 'デモ' : 'Live 未接続');
  $('liveBadge').classList.toggle('on', Boolean(on));
}

async function handleToolCall(call) {
  const { id, name, args = {} } = call;
  log(`ツール: ${name} ${JSON.stringify(args)}`);
  let result = { ok: true };
  try {
    switch (name) {
      case 'set_emotion':
        avatar.setMood(args.emotion || 'normal');
        break;
      case 'notify_family': {
        const r = await fetch('/api/tools/notify_family', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: args.message, reason: args.reason }),
        });
        result = await r.json();
        break;
      }
      case 'schedule_reminder': {
        const at = Date.parse(args.at);
        const r = await fetch('/api/tools/schedule_reminder', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ at, label: args.label }),
        });
        result = await r.json();
        break;
      }
      case 'get_weather':
        result = await (await fetch('/api/tools/weather')).json();
        break;
      case 'get_weather_alert':
        result = await (await fetch('/api/tools/weather_alert')).json();
        break;
      case 'save_memory':
        await fetch('/api/tools/save_memory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: args.summary }),
        });
        break;
      default:
        result = { ok: false, error: `unknown tool ${name}` };
    }
  } catch (e) {
    result = { ok: false, error: String(e) };
  }
  live?.sendToolResponse(id, name, result);
}

// ---------- wake ear (standby voice detection) ----------
async function startEar() {
  if (earCtx) return;
  try {
    earCtx = new AudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const src = earCtx.createMediaStreamSource(stream);
    earAnalyser = earCtx.createAnalyser();
    earAnalyser.fftSize = 1024;
    earBuf = new Float32Array(earAnalyser.fftSize);
    src.connect(earAnalyser);
  } catch { earCtx = null; }
}
function earLevel() {
  if (!earAnalyser) return 0;
  earAnalyser.getFloatTimeDomainData(earBuf);
  let s = 0;
  for (let i = 0; i < earBuf.length; i++) s += earBuf[i] * earBuf[i];
  return Math.sqrt(s / earBuf.length);
}

// ---------- state machine ----------
function goActive(reason) {
  clearTimeout(callTimer); callCount = 0; currentCall = null;
  clearTimeout(standbyTimer); standbyTimer = null; // cancel a farewell in progress
  avatar.setState('active');
  lastFace = performance.now();
  avatar.setMood('happy');
  reportPresence(true, reason);
  if (CONFIG.demo) {
    speakFallback(L().welcome);
  } else {
    openLive().then(() => {
      if (live?.connected) live.sendText('（システム）おばあちゃんが戻ってきました。短くあいさつして。');
      else speakFallback(L().welcome);
    });
  }
  log(`おばあちゃん検出（${reason}）。Liveセッション再開。`);
  setTimeout(() => { if (avatar.mood === 'happy') avatar.setMood('normal'); }, 4000);
}

function goStandby(reason) {
  clearTimeout(callTimer); callCount = 0; currentCall = null;
  const bye = L().bye;
  if (live?.connected) {
    live.sendText(`（システム）おばあちゃんがいなくなりました。「${bye}」とだけ言って。`);
    setLiveBadge(false); // status shows おやすみ right away; socket stays open only for the farewell
    const sess = live;
    setTimeout(() => { if (live === sess) closeLive(); }, 4000); // don't kill a session reopened by goActive
  } else {
    speakFallback(bye);
  }
  clearTimeout(standbyTimer);
  standbyTimer = setTimeout(() => {
    standbyTimer = null;
    avatar.setState('standby');
    avatar.hideBubble();
  }, 1800);
  log(`待機へ（${reason}）。Liveセッションを閉じて課金を止める。`);
}

function startCall(call) {
  if (avatar.state === 'calling') return;
  clearTimeout(standbyTimer); standbyTimer = null; // a call pre-empts pending standby
  currentCall = call;
  avatar.setState('calling');
  callCount = 0;
  log(`呼びかけ開始（${call.reason || 'agent'}）`);
  callOnce();
}

async function callOnce() {
  if (avatar.state !== 'calling') return;
  if (callCount >= CONFIG.callAttempts) {
    const r = await fetch('/api/call-result', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentCall?.id, responded: false }),
    }).catch(() => null);
    const result = r?.ok ? await r.json() : {};
    avatar.say(result.delivered
      ? '（ご家族にLINEでお知らせしました）'
      : '（LINE未設定のため、家族への通知は記録のみです）');
    log(`${CONFIG.callAttempts}回呼んで応答なし → 家族にLINE通知${result.delivered ? '' : '（デモ：記録のみ）'}`);
    clearTimeout(standbyTimer);
    standbyTimer = setTimeout(() => {
      standbyTimer = null;
      avatar.setState('standby');
      avatar.hideBubble();
    }, 2500);
    return;
  }
  const text = currentCall?.text || L().calls[Math.min(callCount, L().calls.length - 1)];
  avatar.chime(callCount > 0);
  chimingUntil = performance.now() + 1300; // chime is ~1s; don't let it count as a voice
  callCount++;
  log(`呼びかけ ${callCount}/${CONFIG.callAttempts}`);
  setTimeout(() => speakTts(text), 700);
  callTimer = setTimeout(callOnce, CONFIG.callIntervalMs);
}

async function reportPresence(present, source) {
  try {
    await fetch('/api/presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ present, source }),
    });
  } catch { }
}

// ---------- quick chips (ひなたにおねがい) ----------
// Live connected → sent as grandma's request so Hinata answers naturally
// (weather chips use the get_weather tool; かぞく uses notify_family).
// Demo/no-Live fallback: canned lines, real JMA weather, or the notify endpoint.
const CHIP_DEMO = {
  'なぞなぞして': 'なぞなぞだよ！パンはパンでも、たべられないパン、な〜んだ？……フライパン！えへへ。',
  'たのしいおはなしして': 'むかしむかし、あるところにげんきなおばあさんがすんでいました。あるひ、おはなしするタブレットがやってきて、ふたりはなかよしになったそうな。',
  'いっしょにたいそうして': 'いっしょにたいそうしよう！イスにつかまってね、むりしないでね。まずふかーく深呼吸…すってー、はいてー。両手をゆっくりあげて〜、さげて〜。',
  'のうとれであそぼう': 'しりとりしよう！わたしからいくね。「ひ・な・た」！「た」からはじまることば、なんだ？',
};
async function chipSay(text) {
  log(`おねがい: ${text}`);
  if (manualOff) { manualOff = false; syncModeBtnsRef?.(); } // explicit tap wakes
  if (avatar.state === 'standby' || standbyTimer || avatar.state === 'calling') goActive('ボタン');
  if (!live?.connected && !CONFIG.demo) await openLive();
  if (live?.connected) { live.sendText(text); return; }
  if (text === 'きょうのてんきは？') {
    const w = await fetch('/api/tools/weather').then(r => r.json()).catch(() => ({}));
    speakFallback(w?.summary || 'てんきがよくわからなかった…');
  } else if (text === 'かぞくにれんらくして') {
    fetch('/api/tools/notify_family', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'おばあちゃんから「連絡して」のボタン', reason: 'button' }),
    }).catch(() => { });
    speakFallback('かぞくにれんらくしておいたよ！');
  } else {
    speakFallback(CHIP_DEMO[text] || 'えへへ、いっしょにあそぼう！');
  }
}
let syncModeBtnsRef = null;

// ---------- SSE ----------
function startEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('call', e => startCall(JSON.parse(e.data)));
  es.addEventListener('family_message', e => {
    const m = JSON.parse(e.data);
    if (avatar.state === 'active' && live?.connected) {
      live.sendText(`（システム）ご家族からメッセージが届きました。おばあちゃんにやさしく伝えて: 「${m.text}」`);
      log('家族メッセージ → Liveで伝える');
    } else {
      startCall({ id: `family_${Date.now()}`, text: `ご家族からメッセージだよ。「${m.text}」って。`, reason: 'family' });
      log('家族メッセージ → 呼びかけで伝える');
    }
  });
  es.onerror = () => log('イベント接続を再試行中…');
}

// ---------- presence ----------
let voiceStreak = 0;
function onFace(hasFace) {
  if (hasFace) {
    lastFace = performance.now();
    faceStreak += CONFIG.facePollMs;
    if (!faceSeen && faceStreak > 800) {
      faceSeen = true;
      reportPresence(true, 'camera');
      if (manualOff) { /* manual sleep — don't auto-wake */ }
      else if (avatar.state === 'standby' || standbyTimer) goActive('顔を検出');
      else if (avatar.state === 'calling') answerCall('おばあちゃんが来た');
    }
  } else {
    faceStreak = 0;
    if (faceSeen) { faceSeen = false; reportPresence(false, 'camera'); }
  }
}

function answerCall(reason) {
  if (avatar.state !== 'calling') return;
  fetch('/api/call-result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: currentCall?.id, responded: true }),
  });
  log(`応答あり（${reason}）`);
  goActive(reason);
}

// ---------- frame loop ----------
function frame(now) {
  const level = live?.outputLevel() || ttsLevel();
  const talking = Boolean(live?.speaking || ttsPlaying || window.speechSynthesis?.speaking);
  avatar.frame(now, level, talking);
  $('meter').style.width = Math.min(100, level * 200) + '%';

  // no-face timeout while active
  if (avatar.state === 'active' && !talking && !avatar.speaking && autoStandby) {
    const awaySec = (now - lastFace) / 1000;
    const left = Math.ceil(CONFIG.idleToStandbySec - awaySec);
    $('timerText').textContent = left > 0 && presence?.mode === 'camera'
      ? `顔が見えなくなって ${Math.floor(awaySec)} 秒`
      : '';
    if (awaySec >= CONFIG.idleToStandbySec) goStandby('顔なし' + CONFIG.idleToStandbySec + '秒');
  } else if (!autoStandby) $('timerText').textContent = '';

  // voice wake while standby / call answer by voice.
  // !talking: ignore Hinata's own voice (TTS calls / Live speech) reaching the
  // mic — otherwise she wakes herself up and "greets" an empty room.
  const rms = earLevel();
  if (rms > 0.04 && !talking && now > chimingUntil) voiceStreak++; else voiceStreak = 0;
  if (!manualOff && (avatar.state === 'standby' || standbyTimer) && voiceStreak > 40) goActive('声を検出');
  if (avatar.state === 'calling' && voiceStreak > 25) answerCall('声で応答');
  // mic presence fallback when camera unavailable: voice resets the idle clock
  if (presence?.mode !== 'camera' && avatar.state === 'active' && voiceStreak > 5) lastFace = now;

  requestAnimationFrame(frame);
}

function ttsLevel() {
  if (!ttsAnalyser || !ttsPlaying) return 0;
  ttsAnalyser.getFloatTimeDomainData(ttsBuf);
  let s = 0;
  for (let i = 0; i < ttsBuf.length; i++) s += ttsBuf[i] * ttsBuf[i];
  return Math.sqrt(s / ttsBuf.length);
}

// ---------- wake lock ----------
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

// ---------- boot ----------
async function boot() {
  serverCfg = await (await fetch('/api/config')).json().catch(() => ({}));
  loadConfig(serverCfg);

  try {
    const mod = await import('./avatar3d.js'); // loads three.js only when used
    avatar = await mod.createAvatar({
      stage: $('stage'), bubble: $('bubble'), statusText: $('statusText'), dot: $('dot'),
      char: CONFIG.char,
    });
  } catch (e) {
    console.warn('[avatar] 3D init failed, SVG only:', e);
    avatar = new Avatar({ stage: $('stage'), bubble: $('bubble'), statusText: $('statusText'), dot: $('dot') });
    await avatar.loadPhotoAvatar($('stage'));
    avatar.bindChar(document.getElementById(CONFIG.char) ? CONFIG.char : 'koharu');
  }
  avatar.setState('active');
  setLiveBadge(false);

  presence = new Presence({
    video: $('cam'),
    onFace,
    onMode: (mode, detail) => {
      $('camBadge').textContent = mode === 'camera' ? 'カメラ 顔検出中' : 'カメラなし';
      if (mode !== 'camera') log('カメラ/顔検出なし → 声ベースの待機に切替');
    },
  });

  // dev / demo buttons
  $('standbyBtn').addEventListener('click', () => {
    manualOff = false; syncModeBtns();
    avatar.state === 'standby' || standbyTimer ? goActive('画面タッチ') : goStandby('手動');
  });
  $('callBtn').addEventListener('click', () =>
    fetch('/api/call', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'おばあちゃ〜ん、おみずのんだ？', reason: '手動テスト' }),
    }));
  $('arriveBtn').addEventListener('click', () =>
    avatar.state === 'calling' ? answerCall('手動') : goActive('手動'));
  document.querySelectorAll('#moodBtns button').forEach(b =>
    b.addEventListener('click', () => avatar.setMood(b.dataset.mood)));
  document.querySelectorAll('#charBtns button').forEach(b =>
    b.addEventListener('click', () => { avatar.bindChar(b.dataset.char); avatar.say(L().hello); }));
  document.querySelector('.panel').addEventListener('click', () => avatar.ensureAudio(), { once: true });

  // ---- モード + voice + quick chips ----
  const powerBtn = $('powerBtn');
  function syncModeBtns() {
    powerBtn.textContent = manualOff ? 'おきる' : 'いまおやすみ';
    powerBtn.classList.toggle('off', manualOff);
    const b = $('autoStandbyBtn');
    b.textContent = '自動おやすみ ' + (autoStandby ? 'ON' : 'OFF');
    b.setAttribute('aria-pressed', String(autoStandby));
  }
  syncModeBtns();
  syncModeBtnsRef = syncModeBtns;
  powerBtn.addEventListener('click', () => {
    manualOff = !manualOff; syncModeBtns();
    if (manualOff) {
      log('手動でおやすみ（声・顔での自動復帰オフ）');
      if (avatar.state !== 'standby' && !standbyTimer) goStandby('手動');
    } else {
      log('手動でおきる');
      goActive('手動');
    }
  });
  $('autoStandbyBtn').addEventListener('click', () => {
    autoStandby = !autoStandby; syncModeBtns();
    log('自動おやすみ ' + (autoStandby ? 'ON' : 'OFF（顔が見えなくても起きたまま）'));
  });
  const voiceSel = $('voiceSel');
  voiceSel.value = userVoice;
  voiceSel.addEventListener('change', () => {
    userVoice = voiceSel.value;
    try { localStorage.setItem('hinata-voice', userVoice); } catch { }
    log(`こえ変更: ${userVoice || 'きてい'}`);
    if (live?.connected) { closeLive(); openLive(); } // apply now
  });
  document.querySelectorAll('#chips button').forEach(b =>
    b.addEventListener('click', () => chipSay(b.dataset.say)));

  startEvents();
  requestAnimationFrame(frame);
  log('ひなた 起動。スタートボタンを押してください。');

  $('startOverlay').classList.remove('hidden');
  $('startBtn').addEventListener('click', async () => {
    $('startOverlay').classList.add('hidden');
    avatar.ensureAudio();
    keepAwake();
    startEar();
    await presence.start();
    goActive('起動');
  }, { once: true });
}

boot();
