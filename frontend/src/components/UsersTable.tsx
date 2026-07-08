import { METRICS, type UserStats } from "../types";

export default function UsersTable({ rows }: { rows: UserStats[] }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Usage by user</h2>
      </div>
      {rows.length === 0 ? (
        <div className="empty-note">No events in this range yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              {METRICS.map((m) => (
                <th className="num" key={m.key}>
                  {m.label}
                </th>
              ))}
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_email}>
                <td>{r.user_email}</td>
                {METRICS.map((m) => (
                  <td className="num" key={m.key}>
                    {r[m.key].toLocaleString()}
                  </td>
                ))}
                <td className="muted">
                  {new Date(r.last_event_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
