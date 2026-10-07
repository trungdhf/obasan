// Vietnamese-mode data sources — used when the tablet runs ?lang=vi:
// Open-Meteo weather for Ho Chi Minh City (free, no API key) and
// VnExpress RSS headlines (same rotating-batch behaviour as the NHK feed).

const HCMC = { lat: 10.82, lon: 106.63, name: 'TP.HCM' };
const NEWS_FEED = process.env.NEWS_FEED_VI || 'https://vnexpress.net/rss/tin-moi-nhat.rss';
const REFRESH_MS = 5 * 60_000;
const MAX_ITEMS = 15;
const BATCH = 3;

const WMO = {
  0: 'trời quang', 1: 'ít mây', 2: 'có mây', 3: 'nhiều mây',
  45: 'sương mù', 48: 'sương mù',
  51: 'mưa phùn', 53: 'mưa phùn', 55: 'mưa phùn',
  61: 'mưa nhỏ', 63: 'mưa vừa', 65: 'mưa to',
  71: 'tuyết', 80: 'mưa rào', 81: 'mưa rào', 82: 'mưa rào to',
  95: 'dông', 96: 'dông có mưa đá', 99: 'dông có mưa đá',
};

let weatherCache = { data: null, updatedAt: 0, error: null };
let newsCache = { headlines: [], updatedAt: 0, error: null };
let cursor = 0;

export async function getWeatherVN() {
  if (Date.now() - weatherCache.updatedAt > REFRESH_MS || !weatherCache.data) {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${HCMC.lat}&longitude=${HCMC.lon}`
        + '&current=temperature_2m,weather_code'
        + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
        + '&timezone=Asia%2FBangkok&forecast_days=2';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const j = await res.json();
      const w = c => WMO[c] || 'thay đổi';
      weatherCache = {
        updatedAt: Date.now(), error: null,
        data: {
          now: { temp: j.current?.temperature_2m, weather: w(j.current?.weather_code) },
          today: {
            max: j.daily?.temperature_2m_max?.[0], min: j.daily?.temperature_2m_min?.[0],
            pops: j.daily?.precipitation_probability_max?.[0], weather: w(j.daily?.weather_code?.[0]),
          },
          tomorrow: {
            max: j.daily?.temperature_2m_max?.[1], min: j.daily?.temperature_2m_min?.[1],
            pops: j.daily?.precipitation_probability_max?.[1], weather: w(j.daily?.weather_code?.[1]),
          },
        },
      };
    } catch (e) {
      weatherCache.error = e.message;
    }
  }
  const d = weatherCache.data;
  if (!d) return { ok: false, error: weatherCache.error || 'weather not fetched yet', area: HCMC.name };
  const day = x => `${x.weather}, cao nhất ${Math.round(x.max)} độ, thấp nhất ${Math.round(x.min)} độ`
    + (x.pops != null ? `, khả năng mưa ${x.pops}%` : '');
  return {
    ok: true,
    area: HCMC.name,
    office: 'Open-Meteo',
    summary: `TP.HCM bây giờ ${Math.round(d.now.temp)} độ, ${d.now.weather}. Hôm nay ${day(d.today)}. Ngày mai ${day(d.tomorrow)}.`,
    today: d.today,
    tomorrow: d.tomorrow,
    alerts: [],
    updatedAt: weatherCache.updatedAt,
  };
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};

async function refreshNews() {
  try {
    const res = await fetch(NEWS_FEED);
    if (!res.ok) throw new Error(`VnExpress RSS ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(m => tag(m[1], 'title'))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    newsCache = { headlines: items, updatedAt: Date.now(), error: null };
    cursor = 0;
  } catch (e) {
    newsCache.error = e.message;
  }
}

export async function getNewsVN() {
  if (Date.now() - newsCache.updatedAt > REFRESH_MS || newsCache.error || !newsCache.headlines.length) await refreshNews();
  const items = newsCache.headlines;
  if (!items.length) {
    return { headlines: [], summary: 'Không lấy được tin tức…', updatedAt: newsCache.updatedAt, wrapped: true };
  }
  const batch = [];
  for (let i = 0; i < BATCH; i++) batch.push(items[(cursor + i) % items.length]);
  cursor = (cursor + BATCH) % items.length;
  const wrapped = cursor === 0;
  return {
    headlines: batch,
    summary: batch.map((h, i) => `Tin số ${i + 1}: ${h}`).join('. ')
      + (wrapped ? '. Tin tức hôm nay đến đây là hết' : ''),
    updatedAt: newsCache.updatedAt,
    wrapped,
  };
}
