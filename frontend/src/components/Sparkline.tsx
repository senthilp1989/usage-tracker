const W = 150;
const H = 40;
const PAD = 4;

export default function Sparkline({ values, color }: { values: number[]; color: string }) {
  const n = values.length;
  if (n === 0) return <svg className="spark" width={W} height={H} aria-hidden="true" />;

  const max = Math.max(1, ...values);
  const x = (i: number) => PAD + (W - 2 * PAD) * (n < 2 ? 0.5 : i / (n - 1));
  const y = (v: number) => H - PAD - (H - 2 * PAD) * (v / max);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `M${x(0)},${H - PAD} L${points} L${x(n - 1)},${H - PAD}Z`;

  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={area} fill={color} opacity={0.1} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r={3.4} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
