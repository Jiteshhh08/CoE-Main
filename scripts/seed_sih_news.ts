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

  // Upload single SIH image to MinIO (so storageUrl works prod+dev)
  // ponytail: single-image news for now; extend EventNews to imageKeys: Json if multi-image gallery needed
  const heroPath = path.join(process.cwd(), "public/sih-2026-pitch-1.jpg");
  const heroBuf = fs.readFileSync(heroPath);
  const heroKey = await uploadFile(`events/${eventId}/news`, {
    buffer: heroBuf,
    originalname: "sih-2026-pitch-1.jpg",
    mimetype: "image/jpeg",
    size: heroBuf.length,
  });
  console.log("Uploaded hero", heroKey);

  // Full editorial stored as plain-text caption (generic News card renders
  // whitespace-pre-wrap, so headings + paragraphs show without custom layout).
  const caption = `A fully digital, collaborative and experiential innovation journey bringing together 254 students across 14 departments.

Thakur College of Engineering and Technology (TCET), Mumbai, successfully conducted its Internal Hackathon for Smart India Hackathon (SIH) 2026, creating a platform for students to work on complex engineering and real-world problem statements and transform their ideas into meaningful technology-driven solutions.

Held from 17th to 22nd across all 14 departments, the internal hackathon brought together 254 student participants who worked in teams to ideate, develop and present their solutions.

254 Students | 14 Departments | 2 Rounds | 50 Teams shortlisted for SIH 2026.

A Completely Digital Hackathon Experience

The entire journey of the internal hackathon was designed and executed digitally through the institute's portal. From the initial participation and submission process to evaluation, presentations and shortlisting, students experienced a structured, technology-enabled innovation workflow.

This digital approach enabled the institute to manage participation across multiple departments while giving students an experience that closely reflected the collaborative and technology-intensive environment of a national-level hackathon.

Solving Complex Engineering Problems

At the heart of the hackathon were challenging and complex problem statements that required students to move beyond conventional classroom approaches.

Teams were encouraged to understand the problem, identify the core challenges, explore possible approaches and build solutions that could address real-world requirements. The emphasis was not simply on arriving at a final answer, but on the process of innovation — ideation, experimentation, testing, feedback and iteration.

Students were guided throughout this journey by experienced faculty members and senior professors, who brought their technical and academic expertise into the mentoring and evaluation process. Their involvement helped teams critically examine their approaches, identify gaps and iterate on their solutions based on feedback.

"A strong solution is rarely built in one attempt; it evolves through questioning, testing, feedback and continuous improvement."

This process gave students an important insight into how engineering solutions are developed in practice.

Interdisciplinary Teams, One Common Goal

Another important aspect of the internal hackathon was the encouragement of interdisciplinary collaboration.

Students from different areas of engineering brought together diverse technical perspectives to approach the problem statements. Such multidisciplinary teams enabled participants to look at problems from different angles and combine knowledge from different domains while developing their solutions.

The experience encouraged students to move beyond departmental boundaries and understand the value of collaboration when solving complex engineering problems — an approach that is increasingly important in today's technology and innovation ecosystem.

Encouraging Women in Innovation

The hackathon also reflected the growing participation of female students in technology, engineering and innovation-driven activities at TCET.

The participation of women across the teams added to the diversity of perspectives within the hackathon environment. Their involvement demonstrated the importance of creating opportunities where every student can contribute ideas, take technical ownership and participate actively in solving challenging engineering problems.

The hackathon thus became not only a platform for technological innovation but also a space for inclusive participation, teamwork and confidence-building.

Learning from Experienced Evaluators

A key strength of the internal hackathon was the involvement of experienced faculty members and senior professors in the evaluation and judging process.

Students had the opportunity to present their solutions before experienced evaluators and receive critical feedback. The judging process looked beyond the novelty of an idea and encouraged teams to think about the technical feasibility, problem-solving approach, implementation and overall quality of their proposed solutions.

For the students, this interaction provided valuable exposure to how an engineering idea is assessed from an expert perspective.

Innovation is not only about having an idea; it is about being able to explain, defend, improve and translate that idea into a viable solution.

Two Rounds, Continuous Improvement

The internal selection process was conducted through two rounds of competition, giving teams an opportunity to progressively strengthen their solutions. The hackathon tested creativity, technical skills, problem-solving abilities, teamwork and presentation skills in a competitive, time-bound environment.

Round 1 — Ideate & propose: Understand the problem, identify core challenges, explore approaches and present initial solutions.

Round 2 — Refine & present: Incorporate feedback, test, improve implementation and defend the solution before evaluators.

Outcome — 50 teams shortlisted: Following rigorous evaluation across both rounds, 50 of the best-performing teams were shortlisted to take their solutions forward in the SIH 2026 journey.

Building Engineers Who Can Solve, Adapt and Innovate

The TCET Internal Hackathon – SIH 2026 was much more than an internal competition. It created an environment where students could work on complex problems, collaborate across disciplines, learn from experienced faculty, receive expert feedback and continuously iterate on their solutions.

As an initiative connected to the Smart India Hackathon of the Ministry of Education's Innovation Cell (MIC), Government of India, the hackathon provided students with an opportunity to engage with societal and industry challenges through innovation and technology.

With participation from 254 students across 14 departments, a completely digital execution model, interdisciplinary collaboration, strong female participation and guidance from experienced faculty and senior evaluators, the initiative strengthened TCET's culture of experiential learning, innovation and problem-solving.

From identifying the problem to building the solution, from receiving feedback to iterating on ideas — the TCET Internal Hackathon gave students a glimpse of what it truly means to engineer for the real world.`;

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
