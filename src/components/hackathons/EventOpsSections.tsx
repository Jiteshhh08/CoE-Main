"use client";

import { useCallback, useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";

type Api<T> = { success: boolean; message: string; data: T };
type NoticeRow = { id: number; title: string; body: string; pinned: boolean; createdAt: string };
type NewsRow = { id: number; title: string; caption: string; imageKey: string; pinned: boolean; createdAt: string };
type MediaRow = { id: number; kind: string; fileKey: string; caption: string | null; createdAt: string };

const storageUrl = (fileKey: string) =>
  `/api/storage/${fileKey.split("/").map(encodeURIComponent).join("/")}`;

const sectionCls = "mt-6 border border-[#c4c6d3] bg-white p-5";

const newsDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

type EventNewsItem = {
  id: number;
  title: string;
  caption: string;
  imageUrl: string | null;
  publishedAt: Date | string;
};

function EventNewsCard({ item }: { item: EventNewsItem }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = () => {
    try {
      trackEvent("content_viewed", {
        content_type: "event_news",
        content_id: String(item.id),
        content_title: item.title,
      });
    } catch {
      // analytics must never break UI
    }
    setIsOpen(true);
  };

  const formatDate = (dateInput: Date | string) => {
    const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
    return newsDateFormatter.format(date);
  };

  return (
    <>
      {/* Clickable horizontal card: image left, title top-right, dotted description below */}
      <article
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpen();
          }
        }}
        role="button"
        tabIndex={0}
        className="border border-[#c4c6d3] bg-white group cursor-pointer hover:shadow-lg transition-shadow duration-300 flex overflow-hidden"
      >
        <div className="w-32 sm:w-48 shrink-0 bg-[#efeeea] overflow-hidden relative border-r border-[#c4c6d3]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
            alt=""
            src={item.imageUrl || "/vercel.svg"}
            width={640}
            height={360}
          />
          <div className="absolute top-2 left-2 bg-[#002155] text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1">
            {formatDate(item.publishedAt)}
          </div>
        </div>
        <div className="p-4 sm:p-5 flex-1 min-w-0">
          <h3 className="font-body font-semibold text-[#002155] mb-2 leading-tight group-hover:text-[#8c4f00] transition-colors">
            {item.title}
          </h3>
          <p className="text-sm text-[#434651] line-clamp-3">{item.caption}</p>
        </div>
      </article>

      {/* Modal overlay — identical to In the Press popup */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#002155]/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain border-t-8 border-[#fd9923] shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close dialog"
              className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white p-2 rounded-full transition-colors"
            >
              <span className="material-symbols-outlined text-[#002155]">close</span>
            </button>

            <div className="p-6 md:p-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] font-bold text-[#8c4f00] uppercase tracking-[0.2em]">
                  {formatDate(item.publishedAt)}
                </span>
                <span className="w-8 h-[1px] bg-[#c4c6d3]" />
                <span className="text-[10px] font-bold text-[#747782] uppercase tracking-widest">
                  TCET CoE Press
                </span>
              </div>

              <h2 className="font-headline text-3xl md:text-4xl text-[#002155] leading-tight mb-6">
                {item.title}
              </h2>

              <div className="w-full aspect-video bg-[#f5f4f0] mb-8 border border-[#c4c6d3] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl || "/vercel.svg"}
                  alt={item.title}
                  className="w-full h-full object-cover"
                  width={640}
                  height={360}
                />
              </div>

              <div className="prose prose-sm max-w-none text-[#434651] font-['Inter'] leading-relaxed whitespace-pre-wrap">
                {item.caption}
              </div>

              <div className="mt-10 pt-6 border-t border-[#c4c6d3] flex justify-between items-center">
                <span className="text-[9px] font-bold text-[#747782] uppercase">
                  © TCET Centre of Excellence
                </span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-xs font-bold text-[#002155] uppercase tracking-widest border-b-2 border-[#fd9923]"
                >
                  Back to News
                </button>
              </div>
            </div>
          </div>
          {/* Backdrop Click to Close */}
          <div className="absolute inset-0 -z-10" onClick={() => setIsOpen(false)} />
        </div>
      )}
    </>
  );
}

export default function EventOpsSections({
  eventId,
  status,
  ops,
}: {
  eventId: number;
  status: string;
  ops: { notices?: boolean; news?: boolean; feedback?: boolean; mediaReport?: boolean };
}) {
  const [notices, setNotices] = useState<NoticeRow[] | null>(null);
  const [news, setNews] = useState<NewsRow[] | null>(null);
  const [media, setMedia] = useState<MediaRow[] | null>(null);
  const [mine, setMine] = useState<{ rating: number; comment: string | null } | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(() => {
    if (ops.notices !== false) {
      void fetch(`/api/innovation/events/${eventId}/ops/notices`, { credentials: "include" })
        .then((r) => r.json())
        .then((b: Api<{ notices: NoticeRow[] }>) => {
          if (b.success) setNotices(b.data.notices);
        });
    }
    if (ops.news !== false) {
      void fetch(`/api/innovation/events/${eventId}/ops/news`, { credentials: "include" })
        .then((r) => r.json())
        .then((b: Api<{ news: NewsRow[] }>) => {
          if (b.success) setNews(b.data.news);
        });
    }
    if (ops.mediaReport) {
      void fetch(`/api/innovation/events/${eventId}/ops/media`, { credentials: "include" })
        .then((r) => r.json())
        .then((b: Api<{ media: MediaRow[] }>) => {
          if (b.success) setMedia(b.data.media);
        });
    }
    if (ops.feedback) {
      void fetch(`/api/innovation/events/${eventId}/feedback`, { credentials: "include" })
        .then((r) => r.json())
        .then((b: Api<{ mine: { rating: number; comment: string | null } | null }>) => {
          if (b.success && b.data.mine) setMine(b.data.mine);
        });
    }
  }, [eventId, ops.notices, ops.news, ops.mediaReport, ops.feedback]);
  useEffect(load, [load]);

  const submitFeedback = async () => {
    if (rating < 1 || rating > 5) {
      notify("Pick a rating (1–5 stars)");
      return;
    }
    const res = await fetch(`/api/innovation/events/${eventId}/feedback`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating, comment: comment.trim() }),
    });
    const b = (await res.json()) as Api<{ feedback: { rating: number; comment: string | null } }>;
    notify(b.success ? "Thank you — feedback submitted" : b.message);
    if (b.success) setMine(b.data.feedback);
  };

  const visibleNotices = notices ?? [];
  const reports = (media ?? []).filter((m) => m.kind === "REPORT");
  const photos = (media ?? []).filter((m) => m.kind === "PHOTO");
  const videos = (media ?? []).filter((m) => m.kind === "VIDEO");

  return (
    <>
      {toast ? (
        <div className="fixed right-4 top-4 z-50 border border-[#0b6b2e] bg-[#f2fbf4] px-4 py-3 text-sm font-semibold text-[#0b6b2e] shadow-lg">
          {toast}
        </div>
      ) : null}

      {(news ?? []).length > 0 ? (
        <section className={sectionCls}>
          <h3 className="font-headline text-xl text-[#002155]">News</h3>
          <div className="mt-3 space-y-4">
            {(news ?? []).map((n) => (
              <EventNewsCard
                key={n.id}
                item={{
                  id: n.id,
                  title: n.pinned ? `📌 ${n.title}` : n.title,
                  caption: n.caption,
                  imageUrl: storageUrl(n.imageKey),
                  publishedAt: n.createdAt,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {visibleNotices.length > 0 ? (
        <section className={sectionCls}>
          <h3 className="font-headline text-xl text-[#002155]">Notices</h3>
          <div className="mt-3 space-y-3">
            {visibleNotices.map((n) => (
              <div key={n.id} className="border border-[#e3e2df] bg-[#faf9f5] p-3">
                <p className="font-semibold text-[#002155]">
                  {n.pinned ? "📌 " : ""}
                  {n.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#434651]">{n.body}</p>
                <p className="mt-1 text-[11px] text-[#747782]">
                  {new Date(n.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {ops.feedback && status === "CLOSED" ? (
        <section className={sectionCls}>
          <h3 className="font-headline text-xl text-[#002155]">Event Feedback</h3>
          {mine ? (
            <div className="mt-3">
              <p className="text-sm text-[#0b6b2e]">{"★".repeat(mine.rating)}{"☆".repeat(5 - mine.rating)} — submitted, thank you!</p>
              {mine.comment ? <p className="mt-1 text-sm text-[#434651]">{mine.comment}</p> : null}
            </div>
          ) : (
            <div className="mt-3">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={`text-2xl ${n <= rating ? "text-[#fd9923]" : "text-[#c4c6d3]"}`}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                className="mt-3 w-full border border-[#c4c6d3] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#002155]"
                placeholder="What did you think of the hackathon? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void submitFeedback()}
                className="mt-2 bg-[#002155] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:opacity-90"
              >
                Submit Feedback
              </button>
            </div>
          )}
        </section>
      ) : null}

      {ops.mediaReport && (media ?? []).length > 0 ? (
        <section className={sectionCls}>
          <h3 className="font-headline text-xl text-[#002155]">Event Report & Gallery</h3>
          {reports.length > 0 ? (
            <div className="mt-3 space-y-2">
              {reports.map((m) => (
                <a
                  key={m.id}
                  href={`${storageUrl(m.fileKey)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block border border-[#e3e2df] bg-[#faf9f5] px-4 py-3 text-sm font-semibold text-[#002155] hover:border-[#002155]"
                >
                  📄 {m.caption ?? "Final Report"}
                </a>
              ))}
            </div>
          ) : null}
          {photos.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {photos.map((m) => (
                <a key={m.id} href={`${storageUrl(m.fileKey)}`} target="_blank" rel="noreferrer">
                  <div className="aspect-video border border-[#e3e2df] bg-[#f4f6fa]" />
                  <p className="mt-1 text-center text-[11px] text-[#747782]">{m.caption ?? "Photo"}</p>
                </a>
              ))}
            </div>
          ) : null}
          {videos.length > 0 ? (
            <div className="mt-3 space-y-3">
              {videos.map((m) => (
                <video key={m.id} controls className="w-full border border-[#e3e2df]" src={`${storageUrl(m.fileKey)}`} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
