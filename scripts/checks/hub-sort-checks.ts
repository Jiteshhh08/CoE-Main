/**
 * Hub listing invariants, asserted against a live API — the same way
 * hub-prod-audit.ts works, so this can run against dev or prod.
 *
 *   npx --yes tsx scripts/checks/hub-sort-checks.ts [baseUrl]
 *
 * Guards the bugs this file exists for: "deadline soonest" leading with events
 * whose deadline already passed, "starting soonest" leading with events that
 * already started, and finished events appearing at all.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3111';

type Item = {
  id: number;
  title: string;
  registrationDeadline: string | null;
  startDate: string | null;
  endDate: string | null;
  regStatus: string;
  eventStatus: string;
  registrations: number | null;
};

let passed = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const today = new Date();
today.setHours(0, 0, 0, 0);

async function fetchSort(sort: string): Promise<Item[]> {
  const res = await fetch(`${BASE}/api/hackathon-hub?sort=${sort}&limit=50`);
  const json = (await res.json()) as { success: boolean; data: { items: Item[] } };
  if (!json.success) throw new Error(`sort=${sort} failed`);
  return json.data.items;
}

const dateOf = (v: string | null) => (v ? new Date(v).getTime() : null);

(async () => {
  console.log(`hub sorts — ${BASE}\n`);

  const deadline = await fetchSort('deadline');
  ok('deadline: returns something', deadline.length > 0, `${deadline.length} rows`);
  ok(
    'deadline: nothing with a past deadline',
    deadline.every((r) => dateOf(r.registrationDeadline) !== null && dateOf(r.registrationDeadline)! >= today.getTime()),
    deadline.filter((r) => !r.registrationDeadline || dateOf(r.registrationDeadline)! < today.getTime()).map((r) => r.title).join(', '),
  );
  ok('deadline: no undated rows', deadline.every((r) => r.registrationDeadline !== null));
  ok(
    'deadline: ascending',
    deadline.every((r, i) => i === 0 || dateOf(r.registrationDeadline)! >= dateOf(deadline[i - 1].registrationDeadline)!),
  );

  const upcoming = await fetchSort('upcoming');
  ok('upcoming: returns something', upcoming.length > 0, `${upcoming.length} rows`);
  ok(
    'upcoming: nothing that already started',
    upcoming.every((r) => dateOf(r.startDate) !== null && dateOf(r.startDate)! >= today.getTime()),
    upcoming.filter((r) => !r.startDate || dateOf(r.startDate)! < today.getTime()).map((r) => r.title).join(', '),
  );
  ok('upcoming: no undated rows', upcoming.every((r) => r.startDate !== null));
  ok(
    'upcoming: ascending',
    upcoming.every((r, i) => i === 0 || dateOf(r.startDate)! >= dateOf(upcoming[i - 1].startDate)!),
  );

  const popular = await fetchSort('popular');
  ok(
    'popular: descending, nulls last',
    popular.every((r, i) => {
      if (i === 0) return true;
      const a = popular[i - 1].registrations;
      const b = r.registrations;
      if (a === null) return b === null;
      return b !== null && a >= b;
    }),
  );

  // Every sort must agree that an event which closed and ended is not listed.
  for (const sort of ['relevant', 'deadline', 'popular', 'upcoming', 'newest']) {
    const rows = await fetchSort(sort);
    const dead = rows.filter((r) => {
      if (!r.registrationDeadline) return false;
      const closed = dateOf(r.registrationDeadline)! < today.getTime();
      const over = r.endDate ? dateOf(r.endDate)! < today.getTime() : r.startDate ? dateOf(r.startDate)! < today.getTime() : false;
      return closed && over;
    });
    ok(`${sort}: no finished-and-closed events`, dead.length === 0, dead.map((r) => r.title).join(', '));
  }

  // The default listing must not rank a completed event first.
  const relevant = await fetchSort('relevant');
  ok(
    'relevant: first row is not already over',
    relevant.length === 0 || relevant[0].eventStatus !== 'COMPLETED',
    relevant[0]?.title,
  );

  console.log(`\n${failures.length === 0 ? `ALL CHECKS PASSED (${passed})` : `FAILURES (${failures.length}/${passed + failures.length})`}`);
  if (failures.length) process.exitCode = 1;
})().catch((e) => {
  console.error('CHECK ERROR:', e);
  process.exitCode = 1;
});
