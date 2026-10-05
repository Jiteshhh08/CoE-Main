/**
 * Checks for the Hackathon Hub pipeline (AGENTS.md §4.4: one runnable check
 * for non-trivial logic). Covers CSV parsing/aliases, dedupe normalization,
 * confidence scoring, URL guards, SSRF classification, and change detection.
 * Pure functions only — no DB, no network.
 * Run: npx --yes tsx --env-file=.env scripts/checks/hub-checks.ts
 */
import assert from "node:assert";
import { parseCsv } from "../../src/lib/hub/csv";
import {
  normalizeName,
  clipDbString,
  fitUrl,
  isHubCategory,
} from "../../src/lib/hackathon-hub";
import {
  scoreConfidence,
  mandatoryMissing,
  type ExtractedEvent,
} from "../../src/lib/hub/extract";
import { diffImportant } from "../../src/lib/hub/pipeline";
import { isPrivateIp } from "../../src/lib/hub/fetch-guard";
import { LISTING_TITLES } from "../../src/lib/hub/discovery";
import { isHubCandidateStatus } from "../../src/lib/hub/pipeline";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
};

// ─── CSV parsing ───
check("csv: quoted commas stay in one cell", () => {
  const rows = parseCsv('eventName,organiser,city\n"AI, Hack","TCET","Mumbai"');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventname, "AI, Hack");
});

check("csv: header case/whitespace normalized", () => {
  const rows = parseCsv('  EventName , ORGANISER \nHack,X');
  assert.equal(rows[0].eventname, "Hack");
  assert.equal(rows[0].organiser, "X");
});

check("csv: blank lines skipped, trailing newline harmless", () => {
  const rows = parseCsv('a,b\n1,2\n\n');
  assert.equal(rows.length, 1);
});

// ─── Dedupe normalization ───
check("dedupe: punctuation/case insensitive", () => {
  assert.equal(normalizeName("AI-Innovation Hackathon!"), normalizeName("ai innovation hackathon"));
});

check("dedupe: yearly editions do NOT merge", () => {
  assert.notEqual(normalizeName("Hack 2026"), normalizeName("Hack 2025"));
});

// ─── Confidence scoring (§15) ───
const fullEvent = (over: Partial<ExtractedEvent> = {}): ExtractedEvent => ({
  eventName: "Hack",
  organiser: "TCET",
  mode: "OFFLINE",
  city: "Mumbai",
  state: null,
  venue: null,
  startDate: "2026-10-10",
  endDate: "2026-10-11",
  registrationDeadline: "2026-10-05",
  registrationUrl: "https://example.com/hack",
  teamMin: 2,
  teamMax: 4,
  prizePool: null,
  domains: [],
  eligibility: null,
  ...over,
});

check("confidence: complete official-source event auto-passes", () => {
  assert.ok(scoreConfidence(fullEvent(), "OFFICIAL_WEBSITE") >= 0.9);
});

check("confidence: thin platform extraction stays in review", () => {
  const c = scoreConfidence(fullEvent({ registrationDeadline: null, mode: null, city: null }), "UNSTOP");
  assert.ok(c < 0.9);
});

check("mandatory: missing fields listed, complete passes", () => {
  assert.deepEqual(mandatoryMissing(fullEvent()), []);
  assert.ok(mandatoryMissing(fullEvent({ registrationDeadline: null })).includes("registrationDeadline"));
});

// ─── URL persistence guards ───
check("fitUrl: javascript:/data: rejected, https kept, long nulled", () => {
  assert.equal(fitUrl("javascript:alert(1)"), null);
  assert.equal(fitUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(fitUrl("https://example.com/apply"), "https://example.com/apply");
  assert.equal(fitUrl("https://" + "x".repeat(200)), null);
  assert.equal(fitUrl(""), null);
});

check("clipDbString: trims and caps at 191", () => {
  assert.equal(clipDbString("  abc  "), "abc");
  assert.equal(clipDbString("x".repeat(300))?.length, 191);
  assert.equal(clipDbString(""), null);
});

check("isHubCategory: hackathon-likes in, workshops out", () => {
  assert.ok(isHubCategory("Hackathon"));
  assert.ok(isHubCategory("Design Challenge"));
  assert.ok(!isHubCategory("Workshop"));
  assert.ok(!isHubCategory(null));
});

// ─── SSRF classification (pure, no network) ───
check("isPrivateIp: loopback/private/link-local rejected", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "::1", "0.0.0.0", "not-an-ip"]) {
    assert.ok(isPrivateIp(ip), ip);
  }
});

check("isPrivateIp: public addresses pass", () => {
  for (const ip of ["93.184.216.34", "142.250.72.14", "8.8.8.8"]) {
    assert.ok(!isPrivateIp(ip), ip);
  }
  assert.ok(!isPrivateIp("172.15.0.1") && !isPrivateIp("172.32.0.1")); // adjacent, not private
});

// ─── Listing-title filter ───
check("LISTING_TITLES: nav pages rejected, real events kept", () => {
  assert.ok(LISTING_TITLES.test("Explore hackathons"));
  assert.ok(LISTING_TITLES.test("2540+ Hackathons in India 2026"));
  assert.ok(LISTING_TITLES.test("Hackathons | Devfolio"));
  assert.ok(!LISTING_TITLES.test("AI Innovation Hackathon 2026"));
  assert.ok(!LISTING_TITLES.test("HackMatrix 5.0"));
});

// ─── Change detection ───
check("diffImportant: only important fields compared", () => {
  const diffs = diffImportant(
    { registrationDeadline: new Date("2026-10-05"), prize: "INR 1L", eligibility: null } as Record<string, unknown>,
    { registrationDeadline: new Date("2026-10-15"), prize: "INR 1L", eligibility: null } as Record<string, unknown>,
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "registrationDeadline");
});

// ─── Status vocabulary ───
check("isHubCandidateStatus: known states pass, typos fail", () => {
  assert.ok(isHubCandidateStatus("VERIFIED"));
  assert.ok(isHubCandidateStatus("NEEDS_UPDATE"));
  assert.ok(!isHubCandidateStatus("VERIFYED"));
  assert.ok(!isHubCandidateStatus(""));
});

console.log(`\nALL CHECKS PASSED (${passed})`);
