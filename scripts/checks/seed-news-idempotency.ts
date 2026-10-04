// Prove the seed-news migration is a true one-shot.
// On a fixture DB with 3 events and empty event_news, the statement must insert
// exactly 1 row, and insert 0 more on repeat runs. Regression guard for the
// FROM <table> -> FROM DUAL fix (a FROM pivot emitted one row per event).
// Run: npx --yes tsx --env-file=.env scripts/checks/seed-news-idempotency.ts
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const stem = url.replace(/\/[^/]+$/, "");
const DEV = `${stem}/coe_db_dev`;
const TEST_DB = "coe_seedcheck_test";

const count = (rows: unknown) => Number((rows as Array<{ c: bigint }>)[0].c);

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: DEV } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.$disconnect();

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `${stem}/${TEST_DB}` },
    stdio: "pipe",
  });

  const p = new PrismaClient({ datasources: { db: { url: `${stem}/${TEST_DB}` } } });
  const me = await p.user.create({
    data: { email: "seedcheck@tcetmumbai.in", name: "Seed Check", role: "ADMIN", password: "x" },
  });

  // 3 events + event id 3 exists: the old FROM <table> form produced 3 rows
  for (const title of ["E1", "E2", "E3"]) {
    await p.hackathonEvent.create({
      data: { title, startTime: new Date(), endTime: new Date(Date.now() + 864e5), createdById: me.id, status: "ACTIVE" },
    });
  }
  console.log("events in fixture DB:", count(await p.$queryRawUnsafe("SELECT COUNT(*) c FROM hackathon_events")));

  const file = path.join(process.cwd(), "prisma/migrations/20260905230000_seed_sih_news/migration.sql");
  const stmt = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim()
    .replace(/;$/, "");

  await p.$executeRawUnsafe("DELETE FROM event_news");

  const results: number[] = [];
  for (let run = 1; run <= 3; run++) {
    await p.$executeRawUnsafe(stmt);
    const n = count(await p.$queryRawUnsafe("SELECT COUNT(*) c FROM event_news"));
    results.push(n);
    console.log(`run ${run} -> event_news rows: ${n} (expected 1)`);
  }

  const ok = results.every((n) => n === 1);
  console.log(ok ? "PASS: exactly one article, no duplicates" : "FAIL: duplicate rows produced");
  await p.$disconnect();

  const cleanup = new PrismaClient({ datasources: { db: { url: DEV } } });
  await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await cleanup.$disconnect();
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
