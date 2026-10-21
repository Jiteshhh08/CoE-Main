import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { authenticate, successRes, errorRes } from '@/lib/api-helpers';
import { getRegistrationStatus, getEventStatus } from '@/lib/hackathon-hub';
import { kmFromTcet } from '@/lib/hub/pipeline';

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
const rateHits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now: number): boolean {
  const entry = rateHits.get(key);
  if (!entry || entry.resetAt <= now) {
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
  verificationStatus: string;
  lastVerifiedAt: Date | null;
  createdAt: Date;
};

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
    const sort = searchParams.get('sort') === 'deadline' ? 'deadline' : 'newest';

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

    const where: Prisma.OpportunityWhereInput = {
      status: 'APPROVED',
      showInHub: true,
      ...(city ? { city: { equals: city } } : {}),
      ...(mode ? { mode } : {}),
      ...(range ? { startDate: { gte: range.start, lt: range.end } } : {}),
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

    const orderBy: Prisma.OpportunityOrderByWithRelationInput[] =
      sort === 'deadline'
        ? [{ registrationDeadline: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }];

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
    if (user && items.length > 0) {
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
        myInterest: user ? myInterestMap.get(opp.id) ?? null : null,
        regStatusSource: statusSource,
        distanceKm,
        distanceLabel:
          opp.mode === 'ONLINE' ? 'Online' : distanceKm == null ? null : `${distanceKm} km from TCET`,
      };
    });

    return successRes(
      { items: payload, nextCursor, hasMore },
      'Hackathon hub events retrieved successfully.',
    );
  } catch (err) {
    console.error('Hackathon hub GET error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
