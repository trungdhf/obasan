// On-device presence detection with MediaPipe FaceDetector.
// Camera frames never leave the tablet — only "face present / absent" booleans
// are reported upward. Falls back to mic-loudness presence when the camera or
// the model can't load (offline demo).

import { CONFIG } from './config.js';

const VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export class Presence {
  constructor({ video, onFace, onMode }) {
    this.video = video;
    this.onFace = onFace;   // (faceDetected:boolean) => void, raw signal
    this.onMode = onMode;   // (mode:'camera'|'none', detail:string) => void
    this.mode = 'none';
    this.detector = null;
    this.timer = null;
  }

  async start() {
    try {
      const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      this.video.srcObject = stream;
      await this.video.play();
      this.detector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      });
      this.mode = 'camera';
      this.onMode?.('camera', '顔検出 オン');
      this.timer = setInterval(() => this._detect(), CONFIG.facePollMs);
      return true;
    } catch (e) {
      console.warn('[presence] camera/mediapipe unavailable:', e);
      this.mode = 'none';
      this.onMode?.('none', String(e.message || e));
      return false;
    }
  }

  _detect() {
    if (!this.detector || this.video.readyState < 2) return;
    try {
      const res = this.detector.detectForVideo(this.video, performance.now());
      this.onFace((res.detections?.length || 0) > 0);
    } catch { /* transient video-frame errors are fine to skip */ }
  }

  stop() {
    clearInterval(this.timer);
    this.video.srcObject?.getTracks().forEach(t => t.stop());
    this.mode = 'none';
  }
}
