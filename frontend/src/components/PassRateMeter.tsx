const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 56;
const STROKE_WIDTH = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function severityColor(rate: number): string {
  if (rate >= 80) return "var(--good)";
  if (rate >= 50) return "var(--warning)";
  return "var(--critical)";
}

export default function PassRateMeter({ passed, failed }: { passed: number; failed: number }) {
  const total = passed + failed;
  const rate = total > 0 ? (passed / total) * 100 : null;

  return (
    <div className="card">
      <h2 className="card-title">Pass rate</h2>
      <div className="meter-wrap">
        <svg width={SIZE} height={SIZE} role="img" aria-label="Pass rate">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--grid)" strokeWidth={STROKE_WIDTH} />
          {rate !== null && (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={severityColor(rate)}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={`${(rate / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          )}
        </svg>
        <div className="meter-value">{rate === null ? "—" : `${Math.round(rate)}%`}</div>
      </div>
      {rate === null && <div className="empty-note">No completed executions in this range yet.</div>}
    </div>
  );
}
