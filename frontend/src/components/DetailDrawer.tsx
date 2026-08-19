import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadTableCsv,
  fetchCreatedEvents,
  fetchDocumentEvents,
  fetchExecutedEvents,
  fetchTestCaseDocumentEvents,
  fetchUsers,
  type TableQuery,
} from "../api";
import {
  stageLabel,
  stageOf,
  type CustomerRegistry,
  type Resolution,
} from "../customers";
import { downloadCsv, fmt, fullDate } from "../format";
import CustomerMappingTab, {
  mappingCsvRows,
  type MappingHandlers,
} from "./CustomerMappingTab";
import {
  METRICS,
  type ArtifactStats,
  type DateRange,
  type UserRollupStats,
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
  /** Backend column name for server-side sorting. A server-mode column
   *  without one (the JSONB test-case name list) is not sortable. */
  field?: string;
}

interface TabDef {
  id: string;
  name: string;
  columns: Column[];
  /** Renders its own body (the customer mapping editor) instead of the shared
   *  table, and pages all its rows at once - the list is one row per
   *  environment, which is short by construction. */
  admin?: boolean;
  /** Undefined while a server-mode tab is still fetching its first page. */
  rows?: Row[];
  count: number;
}

/** Tabs whose rows live server-side. The table fetches one page at a time -
 *  free-text `q`, sort and pagination all happen in SQL, ANDed on top of the
 *  page's date/user/environment scope - and the CSV button downloads the full
 *  filtered-and-sorted set as a server-built file. The two rollup-fed tabs
 *  (user totals, usage by interface) stay client-side: their row counts are
 *  bounded by user/interface cardinality and already sit in memory. */
const SERVER_TABS = [
  "usage-by-user",
  "created",
  "executed",
  "documents",
  "tc-documents",
] as const;
type ServerTabId = (typeof SERVER_TABS)[number];

const SERVER_CSV_PATHS: Record<ServerTabId, string> = {
  "usage-by-user": "/dashboard/users/export",
  created: "/dashboard/created-events/export",
  executed: "/dashboard/executed-events/export",
  documents: "/dashboard/document-events/export",
  "tc-documents": "/dashboard/test-case-document-events/export",
};

const localTime = (iso: string) =>
  `${fullDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

function fetchServerPage(
  id: ServerTabId,
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails: string[],
  environment: string[],
  tq: TableQuery,
): Promise<{ rows: Row[]; total: number }> {
  switch (id) {
    case "usage-by-user":
      return fetchUsers(
        range,
        page,
        pageSize,
        userEmails,
        environment,
        undefined,
        tq,
      ).then((p) => ({
        total: p.total,
        rows: p.items.map((r) => [
          r.user_email,
          r.environment,
          r.report_date,
          ...METRICS.map((m) => r[m.key]),
        ]),
      }));
    case "created":
      return fetchCreatedEvents(
        range,
        page,
        pageSize,
        userEmails,
        environment,
        undefined,
        tq,
      ).then((p) => ({
        total: p.total,
        rows: p.items.map((r) => [
          r.user_email,
          r.environment,
          r.interface_name,
          r.test_case_name,
          localTime(r.created_at),
        ]),
      }));
    case "executed":
      return fetchExecutedEvents(
        range,
        page,
        pageSize,
        userEmails,
        environment,
        undefined,
        tq,
      ).then((p) => ({
        total: p.total,
        rows: p.items.map((r) => [
          r.user_email,
          r.environment,
          r.interface_name,
          r.test_case_name,
          localTime(r.created_at),
        ]),
      }));
    case "documents":
      return fetchDocumentEvents(
        range,
        page,
        pageSize,
        userEmails,
        environment,
        undefined,
        tq,
      ).then((p) => ({
        total: p.total,
        rows: p.items.map((r) => [
          r.user_email,
          r.environment,
          r.interface_name,
          localTime(r.created_at),
        ]),
      }));
    case "tc-documents":
      return fetchTestCaseDocumentEvents(
        range,
        page,
        pageSize,
        userEmails,
        environment,
        undefined,
        tq,
      ).then((p) => ({
        total: p.total,
        rows: p.items.map((r) => [
          r.user_email,
          r.environment ?? "—",
          r.interface_name ?? "—",
          r.suite_name,
          r.test_case_names.join(", "),
          r.test_case_count,
          localTime(r.created_at),
        ]),
      }));
  }
}

export default function DetailDrawer({
  range,
  userEmails,
  environment,
  userRollup,
  artifactRows,
  mapping,
}: {
  range: DateRange;
  userEmails: string[];
  environment: string[];
  userRollup: UserRollupStats[];
  artifactRows: ArtifactStats[];
  /** Everything the admin Customer mapping tab needs. Omitted while the
   *  registry is still loading, in which case the tab isn't offered. */
  mapping?: {
    registry: CustomerRegistry;
    resolve: (environment: string) => Resolution;
    environments: string[];
    totals: Record<string, number>;
    handlers: MappingHandlers;
  };
}) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<ServerTabId, number>>>(
    {},
  );
  const [serverRows, setServerRows] = useState<Row[] | undefined>(undefined);
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const expandBtnRef = useRef<HTMLButtonElement>(null);

  // Every fetched page belongs to one filter scope; changing the scope
  // invalidates all of it rather than letting a stale table linger.
  const scopeKey = `${range.from}|${range.to}|${userEmails.join(",")}|${environment.join(",")}`;

  // The filter box drives a server request on the heavy tabs, so typing a
  // word should cost one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setCounts({});
    setServerRows(undefined);
    setServerTotal(0);
    setPage(0);
    if (!range.to) return;
    let cancelled = false;
    // Tab-label counts: the paginated endpoints at page_size=1 return the
    // scope's total without the rows.
    Promise.all([
      fetchUsers(range, 1, 1, userEmails, environment),
      fetchCreatedEvents(range, 1, 1, userEmails, environment),
      fetchExecutedEvents(range, 1, 1, userEmails, environment),
      fetchDocumentEvents(range, 1, 1, userEmails, environment),
      fetchTestCaseDocumentEvents(range, 1, 1, userEmails, environment),
    ])
      .then(([u, c, e, d, t]) => {
        if (cancelled) return;
        setCounts({
          "usage-by-user": u.total,
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
    const metricCols: Column[] = METRICS.map((m) => ({
      label: m.short,
      numeric: true,
    }));

    return [
      {
        id: "usage-by-user",
        name: "Usage by user",
        columns: [
          { label: "User", field: "user_email" },
          { label: "Environment", tag: true, field: "environment" },
          { label: "Date", field: "report_date" },
          ...METRICS.map((m) => ({
            label: m.short,
            numeric: true,
            field: m.key as string,
          })),
        ],
        rows: serverRows,
        count: counts["usage-by-user"] ?? 0,
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
        rows: userRollup
          .map((r): Row => {
            const values = METRICS.map((m) => r[m.key]);
            return [
              r.user_email,
              values.reduce((a, b) => a + b, 0),
              ...values,
              r.active_days,
              r.environments,
            ];
          })
          .sort((a, b) => (b[1] as number) - (a[1] as number)),
        count: userRollup.length,
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
          { label: "User", field: "user_email" },
          { label: "Environment", tag: true, field: "environment" },
          { label: "Interface", mono: true, field: "interface_name" },
          { label: "Test case", field: "test_case_name" },
          { label: "Created at", field: "created_at" },
        ],
        rows: serverRows,
        count: counts.created ?? 0,
      },
      {
        id: "executed",
        name: "Test cases executed",
        columns: [
          { label: "User", field: "user_email" },
          { label: "Environment", tag: true, field: "environment" },
          { label: "Interface", mono: true, field: "interface_name" },
          { label: "Test case", field: "test_case_name" },
          { label: "Executed at", field: "created_at" },
        ],
        rows: serverRows,
        count: counts.executed ?? 0,
      },
      {
        id: "documents",
        name: "TSD documents",
        columns: [
          { label: "User", field: "user_email" },
          { label: "Environment", tag: true, field: "environment" },
          { label: "Interface", mono: true, field: "interface_name" },
          { label: "Generated at", field: "created_at" },
        ],
        rows: serverRows,
        count: counts.documents ?? 0,
      },
      {
        id: "tc-documents",
        name: "Test-case documents",
        columns: [
          { label: "User", field: "user_email" },
          { label: "Environment", tag: true, field: "environment" },
          { label: "Interface", mono: true, field: "interface_name" },
          { label: "Suite", field: "suite_name" },
          { label: "Test cases", wrap: true },
          { label: "Count", numeric: true, field: "test_case_count" },
          { label: "Generated at", field: "created_at" },
        ],
        rows: serverRows,
        count: counts["tc-documents"] ?? 0,
      },
      // Admin, and last: this tab writes shared reporting configuration
      // (which environment belongs to which customer) rather than reading
      // event rows like the six above it. Its "rows" exist only so the
      // drawer's own filter box, record count and CSV button keep working -
      // the editor itself renders from the environment names in column 0.
      ...(mapping
        ? [
            {
              id: "customer-mapping",
              name: "Customer mapping",
              admin: true,
              columns: [
                { label: "Environment" },
                { label: "Customer" },
                { label: "Stage" },
              ],
              rows: mapping.environments
                .map((e): Row => {
                  const resolution = mapping.resolve(e);
                  return [
                    e,
                    resolution.unassigned ? "Unassigned" : resolution.name,
                    stageLabel(stageOf(e)),
                  ];
                })
                .sort((a, b) =>
                  String(a[0]).localeCompare(String(b[0])),
                ),
              count: mapping.environments.length,
            } satisfies TabDef,
          ]
        : []),
    ];
  }, [userRollup, artifactRows, serverRows, counts, mapping]);

  const active = tabs[Math.min(tab, tabs.length - 1)];
  const serverId = SERVER_TABS.includes(active.id as ServerTabId)
    ? (active.id as ServerTabId)
    : null;
  const pageSize = expanded ? EXPANDED_PAGE_SIZE : PAGE_SIZE;
  const sortBy =
    serverId && sort ? active.columns[sort.col]?.field : undefined;
  const sortDir: "asc" | "desc" = sort?.dir === 1 ? "asc" : "desc";

  useEffect(() => {
    if (!serverId || !range.to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchServerPage(serverId, range, page + 1, pageSize, userEmails, environment, {
      q: debouncedQ || undefined,
      sortBy: sortBy || undefined,
      sortDir,
    })
      .then((res) => {
        if (cancelled) return;
        setServerRows(res.rows);
        setServerTotal(res.total);
      })
      .catch(() => !cancelled && setError("Could not load these records."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, scopeKey, debouncedQ, sortBy, sortDir, page, pageSize]);

  // Client tabs filter and sort here; server tabs arrive already filtered,
  // sorted and paged, so their rows pass straight through.
  const view = useMemo(() => {
    if (serverId) return serverRows ?? [];
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
  }, [active, query, sort, serverId, serverRows]);

  const isAdmin = !!active.admin;
  const filteredTotal = serverId ? serverTotal : view.length;
  // The mapping tab is one row per environment - short by construction, and
  // an editor you page through is an editor you lose your place in.
  const pageCount = isAdmin
    ? 1
    : Math.max(1, Math.ceil(filteredTotal / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = serverId
    ? (serverRows ?? [])
    : isAdmin
      ? view
      : view.slice(current * pageSize, (current + 1) * pageSize);

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
    setDebouncedQ("");
    setSort(null);
    setServerRows(undefined);
    setServerTotal(0);
    setError(null);
  }

  function downloadActiveCsv() {
    if (isAdmin && mapping) {
      const { header, rows } = mappingCsvRows(
        visible.map((r) => String(r[0])),
        mapping.resolve,
        mapping.totals,
      );
      downloadCsv("testease-customer-mapping.csv", header, rows);
    } else if (serverId) {
      setCsvBusy(true);
      downloadTableCsv(
        SERVER_CSV_PATHS[serverId],
        `testease-${active.id}.csv`,
        range,
        userEmails,
        environment,
        { q: debouncedQ || undefined, sortBy: sortBy || undefined, sortDir },
      )
        .catch(() => setError("Could not download the CSV."))
        .finally(() => setCsvBusy(false));
    } else {
      downloadCsv(
        `testease-${active.id}.csv`,
        active.columns.map((c) => c.label),
        view,
      );
    }
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
            {fmt(filteredTotal)}{" "}
            {isAdmin ? "environment" : "record"}
            {filteredTotal === 1 ? "" : "s"}
          </span>
          <button
            className="btn"
            disabled={csvBusy || filteredTotal === 0}
            onClick={downloadActiveCsv}
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
            {csvBusy ? "Preparing…" : "Download CSV"}
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
          ) : isAdmin && mapping ? (
            <CustomerMappingTab
              registry={mapping.registry}
              resolve={mapping.resolve}
              environments={visible.map((r) => String(r[0]))}
              allEnvironments={mapping.environments}
              totals={mapping.totals}
              handlers={mapping.handlers}
            />
          ) : active.rows === undefined ? (
            <div className="empty">Loading records…</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {active.columns.map((c, i) => {
                    const sortable = serverId ? !!c.field : true;
                    return (
                      <th key={c.label} className={c.numeric ? "n" : undefined}>
                        <button
                          disabled={!sortable}
                          onClick={() =>
                            sortable &&
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
                    );
                  })}
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
        {!isAdmin && (
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
        )}
      </section>
    </>
  );
}
