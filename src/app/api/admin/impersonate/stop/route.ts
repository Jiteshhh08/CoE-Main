import { NextRequest } from 'next/server';
import { authenticate, errorRes, successRes, useSecureCookies } from '@/lib/api-helpers';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  SHARED_TOKEN_TTL_SECONDS,
  generateAccessToken,
  generateRefreshToken,
  generateSharedToken,
  TokenPayload,
} from '@/lib/jwt';
import { buildSharedTokenPayload, getSharedCookieOptions, SHARED_COOKIE_NAME } from '@/lib/shared-auth';
import prisma from '@/lib/prisma';

const clearImpersonationCookies = (
  response: Awaited<ReturnType<typeof successRes>>,
  secureCookies: boolean,
  sharedCookieOptions: ReturnType<typeof getSharedCookieOptions>,
) => {
  response.cookies.set('accessToken', '', {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  response.cookies.set('refreshToken', '', {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  response.cookies.set(SHARED_COOKIE_NAME, '', {
    ...sharedCookieOptions,
    maxAge: 0,
  });
};

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    if (!user.isImpersonating || !user.impersonation?.sessionId) {
      return errorRes('Not currently impersonating.', [], 400);
    }

    const sessionId = user.impersonation.sessionId;

    const session = await prisma.impersonationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      return errorRes('Impersonation session not found.', [], 404);
    }

    // Close the session
    const now = new Date();
    const durationSeconds = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000);

    await prisma.impersonationSession.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED',
        endedAt: now,
        durationSeconds,
      },
    });

    // Try to restore the admin user
    const admin = await prisma.user.findUnique({
      where: { id: session.adminId },
      select: { id: true, name: true, email: true, role: true, uid: true, industryId: true, status: true, facultyProfile: { select: { isHod: true } } },
    });

    const secureCookies = useSecureCookies();
    const sharedCookieOptions = getSharedCookieOptions();

    if (admin && admin.status === 'ACTIVE') {
      const adminPayload: TokenPayload = {
        id: admin.id,
        role: admin.role,
        name: admin.name,
        email: admin.email,
        industryId: admin.industryId,
        ...(admin.uid && { uid: admin.uid }),
      };

      const accessToken = generateAccessToken(adminPayload);
      const refreshToken = generateRefreshToken(adminPayload);
      const sharedToken = generateSharedToken(buildSharedTokenPayload({ ...admin, isHod: admin.facultyProfile?.isHod }));

      const response = successRes(
        { restored: true, reason: 'restored' },
        'Impersonation ended. Admin session restored.',
      );

      response.cookies.set('accessToken', accessToken, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
        path: '/',
      });
      response.cookies.set('refreshToken', refreshToken, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
        path: '/',
      });
      response.cookies.set(SHARED_COOKIE_NAME, sharedToken, {
        ...sharedCookieOptions,
        maxAge: SHARED_TOKEN_TTL_SECONDS,
      });

      return response;
    }

    // Admin not restorable — clear all cookies
    const reason = !admin ? 'admin_deleted' : 'admin_inactive';
    const response = successRes(
      { restored: false, reason },
      'Impersonation ended. Admin session could not be restored.',
    );
    clearImpersonationCookies(response, secureCookies, sharedCookieOptions);
    return response;
  } catch (error) {
    console.error('[impersonation:stop]', error);
    return errorRes('Internal server error', [], 500);
  }
}
