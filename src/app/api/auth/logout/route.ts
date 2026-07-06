import { NextRequest, NextResponse } from "next/server";
import { useSecureCookies } from "@/lib/api-helpers";
import { verifyAccessToken } from "@/lib/jwt";
import prisma from "@/lib/prisma";
import { DEFAULT_CALLBACK_URL, isValidCallbackUrl } from "@/lib/callback-url";
import { getSharedCookieOptions, SHARED_COOKIE_NAME } from "@/lib/shared-auth";

const tryCloseImpersonationSession = (req: NextRequest) => {
  const token = req.cookies.get("accessToken")?.value;
  if (!token) return;

  try {
    const decoded = verifyAccessToken(token);
    if (decoded.isImpersonating && decoded.impersonation?.sessionId) {
      const sessionId = decoded.impersonation.sessionId;
      prisma.impersonationSession.update({
        where: { id: sessionId },
        data: {
          status: "ENDED",
          endedAt: new Date(),
        },
      }).catch(() => {});
    }
  } catch {
  }
};

const clearAuthCookies = (
  response: NextResponse,
  secureCookies: boolean,
  sharedCookieOptions: ReturnType<typeof getSharedCookieOptions>,
) => {
  response.cookies.set("accessToken", "", {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.cookies.set("refreshToken", "", {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.cookies.set(SHARED_COOKIE_NAME, "", {
    ...sharedCookieOptions,
    maxAge: 0,
  });
};

export async function POST(request: NextRequest) {
  tryCloseImpersonationSession(request);

  const secureCookies = useSecureCookies();
  const sharedCookieOptions = getSharedCookieOptions();
  const response = NextResponse.json({
    success: true,
    message: "Logged out successfully.",
    data: null,
  });
  clearAuthCookies(response, secureCookies, sharedCookieOptions);
  return response;
}

export async function GET(request: NextRequest) {
  tryCloseImpersonationSession(request);

  const secureCookies = useSecureCookies();
  const sharedCookieOptions = getSharedCookieOptions();

  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "";
  const resolvedCallbackUrl = isValidCallbackUrl(callbackUrl)
    ? callbackUrl
    : DEFAULT_CALLBACK_URL;

  const response = NextResponse.redirect(resolvedCallbackUrl);
  clearAuthCookies(response, secureCookies, sharedCookieOptions);

  return response;
}
