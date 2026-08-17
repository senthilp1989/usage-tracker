import { FormEvent, useState } from "react";
import { login, UnauthorizedError } from "./api";
import logoUrl from "./assets/tarento-logo.png";
import type { Theme } from "./theme";

const HIGHLIGHTS = [
  "Test cases created and executed",
  "Documents generated per interface",
  "Adoption by user, environment and day",
];

export default function Login({
  onLogin,
  theme,
  onToggleTheme,
}: {
  onLogin: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = username.trim().length > 0 && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      onLogin();
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? "That username and password don't match."
          : "Couldn't reach the server — is the API running?",
      );
    } finally {
      setBusy(false);
    }
  }

  const target = theme === "light" ? "Dark" : "Light";

  return (
    <div className="auth">
      <button
        type="button"
        className="btn auth-theme"
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
        {target}
      </button>

      {/* Shares the dashboard hero's aurora so signing in reads as the same
          product, not a separate gate in front of it. */}
      <div className={`auth-card${error ? " shake" : ""}`}>
        <aside className="auth-brand">
          <div className="auth-brand-top">
            <span className="mark">
              <img src={logoUrl} alt="Tarento" />
            </span>
            <span>TARENTO</span>
          </div>
          <div>
            <h1>
              <b>TestEase</b> Usage&nbsp;Tracker
            </h1>
            <p>
              Who is using Test Ease, where, and how much — measured from the
              raw event stream.
            </p>
            <ul className="auth-points">
              {HIGHLIGHTS.map((h) => (
                <li key={h}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                  {h}
                </li>
              ))}
            </ul>
          </div>
          <p className="auth-foot">Internal tool · Tarento</p>
        </aside>

        <form className="auth-form" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="auth-sub">
            Use your dashboard credentials to continue.
          </p>

          <label className="auth-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              placeholder="e.g. testease"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input">
              <input
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                onBlur={() => setCapsLock(false)}
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="auth-reveal"
                onClick={() => setReveal((r) => !r)}
                aria-pressed={reveal}
                aria-label={reveal ? "Hide password" : "Show password"}
                tabIndex={0}
              >
                {reveal ? (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.4 5.3A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.5M6.2 6.7C4.2 8.1 3 10.2 3 12c0 2.5 4 7 9 7a9.6 9.6 0 0 0 3.6-.7" />
                  </svg>
                ) : (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M3 12c0-2.5 4-7 9-7s9 4.5 9 7-4 7-9 7-9-4.5-9-7Z" />
                    <circle cx="12" cy="12" r="2.6" />
                  </svg>
                )}
              </button>
            </div>
          </label>

          {capsLock && (
            <p className="auth-hint" role="status">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4 4 12h4v4h8v-4h4L12 4ZM8 20h8" />
              </svg>
              Caps Lock is on
            </p>
          )}

          {error && (
            <p className="auth-error" role="alert">
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
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5h.01" />
              </svg>
              {error}
            </p>
          )}

          <button
            className="btn primary auth-submit"
            type="submit"
            disabled={!ready || busy}
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>

          <p className="auth-note">Sessions last 12 hours.</p>
        </form>
      </div>
    </div>
  );
}
