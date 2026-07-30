import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-me';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const ACCESS_TOKEN_TTL_SECONDS = parsePositiveInt(process.env.JWT_ACCESS_TTL_SECONDS, 8 * 60 * 60);
export const REFRESH_TOKEN_TTL_SECONDS = parsePositiveInt(process.env.JWT_REFRESH_TTL_SECONDS, 7 * 24 * 60 * 60);
export const SHARED_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TokenPayload {
  id: number;
  role: string;
  name: string;
  email: string;
  uid?: string;
  industryId?: number | null;
  // New optional fields — present ONLY during impersonation
  isImpersonating?: true;
  impersonation?: {
    /** UUID linking to ImpersonationSession for audit + restoration */
    sessionId: string;
  };
}

export interface SharedTokenPayload {
  email: string;
  name: string;
  role: 'ADMIN' | 'FACULTY' | 'STUDENT' | 'INDUSTRY';
  status: 'ACTIVE' | 'PENDING' | 'REJECTED';
  uid?: string;
  isHod?: boolean;
  // New optional fields — present ONLY during impersonation
  isImpersonating?: true;
  impersonation?: {
    /** UUID linking to ImpersonationSession for audit */
    sessionId: string;
  };
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
};

export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
};

export const generateSharedToken = (payload: SharedTokenPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: SHARED_TOKEN_TTL_SECONDS });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, REFRESH_SECRET) as TokenPayload;
};

/**
 * Build a TokenPayload for an impersonation session.
 * The payload carries the TARGET user's identity so that
 * authenticate() and authorize() evaluate as the target user.
 */
export function buildImpersonationAccessTokenPayload(
  targetUser: { id: number; role: string; name: string; email: string; uid?: string | null; industryId?: number | null },
  sessionId: string
): TokenPayload {
  return {
    id: targetUser.id,
    role: targetUser.role,
    name: targetUser.name,
    email: targetUser.email,
    ...(targetUser.uid && { uid: targetUser.uid }),
    ...(targetUser.industryId != null && { industryId: targetUser.industryId }),
    isImpersonating: true,
    impersonation: { sessionId },
  };
}
