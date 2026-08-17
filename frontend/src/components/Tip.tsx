import { useLayoutEffect, useRef, useState } from "react";
import { fmt } from "../format";
import { METRICS, tupleTotal, type MetricTuple } from "../types";

export interface TipState {
  title: string;
  values: MetricTuple;
  x: number;
  y: number;
}

/**
 * Fixed-position tooltip shared by the chart and the ranked bars. Tooltips
 * enhance, never gate: everything shown here is also reachable from a direct
 * label or the table view, and hit targets fire this on `focus` as well as
 * hover so the keyboard path shows the same content.
 */
export default function Tip({
  tip,
  series,
}: {
  tip: TipState | null;
  series: boolean[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!tip || !node) return;
    const rect = node.getBoundingClientRect();
    // Flip to the left of the pointer near the right edge, clamp vertically.
    const left =
      tip.x + 14 + rect.width > window.innerWidth - 12
        ? tip.x - rect.width - 14
        : tip.x + 14;
    const top = Math.max(
      10,
      Math.min(tip.y - rect.height / 2, window.innerHeight - rect.height - 10),
    );
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      className="tip"
      ref={ref}
      role="status"
      aria-live="polite"
      style={{ left: pos.left, top: pos.top }}
    >
      <h4>{tip.title}</h4>
      {METRICS.map((m, i) =>
        series[i] ? (
          <div className="tip-row" key={m.key}>
            <span className="tip-key" style={{ background: m.colorVar }} />
            <span className="tip-name">{m.label}</span>
            <span className="tip-val">{fmt(tip.values[i])}</span>
          </div>
        ) : null,
      )}
      <div className="tip-tot">
        <span>Total</span>
        <span>{fmt(tupleTotal(tip.values, series))}</span>
      </div>
    </div>
  );
}
