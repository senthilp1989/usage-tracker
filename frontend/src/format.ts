const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const fmt = (n: number): string => n.toLocaleString("en-US");

/** "11 Aug" - axis ticks and dense labels. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** "11 Aug 2026" - tooltips, captions, table cells. */
export function fullDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Inclusive day count spanned by a range, e.g. from === to is 1 day. */
export function spanDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Gridline steps at nice round values: 1/2/2.5/5 × 10ⁿ. */
export function niceStep(max: number): number {
  const rough = Math.max(max, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  return (
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10
  );
}

export function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number)[][],
): void {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [
    header.map(cell).join(","),
    ...rows.map((r) => r.map(cell).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([body], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
