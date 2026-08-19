import { useEffect, useMemo, useState } from "react";
import {
  downloadTableCsv,
  fetchArtifactsExport,
  fetchDaily,
  fetchEnvironmentIds,
  fetchEnvironmentsRollup,
  fetchSummary,
  fetchUserEmails,
  fetchUserEnvironmentRollup,
  fetchUsersRollup,
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
import { type HeatCell } from "./components/Heatmap";
import HeatmapCard from "./components/HeatmapCard";
import Hero from "./components/Hero";
import KpiTile from "./components/KpiTile";
import RankedBars, { type RankEntry } from "./components/RankedBars";
import Tip, { type TipState } from "./components/Tip";
import { fullDate, monthsBackStart, spanDays, todayIso } from "./format";
import type { Theme } from "./theme";
import {
  METRICS,
  metricTuple,
  tupleTotal,
  type ArtifactStats,
  type DailyStats,
  type DateRange,
  type EnvironmentRollupStats,
  type MetricTuple,
  type StatsSummary,
  type UserEnvironmentStats,
  type UserRollupStats,
} from "./types";

const TOP_INTERFACES = 8;

/** The activity chart's monthly view can override the page date filter with a
 *  fixed window of whole calendar months. It exists because the page filter is
 *  capped at 90 days (FilterBar), which clips the first and last month of any
 *  monthly view - fine for a trend, useless for comparing months. Scoped to
 *  that one chart on purpose: widening the whole page would widen every
 *  scoped fetch below (rollups, artifacts, the drawer's counts) with it. */
const CHART_WIDE_MONTHS = 6;

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

// The by-user/by-environment grouping that used to happen here in JS (over
// the flat /users/export rows) now happens in Postgres - see the /rollup
// twins in api.ts. The page only reshapes the returned rows for display.

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
  const [userRollup, setUserRollup] = useState<UserRollupStats[]>([]);
  const [envRollup, setEnvRollup] = useState<EnvironmentRollupStats[]>([]);
  const [pairRollup, setPairRollup] = useState<UserEnvironmentStats[]>([]);
  const [optionUserRollup, setOptionUserRollup] = useState<
    UserRollupStats[] | null
  >(null);
  const [optionEnvRollup, setOptionEnvRollup] = useState<
    EnvironmentRollupStats[] | null
  >(null);
  const [artifacts, setArtifacts] = useState<ArtifactStats[]>([]);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Activity chart's monthly override: fetched only while the chart says it
  // wants it, and kept out of `daily` so no other panel can pick it up.
  const [wideNeeded, setWideNeeded] = useState(false);
  const [wideDaily, setWideDaily] = useState<DailyStats[] | null>(null);
  const [wideLoading, setWideLoading] = useState(false);
  const [wideError, setWideError] = useState(false);
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
      setUserRollup([]);
      setEnvRollup([]);
      setPairRollup([]);
      setOptionUserRollup(null);
      setOptionEnvRollup(null);
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
      fetchUsersRollup(range, user, environment),
      fetchEnvironmentsRollup(range, user, environment),
      fetchUserEnvironmentRollup(range, user, environment),
      fetchArtifactsExport(range, user, environment),
      fetchUserEmails(),
      fetchEnvironmentIds(),
      unscoped ? Promise.resolve(null) : fetchUsersRollup(range),
      unscoped ? Promise.resolve(null) : fetchEnvironmentsRollup(range),
    ])
      .then(
        ([s, prevS, d, uRoll, eRoll, pairs, a, emails, envIds, optU, optE]) => {
          if (cancelled) return;
          setSummary(s);
          setPrevSummary(prevS);
          setDaily(d);
          setUserRollup(uRoll);
          setEnvRollup(eRoll);
          setPairRollup(pairs);
          setOptionUserRollup(optU);
          setOptionEnvRollup(optE);
          setArtifacts(a);
          setUserEmails(emails);
          setEnvironmentIds(envIds);
          setError(null);
        },
      )
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

  // Whole calendar months ending with the month the page filter ends in, so
  // the override widens the period the user picked rather than jumping them to
  // a different one - walking a custom range back through history still works.
  // Only the period is overridden: the user and environment filters are passed
  // to the fetch below and still apply.
  const wideRange = useMemo<DateRange>(
    () => ({
      from: monthsBackStart(range.to || todayIso(), CHART_WIDE_MONTHS - 1),
      to: range.to,
    }),
    [range.to],
  );

  useEffect(() => {
    if (!wideNeeded || !wideRange.to) {
      setWideDaily(null);
      setWideError(false);
      return;
    }
    let cancelled = false;
    setWideLoading(true);
    setWideError(false);
    fetchDaily(wideRange, user, environment)
      .then((d) => !cancelled && setWideDaily(zeroFill(wideRange, d)))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) onLogout();
        // Anything else stays local to the chart: the rest of the page loaded
        // fine, so the page-level error banner would be a lie.
        else setWideError(true);
      })
      .finally(() => !cancelled && setWideLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    wideNeeded,
    wideRange.from,
    wideRange.to,
    user.join(","),
    environment.join(","),
  ]);

  const filled = useMemo(() => zeroFill(range, daily), [range, daily]);
  const weekly = useMemo(() => weeklyBuckets(filled).slice(-13), [filled]);
  const windowDays = range.to ? spanDays(range.from, range.to) : 0;

  const byUser = useMemo(
    () =>
      userRollup.map((r) => ({
        name: r.user_email,
        values: metricTuple(r),
        days: r.active_days,
        others: r.environments,
      })),
    [userRollup],
  );
  const byEnvironment = useMemo(
    () =>
      envRollup.map((r) => ({
        name: r.environment,
        values: metricTuple(r),
        days: r.active_days,
        others: r.users,
      })),
    [envRollup],
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
      pairRollup
        .map((r) => ({
          row: r.user_email,
          column: r.environment,
          value: tupleTotal(metricTuple(r), series),
        }))
        .filter((c) => c.value > 0),
    [pairRollup, series],
  );

  // The dropdown counts deliberately ignore the user/environment selection
  // (each row keeps its own period total) - so they come from the unscoped
  // rollups when a filter is active, and from the scoped ones otherwise.
  const optionCounts = useMemo(() => {
    const users: Record<string, number> = {};
    const envs: Record<string, number> = {};
    for (const r of optionUserRollup ?? userRollup)
      users[r.user_email] = tupleTotal(metricTuple(r));
    for (const r of optionEnvRollup ?? envRollup)
      envs[r.environment] = tupleTotal(metricTuple(r));
    return { users, envs };
  }, [optionUserRollup, optionEnvRollup, userRollup, envRollup]);

  const activeDays = summary?.active_days ?? 0;
  const environmentCount = summary?.environments_active ?? 0;
  const interfaceCount = useMemo(
    () => new Set(interfaceRank.map((i) => i.name)).size,
    [interfaceRank],
  );

  // The CSV wants the flat (user, environment, day) rows, which no longer
  // arrive on page load - the server builds the file when the button is
  // actually clicked, honoring the same scope, and streams it to disk.
  function exportSlice() {
    setExporting(true);
    downloadTableCsv(
      "/dashboard/users/export",
      `testease-usage-${range.from}-to-${range.to}.csv`,
      range,
      user,
      environment,
    )
      .catch((err) => {
        if (err instanceof UnauthorizedError) onLogout();
        else setError("Could not export the CSV — is the API running?");
      })
      .finally(() => setExporting(false));
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
        exportDisabled={userRollup.length === 0 || exporting}
      />

      {/* On refetch the previous render is held at reduced opacity - no
          skeleton flash, no layout jump. */}
      <main className={`wrap${loading ? " loading-dim" : ""}`}>
        {error && <div className="card banner-error">{error}</div>}

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
          wideMonths={CHART_WIDE_MONTHS}
          wideData={wideDaily}
          wideLoading={wideLoading}
          wideError={wideError}
          onWideNeeded={setWideNeeded}
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
          <HeatmapCard cells={heatCells} />
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
          userRollup={userRollup}
          artifactRows={artifacts}
        />
      </main>
      <Tip tip={tip} series={series} />
    </>
  );
}
