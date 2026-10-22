import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticate, authorize, errorRes, successRes } from '@/lib/api-helpers';
import { publishCandidate } from '@/lib/hub/pipeline';

// Publishing scores and dedupes per candidate, so a full queue takes a while.
export const maxDuration = 300;

const ALLOWED = ['VERIFIED', 'NEEDS_REVIEW', 'DISCOVERED', 'NEEDS_UPDATE'];
const MAX_BATCH = 500;

/**
 * POST /api/admin/hub/candidates/publish?status=VERIFIED&limit=500
 *
 * Bulk approval. Deliberately routes through the same publishCandidate() the
 * per-row admin button calls, so bulk and single approval cannot drift apart —
 * dedupe, curated-record protection and the missing-field policy all behave
 * identically.
 *
 * Per-candidate failures are collected, never abort the batch: one curated
 * conflict must not strand the other 100.
 */
export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    if (!authorize(user, 'ADMIN')) return errorRes('Forbidden', ['Admin access required'], 403);

    const statusRaw = (req.nextUrl.searchParams.get('status') || 'VERIFIED').trim().toUpperCase();
    const statuses = statusRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = statuses.filter((s) => !ALLOWED.includes(s));
    if (statuses.length === 0 || unknown.length > 0) {
      return errorRes('Validation failed', [`status must be one of: ${ALLOWED.join(', ')}`], 400);
    }

    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? MAX_BATCH);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_BATCH) : MAX_BATCH;

    const rows = await prisma.hubCandidate.findMany({
      where: { status: { in: statuses } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });

    const out = {
      statuses,
      attempted: rows.length,
      created: 0,
      merged: 0,
      conflicts: 0,
      failed: 0,
      failures: [] as { id: number; reason: string }[],
    };

    for (const row of rows) {
      try {
        const result = await publishCandidate(row.id, user.id);
        if (result.conflict) {
          out.conflicts += 1;
          if (out.failures.length < 20) {
            out.failures.push({ id: row.id, reason: result.reason ?? 'curated record conflict' });
          }
        } else if (result.merged) {
          out.merged += 1;
        } else {
          out.created += 1;
        }
      } catch (err) {
        out.failed += 1;
        if (out.failures.length < 20) {
          out.failures.push({ id: row.id, reason: err instanceof Error ? err.message : 'unknown error' });
        }
      }
    }

    return successRes(
      out,
      `Published ${out.created + out.merged} of ${out.attempted} candidate(s)` +
        (out.conflicts || out.failed ? ` — ${out.conflicts} conflict(s), ${out.failed} failed.` : '.'),
    );
  } catch (err) {
    console.error('Bulk hub publish error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
