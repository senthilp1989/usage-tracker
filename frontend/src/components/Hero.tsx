import { computeDelta } from "../delta";
import DeltaIcon from "./DeltaIcon";

export default function Hero({
  total,
  prevTotal,
  windowDays,
  activeUsers,
  environments,
  interfaces,
  activeDays,
}: {
  total: number;
  prevTotal: number;
  windowDays: number;
  activeUsers: number;
  environments: number;
  interfaces: number;
  activeDays: number;
}) {
  const d = computeDelta(total, prevTotal);
  return (
    <section className="hero" aria-labelledby="hero-label">
      <div>
        <div className="hero-eyebrow" id="hero-label">
          Total tracked actions
        </div>
        <div className="hero-num">{total.toLocaleString()}</div>
        <div className="hero-unit">test cases &amp; documents created, run and exported</div>
        <div className="hero-delta">
          {d.none ? (
            <span>
              {d.text} for the previous {windowDays} days
            </span>
          ) : (
            <>
              <DeltaIcon direction={d.direction} />
              <span>
                {d.text} vs previous {windowDays} days
              </span>
            </>
          )}
        </div>
      </div>
      <div className="hero-facts">
        <div>
          <b>{activeUsers.toLocaleString()}</b>active users
        </div>
        <div>
          <b>{environments.toLocaleString()}</b>environments
        </div>
        <div>
          <b>{interfaces.toLocaleString()}</b>interfaces
        </div>
        <div>
          <b>
            {activeDays}/{windowDays}
          </b>
          days with activity
        </div>
      </div>
    </section>
  );
}
