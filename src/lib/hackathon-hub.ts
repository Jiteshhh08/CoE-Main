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

export function getRegistrationStatus(deadline: Date | string | null | undefined, now = new Date()): HubRegistrationStatus {
  if (!deadline) return 'UNKNOWN';
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return 'UNKNOWN';
  const t = now.getTime();
  if (d.getTime() < t) return 'CLOSED';
  if (d.getTime() <= t + 7 * 86_400_000) return 'CLOSING_SOON';
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
    if (t <= e.getTime()) return 'ONGOING';
    return 'COMPLETED';
  }
  // No end date: treat start day as single-day event
  return t - s.getTime() < 86_400_000 ? 'ONGOING' : 'COMPLETED';
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
