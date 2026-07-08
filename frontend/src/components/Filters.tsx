import type { DateRange } from "../types";

export type Preset = "today" | "7d" | "30d" | "90d" | "custom";

export function presetRange(preset: Preset, today: Date): DateRange {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "7d":
      return { from: iso(daysAgo(6)), to: iso(today) };
    case "30d":
      return { from: iso(daysAgo(29)), to: iso(today) };
    case "90d":
      return { from: iso(daysAgo(89)), to: iso(today) };
    case "custom":
      return { from: iso(daysAgo(29)), to: iso(today) };
  }
}

interface Props {
  preset: Preset;
  onPresetChange: (p: Preset) => void;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  userEmails: string[];
  user: string;
  onUserChange: (u: string) => void;
}

export default function Filters({
  preset,
  onPresetChange,
  range,
  onRangeChange,
  userEmails,
  user,
  onUserChange,
}: Props) {
  return (
    <div className="filters">
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as Preset)}
        aria-label="Date range"
      >
        <option value="today">Today</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="custom">Custom range</option>
      </select>
      {preset === "custom" && (
        <>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => onRangeChange({ ...range, from: e.target.value })}
            aria-label="From date"
          />
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => onRangeChange({ ...range, to: e.target.value })}
            aria-label="To date"
          />
        </>
      )}
      <select
        value={user}
        onChange={(e) => onUserChange(e.target.value)}
        aria-label="User filter"
      >
        <option value="">All users</option>
        {userEmails.map((email) => (
          <option key={email} value={email}>
            {email}
          </option>
        ))}
      </select>
    </div>
  );
}
