/**
 * Hackathon Hub helpers — Phase 1.
 * ponytail: auto status only; dedupe/conflict/change-detection land in Phase 3+.
 * Spec §17: registration + event status derived from dates, never stored.
 */

export type HubRegistrationStatus = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'UNKNOWN';
export type HubEventStatus = 'UPCOMING' | 'ONGOING' | 'COMPLETED' | 'UNKNOWN';

export const HUB_SOURCE_TYPES = [
  'OFFICIAL_WEBSITE',
  'DEVFOLIO',
  'UNSTOP',
  'HACKEREARTH',
  'HACK2SKILL',
  'MLH',
  'COLLEGE_WEBSITE',
  'INDIAHACKATHONS',
  'DEVPOST',
  'GOVERNMENT',
  'SOCIAL_MEDIA',
  'ADMIN',
  'GOOGLE_SHEET',
  'OTHER',
] as const;

export const HUB_VERIFICATION_STATES = [
  'UNVERIFIED',
  'PLATFORM_VERIFIED',
  'OFFICIAL_SOURCE',
  'ADMIN_VERIFIED',
  'VERIFIED',
] as const;

export const HUB_MODES = ['ONLINE', 'OFFLINE', 'HYBRID'] as const;

// Human-facing source names. The Hub has to say where an event came from, and
// "UNSTOP" is a database token, not a sentence.
const HUB_SOURCE_LABELS: Record<string, string> = {
  UNSTOP: 'Unstop',
  DEVFOLIO: 'Devfolio',
  DEVPOST: 'Devpost',
  HACKEREARTH: 'HackerEarth',
  HACK2SKILL: 'Hack2Skill',
  MLH: 'Major League Hacking',
  INDIAHACKATHONS: 'India Hackathons',
  COLLEGE_WEBSITE: 'College website',
  OFFICIAL_WEBSITE: 'Official website',
  GOVERNMENT: 'Government portal',
  SOCIAL_MEDIA: 'Social media',
  GOOGLE_SHEET: 'Google Sheet',
  ADMIN: 'Added by admin',
  OTHER: 'Other',
};

export function hubSourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return 'Added by admin';
  return HUB_SOURCE_LABELS[sourceType] ?? sourceType.replace(/_/g, ' ').toLowerCase();
}

/**
 * A bare date means the whole day. Sources publish "closes 23 Oct", which lands
 * as midnight — comparing that instant to the clock closed the event at 00:00 of
 * its own deadline day, so anything closing *today* read CLOSED all day and an
 * event ending today read COMPLETED from the small hours. Values that carry a
 * real time keep it.
 *
 * Midnight has to be checked in UTC *and* local: ingestion writes UTC midnight,
 * while dates built in-app use local midnight, and the server is not on UTC (IST
 * makes a UTC midnight read as 05:30). Testing only one convention passes in the
 * environment that wrote the row and fails in the other.
 */
function isUtcMidnight(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function isLocalMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}

function isMidnight(d: Date): boolean {
  return isUtcMidnight(d) || isLocalMidnight(d);
}

function dayNumber(d: Date, useUtc: boolean): number {
  return (
    Date.UTC(
      useUtc ? d.getUTCFullYear() : d.getFullYear(),
      useUtc ? d.getUTCMonth() : d.getMonth(),
      useUtc ? d.getUTCDate() : d.getDate(),
    ) / 86_400_000
  );
}

/**
 * Calendar-day number (days since 1970-01-01) for a stored date, read with the
 * convention it was written in. Ingestion stores UTC midnight; in-app code
 * stores local midnight. Reading either through the wrong zone shifts the date
 * by one.
 */
export function hubCalendarDay(value: Date | string): number {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return NaN;
  return dayNumber(d, isUtcMidnight(d) && !isLocalMidnight(d));
}

/**
 * Whole calendar days from `now` to `deadline`, read in the deadline's own
 * convention. Both sides use the same calendar, so a UTC-midnight deadline does
 * not lose a day when `now` is late in the IST evening. Negative once the
 * deadline's day has passed.
 */
export function hubDaysUntil(deadline: Date, now: Date): number {
  const useUtc = isUtcMidnight(deadline) && !isLocalMidnight(deadline);
  return dayNumber(deadline, useUtc) - dayNumber(now, useUtc);
}

function endOfDayIfDateOnly(d: Date): number {
  return isMidnight(d) ? d.getTime() + 86_400_000 - 1 : d.getTime();
}

export function getRegistrationStatus(deadline: Date | string | null | undefined, now = new Date()): HubRegistrationStatus {
  if (!deadline) return 'UNKNOWN';
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return 'UNKNOWN';
  const t = now.getTime();
  const closes = endOfDayIfDateOnly(d);
  if (closes < t) return 'CLOSED';
  if (closes <= t + 7 * 86_400_000) return 'CLOSING_SOON';
  return 'OPEN';
}

export function getEventStatus(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  now = new Date(),
): HubEventStatus {
  const s = start ? (start instanceof Date ? start : new Date(start)) : null;
  const e = end ? (end instanceof Date ? end : new Date(end)) : null;
  if (!s || Number.isNaN(s.getTime())) return 'UNKNOWN';
  const t = now.getTime();
  if (s.getTime() > t) return 'UPCOMING';
  if (e && !Number.isNaN(e.getTime())) {
    if (t <= endOfDayIfDateOnly(e)) return 'ONGOING';
    return 'COMPLETED';
  }
  // No end date: treat start day as single-day event
  return t - s.getTime() < 86_400_000 ? 'ONGOING' : 'COMPLETED';
}

/**
 * Where the primary CTA points. A closed event often still carries the
 * application URL its source published, but offering "Register" after the
 * deadline is a dead end; the original listing is the honest fallback. The
 * card and the modal share this one rule.
 */
export type HubCtaTarget = { href: string; kind: 'register' | 'listing' };

export function hubCtaTarget(opp: {
  applicationUrl: string | null;
  sourceUrl: string | null;
  regStatus: string;
}): HubCtaTarget | null {
  if (opp.applicationUrl && opp.regStatus !== 'CLOSED') return { href: opp.applicationUrl, kind: 'register' };
  if (opp.sourceUrl) return { href: opp.sourceUrl, kind: 'listing' };
  return null;
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
// Crawled <title> values carry the platform name as chrome: "Web Hackathon -
// 2026 - Unstop". Left in place it both looks broken on the Hub AND defeats
// title-based dedupe, because the same event from another source has no suffix.
const PLATFORM_CHROME =
  /\s*[-|–—:]\s*(unstop|devfolio|hackerearth|hack2skill|devpost|mlh|internshala|dare2compete)\s*$/i;

export function cleanEventTitle(value: string | null | undefined): string {
  let title = (value || '').trim().replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i += 1) {
    const next = title.replace(PLATFORM_CHROME, '').trim();
    if (next === title) break;
    title = next;
  }
  return title;
}

// ponytail: dedupe uses exact normalized-name equality (URL match is the
// primary key). Year-suffixed variants intentionally do NOT merge — safer
// than fusing distinct yearly editions; admin merges those via publish.
// Upgrade path: trigram similarity + same-organizer+date window.

// DB boundary: Opportunity text columns are VARCHAR(191). Clip at the single
// choke point instead of letting MySQL throw P2000 from every writer.
export function clipDbString(value: string | null | undefined, max = 191): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// URLs can't be clipped without corrupting them — NULL when unstoreable.
// Scheme allowlist mirrors hubUrlSchema: only http(s) may be persisted,
// so a crawled javascript:/data: URL can never reach a rendered <a href>.
export function fitUrl(value: string | null | undefined, max = 191): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

// Hub subset boundary: which Opportunity categories belong in the Hackathon
// Hub. Used to auto-set showInHub on submit/import; admin toggle overrides.
const HUB_CATEGORY_HINTS = [
  'hackathon', 'competition', 'contest', 'ideathon', 'datathon',
  'codefest', 'hackfest', 'challenge',
];

export function isHubCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const c = category.toLowerCase();
  return HUB_CATEGORY_HINTS.some((hint) => c.includes(hint));
}
