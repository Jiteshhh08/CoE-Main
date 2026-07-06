import { NextRequest } from 'next/server';
import { authenticate, authorize, errorRes, successRes } from '@/lib/api-helpers';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    if (!authorize(user, 'ADMIN')) return errorRes('Forbidden', [], 403);

    const sessions = await prisma.impersonationSession.findMany({
      where: { adminId: user.id, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });

    const enrichedSessions = await Promise.all(
      sessions.map(async (s) => {
        const targetUser = await prisma.user.findUnique({
          where: { id: s.targetUserId },
          select: { id: true, name: true, email: true, role: true, uid: true },
        });
        return { ...s, targetUser };
      }),
    );

    return successRes({ sessions: enrichedSessions }, 'Active sessions retrieved.');
  } catch (error) {
    console.error('[impersonation:sessions]', error);
    return errorRes('Internal server error', [], 500);
  }
}
