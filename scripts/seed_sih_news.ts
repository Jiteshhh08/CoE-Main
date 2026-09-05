import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/minio";
import fs from "fs";
import path from "path";

/**
 * Seeds the full SIH 2026 editorial as the first EventNews for event 3 (prod SIH).
 * Run: npx --yes tsx --env-file=.env scripts/seed_sih_news.ts
 * Idempotent: deletes existing news for event 3 then re-creates.
 */
async function main() {
  const eventId = 3;
  const event = await prisma.hackathonEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    console.log(`Event ${eventId} not found — listing first 5 events:`);
    console.log(await prisma.hackathonEvent.findMany({ take: 5, select: { id: true, title: true } }));
    process.exit(1);
  }
  console.log(`Found event ${eventId}: ${event.title}`);

  // Clean existing SIH news to keep idempotent
  const existing = await prisma.eventNews.findMany({ where: { eventId, title: { contains: "SIH 2026" } } });
  for (const n of existing) {
    await prisma.eventNews.delete({ where: { id: n.id } });
    console.log(`Deleted existing news ${n.id}`);
  }

  // Upload hero + pitch images to MinIO (so storageUrl works prod+dev)
  const heroPath = path.join(process.cwd(), "public/sih-2026/sih-2026-hero.jpg");
  const heroBuf = fs.readFileSync(heroPath);
  const heroKey = await uploadFile(`events/${eventId}/news`, {
    buffer: heroBuf,
    originalname: "sih-2026-hero.jpg",
    mimetype: "image/jpeg",
    size: heroBuf.length,
  });
  console.log("Uploaded hero", heroKey);

  // For the rich editorial we store a compact caption; the full 7-section layout
  // is rendered by the static SIH article component when eventId===3 — but since
  // you asked for dynamic-only, we store the full lead + stats as caption.
  // The News card will show this caption; the full editorial can be expanded by
  // linking to the same content if needed.
  const caption = `A fully digital, collaborative and experiential innovation journey bringing together 254 students across 14 departments.

Thakur College of Engineering and Technology (TCET), Mumbai, successfully conducted its Internal Hackathon for Smart India Hackathon (SIH) 2026, creating a platform for students to work on complex engineering and real-world problem statements and transform their ideas into meaningful technology-driven solutions.

Held from 17th to 22nd across all 14 departments, the internal hackathon brought together 254 student participants who worked in teams to ideate, develop and present their solutions.

A Completely Digital Hackathon Experience: The entire journey was designed and executed digitally through the institute's portal—from participation and submission to evaluation, presentations and shortlisting.

Solving Complex Engineering Problems: Teams worked on challenging problem statements, emphasizing ideation, experimentation, testing, feedback and iteration with guidance from experienced faculty and senior professors.

Interdisciplinary Teams, One Common Goal: Students from different engineering areas collaborated, combining diverse technical perspectives.

Encouraging Women in Innovation: Growing participation of female students added diversity of perspectives and inclusive teamwork.

Learning from Experienced Evaluators: Judging looked beyond novelty to technical feasibility, problem-solving approach, implementation and overall quality. Innovation is not only about having an idea; it is about being able to explain, defend, improve and translate that idea into a viable solution.

Two Rounds, Continuous Improvement: Two-round selection tested creativity, technical skills, problem-solving, teamwork and presentation. 50 best-performing teams were shortlisted for the SIH 2026 journey.

Building Engineers Who Can Solve, Adapt and Innovate: As an initiative of MIC, Government of India, the hackathon strengthened TCET's culture of experiential learning, innovation and problem-solving. From identifying the problem to building the solution, from receiving feedback to iterating on ideas — the TCET Internal Hackathon gave students a glimpse of what it truly means to engineer for the real world.`;

  const news = await prisma.eventNews.create({
    data: {
      eventId,
      title: "TCET Internal Hackathon – SIH 2026: From Complex Engineering Problems to Innovative Solutions",
      caption,
      imageKey: heroKey,
      pinned: true,
    },
  });
  console.log(`Created EventNews ${news.id} for event ${eventId} — will appear at /hackathons/${eventId} above Notices`);
}

main().catch((e) => { console.error(e); process.exit(1); });
