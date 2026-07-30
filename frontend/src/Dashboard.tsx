import { useEffect, useMemo, useState } from "react";
import {
  fetchCreatedEvents,
  fetchDaily,
  fetchEnvironmentIds,
  fetchExecutedEvents,
  fetchSummary,
  fetchUserEmails,
  fetchUsers,
  UnauthorizedError,
} from "./api";
import ArtifactsPanel from "./components/ArtifactsPanel";
import CreatedEventsTable from "./components/CreatedEventsTable";
import DailyTrend from "./components/DailyTrend";
import ExecutedEventsTable from "./components/ExecutedEventsTable";
import Filters, { presetRange, type Preset } from "./components/Filters";
import PassFailPie from "./components/PassFailPie";
import PassRateMeter from "./components/PassRateMeter";
import StatTile from "./components/StatTile";
import ThemeToggle from "./components/ThemeToggle";
import UsersTable from "./components/UsersTable";
import type { Theme } from "./theme";
import {
  METRICS,
  type CreatedEventDetail,
  type DailyStats,
  type DateRange,
  type ExecutedEventDetail,
  type StatsSummary,
  type UserStats,
} from "./types";
import { fuzzyMatch } from "./fuzzy";

const MIN_SEARCH_LEN = 2;

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
        test_cases_passed: 0,
        test_cases_failed: 0,
      },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function summarizeRows(rows: UserStats[]): StatsSummary {
  const totals = {
    test_cases_created: 0,
    test_cases_executed: 0,
    documents_generated: 0,
    test_cases_passed: 0,
    test_cases_failed: 0,
  };
  for (const row of rows) {
    for (const metric of METRICS) totals[metric.key] += row[metric.key];
  }
  return { users_reporting: new Set(rows.map((r) => r.user_email)).size, ...totals };
}

function dailyFromRows(rows: UserStats[]): DailyStats[] {
  const byDay = new Map<string, DailyStats>();
  for (const row of rows) {
    const entry = byDay.get(row.report_date) ?? {
      day: row.report_date,
      test_cases_created: 0,
      test_cases_executed: 0,
      documents_generated: 0,
      test_cases_passed: 0,
      test_cases_failed: 0,
    };
    for (const metric of METRICS) entry[metric.key] += row[metric.key];
    byDay.set(row.report_date, entry);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
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
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState<DateRange>(() =>
    presetRange("today", new Date()),
  );
  const [user, setUser] = useState<string[]>([]);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<string[]>([]);
  const [environmentIds, setEnvironmentIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [serverSummary, setServerSummary] = useState<StatsSummary | null>(null);
  const [serverDaily, setServerDaily] = useState<DailyStats[]>([]);
  const [rawUsers, setRawUsers] = useState<UserStats[]>([]);
  const [rawCreatedEvents, setRawCreatedEvents] = useState<CreatedEventDetail[]>([]);
  const [rawExecutedEvents, setRawExecutedEvents] = useState<ExecutedEventDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p, new Date()));
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const searchActive = debouncedSearch.trim().length >= MIN_SEARCH_LEN;
  // While searching, the search term overrides the two dropdown filters —
  // scope the fetch to the date range alone and let the client-side fuzzy
  // filter below narrow it further, instead of asking the server for an
  // ID list (a broad term like "ta" could match dozens of emails sharing a
  // domain, which doesn't compose sensibly with the dropdown filters anyway).
  const scopedUser = searchActive ? [] : user;
  const scopedEnvironment = searchActive ? [] : environment;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSummary(range, scopedUser, scopedEnvironment),
      fetchDaily(range, scopedUser, scopedEnvironment),
      fetchUsers(range, scopedUser, scopedEnvironment),
      fetchCreatedEvents(range, scopedUser, scopedEnvironment),
      fetchExecutedEvents(range, scopedUser, scopedEnvironment),
      fetchUserEmails(),
      fetchEnvironmentIds(),
    ])
      .then(([s, d, u, created, executed, emails, envIds]) => {
        if (cancelled) return;
        setServerSummary(s);
        setServerDaily(d);
        setRawUsers(u);
        setRawCreatedEvents(created);
        setRawExecutedEvents(executed);
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
  }, [range.from, range.to, scopedUser.join(","), scopedEnvironment.join(","), searchActive]);

  const users = useMemo(
    () =>
      searchActive
        ? rawUsers.filter((r) => fuzzyMatch(debouncedSearch, r.environment))
        : rawUsers,
    [rawUsers, searchActive, debouncedSearch],
  );
  const createdEvents = useMemo(
    () =>
      searchActive
        ? rawCreatedEvents.filter((r) => fuzzyMatch(debouncedSearch, r.environment))
        : rawCreatedEvents,
    [rawCreatedEvents, searchActive, debouncedSearch],
  );
  const executedEvents = useMemo(
    () =>
      searchActive
        ? rawExecutedEvents.filter((r) => fuzzyMatch(debouncedSearch, r.environment))
        : rawExecutedEvents,
    [rawExecutedEvents, searchActive, debouncedSearch],
  );
  const summary = searchActive ? summarizeRows(users) : serverSummary;
  const daily = searchActive ? dailyFromRows(users) : serverDaily;
  const searchHasNoMatches = searchActive && users.length === 0;

  // "Test cases executed" here (and pass rate) are derived from passed+failed,
  // not sent or stored as their own fields - QUEUED/RUNNING/STALED/CANCELLED runs
  // are deliberately excluded. This is narrower than the underlying
  // test_cases_executed field (still collected/sent, just no longer shown here),
  // which counts every triggered execution regardless of terminal status.
  const kpiExecutions = (summary?.test_cases_passed ?? 0) + (summary?.test_cases_failed ?? 0);
  const kpiPassRate = kpiExecutions > 0 ? (summary!.test_cases_passed / kpiExecutions) * 100 : null;

  const filled = useMemo(() => zeroFill(range, daily), [range, daily]);

  return (
    <>
      <header className="app-header">
        <h1>TestEase Usage Tracker</h1>
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
          search={search}
          onSearchChange={setSearch}
          searchOverriding={searchActive}
        />
        {error && <div className="card login-error">{error}</div>}
        {searchHasNoMatches && (
          <div className="card login-error">No environments match “{debouncedSearch}”.</div>
        )}
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
            label="Documents generated"
            value={summary?.documents_generated ?? 0}
          />
          <StatTile label="Test cases executed" value={kpiExecutions} />
          <StatTile
            label="Pass rate"
            value={kpiPassRate ?? 0}
            format={(n) => (kpiPassRate === null ? "—" : `${n.toFixed(1)}%`)}
          />
          <StatTile
            label="Test cases passed"
            value={summary?.test_cases_passed ?? 0}
          />
          <StatTile
            label="Test cases failed"
            value={summary?.test_cases_failed ?? 0}
          />
        </div>
        <div className="pie-row">
          <PassFailPie passed={summary?.test_cases_passed ?? 0} failed={summary?.test_cases_failed ?? 0} />
          <PassRateMeter passed={summary?.test_cases_passed ?? 0} failed={summary?.test_cases_failed ?? 0} />
        </div>
        <DailyTrend data={filled} />
        <UsersTable rows={users} range={range} />
        <CreatedEventsTable rows={createdEvents} range={range} />
        <ExecutedEventsTable rows={executedEvents} range={range} />
        <ArtifactsPanel
          range={range}
          userEmails={scopedUser}
          environment={scopedEnvironment}
          searchActive={searchActive}
          searchTerm={debouncedSearch}
        />
      </main>
    </>
  );
}
