'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type ApiResponse<T> = { success: boolean; message: string; data: T | null };

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
  eventStatus: 'UPCOMING' | 'ONGOING' | 'COMPLETED' | 'UNKNOWN';
  distanceKm: number | null;
  distanceLabel: string | null;
  myInterest: { status: 'SAVED' | 'INTERESTED' } | null;
};

const REG_STYLES: Record<HubOpportunity['regStatus'], string> = {
  OPEN: 'border-[#0b6b2e] bg-[#f0faf2] text-[#0b6b2e]',
  CLOSING_SOON: 'border-[#8a5a00] bg-[#fdf6ec] text-[#8a5a00]',
  CLOSED: 'border-[#991b1b] bg-[#fdf2f2] text-[#991b1b]',
  UNKNOWN: 'border-[#c4c6d3] bg-[#efeeea] text-[#434651]',
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

export default function HackathonHubPage() {
  const [rows, setRows] = useState<HubOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<HubOpportunity | null>(null);

  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [mode, setMode] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [domain, setDomain] = useState('');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState<'newest' | 'deadline'>('newest');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (city) params.set('city', city);
      if (mode) params.set('mode', mode);
      if (domain.trim()) params.set('domain', domain.trim());
      if (month) params.set('month', month);
      if (regStatus) params.set('regStatus', regStatus);
      params.set('sort', sort);
      const query = params.toString();
      const res = await fetch(`/api/hackathon-hub${query ? `?${query}` : ''}`, { credentials: 'include' });
      const json = (await res.json()) as ApiResponse<HubOpportunity[]>;
      if (!json.success) throw new Error(json.message || 'Failed to load hackathons.');
      setRows(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hackathons.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, city, mode, regStatus, domain, month, sort]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.city) set.add(r.city);
    return ['', ...Array.from(set).sort()];
  }, [rows]);

  const setInterest = async (opp: HubOpportunity, status: 'SAVED' | 'INTERESTED') => {
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) throw new Error(json.message || 'Failed to update interest.');
      setRows((prev) => prev.map((r) => (r.id === opp.id ? { ...r, myInterest: { status } } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update interest.');
    }
  };

  const quick = (label: string, onClick: () => void, active: boolean) => (
    <button
      key={label}
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-wider ${
        active ? 'border-[#002155] bg-[#002155] text-white' : 'border-[#c4c6d3] bg-white text-[#434651] hover:border-[#002155] hover:text-[#002155]'
      }`}
    >
      {label}
    </button>
  );

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

      <section className="mb-4 flex flex-wrap gap-2">
        {quick('All', () => { setCity(''); setMode(''); setRegStatus(''); setMonth(''); }, !city && !mode && !regStatus && !month)}
        {quick('Mumbai', () => setCity('Mumbai'), city === 'Mumbai')}
        {quick('Pune', () => setCity('Pune'), city === 'Pune')}
        {quick('Online', () => setMode('ONLINE'), mode === 'ONLINE')}
        {quick('Open', () => setRegStatus('OPEN'), regStatus === 'OPEN')}
        {quick('Closing Soon', () => setRegStatus('CLOSING_SOON'), regStatus === 'CLOSING_SOON')}
        {quick('This Month', () => {
          const d = new Date();
          setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }, month !== '')}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-6 bg-white border border-[#c4c6d3] p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search hackathons…"
          className="w-full min-w-0 md:col-span-2 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]"
        />
        <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full min-w-0 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]">
          <option value="">All cities</option>
          {cities.filter(Boolean).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full min-w-0 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]">
          <option value="">All modes</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
          <option value="HYBRID">Hybrid</option>
        </select>
        <select value={regStatus} onChange={(e) => setRegStatus(e.target.value)} className="w-full min-w-0 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]">
          <option value="">Any status</option>
          <option value="OPEN">Open</option>
          <option value="CLOSING_SOON">Closing soon</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'deadline')} className="w-full min-w-0 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]">
          <option value="newest">Newest</option>
          <option value="deadline">Deadline</option>
        </select>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Filter by month"
          className="w-full min-w-0 md:col-span-2 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]"
        />
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Domain / tech (e.g. AI, Cloud)…"
          className="w-full min-w-0 md:col-span-2 border border-[#c4c6d3] px-3 py-2 text-sm outline-none focus:border-[#002155]"
        />
        <p className="md:col-span-2 text-xs text-[#747782] self-center">
          {rows.length} event{rows.length === 1 ? '' : 's'} · status auto-calculated from dates
        </p>
      </section>

      {error ? <div className="mb-6 border border-[#991b1b] bg-[#fdf2f2] p-4 text-sm text-[#991b1b]">{error}</div> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse border border-[#c4c6d3] bg-white" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-[#c4c6d3] bg-white p-10 text-center">
          <p className="font-headline text-xl font-bold text-[#002155]">No hackathons found</p>
          <p className="mt-1 text-sm text-[#747782]">Try clearing filters — approved faculty submissions appear here.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((opp) => {
            const days = daysUntil(opp.registrationDeadline);
            const team = opp.teamMin || opp.teamMax ? `${opp.teamMin ?? '?'}–${opp.teamMax ?? '?'}` : '—';
            const location = opp.city ?? (opp.mode === 'ONLINE' ? 'Online' : 'TBD');
            const dateLabel = opp.startDate ? formatDate(opp.startDate) : formatDate(opp.registrationDeadline);
            const domainLabel = opp.themes?.[0] ?? opp.technologies?.[0] ?? opp.category;
            return (
              <article key={opp.id} className="flex flex-col border border-[#c4c6d3] bg-white p-5">
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${REG_STYLES[opp.regStatus]}`}>
                    {opp.regStatus.replace('_', ' ')}
                  </span>
                  <span className="rounded-full border border-[#c4c6d3] bg-[#efeeea] px-3 py-1 text-[11px] font-semibold text-[#434651]">
                    {opp.eventStatus}
                  </span>
                  {opp.verificationStatus && opp.verificationStatus !== 'UNVERIFIED' ? (
                    <span className="rounded-full bg-[#002155] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                      {opp.verificationStatus.replace('_', ' ')}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-3 font-headline text-xl font-bold text-[#002155]">{opp.title}</h3>
                <p className="mt-1 text-sm text-[#434651]">by {opp.organizer}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#434651]">
                  <div><dt className="font-bold uppercase tracking-wider text-[#747782]">Date</dt><dd>{dateLabel}</dd></div>
                  <div><dt className="font-bold uppercase tracking-wider text-[#747782]">Location</dt><dd>{location}{opp.mode ? ` · ${opp.mode}` : ''}{opp.distanceLabel ? ` · ${opp.distanceLabel}` : ''}</dd></div>
                  <div><dt className="font-bold uppercase tracking-wider text-[#747782]">Team</dt><dd>{team}</dd></div>
                  <div><dt className="font-bold uppercase tracking-wider text-[#747782]">Domain</dt><dd>{domainLabel}</dd></div>
                  <div className="col-span-2"><dt className="font-bold uppercase tracking-wider text-[#747782]">Prize</dt><dd>{opp.prize ?? '—'}</dd></div>
                  <div className="col-span-2"><dt className="font-bold uppercase tracking-wider text-[#747782]">Deadline</dt><dd>{opp.registrationDeadline ? `${formatDate(opp.registrationDeadline)}${days != null && days >= 0 ? ` · ${days}d left` : ''}` : 'No deadline'}</dd></div>
                </dl>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  {opp.applicationUrl ? (
                    <a href={opp.applicationUrl} target="_blank" rel="noopener noreferrer" className="bg-[#002155] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:opacity-90">
                      Register
                    </a>
                  ) : null}
                  <button onClick={() => setSelected(opp)} className="border border-[#002155] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#002155] hover:bg-[#002155] hover:text-white">
                    View Details
                  </button>
                  <button
                    onClick={() => void setInterest(opp, opp.myInterest ? 'SAVED' : 'SAVED')}
                    className="border border-[#8c4f00] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#8c4f00] hover:bg-[#fdf6ec]"
                  >
                    {opp.myInterest ? '✓ Saved' : 'Bookmark'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

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
                <p className="mt-1">Deadline: {formatDate(selected.registrationDeadline)} · Status: {selected.regStatus}</p>
                {selected.applicationUrl ? <a href={selected.applicationUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-[#002155] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white">Register now</a> : null}
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Eligibility</h3>
                <p className="mt-1">{selected.eligibility ?? 'Open — confirm on official page.'} · Team: {selected.teamMin ?? '?'}–{selected.teamMax ?? '?'}</p>
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Competition</h3>
                <p className="mt-1">Domains: {(selected.themes ?? []).join(', ') || '—'} · Tech: {(selected.technologies ?? []).join(', ') || '—'}</p>
              </section>
              <section><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Benefits</h3>
                <p className="mt-1">Prize: {selected.prize ?? '—'}</p>
              </section>
              <section className="border-t border-[#e3e2df] pt-3 text-xs text-[#747782]"><h3 className="font-bold text-[#002155] uppercase text-xs tracking-wider">Verification</h3>
                <p className="mt-1">Last verified: {selected.lastVerifiedAt ? formatDate(selected.lastVerifiedAt) : 'Not yet'} · Source: {selected.sourceType ?? 'ADMIN'}</p>
                {selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Source link</a> : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
