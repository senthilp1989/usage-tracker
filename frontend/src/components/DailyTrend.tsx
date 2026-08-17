import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { TREND_METRICS, type DailyStats } from "../types";

const SERIES = TREND_METRICS.map((m, i) => ({
  ...m,
  colorVar: `var(--s${i + 1})`,
}));

const HEIGHT = 280;
const PAD = { left: 48, right: 20, top: 12, bottom: 28 };
const MAX_BAR_WIDTH = 24;

type Granularity = "day" | "week";

interface Bucket {
  key: string; // first day in the bucket, YYYY-MM-DD
  label: string;
  rangeLabel: string;
  values: Record<string, number>;
  total: number;
}

function niceTicks(maxValue: number): number[] {
  const max = Math.max(maxValue, 1);
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step - 1e-9; v += step) ticks.push(v);
  return ticks;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}`;
}

function bucketSeries(data: DailyStats[], granularity: Granularity): Bucket[] {
  if (granularity === "day") {
    return data.map((d) => {
      const values = Object.fromEntries(SERIES.map((s) => [s.key, d[s.key]]));
      return {
        key: d.day,
        label: shortDate(d.day),
        rangeLabel: shortDate(d.day),
        values,
        total: SERIES.reduce((sum, s) => sum + values[s.key], 0),
      };
    });
  }
  const buckets: Bucket[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7);
    const values = Object.fromEntries(
      SERIES.map((s) => [s.key, chunk.reduce((sum, d) => sum + d[s.key], 0)]),
    );
    const start = chunk[0].day;
    const end = chunk[chunk.length - 1].day;
    buckets.push({
      key: start,
      label: shortDate(start),
      rangeLabel: chunk.length > 1 ? `${shortDate(start)} – ${shortDate(end)}` : shortDate(start),
      values,
      total: SERIES.reduce((sum, s) => sum + values[s.key], 0),
    });
  }
  return buckets;
}

// Consecutive all-zero buckets at the start of the range - e.g. a 90-day
// default window that starts well before the first recorded event. Trimmed
// from the chart (with a note) rather than stretching the plot across mostly
// empty space; the table view still lists every bucket.
function countLeadingEmpty(buckets: Bucket[]): number {
  let n = 0;
  while (n < buckets.length - 1 && buckets[n].total === 0) n++;
  return n;
}

export default function DailyTrend({ data }: { data: DailyStats[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [granularity, setGranularity] = useState<Granularity>(
    data.length > 31 ? "week" : "day",
  );

  const buckets = useMemo(() => bucketSeries(data, granularity), [data, granularity]);
  const leadingEmpty = useMemo(() => countLeadingEmpty(buckets), [buckets]);
  const chartBuckets = useMemo(() => buckets.slice(leadingEmpty), [buckets, leadingEmpty]);

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Daily activity</h2>
        <div style={{ display: "flex", gap: 12 }}>
          <div>
            <button
              className="link-button"
              aria-pressed={granularity === "day"}
              onClick={() => setGranularity("day")}
              style={granularity === "day" ? { color: "var(--ink)", fontWeight: 600 } : undefined}
            >
              Daily
            </button>
            <button
              className="link-button"
              aria-pressed={granularity === "week"}
              onClick={() => setGranularity("week")}
              style={granularity === "week" ? { color: "var(--ink)", fontWeight: 600 } : undefined}
            >
              Weekly
            </button>
          </div>
          <div>
            <button
              className="link-button"
              aria-pressed={view === "chart"}
              onClick={() => setView("chart")}
              style={view === "chart" ? { color: "var(--ink)", fontWeight: 600 } : undefined}
            >
              Chart
            </button>
            <button
              className="link-button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              style={view === "table" ? { color: "var(--ink)", fontWeight: 600 } : undefined}
            >
              Table
            </button>
          </div>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="empty-note">No events in this range yet.</div>
      ) : view === "chart" ? (
        <>
          {leadingEmpty > 0 && (
            <div className="chart-note">
              No activity for the first {leadingEmpty} {granularity === "day" ? "day" : "week"}
              {leadingEmpty > 1 ? "s" : ""} of this range — hidden from the chart below.
            </div>
          )}
          <Chart buckets={chartBuckets} />
        </>
      ) : (
        <BucketTable buckets={buckets} />
      )}
    </div>
  );
}

function Chart({ buckets }: { buckets: Bucket[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plot = useMemo(() => {
    const innerW = Math.max(width - PAD.left - PAD.right, 10);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const n = Math.max(buckets.length, 1);
    const slot = innerW / n;
    const barWidth = Math.min(MAX_BAR_WIDTH, slot * 0.6);
    const maxTotal = Math.max(...buckets.map((b) => b.total), 1);
    const ticks = niceTicks(maxTotal);
    const yMax = ticks[ticks.length - 1];
    const xCenter = (i: number) => PAD.left + slot * (i + 0.5);
    const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
    return { innerW, innerH, slot, barWidth, ticks, yMax, xCenter, y, labelEvery };
  }, [buckets, width]);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Activity by event type">
        {/* gridlines + y ticks */}
        {plot.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={plot.y(t)}
              y2={plot.y(t)}
              stroke={t === 0 ? "var(--line-strong)" : "var(--grid)"}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={plot.y(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--muted)">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {/* x labels */}
        {buckets.map((b, i) =>
          i % plot.labelEvery === 0 || i === buckets.length - 1 ? (
            <text
              key={b.key}
              x={plot.xCenter(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted)"
            >
              {b.label}
            </text>
          ) : null,
        )}
        {/* stacked columns */}
        {buckets.map((b, i) => {
          let cum = 0;
          return (
            <g key={b.key}>
              {SERIES.map((s) => {
                const v = b.values[s.key];
                if (v === 0) return null;
                const y0 = plot.y(cum);
                cum += v;
                const y1 = plot.y(cum);
                return (
                  <rect
                    key={s.key}
                    x={plot.xCenter(i) - plot.barWidth / 2}
                    y={y1}
                    width={plot.barWidth}
                    height={Math.max(y0 - y1, 0)}
                    fill={s.colorVar}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                );
              })}
            </g>
          );
        })}
        {/* hover hit layer - one slot per bucket */}
        {buckets.map((_, i) => (
          <rect
            key={i}
            x={PAD.left + plot.slot * i}
            y={PAD.top}
            width={plot.slot}
            height={plot.innerH}
            fill="transparent"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && buckets[hover] && (
        <div
          className="chart-tooltip"
          style={{
            left: plot.xCenter(hover) + (plot.xCenter(hover) > width * 0.62 ? -170 : 14),
            top: PAD.top,
          }}
        >
          <div className="tooltip-date">{buckets[hover].rangeLabel}</div>
          {SERIES.map((s) => (
            <div className="tooltip-row" key={s.key}>
              <span className="legend-key" style={{ background: s.colorVar }} />
              <span className="name">{s.label}</span>
              <span className="value">{buckets[hover].values[s.key].toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <div className="chart-legend">
        {SERIES.map((s) => (
          <span className="legend-item" key={s.key}>
            <span className="legend-key" style={{ background: s.colorVar }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function BucketTable({ buckets }: { buckets: Bucket[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          {SERIES.map((s) => (
            <th className="num" key={s.key}>
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.key}>
            <td>{b.rangeLabel}</td>
            {SERIES.map((s) => (
              <td className="num" key={s.key}>
                {b.values[s.key].toLocaleString()}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
