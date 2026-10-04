/**
 * One-off: import the Hackathon-list sheet into the Hub via the branch's own
 * CSV importer (src/lib/hub/csv.ts) — same code path as POST /api/admin/hub/import.
 *
 * Input: scripts/hub-import-hackathons.csv (hub-compatible headers).
 * Dupes: matched by sourceUrl, else normalized title+organizer → updated in
 * place unless VERIFIED/ADMIN_VERIFIED/OFFICIAL_SOURCE (then flagged, kept).
 * Run: npx --yes tsx --env-file=.env scripts/run-hub-csv-import.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runCsvImport } from "@/lib/hub/csv";

const p = new PrismaClient();

(async () => {
  const admin = await p.user.findFirst({ where: { role: "ADMIN" }, orderBy: { id: "asc" } });
  if (!admin) throw new Error("no ADMIN user in this database");
  const csvText = readFileSync(
    path.join(process.cwd(), "scripts/hub-import-hackathons.csv"),
    "utf8",
  );
  const result = await runCsvImport(csvText, {
    actorId: admin.id,
    actorRole: "ADMIN",
    origin: "CSV",
  });
  console.log(JSON.stringify(result, null, 1));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
