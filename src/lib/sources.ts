export type SourceSeed = {
  id: string; name: string; feed_url: string;
  homepage: string; country: string; category: string;
};

export const SOURCES: SourceSeed[] = [
  // --- world / wire ---
  { id: 'bbc-world',   name: 'BBC News',      feed_url: 'https://feeds.bbci.co.uk/news/world/rss.xml',            homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'World' },
  { id: 'guardian-world', name: 'The Guardian', feed_url: 'https://www.theguardian.com/world/rss',                homepage: 'https://theguardian.com',     country: 'GB', category: 'World' },
  { id: 'aljazeera',   name: 'Al Jazeera',    feed_url: 'https://www.aljazeera.com/xml/rss/all.xml',              homepage: 'https://aljazeera.com',       country: 'QA', category: 'World' },
  { id: 'npr-world',   name: 'NPR',           feed_url: 'https://feeds.npr.org/1004/rss.xml',                     homepage: 'https://npr.org',             country: 'US', category: 'World' },
  { id: 'dw',          name: 'Deutsche Welle',feed_url: 'https://rss.dw.com/rdf/rss-en-all',                      homepage: 'https://dw.com',              country: 'DE', category: 'World' },
  { id: 'france24',    name: 'France 24',     feed_url: 'https://www.france24.com/en/rss',                        homepage: 'https://france24.com',        country: 'FR', category: 'World' },
  { id: 'cbc-world',   name: 'CBC News',      feed_url: 'https://www.cbc.ca/webfeed/rss/rss-world',               homepage: 'https://cbc.ca/news',         country: 'CA', category: 'World' },
  { id: 'abc-au',      name: 'ABC News (AU)', feed_url: 'https://www.abc.net.au/news/feed/51120/rss.xml',         homepage: 'https://abc.net.au/news',     country: 'AU', category: 'World' },
  { id: 'sky-world',   name: 'Sky News',      feed_url: 'https://feeds.skynews.com/feeds/rss/world.xml',          homepage: 'https://news.sky.com',        country: 'GB', category: 'World' },
  { id: 'euronews',    name: 'Euronews',      feed_url: 'https://www.euronews.com/rss?level=theme&name=news',     homepage: 'https://euronews.com',        country: 'EU', category: 'World' },
  { id: 'cna',         name: 'CNA',           feed_url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', homepage: 'https://channelnewsasia.com', country: 'SG', category: 'World' },

  // --- india ---
  { id: 'thehindu-national', name: 'The Hindu',        feed_url: 'https://www.thehindu.com/news/national/feeder/default.rss',            homepage: 'https://thehindu.com',        country: 'IN', category: 'India' },
  { id: 'toi-top',           name: 'Times of India',   feed_url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',           homepage: 'https://timesofindia.com',    country: 'IN', category: 'India' },
  { id: 'indianexpress',     name: 'The Indian Express',feed_url: 'https://indianexpress.com/feed/',                                     homepage: 'https://indianexpress.com',   country: 'IN', category: 'India' },
  { id: 'ndtv',              name: 'NDTV',             feed_url: 'https://feeds.feedburner.com/ndtvnews-top-stories',                    homepage: 'https://ndtv.com',            country: 'IN', category: 'India' },
  { id: 'hindustantimes',    name: 'Hindustan Times',  feed_url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',      homepage: 'https://hindustantimes.com',  country: 'IN', category: 'India' },
  { id: 'livemint',          name: 'Mint',             feed_url: 'https://www.livemint.com/rss/news',                                    homepage: 'https://livemint.com',        country: 'IN', category: 'Business' },
  { id: 'scroll',            name: 'Scroll.in',        feed_url: 'https://scroll.in/feed',                                               homepage: 'https://scroll.in',           country: 'IN', category: 'India' },
  { id: 'thehindu-blr',      name: 'The Hindu Bengaluru', feed_url: 'https://www.thehindu.com/news/cities/bangalore/feeder/default.rss', homepage: 'https://thehindu.com',        country: 'IN', category: 'India' },
  { id: 'deccanherald',      name: 'Deccan Herald',    feed_url: 'https://www.deccanherald.com/rss/news.rss',                            homepage: 'https://deccanherald.com',    country: 'IN', category: 'India' },

  // --- technology ---
  { id: 'arstechnica', name: 'Ars Technica',  feed_url: 'https://feeds.arstechnica.com/arstechnica/index',        homepage: 'https://arstechnica.com',     country: 'US', category: 'Technology' },
  { id: 'theverge',    name: 'The Verge',     feed_url: 'https://www.theverge.com/rss/index.xml',                 homepage: 'https://theverge.com',        country: 'US', category: 'Technology' },
  { id: 'techcrunch',  name: 'TechCrunch',    feed_url: 'https://techcrunch.com/feed/',                           homepage: 'https://techcrunch.com',      country: 'US', category: 'Technology' },
  { id: 'engadget',    name: 'Engadget',      feed_url: 'https://www.engadget.com/rss.xml',                       homepage: 'https://engadget.com',        country: 'US', category: 'Technology' },
  { id: 'bbc-tech',    name: 'BBC Technology',feed_url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',       homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Technology' },

  // --- business ---
  { id: 'bbc-business',      name: 'BBC Business',   feed_url: 'https://feeds.bbci.co.uk/news/business/rss.xml',  homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Business' },
  { id: 'guardian-business', name: 'Guardian Business', feed_url: 'https://www.theguardian.com/uk/business/rss',  homepage: 'https://theguardian.com',     country: 'GB', category: 'Business' },
  { id: 'cnbc-world',        name: 'CNBC',           feed_url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', homepage: 'https://cnbc.com',      country: 'US', category: 'Business' },

  // --- science / climate / health ---
  { id: 'nature',       name: 'Nature',        feed_url: 'https://www.nature.com/nature.rss',                     homepage: 'https://nature.com',          country: 'GB', category: 'Science' },
  { id: 'sciencedaily', name: 'ScienceDaily',  feed_url: 'https://www.sciencedaily.com/rss/all.xml',              homepage: 'https://sciencedaily.com',    country: 'US', category: 'Science' },
  { id: 'physorg',      name: 'Phys.org',      feed_url: 'https://phys.org/rss-feed/',                            homepage: 'https://phys.org',            country: 'US', category: 'Science' },
  { id: 'nasa',         name: 'NASA',          feed_url: 'https://www.nasa.gov/news-release/feed/',               homepage: 'https://nasa.gov',            country: 'US', category: 'Science' },
  { id: 'bbc-health',   name: 'BBC Health',    feed_url: 'https://feeds.bbci.co.uk/news/health/rss.xml',          homepage: 'https://bbc.co.uk/news',      country: 'GB', category: 'Health' },
  { id: 'guardian-env', name: 'Guardian Environment', feed_url: 'https://www.theguardian.com/environment/rss',    homepage: 'https://theguardian.com',     country: 'GB', category: 'Climate' },

  // --- sport / entertainment ---
  { id: 'bbc-sport',    name: 'BBC Sport',     feed_url: 'https://feeds.bbci.co.uk/sport/rss.xml',                homepage: 'https://bbc.co.uk/sport',     country: 'GB', category: 'Sports' },
  { id: 'espn',         name: 'ESPN',          feed_url: 'https://www.espn.com/espn/rss/news',                    homepage: 'https://espn.com',            country: 'US', category: 'Sports' },
  { id: 'variety',      name: 'Variety',       feed_url: 'https://variety.com/feed/',                             homepage: 'https://variety.com',         country: 'US', category: 'Entertainment' },
  { id: 'bbc-arts',     name: 'BBC Arts',      feed_url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', homepage: 'https://bbc.co.uk/news', country: 'GB', category: 'Entertainment' },
];
