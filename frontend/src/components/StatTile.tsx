export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function StatTile({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="card">
      <p className="stat-label">{label}</p>
      <div className="stat-value" title={value.toLocaleString()}>
        {formatCompact(value)}
      </div>
    </div>
  );
}
