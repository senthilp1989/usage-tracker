const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 64;
const LABEL_RADIUS = RADIUS * 0.6;
const MIN_LABEL_FRACTION = 0.08;

function pointAt(fraction: number, radius: number): [number, number] {
  const angle = ((fraction * 360 - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
}

function wedgePath(startFraction: number, endFraction: number): string {
  const [startX, startY] = pointAt(startFraction, RADIUS);
  const [endX, endY] = pointAt(endFraction, RADIUS);
  const largeArcFlag = endFraction - startFraction > 0.5 ? 1 : 0;
  return `M${CENTER},${CENTER} L${startX},${startY} A${RADIUS},${RADIUS} 0 ${largeArcFlag} 1 ${endX},${endY} Z`;
}

function SliceLabel({ startFraction, endFraction, share }: { startFraction: number; endFraction: number; share: number }) {
  if (share < MIN_LABEL_FRACTION) return null;
  const [x, y] = pointAt((startFraction + endFraction) / 2, LABEL_RADIUS);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={600} fill="#fff">
      {Math.round(share * 100)}%
    </text>
  );
}

export default function PassFailPie({ passed, failed }: { passed: number; failed: number }) {
  const total = passed + failed;
  const passedShare = total > 0 ? passed / total : 0;
  const failedShare = total > 0 ? failed / total : 0;

  return (
    <div className="card">
      <h2 className="card-title">Passed vs failed</h2>
      {total === 0 ? (
        <div className="empty-note">No completed executions in this range yet.</div>
      ) : (
        <div className="pie-chart-wrap">
          <svg width={SIZE} height={SIZE} role="img" aria-label="Passed vs failed test executions">
            {passed === total ? (
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="var(--good)" />
            ) : failed === total ? (
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="var(--critical)" />
            ) : (
              <>
                <path d={wedgePath(0, passedShare)} fill="var(--good)" />
                <path d={wedgePath(passedShare, 1)} fill="var(--critical)" />
              </>
            )}
            <SliceLabel startFraction={0} endFraction={passedShare} share={passedShare} />
            <SliceLabel startFraction={passedShare} endFraction={1} share={failedShare} />
          </svg>
          <ul className="pie-legend">
            <li className="pie-legend-item">
              <span className="pie-legend-swatch" style={{ background: "var(--good)" }} />
              Passed
              <strong>{passed.toLocaleString()}</strong>
            </li>
            <li className="pie-legend-item">
              <span className="pie-legend-swatch" style={{ background: "var(--critical)" }} />
              Failed
              <strong>{failed.toLocaleString()}</strong>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
