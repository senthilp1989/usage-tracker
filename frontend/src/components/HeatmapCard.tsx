import { useEffect, useRef, useState } from "react";
import Heatmap, { type HeatCell } from "./Heatmap";

/**
 * The user × environment card. The grid is the one panel whose width is set by
 * the data (one column per environment, one row per user), so it is the one
 * that outgrows a half-width card first - hence the expand toggle, which takes
 * the same shape as the detail drawer's: a full-viewport panel over a backdrop,
 * Escape to leave, scrolling locked behind it.
 */
export default function HeatmapCard({ cells }: { cells: HeatCell[] }) {
  const [expanded, setExpanded] = useState(false);
  // Fixed positioning pulls the card out of the two-up grid, so the slot it
  // leaves behind is held open at its last measured height - otherwise the
  // page reflows underneath the backdrop and jumps again on exit.
  const [slotHeight, setSlotHeight] = useState<number>();
  const panelRef = useRef<HTMLElement>(null);
  const expandBtnRef = useRef<HTMLButtonElement>(null);

  function toggleExpand() {
    if (!expanded) setSlotHeight(panelRef.current?.offsetHeight);
    setExpanded(!expanded);
  }

  // Escape closes, the page behind stops scrolling, and focus moves into the
  // panel so the keyboard doesn't stay stranded on the page underneath.
  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExpanded(false);
        expandBtnRef.current?.focus();
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  return (
    <div
      className="heat-slot"
      style={expanded && slotHeight ? { minHeight: slotHeight } : undefined}
    >
      {expanded && (
        <div className="detail-backdrop" onClick={() => setExpanded(false)} />
      )}
      <section
        className={`card heat-card${expanded ? " is-expanded" : ""}`}
        ref={panelRef}
        tabIndex={expanded ? -1 : undefined}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? true : undefined}
        aria-label={expanded ? "User by environment, expanded" : undefined}
      >
        <div className="card-hd">
          <div>
            <h2>User × environment</h2>
            <p className="sub">
              Total actions per pair. Empty cells mean no recorded usage in this
              period.
            </p>
          </div>
          <button
            className="btn"
            ref={expandBtnRef}
            onClick={toggleExpand}
            aria-expanded={expanded}
            title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          >
            {expanded ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 3H3v6M21 9V3h-6M9 21H3v-6M15 21h6v-6" />
              </svg>
            )}
            {expanded ? "Exit full screen" : "Expand"}
          </button>
        </div>
        <div className="card-bd heat-scroll">
          <Heatmap cells={cells} />
        </div>
      </section>
    </div>
  );
}
