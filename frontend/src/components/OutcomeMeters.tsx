import { fmt } from "../format";
import { METRICS, type MetricTuple } from "../types";

interface Meter {
  label: string;
  display: string;
  /** Fill, 0-100. */
  pct: number;
  /** Where the target tick sits on the same 0-100 track. */
  targetPct: number;
  targetLabel: string;
  good: boolean;
  hint: string;
}

/**
 * Ratios, not volumes. Every other panel on this page answers "how much";
 * these four answer "is that good", which a raw count cannot - and each ships
 * the level worth holding it to as a tick on its own track, so the number is
 * readable without knowing the target by heart.
 *
 * The verdict is spelled out in words next to the bar: the fill colour is
 * status, and status colour never travels alone.
 */
export default function OutcomeMeters({
  created,
  executed,
  testCaseDocuments,
  dimensions,
  series,
  activeDays,
  windowDays,
  dimensionLabel,
}: {
  created: number;
  executed: number;
  testCaseDocuments: number;
  /** One entry per customer or environment in scope, for the breadth meter. */
  dimensions: { name: string; values: MetricTuple }[];
  series: boolean[];
  activeDays: number;
  windowDays: number;
  dimensionLabel: string;
}) {
  const activeMetrics = METRICS.map((_, i) => i).filter((i) => series[i]);
  const featureCount = Math.max(1, activeMetrics.length);
  const withActivity = dimensions.filter((d) =>
    activeMetrics.some((i) => d.values[i] > 0),
  );
  const breadthOf = (values: MetricTuple) =>
    activeMetrics.filter((i) => values[i] > 0).length;
  const averageBreadth = withActivity.length
    ? withActivity.reduce((sum, d) => sum + breadthOf(d.values), 0) /
      withActivity.length
    : 0;
  const usingAll = withActivity.filter(
    (d) => breadthOf(d.values) === featureCount,
  ).length;

  const depth = created ? executed / created : 0;
  const coverage = created ? (testCaseDocuments / created) * 100 : 0;
  const cadence = windowDays ? (activeDays / windowDays) * 100 : 0;
  // 3 of 4 features, rescaled when the legend has switched some off - the
  // target is "most of what's on screen", not a fixed count of four.
  const breadthTarget = Math.max(1, featureCount - 1);

  const meters: Meter[] = [
    {
      label: "Execution depth",
      display: created ? `${depth.toFixed(1)}×` : "—",
      pct: Math.min(100, (depth / 4) * 100),
      targetPct: 50,
      targetLabel: "the 2.0× target",
      good: depth >= 2,
      hint: `${fmt(executed)} runs from ${fmt(created)} cases`,
    },
    {
      label: "Documentation coverage",
      display: created ? `${Math.round(coverage)}%` : "—",
      pct: coverage,
      targetPct: 50,
      targetLabel: "the 50% target",
      good: coverage >= 50,
      hint: `${fmt(testCaseDocuments)} documents from ${fmt(created)} cases`,
    },
    {
      label: `Feature breadth per ${dimensionLabel}`,
      display: averageBreadth
        ? `${averageBreadth.toFixed(1)} / ${featureCount}`
        : "—",
      pct: (averageBreadth / featureCount) * 100,
      targetPct: (breadthTarget / featureCount) * 100,
      targetLabel: `${breadthTarget} of ${featureCount}`,
      good: averageBreadth >= breadthTarget,
      hint: `${usingAll} of ${withActivity.length} use all ${featureCount}`,
    },
    {
      label: "Usage cadence",
      display: `${activeDays} / ${windowDays} days`,
      pct: cadence,
      targetPct: 40,
      targetLabel: "40% of days",
      good: cadence >= 40,
      hint: "days in the period with any activity",
    },
  ];

  return (
    <div className="meters">
      {meters.map((m) => (
        <div className="meter" key={m.label}>
          <div className="m-top">
            <span className="m-label">{m.label}</span>
            <span
              className="m-val"
              style={m.good ? { color: "var(--good-text)" } : undefined}
            >
              {m.display}
            </span>
          </div>
          <div className="m-track">
            <div
              className="m-fill"
              style={{
                width: `${Math.max(0, Math.min(100, m.pct))}%`,
                background: m.good
                  ? "var(--good)"
                  : m.pct >= m.targetPct * 0.6
                    ? "var(--warning)"
                    : "var(--serious)",
              }}
            />
            <div
              className="m-target"
              style={{ left: `calc(${Math.min(100, m.targetPct)}% - 1px)` }}
              title={`target: ${m.targetLabel}`}
            />
          </div>
          <div className="m-foot">
            <span>{m.hint}</span>
            <span className={`verdict ${m.good ? "ok" : "no"}`}>
              {m.good ? "at or above " : "below "}
              {m.targetLabel}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
