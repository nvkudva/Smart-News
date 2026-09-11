import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const UA = 'Mozilla/5.0 (compatible; SmartNewsBot/1.0)';
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': UA } });

const C: [string, string][] = [
  // --- AI ---
  ['DeepMind',        'https://deepmind.google/blog/rss.xml'],
  ['Meta AI',         'https://ai.meta.com/blog/rss/'],
  ['The Decoder',     'https://the-decoder.com/feed/'],
  ['AI News',         'https://www.artificialintelligence-news.com/feed/'],
  ['The Batch',       'https://www.deeplearning.ai/the-batch/feed/'],
  ['Import AI',       'https://importai.substack.com/feed'],
  ['VentureBeat AI',  'https://venturebeat.com/category/ai/feed/'],
  ['Ars AI',          'https://arstechnica.com/ai/feed/'],
  ['MarkTechPost',    'https://www.marktechpost.com/feed/'],
  ['Berkeley BAIR',   'https://bair.berkeley.edu/blog/feed.xml'],
  // --- startups / VC ---
  ['TC Startups',     'https://techcrunch.com/category/startups/feed/'],
  ['TC Venture',      'https://techcrunch.com/category/venture/feed/'],
  ['Crunchbase News', 'https://news.crunchbase.com/feed/'],
  ['Sifted',          'https://sifted.eu/feed'],
  ['Entrackr',        'https://entrackr.com/feed/'],
  ['Inc42',           'https://inc42.com/feed/'],
  ['YourStory',       'https://yourstory.com/feed'],
  ['EU-Startups',     'https://www.eu-startups.com/feed/'],
  ['Tech.eu',         'https://tech.eu/feed/'],
  ['PitchBook',       'https://pitchbook.com/news/rss'],
  ['Axios',           'https://api.axios.com/feed/'],
  ['TechInAsia',      'https://www.techinasia.com/feed'],
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
    const len = await body(f.items[0].link ?? '');
    const v = len > 240 ? `text ${len}` : len < 0 ? `HTTP ${-len}` : 'NO TEXT';
    return `${name.padEnd(16)} ${String(n).padStart(3)} items  ${v}`;
  } catch (e) {
    return `${name.padEnd(16)} FAIL  ${String((e as Error).message).slice(0, 40)}`;
  }
}

async function main() { for (const l of await Promise.all(C.map(probe))) console.log(l); }
main();
