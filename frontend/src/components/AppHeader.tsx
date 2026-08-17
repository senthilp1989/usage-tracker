import logoUrl from "../assets/tarento-logo.png";
import type { Theme } from "../theme";

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || "??";
}

export default function AppHeader({
  account,
  theme,
  onToggleTheme,
  onLogout,
}: {
  account: string;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  // The toggle reads as the mode you'd switch *to*, not the one you're in.
  const target = theme === "light" ? "Dark" : "Light";
  return (
    <header className="app">
      <div className="app-in">
        <div className="brand">
          {/* The mark's upper bars are #18293c - all but identical to the
              header navy - so it sits on a light chip rather than losing half
              of itself into the background. */}
          <span className="mark">
            <img src={logoUrl} alt="Tarento" />
          </span>
          <span>TARENTO</span>
          <span className="div" />
          <span className="prod">
            <b>TestEase</b> Usage Tracker
          </span>
        </div>
        <div className="spacer" />
        <button
          className="ghost"
          onClick={onToggleTheme}
          aria-label={`Switch to ${target.toLowerCase()} mode`}
        >
          {theme === "light" ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          )}
          <span>{target}</span>
        </button>
        <button className="ghost" onClick={onLogout}>
          Sign out
        </button>
        <div className="avatar" title={account}>
          {initials(account)}
        </div>
      </div>
    </header>
  );
}
