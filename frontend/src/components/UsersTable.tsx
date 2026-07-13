import { useEffect, useMemo, useState } from "react";
import { METRICS, type DateRange, type UserStats } from "../types";

const PAGE_SIZE = 10;

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: UserStats[]): string {
  const headers = ["Email", "Environment", "Date", ...METRICS.map((m) => m.label)];
  const lines = rows.map((r) =>
    [r.user_email, r.environment, r.report_date, ...METRICS.map((m) => r[m.key])]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

function downloadCsv(rows: UserStats[], range?: DateRange) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `usage-by-user${range ? `_${range.from}_to_${range.to}` : ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UsersTable({
  rows,
  range,
}: {
  rows: UserStats[];
  range?: DateRange;
}) {
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
        <h2 className="card-title">Usage by user</h2>
        {rows.length > 0 && (
          <button onClick={() => downloadCsv(rows, range)}>Download CSV</button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="empty-note">No events in this range yet.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Environment</th>
                <th>Date</th>
                {METRICS.map((m) => (
                  <th className="num" key={m.key}>
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={`${r.user_email}-${r.environment}-${r.report_date}`}>
                  <td>{r.user_email}</td>
                  <td>{r.environment}</td>
                  <td>{r.report_date}</td>
                  {METRICS.map((m) => (
                    <td className="num" key={m.key}>
                      {r[m.key].toLocaleString()}
                    </td>
                  ))}
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
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page === pageCount}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
