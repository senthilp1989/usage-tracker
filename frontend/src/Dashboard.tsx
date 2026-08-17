import { useEffect, useMemo, useState } from "react";
import {
  fetchArtifactsExport,
  fetchDaily,
  fetchEnvironmentIds,
  fetchSummary,
  fetchUserEmails,
  fetchUserEnvironmentRollup,
  UnauthorizedError,
} from "./api";
import ArtifactsPanel from "./components/ArtifactsPanel";
import CreatedEventsTable from "./components/CreatedEventsTable";
import DailyTrend from "./components/DailyTrend";
import DocumentEventsTable from "./components/DocumentEventsTable";
import ExecutedEventsTable from "./components/ExecutedEventsTable";
import Filters, { presetRange, type Preset } from "./components/Filters";
import Hero from "./components/Hero";
import KpiTile from "./components/KpiTile";
import TestCaseDocumentEventsTable from "./components/TestCaseDocumentEventsTable";
import ThemeToggle from "./components/ThemeToggle";
import UsersTable from "./components/UsersTable";
import type { Theme } from "./theme";
import {
  METRICS,
  type ArtifactStats,
  type DailyStats,
  type DateRange,
  type StatsSummary,
  type UserEnvironmentStats,
} from "./types";

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

// Inclusive day count spanned by a range, e.g. from===to is 1 day.
function spanDays(range: DateRange): number {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

// The equal-length window immediately preceding `range`, for hero/KPI deltas.
function previousRange(range: DateRange): DateRange {
  const days = spanDays(range);
  const from = new Date(`${range.from}T00:00:00Z`);
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

// Groups an already zero-filled daily series into 7-day buckets (forward
// from the start of the range) for the KPI sparklines - the last up-to-13
// buckets are shown, so a shorter selected range just shows fewer points.
function weeklyBuckets(filled: DailyStats[]): DailyStats[] {
  const buckets: DailyStats[] = [];
  for (let i = 0; i < filled.length; i += 7) {
    const chunk = filled.slice(i, i + 7);
    buckets.push({
      day: chunk[0].day,
      test_cases_created: chunk.reduce((a, d) => a + d.test_cases_created, 0),
      test_cases_executed: chunk.reduce((a, d) => a + d.test_cases_executed, 0),
      documents_generated: chunk.reduce((a, d) => a + d.documents_generated, 0),
      test_case_documents_generated: chunk.reduce((a, d) => a + d.test_case_documents_generated, 0),
    });
  }
  return buckets;
}

function sumMetrics(s: StatsSummary | null): number {
  if (!s) return 0;
  return (
    s.test_cases_created + s.test_cases_executed + s.documents_generated + s.test_case_documents_generated
  );
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
  const [preset, setPreset] = useState<Preset>("90d");
  const [range, setRange] = useState<DateRange>(() =>
    presetRange("90d", new Date()),
  );
  const [user, setUser] = useState<string[]>([]);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<string[]>([]);
  const [environmentIds, setEnvironmentIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<StatsSummary | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [rollup, setRollup] = useState<UserEnvironmentStats[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactStats[]>([]);
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
      setPrevSummary(null);
      setDaily([]);
      setRollup([]);
      setArtifacts([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSummary(range, scopedUser, scopedEnvironment, searchParam),
      fetchSummary(previousRange(range), scopedUser, scopedEnvironment, searchParam),
      fetchDaily(range, scopedUser, scopedEnvironment, searchParam),
      fetchUserEnvironmentRollup(range, scopedUser, scopedEnvironment, searchParam),
      fetchArtifactsExport(range, scopedUser, scopedEnvironment, undefined, searchParam),
      fetchUserEmails(),
      fetchEnvironmentIds(),
    ])
      .then(([s, prevS, d, r, a, emails, envIds]) => {
        if (cancelled) return;
        setSummary(s);
        setPrevSummary(prevS);
        setDaily(d);
        setRollup(r);
        setArtifacts(a);
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
  const weekly = useMemo(() => weeklyBuckets(filled).slice(-13), [filled]);
  const windowDays = range.to ? spanDays(range) : 0;
  const environmentCount = useMemo(() => new Set(rollup.map((r) => r.environment)).size, [rollup]);
  const interfaceCount = useMemo(() => new Set(artifacts.map((a) => a.interface_name)).size, [artifacts]);

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
        <div className="hero-grid">
          <Hero
            total={sumMetrics(summary)}
            prevTotal={sumMetrics(prevSummary)}
            windowDays={windowDays}
            activeUsers={summary?.users_reporting ?? 0}
            environments={environmentCount}
            interfaces={interfaceCount}
            activeDays={daily.length}
          />
          <div className="kpi-row">
            {METRICS.map((m, i) => (
              <KpiTile
                key={m.key}
                label={m.label}
                color={`var(--s${i + 1})`}
                value={summary?.[m.key] ?? 0}
                prevValue={prevSummary?.[m.key] ?? 0}
                sparkValues={weekly.map((w) => w[m.key])}
              />
            ))}
          </div>
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
