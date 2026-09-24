import { CATEGORIES, type Category } from './categories';

/**
 * The two-level taxonomy. Top level is the strip a reader moves along; the
 * second level is a set of lenses over whatever that level returned, never a
 * partition — a story is allowed to sit under two lenses at once.
 *
 * Nothing here is stored. Scope categories are derived from columns the cluster
 * already carries (place_id, country) and topic sub-categories are derived from
 * the text, so the taxonomy can be reshaped without a migration or a re-summarise.
 * On top of those declared lenses, dynamicSubs offers the running stories the
 * summariser named in clusters.topic - the one part that is stored.
 */

/** Kebab-case of the display name; this is the URL segment and the ?sub= value. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export type SubCategory = { name: string; slug: string; keywords: readonly string[] };

export type ScopeSlug = 'top' | 'latest' | 'national' | 'international';

/**
 * The subjects that get a top-level pill, in strip order.
 *
 * Four of the stored categories are missing on purpose: Governance,
 * Crime & Courts, Disasters & Accidents and Conflict & Diplomacy classify
 * sharply - without them 269 of the old India/World rows would fall back to
 * Others - but a reader meets them as subject pills under Trending, National
 * and International rather than as fourteen entries in one strip.
 */
export const STRIP_SUBJECTS = [
  'Technology', 'Politics', 'Business', 'Science', 'Health',
  'Education', 'Sports', 'Entertainment', 'Climate', 'Others',
] as const satisfies readonly Category[];

export type StripSubject = (typeof STRIP_SUBJECTS)[number];

export type Section =
  | { kind: 'scope'; name: string; slug: ScopeSlug; subs: null }
  | { kind: 'topic'; name: Category; slug: string; subs: SubCategory[] };

/** The only shape the matchers need. Story satisfies it structurally. */
export type Matchable = {
  headline: string; crux: string | null; category: string;
  /** The summariser's running-story label. See dynamicSubs. */
  topic?: string | null;
  /** Which scope lenses this story falls under, resolved against the reader's
   *  country and places by the Worker - see scopesFor in worker/lib/world.ts.
   *  Absent on rows that were never scoped, which simply show no scope pill. */
  scopes?: readonly string[];
};

/**
 * Offered under every subject section: the other axis, as the sub-row rule has
 * it. Empty keyword lists because these are not matched against text - the
 * Worker resolves them from c.country and c.place_id, which every row carries.
 *
 * Slug 'unplaced' rather than 'others' so a ?sub= value can never be confused
 * with the Others *subject*.
 */
export const SCOPE_SUBS: readonly SubCategory[] = [
  { name: 'Local', slug: 'local', keywords: [] },
  { name: 'National', slug: 'national', keywords: [] },
  { name: 'International', slug: 'international', keywords: [] },
  { name: 'Others', slug: 'unplaced', keywords: [] },
];

const SCOPE_SUB_SLUGS = new Set(SCOPE_SUBS.map((s) => s.slug));

export type SubCount = { name: string; slug: string; count: number };

/** How many topic pills a scope category shows before the strip stops helping. */
const SCOPE_SUB_LIMIT = 5;

/**
 * Dynamic sub-pills: a topic label needs this many stories on the page to earn
 * a pill, and a section shows at most this many of them. Two is a pair, not a
 * running story; more than five and the strip is a tag cloud.
 */
const TOPIC_MIN = 3;
const TOPIC_LIMIT = 5;

const sub = (name: string, keywords: readonly string[]): SubCategory =>
  ({ name, slug: slug(name), keywords });

/**
 * Keyword lists live beside the taxonomy because they ARE the taxonomy: with no
 * topic tags on a cluster, the list is the only definition a sub-category has.
 * Every list below was measured against the store; a sub whose hit count was in
 * single digits against a large parent, or whose keywords described a writing
 * style rather than a subject, was cut rather than shipped thin.
 */
const TOPIC_SUBS: Record<StripSubject, SubCategory[]> = {
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
  Education: [
    sub('Schools', ['school', 'schools', 'pupil', 'pupils', 'classroom', 'teacher', 'teachers', 'headteacher', 'syllabus', 'textbook', 'midday meal', 'rte', 'cbse', 'icse', 'board exam']),
    sub('Higher Education', ['university', 'universities', 'college', 'colleges', 'iit', 'iim', 'nit', 'campus', 'undergraduate', 'postgraduate', 'phd', 'faculty', 'ugc', 'vtu', 'convocation', 'degree']),
    sub('Exams & Admissions', ['exam', 'exams', 'upsc', 'neet', 'jee', 'cat', 'gate', 'admission', 'admissions', 'entrance', 'counselling', 'cut-off', 'merit list', 'result', 'results', 'rank']),
    sub('Policy & Funding', ['education policy', 'nep', 'scholarship', 'scholarships', 'fee', 'fees', 'grant', 'grants', 'literacy', 'enrolment', 'dropout', 'reservation', 'quota']),
    sub('Research & Faculty', ['research', 'researchers', 'study', 'paper', 'journal', 'professor', 'lecturer', 'academic', 'thesis', 'laboratory', 'fellowship']),
  ],
  Climate: [
    sub('Warming & Emissions', ['warming', 'emissions', 'carbon', '1.5c', 'fossil', 'net zero', 'cop', 'greenhouse', 'temperature', 'air quality', 'sea-level']),
    sub('Extreme Weather', ['heat', 'heatwaves', 'wildfires', 'fire', 'fires', 'flood', 'flooding', 'storm', 'drought', 'el nino', 'haze', 'cyclone', 'hurricane']),
    sub('Nature & Adaptation', ['forest', 'forests', 'rewilding', 'habitat', 'conservation', 'biodiversity', 'tree', 'trees', 'wildlife', 'adaptation', 'risk assessment']),
  ],
  Others: [],
};

/**
 * Trending keeps the slug 'top': it is the section at `/`, and every stored
 * link and prerendered path says so. Only the label changed.
 *
 * Local is no longer one of these. It is a scope sub-pill under every subject
 * now, which is a lens over rows the section already holds rather than a
 * fourteenth query; /local remains its own route against /api/local.
 */
export const SCOPE_CATEGORIES: Section[] = [
  { kind: 'scope', name: 'Trending', slug: 'top', subs: null },
  // The one section with no ranking in it: newest first, whatever the subject
  // and wherever it happened. Trending answers "what matters"; this answers
  // "what just landed", which on a half-hourly cycle is a different question.
  { kind: 'scope', name: 'Latest', slug: 'latest', subs: null },
  { kind: 'scope', name: 'National', slug: 'national', subs: null },
  { kind: 'scope', name: 'International', slug: 'international', subs: null },
];

export const TOPIC_CATEGORIES: Section[] = STRIP_SUBJECTS.map((name) => ({
  kind: 'topic' as const, name, slug: slug(name), subs: TOPIC_SUBS[name],
}));

// STRIP_SUBJECTS leads with Technology because it renders second, ahead of the
// two scope tabs; the rest follow in declared order.
const [TECHNOLOGY, ...REST_OF_SUBJECTS] = TOPIC_CATEGORIES;

/** Declared order is render order. */
export const TAXONOMY: Section[] = [
  SCOPE_CATEGORIES[0], SCOPE_CATEGORIES[1], TECHNOLOGY,
  ...SCOPE_CATEGORIES.slice(2), ...REST_OF_SUBJECTS,
];

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

/**
 * The story's topic as a sub slug, or null. A label whose slug is a scope pill's
 * ("Local") would shadow that pill, so it is dropped rather than renamed.
 */
function topicSlug(s: Matchable): string | null {
  const t = s.topic ? slug(s.topic) : '';
  return t && !SCOPE_SUB_SLUGS.has(t) ? t : null;
}

/**
 * True when the story falls under this sub-category of this topic section.
 * A curated sub also takes the stories the model labelled with its exact name,
 * so "Cricket" from the summariser and the cricket keywords land in one pill.
 */
export function matchesSub(sectionSlug: string, subSlug: string, s: Matchable): boolean {
  const re = MATCHERS.get(`${sectionSlug}/${subSlug}`);
  return (re ? re.test(searchText(s)) : false) || topicSlug(s) === subSlug;
}

/**
 * The running stories on this page, busiest first: topic labels carried by at
 * least TOPIC_MIN rows. Nothing is declared - a pill appears when the news
 * does and goes when it moves on. A label that names a curated sub is left to
 * that sub, which already counts it.
 */
function dynamicSubs(cat: Section, stories: readonly Matchable[]): SubCount[] {
  const curated = new Set((cat.subs ?? []).map((s) => s.slug));
  const seen = new Map<string, SubCount>();
  for (const s of stories) {
    const t = topicSlug(s);
    if (!t || curated.has(t)) continue;
    const hit = seen.get(t);
    if (hit) hit.count++;
    else seen.set(t, { name: s.topic!.trim(), slug: t, count: 1 });
  }
  return [...seen.values()]
    .filter((s) => s.count >= TOPIC_MIN)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOPIC_LIMIT);
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
  // The other axis first: where these happened, before what they are about.
  for (const sc of SCOPE_SUBS) {
    let count = 0;
    for (const s of stories) if (s.scopes?.includes(sc.slug)) count++;
    if (count > 0) out.push({ name: sc.name, slug: sc.slug, count });
  }
  // Then what the news is about this hour, ahead of the standing lenses.
  out.push(...dynamicSubs(cat, stories));
  for (const s of cat.subs) {
    const re = MATCHERS.get(`${cat.slug}/${s.slug}`);
    if (!re) continue;
    let count = 0;
    stories.forEach((st, i) => { if (re.test(texts[i]) || topicSlug(st) === s.slug) count++; });
    if (count > 0) out.push({ name: s.name, slug: s.slug, count });
  }
  return out;
}

/** The rows behind one pill, taken from the same array the counts came from. */
/**
 * Which of a section's sub-categories this one story belongs to.
 *
 * The same verdict `filterBySub` reaches, computed per story instead of per
 * sub, so the answer can travel with the row and a reader switching subs is
 * filtering an array they already hold rather than asking for one.
 */
export function subSlugsFor(categorySlug: string, story: Matchable): string[] {
  const cat = categoryBySlug(categorySlug);
  if (!cat) return [];
  if (cat.kind === 'scope') return [slug(story.category)];
  const text = searchText(story);
  const t = topicSlug(story);
  const curated = (cat.subs ?? [])
    .filter((sub) => MATCHERS.get(`${cat.slug}/${sub.slug}`)?.test(text) || sub.slug === t)
    .map((sub) => sub.slug);
  // The topic slug travels whether or not it earned a pill: the client only
  // filters by slugs the section offers, so an unoffered one is inert.
  return [...new Set([...(story.scopes ?? []), ...curated, ...(t ? [t] : [])])];
}

export function filterBySub<T extends Matchable>(
  categorySlug: string, subSlug: string, stories: readonly T[],
): T[] {
  const cat = categoryBySlug(categorySlug);
  if (!cat) return [...stories];
  if (cat.kind === 'scope') {
    const name = CATEGORIES.find((c) => slug(c) === subSlug);
    return name ? stories.filter((s) => s.category === name) : [...stories];
  }
  if (SCOPE_SUB_SLUGS.has(subSlug)) return stories.filter((s) => s.scopes?.includes(subSlug));
  return stories.filter((s) => matchesSub(cat.slug, subSlug, s));
}
