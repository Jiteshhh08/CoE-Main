/**
 * Confidence scoring and the auto-verify gate.
 *
 * Deliberately a leaf module: both the page extractor and the structured-API
 * discovery stage need to score an event, and having discovery import the
 * extractor (which already imports discovery) would create an import cycle that
 * only shows up as a runtime initialisation error in a production bundle.
 */
import type { ExtractedEvent } from './extract';

// Auto-validation threshold: a candidate needs every mandatory field AND this
// score to skip human review.
export const HUB_VERIFY_THRESHOLD = 0.9;

// Sources we trust enough to auto-verify.
export const TRUSTED_SOURCES = ['OFFICIAL_WEBSITE', 'GOVERNMENT', 'ADMIN'];

// Known hackathon aggregators: real events, but third-party listings.
// INDIAHACKATHONS was absent from every tier, which capped it at 0.75 —
// structurally below HUB_VERIFY_THRESHOLD, so 96 of the 111 candidates in a
// live run could never verify no matter how good the extraction was.
export const AGGREGATOR_SOURCES = [
  'DEVFOLIO',
  'UNSTOP',
  'HACKEREARTH',
  'HACK2SKILL',
  'MLH',
  'COLLEGE_WEBSITE',
  'INDIAHACKATHONS',
  'DEVPOST',
];

export function scoreConfidence(e: ExtractedEvent, sourceType: string): number {
  let score = 0.4;
  const mandatory = [e.eventName, e.organiser, e.startDate, e.registrationDeadline, e.registrationUrl, e.mode];
  score += mandatory.filter(Boolean).length * 0.05; // all six -> 0.70
  if (TRUSTED_SOURCES.includes(sourceType)) score += 0.2; // -> 0.90
  else if (AGGREGATOR_SOURCES.includes(sourceType)) score += 0.15; // -> 0.85
  // A city is meaningless for an online event, so its absence must not cap the
  // score — otherwise every ONLINE aggregator event plateaus at 0.87 and can
  // never auto-verify no matter how complete the extraction is.
  if (e.city || e.mode === 'ONLINE') score += 0.03;
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

/**
 * The real gate: a complete extraction that also clears the threshold.
 * Mirrors runExtraction so both paths agree on what "verified" means.
 */
export function wouldAutoVerify(e: ExtractedEvent, sourceType: string): boolean {
  return mandatoryMissing(e).length === 0 && scoreConfidence(e, sourceType) >= HUB_VERIFY_THRESHOLD;
}
