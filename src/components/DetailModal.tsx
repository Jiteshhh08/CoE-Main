"use client";

import { useEffect } from "react";

export type DetailMeta = { label: string; value: string };

type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  meta?: DetailMeta[];
  body: string | null;
  action?: React.ReactNode;
};

// News-article style details popup (same visual language as NewsModal):
// navy overlay, white sheet with gold top border, full text in whitespace-pre-wrap.
export default function DetailModal({ open, onClose, kicker, title, meta, body, action }: DetailModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#002155]/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain border-t-8 border-[#fd9923] shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white p-2 rounded-full transition-colors"
        >
          <span className="material-symbols-outlined text-[#002155]">close</span>
        </button>

        <div className="p-6 md:p-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-bold text-[#8c4f00] uppercase tracking-[0.2em]">{kicker}</span>
            <span className="w-8 h-[1px] bg-[#c4c6d3]" />
            <span className="text-[10px] font-bold text-[#747782] uppercase tracking-widest">TCET CoE</span>
          </div>

          <h2 className="font-headline text-3xl md:text-4xl text-[#002155] leading-tight mb-6">{title}</h2>

          {meta && meta.length > 0 ? (
            <dl className="mb-6 grid gap-2 border border-[#e3e2df] bg-[#f5f4f0] p-4">
              {meta.map((m) => (
                <div key={m.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#002155] sm:w-40">
                    {m.label}
                  </dt>
                  <dd className="text-sm text-[#434651]">{m.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="prose prose-sm max-w-none text-[#434651] font-['Inter'] leading-relaxed whitespace-pre-wrap">
            {body || "No further details provided."}
          </div>

          {action ? <div className="mt-8 flex flex-wrap items-center gap-2">{action}</div> : null}

          <div className="mt-10 pt-6 border-t border-[#c4c6d3] flex justify-between items-center">
            <span className="text-[9px] font-bold text-[#747782] uppercase">© TCET Centre of Excellence</span>
            <button
              onClick={onClose}
              className="text-xs font-bold text-[#002155] uppercase tracking-widest border-b-2 border-[#fd9923]"
            >
              Back to list
            </button>
          </div>
        </div>
      </div>
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
}
