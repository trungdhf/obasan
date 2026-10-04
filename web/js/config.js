// Client defaults; /api/config from the backend overrides these at boot.
export const CONFIG = {
  idleToStandbySec: 45,     // no face for this long → standby (Live session closed)
  callAttempts: 3,          // proactive-call tries before alerting the family
  callIntervalMs: 9000,
  facePollMs: 250,          // MediaPipe detection cadence
  faceAbsentGraceMs: 1500,  // flicker tolerance before counting "away"
  char: 'photo',            // 'photo' (Hinata expressions) | 'hinata' | 'koharu'
  demo: false,              // forced true when backend reports no Gemini key
};

export function loadConfig(serverCfg = {}) {
  if (serverCfg.idleToStandbySec) CONFIG.idleToStandbySec = serverCfg.idleToStandbySec;
  if (serverCfg.callAttempts) CONFIG.callAttempts = serverCfg.callAttempts;
  if (serverCfg.demo) CONFIG.demo = true;
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1') CONFIG.demo = true;
  if (q.get('char')) CONFIG.char = q.get('char');
  if (q.get('idle')) CONFIG.idleToStandbySec = Number(q.get('idle')) || CONFIG.idleToStandbySec;
  return CONFIG;
}
