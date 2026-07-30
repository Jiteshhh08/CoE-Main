import { NextRequest } from 'next/server';
import { authenticate, authorize, errorRes, successRes, useSecureCookies } from '@/lib/api-helpers';
import { impersonateStartSchema } from '@/lib/validators';
import {
  generateAccessToken,
  generateRefreshToken,
  generateSharedToken,
  buildImpersonationAccessTokenPayload,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  SHARED_TOKEN_TTL_SECONDS,
} from '@/lib/jwt';
import { buildSharedTokenPayload, getSharedCookieOptions, SHARED_COOKIE_NAME } from '@/lib/shared-auth';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

class ImpersonationStartError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    if (!authorize(user, 'ADMIN')) return errorRes('Forbidden', [], 403);
    if (user.isImpersonating) {
      return errorRes('Cannot start impersonation while already impersonating.', [], 409);
    }

    const body = await req.json();
    const parsed = impersonateStartSchema.safeParse(body);
    if (!parsed.success) {
      return errorRes('Validation failed', parsed.error.issues.map((e: any) => e.message), 400);
    }

    const { targetId } = parsed.data;
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || undefined;
    const userAgent = req.headers.get('user-agent') || undefined;

    const session = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetId }, include: { facultyProfile: { select: { isHod: true } } } });
      if (!target) {
        throw new ImpersonationStartError('TARGET_NOT_FOUND', 'Target user not found.', 404);
      }
      if (target.status !== 'ACTIVE') {
        throw new ImpersonationStartError('TARGET_INACTIVE', 'Target user is not active.', 400);
      }
      if (target.id === user.id) {
        throw new ImpersonationStartError('SELF_IMPERSONATION', 'Cannot impersonate yourself.', 400);
      }
      if (target.role === 'INDUSTRY_PARTNER') {
        throw new ImpersonationStartError('INDUSTRY_PARTNER', 'Cannot impersonate an industry partner.', 400);
      }

      const existingSession = await tx.impersonationSession.findFirst({
        where: { adminId: user.id, status: 'ACTIVE' },
      });
      if (existingSession) {
        throw new ImpersonationStartError(
          'ALREADY_IMPERSONATING',
          'You already have an active impersonation session. Stop it first.',
          409,
        );
      }

      return tx.impersonationSession.create({
        data: {
          adminId: user.id,
          targetUserId: target.id,
          ipAddress,
          userAgent,
        },
      });
    });

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, email: true, role: true, uid: true, industryId: true, status: true, facultyProfile: { select: { isHod: true } } },
    });
    if (!targetUser) {
      // Should never happen after transaction success, but guard anyway
      return errorRes('Target user not found after session creation.', [], 500);
    }

    const accessPayload = buildImpersonationAccessTokenPayload(targetUser, session.id);
    const accessToken = generateAccessToken(accessPayload);
    const refreshToken = generateRefreshToken(accessPayload);
    const sharedToken = generateSharedToken(
      buildSharedTokenPayload({ ...targetUser, isHod: targetUser.facultyProfile?.isHod }, { sessionId: session.id }),
    );

    const secureCookies = useSecureCookies();
    const sharedCookieOptions = getSharedCookieOptions();

    const response = successRes(
      {
        sessionId: session.id,
        target: {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          role: targetUser.role,
          uid: targetUser.uid,
        },
      },
      'Impersonation started.',
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
  } catch (error) {
    if (error instanceof ImpersonationStartError) {
      return errorRes(error.message, [error.code], error.status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return errorRes('An impersonation session was already created by another request.', [], 409);
    }
    console.error('[impersonation:start]', error);
    return errorRes('Internal server error', [], 500);
  }
}
