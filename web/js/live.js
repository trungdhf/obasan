// Gemini Live client — minimal raw-WebSocket implementation of the Live
// bidi protocol, matching the @google/genai SDK's endpoint/auth rules:
//  - AI Studio: GenerativeService.BidiGenerateContentConstrained with an
//    ephemeral token passed as ?access_token= (NOT ?key= — that form is for
//    regular API keys on BidiGenerateContent).
//  - Vertex AI: google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent
//    (slash before the method) + OAuth access token as ?access_token= —
//    browsers cannot set the Authorization header the SDK uses.
// Mic → 16kHz PCM up; model audio → 24kHz PCM playback with an analyser
// feeding the avatar's lip-sync. No SDK dependency in the browser.

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
function vertexWsUrl(location) {
  // 'global' location → bare host (no {location}- prefix).
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
}
const IN_RATE = 16000;
const OUT_RATE = 24000;

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64decode(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const v = Math.max(-1, Math.min(1, float32[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}
function resample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(float32.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = float32[Math.floor(i * ratio)];
  return out;
}

const WORKLET_SRC = `
class PcmCap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-cap', PcmCap);`;

export class LiveSession {
  // handlers: onOpen, onClose(reason), onError(err), onTranscript(text, turnComplete),
  //           onInputTranscript(text), onToolCall(call), onInterrupted
  constructor({ token, model, voice, systemPrompt, tools, handlers, vertex, location, project, languageCode }) {
    this.token = token;
    this.vertex = Boolean(vertex);
    this.location = location || 'us-central1';
    this.project = project || '';
    this.model = model;
    this.voice = voice;
    this.languageCode = languageCode || 'ja-JP';
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.h = handlers || {};
    this.ws = null;
    this.connected = false;
    this._sources = new Set();
    this._nextPlay = 0;
    this._sendQueue = [];
    this._pcmBuf = new Float32Array(0);
  }

  get speaking() { return this._sources.size > 0; }

  async connect() {
    await this._startPlayback();
    await this._startMic();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.vertex
        ? `${vertexWsUrl(this.location)}?access_token=${encodeURIComponent(this.token)}`
        : `${WS_URL}?access_token=${encodeURIComponent(this.token)}`);
      this.ws = ws;
      ws.onopen = () => this._sendSetup();
      ws.binaryType = 'arraybuffer';
      const timeout = setTimeout(() => reject(new Error('Live setup timeout')), 15000);
      ws.onmessage = (ev) => this._onMessage(ev, () => { clearTimeout(timeout); resolve(); });
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Live socket error')); };
      ws.onclose = (e) => {
        this.connected = false;
        this.h.onClose?.(e.reason || `code ${e.code}`);
      };
    });
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  _sendSetup() {
    const model = this.vertex
      ? `projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}`
      : `models/${this.model}`;
    this._send({
      setup: {
        model,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            languageCode: this.languageCode,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } },
          },
        },
        systemInstruction: { parts: [{ text: this.systemPrompt }] },
        tools: this.tools,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  }

  // Vertex sends JSON in binary frames (Blob/ArrayBuffer in the browser),
  // AI Studio sends text frames. Decode first, then keep the existing
  // parse path; the decode chain preserves message order.
  _onMessage(ev, onReady) {
    const data = ev.data;
    this._decodeChain = (this._decodeChain || Promise.resolve())
      .then(async () => {
        const text = typeof data === 'string'
          ? data
          : data instanceof Blob
            ? await data.text()
            : new TextDecoder().decode(data);
        this._handleMessage(JSON.parse(text), onReady);
      })
      .catch(e => this.h.onError?.(e));
  }

  _handleMessage(msg, onReady) {
    if (msg.setupComplete !== undefined) {
      this.connected = true;
      this.h.onOpen?.();
      onReady();
      return;
    }
    if (msg.serverContent) {
      const sc = msg.serverContent;
      if (sc.modelTurn) { if (!this._inTurn) this.h.onTurnStart?.(); this._inTurn = true; }
      for (const part of sc.modelTurn?.parts || []) {
        if (part.inlineData?.data && !this._hushed) this._playChunk(part.inlineData.data);
      }
      if (sc.outputTranscription?.text && !this._hushed) this.h.onTranscript?.(sc.outputTranscription.text, false);
      if (sc.inputTranscription?.text) this.h.onInputTranscript?.(sc.inputTranscription.text);
      if (sc.interrupted) this._flushPlayback() || this.h.onInterrupted?.();
      if (sc.turnComplete) this.h.onTranscript?.('', true);
      if (sc.turnComplete || sc.interrupted) { this._inTurn = false; this._hushed = false; }
    }
    if (msg.toolCall) {
      for (const call of msg.toolCall.functionCalls || []) this.h.onToolCall?.(call);
    }
    if (msg.goAway) this.h.onClose?.('goAway');
  }

  // ---- mic ----
  async _startMic() {
    this.micCtx = new AudioContext();
    if (this.micCtx.state === 'suspended') await this.micCtx.resume().catch(() => {});
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    this.micStream = stream;
    const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await this.micCtx.audioWorklet.addModule(blobUrl);
    const src = this.micCtx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(this.micCtx, 'pcm-cap');
    node.port.onmessage = (e) => this._onMicFrame(e.data);
    src.connect(node);
    // Pull the worklet through a muted gain: the processor must be connected
    // to run, but routing mic audio to the speakers echoes grandma's voice
    // (and the bot's replies) back into the conversation.
    const mute = this.micCtx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(this.micCtx.destination);
    this._micNode = node;
  }

  _onMicFrame(float32) {
    if (!this.connected) return;
    const down = resample(float32, this.micCtx.sampleRate, IN_RATE);
    // accumulate ~100ms chunks before sending
    const merged = new Float32Array(this._pcmBuf.length + down.length);
    merged.set(this._pcmBuf); merged.set(down, this._pcmBuf.length);
    this._pcmBuf = merged;
    const chunkLen = Math.floor(IN_RATE * 0.1);
    while (this._pcmBuf.length >= chunkLen) {
      const chunk = this._pcmBuf.subarray(0, chunkLen);
      this._pcmBuf = this._pcmBuf.subarray(chunkLen);
      this._send({ realtimeInput: { audio: { data: b64encode(new Uint8Array(floatToPcm16(chunk).buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
    }
  }

  // ---- playback ----
  async _startPlayback() {
    this.playCtx = new AudioContext();
    this.outAnalyser = this.playCtx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outAnalyser.connect(this.playCtx.destination);
    this._levelBuf = new Float32Array(this.outAnalyser.fftSize);
    this._nextPlay = this.playCtx.currentTime;
  }

  _playChunk(b64) {
    const pcm = new Int16Array(b64decode(b64).buffer);
    const buf = this.playCtx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outAnalyser);
    const start = Math.max(this.playCtx.currentTime + 0.02, this._nextPlay);
    src.start(start);
    this._nextPlay = start + buf.duration;
    this._sources.add(src);
    src.onended = () => this._sources.delete(src);
  }

  _flushPlayback() {
    for (const s of this._sources) { try { s.stop(); } catch { } }
    this._sources.clear();
    this._nextPlay = this.playCtx.currentTime;
  }

  outputLevel() {
    if (!this.outAnalyser || !this.speaking) return 0;
    this.outAnalyser.getFloatTimeDomainData(this._levelBuf);
    let s = 0;
    for (let i = 0; i < this._levelBuf.length; i++) s += this._levelBuf[i] ** 2;
    return Math.sqrt(s / this._levelBuf.length);
  }

  // ---- control ----
  // Cut Hinata off mid-sentence because the app is about to play its own
  // audio (a pre-recorded line, a song). Stops what is queued and drops the
  // rest of the current model turn, so two Hinata voices never overlap.
  hush() {
    if (!this.playCtx) return;
    this._flushPlayback();
    if (this._inTurn) this._hushed = true;
  }

  sendText(text) {
    this._send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }

  sendToolResponse(id, name, response) {
    this._send({ toolResponse: { functionResponses: [{ id, name, response }] } });
  }

  disconnect() {
    this.connected = false;
    try { this.ws?.close(); } catch { }
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch { }
    try { this._micNode?.disconnect(); } catch { }
    try { this.micCtx?.close(); } catch { }
    this._flushPlayback();
    try { this.playCtx?.close(); } catch { }
  }
}
