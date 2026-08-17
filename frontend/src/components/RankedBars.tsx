import { fmt } from "../format";
import { METRICS, type MetricTuple } from "../types";
import type { TipState } from "./Tip";

export interface RankEntry {
  name: string;
  sub?: string;
  values: MetricTuple;
  total: number;
}

/**
 * Ranked stacked bars, two variants:
 *  - compact (users, environments): name column, bar, value
 *  - stacked (interfaces): full name on its own line in mono, because
 *    interface identifiers run past 100 characters and truncating them into a
 *    190px column loses the part that identifies them
 *
 * All rows share one scale via an invisible spacer, so bar length is
 * comparable across the list rather than each row filling its own width.
 */
export default function RankedBars({
  entries,
  series,
  variant = "compact",
  onTip,
}: {
  entries: RankEntry[];
  series: boolean[];
  variant?: "compact" | "stacked";
  onTip: (tip: TipState | null) => void;
}) {
  if (entries.length === 0)
    return <div className="empty">No activity in this selection</div>;
  const max = Math.max(...entries.map((e) => e.total), 1);
  const stacked = variant === "stacked";

  return (
    <div className={`rank${stacked ? " stack" : ""}`}>
      {entries.map((e) => {
        const bar = (
          <div className="rank-bar">
            {METRICS.map((m, i) =>
              series[i] && e.values[i] > 0 ? (
                <span
                  key={m.key}
                  className="rank-seg"
                  style={{ flex: e.values[i], background: m.colorVar }}
                />
              ) : null,
            )}
            <span style={{ flex: Math.max(0, max - e.total) }} />
          </div>
        );
        const value = <div className="rank-val">{fmt(e.total)}</div>;
        const showTip = (x: number, y: number) =>
          onTip({
            title: e.sub ? `${e.name} · ${e.sub}` : e.name,
            values: e.values,
            x,
            y,
          });

        return (
          <div
            className="rank-row"
            key={`${e.name}|${e.sub ?? ""}`}
            onPointerMove={(ev) => showTip(ev.clientX, ev.clientY)}
            onPointerLeave={() => onTip(null)}
          >
            {stacked ? (
              <>
                <div className="rank-name">
                  <span className="nm" title={e.name}>
                    {e.name}
                  </span>
                  {e.sub && <small>{e.sub}</small>}
                  {value}
                </div>
                {bar}
              </>
            ) : (
              <>
                <div className="rank-name" title={e.name}>
                  {e.name}
                  {e.sub && <small>{e.sub}</small>}
                </div>
                {bar}
                {value}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
