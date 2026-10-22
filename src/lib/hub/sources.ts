import prisma from '@/lib/prisma';
import { isFirecrawlConfigured } from './firecrawl';

// Source registry (§8). One row per discovery source — never hard-code
// sources in jobs. Priority doubles as conflict weight (§20: higher wins).
export type HubSourceSeed = {
  key: string;
  label: string;
  method: 'PAGE' | 'RSS' | 'API' | 'MANUAL';
  frequency: 'DAILY' | 'WEEKLY';
  priority: number;
  seedUrl?: string;
};

export const HUB_SOURCE_SEEDS: HubSourceSeed[] = [
  { key: 'official', label: 'Official event websites', method: 'MANUAL', frequency: 'DAILY', priority: 100 },
  { key: 'government', label: 'Government portals', method: 'PAGE', frequency: 'DAILY', priority: 90, seedUrl: 'https://www.mygov.in/' },
  { key: 'college', label: 'College websites', method: 'MANUAL', frequency: 'WEEKLY', priority: 80 },
  { key: 'admin', label: 'Administrator verified entry', method: 'MANUAL', frequency: 'DAILY', priority: 85 },
  // These three publish a first-party JSON API, so they are discovered
  // structured-first (see ./structured) — no renderer, no search, no model.
  { key: 'unstop', label: 'Unstop', method: 'API', frequency: 'DAILY', priority: 70 },
  { key: 'devfolio', label: 'Devfolio', method: 'API', frequency: 'DAILY', priority: 70 },
  { key: 'devpost', label: 'Devpost', method: 'API', frequency: 'DAILY', priority: 65 },
  { key: 'hackerearth', label: 'HackerEarth', method: 'MANUAL', frequency: 'DAILY', priority: 70, seedUrl: 'https://www.hackerearth.com/challenges/hackathon/' },
  { key: 'hack2skill', label: 'Hack2Skill', method: 'MANUAL', frequency: 'DAILY', priority: 70, seedUrl: 'https://hack2skill.com/hackathons' },
  { key: 'mlh', label: 'Major League Hacking', method: 'PAGE', frequency: 'DAILY', priority: 60, seedUrl: 'https://mlh.io/events' },
  { key: 'indiahackathons', label: 'India Hackathons', method: 'PAGE', frequency: 'DAILY', priority: 75, seedUrl: 'https://indiahackathons.com/' },
  { key: 'web', label: 'General web search', method: 'MANUAL', frequency: 'WEEKLY', priority: 40 },
  { key: 'social', label: 'Social media leads', method: 'MANUAL', frequency: 'WEEKLY', priority: 20 },
];

// Discovery is structured-first: Unstop/Devfolio/Devpost are read from their own
// JSON APIs. Search was removed — it returned fewer fields, at lower coverage,
// and depended on third-party engines that rate-limit and CAPTCHA.
// These platforms render their listings client-side: a plain fetch sees an
// empty shell, but a JS render yields real event links (verified: Unstop listing
// 442 -> 5,906 visible chars, 15 event links). They become crawlable the moment
// a renderer is configured, and fall back to MANUAL (paste/CSV only) without one.
const RENDERABLE_SOURCES = new Set(['hackerearth']);

export async function ensureHubSources() {
  const canRender = isFirecrawlConfigured();
  for (const seed of HUB_SOURCE_SEEDS) {
    const method =
      seed.method === 'MANUAL' && canRender && RENDERABLE_SOURCES.has(seed.key) ? 'PAGE' : seed.method;
    await prisma.hubSource.upsert({
      where: { key: seed.key },
      update: { label: seed.label, method, frequency: seed.frequency, priority: seed.priority },
      create: { key: seed.key, label: seed.label, method, frequency: seed.frequency, priority: seed.priority, enabled: true },
    });
  }
}
