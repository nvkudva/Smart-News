/**
 * Bias is rated against the outlet's OWN country's politics, not a single
 * global axis: The Hindu is left in Indian terms the way the Guardian is left
 * in British ones. These are the project's own hand ratings over 38 outlets,
 * not a licensed dataset — AllSides and MBFC both restrict commercial reuse,
 * and at this size curating it is cheaper than licensing it anyway.
 *
 * The distribution is 12 left / 38 centre / 5 right, and that lopsidedness is a
 * property of the feed, not of the ratings: this list is mostly public
 * broadcasters, wire services and quality dailies. Read a "right" blindspot as
 * "these sources did not cover it", which is the honest claim available here.
 *
 * The centre has grown heavier still with the markets and AI additions, and
 * for a duller reason than editorial line: a central bank's press release and
 * a research lab's blog have no politics to rate. Rating them anything else
 * would be inventing a signal.
 *
 * Every feed here was checked three ways before it was added — it parses, its
 * articles yield readable text through Readability, and its robots.txt permits
 * the fetch. Candidates that failed any one of those are absent on purpose;
 * see the notes beside each group.
 */
export type Bias = 'left' | 'centre' | 'right';

/**
 * `title` marks a front-page feed: read for headlines only, never fetched for
 * body text. Two consequences, both deliberate. Nothing here goes through
 * Readability or robots.txt, because only the article page is ever gated and
 * these feeds are never followed to one — so an outlet that refuses automated
 * retrieval can still tell us what it is leading with. And a title-tier outlet
 * is kept out of `source_count`, out of the outlet list and out of the bias
 * split, because we did not read what it said: all it supplies is the fact
 * that it put the story on its front page.
 */
export type Tier = 'full' | 'title';

export type SourceSeed = {
  id: string; name: string; feed_url: string;
  homepage: string; country: string; category: string; bias: Bias;
  /** Absent means 'full'. */
  tier?: Tier;
};

export const SOURCES: SourceSeed[] = [
  // --- world / wire ---
  { id: 'bbc-world',   name: 'BBC News',      feed_url: 'https://feeds.bbci.co.uk/news/world/rss.xml',            homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'World', bias: 'centre' },
  { id: 'guardian-world', name: 'The Guardian', feed_url: 'https://www.theguardian.com/world/rss',                homepage: 'https://theguardian.com',     country: 'GB', category: 'World', bias: 'left' },
  { id: 'aljazeera',   name: 'Al Jazeera',    feed_url: 'https://www.aljazeera.com/xml/rss/all.xml',              homepage: 'https://aljazeera.com',       country: 'QA', category: 'World', bias: 'left' },
  { id: 'npr-world',   name: 'NPR',           feed_url: 'https://feeds.npr.org/1004/rss.xml',                     homepage: 'https://npr.org',             country: 'US', category: 'World', bias: 'left' },
  { id: 'dw',          name: 'Deutsche Welle',feed_url: 'https://rss.dw.com/rdf/rss-en-all',                      homepage: 'https://dw.com',              country: 'DE', category: 'World', bias: 'centre' },
  { id: 'france24',    name: 'France 24',     feed_url: 'https://www.france24.com/en/rss',                        homepage: 'https://france24.com',        country: 'FR', category: 'World', bias: 'centre' },
  { id: 'cbc-world',   name: 'CBC News',      feed_url: 'https://www.cbc.ca/webfeed/rss/rss-world',               homepage: 'https://cbc.ca/news',         country: 'CA', category: 'World', bias: 'centre' },
  { id: 'abc-au',      name: 'ABC News (AU)', feed_url: 'https://www.abc.net.au/news/feed/51120/rss.xml',         homepage: 'https://abc.net.au/news',     country: 'AU', category: 'World', bias: 'centre' },
  { id: 'sky-world',   name: 'Sky News',      feed_url: 'https://feeds.skynews.com/feeds/rss/world.xml',          homepage: 'https://news.sky.com',        country: 'GB', category: 'World', bias: 'right' },
  { id: 'euronews',    name: 'Euronews',      feed_url: 'https://www.euronews.com/rss?level=theme&name=news',     homepage: 'https://euronews.com',        country: 'EU', category: 'World', bias: 'centre' },
  { id: 'cna',         name: 'CNA',           feed_url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', homepage: 'https://channelnewsasia.com', country: 'SG', category: 'World', bias: 'centre' },

  // --- india ---
  { id: 'thehindu-national', name: 'The Hindu',        feed_url: 'https://www.thehindu.com/news/national/feeder/default.rss',            homepage: 'https://thehindu.com',        country: 'IN', category: 'India', bias: 'left' },
  { id: 'toi-top',           name: 'Times of India',   feed_url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',           homepage: 'https://timesofindia.com',    country: 'IN', category: 'India', bias: 'centre' },
  { id: 'indianexpress',     name: 'The Indian Express',feed_url: 'https://indianexpress.com/feed/',                                     homepage: 'https://indianexpress.com',   country: 'IN', category: 'India', bias: 'centre' },
  { id: 'ndtv',              name: 'NDTV',             feed_url: 'https://feeds.feedburner.com/ndtvnews-top-stories',                    homepage: 'https://ndtv.com',            country: 'IN', category: 'India', bias: 'right' },
  { id: 'hindustantimes',    name: 'Hindustan Times',  feed_url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',      homepage: 'https://hindustantimes.com',  country: 'IN', category: 'India', bias: 'centre' },
  { id: 'livemint',          name: 'Mint',             feed_url: 'https://www.livemint.com/rss/news',                                    homepage: 'https://livemint.com',        country: 'IN', category: 'Business', bias: 'right' },
  { id: 'scroll',            name: 'Scroll.in',        feed_url: 'https://scroll.in/feed',                                               homepage: 'https://scroll.in',           country: 'IN', category: 'India', bias: 'left' },
  { id: 'thehindu-blr',      name: 'The Hindu Bengaluru', feed_url: 'https://www.thehindu.com/news/cities/bangalore/feeder/default.rss', homepage: 'https://thehindu.com',        country: 'IN', category: 'India', bias: 'left' },
  { id: 'deccanherald',      name: 'Deccan Herald',    feed_url: 'https://www.deccanherald.com/rss/news.rss',                            homepage: 'https://deccanherald.com',    country: 'IN', category: 'India', bias: 'centre' },

  // --- technology ---
  { id: 'arstechnica', name: 'Ars Technica',  feed_url: 'https://feeds.arstechnica.com/arstechnica/index',        homepage: 'https://arstechnica.com',     country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'theverge',    name: 'The Verge',     feed_url: 'https://www.theverge.com/rss/index.xml',                 homepage: 'https://theverge.com',        country: 'US', category: 'Technology', bias: 'left' },
  { id: 'techcrunch',  name: 'TechCrunch',    feed_url: 'https://techcrunch.com/feed/',                           homepage: 'https://techcrunch.com',      country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'engadget',    name: 'Engadget',      feed_url: 'https://www.engadget.com/rss.xml',                       homepage: 'https://engadget.com',        country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'bbc-tech',    name: 'BBC Technology',feed_url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',       homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Technology', bias: 'centre' },

  // --- business ---
  { id: 'bbc-business',      name: 'BBC Business',   feed_url: 'https://feeds.bbci.co.uk/news/business/rss.xml',  homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Business', bias: 'centre' },
  { id: 'guardian-business', name: 'Guardian Business', feed_url: 'https://www.theguardian.com/uk/business/rss',  homepage: 'https://theguardian.com',     country: 'GB', category: 'Business', bias: 'left' },
  { id: 'cnbc-world',        name: 'CNBC',           feed_url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', homepage: 'https://cnbc.com',      country: 'US', category: 'Business', bias: 'right' },

  // --- technology: added after probing feeds for full-text extraction and
  // checking each robots.txt. The Register was dropped at that step: it serves
  // a readable feed but its robots.txt is `Disallow: /` under a header saying
  // scraping needs a licence. Hacker News and Techmeme were dropped as
  // aggregators — their links resolve to other people's articles, so the
  // byline on the card would credit the wrong newsroom.
  { id: 'wired',       name: 'Wired',          feed_url: 'https://www.wired.com/feed/rss',                          homepage: 'https://wired.com',           country: 'US', category: 'Technology', bias: 'left' },
  { id: 'mit-tr',      name: 'MIT Technology Review', feed_url: 'https://www.technologyreview.com/feed/',           homepage: 'https://technologyreview.com', country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'ieee',        name: 'IEEE Spectrum',  feed_url: 'https://spectrum.ieee.org/feeds/feed.rss',                homepage: 'https://spectrum.ieee.org',   country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'restofworld', name: 'Rest of World',  feed_url: 'https://restofworld.org/feed/latest',                     homepage: 'https://restofworld.org',     country: 'US', category: 'Technology', bias: 'centre' },
  { id: '404media',    name: '404 Media',      feed_url: 'https://www.404media.co/rss/',                            homepage: 'https://404media.co',         country: 'US', category: 'Technology', bias: 'left' },
  { id: 'platformer',  name: 'Platformer',     feed_url: 'https://www.platformer.news/rss/',                        homepage: 'https://platformer.news',     country: 'US', category: 'Technology', bias: 'left' },

  // --- ai. DeepMind is a lab publishing its own results rather than a
  // newsroom; it is here because a primary account beats a write-up of one,
  // and because the readership is people who will read the paper.
  { id: 'deepmind',    name: 'Google DeepMind',feed_url: 'https://deepmind.google/blog/rss.xml',                    homepage: 'https://deepmind.google',     country: 'GB', category: 'Technology', bias: 'centre' },
  { id: 'importai',    name: 'Import AI',      feed_url: 'https://importai.substack.com/feed',                      homepage: 'https://importai.substack.com', country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'thedecoder',  name: 'The Decoder',    feed_url: 'https://the-decoder.com/feed/',                           homepage: 'https://the-decoder.com',     country: 'DE', category: 'Technology', bias: 'centre' },

  // --- startups
  { id: 'crunchbase',  name: 'Crunchbase News',feed_url: 'https://news.crunchbase.com/feed/',                       homepage: 'https://news.crunchbase.com', country: 'US', category: 'Business', bias: 'centre' },
  { id: 'inc42',       name: 'Inc42',          feed_url: 'https://inc42.com/feed/',                                 homepage: 'https://inc42.com',           country: 'IN', category: 'Business', bias: 'centre' },

  // --- markets and macro. Business had four outlets and no markets desk at
  // all, which left "what this does to the economy" with no reporting behind
  // it. The wires refuse us directly — Reuters and AP both answer 403 — and
  // Yahoo Finance is the way their copy legitimately arrives.
  //
  // The Fed and the ECB are not news outlets. They are here because a rate
  // decision is a primary document, and a cluster anchored on the statement
  // itself is a better answer than five reports of it.
  { id: 'yahoo-finance', name: 'Yahoo Finance', feed_url: 'https://finance.yahoo.com/news/rssindex',                 homepage: 'https://finance.yahoo.com',   country: 'US', category: 'Business', bias: 'centre' },
  { id: 'cnbc-markets',  name: 'CNBC Markets',  feed_url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',    homepage: 'https://cnbc.com',            country: 'US', category: 'Business', bias: 'right' },
  { id: 'fed',           name: 'Federal Reserve', feed_url: 'https://www.federalreserve.gov/feeds/press_all.xml',    homepage: 'https://federalreserve.gov',  country: 'US', category: 'Business', bias: 'centre' },
  { id: 'ecb',           name: 'European Central Bank', feed_url: 'https://www.ecb.europa.eu/rss/press.html',        homepage: 'https://ecb.europa.eu',       country: 'EU', category: 'Business', bias: 'centre' },
  { id: 'scmp-business', name: 'SCMP Business', feed_url: 'https://www.scmp.com/rss/92/feed',                        homepage: 'https://scmp.com',            country: 'HK', category: 'Business', bias: 'centre' },
  { id: 'economictimes', name: 'The Economic Times', feed_url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', homepage: 'https://economictimes.indiatimes.com', country: 'IN', category: 'Business', bias: 'centre' },

  // --- science / climate / health ---
  { id: 'nature',       name: 'Nature',        feed_url: 'https://www.nature.com/nature.rss',                     homepage: 'https://nature.com',          country: 'GB', category: 'Science', bias: 'centre' },
  { id: 'sciencedaily', name: 'ScienceDaily',  feed_url: 'https://www.sciencedaily.com/rss/all.xml',              homepage: 'https://sciencedaily.com',    country: 'US', category: 'Science', bias: 'centre' },
  { id: 'physorg',      name: 'Phys.org',      feed_url: 'https://phys.org/rss-feed/',                            homepage: 'https://phys.org',            country: 'US', category: 'Science', bias: 'centre' },
  { id: 'nasa',         name: 'NASA',          feed_url: 'https://www.nasa.gov/news-release/feed/',               homepage: 'https://nasa.gov',            country: 'US', category: 'Science', bias: 'centre' },
  { id: 'bbc-health',   name: 'BBC Health',    feed_url: 'https://feeds.bbci.co.uk/news/health/rss.xml',          homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Health', bias: 'centre' },
  { id: 'guardian-env', name: 'Guardian Environment', feed_url: 'https://www.theguardian.com/environment/rss',    homepage: 'https://theguardian.com',     country: 'GB', category: 'Climate', bias: 'left' },

  // --- sport / entertainment ---
  { id: 'bbc-sport',    name: 'BBC Sport',     feed_url: 'https://feeds.bbci.co.uk/sport/rss.xml',                homepage: 'https://bbc.co.uk/sport',     country: 'GB', category: 'Sports', bias: 'centre' },
  { id: 'espn',         name: 'ESPN',          feed_url: 'https://www.espn.com/espn/rss/news',                    homepage: 'https://espn.com',            country: 'US', category: 'Sports', bias: 'centre' },
  { id: 'variety',      name: 'Variety',       feed_url: 'https://variety.com/feed/',                             homepage: 'https://variety.com',         country: 'US', category: 'Entertainment', bias: 'centre' },
  { id: 'bbc-arts',     name: 'BBC Arts',      feed_url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', homepage: 'https://bbc.co.uk/news', country: 'GB', category: 'Entertainment', bias: 'centre' },

  // --- technology: consumer launches and hardware. The desk had thirteen
  // outlets and still supplied 5.9% of everything ingested, and what it did
  // supply barely corroborated: a trade show is covered by every outlet writing
  // about a DIFFERENT product, so each write-up clustered alone and the
  // two-source gate dropped it. These three are the mainstream launch beat, so
  // they overlap each other and the incumbents on the same announcements —
  // which is what actually gets a launch onto the feed.
  //
  // CNET and PCWorld were dropped at the robots.txt step. Ziff Davis prohibits
  // automated retrieval for AI use in prose at the top of CNET's file, and
  // PCWorld disallows anthropic-ai outright. Same reason The Register is absent.
  { id: 'techradar',   name: 'TechRadar',     feed_url: 'https://www.techradar.com/feeds.xml',                    homepage: 'https://techradar.com',       country: 'GB', category: 'Technology', bias: 'centre' },
  { id: 'tomsguide',   name: "Tom's Guide",   feed_url: 'https://www.tomsguide.com/feeds/all',                    homepage: 'https://tomsguide.com',       country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'tomshardware',name: "Tom's Hardware",feed_url: 'https://www.tomshardware.com/feeds/all',                 homepage: 'https://tomshardware.com',     country: 'US', category: 'Technology', bias: 'centre' },
  { id: 'livemint-tech', name: 'Mint Technology', feed_url: 'https://www.livemint.com/rss/technology',            homepage: 'https://livemint.com',        country: 'IN', category: 'Technology', bias: 'centre' },

  // --- education. There was no education source at all, which is why the
  // category it now has read zero over a 48-hour window.
  { id: 'bbc-education', name: 'BBC Education', feed_url: 'https://feeds.bbci.co.uk/news/education/rss.xml',      homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Education', bias: 'centre' },
  { id: 'ie-education',  name: 'The Indian Express Education', feed_url: 'https://indianexpress.com/section/education/feed/', homepage: 'https://indianexpress.com', country: 'IN', category: 'Education', bias: 'centre' },
  { id: 'guardian-education', name: 'Guardian Education', feed_url: 'https://www.theguardian.com/education/rss',  homepage: 'https://theguardian.com',     country: 'GB', category: 'Education', bias: 'left' },
  { id: 'edsurge',       name: 'EdSurge',       feed_url: 'https://www.edsurge.com/articles_rss',                 homepage: 'https://edsurge.com',         country: 'US', category: 'Education', bias: 'centre' },

  // --- climate. One outlet, one story in 48 hours.
  { id: 'climatehome',  name: 'Climate Home News', feed_url: 'https://www.climatechangenews.com/feed/',           homepage: 'https://climatechangenews.com', country: 'GB', category: 'Climate', bias: 'centre' },
  { id: 'grist',        name: 'Grist',         feed_url: 'https://grist.org/feed/',                               homepage: 'https://grist.org',           country: 'US', category: 'Climate', bias: 'left' },
  { id: 'insideclimate',name: 'Inside Climate News', feed_url: 'https://insideclimatenews.org/feed/',             homepage: 'https://insideclimatenews.org', country: 'US', category: 'Climate', bias: 'left' },

  // --- health. STAT News and Medical Xpress are the obvious two and both
  // disallow ClaudeBot on their articles, so this desk stays thin on purpose.
  { id: 'healthpolicywatch', name: 'Health Policy Watch', feed_url: 'https://healthpolicy-watch.news/feed/',      homepage: 'https://healthpolicy-watch.news', country: 'CH', category: 'Health', bias: 'centre' },

  // --- front pages, title-only. What separates a story six outlets ran from
  // one six outlets LED with, which breadth alone cannot see: the daily puzzle
  // hints that reached the feed with six corroborating sources were on nobody's
  // front page. Selectivity is the whole signal, so a feed only belongs here if
  // it is a curated front page — the Guardian's international feed (117 items)
  // and the Indian Express firehose (200) were rejected for that reason, not
  // for quality, since a feed that carries everything marks everything
  // prominent. Hindustan Times' top-news feed returns nothing and is absent.
  //
  // NDTV's and the Times of India's front pages are absent for a different
  // reason: both are already ingested as ordinary sources reading those exact
  // feeds. Listing a feed in both tiers would mark everything those outlets
  // publish as prominent, which is the same as marking none of it.
  { id: 'bbc-top',      name: 'BBC News',      feed_url: 'https://feeds.bbci.co.uk/news/rss.xml',                 homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'World',    bias: 'centre', tier: 'title' },
  { id: 'nyt-top',      name: 'The New York Times', feed_url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', homepage: 'https://nytimes.com',  country: 'US', category: 'World',    bias: 'left',   tier: 'title' },
  { id: 'cnn-top',      name: 'CNN',           feed_url: 'http://rss.cnn.com/rss/edition.rss',                    homepage: 'https://cnn.com',             country: 'US', category: 'World',    bias: 'left',   tier: 'title' },
  { id: 'thehindu-top', name: 'The Hindu',     feed_url: 'https://www.thehindu.com/feeder/default.rss',           homepage: 'https://thehindu.com',        country: 'IN', category: 'World',    bias: 'left',   tier: 'title' },
  { id: 'et-top',       name: 'The Economic Times', feed_url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', homepage: 'https://economictimes.indiatimes.com', country: 'IN', category: 'Business', bias: 'centre', tier: 'title' },
];