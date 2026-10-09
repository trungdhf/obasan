// Pre-records Hinata's fixed lines (web/js/lines.js) with the Gemini Live
// model itself, so farewell / proactive calls / memory-game feedback sound
// exactly like the conversation voice. The separate TTS model renders the same
// prebuilt voice (e.g. Zephyr) with a noticeably different timbre.
//
//   cd backend && node scripts/gen-lines.mjs [--voice Zephyr] [--force]
//
// Needs Vertex ADC (VERTEX_PROJECT / GOOGLE_CLOUD_PROJECT, or the gcloud
// default project) and ffmpeg on PATH. Writes web/audio/lines/<voice>/*.mp3
// and web/audio/lines/manifest.json ({ voice: { text: path } }).

import { GoogleGenAI, Modality } from '@google/genai';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, LINES_VI, GAME, CALL_VI } from '../../web/js/lines.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VOICE = opt('--voice', process.env.LIVE_VOICE || 'Zephyr');
const FORCE = args.includes('--force');
const MODEL = process.env.LIVE_MODEL || 'gemini-live-2.5-flash';
const PROJECT = process.env.VERTEX_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
  || execSync('gcloud config get-value project').toString().trim();
const LOCATION = process.env.VERTEX_LIVE_LOCATION || 'global';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/audio/lines');
const MANIFEST = path.join(ROOT, 'manifest.json');

// every fixed line, tagged with its language
const ja = new Set(), vi = new Set();
for (const set of Object.values(LINES)) {
  if (!set) continue;
  ja.add(set.bye); set.calls.forEach(c => ja.add(c));
}
for (const set of Object.values(LINES_VI)) {
  if (!set) continue;
  vi.add(set.bye); set.calls.forEach(c => vi.add(c));
}
for (const [j, v] of Object.values(GAME)) { ja.add(j); vi.add(v); }
Object.values(CALL_VI).forEach(v => vi.add(v));

const PERSONA = {
  ja: 'あなたは「ひなた」、おばあちゃんが大好きな明るい小学1年生の女の子です。',
  vi: 'Bạn là "Hinata", một bé gái lớp 1 vui vẻ, rất thương bà.',
};
const RULE = 'ユーザーが送る文章を、ひなたの声でそのまま一字一句読み上げてください。言葉を足したり、省いたり、返事をしたりしないでください。'
  + ' / Read the user text aloud exactly as written, in character. Do not add, drop or answer anything.';

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
const norm = s => s.replace(/[\s、。！？!?,.〜~ー…「」]/g, '').toLowerCase();

async function record(text, lang) {
  const chunks = []; let transcript = '';
  let done, fail;
  const finished = new Promise((res, rej) => { done = res; fail = rej; });
  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        languageCode: lang === 'vi' ? 'vi-VN' : 'ja-JP',
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
      },
      systemInstruction: PERSONA[lang] + RULE,
      outputAudioTranscription: {},
    },
    callbacks: {
      onmessage: m => {
        const sc = m.serverContent;
        for (const p of sc?.modelTurn?.parts || []) {
          if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, 'base64'));
        }
        if (sc?.outputTranscription?.text) transcript += sc.outputTranscription.text;
        if (sc?.turnComplete) done();
      },
      onerror: e => fail(new Error(e.message || String(e))),
      onclose: e => fail(new Error(`closed: ${e.reason || e.code}`)),
    },
  });
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
  const timer = setTimeout(() => fail(new Error('timeout')), 30000);
  try { await finished; } finally { clearTimeout(timer); session.close(); }
  return { pcm: Buffer.concat(chunks), transcript };
}

function toMp3(pcm, out) {
  // Live audio: 24 kHz mono s16le. Trim leading/trailing silence.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    '-c:a', 'libmp3lame', '-b:a', '64k', out], { input: pcm });
}

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const entries = manifest[VOICE] ||= {};
fs.mkdirSync(path.join(ROOT, VOICE), { recursive: true });

const todo = [...[...ja].map(t => [t, 'ja']), ...[...vi].map(t => [t, 'vi'])]
  .filter(([t]) => FORCE || !entries[t]);
console.log(`[gen-lines] ${VOICE} via ${MODEL} @ ${PROJECT}/${LOCATION}: ${todo.length} lines`);

let failed = 0;
for (const [text, lang] of todo) {
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const { pcm, transcript } = await record(text, lang);
      if (pcm.length < 24000) throw new Error('no audio');
      // the model sometimes paraphrases or answers — retry unless it read the line
      const a = norm(text), b = norm(transcript);
      if (b && !(b.includes(a) || a.includes(b)) && Math.abs(a.length - b.length) > 3) {
        throw new Error(`transcript mismatch: "${transcript.trim()}"`);
      }
      const file = `${VOICE}/${createHash('sha1').update(text).digest('hex').slice(0, 12)}.mp3`;
      toMp3(pcm, path.join(ROOT, file));
      entries[text] = file;
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
      console.log(`  ok  ${text}`);
      ok = true;
    } catch (e) {
      console.warn(`  try ${attempt} ${text}: ${e.message}`);
    }
  }
  if (!ok) failed++;
}
console.log(`[gen-lines] done, ${failed} failed`);
process.exit(failed ? 1 : 0);
