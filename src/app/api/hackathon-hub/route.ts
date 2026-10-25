import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { authenticate, authorize, successRes, errorRes } from '@/lib/api-helpers';
import { getRegistrationStatus, getEventStatus } from '@/lib/hackathon-hub';
import { kmFromTcet } from '@/lib/hub/pipeline';
import { refreshStaleHubScores } from '@/lib/hub/score-refresh';

// GET /api/hackathon-hub — public student listing (Phase 1, spec §28-29)
// Filters: search, city, mode, domain (themes/technologies), month (YYYY-MM),
// regStatus, eventStatus, sort — plus cursor pagination.
//
// Design notes:
// - month/city/mode/search are DB predicates, so they run before any limit.
// - domain cannot be a DB predicate on this provider: themes/technologies are
//   JSON columns and Prisma's MySQL JSON filters cannot match inside an array
//   (verified: string_contains/path filters return zero rows). So we scan the
//   ordered result set page by page and keep scanning until the requested page
//   is full — filters still run before the result limit, which is what the
//   previous `take: 200`-then-filter broke.
// - regStatus/eventStatus are derived from dates and are also applied during
//   that scan for the same reason.

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const SCAN_PAGE = 100;
const MAX_SCAN_ROWS = 2000;

// Process-local limiter. Production is a single pm2 process on the
// self-hosted runner (AGENTS.md deploy), so this is effective there; if the
// app is ever scaled horizontally this must move to shared storage.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const RATE_MAX_KEYS = 10_000;
const rateHits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now: number): boolean {
  const entry = rateHits.get(key);
  if (!entry || entry.resetAt <= now) {
    if (rateHits.size >= RATE_MAX_KEYS) {
      // Hard memory bound: evict the oldest key in O(1). Expired windows are
      // reclaimed as new keys arrive; the limiter stays best-effort, and the
      // single-process assumption noted above still applies.
      const oldest = rateHits.keys().next();
      if (!oldest.done) rateHits.delete(oldest.value);
    }
    rateHits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// The cached hubScore only decays when a deadline crosses an urgency tier, so
// refreshing the small near-deadline window once per window is enough. The
// process-local guard matches the deployment assumption documented on the rate
// limiter; the Hub cron calls the same function as a backstop.
const SCORE_REFRESH_MS = 5 * 60_000;
let lastScoreRefreshAt = 0;

async function refreshScoresIfStale(now: Date): Promise<void> {
  if (now.getTime() - lastScoreRefreshAt < SCORE_REFRESH_MS) return;
  // Claim before awaiting so concurrent requests do not stampede the update.
  lastScoreRefreshAt = now.getTime();
  try {
    const { updated } = await refreshStaleHubScores(now);
    if (updated > 0) console.log(`Hub score refresh: ${updated} cached scores updated`);
  } catch (err) {
    // A listing must still render if the opportunistic refresh fails.
    lastScoreRefreshAt = 0;
    console.error('Hub score refresh failed:', err);
  }
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthRange(month: string): { start: Date; end: Date } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

type Row = {
  id: number;
  title: string;
  category: string;
  organizer: string;
  description: string | null;
  registrationDeadline: Date | null;
  eligibility: string | null;
  prize: string | null;
  themes: Prisma.JsonValue;
  technologies: Prisma.JsonValue;
  applicationUrl: string | null;
  facultyRecommended: boolean;
  status: string;
  mode: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  startDate: Date | null;
  endDate: Date | null;
  teamMin: number | null;
  teamMax: number | null;
  sourceUrl: string | null;
  sourceType: string;
  country: string | null;
  registrations: number | null;
  verificationStatus: string;
  lastVerifiedAt: Date | null;
  createdAt: Date;
};

/** Ordering the Hub offers. `relevant` is the default (see the sort block). */
const SORT_KEYS = ['relevant', 'popular', 'upcoming', 'deadline', 'newest'] as const;
type SortKey = (typeof SORT_KEYS)[number];

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    if (rateLimited(clientKey(req), now.getTime())) {
      return errorRes('Too many requests. Please retry shortly.', ['RATE_LIMITED'], 429);
    }

    const user = authenticate(req);
    const { searchParams } = req.nextUrl;
    const search = searchParams.get('search')?.trim().slice(0, 100) || undefined;
    const city = searchParams.get('city')?.trim().slice(0, 191) || undefined;
    const modeRaw = searchParams.get('mode')?.trim().toUpperCase() || undefined;
    const mode = modeRaw && ['ONLINE', 'OFFLINE', 'HYBRID'].includes(modeRaw) ? modeRaw : undefined;
    const domain = searchParams.get('domain')?.trim().toLowerCase().slice(0, 40) || undefined;
    const month = searchParams.get('month')?.trim() || undefined;
    const regStatusFilter = searchParams.get('regStatus')?.trim().toUpperCase() || undefined;
    const eventStatusFilter = searchParams.get('eventStatus')?.trim().toUpperCase() || undefined;
    // "relevant" is the default: the Hub should open on the events most worth
    // a student's attention, not on whatever was ingested most recently.
    const sortRaw = searchParams.get('sort')?.trim().toLowerCase();
    const sort: SortKey = SORT_KEYS.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : 'relevant';

    const limitRaw = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

    const cursorRaw = searchParams.get('cursor');
    let cursor: number | null = null;
    if (cursorRaw !== null) {
      const parsed = Number(cursorRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return errorRes('Invalid cursor', ['cursor must be a positive integer'], 400);
      }
      const anchor = await prisma.opportunity.findUnique({ where: { id: parsed }, select: { id: true } });
      if (!anchor) return errorRes('Invalid or stale cursor', ['cursor no longer exists'], 400);
      cursor = parsed;
    }

    const range = month ? monthRange(month) : null;

    // Sorts that mean "soonest" must not lead with things that already happened.
    // MySQL also sorts NULLs first under ASC, which sprinkled undated rows through
    // the top of every ascending list, so each date sort now constrains the field
    // it orders by. `today` (not `now`) so a deadline dated today still counts.
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // A hub listing should not surface events that are over and unjoinable.
    // Excluded only when registration closed AND the event ended; closed
    // registration on a still-running event is a legitimate card.
    //
    // "Registration closed" uses the same effective close as the rest of the
    // Hub: the published deadline, else the start date (a source that publishes
    // no deadline closes when the event starts). Requiring a non-null
    // `registrationDeadline` here left every deadline-less finished event in the
    // listing forever — the card correctly read "Closes when it starts", but the
    // API still treated it as joinable.
    //
    // Every comparison is null-guarded on purpose. A bare `lt` on a null column
    // yields NULL, and `NOT (TRUE AND NULL)` is NULL, so unguarded rows with a
    // missing date were silently dropped from the whole listing.
    const registrationClosed = {
      OR: [
        { registrationDeadline: { not: null, lt: today } },
        { registrationDeadline: null, startDate: { not: null, lt: today } },
      ],
    } satisfies Prisma.OpportunityWhereInput;
    const deadEvent: Prisma.OpportunityWhereInput = {
      NOT: {
        AND: [
          registrationClosed,
          {
            OR: [
              { endDate: { not: null, lt: today } },
              { AND: [{ endDate: null }, { startDate: { not: null, lt: today } }] },
            ],
          },
        ],
      },
    };

    const where: Prisma.OpportunityWhereInput = {
      status: 'APPROVED',
      showInHub: true,
      ...(city ? { city: { equals: city } } : {}),
      ...(mode ? { mode } : {}),
      ...(range
        ? {
            // "When" means when the event runs, not when it starts: an event
            // already under way still belongs to this month.
            AND: [
              { startDate: { lt: range.end } },
              {
                OR: [
                  { endDate: { gte: range.start } },
                  { endDate: null, registrationDeadline: { gte: range.start } },
                  { endDate: null, registrationDeadline: null, startDate: { gte: range.start } },
                ],
              },
            ],
          }
        : {}),
      ...deadEvent,
      ...(search
        ? {
            OR: [
              { title: { contains: search } },
              { organizer: { contains: search } },
              { description: { contains: search } },
            ],
          }
        : {}),
    };

    // Each sort constrains the field it sorts on, so "soonest" cannot lead with
    // a null or a past date.
    if (sort === 'deadline') {
      where.registrationDeadline = { gte: today };
    } else if (sort === 'upcoming') {
      where.startDate = { gte: today };
    }

    // MySQL sorts NULLs as the lowest value, so a missing score or count lands
    // last under DESC — unscored rows never outrank scored ones.
    const orderBy: Prisma.OpportunityOrderByWithRelationInput[] =
      sort === 'deadline'
        ? [{ registrationDeadline: 'asc' }, { id: 'asc' }]
        : sort === 'popular'
          ? [{ registrations: 'desc' }, { id: 'desc' }]
          : sort === 'upcoming'
            ? [{ startDate: 'asc' }, { id: 'asc' }]
            : sort === 'newest'
              ? [{ createdAt: 'desc' }, { id: 'desc' }]
              : [{ hubScore: 'desc' }, { registrationDeadline: 'asc' }, { id: 'desc' }];

    // Explicit select: internal fields (createdById = staff user ids,
    // pageHash = crawler state) must never leave this public endpoint.
    // verificationStatus + sourceUrl + lastVerifiedAt stay: they are the
    // spec §35 trust display (badge + source link), and sourceUrl can only
    // ever be an https URL (validator + fitUrl guards).
    const select = {
      id: true,
      title: true,
      category: true,
      organizer: true,
      description: true,
      registrationDeadline: true,
      eligibility: true,
      prize: true,
      themes: true,
      technologies: true,
      applicationUrl: true,
      facultyRecommended: true,
      status: true,
      mode: true,
      venue: true,
      city: true,
      state: true,
      startDate: true,
      endDate: true,
      teamMin: true,
      teamMax: true,
      sourceUrl: true,
      sourceType: true,
      country: true,
      registrations: true,
      verificationStatus: true,
      lastVerifiedAt: true,
      createdAt: true,
    } satisfies Prisma.OpportunitySelect;

    const matchesDerived = (row: Row): boolean => {
      if (regStatusFilter && ['OPEN', 'CLOSING_SOON', 'CLOSED'].includes(regStatusFilter)) {
        if (getRegistrationStatus(row.registrationDeadline ?? row.startDate ?? null, now) !== regStatusFilter) return false;
      }
      if (eventStatusFilter && ['UPCOMING', 'ONGOING', 'COMPLETED'].includes(eventStatusFilter)) {
        if (getEventStatus(row.startDate ?? null, row.endDate ?? null, now) !== eventStatusFilter) return false;
      }
      if (domain) {
        const themes = Array.isArray(row.themes) ? (row.themes as string[]) : [];
        const techs = Array.isArray(row.technologies) ? (row.technologies as string[]) : [];
        if (![...themes, ...techs].some((t) => String(t).toLowerCase().includes(domain))) return false;
      }
      return true;
    };

    // "Most relevant" is the only order that reads the cached score. Refresh
    // the near-deadline window first so the page is ordered by today's
    // relevance, not by the relevance the row had when it was published.
    if (sort === 'relevant') await refreshScoresIfStale(now);

    const collected: Row[] = [];
    let scanCursor = cursor;
    let scanned = 0;
    let exhausted = false;
    let lastScannedId: number | null = null;

    while (collected.length <= limit && scanned < MAX_SCAN_ROWS && !exhausted) {
      const batch = await prisma.opportunity.findMany({
        where,
        orderBy,
        take: SCAN_PAGE,
        ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
        select,
      });
      if (batch.length === 0) {
        exhausted = true;
        break;
      }
      for (const row of batch) {
        scanned += 1;
        lastScannedId = row.id;
        if (!matchesDerived(row)) continue;
        collected.push(row);
        if (collected.length > limit) break;
      }
      scanCursor = batch[batch.length - 1].id;
      if (batch.length < SCAN_PAGE) exhausted = true;
    }

    const items = collected.slice(0, limit);
    const hasMore = collected.length > limit || !exhausted;
    const nextCursor = hasMore ? (items.length > 0 ? items[items.length - 1].id : lastScannedId) : null;

    let myInterestMap = new Map<number, { status: string }>();
    // Only a student can create an interest row (POST/DELETE both require
    // STUDENT), so asking for anyone else is a guaranteed-empty query. The
    // viewer block is what lets the UI render "Sign in to save" / "students
    // only" before a click, instead of attempting a write and showing 401/403.
    const viewer = {
      authenticated: Boolean(user),
      canSave: Boolean(user && authorize(user, 'STUDENT')),
    };
    if (viewer.canSave && user && items.length > 0) {
      const interests = await prisma.opportunityInterest.findMany({
        where: { userId: user.id, opportunityId: { in: items.map((o) => o.id) } },
        select: { opportunityId: true, status: true },
      });
      myInterestMap = new Map(interests.map((i) => [i.opportunityId, { status: i.status }]));
    }

    const payload = items.map((opp) => {
      // No-guess rule lives in the DB (NULL stays NULL). For display only,
      // fall back to the start date so cards don't read UNKNOWN — flagged
      // via regStatusSource so the UI can mark it unconfirmed.
      const startDate = opp.startDate ?? null;
      const statusSource = opp.registrationDeadline ? 'deadline' : startDate ? 'startDate' : 'none';
      const distanceKm = kmFromTcet(opp.city ?? null);
      return {
        ...opp,
        regStatus: getRegistrationStatus(opp.registrationDeadline ?? startDate, now),
        eventStatus: getEventStatus(startDate, opp.endDate, now),
        myInterest: viewer.canSave ? myInterestMap.get(opp.id) ?? null : null,
        regStatusSource: statusSource,
        distanceKm,
        distanceLabel:
          opp.mode === 'ONLINE' ? 'Online' : distanceKm == null ? null : `${distanceKm} km from TCET`,
      };
    });

    // The city dropdown has to offer every city in the hub, not just the ones
    // on the page the client happens to hold — otherwise page 1 decides which
    // cities exist. Only computed when asked for.
    const facets =
      searchParams.get('facets') === '1'
        ? {
            cities: (
              await prisma.opportunity.groupBy({
                by: ['city'],
                where: { status: 'APPROVED', showInHub: true, city: { not: null }, ...deadEvent },
                _count: { _all: true },
                orderBy: { _count: { city: 'desc' } },
              })
            )
              .filter((r) => (r.city ?? '').trim().length > 0)
              .map((r) => ({ city: r.city as string, count: r._count._all })),
          }
        : undefined;

    const response = successRes(
      { items: payload, nextCursor, hasMore, viewer, ...(facets ? { facets } : {}) },
      'Hackathon hub events retrieved successfully.',
    );
    // The payload now varies per session (viewer + saved state), so a shared
    // cache must never serve one user's answer to another.
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie, Authorization');
    return response;
  } catch (err) {
    console.error('Hackathon hub GET error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
