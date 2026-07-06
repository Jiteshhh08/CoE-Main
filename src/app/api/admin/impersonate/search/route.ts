import { NextRequest } from 'next/server';
import { authenticate, authorize, errorRes, successRes } from '@/lib/api-helpers';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    if (!authorize(user, 'ADMIN')) return errorRes('Forbidden', [], 403);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

    if (!q || q.length < 1) {
      return successRes({ users: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { uid: { contains: q } },
          ],
          status: 'ACTIVE' as const,
          role: { not: 'INDUSTRY_PARTNER' as const },
          id: { not: user.id },
        },
        select: { id: true, name: true, email: true, role: true, uid: true, status: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({
        where: {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { uid: { contains: q } },
          ],
          status: 'ACTIVE' as const,
          role: { not: 'INDUSTRY_PARTNER' as const },
          id: { not: user.id },
        },
      }),
    ]);

    return successRes({
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[impersonation:search]', error);
    return errorRes('Internal server error', [], 500);
  }
}
