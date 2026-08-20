import { useEffect, useMemo, useState } from "react";
import {
  ConflictError,
  downloadTableCsv,
  fetchArtifactsExport,
  fetchCustomerRegistry,
  fetchDaily,
  fetchEnvironmentIds,
  fetchEnvironmentsRollup,
  fetchSummary,
  fetchUserEmails,
  fetchUserEnvironmentRollup,
  fetchUsersRollup,
  getAccount,
  saveCustomerRegistry,
  UnauthorizedError,
} from "./api";
import ActivityChart from "./components/ActivityChart";
import AppHeader from "./components/AppHeader";
import DetailDrawer from "./components/DetailDrawer";
import FeatureHeatmap, {
  type FeatureMode,
} from "./components/FeatureHeatmap";
import FilterBar, {
  DEFAULT_GROUP_BY,
  DEFAULT_PRESET,
  presetRange,
  type GroupBy,
  type Preset,
} from "./components/FilterBar";
import { type HeatCell } from "./components/Heatmap";
import HeatmapCard from "./components/HeatmapCard";
import Hero from "./components/Hero";
import KpiTile from "./components/KpiTile";
import RankedBars, { type RankEntry } from "./components/RankedBars";
import Tip, { type TipState } from "./components/Tip";
import {
  customerSlug,
  EMPTY_REGISTRY,
  makeResolver,
  sameRegistry,
  type CustomerRegistry,
} from "./customers";
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
  // Environment is the atomic unit the source tool writes, so it stays the
  // default; customer is a rollup on top of it. Switching regroups the
  // leaderboard, the coverage heatmap and the feature grid - never the
  // filters or the detail tables, which stay environment-level either way.
  const [groupBy, setGroupBy] = useState<GroupBy>(DEFAULT_GROUP_BY);
  const [featureMode, setFeatureMode] = useState<FeatureMode>("count");
  // `registry` is the live draft the whole page resolves against, so an edit
  // in the mapping tab regroups everything before it is saved;
  // `savedRegistry` is what the server last confirmed, and the difference
  // between them is what "Save mapping" would write.
  const [registry, setRegistry] = useState<CustomerRegistry>(EMPTY_REGISTRY);
  const [savedRegistry, setSavedRegistry] =
    useState<CustomerRegistry>(EMPTY_REGISTRY);
  const [registryReady, setRegistryReady] = useState(false);
  const [savingRegistry, setSavingRegistry] = useState(false);
  // Two separate failures with two different consequences: a load failure
  // takes the whole customer axis away (and must say so, loudly, because an
  // empty registry silently resolves every environment to "Unassigned" and
  // that looks like real data); a save failure is local to the mapping tab.
  const [registryLoadError, setRegistryLoadError] = useState<string | null>(
    null,
  );
  const [registrySaveError, setRegistrySaveError] = useState<string | null>(
    null,
  );

  function applyPreset(p: Preset) {
    setPreset(p);
    setRange(presetRange(p, new Date()));
  }

  // The registry is configuration, not data: it does not change with the
  // date range or the scope, so it is fetched once rather than alongside
  // every scoped refetch below.
  useEffect(() => {
    let cancelled = false;
    fetchCustomerRegistry()
      .then((r) => {
        if (cancelled) return;
        setRegistry(r);
        setSavedRegistry(r);
        setRegistryReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) onLogout();
        else
          setRegistryLoadError(
            "Could not load the customer registry — grouping by customer is unavailable, and the Customer mapping tab is hidden. Everything else on this page is unaffected.",
          );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        environments: r.environments,
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

  // --- customer axis ----------------------------------------------------
  //
  // Every customer-keyed panel below is one of the environment-keyed rollups
  // folded one level further, so a customer total and the environment totals
  // under it are the same rows by construction and cannot drift apart. That
  // is the same guarantee the /rollup twins give the leaderboards: no panel
  // gets its own filter logic.

  const resolve = useMemo(() => makeResolver(registry), [registry]);
  const dimensionOf = useMemo(
    () => (environment: string) =>
      groupBy === "customer" ? resolve(environment).name : environment,
    [groupBy, resolve],
  );
  const dimensionLabel = groupBy === "customer" ? "customer" : "environment";

  /** Actions per environment in the current scope - the figure the mapping
   *  tab shows, so an admin can see what a reassignment moves before making
   *  it. */
  const environmentTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const r of envRollup)
      totals[r.environment] = tupleTotal(metricTuple(r), series);
    return totals;
  }, [envRollup, series]);

  /** Distinct users per grouping key, from the (user, environment) pairs -
   *  a customer's user count is a set union, not a sum of its environments'
   *  counts. Active days can't be derived the same way (the pair rollup has
   *  no day dimension), which is why the customer sub-line says environments
   *  and users rather than borrowing the per-environment day count. */
  const usersPerDimension = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of pairRollup) {
      const key = dimensionOf(p.environment);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(p.user_email);
    }
    return map;
  }, [pairRollup, dimensionOf]);

  const byDimension = useMemo(() => {
    if (groupBy === "environment")
      return byEnvironment.map((e) => ({ ...e, environments: 1 }));
    const map = new Map<
      string,
      { name: string; values: number[]; environments: Set<string> }
    >();
    for (const r of envRollup) {
      const name = resolve(r.environment).name;
      if (!map.has(name))
        map.set(name, { name, values: [0, 0, 0, 0], environments: new Set() });
      const entry = map.get(name)!;
      metricTuple(r).forEach((v, i) => (entry.values[i] += v));
      entry.environments.add(r.environment);
    }
    return [...map.values()].map((e) => ({
      name: e.name,
      values: e.values as MetricTuple,
      days: 0,
      others: usersPerDimension.get(e.name)?.size ?? 0,
      environments: e.environments.size,
    }));
  }, [groupBy, byEnvironment, envRollup, resolve, usersPerDimension]);

  const rank = (
    items: {
      name: string;
      values: MetricTuple;
      days: number;
      others: number;
      environments: number;
    }[],
    sub: (e: {
      days: number;
      others: number;
      environments: number;
    }) => string,
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
  const dimensionRank = useMemo(
    () =>
      rank(byDimension, (e) =>
        groupBy === "customer"
          ? `${e.environments} environment${e.environments === 1 ? "" : "s"} · ${e.others} user${e.others === 1 ? "" : "s"}`
          : `${e.others} user${e.others === 1 ? "" : "s"} · ${e.days} active day${e.days === 1 ? "" : "s"}`,
      ),
    [byDimension, groupBy, series],
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
          column: dimensionOf(r.environment),
          value: tupleTotal(metricTuple(r), series),
        }))
        .filter((c) => c.value > 0),
    [pairRollup, series, dimensionOf],
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

  // --- customer mapping (admin) -----------------------------------------
  //
  // Edits land in the draft `registry`, which every panel already resolves
  // against, so a reassignment regroups the page immediately. Only "Save
  // mapping" touches the server.

  function setOverride(
    nameNormalised: string,
    customerId: string | null | undefined,
  ) {
    setRegistry((r) => {
      const rest = r.overrides.filter(
        (o) => o.name_normalised !== nameNormalised,
      );
      // `undefined` means "fall back to the rule", which is the absence of an
      // override rather than an override onto the rule's own answer - that is
      // what keeps the saved set a list of genuine exceptions.
      return {
        ...r,
        overrides:
          customerId === undefined
            ? rest
            : [
                ...rest,
                { name_normalised: nameNormalised, customer_id: customerId },
              ],
      };
    });
  }

  /** Returns a reason the name was refused, or null when it was added. The
   *  duplicate-name check matters twice over: `customers.name` is UNIQUE
   *  server-side, and the page groups on the name, so a second "Heineken"
   *  would merge two rollups into one row before the save even failed. */
  function addCustomer(name: string): string | null {
    const trimmed = name.trim();
    const id = customerSlug(trimmed);
    if (!id) return "Use a name with at least one letter or number.";
    if (registry.customers.some((c) => c.id === id))
      return `“${trimmed}” already exists.`;
    if (
      registry.customers.some(
        (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
      )
    )
      return `A customer named “${trimmed}” already exists.`;
    // Manual-only: no patterns, so it catches nothing on its own and only
    // ever holds the environments someone assigns to it by hand.
    setRegistry((r) => ({
      ...r,
      customers: [
        ...r.customers,
        { id, name: trimmed, is_internal: false, patterns: [] },
      ],
    }));
    return null;
  }

  function saveRegistry() {
    setSavingRegistry(true);
    setRegistrySaveError(null);
    saveCustomerRegistry({
      customers: registry.customers.map((c) => ({
        id: c.id,
        name: c.name,
        is_internal: c.is_internal,
      })),
      environments: registry.overrides,
    })
      .then((saved) => {
        // Adopt what the server ended up with rather than the draft - it is
        // the one that knows which customers already existed.
        setRegistry(saved);
        setSavedRegistry(saved);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) onLogout();
        // 409 is the expected, actionable one (a customer name already in
        // use), so don't bury it under a generic "is the API running?".
        else
          setRegistrySaveError(
            err instanceof ConflictError
              ? err.message
              : "Could not save the mapping — is the API running?",
          );
      })
      .finally(() => setSavingRegistry(false));
  }

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
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        groupByCustomerDisabledReason={
          registryLoadError
            ? "The customer registry could not be loaded, so every environment would show as Unassigned."
            : undefined
        }
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
        environmentCustomer={
          registryReady ? (e) => resolve(e).name : undefined
        }
        onReset={() => {
          setUser([]);
          setEnvironment([]);
          setGroupBy(DEFAULT_GROUP_BY);
          applyPreset(DEFAULT_PRESET);
        }}
        onExport={exportSlice}
        exportDisabled={userRollup.length === 0 || exporting}
      />

      {/* On refetch the previous render is held at reduced opacity - no
          skeleton flash, no layout jump. */}
      <main className={`wrap${loading ? " loading-dim" : ""}`}>
        {error && <div className="card banner-error">{error}</div>}
        {/* Without this the failure is completely silent: the mapping tab
            just isn't there, and Group by → Customer would fold every
            environment into one "Unassigned" bar that reads as a finding. */}
        {registryLoadError && (
          <div className="card banner-error">{registryLoadError}</div>
        )}

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
                <h2>By {dimensionLabel}</h2>
                <p className="sub">
                  {dimensionRank.length} {dimensionLabel}
                  {dimensionRank.length === 1 ? "" : "s"} in scope
                </p>
              </div>
            </div>
            <div className="card-bd">
              <RankedBars
                entries={dimensionRank}
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
          <HeatmapCard cells={heatCells} columnLabel={dimensionLabel} />
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
          <h2>What each {dimensionLabel} uses TestEase for</h2>
          <p>
            Adoption is not one number — {groupBy === "customer" ? "a" : "an"}{" "}
            {dimensionLabel} that only generates documents is using a quarter
            of the product.
          </p>
        </div>
        <section className="card">
          <div className="card-hd">
            <div>
              <h2>
                {groupBy === "customer" ? "Customer" : "Environment"} × feature
              </h2>
              <p className="sub">
                {featureMode === "share"
                  ? "Each row sums to 100% — the shape of usage, not its size."
                  : "Actions per feature. Breadth counts how many of the four are used at all."}
              </p>
            </div>
            <div className="seg" role="group" aria-label="Heatmap mode">
              {(
                [
                  { id: "count", label: "Actions" },
                  { id: "share", label: `% of ${dimensionLabel}` },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  aria-pressed={featureMode === option.id}
                  onClick={() => setFeatureMode(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card-bd heat-scroll">
            <FeatureHeatmap rows={byDimension} series={series} mode={featureMode} />
          </div>
        </section>

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
          mapping={
            registryReady
              ? {
                  registry,
                  resolve,
                  environments: environmentIds,
                  totals: environmentTotals,
                  handlers: {
                    onOverride: setOverride,
                    onAddCustomer: addCustomer,
                    onRevertAll: () =>
                      setRegistry((r) => ({ ...r, overrides: [] })),
                    onSave: saveRegistry,
                    saving: savingRegistry,
                    dirty: !sameRegistry(registry, savedRegistry),
                    error: registrySaveError,
                  },
                }
              : undefined
          }
        />
      </main>
      <Tip tip={tip} series={series} />
    </>
  );
}
