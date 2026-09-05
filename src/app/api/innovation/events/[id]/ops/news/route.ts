import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticate, errorRes, successRes } from '@/lib/api-helpers';
import { canManageEvent } from '@/lib/hackathon-ops';
import { uploadFile } from '@/lib/minio';

// GET  — news for the event (public; used by student pages too)
// POST — create news { title, caption, pinned?, file } (ADMIN/coordinator) — mirrors notices/route.ts exactly
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = Number((await params).id);
    const news = await prisma.eventNews.findMany({
      where: { eventId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
    return successRes({ news });
  } catch (err) {
    console.error('news GET error:', err);
    return errorRes('Internal server error', [], 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = authenticate(req);
    if (!user) return errorRes('Unauthorized', [], 401);
    const eventId = Number((await params).id);
    const event = await prisma.hackathonEvent.findUnique({ where: { id: eventId }, select: { coordinatorId: true, coordinators: { select: { userId: true } }, config: true } });
    if (!event) return errorRes('Event not found', [], 404);
    if (!canManageEvent(user, event)) return errorRes('Coordinator access required', [], 403);

    // mirrors media/route.ts FormData handling but keeps notices/route.ts field names (title/caption)
    const form = await req.formData();
    const title = String(form.get('title') ?? '').trim().slice(0, 200);
    const caption = String(form.get('caption') ?? '').trim();
    const pinned = form.get('pinned') === 'true' || form.get('pinned') === '1';
    const file = form.get('file') as File | null;
    const imageFile = (form.get('image') as File | null) ?? file;

    if (!title) return errorRes('News title is required', [], 400);
    if (!caption) return errorRes('News description is required', [], 400);
    if (!imageFile || !imageFile.size) return errorRes('Image is required', [], 400);

    const allowed = /^image\/(png|jpe?g|webp)$/;
    if (!allowed.test(imageFile.type)) return errorRes('Unsupported image type', ['Only PNG, JPEG, WebP allowed'], 400);
    if (imageFile.size > 10 * 1024 * 1024) return errorRes('Image too large', ['Max 10 MB'], 400);

    const buffer = Buffer.from(await imageFile.arrayBuffer());
    const imageKey = await uploadFile(`events/${eventId}/news`, {
      buffer,
      originalname: imageFile.name,
      mimetype: imageFile.type,
      size: imageFile.size,
    });

    const news = await prisma.eventNews.create({
      data: {
        eventId,
        title,
        caption,
        imageKey,
        pinned: !!pinned,
      },
    });
    return successRes({ news }, 'News published');
  } catch (err) {
    console.error('news POST error:', err);
    return errorRes('Internal server error', [], 500);
  }
}
