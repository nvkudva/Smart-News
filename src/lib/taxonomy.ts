import { CATEGORIES, type Category } from './db';

/**
 * The two-level taxonomy. Top level is the strip a reader moves along; the
 * second level is a set of lenses over whatever that level returned, never a
 * partition — a story is allowed to sit under two lenses at once.
 *
 * Nothing here is stored. Scope categories are derived from columns the cluster
 * already carries (place_id, country) and topic sub-categories are derived from
 * the text, so the taxonomy can be reshaped without a migration or a re-summarise.
 */

/** Kebab-case of the display name; this is the URL segment and the ?sub= value. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export type SubCategory = { name: string; slug: string; keywords: readonly string[] };

export type ScopeSlug = 'top' | 'local' | 'national' | 'international';

export type Section =
  | { kind: 'scope'; name: string; slug: ScopeSlug; subs: null }
  | { kind: 'topic'; name: Category; slug: string; subs: SubCategory[] };

/** The only shape the matchers need. Story satisfies it structurally. */
export type Matchable = { headline: string; crux: string | null; category: string };

export type SubCount = { name: string; slug: string; count: number };

/** How many topic pills a scope category shows before the strip stops helping. */
const SCOPE_SUB_LIMIT = 5;

const sub = (name: string, keywords: readonly string[]): SubCategory =>
  ({ name, slug: slug(name), keywords });

/**
 * Keyword lists live beside the taxonomy because they ARE the taxonomy: with no
 * topic tags on a cluster, the list is the only definition a sub-category has.
 * Every list below was measured against the store; a sub whose hit count was in
 * single digits against a large parent, or whose keywords described a writing
 * style rather than a subject, was cut rather than shipped thin.
 */
const TOPIC_SUBS: Record<Category, SubCategory[]> = {
  India: [
    sub('Governance', ['minister', 'chief minister', 'cm', 'centre', 'ministry', 'scheme', 'cabinet', 'govt', 'government', 'policy', 'panchayat', 'municipal', 'mcd', 'commission', 'board']),
    sub('Crime & Policing', ['arrested', 'arrest', 'police', 'murder', 'killed', 'kills', 'assault', 'rape', 'fraud', 'scam', 'gang', 'gangster', 'booked', 'fir', 'cbi', 'accused', 'probe', 'crime']),
    sub('Accidents & Safety', ['collapse', 'fire', 'crash', 'drowned', 'died', 'die', 'dead', 'injured', 'blast', 'explosion', 'rescued', 'stampede', 'accident', 'safety']),
    sub('Courts & Law', ['supreme court', 'high court', 'hc', 'sc', 'bench', 'plea', 'petition', 'verdict', 'bail', 'judge', 'judicial', 'tribunal', 'court', 'custody', 'remand']),
    sub('Transport', ['flight', 'flights', 'airport', 'indigo', 'air india', 'rail', 'railway', 'train', 'metro', 'highway', 'bus', 'road', 'traffic', 'vehicle', 'airline', 'expressway']),
    sub('Weather & Floods', ['flood', 'floods', 'rain', 'rains', 'monsoon', 'cyclone', 'heatwave', 'waterlogging', 'landslide', 'imd', 'weather']),
  ],
  World: [
    sub('Conflict', ['israel', 'gaza', 'lebanon', 'hezbollah', 'hamas', 'ukraine', 'russia', 'russian', 'putin', 'yemen', 'houthi', 'iran', 'airstrike', 'strikes', 'military', 'troops', 'war', 'ceasefire', 'missile', 'drone', 'nato', 'soldiers', 'rebels', 'militant']),
    sub('Crime & Courts', ['trial', 'court', 'sentenced', 'murder', 'murdering', 'police', 'arrested', 'charged', 'jail', 'prison', 'fraud', 'smuggling', 'cocaine', 'extortion', 'convicted', 'inquest', 'verdict', 'pirate', 'attacks']),
    sub('Disasters', ['crash', 'crashes', 'flood', 'floods', 'earthquake', 'eruption', 'volcano', 'wildfire', 'fire', 'cyclone', 'typhoon', 'landslide', 'storm', 'rescued', 'rescuers', 'killed', 'dead', 'death toll', 'collapse', 'evacuated', 'missing']),
    sub('Diplomacy', ['un', 'united nations', 'eu', 'european union', 'summit', 'envoy', 'talks', 'treaty', 'ambassador', 'sanctions', 'diplomatic', 'foreign minister', 'embassy', 'visit', 'pact', 'accord']),
  ],
  Sports: [
    sub('Football', ['football', 'premier league', 'chelsea', 'arsenal', 'united', 'liverpool', 'uefa', 'fifa', 'la liga', 'serie a', 'psg', 'goal', 'goals', 'striker', 'midfielder', 'isl', 'derby', 'fc', 'wsl', 'draw', 'marseille', 'monaco', 'keeper', 'bagan']),
    sub('American Sports', ['nfl', 'quarterback', 'touchdown', 'college football', 'cfp', 'big ten', 'ncaa', 'rams', 'braves', 'giants', 'notre dame', 'mlb', 'nba', 'homer', 'fantasy football', 'yards']),
    sub('Combat Sports', ['boxing', 'boxer', 'ufc', 'mma', 'wrestling', 'wrestler', 'fury', 'usyk', 'joshua', 'knockout', 'powerlifter', 'deadlift', 'darts', 'title fight', 'undisputed', 'champion']),
    sub('Cricket', ['cricket', 'test', 'odi', 't20', 'ipl', 'bcci', 'wicket', 'wickets', 'batsman', 'batsmen', 'batter', 'bowler', 'bowlers', 'duleep', 'ranji', 'innings', 'century', 'kohli', 'wpl', 'asia cup', 'trophy', 'stumps', 'all-rounder', 'batting', 'bowling', 'runs', 'de villiers', 'misbah', 'mushtaq', 'pcb', 'sri lanka', 'bangladesh']),
    sub('Rugby & AFL', ['rugby', 'nrl', 'afl', 'aflw', 'wallabies', 'scrum', 'flyhalf', 'swans', 'crows', 'hawthorn', 'premiership']),
    sub('Motorsport', ['formula 1', 'f1', 'grand prix', 'nascar', 'motogp', 'tsunoda', 'audi', 'race', 'racing', 'circuit', 'driver']),
    sub('Olympics & Athletics', ['olympic', 'olympics', 'athletics', 'marathon', 'sprint', 'medal', 'world championship', 'commonwealth', 'chess', 'olympiad', 'swimming', 'hockey']),
    sub('Tennis', ['tennis', 'us open', 'wimbledon', 'french open', 'australian open', 'atp', 'wta', 'alcaraz', 'sabalenka', 'djokovic', 'sinner', 'quarterfinals', 'quarter-finals', 'shelton', 'townsend']),
  ],
  Technology: [
    sub('AI', ['ai', 'artificial intelligence', 'openai', 'chatgpt', 'llm', 'anthropic', 'chatbot', 'machine learning', 'gemini', 'copilot', 'agents', 'deep learning']),
    sub('Gadgets', ['iphone', 'apple', 'android', 'smartphone', 'laptop', 'pixel', 'samsung', 'galaxy', 'headphones', 'gadgets', 'macbook', 'foldable', 'earbuds', 'tablet', 'carplay', 'mac', 'watch']),
    sub('Security & Privacy', ['breach', 'hack', 'hacked', 'ransomware', 'malware', 'cyber', 'cybersecurity', 'phishing', 'vulnerability', 'leak', 'privacy', 'password', 'hackers']),
    sub('Platforms & Policy', ['meta', 'facebook', 'instagram', 'tiktok', 'social media', 'google', 'antitrust', 'lawsuit', 'sue', 'sues', 'regulation', 'copyright', 'ban', 'settles', 'court']),
    sub('Chips & Data Centres', ['chip', 'chips', 'semiconductor', 'nvidia', 'tsmc', 'data centre', 'data center', 'gpu', 'processor', 'memory', 'cloud']),
    sub('Crypto', ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'stablecoin', 'blockchain', 'token', 'tokens', 'coinbase', 'binance', 'defi', 'web3', 'wallet', 'mining', 'halving', 'sec approval', 'etf']),
    sub('Space & Satellites', ['isro', 'satellite', 'satellites', 'rocket', 'spacex', 'orbit', 'orbital', 'space', 'nasa']),
    sub('Cars & EVs', ['tesla', 'robotaxi', 'ev', 'evs', 'electric vehicle', 'car', 'cars', 'truck', 'driverless', 'autonomous', 'carplay', 'android auto', 'charging']),
  ],
  Entertainment: [
    sub('Indian Cinema', ['bollywood', 'tollywood', 'malayalam', 'tamil', 'telugu', 'kannada', 'hindi', 'actress', 'actor', 'box office', 'crore', 'mammootty', 'khan', 'kapoor', 'dutt', 'film', 'films']),
    sub('TV & Streaming', ['bigg boss', 'ott', 'series', 'netflix', 'prime video', 'season', 'episode', 'reality show', 'show', 'streaming', 'mediacorp', 'channel']),
    sub('Film Festivals', ['venice', 'cannes', 'festival', 'documentary', 'doc', 'premiere', 'premieres', 'director', 'screening', 'sundance', 'berlinale', 'san sebastian', 'deauville', 'unifrance']),
    sub('Music', ['singer', 'song', 'album', 'concert', 'music', 'band', 'rapper', 'tour', 'headline', 'folk']),
    sub('Books & Arts', ['book', 'books', 'author', 'novel', 'poet', 'art', 'theater', 'theatre', 'museum', 'exhibition', 'dance', 'bharatanatyam', 'literature']),
  ],
  Politics: [
    sub('Parties & Leaders', ['bjp', 'congress', 'aap', 'tmc', 'dmk', 'shiv sena', 'rahul gandhi', 'modi', 'party', 'mla', 'mlas', 'mp', 'leader', 'alliance', 'opposition', 'chief minister', 'nda']),
    sub('Elections', ['election', 'elections', 'poll', 'polls', 'vote', 'voters', 'ballot', 'constituency', 'candidate', 'campaign', 'electoral', 'by-election', 'seat-sharing']),
    sub('World Politics', ['trump', 'white house', 'republican', 'democrat', 'democratic', 'senate', 'governor', 'washington', 'afd', 'german', 'germany', 'chancellor', 'downing street', 'eu', 'canada', 'swedish', 'singapore', 'uk']),
    sub('Parliament & Assemblies', ['assembly', 'parliament', 'bill', 'legislation', 'session', 'amendment', 'speaker', 'lok sabha', 'rajya sabha', 'chancellor', 'budget']),
    sub('Protest & Rights', ['protest', 'protests', 'march', 'rally', 'strike', 'activists', 'rights', 'clashes', 'anti-migrant']),
    // Thin but real — ED raids are a recurring beat. The non-empty gate drops it
    // on quiet days, which is the behaviour we want rather than a dead pill.
    sub('Probes & Scandals', ['ed', 'raid', 'raids', 'probe', 'cbi', 'money laundering', 'summons', 'icac', 'inquiry', 'corruption', 'scandal']),
  ],
  Business: [
    sub('Companies & Jobs', ['company', 'companies', 'firm', 'firms', 'ceo', 'jobs', 'layoffs', 'workers', 'staff', 'merger', 'acquisition', 'profit', 'revenue', 'earnings', 'hiring', 'cut', 'cuts']),
    sub('Markets', ['sensex', 'nifty', 'stock', 'shares', 'market', 'markets', 'index', 'investor', 'investors', 'bond', 'yields', 'rupee', 'dollar', 'trading', 'ipo', 'ipos', 'listing']),
    sub('Economy', ['gdp', 'inflation', 'economy', 'economic', 'fed', 'rbi', 'budget', 'tax', 'deficit', 'unemployment', 'prices', 'fiscal', 'central bank', 'reserves', 'pension', 'house prices', 'housing', 'mortgage']),
    sub('Crypto', ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'stablecoin', 'blockchain', 'token', 'tokens', 'coinbase', 'binance', 'defi', 'web3', 'wallet', 'mining', 'halving', 'sec approval', 'etf']),
    sub('Energy & Commodities', ['oil', 'crude', 'opec', 'gas', 'energy', 'power', 'coal', 'solar', 'geothermal', 'gold', 'sugar', 'wheat', 'fuel']),
    sub('Trade & Tariffs', ['tariff', 'tariffs', 'trade', 'exports', 'imports', 'wto', 'supply chain', 'customs']),
  ],
  Science: [
    sub('Life Sciences', ['study', 'cells', 'protein', 'gene', 'dna', 'brain', 'cancer', 'immune', 'metabolic', 'microbe', 'bacteria', 'virus', 'neural', 'clinical', 'health']),
    sub('Earth Sciences', ['earthquake', 'volcano', 'ocean', 'climate', 'forest', 'carbon', 'geology', 'seismic', 'glacier', 'soil', 'atmosphere', 'mantle', 'lava', 'core']),
    sub('Space & Astronomy', ['nasa', 'galaxy', 'nebula', 'star', 'stars', 'pulsar', 'black hole', 'telescope', 'planet', 'moon', 'mars', 'spacecraft', 'astronomy', 'cosmic', 'dark matter', 'isro', 'orbit', 'mercury']),
    sub('Animals & Wildlife', ['species', 'bird', 'birds', 'fish', 'shark', 'frog', 'whale', 'insect', 'wildlife', 'animals', 'salmon', 'narwhals', 'habitat', 'cheetah']),
    sub('Archaeology', ['archaeology', 'fossil', 'ancient', 'excavation', 'artefacts', 'prehistoric', 'cave', 'arrowheads', 'remains', 'tomb', 'folklore']),
    sub('Physics & Materials', ['physics', 'quantum', 'atom', 'atoms', 'particle', 'laser', 'magnet', 'materials', 'alloy', 'copper', 'superconductor', 'crystal', 'pressure', 'emission']),
  ],
  Health: [
    sub('Conditions & Treatment', ['cancer', 'diabetes', 'disease', 'patient', 'patients', 'treatment', 'symptoms', 'therapy', 'drug', 'surgery', 'diagnosis', 'study', 'risk']),
    sub('Nutrition', ['diet', 'food', 'nutrition', 'fibre', 'fiber', 'sugar', 'protein', 'vitamin', 'ghee', 'alcohol', 'supplement', 'weight', 'eating']),
    sub('Hospitals & Care', ['hospital', 'hospitals', 'nhs', 'doctors', 'nurse', 'clinic', 'maternity', 'ambulance', 'care', 'guidelines', 'fda']),
    sub('Mental Health', ['mental', 'anxiety', 'depression', 'adhd', 'burnout', 'stress', 'cognition', 'sleep']),
  ],
  Climate: [
    sub('Warming & Emissions', ['warming', 'emissions', 'carbon', '1.5c', 'fossil', 'net zero', 'cop', 'greenhouse', 'temperature', 'air quality', 'sea-level']),
    sub('Extreme Weather', ['heat', 'heatwaves', 'wildfires', 'fire', 'fires', 'flood', 'flooding', 'storm', 'drought', 'el nino', 'haze', 'cyclone', 'hurricane']),
    sub('Nature & Adaptation', ['forest', 'forests', 'rewilding', 'habitat', 'conservation', 'biodiversity', 'tree', 'trees', 'wildlife', 'adaptation', 'risk assessment']),
  ],
};

/** Scope first, then the ten topics in their stored order. */
export const SCOPE_CATEGORIES: Section[] = [
  { kind: 'scope', name: 'Top', slug: 'top', subs: null },
  { kind: 'scope', name: 'Local', slug: 'local', subs: null },
  { kind: 'scope', name: 'National', slug: 'national', subs: null },
  { kind: 'scope', name: 'International', slug: 'international', subs: null },
];

export const TOPIC_CATEGORIES: Section[] = CATEGORIES.map((name) => ({
  kind: 'topic' as const, name, slug: slug(name), subs: TOPIC_SUBS[name],
}));

/** Declared order is render order: scope first, then the ten topics. */
export const TAXONOMY: Section[] = [...SCOPE_CATEGORIES, ...TOPIC_CATEGORIES];

export function categoryBySlug(s: string): Section | null {
  return TAXONOMY.find((c) => c.slug === s) ?? null;
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/**
 * Word-boundary matching, not substring. This is load-bearing: a substring test
 * makes "ed" match "detained", "fir" match "first" and "ai" match "said", which
 * took Politics/Probes from 5 real hits to 49 false ones. \b will not do either
 * — keywords like "1.5c" and "all-rounder" start and end on characters \b reads
 * as boundaries mid-token, so the guards are explicit character classes.
 */
function matcher(keywords: readonly string[]): RegExp {
  const alts = keywords.map((k) => k.replace(ESCAPE, '\\$&')).join('|');
  return new RegExp('(?:^|[^a-z0-9])(?:' + alts + ')(?![a-z0-9])', 'i');
}

// Built once per sub-category, not once per story: the strip runs every matcher
// over every row in the section on each render.
const MATCHERS = new Map<string, RegExp>();
for (const c of TOPIC_CATEGORIES) {
  if (!c.subs) continue;
  for (const s of c.subs) MATCHERS.set(`${c.slug}/${s.slug}`, matcher(s.keywords));
}

export function searchText(s: Matchable): string {
  return `${s.headline} ${s.crux ?? ''}`.toLowerCase();
}

/** True when the story falls under this sub-category of this topic section. */
export function matchesSub(sectionSlug: string, subSlug: string, s: Matchable): boolean {
  const re = MATCHERS.get(`${sectionSlug}/${subSlug}`);
  return re ? re.test(searchText(s)) : false;
}

/**
 * The non-empty gate. One pass over the rows the page is already rendering —
 * never a second query per sub — returning only the populated sub-categories in
 * declared order. A scope category's subs are the ten topic categories counted
 * off `cluster.category`, so they need no keyword maintenance and can never go
 * stale.
 */
export function subCategoriesFor(categorySlug: string, stories: readonly Matchable[]): SubCount[] {
  const cat = categoryBySlug(categorySlug);
  if (!cat) return [];

  if (cat.kind === 'scope') {
    const seen = new Map<string, number>();
    for (const s of stories) seen.set(s.category, (seen.get(s.category) ?? 0) + 1);
    const present = CATEGORIES
      .map((name) => ({ name, slug: slug(name), count: seen.get(name) ?? 0 }))
      .filter((s) => s.count > 0);
    // A scope's subs are the ten topics, and on a busy day nine of them qualify —
    // a second strip as long as the first, saying the same words. The thinnest
    // are dropped by count, then declared order is restored so the pills keep
    // their places instead of reshuffling as the feed moves under them.
    const keep = new Set(
      [...present].sort((a, b) => b.count - a.count).slice(0, SCOPE_SUB_LIMIT).map((s) => s.slug),
    );
    return present.filter((s) => keep.has(s.slug));
  }

  const texts = stories.map(searchText);
  const out: SubCount[] = [];
  for (const s of cat.subs) {
    const re = MATCHERS.get(`${cat.slug}/${s.slug}`);
    if (!re) continue;
    let count = 0;
    for (const t of texts) if (re.test(t)) count++;
    if (count > 0) out.push({ name: s.name, slug: s.slug, count });
  }
  return out;
}

/** The rows behind one pill, taken from the same array the counts came from. */
export function filterBySub<T extends Matchable>(
  categorySlug: string, subSlug: string, stories: readonly T[],
): T[] {
  const cat = categoryBySlug(categorySlug);
  if (!cat) return [...stories];
  if (cat.kind === 'scope') {
    const name = CATEGORIES.find((c) => slug(c) === subSlug);
    return name ? stories.filter((s) => s.category === name) : [...stories];
  }
  const re = MATCHERS.get(`${cat.slug}/${subSlug}`);
  return re ? stories.filter((s) => re.test(searchText(s))) : [...stories];
}

/** Section-object spellings of the two helpers above, for callers that already
 *  hold the resolved category and should not have to round-trip through a slug. */
export const SECTIONS = TAXONOMY;
export const sectionBySlug = categoryBySlug;
export const visibleSubs = (section: Section, stories: readonly Matchable[]): SubCount[] =>
  subCategoriesFor(section.slug, stories);
