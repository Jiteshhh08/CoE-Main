import { fetchPublicText } from './fetch-guard';

// Self-hosted Firecrawl: renders JS-shell pages that a plain fetch sees as an
// empty shell, and provides open-internet search. Replaces the paid search API
// with a service we run ourselves.
//
// Security: the endpoint is operator config, never user input, but it is still
// pinned to loopback/private hosts — this must not become a public egress proxy.

const RENDER_TIMEOUT_MS = 45_000;
const SEARCH_TIMEOUT_MS = 30_000;
// Below this many visible characters a page is treated as a JS shell or a
// cookie wall, and worth a (much more expensive) render.
const SHELL_TEXT_THRESHOLD = 900;

// Explicit operator allowlist, e.g. FIRECRAWL_ALLOWED_HOSTS=175.175.1.89.
// Needed when prod reaches the renderer over a LAN/CGNAT address that is not
// RFC1918 (175.175.x, Tailscale 100.64/10). Keeping it an explicit list is the
// point: this endpoint must never drift into an arbitrary public host.
function allowedHosts(): string[] {
  return (process.env.FIRECRAWL_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^www\./, ''))
    .filter((h) => h.length > 0);
}

function endpoint(): string | null {
  const raw = (process.env.FIRECRAWL_URL || '').trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '::1' || host === 'host.docker.internal' || /^127\./.test(host);
  // RFC1918
  const privateNet =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const allowlisted = allowedHosts().some((d) => host === d || host.endsWith('.' + d));
  if (!loopback && !privateNet && !allowlisted) return null;
  return raw.replace(/\/+$/, '');
}

export function isFirecrawlConfigured(): boolean {
  return endpoint() !== null;
}

function authHeaders(): Record<string, string> {
  const key = (process.env.FIRECRAWL_API_KEY || '').trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function visibleTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * Render a URL through Firecrawl and return the post-JS HTML.
 * Returns null when the renderer is not configured or the page genuinely fails,
 * so callers keep whatever they already had.
 */
export async function renderHtml(url: string): Promise<string | null> {
  const base = endpoint();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        url,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 2500,
        timeout: RENDER_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      data?: { html?: string; rawHtml?: string };
    };
    const html = data?.data?.html || data?.data?.rawHtml || '';
    return html.length > 0 ? html : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a page, transparently falling back to the renderer when the plain
 * response is a JS shell. This is the single choke point both discovery and
 * extraction route through, so JS-heavy sources are fixed in one place.
 */
export async function fetchHtmlWithRender(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number; render?: boolean } = {},
): Promise<{ status: number; text: string; rendered: boolean }> {
  const { status, text } = await fetchPublicText(url, {
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxChars: opts.maxChars ?? 1_500_000,
    contentTypes: ['html', 'text'],
  });
  const wantRender = opts.render !== false && isFirecrawlConfigured();
  if (!wantRender) return { status, text, rendered: false };
  const usable = status >= 200 && status < 300 && visibleTextLength(text) >= SHELL_TEXT_THRESHOLD;
  if (usable) return { status, text, rendered: false };
  const rendered = await renderHtml(url);
  if (!rendered) return { status, text, rendered: false };
  return { status: 200, text: rendered, rendered: true };
}

export type WebSearchHit = { title: string; url: string; snippet: string };

/**
 * Open-internet search through the self-hosted stack (SearXNG behind Firecrawl).
 * Returns an empty list rather than throwing: a dead search provider must not
 * fail a discovery run.
 */
export async function searchWeb(query: string, limit = 10): Promise<WebSearchHit[]> {
  const base = endpoint();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      success?: boolean;
      data?: { title?: string; url?: string; description?: string }[];
    };
    const rows = Array.isArray(data?.data) ? data.data : [];
    const out: WebSearchHit[] = [];
    for (const r of rows) {
      if (!r?.url || !r?.title) continue;
      if (!r.url.startsWith('https://')) continue;
      out.push({
        title: r.title.slice(0, 200),
        url: r.url.split('#')[0],
        snippet: (r.description || '').slice(0, 300),
      });
    }
    return out;
  } catch {
    return [];
  }
}
