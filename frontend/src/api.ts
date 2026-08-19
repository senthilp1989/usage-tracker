import type {
  ArtifactStats,
  CreatedEventDetail,
  DailyStats,
  DateRange,
  DocumentEventDetail,
  EnvironmentRollupStats,
  ExecutedEventDetail,
  Page,
  StatsSummary,
  TestCaseDocumentEventDetail,
  UserEnvironmentStats,
  UserRollupStats,
  UserStats,
} from "./types";

const TOKEN_KEY = "usage_tracker_token";
const ACCOUNT_KEY = "usage_tracker_account";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Whatever was typed at sign-in - the token payload carries only an expiry,
 *  so this is the only account label the dashboard has for the header. */
export function getAccount(): string {
  return localStorage.getItem(ACCOUNT_KEY) ?? "";
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
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
  localStorage.setItem(ACCOUNT_KEY, username);
}

// `search` and `environmentIds` are mutually exclusive on the backend (search
// overrides the environment dropdown) - when both are passed, search wins.
function scope(
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  (userEmails ?? []).forEach((email) => params.append("user_email", email));
  if (search) {
    params.set("search", search);
  } else {
    (environmentIds ?? []).forEach((id) => params.append("environment", id));
  }
  return params.toString();
}

/** Drawer-table view state, forwarded to the backend: free-text `q` (ANDed on
 *  top of the date/user/environment scope) and a whitelisted sort column. */
export interface TableQuery {
  q?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

function tableParams(tq?: TableQuery): string {
  if (!tq) return "";
  const params = new URLSearchParams();
  if (tq.q) params.set("q", tq.q);
  if (tq.sortBy) {
    params.set("sort_by", tq.sortBy);
    params.set("sort_dir", tq.sortDir ?? "desc");
  }
  const s = params.toString();
  return s ? `&${s}` : "";
}

/** Server-built CSV of the full filtered-and-sorted set - streamed straight
 *  to a file download, never parsed as data. Same scope + q + sort params as
 *  the table view it sits next to, so the file always matches the screen. */
export async function downloadTableCsv(
  path: string,
  filename: string,
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  tq?: TableQuery,
): Promise<void> {
  const token = getToken();
  const res = await fetch(
    `/api${path}?${scope(range, userEmails, environmentIds)}${tableParams(tq)}&format=csv`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (res.status === 401) {
    clearToken();
    throw new UnauthorizedError("Session expired");
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const fetchSummary = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<StatsSummary>(
    `/dashboard/summary?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchDaily = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<DailyStats[]>(
    `/dashboard/daily?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchUsers = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
  tq?: TableQuery,
) =>
  request<Page<UserStats>>(
    `/dashboard/users?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}${tableParams(tq)}`,
  );

// The flat (user, environment, day) fact table. Since the rollups below moved
// the panel math server-side, only two things still want the raw rows - the
// CSV download button and the drawer's "Usage by user" tab - and both fetch
// on demand, never on page load.
export const fetchUsersExport = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<UserStats[]>(
    `/dashboard/users/export?${scope(range, userEmails, environmentIds, search)}`,
  );

// The /rollup twins are the server-side versions of the grouping the page used
// to do in JS over the flat export. All three are built on the same combined
// subquery as /users/export, so no panel can disagree with the fact table.
export const fetchUsersRollup = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<UserRollupStats[]>(
    `/dashboard/rollup/users?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchEnvironmentsRollup = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<EnvironmentRollupStats[]>(
    `/dashboard/rollup/environments?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchUserEnvironmentRollup = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<UserEnvironmentStats[]>(
    `/dashboard/user-environment-rollup?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchCreatedEventsExport = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<CreatedEventDetail[]>(
    `/dashboard/created-events/export?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchExecutedEventsExport = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<ExecutedEventDetail[]>(
    `/dashboard/executed-events/export?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchDocumentEventsExport = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<DocumentEventDetail[]>(
    `/dashboard/document-events/export?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchTestCaseDocumentEventsExport = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
) =>
  request<TestCaseDocumentEventDetail[]>(
    `/dashboard/test-case-document-events/export?${scope(range, userEmails, environmentIds, search)}`,
  );

export const fetchCreatedEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
  tq?: TableQuery,
) =>
  request<Page<CreatedEventDetail>>(
    `/dashboard/created-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}${tableParams(tq)}`,
  );

export const fetchExecutedEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
  tq?: TableQuery,
) =>
  request<Page<ExecutedEventDetail>>(
    `/dashboard/executed-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}${tableParams(tq)}`,
  );

export const fetchDocumentEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
  tq?: TableQuery,
) =>
  request<Page<DocumentEventDetail>>(
    `/dashboard/document-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}${tableParams(tq)}`,
  );

export const fetchTestCaseDocumentEvents = (
  range: DateRange,
  page: number,
  pageSize: number,
  userEmails?: string[],
  environmentIds?: string[],
  search?: string,
  tq?: TableQuery,
) =>
  request<Page<TestCaseDocumentEventDetail>>(
    `/dashboard/test-case-document-events?${scope(range, userEmails, environmentIds, search)}&page=${page}&page_size=${pageSize}${tableParams(tq)}`,
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
  const params = new URLSearchParams(
    scope(range, userEmails, environmentIds, search),
  );
  (interfaceNames ?? []).forEach((iface) =>
    params.append("interface_name", iface),
  );
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

export const fetchArtifactsExport = (
  range: DateRange,
  userEmails?: string[],
  environmentIds?: string[],
  interfaceNames?: string[],
  search?: string,
) =>
  request<ArtifactStats[]>(
    `/dashboard/artifacts/export?${artifactScope(range, userEmails, environmentIds, interfaceNames, search)}`,
  );

export const fetchInterfaces = () => request<string[]>("/dashboard/interfaces");
