import { useState } from "react";
import { addDays, fullDate, todayIso } from "../format";
import type { DateRange } from "../types";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function monthOf(value: string): { year: number; month: number } {
  const [y, m] = value.split("-").map(Number);
  return { year: y, month: m - 1 };
}

/**
 * Range picker for the period popover. One calendar, two endpoints — rather
 * than two separate single-date dialogs nested inside the popover, which was
 * both cramped and a `role="dialog"` inside a `role="listbox"`.
 *
 * Nothing commits until Apply, so a half-picked range never reaches the
 * dashboard: the old flow wrote an empty `to` straight through and every panel
 * on the page blanked to zero mid-edit, which read as breakage.
 */
export default function RangeCalendar({
  value,
  maxSpanDays,
  onApply,
  onBack,
}: {
  value: DateRange;
  maxSpanDays: number;
  onApply: (range: DateRange) => void;
  onBack: () => void;
}) {
  const [from, setFrom] = useState(value.from || "");
  const [to, setTo] = useState(value.to || "");
  const [editing, setEditing] = useState<"from" | "to">("from");
  const [view, setView] = useState(() => monthOf(value.from || todayIso()));

  const today = todayIso();
  // Picking the end date is bounded by the start and the span cap; picking the
  // start is bounded only by today.
  const min = editing === "to" && from ? from : "";
  const max =
    editing === "to" && from
      ? minIso(addDays(from, maxSpanDays - 1), today)
      : today;

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leading = new Date(view.year, view.month, 1).getDay();

  function shiftMonth(delta: number) {
    setView(({ year, month }) => {
      const m = month + delta;
      if (m < 0) return { year: year - 1, month: 11 };
      if (m > 11) return { year: year + 1, month: 0 };
      return { year, month: m };
    });
  }

  function pick(day: string) {
    if (editing === "from") {
      setFrom(day);
      // A start after the current end invalidates the end - drop it rather
      // than silently keeping an inverted range.
      if (to && (day > to || to > addDays(day, maxSpanDays - 1))) setTo("");
      setEditing("to");
    } else {
      setTo(day);
    }
  }

  const complete = Boolean(from && to);

  return (
    <div className="cal">
      <div className="cal-fields">
        <button
          type="button"
          className={`cal-field${editing === "from" ? " on" : ""}`}
          aria-pressed={editing === "from"}
          onClick={() => {
            setEditing("from");
            if (from) setView(monthOf(from));
          }}
        >
          <span>From</span>
          <b>{from ? fullDate(from) : "Pick a date"}</b>
        </button>
        <button
          type="button"
          className={`cal-field${editing === "to" ? " on" : ""}`}
          aria-pressed={editing === "to"}
          onClick={() => {
            setEditing("to");
            if (to) setView(monthOf(to));
            else if (from) setView(monthOf(from));
          }}
        >
          <span>To</span>
          <b>{to ? fullDate(to) : "Pick a date"}</b>
        </button>
      </div>

      <div className="cal-hd">
        <button
          type="button"
          className="cal-nav"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
        >
          ‹
        </button>
        <span className="cal-title" aria-live="polite">
          {MONTHS[view.month]} {view.year}
        </span>
        <button
          type="button"
          className="cal-nav"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
        >
          ›
        </button>
      </div>

      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((w) => (
          <span className="cal-wd" key={w}>
            {w}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span className="cal-day cal-day--empty" key={`e${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = iso(view.year, view.month, i + 1);
          const disabled = (!!min && day < min) || (!!max && day > max);
          const isEnd = day === from || day === to;
          const inRange = Boolean(from && to && day > from && day < to);
          return (
            <button
              type="button"
              key={day}
              className={[
                "cal-day",
                disabled ? "cal-day--off" : "",
                isEnd ? "cal-day--sel" : "",
                inRange ? "cal-day--in" : "",
                day === today && !isEnd ? "cal-day--today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={disabled}
              aria-label={fullDate(day)}
              onClick={() => pick(day)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <p className="cal-hint">
        {editing === "from"
          ? "Choose the start of the range."
          : `Choose the end — up to ${maxSpanDays} days from the start.`}
      </p>

      <div className="cal-foot">
        <button type="button" className="link-btn" onClick={onBack}>
          ‹ Presets
        </button>
        <button
          type="button"
          className="btn primary cal-apply"
          disabled={!complete}
          onClick={() => complete && onApply({ from, to })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}
