# Usage Tracker — Integration Guide

This document describes how an external system (e.g. Test Ease) should report
usage data to the TestEase Usage Tracker. It covers authentication, the request
format, upsert semantics, error handling, and a recommended reporting
strategy.

## 1. Overview

The Usage Tracker is a passive ingestion service. It does **not** poll or
pull data from anywhere — your system must actively `POST` usage numbers to
it on an interval. There is a single ingestion endpoint:

```
POST /reports
```

Each call reports **running daily totals** for one user in one environment
— not individual events, and not deltas since the last call. See
[Section 4](#4-reporting-model-running-totals-not-events) for what this
means in practice.

## 2. Authentication

Ingestion is protected by a single shared API key, sent as a header on every
request:

```
X-API-Key: <the shared key>
```

- The key is a static shared secret (not per-user, not per-environment).
  Treat it like a password — store it in a secrets manager or CI variable,
  not in source control.
- A missing or incorrect key returns `401 Unauthorized`.
- There is no rate limiting and no per-caller identity — anyone with the key
  can write any user's data. Scope who holds the key accordingly.

## 3. Endpoint

### `POST /reports`

Base URL depends on deployment (e.g. `https://<host>:8000` or through the
frontend's `/api` proxy). The path itself is always `/reports`.

**Headers**

| Header         | Value              | Required |
|----------------|--------------------|----------|
| `Content-Type` | `application/json`  | yes |
| `X-API-Key`    | shared ingestion key | yes |

**Body** — either a single report object, or a JSON array of report objects
(for batching multiple users/environments/days in one call).

#### Report object fields

| Field                  | Type   | Required | Notes |
|-------------------------|--------|----------|-------|
| `user_email`            | string (email) | yes | Validated as an email address. Identifies the reporting user. |
| `environment`            | string | yes | Free-text label for the environment the usage occurred in (e.g. `production`, `staging`, `client-acme`). |
| `report_date`            | string (`YYYY-MM-DD`) | yes | The calendar day these totals apply to. No time/timezone component — pick one convention (e.g. always UTC calendar day) and use it consistently. |
| `test_cases_created`     | integer | no (default `0`) | Running total **for that day**, not a delta. |
| `test_cases_executed`    | integer | no (default `0`) | Running total for that day. |
| `documents_generated`    | integer | no (default `0`) | Running total for that day. |

The tuple `(user_email, report_date, environment)` uniquely identifies a
row. Sending the same tuple again **overwrites** the previous numbers for
that row — it does not add to them.

#### Single report example

```bash
curl -X POST https://usage-tracker.example.com/reports \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $USAGE_TRACKER_API_KEY" \
  -d '{
        "user_email": "jane.doe@example.com",
        "environment": "production",
        "report_date": "2026-07-10",
        "test_cases_created": 12,
        "test_cases_executed": 47,
        "documents_generated": 3
      }'
```

#### Batch example

Use this to report multiple users, or multiple environments/days for the
same user, in one round trip:

```bash
curl -X POST https://usage-tracker.example.com/reports \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $USAGE_TRACKER_API_KEY" \
  -d '[
        {
          "user_email": "jane.doe@example.com",
          "environment": "production",
          "report_date": "2026-07-10",
          "test_cases_created": 12,
          "test_cases_executed": 47,
          "documents_generated": 3
        },
        {
          "user_email": "john.smith@example.com",
          "environment": "staging",
          "report_date": "2026-07-10",
          "test_cases_created": 5,
          "test_cases_executed": 5,
          "documents_generated": 0
        }
      ]'
```

If two items in the same batch share the same
`(user_email, report_date, environment)` tuple, the later item in the array
wins — it updates the row the earlier item just wrote, rather than
conflicting with it.

#### Response

`200 OK` with the stored row(s), including a server-assigned `reported_at`
timestamp:

```json
{
  "user_email": "jane.doe@example.com",
  "environment": "production",
  "report_date": "2026-07-10",
  "test_cases_created": 12,
  "test_cases_executed": 47,
  "documents_generated": 3,
  "reported_at": "2026-07-10T14:32:01.123456+00:00"
}
```

A batch request returns a JSON array of the same shape, in the same order
as the input.

## 4. Reporting model: running totals, not events

This is the most important integration detail. `report_date` +
`user_email` + `environment` is a single row that gets **replaced** on
every call, not appended to.

**Correct pattern:** your system accumulates counts internally throughout
the day (e.g. in memory or in its own database) and periodically POSTs the
*current cumulative total for that day so far*.

```
09:00  POST { report_date: 2026-07-10, test_cases_created: 3  }
11:00  POST { report_date: 2026-07-10, test_cases_created: 9  }   # not 6
17:00  POST { report_date: 2026-07-10, test_cases_created: 21 }   # final total for the day
```

**Incorrect pattern:** POSTing the count-since-last-report as if it were a
delta. Doing so will cause each report to silently overwrite the previous
total rather than add to it, undercounting the day.

```
09:00  POST { test_cases_created: 3 }   # stored total: 3
11:00  POST { test_cases_created: 6 }   # stored total: 6  (WRONG — should be 9)
```

`reported_at` on the stored row reflects the last time it was written, so
the dashboard can show how stale a given user's number is (e.g. "last
reported 3 hours ago") — you don't need to send it yourself; the server
sets it.

## 5. Suggested reporting cadence

- Pick an interval appropriate to how "live" you need the dashboard to be
  (e.g. every 5–15 minutes, or on a fixed schedule like hourly).
  Per-action POSTs are explicitly *not* the intended usage — batch your
  counters and report on an interval instead.
- Always send the full set of three metrics you track, even if some are
  zero for that interval — omitted fields default to `0`, which will
  **reset** that metric for the day if a prior report had a nonzero value.
  In other words, always send your true current-day total for every metric
  you track, not just the ones that changed.
- If your system runs in multiple environments (e.g. per-customer
  deployments, staging vs. production), send a distinct `environment`
  value per deployment. Each `(user, day, environment)` combination is
  tracked independently.
- `report_date` should be a stable calendar-day bucket. Decide once
  whether you bucket by UTC day or local day, and keep that convention
  consistent across all reporting instances — mixing conventions will
  split one logical day's usage across two rows.

## 6. Error handling

| Status | Meaning | Action |
|--------|---------|--------|
| `200`  | Report(s) stored/updated. | — |
| `401`  | Missing/invalid `X-API-Key`. | Check the key; do not retry with the same credentials. |
| `422`  | Payload failed validation (e.g. bad email format, missing required field, wrong date format). | Fix the payload; do not retry as-is. |
| `5xx`  | Server/database error. | Safe to retry with backoff — the upsert is idempotent for a given `(user_email, report_date, environment)`, so re-sending the same totals after a failure will not double-count. |

Because each report is an idempotent overwrite (not an additive event),
retries after a network failure or `5xx` are safe: simply resend the same
payload.

## 7. Reference: reading data back

`GET /reports` (also requires `X-API-Key`) returns all stored rows
unpaginated, if your system needs to verify what was recorded. The
dashboard's read endpoints (`/dashboard/summary`, `/dashboard/daily`,
`/dashboard/users`, etc.) use a separate Bearer-token auth scheme intended
for the UI, not for ingestion — integrators only need the `X-API-Key`
endpoints described above.
