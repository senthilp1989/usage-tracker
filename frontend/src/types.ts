export interface StatsSummary {
  users_reporting: number;
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_cases_passed: number;
  test_cases_failed: number;
}

export interface DailyStats {
  day: string; // YYYY-MM-DD
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_cases_passed: number;
  test_cases_failed: number;
}

export interface UserStats {
  user_email: string;
  environment: string;
  report_date: string; // YYYY-MM-DD
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
  test_cases_passed: number;
  test_cases_failed: number;
  last_event_at: string;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export const METRICS = [
  { key: "test_cases_created", label: "Test cases created" },
  { key: "test_cases_executed", label: "Test cases executed" },
  { key: "documents_generated", label: "Documents generated" },
  { key: "test_cases_passed", label: "Test cases passed" },
  { key: "test_cases_failed", label: "Test cases failed" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

// Daily Activity trend chart/table intentionally shows only the original three -
// Passed/Failed are visualized separately (pie + pass-rate meter), not as trend lines.
export const TREND_METRICS = METRICS.slice(0, 3);
