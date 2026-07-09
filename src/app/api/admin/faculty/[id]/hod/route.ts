import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { successRes, errorRes, authenticate, authorize } from '@/lib/api-helpers';
import { syncFaculty } from '@/lib/dashboard-sync';
import { isValidDepartment } from '@/lib/validators';

// PATCH /api/admin/faculty/:id/hod
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    if (!authorize(user, 'ADMIN')) return errorRes('Forbidden', [], 403);

    const { id } = await params;
    const userId = parseInt(id);
    if (Number.isNaN(userId)) return errorRes('Invalid user ID.', [], 400);

    const body = await req.json().catch(() => ({}));
    const isHod = Boolean(body.isHod);
    const department: string | undefined = body.department;

    if (isHod) {
      if (!department || typeof department !== 'string' || !department.trim()) {
        return errorRes('Department is required when assigning HOD.', [], 400);
      }
      if (!isValidDepartment(department.trim())) {
        return errorRes('Invalid department.', [], 400);
      }
    }

    const faculty = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, name: true, uid: true, status: true },
    });
    if (!faculty) return errorRes('Faculty not found.', [], 404);
    if (faculty.role !== 'FACULTY') return errorRes('Faculty not found.', [], 404);

    const result = await prisma.$transaction(async (tx) => {
      let oldHodUserId: number | null = null;

      if (isHod && department) {
        const currentHod = await tx.facultyProfile.findFirst({
          where: { department: department.trim(), isHod: true, userId: { not: userId } },
          select: { userId: true },
        });

        if (currentHod) {
          oldHodUserId = currentHod.userId;
          await tx.facultyProfile.update({
            where: { userId: currentHod.userId },
            data: { isHod: false },
          });
        }
      }

      const updated = await tx.facultyProfile.upsert({
        where: { userId },
        create: {
          userId,
          department: isHod ? department!.trim() : null,
          isHod,
        },
        update: {
          isHod,
          ...(isHod && department ? { department: department.trim() } : {}),
        },
      });

      return { updated, oldHodUserId };
    });

    void syncFaculty(userId);
    if (result.oldHodUserId) {
      void syncFaculty(result.oldHodUserId);
    }

    return successRes(result.updated, isHod ? 'HOD assigned successfully.' : 'HOD role removed successfully.');
  } catch (err) {
    console.error('HOD assignment error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
