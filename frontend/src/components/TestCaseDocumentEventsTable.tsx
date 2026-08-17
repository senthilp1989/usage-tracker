import { useEffect, useState } from "react";
import { fetchTestCaseDocumentEvents } from "../api";
import type { DateRange, TestCaseDocumentEventDetail } from "../types";

const PAGE_SIZE = 10;

export default function TestCaseDocumentEventsTable({
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
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TestCaseDocumentEventDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [range.from, range.to, userEmails.join(","), environment.join(","), search]);

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
    fetchTestCaseDocumentEvents(range, page, PAGE_SIZE, userEmails, environment, search)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load test case documents generated.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, userEmails.join(","), environment.join(","), search, page]);

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
          Test case documents generated ({total.toLocaleString()})
        </button>
      </div>
      {expanded && (
        <>
          {error && <div className="card login-error">{error}</div>}
          {total === 0 ? (
            <div className="empty-note">No test case documents generated in this range yet.</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Environment</th>
                    <th>Interface</th>
                    <th>Suite</th>
                    <th>Test cases</th>
                    <th className="num">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={`${r.user_email}-${r.suite_name}-${r.created_at}-${i}`}>
                      <td>{r.user_email}</td>
                      <td>{r.environment ?? "—"}</td>
                      <td>{r.interface_name ?? "—"}</td>
                      <td>{r.suite_name}</td>
                      <td>{r.test_case_names.join(", ")}</td>
                      <td className="num">{r.test_case_count.toLocaleString()}</td>
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
