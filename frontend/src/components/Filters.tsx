import MultiSelect from "./MultiSelect";
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
  user: string[];
  onUserChange: (u: string[]) => void;
  environmentIds: string[];
  environment: string[];
  onEnvironmentChange: (e: string[]) => void;
  search: string;
  onSearchChange: (s: string) => void;
  searchOverriding: boolean;
}

export default function Filters({
  preset,
  onPresetChange,
  range,
  onRangeChange,
  userEmails,
  user,
  onUserChange,
  environmentIds,
  environment,
  onEnvironmentChange,
  search,
  onSearchChange,
  searchOverriding,
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
      <div className={searchOverriding ? "filters-overridden" : undefined} title={searchOverriding ? "Overridden by search" : undefined}>
        <MultiSelect
          label="User filter"
          placeholder="All users"
          options={userEmails}
          selected={user}
          onChange={onUserChange}
        />
      </div>
      <div className={searchOverriding ? "filters-overridden" : undefined} title={searchOverriding ? "Overridden by search" : undefined}>
        <MultiSelect
          label="Environment filter"
          placeholder="All environments"
          options={environmentIds}
          selected={environment}
          onChange={onEnvironmentChange}
        />
      </div>
      <input
        type="search"
        className="filters-search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search environments…"
        aria-label="Search environments"
        title="Searching overrides the User and Environment filters above"
      />
    </div>
  );
}
