// Japan Meteorological Agency (気象庁) public feeds — no API key required.
// Fetches the area forecast + warnings on an interval. New warnings are
// surfaced so the backend can proactively call the tablet and have Hinata
// warn grandma unprompted — disaster info must not wait for a question.

const AREA = process.env.WEATHER_AREA || '130000';      // 東京都
const AREA_NAME = process.env.WEATHER_AREA_NAME || '';  // e.g. '東京地方'; '' = whole prefecture feed
const REFRESH_MS = Number(process.env.WEATHER_REFRESH_MS || 10 * 60_000);

const WARN_NAMES = {
  '02': '暴風雪警報', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報',
  '06': '大雪警報', '07': '波浪警報', '08': '高潮警報',
  '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報',
  '15': '強風注意報', '16': '波浪注意報', '17': '融雪注意報', '18': '洪水注意報',
  '19': '高潮注意報', '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報',
  '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報',
  '27': 'その他注意報', '29': '消火注意報',
  '32': '暴風雪特別警報', '33': '大雨特別警報', '34': '暴風特別警報',
  '35': '大雪特別警報', '36': '波浪特別警報', '37': '高潮特別警報',
  '38': '記録的短時間大雨情報', '39': '竜巻注意情報', '40': '高潮特別警報', '41': '洪水特別警報',
};
const SEVERE = new Set(['32', '33', '34', '35', '36', '37', '38', '40', '41']);
const WARNING = new Set(['02', '03', '04', '05', '06', '07', '08']);

let cache = { forecast: null, warnings: [], headline: '', updatedAt: 0, error: null };
let lastWarningKeys = new Set();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JMA ${res.status} ${url}`);
  return res.json();
}

function pickArea(areas) {
  if (!areas?.length) return null;
  if (AREA_NAME) return areas.find(a => a.area?.name === AREA_NAME || a.area?.code === AREA_NAME) || areas[0];
  return areas[0];
}

const squeeze = s => (s || '').replace(/\s+/g, '');

function parseForecast(doc) {
  const shortTerm = doc[0], weekly = doc[1];
  const days = [];
  // short-term: weathers/winds per timeDefine
  for (const ts of shortTerm?.timeSeries || []) {
    const a = pickArea(ts.areas);
    if (!a?.weathers) continue;
    ts.timeDefines.forEach((t, i) => days.push({
      at: t.slice(0, 10),
      weather: squeeze(a.weathers[i]),
      wind: squeeze(a.winds?.[i]),
    }));
    break;
  }
  // short-term pops (6h slots → keep the max per day)
  const pops = {};
  for (const ts of shortTerm?.timeSeries || []) {
    const a = pickArea(ts.areas);
    if (!a?.pops) continue;
    ts.timeDefines.forEach((t, i) => {
      const d = t.slice(0, 10);
      const p = Number(a.pops[i]);
      if (!Number.isNaN(p)) pops[d] = Math.max(pops[d] ?? -1, p);
    });
  }
  // weekly temps for the same named city area (first area = 都心でよい default)
  const temps = {};
  for (const ts of weekly?.timeSeries || []) {
    const a = pickArea(ts.areas);
    if (!a) continue;
    ts.timeDefines.forEach((t, i) => {
      const val = v => (v === '' || v == null ? null : v);
      temps[t.slice(0, 10)] = {
        min: val(a.tempsMin?.[i] ?? a.temps?.[i]),
        max: val(a.tempsMax?.[i]),
      };
    });
  }
  return { days, pops, temps, office: shortTerm?.publishingOffice || '気象庁' };
}

function parseWarnings(doc) {
  const out = [];
  for (const group of (doc.areaTypes || []).slice(0, 1)) { // regional level
    for (const a of group.areas || []) {
      if (AREA_NAME && a.name && a.name !== AREA_NAME && a.code !== AREA_NAME) continue;
      for (const w of a.warnings || []) {
        if (!w.code || w.status === '解除' || String(w.status || '').includes('なし')) continue;
        out.push({
          code: w.code,
          name: WARN_NAMES[w.code] || `気象情報${w.code}`,
          status: w.status || '',
          area: a.name || a.code,
          level: SEVERE.has(w.code) ? 'severe' : WARNING.has(w.code) ? 'warning' : 'advisory',
        });
      }
    }
  }
  return out;
}

export async function refreshWeather() {
  try {
    const [forecast, warnings] = await Promise.all([
      fetchJson(`https://www.jma.go.jp/bosai/forecast/data/forecast/${AREA}.json`),
      fetchJson(`https://www.jma.go.jp/bosai/warning/data/warning/${AREA}.json`),
    ]);
    cache = {
      forecast: parseForecast(forecast),
      warnings: parseWarnings(warnings),
      headline: warnings.headlineText || '',
      updatedAt: Date.now(),
      error: null,
    };
  } catch (e) {
    console.warn('[jma] refresh failed:', e.message);
    cache.error = e.message;
  }
  return cache;
}

// Forecast + alerts for the get_weather tool (Japanese summary ready to read aloud).
export function getWeather() {
  const f = cache.forecast;
  const alerts = cache.warnings;
  if (!f) return { ok: false, error: cache.error || 'weather not fetched yet', area: AREA };
  const [today, tomorrow] = f.days;
  const dayLabel = d => {
    const t = f.temps[d?.at];
    const bits = [`${d?.weather || '不明'}`];
    if (t?.max != null) bits.push(`最高${t.max}度`);
    if (t?.min != null) bits.push(`最低${t.min}度`);
    const p = f.pops[d?.at];
    if (p != null) bits.push(`降水確率${p}%`);
    return bits.join('、');
  };
  const alertText = alerts.length
    ? `警報・注意報: ${[...new Set(alerts.map(a => a.name))].join('、')}。${cache.headline}`
    : '警報・注意報は出ていません。';
  return {
    ok: true,
    area: AREA,
    office: f.office,
    summary: `今日は${dayLabel(today)}。明日は${dayLabel(tomorrow)}。${alertText}`,
    today: today && { ...today, temps: f.temps[today.at], pops: f.pops[today.at] },
    tomorrow: tomorrow && { ...tomorrow, temps: f.temps[tomorrow.at], pops: f.pops[tomorrow.at] },
    alerts,
    updatedAt: cache.updatedAt,
  };
}

export function getAlerts() {
  return {
    hasAlert: cache.warnings.length > 0,
    level: cache.warnings.some(a => a.level === 'severe') ? 'severe'
      : cache.warnings.some(a => a.level === 'warning') ? 'warning'
      : cache.warnings.length ? 'advisory' : 'none',
    title: cache.warnings.length ? [...new Set(cache.warnings.map(a => a.name))].join('・') : '',
    detail: cache.headline,
    alerts: cache.warnings,
    updatedAt: cache.updatedAt,
    source: '気象庁',
  };
}

// Returns warnings that are new since the last call (for proactive alerting).
export function drainNewWarnings() {
  const fresh = cache.warnings.filter(a =>
    (a.level === 'warning' || a.level === 'severe') && !lastWarningKeys.has(`${a.code}:${a.area}`));
  lastWarningKeys = new Set(cache.warnings.map(a => `${a.code}:${a.area}`));
  return fresh;
}

export function startWeatherLoop(onNewWarnings) {
  let first = true;
  const tick = async () => {
    await refreshWeather();
    const fresh = drainNewWarnings();
    if (first) { first = false; return; } // don't call for pre-existing warnings at boot
    if (fresh.length) onNewWarnings?.(fresh);
  };
  tick();
  const timer = setInterval(tick, REFRESH_MS);
  timer.unref?.();
  return timer;
}
