# Usage Tracker — Integration Guide

This document describes how an external system (e.g. Test Ease) should report
usage data to the TestEase Usage Tracker. It covers authentication, the request
format, de-duplication semantics, error handling, and a recommended reporting
strategy.

## 1. Overview

The Usage Tracker is a passive ingestion service. It does **not** poll or
pull data from anywhere — your system must actively `POST` usage data to
it on an interval. There is a single ingestion endpoint:

```
POST /events
```

Each call reports **individual events** — one item per test case created, per
test case executed, per document generated — not daily totals and not deltas.
The tracker stores them raw and computes every total, ranking and breakdown at
query time. See [Section 4](#4-reporting-model-raw-events-not-totals) for what
this means in practice.

> **Historical note.** An earlier version of this service ingested
> pre-aggregated daily totals via `POST /reports`, upserted into a
> `usage_reports` table. That endpoint and table were removed (migration
> `0009`); `POST /events` is the only ingestion path. If you are maintaining an
> old integration that still posts to `/reports`, it now returns `404`.

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

### `POST /events`

Base URL depends on deployment (e.g. `https://<host>:8000` or through the
frontend's `/api` proxy). The path itself is always `/events`.

**Headers**

| Header         | Value              | Required |
|----------------|--------------------|----------|
| `Content-Type` | `application/json`  | yes |
| `X-API-Key`    | shared ingestion key | yes |

**Body** — one JSON object with up to four arrays, one per event type. Every
array is optional; omit it or send `[]` if you have nothing of that kind this
interval.

```json
{
  "test_cases_created": [],
  "test_cases_executed": [],
  "documents_generated": [],
  "test_case_documents_generated": []
}
```

#### Fields common to every event type

| Field            | Type   | Required | Notes |
|------------------|--------|----------|-------|
| `user_email`     | string (email) | yes | Validated as an email address. A non-RFC-compliant value rejects **that row only** (see §6). |
| `environment`    | string | yes | Free-text label for the environment the action happened in (e.g. `Heineken_Dev`). Normalized on write — see §5. |
| `interface_name` | string | yes | The integration flow / interface the action was performed against. |
| `created_at`     | string (naive datetime) | yes | When the action happened, as IST wall-clock with **no** timezone offset and no `Z` suffix — e.g. `2026-07-08T14:35:10.500`. See §4. |

#### Per-type extra fields

| Event array | Extra fields |
|-------------|--------------|
| `test_cases_created` | `test_case_name` (string, required) |
| `test_cases_executed` | `test_case_name` (string, required), `status` (string, required — the execution's terminal-or-not state, e.g. `PASSED`/`FAILED`/`RUNNING`) |
| `documents_generated` | none |
| `test_case_documents_generated` | `suite_name` (string, required), `test_case_count` (integer, required), `test_case_names` (array of strings, defaults to `[]`) |

#### De-duplication key

Each event type has a natural key, unique in the database:

| Event array | Natural key |
|-------------|-------------|
| `test_cases_created` | `user_email`, `environment`, `interface_name`, `test_case_name`, `created_at` |
| `test_cases_executed` | `user_email`, `environment`, `interface_name`, `test_case_name`, `created_at` |
| `documents_generated` | `user_email`, `environment`, `interface_name`, `created_at` |
| `test_case_documents_generated` | `user_email`, `environment`, `interface_name`, `suite_name`, `created_at` |

Re-sending a row that matches an existing key is **silently ignored**
(`ON CONFLICT DO NOTHING`) — not an error, and not a duplicate. This is a
backstop for resends, not the primary de-dup mechanism; see §5.

#### Example

```bash
curl -X POST https://usage-tracker.example.com/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $USAGE_TRACKER_API_KEY" \
  -d '{
        "test_cases_created": [
          {
            "user_email": "jane.doe@example.com",
            "environment": "Heineken_Dev",
            "interface_name": "OrderSync",
            "test_case_name": "TC_01",
            "created_at": "2026-07-08T14:30:00.000"
          }
        ],
        "test_cases_executed": [
          {
            "user_email": "jane.doe@example.com",
            "environment": "Heineken_Dev",
            "interface_name": "OrderSync",
            "test_case_name": "TC_01",
            "status": "PASSED",
            "created_at": "2026-07-08T14:35:10.500"
          }
        ],
        "documents_generated": [],
        "test_case_documents_generated": []
      }'
```

#### Response

`200 OK` with the number of rows accepted per event type, plus a `rejected`
array naming any rows that failed validation:

```json
{
  "test_cases_created": 1,
  "test_cases_executed": 1,
  "documents_generated": 0,
  "test_case_documents_generated": 0,
  "rejected": []
}
```

A rejected row looks like this, identified by its array and its index within
that array:

```json
{
  "rejected": [
    { "event_type": "test_cases_created", "index": 3,
      "reason": "user_email: value is not a valid email address" }
  ]
}
```

The accepted counts are rows that **passed validation**, which includes rows
skipped by `ON CONFLICT DO NOTHING`. Don't read them as "rows newly inserted".

## 4. Reporting model: raw events, not totals

This is the most important integration detail. Send one item per action that
occurred; the tracker never adds to or overwrites a previous value, it just
appends.

**Correct pattern:** your system tracks a checkpoint (the timestamp it last
reported through), queries its own database for actions since that checkpoint,
sends them as individual events, and advances the checkpoint only after a
successful send.

```
09:00  POST { test_cases_created: [ …3 events… ] }   # checkpoint → 09:00
11:00  POST { test_cases_created: [ …6 events… ] }   # the 6 since 09:00, not 9
17:00  POST { test_cases_created: [ …12 events… ] }  # the 12 since 11:00
```

**Incorrect pattern:** sending running totals, or re-sending the whole day
every interval. Totals have nowhere to go — there is no count field. Re-sending
the whole day is not *harmful* (the natural key dedupes it) but it is wasted
work and relies on a backstop rather than your checkpoint.

**Timestamps are naive IST.** Convert to IST (UTC+5:30, no DST) once before
sending, and send with no offset and no `Z`. The tracker stores exactly what
you send and never converts, so a value with an offset is either rejected or
silently mis-bucketed by up to a day. `reported_at` is set server-side to IST
wall-clock on insert — don't send it.

## 5. Suggested reporting cadence

- Pick an interval appropriate to how "live" you need the dashboard to be
  (e.g. every 5–15 minutes, or hourly). Per-action POSTs are not intended —
  batch the events accumulated since your checkpoint and send them together.
- **Your checkpoint is the correctness mechanism**, not the tracker's unique
  constraints. Advance it only on a successful send, so a failed request means
  the next one re-covers the same window.
- **`environment` is normalized on write.** Each underscore-separated segment
  is title-cased and whitespace is stripped, so `HEINEKEN_DEV`,
  `heineken_dev` and `Heineken_Dev  ` all land on `Heineken_Dev`. This exists
  because case and whitespace variants of one environment were showing up as
  separate environments across every dashboard aggregate. Send a consistent
  value anyway — normalization is a safety net, not a naming policy.
- If your system runs in multiple environments (per-customer deployments,
  staging vs. production), send a distinct `environment` per deployment. Each
  one is tracked independently.
- A long-running action that hasn't reached a terminal state yet will be
  reported with whatever `status` it has at send time and **never corrected** —
  ingestion is insert-only, with no update path. Either wait for a terminal
  state before reporting, or accept the non-terminal value.

## 6. Error handling

| Status | Meaning | Action |
|--------|---------|--------|
| `200`  | Request processed. Check the `rejected` array — a `200` does **not** mean every row was stored. | Log/alert on non-empty `rejected`; those rows will not be retried for you. |
| `401`  | Missing/invalid `X-API-Key`. | Check the key; do not retry with the same credentials. |
| `422`  | The request body itself was unparseable (not a JSON object). | Fix the payload; do not retry as-is. |
| `5xx`  | Server/database error. | Safe to retry with backoff — see below. |

**Per-row validation is deliberate.** A malformed row (e.g. an invalid email)
is dropped and reported in `rejected`; every other row in the batch still
inserts. The whole batch is never failed over one bad row, because upstream
checkpoints only advance on a successful send — an all-or-nothing `422` would
turn one bad row into a permanent block on every retry.

**Retries are safe.** Insertion is guarded by each event type's natural key
with `ON CONFLICT DO NOTHING`, so resending a window you already sent — after
a network failure, a `5xx`, or a lost checkpoint file — cannot double-count.

## 7. Reference: reading data back

There is no `X-API-Key` read endpoint. The dashboard's read endpoints
(`/dashboard/summary`, `/dashboard/daily`, `/dashboard/users`,
`/dashboard/artifacts`, the `/export` twins, etc.) use a separate Bearer-token
scheme intended for the UI: `POST /dashboard/login` with the dashboard
username/password returns a 12-hour signed token. Integrators only need the
`X-API-Key` ingestion endpoint described above.
