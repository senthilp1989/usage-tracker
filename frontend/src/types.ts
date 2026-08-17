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

export const METRICS = [
  { key: "test_cases_created", label: "Test cases created" },
  { key: "test_cases_executed", label: "Test cases executed" },
  { key: "documents_generated", label: "TSD documents generated" },
  { key: "test_case_documents_generated", label: "Test case documents generated" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

export const TREND_METRICS = METRICS;
