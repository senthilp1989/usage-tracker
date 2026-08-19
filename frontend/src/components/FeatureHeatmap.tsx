import { fmt } from "../format";
import { METRICS, type MetricTuple } from "../types";

export interface FeatureRow {
  name: string;
  values: MetricTuple;
}

export type FeatureMode = "count" | "share";

/**
 * Which of the four features each customer (or environment) actually uses.
 *
 * Adoption is not one number: a customer that only generates documents is
 * using a quarter of the product, and a headline total hides that completely.
 * The "Breadth" column is the point of the panel - the heatmap shows where
 * the volume is, breadth shows how much of the product it covers.
 *
 * Every cell carries its number, as everywhere else on the page: the
 * sequential ramp is slot 1, which sits below 3:1 on white, so colour is
 * never the only channel.
 */
export default function FeatureHeatmap({
  rows,
  series,
  mode,
}: {
  rows: FeatureRow[];
  series: boolean[];
  mode: FeatureMode;
}) {
  if (rows.length === 0)
    return <div className="empty">No activity in this selection</div>;

  const active = METRICS.map((m, i) => ({ ...m, index: i })).filter(
    (_, i) => series[i],
  );
  if (active.length === 0)
    return <div className="empty">Every metric is switched off</div>;

  const ordered = [...rows]
    .map((r) => ({
      ...r,
      total: active.reduce((sum, m) => sum + r.values[m.index], 0),
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  if (ordered.length === 0)
    return <div className="empty">No activity in this selection</div>;

  const columnTotals = active.map((m) =>
    ordered.reduce((sum, r) => sum + r.values[m.index], 0),
  );
  const grand = columnTotals.reduce((a, b) => a + b, 0);
  // In share mode a row's cells are percentages of that row, so the ramp has
  // a fixed 0-100 domain; in count mode it scales to the busiest cell.
  const max =
    mode === "share"
      ? 100
      : Math.max(
          1,
          ...ordered.flatMap((r) => active.map((m) => r.values[m.index])),
        );

  return (
    <table className="heat">
      <thead>
        <tr>
          <th />
          {active.map((m) => (
            <th className="feat" key={m.key}>
              <span className="k-dot" style={{ background: m.colorVar }} />
              {m.label}
            </th>
          ))}
          <th className="ctr">Breadth</th>
          <th className="ctr">Total</th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((r) => {
          const used = active.filter((m) => r.values[m.index] > 0).length;
          return (
            <tr key={r.name}>
              <td className="rh" title={r.name}>
                {r.name}
              </td>
              {active.map((m) => {
                const raw = r.values[m.index];
                if (raw === 0)
                  return (
                    <td className="cell z" key={m.key}>
                      –
                    </td>
                  );
                const share = r.total ? (raw / r.total) * 100 : 0;
                const value = mode === "share" ? share : raw;
                const mix = 0.1 + 0.9 * (value / max) ** 0.62;
                return (
                  <td
                    className="cell"
                    key={m.key}
                    title={`${r.name} · ${m.label}: ${fmt(raw)} actions (${Math.round(share)}% of this row)`}
                    style={{
                      background: `color-mix(in srgb, var(--s1) ${(mix * 100).toFixed(1)}%, var(--surface))`,
                      color: mix > 0.58 ? "#fff" : "var(--ink)",
                    }}
                  >
                    {mode === "share" ? `${Math.round(share)}%` : fmt(raw)}
                  </td>
                );
              })}
              <td
                className={`tot breadth${used === active.length ? " full" : used === 1 ? " thin" : ""}`}
                title={`${used} of ${active.length} features used`}
              >
                {used}/{active.length}
              </td>
              <td className="tot">{fmt(r.total)}</td>
            </tr>
          );
        })}
        <tr>
          <td className="rh">Total</td>
          {active.map((m, i) => (
            <td className="tot" key={m.key}>
              {fmt(columnTotals[i])}
            </td>
          ))}
          <td className="tot" />
          <td className="tot">{fmt(grand)}</td>
        </tr>
      </tbody>
    </table>
  );
}
