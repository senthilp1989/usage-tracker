import { useEffect, useMemo, useState } from "react";
import {
  fetchArtifactsExport,
  fetchDaily,
  fetchEnvironmentIds,
  fetchSummary,
  fetchUserEmails,
  fetchUsersExport,
  getAccount,
  UnauthorizedError,
} from "./api";
import ActivityChart from "./components/ActivityChart";
import AppHeader from "./components/AppHeader";
import DetailDrawer from "./components/DetailDrawer";
import FilterBar, {
  DEFAULT_PRESET,
  presetRange,
  type Preset,
} from "./components/FilterBar";
import Heatmap, { type HeatCell } from "./components/Heatmap";
import Hero from "./components/Hero";
import KpiTile from "./components/KpiTile";
import RankedBars, { type RankEntry } from "./components/RankedBars";
import Tip, { type TipState } from "./components/Tip";
import { downloadCsv, fullDate, spanDays } from "./format";
import type { Theme } from "./theme";
import {
  METRICS,
  metricTuple,
  tupleTotal,
  type ArtifactStats,
  type DailyStats,
  type DateRange,
  type MetricTuple,
  type StatsSummary,
  type UserStats,
} from "./types";

const TOP_INTERFACES = 8;

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

/** The equal-length window immediately preceding `range`, for hero/KPI deltas. */
function previousRange(range: DateRange): DateRange {
  const days = spanDays(range.from, range.to);
  const from = new Date(`${range.from}T00:00:00Z`);
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

/** Groups an already zero-filled daily series into 7-day buckets for the KPI
 *  sparklines - the last up-to-13 are shown, so a shorter range just shows
 *  fewer points. */
function weeklyBuckets(filled: DailyStats[]): DailyStats[] {
  const buckets: DailyStats[] = [];
  for (let i = 0; i < filled.length; i += 7) {
    const chunk = filled.slice(i, i + 7);
    buckets.push({
      day: chunk[0].day,
      test_cases_created: chunk.reduce((a, d) => a + d.test_cases_created, 0),
      test_cases_executed: chunk.reduce((a, d) => a + d.test_cases_executed, 0),
      documents_generated: chunk.reduce((a, d) => a + d.documents_generated, 0),
      test_case_documents_generated: chunk.reduce(
        (a, d) => a + d.test_case_documents_generated,
        0,
      ),
    });
  }
  return buckets;
}

function sumMetrics(s: StatsSummary | null): number {
  if (!s) return 0;
  return (
    s.test_cases_created +
    s.test_cases_executed +
    s.documents_generated +
    s.test_case_documents_generated
  );
}

/** Rolls the flat (user, environment, day) fact table up by one key, keeping
 *  the distinct counts the ranked-bar sub-lines need. */
function groupUsage(
  rows: UserStats[],
  keyOf: (r: UserStats) => string,
  otherOf: (r: UserStats) => string,
): { name: string; values: MetricTuple; days: number; others: number }[] {
  const map = new Map<
    string,
    { values: MetricTuple; days: Set<string>; others: Set<string> }
  >();
  for (const r of rows) {
    const key = keyOf(r);
    const entry = map.get(key) ?? {
      values: [0, 0, 0, 0] as MetricTuple,
      days: new Set(),
      others: new Set(),
    };
    METRICS.forEach((m, i) => (entry.values[i] += r[m.key]));
    entry.days.add(r.report_date);
    entry.others.add(otherOf(r));
    map.set(key, entry);
  }
  return [...map.entries()].map(([name, e]) => ({
    name,
    values: e.values,
    days: e.days.size,
    others: e.others.size,
  }));
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
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [range, setRange] = useState<DateRange>(() =>
    presetRange(DEFAULT_PRESET, new Date()),
  );
  const [user, setUser] = useState<string[]>([]);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<string[]>([]);
  const [environmentIds, setEnvironmentIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<StatsSummary | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [usageRows, setUsageRows] = useState<UserStats[]>([]);
  const [optionRows, setOptionRows] = useState<UserStats[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Legend toggles scope every panel below the chart, not just the chart -
  // turning a metric off has to mean the same thing everywhere on the page.
  const [series, setSeries] = useState<boolean[]>([true, true, true, true]);
  const [tip, setTip] = useState<TipState | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    setRange(presetRange(p, new Date()));
  }

  useEffect(() => {
    // Custom range starts with `to` empty (see FilterBar) - nothing is fetched
    // until the user picks an end date. Reset to the same zero state a
    // legitimately empty result set would produce, so the UI reads as "no
    // records" rather than a distinct "pick a date" mode.
    if (!range.to) {
      setSummary(null);
      setPrevSummary(null);
      setDaily([]);
      setUsageRows([]);
      setOptionRows([]);
      setArtifacts([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // The option-count query deliberately ignores the user/environment
    // selection, so each dropdown row keeps showing its own period total
    // rather than collapsing to whatever is already selected. When nothing is
    // selected the scoped result already is that, so skip the second call.
    const unscoped = user.length === 0 && environment.length === 0;
    Promise.all([
      fetchSummary(range, user, environment),
      fetchSummary(previousRange(range), user, environment),
      fetchDaily(range, user, environment),
      fetchUsersExport(range, user, environment),
      fetchArtifactsExport(range, user, environment),
      fetchUserEmails(),
      fetchEnvironmentIds(),
      unscoped ? Promise.resolve(null) : fetchUsersExport(range),
    ])
      .then(([s, prevS, d, usage, a, emails, envIds, options]) => {
        if (cancelled) return;
        setSummary(s);
        setPrevSummary(prevS);
        setDaily(d);
        setUsageRows(usage);
        setOptionRows(options ?? usage);
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
  }, [range.from, range.to, user.join(","), environment.join(",")]);

  const filled = useMemo(() => zeroFill(range, daily), [range, daily]);
  const weekly = useMemo(() => weeklyBuckets(filled).slice(-13), [filled]);
  const windowDays = range.to ? spanDays(range.from, range.to) : 0;

  const byUser = useMemo(
    () =>
      groupUsage(
        usageRows,
        (r) => r.user_email,
        (r) => r.environment,
      ),
    [usageRows],
  );
  const byEnvironment = useMemo(
    () =>
      groupUsage(
        usageRows,
        (r) => r.environment,
        (r) => r.user_email,
      ),
    [usageRows],
  );

  const rank = (
    items: {
      name: string;
      values: MetricTuple;
      days: number;
      others: number;
    }[],
    sub: (e: { days: number; others: number }) => string,
  ): RankEntry[] =>
    items
      .map((e) => ({
        name: e.name,
        sub: sub(e),
        values: e.values,
        total: tupleTotal(e.values, series),
      }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total);

  const userRank = useMemo(
    () =>
      rank(
        byUser,
        (e) =>
          `${e.days} active day${e.days === 1 ? "" : "s"} · ${e.others} env`,
      ),
    [byUser, series],
  );
  const environmentRank = useMemo(
    () =>
      rank(
        byEnvironment,
        (e) =>
          `${e.others} user${e.others === 1 ? "" : "s"} · ${e.days} active day${e.days === 1 ? "" : "s"}`,
      ),
    [byEnvironment, series],
  );

  const interfaceRank = useMemo<RankEntry[]>(
    () =>
      artifacts
        .map((a) => {
          const values = metricTuple(a);
          return {
            name: a.interface_name,
            sub: a.environment,
            values,
            total: tupleTotal(values, series),
          };
        })
        .filter((a) => a.total > 0)
        .sort((a, b) => b.total - a.total),
    [artifacts, series],
  );

  const heatCells = useMemo<HeatCell[]>(
    () =>
      usageRows
        .map((r) => ({
          row: r.user_email,
          column: r.environment,
          value: tupleTotal(metricTuple(r), series),
        }))
        .filter((c) => c.value > 0),
    [usageRows, series],
  );

  const optionCounts = useMemo(() => {
    const users: Record<string, number> = {};
    const envs: Record<string, number> = {};
    for (const r of optionRows) {
      const total = tupleTotal(metricTuple(r));
      users[r.user_email] = (users[r.user_email] ?? 0) + total;
      envs[r.environment] = (envs[r.environment] ?? 0) + total;
    }
    return { users, envs };
  }, [optionRows]);

  const activeDays = useMemo(
    () => new Set(usageRows.map((r) => r.report_date)).size,
    [usageRows],
  );
  const environmentCount = useMemo(
    () => new Set(usageRows.map((r) => r.environment)).size,
    [usageRows],
  );
  const interfaceCount = useMemo(
    () => new Set(interfaceRank.map((i) => i.name)).size,
    [interfaceRank],
  );

  function exportSlice() {
    downloadCsv(
      `testease-usage-${range.from}-to-${range.to}.csv`,
      ["User", "Environment", "Date", ...METRICS.map((m) => m.label)],
      usageRows.map((r) => [
        r.user_email,
        r.environment,
        r.report_date,
        ...METRICS.map((m) => r[m.key]),
      ]),
    );
  }

  return (
    <>
      <AppHeader
        account={getAccount()}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />
      <FilterBar
        preset={preset}
        onPresetChange={applyPreset}
        range={range}
        onRangeChange={setRange}
        userEmails={userEmails}
        user={user}
        onUserChange={setUser}
        userCounts={optionCounts.users}
        environmentIds={environmentIds}
        environment={environment}
        onEnvironmentChange={setEnvironment}
        environmentCounts={optionCounts.envs}
        onReset={() => {
          setUser([]);
          setEnvironment([]);
          applyPreset(DEFAULT_PRESET);
        }}
        onExport={exportSlice}
        exportDisabled={usageRows.length === 0}
      />

      {/* On refetch the previous render is held at reduced opacity - no
          skeleton flash, no layout jump. */}
      <main className={`wrap${loading ? " loading-dim" : ""}`}>
        {error && <div className="card login-error banner-error">{error}</div>}

        <div className="sec-title">
          <h2>Adoption at a glance</h2>
          <p>
            {range.to
              ? `${fullDate(range.from)} – ${fullDate(range.to)}`
              : "Pick an end date to load data"}
          </p>
        </div>
        <div className="hero-grid">
          <Hero
            total={sumMetrics(summary)}
            prevTotal={sumMetrics(prevSummary)}
            windowDays={windowDays}
            activeUsers={summary?.users_reporting ?? 0}
            environments={environmentCount}
            interfaces={interfaceCount}
            activeDays={activeDays}
          />
          <div className="kpi-row">
            {METRICS.map((m) => (
              <KpiTile
                key={m.key}
                label={m.label}
                color={m.colorVar}
                value={summary?.[m.key] ?? 0}
                prevValue={prevSummary?.[m.key] ?? 0}
                sparkValues={weekly.map((w) => w[m.key])}
              />
            ))}
          </div>
        </div>

        <div className="sec-title">
          <h2>Activity over time</h2>
          <p>Where the work actually happened — and where it stopped.</p>
        </div>
        <ActivityChart
          data={filled}
          series={series}
          onToggleSeries={(i) =>
            setSeries((s) => s.map((on, k) => (k === i ? !on : on)))
          }
          onTip={setTip}
        />

        <div className="sec-title">
          <h2>Who is using it, and where</h2>
          <p>
            Sorted by total actions. Bar segments follow the metric colours
            above.
          </p>
        </div>
        <div className="two-up">
          <section className="card">
            <div className="card-hd">
              <div>
                <h2>By user</h2>
                <p className="sub">
                  {userRank.length} user{userRank.length === 1 ? "" : "s"} with
                  recorded activity
                </p>
              </div>
            </div>
            <div className="card-bd">
              <RankedBars entries={userRank} series={series} onTip={setTip} />
            </div>
          </section>
          <section className="card">
            <div className="card-hd">
              <div>
                <h2>By environment</h2>
                <p className="sub">
                  {environmentRank.length} environment
                  {environmentRank.length === 1 ? "" : "s"} in scope
                </p>
              </div>
            </div>
            <div className="card-bd">
              <RankedBars
                entries={environmentRank}
                series={series}
                onTip={setTip}
              />
            </div>
          </section>
        </div>

        <div className="sec-title">
          <h2>Coverage &amp; concentration</h2>
          <p>
            Every cell carries its number, so nothing depends on colour alone.
          </p>
        </div>
        <div className="two-up">
          <section className="card">
            <div className="card-hd">
              <div>
                <h2>User × environment</h2>
                <p className="sub">
                  Total actions per pair. Empty cells mean no recorded usage in
                  this period.
                </p>
              </div>
            </div>
            <div className="card-bd" style={{ overflowX: "auto" }}>
              <Heatmap cells={heatCells} />
            </div>
          </section>
          <section className="card">
            <div className="card-hd">
              <div>
                <h2>Top interfaces</h2>
                {/* One row is one (interface, environment) pair - the same
                    interface in two environments is two rows - so say pairs
                    rather than calling the count "interfaces". */}
                <p className="sub">
                  Top {Math.min(TOP_INTERFACES, interfaceRank.length)} of{" "}
                  {interfaceRank.length} interface · environment pairs, ranked
                  by total actions
                </p>
              </div>
            </div>
            <div className="card-bd">
              <RankedBars
                entries={interfaceRank.slice(0, TOP_INTERFACES)}
                series={series}
                variant="stacked"
                onTip={setTip}
              />
            </div>
          </section>
        </div>

        <div className="sec-title">
          <h2>Detail records</h2>
          <p>
            The raw tables, demoted to where you go when you need to prove a
            number.
          </p>
        </div>
        <DetailDrawer
          range={range}
          userEmails={user}
          environment={environment}
          usageRows={usageRows}
          artifactRows={artifacts}
        />
      </main>
      <Tip tip={tip} series={series} />
    </>
  );
}
