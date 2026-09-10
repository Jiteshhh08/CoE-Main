import prisma from "@/lib/prisma";
import { TRUSTED_SOURCES } from "./sources";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

type RawGrant = {
  title: string;
  issuingBody: string;
  category: string;
  description: string;
  deadline: string | null;
  referenceLink: string | null;
  funding: string | null;
};

type AutomationResult = {
  month: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  grantsFound: number;
  grantsPublished: number;
  duplicatesSkipped: number;
  errors: string[];
};

function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function buildPrompt(currentMonth: string): string {
  const sourceList = TRUSTED_SOURCES.map(
    (s) => `- ${s.name} (${s.abbreviation}) — ${s.url}`
  ).join("\n");

  return `You are a grant research assistant for an Indian academic Centre of Excellence focused on engineering and technology.

Today's date: ${new Date().toISOString().slice(0, 10)}. The target month is ${currentMonth}.

Generate a JSON array of 10-15 REAL, currently active grant/scholarship/funding opportunities in India relevant to engineering students, researchers, and faculty.

TRUSTED SOURCES TO PRIORITIZE:
${sourceList}

STRICT RULES:
1. ONLY include grants you are confident are REAL from your training data
2. Use REAL organization names matching the trusted sources above
3. Use REAL official URLs from the trusted sources list
4. If you are NOT certain a grant exists, DO NOT include it
5. Do NOT invent funding amounts — use null if unsure
6. Do NOT invent deadlines — use null if unsure
7. Do NOT invent eligibility criteria — use null if unsure
8. Use realistic deadlines only for grants you are certain about
9. Each grant must have a valid referenceLink pointing to the official source page

CATEGORIES (use exactly one):
- GOVT_GRANT: Government funding programs
- SCHOLARSHIP: Student scholarships and fellowships
- RESEARCH_FUND: Research project funding
- INDUSTRY_GRANT: Industry-sponsored grants

OUTPUT: Return ONLY a valid JSON array. No markdown fences, no explanation, no text before or after.

Each object must have exactly these fields:
{
  "title": "string — grant/program name",
  "issuingBody": "string — organization name from trusted sources",
  "category": "string — one of the 4 categories above",
  "description": "string — 2-3 sentence summary grounded in reality",
  "deadline": "string YYYY-MM-DD or null",
  "referenceLink": "string URL or null",
  "funding": "string amount or null"
}`;
}

function parseClaudeResponse(text: string): RawGrant[] {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Response is not an array");
  return parsed;
}

function validateGrant(raw: RawGrant, index: number): string[] {
  const errors: string[] = [];
  if (!raw.title || raw.title.length < 3)
    errors.push(`Grant ${index}: title too short`);
  if (!raw.issuingBody || raw.issuingBody.length < 2)
    errors.push(`Grant ${index}: issuingBody missing`);
  if (
    !["GOVT_GRANT", "SCHOLARSHIP", "RESEARCH_FUND", "INDUSTRY_GRANT"].includes(
      raw.category
    )
  )
    errors.push(`Grant ${index}: invalid category "${raw.category}"`);
  if (!raw.description || raw.description.length < 10)
    errors.push(`Grant ${index}: description too short`);
  if (raw.deadline && isNaN(Date.parse(raw.deadline)))
    errors.push(`Grant ${index}: invalid deadline "${raw.deadline}"`);
  return errors;
}

function normalizeCategory(
  raw: string
): "GOVT_GRANT" | "SCHOLARSHIP" | "RESEARCH_FUND" | "INDUSTRY_GRANT" {
  const upper = raw.toUpperCase().replace(/\s+/g, "_");
  if (
    ["GOVT_GRANT", "SCHOLARSHIP", "RESEARCH_FUND", "INDUSTRY_GRANT"].includes(
      upper
    )
  )
    return upper as "GOVT_GRANT" | "SCHOLARSHIP" | "RESEARCH_FUND" | "INDUSTRY_GRANT";
  return "GOVT_GRANT";
}

export async function collectMonthlyGrants(): Promise<AutomationResult> {
  const month = getCurrentMonth();
  const errors: string[] = [];
  let grantsFound = 0;
  let grantsPublished = 0;
  let duplicatesSkipped = 0;

  // Idempotency: check if we already ran this month
  const existingRun = await prisma.automationRun.findFirst({
    where: { month, status: { not: "FAILED" } },
  });
  if (existingRun) {
    return {
      month,
      status: "SUCCESS",
      grantsFound: existingRun.grantsFound,
      grantsPublished: existingRun.grantsPublished,
      duplicatesSkipped: existingRun.duplicatesSkipped,
      errors: ["Already ran for this month — skipping."],
    };
  }

  const run = await prisma.automationRun.create({
    data: { month, status: "PARTIAL" },
  });

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const prompt = buildPrompt(month);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error("Empty response from Claude API");

    const rawGrants = parseClaudeResponse(text);
    grantsFound = rawGrants.length;

    // Validate
    const validGrants: RawGrant[] = [];
    for (let i = 0; i < rawGrants.length; i++) {
      const grantErrors = validateGrant(rawGrants[i], i);
      if (grantErrors.length > 0) {
        errors.push(...grantErrors);
      } else {
        validGrants.push(rawGrants[i]);
      }
    }

    // Deduplicate against existing grants for this month
    for (const grant of validGrants) {
      const duplicate = await prisma.grant.findFirst({
        where: {
          month,
          title: { contains: grant.title },
          issuingBody: { contains: grant.issuingBody },
        },
      });

      if (duplicate) {
        duplicatesSkipped++;
        continue;
      }

      // Also check by referenceLink if both are non-null
      if (grant.referenceLink) {
        const linkDuplicate = await prisma.grant.findFirst({
          where: {
            month,
            referenceLink: grant.referenceLink,
          },
        });
        if (linkDuplicate) {
          duplicatesSkipped++;
          continue;
        }
      }

      await prisma.grant.create({
        data: {
          title: grant.title,
          issuingBody: grant.issuingBody,
          category: normalizeCategory(grant.category),
          description: grant.description,
          deadline: grant.deadline ? new Date(grant.deadline) : new Date(),
          referenceLink: grant.referenceLink || null,
          source: "AUTO",
          month,
          postedById: null,
          isActive: true,
        },
      });
      grantsPublished++;
    }

    const status = errors.length > 0 ? "PARTIAL" : "SUCCESS";

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status,
        grantsFound,
        grantsPublished,
        duplicatesSkipped,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return {
      month,
      status,
      grantsFound,
      grantsPublished,
      duplicatesSkipped,
      errors,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errors.push(errorMsg);

    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        grantsFound,
        grantsPublished,
        duplicatesSkipped,
        errors: JSON.stringify(errors),
        completedAt: new Date(),
      },
    });

    return {
      month,
      status: "FAILED",
      grantsFound,
      grantsPublished,
      duplicatesSkipped,
      errors,
    };
  }
}
