import { useEffect, useMemo, useState } from "react";
import type { DateRange, TestCaseDocumentEventDetail } from "../types";

const PAGE_SIZE = 10;

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: TestCaseDocumentEventDetail[]): string {
  const headers = ["Email", "Environment", "Interface", "Suite", "Test cases", "Test case count"];
  const lines = rows.map((r) =>
    [
      r.user_email,
      r.environment ?? "",
      r.interface_name ?? "",
      r.suite_name,
      r.test_case_names.join("; "),
      r.test_case_count,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

function downloadCsv(rows: TestCaseDocumentEventDetail[], range?: DateRange) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `test-case-documents-generated${range ? `_${range.from}_to_${range.to}` : ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TestCaseDocumentEventsTable({
  rows,
  range,
}: {
  rows: TestCaseDocumentEventDetail[];
  range?: DateRange;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [rows]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  return (
    <div className="card">
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
          Test case documents generated ({rows.length.toLocaleString()})
        </button>
        {expanded && rows.length > 0 && <button onClick={() => downloadCsv(rows, range)}>Download CSV</button>}
      </div>
      {expanded &&
        (rows.length === 0 ? (
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
                {pageRows.map((r, i) => (
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
        ))}
    </div>
  );
}
