/**
 * Structured discovery: first-party JSON APIs instead of search.
 *
 * Search was the wrong tool for this job. These platforms publish the exact
 * fields the extractor used to guess at, at far higher coverage, with no API
 * key and no quota — so nothing here renders a page or calls a model.
 *
 *   Unstop   6,831 hackathons   title, organiser, start/end, regn window, city,
 *                               state, venue, prizes, team size, eligibility
 *   Devfolio 2,038 hackathons   name, dates, city/country, online flag, prizes,
 *                               team size, themes, university flag
 *   Devpost  5,250 hackathons   title, org, submission window, prize, location
 *
 * These are UNDOCUMENTED endpoints. Every field is read defensively: a shape
 * change must degrade to a missing field, never a thrown error that kills the
 * run. `registrationClosesWithSubmission` marks the platforms where sign-up
 * genuinely stays open until submissions close (a property of the platform, not
 * a guess) — without it those events could never satisfy the mandatory
 * registrationDeadline and would sit in NEEDS_REVIEW forever.
 */
import { cleanEventTitle } from '@/lib/hackathon-hub';
import { cleanOrganiser, stripHtml, tidy } from './text';
import type { ExtractedEvent } from './extract';

const FETCH_TIMEOUT_MS = 20_000;
// Devfolio legitimately returns 1000 events (~8.3 MB) per page. The cap is a
// guard against a runaway or hostile response, not a working limit, so it sits
// well above the largest real payload observed.
const MAX_BODY_CHARS = 32_000_000;
const USER_AGENT = 'CoE-Hub-Discovery/1.0 (+https://tcetcercd.in; hackathon aggregation)';

export type StructuredEvent = {
  /** Canonical event page — also the registration entry point on these platforms. */
  url: string;
  /** Platform-native id, used to dedupe within a source without trusting the URL. */
  nativeId: string;
  /** Raw signup count as published, or null when the source omits it. */
  popularity: number | null;
  event: ExtractedEvent;
};

export type StructuredPage = {
  events: StructuredEvent[];
  total: number | null;
  pages: number | null;
  error: string | null;
};

// ── defensive readers ────────────────────────────────────────────────────────
// The payloads are external and unversioned: every accessor tolerates a wrong
// type rather than throwing, so one malformed row cannot fail a whole run.

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown, max = 400): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function int(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const rounded = Math.trunc(n);
  return rounded > 0 && rounded <= 100_000 ? rounded : null;
}

function httpUrl(value: unknown): string | null {
  const raw = str(value, 512);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 512) : null;
  } catch {
    return null;
  }
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Timestamp → the calendar date in the event's own timezone.
 *
 * `slice(0, 10)` would be wrong for a UTC stamp that lands on the previous or
 * next day locally, so the platform's timezone is honoured via Intl (stdlib).
 */
export function localDate(value: unknown, timeZone?: string | null): string | null {
  const raw = str(value, 40);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  } catch {
    // Unknown IANA zone — fall back to the literal date component.
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
  }
}

/** "Aug 31 - Oct 23, 2026" / "Aug 31, 2026 - Oct 23, 2026" / "Oct 23, 2026". */
export function parseDateRange(
  text: string | null | undefined,
  now: Date = new Date(),
): { startDate: string | null; endDate: string | null } {
  const source = stripHtml(text);
  if (!source) return { startDate: null, endDate: null };
  const tokens: { month: number; day: number; year: number | null }[] = [];
  const re = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const day = Number(match[2]);
    if (!month || !Number.isInteger(day) || day < 1 || day > 31) continue;
    tokens.push({ month, day, year: match[3] ? Number(match[3]) : null });
    if (tokens.length === 2) break;
  }
  if (tokens.length === 0) return { startDate: null, endDate: null };

  const end = tokens[tokens.length - 1];
  const start = tokens.length > 1 ? tokens[0] : null;

  // Devpost writes the year once, on the end date. Infer the start's year from
  // it, rolling back a year when the range spans a new year (Dec → Jan).
  let endYear = end.year ?? now.getUTCFullYear();
  if (end.year === null) {
    const probe = new Date(Date.UTC(endYear, end.month - 1, end.day));
    if (probe.getTime() < now.getTime() - 180 * 86_400_000) endYear += 1;
  }
  const endDate = isoOf(endYear, end.month, end.day);
  if (!start) return { startDate: null, endDate };

  let startYear = start.year ?? endYear;
  if (start.year === null && start.month > end.month) startYear = endYear - 1;
  return { startDate: isoOf(startYear, start.month, start.day), endDate };
}

function currencySymbol(currency: string | null): string {
  const c = (currency ?? '').toLowerCase();
  if (c.includes('rupee') || c === 'inr') return '\u20b9';
  if (c.includes('dollar') || c === 'usd') return '$';
  if (c.includes('euro') || c === 'eur') return '\u20ac';
  if (c.includes('pound') || c === 'gbp') return '\u00a3';
  return '';
}

/** Sum prize cash per currency; largest first. Rank names when there is no cash. */
function sumPrizes(
  rows: { amount: number; currency: string | null }[],
  fallbackLabels: string[],
): string | null {
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    if (row.amount <= 0) continue;
    const key = row.currency ?? '';
    byCurrency.set(key, (byCurrency.get(key) ?? 0) + row.amount);
  }
  if (byCurrency.size === 0) {
    const labels = [...new Set(fallbackLabels.filter(Boolean))];
    return labels.length > 0 ? labels.slice(0, 3).join(', ') : null;
  }
  return [...byCurrency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([currency, amount]) => `${currencySymbol(currency)}${Math.round(amount).toLocaleString('en-IN')}`)
    .join(' + ');
}

// ── Unstop ───────────────────────────────────────────────────────────────────

function unstopMode(region: string | null): ExtractedEvent['mode'] {
  const value = (region ?? '').toLowerCase();
  if (value === 'online') return 'ONLINE';
  if (value === 'offline') return 'OFFLINE';
  if (value === 'hybrid') return 'HYBRID';
  return null;
}

function unstopPrize(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const rows: { amount: number; currency: string | null }[] = [];
  const ranks: string[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    if (!row) continue;
    const cash = typeof row.cash === 'number' ? row.cash : Number(row.cash);
    rows.push({ amount: Number.isFinite(cash) ? cash : 0, currency: str(row.currency, 30) });
    const rank = tidy(str(row.rank, 40));
    if (rank) ranks.push(rank);
  }
  return sumPrizes(rows, ranks);
}

function unstopSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = tidy(str(row.skill_name, 60) ?? str(row.skill, 60), 60);
    if (name) out.push(name);
  }
  return [...new Set(out)].slice(0, 8);
}

/** `{"sector":["students"],"others":["all"],…}` → "Students". */
function unstopEligibility(value: unknown): string | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return tidy(value, 200);
    }
  }
  const record = asRecord(parsed);
  if (!record) return null;
  const words: string[] = [];
  for (const list of Object.values(record)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const word = tidy(str(item, 40), 40);
      if (word && word.toLowerCase() !== 'all') words.push(word.charAt(0).toUpperCase() + word.slice(1));
    }
  }
  const unique = [...new Set(words)].slice(0, 4);
  return unique.length > 0 ? unique.join(', ') : null;
}

export function parseUnstop(payload: unknown): StructuredPage {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const rows = Array.isArray(data?.data) ? data.data : [];
  const events: StructuredEvent[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const title = tidy(cleanEventTitle(str(row.title, 300)), 191);
    const url = httpUrl(row.seo_url);
    if (!title || !url) continue;
    const regn = asRecord(row.regnRequirements) ?? {};
    const address = asRecord(row.address_with_country_logo) ?? {};
    const organisation = asRecord(row.organisation);
    events.push({
      url,
      nativeId: str(row.short_id, 40) ?? str(row.id, 40) ?? url,
      popularity: int(row.registerCount),
      event: {
        eventName: title,
        organiser: cleanOrganiser(str(organisation?.name, 200)),
        mode: unstopMode(str(row.region, 20)),
        city: tidy(str(address.city, 80), 80),
        state: tidy(str(address.state, 80), 80),
        country: unstopCountry(address.country),
        venue: tidy(str(address.address, 200), 200),
        startDate: localDate(row.start_date, 'Asia/Kolkata'),
        endDate: localDate(row.end_date, 'Asia/Kolkata'),
        registrationDeadline: localDate(regn.end_regn_dt, 'Asia/Kolkata'),
        registrationUrl: url,
        teamMin: int(regn.min_team_size),
        teamMax: int(regn.max_team_size),
        prizePool: unstopPrize(row.prizes),
        domains: unstopSkills(row.required_skills),
        eligibility: unstopEligibility(regn.eligibility),
      },
    });
  }
  return { events, total: int(data?.total), pages: int(data?.last_page), error: null };
}

// ── Devfolio ─────────────────────────────────────────────────────────────────

/**
 * Unstop sends `country` as a bare string on some rows and as
 * `{ id, name, alpha_2 }` on others — the object form is what every offline and
 * hybrid event carries. Reading only `country_name` there returned null, and a
 * null country means the India gate drops the row: it silently deleted every
 * Unstop hackathon a student could physically attend.
 */
function unstopCountry(value: unknown): string | null {
  const direct = tidy(str(value, 60), 60);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record) return null;
  return (
    tidy(str(record.name, 60), 60) ??
    tidy(str(record.country_name, 60), 60) ??
    tidy(str(record.alpha_2, 2), 2)
  );
}

function devfolioPrize(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const rows: { amount: number; currency: string | null }[] = [];
  const names: string[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    if (!row || row.hidden === true) continue;
    const amount = Number(row.amount);
    rows.push({ amount: Number.isFinite(amount) ? amount : 0, currency: str(row.currency, 10) });
    const name = tidy(str(row.name, 60), 60);
    if (name) names.push(name);
  }
  return sumPrizes(rows, names);
}

function themeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = tidy(str(row.name, 60), 60);
    // "No Restrictions" is a filler value, not a domain.
    if (name && !/^no restrictions?$/i.test(name)) out.push(name);
  }
  return [...new Set(out)].slice(0, 8);
}

/**
 * Devfolio's list API does not publish an organiser field — `hackathon_brand` is
 * populated for ~1% of rows. The organiser appears in the markdown `desc`
 * ("**Organized by Internwell SLIET Club**") for ~13%. Read it when present;
 * never invent one, because organiser is a mandatory field and a guessed value
 * would let an unverifiable event through the gate.
 */
function organiserFromDesc(value: unknown): string | null {
  const text = str(value, 4000);
  if (!text) return null;
  // Stops at sentence punctuation so a description that continues after the
  // name ("Organized by ISTE! We are…") does not become the organiser, and skips
  // a leading article so "organized by the X" yields "X" rather than "the".
  const match = /organi[sz]ed\s+by[:\s]*\**\s*(?:the\s+)?([^\n*|,.;!?]{2,80})/i.exec(text);
  return cleanOrganiser(match ? match[1] : null);
}

export function parseDevfolio(payload: unknown): StructuredPage {
  const root = asRecord(payload);
  const rows = Array.isArray(root?.result) ? root.result : [];
  const events: StructuredEvent[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const title = tidy(cleanEventTitle(str(row.name, 300)), 191);
    const slug = str(row.slug, 120);
    // Devfolio events live on their own subdomain; the root is the event page.
    const url = slug ? httpUrl(`https://${slug}.devfolio.co/`) : null;
    if (!title || !url) continue;
    const timezone = str(row.timezone, 60);
    const isOnline = row.is_online === true;
    const setting = asRecord(row.hackathon_setting) ?? {};
    const endsAt = localDate(row.ends_at, timezone);
    // The real registration window, populated for ~999/1000 rows. Falls back to
    // the submission close only when the setting block is absent.
    const regEnds = localDate(setting.reg_ends_at, timezone) ?? endsAt;
    const organiser =
      cleanOrganiser(str(row.hackathon_brand, 200)) ??
      cleanOrganiser(str(row.edition_name, 200)) ??
      organiserFromDesc(row.desc);
    events.push({
      url,
      nativeId: str(row.uuid, 60) ?? slug ?? url,
      popularity: int(row.participants_count),
      event: {
        eventName: title,
        organiser,
        mode: isOnline ? 'ONLINE' : row.is_online === false ? 'OFFLINE' : null,
        city: tidy(str(row.city, 80), 80),
        state: tidy(str(row.state, 80), 80),
        country: tidy(str(row.country, 60), 60),
        venue: tidy(str(row.location, 200), 200),
        startDate: localDate(row.starts_at, timezone),
        endDate: endsAt,
        registrationDeadline: regEnds,
        registrationUrl: url,
        teamMin: int(row.team_min),
        teamMax: int(row.team_size),
        prizePool: devfolioPrize(row.prizes),
        domains: themeNames(row.themes),
        eligibility: row.is_university_hackathon === true ? 'University students' : null,
      },
    });
  }
  return { events, total: int(root?.count), pages: int(root?.pages), error: null };
}

// ── Devpost ──────────────────────────────────────────────────────────────────

export function parseDevpost(payload: unknown, now: Date = new Date()): StructuredPage {
  const root = asRecord(payload);
  const rows = Array.isArray(root?.hackathons) ? root.hackathons : [];
  const events: StructuredEvent[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const title = tidy(cleanEventTitle(str(row.title, 300)), 191);
    const url = httpUrl(row.url);
    if (!title || !url) continue;
    const location = asRecord(row.displayed_location);
    const place = tidy(str(location?.location, 120), 120);
    const isOnline = location?.icon === 'globe' || (place ? /online|virtual|remote/i.test(place) : false);
    const range = parseDateRange(str(row.submission_period_dates, 80), now);
    // "San Francisco, CA, USA" → city + state, nothing invented when absent.
    const parts = place && !isOnline ? place.split(',').map((p) => p.trim()).filter(Boolean) : [];
    events.push({
      url,
      nativeId: str(row.id, 40) ?? url,
      popularity: int(row.registrations_count),
      event: {
        eventName: title,
        organiser: cleanOrganiser(str(row.organization_name, 200)),
        mode: isOnline ? 'ONLINE' : place ? 'OFFLINE' : null,
        city: parts.length > 0 ? parts[0].slice(0, 80) : null,
        state: parts.length > 1 ? parts[1].slice(0, 80) : null,
        venue: null,
        startDate: range.startDate,
        endDate: range.endDate,
        // Registration stays open until the submission period closes.
        registrationDeadline: range.endDate,
        registrationUrl: url,
        teamMin: null,
        teamMax: null,
        prizePool: tidy(str(row.prize_amount, 80), 80),
        domains: themeNames(row.themes),
        eligibility: null,
      },
    });
  }
  const meta = asRecord(root?.meta);
  return { events, total: int(meta?.total_count), pages: null, error: null };
}

// ── registry + fetch ─────────────────────────────────────────────────────────

export type StructuredSource = {
  sourceType: string;
  label: string;
  /** Hard cap on pages per run. These endpoints are undocumented: stay polite. */
  maxPages: number;
  pageUrl: (page: number) => string;
  parse: (payload: unknown, now: Date) => StructuredPage;
  /** Submission close == registration close on this platform. */
  registrationClosesWithSubmission?: boolean;
};

export const STRUCTURED_SOURCES: Record<string, StructuredSource> = {
  unstop: {
    sourceType: 'UNSTOP',
    label: 'Unstop',
    maxPages: 3,
    pageUrl: (page) =>
      `https://unstop.com/api/public/opportunity/search-new?opportunity=hackathons&page=${page}&per_page=100`,
    parse: parseUnstop,
  },
  devfolio: {
    sourceType: 'DEVFOLIO',
    label: 'Devfolio',
    maxPages: 2,
    pageUrl: (page) => `https://api.devfolio.co/api/hackathons?type=open&page=${page}`,
    parse: parseDevfolio,
  },
  devpost: {
    sourceType: 'DEVPOST',
    label: 'Devpost',
    maxPages: 2,
    pageUrl: (page) => `https://devpost.com/api/hackathons?challenge_type%5B%5D=online&page=${page}&per_page=50`,
    parse: parseDevpost,
    registrationClosesWithSubmission: true,
  },
};

export function isStructuredSource(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(STRUCTURED_SOURCES, key);
}

/**
 * Fetch and parse one page. Returns `error` rather than throwing: a dead
 * endpoint must surface in the run report, not abort discovery.
 */
export async function fetchStructuredPage(key: string, page = 1): Promise<StructuredPage> {
  const source = STRUCTURED_SOURCES[key];
  if (!source) return { events: [], total: null, pages: null, error: `unknown structured source ${key}` };
  const url = source.pageUrl(page);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { events: [], total: null, pages: null, error: `${key}: HTTP ${res.status}` };
    const contentType = res.headers.get('content-type') ?? '';
    // A rate-limit or maintenance page served as HTML parses as "no results",
    // which is indistinguishable from a genuinely empty source.
    if (!contentType.includes('json')) {
      return { events: [], total: null, pages: null, error: `${key}: unexpected content-type "${contentType.slice(0, 40)}"` };
    }
    const body = await res.text();
    if (body.length > MAX_BODY_CHARS) {
      return { events: [], total: null, pages: null, error: `${key}: response too large` };
    }
    const parsed = source.parse(JSON.parse(body), new Date());
    return { ...parsed, error: null };
  } catch (err) {
    return {
      events: [],
      total: null,
      pages: null,
      error: `${key}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    };
  }
}
