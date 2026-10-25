/**
 * Checks for the Hackathon Hub pipeline (AGENTS.md §4.4: one runnable check
 * for non-trivial logic).
 *
 * Sections 1–12 are pure-function regressions. Sections 13+ are integration
 * checks against the development database (coe_db_dev / coe_main — whichever
 * DATABASE_URL points at) using uniquely-marked throwaway rows, all removed
 * in a finally block. No outbound network calls are made.
 *
 * Run: npx --yes tsx --env-file=.env scripts/checks/hub-checks.ts
 */
import assert from "node:assert";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { parseCsv, runCsvImport } from "../../src/lib/hub/csv";
import {
  normalizeName,
  clipDbString,
  fitUrl,
  isHubCategory,
  getEventStatus,
  getRegistrationStatus,
  hubCalendarDay,
  hubDaysUntil,
  hubCtaTarget,
} from "../../src/lib/hackathon-hub";
import { computeHubScore } from "../../src/lib/hub/ranking";
import { staleScoreUpdates } from "../../src/lib/hub/score-refresh";
import {
  extractFromHtml,
  scoreConfidence,
  mandatoryMissing,
  resolveRegistrationUrl,
  type ExtractedEvent,
} from "../../src/lib/hub/extract";
import {
  diffImportant,
  kmFromTcet,
  isCuratedVerification,
  isPlaceholderDescription,
  publishCandidate,
} from "../../src/lib/hub/pipeline";
import { runMonitor } from "../../src/lib/hub/monitor";
import { isPrivateIp } from "../../src/lib/hub/fetch-guard";
import { LISTING_TITLES } from "../../src/lib/hub/discovery";
import { isHubCandidateStatus } from "../../src/lib/hub/pipeline";
import {
  toDbDate,
  normalizeIsoDate,
  parseNumericDate,
  isSentinel,
  isValidCalendarDate,
} from "../../src/lib/hub/dates";
import { HUB_CITIES, cityCoords, findHubCityInText, resolveHubCity } from "../../src/lib/hub/cities";
import { opportunityCreateSchema, opportunityUpdateSchema } from "../../src/lib/validators";
import { generateAccessToken } from "../../src/lib/jwt";
import { GET as hubGET } from "../../src/app/api/hackathon-hub/route";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
};
const checkAsync = async (name: string, fn: () => Promise<void>) => {
  await fn();
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

check("validation: URL schemes and date/team ranges enforced on create + update", () => {
  const base = { title: "Validation Event", category: "Hackathon", organizer: "TCET" };
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "not-a-url"]) {
    assert.equal(opportunityCreateSchema.safeParse({ ...base, applicationUrl: bad }).success, false, bad);
    assert.equal(opportunityCreateSchema.safeParse({ ...base, sourceUrl: bad }).success, false, bad);
    const upd = opportunityUpdateSchema.safeParse({ applicationUrl: bad });
    assert.equal(upd.success, false, `update ${bad}`);
  }
  assert.ok(opportunityCreateSchema.safeParse({ ...base, applicationUrl: "https://example.com/apply" }).success);
  assert.equal(opportunityCreateSchema.safeParse({ ...base, startDate: "2027-05-10", endDate: "2027-05-01" }).success, false);
  assert.equal(opportunityCreateSchema.safeParse({ ...base, teamMin: 5, teamMax: 2 }).success, false);
  assert.ok(opportunityCreateSchema.safeParse({ ...base, startDate: "2027-05-01", endDate: "2027-05-10", teamMin: 2, teamMax: 5 }).success);
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

// ─── Card/modal CTA parity ───
check("cta: closed never offers register; source is the fallback", () => {
  const link = { applicationUrl: "https://example.com/apply", sourceUrl: "https://example.com/listing" };
  assert.equal(hubCtaTarget({ ...link, regStatus: "OPEN" })?.kind, "register");
  assert.equal(hubCtaTarget({ ...link, regStatus: "CLOSING_SOON" })?.kind, "register");
  assert.equal(hubCtaTarget({ ...link, regStatus: "CLOSED" })?.kind, "listing");
  assert.equal(hubCtaTarget({ ...link, regStatus: "CLOSED" })?.href, link.sourceUrl);
  assert.equal(hubCtaTarget({ applicationUrl: link.applicationUrl, sourceUrl: null, regStatus: "CLOSED" }), null);
  assert.equal(hubCtaTarget({ applicationUrl: null, sourceUrl: link.sourceUrl, regStatus: "OPEN" })?.kind, "listing");
  assert.equal(hubCtaTarget({ applicationUrl: null, sourceUrl: null, regStatus: "OPEN" }), null);
});

// ─── Relevance urgency is calendar-day based ───
const rankable = (deadline: Date | null) => ({
  popularity: 50,
  registrationDeadline: deadline,
  prize: null,
  mode: "ONLINE",
  country: null,
  verificationStatus: "UNVERIFIED",
});

check("score: a deadline closing today keeps its urgency all day", () => {
  const deadline = new Date("2026-10-22T00:00:00Z");
  const morning = computeHubScore(rankable(deadline), Date.parse("2026-10-22T00:01:00Z"));
  const night = computeHubScore(rankable(deadline), Date.parse("2026-10-22T23:59:00Z"));
  assert.equal(morning, night, "midnight-to-midnight decay must not happen inside the closing day");
  assert.ok(morning > computeHubScore(rankable(new Date("2026-12-25T00:00:00Z")), Date.parse("2026-10-22T12:00:00Z")));
});

check("score: UTC and local midnight both resolve to the written calendar day", () => {
  assert.equal(hubCalendarDay(new Date("2026-10-22T00:00:00Z")), Date.UTC(2026, 9, 22) / 86_400_000);
  assert.equal(hubCalendarDay(new Date(2026, 9, 22)), Date.UTC(2026, 9, 22) / 86_400_000);
  // Same convention on both sides: a UTC-midnight deadline is still day 0 at
  // 23:59 UTC even though that is already the next day in IST.
  assert.equal(hubDaysUntil(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-22T23:59:00Z")), 0);
  assert.equal(hubDaysUntil(new Date("2026-10-22T00:00:00Z"), new Date("2026-10-23T00:00:00Z")), -1);
});

check("score refresh: only changed rows are written, and a fresh row is left alone", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const row = {
    id: 1,
    hubScore: 0,
    popularity: 50,
    registrationDeadline: new Date("2026-10-25T00:00:00Z"),
    prize: null,
    mode: "ONLINE",
    country: null,
    verificationStatus: "UNVERIFIED",
  };
  const updates = staleScoreUpdates([row], now);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 1);
  assert.ok(updates[0].next > 0);
  assert.deepEqual(staleScoreUpdates([{ ...row, hubScore: updates[0].next }], now), []);
});

// ══════════════════════════════════════════════════════════════════════
// Issue 1 — registration URLs are never fabricated
// ══════════════════════════════════════════════════════════════════════
const PAGE = "https://devfolio.co/hackathons/ai-hack-2027";

check("issue1: no registration link → null (page URL is not a signup form)", () => {
  const e = extractFromHtml("<html><title>AI Hack</title><p>Great event.</p></html>", PAGE);
  assert.equal(e.registrationUrl, null);
  assert.equal(e.registrationUrl === PAGE, false);
});

check("issue1: valid relative registration link resolved against page", () => {
  const e = extractFromHtml('<a href="/apply/ai-hack">Register now</a>', PAGE);
  assert.equal(e.registrationUrl, "https://devfolio.co/apply/ai-hack");
});

check("issue1: valid absolute registration link kept", () => {
  const e = extractFromHtml('<a href="https://forms.gle/abc123">Apply Now</a>', PAGE);
  assert.equal(e.registrationUrl, "https://forms.gle/abc123");
});

check("issue1: malformed/javascript link rejected, not replaced with page URL", () => {
  const e = extractFromHtml('<a href="javascript:alert(1)">Register</a>', PAGE);
  assert.equal(e.registrationUrl, null);
  assert.equal(resolveRegistrationUrl("http://", PAGE), null);
  assert.equal(resolveRegistrationUrl("mailto:x@example.com", PAGE), null);
});

check("issue1: JSON-LD offer URL resolved; missing stays absent", () => {
  const withOffer = `<script type="application/ld+json">{"@type":"Event","name":"H","offers":[{"url":"/signup"}]}</script>`;
  assert.equal(extractFromHtml(withOffer, PAGE).registrationUrl, "https://devfolio.co/signup");
  const noOffer = `<script type="application/ld+json">{"@type":"Event","name":"H"}</script>`;
  assert.equal(extractFromHtml(noOffer, PAGE).registrationUrl, null);
});

check("issue1: missing registration URL lowers confidence and is mandatory-missing", () => {
  const e = fullEvent({ registrationUrl: null });
  assert.ok(scoreConfidence(e, "OFFICIAL_WEBSITE") < 0.9);
  assert.ok(mandatoryMissing(e).includes("registrationUrl"));
});

// ══════════════════════════════════════════════════════════════════════
// Issue 2 — organiser is evidence-only
// ══════════════════════════════════════════════════════════════════════
check("issue2: explicit organiser extracted", () => {
  const e = extractFromHtml("<p>Hosted by Acme Robotics Club</p>", PAGE);
  assert.equal(e.organiser?.toLowerCase(), "acme robotics club");
});

check("issue2: no organiser → null, hostname never used", () => {
  const e = extractFromHtml("<p>A hackathon with prizes.</p>", PAGE);
  assert.equal(e.organiser, null);
  assert.notEqual(e.organiser, "devfolio.co");
});

check("issue2: plausible hostname-shaped text is not an organiser", () => {
  const e = extractFromHtml("<title>AI Hack</title><p>Welcome to devfolio.co</p>", PAGE);
  assert.equal(e.organiser, null);
});

check("issue2: missing organiser lowers confidence and is mandatory-missing", () => {
  const e = fullEvent({ organiser: null });
  assert.ok(scoreConfidence(e, "OFFICIAL_WEBSITE") < 0.9);
  assert.ok(mandatoryMissing(e).includes("organiser"));
});

check("issue2: JSON-LD organiser still honoured", () => {
  const html = `<script type="application/ld+json">{"@type":"Event","name":"H","organizer":{"name":"TCET"}}</script>`;
  assert.equal(extractFromHtml(html, PAGE).organiser, "TCET");
});

// ══════════════════════════════════════════════════════════════════════
// Issue 3 — endDate is never copied from startDate
// ══════════════════════════════════════════════════════════════════════
check("issue3: single date → startDate set, endDate null", () => {
  const e = extractFromHtml("<p>Event starts 10 October 2026</p>", PAGE);
  assert.equal(e.startDate, "2026-10-10");
  assert.equal(e.endDate, null);
});

check("issue3: genuine multi-day range keeps both dates", () => {
  const e = extractFromHtml("<p>Hackathon from 10 October 2026 to 12 October 2026</p>", PAGE);
  assert.equal(e.startDate, "2026-10-10");
  assert.equal(e.endDate, "2026-10-12");
});

check("issue3: explicit JSON-LD endDate honoured", () => {
  const html = `<script type="application/ld+json">{"@type":"Event","name":"H","startDate":"2027-01-10","endDate":"2027-01-12"}</script>`;
  const e = extractFromHtml(html, PAGE);
  assert.equal(e.startDate, "2027-01-10");
  assert.equal(e.endDate, "2027-01-12");
});

check("issue3: no dates → both null, status UNKNOWN", () => {
  const e = extractFromHtml("<p>Dates coming soon.</p>", PAGE);
  assert.equal(e.startDate, null);
  assert.equal(e.endDate, null);
  assert.equal(getEventStatus(e.startDate, e.endDate), "UNKNOWN");
});

check("issue3: null endDate does not crash event status", () => {
  const now = new Date("2027-01-11T12:00:00Z");
  assert.equal(getEventStatus("2027-01-11", null, now), "ONGOING");
  assert.equal(getEventStatus("2027-01-01", null, now), "COMPLETED");
  assert.equal(getEventStatus("2027-02-01", null, now), "UPCOMING");
});

check("issue3: monitoring detects a real end date discovered later", () => {
  const before = extractFromHtml("<p>Starts 10 October 2026</p>", PAGE);
  const after = extractFromHtml("<p>Starts 10 October 2026</p><p>Ends 12 October 2026</p>", PAGE);
  assert.equal(before.endDate, null);
  assert.equal(after.endDate, "2026-10-12");
  const diffs = diffImportant(
    { startDate: before.startDate, endDate: before.endDate },
    { startDate: after.startDate, endDate: after.endDate },
  );
  assert.ok(diffs.some((d) => d.field === "endDate"));
});

// ══════════════════════════════════════════════════════════════════════
// Issue 4 — AI sentinels and date validation before persistence
// ══════════════════════════════════════════════════════════════════════
check("issue4: sentinel strings recognised case-insensitively", () => {
  for (const v of ["null", "NULL", "undefined", "N/A", "n/a", "na", "none", "-", " ", ""]) {
    assert.ok(isSentinel(v), JSON.stringify(v));
  }
  assert.ok(isSentinel(null) && isSentinel(undefined));
  assert.ok(!isSentinel("AI Hack"));
  assert.ok(!isSentinel(0));
});

check("issue4: normalizeIsoDate accepts valid, rejects impossible/loose", () => {
  assert.equal(normalizeIsoDate("2027-04-13"), "2027-04-13");
  assert.equal(normalizeIsoDate("2027-04-13T10:30:00Z"), "2027-04-13");
  assert.equal(normalizeIsoDate("2027-02-30"), null);
  assert.equal(normalizeIsoDate("2027-13-01"), null);
  assert.equal(normalizeIsoDate("10/10/2026"), null);
  assert.equal(normalizeIsoDate("N/A"), null);
  assert.equal(normalizeIsoDate(""), null);
});

check("issue4: toDbDate never returns an Invalid Date", () => {
  assert.equal(toDbDate("N/A"), null);
  assert.equal(toDbDate("null"), null);
  assert.equal(toDbDate("2027-02-30"), null);
  assert.equal(toDbDate(""), null);
  assert.equal(toDbDate(undefined), null);
  assert.ok(toDbDate("2027-04-13") instanceof Date);
  assert.equal((toDbDate("2027-04-13") as Date).toISOString(), "2027-04-13T00:00:00.000Z");
  const invalid = new Date("nonsense");
  assert.equal(toDbDate(invalid), null);
});

check("issue4: CSV/opportunity schema rejects sentinel + impossible dates", () => {
  const base = { title: "Hack", category: "Hackathon", organizer: "Org" };
  assert.ok(opportunityCreateSchema.safeParse({ ...base, registrationDeadline: "N/A" }).success === false);
  assert.ok(opportunityCreateSchema.safeParse({ ...base, registrationDeadline: "2027-02-30" }).success === false);
  assert.ok(opportunityCreateSchema.safeParse({ ...base, startDate: "2027-04-31" }).success === false);
  const ok = opportunityCreateSchema.safeParse({ ...base, registrationDeadline: "2027-04-13" });
  assert.ok(ok.success);
});

// ══════════════════════════════════════════════════════════════════════
// Issue 7 — one authoritative city registry
// ══════════════════════════════════════════════════════════════════════
check("issue7: every registered city is recognisable and has valid coordinates", () => {
  for (const city of HUB_CITIES) {
    assert.ok(findHubCityInText(`hackathon in ${city.name}`), city.name);
    assert.ok(resolveHubCity(city.name), city.name);
    assert.ok(city.lat >= 6 && city.lat <= 37, `${city.name} lat`);
    assert.ok(city.lon >= 68 && city.lon <= 98, `${city.name} lon`);
  }
});

check("issue7: no duplicate normalized city keys or aliases", () => {
  const keys = HUB_CITIES.flatMap((c) => [c.name, ...c.aliases]).map((v) => v.trim().toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
});

check("issue7: previously missing cities resolve, extract and yield distances", () => {
  const missing = ["Kolkata", "Kochi", "Indore", "Guwahati", "Ahmedabad", "Jaipur", "Chandigarh", "Srivilliputhur"];
  for (const name of missing) {
    assert.ok(cityCoords(name), name);
    assert.ok(typeof kmFromTcet(name) === "number", name);
    const e = extractFromHtml(`<p>Venue: ${name}</p>`, PAGE);
    assert.equal(e.city, name);
  }
});

check("issue7: unknown city stays unknown (no fabricated distance)", () => {
  assert.equal(cityCoords("Atlantis"), null);
  assert.equal(kmFromTcet("Atlantis"), null);
  assert.equal(extractFromHtml("<p>Venue: Atlantis</p>", PAGE).city, null);
});

check("issue7: aliases map to the canonical persisted name", () => {
  assert.equal(extractFromHtml("<p>Venue: Bengaluru</p>", PAGE).city, "Bengaluru");
  assert.equal(resolveHubCity("Bangalore")?.name, "Bengaluru");
  assert.equal(kmFromTcet("Mumbai") as number > 0, true);
});

// ══════════════════════════════════════════════════════════════════════
// Issue 8 — ambiguous numeric dates are rejected
// ══════════════════════════════════════════════════════════════════════
check("issue8: 03/04/2027 is ambiguous → rejected", () => {
  assert.equal(parseNumericDate("03", "04", "2027"), null);
  assert.equal(extractFromHtml("<p>Event on 03/04/2027</p>", PAGE).startDate, null);
});

check("issue8: unambiguous numeric dates accepted", () => {
  assert.equal(parseNumericDate("13", "04", "2027"), "2027-04-13");
  assert.equal(parseNumericDate("04", "13", "2027"), "2027-04-13");
  assert.equal(extractFromHtml("<p>Event on 13/04/2027</p>", PAGE).startDate, "2027-04-13");
  assert.equal(extractFromHtml("<p>Event on 04/13/2027</p>", PAGE).startDate, "2027-04-13");
});

check("issue8: impossible month/day and leap-day rules enforced", () => {
  assert.equal(parseNumericDate("32", "13", "2027"), null);
  assert.equal(isValidCalendarDate(2027, 2, 29), false);
  assert.equal(isValidCalendarDate(2028, 2, 29), true);
  assert.equal(parseNumericDate("29", "02", "2027"), null);
  assert.equal(parseNumericDate("29", "02", "2028"), "2028-02-29");
  assert.equal(extractFromHtml("<p>Event on 31 February 2027</p>", PAGE).startDate, null);
});

check("issue8: written-month and ISO dates still work, duplicates collapse", () => {
  assert.equal(extractFromHtml("<p>Starts 13 April 2027</p>", PAGE).startDate, "2027-04-13");
  assert.equal(extractFromHtml("<p>Starts 2027-04-13</p>", PAGE).startDate, "2027-04-13");
  const dup = extractFromHtml("<p>13 April 2027</p><p>13 April 2027</p>", PAGE);
  assert.equal(dup.startDate, "2027-04-13");
  assert.equal(dup.endDate, null);
});

check("issue8: omitted ambiguous date does not fake registration status", () => {
  assert.equal(getRegistrationStatus(null), "UNKNOWN");
  assert.equal(extractFromHtml("<p>Registration deadline 03/04/2027</p>", PAGE).registrationDeadline, null);
});

// ══════════════════════════════════════════════════════════════════════
// Issue 6 — curated-record protection helpers
// ══════════════════════════════════════════════════════════════════════
check("issue6: curated verification states identified", () => {
  for (const s of ["VERIFIED", "ADMIN_VERIFIED", "OFFICIAL_SOURCE"]) assert.ok(isCuratedVerification(s), s);
  for (const s of ["UNVERIFIED", "PLATFORM_VERIFIED", null]) assert.ok(!isCuratedVerification(s), String(s));
});

check("issue6: placeholder descriptions recognised", () => {
  assert.ok(isPlaceholderDescription("Auto-published with missing fields: organiser — verify on the official page."));
  assert.ok(!isPlaceholderDescription("A real curated description."));
  assert.ok(!isPlaceholderDescription(null));
});

// ══════════════════════════════════════════════════════════════════════
// Integration + regression — database-backed sections
// ══════════════════════════════════════════════════════════════════════
const MARK = `__hubcheck_${Date.now()}`;

function api(path: string, ip = "unknown", headers: Record<string, string> = {}) {
  return hubGET(
    new NextRequest(`http://localhost${path}`, { headers: { "x-forwarded-for": ip, ...headers } }),
  );
}

async function runDbChecks() {
  const admin = await prisma.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("DB checks need at least one user for createdById");
  const actorId = admin.id;

  const oppIds: number[] = [];
  const candidateIds: number[] = [];
  const logStart = (await prisma.hubImportLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0;
  const bulkIds: number[] = [];

  const mkOpp = async (data: {
    title: string;
    organizer: string;
    verificationStatus: string;
    description?: string | null;
    applicationUrl?: string | null;
    sourceUrl?: string | null;
    city?: string | null;
    mode?: string | null;
    themes?: string[];
    startDate?: Date | null;
    endDate?: Date | null;
    registrationDeadline?: Date | null;
    createdAt?: Date;
  }) => {
    const row = await prisma.opportunity.create({
      data: {
        title: data.title,
        category: "Hackathon",
        organizer: data.organizer,
        description: data.description ?? null,
        status: "APPROVED",
        showInHub: true,
        verificationStatus: data.verificationStatus,
        applicationUrl: data.applicationUrl ?? null,
        sourceUrl: data.sourceUrl ?? null,
        city: data.city ?? null,
        mode: data.mode ?? null,
        themes: data.themes ?? undefined,
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        registrationDeadline: data.registrationDeadline ?? null,
        createdAt: data.createdAt ?? undefined,
        createdById: actorId,
      },
    });
    oppIds.push(row.id);
    return row;
  };

  const mkCandidate = async (url: string, extracted: Prisma.InputJsonObject) => {
    const row = await prisma.hubCandidate.create({
      data: {
        url,
        source: "ADMIN",
        sourceType: "ADMIN",
        status: "NEEDS_REVIEW",
        title: String(extracted.eventName ?? "Candidate"),
        extracted,
        confidence: 0.75,
      },
    });
    candidateIds.push(row.id);
    return row;
  };

  try {
    // ── Issue 6: curated records are never overwritten ──
    for (const status of ["ADMIN_VERIFIED", "VERIFIED", "OFFICIAL_SOURCE"]) {
      await checkAsync(`issue6: publish against ${status} flags conflict, leaves row intact`, async () => {
        const url = `https://example.com/${MARK}/${status.toLowerCase()}`;
        const opp = await mkOpp({
          title: `${MARK} Curated ${status}`,
          organizer: `Org ${status}`,
          verificationStatus: status,
          description: "Curated description that must survive.",
          applicationUrl: url,
        });
        const cand = await mkCandidate(`${url}/candidate`, {
          eventName: `${MARK} Curated ${status}`,
          organiser: `Org ${status}`,
          registrationUrl: url,
          startDate: "2027-01-10",
          endDate: "2027-01-12",
          mode: "ONLINE",
        });
        const res = await publishCandidate(cand.id, actorId);
        assert.equal(res.conflict, true);
        const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
        assert.equal(after.description, "Curated description that must survive.");
        assert.equal(after.verificationStatus, status);
        assert.equal(after.startDate, null);
        const afterCand = await prisma.hubCandidate.findUniqueOrThrow({ where: { id: cand.id } });
        assert.equal(afterCand.status, "NEEDS_UPDATE");
      });
    }

    await checkAsync("issue6: unverified row updates, real description preserved", async () => {
      const url = `https://example.com/${MARK}/unverified`;
      const opp = await mkOpp({
        title: `${MARK} Unverified`,
        organizer: "Org Unverified",
        verificationStatus: "UNVERIFIED",
        description: "Real description written by an admin.",
        applicationUrl: url,
      });
      const cand = await mkCandidate(`${url}/candidate`, {
        eventName: `${MARK} Unverified`,
        organiser: "Org Unverified",
        registrationUrl: url,
        startDate: "2027-02-10",
        mode: "HYBRID",
        city: "Pune",
      });
      const res = await publishCandidate(cand.id, actorId);
      assert.equal(res.conflict, undefined);
      assert.equal(res.merged, true);
      const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
      assert.equal(after.description, "Real description written by an admin.");
      assert.equal(after.startDate?.toISOString().slice(0, 10), "2027-02-10");
      assert.equal(after.mode, "HYBRID");
      assert.equal(after.city, "Pune");
    });

    await checkAsync("issue6: placeholder cannot replace a real description (CSV path too)", async () => {
      const url = `https://example.com/${MARK}/placeholder`;
      const opp = await mkOpp({
        title: `${MARK} Placeholder`,
        organizer: "Org Placeholder",
        verificationStatus: "UNVERIFIED",
        description: "Genuine curated copy.",
        sourceUrl: url,
      });
      const csv = `eventName,organiser,category,sourceUrl\n${MARK} Placeholder,Org Placeholder,Hackathon,${url}`;
      const result = await runCsvImport(csv, { actorId, actorRole: "ADMIN", origin: "CSV" });
      assert.equal(result.updated, 1);
      const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
      assert.equal(after.description, "Genuine curated copy.");
    });

    await checkAsync("issue6: CSV rejects curated conflict with explicit stat", async () => {
      const url = `https://example.com/${MARK}/csv-curated`;
      const opp = await mkOpp({
        title: `${MARK} CSV Curated`,
        organizer: "Org CSV Curated",
        verificationStatus: "ADMIN_VERIFIED",
        description: "Curated CSV copy.",
        sourceUrl: url,
      });
      const csv = `eventName,organiser,category,sourceUrl\n${MARK} CSV Curated,Org CSV Curated,Hackathon,${url}`;
      const result = await runCsvImport(csv, { actorId, actorRole: "ADMIN", origin: "CSV" });
      assert.equal(result.conflicts, 1);
      assert.equal(result.updated, 0);
      const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
      assert.equal(after.description, "Curated CSV copy.");
    });

    await checkAsync("issue4: CSV invalid/sentinel dates are rejected, not persisted", async () => {
      const csv = [
        "eventName,organiser,category,registrationDeadline,startDate",
        `${MARK} Bad Deadline,Org X,Hackathon,N/A,2027-04-13`,
        `${MARK} Bad Start,Org X,Hackathon,2027-04-01,2027-02-30`,
        `${MARK} Good Dates,Org X,Hackathon,2027-04-01,2027-04-13`,
      ].join("\n");
      const result = await runCsvImport(csv, { actorId, actorRole: "ADMIN", origin: "CSV" });
      assert.equal(result.rejected, 2);
      assert.equal(result.inserted, 1);
      const good = await prisma.opportunity.findFirst({ where: { title: `${MARK} Good Dates` } });
      assert.ok(good);
      oppIds.push(good.id);
      assert.equal(good.startDate?.toISOString().slice(0, 10), "2027-04-13");
    });

    // ── Issue 10: monitor is bounded and reports remaining work ──
    await checkAsync("issue10: zero budget performs no fetches and reports deferred", async () => {
      const total = await prisma.opportunity.count({ where: { status: "APPROVED" } });
      const res = await runMonitor({ limit: 5, budgetMs: 0 });
      assert.equal(res.checked, 0);
      assert.equal(res.batch, 5);
      assert.equal(res.deferred, total);
    });

    // ── Issue 9: filters before limit + cursor pagination ──
    const matchingIds: number[] = [];
    const fillerIds: number[] = [];
    // 5 matching rows are OLDER than 200 newer non-matching rows, so any
    // take-200-then-filter implementation would return nothing.
    const matching = await prisma.opportunity.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        title: `${MARK} Quantum Hack ${i}`,
        category: "Hackathon",
        organizer: `${MARK} Org`,
        description: `${MARK} quantum event`,
        status: "APPROVED",
        showInHub: true,
        verificationStatus: "UNVERIFIED",
        city: "Mumbai",
        mode: "OFFLINE",
        themes: ["Quantum"],
        startDate: new Date("2027-03-15T00:00:00Z"),
        createdAt: new Date("2020-01-01T00:00:00Z"),
        createdById: actorId,
      })),
    });
    assert.equal(matching.count, 5);
    const fillers = await prisma.opportunity.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        title: `${MARK} Filler ${i}`,
        category: "Hackathon",
        organizer: `${MARK} Org`,
        status: "APPROVED",
        showInHub: true,
        verificationStatus: "UNVERIFIED",
        city: "Pune",
        mode: "ONLINE",
        themes: ["Web"],
        startDate: new Date("2027-05-01T00:00:00Z"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
        createdById: actorId,
      })),
    });
    assert.equal(fillers.count, 200);
    const created = await prisma.opportunity.findMany({
      where: { title: { startsWith: MARK } },
      select: { id: true, title: true },
    });
    for (const row of created) {
      bulkIds.push(row.id);
      if (row.title.includes("Quantum")) matchingIds.push(row.id);
      else fillerIds.push(row.id);
    }

    await checkAsync("issue9: domain filter finds matches beyond the first 200", async () => {
      const res = await api(`/api/hackathon-hub?domain=quantum&limit=50`);
      const json = await res.json();
      assert.equal(res.status, 200);
      const ids = json.data.items.map((r: { id: number }) => r.id);
      assert.equal(ids.length, 5);
      for (const id of matchingIds) assert.ok(ids.includes(id), `missing ${id}`);
    });

    await checkAsync("issue9: month filter runs in the DB, beyond the first 200", async () => {
      const res = await api(`/api/hackathon-hub?month=2027-03&limit=50`);
      const json = await res.json();
      const ids = json.data.items.map((r: { id: number }) => r.id);
      for (const id of matchingIds) assert.ok(ids.includes(id), `missing ${id}`);
    });

    await checkAsync("issue9: combined filters all applied", async () => {
      const res = await api(`/api/hackathon-hub?domain=quantum&month=2027-03&city=Mumbai&mode=OFFLINE&search=${encodeURIComponent(MARK)}&limit=50`);
      const json = await res.json();
      assert.equal(json.data.items.length, 5);
    });

    await checkAsync("issue9: cursor pagination is stable, no duplicates or gaps", async () => {
      const seen: number[] = [];
      let cursor: number | null = null;
      for (let page = 0; page < 6; page++) {
        const qs: string = `domain=quantum&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
        const json: { data: { items: { id: number }[]; nextCursor: number | null; hasMore: boolean } } =
          await (await api(`/api/hackathon-hub?${qs}`)).json();
        seen.push(...json.data.items.map((r: { id: number }) => r.id));
        if (!json.data.hasMore) break;
        cursor = json.data.nextCursor;
        assert.ok(cursor, "hasMore requires a cursor");
      }
      assert.equal(seen.length, 5);
      assert.equal(new Set(seen).size, 5);
      for (const id of matchingIds) assert.ok(seen.includes(id));
    });

    await checkAsync("issue9: invalid and stale cursors are rejected safely", async () => {
      assert.equal((await api(`/api/hackathon-hub?cursor=abc`)).status, 400);
      assert.equal((await api(`/api/hackathon-hub?cursor=999999999`)).status, 400);
    });

    await checkAsync("issue9: page size is capped", async () => {
      const json = await (await api(`/api/hackathon-hub?limit=999`)).json();
      assert.ok(json.data.items.length <= 50);
    });

    await checkAsync("issue9: public response keeps the allowlist", async () => {
      const json = await (await api(`/api/hackathon-hub?limit=1`)).json();
      const item = json.data.items[0];
      assert.ok(item);
      assert.equal("createdById" in item, false);
      assert.equal("pageHash" in item, false);
      assert.equal("verificationStatus" in item, true);
    });

    // The UI renders "Sign in to save" / "students only" from this block; it
    // must never learn the role by firing a write that returns 401/403.
    await checkAsync("viewer: capability is answered by the listing, interests only for students", async () => {
      const token = `${MARK} Viewer`;
      const opp = await mkOpp({
        title: token,
        organizer: `${MARK} Org`,
        verificationStatus: "UNVERIFIED",
      });
      const qs = `/api/hackathon-hub?search=${encodeURIComponent(token)}&limit=50`;
      const jsonOf = async (headers: Record<string, string> = {}) =>
        (await api(qs, "198.51.100.7", headers)).json();

      const anonRes = await api(qs, "198.51.100.7");
      const anon = await anonRes.json();
      assert.match(anonRes.headers.get("cache-control") ?? "", /no-store/, "per-session payload must not be cached");
      assert.deepEqual(anon.data.viewer, { authenticated: false, canSave: false });
      assert.equal(anon.data.items[0].myInterest, null);

      await prisma.opportunityInterest.create({
        data: { userId: actorId, opportunityId: opp.id, status: "SAVED" },
      });
      const studentToken = generateAccessToken({
        id: actorId,
        role: "STUDENT",
        name: "Check Student",
        email: "checks@example.com",
      });
      const student = await jsonOf({ authorization: `Bearer ${studentToken}` });
      assert.deepEqual(student.data.viewer, { authenticated: true, canSave: true });
      assert.equal(student.data.items[0].myInterest.status, "SAVED");

      const facultyToken = generateAccessToken({
        id: actorId,
        role: "FACULTY",
        name: "Check Faculty",
        email: "checks@example.com",
      });
      const faculty = await jsonOf({ authorization: `Bearer ${facultyToken}` });
      assert.deepEqual(faculty.data.viewer, { authenticated: true, canSave: false });
      assert.equal(faculty.data.items[0].myInterest, null, "non-students cannot own a save");
    });

    // A finished event with no published deadline has to be judged by its
    // start date. Requiring a non-null deadline here kept these rows in the
    // listing forever, even though the card already said "Closes with start".
    await checkAsync("dead event: no deadline still means closed at start; running event stays", async () => {
      const token = `${MARK} NullDeadline`;
      const day = 86_400_000;
      const past = new Date(Date.now() - 10 * day);
      const future = new Date(Date.now() + 10 * day);
      const dead = await mkOpp({
        title: `${token} Dead`,
        organizer: `${MARK} Org`,
        verificationStatus: "UNVERIFIED",
        startDate: past,
        endDate: past,
      });
      const running = await mkOpp({
        title: `${token} Running`,
        organizer: `${MARK} Org`,
        verificationStatus: "UNVERIFIED",
        startDate: past,
        endDate: future,
      });
      const undated = await mkOpp({
        title: `${token} Undated`,
        organizer: `${MARK} Org`,
        verificationStatus: "UNVERIFIED",
      });
      const json = await (await api(`/api/hackathon-hub?search=${encodeURIComponent(token)}&limit=50`)).json();
      assert.equal(json.data.items.length, 2);
      const ids = json.data.items.map((r: { id: number }) => r.id);
      assert.equal(ids.includes(dead.id), false, "finished without a deadline must be hidden");
      assert.ok(ids.includes(running.id), "still-running event must stay");
      assert.ok(ids.includes(undated.id), "no dates at all is unknown, not finished");
    });

    await checkAsync("issue9: rate limiter returns 429 after the window budget", async () => {
      let last = 200;
      for (let i = 0; i < 61; i++) {
        const res = await api(`/api/hackathon-hub?limit=1`, "203.0.113.9");
        last = res.status;
        if (last === 429) break;
      }
      assert.equal(last, 429);
    });

    await checkAsync("issue10: cron rejects an unauthenticated request", async () => {
      const { GET: cronGET } = await import("../../src/app/api/cron/hub/route");
      const prev = process.env.CRON_SECRET;
      process.env.CRON_SECRET = "checks-secret";
      try {
        const res = await cronGET(new NextRequest("http://localhost/api/cron/hub?job=monitor"));
        assert.equal(res.status, 403);
      } finally {
        if (prev === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = prev;
      }
    });
  } finally {
    // Cleanup: only rows created by this run (unique MARK), never seed data.
    if (candidateIds.length) await prisma.hubCandidate.deleteMany({ where: { id: { in: candidateIds } } });
    const allOppIds = [...oppIds];
    if (bulkIds.length) allOppIds.push(...bulkIds);
    if (allOppIds.length) await prisma.opportunity.deleteMany({ where: { id: { in: allOppIds } } });
    const leftovers = await prisma.opportunity.findMany({ where: { title: { startsWith: MARK } }, select: { id: true } });
    if (leftovers.length) await prisma.opportunity.deleteMany({ where: { id: { in: leftovers.map((r) => r.id) } } });
    await prisma.hubImportLog.deleteMany({ where: { id: { gt: logStart } } });
  }
}

runDbChecks()
  .then(() => {
    console.log(`\nALL CHECKS PASSED (${passed})`);
  })
  .catch((err) => {
    console.error("\nCHECK FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
