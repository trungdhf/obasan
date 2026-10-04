// Gemini helpers: short-lived ephemeral tokens so the tablet can open a Gemini
// Live session directly (no API key on the device), and Flash TTS for the
// pre-generated proactive-call lines.

import { GoogleGenAI } from '@google/genai';

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'Leda';

let ai = null;
export function geminiEnabled() {
  return Boolean(API_KEY);
}
if (geminiEnabled()) {
  ai = new GoogleGenAI({ apiKey: API_KEY });
} else {
  console.log('[gemini] GEMINI_API_KEY not set — token/TTS endpoints will report demo mode');
}

// Ephemeral token for a single Live session. The tablet uses it as the apiKey
// with BidiGenerateContentConstrained on v1alpha.
export async function createLiveToken() {
  if (!ai) return null;
  const now = Date.now();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),      // token valid 30 min
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString() // session must start within 2 min
    }
  });
  return token.name;
}

const ttsCache = new Map(); // text -> { data, mimeType, at }

// Pre-generated call line → base64 PCM (audio/L16;rate=24000).
export async function synthesizeSpeech(text) {
  if (!ai) return null;
  const hit = ttsCache.get(text);
  if (hit) return hit;
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text: `元気な幼い子どもの声で、おばあちゃんに話しかけるように言ってください: ${text}` }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } }
    }
  });
  const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part) throw new Error('TTS returned no audio');
  const out = { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'audio/L16;rate=24000' };
  if (ttsCache.size > 100) ttsCache.clear();
  ttsCache.set(text, out);
  return out;
}
