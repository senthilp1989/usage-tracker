import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmt, fullDate, niceStep, shortDate } from "../format";
import {
  METRICS,
  tupleTotal,
  type DailyStats,
  type MetricTuple,
} from "../types";
import type { TipState } from "./Tip";

const HEIGHT = 300;
const M = { top: 14, right: 16, bottom: 34, left: 44 };
const MAX_BAR_WIDTH = 24;
const SEGMENT_GAP = 2; // surface-coloured gap between stacked segments
const DAILY_LABEL_LIMIT = 32; // above this, per-column totals become noise

type Granularity = "day" | "week";

interface Bucket {
  key: string;
  label: string;
  rangeLabel: string;
  values: MetricTuple;
}

function bucketSeries(data: DailyStats[], granularity: Granularity): Bucket[] {
  const make = (chunk: DailyStats[]): Bucket => {
    const values = METRICS.map((m) =>
      chunk.reduce((sum, d) => sum + d[m.key], 0),
    ) as unknown as MetricTuple;
    const start = chunk[0].day;
    const end = chunk[chunk.length - 1].day;
    return {
      key: start,
      label: shortDate(start),
      rangeLabel:
        chunk.length > 1
          ? `Week of ${shortDate(start)} – ${shortDate(end)}`
          : fullDate(start),
      values,
    };
  };
  if (granularity === "day") return data.map((d) => make([d]));
  const buckets: Bucket[] = [];
  for (let i = 0; i < data.length; i += 7)
    buckets.push(make(data.slice(i, i + 7)));
  return buckets;
}

export default function ActivityChart({
  data,
  series,
  onToggleSeries,
  onTip,
}: {
  data: DailyStats[];
  series: boolean[];
  onToggleSeries: (index: number) => void;
  onTip: (tip: TipState | null) => void;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [granularity, setGranularity] = useState<Granularity>("week");

  const buckets = useMemo(
    () => bucketSeries(data, granularity),
    [data, granularity],
  );
  const totals = useMemo(
    () => buckets.map((b) => tupleTotal(b.values, series)),
    [buckets, series],
  );

  return (
    <section className="card">
      <div className="card-hd">
        <div>
          <h2>Volume by period</h2>
          <p className="sub">
            {buckets.length} {granularity === "day" ? "days" : "weeks"} ·
            stacked by metric
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="seg" role="group" aria-label="Granularity">
            <button
              aria-pressed={granularity === "day"}
              onClick={() => setGranularity("day")}
            >
              Daily
            </button>
            <button
              aria-pressed={granularity === "week"}
              onClick={() => setGranularity("week")}
            >
              Weekly
            </button>
          </div>
          <div className="seg" role="group" aria-label="View">
            <button
              aria-pressed={view === "chart"}
              onClick={() => setView("chart")}
            >
              Chart
            </button>
            <button
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
        </div>
      </div>
      <div className="card-bd">
        {buckets.length === 0 ? (
          <div className="empty">No activity in this period</div>
        ) : view === "chart" ? (
          <Plot
            buckets={buckets}
            totals={totals}
            series={series}
            granularity={granularity}
            onTip={onTip}
          />
        ) : (
          <BucketTable buckets={buckets} totals={totals} />
        )}
        <div className="legend">
          {METRICS.map((m, i) => {
            const total = buckets.reduce((sum, b) => sum + b.values[i], 0);
            return (
              <button
                key={m.key}
                aria-pressed={series[i]}
                onClick={() => onToggleSeries(i)}
                // The last visible series cannot be turned off - an empty
                // chart isn't a state worth being able to reach.
                disabled={series[i] && series.filter(Boolean).length === 1}
              >
                <span className="lg-key" style={{ background: m.colorVar }} />
                <span>{m.label}</span>
                <span className="lg-val">{fmt(total)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Plot({
  buckets,
  totals,
  series,
  granularity,
  onTip,
}: {
  buckets: Bucket[];
  totals: number[];
  series: boolean[];
  granularity: Granularity;
  onTip: (tip: TipState | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: number | undefined;
    const ro = new ResizeObserver(([entry]) => {
      // 140ms debounce - re-rendering per resize frame makes the whole page jitter.
      window.clearTimeout(timer);
      const next = entry.contentRect.width;
      timer = window.setTimeout(() => setWidth(next), 140);
    });
    ro.observe(el);
    setWidth(el.clientWidth || 900);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  // Hide the tooltip if this plot unmounts (view/granularity switch) while hovered.
  useEffect(() => () => onTip(null), [onTip]);

  const W = Math.max(560, width);
  const plotW = W - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const barWidth = Math.min(
    MAX_BAR_WIDTH,
    Math.max(3, (plotW / buckets.length) * 0.72),
  );
  const xCenter = (i: number) => M.left + plotW * ((i + 0.5) / buckets.length);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;

  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  const showTotals =
    granularity === "week" || buckets.length <= DAILY_LABEL_LIMIT;

  // A long leading run of empty buckets is a finding, not dead space: block it
  // out and say when recording actually starts.
  const firstNonZero = totals.findIndex((t) => t > 0);
  const leadingBlock = firstNonZero > 2 ? firstNonZero : 0;

  const tickCount = Math.min(buckets.length, 7);

  function showTip(i: number, x: number, yPos: number) {
    setHover(i);
    onTip({
      title: buckets[i].rangeLabel,
      values: buckets[i].values,
      x,
      y: yPos,
    });
  }
  function hideTip() {
    setHover(null);
    onTip(null);
  }

  return (
    <div ref={wrapRef}>
      <svg
        className="plot"
        viewBox={`0 0 ${W} ${HEIGHT}`}
        role="img"
        aria-label={`Stacked activity volume by ${granularity === "day" ? "day" : "week"}`}
      >
        {leadingBlock > 0 && (
          <>
            <rect
              x={M.left}
              y={M.top}
              width={Math.max(
                0,
                xCenter(leadingBlock) - barWidth / 2 - 6 - M.left,
              )}
              height={plotH}
              fill="var(--surface-2)"
              rx={6}
            />
            <text
              x={(M.left + xCenter(leadingBlock) - barWidth / 2 - 6) / 2}
              y={M.top + plotH / 2}
              textAnchor="middle"
              className="tick"
            >
              No recorded usage before {shortDate(buckets[leadingBlock].key)}
            </text>
          </>
        )}

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? "baseline" : "gridline"}
            />
            <text
              x={M.left - 9}
              y={y(t) + 4}
              textAnchor="end"
              className="tick num"
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {buckets.map((b, i) => {
          let acc = 0;
          const segments = METRICS.map((m, k) => {
            if (!series[k]) return null;
            const v = b.values[k];
            if (v <= 0) return null;
            const y0 = y(acc + v);
            const y1 = y(acc);
            acc += v;
            const isTop = Math.abs(acc - totals[i]) < 1e-9;
            return (
              <rect
                key={m.key}
                x={xCenter(i) - barWidth / 2}
                width={barWidth}
                y={y0}
                height={Math.max(1.5, y1 - y0 - SEGMENT_GAP)}
                fill={m.colorVar}
                rx={isTop ? Math.min(4, barWidth / 2) : 0}
              />
            );
          });
          return (
            <g
              key={b.key}
              className={`colgroup${hover !== null && hover !== i ? " dim" : ""}`}
            >
              {segments}
              {showTotals && totals[i] > 0 && (
                <text
                  x={xCenter(i)}
                  y={y(totals[i]) - 7}
                  textAnchor="middle"
                  className="tick num"
                  fill="var(--ink-2)"
                  fontWeight={600}
                >
                  {fmt(totals[i])}
                </text>
              )}
            </g>
          );
        })}

        {/* Hit targets: transparent full-height bands over the whole column
            slot, not the painted bar, and focusable so the value is reachable
            from the keyboard. */}
        {buckets.map((b, i) => (
          <rect
            key={`hit-${b.key}`}
            className="hit"
            tabIndex={0}
            x={M.left + plotW * (i / buckets.length)}
            width={plotW / buckets.length}
            y={M.top}
            height={plotH}
            aria-label={`${b.rangeLabel}: ${fmt(totals[i])} actions`}
            onPointerMove={(e) => showTip(i, e.clientX, e.clientY)}
            onPointerLeave={hideTip}
            onFocus={(e) => {
              const r = (e.target as SVGRectElement).getBoundingClientRect();
              showTip(i, r.right, r.top + r.height / 2);
            }}
            onBlur={hideTip}
          />
        ))}

        {Array.from({ length: tickCount }, (_, j) => {
          const i = Math.round(
            (j * (buckets.length - 1)) / Math.max(1, tickCount - 1),
          );
          return (
            <text
              key={`xt-${i}`}
              x={xCenter(i)}
              y={HEIGHT - 12}
              textAnchor="middle"
              className="tick"
            >
              {buckets[i].label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** The table view is a first-class twin of the chart, not a fallback - it is
 *  the mandatory accessibility relief for the sub-3:1 contrast of slot 1. */
function BucketTable({
  buckets,
  totals,
}: {
  buckets: Bucket[];
  totals: number[];
}) {
  const rows = buckets
    .map((b, i) => ({ b, total: totals[i] }))
    .filter((r) => r.b.values.some((v) => v > 0));
  if (rows.length === 0)
    return <div className="empty">No activity in this period</div>;
  return (
    <div className="tbl-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
      <table className="data">
        <thead>
          <tr>
            <th>Period</th>
            {METRICS.map((m) => (
              <th className="n" key={m.key}>
                {m.label}
              </th>
            ))}
            <th className="n">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ b, total }) => (
            <tr key={b.key}>
              <td>{b.rangeLabel}</td>
              {METRICS.map((m, i) => (
                <td className={`n${b.values[i] ? "" : " zero"}`} key={m.key}>
                  {fmt(b.values[i])}
                </td>
              ))}
              <td className="n" style={{ fontWeight: 700 }}>
                {fmt(total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
