/**
 * Date hardening at the Hub's AI/CSV/persistence boundaries.
 *
 * The pipeline gets dates from three untrusted places: page heuristics, an
 * LLM that happily answers "null"/"N/A"/"-", and admin CSV uploads. Prisma
 * throws on `new Date('N/A')`, so every one of those paths must normalise to
 * a null-or-valid value BEFORE it reaches the database. Never substitute a
 * plausible date for an unknown one.
 */

/** Strings a model (or spreadsheet) uses to mean "no value". */
const SENTINELS = new Set(['', 'null', 'undefined', 'n/a', 'na', 'none', '-', 'nil']);

export function isSentinel(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  return SENTINELS.has(value.trim().toLowerCase());
}

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

/** True only for a real calendar date (rejects 2027-02-30, 2027-13-01, …). */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Strict ISO parse → `YYYY-MM-DD` or null. Accepts date-only and full
 * timestamps (which are unambiguous); everything else is rejected rather
 * than handed to `Date.parse`'s locale-dependent guessing.
 */
export function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || isSentinel(value)) return null;
  const trimmed = value.trim();
  const dateOnly = ISO_DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number) as [number, number, number, number];
    return isValidCalendarDate(y, m, d) ? iso(y, m, d) : null;
  }
  const stamp = ISO_DATETIME.exec(trimmed);
  if (stamp) {
    const [, y, m, d, hh, mm, ss] = stamp.map(Number) as [number, number, number, number, number, number, number];
    if (!isValidCalendarDate(y, m, d)) return null;
    if (hh > 23 || mm > 59 || (ss || 0) > 59) return null;
    return iso(y, m, d);
  }
  return null;
}

/**
 * Ambiguous numeric dates (03/04/2027). Only accept when one component
 * proves the order: first > 12 ⇒ DD/MM; second > 12 ⇒ MM/DD. Both ≤ 12 is
 * unrecoverable without locale evidence, so it stays unknown.
 */
export function parseNumericDate(first: unknown, second: unknown, year: unknown): string | null {
  const a = Number(first);
  const b = Number(second);
  const y = Number(year);
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(y)) return null;
  if (a > 12 && b <= 12) return isValidCalendarDate(y, b, a) ? iso(y, b, a) : null;
  if (b > 12 && a <= 12) return isValidCalendarDate(y, a, b) ? iso(y, a, b) : null;
  return null;
}

/**
 * Persistence boundary: any untrusted value → a valid `Date` or null.
 * Returns null for sentinels, impossible calendar dates, and loosely parsed
 * strings (`4/31/2027` silently rolls over in JS — that is exactly the bug
 * this blocks).
 */
export function toDbDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = normalizeIsoDate(value);
  if (!normalized) return null;
  const d = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Drop an end date that is invalid or earlier than a known start date. */
export function coerceDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): { startDate: string | null; endDate: string | null } {
  const s = normalizeIsoDate(start);
  const e = normalizeIsoDate(end);
  return { startDate: s, endDate: e && s && e < s ? null : e };
}
