import prisma from '@/lib/prisma';

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
  // JS app shells — page crawling returns empty shells, so these stay MANUAL
  // (admin-pasted URLs + CSV still flow). Re-enable PAGE only with a
  // JS renderer or an official feed.
  { key: 'devfolio', label: 'Devfolio', method: 'MANUAL', frequency: 'DAILY', priority: 70, seedUrl: 'https://devfolio.co/hackathons' },
  { key: 'unstop', label: 'Unstop', method: 'MANUAL', frequency: 'DAILY', priority: 70, seedUrl: 'https://unstop.com/hackathons' },
  { key: 'hackerearth', label: 'HackerEarth', method: 'MANUAL', frequency: 'DAILY', priority: 70, seedUrl: 'https://www.hackerearth.com/challenges/hackathon/' },
  { key: 'hack2skill', label: 'Hack2Skill', method: 'MANUAL', frequency: 'DAILY', priority: 70, seedUrl: 'https://hack2skill.com/hackathons' },
  { key: 'mlh', label: 'Major League Hacking', method: 'PAGE', frequency: 'DAILY', priority: 60, seedUrl: 'https://mlh.io/events' },
  { key: 'indiahackathons', label: 'India Hackathons', method: 'PAGE', frequency: 'DAILY', priority: 75, seedUrl: 'https://indiahackathons.com/' },
  { key: 'web', label: 'General web search', method: 'MANUAL', frequency: 'WEEKLY', priority: 40 },
  { key: 'social', label: 'Social media leads', method: 'MANUAL', frequency: 'WEEKLY', priority: 20 },
];

// Search query strategy (§10). Used to document coverage and, when a search
// provider key is configured, to drive automated queries. Without a key the
// discovery job still crawls PAGE seeds + admin-supplied URLs.
export const HUB_QUERY_PACKS: Record<string, string[]> = {
  location: [
    'hackathon Mumbai 2026',
    'hackathon Navi Mumbai 2026',
    'hackathon Thane 2026',
    'hackathon Pune 2026',
    'hackathon Maharashtra 2026',
    'hackathon India 2026',
    'online hackathon 2026',
  ],
  institution: [
    'college hackathon Mumbai 2026',
    'engineering college hackathon Maharashtra 2026',
    'university hackathon Mumbai 2026',
  ],
  technology: [
    'AI hackathon 2026 India',
    'ML hackathon 2026 India',
    'GenAI hackathon 2026',
    'cybersecurity hackathon India 2026',
    'cloud hackathon India 2026',
    'IoT hackathon India 2026',
    'blockchain hackathon India 2026',
  ],
  platform: [
    'site:devfolio.co hackathon India',
    'site:unstop.com hackathon Mumbai',
    'site:hackerearth.com hackathon India',
    'site:hack2skill.com hackathon',
    'site:mlh.io hackathon',
  ],
};

export const HUB_GEO_TIERS: Record<string, string[]> = {
  local: ['TCET vicinity', 'Mumbai', 'Navi Mumbai', 'Thane'],
  maharashtra: ['Pune', 'Nagpur', 'Nashik', 'Chhatrapati Sambhajinagar', 'Kolhapur'],
  national: ['India-wide', 'Online', 'International online (open to Indian students)'],
};

export async function ensureHubSources() {
  for (const seed of HUB_SOURCE_SEEDS) {
    await (prisma as any).hubSource.upsert({
      where: { key: seed.key },
      update: { label: seed.label, method: seed.method, frequency: seed.frequency, priority: seed.priority },
      create: { key: seed.key, label: seed.label, method: seed.method, frequency: seed.frequency, priority: seed.priority, enabled: true },
    });
  }
}
