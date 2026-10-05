// NHK public RSS — no API key. Top domestic headlines for the tablet,
// cached briefly so repeated asks don't hammer the feed.
// Each getNews() call returns the NEXT batch of 3 — pressing ニュース again
// walks through the feed instead of repeating the same headlines.

const FEED = process.env.NEWS_FEED || 'https://www3.nhk.or.jp/rss/news/cat0.xml'; // 主要ニュース
const REFRESH_MS = 5 * 60_000;
const MAX_ITEMS = 15;
const BATCH = 3;

let cache = { headlines: [], updatedAt: 0, error: null };
let cursor = 0;

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
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
    cursor = 0; // fresh feed → start from the top
  } catch (e) {
    cache.error = e.message;
  }
}

export async function getNews() {
  if (Date.now() - cache.updatedAt > REFRESH_MS || cache.error || !cache.headlines.length) await refresh();
  const items = cache.headlines;
  if (!items.length) {
    return { headlines: [], summary: 'ニュースがとれなかったよ…', updatedAt: cache.updatedAt, wrapped: true };
  }
  const batch = [];
  for (let i = 0; i < BATCH; i++) batch.push(items[(cursor + i) % items.length]);
  cursor = (cursor + BATCH) % items.length;
  const wrapped = cursor === 0; // looped back to the top — all headlines read
  return {
    headlines: batch,
    summary: batch.map((h, i) => `${i + 1}ばんめ: ${h}`).join('。')
      + (wrapped ? '。ニュースはいったんこれで全部だよ' : ''),
    updatedAt: cache.updatedAt,
    wrapped,
  };
}
