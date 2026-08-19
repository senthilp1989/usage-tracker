/**
 * Environment -> customer resolution, and the stage axis that comes free with
 * it.
 *
 * Environments are what the source tool writes (`Heineken_Dev`, `Hei_Test`,
 * `Celanese_Qa`); customers are what the business reports on. The registry
 * (served by /customers/registry) holds *rules*, not a frozen list, so a new
 * environment that matches an existing pattern joins its customer with no
 * code change - and anything matching nothing resolves as Unassigned, for a
 * human to decide in the mapping tab, rather than being guessed into a
 * customer.
 *
 * Resolution happens here rather than in SQL on purpose. Every customer-keyed
 * panel is the corresponding environment-keyed rollup folded one level
 * further, so a customer total and an environment total are the same rows by
 * construction and cannot drift apart. It also means an admin editing the
 * mapping regroups the whole page live, before anything is saved.
 */

export interface Customer {
  id: string;
  name: string;
  is_internal: boolean;
  /** Regex sources, matched against the *normalised* name. First match wins. */
  patterns: string[];
}

export interface EnvironmentOverride {
  name_normalised: string;
  /** null is an explicit "leave unassigned", which still beats a rule. */
  customer_id: string | null;
}

export interface CustomerRegistry {
  customers: Customer[];
  overrides: EnvironmentOverride[];
}

export const EMPTY_REGISTRY: CustomerRegistry = {
  customers: [],
  overrides: [],
};

/** Sentinel id for "no customer". Not a row in the registry - it is the
 *  absence of one, given a name so the <select> and the rollups can key on
 *  something. */
export const UNASSIGNED_ID = "__unassigned";
export const UNASSIGNED_NAME = "Unassigned";

export type ResolutionSource = "rule" | "manual" | "none";

export interface Resolution {
  id: string;
  name: string;
  source: ResolutionSource;
  /** The pattern that matched, for the "Resolved by" column. */
  matchedBy: string | null;
  unassigned: boolean;
}

const UNRESOLVED: Resolution = {
  id: UNASSIGNED_ID,
  name: UNASSIGNED_NAME,
  source: "none",
  matchedBy: null,
  unassigned: true,
};

/**
 * Layer 1: case-fold, trim, collapse `-` and whitespace to `_`. This is what
 * every pattern and every override key is matched against, and it is why
 * `Tarento_Dev` and `TARENTO_DEV` resolve to one customer even where the
 * source rows still spell them differently.
 */
export function normalizeEnv(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** A stored pattern that no longer compiles must not blank the page - it just
 *  stops matching, and the environments it used to catch show as Unassigned
 *  in the mapping tab, where someone will notice. */
function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/**
 * Builds a memoised `environment -> Resolution` function for one registry.
 * Memoised per call because every panel resolves the same handful of
 * environment names repeatedly on each render.
 */
export function makeResolver(
  registry: CustomerRegistry,
): (environment: string) => Resolution {
  const compiled = registry.customers.map((c) => ({
    customer: c,
    rules: c.patterns
      .map((p) => ({ source: p, re: compile(p) }))
      .filter((r): r is { source: string; re: RegExp } => r.re !== null),
  }));
  const byId = new Map(registry.customers.map((c) => [c.id, c]));
  const overrides = new Map(
    registry.overrides.map((o) => [o.name_normalised, o.customer_id]),
  );
  const cache = new Map<string, Resolution>();

  return function resolve(environment: string): Resolution {
    const hit = cache.get(environment);
    if (hit) return hit;
    const normalised = normalizeEnv(environment);

    // Layer 3 first: a manual choice beats every pattern, so one awkward name
    // never forces a contorted regex.
    let out: Resolution | null = null;
    if (overrides.has(normalised)) {
      const id = overrides.get(normalised) ?? null;
      const customer = id === null ? undefined : byId.get(id);
      out = customer
        ? {
            id: customer.id,
            name: customer.name,
            source: "manual",
            matchedBy: null,
            unassigned: false,
          }
        : { ...UNRESOLVED, source: "manual" };
    }

    // Layer 2: ordered patterns, first match wins.
    if (!out) {
      for (const { customer, rules } of compiled) {
        const matched = rules.find((r) => r.re.test(normalised));
        if (matched) {
          out = {
            id: customer.id,
            name: customer.name,
            source: "rule",
            matchedBy: matched.source,
            unassigned: false,
          };
          break;
        }
      }
    }

    const result = out ?? UNRESOLVED;
    cache.set(environment, result);
    return result;
  };
}

/** What the rules alone would say, ignoring any override - the value a "reset
 *  this row" falls back to, and the one an admin picking it should clear the
 *  override rather than store a redundant one. */
export function resolveByRule(
  registry: CustomerRegistry,
  environment: string,
): Resolution {
  return makeResolver({ ...registry, overrides: [] })(environment);
}

/**
 * The second axis, parsed from the name's suffix. Unrecognised tokens are
 * kept verbatim rather than forced into a bucket: `Bat_Fj` is a market and
 * `Heineken_Pipo` is a platform, and labelling either of them "Dev" would be
 * worse than saying "Other (fj)" and letting a human classify it.
 */
const STAGE_RULES: [RegExp, string][] = [
  [/(^|_)dev(_|$)/, "Dev"],
  [/(^|_)qas?(_|$)/, "QA"],
  [/(^|_)test(_|$)/, "Test"],
  [/(^|_)uat(_|$)/, "UAT"],
  [/(^|_)prod(_|$)/, "Prod"],
];

export interface Stage {
  stage: string;
  /** The unrecognised suffix, when there is one - shown as "Other (pipo)". */
  token: string | null;
}

export function stageOf(environment: string): Stage {
  const normalised = normalizeEnv(environment);
  for (const [re, stage] of STAGE_RULES)
    if (re.test(normalised)) return { stage, token: null };
  const token = normalised.split("_").slice(1).join("_");
  return { stage: "Other", token: token || null };
}

export function stageLabel(stage: Stage): string {
  return stage.token ? `${stage.stage} (${stage.token})` : stage.stage;
}

/** Slug for a customer an admin types into "Add customer", or "" when the
 *  name has nothing to build one from - a name of pure punctuation would
 *  otherwise slug down to the bare "c_" prefix, and the next one would
 *  silently collide with it. */
export function customerSlug(name: string): string {
  const body = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return body ? `c_${body}` : "";
}

export function sameRegistry(
  a: CustomerRegistry,
  b: CustomerRegistry,
): boolean {
  const key = (r: CustomerRegistry) =>
    JSON.stringify({
      customers: [...r.customers]
        .map((c) => [c.id, c.name, c.is_internal])
        .sort(),
      overrides: [...r.overrides]
        .map((o) => [o.name_normalised, o.customer_id])
        .sort(),
    });
  return key(a) === key(b);
}
