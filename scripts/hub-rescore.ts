/**
 * Recompute `hubScore` for every opportunity.
 *
 * Run this after the relevance weights in `src/lib/hub/ranking.ts` change, and
 * once after the ranking columns were introduced — rows published before then
 * carry a NULL score, which sorts them to the bottom of "Most relevant".
 *
 * `popularity` and `registrations` are deliberately left alone: only the source
 * knows a signup count, so a row ingested before those columns existed stays
 * unscored on that axis rather than being handed a made-up number.
 *
 *   npx tsx scripts/hub-rescore.ts [--dry-run]
 */
import prisma from '../src/lib/prisma';
import { computeHubScore } from '../src/lib/hub/ranking';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await prisma.opportunity.findMany({
    select: {
      id: true,
      popularity: true,
      registrations: true,
      registrationDeadline: true,
      prize: true,
      mode: true,
      country: true,
      verificationStatus: true,
      hubScore: true,
    },
  });

  let changed = 0;
  const buckets = { high: 0, mid: 0, low: 0 };
  for (const row of rows) {
    const next = computeHubScore({
      popularity: row.popularity,
      registrationDeadline: row.registrationDeadline,
      prize: row.prize,
      mode: row.mode,
      country: row.country,
      verificationStatus: row.verificationStatus,
    });
    if (next >= 60) buckets.high += 1;
    else if (next >= 35) buckets.mid += 1;
    else buckets.low += 1;
    if (next !== row.hubScore) changed += 1;
    if (!dryRun && next !== row.hubScore) {
      await prisma.opportunity.update({ where: { id: row.id }, data: { hubScore: next } });
    }
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}${rows.length} opportunities, ${changed} rescored — ` +
      `high(>=60) ${buckets.high}, mid ${buckets.mid}, low ${buckets.low}`,
  );
  const unscored = rows.filter((r) => r.popularity === null).length;
  console.log(`${unscored}/${rows.length} have no popularity signal (source published no signup count).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
