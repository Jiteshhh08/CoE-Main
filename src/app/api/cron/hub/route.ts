import { NextRequest } from 'next/server';
import { authenticate, authorize, errorRes, successRes } from '@/lib/api-helpers';
import { runDiscovery } from '@/lib/hub/discovery';
import { runExtraction } from '@/lib/hub/extract';
import { runMonitor } from '@/lib/hub/monitor';

// Hub automation jobs (§33–34, Next.js cron-route form): separate lib stages,
// one guarded entrypoint with ?job=.
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

// GET /api/cron/hub?job=discover|extract|monitor|all
export async function GET(req: NextRequest) {
  try {
    if (!isAuthorizedCron(req)) return errorRes('Forbidden', ['Invalid cron secret'], 403);

    const job = (req.nextUrl.searchParams.get('job') || 'all').trim().toLowerCase();
    const valid = ['discover', 'extract', 'monitor', 'all'];
    if (!valid.includes(job)) return errorRes('Unknown job', [`Use one of: ${valid.join(', ')}`], 400);

    const guard = (name: string, ms: number) => {
      const last = lastRunAt.get(name) ?? 0;
      if (Date.now() - last < ms) return false;
      lastRunAt.set(name, Date.now());
      return true;
    };

    const out: Record<string, unknown> = { job };

    // Every stage here is bounded: discovery walks a fixed source list,
    // extraction takes a fixed batch, and monitoring takes a fixed batch +
    // time budget, rotating through the catalogue on later runs. Nothing is
    // queued, so the HTTP 200 means "this slice done", not "all done".
    if (job === 'discover' || job === 'all') {
      if (!guard('discover', 10 * 60_000)) out.discovery = { skipped: 'ran <10m ago' };
      else out.discovery = await runDiscovery();
    }
    if (job === 'extract' || job === 'all') {
      if (!guard('extract', 10 * 60_000)) out.extraction = { skipped: 'ran <10m ago' };
      else out.extraction = await runExtraction(10);
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

    return successRes(out, 'Hub cron executed successfully.');
  } catch (err) {
    console.error('Hub cron error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
