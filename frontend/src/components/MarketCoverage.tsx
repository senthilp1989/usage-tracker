import { fmt } from "../format";
import {
  COUNTRY,
  GLOBAL_CODE,
  marketName,
  marketOf,
  TILE,
  TILE_COLUMNS,
  TILE_ROWS,
  UNATTRIBUTED_CODE,
} from "../markets";
import { metricTuple, tupleTotal, type ArtifactStats } from "../types";

interface Market {
  code: string;
  total: number;
  interfaces: number;
  environments: Set<string>;
}

/**
 * Which markets' integrations are actually being tested, read from the
 * country prefix in each interface name.
 *
 * A schematic tile grid rather than a real map: every market gets equal
 * visual weight, its number fits inside its own tile, and nothing depends on
 * land area or on colour alone. The two off-map rows carry the activity that
 * can't be placed - multi-market interfaces, and anything with no usable
 * prefix - so the unattributable share stays visible rather than quietly
 * dropping out of the picture.
 *
 * Scoped by date, user and environment like everything else: /artifacts
 * filters on all three, so this panel honours the same slice as the rest of
 * the page.
 */
export default function MarketCoverage({
  artifacts,
  series,
}: {
  artifacts: ArtifactStats[];
  series: boolean[];
}) {
  const markets = new Map<string, Market>();
  for (const a of artifacts) {
    if (!a.interface_name) continue;
    const code = marketOf(a.interface_name);
    if (!markets.has(code))
      markets.set(code, {
        code,
        total: 0,
        interfaces: 0,
        environments: new Set(),
      });
    const market = markets.get(code)!;
    market.total += tupleTotal(metricTuple(a), series);
    market.interfaces += 1;
    if (a.environment) market.environments.add(a.environment);
  }

  // Every known market gets a tile, whether or not it appears in this slice:
  // "nobody has tested Spain" is the finding, and it only reads as one if
  // Spain is on the map with a dash in it.
  const onMap = Object.keys(TILE).map(
    (code) =>
      markets.get(code) ?? {
        code,
        total: 0,
        interfaces: 0,
        environments: new Set<string>(),
      },
  );
  const max = Math.max(1, ...onMap.map((m) => m.total));
  const covered = onMap.filter((m) => m.total > 0).length;
  const byTile = new Map(onMap.map((m) => [TILE[m.code].join(","), m]));

  const offMap = [
    {
      code: GLOBAL_CODE,
      label: "Multi-market interfaces — not attributable to one country",
    },
    {
      code: UNATTRIBUTED_CODE,
      label: "No country prefix — cannot be reported by market",
    },
  ]
    .map((row) => ({ ...row, market: markets.get(row.code) }))
    .filter((row) => row.market && row.market.total > 0);

  const busiest = onMap
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (artifacts.length === 0)
    return <div className="empty">No interface activity in this selection</div>;

  return (
    <>
      <p className="sub market-sub">
        {covered} of {Object.keys(TILE).length} known markets have recorded
        testing · {artifacts.length} interface · environment pairs in scope
      </p>
      <div className="tilewrap">
        <div>
          <div
            className="tilemap"
            role="img"
            aria-label={`Schematic tile map of tested markets: ${
              busiest.length
                ? busiest
                    .map((m) => `${marketName(m.code)} ${m.total}`)
                    .join(", ")
                : "no market has recorded testing in this period"
            }`}
          >
            {Array.from({ length: TILE_ROWS * TILE_COLUMNS }, (_, i) => {
              const row = Math.floor(i / TILE_COLUMNS) + 1;
              const column = (i % TILE_COLUMNS) + 1;
              const market = byTile.get(`${row},${column}`);
              if (!market) return <div className="tile blank" key={i} />;
              const label = COUNTRY[market.code] ?? market.code;
              const mix = market.total
                ? 0.12 + 0.88 * (market.total / max) ** 0.6
                : 0;
              return (
                <div
                  className="tile"
                  key={i}
                  title={
                    market.total
                      ? `${label} — ${fmt(market.total)} actions across ${market.interfaces} interface${market.interfaces === 1 ? "" : "s"} (${[...market.environments].join(", ")})`
                      : `${label} — no recorded testing in this period`
                  }
                  style={{
                    background: market.total
                      ? `color-mix(in srgb, var(--s1) ${(mix * 100).toFixed(1)}%, var(--surface))`
                      : "var(--surface-2)",
                    color: mix > 0.58 ? "#fff" : "var(--ink)",
                  }}
                >
                  <span className="cc">{market.code}</span>
                  <span className="n">
                    {market.total ? fmt(market.total) : "–"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="scale">
            <span>Fewer</span>
            <span className="ramp">
              {[12, 32, 52, 72, 100].map((a) => (
                <i
                  key={a}
                  style={{
                    background: `color-mix(in srgb, var(--s1) ${a}%, var(--surface))`,
                  }}
                />
              ))}
            </span>
            <span>More · max {fmt(max)}</span>
          </div>
        </div>
        <div className="offmap">
          {offMap.map((row) => (
            <div
              className="offrow"
              key={row.code}
              title={`${row.market!.interfaces} interfaces`}
            >
              <span className="cc">
                {row.code === UNATTRIBUTED_CODE ? "n/a" : row.code}
              </span>
              <span className="lb">{row.label}</span>
              <span className="n">{fmt(row.market!.total)}</span>
            </div>
          ))}
          {covered === 0 && (
            <div className="offrow note-row">
              <span className="lb">
                No interface in scope carries a recognised country prefix, so
                nothing can be placed on the map. Market attribution needs the
                leading token of the interface name to be an ISO country code.
              </span>
            </div>
          )}
          {busiest.length > 0 && (
            <div className="offrow busiest">
              <span className="lb">
                Busiest markets:{" "}
                {busiest
                  .map((m) => `${marketName(m.code)} (${fmt(m.total)})`)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
