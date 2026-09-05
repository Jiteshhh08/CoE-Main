import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticate, errorRes, successRes } from '@/lib/api-helpers';
import { canManageEvent } from '@/lib/hackathon-ops';

// Mirrors notices/[noticeId]/route.ts exactly: PUT (coordinator), DELETE (admin only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; newsId: string }> }) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    const eventId = Number((await params).id);
    const newsId = Number((await params).newsId);
    const event = await prisma.hackathonEvent.findUnique({ where: { id: eventId }, select: { coordinatorId: true, coordinators: { select: { userId: true } }, config: true } });
    if (!event) return errorRes('Event not found', [], 404);
    if (!canManageEvent(user, event)) return errorRes('Coordinator access required', [], 403);
    const body = await req.json().catch(() => null);

    const news = await prisma.eventNews.findFirst({ where: { id: newsId, eventId } });
    if (!news) return errorRes('News not found', [], 404);

    const updated = await prisma.eventNews.update({
      where: { id: newsId },
      data: {
        title: body?.title != null ? String(body.title).trim().slice(0, 200) : news.title,
        caption: body?.caption != null ? String(body.caption).trim() : news.caption,
        pinned: body?.pinned != null ? !!body.pinned : news.pinned,
      },
    });
    return successRes({ news: updated }, 'News updated');
  } catch (err) {
    console.error('news PUT error:', err);
    return errorRes('Internal server error', [], 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; newsId: string }> }) {
  try {
    const user = authenticate(req);
    if (!user || user.role !== 'ADMIN') return errorRes('Admins only', [], 403);
    const eventId = Number((await params).id);
    const newsId = Number((await params).newsId);
    const news = await prisma.eventNews.findFirst({ where: { id: newsId, eventId } });
    if (!news) return errorRes('News not found', [], 404);
    await prisma.eventNews.delete({ where: { id: newsId } });
    return successRes({ deleted: true }, 'News deleted');
  } catch (err) {
    console.error('news DELETE error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
