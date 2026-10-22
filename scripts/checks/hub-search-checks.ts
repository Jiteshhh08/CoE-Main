/**
 * Checks for the self-hosted search + render layer (Firecrawl) and the
 * confidence-ceiling fix.
 *
 * Sections A–B are pure-function regressions (no network, no DB).
 * Sections C–E are integration checks: they hit the self-hosted Firecrawl
 * service and the development database that DATABASE_URL points at. DB rows
 * created here are removed in the finally block.
 *
 * Run: FIRECRAWL_URL=http://127.0.0.1:3002 \
 *      DATABASE_URL=... npx --yes tsx scripts/checks/hub-search-checks.ts
 */
import assert from 'node:assert';
import prisma from '../../src/lib/prisma';
import {
  extractFromHtml,
  scoreConfidence,
  mandatoryMissing,
  HUB_VERIFY_THRESHOLD,
  type ExtractedEvent,
} from '../../src/lib/hub/extract';
import {
  isFirecrawlConfigured,
  fetchHtmlWithRender,
  renderHtml,
  renderBudgetAvailable,
  renderBudgetState,
  resetRenderBudget,
  rendererHealthy,
} from '../../src/lib/hub/firecrawl';
import {
  runDiscovery,
  discoverFromStructured,
  extractEventLinks,
  decodeEntities,
  PLATFORM_MATCHERS,
  registersOnEventPage,
  isIndividualEventPage,
} from '../../src/lib/hub/discovery';
import { STRUCTURED_SOURCES, fetchStructuredPage, parseDateRange, parseDevpost } from '../../src/lib/hub/structured';
import { addToIndex, indexHas, isSameEvent, titleKey, type ExistingIndex } from '../../src/lib/hub/dedupe';
import { deriveRegistrationDeadline, wouldAutoVerify } from '../../src/lib/hub/confidence';
import { ensureHubSources } from '../../src/lib/hub/sources';
import { fetchPublicText } from '../../src/lib/hub/fetch-guard';
import { cleanEventTitle } from '../../src/lib/hackathon-hub';
import { cleanOrganiser } from '../../src/lib/hub/text';
import { publishCandidate } from '../../src/lib/hub/pipeline';
import {
  computeHubScore,
  isAttendable,
  isOver,
  percentileRanks,
  type RankableOpportunity,
} from '../../src/lib/hub/ranking';

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

const fullEvent = (over: Partial<ExtractedEvent> = {}): ExtractedEvent => ({
  eventName: 'HackMatrix 5.0',
  organiser: "PCCOE'S GFG Student Chapter",
  startDate: '2026-11-15',
  registrationDeadline: '2026-11-01',
  registrationUrl: 'https://unstop.com/hackathons/hackmatrix-5',
  mode: 'OFFLINE',
  state: 'Maharashtra',
  city: 'Pune',
  venue: 'PCCOE',
  prizePool: '₹70,000',
  teamMin: 3,
  teamMax: 4,
  eligibility: null,
  endDate: null,
  domains: ['AI'],
  ...over,
});

// The real gate from runExtraction: BOTH conditions must hold.
const wouldVerify = (e: ExtractedEvent, src: string) =>
  mandatoryMissing(e).length === 0 && scoreConfidence(e, src) >= HUB_VERIFY_THRESHOLD;

const filled = (e: ExtractedEvent) =>
  Object.values(e).filter((v) => v !== null && v !== undefined && v !== '').length;

// ─── A. Confidence ceiling ───
// Regression: INDIAHACKATHONS had no source tier at all, capping a PERFECT
// extraction at 0.75 -> 92 of 111 live candidates were stuck in review forever.
check('confidence: fully-specified INDIAHACKATHONS event now clears the threshold', () => {
  const c = scoreConfidence(fullEvent(), 'INDIAHACKATHONS');
  assert.strictEqual(c, 0.9, `expected 0.9, got ${c}`);
  assert.ok(c >= HUB_VERIFY_THRESHOLD, 'must reach auto-verify threshold');
});

check('confidence: INDIAHACKATHONS was previously capped below threshold', () => {
  // Old formula: 0.4 + 0.30 fields + 0 (no tier) + 0.03 city + 0.02 prize = 0.75
  const oldValue = 0.4 + 0.3 + 0 + 0.03 + 0.02;
  assert.strictEqual(Math.round(oldValue * 100) / 100, 0.75);
  assert.ok(oldValue < HUB_VERIFY_THRESHOLD, 'old ceiling must be unreachable');
});

check('confidence: named aggregators clear the threshold when complete', () => {
  for (const src of ['UNSTOP', 'DEVFOLIO', 'MLH', 'HACKEREARTH', 'HACK2SKILL', 'INDIAHACKATHONS']) {
    const c = scoreConfidence(fullEvent(), src);
    assert.ok(c >= HUB_VERIFY_THRESHOLD, `${src} got ${c}`);
  }
});

check('confidence: trusted sources remain highest', () => {
  assert.strictEqual(scoreConfidence(fullEvent(), 'GOVERNMENT'), 0.95);
  assert.strictEqual(scoreConfidence(fullEvent(), 'OFFICIAL_WEBSITE'), 0.95);
});

check('confidence: missing fields still block auto-verify (no loosening)', () => {
  const partial = fullEvent({ registrationDeadline: null, mode: null, city: null });
  assert.strictEqual(wouldVerify(partial, 'UNSTOP'), false);
  assert.strictEqual(mandatoryMissing(partial).length, 2);
  // A missing mandatory field blocks even the highest-trust source, even where
  // the raw score alone would still reach the threshold.
  assert.strictEqual(wouldVerify(fullEvent({ startDate: null }), 'GOVERNMENT'), false);
  assert.strictEqual(wouldVerify(fullEvent(), 'GOVERNMENT'), true);
});

check('confidence: aggregators with all six fields + city + prize do verify', () => {
  for (const src of ['UNSTOP', 'DEVFOLIO', 'INDIAHACKATHONS', 'MLH']) {
    assert.strictEqual(wouldVerify(fullEvent(), src), true, `${src} should verify`);
  }
});

check('confidence: complete aggregator verifies without city or prize', () => {
  // These two used to be required to clear the bar, which meant a Devfolio event
  // with a real organiser, both dates, mode and a signup link was rejected for
  // having no prize pool. City and prize are decoration; completeness is the gate.
  const c = scoreConfidence(fullEvent({ prizePool: null }), 'UNSTOP');
  assert.strictEqual(c, 0.88);
  assert.ok(c >= HUB_VERIFY_THRESHOLD, 'a complete listing must not be held back by decoration fields');
  assert.strictEqual(wouldVerify(fullEvent({ prizePool: null }), 'UNSTOP'), true);
  // Online needs no city, so it clears the bar with neither bonus.
  assert.strictEqual(wouldVerify(fullEvent({ city: null, prizePool: null, mode: 'ONLINE' }), 'UNSTOP'), true);
});

check('confidence: unknown source gets no tier bonus', () => {
  assert.strictEqual(scoreConfidence(fullEvent(), 'SOMETHING_ELSE'), 0.75);
});

// ─── B. Renderer config guard ───
check('renderer: disabled when FIRECRAWL_URL is unset', () => {
  const prev = process.env.FIRECRAWL_URL;
  delete process.env.FIRECRAWL_URL;
  assert.strictEqual(isFirecrawlConfigured(), false);
  if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
});

check('renderer: refuses a public host (must not become an egress proxy)', () => {
  const prev = process.env.FIRECRAWL_URL;
  for (const bad of ['http://evil.example.com:3002', 'https://api.openai.com', 'ftp://127.0.0.1:3002']) {
    process.env.FIRECRAWL_URL = bad;
    assert.strictEqual(isFirecrawlConfigured(), false, `should refuse ${bad}`);
  }
  if (prev === undefined) delete process.env.FIRECRAWL_URL;
  else process.env.FIRECRAWL_URL = prev;
});

check('renderer: non-private host needs an explicit allowlist entry', () => {
  const prevUrl = process.env.FIRECRAWL_URL;
  const prevHosts = process.env.FIRECRAWL_ALLOWED_HOSTS;
  process.env.FIRECRAWL_URL = 'http://175.175.1.89:3002';
  delete process.env.FIRECRAWL_ALLOWED_HOSTS;
  assert.strictEqual(isFirecrawlConfigured(), false, 'public-ish host must be refused by default');
  process.env.FIRECRAWL_ALLOWED_HOSTS = '175.175.1.89';
  assert.strictEqual(isFirecrawlConfigured(), true, 'explicitly allowlisted host is accepted');
  process.env.FIRECRAWL_ALLOWED_HOSTS = 'other.host';
  assert.strictEqual(isFirecrawlConfigured(), false, 'a different allowlist entry must not match');
  if (prevUrl === undefined) delete process.env.FIRECRAWL_URL;
  else process.env.FIRECRAWL_URL = prevUrl;
  if (prevHosts === undefined) delete process.env.FIRECRAWL_ALLOWED_HOSTS;
  else process.env.FIRECRAWL_ALLOWED_HOSTS = prevHosts;
});

check('renderer: accepts loopback and private hosts', () => {
  const prev = process.env.FIRECRAWL_URL;
  for (const good of ['http://127.0.0.1:3002', 'http://localhost:3002', 'http://192.168.1.20:3002']) {
    process.env.FIRECRAWL_URL = good;
    assert.strictEqual(isFirecrawlConfigured(), true, `should accept ${good}`);
  }
  if (prev === undefined) delete process.env.FIRECRAWL_URL;
  else process.env.FIRECRAWL_URL = prev;
});

check('extraction: footer chrome never becomes an organiser', () => {
  const junk = '<html><body><p>This event is powered by best viewed in chrome, opera, mozilla</p></body></html>';
  assert.strictEqual(extractFromHtml(junk, 'https://example.com/ev').organiser, null);
  const real = '<html><body><p>This hackathon is organised by Acme Robotics Club Pune</p></body></html>';
  const org = extractFromHtml(real, 'https://example.com/ev').organiser;
  assert.ok(org && /acme/i.test(org), `expected a real organiser, got ${JSON.stringify(org)}`);
});

check('confidence: an ONLINE event is not penalised for having no city', () => {
  const online = fullEvent({ city: null, mode: 'ONLINE' });
  assert.strictEqual(scoreConfidence(online, 'UNSTOP'), 0.9);
  assert.strictEqual(wouldVerify(online, 'UNSTOP'), true);
  // offline with no city still falls short — we genuinely want the location.
  // (0.87: the prize bonus still applies, city is what's missing.)
  const offline = fullEvent({ city: null, mode: 'OFFLINE' });
  assert.strictEqual(scoreConfidence(offline, 'UNSTOP'), 0.87);
  assert.strictEqual(wouldVerify(offline, 'UNSTOP'), false);
});

check('registration: platforms that sign up on the event page are declared', () => {
  assert.strictEqual(registersOnEventPage('unstop'), true);
  assert.strictEqual(registersOnEventPage('devfolio'), true);
  assert.strictEqual(registersOnEventPage('hack2skill'), true);
  assert.strictEqual(registersOnEventPage('indiahackathons'), false);
  assert.strictEqual(registersOnEventPage('government'), false);
});

check('render budget: a spent budget stops rendering instead of stalling the cron', () => {
  const prev = process.env.HUB_RENDER_MAX_PAGES;
  process.env.HUB_RENDER_MAX_PAGES = '0';
  resetRenderBudget();
  assert.strictEqual(renderBudgetAvailable(), false, 'zero-page budget must be exhausted immediately');
  const st = renderBudgetState();
  assert.strictEqual(st.maxPages, 0);
  if (prev === undefined) delete process.env.HUB_RENDER_MAX_PAGES;
  else process.env.HUB_RENDER_MAX_PAGES = prev;
  resetRenderBudget();
  assert.strictEqual(renderBudgetAvailable(), true, 'fresh window has budget again');
});

check('registration: event-page predicate rejects listing/dashboard URLs', () => {
  assert.strictEqual(isIndividualEventPage('https://unstop.com/hackathons/some-event-1', 'unstop'), true);
  assert.strictEqual(isIndividualEventPage('https://unstop.com/hackathons', 'unstop'), false);
  assert.strictEqual(isIndividualEventPage('https://devfolio.co/hackathons/applied', 'devfolio'), false);
  assert.strictEqual(isIndividualEventPage('https://devfolio.co/hackathons/open', 'devfolio'), false);
  assert.strictEqual(isIndividualEventPage('https://biosv2.devfolio.co/', 'devfolio'), true);
});

check('titles: platform chrome is stripped before storage', () => {
  assert.strictEqual(cleanEventTitle('Web Hackathon - 2026 - Unstop'), 'Web Hackathon - 2026');
  assert.strictEqual(cleanEventTitle('SU HACKS 2026 - Unstop'), 'SU HACKS 2026');
  assert.strictEqual(cleanEventTitle('Ignition Hackathon Series 2026 - Unstop'), 'Ignition Hackathon Series 2026');
  assert.strictEqual(cleanEventTitle('AI Hackathon | Devfolio'), 'AI Hackathon');
  assert.strictEqual(cleanEventTitle('HackMatrix 5.0'), 'HackMatrix 5.0');
  assert.strictEqual(cleanEventTitle('  spaced   out  '), 'spaced out');
});

check('entities: link titles are decoded', () => {
  assert.strictEqual(decodeEntities('AI &amp; Prompt Engineering'), 'AI & Prompt Engineering');
  assert.strictEqual(decodeEntities('It&#39;s here'), "It's here");
  assert.strictEqual(decodeEntities('plain text'), 'plain text');
});

check('matcher: unstop accepts event pages only', () => {
  const m = PLATFORM_MATCHERS.unstop.isEventUrl;
  assert.strictEqual(m(new URL('https://unstop.com/hackathons/some-event-123')), true);
  assert.strictEqual(m(new URL('https://unstop.com/hackathons')), false);
  assert.strictEqual(m(new URL('https://unstop.com/competitions')), false);
  assert.strictEqual(m(new URL('https://unstop.com/hackathons/a/b')), false);
});

/**
 * Ranking + the two gates that decide what is allowed into the Hub at all.
 * All pure functions except the last check, which proves the gate held on the
 * rows discovery actually stored.
 */
async function rankingChecks() {
  // ── organiser hygiene: a mandatory field must not be a placeholder ──
  await checkAsync('adapter: placeholder organisers are not organisers', async () => {
    for (const junk of ['N/A', 'n/a', 'NA', 'nill', 'nil', 'none', 'unknown', 'the', 'an', '-', '...', 'TBD', 'test']) {
      assert.strictEqual(cleanOrganiser(junk), null, `"${junk}" must not become an organiser`);
    }
    for (const real of ['Google', 'ISTE SC MANIT', 'International Institute of Information Technology']) {
      assert.strictEqual(cleanOrganiser(real), real, `"${real}" must survive`);
    }
    // Scraped prose stops at the sentence.
    assert.strictEqual(cleanOrganiser('ISTE SC MANIT! This is your chance to win'), null);
    assert.strictEqual(cleanOrganiser(''), null);
    assert.strictEqual(cleanOrganiser(null), null);
  });

  await checkAsync('adapter: live payloads carry no placeholder organisers', async () => {
    let seen = 0;
    const bad: string[] = [];
    for (const key of ['unstop', 'devpost', 'devfolio']) {
      const page = await fetchStructuredPage(key, 1);
      for (const item of page.events) {
        const o = item.event.organiser;
        if (!o) continue;
        seen += 1;
        if (/^(n\/?a|nil+|na|the|none)$/i.test(o.trim())) bad.push(`${key}:"${o}"`);
      }
    }
    assert.strictEqual(bad.length, 0, `placeholders survived: ${bad.slice(0, 5).join(', ')}`);
    assert.ok(seen > 0, 'expected at least some organisers in live payloads');
    console.log(`    ${seen} organisers seen across three live sources, 0 placeholders`);
  });

  await checkAsync('adapter: offline Unstop events keep their country', async () => {
    const { events } = await fetchStructuredPage('unstop', 1);
    const inPerson = events.map((e) => e.event).filter((e) => e.mode && e.mode !== 'ONLINE');
    assert.ok(inPerson.length > 0, 'expected offline/hybrid rows on page 1 of Unstop');
    const lost = inPerson.filter((e) => !e.country);
    assert.strictEqual(
      lost.length,
      0,
      `${lost.length} offline row(s) lost their country, so the India gate would drop them: ` +
        lost.slice(0, 3).map((e) => `"${e.eventName}"`).join(', '),
    );
    const attendable = inPerson.filter((e) => isAttendable(e));
    assert.ok(attendable.length > 0, 'offline Unstop rows must survive the India gate');
    console.log(`    ${attendable.length}/${inPerson.length} offline/hybrid rows are attendable in person`);
  });

  await checkAsync('gate: a missing deadline falls back to the start date', async () => {
    const base = { startDate: '2026-11-01', registrationDeadline: null } as never;
    assert.strictEqual(deriveRegistrationDeadline(base).registrationDeadline, '2026-11-01', 'deadline should fall back to start');
    const owned = { startDate: '2026-11-01', registrationDeadline: '2026-10-25' } as never;
    assert.strictEqual(deriveRegistrationDeadline(owned).registrationDeadline, '2026-10-25', 'a real deadline must win');
    const none = { startDate: null, registrationDeadline: null } as never;
    assert.strictEqual(deriveRegistrationDeadline(none).registrationDeadline, null, 'no dates at all stays null');
  });

  await checkAsync('gate: complete + known source verifies, bonuses do not gate', async () => {
    const complete = {
      eventName: 'Real Hackathon 2026',
      organiser: 'Some College',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      registrationDeadline: '2026-10-30',
      registrationUrl: 'https://example.com/register',
      mode: 'ONLINE',
      city: null,
      prizePool: null,
    } as never;
    // The whole point: a complete aggregator listing with no prize and no city
    // must clear the bar, because those are decoration.
    // 0.88: base tier sits on the bar and the online city bonus lifts it clear.
    assert.ok(scoreConfidence(complete, 'DEVFOLIO') >= HUB_VERIFY_THRESHOLD, 'complete aggregator must clear the bar');
    assert.ok(wouldAutoVerify(complete, 'DEVFOLIO'), 'complete aggregator must verify');
    assert.ok(wouldAutoVerify(complete, 'UNSTOP'), 'complete unstop must verify');
    assert.ok(wouldAutoVerify(complete, 'GOVERNMENT'), 'trusted source must verify');
    assert.ok(scoreConfidence(complete, 'GOVERNMENT') > scoreConfidence(complete, 'DEVFOLIO'), 'trusted must lead aggregators');

    // Incompleteness still blocks, no matter the source.
    for (const field of ['eventName', 'organiser', 'startDate', 'registrationDeadline', 'registrationUrl', 'mode']) {
      const holed = { ...(complete as Record<string, unknown>), [field]: null } as never;
      assert.ok(!wouldAutoVerify(holed, 'GOVERNMENT'), `missing ${field} must block even a trusted source`);
    }
    // An unknown source with everything present is not auto-trusted.
    assert.ok(!wouldAutoVerify(complete, 'SOMETHING_ELSE'), 'unknown source must not auto-verify');
  });

  await checkAsync('gate: an in-person event with no location needs review', async () => {
    const ev = {
      eventName: 'Some Offline Hack 2026',
      organiser: 'A College',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      registrationDeadline: '2026-10-30',
      registrationUrl: 'https://example.com/register',
      mode: 'OFFLINE',
      city: null,
      prizePool: '10000',
    } as never;
    assert.ok(mandatoryMissing(ev).includes('city'), 'offline without a city must be reported missing');
    assert.ok(!wouldAutoVerify(ev, 'GOVERNMENT'), 'even a trusted source cannot publish a location-less offline event');
    const online = { ...(ev as Record<string, unknown>), mode: 'ONLINE' } as never;
    assert.ok(!mandatoryMissing(online).includes('city'), 'online events do not need a city');
    assert.ok(wouldAutoVerify(online, 'GOVERNMENT'), 'online without a city is fine');
  });

  // ── percentile: comparable across sources, honest about missing counts ──
  await checkAsync('ranking: percentile is monotonic and keeps nulls null', async () => {
    const ranks = percentileRanks([10, null, 100, 0, 55]);
    assert.strictEqual(ranks[1], null, 'a missing count must stay missing');
    assert.strictEqual(ranks[3], null, 'zero means "not published", not "least popular"');
    assert.ok(ranks[0]! < ranks[2]!, '10 must rank below 100');
    assert.ok(ranks[0]! < ranks[4]! && ranks[4]! < ranks[2]!, '55 must sit between 10 and 100');
    assert.strictEqual(ranks[2], 100, 'the largest value is the 100th percentile');
  });

  await checkAsync('ranking: equal counts get equal percentiles', async () => {
    const ranks = percentileRanks([5, 5, 5]);
    assert.deepStrictEqual(ranks, [100, 100, 100]);
    const mixed = percentileRanks([1, 2, 2, 4]);
    assert.strictEqual(mixed[1], mixed[2], 'ties must not be split arbitrarily');
  });

  await checkAsync('ranking: all-null input yields all-null output', async () => {
    assert.deepStrictEqual(percentileRanks([null, null]), [null, null]);
    assert.deepStrictEqual(percentileRanks([]), []);
  });

  // ── the "already over" gate ──
  const ev = (over: Partial<ExtractedEvent>) =>
    ({ endDate: null, startDate: null, ...over }) as ExtractedEvent;

  await checkAsync('gate: a finished event is dropped, one ending today is kept', async () => {
    const now = Date.parse('2026-10-22T09:00:00Z');
    assert.strictEqual(isOver(ev({ endDate: '2026-10-21' }), now), true, 'yesterday is over');
    assert.strictEqual(isOver(ev({ endDate: '2026-10-22' }), now), false, 'ending today is still joinable');
    assert.strictEqual(isOver(ev({ endDate: '2026-11-01' }), now), false, 'future is kept');
  });

  await checkAsync('gate: unknown dates are never assumed over', async () => {
    const now = Date.parse('2026-10-22T09:00:00Z');
    assert.strictEqual(isOver(ev({}), now), false, 'no dates at all');
    assert.strictEqual(isOver(ev({ endDate: 'not-a-date' }), now), false, 'unparseable date');
    // Falls back to the start date when there is no end date.
    assert.strictEqual(isOver(ev({ startDate: '2026-10-01' }), now), true, 'started and no end date');
  });

  // ── the offline-India gate ──
  await checkAsync('gate: online is welcome from anywhere', async () => {
    for (const country of ['Germany', 'India', null]) {
      assert.strictEqual(isAttendable({ mode: 'ONLINE', country }), true, `online from ${country}`);
    }
  });

  await checkAsync('gate: offline must be confirmably in India', async () => {
    assert.strictEqual(isAttendable({ mode: 'OFFLINE', country: 'India' }), true);
    assert.strictEqual(isAttendable({ mode: 'HYBRID', country: 'india' }), true, 'case-insensitive');
    assert.strictEqual(isAttendable({ mode: 'OFFLINE', country: 'United States' }), false);
    assert.strictEqual(isAttendable({ mode: 'OFFLINE', country: null }), false, 'unconfirmed location is dropped');
    assert.strictEqual(isAttendable({ mode: null, country: null }), false, 'unknown mode, unknown place');
  });

  // ── relevance scoring ──
  const rank = (o: Partial<RankableOpportunity>) =>
    computeHubScore({
      popularity: null,
      registrationDeadline: null,
      prize: null,
      mode: null,
      country: null,
      verificationStatus: 'UNVERIFIED',
      ...o,
    });

  await checkAsync('relevance: always inside 0-100', async () => {
    const extremes = [
      rank({ popularity: 100, mode: 'ONLINE', prize: '₹1,00,000', verificationStatus: 'ADMIN_VERIFIED' }),
      rank({ popularity: 0, mode: 'OFFLINE', country: 'United States' }),
      rank({}),
    ];
    for (const score of extremes) {
      assert.ok(score >= 0 && score <= 100, `out of range: ${score}`);
      assert.ok(Number.isInteger(score), 'must be an integer for the DB column');
    }
    // Not 100: with no registration deadline the urgency term stays low, which
    // is the intended shape — an event nobody can still sign up for is never
    // maximally relevant.
    assert.ok(extremes[0] >= 85, `best case should be high, got `);
    assert.ok(extremes[0] > extremes[2]!, 'best case must beat the neutral case');
    assert.ok(extremes[0] > extremes[1]!, 'best case must beat the worst case');
    // Unknown place outscores confirmed-abroad on purpose: the India-only crawl
    // sources (indiahackathons, government) publish no country at all, so
    // "unknown" has to mean "probably fine" rather than "foreign".
    assert.ok(extremes[2]! > extremes[1]!, 'unknown place should outrank confirmed abroad');
  });

  await checkAsync('relevance: a popular online event beats an obscure foreign one', async () => {
    const strong = rank({ popularity: 95, mode: 'ONLINE', prize: '$10,000' });
    const weak = rank({ popularity: 5, mode: 'OFFLINE', country: 'Germany' });
    assert.ok(strong > weak, `${strong} should beat ${weak}`);
  });

  await checkAsync('relevance: closing sooner outranks closing later', async () => {
    const now = Date.parse('2026-10-22T00:00:00Z');
    const soon = computeHubScore(
      { popularity: 50, registrationDeadline: new Date('2026-10-25'), prize: null, mode: 'ONLINE', country: null, verificationStatus: 'UNVERIFIED' },
      now,
    );
    const later = computeHubScore(
      { popularity: 50, registrationDeadline: new Date('2026-12-25'), prize: null, mode: 'ONLINE', country: null, verificationStatus: 'UNVERIFIED' },
      now,
    );
    assert.ok(soon > later, `closing in 3d (${soon}) should beat closing in 64d (${later})`);
  });

  await checkAsync('relevance: a closed deadline earns no urgency', async () => {
    const now = Date.parse('2026-10-22T00:00:00Z');
    const past = computeHubScore(
      { popularity: 50, registrationDeadline: new Date('2026-10-01'), prize: null, mode: 'ONLINE', country: null, verificationStatus: 'UNVERIFIED' },
      now,
    );
    const open = computeHubScore(
      { popularity: 50, registrationDeadline: new Date('2026-10-25'), prize: null, mode: 'ONLINE', country: null, verificationStatus: 'UNVERIFIED' },
      now,
    );
    assert.ok(past < open, 'a passed deadline must not score like an open one');
  });

  await checkAsync('relevance: an empty prize string is not a prize', async () => {
    const withPrize = rank({ prize: '₹50,000' });
    for (const empty of ['', '  ', 'None', 'TBD', '—']) {
      assert.ok(rank({ prize: empty }) < withPrize, `"${empty}" must not count as a prize`);
    }
  });

  // ── the gate, proven on what discovery actually stored ──
  await checkAsync('gate: nothing stored is finished, nothing offline is foreign', async () => {
    await prisma.hubCandidate.deleteMany({});
    const totals = { over: 0, abroad: 0, kept: 0 };
    for (const key of ['unstop', 'devpost', 'devfolio']) {
      const res = await discoverFromStructured(key);
      totals.over += res.skippedOver;
      totals.abroad += res.skippedAbroad;
      totals.kept += res.discovered;
    }
    const rows = await prisma.hubCandidate.findMany({ select: { extracted: true, url: true } });
    const offenders = rows.filter((r) => {
      const e = (r.extracted ?? {}) as ExtractedEvent;
      return isOver(e) || !isAttendable(e);
    });
    assert.strictEqual(offenders.length, 0, `gate let through: ${offenders.map((o) => o.url).slice(0, 3).join(', ')}`);
    assert.ok(totals.over > 0, 'the gate should have dropped finished events');
    assert.ok(totals.kept > 0, 'and kept some');
    console.log(
      `    gate dropped ${totals.over} finished + ${totals.abroad} non-India offline, kept ${totals.kept}`,
    );
    await prisma.hubCandidate.deleteMany({});
  });

  await checkAsync('gate: stored rows carry a usable popularity percentile', async () => {
    await prisma.hubCandidate.deleteMany({});
    await discoverFromStructured('unstop');
    const rows = await prisma.hubCandidate.findMany({ select: { extracted: true, source: true } });
    const withRank = rows.filter((r) => {
      const p = ((r.extracted ?? {}) as ExtractedEvent).popularity;
      return typeof p === 'number' && p >= 0 && p <= 100;
    });
    assert.ok(withRank.length > 0, 'expected at least some unstop rows to carry a percentile');
    console.log(`    unstop: ${withRank.length}/${rows.length} rows carry a percentile`);
    await prisma.hubCandidate.deleteMany({});
  });
}

async function dedupeChecks() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw new Error('dedupe checks need an ADMIN user');

  // ── pure-function checks: no DB, no network ──
  check('dedupe: a generic title is never evidence of a duplicate', () => {
    assert.strictEqual(titleKey('Hackathon 2026'), null, 'short/generic titles must not key');
    assert.strictEqual(titleKey('AI Hack'), null);
    assert.strictEqual(titleKey(null), null);
    assert.ok(titleKey('RootAccess Hardware Hackathon'));
  });

  check('dedupe: two editions of one event stay separate', () => {
    const a = { title: 'Codefest National Hackathon', startDate: '2026-03-01' };
    const b = { title: 'Codefest National Hackathon', startDate: '2027-03-01' };
    assert.strictEqual(isSameEvent(a, b), false, 'different years are different editions');
    assert.strictEqual(isSameEvent(a, { ...a }), true);
    // Same event, one side simply has no date: not a contradiction.
    assert.strictEqual(isSameEvent(a, { title: a.title, startDate: null }), true);
  });

  check('dedupe: cross-source index matches on title + edition', () => {
    const index: ExistingIndex = new Map();
    addToIndex(index, { title: 'RootAccess Hardware Hackathon', startDate: '2026-10-22' });
    assert.strictEqual(indexHas(index, { title: 'RootAccess Hardware Hackathon', startDate: '2026-10-22' }), true);
    assert.strictEqual(indexHas(index, { title: 'RootAccess Hardware Hackathon', startDate: '2027-10-22' }), false);
    assert.strictEqual(indexHas(index, { title: 'Something Else Entirely 2026', startDate: '2026-10-22' }), false);
    assert.strictEqual(indexHas(index, { title: 'Hackathon 2026', startDate: '2026-10-22' }), false);
  });

  check('dates: a devpost-style range parses, including a year rollover', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    assert.deepStrictEqual(parseDateRange('Aug 31 - Oct 23, 2026', now), { startDate: '2026-08-31', endDate: '2026-10-23' });
    assert.deepStrictEqual(parseDateRange('Dec 15 - Jan 20, 2027', now), { startDate: '2026-12-15', endDate: '2027-01-20' });
    assert.deepStrictEqual(parseDateRange('Oct 23, 2026', now), { startDate: null, endDate: '2026-10-23' });
    assert.deepStrictEqual(parseDateRange('garbage', now), { startDate: null, endDate: null });
    assert.deepStrictEqual(parseDateRange('', now), { startDate: null, endDate: null });
    assert.deepStrictEqual(parseDateRange(null, now), { startDate: null, endDate: null });
  });

  check('structured: malformed payloads yield no events instead of throwing', () => {
    for (const payload of [null, undefined, {}, { data: null }, { hackathons: 'nope' }, { result: 5 }, []]) {
      assert.deepStrictEqual(parseDevpost(payload as unknown).events, []);
    }
    // A row with no usable title or url is dropped, not stored half-built.
    const page = parseDevpost({ hackathons: [{ title: '', url: '' }, { title: 'Real Event 2026', url: 'https://x.devpost.com/' }] });
    assert.strictEqual(page.events.length, 1);
  });

  const mk = (url: string, source: string, organiser: string, title: string) =>
    prisma.hubCandidate.create({
      data: {
        url,
        source,
        sourceType: source.toUpperCase(),
        status: 'VERIFIED',
        title,
        extracted: {
          eventName: title,
          organiser,
          mode: 'ONLINE',
          city: 'Mumbai',
          startDate: '2026-12-01',
          registrationDeadline: '2026-11-20',
          registrationUrl: null,
          domains: [],
        },
      },
    });

  await checkAsync('dedupe: same event from two sources publishes ONE opportunity', async () => {
    await prisma.opportunity.deleteMany({ where: { title: { contains: 'Dedupe Probe' } } });
    await prisma.hubCandidate.deleteMany({ where: { url: { contains: 'dedupe-probe' } } });

    // Different URLs, different organiser strings, platform chrome on one title:
    // exactly the shape that used to become two entries on the public Hub.
    const a = await mk(
      'https://unstop.com/hackathons/dedupe-probe-1',
      'unstop',
      'Alpha Robotics Club',
      'Dedupe Probe Hackathon 2026 - Unstop',
    );
    const b = await mk(
      'https://devfolio.co/hackathons/dedupe-probe-2',
      'devfolio',
      'Beta Foundation Trust',
      'Dedupe Probe Hackathon 2026',
    );

    const r1 = await publishCandidate(Number(a.id), admin.id);
    const r2 = await publishCandidate(Number(b.id), admin.id);
    const count = await prisma.opportunity.count({ where: { title: { contains: 'Dedupe Probe' } } });

    console.log(`    candidate A -> opportunity ${r1.opportunityId}`);
    console.log(`    candidate B -> opportunity ${r2.opportunityId}`);
    assert.strictEqual(r1.opportunityId, r2.opportunityId, 'both candidates must resolve to one opportunity');
    assert.strictEqual(count, 1, `expected exactly 1 opportunity, found ${count}`);
  });

  await checkAsync('dedupe: a short generic title does NOT merge (no false fusion)', async () => {
    await prisma.opportunity.deleteMany({ where: { title: { contains: 'Codefest' } } });
    await prisma.hubCandidate.deleteMany({ where: { url: { contains: 'dedupe-generic' } } });
    const a = await mk('https://unstop.com/hackathons/dedupe-generic-1', 'unstop', 'Org One', 'Codefest 2026');
    const b = await mk('https://devfolio.co/hackathons/dedupe-generic-2', 'devfolio', 'Org Two', 'Codefest 2027');
    const r1 = await publishCandidate(Number(a.id), admin.id);
    const r2 = await publishCandidate(Number(b.id), admin.id);
    assert.notStrictEqual(r1.opportunityId, r2.opportunityId, 'different editions must stay separate');
    await prisma.opportunity.deleteMany({ where: { title: { contains: 'Codefest' } } });
  });

  await prisma.hubCandidate.deleteMany({ where: { url: { contains: 'dedupe-probe' } } });
  await prisma.hubCandidate.deleteMany({ where: { url: { contains: 'dedupe-generic' } } });
}

// ─── C. Live search ───
const LISTING_URL = 'https://unstop.com/hackathons';
const EVENT_URL = 'https://unstop.com/hackathons/hackmatrix-50-pccoes-gfg-student-chapter-1750988';
const vis = (h: string) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
   .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;

async function liveChecks() {
  // Only the checks that actually talk to the renderer are conditional now:
  // structured discovery is plain JSON over public APIs and must be exercised
  // whether or not a renderer is configured.
  const rendererOnly = async (name: string, fn: () => Promise<void>) => {
    if (!isFirecrawlConfigured()) {
      console.log(`\n(skipping ${name}: FIRECRAWL_URL not set)`);
      return;
    }
    await checkAsync(name, fn);
  };

  await rendererOnly('render: JS-shell listing becomes readable', async () => {
    const plain = await fetchPublicText(LISTING_URL, { timeoutMs: 20000, contentTypes: ['html', 'text'] });
    const plainLen = vis(plain.text);
    const rendered = await fetchHtmlWithRender(LISTING_URL, { timeoutMs: 30000 });
    assert.strictEqual(rendered.rendered, true, 'shell listing should trigger a render');
    const renderedLen = vis(rendered.text);
    console.log(`    ${LISTING_URL}\n    plain ${plainLen}c -> rendered ${renderedLen}c`);
    assert.ok(renderedLen > plainLen * 2, `render should more than double text (${plainLen} -> ${renderedLen})`);
  });

  await rendererOnly('renderer: refuses internal addresses (SSRF bypass closed)', async () => {
    // The renderer itself will fetch anything it is handed, so the guard has to
    // run before the request leaves the app.
    assert.strictEqual(await renderHtml('http://127.0.0.1:9/x'), null, 'loopback must be refused');
    assert.strictEqual(await renderHtml('https://192.168.1.1/'), null, 'private IP must be refused');
    assert.strictEqual(await renderHtml('http://unstop.com/hackathons'), null, 'non-https must be refused');
  });

  await rendererOnly('renderer: health probe reports reachability', async () => {
    assert.strictEqual(await rendererHealthy(), true, 'live renderer must report healthy');
    const prev = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL;
    assert.strictEqual(await rendererHealthy(), false, 'unconfigured renderer must report unhealthy');
    if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
  });

  await rendererOnly('render: a THROWING plain fetch falls back to the renderer', async () => {
    // application/json makes the plain path reject on content type, which is a
    // throw rather than a status — the exact case that used to lose the page.
    const r = await fetchHtmlWithRender('https://jsonplaceholder.typicode.com/todos/1', { timeoutMs: 8000 });
    assert.strictEqual(r.rendered, true, 'must have been rendered');
    assert.ok(r.text.length > 0, 'rendered body must not be empty');
  });

  await checkAsync('render: a throwing plain fetch still throws with no renderer', async () => {
    const prev = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL;
    let threw = false;
    try {
      await fetchHtmlWithRender('https://jsonplaceholder.typicode.com/todos/1', { timeoutMs: 8000 });
    } catch {
      threw = true;
    }
    if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
    assert.strictEqual(threw, true, 'behaviour without a renderer must be unchanged');
  });

  await checkAsync('render budget: exhausted budget makes renderHtml a no-op (no hang)', async () => {
    const prev = process.env.HUB_RENDER_MAX_PAGES;
    process.env.HUB_RENDER_MAX_PAGES = '0';
    resetRenderBudget();
    const started = Date.now();
    const out = await renderHtml('https://unstop.com/hackathons');
    const ms = Date.now() - started;
    if (prev === undefined) delete process.env.HUB_RENDER_MAX_PAGES;
    else process.env.HUB_RENDER_MAX_PAGES = prev;
    resetRenderBudget();
    assert.strictEqual(out, null, 'must refuse without spending a request');
    assert.ok(ms < 3000, `must return immediately, took ${ms}ms`);
  });

  await rendererOnly('render: a page that already renders is not re-rendered', async () => {
    const r = await fetchHtmlWithRender('https://mlh.io/events', { timeoutMs: 25000 });
    assert.strictEqual(r.rendered, false, 'already-readable page must not pay for a render');
  });

  await rendererOnly('discovery: rendered listing yields real event links, junk rejected', async () => {
    // This one genuinely needs to render, so it claims its own budget instead of
    // inheriting whatever earlier checks spent.
    resetRenderBudget();
    const html = await renderHtml(LISTING_URL);
    assert.ok(html, 'render returned html');
    const links = extractEventLinks(html as string, LISTING_URL);
    const matcher = PLATFORM_MATCHERS.unstop.isEventUrl;
    const kept = links.filter((l) => {
      try {
        return matcher(new URL(l.url));
      } catch {
        return false;
      }
    });
    console.log(`    extracted ${links.length} links -> ${kept.length} real event pages`);
    for (const l of kept.slice(0, 4)) console.log(`      - ${l.title.slice(0, 56)}`);
    assert.ok(kept.length >= 5, `expected >=5 event pages, got ${kept.length}`);
    assert.ok(
      kept.every((l) => /\/hackathons\/[^/]+$/.test(new URL(l.url).pathname)),
      'every kept link must be an individual event page',
    );
    assert.ok(
      !kept.some((l) => /\/(competitions|hackathons)$/.test(new URL(l.url).pathname)),
      'index pages must be filtered out',
    );
  });

  await checkAsync('sources: renderable platforms become crawlable with a renderer', async () => {
    await ensureHubSources();
    // Unstop/Devfolio/Devpost are API-served now; only HackerEarth still needs
    // a renderer to become crawlable, and reverts to MANUAL without one.
    const apiRows = await prisma.hubSource.findMany({
      where: { key: { in: ['unstop', 'devfolio', 'devpost'] } },
      select: { key: true, method: true },
    });
    assert.strictEqual(apiRows.length, 3);
    for (const r of apiRows) assert.strictEqual(r.method, 'API', `${r.key} should be API`);

    // This one is about the renderer flip, so it sets its own precondition
    // rather than inheriting whatever the suite was started with.
    const prev = process.env.FIRECRAWL_URL;
    process.env.FIRECRAWL_URL = 'http://127.0.0.1:3002';
    await ensureHubSources();
    const rows = await prisma.hubSource.findMany({
      where: { key: 'hackerearth' },
      select: { key: true, method: true },
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].method, 'PAGE', 'hackerearth should be PAGE with a renderer');
    delete process.env.FIRECRAWL_URL;
    await ensureHubSources();
    const off = await prisma.hubSource.findMany({
      where: { key: 'hackerearth' },
      select: { key: true, method: true },
    });
    if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
    await ensureHubSources();
    for (const r of off) assert.strictEqual(r.method, 'MANUAL', `${r.key} should stay MANUAL without a renderer`);
  });

  // ─── E. Structured (first-party API) discovery ───
  await checkAsync('structured: every source returns well-formed events', async () => {
    for (const key of Object.keys(STRUCTURED_SOURCES)) {
      const page = await fetchStructuredPage(key, 1);
      assert.ok(!page.error, `${key} fetch failed: ${page.error}`);
      assert.ok(page.events.length > 0, `${key} returned no events`);
      for (const e of page.events) {
        assert.ok(e.url.startsWith('https://'), `${key}: bad url ${e.url}`);
        assert.ok((e.event.eventName ?? '').length <= 191, `${key}: title exceeds the column`);
        const iso = /^\d{4}-\d{2}-\d{2}$/;
        assert.ok(e.event.startDate === null || iso.test(e.event.startDate), `${key}: bad start ${e.event.startDate}`);
        assert.ok(e.event.registrationDeadline === null || iso.test(e.event.registrationDeadline), `${key}: bad deadline`);
        assert.ok([null, 'ONLINE', 'OFFLINE', 'HYBRID'].includes(e.event.mode), `${key}: bad mode ${e.event.mode}`);
        assert.ok(e.event.teamMin === null || e.event.teamMin > 0, `${key}: bad teamMin`);
      }
      const verified = page.events.filter((e) => wouldAutoVerify(e.event, STRUCTURED_SOURCES[key].sourceType)).length;
      console.log(`    ${key}: ${page.events.length} events, ${verified} would auto-verify`);
    }
  });

  await checkAsync('structured: unstop supplies every mandatory field', async () => {
    // This is the whole reason search was dropped: the platform publishes what
    // the extractor used to guess at, so completeness is a platform property.
    const page = await fetchStructuredPage('unstop', 1);
    const complete = page.events.filter((e) => mandatoryMissing(e.event).length === 0);
    const rate = complete.length / Math.max(page.events.length, 1);
    console.log(`    unstop complete rows: ${complete.length}/${page.events.length} (${Math.round(rate * 100)}%)`);
    assert.ok(rate >= 0.8, `expected >=80% complete unstop rows, got ${Math.round(rate * 100)}%`);
  });

  await checkAsync('structured: an unknown source reports an error instead of throwing', async () => {
    const bad = await fetchStructuredPage('no-such-source', 1);
    assert.ok(bad.error, 'must report an error');
    assert.strictEqual(bad.events.length, 0);
  });

  await checkAsync('structured: discovery stores mapped events, never re-extracts them', async () => {
    await prisma.hubCandidate.deleteMany({ where: { source: 'devpost' } });
    const res = await discoverFromStructured('devpost');
    const rows = await prisma.hubCandidate.findMany({ where: { source: 'devpost' } });
    assert.ok(rows.length > 0, 'expected devpost candidates');
    // Status is decided at insert, so none may sit in the DISCOVERED state that
    // would send them back through the fetch-and-AI extractor.
    assert.ok(rows.every((r: { status: string }) => r.status !== 'DISCOVERED'), 'structured rows must not need extraction');
    assert.ok(rows.every((r: { confidence: number | null }) => r.confidence !== null), 'confidence must be set');
    assert.ok(rows.every((r: { extracted: unknown }) => r.extracted !== null), 'extracted payload must be stored');
    console.log(`    devpost: discovered=${res.discovered} duplicates=${res.duplicates}`);
    await prisma.hubCandidate.deleteMany({ where: { source: 'devpost' } });
  });

  await checkAsync('structured: re-running the same source adds nothing', async () => {
    await prisma.hubCandidate.deleteMany({ where: { source: 'devpost' } });
    const first = await discoverFromStructured('devpost');
    const second = await discoverFromStructured('devpost');
    const stored = await prisma.hubCandidate.count({ where: { source: 'devpost' } });
    console.log(`    devpost: first=${first.discovered} second=${second.discovered} stored=${stored}`);
    assert.strictEqual(second.discovered, 0, 'a re-run must insert nothing');
    assert.ok(second.duplicates >= first.discovered, 'the re-run must account for the existing rows as duplicates');
    await prisma.hubCandidate.deleteMany({ where: { source: 'devpost' } });
  });

  await checkAsync('structured: pages never duplicate each other', async () => {
    await prisma.hubCandidate.deleteMany({ where: { source: 'devfolio' } });
    await discoverFromStructured('devfolio');
    const rows = await prisma.hubCandidate.findMany({ where: { source: 'devfolio' }, select: { url: true } });
    const urls = rows.map((r: { url: string }) => r.url);
    console.log(`    devfolio: ${urls.length} rows across pages, ${urls.length - new Set(urls).size} duplicates`);
    assert.strictEqual(new Set(urls).size, urls.length, 'duplicate urls across pages');
    await prisma.hubCandidate.deleteMany({ where: { source: 'devfolio' } });
  });

  await checkAsync('registration: page-as-registration can only ever hit event pages', async () => {
    // The AI-fill rule sets registrationUrl = the page URL for
    // registrationOnPage sources. Prove that for every candidate discovery can
    // actually produce from those sources, isIndividualEventPage() is true — so
    // the rule can never fire on a listing page.
    await prisma.hubCandidate.deleteMany({});
    await runDiscovery();
    const rows = await prisma.hubCandidate.findMany({
      where: { source: { in: ['unstop', 'devfolio', 'hacker2kill', 'hack2skill'] } },
      select: { url: true, source: true },
    });
    assert.ok(rows.length > 0, 'expected candidates from a registrationOnPage source');
    const bad = rows.filter((r: { url: string; source: string }) => !isIndividualEventPage(r.url, r.source));
    console.log(`    ${rows.length} candidates from page-registration sources, ${bad.length} are not event pages`);
    assert.strictEqual(bad.length, 0, `listing URLs must never reach the rule: ${bad.map((b: any) => b.url).join(', ')}`);
    await prisma.hubCandidate.deleteMany({});
  });

  await checkAsync('discovery: structured sources carry the run with no renderer', async () => {
    // The APIs are plain JSON: discovery must work with FIRECRAWL_URL unset.
    const prev = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL;
    await prisma.hubCandidate.deleteMany({});
    const res = await runDiscovery();
    const bySource = await prisma.hubCandidate.groupBy({ by: ['source'], _count: { _all: true } });
    if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
    const counts = bySource.map((b: any) => `${b.source}=${b._count._all}`).join(' ');
    console.log(`    discovered=${res.discovered} with no renderer configured: ${counts}`);
    assert.ok(res.discovered > 0, 'discovery must not depend on the renderer');
    for (const key of ['unstop', 'devpost']) {
      const n = await prisma.hubCandidate.count({ where: { source: key } });
      assert.ok(n > 0, `${key} must yield events without a renderer`);
    }
    await prisma.hubCandidate.deleteMany({});
  });

  await checkAsync('discovery: re-running never duplicates a URL', async () => {
    // The invariant is not a fixed row count — the upstream collection changes
    // daily — it is that no event URL is ever ingested twice.
    const before = await prisma.hubCandidate.findMany({
      where: { source: 'unstop' },
      select: { url: true },
    });
    await discoverFromStructured('unstop');
    const after = await prisma.hubCandidate.findMany({
      where: { source: 'unstop' },
      select: { url: true },
    });
    const urls = after.map((r: { url: string }) => r.url);
    assert.strictEqual(new Set(urls).size, urls.length, 'duplicate urls found');
    for (const r of before) {
      assert.ok(urls.includes(r.url), `previously discovered url disappeared: ${r.url}`);
    }
    console.log(`    ${before.length} -> ${after.length} rows, no duplicates`);
  });

  await checkAsync('dedupe: an event already listed elsewhere is not ingested twice', async () => {
    // The real cross-source case: the same hackathon published from one platform
    // must not be re-created when a second platform lists it.
    const actor = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
    assert.ok(actor, 'cross-source check needs an ADMIN user');
    await prisma.hubCandidate.deleteMany({ where: { source: 'unstop' } });
    await discoverFromStructured('unstop');
    const seed = await prisma.hubCandidate.findFirst({ where: { source: 'unstop' } });
    assert.ok(seed, 'need a real unstop row to seed with');
    const seedExtracted = (seed.extracted ?? {}) as { startDate?: string | null };
    const seedUrl = seed.url;
    const seedTitle = seed.title as string;

    // Pretend it arrived from a different platform and was published.
    const published = await prisma.opportunity.create({
      data: {
        title: seedTitle,
        category: 'Hackathon',
        organizer: 'Some Other Platform',
        sourceType: 'DEVPOST',
        status: 'APPROVED',
        showInHub: true,
        startDate: seedExtracted.startDate ? new Date(`${seedExtracted.startDate}T00:00:00.000Z`) : null,
        createdById: actor.id,
      },
    });
    await prisma.hubCandidate.deleteMany({ where: { source: 'unstop' } });

    const res = await discoverFromStructured('unstop');
    const again = await prisma.hubCandidate.findFirst({ where: { url: seedUrl } });
    console.log(`    re-ran unstop: discovered=${res.discovered} duplicates=${res.duplicates}`);
    assert.strictEqual(again, null, 'an event already published from another source must not be re-ingested');
    assert.ok(res.duplicates > 0, 'the duplicate must be counted, not silently dropped');

    await prisma.opportunity.delete({ where: { id: published.id } });
    await prisma.hubCandidate.deleteMany({ where: { source: 'unstop' } });
  });

  // cleanup
  await prisma.hubCandidate.deleteMany({ where: { source: 'unstop' } });
  await prisma.hubCandidate.deleteMany({ where: { source: 'devpost' } });
  await prisma.hubCandidate.deleteMany({ where: { source: 'devfolio' } });
}

rankingChecks()
  .then(() => dedupeChecks())
  .then(() => liveChecks())
  .then(() => {
    console.log(`\nALL CHECKS PASSED (${passed})`);
    console.log(`HUB_VERIFY_THRESHOLD = ${HUB_VERIFY_THRESHOLD}`);
  })
  .catch((err) => {
    console.error('\nCHECK FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
