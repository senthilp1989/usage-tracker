export interface Delta {
  direction: "up" | "down" | "flat";
  text: string;
  /** True when there's no meaningful comparison to show (no prior-period data) - render muted, no arrow. */
  none: boolean;
}

export function computeDelta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { direction: "flat", text: "No change", none: true };
  if (previous === 0) return { direction: "flat", text: "No prior data", none: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { direction: "flat", text: "0%", none: false };
  return { direction: pct > 0 ? "up" : "down", text: `${pct > 0 ? "+" : ""}${pct}%`, none: false };
}
