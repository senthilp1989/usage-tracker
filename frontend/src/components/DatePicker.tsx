import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface YearMonth {
  year: number;
  month: number; // 0-11
}

function parseIso(iso: string): (YearMonth & { day: number }) | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: month - 1, day };
}

function toIso(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function formatDisplay(iso: string): string {
  const parsed = parseIso(iso);
  if (!parsed) return "";
  return `${parsed.day} ${MONTHS[parsed.month].slice(0, 3)} ${parsed.year}`;
}

function currentYearMonth(): YearMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

interface Props {
  value: string; // "" or YYYY-MM-DD
  min?: string;
  max?: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}

// A self-drawn calendar grid, not a native <input type="date">. The native
// picker's disabled/enabled day styling is entirely browser/OS-controlled -
// on several browsers out-of-range days are barely distinguishable from
// selectable ones - so this renders both states itself (grayed-out/disabled
// vs. white/clickable) via our own CSS, deterministically across browsers.
export default function DatePicker({ value, min, max, onChange, ariaLabel, placeholder = "Select date" }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<YearMonth>(
    () => parseIso(value) ?? parseIso(max ?? "") ?? currentYearMonth(),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openPanel() {
    setView(parseIso(value) ?? parseIso(max ?? "") ?? currentYearMonth());
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    setView(({ year, month }) => {
      let m = month + delta;
      let y = year;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      return { year: y, month: m };
    });
  }

  const cells = useMemo(() => {
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const leading = new Date(view.year, view.month, 1).getDay();
    return [
      ...Array.from({ length: leading }, () => null as number | null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }, [view]);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="datepicker" ref={rootRef}>
      <button
        type="button"
        className="datepicker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {value ? formatDisplay(value) : <span className="datepicker-placeholder">{placeholder}</span>}
      </button>
      {open && (
        <div className="datepicker-panel" role="dialog" aria-label={ariaLabel}>
          <div className="datepicker-header">
            <button
              type="button"
              className="datepicker-nav"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
            <span className="datepicker-title">
              {MONTHS[view.month]} {view.year}
            </span>
            <button type="button" className="datepicker-nav" aria-label="Next month" onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="datepicker-grid">
            {WEEKDAYS.map((w) => (
              <span className="datepicker-weekday" key={w}>
                {w}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span className="datepicker-day datepicker-day--empty" key={`empty-${i}`} />;
              const iso = toIso(view.year, view.month, day);
              const disabled = (!!min && iso < min) || (!!max && iso > max);
              const selected = iso === value;
              const isToday = iso === todayIso;
              return (
                <button
                  type="button"
                  key={iso}
                  className={[
                    "datepicker-day",
                    disabled ? "datepicker-day--disabled" : "",
                    selected ? "datepicker-day--selected" : "",
                    isToday && !selected ? "datepicker-day--today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
