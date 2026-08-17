import type {
  ArtifactStats,
  CreatedEventDetail,
  DailyStats,
  DateRange,
  DocumentEventDetail,
  ExecutedEventDetail,
  Page,
  StatsSummary,
  TestCaseDocumentEventDetail,
  UserStats,
} from "./types";

const TOKEN_KEY = "usage_tracker_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    throw new UnauthorizedError("Session expired");
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch("/api/dashboard/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) throw new UnauthorizedError("Invalid credentials");
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const data = (await res.json()) as { token: string };
  localStorage.setItem(TOKEN_KEY, data.token);
}

// `search` and `environmentIds` are mutually exclusive on the backend (search
// overrides the environment dropdown) - when both are passed, search wins.
function scope(range: DateRange, userEmails?: string[], environmentIds?: string[], search?: string): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  (userEmails ?? []).forEach((email) => params.append("user_email", email));
  if (search) {
    params.set("search", search);
  } else {
    (environmentIds ?? []).forEach((id) => params.append("environment", id));
  }
  return params.toString();
}

export const fetchSummary = (range: DateRange, userEmails?: string[], environmentIds?: string[], search?: string) =>
  request<StatsSummary>(`/dashboard/summary?${scope(range, userEmails, environmentIds, search)}`);

export const fetchDaily = (range: DateRange, userEmails?: string[], environmentIds?: string[], search?: string) =>
  request<DailyStats[]>(`/dashboard/daily?${scope(range, userEmails, environmentIds, search)}`);

export const fetchUsers = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<Page<UserStats>>(
    `/dashboard/users?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}`,
  );

export const fetchCreatedEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<Page<CreatedEventDetail>>(
    `/dashboard/created-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}`,
  );

export const fetchExecutedEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<Page<ExecutedEventDetail>>(
    `/dashboard/executed-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}`,
  );

export const fetchDocumentEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<Page<DocumentEventDetail>>(
    `/dashboard/document-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}`,
  );

export const fetchTestCaseDocumentEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<Page<TestCaseDocumentEventDetail>>(
    `/dashboard/test-case-document-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}`,
  );

export const fetchUserEmails = () =>
  request<string[]>("/dashboard/user-emails");

export const fetchEnvironmentIds = () =>
  request<string[]>("/dashboard/environments");

function artifactScope(
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  interfaceNames?: string[],
  search?: string,
): string {
  const params = new URLSearchParams(scope(range, userEmails, environmentIds, search));
  (interfaceNames ?? []).forEach((iface) => params.append("interface_name", iface));
  return params.toString();
}

export const fetchArtifacts = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  interfaceNames?: string[],
  search?: string,
) =>
  request<Page<ArtifactStats>>(
    `/dashboard/artifacts?${artifactScope(range, userEmails, environmentIds, interfaceNames, search)}&page=${page}&page_size=${pageSize}`,
  );

export const fetchInterfaces = () => request<string[]>("/dashboard/interfaces");
