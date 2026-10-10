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
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { CONFIG } from './config.js';

const MODEL_URL = 'models/hinata.vrm';
// .vrma clips on the shared humanoid skeleton — work on any VRM model.
const ANIM_URLS = {
  wave: 'models/greet_wave.vrma',
  clapping: 'models/clapping.vrma',
  thinking: 'models/thinking.vrma',
  surprised: 'models/surprised.vrma',
  jump: 'models/jump.vrma',
  goodbye: 'models/goodbye.vrma',
  // hello.vrma is authored facing away (hips yaw ~170° for the whole clip),
  // so Hinata turned her back on grandma — 'hello' plays the wave clip instead.
  greeting2: 'models/greeting2.vrma',
  spin: 'models/spin.vrma',
  peace_sign: 'models/peace_sign.vrma',
  model_pose: 'models/model_pose.vrma',
  look_around: 'models/look_around.vrma',
};
// App mood names → VRM 1.0 expression presets (weights).
const MOOD_EXPR = {
  normal: {},
  // 0.5 keeps the eyes open — the VRoid 'happy' preset squeezes them shut
  // past ~0.6; relaxed adds a soft mouth smile.
  happy: { happy: 0.5, relaxed: 0.3 },
  sad: { sad: 1 },
  worried: { sad: 0.6 },
  pout: { angry: 1 },
  scared: { surprised: 0.6, sad: 0.5 },
  surprised: { surprised: 1 },
};
const EXPR_KEYS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];

// みんなの体操 (NHK's seated senior routine) — each move loops on a slow
// rep cycle; rZ/lZ are deltas added to the rest arm rotations (negative
// raises the right arm, positive raises the left). ~80 s total.
const EXERCISE_MOVES = [
  { key: 'breath',  label: '① しんこきゅう — うでをあげて', vi: '① Hít thở sâu — giơ tay lên', secs: 10 },
  { key: 'chest',   label: '② むねをはって',               vi: '② Ưỡn ngực',                  secs: 10 },
  { key: 'lean',    label: '③ よこにかたむく',             vi: '③ Nghiêng người sang bên',    secs: 14 },
  { key: 'twist',   label: '④ からだをひねる',             vi: '④ Vặn người',                 secs: 14 },
  { key: 'arms',    label: '⑤ うでをまわす',               vi: '⑤ Xoay tay',                  secs: 12 },
  { key: 'stretch', label: '⑥ おおきくのび',               vi: '⑥ Vươn vai thật cao',         secs: 10 },
  { key: 'breath',  label: '⑦ しんこきゅう — おわり',       vi: '⑦ Hít thở sâu — xong rồi',    secs: 10 },
];

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
    this.leftArmBone = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    this.forearmBone = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
    this.leftForearmBone = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
    this.chestBone = vrm.humanoid?.getNormalizedBoneNode('chest')
      || vrm.humanoid?.getNormalizedBoneNode('spine');
    // natural rest pose: arms hang down instead of the model's T-pose
    this._restR = 1.45; this._restL = -1.45;
    if (this.armBone) this.armBone.rotation.z = this._restR;
    if (this.leftArmBone) this.leftArmBone.rotation.z = this._restL;
    this._waveUntil = 0;   // procedural wave fallback end time
    this._animAction = null;
    this._animUntil = 0;
    // .vrma clips — procedural bone animation stays as fallback per clip
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.clips = {};
    await Promise.all(Object.entries(ANIM_URLS).map(async ([name, url]) => {
      try {
        const animGltf = await new GLTFLoader()
          .register(parser => new VRMAnimationLoaderPlugin(parser))
          .loadAsync(url);
        const vrmAnim = animGltf.userData.vrmAnimations?.[0];
        if (vrmAnim) this.clips[name] = createVRMAnimationClip(vrmAnim, vrm);
      } catch (e) {
        console.warn(`[avatar] clip ${name} unavailable:`, e.message || e);
      }
    }));
    console.log('[avatar] clips loaded:', Object.keys(this.clips).join(',') || 'none');
    this.camera.position.set(hp.x, hp.y + 0.05, hp.z + 2.7);
    this.camera.lookAt(hp.x, hp.y - 0.02, hp.z);
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
  waveHello(ms = 2400) {
    const pool = ['wave', 'greeting2'].filter(n => this.clips[n]);
    if (pool.length) { this.playAnim(pool[Math.floor(Math.random() * pool.length)]); return; }
    this._waveUntil = performance.now() + ms;
  }
  celebrate() { this.playAnim('clapping'); }
  // みんなの体操 routine — procedural move sequence so grandma can
  // follow along (no taisou .vrma clip needed)
  exercise(on = true, ms = 80000) {
    this._exerciseUntil = on ? performance.now() + ms : 0;
    this._exStart = performance.now();
    if (!this._exLabel) {
      this._exLabel = document.createElement('div');
      this._exLabel.className = 'exlabel';
      this.stage.appendChild(this._exLabel);
    }
  }

  // Bone targets for the current move (deltas on top of the rest pose).
  _exercisePose(now, t) {
    let el = (now - this._exStart) / 1000, move = EXERCISE_MOVES[0];
    for (const m of EXERCISE_MOVES) { if (el < m.secs) { move = m; break; } el -= m.secs; }
    if (this._exMove !== move && this._exLabel) {
      this._exMove = move;
      this._exLabel.textContent = (CONFIG.lang === 'vi' && move.vi) || move.label;
    }
    const s4 = 0.5 + 0.5 * Math.sin(t * Math.PI / 2);          // 4 s rep
    const s3 = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 3);      // 3 s rep
    const p = { rZ: 0, lZ: 0, rF: 0, lF: 0, rY: 0, lY: 0, spZ: 0, spY: 0, headX: 0, headY: 0 };
    switch (move.key) {
      case 'breath':   // 深呼吸 — arms rise overhead, lower
        p.rZ = -1.55 * s4; p.lZ = 1.55 * s4; p.headX = -0.1 * s4; break;
      case 'chest':    // 胸をはる — arms half-out, elbows pull back
        p.rZ = -0.55 - 0.45 * s3; p.lZ = 0.55 + 0.45 * s3;
        p.rF = -0.4 * s3; p.lF = 0.4 * s3; break;
      case 'lean': {   // 横にかたむく — alternate side every 5 s, opposite arm over head
        const side = Math.floor(t / 5) % 2 ? -1 : 1;
        const bend = Math.sin(((t % 5) / 5) * Math.PI);
        p.spZ = side * bend * 0.22;
        if (side > 0) { p.rZ = -1.7 * bend; p.lZ = 0.5 * bend; }
        else          { p.lZ = 1.7 * bend;  p.rZ = -0.5 * bend; }
        break;
      }
      case 'twist':    // ひねる — forearms folded in front, torso twists L/R
        p.rZ = -0.95; p.lZ = 0.95; p.rF = -1.35; p.lF = 1.35;
        p.spY = Math.sin(t * Math.PI / 2) * 0.3;
        p.headY = p.spY * 0.5; break;
      case 'arms':     // うでまわし — arms out, swing fwd/back like circles
        p.rZ = -1.3; p.lZ = 1.3;
        p.rY = Math.sin(t * Math.PI) * 0.55; p.lY = -Math.sin(t * Math.PI) * 0.55;
        break;
      case 'stretch':  // のび — both arms high, gentle sway, head up
        p.rZ = -1.7 + 0.07 * Math.sin(t * 3);
        p.lZ = 1.7 - 0.07 * Math.sin(t * 3);
        p.headX = -0.14; break;
    }
    return p;
  }
  playAnim(name) {
    if (name === 'hello') name = 'wave';
    if (name === 'exercise') { this.mixer.stopAllAction(); this.exercise(true); return; }
    const clip = this.clips[name];
    if (!clip) { if (name === 'wave') this._waveUntil = performance.now() + 2400; return; }
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce);
    action.clampWhenFinished = true;
    action.reset().fadeIn(0.15).play();
    this._animAction = action;
    this._animUntil = performance.now() + clip.duration * 1000;
  }
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
      this.headBone.rotation.x = Math.sin(t * 0.53 + 1) * (standby ? 0.1 : 0.05) + (standby ? 0.12 : 0)
        + (now < (this._dozeUntil || 0) ? 0.55 : 0); // dozing off: head droops
    }
    // animation clip drives the bones while playing; fade out at the end and
    // hand control back to the procedural pose below
    if (this._animAction && now >= this._animUntil) {
      const act = this._animAction;
      act.fadeOut(0.4);
      this._animAction = null;
      setTimeout(() => act.stop(), 450);
    }
    this.mixer?.update(dt);
    const animBusy = Boolean(this._animAction);
    const waving = !animBusy && now < this._waveUntil; // bone fallback only
    // exercise routine: run the みんなの体操 move sequence
    const exercising = !animBusy && !standby && now < this._exerciseUntil;
    const ex = exercising ? this._exercisePose(now, t) : null;
    if (this._exLabel) this._exLabel.style.display = exercising ? '' : 'none';

    // ---- idle fun: while awake and not busy, do a random action every 18-38 s ----
    // (look around, spin, pose, jump — plus two procedural gags: side-step
    // walk and nodding off)
    if (!standby && !animBusy && !exercising && this.state !== 'calling') {
      if (!this._nextFunAt) this._nextFunAt = now + 12000;
      if (now > this._nextFunAt) {
        this._nextFunAt = now + 18000 + Math.random() * 20000;
        const pool = ['look_around', 'spin', 'peace_sign', 'model_pose', 'jump']
          .filter(n => this.clips[n]);
        pool.push('steps', 'doze');
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick === 'steps') this._stepsUntil = now + 5000;
        else if (pick === 'doze') this._dozeUntil = now + 4000;
        else this.playAnim(pick);
      }
    }
    // うろうろ walk: drift the model left-right for a few seconds
    this.vrm.scene.position.x = now < (this._stepsUntil || 0) ? Math.sin(t * 1.8) * 0.35 : 0;
    if (this.armBone && !animBusy) {
      // hello wave: upper arm out to the side + slight forward swing;
      // calling wave or rest at the side otherwise
      const targetZ = ex ? this._restR + ex.rZ
        : waving ? -1.55 + Math.sin(t * 3) * 0.05
        : this.state === 'calling' ? -1.1 + Math.sin(t * 5) * 0.35
        : this._restR;
      this.armBone.rotation.z += (targetZ - this.armBone.rotation.z) * Math.min(1, dt * (ex ? 8 : waving ? 10 : 5));
      const targetY = ex ? ex.rY : waving ? Math.sin(t * 8) * 0.2 : 0;
      this.armBone.rotation.y += (targetY - this.armBone.rotation.y) * Math.min(1, dt * 10);
    }
    if (this.forearmBone && !animBusy) {
      // elbow bent ~90° so the forearm stands up beside the head;
      // the hand rocks side to side like the reference wave gif
      const targetZ = ex ? ex.rF : waving ? -2.1 + Math.sin(t * 8) * 0.3 : 0;
      this.forearmBone.rotation.z += (targetZ - this.forearmBone.rotation.z) * Math.min(1, dt * 10);
    }
    if (this.leftArmBone && !animBusy) {
      const targetZ = ex ? this._restL + ex.lZ : this._restL;
      this.leftArmBone.rotation.z += (targetZ - this.leftArmBone.rotation.z) * Math.min(1, dt * (ex ? 8 : 5));
      const targetY = ex ? ex.lY : 0;
      this.leftArmBone.rotation.y += (targetY - this.leftArmBone.rotation.y) * Math.min(1, dt * 10);
    }
    if (this.leftForearmBone && !animBusy) {
      const targetZ = ex ? ex.lF : 0;
      this.leftForearmBone.rotation.z += (targetZ - this.leftForearmBone.rotation.z) * Math.min(1, dt * 10);
    }
    if (this.chestBone && !animBusy) {
      const tZ = ex ? ex.spZ : 0, tY = ex ? ex.spY : 0;
      this.chestBone.rotation.z += (tZ - this.chestBone.rotation.z) * Math.min(1, dt * 6);
      this.chestBone.rotation.y += (tY - this.chestBone.rotation.y) * Math.min(1, dt * 6);
    }
    if (ex && this.headBone) {
      this.headBone.rotation.x += ex.headX;
      this.headBone.rotation.y += ex.headY;
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
  waveHello(ms) { this._active.waveHello?.(ms); }
  playAnim(n) { this._active.playAnim?.(n); }
  exercise(on, ms) { this._active.exercise?.(on, ms); }
  celebrate() { this._active.celebrate?.() || this._active.playAnim?.('clapping'); }
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
