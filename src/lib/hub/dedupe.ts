/**
 * Cross-source event identity.
 *
 * The same hackathon is routinely listed on several platforms at once — an
 * organiser posts to Unstop, Devpost mirrors it, Devfolio has its own page. No
 * shared id exists between them, so the only reliable signal is the title.
 *
 * Two rules keep this from fusing genuinely different events:
 *   1. A title must be distinctive (>= 12 normalized chars). "Hackathon 2026"
 *      is not evidence of anything.
 *   2. Matching titles must not disagree about when the event starts. That is
 *      what keeps "Codefest 2026" and "Codefest 2027" apart, and it also
 *      separates an annual edition from last year's.
 *
 * Both the discovery stage and the publish step route through here, so a
 * duplicate cannot slip through one layer by being accepted in the other.
 */
import { cleanEventTitle, normalizeName } from '@/lib/hackathon-hub';

export const MIN_DISTINCTIVE_TITLE = 12;

// Titles made only of event-type words and a year carry no identity: "Hackathon
// 2026" is 14 normalized characters, so length alone would happily key it and
// fuse two unrelated events from two platforms.
const GENERIC_WORDS = new Set([
  'hackathon', 'hackathons', 'hackfest', 'hack', 'codefest', 'ideathon',
  'datathon', 'competition', 'challenge', 'contest', 'event', 'hackdays',
]);

function isGenericTitle(normalized: string): boolean {
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0) return true;
  return words.every((word) => GENERIC_WORDS.has(word) || /^(19|20)\d{2}$/.test(word));
}
/** Start dates further apart than this are different editions, not a duplicate. */
const DATE_TOLERANCE_MS = 2 * 86_400_000;

export type EventIdentity = {
  title: string | null | undefined;
  /** ISO string from an extraction, or a Date straight out of Prisma. */
  startDate?: string | Date | null;
  organiser?: string | null;
};

/** Normalized comparison key, or null when the title is too generic to trust. */
export function titleKey(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null;
  const normalized = normalizeName(cleanEventTitle(title));
  if (normalized.length < MIN_DISTINCTIVE_TITLE) return null;
  return isGenericTitle(normalized) ? null : normalized;
}

function startMs(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when two records describe the same edition of the same event.
 * A missing start date on either side is not a contradiction — the title alone
 * then decides, which is the previous behaviour preserved.
 */
export function isSameEvent(a: EventIdentity, b: EventIdentity): boolean {
  const ka = titleKey(a.title);
  const kb = titleKey(b.title);
  if (!ka || !kb || ka !== kb) return false;
  const da = startMs(a.startDate);
  const db = startMs(b.startDate);
  if (da !== null && db !== null && Math.abs(da - db) > DATE_TOLERANCE_MS) return false;
  return true;
}

export type ExistingIndex = Map<string, (string | null)[]>;

/**
 * Load every title already known (published opportunities + pending candidates)
 * into one map, so the discovery stage can dedupe a thousand events with a
 * thousand lookups instead of a thousand queries.
 *
 * ponytail: in-memory, capped at 5000 rows per side. Past that, add a
 * normalized-title column with an index and query it directly.
 */
export async function loadExistingIndex(
  opportunities: { title: string; startDate: Date | string | null }[],
  candidates: { title: string | null; extracted: unknown }[],
): Promise<ExistingIndex> {
  const index: ExistingIndex = new Map();
  for (const row of opportunities) {
    addToIndex(index, { title: row.title, startDate: row.startDate });
  }
  for (const row of candidates) {
    const extracted = (row.extracted ?? null) as { startDate?: string | null } | null;
    addToIndex(index, { title: row.title, startDate: extracted?.startDate ?? null });
  }
  return index;
}

/** Normalise a Date|string to an ISO string for storage in the index. */
function toIso(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === 'string' && value ? value : null;
}

export function addToIndex(index: ExistingIndex, identity: EventIdentity): void {
  const key = titleKey(identity.title);
  if (!key) return;
  const bucket = index.get(key);
  const date = toIso(identity.startDate);
  if (bucket) {
    if (!bucket.includes(date)) bucket.push(date);
    return;
  }
  index.set(key, [date]);
}

/** Would this event duplicate something already indexed? */
export function indexHas(index: ExistingIndex, identity: EventIdentity): boolean {
  const key = titleKey(identity.title);
  if (!key) return false;
  const bucket = index.get(key);
  if (!bucket) return false;
  const incoming = startMs(identity.startDate);
  // Same distinctive title and nothing contradicts it => same event.
  if (incoming === null) return true;
  return bucket.some((existing) => {
    const ms = startMs(existing);
    return ms === null || Math.abs(ms - incoming) <= DATE_TOLERANCE_MS;
  });
}
