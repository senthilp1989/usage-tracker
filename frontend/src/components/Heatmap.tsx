import { fmt } from "../format";

export interface HeatCell {
  row: string;
  column: string;
  value: number;
}

/**
 * User × environment coverage grid. Every cell carries its number - colour is
 * reinforcement, never the only channel - using a single-hue sequential ramp
 * (slot 1) mixed against the surface. Never a rainbow ramp, and never colour
 * for nominal categories.
 */
export default function Heatmap({ cells }: { cells: HeatCell[] }) {
  if (cells.length === 0)
    return <div className="empty">No activity in this selection</div>;

  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  const byKey = new Map<string, number>();
  for (const c of cells) {
    byKey.set(
      `${c.row}|${c.column}`,
      (byKey.get(`${c.row}|${c.column}`) ?? 0) + c.value,
    );
    rowTotals.set(c.row, (rowTotals.get(c.row) ?? 0) + c.value);
    colTotals.set(c.column, (colTotals.get(c.column) ?? 0) + c.value);
  }
  const rows = [...rowTotals.keys()].sort(
    (a, b) => (rowTotals.get(b) ?? 0) - (rowTotals.get(a) ?? 0),
  );
  const columns = [...colTotals.keys()].sort(
    (a, b) => (colTotals.get(b) ?? 0) - (colTotals.get(a) ?? 0),
  );
  const max = Math.max(1, ...byKey.values());
  const grand = [...rowTotals.values()].reduce((a, b) => a + b, 0);

  return (
    <table className="heat">
      <thead>
        <tr>
          <th />
          {columns.map((c) => (
            <th className="rot" key={c}>
              {c}
            </th>
          ))}
          <th style={{ textAlign: "center", paddingLeft: 10 }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td className="rh" title={r}>
              {r}
            </td>
            {columns.map((c) => {
              const v = byKey.get(`${r}|${c}`) ?? 0;
              if (v === 0)
                return (
                  <td className="cell z" key={c}>
                    –
                  </td>
                );
              // Gamma-corrected mix so the low end stays distinguishable
              // instead of collapsing into the surface colour.
              const mix = 0.1 + 0.9 * (v / max) ** 0.62;
              return (
                <td
                  className="cell"
                  key={c}
                  title={`${r} · ${c}: ${fmt(v)} actions`}
                  style={{
                    background: `color-mix(in srgb, var(--s1) ${(mix * 100).toFixed(1)}%, var(--surface))`,
                    color: mix > 0.58 ? "#fff" : "var(--ink)",
                  }}
                >
                  {fmt(v)}
                </td>
              );
            })}
            <td className="tot">{fmt(rowTotals.get(r) ?? 0)}</td>
          </tr>
        ))}
        <tr>
          <td className="rh">Total</td>
          {columns.map((c) => (
            <td className="tot" key={c}>
              {fmt(colTotals.get(c) ?? 0)}
            </td>
          ))}
          <td className="tot">{fmt(grand)}</td>
        </tr>
      </tbody>
    </table>
  );
}
