/**
 * Hub filter correctness, asserted against a live API.
 *
 *   npx --yes tsx scripts/checks/hub-filter-checks.ts [baseUrl]
 *
 * The point of this file: every filter is re-derived here from the payload the
 * API itself returned, then compared as a SET against what the filtered request
 * actually returned. That catches both directions a filter can break —
 *   leakage: a row that does not match the filter comes back anyway
 *   omission: a row that matches is silently dropped (scan caps, null guards,
 *             three-valued SQL logic).
 * A one-directional test would have missed the null-date drop that shipped once.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3111';
const LIMIT = 50; // the route's MAX_LIMIT

type Row = {
  id: number;
  title: string;
  organizer: string | null;
  description: string | null;
  city: string | null;
  mode: string | null;
  themes: unknown;
  technologies: unknown;
  startDate: string | null;
  endDate: string | null;
  registrationDeadline: string | null;
  regStatus: string;
  eventStatus: string;
};

let passed = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * The route allows 60 requests a minute per client key, so pace under it rather
 * than trip the limiter and retry. A check that only passes against an unbounded
 * API is not a check you can trust.
 */
let lastCall = 0;
const MIN_GAP_MS = 1100;

async function getJson(url: string, attempt = 0): Promise<Record<string, unknown>> {
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
  const res = await fetch(url);
  if (res.status === 429 && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Every row the API will ever show, paged. The oracle's universe. */
async function fetchAll(qs: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 200; page += 1) {
    const url = `${BASE}/api/hackathon-hub?limit=${LIMIT}${qs}${cursor === null ? '' : `&cursor=${cursor}`}`;
    const json = (await getJson(url)) as unknown as {
      success: boolean;
      data: { items: Row[]; nextCursor: number | null; hasMore: boolean };
    };
    if (!json.success) throw new Error(`${qs || '(all)'} -> not success`);
    out.push(...json.data.items);
    if (!json.data.hasMore || json.data.nextCursor === null) break;
    cursor = json.data.nextCursor;
  }
  return out;
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

/** Mirrors the route's month window: the event's run overlaps the month. */
function inMonth(r: Row, month: string): boolean {
  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1);
  const s = ms(r.startDate);
  if (s === null || !(s < end)) return false;
  const e = ms(r.endDate);
  if (e !== null) return e >= start;
  const d = ms(r.registrationDeadline);
  if (d !== null) return d >= start;
  return s >= start;
}

/** Mirrors the route's domain rule: lowercased substring over themes+technologies. */
function inDomain(r: Row, domain: string): boolean {
  const themes = Array.isArray(r.themes) ? (r.themes as string[]) : [];
  const techs = Array.isArray(r.technologies) ? (r.technologies as string[]) : [];
  return [...themes, ...techs].some((t) => String(t).toLowerCase().includes(domain));
}

function inSearch(r: Row, q: string): boolean {
  const needle = q.toLowerCase();
  return [r.title, r.organizer ?? '', r.description ?? ''].some((f) => f.toLowerCase().includes(needle));
}

const ids = (rows: Row[]) => rows.map((r) => r.id).sort((a, b) => a - b);

/** Compare one probe: what the API returned vs what the rule says it should. */
async function probe(name: string, qs: string, expected: (r: Row) => boolean, universe: Row[]) {
  const want = ids(universe.filter(expected));
  const got = ids(await fetchAll(qs));
  const missing = want.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !want.includes(id));
  const titleOf = (id: number) => universe.find((r) => r.id === id)?.title.slice(0, 28) ?? String(id);
  ok(
    name,
    missing.length === 0 && extra.length === 0,
    [
      missing.length ? `${missing.length} missing (${missing.slice(0, 3).map(titleOf).join(', ')})` : '',
      extra.length ? `${extra.length} extra (${extra.slice(0, 3).map(titleOf).join(', ')})` : '',
    ]
      .filter(Boolean)
      .join(' / '),
  );
  return { want: want.length, got: got.length };
}

(async () => {
  console.log(`hub filters — ${BASE}\n`);

  const all = await fetchAll('');
  console.log(`  universe: ${all.length} rows\n`);
  ok('a hub with rows to test', all.length > 0);
  if (!all.length) {
    console.log('nothing to check');
    process.exitCode = 1;
    return;
  }

  // Deterministic filter values, all taken from the data itself.
  const distinct = <T>(xs: T[]) => Array.from(new Set(xs));
  const cities = distinct(all.map((r) => r.city).filter((c): c is string => !!c));
  const domains = distinct(
    all.flatMap((r) => [
      ...(Array.isArray(r.themes) ? (r.themes as string[]) : []),
      ...(Array.isArray(r.technologies) ? (r.technologies as string[]) : []),
    ]),
  )
    .map((t) => String(t).toLowerCase())
    .filter((t) => t.length >= 3 && /^[a-z0-9 .+#-]+$/.test(t));
  const monthOf = (v: number) => {
    const d = new Date(v);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const months = distinct(
    all.flatMap((r) => [r.startDate, r.endDate].filter(Boolean).map((d) => monthOf(ms(d as string)!))),
  ).sort();
  const words = distinct(
    all
      .flatMap((r) => r.title.split(/\s+/))
      .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
      .filter((w) => w.length >= 5 && /^[A-Za-z0-9]+$/.test(w)),
  );

  for (const mode of ['ONLINE', 'OFFLINE', 'HYBRID']) {
    await probe(`mode=${mode}`, `&mode=${mode}`, (r) => r.mode === mode, all);
  }
  for (const s of ['OPEN', 'CLOSING_SOON', 'CLOSED']) {
    await probe(`regStatus=${s}`, `&regStatus=${s}`, (r) => r.regStatus === s, all);
  }
  for (const s of ['UPCOMING', 'ONGOING', 'COMPLETED']) {
    await probe(`eventStatus=${s}`, `&eventStatus=${s}`, (r) => r.eventStatus === s, all);
  }
  for (const city of cities) {
    await probe(`city=${city}`, `&city=${encodeURIComponent(city)}`, (r) => r.city === city, all);
  }
  for (const d of domains.slice(0, 6)) {
    await probe(`domain=${d}`, `&domain=${encodeURIComponent(d)}`, (r) => inDomain(r, d), all);
  }
  for (const w of words.slice(0, 6)) {
    await probe(`search=${w}`, `&search=${encodeURIComponent(w)}`, (r) => inSearch(r, w), all);
  }
  for (const m of months) {
    await probe(`month=${m}`, `&month=${m}`, (r) => inMonth(r, m), all);
  }

  // Two filters at once: each must still hold, and together they must intersect.
  const city0 = cities[0];
  if (city0) {
    await probe(
      `city=${city0} + mode=ONLINE`,
      `&city=${encodeURIComponent(city0)}&mode=ONLINE`,
      (r) => r.city === city0 && r.mode === 'ONLINE',
      all,
    );
  }
  if (months[0]) {
    await probe(`month=${months[0]} + regStatus=OPEN`, `&month=${months[0]}&regStatus=OPEN`, (r) => inMonth(r, months[0]) && r.regStatus === 'OPEN', all);
  }

  // Unknown values must be ignored, never applied as a filter that matches nothing.
  ok('bogus mode is ignored', ids(await fetchAll('&mode=NOT_A_MODE')).length === ids(all).length);
  ok('bogus regStatus is ignored', ids(await fetchAll('&regStatus=NOT_A_STATUS')).length === ids(all).length);
  ok('bogus month is ignored', ids(await fetchAll('&month=not-a-month')).length === ids(all).length);

  // Facets must cover every city the listing holds, or the dropdown cannot offer it.
  const facetJson = (await getJson(`${BASE}/api/hackathon-hub?facets=1&limit=1`)) as unknown as {
    data?: { facets?: { cities: { city: string; count: number }[] } };
  };
  const facetCities = new Set((facetJson.data?.facets?.cities ?? []).map((c) => c.city));
  const unreachable = cities.filter((c) => !facetCities.has(c));
  ok('every city is offered as a filter', unreachable.length === 0, unreachable.slice(0, 5).join(', '));

  console.log(
    failures.length === 0
      ? `\nALL CHECKS PASSED (${passed})`
      : `\nFAILURES (${failures.length}/${passed + failures.length})`,
  );
  if (failures.length) process.exitCode = 1;
})().catch((e) => {
  console.error('CHECK ERROR:', e);
  process.exitCode = 1;
});

// Module scope: without this the consts above collide with the other checks.
export {};
