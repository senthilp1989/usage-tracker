import { useEffect, useMemo, useState } from "react";
import { fetchArtifacts, fetchInterfaces } from "../api";
import type { ArtifactStats, DateRange } from "../types";
import { fuzzyMatch } from "../fuzzy";
import MultiSelect from "./MultiSelect";

const PAGE_SIZE = 10;

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: ArtifactStats[]): string {
  const headers = ["Environment", "Interface", "Test cases created", "Test cases executed", "Documents generated"];
  const lines = rows.map((r) =>
    [r.environment, r.interface_name, r.test_cases_created, r.test_cases_executed, r.documents_generated]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

function downloadCsv(rows: ArtifactStats[], range?: DateRange) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `usage-by-interface${range ? `_${range.from}_to_${range.to}` : ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Date range, user, environment (dropdown), and interface filtering are all
// done server-side via query params on GET /dashboard/artifacts. The one
// exception is the global search box: like Users/CreatedEvents/ExecutedEvents,
// the environment dropdown is bypassed while searching, so rows are narrowed
// client-side by the search term instead (see the `rows` useMemo above).
export default function ArtifactsPanel({
  range,
  userEmails,
  environment,
  searchActive,
  searchTerm,
}: {
  range: DateRange;
  userEmails: string[];
  environment: string[];
  searchActive: boolean;
  searchTerm: string;
}) {
  const [interfaceNames, setInterfaceNames] = useState<string[]>([]);
  const [interfaceOptions, setInterfaceOptions] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<ArtifactStats[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // The environment dropdown filter is bypassed (empty) while a search is
  // active - same convention as Users/CreatedEvents/ExecutedEvents - so this
  // narrows the already-fetched rows by the search term client-side instead.
  const rows = useMemo(
    () => (searchActive ? rawRows.filter((r) => fuzzyMatch(searchTerm, r.environment)) : rawRows),
    [rawRows, searchActive, searchTerm],
  );

  useEffect(() => {
    fetchInterfaces().then(setInterfaceOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchArtifacts(range, userEmails, environment, interfaceNames)
      .then((data) => {
        if (cancelled) return;
        setRawRows(data);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load interface breakdown.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, userEmails.join(","), environment.join(","), interfaceNames.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  return (
    <div className={`card${loading ? " loading-dim" : ""}`}>
      <div className="card-header">
        <button
          type="button"
          className="collapse-toggle"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          <span className={`collapse-arrow${expanded ? " expanded" : ""}`} aria-hidden="true">
            ▸
          </span>
          Usage by interface ({rows.length.toLocaleString()})
        </button>
        {expanded && rows.length > 0 && <button onClick={() => downloadCsv(rows, range)}>Download CSV</button>}
      </div>
      {expanded && (
        <>
          <div className="filters">
            <MultiSelect
              label="Interface filter"
              placeholder="All interfaces"
              options={interfaceOptions}
              selected={interfaceNames}
              onChange={setInterfaceNames}
            />
          </div>
          {error && <div className="card login-error">{error}</div>}
          {rows.length === 0 ? (
            <div className="empty-note">No interface activity in this range yet.</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Environment</th>
                    <th>Interface</th>
                    <th className="num">Test cases created</th>
                    <th className="num">Test cases executed</th>
                    <th className="num">Documents generated</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={`${r.environment}-${r.interface_name}`}>
                      <td>{r.environment}</td>
                      <td>{r.interface_name}</td>
                      <td className="num">{r.test_cases_created.toLocaleString()}</td>
                      <td className="num">{r.test_cases_executed.toLocaleString()}</td>
                      <td className="num">{r.documents_generated.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageCount > 1 && (
                <div className="pagination">
                  <span className="pagination-info">
                    Page {page} of {pageCount} &middot; {rows.length.toLocaleString()} rows
                  </span>
                  <div className="pagination-controls">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                      Previous
                    </button>
                    <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
