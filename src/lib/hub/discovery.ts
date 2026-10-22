import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { clipDbString, cleanEventTitle, normalizeName } from '@/lib/hackathon-hub';
import { ensureHubSources } from './sources';
import { fetchPublicText } from './fetch-guard';
import { fetchHtmlWithRender, isFirecrawlConfigured, searchWeb } from './firecrawl';

const FETCH_TIMEOUT_MS = 15000;
const POLITENESS_DELAY_MS = 1500;
const MAX_HTML_CHARS = 1_500_000;
const MAX_CANDIDATES_PER_PAGE = 20;

const HACKATHON_KEYWORDS =
  /hackathon|hackfest|codefest|ideathon|datathon|competition|challenge|contest/i;
const NOISE =
  /job|recruitment|vacancy|admission|result|merit list|tender|auction/i;
// Listing/nav pages, not events (e.g. "Explore hackathons", "Organize a hackathon").
const LISTING_PATTERNS = [
  /^(explore|organize|organise|all|upcoming|past|open|find|browse|discover|host)\b[\w\s|–—-]*hackathons?\b[\w\s|–—-]*$/i,
  /^\d[\d,+]*(?:\+)?\s+hackathons?\b/i, // "2540+ Hackathons in India…"
  /hackathons?\s*[|–—-]\s*(devfolio|unstop|hackerearth|hack2skill|devpost|mlh)\b/i, // platform index pages
];
export const LISTING_TITLES = {
  test: (title: string): boolean => LISTING_PATTERNS.some((re) => re.test(title)),
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Link text arrives HTML-escaped ("AI &amp; Prompt Engineering"), which makes
// titles look broken in the Hub UI.
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const key = code.toLowerCase();
    try {
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    } catch {
      return match;
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function normalizeContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString().slice(0, 512);
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string> {
  // Rendering fallback inside: JS-shell sources (Devfolio, Unstop, HackerEarth)
  // return empty markup to a plain fetch, so those are rendered when configured.
  const { status, text } = await fetchHtmlWithRender(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxChars: MAX_HTML_CHARS,
  });
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  return text;
}

export type DiscoveredLink = { url: string; title: string };

export function extractEventLinks(html: string, base: string): DiscoveredLink[] {
  const out: DiscoveredLink[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    if (out.length >= MAX_CANDIDATES_PER_PAGE) break;
    const url = normalizeUrl(match[1].trim(), base);
    if (!url || !url.startsWith('https://')) continue;
    try {
      const parsed = new URL(url);
      const baseParsed = new URL(base);
      if (parsed.origin === baseParsed.origin && parsed.pathname.replace(/\/$/, '') === '') continue; // site self-link
      if (/^\/(submit|login|signup|signin|organise|organize|contact|about)/i.test(parsed.pathname)) continue; // forms, not events
    } catch {
      continue;
    }
    const title = decodeEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 200);
    if (title.length < 8 || !HACKATHON_KEYWORDS.test(title) || NOISE.test(title)) continue;
    if (LISTING_TITLES.test(title)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, title });
  }
  return out;
}

export type DiscoveryResult = {
  pagesFetched: number;
  discovered: number;
  /** Same event already known under a different URL/source — skipped, not duplicated. */
  duplicatesSkipped: number;
  errors: string[];
};

// Titles already represented in the candidate queue, keyed by cleaned+normalized
// name. Cross-source duplicates (the same hackathon listed on Unstop AND
// IndiaHackathons) never share a URL, so URL dedupe alone cannot see them.
async function knownTitleKeys(): Promise<Set<string>> {
  const rows = await prisma.hubCandidate.findMany({ select: { title: true } });
  return new Set(rows.map((r: { title: string | null }) => normalizeName(cleanEventTitle(r.title))));
}

// Sitemap discovery: a sitemap.xml is a machine-readable index of a site's
// pages — one fetch yields every event URL, no HTML parsing. Preferred over
// page crawling wherever a source publishes one.
// ponytail: currently wired for indiahackathons only; upgrade path is a
// per-source sitemap column on HubSource instead of the key check below.
export async function discoverFromSitemap(
  sitemapUrl: string,
  sourceKey: string,
  sourceType: string,
  pathFilter: RegExp,
): Promise<{ discovered: number; error: string | null }> {
  let discovered = 0;
  try {
    const { status, text: xml } = await fetchPublicText(sitemapUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      accept: 'application/xml,text/xml',
      contentTypes: ['xml', 'text'],
    });
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
    const seen = new Set<string>();
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = match[1].trim().slice(0, 512);
      if (!url.startsWith('https://') || !pathFilter.test(url) || seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());
      const existing = await prisma.hubCandidate.findUnique({ where: { url } });
      if (existing) continue;
      const slug = url.split('/').filter(Boolean).pop() ?? url;
      const title = cleanEventTitle(slug.replace(/[-_]+/g, ' ').replace(/\?.*$/, ''));
      await prisma.hubCandidate.create({
        data: {
          url,
          source: sourceKey,
          sourceType,
          status: 'DISCOVERED',
          title: clipDbString(title, 191) ?? url.slice(0, 191),
        },
      });
      discovered++;
    }
    return { discovered, error: null };
  } catch (err) {
    return { discovered, error: `${sourceKey} sitemap: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Personal/listing tabs that look like event slugs but are not events.
const DEVFORUM_RESERVED_SLUGS = new Set(['applied', 'open', 'past', 'upcoming', 'mine', 'saved']);

// True when a candidate URL is an individual event detail page (not a listing).
// Unstop/Devfolio/Hack2Skill host registration ON the event page, so for these
// the page URL is a legitimate registrationUrl — see aiFill().
export function isIndividualEventPage(url: string, sourceKey: string): boolean {
  const matcher = SEARCH_SOURCES[sourceKey]?.isEventUrl;
  if (!matcher) return false;
  try {
    return matcher(new URL(url));
  } catch {
    return false;
  }
}

/** The platform registers on the event page itself (no separate signup link). */
export function registersOnEventPage(sourceKey: string): boolean {
  return SEARCH_SOURCES[sourceKey]?.registrationOnPage === true;
}

// Search-driven discovery. Some platforms are unreachable by crawling: Unstop's
// /hackathons listing answers with a cookie wall (416 chars of "Please Wait")
// to both plain fetch AND a JS render. Their individual event pages render fine,
// so the reliable route is: search -> keep only event URLs -> extract the page.
// registrationOnPage: the platform hosts sign-up ON the event detail page
// (Unstop's Apply button, Devfolio's Register). For these, the page URL IS the
// registration URL — not a guess, a property of the platform.
export const SEARCH_SOURCES: Record<
  string,
  { sourceType: string; queries: string[]; isEventUrl: (u: URL) => boolean; registrationOnPage?: boolean }
> = {
  unstop: {
    sourceType: 'UNSTOP',
    registrationOnPage: true,
    queries: ['unstop hackathon 2026 India register', 'unstop.com hackathon online students 2026'],
    isEventUrl: (u) => u.hostname.endsWith('unstop.com') && /^\/hackathons\/[^/]+$/i.test(u.pathname),
  },
  devfolio: {
    sourceType: 'DEVFOLIO',
    registrationOnPage: true,
    queries: ['devfolio hackathon 2026 open register', 'devfolio.co hackathon India 2026'],
    // Devfolio events live on subdomains (biosv2.devfolio.co), not /slug paths.
    // "/hackathons/applied" is a personal dashboard tab, not an event.
    isEventUrl: (u) => {
      if (u.hostname.endsWith('.devfolio.co')) return u.pathname === '/';
      if (u.hostname !== 'devfolio.co') return false;
      const m = /^\/hackathons\/([^/]+)$/i.exec(u.pathname);
      if (!m) return false;
      return !DEVFORUM_RESERVED_SLUGS.has(m[1].toLowerCase());
    },
  },
  hack2skill: {
    sourceType: 'HACK2SKILL',
    registrationOnPage: true,
    queries: ['hack2skill hackathon 2026 register'],
    isEventUrl: (u) =>
      u.hostname.endsWith('hack2skill.com') && /^\/(hackathons|competitions)\/[^/]+$/i.test(u.pathname),
  },
};

export async function discoverFromSearch(
  sourceKey: string,
  limitPerQuery = 10,
  sharedSeen?: Set<string>,
): Promise<{ discovered: number; duplicates: number; error: string | null }> {
  const cfg = SEARCH_SOURCES[sourceKey];
  // No config or no provider -> silently nothing. Discovery must not fail just
  // because the optional renderer/search service is absent.
  if (!cfg || !isFirecrawlConfigured()) return { discovered: 0, duplicates: 0, error: null };

  const seenTitles = sharedSeen ?? (await knownTitleKeys());
  let discovered = 0;
  let duplicates = 0;
  const errors: string[] = [];
  for (const query of cfg.queries) {
    const hits = await searchWeb(query, limitPerQuery);
    if (hits.length === 0) {
      errors.push(`${sourceKey}: search returned nothing for "${query}"`);
      continue;
    }
    for (const hit of hits) {
      let parsed: URL;
      try {
        parsed = new URL(hit.url);
      } catch {
        continue;
      }
      if (!cfg.isEventUrl(parsed)) continue;
      if (NOISE.test(hit.title) || LISTING_TITLES.test(hit.title)) continue;
      const url = hit.url.slice(0, 512);
      const existing = await prisma.hubCandidate.findUnique({ where: { url } });
      if (existing) continue;
      const title = cleanEventTitle(hit.title);
      const key = normalizeName(title);
      if (key && seenTitles.has(key)) {
        duplicates += 1;
        continue;
      }
      seenTitles.add(key);
      await prisma.hubCandidate.create({
        data: {
          url,
          source: sourceKey,
          sourceType: cfg.sourceType,
          status: 'DISCOVERED',
          title: clipDbString(title, 191) ?? url.slice(0, 191),
        },
      });
      discovered++;
    }
  }
  return { discovered, duplicates, error: errors.length > 0 ? errors.join('; ').slice(0, 1900) : null };
}

export async function runDiscovery(): Promise<DiscoveryResult> {
  await ensureHubSources();
  const errors: string[] = [];
  let pagesFetched = 0;
  let discovered = 0;
  let duplicatesSkipped = 0;
  const seenTitles = await knownTitleKeys();

  const sources = await prisma.hubSource.findMany({
    where: { enabled: true, method: { in: ['PAGE', 'RSS', 'API'] } },
  });

  // Sitemap-first for sources that publish one (complete coverage, 1 fetch).
  // Runs only while the source stays enabled (toggle in Hub Sources).
  const ihEnabled = sources.some((s: { key: string }) => s.key === 'indiahackathons');
  if (ihEnabled) {
    const sitemap = await discoverFromSitemap(
      'https://indiahackathons.com/sitemap.xml',
      'indiahackathons',
      'INDIAHACKATHONS',
      /^https:\/\/indiahackathons\.com\/events\//,
    );
    discovered += sitemap.discovered;
    if (sitemap.error) errors.push(sitemap.error);
  }

  // Search-first stage for platforms whose listing pages are JS shells or
  // cookie-walled (they sit at method=MANUAL, so they are not in `sources`).
  // Runs only when a self-hosted search provider is configured.
  if (isFirecrawlConfigured()) {
    const enabledKeys = new Set(
      (
        await prisma.hubSource.findMany({
          where: { enabled: true },
          select: { key: true },
        })
      ).map((s: { key: string }) => s.key),
    );
    for (const key of Object.keys(SEARCH_SOURCES)) {
      if (!enabledKeys.has(key)) continue;
      const found = await discoverFromSearch(key, 10, seenTitles);
      discovered += found.discovered;
      duplicatesSkipped += found.duplicates;
      if (found.error) errors.push(found.error);
    }
  }

  for (const source of sources) {
    const seedUrl = (source as { key: string }).key
      ? seedUrlFor(source.key as string)
      : null;
    if (!seedUrl) continue;
    try {
      const html = await fetchHtml(seedUrl);
      pagesFetched++;
      await new Promise((r) => setTimeout(r, POLITENESS_DELAY_MS));
      const hash = sha256(normalizeContent(html));
      // Apply the source's event-URL matcher to crawled links too. Without it
      // the rendered listings leak index pages ("Competitions", "/hackathons/applied").
      const matcher = SEARCH_SOURCES[source.key as string]?.isEventUrl;
      for (const link of extractEventLinks(html, seedUrl)) {
        if (matcher) {
          try {
            if (!matcher(new URL(link.url))) continue;
          } catch {
            continue;
          }
        }
        const existing = await prisma.hubCandidate.findUnique({ where: { url: link.url } });
        if (existing) continue;
        const title = cleanEventTitle(link.title);
        const key = normalizeName(title);
        if (key && seenTitles.has(key)) {
          duplicatesSkipped += 1;
          continue;
        }
        seenTitles.add(key);
        await prisma.hubCandidate.create({
          data: {
            url: link.url,
            source: source.key,
            sourceType: sourceTypeFor(source.key),
            status: 'DISCOVERED',
            title: clipDbString(title, 191) ?? link.url.slice(0, 191),
            pageHash: hash,
          },
        });
        discovered++;
      }
      await prisma.hubSource.update({
        where: { key: source.key },
        data: { lastRunAt: new Date(), lastError: null },
      });
    } catch (err) {
      const msg = `${source.key}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      await prisma.hubSource.update({
        where: { key: source.key },
        data: { lastRunAt: new Date(), lastError: msg.slice(0, 1900) },
      });
    }
  }

  await prisma.hubImportLog.create({
    data: { source: 'DISCOVERY', discovered, inserted: discovered, errors: errors.length > 0 ? errors : undefined },
  });

  return { pagesFetched, discovered, duplicatesSkipped, errors };
}

function seedUrlFor(key: string): string | null {
  const map: Record<string, string> = {
    government: 'https://www.mygov.in/',
    devfolio: 'https://devfolio.co/hackathons',
    unstop: 'https://unstop.com/hackathons',
    hackerearth: 'https://www.hackerearth.com/challenges/hackathon/',
    hack2skill: 'https://hack2skill.com/hackathons',
    mlh: 'https://mlh.io/events',
    indiahackathons: 'https://indiahackathons.com/',
  };
  return map[key] ?? null;
}

function sourceTypeFor(key: string): string {
  const map: Record<string, string> = {
    devfolio: 'DEVFOLIO',
    unstop: 'UNSTOP',
    hackerearth: 'HACKEREARTH',
    hack2skill: 'HACK2SKILL',
    mlh: 'MLH',
    indiahackathons: 'INDIAHACKATHONS',
    government: 'GOVERNMENT',
    college: 'COLLEGE_WEBSITE',
  };
  return map[key] ?? 'OTHER';
}
