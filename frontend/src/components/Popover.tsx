import { useEffect, useRef, type ReactNode } from "react";

/**
 * Filter-bar popover: a labelled trigger plus an anchored panel. Escape and
 * outside-click both close it, and the trigger carries `aria-expanded` while
 * the panel is the labelled listbox.
 */
export default function Popover({
  label,
  ariaLabel,
  icon,
  count,
  open,
  onOpenChange,
  wide,
  children,
}: {
  label: string;
  ariaLabel: string;
  icon: ReactNode;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        onOpenChange(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="ctl" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => onOpenChange(!open)}
      >
        {icon}
        <span>{label}</span>
        {count != null && count > 1 && (
          <span className="pill-count">{count}</span>
        )}
        <svg
          className="caret"
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M1 3.5 5 7.5 9 3.5Z" />
        </svg>
      </button>
      {/* The panel is a plain container - the caller puts role="listbox" on its
          own option list, so a panel holding a calendar rather than options
          isn't mislabelled as one. */}
      {open && (
        <div className={`pop${wide ? " wide" : ""}`} aria-label={ariaLabel}>
          {children}
        </div>
      )}
    </div>
  );
}
