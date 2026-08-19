import { useState } from "react";
import {
  normalizeEnv,
  resolveByRule,
  stageLabel,
  stageOf,
  UNASSIGNED_ID,
  type CustomerRegistry,
  type Resolution,
} from "../customers";
import { fmt } from "../format";

export interface MappingHandlers {
  /** `customerId === undefined` clears the override and falls back to the
   *  rule; `null` pins the environment to Unassigned on purpose. */
  onOverride: (
    nameNormalised: string,
    customerId: string | null | undefined,
  ) => void;
  /** Returns a reason the name was refused, or null when it was added. */
  onAddCustomer: (name: string) => string | null;
  onRevertAll: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  error: string | null;
}

/**
 * Admin: where an environment's customer actually gets decided.
 *
 * One row per environment: how it resolved, and the control that changes it.
 * A manual choice beats every pattern, and picking the value the rule would
 * have produced *clears* the override instead of storing a redundant one - so
 * the saved payload only ever holds genuine exceptions and stays readable as
 * "the rules got these wrong".
 *
 * Edits regroup the whole dashboard immediately, before anything is saved, so
 * the effect of a reassignment is visible while deciding on it.
 */
export default function CustomerMappingTab({
  registry,
  resolve,
  environments,
  allEnvironments,
  totals,
  handlers,
}: {
  registry: CustomerRegistry;
  resolve: (environment: string) => Resolution;
  /** The rows to draw - already narrowed by the drawer's filter box, so the
   *  record count above the table and the CSV below it agree with it. */
  environments: string[];
  /** Every environment, filtered or not, for the "shares this key" check -
   *  a collapse only makes sense against the full set. */
  allEnvironments: string[];
  totals: Record<string, number>;
  handlers: MappingHandlers;
}) {
  const [newCustomer, setNewCustomer] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const shown = environments;

  // Two raw names collapsing to one normalised name is the casing/whitespace
  // split showing itself - they are one environment here and share a mapping,
  // which is worth saying out loud rather than leaving as a coincidence.
  const collapsed = new Map<string, string[]>();
  for (const e of allEnvironments) {
    const n = normalizeEnv(e);
    if (!collapsed.has(n)) collapsed.set(n, []);
    collapsed.get(n)!.push(e);
  }

  const overrides = new Map(
    registry.overrides.map((o) => [o.name_normalised, o.customer_id]),
  );

  function addCustomer() {
    const name = newCustomer.trim();
    if (!name) return;
    const refused = handlers.onAddCustomer(name);
    setAddError(refused);
    // Keep the text on a refusal so the name can be corrected rather than
    // retyped.
    if (!refused) setNewCustomer("");
  }

  return (
    <div className="mapping">
      <div className="maptools">
        {overrides.size > 0 ? (
          <>
            <span className="ovchip">
              {overrides.size} manual override{overrides.size === 1 ? "" : "s"}
            </span>
            <button className="btn" onClick={handlers.onRevertAll}>
              Revert all
            </button>
          </>
        ) : (
          <span className="maphint">All environments resolved by rule.</span>
        )}
        <div className="spacer" />
        <div className="addcust">
          <input
            type="text"
            value={newCustomer}
            placeholder="New customer name…"
            aria-label="New customer name"
            onChange={(e) => {
              setNewCustomer(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomer();
              }
            }}
          />
          <button
            className="btn"
            disabled={!newCustomer.trim()}
            onClick={addCustomer}
            title="Creates a manual-only customer, with no patterns — for a one-off that doesn't deserve a rule"
          >
            Add
          </button>
        </div>
        <button
          className="btn primary"
          disabled={!handlers.dirty || handlers.saving}
          onClick={handlers.onSave}
        >
          {handlers.saving ? "Saving…" : "Save mapping"}
        </button>
      </div>

      {addError && <div className="note map-error">{addError}</div>}
      {handlers.error && <div className="note map-error">{handlers.error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>Environment</th>
            <th>Normalised</th>
            <th>Stage</th>
            <th>Resolved by</th>
            <th>Customer</th>
            <th className="n">Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
                No environment matches this filter
              </td>
            </tr>
          ) : (
            shown.map((environment) => {
              const normalised = normalizeEnv(environment);
              const resolution = resolve(environment);
              const stage = stageOf(environment);
              const shares = collapsed.get(normalised) ?? [environment];
              const overridden = overrides.has(normalised);
              return (
                <tr key={environment}>
                  <td>
                    <span className="mono">{environment}</span>
                  </td>
                  <td>
                    <span className="mono muted">{normalised}</span>
                    {shares.length > 1 && (
                      <span
                        className="src none shares"
                        title={`${shares.join(" and ")} collapse to the same normalised name, so they are one environment here and share a mapping.`}
                      >
                        shares this key
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className="tag"
                      title={
                        stage.token
                          ? `"${stage.token}" is not a recognised stage token — classify it here`
                          : undefined
                      }
                    >
                      {stage.stage}
                      {stage.token ? ` · ${stage.token}` : ""}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`src ${resolution.source}`}
                      title={
                        resolution.matchedBy
                          ? `matched /${resolution.matchedBy}/i`
                          : undefined
                      }
                    >
                      {resolution.source === "manual"
                        ? "Manual"
                        : resolution.source === "rule"
                          ? "Rule"
                          : "Unassigned"}
                    </span>
                    {resolution.source === "rule" && resolution.matchedBy && (
                      <span className="reg-rule">
                        /{resolution.matchedBy}/i
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className={`custsel${overridden ? " changed" : ""}`}
                      aria-label={`Customer for ${environment}`}
                      value={
                        resolution.unassigned ? UNASSIGNED_ID : resolution.id
                      }
                      onChange={(e) => {
                        const picked =
                          e.target.value === UNASSIGNED_ID
                            ? null
                            : e.target.value;
                        // Choosing what the rule already says drops the
                        // override rather than storing a redundant one.
                        const byRule = resolveByRule(registry, environment);
                        const ruleValue = byRule.unassigned ? null : byRule.id;
                        handlers.onOverride(
                          normalised,
                          picked === ruleValue ? undefined : picked,
                        );
                      }}
                    >
                      <option value={UNASSIGNED_ID}>— Unassigned</option>
                      {registry.customers.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                          {c.is_internal && !/internal/i.test(c.name)
                            ? " (internal)"
                            : ""}
                        </option>
                      ))}
                    </select>
                    {overridden && (
                      <button
                        className="link-btn"
                        title="fall back to the rule"
                        onClick={() =>
                          handlers.onOverride(normalised, undefined)
                        }
                      >
                        reset
                      </button>
                    )}
                  </td>
                  <td className={`n${totals[environment] ? "" : " zero"}`}>
                    {fmt(totals[environment] ?? 0)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* One child, not several: `.note` is a flex row (icon + text), so bare
          inline elements dropped straight into it become flex items and the
          sentence breaks apart. */}
      <div className="note map-note">
        <span>
          A manual choice overrides every pattern, and clearing it falls back
          to the rule — so the registry stays readable and one awkward name
          never forces a contorted regex. Changes regroup the dashboard
          immediately; <b>Save mapping</b> writes them to{" "}
          <span className="mono">environment_mappings</span>.
        </span>
      </div>
    </div>
  );
}

/** CSV of the resolved mapping, for the drawer's download button. */
export function mappingCsvRows(
  environments: string[],
  resolve: (environment: string) => Resolution,
  totals: Record<string, number>,
): { header: string[]; rows: (string | number)[][] } {
  return {
    header: [
      "environment",
      "normalised",
      "stage",
      "resolved_by",
      "customer",
      "actions",
    ],
    rows: [...environments]
      .sort((a, b) => a.localeCompare(b))
      .map((e) => {
        const resolution = resolve(e);
        return [
          e,
          normalizeEnv(e),
          stageLabel(stageOf(e)),
          resolution.source,
          resolution.unassigned ? "" : resolution.name,
          totals[e] ?? 0,
        ];
      }),
  };
}
