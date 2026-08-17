import { computeDelta } from "../delta";
import DeltaIcon from "./DeltaIcon";
import Sparkline from "./Sparkline";

export default function KpiTile({
  label,
  color,
  value,
  prevValue,
  sparkValues,
}: {
  label: string;
  color: string;
  value: number;
  prevValue: number;
  sparkValues: number[];
}) {
  const d = computeDelta(value, prevValue);
  return (
    <div className="card kpi">
      <div className="k-top">
        <span className="k-dot" style={{ background: color }} />
        <span className="k-label">{label}</span>
      </div>
      <div className="k-val">{value.toLocaleString()}</div>
      <div className="k-foot">
        <span className={`delta ${d.direction}`}>
          {d.none ? (
            <span className="cap">{d.text}</span>
          ) : (
            <>
              <DeltaIcon direction={d.direction} /> {d.text} <span className="cap">vs prev.</span>
            </>
          )}
        </span>
        <Sparkline values={sparkValues} color={color} />
      </div>
    </div>
  );
}
