import type { DailyStats, DateRange, StatsSummary, UserStats } from "./types";

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

function scope(range: DateRange, userEmail?: string): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (userEmail) params.set("user_email", userEmail);
  return params.toString();
}

export const fetchSummary = (range: DateRange, userEmail?: string) =>
  request<StatsSummary>(`/dashboard/summary?${scope(range, userEmail)}`);

export const fetchDaily = (range: DateRange, userEmail?: string) =>
  request<DailyStats[]>(`/dashboard/daily?${scope(range, userEmail)}`);

export const fetchUsers = (range: DateRange) =>
  request<UserStats[]>(`/dashboard/users?${scope(range)}`);

export const fetchUserEmails = () =>
  request<string[]>("/dashboard/user-emails");
