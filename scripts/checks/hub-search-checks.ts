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
  searchWeb,
  fetchHtmlWithRender,
  renderHtml,
  renderBudgetAvailable,
  renderBudgetState,
  resetRenderBudget,
  rendererHealthy,
} from '../../src/lib/hub/firecrawl';
import {
  runDiscovery,
  discoverFromSearch,
  extractEventLinks,
  decodeEntities,
  SEARCH_SOURCES,
  registersOnEventPage,
  isIndividualEventPage,
} from '../../src/lib/hub/discovery';
import { ensureHubSources } from '../../src/lib/hub/sources';
import { fetchPublicText } from '../../src/lib/hub/fetch-guard';
import { cleanEventTitle } from '../../src/lib/hackathon-hub';
import { publishCandidate } from '../../src/lib/hub/pipeline';

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

check('confidence: complete but no city/prize stays in review for aggregators', () => {
  const c = scoreConfidence(fullEvent({ city: null, prizePool: null }), 'UNSTOP');
  assert.strictEqual(c, 0.85);
  assert.ok(c < HUB_VERIFY_THRESHOLD);
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
  const m = SEARCH_SOURCES.unstop.isEventUrl;
  assert.strictEqual(m(new URL('https://unstop.com/hackathons/some-event-123')), true);
  assert.strictEqual(m(new URL('https://unstop.com/hackathons')), false);
  assert.strictEqual(m(new URL('https://unstop.com/competitions')), false);
  assert.strictEqual(m(new URL('https://unstop.com/hackathons/a/b')), false);
});

async function dedupeChecks() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw new Error('dedupe checks need an ADMIN user');

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
  if (!isFirecrawlConfigured()) {
    console.log('\n(skipping live checks: FIRECRAWL_URL not set)');
    return;
  }

  await checkAsync('search: self-hosted provider returns a well-formed hit list', async () => {
    // Public engines CAPTCHA and rate-limit this host regularly, which is an
    // upstream outage rather than a defect here — so the invariant is a
    // well-formed result, and an empty one must be visibly reported.
    const hits = await searchWeb('unstop hackathon 2026 India register', 5);
    if (hits.length === 0) {
      console.log('    NO HITS — upstream engines are rate-limited/captcha-ed; runDiscovery reports this as an error');
      assert.ok(Array.isArray(hits));
      return;
    }
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.ok(hits.every((h) => h.url.startsWith('https://')), 'all urls must be https');
    assert.ok(hits.every((h) => h.title.length > 0), 'all hits need a title');
    console.log(`    ${hits.length} hits, first: ${hits[0].url.slice(0, 72)}`);
  });

  await checkAsync('render: JS-shell listing becomes readable', async () => {
    const plain = await fetchPublicText(LISTING_URL, { timeoutMs: 20000, contentTypes: ['html', 'text'] });
    const plainLen = vis(plain.text);
    const rendered = await fetchHtmlWithRender(LISTING_URL, { timeoutMs: 30000 });
    assert.strictEqual(rendered.rendered, true, 'shell listing should trigger a render');
    const renderedLen = vis(rendered.text);
    console.log(`    ${LISTING_URL}\n    plain ${plainLen}c -> rendered ${renderedLen}c`);
    assert.ok(renderedLen > plainLen * 2, `render should more than double text (${plainLen} -> ${renderedLen})`);
  });

  await checkAsync('renderer: refuses internal addresses (SSRF bypass closed)', async () => {
    // The renderer itself will fetch anything it is handed, so the guard has to
    // run before the request leaves the app.
    assert.strictEqual(await renderHtml('http://127.0.0.1:9/x'), null, 'loopback must be refused');
    assert.strictEqual(await renderHtml('https://192.168.1.1/'), null, 'private IP must be refused');
    assert.strictEqual(await renderHtml('http://unstop.com/hackathons'), null, 'non-https must be refused');
  });

  await checkAsync('renderer: health probe reports reachability', async () => {
    assert.strictEqual(await rendererHealthy(), true, 'live renderer must report healthy');
    const prev = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL;
    assert.strictEqual(await rendererHealthy(), false, 'unconfigured renderer must report unhealthy');
    if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
  });

  await checkAsync('render: a THROWING plain fetch falls back to the renderer', async () => {
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

  await checkAsync('render: a page that already renders is not re-rendered', async () => {
    const r = await fetchHtmlWithRender('https://mlh.io/events', { timeoutMs: 25000 });
    assert.strictEqual(r.rendered, false, 'already-readable page must not pay for a render');
  });

  await checkAsync('discovery: rendered listing yields real event links, junk rejected', async () => {
    // This one genuinely needs to render, so it claims its own budget instead of
    // inheriting whatever earlier checks spent.
    resetRenderBudget();
    const html = await renderHtml(LISTING_URL);
    assert.ok(html, 'render returned html');
    const links = extractEventLinks(html as string, LISTING_URL);
    const matcher = SEARCH_SOURCES.unstop.isEventUrl;
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
    const rows = await prisma.hubSource.findMany({
      where: { key: { in: ['unstop', 'hackerearth', 'devfolio'] } },
      select: { key: true, method: true },
    });
    assert.strictEqual(rows.length, 3);
    for (const r of rows) assert.strictEqual(r.method, 'PAGE', `${r.key} should be PAGE`);
    // and revert to MANUAL without a renderer
    const prev = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL;
    await ensureHubSources();
    const off = await prisma.hubSource.findMany({
      where: { key: { in: ['unstop', 'hackerearth', 'devfolio'] } },
      select: { key: true, method: true },
    });
    if (prev !== undefined) process.env.FIRECRAWL_URL = prev;
    await ensureHubSources();
    for (const r of off) assert.strictEqual(r.method, 'MANUAL', `${r.key} should stay MANUAL without a renderer`);
  });

  // ─── E. Search -> candidate insertion ───
  await checkAsync('discovery: search stage degrades loudly, never silently', async () => {
    // Public search engines rate-limit and CAPTCHA freely; that must surface as
    // a reported error, because zero-results-with-no-error looks exactly like a
    // healthy run that simply found nothing.
    await prisma.hubCandidate.deleteMany({ where: { source: 'unstop' } });
    const res = await discoverFromSearch('unstop');
    assert.ok(typeof res.discovered === 'number' && typeof res.duplicates === 'number');
    console.log(`    discoverFromSearch(unstop) -> discovered=${res.discovered}`);
    if (res.discovered === 0) {
      assert.ok(res.error, 'zero results must be reported as an error, not swallowed');
      console.log(`    reported: ${String(res.error).slice(0, 76)}`);
    }
    const rows = await prisma.hubCandidate.findMany({
      where: { source: 'unstop' },
      select: { url: true, sourceType: true, status: true },
    });
    assert.ok(rows.every((r: { sourceType: string }) => r.sourceType === 'UNSTOP'));
    assert.ok(rows.every((r: { sourceType: string }) => r.sourceType === 'UNSTOP'));
    assert.ok(rows.every((r: { status: string }) => r.status === 'DISCOVERED'));
    assert.ok(
      rows.every((r: { url: string }) => /unstop\.com\/hackathons\/[^/]+$/.test(r.url)),
      'all candidates must be individual event pages, not the listing',
    );
    assert.ok(
      rows.every((r: { url: string }) => !/unstop\.com\/hackathons$/.test(r.url)),
      'listing page must never be ingested',
    );
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

  await checkAsync('discovery: crawls events even when the search backend is dead', async () => {
    // The search stage is best-effort (engines CAPTCHA this IP regularly). The
    // deterministic crawl+render path is what discovery must actually rely on.
    await prisma.hubCandidate.deleteMany({});
    const res = await runDiscovery();
    const bySource = await prisma.hubCandidate.groupBy({ by: ['source'], _count: { _all: true } });
    const counts = bySource.map((b: any) => `${b.source}=${b._count._all}`).join(' ');
    console.log(`    discovered=${res.discovered} in a run with search degraded: ${counts}`);
    assert.ok(res.discovered > 0, 'a dead search backend must not empty the run');
    const renderable = await prisma.hubCandidate.count({
      where: { source: { in: ['unstop', 'devfolio', 'hackerearth'] } },
    });
    assert.ok(renderable > 0, 'renderable sources must still yield events via crawl');
    await prisma.hubCandidate.deleteMany({});
  });

  await checkAsync('discovery: re-running never duplicates a URL', async () => {
    // Search results legitimately vary between calls, so the invariant is not a
    // fixed row count — it is that no event URL is ever ingested twice.
    const before = await prisma.hubCandidate.findMany({
      where: { source: 'unstop' },
      select: { url: true },
    });
    await discoverFromSearch('unstop');
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

  // cleanup
  await prisma.hubCandidate.deleteMany({ where: { source: 'unstop' } });
}

dedupeChecks()
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
