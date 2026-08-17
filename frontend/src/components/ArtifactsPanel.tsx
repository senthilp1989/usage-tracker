import { useEffect, useState } from "react";
import { fetchArtifacts, fetchInterfaces } from "../api";
import type { ArtifactStats, DateRange } from "../types";
import MultiSelect from "./MultiSelect";

const PAGE_SIZE = 10;

// Date range, user, environment (dropdown), and interface filtering are all
// done server-side via query params on GET /dashboard/artifacts. `search`
// (the global search box) is likewise resolved server-side, mutually
// exclusive with the environment dropdown - same convention as the other
// tables.
export default function ArtifactsPanel({
  range,
  userEmails,
  environment,
  search,
}: {
  range: DateRange;
  userEmails: string[];
  environment: string[];
  search?: string;
}) {
  const [interfaceNames, setInterfaceNames] = useState<string[]>([]);
  const [interfaceOptions, setInterfaceOptions] = useState<string[]>([]);
  const [items, setItems] = useState<ArtifactStats[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    fetchInterfaces().then(setInterfaceOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [range.from, range.to, userEmails.join(","), environment.join(","), interfaceNames.join(","), search]);

  useEffect(() => {
    if (!range.to) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchArtifacts(range, page, PAGE_SIZE, userEmails, environment, interfaceNames, search)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
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
  }, [range.from, range.to, userEmails.join(","), environment.join(","), interfaceNames.join(","), search, page]);

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
          Usage by interface ({total.toLocaleString()})
        </button>
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
          {total === 0 ? (
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
                    <th className="num">TSD documents generated</th>
                    <th className="num">Test case documents generated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={`${r.environment}-${r.interface_name}`}>
                      <td>{r.environment}</td>
                      <td>{r.interface_name}</td>
                      <td className="num">{r.test_cases_created.toLocaleString()}</td>
                      <td className="num">{r.test_cases_executed.toLocaleString()}</td>
                      <td className="num">{r.documents_generated.toLocaleString()}</td>
                      <td className="num">{r.test_case_documents_generated.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageCount > 1 && (
                <div className="pagination">
                  <span className="pagination-info">
                    Page {page} of {pageCount} &middot; {total.toLocaleString()} rows
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
