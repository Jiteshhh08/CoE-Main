/**
 * Keep the cached `hubScore` honest.
 *
 * Everything in the score is fixed at publish time except urgency, and urgency
 * only changes when a deadline crosses a tier (30 days, 7 days, passed). So the
 * set that can actually go stale is small: rows with a deadline inside the
 * widest tier plus a day of slack. Re-scoring that window is cheap enough to do
 * opportunistically before a "Most relevant" listing and deterministically from
 * the Hub cron. Without it, a row scored 29 days before its deadline kept the
 * low-urgency score forever, even on the day it closed.
 */
import prisma from '@/lib/prisma';
import { computeHubScore } from './ranking';

const DAY_MS = 86_400_000;
/** 30-day tier + 7-day tier, with a day of timezone/clock slack on both sides. */
const WINDOW_DAYS = 32;

export type ScoredRow = {
  id: number;
  hubScore: number | null;
  popularity: number | null;
  registrationDeadline: Date | null;
  prize: string | null;
  mode: string | null;
  country: string | null;
  verificationStatus: string;
};

export type ScoreUpdate = { id: number; previous: number | null; next: number };

/** Pure: which rows would change, and to what. */
export function staleScoreUpdates(rows: ScoredRow[], now = Date.now()): ScoreUpdate[] {
  return rows.flatMap((row) => {
    const next = computeHubScore(
      {
        popularity: row.popularity,
        registrationDeadline: row.registrationDeadline,
        prize: row.prize,
        mode: row.mode,
        country: row.country,
        verificationStatus: row.verificationStatus,
      },
      now,
    );
    return next === row.hubScore ? [] : [{ id: row.id, previous: row.hubScore, next }];
  });
}

/**
 * Re-score the rows whose urgency can have changed. Bounded by the deadline
 * window, so this never turns into a full-table scan on a page request. Rows
 * with no deadline are excluded deliberately: their urgency is a constant, so
 * their score cannot drift.
 */
export async function refreshStaleHubScores(now = new Date()): Promise<{ scanned: number; updated: number }> {
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const to = new Date(now.getTime() + WINDOW_DAYS * DAY_MS);

  const rows = await prisma.opportunity.findMany({
    // Same visibility rule the listing uses: a score nobody can rank is not worth
    // writing, and this runs on a page request.
    where: { status: 'APPROVED', showInHub: true, registrationDeadline: { not: null, gte: from, lt: to } },
    select: {
      id: true,
      hubScore: true,
      popularity: true,
      registrationDeadline: true,
      prize: true,
      mode: true,
      country: true,
      verificationStatus: true,
    },
  });

  const updates = staleScoreUpdates(rows, now.getTime());
  // Optimistic on the previous value: a concurrent publish that already wrote a
  // newer score is never clobbered by this refresh.
  const results = await Promise.all(
    updates.map((update) =>
      prisma.opportunity.updateMany({
        where: { id: update.id, hubScore: update.previous },
        data: { hubScore: update.next },
      }),
    ),
  );

  // Count what the guard actually matched, not what we attempted: an update that
  // lost the race changed nothing and the caller should not be told otherwise.
  return { scanned: rows.length, updated: results.reduce((total, r) => total + r.count, 0) };
}
