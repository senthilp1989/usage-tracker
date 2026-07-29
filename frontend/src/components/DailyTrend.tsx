import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { TREND_METRICS, type DailyStats } from "../types";

const SERIES = TREND_METRICS.map((m, i) => ({
  ...m,
  colorVar: `var(--series-${i + 1})`,
}));

const HEIGHT = 280;
const PAD = { left: 48, right: 20, top: 12, bottom: 28 };

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

export default function DailyTrend({ data }: { data: DailyStats[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Daily activity</h2>
        <div>
          <button
            className="link-button"
            aria-pressed={view === "chart"}
            onClick={() => setView("chart")}
            style={
              view === "chart"
                ? { color: "var(--text-primary)", fontWeight: 600 }
                : undefined
            }
          >
            Chart
          </button>
          <button
            className="link-button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
            style={
              view === "table"
                ? { color: "var(--text-primary)", fontWeight: 600 }
                : undefined
            }
          >
            Table
          </button>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="empty-note">No events in this range yet.</div>
      ) : view === "chart" ? (
        <Chart data={data} />
      ) : (
        <DailyTable data={data} />
      )}
    </div>
  );
}

function Chart({ data }: { data: DailyStats[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plot = useMemo(() => {
    const innerW = Math.max(width - PAD.left - PAD.right, 10);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const maxValue = Math.max(
      ...data.flatMap((d) => SERIES.map((s) => d[s.key])),
      1,
    );
    const ticks = niceTicks(maxValue);
    const yMax = ticks[ticks.length - 1];
    const x = (i: number) =>
      PAD.left +
      (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
    // ~6 x labels max, always include first and last
    const labelEvery = Math.max(1, Math.ceil(data.length / 6));
    return { innerW, innerH, ticks, yMax, x, y, labelEvery };
  }, [data, width]);

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + PAD.left;
    let nearest = 0;
    let best = Infinity;
    data.forEach((_, i) => {
      const d = Math.abs(plot.x(i) - px);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHover(nearest);
  }

  const tooltipLeft =
    hover === null
      ? 0
      : plot.x(hover) + (plot.x(hover) > width * 0.62 ? -170 : 14);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Daily activity by event type"
      >
        {/* gridlines + y ticks */}
        {plot.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={plot.y(t)}
              y2={plot.y(t)}
              stroke={t === 0 ? "var(--baseline)" : "var(--grid)"}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={plot.y(t) + 3.5}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {/* x labels */}
        {data.map((d, i) =>
          i % plot.labelEvery === 0 || i === data.length - 1 ? (
            <text
              key={d.day}
              x={plot.x(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {shortDate(d.day)}
            </text>
          ) : null,
        )}
        {/* crosshair */}
        {hover !== null && (
          <line
            x1={plot.x(hover)}
            x2={plot.x(hover)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="var(--baseline)"
            strokeWidth={1}
          />
        )}
        {/* series lines: 2px, round joins; end dots r=4 with 2px surface ring */}
        {SERIES.map((s) => {
          const path = data
            .map(
              (d, i) =>
                `${i === 0 ? "M" : "L"}${plot.x(i)},${plot.y(d[s.key])}`,
            )
            .join(" ");
          const last = data.length - 1;
          return (
            <g key={s.key}>
              <path
                d={path}
                fill="none"
                stroke={s.colorVar}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={plot.x(last)}
                cy={plot.y(data[last][s.key])}
                r={4}
                fill={s.colorVar}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
              {hover !== null && hover !== last && (
                <circle
                  cx={plot.x(hover)}
                  cy={plot.y(data[hover][s.key])}
                  r={4}
                  fill={s.colorVar}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
        {/* hover hit layer — whole plot, never just the 2px lines */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plot.innerW}
          height={plot.innerH}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <div
          className="chart-tooltip"
          style={{ left: tooltipLeft, top: PAD.top }}
        >
          <div className="tooltip-date">{shortDate(data[hover].day)}</div>
          {SERIES.map((s) => (
            <div className="tooltip-row" key={s.key}>
              <span className="legend-key" style={{ background: s.colorVar }} />
              <span className="name">{s.label}</span>
              <span className="value">
                {data[hover][s.key].toLocaleString()}
              </span>
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

function DailyTable({ data }: { data: DailyStats[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          {TREND_METRICS.map((m) => (
            <th className="num" key={m.key}>
              {m.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.day}>
            <td>{d.day}</td>
            {TREND_METRICS.map((m) => (
              <td className="num" key={m.key}>
                {d[m.key].toLocaleString()}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
