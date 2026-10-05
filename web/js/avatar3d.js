// 3D VRM avatar (three.js + @pixiv/three-vrm via CDN import map).
// Same interface as the SVG Avatar (state/mood/say/frame/chime) plus:
// real blendshape lip-sync (aa/ih/ou), blinking, look-at wander, head sway,
// arm wave while calling, VRM expression moods, eyes-closed standby.
// Swap the model by replacing web/models/hinata.vrm — a VRoid Studio export
// works out of the box; VRM 0.x models are auto-rotated to face the camera.
//
// HybridAvatar owns BOTH renderers: the character buttons can switch between
// the 3D model ('vrm') and any SVG char at runtime; if the VRM fails to load
// (no WebGL, missing file, offline CDN) it silently stays on the SVG avatar.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const MODEL_URL = 'models/hinata.vrm';
// App mood names → VRM 1.0 expression presets (weights).
const MOOD_EXPR = {
  normal: {},
  happy: { happy: 1 },
  sad: { sad: 1 },
  worried: { sad: 0.6 },
  pout: { angry: 1 },
  scared: { surprised: 0.6, sad: 0.5 },
  surprised: { surprised: 1 },
};
const EXPR_KEYS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];

class VrmAvatar {
  constructor({ stage, bubble, statusText, dot }) {
    this.stage = stage; this.bubble = bubble;
    this.statusText = statusText; this.dot = dot;
    this.state = 'active'; this.mood = 'normal';
    this.speaking = false; this.speakUntil = 0;
    this.mouth = 0; this.charKey = 'vrm';
    this.audioCtx = null;
    this._expr = {};        // current expression weights (lerped)
    this._exprT = {};       // targets
    this._blink = 0; this._blinkT = 0; this._nextBlink = 0;
    this._look = { x: 0, y: 0 };
    this._prevT = 0;
  }

  async init(url = MODEL_URL) {
    const canvas = document.createElement('canvas');
    canvas.className = 'vrm-canvas';
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) {
      throw new Error('WebGL unavailable: ' + e.message);
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.stage.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9db8d9, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 2, 1.5);
    this.scene.add(key);

    const gltf = await new GLTFLoader()
      .register(parser => new VRMLoaderPlugin(parser))
      .loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('not a VRM file');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineMorphs(vrm);
    if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
    this.vrm = vrm;
    this.scene.add(vrm.scene);

    // Camera: bust shot framed on the head bone.
    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    const hp = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.3, 0);
    this.headBone = head;
    this.armBone = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    this.camera.position.set(hp.x, hp.y - 0.05, hp.z + 1.5);
    this.camera.lookAt(hp.x, hp.y - 0.15, hp.z);
    this.lookTarget = new THREE.Object3D();
    this.lookTarget.position.copy(hp).add(new THREE.Vector3(0, 0, 0.5));
    this.scene.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

    this._resize();
    new ResizeObserver(() => this._resize()).observe(this.stage);
    this.sleepEl = document.createElement('div');
    this.sleepEl.className = 'vrm-sleep hidden';
    this.sleepEl.textContent = 'z z Z';
    this.stage.appendChild(this.sleepEl);
    this.applyClasses();
    return this;
  }

  _resize() {
    const w = this.stage.clientWidth || 400, h = this.stage.clientHeight || 440;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  bindChar() { return true; }
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

  setMood(m) {
    this.mood = m;
    document.querySelectorAll('#moodBtns button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.mood === m)));
    this._exprT = MOOD_EXPR[m] || {};
    this.applyClasses();
  }
  setState(s) { this.state = s; this.applyClasses(); }
  say(text, { est } = {}) {
    this.bubble.textContent = text;
    this.bubble.classList.remove('hidden');
    this.speaking = true;
    this.speakUntil = performance.now() + (est || Math.max(1500, text.length * 170));
  }
  hideBubble() { this.bubble.classList.add('hidden'); this.speaking = false; }

  applyClasses() {
    this.stage.classList.toggle('night', this.state === 'standby');
    this.dot.className = 'dot' + (this.state === 'standby' ? ' standby' : this.state === 'calling' ? ' calling' : '');
    this.statusText.textContent = this.state === 'active' ? 'おはなし中'
      : this.state === 'standby' ? 'おやすみ中' : '呼びかけ中…';
    this.sleepEl?.classList.toggle('hidden', this.state !== 'standby');
  }

  frame(now, level, externalTalking = false) {
    if (!this.vrm) return;
    const dt = Math.min(0.1, (now - this._prevT) / 1000 || 0.016);
    this._prevT = now;
    const t = now / 1000;
    const em = this.vrm.expressionManager;
    const standby = this.state === 'standby';

    // ---- mouth (viseme) ----
    if (this.speaking && now > this.speakUntil + 400 && !externalTalking) this.speaking = false;
    let target = 0;
    if ((this.speaking || externalTalking) && !standby) {
      target = externalTalking
        ? Math.min(1, level * 2.2)
        : 0.35 + 0.65 * Math.abs(Math.sin(now / 75)) * (0.6 + 0.4 * Math.random());
    }
    this.mouth += (target - this.mouth) * Math.min(1, dt * 18);
    const m = this.mouth;
    em?.setValue('aa', m * 0.9);
    em?.setValue('ih', m * 0.35 * (0.5 + 0.5 * Math.sin(t * 9)));
    em?.setValue('ou', m * 0.25 * (0.5 + 0.5 * Math.cos(t * 7)));

    // ---- blink ----
    if (standby) { this._blinkT = 1; }
    else if (now > this._nextBlink) {
      this._blinkT = 1;
      setTimeout(() => { this._blinkT = 0; }, 110);
      this._nextBlink = now + 2400 + Math.random() * 3600;
    }
    this._blink += (this._blinkT - this._blink) * Math.min(1, dt * 20);
    em?.setValue('blink', this._blink);

    // ---- mood expressions (lerp) ----
    for (const k of EXPR_KEYS) {
      const tgt = standby ? (k === 'relaxed' ? 0.4 : 0) : (this._exprT[k] || 0);
      this._expr[k] = (this._expr[k] || 0) + (tgt - (this._expr[k] || 0)) * Math.min(1, dt * 6);
      em?.setValue(k, this._expr[k]);
    }

    // ---- body motion ----
    if (this.headBone) {
      // gentle idle sway; wider look-around while calling
      const amp = this.state === 'calling' ? 0.28 : standby ? 0.04 : 0.1;
      this.headBone.rotation.y = Math.sin(t * 0.7) * amp;
      this.headBone.rotation.x = Math.sin(t * 0.53 + 1) * (standby ? 0.1 : 0.05) + (standby ? 0.12 : 0);
    }
    if (this.armBone) {
      // wave the raised arm while calling, otherwise let it rest
      const targetZ = this.state === 'calling' ? -1.1 + Math.sin(t * 5) * 0.35 : 0;
      this.armBone.rotation.z += (targetZ - this.armBone.rotation.z) * Math.min(1, dt * 5);
    }
    // look-at wander toward the camera area
    this._look.x = Math.sin(t * 0.4) * 0.12;
    this._look.y = Math.sin(t * 0.31 + 2) * 0.04;
    if (this.lookTarget && this.headBone) {
      const hp = this.headBone.getWorldPosition(new THREE.Vector3());
      this.lookTarget.position.set(hp.x + this._look.x, hp.y + this._look.y, hp.z + 0.5);
    }

    this.vrm.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  hide() { if (this.canvas) this.canvas.style.display = 'none'; }
  show() { if (this.canvas) this.canvas.style.display = ''; }
}

export class HybridAvatar {
  constructor(opts, svgAvatar, vrm) {
    this.svgAvatar = svgAvatar;
    this.vrm = vrm;
    this.stage = opts.stage; this.bubble = opts.bubble;
    this.statusText = opts.statusText; this.dot = opts.dot;
    this.state = 'active'; this.mood = 'normal';
    this.charKey = null;
    this._active = svgAvatar;
  }

  get speaking() { return this._active.speaking; }
  get mouth() { return this._active.mouth; }

  bindChar(key) {
    const useVrm = key === 'vrm' && this.vrm;
    this.charKey = key;
    this._active = useVrm ? this.vrm : this.svgAvatar;
    if (this.vrm) useVrm ? this.vrm.show() : this.vrm.hide();
    if (!useVrm) this.svgAvatar.bindChar(key);
    else document.querySelectorAll('svg.char').forEach(el => { el.style.display = 'none'; });
    document.querySelectorAll('#charBtns button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.char === key)));
    this._active.state = this.state;
    this._active.applyClasses?.();
    return true;
  }

  setMood(m) { this.mood = m; this.svgAvatar.setMood(m); this.vrm?.setMood(m); }
  setState(s) { this.state = s; this.svgAvatar.setState(s); this.vrm?.setState(s); }
  say(t, o) { this._active.say(t, o); }
  hideBubble() { this._active.hideBubble(); }
  ensureAudio() { return this._active.ensureAudio(); }
  chime(l) { this._active.chime(l); }
  frame(now, level, talking) {
    this._active.frame(now, level, talking);
  }
}

export async function createAvatar(opts) {
  const { Avatar } = await import('./avatar.js');
  const svg = new Avatar(opts);
  await svg.loadPhotoAvatar(opts.stage);
  let vrm = null;
  const want = new URLSearchParams(location.search).get('avatar') !== 'svg';
  if (want) {
    try {
      vrm = new VrmAvatar(opts);
      await vrm.init();
      // add the 3D character button once
      const btn = document.createElement('button');
      btn.dataset.char = 'vrm';
      btn.textContent = 'ひなた（3D）';
      document.getElementById('charBtns')?.prepend(btn);
      console.log('[avatar] VRM loaded');
    } catch (e) {
      console.warn('[avatar] VRM unavailable, staying on SVG:', e.message || e);
      vrm = null;
    }
  }
  const hybrid = new HybridAvatar(opts, svg, vrm);
  const key = vrm && want ? 'vrm' : (document.getElementById(opts.char) ? opts.char : 'koharu');
  hybrid.bindChar(key);
  return hybrid;
}
