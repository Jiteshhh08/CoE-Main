import prisma from '@/lib/prisma';
import { opportunityCreateSchema } from '@/lib/validators';
import { normalizeName, cleanEventTitle, clipDbString, fitUrl } from '@/lib/hackathon-hub';
import { toDbDate } from './dates';
import { isCuratedVerification, isPlaceholderDescription } from './pipeline';
import { fetchPublicText } from './fetch-guard';

// Google Sheet as lightweight CMS (§24): admins paste a Sheet CSV-export URL
// or upload a CSV file. One row = one hackathon. Never blindly overwrites
// higher-priority verified rows (§31).

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;
  const push = () => { row.push(current); current = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') push();
    else if (ch === '\n') { push(); rows.push(row); row = []; }
    else if (ch === '\r') { /* skip */ }
    else current += ch;
  }
  push();
  if (row.length > 1 || row[0] !== '') rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
}

const HEADER_ALIASES: Record<string, string> = {
  eventname: 'title', title: 'title', name: 'title',
  organiser: 'organizer', organizer: 'organizer',
  owner: 'organizer',
  registrationdeadline: 'registrationDeadline', deadline: 'registrationDeadline',
  registrationurl: 'applicationUrl', applicationurl: 'applicationUrl', applylink: 'applicationUrl',
  officialurl: 'sourceUrl', sourceurl: 'sourceUrl',
  prizepool: 'prize', prize: 'prize',
  startdate: 'startDate', enddate: 'endDate',
  teammin: 'teamMin', teammax: 'teamMax',
  city: 'city', state: 'state', venue: 'venue', mode: 'mode',
  eligibility: 'eligibility', description: 'description', category: 'category',
  themes: 'themes', domains: 'themes', technologies: 'technologies',
  sourcetype: 'sourceType', eventtype: 'category',
};

function normalizeRow(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value) continue;
    const field = HEADER_ALIASES[key] ?? key;
    if (['themes', 'technologies'].includes(field)) {
      out[field] = value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    } else if (['teamMin', 'teamMax'].includes(field)) {
      const n = Number(value);
      if (Number.isInteger(n)) out[field] = n;
    } else {
      out[field] = value;
    }
  }
  if (!out.category) out.category = 'Hackathon';
  if (!out.sourceType) out.sourceType = 'GOOGLE_SHEET';
  return out;
}

export type HubImportResult = {
  total: number;
  inserted: number;
  updated: number;
  rejected: number;
  conflicts: number;
  published: number;
  errors: string[];
};

export async function runCsvImport(
  csvText: string,
  opts: { actorId: number; actorRole: string; origin: 'CSV' | 'SHEET_URL' },
): Promise<HubImportResult> {
  const result: HubImportResult = { total: 0, inserted: 0, updated: 0, rejected: 0, conflicts: 0, published: 0, errors: [] };
  const rows = parseCsv(csvText);
  result.total = rows.length;
  const autoApprove = opts.actorRole === 'ADMIN';

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    try {
      const parsed = opportunityCreateSchema.safeParse(normalizeRow(rows[i]));
      if (!parsed.success) {
        result.rejected++;
        result.errors.push(`Row ${rowNo}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
        continue;
      }
      const data = parsed.data;

      // Duplicate detection (§16): source URL first, then normalized name+organizer+start.
      let existing: { id: number; verificationStatus: string; sourceType: string; description: string | null } | null = null;
      if (data.sourceUrl) {
        existing = await prisma.opportunity.findFirst({ where: { sourceUrl: data.sourceUrl } });
      }
      if (!existing) {
        const rivals = await prisma.opportunity.findMany({
          where: { organizer: data.organizer },
          select: { id: true, title: true, verificationStatus: true, sourceType: true, description: true, startDate: true },
          take: 50,
        });
        const needle = normalizeName(cleanEventTitle(data.title));
        existing = rivals.find((r) => normalizeName(cleanEventTitle(r.title)) === needle) ?? null;
      }

      const record = {
        title: clipDbString(data.title) as string,
        category: clipDbString(data.category) as string,
        organizer: clipDbString(data.organizer) as string,
        description: data.description || null,
        // Persistence boundary: invalid/sentinel dates become NULL rather
        // than an Invalid Date that Prisma would throw on.
        registrationDeadline: toDbDate(data.registrationDeadline),
        eligibility: clipDbString(data.eligibility),
        prize: clipDbString(data.prize),
        themes: data.themes?.length ? data.themes : undefined,
        technologies: data.technologies?.length ? data.technologies : undefined,
        applicationUrl: fitUrl(data.applicationUrl),
        facultyRecommended: data.facultyRecommended ?? false,
        mode: (data as { mode?: string }).mode || null,
        venue: clipDbString((data as { venue?: string }).venue),
        city: clipDbString((data as { city?: string }).city),
        state: clipDbString((data as { state?: string }).state),
        startDate: toDbDate((data as { startDate?: string }).startDate),
        endDate: toDbDate((data as { endDate?: string }).endDate),
        teamMin: (data as { teamMin?: number }).teamMin ?? null,
        teamMax: (data as { teamMax?: number }).teamMax ?? null,
        sourceUrl: (data.sourceUrl || null) as string | null,
        sourceType: data.sourceType ?? 'GOOGLE_SHEET',
      };

      if (!existing) {
        await prisma.opportunity.create({
          data: {
            ...record,
            status: autoApprove ? 'APPROVED' : 'PENDING',
            verificationStatus: autoApprove ? 'ADMIN_VERIFIED' : 'UNVERIFIED',
            lastVerifiedAt: autoApprove ? new Date() : null,
            // Hub-curated feed: always Hub-visible; category hint as fallback.
            showInHub: true,
            createdById: opts.actorId,
          },
        });
        result.inserted++;
        if (autoApprove) result.published++;
      } else {
        // Conflict guard (§31), same policy as pipeline publication: a curated
        // row is never overwritten by lower-confidence import data.
        if (isCuratedVerification(existing.verificationStatus)) {
          result.rejected++;
          result.conflicts++;
          result.errors.push(`Row ${rowNo}: conflicts with curated record #${existing.id} (${existing.verificationStatus}) — flagged, not overwritten`);
          continue;
        }
        // Null-safe merge: blank cells must not erase data the sheet omitted.
        const update: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
          if (value !== null && value !== undefined) update[key] = value;
        }
        if (isPlaceholderDescription(record.description) && existing.description && !isPlaceholderDescription(existing.description)) {
          update.description = existing.description;
        }
        await prisma.opportunity.update({ where: { id: existing.id }, data: update });
        result.updated++;
      }
    } catch (err) {
      result.rejected++;
      result.errors.push(`Row ${rowNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await prisma.hubImportLog.create({
    data: {
      source: opts.origin,
      discovered: result.total,
      inserted: result.inserted,
      updated: result.updated,
      rejected: result.rejected,
      published: result.published,
      errors: result.errors.length > 0 ? result.errors.slice(0, 50) : undefined,
    },
  });

  return result;
}

export async function fetchSheetCsv(sheetUrl: string): Promise<string> {
  // SSRF-guarded: admin-supplied URL is DNS-checked before fetch.
  const { status, text } = await fetchPublicText(sheetUrl, {
    timeoutMs: 20000,
    accept: 'text/csv,text/plain',
    contentTypes: ['csv', 'text', 'octet-stream'],
  });
  if (status < 200 || status >= 300) throw new Error(`Sheet fetch failed: HTTP ${status}`);
  if (!text.includes(',')) throw new Error('Sheet did not return CSV — use File → Share → Publish to web (CSV).');
  return text;
}
