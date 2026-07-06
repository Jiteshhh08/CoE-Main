import { NextRequest } from 'next/server';
import { authenticate, errorRes, successRes } from '@/lib/api-helpers';
import { SHARED_COOKIE_NAME } from '@/lib/shared-auth';
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-change-me';

export async function GET(req: NextRequest) {
  try {
    // Try authenticate() first (CoE Main caller via access token)
    const user = authenticate(req);
    let sessionId: string | undefined;
    let authMethod: 'access_token' | 'shared_token' | null = null;

    if (user?.isImpersonating && user.impersonation?.sessionId) {
      sessionId = user.impersonation.sessionId;
      authMethod = 'access_token';
    } else {
      // Fall back to shared token (Dashboard caller)
      try {
        const sharedToken = req.cookies.get(SHARED_COOKIE_NAME)?.value;
        if (sharedToken) {
          const decoded = jwt.verify(sharedToken, ACCESS_SECRET) as {
            isImpersonating?: true;
            impersonation?: { sessionId: string };
          };
          if (decoded.isImpersonating && decoded.impersonation?.sessionId) {
            sessionId = decoded.impersonation.sessionId;
            authMethod = 'shared_token';
          }
        }
      } catch {
        // Ignore invalid/malformed shared tokens
      }
    }

    if (!sessionId) {
      return errorRes('No active impersonation session found.', [], 401);
    }

    const session = await prisma.impersonationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return errorRes('Impersonation session not found.', [], 404);
    }

    const [adminUser, targetUser] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.adminId },
        select: { name: true, email: true },
      }),
      prisma.user.findUnique({
        where: { id: session.targetUserId },
        select: { name: true, email: true, role: true, uid: true },
      }),
    ]);

    const response = successRes(
      {
        admin: adminUser,
        target: targetUser,
        sessionId: session.id,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSeconds: session.durationSeconds,
        authMethod,
      },
      'Session info retrieved.',
    );

    response.headers.set('Cache-Control', 'no-store, must-revalidate');
    return response;
  } catch (error) {
    console.error('[impersonation:session-info]', error);
    return errorRes('Internal server error', [], 500);
  }
}
