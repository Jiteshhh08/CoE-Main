'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { hubSourceLabel } from '@/lib/hackathon-hub';

type ApiResponse<T> = { success: boolean; message: string; data: T | null };

type HubPage = {
  items: HubOpportunity[];
  nextCursor: number | null;
  hasMore: boolean;
  viewer?: HubViewer;
  facets?: { cities: { city: string; count: number }[] };
};

/** Answered by the listing, so the save button never discovers the role by failing. */
type HubViewer = {
  authenticated: boolean;
  canSave: boolean;
};

type HubOpportunity = {
  id: number;
  title: string;
  category: string;
  organizer: string;
  description: string | null;
  registrationDeadline: string | null;
  eligibility: string | null;
  prize: string | null;
  themes: string[] | null;
  technologies: string[] | null;
  applicationUrl: string | null;
  facultyRecommended: boolean;
  status: string;
  mode: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  registrations: number | null;
  startDate: string | null;
  endDate: string | null;
  teamMin: number | null;
  teamMax: number | null;
  sourceUrl: string | null;
  sourceType: string | null;
  verificationStatus: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  regStatus: 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'UNKNOWN';
  regStatusSource: 'deadline' | 'startDate' | 'none';
  eventStatus: 'UPCOMING' | 'ONGOING' | 'COMPLETED' | 'UNKNOWN';
  distanceKm: number | null;
  distanceLabel: string | null;
  myInterest: { status: 'SAVED' | 'INTERESTED' } | null;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
};

/** Day + short month for the card's date block, which is what people scan for first. */
const dateBadge = (iso: string | null): { day: string; mon: string } => {
  if (!iso) return { day: '—', mon: 'TBD' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '—', mon: 'TBD' };
  return {
    day: String(d.getDate()),
    mon: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
  };
};

/** A deadline is only worth shouting about when it is close or already gone. */
const urgencyChip = (status: HubOpportunity['regStatus']): string => {
  if (status === 'CLOSING_SOON') return 'border-[#f0c98a] bg-[#fdf6ec] text-[#8a5a00]';
  if (status === 'CLOSED') return 'border-[#e8c4c4] bg-[#fdf2f2] text-[#991b1b]';
  if (status === 'OPEN') return 'border-[#dfe2e8] bg-[#f6f7f9] text-[#434651]';
  return 'border-[#dfe2e8] bg-white text-[#747782]';
};

/** "OFFLINE" tells a student nothing; "In person" does. */
const MODE_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE: 'In person',
  HYBRID: 'Hybrid',
};

/**
 * When the hackathon actually runs, and how far through it we are — the card's
 * primary date. Registration deadlines are a separate, action-facing fact.
 *
 * The label comes from the API's `eventStatus`, not from comparing dates here.
 * Deriving it twice meant the card said "ended" on an event whose chip said
 * "closes today": a date-only end date is an instant at midnight, so the local
 * comparison expired it while the API (which knows a bare date is a whole day)
 * still called it ongoing. One rule, one owner.
 */
const eventTimeline = (opp: {
  startDate: string | null;
  endDate: string | null;
  eventStatus: string;
}): { from: Date; to: Date | null; pct: number; label: string } | null => {
  if (!opp.startDate) return null;
  const from = new Date(opp.startDate);
  if (Number.isNaN(from.getTime())) return null;
  const to = opp.endDate ? new Date(opp.endDate) : null;
  if (to && Number.isNaN(to.getTime())) return null;

  const DAY = 86_400_000;
  const now = Date.now();
  const start = from.getTime();
  const end = to?.getTime() ?? null;
  const totalDays = end ? Math.max(1, Math.round((end - start) / DAY) + 1) : 1;

  const pct = end && end > start ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : now >= start ? 100 : 0;
  const label =
    opp.eventStatus === 'COMPLETED'
      ? 'ended'
      : opp.eventStatus === 'UPCOMING'
        ? `starts in ${Math.max(1, Math.ceil((start - now) / DAY))}d`
        : end
          ? `day ${Math.min(Math.floor((now - start) / DAY) + 1, totalDays)} of ${totalDays}`
          : 'running';
  return { from, to, pct, label };
};

/** Mirrors SORT_KEYS in the hub API route. */
type HubSort = 'relevant' | 'popular' | 'upcoming' | 'deadline' | 'newest';

export default function HackathonHubPage() {
  const [rows, setRows] = useState<HubOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<HubOpportunity | null>(null);
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const [viewer, setViewer] = useState<HubViewer>({ authenticated: false, canSave: false });

  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [mode, setMode] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [domain, setDomain] = useState('');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState<HubSort>('relevant');

  const buildParams = (cursor?: number | null) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (city) params.set('city', city);
    if (mode) params.set('mode', mode);
    if (domain.trim()) params.set('domain', domain.trim());
    if (month) params.set('month', month);
    if (regStatus) params.set('regStatus', regStatus);
    params.set('sort', sort);
    if (cursor) params.set('cursor', String(cursor));
    return params.toString();
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = buildParams();
      const res = await fetch(`/api/hackathon-hub${query ? `?${query}` : ''}`, { credentials: 'include' });
      const json = (await res.json()) as ApiResponse<HubPage>;
      if (!json.success || !json.data) throw new Error(json.message || 'Failed to load hackathons.');
      setRows(json.data.items);
      setNextCursor(json.data.nextCursor);
      setHasMore(json.data.hasMore);
      if (json.data.viewer) setViewer(json.data.viewer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hackathons.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const query = buildParams(nextCursor);
      const res = await fetch(`/api/hackathon-hub?${query}`, { credentials: 'include' });
      const json = (await res.json()) as ApiResponse<HubPage>;
      const data = json.data;
      if (!json.success || !data) throw new Error(json.message || 'Failed to load more hackathons.');
      setRows((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
      if (data.viewer) setViewer(data.viewer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more hackathons.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, city, mode, regStatus, domain, month, sort]);

  const [cityFacets, setCityFacets] = useState<{ city: string; count: number }[]>([]);

  // The dropdown must offer every city in the hub. Deriving it from `rows` only
  // ever showed the cities on the page the browser happened to hold.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/hackathon-hub?facets=1&limit=1', { credentials: 'include' });
        const json = (await res.json()) as ApiResponse<HubPage>;
        if (alive && json.success && json.data?.facets) setCityFacets(json.data.facets.cities);
      } catch {
        // Falls back to the cities on the loaded page below.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cities = useMemo(() => {
    const source = cityFacets.length
      ? cityFacets.map((c) => c.city)
      : (rows.map((r) => r.city).filter(Boolean) as string[]);
    return ['', ...Array.from(new Set(source)).sort()];
  }, [cityFacets, rows]);

  // The API's month filter takes YYYY-MM; a native month input renders "---------- ----" empty.
  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      });
    }
    return out;
  }, []);

  /** The card and the open modal must never disagree about the save state. */
  const patchInterest = (id: number, myInterest: HubOpportunity['myInterest']) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, myInterest } : r)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, myInterest } : prev));
  };

  /**
   * One button, two directions. It used to POST `SAVED` unconditionally, so a
   * saved card could only ever be re-saved — the stored interest was invisible
   * to the user and impossible to remove from the Hub. Clicking now removes the
   * bookmark, using the DELETE the API already exposed.
   *
   * Optimistic: the icon flips immediately and rolls back if the server rejects
   * the change, so the card never claims a save that did not happen.
   */
  const toggleSaved = async (opp: HubOpportunity) => {
    if (savingIds.includes(opp.id)) return;
    const previous = opp.myInterest;
    const wasSaved = Boolean(previous);
    setError('');
    setSavingIds((prev) => [...prev, opp.id]);
    patchInterest(opp.id, wasSaved ? null : { status: 'SAVED' });
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/interest`, {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        ...(wasSaved ? {} : { body: JSON.stringify({ status: 'SAVED' }) }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) {
        if (res.status === 401 || res.status === 403) {
          // The session changed under us (expired token, or a role the listing
          // did not know about). Re-render the truthful button state instead of
          // a red banner the user cannot act on.
          setViewer({ authenticated: res.status === 403, canSave: false });
          patchInterest(opp.id, previous);
          return;
        }
        throw new Error(json.message || 'Failed to update interest.');
      }
    } catch (err) {
      patchInterest(opp.id, previous);
      setError(err instanceof Error ? err.message : 'Failed to update interest.');
    } finally {
      setSavingIds((prev) => prev.filter((id) => id !== opp.id));
    }
  };

  return (
    <main className="max-w-7xl mx-auto mt-10 px-4 md:px-8 pt-[120px] pb-14 min-h-screen">
      <header className="mb-6 border-l-4 border-[#002155] pl-4 md:pl-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8c4f00]">
          <Link href="/innovation" className="hover:underline">← Innovation Home</Link>
        </p>
        <h1 className="mt-2 font-headline text-3xl md:text-[40px] font-bold tracking-tight text-[#002155] leading-none">
          Hackathon Hub
        </h1>
        <p className="mt-2 text-[#434651] max-w-3xl font-body text-sm md:text-base">
          Find upcoming hackathons and innovation challenges — Mumbai, Maharashtra, India-wide and online.
        </p>
      </header>

      <section className="mb-6 bg-white border border-[#c4c6d3] p-4 md:p-5">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, organizer or keyword…"
          aria-label="Search hackathons"
          className="w-full min-w-0 border border-[#c4c6d3] px-3 py-2.5 text-sm outline-none focus:border-[#002155]"
        />

        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8c4f00]">Where</p>
            <label htmlFor="hub-city" className="mb-1 block text-xs text-[#747782]">City</label>
            <select id="hub-city" value={city} onChange={(e) => setCity(e.target.value)} className="w-full min-w-0 border border-[#c4c6d3] bg-white px-3 py-2 text-sm text-[#434651] outline-none focus:border-[#002155]">
              <option value="">All cities</option>
              {cities.filter(Boolean).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8c4f00]">How</p>
            <label htmlFor="hub-mode" className="mb-1 block text-xs text-[#747782]">Mode</label>
            <select id="hub-mode" value={mode} onChange={(e) => setMode(e.target.value)} className="w-full min-w-0 border border-[#c4c6d3] bg-white px-3 py-2 text-sm text-[#434651] outline-none focus:border-[#002155]">
              <option value="">Online + Offline + Hybrid</option>
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
              <option value="HYBRID">Hybrid</option>
            </select>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8c4f00]">Status</p>
            <label htmlFor="hub-reg" className="mb-1 block text-xs text-[#747782]">Registration</label>
            <select id="hub-reg" value={regStatus} onChange={(e) => setRegStatus(e.target.value)} className="w-full min-w-0 border border-[#c4c6d3] bg-white px-3 py-2 text-sm text-[#434651] outline-none focus:border-[#002155]">
              <option value="">Open + Closing soon + Closed</option>
              <option value="OPEN">Open</option>
              <option value="CLOSING_SOON">Closing soon</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8c4f00]">When</p>
            <label htmlFor="hub-month" className="mb-1 block text-xs text-[#747782]">Month</label>
            <select
              id="hub-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full min-w-0 border border-[#c4c6d3] bg-white px-3 py-2 text-sm text-[#434651] outline-none focus:border-[#002155]"
            >
              <option value="">Any month</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8c4f00]">What</p>
            <label htmlFor="hub-domain" className="mb-1 block text-xs text-[#747782]">Domain / Technology</label>
            <input
              id="hub-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. AI, Cloud…"
              className="w-full min-w-0 border border-[#c4c6d3] bg-white px-3 py-2 text-sm text-[#434651] outline-none focus:border-[#002155]"
            />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8c4f00]">Order</p>
            <label htmlFor="hub-sort" className="mb-1 block text-xs text-[#747782]">Sort by</label>
            <select id="hub-sort" value={sort} onChange={(e) => setSort(e.target.value as HubSort)} className="w-full min-w-0 border border-[#c4c6d3] bg-white px-3 py-2 text-sm text-[#434651] outline-none focus:border-[#002155]">
              <option value="relevant">Most relevant</option>
              <option value="popular">Most popular</option>
              <option value="upcoming">Starting soonest</option>
              <option value="deadline">Deadline soonest</option>
              <option value="newest">Recently added</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e3e2df] pt-3">
          <p className="text-xs text-[#747782]">
            {rows.length} event{rows.length === 1 ? '' : 's'} · status auto-calculated from dates · * deadline not published, derived from start date
          </p>
          <button
            onClick={() => { setSearch(''); setCity(''); setMode(''); setRegStatus(''); setDomain(''); setMonth(''); setSort('relevant'); }}
            className="border border-[#c4c6d3] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#434651] hover:border-[#002155] hover:text-[#002155]"
          >
            Clear all
          </button>
        </div>
      </section>

      {error ? <div className="mb-6 border border-[#991b1b] bg-[#fdf2f2] p-4 text-sm text-[#991b1b]">{error}</div> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[300px] animate-pulse border border-[#c4c6d3] bg-white" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-[#c4c6d3] bg-white p-10 text-center">
          <p className="font-headline text-xl font-bold text-[#002155]">No hackathons found</p>
          <p className="mt-1 text-sm text-[#747782]">Try clearing filters — approved faculty submissions appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((opp) => {
            const days = daysUntil(opp.registrationDeadline);
            // A deadline stored as a bare date closes at the end of that day, so
            // it is still open on the day itself.
            const closesIn =
              opp.regStatus === 'CLOSED' || days == null
                ? ''
                : days > 1
                  ? ` · ${days} days left`
                  : days === 1
                    ? ' · 1 day left'
                    : ' · today';
            const place = [opp.city, opp.state, opp.country].filter(Boolean).join(', ');
            const location = opp.mode === 'ONLINE' ? 'Online' : place || 'TBD';
            // The date anchor answers "when is this hackathon" — the day it is on
            // and closes. startDate is when the submission window opened, which
            // reads as a registration date, not an event date.
            const anchorIso = opp.endDate ?? opp.startDate ?? opp.registrationDeadline;
            const badge = dateBadge(anchorIso);
            const span = eventTimeline(opp);
            const domainLabel = opp.themes?.[0] ?? opp.technologies?.[0] ?? opp.category;
            const modeLabel = opp.mode ? MODE_LABEL[opp.mode] ?? opp.mode : null;
            const teamLabel = opp.teamMin || opp.teamMax ? `${opp.teamMin ?? '1'}–${opp.teamMax ?? '–'} people` : null;
            // One flowing line of values, no label column: the format tells you what each one is.
            // Values are deduped across fields, because the API's distanceLabel is "Online" for
            // online events and would otherwise print the mode twice.
            const metaParts = [
              location,
              modeLabel,
              teamLabel,
              opp.registrations ? `${opp.registrations.toLocaleString('en-IN')} registered` : null,
              opp.distanceLabel,
            ].filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i);
            return (
              <article
                key={opp.id}
                className="group flex flex-col border border-[#c4c6d3] bg-white transition-colors duration-150 hover:border-[#002155]"
              >
                <div className="flex gap-4 border-b border-[#e8e7e3] p-5">
                  {/* the anchor: when. ink mass, not a shadow — the house style is flat */}
                  <div className="flex h-[56px] w-[54px] shrink-0 flex-col items-center justify-center bg-[#002155] text-white">
                    {badge.mon === 'TBD' ? (
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/80">TBD</span>
                    ) : (
                      <>
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">{badge.mon}</span>
                        <span className="mt-0.5 text-[21px] font-bold leading-none tabular-nums">{badge.day}</span>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]">
                      <span className="truncate text-[#8c4f00]">{domainLabel}</span>
                      {opp.sourceType ? (
                        <>
                          <span aria-hidden="true" className="text-[#c4c6d3]">·</span>
                          <span
                            className="truncate text-[#747782]"
                            title={opp.sourceUrl ? `Original listing: ${opp.sourceUrl}` : undefined}
                          >
                            {hubSourceLabel(opp.sourceType)}
                          </span>
                        </>
                      ) : null}
                      {opp.verificationStatus && opp.verificationStatus !== 'UNVERIFIED' ? (
                        <span className="ml-auto shrink-0 text-[#0b6b2e]" title="Cross-checked against the original listing">
                          ✓
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-1.5 line-clamp-2 font-headline text-[18px] font-bold leading-[1.28] text-[#002155]">{opp.title}</h3>
                    <p className="mt-1 truncate text-[12px] text-[#747782]">{opp.organizer}</p>
                  </div>
                </div>
                <div className="px-5 pt-4">
                  <p className="text-[13px] leading-relaxed text-[#434651]">{metaParts.join(' · ')}</p>
                  {opp.prize ? (
                    <p className="mt-2 flex items-baseline gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#747782]">Prize</span>
                      <span className="text-[15px] font-bold text-[#002155]">{opp.prize}</span>
                    </p>
                  ) : null}
                </div>

                {/* When the hackathon runs. Registration closing is a separate line below. */}
                {span ? (
                  <div className="mt-3 px-5">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-[#434651]">
                        {formatDate(opp.startDate)}
                        {span.to ? ` → ${formatDate(opp.endDate)}` : ''}
                      </span>
                      <span className={span.label === 'ended' ? 'text-[#991b1b]' : 'text-[#747782]'}>{span.label}</span>
                    </div>
                    {span.to && span.pct > 0 ? (
                      <div className="mt-1 h-[3px] w-full bg-[#e8e7e3]" aria-hidden="true">
                        <div className="h-[3px] bg-[#002155]" style={{ width: `${span.pct}%` }} />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pb-4">
                  <span
                    title={opp.regStatusSource === 'startDate' ? 'No deadline published by the source — this is the start date' : undefined}
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${urgencyChip(opp.regStatus)}`}
                  >
                    {opp.registrationDeadline
                      ? `${opp.regStatus === 'CLOSED' ? 'Closed' : 'Closes'} ${formatDate(opp.registrationDeadline)}${closesIn}`
                      : opp.startDate
                        ? 'Closes when it starts'
                        : 'Deadline not published'}
                  </span>
                </div>
                <div className="mt-auto flex items-center gap-2 border-t border-[#e8e7e3] bg-[#fbfaf8] px-5 py-3">
                  {opp.applicationUrl && opp.regStatus !== 'CLOSED' ? (
                    <a
                      href={opp.applicationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-[#002155] px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[#00173d]"
                    >
                      Register
                    </a>
                  ) : opp.sourceUrl ? (
                    // No usable application link, but we do know where the event
                    // was published. "No link yet" hid a link we already had.
                    <a
                      href={opp.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the original listing"
                      className="flex-1 bg-[#002155] px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-white hover:bg-[#00173d]"
                    >
                      View listing
                    </a>
                  ) : (
                    <span
                      title="The source published no link"
                      className="flex-1 cursor-default border border-[#d8dae1] bg-[#f2f2f0] px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-[#5c606b]"
                    >
                      No link yet
                    </span>
                  )}
                  <button
                    onClick={() => setSelected(opp)}
                    className="border border-[#002155] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[#002155] hover:bg-[#002155] hover:text-white"
                  >
                    Details
                  </button>
                  {viewer.canSave ? (
                    <button
                      onClick={() => void toggleSaved(opp)}
                      disabled={savingIds.includes(opp.id)}
                      title={opp.myInterest ? 'Remove from saved' : 'Save for later'}
                      aria-label={opp.myInterest ? 'Remove from saved' : 'Save for later'}
                      aria-pressed={!!opp.myInterest}
                      className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center border text-[#8c4f00] disabled:opacity-60 ${
                        opp.myInterest
                          ? 'border-[#8c4f00] bg-[#fdf6ec]'
                          : 'border-[#c4c6d3] hover:border-[#8c4f00] hover:bg-[#fdf6ec]'
                      }`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>
                        {opp.myInterest ? 'bookmark' : 'bookmark_border'}
                      </span>
                    </button>
                  ) : viewer.authenticated ? (
                    // A signed-in non-student has no write to attempt. Say so
                    // once, here, instead of letting the click produce a 403.
                    <button
                      type="button"
                      disabled
                      title="Only students can save opportunities"
                      aria-label="Only students can save opportunities"
                      className="flex h-[34px] w-[34px] shrink-0 cursor-not-allowed items-center justify-center border border-[#e3e2df] text-[#b0b3bd]"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>
                        bookmark_border
                      </span>
                    </button>
                  ) : (
                    // Signed out: the actionable state is "sign in", not a save
                    // that is guaranteed to 401.
                    <Link
                      href={`/login?next=${encodeURIComponent('/innovation/hackathon-hub')}`}
                      title="Sign in to save"
                      className="flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap border border-[#c4c6d3] px-2 text-[10px] font-bold uppercase tracking-wider text-[#8c4f00] hover:border-[#8c4f00] hover:bg-[#fdf6ec]"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>
                        bookmark_border
                      </span>
                      Sign in to save
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && rows.length > 0 && hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="border border-[#002155] px-6 py-3 text-xs font-bold uppercase tracking-wider text-[#002155] hover:bg-[#002155] hover:text-white disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more events'}
          </button>
        </div>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto bg-white border border-[#002155] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8c4f00]">{selected.category} · {selected.eventStatus}</p>
                <h2 className="mt-1 font-headline text-2xl font-bold text-[#002155]">{selected.title}</h2>
                <p className="text-sm text-[#434651]">by {selected.organizer}</p>
              </div>
              <button onClick={() => setSelected(null)} className="border border-[#c4c6d3] px-3 py-2 text-xs font-bold uppercase tracking-wider">Close</button>
            </div>
            <div className="mt-4 space-y-4 text-sm text-[#434651]">
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Overview</h3>
                <p className="mt-1">Mode: {selected.mode ?? 'TBD'} · Venue: {selected.venue ?? 'TBD'} · {selected.city ?? ''} {selected.state ?? ''}</p>
                <p className="mt-1">Dates: {formatDate(selected.startDate)} → {formatDate(selected.endDate)}</p>
                {selected.description ? <p className="mt-2">{selected.description}</p> : null}
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Registration</h3>
                <p className="mt-1">Deadline: {selected.registrationDeadline ? formatDate(selected.registrationDeadline) : 'Not published'} · Status: {selected.regStatus}{selected.regStatusSource === 'startDate' ? ' (derived from start date)' : ''}</p>
                {selected.applicationUrl ? <a href={selected.applicationUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-[#002155] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white">Register now</a> : null}
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Eligibility</h3>
                <p className="mt-1">{selected.eligibility ?? 'Open — confirm on official page.'}</p>
                <p className="mt-1">
                  Team size: {selected.teamMin || selected.teamMax ? `${selected.teamMin ?? '?'}–${selected.teamMax ?? '?'} members` : 'Not published'}
                </p>
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Competition</h3>
                <p className="mt-1">Domains: {(selected.themes ?? []).join(', ') || '—'} · Tech: {(selected.technologies ?? []).join(', ') || '—'}</p>
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Benefits</h3>
                <p className="mt-1">Prize: {selected.prize ?? '—'}</p>
              </section>
              <section className="border-t border-[#e3e2df] pt-3 text-xs text-[#747782]"><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Source</h3>
                <p className="mt-1">
                  Listed on <span className="font-semibold text-[#434651]">{hubSourceLabel(selected.sourceType)}</span>
                  {selected.sourceUrl ? (
                    <> · <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">view original listing</a></>
                  ) : null}
                </p>
                <p className="mt-1">
                  Verification: {selected.verificationStatus ?? 'UNVERIFIED'} · Last checked: {selected.lastVerifiedAt ? formatDate(selected.lastVerifiedAt) : 'Not yet'}
                </p>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
