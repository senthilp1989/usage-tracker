import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}

export default function MultiSelect({ label, placeholder, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
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

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  }

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="multiselect" ref={rootRef}>
      <button
        type="button"
        className="multiselect-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
        <span className="multiselect-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="multiselect-panel" role="listbox" aria-multiselectable="true">
          <div className="multiselect-actions">
            <button type="button" onClick={() => onChange(options)} disabled={selected.length === options.length}>
              Select all
            </button>
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0}>
              Clear
            </button>
          </div>
          <div className="multiselect-options">
            {options.length === 0 ? (
              <div className="multiselect-empty">No options</div>
            ) : (
              options.map((option) => (
                <label key={option} className="multiselect-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggle(option)}
                  />
                  {option}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
