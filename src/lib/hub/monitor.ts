import prisma from '@/lib/prisma';
import { normalizeContent, sha256 } from './discovery';
import { extractFromHtml } from './extract';
import { IMPORTANT_FIELDS, diffImportant } from './pipeline';
import { fetchPublicText } from './fetch-guard';

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;

const numEnv = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// Bounded monitor knobs. The old loop walked up to 200 events with an 800 ms
// sleep between each, so a single HTTP request could run for minutes. Each
// invocation now handles a small batch and rotates via lastVerifiedAt.
const DEFAULT_BATCH = clamp(numEnv('HUB_MONITOR_BATCH', 10), 1, 50);
const DEFAULT_BUDGET_MS = clamp(numEnv('HUB_MONITOR_BUDGET_MS', 45_000), 0, 120_000);
const POLITENESS_DELAY_MS = clamp(numEnv('HUB_MONITOR_DELAY_MS', 400), 0, 5_000);

async function fetchText(url: string, timeoutMs = 12_000): Promise<{ status: number; html: string }> {
  // SSRF-guarded (DNS allowlist + landing re-check); non-2xx yields empty
  // body so 404/403 handling below keeps working.
  const { status, text } = await fetchPublicText(url, { timeoutMs, contentTypes: ['html', 'text'] });
  return { status, html: text };
}

export type MonitorResult = {
  checked: number;
  changed: number;
  broken: number;
  /** Approved events not checked by this invocation (picked up next run). */
  deferred: number;
  batch: number;
  errors: string[];
};

// Change detection (§21–22) + broken-link review (§41.4), bounded.
// Rotation checkpoint is `lastVerifiedAt` (oldest first), so consecutive
// invocations cover the whole catalogue without extra state. Every completed
// attempt stamps it — including 403/empty pages, otherwise a permanently
// restricted page would sit at the head of the queue forever.
export async function runMonitor(opts: { limit?: number; budgetMs?: number } = {}): Promise<MonitorResult> {
  const limit = clamp(opts.limit ?? DEFAULT_BATCH, 1, 50);
  const budgetMs = clamp(opts.budgetMs ?? DEFAULT_BUDGET_MS, 0, 120_000);
  const startedAt = Date.now();
  const out: MonitorResult = { checked: 0, changed: 0, broken: 0, deferred: 0, batch: limit, errors: [] };

  const totalApproved = await prisma.opportunity.count({ where: { status: 'APPROVED' } });
  const rows = await prisma.opportunity.findMany({
    where: { status: 'APPROVED' },
    orderBy: [{ lastVerifiedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, title: true, sourceUrl: true, applicationUrl: true, pageHash: true,
      registrationDeadline: true, prize: true, eligibility: true, teamMin: true, teamMax: true,
      venue: true, startDate: true, endDate: true,
    },
    take: limit,
  });

  for (const opp of rows) {
    if (Date.now() - startedAt > budgetMs) break;
    const watchUrl = opp.sourceUrl || opp.applicationUrl;
    if (!watchUrl) {
      // No page to watch: stamp the attempt so the row rotates out of the head
      // of the queue instead of consuming a batch slot on every run.
      await prisma.opportunity.update({ where: { id: opp.id }, data: { lastVerifiedAt: new Date() } });
      continue;
    }
    out.checked++;
    try {
      const { status, html } = await fetchText(watchUrl);
      const checkedAt = new Date();
      if (status === 404) {
        out.broken++;
        await prisma.opportunity.update({
          where: { id: opp.id },
          data: { verificationStatus: 'NEEDS_UPDATE', lastVerifiedAt: checkedAt },
        });
        continue;
      }
      if (status === 403 || !html) {
        // Restricted/unavailable (§19) — record the attempt so rotation advances.
        await prisma.opportunity.update({ where: { id: opp.id }, data: { lastVerifiedAt: checkedAt } });
        continue;
      }
      const hash = sha256(normalizeContent(html));
      if (opp.pageHash && hash === opp.pageHash) {
        await prisma.opportunity.update({ where: { id: opp.id }, data: { lastVerifiedAt: checkedAt } });
        continue;
      }
      if (!opp.pageHash) {
        await prisma.opportunity.update({ where: { id: opp.id }, data: { pageHash: hash, lastVerifiedAt: checkedAt } });
        continue;
      }
      const fresh = extractFromHtml(html, watchUrl, opp.title);
      const diffs = diffImportant(
        {
          registrationDeadline: opp.registrationDeadline, prize: opp.prize, eligibility: opp.eligibility,
          teamMin: opp.teamMin, teamMax: opp.teamMax, venue: opp.venue, startDate: opp.startDate, endDate: opp.endDate,
        },
        {
          registrationDeadline: fresh.registrationDeadline ? new Date(fresh.registrationDeadline) : null,
          prize: fresh.prizePool, eligibility: fresh.eligibility, teamMin: fresh.teamMin, teamMax: fresh.teamMax,
          venue: fresh.venue, startDate: fresh.startDate ? new Date(fresh.startDate) : null,
          endDate: fresh.endDate ? new Date(fresh.endDate) : null,
        },
      );
      await prisma.opportunity.update({
        where: { id: opp.id },
        data: { pageHash: hash, lastVerifiedAt: checkedAt },
      });
      const important = diffs.filter((d) => (IMPORTANT_FIELDS as readonly string[]).includes(d.field));
      if (important.length > 0) {
        out.changed++;
        await prisma.opportunity.update({
          where: { id: opp.id },
          data: { verificationStatus: 'NEEDS_UPDATE', lastVerifiedAt: checkedAt },
        });
      }
    } catch (err) {
      out.errors.push(`Opportunity ${opp.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (POLITENESS_DELAY_MS > 0) await new Promise((r) => setTimeout(r, POLITENESS_DELAY_MS));
  }

  out.deferred = Math.max(0, totalApproved - out.checked);
  return out;
}
