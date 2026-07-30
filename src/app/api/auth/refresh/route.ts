import { NextRequest } from 'next/server';
import { successRes, errorRes, useSecureCookies } from '@/lib/api-helpers';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  SHARED_TOKEN_TTL_SECONDS,
  verifyRefreshToken,
  generateAccessToken,
  generateRefreshToken,
  generateSharedToken,
  buildImpersonationAccessTokenPayload,
  TokenPayload,
} from '@/lib/jwt';
import prisma from '@/lib/prisma';
import { buildSharedTokenPayload, getSharedCookieOptions, SHARED_COOKIE_NAME } from '@/lib/shared-auth';

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refreshToken')?.value;
    if (!refreshToken) {
      return errorRes('No refresh token provided.', [], 401);
    }

    const decoded = verifyRefreshToken(refreshToken) as TokenPayload;

    if (decoded.isImpersonating) {
      return handleImpersonationRefresh(decoded);
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        role: true,
        name: true,
        email: true,
        uid: true,
        industryId: true,
        status: true,
        facultyProfile: { select: { isHod: true } },
      },
    });

    if (!currentUser) {
      return errorRes('User not found.', [], 401);
    }

    const payload: TokenPayload = {
      id: currentUser.id,
      role: currentUser.role,
      name: currentUser.name,
      email: currentUser.email,
      industryId: currentUser.industryId,
      ...(currentUser.uid && { uid: currentUser.uid }),
    };

    const accessToken = generateAccessToken(payload);
    const sharedToken = generateSharedToken(buildSharedTokenPayload({ ...currentUser, isHod: currentUser.facultyProfile?.isHod }));
    const secureCookies = useSecureCookies();
    const sharedCookieOptions = getSharedCookieOptions();

    const response = successRes({ accessToken }, 'Token refreshed successfully.');
    response.cookies.set('accessToken', accessToken, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
      path: '/',
    });

    response.cookies.set(SHARED_COOKIE_NAME, sharedToken, {
      ...sharedCookieOptions,
      maxAge: SHARED_TOKEN_TTL_SECONDS,
    });

    return response;
  } catch {
    return errorRes('Invalid or expired refresh token.', [], 401);
  }
}

async function handleImpersonationRefresh(decoded: TokenPayload) {
  const sessionId = decoded.impersonation?.sessionId;
  if (!sessionId) {
    return errorRes('Invalid impersonation session reference.', [], 401);
  }

  const session = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.status !== 'ACTIVE') {
    return impersonationFallback(session?.adminId, session?.id, session?.startedAt, 'session_ended');
  }

  const [admin, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.adminId },
      select: { id: true, name: true, email: true, role: true, uid: true, industryId: true, status: true, facultyProfile: { select: { isHod: true } } },
    }),
    prisma.user.findUnique({
      where: { id: session.targetUserId },
      select: { id: true, name: true, email: true, role: true, uid: true, industryId: true, status: true, facultyProfile: { select: { isHod: true } } },
    }),
  ]);

  if (!admin || admin.status !== 'ACTIVE') {
    return impersonationFallback(session.adminId, session.id, session.startedAt, 'admin_inactive');
  }

  if (!target || target.status !== 'ACTIVE') {
    return impersonationFallback(session.adminId, session.id, session.startedAt, 'target_inactive');
  }

  const impersonationPayload = buildImpersonationAccessTokenPayload(target, sessionId);
  const accessToken = generateAccessToken(impersonationPayload);
  const newRefreshToken = generateRefreshToken(impersonationPayload);
  const sharedToken = generateSharedToken(
    buildSharedTokenPayload({ ...target, isHod: target.facultyProfile?.isHod }, { sessionId }),
  );

  const secureCookies = useSecureCookies();
  const sharedCookieOptions = getSharedCookieOptions();

  const response = successRes({ accessToken }, 'Impersonation token refreshed.');

  response.cookies.set('accessToken', accessToken, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
    path: '/',
  });

  response.cookies.set('refreshToken', newRefreshToken, {
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

async function impersonationFallback(
  adminId: number | undefined,
  sessionId: string | undefined,
  startedAt: Date | undefined,
  reason: string,
) {
  if (sessionId) {
    try {
      const now = new Date();
      const durationSeconds = startedAt
        ? Math.floor((now.getTime() - startedAt.getTime()) / 1000)
        : undefined;

      await prisma.impersonationSession.update({
        where: { id: sessionId },
        data: {
          status: 'ENDED',
          endedAt: now,
          durationSeconds,
        },
      });
    } catch {
    }
  }

  const secureCookies = useSecureCookies();
  const sharedCookieOptions = getSharedCookieOptions();

  if (adminId) {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, name: true, email: true, role: true, uid: true, industryId: true, status: true, facultyProfile: { select: { isHod: true } } },
    });

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
      const newRefreshToken = generateRefreshToken(adminPayload);
      const sharedToken = generateSharedToken(buildSharedTokenPayload({ ...admin, isHod: admin.facultyProfile?.isHod }));

      const response = successRes(
        { accessToken, restored: true, reason },
        'Session restored.',
      );

      response.cookies.set('accessToken', accessToken, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
        path: '/',
      });
      response.cookies.set('refreshToken', newRefreshToken, {
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
  }

  const response = successRes(
    { restored: false, reason },
    'Session ended.',
  );

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

  return response;
}
