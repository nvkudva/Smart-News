import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const UA = 'Mozilla/5.0 (compatible; SmartNewsBot/1.0)';
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': UA } });

const C: [string, string][] = [
  ['HN frontpage',     'https://news.ycombinator.com/rss'],
  ['HN 100+ points',   'https://hnrss.org/frontpage?points=100'],
  ['HN best',          'https://hnrss.org/best'],
  ['YC blog',          'https://www.ycombinator.com/blog/rss'],
  ['Techmeme',         'https://www.techmeme.com/feed.xml'],
  ['404 Media',        'https://www.404media.co/rss/'],
  ['Platformer',       'https://www.platformer.news/rss/'],
  ['Simon Willison',   'https://simonwillison.net/atom/everything/'],
  ['IEEE Spectrum',    'https://spectrum.ieee.org/feeds/feed.rss'],
  ['ZDNet',            'https://www.zdnet.com/news/rss.xml'],
  ['CNET',             'https://www.cnet.com/rss/news/'],
  ['Gizmodo',          'https://gizmodo.com/rss'],
  "Tom's Hardware,https://www.tomshardware.com/feeds/all".split(',') as [string, string],
  ['VentureBeat',      'https://venturebeat.com/feed/'],
  ['Slashdot',         'http://rss.slashdot.org/Slashdot/slashdotMain'],
  ['Techdirt',         'https://www.techdirt.com/feed/'],
  ['InfoQ',            'https://feed.infoq.com/'],
  ['SCMP Tech',        'https://www.scmp.com/rss/36/feed'],
  ['Semafor Tech',     'https://www.semafor.com/vertical/technology/rss.xml'],
  ['Hugging Face',     'https://huggingface.co/blog/feed.xml'],
  ['Google Research',  'https://research.google/blog/rss/'],
  ['OpenAI news',      'https://openai.com/news/rss.xml'],
  ['Anthropic news',   'https://www.anthropic.com/news/rss.xml'],
  ['Nikkei tech',      'https://asia.nikkei.com/rss/feed/business-technology'],
];

async function body(url: string) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(14000) });
    if (!res.ok) return -res.status;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return 0;
    const dom = new JSDOM(await res.text(), { url });
    const a = new Readability(dom.window.document).parse();
    const t = a?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    dom.window.close();
    return t.length;
  } catch { return 0; }
}

async function probe([name, url]: [string, string]) {
  try {
    const f = await parser.parseURL(url);
    const n = f.items?.length ?? 0;
    if (!n) return `${name.padEnd(16)} feed ok, 0 items`;
    const link = f.items[0].link ?? '';
    const host = (() => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return '?'; } })();
    const len = await body(link);
    const v = len > 240 ? `text ${len}` : len < 0 ? `HTTP ${-len}` : `NO TEXT`;
    return `${name.padEnd(16)} ${String(n).padStart(3)} items  ${v.padEnd(11)} first→ ${host}`;
  } catch (e) {
    return `${name.padEnd(16)} FAIL  ${String((e as Error).message).slice(0, 40)}`;
  }
}

async function main() { for (const l of await Promise.all(C.map(probe))) console.log(l); }
main();
