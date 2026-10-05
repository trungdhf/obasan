// NHK public RSS — no API key. Top domestic headlines for the tablet,
// cached briefly so repeated asks don't hammer the feed.

const FEED = process.env.NEWS_FEED || 'https://www3.nhk.or.jp/rss/news/cat0.xml'; // 主要ニュース
const REFRESH_MS = 5 * 60_000;
const MAX_ITEMS = 5;

let cache = { headlines: [], updatedAt: 0, error: null };

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, '').trim() : '';
};

async function refresh() {
  try {
    const res = await fetch(FEED);
    if (!res.ok) throw new Error(`NHK RSS ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(m => tag(m[1], 'title'))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    cache = { headlines: items, updatedAt: Date.now(), error: null };
  } catch (e) {
    cache.error = e.message;
  }
}

export async function getNews() {
  if (Date.now() - cache.updatedAt > REFRESH_MS || cache.error) await refresh();
  return {
    headlines: cache.headlines,
    summary: cache.headlines.length
      ? cache.headlines.map((h, i) => `${i + 1}ばんめ: ${h}`).join('。')
      : 'ニュースがとれなかったよ…',
    updatedAt: cache.updatedAt,
  };
}
