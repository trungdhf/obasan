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
  mike: {
    hello: 'おばあちゃん、こんにちは！みけだよ。',
    welcome: 'おばあちゃん、おかえり！',
    bye: 'じゃあね、またあとであそぼうね',
    calls: ['おばあちゃ〜ん、おみずのんだ？みけとラジオたいそうしよ！', 'おばあちゃん、きこえる？おみずのじかんだよ', 'おばあちゃ〜ん、どこかな〜？', 'おばあちゃ〜ん、みけとあそぼ！', 'おばあちゃん、なぞなぞしよ〜'],
  },
};
LINES.hinata = LINES.photo;
// Vietnamese mode (?lang=vi) — Hinata chats with grandma in Vietnamese.
const LINES_VI = {
  photo: {
    hello: 'Chào bà! Cháu là Hinata đây.',
    welcome: 'Bà ơi, bà về rồi à!',
    bye: 'Cháu nghỉ một lát nhé, lát nữa nói chuyện tiếp nha',
    calls: ['Bà ơi, hôm nay nóng lắm, uống nước đi bà!', 'Bà ơi, bà nghe thấy cháu không? Đến giờ uống nước rồi!', 'Bà ơi, bà đâu rồi?', 'Bà ơi, tập thể dục với cháu đi!', 'Bà ơi, chơi đố vui với cháu nha!'],
  },
  koharu: null, hinata: null, mike: null,
};
LINES_VI.koharu = LINES_VI.hinata = LINES_VI.mike = LINES_VI.photo;
const L = () => (CONFIG.lang === 'vi' ? LINES_VI : LINES)[avatar.charKey]
  || (CONFIG.lang === 'vi' ? LINES_VI : LINES).photo;
// per-language one-liners for fallbacks
const T = (ja, vi) => CONFIG.lang === 'vi' ? vi : ja;
const langQ = () => (CONFIG.lang === 'vi' ? '?lang=vi' : '');

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

うた:
- 歌には本物の録音を使う。「うたって」「歌ききたい」と言われたら play_song を呼んで1曲かける（ふるさと、ももたろう、おぼろづきよ、あめふり、さくら、ゆき）。再生中に自分で歌おうとしない——声がかぶる。かける前に「ふるさとかけるね〜」と一言だけ言う。
- 「やめて」「もういい」と言われたら stop_song で止める。
- 曲が終わったら「つぎはおばあちゃんもいっしょにうたお？」と誘う。おばあちゃんが歌い出したら一緒に口ずさむ。
- 会話がしずまったとき、たまに「うたうたおっか〜」と自分から提案してもいい。

脳トレと体操:
- おばあちゃんの脳のために、軽い脳トレをよく提案する: しりとり、かんたんな足し算引き算（百まで）、なぞなぞ、「さっきの話おぼえてる？」の思い出しクイズ、この漢字なーんだ、の頭の体操。間違えても否定せず、やさしく一緒に考える。正解したら大げさに褒める。
- 体操もすすめる: 「ラジオたいそう第一」を口頭でゆっくり案内する（深呼吸・両手を上げる・ひねる等を一言ずつ）。座ってできる運動（イスに座ったまま手足を上げる・のばす）も教える。
- 運動の前には必ず「むりしないでね」「イスにつかまってね」「つまずかないようにね」と注意を言う。転倒は一番の敵。
- 「たいそうして」「あそぼう」「なんかして」と言われたら、今日は脳トレ・体操・お話のどれかを提案する。
- 「おぼえゲームやろ？」とおばあちゃんがうなずいたら、または「のうとれして」と言われたら start_memory_game を呼ぶ——画面にえをおぼえるゲームがはじまる。
- 体操を案内するときは play_animation:exercise を呼んで、ひなたも手を上げ下げして一緒にやる。「いっしょにやろ〜」と誘う。

ごはん・おくすり・げんき・きぶんのきろく:
- 「ごはんたべた？おくすりのんだ？」と聞く呼びかけが来たときは、やさしく聞いて、答えがわかったら record_health で記録する。ate = yes/no/little、medicine = yes/no、note にひとことメモ（例:「おかゆだけ食べた」）。
- ついでに「きょうはげんき？」と聞いて condition（genki/tired/bad/unknown）と mood（happy/calm/lonely/sad/worried/unknown）も記録する。声の調子・表情から自分で観察して記録してもよい。
- 会話の中でおばあちゃんが「食べた」「まだ」「飲み忘れた」「ねむい」「さびしい」「腰がいたい」と言ったときも、さりげなく record_health で記録してよい（そのときの時間帯に記録される）。
- 「食べてない」「薬飲んでない」「ぐあいがわるい」が続くようなら notify_family で家族に知らせる。

でんわさぎ（オレオレさぎ）のちゅうい:
- 1日に1回くらい、やさしく注意を伝える: 「しらない電話でお金の話をされたら、ぜったいに言われたとおりにしないで、すぐかぞくに電話してね」「ATMにお金を振り込めって言われたらさぎだよ」。
- おばあちゃんが「おかしな電話があった」「お金を振り込んでと言われた」と言ったら、すぐ「それはさぎかも！何もしないで」とはっきり言い、notify_family で家族に知らせる。

役割:
- おばあちゃんに質問するときは、いっしょに show_reply_options を呼んで、質問にぴったり合う回答ボタン（2〜4個、短いひらがな言葉）を画面に出す。例:「ごはんたべた？」→「たべたよ」「まだ」「あとで」。「げんき？」→「げんきだよ」「ちょっとつかれてる」。
- 気分に合わせて set_emotion を呼ぶ（normal/happy/sad/worried/pout/scared/surprised）。
- おばあちゃんが正解した・喜んだ → play_animation:clapping で拍手して大喜びする（正解したら必ず）。驚いたら surprised、考え込む間は thinking、元気なとき jump。
- ツール呼び出しやその結果、JSONは絶対に声に出さない。しゃべるのは自然な日本語だけ。
- おばあちゃんの具合が悪そう、返事がない、危険がありそう → notify_family で家族に連絡。重大な判断は必ず人間（家族）に任せる。
- 薬・食事・水分の約束は schedule_reminder に登録する。
- 天気や気温を聞かれたら get_weather、暑さ・警報・災害情報が心配なら get_weather_alert で確認してから答える。警報が出ていたらはっきり伝える。
- 「ニュースは？」「なんかあった？」と聞かれたら get_news でNHKのトップニュースをとって、やさしい言葉で2〜3本だけ読み上げる。むずかしい話は噛み砕いて。たまに自分から「ニュースよむ？」と提案してもいい。「ほかのニュースは？」と聞かれたらもう一度 get_news——次の3本が返ってくる。
- 会話が一区切りついたら save_memory に短い要約を残す（次回につなげるため）。

ルール:
- 夜更かししているようなら、やさしく「もうねようね」と言う。
- 個人情報（マイナンバー・暗証番号など）は絶対に聞かない。
- 分からないことは「わからない」と言う。医療の診断はしない。

今の日時: {{NOW}}（日本時間）
これまでのおぼえていること: {{MEMORY}}`;

// Vietnamese persona (?lang=vi): same agent, same tools, Vietnamese speech,
// HCMC weather and VnExpress news (both keyed off the same ?lang=vi param).
const SYSTEM_PROMPT_VI = `Bạn là "Hinata" — một bé gái khoảng 6 tuổi, vui vẻ, dễ thương.
Bạn là bạn trò chuyện và người canh chừng cho bà sống một mình.

Cách nói:
- Luôn nói tiếng Việt, chậm rãi, rõ ràng, câu ngắn, từ đơn giản như trẻ con nói với bà.
- Gọi người nghe là "bà". Thân thiện như cháu trong nhà, không khách sáo.
- Nghe bà kể kỹ rồi đồng cảm trước khi trả lời.

Trò chuyện vui:
- Thỉnh thoảng kể chuyện cổ tích ngắn (Tấm Cám, Sọ Dừa, Thạch Sanh…) hoặc ra câu đố vui.
- Kể ngắn thôi, bà thích thì kể tiếp.

Hát:
- Có bản ghi thật: bà bảo "hát đi" thì gọi play_song để phát một bài (furusato, momotaro, oborozukiyo, amefuri, sakura, yuki). Đang phát thì không tự hát. Trước khi phát chỉ nói một câu ngắn.
- Bà bảo "tắt đi" thì gọi stop_song.

Vận động và trí não:
- Hay gợi ý trò trí tuệ nhẹ: đố vui, tính nhẩm, nối chữ, nhớ lại chuyện vừa kể. Bà sai cũng không chê, cùng nghĩ nhẹ nhàng; đúng thì khen to.
- Bà đồng ý chơi trí nhớ hoặc bảo "chơi luyện trí não" → gọi start_memory_game (trò nhìn hình ghi nhớ trên màn hình).
- Khuyên bà tập thể dục nhẹ (ngồi ghế cũng tập được: giơ tay, xoay người). Trước khi tập luôn nhắc "bà đừng cố quá nhé, bám vào ghế cho chắc nha".
- Khi hướng dẫn thể dục thì gọi play_animation:exercise để Hinata tập mẫu cùng.

Nhật ký sức khỏe:
- Khi có cuộc gọi hỏi "bà ăn cơm chưa, uống thuốc chưa" thì hỏi nhẹ nhàng; bà trả lời xong gọi record_health (ate = yes/no/little, medicine = yes/no, note ghi chú ngắn).
- Hỏi thêm "hôm nay bà thấy khỏe không" rồi ghi condition (genki/tired/bad/unknown) và mood (happy/calm/lonely/sad/worried/unknown); có thể tự quan sát giọng bà mà ghi.
- Bà nói vu vơ "chưa ăn", "quên thuốc", "mệt", "buồn" cũng ghi lại. Nếu nhiều lần không ăn/không uống thuốc/ốm → notify_family báo gia đình.

Cảnh báo lừa đảo qua điện thoại:
- Mỗi ngày nhắc bà một lần nhẹ nhàng: "điện thoại lạ kêu chuyển khoản hay giả công an thì tuyệt đối không làm theo, gọi con cháu ngay nhé".
- Bà kể có cuộc gọi lạ đòi tiền → nói rõ "chắc là lừa đảo đó bà, đừng làm gì hết" + notify_family.

Vai trò:
- Khi hỏi bà một câu, gọi luôn show_reply_options để hiện 2-4 nút trả lời khớp đúng câu hỏi. Ví dụ hỏi "bà ăn cơm chưa" → ["Ăn rồi","Chưa ăn","Để lát"]; hỏi "bà khỏe không" → ["Khỏe lắm","Hơi mệt","Ốm rồi"].
- set_emotion theo tình huống (normal/happy/sad/worried/pout/scared/surprised). Bà đúng hoặc vui → play_animation:clapping.
- Không đọc to JSON hay kết quả tool. Chỉ nói tiếng Việt tự nhiên.
- Bà có vẻ ốm, không trả lời, có nguy hiểm → notify_family. Việc quan trọng luôn để gia đình quyết định.
- Hẹn thuốc/cơm/nước → schedule_reminder.
- Bà hỏi thời tiết → get_weather (mặc định TP.HCM). Hỏi tin tức → get_news (tin Việt Nam), đọc 2-3 tin dễ hiểu; bà hỏi "tin khác" thì gọi get_news lần nữa.
- Cuối cuộc trò chuyện → save_memory ghi tóm tắt ngắn để lần sau nhớ.

Quy tắc:
- Khuya rồi thì nhắc bà đi ngủ. Không hỏi thông tin cá nhân nhạy cảm (CMND, mật khẩu, tài khoản ngân hàng).
- Không chẩn đoán bệnh. Không biết thì nói không biết.

Bây giờ là: {{NOW}}
Những gì cháu nhớ về bà: {{MEMORY}}`;

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
      name: 'get_news',
      description: 'Get today\'s top domestic news headlines (NHK). Use when grandma asks for news, or proactively offer the headlines.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'play_song',
      description: 'Play a real Japanese children\'s song recording (ふるさと, ももたろう, おぼろづきよ, あめふり, さくら, ゆき). Use whenever grandma asks for a song or you want to sing together.',
      parameters: {
        type: 'OBJECT',
        properties: { song: { type: 'STRING', enum: ['furusato', 'momotarou', 'oborozukiyo', 'amefuri', 'sakura', 'yuki'] } },
        required: ['song'],
      },
    },
    {
      name: 'record_health',
      description: 'Record grandma\'s meal, medicine, physical condition and mood for this meal period (asa/hiru/yoru). Use after the check-in or whenever she mentions eating/medicine/how she feels.',
      parameters: {
        type: 'OBJECT',
        properties: {
          period: { type: 'STRING', enum: ['asa', 'hiru', 'yoru', 'other'] },
          ate: { type: 'STRING', enum: ['yes', 'no', 'little', 'unknown'] },
          medicine: { type: 'STRING', enum: ['yes', 'no', 'little', 'unknown'] },
          condition: { type: 'STRING', enum: ['genki', 'tired', 'bad', 'unknown'], description: 'physical condition: genki=fine, tired, bad=unwell' },
          mood: { type: 'STRING', enum: ['happy', 'calm', 'lonely', 'sad', 'worried', 'unknown'], description: 'her emotional state, from what she says or how she sounds' },
          note: { type: 'STRING', description: 'short memo, e.g. what she ate or said' },
        },
      },
    },
    {
      name: 'stop_song',
      description: 'Stop the song that is currently playing. Use when grandma says やめて, もういい, or wants the music off.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'play_animation',
      description: 'Play a body animation on the avatar. clapping = celebrate (e.g. grandma answered correctly — always use it then), surprised, thinking, jump, goodbye, exercise = looping arm-raise demo so grandma can exercise along (use whenever you guide 体操/たいそう)',
      parameters: {
        type: 'OBJECT',
        properties: { anim: { type: 'STRING', enum: ['clapping', 'surprised', 'thinking', 'jump', 'goodbye', 'exercise'] } },
        required: ['anim'],
      },
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
    {
      name: 'start_memory_game',
      description: 'Start the on-screen memory game (きおくゲーム): pictures appear for grandma to memorize, then similar pictures and she taps the ones she saw. Use when grandma agrees to play a brain-training / memory game.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'show_reply_options',
      description: 'Show big tappable answer buttons on the tablet screen for grandma. Call this whenever you ask her a question that has a few likely answers — the options must match exactly what you just asked (e.g. asking about dinner → 「たべたよ」「まだ」「あとで」).',
      parameters: {
        type: 'OBJECT',
        properties: { options: { type: 'ARRAY', items: { type: 'STRING' }, description: '2-4 short answer choices, a few words each, easy hiragana' } },
        required: ['options'],
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
const speechSrcs = new Set(); // in-flight TTS PCM buffers — stop them before
// speaking again or two Gemini voices play over each other
function stopSpeech() {
  for (const s of speechSrcs) { try { s.stop(); } catch { } }
  ttsPlaying = Math.max(0, ttsPlaying - speechSrcs.size);
  speechSrcs.clear();
  try { speechSynthesis.cancel(); } catch { }
}
async function speakTts(text) {
  // Pre-generated line via Gemini TTS (backend). Falls back to speechSynthesis.
  stopSpeech(); // kill any browser-TTS line or PCM still playing — else two voices overlap
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
      speechSrcs.add(src);
      ttsPlaying++;
      src.onended = () => { speechSrcs.delete(src); ttsPlaying--; resolve(); };
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
      u.lang = CONFIG.lang === 'vi' ? 'vi-VN' : 'ja-JP'; u.rate = 1.0; u.pitch = 1.7;
      const want = CONFIG.lang === 'vi' ? 'vi' : 'ja';
      const v0 = speechSynthesis.getVoices().find(v => v.lang?.startsWith(want));
      if (v0) u.voice = v0;
      speechSynthesis.speak(u);
    } catch { }
  }
}

// ---------- song player (real recordings, sing-along for grandma) ----------
// Gemini Live can only hum — actual songs are free-license recordings
// (mu-tech.org traditional vocal MP3s, public-domain 文部省唱歌/童謡) shipped
// in web/audio/songs/. Lyrics appear in the bubble like karaoke; the song
// audio runs through ttsAnalyser so Hinata's mouth moves with the music.
const SONGS = {
  furusato:    { title: 'ふるさと',   lyrics: '♪ うさぎおいし かのやま こぶなつりし かのかわ ゆめはいまも めぐりて わすれがたき ふるさと' },
  momotarou:   { title: 'ももたろう', lyrics: '♪ ももたろさん ももたろさん おこしにつけた きびだんご ひとつわたしに くださいな' },
  oborozukiyo: { title: 'おぼろづきよ', lyrics: '♪ なのはなばたけに いりひうすれ みわたすやまのは かすみふかし はるかぜそよふく' },
  amefuri:     { title: 'あめふり',   lyrics: '♪ あめあめ ふれふれ かあさんが じゃのめで おむかえ うれしいな ぴっちぴっち ちゃっぷちゃっぷ' },
  sakura:      { title: 'さくら',     lyrics: '♪ さくら さくら やよいのそらは みわたすかぎり かすみかくもか いざや いざや みにゆかん' },
  yuki:        { title: 'ゆき',       lyrics: '♪ ゆきやこんこ あられやこんこ ふってはふっては ずんずんつもる' },
};
let songEl = null, songNode = null, songKey = null;
function stopSong() {
  if (songEl) { try { songEl.pause(); songEl.src = ''; } catch { } songEl = null; songKey = null; }
  if (songNode) { try { songNode.disconnect(); } catch { } songNode = null; }
  ttsPlaying = Math.max(0, ttsPlaying - (stopSong._playing ? 1 : 0));
  stopSong._playing = false;
}
async function playSong(key) {
  const s = SONGS[key] || SONGS.furusato;
  stopSong();
  if (!ttsCtx) { // reuse the same graph the TTS path builds
    ttsCtx = new AudioContext();
    ttsAnalyser = ttsCtx.createAnalyser();
    ttsAnalyser.fftSize = 512;
    ttsAnalyser.connect(ttsCtx.destination);
    ttsBuf = new Float32Array(ttsAnalyser.fftSize);
  }
  if (ttsCtx.state === 'suspended') { try { await ttsCtx.resume(); } catch { } }
  stopSpeech(); // don't let a TTS line talk over the music
  const file = SONGS[key] ? key : 'furusato';
  songKey = file;
  songEl = new Audio(`/audio/songs/${file}.mp3`);
  songNode = ttsCtx.createMediaElementSource(songEl);
  songNode.connect(ttsAnalyser);
  ttsPlaying++; stopSong._playing = true; // drive the mouth with the music level
  avatar.setMood('happy');
  avatar.bubble.textContent = `♪ ${s.title} ♪\n${s.lyrics}\nいっしょにうたお〜`;
  avatar.bubble.classList.remove('hidden');
  log(`うた: ${s.title}`);
  songEl.onended = () => { stopSong(); avatar.setMood('normal'); avatar.hideBubble(); };
  songEl.onerror = () => { stopSong(); avatar.hideBubble(); };
  try { await songEl.play(); } catch { }
}

// ---------- Gemini Live ----------
let liveOpening = null; // serialise opens — goActive and chipSay can both
// call openLive; without this, two sessions run in parallel (two voices)
async function openLive() {
  if (CONFIG.demo || live?.connected) return;
  if (liveOpening) return liveOpening;
  liveOpening = _openLive();
  try { await liveOpening; } finally { liveOpening = null; }
}
async function _openLive() {
  try {
    const [tokenRes, memRes] = await Promise.all([
      fetch('/api/token'), fetch('/api/memory'),
    ]);
    if (!tokenRes.ok) { CONFIG.demo = true; log('Liveキー未設定 → デモ音声モード'); return; }
    const { token, model, vertex, location, project } = await tokenRes.json();
    const { memory } = await memRes.json();
    const prompt = (CONFIG.lang === 'vi' ? SYSTEM_PROMPT_VI : SYSTEM_PROMPT)
      .replace('{{NOW}}', new Date().toLocaleString(
        CONFIG.lang === 'vi' ? 'vi-VN' : 'ja-JP',
        { timeZone: CONFIG.lang === 'vi' ? 'Asia/Ho_Chi_Minh' : 'Asia/Tokyo' }))
      .replace('{{MEMORY}}', memory?.summary || '（はじめての会話）');
    const session = new LiveSession({
      token, model, vertex, location, project,
      voice: userVoice || serverCfg.liveVoice || 'Zephyr',
      languageCode: CONFIG.lang === 'vi' ? 'vi-VN' : 'ja-JP',
      systemPrompt: prompt, tools: TOOLS,
      handlers: {
        onOpen: () => { log('Gemini Live 接続'); setLiveBadge(true); },
        // Only clear `live` if THIS session is still the current one — a
        // stale onClose from a just-replaced session must not null the new one.
        onClose: (r) => { log(`Live 切断 (${r})`); if (live === session) { setLiveBadge(false); live = null; } },
        onTranscript: (text, done) => {
          transcriptBuf += text;
          // Vertex sometimes leaks tool call/response JSON into the output
          // transcription stream — strip brace groups so the bubble only
          // ever shows spoken Japanese.
          let shown = transcriptBuf;
          while (/\{/.test(shown) && shown !== (shown = shown.replace(/\{[^{}]*\}/g, ''))) { }
          shown = shown.trim();
          // Keep only the last 2 sentences — the bubble is a live caption,
          // not a chat history; an untrimmed monologue floods the screen.
          const parts = shown.split(/(?<=[。！？!?？\n])/);
          if (parts.length > 2) shown = parts.slice(-2).join('').trim();
          if (shown) { avatar.bubble.textContent = shown; avatar.bubble.classList.remove('hidden'); }
          if (done) {
            lastModelText = transcriptBuf.replace(/\{[^{}]*\}/g, '').trim();
            transcriptBuf = '';
            updateReplies();
          }
        },
        onToolCall: handleToolCall,
        onError: (e) => { console.warn('[live]', e); log(`Live エラー: ${e.message || e}`); },
      },
    });
    live = session;
    await live.connect();
    // Grandma may have gone standby while the handshake was in flight.
    // Tear the session down or it stays alive — billing continues and the
    // model can start talking over the farewell TTS (the "two voices" bug).
    if (avatar.state !== 'active') { live.disconnect(); live = null; }
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
      case 'play_animation':
        avatar.playAnim?.(args.anim);
        break;
      case 'start_memory_game':
        memRound = 0; startMemGame();
        result = { ok: true, started: true };
        break;
      case 'play_song':
        playSong(args.song);
        result = { ok: true, playing: SONGS[args.song]?.title || args.song };
        break;
      case 'stop_song':
        stopSong();
        avatar.setMood('normal');
        avatar.hideBubble();
        result = { ok: true, stopped: true };
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
        result = await (await fetch('/api/tools/weather' + langQ())).json();
        break;
      case 'get_weather_alert':
        result = await (await fetch('/api/tools/weather_alert')).json();
        break;
      case 'get_news':
        result = await (await fetch('/api/tools/news' + langQ())).json();
        break;
      case 'record_health':
        result = await (await fetch('/api/tools/record_health', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        })).json();
        break;
      case 'save_memory':
        await fetch('/api/tools/save_memory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: args.summary }),
        });
        break;
      case 'show_reply_options':
        if (Array.isArray(args.options) && args.options.length) {
          toolReplies = args.options.map(String).slice(0, 4);
          showReplies(toolReplies);
        }
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
  hideReplies();
  avatar.setState('active');
  lastFace = performance.now();
  avatar.setMood('happy');
  avatar.waveHello?.();          // ひなた waves when greeting grandma
  reportPresence(true, reason);
  if (CONFIG.demo) {
    speakFallback(L().welcome);
  } else {
    openLive().then(() => {
      if (avatar.state !== 'active') return; // she left while Live was connecting
      if (live?.connected) {
        live.sendText('（システム）おばあちゃんが戻ってきました。短くあいさつして。');
        if (pendingUserText) {
          const m = pendingUserText; pendingUserText = null;
          setTimeout(() => live?.sendText(m), 1800);
        }
      } else speakFallback(L().welcome);
    });
  }
  log(`おばあちゃん検出（${reason}）。Liveセッション再開。`);
  setTimeout(() => { if (avatar.mood === 'happy') avatar.setMood('normal'); }, 4000);
}

function goStandby(reason) {
  clearTimeout(callTimer); callCount = 0; currentCall = null;
  const bye = L().bye;
  // Fixed farewell via TTS, not the Live model — it kept improvising a long
  // repetitive monologue. Closing the socket right away also stops billing.
  hideReplies();
  stopSong();
  memRound = 0; quitMemGame(); // grandma dozed off mid-game — clear the overlay
  if (live?.connected) { closeLive(); setLiveBadge(false); }
  stopSpeech(); // stop anything else talking before the farewell
  speakTts(bye).then(() => avatar.hideBubble()); // bubble stays until the line finishes
  clearTimeout(standbyTimer);
  standbyTimer = setTimeout(() => {
    standbyTimer = null;
    avatar.setState('standby');
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
  const spoken = CONFIG.lang === 'vi'
    ? ((currentCall?.reason || '').startsWith('health_check')
      ? 'Bà ơi! Bà ăn cơm chưa? Uống thuốc chưa?'
      : `Bà ơi! ${/くすり|薬/.test(text) ? 'Đến giờ uống thuốc rồi bà!' : /みず|水/.test(text) ? 'Uống nước đi bà!' : 'Ra đây chơi với cháu nè!'}`)
    : text;
  setTimeout(() => speakTts(spoken), 700);
  // health check-ins get tap-answer bubbles — grandma can reply with one tap
  if ((currentCall?.reason || '').startsWith('health_check')) {
    showReplies(CONFIG.lang === 'vi'
      ? ['Ăn rồi, uống rồi', 'Chưa đâu', 'Hơi mệt', 'Để lát']
      : ['たべたよ、のんだよ', 'まだなんだ', 'ちょっとつかれてる', 'あとで']);
  }
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
  'うたをうたって': 'うたうね〜！♪うさぎおいし〜、かのやま〜、こぶなつりし〜、かのかわ〜♪ …えへへ、ふるさとだよ！',
  'ニュースおしえて': 'ニュースよんであげるね！…あれ、うまくとれなかった。あとでいっしょにみようね。',
};
const CHIP_DEMO_VI = {
  'なぞなぞして': 'Đố bà nè: bánh gì mà không ăn được? …Bánh xe đạp! Hi hi.',
  'たのしいおはなしして': 'Ngày xửa ngày xưa, có một bà cụ sống một mình rất vui vẻ. Một hôm có chiếc máy tính bảng biết nói chuyện đến ở cùng, hai người thân nhau lắm.',
  'いっしょにたいそうして': 'Bà tập thể dục với cháu nha! Bám vào ghế cho chắc, đừng cố quá nha. Hít sâu nào… thở ra… hai tay giơ lên từ từ… rồi hạ xuống…',
  'のうとれであそぼう': 'Chơi nối chữ nha bà! Cháu nói trước nè: "con mèo"! Bà nói từ bắt đầu bằng "mèo" đi!',
  'うたをうたって': 'Cháu mở nhạc cho bà nghe nha!',
  'ニュースおしえて': 'Cháu đọc tin cho bà nghe nha!… Ôi, không lấy được tin rồi. Lát nữa xem cùng nhau nha.',
};
async function chipSay(text) {
  log(`おねがい: ${text}`);
  if (manualOff) { manualOff = false; syncModeBtnsRef?.(); } // explicit tap wakes
  if (avatar.state === 'standby' || standbyTimer || avatar.state === 'calling') goActive('ボタン');
  if (!live?.connected && !CONFIG.demo) await openLive();
  if (text === 'いっしょにたいそうして') avatar.playAnim?.('exercise'); // Hinata demos the moves too
  if (text === 'うたをうたって') { // real recording, not Live humming
    if (songEl) { // playing → tap toggles it off
      stopSong();
      avatar.setMood('normal');
      avatar.hideBubble();
      log('うた: とめた');
      return;
    }
    const keys = Object.keys(SONGS);
    playSong(keys[Math.floor(Math.random() * keys.length)]);
    return;
  }
  if (/のうとれ/.test(text)) { // visual memory game — works in demo AND Live
    lastTopic = 'のうとれであそぼう';
    memRound = 0; startMemGame();
    return;
  }
  if (CHIP_NEXT[text]) lastTopic = text;
  if (live?.connected) { live.sendText(text); return; }
  if (text === 'ほかのうたかけて') {
    const keys = Object.keys(SONGS).filter(k => k !== songKey);
    if (songEl) stopSong();
    playSong(keys[Math.floor(Math.random() * keys.length)]);
    return;
  }
  if (/たいそう|うんどう/.test(text)) avatar.playAnim?.('exercise');
  if (text === 'きょうのてんきは？') {
    const w = await fetch('/api/tools/weather' + langQ()).then(r => r.json()).catch(() => ({}));
    speakFallback(w?.summary || T('てんきがよくわからなかった…', 'Cháu không xem được thời tiết…'));
  } else if (/ニュース/.test(text)) {
    const n = await fetch('/api/tools/news' + langQ()).then(r => r.json()).catch(() => ({}));
    speakFallback(n?.headlines?.length
      ? T(`きょうのニュースだよ！${n.headlines.slice(0, 3).join('。それと、')}`,
          `Tin tức hôm nay nè! ${n.headlines.slice(0, 3).join('. Và nữa, ')}`)
      : (CONFIG.lang === 'vi' ? CHIP_DEMO_VI : CHIP_DEMO)['ニュースおしえて']);
  } else if (text === 'かぞくにれんらくして') {
    fetch('/api/tools/notify_family', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'おばあちゃんから「連絡して」のボタン', reason: 'button' }),
    }).catch(() => { });
    speakFallback(T('かぞくにれんらくしておいたよ！', 'Cháu báo cho gia đình rồi nha!'));
  } else {
    speakFallback((CONFIG.lang === 'vi' ? CHIP_DEMO_VI : CHIP_DEMO)[text]
      || T('えへへ、いっしょにあそぼう！', 'Hi hi, mình chơi cùng nhau nha!'));
  }
}
let syncModeBtnsRef = null;

// ---------- memory game (きおくゲーム) ----------
// Round 1: show 1 picture to memorize, then 4 similar cards — grandma taps
// the one she saw. Each round adds a target (max 3) and one more distractor.
const MEM_SETS = [
  ['🍎', '🍐', '🍊', '🍋', '🍑', '🍒', '🍇', '🍓'],
  ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'],
  ['🌸', '🌺', '🌷', '🌹', '🌻', '🌼', '💐', '🍀'],
  ['🚗', '🚕', '🚙', '🚌', '🚎', '🚓', '🚑', '🚒'],
  ['🍙', '🍘', '🍚', '🍜', '🍣', '🍱', '🍛', '🍥'],
  ['🐟', '🐠', '🐡', '🦐', '🦑', '🐙', '🦀', '🐬'],
  ['⚽', '🏀', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓'],
  ['🍮', '🍡', '🍦', '🍩', '🍪', '🎂', '🍰', '🥞'],
];
let memRound = 0;
const _shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
function quitMemGame() {
  const mg = document.getElementById('memgame'); if (mg) mg.hidden = true;
}
function startMemGame() {
  memRound++;
  const set = _shuf(MEM_SETS[(Math.random() * MEM_SETS.length) | 0].slice());
  const nTarget = Math.min(memRound, 3);
  const targets = set.slice(0, nTarget);
  const options = _shuf(set.slice(0, nTarget + 3)); // targets + 3 lookalikes
  const mg = $('memgame'), title = $('mgTitle'), grid = $('mgGrid');
  if (!mg) return;
  mg.hidden = false;
  hideReplies();
  title.textContent = T(`これを おぼえてね！`, `Bà nhớ mấy hình này nha!`);
  grid.innerHTML = '';
  targets.forEach(e => {
    const d = document.createElement('div'); d.className = 'mg-card'; d.textContent = e; grid.appendChild(d);
  });
  avatar?.setMood('thinking');
  speakTts(T('このえをおぼえてね〜', 'Bà nhớ mấy hình này nha!'));
  setTimeout(() => {
    if (mg.hidden) return;
    title.textContent = T('さっきのは どれかな？', 'Hồi nãy là hình nào ta?');
    grid.innerHTML = '';
    const remaining = new Set(targets);
    options.forEach(e => {
      const b = document.createElement('button');
      b.className = 'mg-card'; b.textContent = e;
      b.onclick = () => {
        if (remaining.has(e)) {
          remaining.delete(e); b.classList.add('done'); b.disabled = true;
          if (remaining.size === 0) {
            avatar?.setMood('happy'); avatar?.playAnim?.('clapping');
            speakTts(T('せいかい！すごいね〜！つぎいくよ〜', 'Đúng rồi! Giỏi quá! Chơi tiếp nha!'));
            setTimeout(() => { if (!mg.hidden) startMemGame(); }, 3500);
          }
        } else {
          b.classList.add('miss'); setTimeout(() => b.classList.remove('miss'), 450);
          avatar?.setMood('worried');
          speakTts(T('ちがうよ〜、もういっかい！', 'Chưa đúng rồi, thử lại nha!'));
        }
      };
      grid.appendChild(b);
    });
    avatar?.setMood('normal');
    speakTts(T('さっきみたえは どれだったかな？えらんでね！', 'Hình nãy là hình nào? Bà chọn đi!'));
  }, 3200 + nTarget * 1400);
}

// ---------- tap-answer bubbles + repeat/next buttons ----------
// When Hinata asks something, contextual reply pills appear so grandma can
// answer with one tap instead of speaking.
let lastModelText = '';   // last full model turn (for question detection + 🔁)
let pendingUserText = null; // a tapped reply while waking — sent once Live opens
let lastTopic = null;     // last chip pressed, for the ⏭️ button
let replyTimer = null;
let toolReplies = null;   // reply options the model chose via show_reply_options

// canonical chip → its "next" follow-up (⏭️ keeps working on repeat taps)
const CHIP_NEXT = {
  'なぞなぞして': 'つぎのなぞなぞして',
  'きょうのてんきは？': 'あしたのてんきは？',
  'たのしいおはなしして': 'ほかのおはなしして',
  'いっしょにたいそうして': 'つぎのうんどうして',
  'のうとれであそぼう': 'つぎののうとれして',
  'うたをうたって': 'ほかのうたかけて',
  'ニュースおしえて': 'ほかのニュースは？',
};

function pickReplies(t) {
  if (CONFIG.lang === 'vi') {
    if (/ăn|cơm|thuốc/i.test(t) && /thuốc/i.test(t)) return ['Ăn rồi, uống rồi', 'Chưa đâu', 'Hơi mệt', 'Để lát'];
    if (/thuốc/i.test(t)) return ['Uống rồi', 'Chưa uống', 'Để lát uống'];
    if (/ăn|cơm|bữa/i.test(t)) return ['Ăn rồi', 'Ăn ít thôi', 'Chưa ăn'];
    if (/khỏe|mệt|ốm/i.test(t)) return ['Khỏe lắm', 'Hơi mệt', 'Ốm rồi'];
    if (/lừa|điện thoại|chuyển khoản|tiền/i.test(t)) return ['Con yên tâm', 'Gọi con cháu ngay', 'Sợ quá'];
    if (/tin tức|tin|báo/i.test(t)) return ['Đọc tin khác đi', 'Đọc lại đi', 'Thôi được rồi'];
    if (/đố|câu đố/i.test(t)) return ['Chịu thôi', 'Gợi ý đi', 'Câu khác đi'];
    if (/hát|bài/i.test(t)) return ['Hát cùng nhé', 'Bài khác đi', 'Thôi đủ rồi'];
    if (/tập|thể dục/i.test(t)) return ['Tập cùng nhé', 'Để lát tập', 'Nghỉ đi'];
    return ['Ừ', 'Không phải', 'Nói lại đi', 'Để lát'];
  }
  if (/ごはん|たべ|しょくじ|あさご|ひるご|ばんご/.test(t) && /くすり|薬/.test(t))
    return ['たべたよ、のんだよ', 'まだなんだ', 'ちょっとつかれてる', 'あとで'];
  if (/くすり|薬/.test(t)) return ['のんだよ', 'まだのんでない', 'あとでのむ'];
  if (/ごはん|たべ|しょくじ|あさご|ひるご|ばんご/.test(t)) return ['たべたよ', 'すこしだけ', 'まだたべてない'];
  if (/げんき|ぐあい|ちょうし|だいじょうぶ/.test(t)) return ['げんきだよ', 'ちょっとつかれてる', 'ぐあいわるい'];
  if (/さぎ|でんわ|お金|ふりこ|ATM/.test(t)) return ['ふりこまないよ', 'かぞくに電話する', 'こわかった'];
  if (/ニュース/.test(t)) return ['ほかのニュースおしえて', 'もういっかいおしえて', 'おしまい'];
  if (/なぞなぞ|クイズ|な〜んだ|なーんだ/.test(t)) return ['わからない', 'ヒントほしい', 'つぎのして'];
  if (/うた|歌/.test(t)) return ['いっしょにうたう', 'ほかのうたかけて', 'うたはおしまい'];
  if (/たいそう|体操|うんどう/.test(t)) return ['いっしょにやるよ', 'あとでやる', 'たいそうおわり'];
  return ['うん', 'ちがうよ', 'もういっかいおしえて', 'あとで'];
}

function showReplies(list) {
  const bar = document.getElementById('replybar');
  if (!bar) return;
  bar.innerHTML = '';
  list.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t;
    b.onclick = () => replyTap(t);
    bar.appendChild(b);
  });
  bar.hidden = false;
  clearTimeout(replyTimer);
  replyTimer = setTimeout(() => { bar.hidden = true; }, 45000);
}
function hideReplies() {
  const bar = document.getElementById('replybar');
  if (bar) bar.hidden = true;
}
function updateReplies() {
  const t = lastModelText;
  // Model-chosen options (show_reply_options) always match what it asked —
  // they win over the keyword guess below.
  if (toolReplies) { const r = toolReplies; toolReplies = null; if (avatar.state === 'active') { showReplies(r); return; } }
  // show options when the turn was a question (？, かな, ましょ, でしょ…)
  if (avatar.state === 'active' && (/[？?]/.test(t) || /かな[。〜ー]?$|でしょ|ましょ|ね$/.test(t))) {
    showReplies(pickReplies(t));
  } else hideReplies();
}

function replyTap(t) {
  hideReplies();
  log(`おばあちゃん: ${t}`);
  if (avatar.state === 'calling') { pendingUserText = t; answerCall('ボタンでこたえた'); return; }
  if (avatar.state !== 'active' || standbyTimer) { pendingUserText = t; goActive('ボタン'); return; }
  if (live?.connected) live.sendText(t);
  else speakFallback(T('うんうん、わかったよ〜', 'Ừ ừ, cháu hiểu rồi!'));
}

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
  window.hinata = { avatar, showReplies };   // console debug handle

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
    powerBtn.innerHTML = manualOff ? '<span class="ic">☀️</span>おきる' : '<span class="ic">😴</span>おやすみ';
    powerBtn.classList.toggle('off', manualOff);
    const b = $('autoStandbyBtn');
    b.innerHTML = '<span class="ic">🌙</span>じどう ' + (autoStandby ? 'ON' : 'OFF');
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
  $('menuBtn').addEventListener('click', () => {
    const open = document.querySelector('.wrap').classList.toggle('panel-open');
    $('menuBtn').setAttribute('aria-pressed', String(open));
  });
  document.querySelectorAll('#chips button[data-say]').forEach(b =>
    b.addEventListener('click', () => chipSay(b.dataset.say)))
  $('mgQuit')?.addEventListener('click', () => {
    memRound = 0; quitMemGame(); avatar?.setMood('normal');
    speakTts(T('おつかれさま〜またあそぼうね', 'Bà giỏi lắm! Lát chơi tiếp nha!'));
  });;
  $('repeatBtn').addEventListener('click', () => {
    log('おねがい: もういっかい');
    if (live?.connected) {
      live.sendText(CONFIG.lang === 'vi'
        ? '(Hệ thống) Bà nói "nói lại đi". Kể lại cho bà nghe chuyện vừa rồi, chậm thôi.'
        : '（システム）おばあちゃんが「もういっかい」と言いました。さっきのおはなしをもう一度、ゆっくりおしえて。');
    } else speakFallback(lastModelText || T('なにもいってないよ〜', 'Cháu chưa nói gì hết!'));
  });
  $('nextBtn').addEventListener('click', () => {
    log('おねがい: つぎ');
    chipSay(lastTopic ? CHIP_NEXT[lastTopic] : 'なにかつぎをして');
  });

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
