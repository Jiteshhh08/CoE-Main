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
