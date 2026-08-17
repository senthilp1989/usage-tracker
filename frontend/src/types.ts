export interface StatsSummary {
  users_reporting: number;
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_case_documents_generated: number;
}

export interface DailyStats {
  day: string; // YYYY-MM-DD
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_case_documents_generated: number;
}

export interface UserStats {
  user_email: string;
  environment: string;
  report_date: string; // YYYY-MM-DD
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_case_documents_generated: number;
  last_event_at: string;
}

export interface UserEnvironmentStats {
  user_email: string;
  environment: string;
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_case_documents_generated: number;
}

export interface ArtifactStats {
  environment: string;
  interface_name: string;
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_case_documents_generated: number;
}

export interface CreatedEventDetail {
  user_email: string;
  environment: string;
  interface_name: string;
  test_case_name: string;
  created_at: string;
}

export interface ExecutedEventDetail {
  user_email: string;
  environment: string;
  interface_name: string;
  test_case_name: string;
  created_at: string;
}

export interface DocumentEventDetail {
  user_email: string;
  environment: string;
  interface_name: string;
  created_at: string;
}

export interface TestCaseDocumentEventDetail {
  user_email: string;
  environment: string | null;
  interface_name: string | null;
  suite_name: string;
  test_case_names: string[];
  test_case_count: number;
  created_at: string;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface Page<T> {
  items: T[];
  total: number;
}

// Four metrics, four fixed colour slots. Colour follows the metric, never its
// rank - filtering a series out must not repaint the survivors, so the slot
// index is baked in here rather than derived from position at render time.
export const METRICS = [
  {
    key: "test_cases_created",
    label: "Test cases created",
    short: "Created",
    colorVar: "var(--s1)",
  },
  {
    key: "test_cases_executed",
    label: "Test cases executed",
    short: "Executed",
    colorVar: "var(--s2)",
  },
  {
    key: "documents_generated",
    label: "TSD documents generated",
    short: "TSD docs",
    colorVar: "var(--s3)",
  },
  {
    key: "test_case_documents_generated",
    label: "Test case documents generated",
    short: "TC docs",
    colorVar: "var(--s4)",
  },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

/** The four metric counts for one grouping key, in METRICS order. */
export type MetricTuple = [number, number, number, number];

export function metricTuple(row: Record<MetricKey, number>): MetricTuple {
  return [
    row.test_cases_created,
    row.test_cases_executed,
    row.documents_generated,
    row.test_case_documents_generated,
  ];
}

export function tupleTotal(
  values: MetricTuple,
  series: boolean[] = [true, true, true, true],
): number {
  return values.reduce((sum, v, i) => sum + (series[i] ? v : 0), 0);
}
