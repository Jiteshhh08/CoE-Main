import prisma from '@/lib/prisma';
import { normalizeName, cleanEventTitle, getRegistrationStatus, getEventStatus, clipDbString, fitUrl } from '@/lib/hackathon-hub';
import { isSameEvent, titleKey } from './dedupe';
import { computeHubScore } from './ranking';
import { cityCoords } from './cities';
import { coerceDateRange, toDbDate } from './dates';
import type { ExtractedEvent } from './extract';
import { mandatoryMissing } from './extract';

// Verification states that mean "a human/authoritative source vouched for
// this row". Automated publication and CSV import must never overwrite them.
export const CURATED_VERIFICATION_STATUSES = ['VERIFIED', 'ADMIN_VERIFIED', 'OFFICIAL_SOURCE'] as const;

export function isCuratedVerification(status: string | null | undefined): boolean {
  return typeof status === 'string' && (CURATED_VERIFICATION_STATUSES as readonly string[]).includes(status);
}

export const PLACEHOLDER_DESCRIPTION_PREFIX = 'Auto-published with missing fields:';

export function isPlaceholderDescription(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().startsWith(PLACEHOLDER_DESCRIPTION_PREFIX);
}

// Candidate lifecycle states (§18). String union (not a DB enum) so no
// migration is needed; importing this instead of string literals keeps
// typos ('VERIFYED') a compile error rather than an invisible state.
export const HUB_CANDIDATE_STATUSES = [
  'DISCOVERED',
  'PROCESSING',
  'EXTRACTED',
  'NEEDS_REVIEW',
  'VERIFIED',
  'PUBLISHED',
  'REJECTED',
  'NEEDS_UPDATE',
] as const;
export type HubCandidateStatus = (typeof HUB_CANDIDATE_STATUSES)[number];
export const isHubCandidateStatus = (value: unknown): value is HubCandidateStatus =>
  typeof value === 'string' && (HUB_CANDIDATE_STATUSES as readonly string[]).includes(value);

// Promotion: VERIFIED candidate → Opportunity (§18 VERIFIED→PUBLISHED).
// R12: never auto-publish incomplete rows; publish is an explicit admin act.
export type PublishResult = {
  opportunityId: number;
  merged: boolean;
  conflict?: boolean;
  reason?: string;
};

export async function publishCandidate(candidateId: number, actorId: number): Promise<PublishResult> {
  const candidate = await prisma.hubCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new Error('Candidate not found');
  if (!(['VERIFIED', 'NEEDS_REVIEW', 'NEEDS_UPDATE'] as const).some((s) => s === candidate.status)) {
    throw new Error(`Cannot publish from status ${candidate.status}`);
  }
  const e = (candidate.extracted ?? {}) as Partial<ExtractedEvent>;
  // Admin clicking Publish IS the human verification (§36.3): missing fields
  // stay NULL (§41.1) instead of blocking. Only title is truly required.
  const missing = mandatoryMissing(e as ExtractedEvent);
  if (!e.eventName && !candidate.title) {
    throw new Error(`Nothing to publish — missing: ${missing.join(', ')}`);
  }

  const title = cleanEventTitle(e.eventName ?? candidate.title) || 'Untitled hackathon';
  const organizer = e.organiser ?? 'Unknown organizer';

  // Dedupe (§16): URL first, then normalized name+organizer (skipped when unknown).
  let existing: {
    id: number;
    description: string | null;
    verificationStatus: string;
  } | null = null;
  if (e.registrationUrl) {
    existing =
      (await prisma.opportunity.findFirst({ where: { sourceUrl: e.registrationUrl } })) ??
      (await prisma.opportunity.findFirst({ where: { applicationUrl: e.registrationUrl } }));
  }
  if (!existing && e.eventName) {
    const identity = { title: e.eventName, startDate: e.startDate, organiser: e.organiser };
    // Organiser first (cheap, narrow), then the whole table by title.
    // Cross-source listings almost never agree on the organiser string ("Unstop"
    // vs "PCCOE GFG Student Chapter"), so a distinctive title is the only shared
    // signal. isSameEvent() also refuses to fuse two editions of one event: a
    // matching title with start dates months apart is a different year, and
    // titles that are only event-words ("Codefest 2026") never key at all.
    // ponytail: in-memory scan capped at 500 rows; move to a normalized-title
    // column with an index if the opportunity table outgrows that.
    const RIVAL_SELECT = { id: true, title: true, description: true, verificationStatus: true, startDate: true };
    if (e.organiser) {
      const rivals = await prisma.opportunity.findMany({
        where: { organizer: e.organiser },
        select: RIVAL_SELECT,
        take: 50,
      });
      existing = rivals.find((r) => isSameEvent(identity, r)) ?? null;
    }
    if (!existing && titleKey(e.eventName)) {
      const rivals = await prisma.opportunity.findMany({ select: RIVAL_SELECT, take: 500 });
      existing = rivals.find((r) => isSameEvent(identity, r)) ?? null;
    }
  }

  // Conflict policy (shared with CSV import): curated rows are review-only.
  // Automation must not downgrade them, and an explicit publish click is not
  // permission to destroy verified data — flag it for a human merge instead.
  if (existing && isCuratedVerification(existing.verificationStatus)) {
    const reason = `Curated record #${existing.id} (${existing.verificationStatus}) — not overwritten; review and merge manually.`;
    await prisma.hubCandidate.update({
      where: { id: candidateId },
      data: { status: 'NEEDS_UPDATE' satisfies HubCandidateStatus, opportunityId: existing.id, error: reason },
    });
    return { opportunityId: existing.id, merged: false, conflict: true, reason };
  }

  const dates = coerceDateRange(e.startDate, e.endDate);
  // Percentile comes out of stored JSON, so it is re-validated here rather than
  // trusted to still be a 0-100 integer.
  const popularityRaw = Number(e.popularity);
  const popularity =
    Number.isFinite(popularityRaw) && popularityRaw > 0
      ? Math.max(0, Math.min(100, Math.round(popularityRaw)))
      : null;
  // Scored from the same values we are about to write, so the cached number and
  // what the Hub displays can never drift apart.
  const hubScore = computeHubScore({
    popularity,
    registrationDeadline: toDbDate(e.registrationDeadline),
    prize: clipDbString(e.prizePool),
    mode: e.mode ?? null,
    country: clipDbString(e.country),
    verificationStatus: 'ADMIN_VERIFIED',
  });
  const registrationsRaw = Number(e.registrations);
  const registrations =
    Number.isFinite(registrationsRaw) && registrationsRaw > 0 ? Math.round(registrationsRaw) : null;
  const record = {
    title: clipDbString(title) as string,
    category: 'Hackathon',
    organizer: clipDbString(organizer) as string,
    description: missing.length > 0
      ? `${PLACEHOLDER_DESCRIPTION_PREFIX} ${missing.join(', ')} — verify on the official page.`
      : null,
    // Persistence boundary: untrusted/AI dates become NULL, never an Invalid
    // Date handed to Prisma, and never a guessed substitute.
    registrationDeadline: toDbDate(e.registrationDeadline),
    eligibility: clipDbString(e.eligibility),
    prize: clipDbString(e.prizePool),
    themes: e.domains?.length ? e.domains : undefined,
    applicationUrl: fitUrl(e.registrationUrl),
    mode: e.mode ?? null,
    venue: clipDbString(e.venue),
    city: clipDbString(e.city),
    state: clipDbString(e.state),
    startDate: toDbDate(dates.startDate),
    endDate: toDbDate(dates.endDate),
    teamMin: e.teamMin ?? null,
    teamMax: e.teamMax ?? null,
    country: clipDbString(e.country),
    popularity,
    registrations,
    hubScore,
    sourceUrl: candidate.url,
    sourceType: candidate.sourceType,
    pageHash: candidate.pageHash ?? null,
  };

  let opportunityId: number;
  if (existing) {
    // Legitimate refresh of an unverified pipeline row: apply non-null values
    // only, so a thin re-extraction cannot erase real data it failed to find.
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value !== null && value !== undefined) update[key] = value;
    }
    if (isPlaceholderDescription(record.description) && existing.description && !isPlaceholderDescription(existing.description)) {
      update.description = existing.description;
    }
    const updated = await prisma.opportunity.update({
      where: { id: existing.id },
      data: {
        ...update,
        status: 'APPROVED',
        showInHub: true,
        verificationStatus: 'ADMIN_VERIFIED',
        lastVerifiedAt: new Date(),
      },
    });
    opportunityId = updated.id;
  } else {
    const created = await prisma.opportunity.create({
      data: {
        ...record,
        status: 'APPROVED',
        showInHub: true,
        verificationStatus: 'ADMIN_VERIFIED',
        lastVerifiedAt: new Date(),
        createdById: actorId,
      },
    });
    opportunityId = created.id;
  }

  await prisma.hubCandidate.update({
    where: { id: candidateId },
    data: { status: 'PUBLISHED' satisfies HubCandidateStatus, opportunityId, error: null },
  });
  return { opportunityId, merged: Boolean(existing) };
}

// Change detection (§21): re-hash source pages; on hash drift, re-extract and
// diff important fields. Important-field drift → NEEDS_UPDATE + admin notify.
export const IMPORTANT_FIELDS = [
  'registrationDeadline', 'prize', 'eligibility', 'teamMin', 'teamMax', 'venue', 'startDate', 'endDate',
] as const;

export function diffImportant(
  current: Record<string, unknown>,
  fresh: Record<string, unknown>,
): { field: string; from: unknown; to: unknown }[] {
  const diffs: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of IMPORTANT_FIELDS) {
    const a = current[field] instanceof Date ? (current[field] as Date).toISOString() : (current[field] ?? null);
    const b = fresh[field] instanceof Date ? (fresh[field] as Date).toISOString() : (fresh[field] ?? null);
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ field, from: a, to: b });
  }
  return diffs;
}

// Admin dashboard rollup (§39).
export async function hubStats() {
  const [opportunities, candidates] = await Promise.all([
    prisma.opportunity.findMany({
      select: { id: true, registrationDeadline: true, startDate: true, endDate: true, createdAt: true, status: true },
      take: 1000,
    }),
    prisma.hubCandidate.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  let active = 0, closingSoon = 0, expired = 0, newThisWeek = 0;
  for (const o of opportunities) {
    if (o.status !== 'APPROVED') continue;
    const reg = getRegistrationStatus(o.registrationDeadline, now);
    const ev = getEventStatus(o.startDate ?? null, o.endDate ?? null, now);
    if (reg === 'OPEN' || reg === 'CLOSING_SOON') active++;
    if (reg === 'CLOSING_SOON') closingSoon++;
    if (ev === 'COMPLETED') expired++;
    if (new Date(o.createdAt) >= weekAgo) newThisWeek++;
  }
  const needsReview = candidates
    .filter((c: { status: string }) => ['NEEDS_REVIEW', 'NEEDS_UPDATE'].includes(c.status))
    .reduce((n: number, c: { _count: { _all: number } }) => n + c._count._all, 0);
  return {
    totalEvents: opportunities.length,
    active, closingSoon, needsReview, expired, newThisWeek,
    byStatus: candidates,
  };
}

// Distance from TCET (§37–38, Phase 2-lite: known-city Haversine, display only).
// Coordinates come from the same registry extraction uses (cities.ts).
const TCET = { lat: 19.2066, lon: 72.8735 };

export function kmFromTcet(city: string | null): number | null {
  const coords = cityCoords(city);
  if (!coords) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(coords.lat - TCET.lat);
  const dLon = toRad(coords.lon - TCET.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(TCET.lat)) * Math.cos(toRad(coords.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}
