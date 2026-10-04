// Avatar renderer: 3 characters (Hinata photo-expression set, drawn Hinata, Koharu
// the dog), 7 moods, lip-sync driven by an external level, blinking, sleep, waving.
// Visual states: active | standby | calling.

const MOOD_FACE = { normal: 'vui', happy: 'vui', sad: 'buon', worried: 'lolang', pout: 'hon', scared: 'sohai', surprised: 'ngacnhien' };
const FACES = {
  vui:       { mouth: { cx: 250.5, cy: 250, rx: 36, ry: 24, style: 'smile', w: [9, 19], h: [5, 22] } },
  buon:      { mouth: { cx: 247.5, cy: 251, rx: 22, ry: 12, style: 'frown', w: [7, 13], h: [3, 13] } },
  lolang:    { mouth: null },
  hon:       { mouth: { cx: 255, cy: 248, rx: 28, ry: 16, style: 'frown', w: [7, 13], h: [3, 13] } },
  sohai:     { mouth: { cx: 250, cy: 252, rx: 33, ry: 18, style: 'frown', w: [10, 18], h: [4, 16] } },
  ngacnhien: { mouth: { cx: 233.5, cy: 255, rx: 22, ry: 22, style: 'round', w: [6, 12], h: [7, 16] } },
};

export class Avatar {
  constructor({ stage, bubble, statusText, dot }) {
    this.stage = stage;
    this.bubble = bubble;
    this.statusText = statusText;
    this.dot = dot;
    this.state = 'active';
    this.mood = 'normal';
    this.mouth = 0;
    this.speaking = false;
    this.speakUntil = 0;
    this.lastLoud = 0;
    this.audioCtx = null;
    this.charKey = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._scheduleBlink();
  }

  // Load the big expression-set SVG (webp faces) into `container` and register it
  // as character 'photo'. Returns false when the asset can't be fetched.
  async loadPhotoAvatar(container, url = 'assets/hinata-avatar.svg') {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
      const svg = doc.documentElement;
      svg.setAttribute('id', 'photo');
      svg.setAttribute('class', 'koharu char');
      svg.dataset.mouth = 'photo';
      svg.style.display = 'none';
      container.appendChild(document.importNode(svg, true));
      return true;
    } catch {
      return false;
    }
  }

  bindChar(key) {
    const target = document.getElementById(key);
    if (!target) return false;
    this.charKey = key;
    document.querySelectorAll('svg.char').forEach(el => { el.style.display = el.id === key ? 'block' : 'none'; });
    this.svg = target;
    this.eyes = target.querySelector('.eyes-open');
    this.hole = target.querySelector('.mouth-hole');
    this.tongue = target.querySelector('.mouth-tongue');
    this.pm = target.dataset.mouth === 'photo' ? {
      fill: target.querySelector('.pm-fill'), clip: target.querySelector('.pm-clip'),
      cover: target.querySelector('.pm-cover'), line: target.querySelector('.pm-line'),
      teeth: target.querySelector('.pm-teeth'), tongue: target.querySelector('.pm-tongue'),
    } : null;
    document.querySelectorAll('#charBtns button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.char === key)));
    this.applyClasses();
    return true;
  }

  setMood(m) {
    this.mood = m;
    document.querySelectorAll('#moodBtns button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.mood === m)));
    this.applyClasses();
  }

  setState(s) {
    this.state = s;
    this.applyClasses();
  }

  applyClasses() {
    const { svg, state, mood } = this;
    if (!svg) return;
    document.querySelectorAll('svg.char').forEach(el =>
      el.classList.remove('sleep', 'happy', 'worried', 'waving'));
    svg.classList.toggle('sleep', state === 'standby');
    svg.classList.toggle('happy', state !== 'standby' && mood === 'happy');
    svg.classList.toggle('worried', state !== 'standby' && ['sad', 'worried', 'pout', 'scared'].includes(mood));
    if (this.pm) this._setFace();
    svg.classList.toggle('waving', state === 'calling');
    this.stage.classList.toggle('night', state === 'standby');
    this.dot.className = 'dot' + (state === 'standby' ? ' standby' : state === 'calling' ? ' calling' : '');
    this.statusText.textContent = state === 'active' ? 'おはなし中' :
      state === 'standby' ? 'おやすみ中（待機）' : 'おばあちゃんを呼んでいます…';
  }

  // Show a line in the speech bubble and mark the avatar "speaking" for the
  // synthetic mouth animation (used when there is no real audio stream).
  say(text, { est } = {}) {
    this.bubble.textContent = text;
    this.bubble.classList.remove('hidden');
    this.speaking = true;
    this.speakUntil = performance.now() + (est || Math.max(1500, text.length * 170));
  }

  hideBubble() {
    this.bubble.classList.add('hidden');
    this.speaking = false;
  }

  ensureAudio() {
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.audioCtx = new AC();
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
    return this.audioCtx;
  }

  chime(loud = false) {
    const ctx = this.ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    [[784, 0], [659, 0.28]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + d);
      g.gain.linearRampToValueAtTime(loud ? 0.25 : 0.12, now + d + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + d + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(now + d); o.stop(now + d + 1);
    });
  }

  // level: 0..1 real mouth target (playback RMS). When the avatar is "speaking"
  // without a real stream (fallback), a synthetic wave is used instead.
  frame(now, level, externalTalking = false) {
    if (this.speaking && now > this.speakUntil + 400 && !externalTalking) this.speaking = false;
    let target = 0;
    if ((this.speaking || externalTalking) && this.state !== 'standby') {
      target = externalTalking
        ? Math.min(1, level * 2.2)
        : 0.35 + 0.65 * Math.abs(Math.sin(now / 75)) * (0.6 + 0.4 * Math.random());
    }
    this.mouth += (target - this.mouth) * 0.35;
    const m = this.mouth < 0.04 ? 0 : this.mouth;
    const talking = (this.speaking || externalTalking) && this.state !== 'standby';
    if (this.pm) {
      if (level > 0.05) this.lastLoud = now;
      this._photoMouth(m, talking || now - this.lastLoud < 350);
    } else if (this.hole) {
      this.hole.setAttribute('ry', (m * 17).toFixed(2));
      this.hole.setAttribute('rx', (12 + m * 6).toFixed(2));
      this.tongue.setAttribute('ry', (m * 7).toFixed(2));
      this.tongue.setAttribute('cy', (+this.tongue.dataset.cy + m * 9).toFixed(2));
    }
  }

  _setFace() {
    this.faceKey = this.state === 'standby' ? 'vui' : (MOOD_FACE[this.mood] || 'vui');
    Object.keys(FACES).forEach(k => this.svg.classList.toggle('f-' + k, k === this.faceKey));
    const f = FACES[this.faceKey].mouth;
    if (f) {
      this.pm.cover.setAttribute('cx', f.cx);
      this.pm.cover.setAttribute('cy', f.cy);
      this.pm.cover.setAttribute('rx', f.rx);
      this.pm.cover.setAttribute('ry', f.ry);
    }
  }

  _hideMouth() {
    this.pm.cover.style.display = 'none';
    ['fill', 'clip', 'line'].forEach(k => this.pm[k].setAttribute('d', ''));
    this.pm.teeth.setAttribute('height', '0');
    this.pm.tongue.setAttribute('ry', '0');
  }

  _photoMouth(m, talking) {
    const pm = this.pm;
    const F = FACES[this.faceKey], f = F.mouth;
    this.svg.classList.toggle('talkbob', !f && talking && this.state !== 'standby');
    if (this.state === 'standby') {
      const v = FACES.vui.mouth;
      this._hideMouth();
      pm.cover.style.display = '';
      pm.line.setAttribute('d', `M${v.cx - 11} ${v.cy - 3} Q${v.cx} ${v.cy + 5} ${v.cx + 11} ${v.cy - 3}`);
      return;
    }
    const active = f && (talking || (this.mood === 'normal' && this.faceKey === 'vui'));
    if (!active) { this._hideMouth(); return; }
    pm.cover.style.display = '';
    const k = talking ? 0.2 + m * 0.8 : 0.2;
    const w = f.w[0] + (f.w[1] - f.w[0]) * k, h = f.h[0] + (f.h[1] - f.h[0]) * k;
    let d, top;
    if (f.style === 'round') {
      top = f.cy - h / 2;
      d = `M${f.cx - w} ${f.cy} A${w} ${h / 2} 0 1 1 ${f.cx + w} ${f.cy} A${w} ${h / 2} 0 1 1 ${f.cx - w} ${f.cy} Z`;
    } else if (f.style === 'smile') {
      const lift = 2.5 + k;
      top = f.cy - h / 2;
      d = `M${f.cx - w} ${top - lift} Q${f.cx} ${top + 2.5} ${f.cx + w} ${top - lift} ` +
          `Q${f.cx + w * 0.8} ${top + h} ${f.cx} ${top + h} Q${f.cx - w * 0.8} ${top + h} ${f.cx - w} ${top - lift} Z`;
    } else {
      const y0 = f.cy + h * 0.35;
      top = f.cy - h * 0.65;
      d = `M${f.cx - w} ${y0} Q${f.cx} ${top - h * 0.55} ${f.cx + w} ${y0} ` +
          `Q${f.cx} ${y0 + h * 0.35} ${f.cx - w} ${y0} Z`;
    }
    ['fill', 'clip', 'line'].forEach(key => pm[key].setAttribute('d', d));
    const teeth = (f.style !== 'round' && k > 0.45) ? 2.5 + (k - 0.45) * 4 : 0;
    pm.teeth.setAttribute('y', (top - 6).toFixed(1));
    pm.teeth.setAttribute('height', teeth ? (teeth + 6).toFixed(1) : '0');
    pm.tongue.setAttribute('cx', f.cx);
    pm.tongue.setAttribute('cy', (top + h - 1).toFixed(1));
    pm.tongue.setAttribute('rx', (w * 0.6).toFixed(1));
    pm.tongue.setAttribute('ry', (h * 0.28).toFixed(1));
  }

  _scheduleBlink() {
    setTimeout(() => {
      if (!this.reduced && this.eyes) {
        this.eyes.classList.add('blink');
        this.svg.classList.add('blinking');
        setTimeout(() => {
          this.eyes?.classList.remove('blink');
          this.svg?.classList.remove('blinking');
        }, 130);
      }
      this._scheduleBlink();
    }, 2200 + Math.random() * 3800);
  }
}
