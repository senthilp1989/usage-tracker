/**
 * Market attribution, read from the country prefix in an interface name.
 *
 * Interface identifiers are written `AU_IT_IF_CI20450_DBECC_MFT_StandardCost`
 * - the leading token is an ISO country code. That makes "which markets'
 * integrations are actually being tested" answerable from data already on the
 * page, with no new column anywhere.
 *
 * Two escape hatches, both deliberate: `GLO` marks a multi-market interface
 * that belongs to no single country, and anything whose prefix isn't a
 * recognised code is reported as unattributed rather than guessed at. Both
 * are shown off-map, next to the grid, so the share of activity that *can't*
 * be placed on a map stays visible instead of quietly vanishing.
 */

export const COUNTRY: Record<string, string> = {
  AU: "Australia",
  AT: "Austria",
  BE: "Belgium",
  CH: "Switzerland",
  EC: "Ecuador",
  ES: "Spain",
  FJ: "Fiji",
  MX: "Mexico",
  NG: "Nigeria",
  NZ: "New Zealand",
  PT: "Portugal",
  SG: "Singapore",
  SK: "Slovakia",
  US: "United States",
};

/** Schematic [row, column] slots on a 4x10 tile grid - a rough world layout,
 *  not a projection. A tile map beats a real map here: every market gets the
 *  same visual weight and its number fits inside the tile, so nothing depends
 *  on area or on colour alone. */
export const TILE: Record<string, [number, number]> = {
  US: [1, 1],
  MX: [2, 1],
  EC: [3, 2],
  BE: [1, 5],
  SK: [1, 7],
  PT: [2, 4],
  ES: [2, 5],
  CH: [2, 6],
  AT: [2, 7],
  NG: [3, 5],
  SG: [3, 8],
  FJ: [3, 10],
  AU: [4, 9],
  NZ: [4, 10],
};

export const TILE_ROWS = 4;
export const TILE_COLUMNS = 10;

/** Multi-market interfaces, and the bucket for everything with no usable
 *  prefix. Neither sits on the grid. */
export const GLOBAL_CODE = "GLO";
export const UNATTRIBUTED_CODE = "—";

export function marketOf(interfaceName: string): string {
  const prefix = interfaceName.split("_")[0]?.toUpperCase() ?? "";
  if (COUNTRY[prefix]) return prefix;
  if (/FIJI/i.test(interfaceName)) return "FJ";
  if (prefix === GLOBAL_CODE) return GLOBAL_CODE;
  return UNATTRIBUTED_CODE;
}

export function marketName(code: string): string {
  if (code === GLOBAL_CODE) return "Multi-market";
  if (code === UNATTRIBUTED_CODE) return "No country prefix";
  return COUNTRY[code] ?? code;
}
