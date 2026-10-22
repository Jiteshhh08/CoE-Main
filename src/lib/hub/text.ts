/**
 * Text normalisation shared by the Hub's fetch paths.
 *
 * Structured APIs hand back HTML fragments in places you would not expect —
 * Devpost embeds the prize as `"$<span data-currency-value>138,000</span>"` and
 * Unstop returns a `details` blob of markup — so every string that reaches the
 * database goes through here first.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const key = code.toLowerCase();
    try {
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    } catch {
      return match;
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

/** Strip tags + entities and collapse whitespace. Never returns markup. */
export function stripHtml(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  return decodeEntities(input)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse whitespace and drop a value that is only punctuation/whitespace. */
export function tidy(input: string | null | undefined, max = 400): string | null {
  const value = stripHtml(input);
  if (!value) return null;
  if (!/[\p{L}\p{N}]/u.test(value)) return null;
  return value.slice(0, max);
}
