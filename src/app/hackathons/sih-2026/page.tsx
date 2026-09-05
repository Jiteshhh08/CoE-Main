import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TCET Internal Hackathon – SIH 2026 | Thakur College of Engineering and Technology",
  description:
    "TCET Mumbai successfully conducted its Internal Hackathon for Smart India Hackathon 2026 from 17th to 22nd across all 14 departments — 254 students, 2 rounds of evaluation, and 50 teams shortlisted for the SIH 2026 journey.",
  openGraph: {
    title: "TCET Internal Hackathon – SIH 2026: From Complex Engineering Problems to Innovative Solutions",
    description:
      "A fully digital, collaborative and experiential innovation journey bringing together 254 students across 14 departments at TCET Mumbai. 50 teams shortlisted for SIH 2026.",
    type: "article",
    url: "/hackathons/sih-2026",
    images: [{ url: "/sih-2026/sih-2026-hero.jpg", width: 1600, height: 900 }],
  },
  alternates: { canonical: "/hackathons/sih-2026" },
};

export default function Sih2026NewsPage() {
  return (
    <article className="min-h-screen bg-surface pb-16">
      {/* Break out of HackathonsLayout max-w-6xl padding */}
      <div className="relative -mx-4 -mt-8 md:-mx-8">
        {/* ── Breadcrumb ───────────────────────────────────── */}
        <nav
          aria-label="Breadcrumb"
          className="mx-auto max-w-6xl px-4 pt-6 md:px-8"
        >
          <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <li>
              <Link href="/hackathons" className="hover:text-primary hover:underline">
                Hackathons
              </Link>
            </li>
            <li aria-hidden="true" className="text-outline-variant">
              /
            </li>
            <li>
              <Link href="/hackathons/browse" className="hover:text-primary hover:underline">
                Browse
              </Link>
            </li>
            <li aria-hidden="true" className="text-outline-variant">
              /
            </li>
            <li aria-current="page" className="font-semibold text-primary">
              SIH 2026
            </li>
            <li className="ml-2 hidden items-center gap-1.5 sm:inline-flex">
              <span className="h-1 w-1 rounded-full bg-secondary-container" aria-hidden="true" />
              <span className="border border-secondary-container bg-secondary-container px-2 py-0.5 text-[10px] font-bold text-on-secondary-container">
                Completed
              </span>
            </li>
          </ol>
        </nav>

        {/* ── Hero ─────────────────────────────────────────── */}
        <header className="mx-auto mt-6 max-w-6xl px-4 md:px-8">
          <div className="border border-hairline bg-white">
            {/* Top hairline + gold rule */}
            <div aria-hidden="true" className="h-1 bg-secondary-container" />
            <div className="p-6 md:p-10">
              {/* Eyebrow */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center border border-primary bg-primary px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                  News
                </span>
                <span className="inline-flex items-center border border-outline-variant px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
                  Hackathon
                </span>
                <span className="inline-flex items-center gap-1.5 border border-outline-variant bg-surface-container px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                  Internal · SIH 2026
                </span>
                <span className="font-mono text-[11px] text-muted">17th–22nd · TCET, Mumbai</span>
              </div>

              <h1 className="mt-4 max-w-4xl font-headline text-[28px] font-bold leading-[1.05] tracking-tight text-primary md:text-[44px]">
                TCET Internal Hackathon – SIH 2026: From Complex Engineering Problems to Innovative Solutions
              </h1>
              <p className="mt-3 max-w-3xl font-body text-base leading-relaxed text-on-surface-variant md:text-lg">
                A fully digital, collaborative and experiential innovation journey bringing together{" "}
                <span className="font-semibold text-primary">254 students across 14 departments</span>.
              </p>

              {/* Meta bar */}
              <div className="mt-6 flex flex-wrap gap-3 border-y border-hairline py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-primary">
                    calendar_month
                  </span>
                  17th–22nd
                </span>
                <span aria-hidden="true" className="text-outline-variant">
                  ·
                </span>
                <span>TCET, Mumbai</span>
                <span aria-hidden="true" className="text-outline-variant">
                  ·
                </span>
                <span>Smart India Hackathon · MIC, Govt. of India</span>
                <span className="ml-auto hidden items-center gap-1.5 md:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                  Completed event
                </span>
              </div>

              {/* Hero image — object-contain so entire image is visible (no crop) */}
              <figure className="mt-6 overflow-hidden border border-hairline bg-surface-container">
                <div className="relative w-full overflow-hidden bg-white">
                  <Image
                    src="/sih-2026/sih-2026-hero.jpg"
                    alt="TCET Internal Hackathon SIH 2026 – institutional hero visual representing the digital innovation journey"
                    width={1600}
                    height={900}
                    priority
                    sizes="(max-width: 768px) 100vw, 1100px"
                    className="h-auto w-full object-contain"
                  />
                </div>
                <figcaption className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3 text-xs leading-relaxed text-muted md:px-5">
                  <span>
                    Students and faculty at the TCET Internal Hackathon – SIH 2026. The entire journey — from participation and submissions to evaluation and shortlisting — was conducted digitally through the institute&apos;s portal.
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                    17th–22nd · All 14 departments
                  </span>
                </figcaption>
              </figure>

              {/* At-a-glance */}
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="border border-hairline bg-surface-container-low px-4 py-3">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Event</p>
                  <p className="mt-1 font-headline text-sm font-bold leading-tight text-primary">TCET Internal Hackathon – SIH 2026</p>
                </div>
                <div className="border border-hairline bg-surface-container-low px-4 py-3">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Date</p>
                  <p className="mt-1 font-mono text-sm font-bold text-primary">17th–22nd</p>
                  <p className="text-[11px] text-muted">All 14 departments</p>
                </div>
                <div className="border border-hairline bg-surface-container-low px-4 py-3">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Participation</p>
                  <p className="mt-1 font-headline text-xl font-bold text-primary">254</p>
                  <p className="text-[11px] text-muted">students</p>
                </div>
                <div className="border border-hairline bg-surface-container-low px-4 py-3">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Departments</p>
                  <p className="mt-1 font-headline text-xl font-bold text-primary">14</p>
                  <p className="text-[11px] text-muted">all departments</p>
                </div>
                <div className="col-span-2 border border-primary bg-primary px-4 py-3 text-white md:col-span-1">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Shortlisted</p>
                  <p className="mt-1 font-headline text-xl font-bold text-white">50 teams</p>
                  <p className="text-[11px] text-white/70">for SIH 2026 journey</p>
                </div>
              </div>
            </div>
          </div>
        </header>
      </div>

      {/* ── Article body ───────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 md:px-8">
        <div className="mx-auto max-w-[72ch]">
          {/* Lead */}
          <div className="mt-8 border-l-4 border-primary bg-white px-5 py-5 md:px-6">
            <p className="font-body text-[15px] leading-relaxed text-on-surface md:text-base">
              <span className="font-semibold text-primary">Thakur College of Engineering and Technology (TCET), Mumbai,</span> successfully conducted its Internal Hackathon for Smart India Hackathon (SIH) 2026, creating a platform for students to work on complex engineering and real-world problem statements and transform their ideas into meaningful technology-driven solutions.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              Held from <span className="font-semibold text-primary">17th to 22nd across all 14 departments</span>, the internal hackathon brought together <span className="font-semibold text-primary">254 student participants</span> who worked in teams to ideate, develop and present their solutions.
            </p>
          </div>

          {/* Stat ribbon */}
          <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { value: "254", label: "Students", sub: "participants" },
              { value: "14", label: "Departments", sub: "all departments" },
              { value: "2", label: "Rounds", sub: "selection process" },
              { value: "50", label: "Teams shortlisted", sub: "for SIH 2026" },
            ].map((stat) => (
              <div key={stat.label} className="border border-hairline bg-white px-4 py-5 text-center">
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{stat.label}</dt>
                <dd className="mt-1 font-headline text-3xl font-bold tabular-nums text-primary md:text-4xl">
                  {stat.value}
                </dd>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{stat.sub}</p>
              </div>
            ))}
          </dl>

          {/* ── Sections ─────────────────────────────── */}
          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              A Completely Digital Hackathon Experience
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-headings:font-headline prose-headings:text-primary prose-strong:text-on-surface">
              <p>
                The entire journey of the internal hackathon was designed and executed digitally through the institute&apos;s portal. From the initial participation and submission process to evaluation, presentations and shortlisting, students experienced a structured, technology-enabled innovation workflow.
              </p>
              <p>
                This digital approach enabled the institute to manage participation across multiple departments while giving students an experience that closely reflected the collaborative and technology-intensive environment of a national-level hackathon.
              </p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              Solving Complex Engineering Problems
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-headings:font-headline prose-headings:text-primary prose-strong:text-on-surface">
              <p>
                At the heart of the hackathon were <strong>challenging and complex problem statements</strong> that required students to move beyond conventional classroom approaches.
              </p>
              <p>
                Teams were encouraged to understand the problem, identify the core challenges, explore possible approaches and build solutions that could address real-world requirements. The emphasis was not simply on arriving at a final answer, but on the <strong>process of innovation — ideation, experimentation, testing, feedback and iteration</strong>.
              </p>
              <p>
                Students were guided throughout this journey by <strong>experienced faculty members and senior professors</strong>, who brought their technical and academic expertise into the mentoring and evaluation process. Their involvement helped teams critically examine their approaches, identify gaps and <strong>iterate on their solutions based on feedback</strong>.
              </p>
              <blockquote className="border-l-4 border-secondary-container bg-surface-container-low px-4 py-3 font-headline text-base italic leading-relaxed text-primary md:px-5">
                “A strong solution is rarely built in one attempt; it evolves through questioning, testing, feedback and continuous improvement.”
              </blockquote>
              <p className="text-sm text-muted">
                This process gave students an important insight into how engineering solutions are developed in practice.
              </p>
            </div>

            {/* Inline gallery — 2 pitch images */}
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <figure className="overflow-hidden border border-hairline bg-white">
                <div className="relative aspect-[4/3] w-full bg-surface-container">
                  <Image
                    src="/sih-2026/sih-2026-pitch-1.jpg"
                    alt="Student team presenting their technical approach on screen during the TCET Internal Hackathon – SIH 2026 evaluation"
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
                <figcaption className="px-4 py-3 text-xs leading-relaxed text-muted">
                  Team presentation in progress. The hackathon tested creativity, technical skills, problem-solving, teamwork and presentation in a competitive, time-bound environment.
                </figcaption>
              </figure>
              <figure className="overflow-hidden border border-hairline bg-white">
                <div className="relative aspect-[4/3] w-full bg-surface-container">
                  <Image
                    src="/sih-2026/sih-2026-pitch-2.jpg"
                    alt="Evaluators and students during panel review at the TCET Internal Hackathon – SIH 2026"
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
                <figcaption className="px-4 py-3 text-xs leading-relaxed text-muted">
                  Students presenting before experienced evaluators — the judging process looked beyond novelty to technical feasibility, approach, implementation and overall quality.
                </figcaption>
              </figure>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              Interdisciplinary Teams, One Common Goal
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-strong:text-on-surface">
              <p>
                Another important aspect of the internal hackathon was the encouragement of <strong>interdisciplinary collaboration</strong>.
              </p>
              <p>
                Students from different areas of engineering brought together diverse technical perspectives to approach the problem statements. Such multidisciplinary teams enabled participants to look at problems from different angles and combine knowledge from different domains while developing their solutions.
              </p>
              <p>
                The experience encouraged students to move beyond departmental boundaries and understand the value of collaboration when solving complex engineering problems — an approach that is increasingly important in today&apos;s technology and innovation ecosystem.
              </p>
            </div>

            {/* Full-width group photo — reuses hero, object-contain so entire image visible */}
            <figure className="mt-6 overflow-hidden border border-hairline bg-white">
              <div className="relative w-full overflow-hidden bg-white">
                <Image
                  src="/sih-2026/sih-2026-hero.jpg"
                  alt="Group photograph of students and faculty members at TCET Internal Hackathon – SIH 2026"
                  width={1600}
                  height={900}
                  sizes="(max-width: 768px) 100vw, 800px"
                  className="h-auto w-full object-contain"
                />
              </div>
              <figcaption className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low px-4 py-3 text-xs leading-relaxed text-muted">
                <span>Participants across 14 departments — collaboration beyond departmental boundaries.</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Interdisciplinary teams</span>
              </figcaption>
            </figure>
          </section>

          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              Encouraging Women in Innovation
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-strong:text-on-surface">
              <p>
                The hackathon also reflected the growing participation of <strong>female students in technology, engineering and innovation-driven activities</strong> at TCET.
              </p>
              <p>
                The participation of women across the teams added to the diversity of perspectives within the hackathon environment. Their involvement demonstrated the importance of creating opportunities where every student can contribute ideas, take technical ownership and participate actively in solving challenging engineering problems.
              </p>
              <p className="font-semibold text-primary">
                The hackathon thus became not only a platform for technological innovation but also a space for inclusive participation, teamwork and confidence-building.
              </p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              Learning from Experienced Evaluators
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-strong:text-on-surface">
              <p>
                A key strength of the internal hackathon was the involvement of <strong>experienced faculty members and senior professors in the evaluation and judging process</strong>.
              </p>
              <p>
                Students had the opportunity to present their solutions before experienced evaluators and receive critical feedback. The judging process looked beyond the novelty of an idea and encouraged teams to think about the technical feasibility, problem-solving approach, implementation and overall quality of their proposed solutions.
              </p>
              <p>
                For the students, this interaction provided valuable exposure to how an engineering idea is assessed from an expert perspective.
              </p>
              <div className="rounded-none border border-hairline bg-white px-4 py-4 md:px-5">
                <p className="font-headline text-base font-bold leading-snug text-primary">
                  Innovation is not only about having an idea; it is about being able to explain, defend, improve and translate that idea into a viable solution.
                </p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Key lesson reinforced through evaluator feedback</p>
              </div>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              Two Rounds, Continuous Improvement
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-strong:text-on-surface">
              <p>
                The internal selection process was conducted through <strong>two rounds of competition</strong>, giving teams an opportunity to progressively strengthen their solutions. The hackathon tested creativity, technical skills, problem-solving abilities, teamwork and presentation skills in a competitive, time-bound environment.
              </p>
              <div className="not-prose mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="border-t-2 border-secondary-container bg-white px-4 py-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Round 1</p>
                  <p className="mt-1 text-sm font-semibold text-primary">Ideate &amp; propose</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">Understand the problem, identify core challenges, explore approaches and present initial solutions.</p>
                </div>
                <div className="border-t-2 border-primary bg-white px-4 py-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Round 2</p>
                  <p className="mt-1 text-sm font-semibold text-primary">Refine &amp; present</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">Incorporate feedback, test, improve implementation and defend the solution before evaluators.</p>
                </div>
                <div className="border-t-2 border-success bg-success-container px-4 py-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-success">Outcome</p>
                  <p className="mt-1 text-sm font-semibold text-primary">50 teams shortlisted</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">Best-performing teams selected to continue the SIH 2026 journey.</p>
                </div>
              </div>
              <p className="mt-5">
                Following rigorous evaluation across both rounds, <strong>50 of the best-performing teams were shortlisted</strong> to take their solutions forward in the SIH 2026 journey.
              </p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-primary md:text-[28px]">
              Building Engineers Who Can Solve, Adapt and Innovate
            </h2>
            <div className="mt-3 h-px bg-hairline" aria-hidden="true" />
            <div className="prose prose-neutral mt-5 max-w-none font-body text-[15px] leading-7 text-on-surface-variant prose-strong:text-on-surface">
              <p>
                The TCET Internal Hackathon – SIH 2026 was much more than an internal competition. It created an environment where students could <strong>work on complex problems, collaborate across disciplines, learn from experienced faculty, receive expert feedback and continuously iterate on their solutions</strong>.
              </p>
              <p>
                As an initiative connected to the <strong>Smart India Hackathon of the Ministry of Education&apos;s Innovation Cell (MIC), Government of India</strong>, the hackathon provided students with an opportunity to engage with societal and industry challenges through innovation and technology.
              </p>
              <p className="font-semibold text-primary">
                With participation from 254 students across 14 departments, a completely digital execution model, interdisciplinary collaboration, strong female participation and guidance from experienced faculty and senior evaluators, the initiative strengthened TCET&apos;s culture of experiential learning, innovation and problem-solving.
              </p>
              <p className="border-l-4 border-primary bg-surface-container-low px-4 py-3 font-headline text-base font-bold leading-relaxed text-primary md:px-5">
                From identifying the problem to building the solution, from receiving feedback to iterating on ideas — the TCET Internal Hackathon gave students a glimpse of what it truly means to engineer for the real world.
              </p>
            </div>
          </section>

          {/* ── Closing + CTAs ───────────────────────── */}
          <div className="mt-10 border border-hairline bg-white p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 bg-secondary-container px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-on-secondary-container">
                Completed · 17th–22nd
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Smart India Hackathon 2026 — Internal round concluded</span>
            </div>
            <h3 className="mt-3 font-headline text-xl font-bold text-primary md:text-2xl">
              Continue the journey
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Fifty teams now advance in the SIH 2026 journey. Explore current hackathons, problem statements and external opportunities to take your own ideas forward.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/hackathons/browse"
                className="inline-flex items-center justify-center bg-primary px-5 py-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-primary-container"
              >
                Browse hackathons
              </Link>
              <Link
                href="/innovation/problems"
                className="inline-flex items-center justify-center border border-primary px-5 py-3 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary hover:text-white"
              >
                Problem statements
              </Link>
              <Link
                href="/hackathons"
                className="inline-flex items-center justify-center border border-hairline bg-surface-container px-5 py-3 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:border-primary"
              >
                Back to Hackathons →
              </Link>
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              Connected to the Smart India Hackathon — Ministry of Education&apos;s Innovation Cell (MIC), Government of India.
            </p>
          </div>

          {/* Share / metadata footer */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <span>TCET Centre of Excellence · News</span>
            <span>Source: Institute portal records · Participation across all 14 departments</span>
          </div>
        </div>
      </div>

      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            headline: "TCET Internal Hackathon – SIH 2026: From Complex Engineering Problems to Innovative Solutions",
            description:
              "TCET Mumbai conducted its Internal Hackathon for Smart India Hackathon 2026 from 17th to 22nd across all 14 departments — 254 students, two rounds, 50 teams shortlisted.",
            image: ["/sih-2026/sih-2026-hero.jpg"],
            datePublished: "2026-08-22",
            dateModified: "2026-08-22",
            author: { "@type": "Organization", name: "Thakur College of Engineering and Technology" },
            publisher: {
              "@type": "Organization",
              name: "TCET Centre of Excellence",
              logo: { "@type": "ImageObject", url: "/coe-logo-v2.jpeg" },
            },
            mainEntityOfPage: { "@type": "WebPage", "@id": "/hackathons/sih-2026" },
          }),
        }}
      />
    </article>
  );
}
