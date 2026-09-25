import prisma from '@/lib/prisma';
import { normalizeContent, sha256 } from './discovery';

// Structured extraction (§14). Rule-based first; Qwen AI pass only fills
// fields the rules could not find. Missing stays NULL — never invented (§41.1).
export type ExtractedEvent = {
  eventName: string | null;
  organiser: string | null;
  mode: 'ONLINE' | 'OFFLINE' | 'HYBRID' | null;
  city: string | null;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
  registrationDeadline: string | null;
  registrationUrl: string | null;
  teamMin: number | null;
  teamMax: number | null;
  prizePool: string | null;
  domains: string[];
  eligibility: string | null;
};

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

const KNOWN_CITIES = [
  'Mumbai', 'Navi Mumbai', 'Thane', 'Pune', 'Nagpur', 'Nashik',
  'Chhatrapati Sambhajinagar', 'Kolhapur', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai',
];

const DOMAIN_KEYWORDS: Record<string, RegExp> = {
  AI: /\b(ai|artificial intelligence|machine learning|\bml\b|genai|llm)\b/i,
  Cloud: /\bcloud|aws|azure|gcp\b/i,
  Cybersecurity: /\bcyber|security|ethical hacking\b/i,
  IoT: /\biot|internet of things|embedded\b/i,
  Blockchain: /\bblockchain|web3|solidity\b/i,
  Web: /\bweb dev|react|frontend|full.?stack\b/i,
};

function findDates(text: string): string[] {
  const found: string[] = [];
  const push = (y: string, m: string, d: string) => {
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(iso)) && !found.includes(iso)) found.push(iso);
  };
  for (const m of text.matchAll(/(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi)) {
    push(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  }
  for (const m of text.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/gi)) {
    push(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  }
  for (const m of text.matchAll(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/g)) {
    push(m[3], m[2], m[1]);
  }
  return found.slice(0, 6);
}

function textOf(html: string): string {
  return normalizeContent(html);
}

export function extractFromHtml(html: string, pageUrl: string, fallbackTitle?: string | null): ExtractedEvent {
  const text = textOf(html);
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const eventName = (titleMatch?.[1] ?? h1?.[1] ?? fallbackTitle ?? null)
    ?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null;

  const orgMatch = text.match(/(?:organised|organized|presented|hosted|powered)\s+by\s+([a-z0-9&.,'() ]{3,80})/i);
  let organiser: string | null = orgMatch?.[1]?.trim().replace(/\s+/g, ' ') ?? null;
  if (!organiser) {
    try { organiser = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { organiser = null; }
  }

  const dates = findDates(text);
  const deadlineMatch = text.match(/(?:regist\w*|application|submission)[^.]{0,80}?(?:deadline|closes?|closing|last date|ends? (?:on|by))[^.]{0,80}?(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  const registrationDeadline = deadlineMatch ? findDates(deadlineMatch[0])[0] ?? null : null;

  const lower = text.toLowerCase();
  const mode: ExtractedEvent['mode'] = /\bhybrid\b/.test(lower) ? 'HYBRID'
    : /\bonline\b|\bvirtual\b|\bremote\b/.test(lower) ? 'ONLINE'
    : /\bvenue\b|\bcampus\b|\baudit(orium)?\b/.test(lower) ? 'OFFLINE' : null;

  const city = KNOWN_CITIES.find((c) => lower.includes(c.toLowerCase())) ?? null;
  const venueMatch = text.match(/venue\s*[:\-]\s*([^.\n]{3,120})/i);
  const venue = venueMatch?.[1]?.trim() ?? null;

  const teamMatch = text.match(/team.{0,30}?(\d)\s*(?:[-–]|to)\s*(\d)|(?:min\w*.?(\d)|max\w*.?(\d))/i);
  const teamMin = teamMatch?.[1] ? Number(teamMatch[1]) : teamMatch?.[3] ? Number(teamMatch[3]) : null;
  const teamMax = teamMatch?.[2] ? Number(teamMatch[2]) : teamMatch?.[4] ? Number(teamMatch[4]) : null;

  const prizeMatch = text.match(/(?:prize|prizes|prize pool|worth|₹|inr|rs\.?)\s*[:\-]?\s*([₹$]?\s?[\d,]+(?:\.\d+)?\s*(?:lakh|lac|l|k|thousand|crore|inr|₹|\$)?)/i);
  const prizePool = prizeMatch?.[0]?.trim().slice(0, 120) ?? null;

  const domains = Object.entries(DOMAIN_KEYWORDS).filter(([, re]) => re.test(text)).map(([k]) => k);

  const eligMatch = text.match(/eligib\w*[^.\n]{0,200}/i);
  const eligibility = eligMatch?.[0]?.trim().slice(0, 300) ?? null;

  let registrationUrl: string | null = null;
  const regLink = html.match(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]{0,80}?(?:register|apply now|sign up)[\s\S]{0,40}?)<\/a>/i);
  if (regLink) {
    try { registrationUrl = new URL(regLink[1], pageUrl).toString().split('#')[0]; } catch { registrationUrl = pageUrl; }
  } else {
    registrationUrl = pageUrl;
  }

  return {
    eventName, organiser, mode, city, venue,
    startDate: dates[0] ?? null,
    endDate: dates[1] ?? dates[0] ?? null,
    registrationDeadline,
    registrationUrl,
    teamMin: teamMin && teamMin >= 1 && teamMin <= 20 ? teamMin : null,
    teamMax: teamMax && teamMax >= 1 && teamMax <= 20 ? teamMax : null,
    prizePool, domains, eligibility,
  };
}

// Confidence (§15): rule-based only, capped by evidence. Missing stays low.
export function scoreConfidence(e: ExtractedEvent, sourceType: string): number {
  let score = 0.4;
  const mandatory = [e.eventName, e.organiser, e.startDate, e.registrationDeadline, e.registrationUrl, e.mode];
  score += mandatory.filter(Boolean).length * 0.05;
  if (['OFFICIAL_WEBSITE', 'GOVERNMENT', 'ADMIN'].includes(sourceType)) score += 0.2;
  else if (['DEVFOLIO', 'UNSTOP', 'HACKEREARTH', 'HACK2SKILL', 'MLH', 'COLLEGE_WEBSITE'].includes(sourceType)) score += 0.1;
  if (e.city) score += 0.03;
  if (e.prizePool) score += 0.02;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

export function mandatoryMissing(e: ExtractedEvent): string[] {
  const missing: string[] = [];
  if (!e.eventName) missing.push('eventName');
  if (!e.organiser) missing.push('organiser');
  if (!e.startDate) missing.push('startDate');
  if (!e.registrationDeadline) missing.push('registrationDeadline');
  if (!e.registrationUrl) missing.push('registrationUrl');
  if (!e.mode) missing.push('mode');
  return missing;
}

async function aiFill(html: string, current: ExtractedEvent): Promise<ExtractedEvent> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  if (!apiKey) return current;
  const missing = mandatoryMissing(current);
  if (missing.length === 0) return current;
  const snippet = normalizeContent(html).slice(0, 6000);
  try {
    const res = await fetch('https://ai.tcetcercd.in/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'qwen3.6',
        messages: [{
          role: 'user',
          content: `Extract hackathon fields from the page text below. Return ONLY JSON with keys: eventName, organiser, mode (ONLINE|OFFLINE|HYBRID|null), city, venue, startDate (YYYY-MM-DD|null), endDate, registrationDeadline, teamMin (int|null), teamMax, prizePool, eligibility. Only fill these missing fields: ${missing.join(', ')}. NEVER invent: use null when absent.\n\nPAGE:\n${snippet}`,
        }],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) return current;
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const cleaned = text.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    const ai = JSON.parse(cleaned);
    const merged = { ...current };
    for (const key of missing) {
      const v = (ai as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.trim()) (merged as Record<string, unknown>)[key] = v.trim().slice(0, 200);
      if (typeof v === 'number' && (key === 'teamMin' || key === 'teamMax') && v >= 1 && v <= 20) {
        (merged as Record<string, unknown>)[key] = v;
      }
      if (key === 'mode' && ['ONLINE', 'OFFLINE', 'HYBRID'].includes(String(v))) {
        (merged as Record<string, unknown>)[key] = v;
      }
    }
    return merged;
  } catch {
    return current;
  }
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TCET-CoE-HubBot/1.0', Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.text()).slice(0, 1_500_000);
  } finally {
    clearTimeout(timer);
  }
}

export type ExtractionResult = { processed: number; verified: number; needsReview: number; errors: string[] };

export async function runExtraction(limit = 10): Promise<ExtractionResult> {
  const result: ExtractionResult = { processed: 0, verified: 0, needsReview: 0, errors: [] };
  const candidates = await (prisma as any).hubCandidate.findMany({
    where: { status: { in: ['DISCOVERED', 'PROCESSING'] } },
    orderBy: { discoveredAt: 'asc' },
    take: limit,
  });

  for (const candidate of candidates) {
    try {
      await (prisma as any).hubCandidate.update({ where: { id: candidate.id }, data: { status: 'PROCESSING', error: null } });
      const html = await fetchPage(candidate.url);
      let extracted = extractFromHtml(html, candidate.url, candidate.title);
      extracted = await aiFill(html, extracted);
      const confidence = scoreConfidence(extracted, candidate.sourceType);
      const missing = mandatoryMissing(extracted);
      const pageHash = sha256(normalizeContent(html));
      // Auto-validate (§19): complete + confident → VERIFIED, else NEEDS_REVIEW.
      const status = missing.length === 0 && confidence >= 0.9 ? 'VERIFIED' : 'NEEDS_REVIEW';
      await (prisma as any).hubCandidate.update({
        where: { id: candidate.id },
        data: {
          status,
          title: extracted.eventName ?? candidate.title,
          extracted: { ...extracted, missing },
          confidence,
          pageHash,
          error: missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
        },
      });
      result.processed++;
      if (status === 'VERIFIED') result.verified++;
      else result.needsReview++;
    } catch (err) {
      const msg = `Candidate ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      await (prisma as any).hubCandidate.update({
        where: { id: candidate.id },
        data: { status: 'NEEDS_REVIEW', error: msg.slice(0, 1900) },
      });
      result.needsReview++;
    }
  }
  return result;
}
