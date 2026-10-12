// Hinata's voice: Gemini's prebuilt voices are all adult, so her audio is
// pitched up (+3 semitones by default, formants move with it, tempo kept)
// to sound like a 6-year-old. SoundTouch JS (LGPL-2.1, vendored unmodified
// in ./vendor) does the shifting; ?pitch=0 turns it off.
import { SoundTouch } from './vendor/soundtouch.js';

function stretcher(semitones, sampleRate) {
  const st = new SoundTouch();
  st.stretch.setParameters(sampleRate, 0, 0, 8); // its defaults assume 44.1 kHz
  st.pitchSemitones = semitones;
  return st;
}
function feed(st, mono) {
  const s = new Float32Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) { s[i * 2] = mono[i]; s[i * 2 + 1] = mono[i]; }
  st.inputBuffer.putSamples(s, 0, mono.length);
  st.process();
}
function drain(st) {
  const n = st.outputBuffer.frameCount;
  if (!n) return new Float32Array(0);
  const tmp = new Float32Array(n * 2);
  st.outputBuffer.receiveSamples(tmp, n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = tmp[i * 2];
  return out;
}

// Streaming: push() each incoming chunk, play whatever comes out; flush() at
// the end of a turn pushes silence so the tail held in the pipeline plays.
export function pitchStream(semitones, sampleRate) {
  let st = stretcher(semitones, sampleRate);
  return {
    push(mono) { feed(st, mono); return drain(st); },
    flush() { feed(st, new Float32Array(Math.round(sampleRate * 0.2))); return drain(st); },
    reset() { st = stretcher(semitones, sampleRate); },
  };
}

// Whole buffer at once (TTS lines).
export function pitchBuffer(mono, sampleRate, semitones) {
  const st = stretcher(semitones, sampleRate);
  feed(st, mono);
  feed(st, new Float32Array(Math.round(sampleRate * 0.2)));
  return drain(st);
}
