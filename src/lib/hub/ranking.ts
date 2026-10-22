/**
 * Ranking signals for the Hub.
 *
 * "Don't show me a million events" is two separate problems. Most of what the
 * platforms hand back is already over — Devfolio's `type=open` returned 1,969
 * already-started events out of 2,000 — and the rest arrives in no order at
 * all. So: drop what cannot be joined, then rank what is left.
 *
 * Popularity is measured, never invented: every one of these platforms
 * publishes its own signup count. The scales are not comparable (Devfolio's
 * median is roughly 11x Unstop's), so counts are converted to a percentile
 * *within their own source* before anything mixes them.
 */
import type { ExtractedEvent } from './extract';

/**
 * Percentile (0-100) of each value within its own list. A null means the source
 * published no count — treated as "unproven", not as "unpopular", so it scores
 * zero rather than dragging the scale.
 */
export function percentileRanks(values: Array<number | null>): Array<number | null> {
  const present = values.filter((v): v is number => typeof v === 'number' && v > 0);
  if (present.length === 0) return values.map(() => null);
  // ponytail: O(n^2) over at most ~1,000 rows per source, which is instant and
  // keeps ties exact. Swap for a sorted-index lookup if a source ever returns
  // six figures.
  return values.map((v) =>
    typeof v === 'number' && v > 0
      ? Math.round((present.filter((x) => x <= v).length / present.length) * 100)
      : null,
  );
}

/**
 * Already over, therefore unjoinable. An event that ends today is still kept —
 * on-the-spot registration is real. Unknown dates are never assumed to be over.
 */
export function isOver(event: ExtractedEvent, now = Date.now()): boolean {
  const end = event.endDate ?? event.startDate;
  if (!end) return false;
  const t = Date.parse(end);
  if (!Number.isFinite(t)) return false;
  const today = new Date(now);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return t < startOfToday;
}

/**
 * Relevance for a TCET student, 0-100.
 *
 * The weights are a judgement call, kept here so they can be retuned in one
 * place. Everything they read is real data from the source except
 * `verificationStatus`, which is our own review state.
 */
export const RELEVANCE_WEIGHTS = {
  /** How many people signed up, relative to that source's other events. */
  popularity: 45,
  /** Can a student at this college actually take part. */
  reachable: 25,
  /** Open now and closing soon beats open now and closing later. */
  urgency: 15,
  /** A stated prize pool. */
  prize: 10,
  /** Someone here checked it by hand. */
  verified: 5,
} as const;

const INDIA = new Set(['india', 'in', 'bharat']);

/**
 * Where an event is allowed to be. Online is welcome from anywhere — a remote
 * hackathon in Berlin is as joinable as one in Mumbai. Offline has to be in
 * India, because that is where a student at this college can actually turn up.
 *
 * Offline with no country is dropped rather than assumed Indian. Devfolio
 * publishes 179 such rows and not one of them carries a city or state either,
 * so there is nothing to confirm the location with. Guessing here would put
 * unverifiable events in front of students.
 */
export function isAttendable(event: { mode: string | null; country?: string | null }): boolean {
  if (event.mode === 'ONLINE') return true;
  const country = (event.country ?? '').trim().toLowerCase();
  if (!country) return false;
  return INDIA.has(country);
}

/** Points for whether a TCET student can realistically attend. */
export function reachabilityPoints(o: { mode: string | null; country?: string | null }): number {
  if (o.mode === 'ONLINE') return RELEVANCE_WEIGHTS.reachable;
  const country = (o.country ?? '').trim().toLowerCase();
  if (INDIA.has(country)) return Math.round(RELEVANCE_WEIGHTS.reachable * 0.8);
  if (!country) return Math.round(RELEVANCE_WEIGHTS.reachable * 0.5);
  return Math.round(RELEVANCE_WEIGHTS.reachable * 0.2);
}

const NO_PRIZE = /^(none|no prize|nil|tbd|-|—)$/i;

export type RankableOpportunity = {
  popularity: number | null;
  registrationDeadline: Date | null;
  prize: string | null;
  mode: string | null;
  country?: string | null;
  verificationStatus: string;
};

export function computeHubScore(o: RankableOpportunity, now = Date.now()): number {
  let score = ((o.popularity ?? 0) / 100) * RELEVANCE_WEIGHTS.popularity;
  score += reachabilityPoints(o);

  if (o.registrationDeadline) {
    const days = (o.registrationDeadline.getTime() - now) / 86_400_000;
    if (days < 0) score += 0;
    else if (days <= 7) score += RELEVANCE_WEIGHTS.urgency;
    else if (days <= 30) score += Math.round(RELEVANCE_WEIGHTS.urgency * 0.66);
    else score += Math.round(RELEVANCE_WEIGHTS.urgency * 0.33);
  } else {
    score += Math.round(RELEVANCE_WEIGHTS.urgency * 0.2);
  }

  const prize = (o.prize ?? '').trim();
  if (prize && !NO_PRIZE.test(prize)) score += RELEVANCE_WEIGHTS.prize;

  if (o.verificationStatus === 'ADMIN_VERIFIED' || o.verificationStatus === 'VERIFIED') {
    score += RELEVANCE_WEIGHTS.verified;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
