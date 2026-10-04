/**
 * Seed the 28 curated hackathons into the Hub (/innovation/hackathon-hub).
 *
 * Source data: scripts/data-hackathon-opportunities.json (converted from the
 * Hackathon-list sheet — same columns the CSV importer accepts, minus the
 * sheet-only metadata). Idempotent: matches by applicationUrl, else normalized
 * title+organizer → updates in place, skips VERIFIED/ADMIN_VERIFIED rows.
 * Seeded rows are APPROVED + ADMIN_VERIFIED + showInHub so they go live.
 *
 * Run: npx --yes tsx --env-file=.env scripts/seed-hub-opportunities.ts
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { clipDbString, fitUrl, isHubCategory, normalizeName } from '@/lib/hackathon-hub';

const p = new PrismaClient();

type Row = {
  title: string;
  category?: string;
  organizer: string;
  description?: string | null;
  registrationDeadline?: string | null;
  eligibility?: string | null;
  prize?: string | null;
  themes?: string[];
  technologies?: string[];
  applicationUrl?: string | null;
  facultyRecommended?: boolean;
};

const rows = JSON.parse(
  readFileSync(path.join(process.cwd(), 'scripts/data-hackathon-opportunities.json'), 'utf8'),
) as Row[];

(async () => {
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  if (!admin) throw new Error('no ADMIN user in this database');

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const title = clipDbString(r.title) as string;
    const organizer = clipDbString(r.organizer) as string;
    const category = clipDbString(r.category) ?? 'Hackathon';
    let existing: { id: number; verificationStatus: string } | null = null;
    const appUrl = fitUrl(r.applicationUrl);
    if (appUrl) {
      existing =
        (await p.opportunity.findFirst({ where: { sourceUrl: appUrl } })) ??
        (await p.opportunity.findFirst({ where: { applicationUrl: appUrl } }));
    }
    if (!existing) {
      const rivals = await p.opportunity.findMany({
        where: { organizer },
        select: { id: true, title: true, verificationStatus: true },
        take: 50,
      });
      existing = rivals.find((x) => normalizeName(x.title) === normalizeName(title)) ?? null;
    }
    const record = {
      title,
      category,
      organizer,
      description: r.description || null,
      registrationDeadline: r.registrationDeadline ? new Date(r.registrationDeadline) : null,
      eligibility: clipDbString(r.eligibility),
      prize: clipDbString(r.prize),
      themes: r.themes?.length ? r.themes : undefined,
      technologies: r.technologies?.length ? r.technologies : undefined,
      applicationUrl: appUrl,
      facultyRecommended: r.facultyRecommended ?? false,
      status: 'APPROVED',
      verificationStatus: 'ADMIN_VERIFIED',
      lastVerifiedAt: new Date(),
      showInHub: isHubCategory(category),
      sourceType: 'GOOGLE_SHEET',
    };
    if (!existing) {
      await p.opportunity.create({ data: { ...record, createdById: admin.id } });
      created++;
    } else if (['VERIFIED', 'ADMIN_VERIFIED', 'OFFICIAL_SOURCE'].includes(existing.verificationStatus)) {
      skipped++;
    } else {
      await p.opportunity.update({ where: { id: existing.id }, data: record });
      updated++;
    }
  }
  console.log(`hub opportunities: created=${created} updated=${updated} skipped(verified)=${skipped} total=${rows.length}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
