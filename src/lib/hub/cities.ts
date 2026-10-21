/**
 * Authoritative Hub city registry.
 *
 * ONE list drives both extraction (which cities a page may be recognised as)
 * and distance display (which cities have coordinates). They used to be two
 * independent lists and drifted: cities with coordinates could never be
 * extracted. Never add a city here without verified coordinates — an
 * uncoordinated name is worse than an unknown city, because it manufactures
 * a "N km from TCET" claim we cannot back.
 *
 * Coordinates are city-centre approximations, adequate for a display-only
 * Haversine distance (not routing).
 */

export type HubCity = {
  /** Canonical display name (also the value persisted on Opportunity.city). */
  name: string;
  /** Lowercase alternate spellings that must resolve to this city. */
  aliases: readonly string[];
  lat: number;
  lon: number;
};

export const HUB_CITIES: readonly HubCity[] = [
  { name: 'Mumbai', aliases: ['bombay'], lat: 19.076, lon: 72.8777 },
  { name: 'Navi Mumbai', aliases: [], lat: 19.033, lon: 73.0297 },
  { name: 'Thane', aliases: [], lat: 19.2183, lon: 72.9781 },
  { name: 'Pune', aliases: ['poona'], lat: 18.5204, lon: 73.8567 },
  { name: 'Nagpur', aliases: [], lat: 21.1458, lon: 79.0882 },
  { name: 'Nashik', aliases: ['nasik'], lat: 19.9975, lon: 73.7898 },
  {
    name: 'Chhatrapati Sambhajinagar',
    aliases: ['aurangabad', 'sambhajinagar'],
    lat: 19.8762,
    lon: 75.3433,
  },
  { name: 'Kolhapur', aliases: [], lat: 16.705, lon: 74.2433 },
  { name: 'Delhi', aliases: ['new delhi'], lat: 28.6139, lon: 77.209 },
  { name: 'Bengaluru', aliases: ['bangalore'], lat: 12.9716, lon: 77.5946 },
  { name: 'Hyderabad', aliases: [], lat: 17.385, lon: 78.4867 },
  { name: 'Chennai', aliases: ['madras'], lat: 13.0827, lon: 80.2707 },
  { name: 'Kolkata', aliases: ['calcutta'], lat: 22.5726, lon: 88.3639 },
  { name: 'Ahmedabad', aliases: [], lat: 23.0225, lon: 72.5714 },
  { name: 'Jaipur', aliases: [], lat: 26.9124, lon: 75.7873 },
  { name: 'Chandigarh', aliases: [], lat: 30.7333, lon: 76.7794 },
  { name: 'Indore', aliases: [], lat: 22.7196, lon: 75.8577 },
  { name: 'Kochi', aliases: ['cochin'], lat: 9.9312, lon: 76.2673 },
  { name: 'Guwahati', aliases: ['gauhati'], lat: 26.1445, lon: 91.7362 },
  { name: 'Srivilliputhur', aliases: ['srivilliputtur'], lat: 9.5125, lon: 77.6336 },
] as const;

export function normalizeCityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Longest names first so "Navi Mumbai" cannot be shadowed by "Mumbai".
const MATCH_ORDER: readonly { city: HubCity; needle: string }[] = [...HUB_CITIES]
  .flatMap((city) => [city.name, ...city.aliases].map((needle) => ({ city, needle: normalizeCityKey(needle) })))
  .sort((a, b) => b.needle.length - a.needle.length);

/** Find a registry city mentioned anywhere in `text` (word-bounded, case-insensitive). */
export function findHubCityInText(text: string): HubCity | null {
  const haystack = ` ${normalizeCityKey(text)} `;
  for (const { city, needle } of MATCH_ORDER) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z])${escaped}(?:[^a-z]|$)`, 'i').test(haystack)) return city;
  }
  return null;
}

/** Canonical city for a persisted/entered value, or null when unknown. */
export function resolveHubCity(value: string | null | undefined): HubCity | null {
  if (!value) return null;
  const key = normalizeCityKey(value);
  return (
    HUB_CITIES.find((c) => normalizeCityKey(c.name) === key) ??
    HUB_CITIES.find((c) => c.aliases.some((a) => normalizeCityKey(a) === key)) ??
    null
  );
}

export function cityCoords(value: string | null | undefined): { lat: number; lon: number } | null {
  const city = resolveHubCity(value);
  return city ? { lat: city.lat, lon: city.lon } : null;
}
