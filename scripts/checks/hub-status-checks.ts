/**
 * Date-semantics checks for the Hub status helpers. Pure, no DB, no server.
 *
 *   npx --yes tsx scripts/checks/hub-status-checks.ts
 *
 * These exist because a bare date stored as midnight expired at 00:00 of its own
 * day: every event closing today read CLOSED all day. Both midnight conventions
 * are covered on purpose — ingestion writes UTC midnight, in-app code writes
 * local midnight, and the server is not on UTC.
 */
import { getEventStatus, getRegistrationStatus } from '../../src/lib/hackathon-hub';

let passed = 0;
const failures: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => {
  if (got === want) {
    passed += 1;
    return;
  }
  failures.push(`${name}: got ${String(got)}, want ${String(want)}`);
  console.log(`  FAIL ${name}: got ${String(got)}, want ${String(want)}`);
};

// A fixed "now": 23 Oct 2026, 10:00 UTC.
const now = new Date(Date.UTC(2026, 9, 23, 10, 0, 0));
const D = 86_400_000;

// The deadline is today. It closes at the end of today, so it is not closed.
eq('UTC midnight today is still open', getRegistrationStatus(new Date(Date.UTC(2026, 9, 23)), now), 'CLOSING_SOON');
eq(
  'local midnight today is still open',
  getRegistrationStatus(new Date(2026, 9, 23, 0, 0, 0, 0), now),
  'CLOSING_SOON',
);
// Yesterday is genuinely gone.
eq('UTC midnight yesterday is closed', getRegistrationStatus(new Date(Date.UTC(2026, 9, 22)), now), 'CLOSED');
// A real time on today is respected as an instant, not widened to the day.
eq(
  'a real time earlier today is closed',
  getRegistrationStatus(new Date(Date.UTC(2026, 9, 23, 8, 0, 0)), now),
  'CLOSED',
);
eq(
  'a real time later today is closing soon',
  getRegistrationStatus(new Date(Date.UTC(2026, 9, 23, 18, 0, 0)), now),
  'CLOSING_SOON',
);
eq('far future is open', getRegistrationStatus(new Date(Date.UTC(2026, 11, 1)), now), 'OPEN');
eq('missing deadline is unknown', getRegistrationStatus(null, now), 'UNKNOWN');

// An event running through today is ongoing, not completed at 00:00.
eq(
  'event ending today is ongoing',
  getEventStatus(new Date(Date.UTC(2026, 8, 30)), new Date(Date.UTC(2026, 9, 23)), now),
  'ONGOING',
);
eq(
  'event ending yesterday is completed',
  getEventStatus(new Date(Date.UTC(2026, 8, 30)), new Date(Date.UTC(2026, 9, 22)), now),
  'COMPLETED',
);
eq(
  'event starting later is upcoming',
  getEventStatus(new Date(Date.UTC(2026, 10, 2)), null, now),
  'UPCOMING',
);
eq(
  'single-day event later today is ongoing',
  getEventStatus(new Date(Date.UTC(2026, 9, 23)), null, now),
  'ONGOING',
);
eq(
  'single-day event two days ago is completed',
  getEventStatus(new Date(Date.UTC(2026, 9, 21)), null, now),
  'COMPLETED',
);
eq('undated event is unknown', getEventStatus(null, null, now), 'UNKNOWN');

// The end-of-day grace must not stretch a real timestamp by a day.
const closesAt = new Date(Date.UTC(2026, 9, 23, 12, 0, 0));
eq('no grace given to a timed deadline', getRegistrationStatus(closesAt, new Date(closesAt.getTime() + D)), 'CLOSED');

console.log(failures.length === 0 ? `ALL CHECKS PASSED (${passed})` : `FAILURES (${failures.length}/${passed + failures.length})`);
if (failures.length) process.exitCode = 1;

export {};
