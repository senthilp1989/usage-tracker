# TestEase Usage Tracker

A standalone service for tracking per-user product usage in Test Ease. Test Ease reports raw, per-event usage rows (test case created, test case executed, document generated — no grouping) on a fixed interval; the backend inserts them into PostgreSQL, and a custom React dashboard aggregates and visualizes them at query time.

## Architecture

```
Test Ease ──POST /events──▶ FastAPI api ──▶ PostgreSQL (test_case_created_events,
            (X-API-Key)          ▲                        test_case_executed_events,
                                 │ /api/* (Bearer token)   document_generated_events)
                    React dashboard (nginx)
```

- **Backend** — FastAPI + SQLAlchemy. Ingestion is authenticated with a shared `X-API-Key`; dashboard endpoints use a signed session token obtained via username/password login.
- **Database** — PostgreSQL 15. Three raw event tables — one row per test case creation (+ `test_case_name`), per test case execution (+ `test_case_name`, `status`), and per generated document — each with `user_email`, `environment`, `interface_name`, `created_at`, and a unique constraint on those (plus `test_case_name` where present) as a de-dupe backstop against resends. No aggregation happens on ingestion; the dashboard computes totals, pass/fail counts, and interface breakdowns at query time by grouping these tables. There is deliberately no `package_name` — it's never populated by the source system (only exists via a live SAP API call the source tool doesn't make), so it was dropped rather than kept as an always-"unknown" field. `created_at`/`reported_at` are stored as naive IST (UTC+5:30) timestamps — Test Ease shifts to IST once before sending, so no timezone conversion happens anywhere in this service. There's also a frozen `usage_reports` table from an earlier pre-aggregated design; it's no longer written to or read from, kept only as a historical archive.
- **Frontend** — React + TypeScript (Vite), hand-rolled SVG charts, served by nginx which also proxies `/api/*` to the backend. Light and dark mode follow the OS preference.

## Quick start

Requirements: Docker + Docker Compose.

```bash
cp .env.example .env   # set API_KEY and DASHBOARD_PASSWORD
docker compose up --build
```

| Service   | Container              | Port (host)                      |
| --------- | ---------------------- | -------------------------------- |
| Dashboard | usage-tracker-frontend | `${FRONTEND_PUBLISH_PORT:-3005}` |
| API       | usage-tracker-api      | `${API_PUBLISH_PORT:-8000}`      |
| Postgres  | usage-tracker-db       | internal only                    |

- Dashboard: http://localhost:3005 (sign in with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`)
- API docs (OpenAPI): http://localhost:8000/docs

## Configuration

All configuration is via `.env` (see `.env.example`):

| Variable                | Default    | Purpose                            |
| ----------------------- | ---------- | ---------------------------------- |
| `API_KEY`               | _required_ | Key Test Ease sends as `X-API-Key` |
| `DASHBOARD_PASSWORD`    | _required_ | Dashboard login password           |
| `DASHBOARD_USERNAME`    | `admin`    | Dashboard login username           |
| `DB_PASSWORD`           | `changeme` | Postgres password                  |
| `API_PUBLISH_PORT`      | `8000`     | Host port for the API              |
| `FRONTEND_PUBLISH_PORT` | `3005`     | Host port for the dashboard        |

## Ingestion API (called by Test Ease)

Test Ease reports raw, individual event rows on a fixed interval — not aggregated totals, and not per-action in real time (each cycle batches whatever's new since its last checkpoint). Requires the `X-API-Key` header. The body is a single object with three independent lists, any of which may be empty:

```bash
curl -X POST http://localhost:8000/events \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "test_cases_created": [
      { "user_email": "jane@example.com", "environment": "prod", "interface_name": "OrderSync", "test_case_name": "TC_01", "created_at": "2026-07-08T14:32:05.120" }
    ],
    "test_cases_executed": [
      { "user_email": "jane@example.com", "environment": "prod", "interface_name": "OrderSync", "test_case_name": "TC_01", "status": "PASSED", "created_at": "2026-07-08T14:35:10.500" }
    ],
    "documents_generated": []
  }'
```

- Every row is a plain **insert**, not an upsert — these are immutable, append-only events. A row matching an existing natural key (`user_email, environment, interface_name`, plus `test_case_name` where applicable, plus `created_at`) is silently skipped (`ON CONFLICT DO NOTHING`), which only matters if Test Ease ever resends a window it already sent (e.g. after losing its own checkpoint state).
- A malformed row (e.g. an invalid email) is rejected individually, not the whole batch — the response's `rejected` array lists which rows and why; everything else still gets inserted.
- `created_at` must be a naive datetime string (no timezone offset/`Z` suffix) already shifted to IST — see `app/models.py` for why.
- `GET /reports` still exists and lists the old frozen `usage_reports` archive (requires `X-API-Key`) — nothing writes to it anymore.

## Dashboard

Sign in at the frontend port. The page is built **aggregate first, detail on demand** — rankings, concentration and deltas above the fold; the raw tables demoted to a tabbed drawer at the bottom where you go to prove a number.

A single sticky filter bar sits above everything it scopes — period (default **Last 90 days**, not today), users, environments — and every panel below re-renders against that same slice, so the numbers always agree. Selections show as removable chips; each dropdown row carries that option's action count for the period; **Reset** appears only when something is off-default; **Export** downloads the current slice as CSV.

Top to bottom:

| Section                        | Contents                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Adoption at a glance**       | Hero card (total actions + delta + active users / environments / interfaces / days with activity) and 4 KPI tiles, each with a delta against the immediately preceding equal-length window and a 13-week sparkline |
| **Activity over time**         | Volume by period — stacked columns with `Daily`/`Weekly` and `Chart`/`Table` toggles, a legend that toggles series, per-column totals, and a labelled block over any long leading run of empty buckets             |
| **Who is using it, and where** | Ranked stacked bars by user and by environment, each with active-day and reach sub-lines                                                                                                                           |
| **Coverage & concentration**   | User × environment heatmap (every cell carries its number) and the top interface · environment pairs as ranked bars                                                                                                |
| **Detail records**             | Tabbed drawer: usage by user, user totals, usage by interface, and the four raw event tables — each with free-text filter, click-to-sort headers, pagination, and CSV export of the filtered-and-sorted set        |

Date, user and environment scoping all happen server-side via SQL query params. Within that already-scoped slice, the page reshapes client-side: leaderboards, the heatmap and the drawer's first two tabs all derive from the one flat `(user, environment, day)` fact table returned by `/dashboard/users/export`, which is what guarantees every panel agrees with every other. The drawer's raw-event tabs fetch their rows only when first opened.

Accessibility: series identity is never colour-alone (legend + direct labels + a first-class table view of the chart, the required relief for slot 1's sub-3:1 contrast on white), heatmap cells carry their numbers, chart hit areas are focusable and announce their value, Escape closes any popover, and light/dark are separately selected palettes rather than one inverted into the other.

The dashboard talks to token-protected endpoints under `/dashboard/*` (`login`, `summary`, `daily`, `users`, `artifacts`, `user-environment-rollup`, the `*-events` detail endpoints, each of those `/export` twins, and `user-emails` / `environments` / `interfaces`). Sessions last 12 hours.

## Local development

Backend (needs a Postgres — `docker compose up -d database` and publish port 5432, or point `DATABASE_URL` elsewhere):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=postgresql+psycopg2://usage_tracker:changeme@localhost:5432/usage_tracker \
API_KEY=dev-key DASHBOARD_PASSWORD=dev \
uvicorn app.main:app --reload
```

Frontend (dev server proxies `/api` to `localhost:8000`):

```bash
cd frontend
npm install
npm run dev
```

Schema is managed by Alembic — the API container runs `alembic upgrade head` on startup (see Dockerfile). Locally, run migrations the same way:

```bash
DATABASE_URL=postgresql+psycopg2://usage_tracker:changeme@localhost:5432/usage_tracker alembic upgrade head
```

To add a schema change: edit `app/models.py`, then write a migration under `alembic/versions/` (autogenerate works too: `alembic revision --autogenerate -m "..."`, but always review the generated diff).

## Synthetic data

`scripts/seed_synthetic_events.py` fills an empty database with a realistic-looking history so the dashboard has something to show. It POSTs to `/events` like Test Ease would (no direct DB writes), so rows go through the same validation, environment canonicalization and `ON CONFLICT` backstop:

```bash
API_KEY=<your key> python3 scripts/seed_synthetic_events.py --days 90
```

It generates a fixed cast of 7 users across 4 environments and 8 interfaces, with weekday/weekend volume differences, working-hours IST timestamps, an adoption ramp over the window, re-runs of the same test case, and a mostly-terminal status mix (plus a few `RUNNING`/`QUEUED` rows, matching the stale-status case the pipeline never corrects). Useful flags:

| Flag                    | Default                        | Purpose                                                               |
| ----------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `--days` / `--end-date` | `90` / today                   | Size and end of the generated window                                  |
| `--scale`               | `1.0`                          | Multiplier on per-user daily volume                                   |
| `--seed`                | `20260817`                     | RNG seed — same seed produces the same rows, so re-running is a no-op |
| `--url`                 | `http://localhost:8000/events` | Ingestion endpoint                                                    |
| `--out` / `--dry-run`   | —                              | Dump the generated payload as JSON / skip posting                     |

To start over, truncate the four event tables first:

```bash
docker compose exec database psql -U usage_tracker -d usage_tracker -c \
  "TRUNCATE test_case_created_events, test_case_executed_events, document_generated_events, test_case_document_generated_events;"
```

## Project structure

```
app/                    FastAPI application
  main.py               App entrypoint, CORS, /health
  config.py             Env-based settings
  database.py           SQLAlchemy engine/session
  models.py             TestCaseCreatedEvent / TestCaseExecutedEvent / DocumentGeneratedEvent
                         (raw, one row per event) + frozen UsageReport archive
  schemas.py            Request/response models
  auth.py               X-API-Key check + dashboard session tokens (HMAC)
  routers/
    events.py           POST /events (insert, ON CONFLICT DO NOTHING) — ingestion
    reports.py          Frozen: GET /reports (archive read) + POST /reports (unused, kept for the old route)
    dashboard.py         Login + aggregated stats, computed at query time from the raw event tables
alembic/                Schema migrations (env.py, versions/)
alembic.ini             Alembic config (DB URL resolved from app settings at runtime)
frontend/               React + TypeScript dashboard (Vite)
  src/components/       Header, sticky filter bar + popovers, hero/KPI tiles, stacked-column
                         activity chart, ranked bars, heatmap, tabbed detail drawer, shared tooltip
  nginx.conf            Serves the SPA, proxies /api/* to the backend
docker-compose.yml      database + api + frontend
Dockerfile              API image (python:3.11-slim + uvicorn), runs `alembic upgrade head` before serving
```
