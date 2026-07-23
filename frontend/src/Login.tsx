import { FormEvent, useState } from "react";
import { login, UnauthorizedError } from "./api";
import ThemeToggle from "./components/ThemeToggle";
import type { Theme } from "./theme";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      onLogin();
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? "Invalid username or password"
          : "Login failed — is the API running?",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <ThemeToggle
        theme={theme}
        onToggle={onToggleTheme}
        className="corner-toggle"
      />
      <form className="login-form card" onSubmit={submit}>
        <h1>TestEase Usage Tracker</h1>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <div className="login-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
