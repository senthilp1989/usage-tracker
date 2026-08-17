import { useEffect, useMemo, useState } from "react";
import {
  fetchDaily,
  fetchEnvironmentIds,
  fetchSummary,
  fetchUserEmails,
  UnauthorizedError,
} from "./api";
import ArtifactsPanel from "./components/ArtifactsPanel";
import CreatedEventsTable from "./components/CreatedEventsTable";
import DailyTrend from "./components/DailyTrend";
import DocumentEventsTable from "./components/DocumentEventsTable";
import ExecutedEventsTable from "./components/ExecutedEventsTable";
import Filters, { presetRange, type Preset } from "./components/Filters";
import StatTile from "./components/StatTile";
import TestCaseDocumentEventsTable from "./components/TestCaseDocumentEventsTable";
import ThemeToggle from "./components/ThemeToggle";
import UsersTable from "./components/UsersTable";
import type { Theme } from "./theme";
import { type DailyStats, type DateRange, type StatsSummary } from "./types";

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
        test_case_documents_generated: 0,
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
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    setRange(presetRange(p, new Date()));
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const searchActive = debouncedSearch.trim().length >= MIN_SEARCH_LEN;
  // While searching, the search term overrides the two dropdown filters -
  // it's resolved server-side against the environment column, and doesn't
  // compose sensibly with the dropdown filters anyway.
  const scopedUser = searchActive ? [] : user;
  const scopedEnvironment = searchActive ? [] : environment;
  const searchParam = searchActive ? debouncedSearch : undefined;

  useEffect(() => {
    // Custom range starts with `to` empty (see Filters.tsx) - nothing is
    // fetched until the user picks an end date. Reset to the same zero
    // state a legitimately empty result set would produce, so the UI reads
    // as "no records" rather than a distinct "pick a date" mode.
    if (!range.to) {
      setSummary(null);
      setDaily([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSummary(range, scopedUser, scopedEnvironment, searchParam),
      fetchDaily(range, scopedUser, scopedEnvironment, searchParam),
      fetchUserEmails(),
      fetchEnvironmentIds(),
    ])
      .then(([s, d, emails, envIds]) => {
        if (cancelled) return;
        setSummary(s);
        setDaily(d);
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
  }, [range.from, range.to, scopedUser.join(","), scopedEnvironment.join(","), searchParam]);

  const searchHasNoMatches = searchActive && summary !== null && summary.users_reporting === 0;

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
            label="TSD documents generated"
            value={summary?.documents_generated ?? 0}
          />
          <StatTile
            label="Test cases executed"
            value={summary?.test_cases_executed ?? 0}
          />
          <StatTile
            label="Test case documents generated"
            value={summary?.test_case_documents_generated ?? 0}
          />
        </div>
        <DailyTrend data={filled} />
        <UsersTable range={range} userEmails={scopedUser} environment={scopedEnvironment} search={searchParam} />
        <CreatedEventsTable range={range} userEmails={scopedUser} environment={scopedEnvironment} search={searchParam} />
        <ExecutedEventsTable range={range} userEmails={scopedUser} environment={scopedEnvironment} search={searchParam} />
        <DocumentEventsTable range={range} userEmails={scopedUser} environment={scopedEnvironment} search={searchParam} />
        <TestCaseDocumentEventsTable
          range={range}
          userEmails={scopedUser}
          environment={scopedEnvironment}
          search={searchParam}
        />
        <ArtifactsPanel range={range} userEmails={scopedUser} environment={scopedEnvironment} search={searchParam} />
      </main>
    </>
  );
}
