export interface StatsSummary {
  users_reporting: number;
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
}

export interface DailyStats {
  day: string; // YYYY-MM-DD
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
}

export interface UserStats {
  user_email: string;
  environment_id: string;
  report_date: string; // YYYY-MM-DD
  test_cases_created: number;
  test_cases_executed: number;
  documents_generated: number;
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
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];
