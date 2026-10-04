/**
 * Seed the 100 TCET-mapped open problem statements (/innovation/problems).
 *
 * Source data: scripts/data-tcet-100-problems.json (generated from Desktop
 * TCET_100_Problem_Statements_Full_Mapping.xlsx — all 17 metadata columns are
 * preserved: title/tags/difficulty/sdgTags map to native columns, everything
 * else is appended to `description` as a labeled block for the details popup).
 * Idempotent: rows whose title already exists are skipped.
 * Seeded rows are APPROVED + OPENED so they show on the public board immediately.
 *
 * Run: npx --yes tsx --env-file=.env scripts/seed-tcet-100-problems.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const p = new PrismaClient();

type Row = {
  title: string;
  description: string;
  tags: string | null;
  difficulty: string | null;
  sdgTags: string[] | null;
};

const rows = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/data-tcet-100-problems.json"), "utf8"),
) as Row[];

(async () => {
  const admin = await p.user.findFirst({ where: { role: "ADMIN" }, orderBy: { id: "asc" } });
  if (!admin) throw new Error("no ADMIN user in this database");

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = await p.problem.findFirst({ where: { title: r.title } });
    if (existing) {
      skipped++;
      continue;
    }
    await p.problem.create({
      data: {
        title: r.title,
        description: r.description,
        tags: r.tags,
        difficulty: r.difficulty,
        sdgTags: r.sdgTags ?? undefined,
        problemType: "OPEN",
        approvalStatus: "APPROVED",
        mode: "OPEN",
        status: "OPENED",
        createdById: admin.id,
      },
    });
    created++;
  }
  console.log(`open problems: created=${created} skipped(existing)=${skipped} total=${rows.length}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
