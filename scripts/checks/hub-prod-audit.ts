/**
 * Audit the LIVE production Hub against the application's own rules.
 *
 * Deliberately re-uses rejectionReason / isAttendable / isOver / titleKey rather
 * than re-expressing them in SQL: the bugs this is meant to catch were exactly
 * cases where a rule was restated somewhere else and drifted. No DB access, no
 * writes — it walks the public API and reports.
 */
import { rejectionReason } from '../../src/lib/hub/ranking';
import { titleKey } from '../../src/lib/hub/dedupe';

const BASE = process.env.HUB_BASE || 'https://tcetcercd.in';

type Item = {
  id: number;
  title: string;
  organizer: string | null;
  mode: string | null;
  city: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  registrationDeadline: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  registrations: number | null;
  popularity: number | null;
};

async function page(cursor: string | null): Promise<{ items: Item[]; next: string | null }> {
  const url = new URL('/api/hackathon-hub', BASE);
  url.searchParams.set('limit', '100');
  url.searchParams.set('sort', 'newest');
  if (cursor) url.searchParams.set('cursor', cursor);
  const res = await fetch(url, { headers: { 'user-agent': 'hub-audit' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = (await res.json()) as { data?: { items?: Item[]; nextCursor?: string | null; hasMore?: boolean } };
  const d = body.data ?? {};
  return { items: d.items ?? [], next: d.hasMore ? (d.nextCursor ?? null) : null };
}

(async () => {
  const all: Item[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 60; i += 1) {
    const { items, next } = await page(cursor);
    all.push(...items);
    if (!next || items.length === 0) break;
    cursor = next;
  }
  console.log(`fetched ${all.length} live Hub events from ${BASE}\n`);

  const now = Date.now();
  const violations: Record<string, Item[]> = {};

  const add = (rule: string, item: Item) => {
    (violations[rule] ??= []).push(item);
  };

  for (const it of all) {
    const reason = rejectionReason({ mode: it.mode, country: it.country, city: it.city, endDate: it.endDate, startDate: it.startDate } as never, now);
    if (reason) add(reason, it);
    if (!it.organizer || /^(n\/a|na|nill|nil|none|unknown|the|-)$/i.test(it.organizer.trim())) add('junk organiser', it);
    if (!it.sourceUrl) add('no source url', it);
    if (!it.mode) add('no mode', it);
    // A city outside the display registry is not a violation: that list exists
    // for distance display. rejectionReason already handles the case that
    // matters — no country AND no placeable city.
  }

  // duplicates: same sourceUrl, and same identity key
  const byUrl = new Map<string, Item[]>();
  for (const it of all) if (it.sourceUrl) byUrl.set(it.sourceUrl, [...(byUrl.get(it.sourceUrl) ?? []), it]);
  for (const [, group] of byUrl) if (group.length > 1) add('duplicate source url', group[0]);

  const byTitle = new Map<string, Item[]>();
  for (const it of all) {
    const k = titleKey(it.title);
    if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), it]);
  }
  for (const [, group] of byTitle) {
    const dates = new Set(group.map((g) => g.startDate));
    if (group.length > 1 && dates.size === 1) add('duplicate title+date', group[0]);
  }

  console.log('=== violations ===');
  if (Object.keys(violations).length === 0) console.log('  none');
  for (const [rule, items] of Object.entries(violations)) {
    console.log(`  ${rule}: ${items.length}`);
    for (const it of items.slice(0, 3)) {
      console.log(`     #${it.id} "${it.title.slice(0, 40)}" mode=${it.mode} city=${it.city} country=${it.country} end=${it.endDate}`);
    }
  }

  console.log('\n=== composition ===');
  const tally = (fn: (i: Item) => string) => {
    const m: Record<string, number> = {};
    for (const i of all) m[fn(i)] = (m[fn(i)] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ');
  };
  console.log('  mode  :', tally((i) => i.mode ?? 'none'));
  console.log('  source:', tally((i) => i.sourceType ?? 'none'));
  console.log('  placed:', tally((i) => (i.city ? 'city' : i.mode === 'ONLINE' ? 'online' : 'unknown')));
  console.log('  reg   :', tally((i) => (i.registrations ? 'signups' : 'no signups')));

  const total = Object.values(violations).reduce((a, b) => a + b.length, 0);
  console.log(`\n${total === 0 ? 'CLEAN' : `DIRTY: ${total} violation(s)`}`);
  if (total > 0) process.exitCode = 1;
})();
