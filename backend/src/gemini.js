// Gemini helpers. Two modes:
//  - Vertex AI (GOOGLE_CLOUD_PROJECT set): Gemini Live via OAuth access tokens
//    minted server-side (service account on Cloud Run / ADC locally) — this is
//    the mode hackathon Google Cloud credits pay for.
//  - AI Studio (GEMINI_API_KEY): ephemeral tokens via authTokens.create.
// Neither credential ever ships to the tablet; it only gets a short-lived token.

import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
// VERTEX_PROJECT overrides GOOGLE_CLOUD_PROJECT so Vertex Live/TTS can be
// tested without also enabling the Firestore store.
const PROJECT = process.env.VERTEX_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const LOCATION = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
// Live runs on the 'global' Vertex endpoint: regional Live publisher models
// (e.g. gemini-live-2.5-flash on us-central1) are not served — verified
// 2026-10 against a real project (close 1008 "Publisher model ...").
// TTS stays regional (LOCATION); override with VERTEX_LIVE_LOCATION if needed.
const LIVE_LOCATION = process.env.VERTEX_LIVE_LOCATION || 'global';
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'Aoede';

const VERTEX = Boolean(PROJECT);
export function isVertex() { return VERTEX; }
export function vertexLocation() { return LOCATION; }
export function geminiEnabled() { return VERTEX || Boolean(API_KEY); }

let ai = null;
if (geminiEnabled()) {
  ai = VERTEX
    ? new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION })
    : new GoogleGenAI({ apiKey: API_KEY });
  console.log(`[gemini] mode=${VERTEX ? `vertex:${PROJECT}/${LOCATION}` : 'ai-studio'}`);
} else {
  console.log('[gemini] no GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY — token/TTS endpoints will report demo mode');
}

// Token the tablet trades for a direct Live session.
// Vertex: OAuth access token (~1h, used as ?access_token= on the WS URL).
// AI Studio: ephemeral token (single-use, 30 min) via authTokens.create.
export async function createLiveToken() {
  if (!ai) return null;
  if (VERTEX) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('no access token (check ADC / service account)');
    return { token, vertex: true, location: LIVE_LOCATION, project: PROJECT };
  }
  const now = Date.now();
  const t = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),      // token valid 30 min
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString() // session must start within 2 min
    }
  });
  return { token: t.name, vertex: false };
}

const ttsCache = new Map(); // `${voice}|${text}` -> { data, mimeType, at }

// Pre-generated call line → base64 PCM (audio/L16;rate=24000).
export async function synthesizeSpeech(text, voice) {
  if (!ai) return null;
  const voiceName = /^[A-Za-z]{2,20}$/.test(voice || '') ? voice : TTS_VOICE;
  const key = `${voiceName}|${text}`;
  const hit = ttsCache.get(key);
  if (hit) return hit;
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: 'user', parts: [{ text: `元気な幼い子どもの声で、おばあちゃんに話しかけるように言ってください: ${text}` }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        languageCode: 'ja-JP',
        voiceConfig: { prebuiltVoiceConfig: { voiceName } }
      }
    }
  });
  const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part) throw new Error('TTS returned no audio');
  const out = { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'audio/L16;rate=24000' };
  if (ttsCache.size > 100) ttsCache.clear();
  ttsCache.set(key, out);
  return out;
}
