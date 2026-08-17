import DatePicker from "./DatePicker";
import MultiSelect from "./MultiSelect";
import type { DateRange } from "../types";

export type Preset = "today" | "7d" | "30d" | "90d" | "custom";

const MAX_CUSTOM_RANGE_DAYS = 90;

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
      // `to` starts empty - nothing is fetched until the user explicitly
      // picks an end date (see Dashboard.tsx).
      return { from: iso(today), to: "" };
  }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

// The native date-picker calendar can only gray out/disable days via the
// input's own min/max - there's no way to style individual cells - so every
// bound that makes a date genuinely unselectable (future dates, and the
// 90-day span cap) has to be reflected in min/max, not just enforced after
// the fact, or the calendar would show those days as pickable.
function clampToMaxSpan(from: string, to: string): string {
  const maxTo = minIso(addDays(from, MAX_CUSTOM_RANGE_DAYS - 1), todayIso());
  return to > maxTo ? maxTo : to;
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
          <DatePicker
            value={range.from}
            max={todayIso()}
            onChange={(from) => onRangeChange({ from, to: "" })}
            ariaLabel="From date"
            placeholder="From"
          />
          <DatePicker
            value={range.to}
            min={range.from}
            max={range.from ? minIso(addDays(range.from, MAX_CUSTOM_RANGE_DAYS - 1), todayIso()) : todayIso()}
            onChange={(to) => onRangeChange({ ...range, to: clampToMaxSpan(range.from, to) })}
            ariaLabel="To date"
            placeholder="To"
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
