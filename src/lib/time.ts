/**
 * Converts a Booking calendar date and IST time slot into a concrete UTC Date.
 *
 * Business rules:
 * - `Booking.date` is stored as midnight UTC in this application (Prisma Date).
 * - `Booking.timeSlot` is a wall-clock range in India Standard Time (IST, UTC+05:30).
 * - The returned Date is the absolute UTC instant corresponding to the start of the slot.
 *
 * This is observed behaviour of the current application, not a framework guarantee.
 * UTC getters are used throughout because they are timezone-independent – local getters
 * produce wrong results on negative-offset timezones (proven during design review).
 *
 * The function enforces an invariant: the input `date` MUST be midnight UTC (zero
 * hours, minutes, seconds, milliseconds). Any non-zero UTC-time component throws
 * an Error with the actual values so the caller can diagnose the root cause.
 */

/** India Standard Time offset – permanent. India does not observe DST
 *  (government policy since 1906), this offset never changes. */
export const IST_OFFSET = "+05:30";

export function bookingDateTimeFromIST(date: Date, timeSlot: string): Date {
  // -- Invariant check: date must be midnight UTC ---------------------------
  const uh = date.getUTCHours();
  const um = date.getUTCMinutes();
  const us = date.getUTCSeconds();
  const ums = date.getUTCMilliseconds();
  if (uh !== 0 || um !== 0 || us !== 0 || ums !== 0) {
    throw new Error(
      `Booking.date must be midnight UTC, got UTC ${uh}:${um}:${us}.${ums} (date=${date.toISOString()})`,
    );
  }

  // -- Extract calendar parts using TZ-independent getters -----------------
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 0-indexed → 1-indexed
  const day = date.getUTCDate();

  // -- Parse the time slot --------------------------------------------------
  // timeSlot format: "11:00 - 12:00"
  const [startTime] = timeSlot.split(" - ") as [string, string];

  // -- Build an ISO 8601 string in IST and parse it ------------------------
  // pad month/day to 2 digits so the string is always valid
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${startTime}:00${IST_OFFSET}`;
  return new Date(iso);
}

/**
 * Parse a calendar date string in "YYYY-MM-DD" format.
 *
 * Temporal category: Calendar Date (no time, no timezone).
 * Accepted:   "2026-07-03"
 * Rejected:   Anything not matching /^\d{4}-\d{2}-\d{2}$/ — throws a descriptive Error.
 *
 * Per ECMAScript spec, "YYYY-MM-DD" is parsed as midnight UTC. No IST offset is
 * applied, because this function represents a date, not a wall-clock instant.
 *
 * @example
 *   parseCalendarDate("2026-07-03") // Date representing 2026-07-03T00:00:00.000Z
 *   parseCalendarDate("03-07-2026") // throws
 *   parseCalendarDate("2026-7-3")   // throws
 *
 * Used by: Grant.deadline, Booking.date, InnovationProgram.eventDate
 */
export function parseCalendarDate(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(
      `parseCalendarDate: expected "YYYY-MM-DD", got "${dateStr}"`,
    );
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `parseCalendarDate: invalid date "${dateStr}" — parsed as NaN`,
    );
  }
  return d;
}

/**
 * Parse a local wall-clock datetime string (IST) with NO timezone indicator.
 *
 * Temporal category: Local Wall Clock Time (India Standard Time, UTC+05:30).
 * Accepted:   "2026-07-03T09:00" or "2026-07-03T09:00:00"
 * Rejected:   Strings containing 'Z' or an explicit offset like "+05:30" or "-04:00"
 *             — throws an Error explaining that the input already carries a timezone.
 *             Strings not matching an expected datetime format — throws an Error.
 *
 * The input is treated as IST by appending IST_OFFSET ("+05:30") before parsing.
 * This is the correct choice for form inputs where the user is thinking in IST and
 * the backend stores instants in UTC. Prisma converts the resulting Date to UTC
 * automatically on write.
 *
 * @example
 *   parseLocalWallClock("2026-07-03T09:00")     // → Date for 2026-07-03T03:30:00Z
 *   parseLocalWallClock("2026-07-03T09:00:00")  // → Date for 2026-07-03T03:30:00Z
 *   parseLocalWallClock("2026-07-03T09:00Z")    // throws (has 'Z')
 *
 * Used by: InnovationProgram.startTime/endTime, InternshipMeeting.datetime,
 *          InternshipTask.deadline
 */
export function parseLocalWallClock(datetimeStr: string): Date {
  if (datetimeStr.includes("Z") || /[+-]\d{2}:\d{2}$/.test(datetimeStr)) {
    throw new Error(
      "parseLocalWallClock: input already has timezone indicator: " +
        datetimeStr,
    );
  }
  const d = new Date(datetimeStr + IST_OFFSET);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `parseLocalWallClock: invalid datetime "${datetimeStr}" — ` +
        `parsed as NaN`,
    );
  }
  return d;
}

/**
 * Parse an ISO 8601 string that already carries a timezone indicator.
 *
 * Temporal category: Absolute Instant (pre-converted to UTC by the caller/frontend).
 * Accepted:   "2026-07-03T09:00:00Z", "2026-07-03T14:30:00+05:30",
 *             "2026-07-03T05:00:00-04:00"
 * Rejected:   Strings WITHOUT a timezone indicator ('Z' or explicit offset)
 *             — throws an Error. Such strings are ambiguous (the ECMAScript spec
 *             would parse them as UTC, but the caller should be explicit).
 *
 * The string is passed directly to `new Date(isoStr)`. The ECMAScript spec treats
 * inputs with 'Z' or an offset as a UTC-based instant; no further offset is applied.
 *
 * @example
 *   parseUTCIso("2026-07-03T09:00:00Z")          // → Date for 2026-07-03T09:00:00Z
 *   parseUTCIso("2026-07-03T14:30:00+05:30")     // → Date for 2026-07-03T09:00:00Z
 *   parseUTCIso("2026-07-03T09:00:00")           // throws (no timezone indicator)
 *
 * Used by: HackathonEvent dates, FacultyPortal event dates
 *          (frontends already convert to UTC ISO before sending).
 */
export function parseUTCIso(isoStr: string): Date {
  if (!isoStr.includes("Z") && !/[+-]\d{2}:\d{2}$/.test(isoStr)) {
    throw new Error(
      "parseUTCIso: input missing timezone indicator: " + isoStr,
    );
  }
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `parseUTCIso: invalid ISO string "${isoStr}" — parsed as NaN`,
    );
  }
  return d;
}
