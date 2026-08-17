import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCreatedEvents,
  fetchCreatedEventsExport,
  fetchDocumentEvents,
  fetchDocumentEventsExport,
  fetchExecutedEvents,
  fetchExecutedEventsExport,
  fetchTestCaseDocumentEvents,
  fetchTestCaseDocumentEventsExport,
} from "../api";
import { downloadCsv, fmt, fullDate } from "../format";
import {
  METRICS,
  type ArtifactStats,
  type DateRange,
  type UserStats,
} from "../types";

const PAGE_SIZE = 10;
// Expanded takes over the viewport, so it can show a screenful instead of
// paging through ten rows at a time.
const EXPANDED_PAGE_SIZE = 25;

type Cell = string | number;
type Row = Cell[];

interface Column {
  label: string;
  numeric?: boolean;
  mono?: boolean;
  tag?: boolean;
  /** List-shaped value that should wrap instead of widening the table. */
  wrap?: boolean;
}

interface TabDef {
  id: string;
  name: string;
  columns: Column[];
  /** Undefined while a lazily-loaded tab is still fetching. */
  rows?: Row[];
  count: number;
}

/** Tabs sourced from the raw event tables. Their full row sets are fetched
 *  only when the tab is first opened for the current scope - the drawer is
 *  where you go to prove a number, not what the page costs on load. */
const LAZY_TABS = ["created", "executed", "documents", "tc-documents"] as const;
type LazyTabId = (typeof LAZY_TABS)[number];

const localTime = (iso: string) =>
  `${fullDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

export default function DetailDrawer({
  range,
  userEmails,
  environment,
  usageRows,
  artifactRows,
}: {
  range: DateRange;
  userEmails: string[];
  environment: string[];
  usageRows: UserStats[];
  artifactRows: ArtifactStats[];
}) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<LazyTabId, number>>>({});
  const [loaded, setLoaded] = useState<Partial<Record<LazyTabId, Row[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const expandBtnRef = useRef<HTMLButtonElement>(null);

  // Every cached row set belongs to one filter scope; changing the scope
  // invalidates all of it rather than letting a stale tab linger.
  const scopeKey = `${range.from}|${range.to}|${userEmails.join(",")}|${environment.join(",")}`;

  useEffect(() => {
    setLoaded({});
    setCounts({});
    setPage(0);
    if (!range.to) return;
    let cancelled = false;
    Promise.all([
      fetchCreatedEvents(range, 1, 1, userEmails, environment),
      fetchExecutedEvents(range, 1, 1, userEmails, environment),
      fetchDocumentEvents(range, 1, 1, userEmails, environment),
      fetchTestCaseDocumentEvents(range, 1, 1, userEmails, environment),
    ])
      .then(([c, e, d, t]) => {
        if (cancelled) return;
        setCounts({
          created: c.total,
          executed: e.total,
          documents: d.total,
          "tc-documents": t.total,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const tabs = useMemo<TabDef[]>(() => {
    const byUser = new Map<
      string,
      { values: number[]; days: Set<string>; envs: Set<string> }
    >();
    for (const r of usageRows) {
      const entry = byUser.get(r.user_email) ?? {
        values: [0, 0, 0, 0],
        days: new Set(),
        envs: new Set(),
      };
      METRICS.forEach((m, i) => (entry.values[i] += r[m.key]));
      entry.days.add(r.report_date);
      entry.envs.add(r.environment);
      byUser.set(r.user_email, entry);
    }

    const metricCols: Column[] = METRICS.map((m) => ({
      label: m.short,
      numeric: true,
    }));

    return [
      {
        id: "usage-by-user",
        name: "Usage by user",
        columns: [
          { label: "User" },
          { label: "Environment", tag: true },
          { label: "Date" },
          ...metricCols,
        ],
        rows: usageRows.map((r) => [
          r.user_email,
          r.environment,
          r.report_date,
          ...METRICS.map((m) => r[m.key]),
        ]),
        count: usageRows.length,
      },
      {
        id: "user-totals",
        name: "User totals",
        columns: [
          { label: "User" },
          { label: "Actions", numeric: true },
          ...metricCols,
          { label: "Active days", numeric: true },
          { label: "Environments", numeric: true },
        ],
        rows: [...byUser.entries()]
          .map(([email, e]) => [
            email,
            e.values.reduce((a, b) => a + b, 0),
            ...e.values,
            e.days.size,
            e.envs.size,
          ])
          .sort((a, b) => (b[1] as number) - (a[1] as number)),
        count: byUser.size,
      },
      {
        id: "usage-by-interface",
        name: "Usage by interface",
        columns: [
          { label: "Environment", tag: true },
          { label: "Interface", mono: true },
          ...metricCols,
        ],
        rows: artifactRows
          .map((r) => [
            r.environment,
            r.interface_name,
            ...METRICS.map((m) => r[m.key]),
          ])
          .sort(
            (a, b) =>
              (b.slice(2) as number[]).reduce((x, y) => x + y, 0) -
              (a.slice(2) as number[]).reduce((x, y) => x + y, 0),
          ),
        count: artifactRows.length,
      },
      {
        id: "created",
        name: "Test cases created",
        columns: [
          { label: "User" },
          { label: "Environment", tag: true },
          { label: "Interface", mono: true },
          { label: "Test case" },
          { label: "Created at" },
        ],
        rows: loaded.created,
        count: counts.created ?? 0,
      },
      {
        id: "executed",
        name: "Test cases executed",
        columns: [
          { label: "User" },
          { label: "Environment", tag: true },
          { label: "Interface", mono: true },
          { label: "Test case" },
          { label: "Executed at" },
        ],
        rows: loaded.executed,
        count: counts.executed ?? 0,
      },
      {
        id: "documents",
        name: "TSD documents",
        columns: [
          { label: "User" },
          { label: "Environment", tag: true },
          { label: "Interface", mono: true },
          { label: "Generated at" },
        ],
        rows: loaded.documents,
        count: counts.documents ?? 0,
      },
      {
        id: "tc-documents",
        name: "Test-case documents",
        columns: [
          { label: "User" },
          { label: "Environment", tag: true },
          { label: "Interface", mono: true },
          { label: "Suite" },
          { label: "Test cases", wrap: true },
          { label: "Count", numeric: true },
          { label: "Generated at" },
        ],
        rows: loaded["tc-documents"],
        count: counts["tc-documents"] ?? 0,
      },
    ];
  }, [usageRows, artifactRows, loaded, counts]);

  const active = tabs[Math.min(tab, tabs.length - 1)];
  const lazyId = LAZY_TABS.includes(active.id as LazyTabId)
    ? (active.id as LazyTabId)
    : null;

  useEffect(() => {
    if (!lazyId || loaded[lazyId] || !range.to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = (): Promise<Row[]> => {
      switch (lazyId) {
        case "created":
          return fetchCreatedEventsExport(range, userEmails, environment).then(
            (rows) =>
              rows.map((r) => [
                r.user_email,
                r.environment,
                r.interface_name,
                r.test_case_name,
                localTime(r.created_at),
              ]),
          );
        case "executed":
          return fetchExecutedEventsExport(range, userEmails, environment).then(
            (rows) =>
              rows.map((r) => [
                r.user_email,
                r.environment,
                r.interface_name,
                r.test_case_name,
                localTime(r.created_at),
              ]),
          );
        case "documents":
          return fetchDocumentEventsExport(range, userEmails, environment).then(
            (rows) =>
              rows.map((r) => [
                r.user_email,
                r.environment,
                r.interface_name,
                localTime(r.created_at),
              ]),
          );
        case "tc-documents":
          return fetchTestCaseDocumentEventsExport(
            range,
            userEmails,
            environment,
          ).then((rows) =>
            rows.map((r) => [
              r.user_email,
              r.environment ?? "—",
              r.interface_name ?? "—",
              r.suite_name,
              r.test_case_names.join(", "),
              r.test_case_count,
              localTime(r.created_at),
            ]),
          );
      }
    };
    load()
      .then(
        (rows) =>
          !cancelled && setLoaded((prev) => ({ ...prev, [lazyId]: rows })),
      )
      .catch(() => !cancelled && setError("Could not load these records."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lazyId, scopeKey, loaded[lazyId ?? "created"]]);

  // Filter first, then sort - so the CSV below exports exactly what is on
  // screen across all pages, not just the visible ten rows.
  const view = useMemo(() => {
    let rows = active.rows ?? [];
    const q = query.trim().toLowerCase();
    if (q)
      rows = rows.filter((r) =>
        r.some((c) => String(c).toLowerCase().includes(q)),
      );
    if (sort) {
      const { col, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        if (typeof x === "number" && typeof y === "number")
          return (x - y) * dir;
        return String(x).localeCompare(String(y)) * dir;
      });
    }
    return rows;
  }, [active, query, sort]);

  const pageSize = expanded ? EXPANDED_PAGE_SIZE : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(view.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = view.slice(current * pageSize, (current + 1) * pageSize);

  function toggleExpand() {
    const next = !expanded;
    // Page size changes with the mode, so re-derive the page from the row the
    // user is actually looking at - otherwise expanding jumps them elsewhere
    // in the table.
    const firstRow = current * pageSize;
    setPage(Math.floor(firstRow / (next ? EXPANDED_PAGE_SIZE : PAGE_SIZE)));
    setExpanded(next);
  }

  // Escape closes, the page behind stops scrolling, and focus moves into the
  // panel so the keyboard doesn't stay stranded on the page underneath.
  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExpanded(false);
        expandBtnRef.current?.focus();
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  function selectTab(i: number) {
    setTab(i);
    setPage(0);
    setQuery("");
    setSort(null);
  }

  return (
    <>
      {expanded && <div className="detail-backdrop" onClick={toggleExpand} />}
      <section
        className={`card detail-card${expanded ? " is-expanded" : ""}`}
        ref={panelRef}
        tabIndex={expanded ? -1 : undefined}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? true : undefined}
        aria-label={expanded ? "Detail records, expanded" : undefined}
      >
        <div className="tabs" role="tablist">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={i === tab}
              onClick={() => selectTab(i)}
            >
              {t.name} <span className="cnt">({fmt(t.count)})</span>
            </button>
          ))}
        </div>
        <div className="tbl-tools">
          <div className="search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: "var(--muted)", flex: "none" }}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Filter rows…"
              aria-label="Filter rows"
            />
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {fmt(view.length)} record{view.length === 1 ? "" : "s"}
          </span>
          <button
            className="btn"
            disabled={view.length === 0}
            onClick={() =>
              downloadCsv(
                `testease-${active.id}.csv`,
                active.columns.map((c) => c.label),
                view,
              )
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
            </svg>
            Download CSV
          </button>
          <button
            className="btn"
            ref={expandBtnRef}
            onClick={toggleExpand}
            aria-expanded={expanded}
            title={
              expanded ? "Exit full screen (Esc)" : "Expand to full screen"
            }
          >
            {expanded ? (
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
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            ) : (
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
                <path d="M9 3H3v6M21 9V3h-6M9 21H3v-6M15 21h6v-6" />
              </svg>
            )}
            {expanded ? "Exit full screen" : "Expand"}
          </button>
        </div>
        <div className={`tbl-scroll${loading ? " loading-dim" : ""}`}>
          {error ? (
            <div className="empty">{error}</div>
          ) : active.rows === undefined ? (
            <div className="empty">Loading records…</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {active.columns.map((c, i) => (
                    <th key={c.label} className={c.numeric ? "n" : undefined}>
                      <button
                        onClick={() =>
                          setSort((s) =>
                            s && s.col === i
                              ? { col: i, dir: -s.dir as 1 | -1 }
                              : { col: i, dir: -1 },
                          )
                        }
                      >
                        {c.label}
                        {sort?.col === i && (
                          <span aria-hidden="true">
                            {sort.dir > 0 ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={active.columns.length}>
                      No matching records
                    </td>
                  </tr>
                ) : (
                  visible.map((r, ri) => (
                    <tr key={`${current}-${ri}`}>
                      {r.map((c, ci) => {
                        const col = active.columns[ci];
                        if (col.numeric)
                          return (
                            <td className={`n${c ? "" : " zero"}`} key={ci}>
                              {fmt(Number(c))}
                            </td>
                          );
                        if (col.mono)
                          return (
                            <td key={ci}>
                              <span className="mono">{String(c)}</span>
                            </td>
                          );
                        if (col.tag)
                          return (
                            <td key={ci}>
                              <span className="tag">{String(c)}</span>
                            </td>
                          );
                        return (
                          <td
                            key={ci}
                            className={col.wrap ? "wrap" : undefined}
                          >
                            {String(c)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        <div className="pager">
          <span>
            Page {current + 1} of {pageCount}
          </span>
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <button
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}
