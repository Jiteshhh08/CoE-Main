import prisma from '@/lib/prisma';
import { normalizeContent, sha256 } from './discovery';
import { fetchPublicText } from './fetch-guard';
import { HUB_CITIES, findHubCityInText } from './cities';
import {
  coerceDateRange,
  isSentinel,
  isValidCalendarDate,
  normalizeIsoDate,
  parseNumericDate,
} from './dates';
import type { HubCandidateStatus } from './pipeline';

// Structured extraction (§14). Rule-based first; Qwen AI pass only fills
// fields the rules could not find. Missing stays NULL — never invented (§41.1).
export type ExtractedEvent = {
  eventName: string | null;
  organiser: string | null;
  mode: 'ONLINE' | 'OFFLINE' | 'HYBRID' | null;
  city: string | null;
  state: string | null;
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

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const isoOf = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const DOMAIN_KEYWORDS: Record<string, RegExp> = {
  AI: /\b(ai|artificial intelligence|machine learning|\bml\b|genai|llm)\b/i,
  Cloud: /\bcloud|aws|azure|gcp\b/i,
  Cybersecurity: /\bcyber|security|ethical hacking\b/i,
  IoT: /\biot|internet of things|embedded\b/i,
  Blockchain: /\bblockchain|web3|solidity\b/i,
  Web: /\bweb dev|react|frontend|full.?stack\b/i,
};

// Dates from free text. Written-month and ISO forms are unambiguous; numeric
// d/m/y-vs-m/d/y forms are only accepted when one component proves the order
// (see parseNumericDate). 03/04/2027 stays unknown — a confidently wrong
// date corrupts closing-soon status and event status.
function findDates(text: string): string[] {
  const found: string[] = [];
  const add = (iso: string | null) => {
    if (iso && !found.includes(iso)) found.push(iso);
  };
  const pushWritten = (day: string, monthName: string, year: string) => {
    const month = MONTH_INDEX[monthName.toLowerCase()];
    const d = Number(day);
    const y = Number(year);
    if (month && isValidCalendarDate(y, month, d)) add(isoOf(y, month, d));
  };
  for (const m of text.matchAll(/(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi)) {
    pushWritten(m[1], m[2], m[3]);
  }
  for (const m of text.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/gi)) {
    pushWritten(m[2], m[1], m[3]);
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (isValidCalendarDate(y, mo, d)) add(isoOf(y, mo, d));
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) {
    add(parseNumericDate(m[1], m[2], m[3]));
  }
  return found.slice(0, 6);
}

function textOf(html: string): string {
  return normalizeContent(html);
}

// Structured data first (§13): schema.org JSON-LD Event blocks beat regex
// heuristics. Never invented — absent stays NULL.
type JsonLdEvent = {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  organizer?: { name?: string };
  location?: { address?: { addressLocality?: string; addressRegion?: string } };
  eventAttendanceMode?: string;
  offers?: Array<{ url?: string }>;
};

/**
 * Registration-link resolver. A page's own URL is NOT a registration form —
 * when no genuine link is present the answer is null, never `pageUrl`.
 * Malformed/unsupported-scheme links are rejected, not "repaired".
 */
export function resolveRegistrationUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== 'string' || isSentinel(raw)) return null;
  const value = raw.trim();
  if (!value || value.length > 512) return null;
  try {
    const u = new URL(value, pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

const stripHash = (value: string): string => {
  try {
    const u = new URL(value);
    u.hash = '';
    return u.toString();
  } catch {
    return value;
  }
};

export function extractJsonLdEvent(html: string, pageUrl = ''): Partial<ExtractedEvent> {
  const out: Partial<ExtractedEvent> = {};
  const blocks = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }
    let nodes: unknown[] = [parsed];
    if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
      const graph = (parsed as Record<string, unknown>)['@graph'];
      if (Array.isArray(graph)) nodes = graph;
    } else if (Array.isArray(parsed)) {
      nodes = parsed;
    }
    for (const node of nodes) {
      const ev = node as Partial<JsonLdEvent> & { '@type'?: string };
      if (!ev || ev['@type'] !== 'Event') continue;
      if (typeof ev.name === 'string' && ev.name.trim()) out.eventName = ev.name.trim().slice(0, 200);
      const start = normalizeIsoDate(ev.startDate);
      if (start) out.startDate = start;
      const end = normalizeIsoDate(ev.endDate);
      if (end) out.endDate = end;
      if (ev.organizer && typeof ev.organizer.name === 'string' && ev.organizer.name.trim()) {
        out.organiser = ev.organizer.name.trim().slice(0, 200);
      }
      const addr = ev.location?.address;
      if (addr?.addressLocality) out.city = String(addr.addressLocality).trim().slice(0, 191) || null;
      if (addr?.addressRegion) out.state = String(addr.addressRegion).trim().slice(0, 191) || null;
      if (typeof ev.eventAttendanceMode === 'string') {
        const m = ev.eventAttendanceMode.toLowerCase();
        out.mode = m.includes('online') && m.includes('offline') ? 'HYBRID'
          : m.includes('online') ? 'ONLINE'
          : m.includes('offline') ? 'OFFLINE' : undefined;
      }
      const offer = resolveRegistrationUrl(ev.offers?.[0]?.url, pageUrl);
      if (offer) out.registrationUrl = offer;
      // ponytail: offers[].price is the entry FEE, not the prize pool — never
      // map it to prizePool. Prize pools are absent on most listing sites.
      return out;
    }
  }
  return out;
}

export function extractFromHtml(html: string, pageUrl: string, fallbackTitle?: string | null): ExtractedEvent {
  const text = textOf(html);
  const structured = extractJsonLdEvent(html, pageUrl);
  const pick = <T>(structuredValue: T | undefined, heuristic: T): T =>
    (structuredValue ?? null) !== null && structuredValue !== undefined ? structuredValue as T : heuristic;
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const eventName = (titleMatch?.[1] ?? h1?.[1] ?? fallbackTitle ?? null)
    ?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null;

  // Organiser must be evidence-backed ("hosted by X", JSON-LD organizer).
  // The crawled host is a platform (devfolio.co), never the event's organiser.
  const orgMatch = text.match(/(?:organised|organized|presented|hosted|powered)\s+by\s+([a-z0-9&.,'() ]{3,80})/i);
  const organiser: string | null = orgMatch?.[1]?.trim().replace(/\s+/g, ' ') ?? null;

  // Dates: prefer ones near event-start phrasing — the first date on a page is
  // often a publish date, not the event date.
  const allDates = findDates(text);
  const eventish = text.match(/(?:start|starts|starting|kickoff|from|save the date|event date|happening)[^.]{0,120}?(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  const eventDates = eventish ? findDates(eventish[0]) : [];
  const dates = [...eventDates, ...allDates.filter((d) => !eventDates.includes(d))].slice(0, 6);
  const deadlineMatch = text.match(/(?:regist\w*|application|submission)[^.]{0,80}?(?:deadline|closes?|closing|last date|ends? (?:on|by))[^.]{0,80}?(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  const registrationDeadline = deadlineMatch ? findDates(deadlineMatch[0])[0] ?? null : null;

  const lower = text.toLowerCase();
  const heuristicMode: ExtractedEvent['mode'] = /\bhybrid\b/.test(lower) ? 'HYBRID'
    : /\bonline\b|\bvirtual\b|\bremote\b/.test(lower) ? 'ONLINE'
    : /\bvenue\b|\bcampus\b|\baudit(orium)?\b/.test(lower) ? 'OFFLINE' : null;

  // City: prefer mentions near location keywords (footers name-drop popular
  // cities); fall back to any page mention. Registry comes from cities.ts so
  // "recognisable" and "distance-computable" can never drift apart.
  const cityNearLocation = (city: string): boolean => {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:where|venue|location|city|address)[^.\\n]{0,120}${escaped}|${escaped}[^.\\n]{0,80}(?:venue|location|address)`, 'i');
    return re.test(text);
  };
  const heuristicCity =
    HUB_CITIES.find((c) => cityNearLocation(c.name))?.name ??
    findHubCityInText(text)?.name ??
    null;
  const mode = pick(structured.mode, heuristicMode);
  // Online events have no meaningful city — a heuristic match is footer noise.
  const city = mode === 'ONLINE' && !structured.city ? null : pick(structured.city, heuristicCity);
  const venueMatch = text.match(/venue\s*[:\-]\s*([^.\n]{3,120})/i);
  const venue = (venueMatch?.[1] ?? '').split(/[—|•]/)[0].trim().slice(0, 80) || null;

  const teamMatch = text.match(/team.{0,30}?(\d)\s*(?:[-–]|to)\s*(\d)|(?:min\w*.?(\d)|max\w*.?(\d))/i);
  let teamMin = teamMatch?.[1] ? Number(teamMatch[1]) : teamMatch?.[3] ? Number(teamMatch[3]) : null;
  let teamMax = teamMatch?.[2] ? Number(teamMatch[2]) : teamMatch?.[4] ? Number(teamMatch[4]) : null;
  // Never invent: a range reading min>max is a misparse, not data.
  if (teamMin !== null && teamMax !== null && teamMin > teamMax) {
    teamMin = null;
    teamMax = null;
  }

  // Prize needs an actual amount — a bare currency symbol is noise, not data.
  const prizeMatch = text.match(/(?:prize|prizes|prize pool|worth|₹|inr|rs\.?)\s*[:\-]?\s*([₹$]?\s?[\d,]+(?:\.\d+)?\s*(?:lakh|lac|l|k|thousand|crore|inr|₹|\$)?)/i);
  const prizeRaw = prizeMatch?.[0]?.trim() ?? '';
  const prizePool = /\d/.test(prizeRaw) ? prizeRaw.slice(0, 120) : null;

  const domains = Object.entries(DOMAIN_KEYWORDS).filter(([, re]) => re.test(text)).map(([k]) => k);

  // Eligibility only counts when it has a structured delimiter — otherwise the
  // match is usually nav copy or JS text, not a rule.
  const eligMatch = text.match(/eligib\w*[^.\n:]{0,10}[:\-–]\s*([^.\n]{10,250})/i);
  const eligibility = (eligMatch?.[1] ?? '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 191) || null;

  // Registration link: genuine anchor evidence only. When the page has none,
  // registrationUrl stays null — the listing page is not a signup form.
  const regLink = html.match(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]{0,80}?(?:register|apply now|sign up)[\s\S]{0,40}?)<\/a>/i);
  const registrationUrl = regLink ? resolveRegistrationUrl(regLink[1], pageUrl) : null;

  // Start/end: an end date exists only when it was stated or a genuinely
  // later date was found. A single date is not a single-day event.
  const startDate = structured.startDate ?? dates[0] ?? null;
  const inferredEnd = startDate ? dates.find((d) => d > startDate) ?? null : null;
  const { startDate: safeStart, endDate: safeEnd } = coerceDateRange(startDate, structured.endDate ?? inferredEnd);

  return {
    eventName: pick(structured.eventName, eventName),
    organiser: pick(structured.organiser, organiser),
    mode,
    city,
    state: structured.state ?? null,
    venue,
    startDate: safeStart,
    endDate: safeEnd,
    registrationDeadline,
    registrationUrl: pick(structured.registrationUrl, registrationUrl),
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

const AI_TEXT_FIELDS = ['eventName', 'organiser', 'city', 'venue', 'state', 'prizePool', 'eligibility'] as const;
const AI_DATE_FIELDS = ['startDate', 'endDate', 'registrationDeadline'] as const;

/** Trim a model-provided string; sentinels/empties are "no value", not data. */
function aiText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string' || isSentinel(value)) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

async function aiFill(html: string, current: ExtractedEvent, pageUrl: string): Promise<ExtractedEvent> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  // No hardcoded gateway: URL + model come from env like grants-automation.
  // Unlike grants (which fails loudly), Hub degrades to rules-only extraction
  // when AI is unconfigured — extraction must keep working without a key.
  const gatewayUrl = (process.env.AI_GATEWAY_URL || '').trim();
  const gatewayModel = (process.env.AI_GATEWAY_MODEL || '').trim();
  if (!apiKey || !gatewayUrl || !gatewayModel) {
    console.warn('[hub] AI fill-in skipped (missing QWEN_API_KEY / AI_GATEWAY_URL / AI_GATEWAY_MODEL) — rules-only extraction');
    return current;
  }
  const missing = mandatoryMissing(current);
  if (missing.length === 0) return current;
  const snippet = normalizeContent(html).slice(0, 6000);
  try {
    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: gatewayModel,
        messages: [{
          role: 'user',
          content: `Extract hackathon fields from the page text below. Return ONLY JSON with keys: eventName, organiser, mode (ONLINE|OFFLINE|HYBRID|null), city, venue, startDate (YYYY-MM-DD|null), endDate, registrationDeadline, registrationUrl, teamMin (int|null), teamMax, prizePool, eligibility. Only fill these missing fields: ${missing.join(', ')}. NEVER invent: use null when absent.\n\nPAGE:\n${snippet}`,
        }],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) return current;
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const cleaned = text.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    const ai: unknown = JSON.parse(cleaned);
    if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return current;
    const fields = ai as Record<string, unknown>;
    const merged: ExtractedEvent = { ...current };
    const set = (key: keyof ExtractedEvent, value: unknown) => {
      (merged as unknown as Record<string, unknown>)[key] = value;
    };
    const page = stripHash(pageUrl);

    // Only fill keys that were missing, and only with type-valid, non-sentinel
    // values. Invalid model output must never overwrite rule/JSON-LD evidence.
    for (const key of missing) {
      const v = fields[key];
      if (key === 'registrationUrl') {
        const url = resolveRegistrationUrl(v, pageUrl);
        // A model echoing the listing URL as the signup URL is the old
        // fabrication bug wearing a new hat.
        if (url && stripHash(url) !== page) set('registrationUrl', url);
        continue;
      }
      if ((AI_DATE_FIELDS as readonly string[]).includes(key)) {
        const iso = normalizeIsoDate(v);
        if (iso) set(key as keyof ExtractedEvent, iso);
        continue;
      }
      if (key === 'mode') {
        const mode = typeof v === 'string' ? v.trim().toUpperCase() : '';
        if (mode === 'ONLINE' || mode === 'OFFLINE' || mode === 'HYBRID') set('mode', mode);
        continue;
      }
      if (key === 'teamMin' || key === 'teamMax') {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 20) set(key as 'teamMin' | 'teamMax', n);
        continue;
      }
      if ((AI_TEXT_FIELDS as readonly string[]).includes(key)) {
        const textValue = aiText(v, key === 'eventName' || key === 'organiser' ? 200 : 191);
        if (textValue) set(key as keyof ExtractedEvent, textValue);
      }
    }
    return merged;
  } catch {
    return current;
  }
}

async function fetchPage(url: string): Promise<string> {
  // SSRF-guarded (DNS allowlist + landing re-check in fetch-guard).
  const { status, text } = await fetchPublicText(url, { timeoutMs: 15000, contentTypes: ['html', 'text'] });
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  return text;
}

export type ExtractionResult = { processed: number; verified: number; needsReview: number; errors: string[] };

export async function runExtraction(limit = 10): Promise<ExtractionResult> {
  const result: ExtractionResult = { processed: 0, verified: 0, needsReview: 0, errors: [] };
  const candidates = await prisma.hubCandidate.findMany({
    where: { status: { in: ['DISCOVERED', 'PROCESSING'] } },
    orderBy: { discoveredAt: 'asc' },
    take: limit,
  });

  for (const candidate of candidates) {
    try {
      await prisma.hubCandidate.update({ where: { id: candidate.id }, data: { status: 'PROCESSING', error: null } });
      const html = await fetchPage(candidate.url);
      let extracted = extractFromHtml(html, candidate.url, candidate.title);
      extracted = await aiFill(html, extracted, candidate.url);
      const confidence = scoreConfidence(extracted, candidate.sourceType);
      const missing = mandatoryMissing(extracted);
      const pageHash = sha256(normalizeContent(html));
      // Auto-validate (§19): complete + confident → VERIFIED, else NEEDS_REVIEW.
      const status: HubCandidateStatus =
        missing.length === 0 && confidence >= 0.9 ? 'VERIFIED' : 'NEEDS_REVIEW';
      await prisma.hubCandidate.update({
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
      await prisma.hubCandidate.update({
        where: { id: candidate.id },
        data: { status: 'NEEDS_REVIEW', error: msg.slice(0, 1900) },
      });
      result.needsReview++;
    }
  }
  return result;
}
