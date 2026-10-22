import { NextRequest } from 'next/server';
import { authenticate, authorize, errorRes, successRes } from '@/lib/api-helpers';
import { runDiscovery } from '@/lib/hub/discovery';
import { runExtraction } from '@/lib/hub/extract';
import { runMonitor } from '@/lib/hub/monitor';
import { isFirecrawlConfigured, rendererHealthy, renderBudgetState } from '@/lib/hub/firecrawl';
import prisma from '@/lib/prisma';
import { deriveRegistrationDeadline, mandatoryMissing, scoreConfidence, wouldAutoVerify } from '@/lib/hub/confidence';
import type { ExtractedEvent } from '@/lib/hub/extract';

// Hub automation jobs (§33–34, Next.js cron-route form): separate lib stages,
// one guarded entrypoint with ?job=.
// Platforms that honour route segment limits get an explicit ceiling; on the
// self-hosted pm2 runtime this is inert and the real bound is per-stage
// (fixed source list, 10-candidate extraction batch, rotating monitor batch).
export const maxDuration = 300;
const lastRunAt = new Map<string, number>();
// Overlap guard: the minute-level throttle above does not stop a run that is
// still in flight (a slow batch) from being started again in the same process.
let monitorInFlight = false;

function isAuthorizedCron(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  const headerSecret = (req.headers.get('x-cron-secret') || '').trim();
  const querySecret = (new URL(req.url).searchParams.get('secret') || '').trim();
  if (expectedSecret && (headerSecret === expectedSecret || querySecret === expectedSecret)) return true;
  // Admin session fallback: lets admins trigger from the UI + local dev runs.
  const user = authenticate(req);
  return Boolean(user && authorize(user, 'ADMIN'));
}

// GET /api/cron/hub?job=discover|extract|monitor|revalidate|all[&batch=1-40][&force=1]
export async function GET(req: NextRequest) {
  try {
    if (!isAuthorizedCron(req)) return errorRes('Forbidden', ['Invalid cron secret'], 403);

    const job = (req.nextUrl.searchParams.get('job') || 'all').trim().toLowerCase();
    const valid = ['discover', 'extract', 'monitor', 'revalidate', 'all'];
    if (!valid.includes(job)) return errorRes('Unknown job', [`Use one of: ${valid.join(', ')}`], 400);

    // A batch is a knob, not a constant: clearing a backlog of discovered-but-
    // never-extracted candidates takes ~10 calls at the cron default, which the
    // 10-minute guard spaces out to two hours. An operator holding the cron
    // secret can raise the batch and skip the guard to drain it in one sitting.
    const batchRaw = Number(req.nextUrl.searchParams.get('batch'));
    const batch = Number.isInteger(batchRaw) && batchRaw > 0 ? Math.min(batchRaw, 40) : 10;
    const force = req.nextUrl.searchParams.get('force') === '1';

    const guard = (name: string, ms: number) => {
      if (force) return true;
      const last = lastRunAt.get(name) ?? 0;
      if (Date.now() - last < ms) return false;
      lastRunAt.set(name, Date.now());
      return true;
    };

    const out: Record<string, unknown> = { job };

    // One failing stage must never take the others down with it, and a failed
    // stage must not stay locked out for its whole guard window.
    const stage = async (name: string, fn: () => Promise<unknown>) => {
      try {
        return await fn();
      } catch (err) {
        lastRunAt.delete(name);
        console.error(`Hub cron stage '${name}' failed:`, err);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    };

    // Every stage here is bounded: discovery walks a fixed source list,
    // extraction takes a fixed batch, and monitoring takes a fixed batch +
    // time budget, rotating through the catalogue on later runs. Nothing is
    // queued, so the HTTP 200 means "this slice done", not "all done".
    if (job === 'discover' || job === 'all') {
      if (!guard('discover', 10 * 60_000)) out.discovery = { skipped: 'ran <10m ago' };
      else out.discovery = await stage('discover', () => runDiscovery());
    }
    if (job === 'extract' || job === 'all') {
      if (!guard('extract', 10 * 60_000)) out.extraction = { skipped: 'ran <10m ago' };
      else out.extraction = await stage('extract', () => runExtraction(batch));
    }
    // Re-score what is already stored — no fetch, no AI. Gates and weights change
    // far more often than platform payloads do, and without this every change
    // strands the existing queue at the verdict it got under the old rules.
    if (job === 'revalidate') {
      out.revalidation = await stage('revalidate', async () => {
        const rows = await prisma.hubCandidate.findMany({
          where: { status: { in: ['VERIFIED', 'NEEDS_REVIEW'] } },
          select: { id: true, sourceType: true, extracted: true, status: true, confidence: true },
        });
        let promoted = 0;
        let demoted = 0;
        let deadlineFilled = 0;
        for (const row of rows) {
          const stored = (row.extracted ?? {}) as unknown as ExtractedEvent;
          const event = deriveRegistrationDeadline(stored);
          if (!stored.registrationDeadline && event.registrationDeadline) deadlineFilled += 1;
          const missing = mandatoryMissing(event);
          const confidence = scoreConfidence(event, row.sourceType);
          const status = wouldAutoVerify(event, row.sourceType) ? 'VERIFIED' : 'NEEDS_REVIEW';
          if (status === row.status && confidence === row.confidence) continue;
          await prisma.hubCandidate.update({
            where: { id: row.id },
            data: {
              status,
              confidence,
              extracted: event as unknown as object,
              error: missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
            },
          });
          if (status === 'VERIFIED' && row.status !== 'VERIFIED') promoted += 1;
          if (status !== 'VERIFIED' && row.status === 'VERIFIED') demoted += 1;
        }
        return { scanned: rows.length, promoted, demoted, deadlineFilled };
      });
    }

    if (job === 'monitor' || job === 'all') {
      if (!guard('monitor', 60 * 60_000)) out.monitor = { skipped: 'ran <1h ago' };
      else if (monitorInFlight) out.monitor = { skipped: 'previous monitor still running' };
      else {
        monitorInFlight = true;
        try {
          out.monitor = await runMonitor();
        } finally {
          monitorInFlight = false;
        }
      }
    }

    // Renderer visibility: without this a dead renderer degrades into "fewer
    // candidates" and reads like a normal run.
    if (job === 'all' || job === 'discover' || job === 'extract') {
      out.renderer = isFirecrawlConfigured()
        ? { configured: true, healthy: await rendererHealthy(), budget: renderBudgetState() }
        : { configured: false };
    }

    return successRes(out, 'Hub cron executed successfully.');
  } catch (err) {
    console.error('Hub cron error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
