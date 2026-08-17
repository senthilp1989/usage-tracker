import { useState } from "react";
import { fmt, fullDate } from "../format";
import type { DateRange } from "../types";
import Popover from "./Popover";
import RangeCalendar from "./RangeCalendar";

export type Preset = "today" | "7d" | "30d" | "90d" | "custom";

const MAX_CUSTOM_RANGE_DAYS = 90;

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
];

export const DEFAULT_PRESET: Preset = "90d";

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
      // Never actually rendered: "custom" is only ever set from the
      // calendar's Apply, which sets the real range in the same batched
      // update. Present so the switch stays exhaustive.
      return { from: iso(today), to: iso(today) };
  }
}

const CalendarIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const UserIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </svg>
);

const EnvIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M7 7h.01M7 17h.01" />
  </svg>
);

interface Props {
  preset: Preset;
  onPresetChange: (p: Preset) => void;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  userEmails: string[];
  user: string[];
  onUserChange: (u: string[]) => void;
  /** Action count per user for the current period, for the option rows. */
  userCounts: Record<string, number>;
  environmentIds: string[];
  environment: string[];
  onEnvironmentChange: (e: string[]) => void;
  environmentCounts: Record<string, number>;
  onReset: () => void;
  onExport: () => void;
  exportDisabled: boolean;
}

export default function FilterBar({
  preset,
  onPresetChange,
  range,
  onRangeChange,
  userEmails,
  user,
  onUserChange,
  userCounts,
  environmentIds,
  environment,
  onEnvironmentChange,
  environmentCounts,
  onReset,
  onExport,
  exportDisabled,
}: Props) {
  const [openPop, setOpenPop] = useState<"range" | "user" | "env" | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const setOpen = (id: "range" | "user" | "env") => (open: boolean) =>
    setOpenPop(open ? id : null);

  const rangeLabel =
    preset === "custom"
      ? `${fullDate(range.from)} – ${fullDate(range.to)}`
      : (PRESETS.find((p) => p.id === preset)?.label ?? "Last 90 days");

  const offDefault =
    user.length > 0 || environment.length > 0 || preset !== DEFAULT_PRESET;

  return (
    <div className="filters">
      <div className="filters-in">
        <span className="fl">Period</span>
        <Popover
          label={rangeLabel}
          ariaLabel="Date range"
          icon={CalendarIcon}
          open={openPop === "range"}
          onOpenChange={(open) => {
            setOpenPop(open ? "range" : null);
            if (!open) setCalendarOpen(false);
          }}
          wide={calendarOpen}
        >
          {calendarOpen ? (
            <RangeCalendar
              value={range}
              maxSpanDays={MAX_CUSTOM_RANGE_DAYS}
              onApply={(next) => {
                onPresetChange("custom");
                onRangeChange(next);
                setCalendarOpen(false);
                setOpenPop(null);
              }}
              onBack={() => setCalendarOpen(false)}
            />
          ) : (
            <>
              <div
                className="pop-list"
                role="listbox"
                aria-label="Date range presets"
              >
                {PRESETS.map((p) => (
                  <button
                    type="button"
                    className="pop-row"
                    key={p.id}
                    role="option"
                    aria-selected={preset === p.id}
                    onClick={() => {
                      onPresetChange(p.id);
                      setOpenPop(null);
                    }}
                  >
                    <span className="ck">✓</span>
                    <span className="nm">{p.label}</span>
                  </button>
                ))}
              </div>
              <div className="pop-foot">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setCalendarOpen(true)}
                >
                  Custom range…
                </button>
              </div>
            </>
          )}
        </Popover>

        <span className="fl" style={{ marginLeft: 8 }}>
          Scope
        </span>
        <MultiPopover
          id="user"
          openPop={openPop}
          setOpen={setOpen}
          icon={UserIcon}
          noun="users"
          ariaLabel="Users"
          options={userEmails}
          counts={userCounts}
          selected={user}
          onChange={onUserChange}
        />
        <MultiPopover
          id="env"
          openPop={openPop}
          setOpen={setOpen}
          icon={EnvIcon}
          noun="environments"
          ariaLabel="Environments"
          options={environmentIds}
          counts={environmentCounts}
          selected={environment}
          onChange={onEnvironmentChange}
        />

        {/* No chips for the active selection - the dropdown's own label and
            count pill already say what's selected, and deselecting happens in
            the popover or via Reset. */}
        <div className="spacer" />
        {offDefault && (
          <button className="btn" onClick={onReset}>
            Reset
          </button>
        )}
        <button className="btn" onClick={onExport} disabled={exportDisabled}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
          </svg>
          Export
        </button>
      </div>
    </div>
  );
}

/**
 * Multi-select combobox. Each row carries the option's action count for the
 * current period, and the type-to-filter box narrows long option lists (the
 * environment list in particular) - "Select all" then applies to whatever is
 * currently visible, which is what replaced the old standalone environment
 * search box.
 */
function MultiPopover({
  id,
  openPop,
  setOpen,
  icon,
  noun,
  ariaLabel,
  options,
  counts,
  selected,
  onChange,
}: {
  id: "user" | "env";
  openPop: string | null;
  setOpen: (id: "range" | "user" | "env") => (open: boolean) => void;
  icon: React.ReactNode;
  noun: string;
  ariaLabel: string;
  options: string[];
  counts: Record<string, number>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const open = openPop === id;
  const visible = query.trim()
    ? options.filter((o) =>
        o.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  const label =
    selected.length === 0
      ? `All ${noun}`
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${noun}`;

  return (
    <Popover
      label={label}
      ariaLabel={ariaLabel}
      icon={icon}
      count={selected.length}
      open={open}
      onOpenChange={setOpen(id)}
    >
      <div className="pop-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${noun}…`}
          aria-label={`Filter ${noun}`}
        />
      </div>
      <div
        className="pop-list"
        role="listbox"
        aria-multiselectable="true"
        aria-label={ariaLabel}
      >
        {visible.length === 0 ? (
          <div className="pop-row" style={{ color: "var(--muted)" }}>
            No matches
          </div>
        ) : (
          visible.map((o) => (
            <button
              type="button"
              className="pop-row"
              key={o}
              role="option"
              aria-selected={selected.includes(o)}
              onClick={() =>
                onChange(
                  selected.includes(o)
                    ? selected.filter((v) => v !== o)
                    : [...selected, o],
                )
              }
            >
              <span className="ck">✓</span>
              <span className="nm" title={o}>
                {o}
              </span>
              <span className="meta">{fmt(counts[o] ?? 0)}</span>
            </button>
          ))
        )}
      </div>
      <div className="pop-foot">
        <button
          type="button"
          className="link-btn"
          onClick={() => onChange(visible)}
        >
          Select all
        </button>
        <button type="button" className="link-btn" onClick={() => onChange([])}>
          Clear
        </button>
      </div>
    </Popover>
  );
}
