import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { ensureHubSources } from './sources';

const FETCH_TIMEOUT_MS = 15000;
const POLITENESS_DELAY_MS = 1500;
const MAX_HTML_CHARS = 1_500_000;
const MAX_CANDIDATES_PER_PAGE = 20;

const HACKATHON_KEYWORDS =
  /hackathon|hackfest|codefest|ideathon|datathon|competition|challenge|contest/i;
const NOISE =
  /job|recruitment|vacancy|admission|result|merit list|tender|auction/i;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TCET-CoE-HubBot/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text')) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }
    return (await res.text()).slice(0, MAX_HTML_CHARS);
  } finally {
    clearTimeout(timer);
  }
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
    const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title.length < 8 || !HACKATHON_KEYWORDS.test(title) || NOISE.test(title)) continue;
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
  errors: string[];
};

export async function runDiscovery(): Promise<DiscoveryResult> {
  await ensureHubSources();
  const errors: string[] = [];
  let pagesFetched = 0;
  let discovered = 0;

  const sources = await (prisma as any).hubSource.findMany({
    where: { enabled: true, method: { in: ['PAGE', 'RSS', 'API'] } },
  });

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
      void hash;
      for (const link of extractEventLinks(html, seedUrl)) {
        const existing = await (prisma as any).hubCandidate.findUnique({ where: { url: link.url } });
        if (existing) continue;
        await (prisma as any).hubCandidate.create({
          data: {
            url: link.url,
            source: source.key,
            sourceType: sourceTypeFor(source.key),
            status: 'DISCOVERED',
            title: link.title,
          },
        });
        discovered++;
      }
      await (prisma as any).hubSource.update({
        where: { key: source.key },
        data: { lastRunAt: new Date(), lastError: null },
      });
    } catch (err) {
      const msg = `${source.key}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      await (prisma as any).hubSource.update({
        where: { key: source.key },
        data: { lastRunAt: new Date(), lastError: msg.slice(0, 1900) },
      });
    }
  }

  await (prisma as any).hubImportLog.create({
    data: { source: 'DISCOVERY', discovered, inserted: discovered, errors: errors.length > 0 ? errors : undefined },
  });

  return { pagesFetched, discovered, errors };
}

function seedUrlFor(key: string): string | null {
  const map: Record<string, string> = {
    government: 'https://www.mygov.in/',
    devfolio: 'https://devfolio.co/hackathons',
    unstop: 'https://unstop.com/hackathons',
    hackerearth: 'https://www.hackerearth.com/challenges/hackathon/',
    hack2skill: 'https://hack2skill.com/hackathons',
    mlh: 'https://mlh.io/events',
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
    government: 'GOVERNMENT',
    college: 'COLLEGE_WEBSITE',
  };
  return map[key] ?? 'OTHER';
}
