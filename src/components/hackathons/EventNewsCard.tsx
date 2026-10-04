"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";

const newsDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export type EventNewsItem = {
  id: number;
  title: string;
  caption: string;
  imageUrl: string | null;
  publishedAt: Date | string;
};

export default function EventNewsCard({ item }: { item: EventNewsItem }) {
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
        <div className="w-[35%] shrink-0 bg-[#efeeea] overflow-hidden relative border-r border-[#c4c6d3] min-h-36 sm:min-h-44">
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
          <p className="text-sm text-[#434651] line-clamp-5">{item.caption}</p>
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
