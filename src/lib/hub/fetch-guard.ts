import { lookup } from 'node:dns/promises';

// Outbound-fetch guard for server-side crawls (discovery / extraction /
// sheet import / change monitoring). All fetch targets here are either
// admin-supplied or crawled URLs, so every host is resolved and rejected
// when non-public BEFORE any bytes move. Redirect landings are re-checked.
//
// Known limitation: DNS is resolved pre-fetch, so a hostile DNS that flips
// answers between check and fetch (rebinding) is not covered. Accepted:
// every configured source is either an allowlisted public site or an
// admin-pasted URL, and failures are loud, never silent.
export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (v === '::1' || v === '::' || v === '::ffff:127.0.0.1') return true;
  if (v.includes(':')) {
    // IPv6: loopback handled above; fe80::/10 link-local, fc00::/7 unique-local.
    return /^fe[89ab]/.test(v.replace(/^::ffff:/, '').split(':')[0] ?? '') || /^(fc|fd)/.test(v);
  }
  const parts = v.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // fail closed
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  );
}

export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Not a fetchable URL: ${String(raw).slice(0, 120)}`);
  }
  if (u.protocol !== 'https:') throw new Error(`Only https URLs may be fetched (got ${u.protocol})`);
  let addrs;
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    throw new Error(`DNS lookup failed for ${u.hostname}`);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Refusing to fetch non-public host: ${u.hostname}`);
  }
  return u;
}

export type FetchPublicOptions = {
  timeoutMs?: number;
  maxChars?: number;
  userAgent?: string;
  accept?: string;
  contentTypes?: string[];
};

export async function fetchPublicText(
  url: string,
  opts: FetchPublicOptions = {},
): Promise<{ status: number; text: string; contentType: string; finalUrl: string }> {
  const checked = await assertPublicHttpsUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(checked.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': opts.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TCET-CoE-HubBot/1.0',
        Accept: opts.accept ?? 'text/html,application/xhtml+xml',
      },
    });
    // Re-validate the landing host: default fetch follows redirects, and a
    // redirect onto internal infra must not be fetched silently.
    const finalUrl = new URL(res.url || checked.toString());
    await assertPublicHttpsUrl(finalUrl.toString());
    const contentType = res.headers.get('content-type') || '';
    if (opts.contentTypes && !opts.contentTypes.some((t) => contentType.includes(t))) {
      throw new Error(`Unexpected content-type: ${contentType || '(none)'}`);
    }
    const text = res.ok ? (await res.text()).slice(0, opts.maxChars ?? 1_500_000) : '';
    return { status: res.status, text, contentType, finalUrl: finalUrl.toString() };
  } finally {
    clearTimeout(timer);
  }
}
