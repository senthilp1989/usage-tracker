import { useEffect, useMemo, useState } from "react";
import {
  fetchDaily,
  fetchEnvironmentIds,
  fetchSummary,
  fetchUserEmails,
  fetchUsers,
  UnauthorizedError,
} from "./api";
import DailyTrend from "./components/DailyTrend";
import Filters, { presetRange, type Preset } from "./components/Filters";
import StatTile from "./components/StatTile";
import ThemeToggle from "./components/ThemeToggle";
import UsersTable from "./components/UsersTable";
import type { Theme } from "./theme";
import type { DailyStats, DateRange, StatsSummary, UserStats } from "./types";

function zeroFill(range: DateRange, rows: DailyStats[]): DailyStats[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DailyStats[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    out.push(
      byDay.get(day) ?? {
        day,
        test_cases_created: 0,
        test_cases_executed: 0,
        documents_generated: 0,
      },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export default function Dashboard({
  onLogout,
  theme,
  onToggleTheme,
}: {
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState<DateRange>(() =>
    presetRange("30d", new Date()),
  );
  const [user, setUser] = useState("");
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [environment, setEnvironment] = useState("");
  const [environmentIds, setEnvironmentIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [users, setUsers] = useState<UserStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p, new Date()));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSummary(range, user || undefined, environment || undefined),
      fetchDaily(range, user || undefined, environment || undefined),
      fetchUsers(range, environment || undefined),
      fetchUserEmails(),
      fetchEnvironmentIds(),
    ])
      .then(([s, d, u, emails, envIds]) => {
        if (cancelled) return;
        setSummary(s);
        setDaily(d);
        setUsers(u);
        setUserEmails(emails);
        setEnvironmentIds(envIds);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) onLogout();
        else setError("Could not load data — is the API running?");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, user, environment]);

  const filled = useMemo(() => zeroFill(range, daily), [range, daily]);
  const visibleUsers = useMemo(
    () => (user ? users.filter((u) => u.user_email === user) : users),
    [users, user],
  );

  return (
    <>
      <header className="app-header">
        <h1>iVolve Usage Tracker</h1>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="link-button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className={`app-main${loading ? " loading-dim" : ""}`}>
        <Filters
          preset={preset}
          onPresetChange={applyPreset}
          range={range}
          onRangeChange={setRange}
          userEmails={userEmails}
          user={user}
          environmentIds={environmentIds}
          environment={environment}
          onEnvironmentChange={setEnvironment}
          onUserChange={setUser}
        />
        {error && <div className="card login-error">{error}</div>}
        <div className="kpi-row">
          <StatTile
            label="Users reporting"
            value={summary?.users_reporting ?? 0}
          />
          <StatTile
            label="Test cases created"
            value={summary?.test_cases_created ?? 0}
          />
          <StatTile
            label="Test cases executed"
            value={summary?.test_cases_executed ?? 0}
          />
          <StatTile
            label="Documents generated"
            value={summary?.documents_generated ?? 0}
          />
        </div>
        <DailyTrend data={filled} />
        <UsersTable rows={visibleUsers} range={range} />
      </main>
    </>
  );
}
