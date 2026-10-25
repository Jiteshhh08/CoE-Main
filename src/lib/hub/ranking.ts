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
import { hubDaysUntil } from '@/lib/hackathon-hub';

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
export function isOver(event: { startDate?: string | null; endDate?: string | null }, now = Date.now()): boolean {
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

import { resolveHubCity } from './cities';

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
export function isAttendable(event: {
  mode: string | null;
  country?: string | null;
  city?: string | null;
}): boolean {
  if (event.mode === 'ONLINE') return true;
  const country = (event.country ?? '').trim().toLowerCase();
  if (country) return INDIA.has(country);
  // No country field, but a city we can place. The Hub city registry is an
  // India-only list, so a recognised city is positive evidence of India — not an
  // assumption. indiahackathons never publishes a country, and treating the gap
  // as "probably abroad" deleted 75 real in-person Indian hackathons (Hyderabad,
  // Mumbai, Chennai, Jaipur) that the Hub exists to surface. A city we do not
  // recognise still fails, so genuinely unknown locations are not guessed at.
  return Boolean(resolveHubCity(event.city));
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
    // Whole calendar days, not elapsed milliseconds. A deadline published as a
    // bare date is stored at midnight; comparing instants made it "passed" at
    // 00:00 of the day it closes and dropped 15 urgency points, so the score
    // decayed every night. Day arithmetic keeps one value for the whole day and
    // makes the cached number change only when a tier actually changes.
    const days = hubDaysUntil(o.registrationDeadline, new Date(now));
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

/**
 * Why an event may not be published at all, or null when it may.
 *
 * Discovery, extraction and revalidation must all ask this identical question.
 * They did not: the gates lived only in discovery, and the extraction path — the
 * one every crawled candidate takes — had no idea they existed, so 58 finished
 * and 75 offline-outside-India events went from crawl to verified to the live
 * Hub without either question being asked. One function, three callers.
 */
export function rejectionReason(
  event: { mode: string | null; country?: string | null; city?: string | null; endDate?: string | null },
  now: number = Date.now(),
): string | null {
  if (isOver(event, now)) return 'Event already finished';
  if (!isAttendable(event)) return 'Offline event outside India';
  return null;
}
