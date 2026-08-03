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
| --------- | ---------------------- | --------------------------------- |
| Dashboard | usage-tracker-frontend | `${FRONTEND_PUBLISH_PORT:-3005}` |
| API       | usage-tracker-api      | `${API_PUBLISH_PORT:-8000}`      |
| Postgres  | usage-tracker-db       | internal only                    |

- Dashboard: http://localhost:3005 (sign in with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`)
- API docs (OpenAPI): http://localhost:8000/docs

## Configuration

All configuration is via `.env` (see `.env.example`):

| Variable                | Default    | Purpose                            |
| ----------------------- | ---------- | ----------------------------------- |
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

Sign in at the frontend port. The dashboard shows, scoped by a date-range preset (today / 7 / 30 / 90 days / custom) and optional user and environment filters:

- KPI tiles: users reporting, and totals for each metric (test cases created/executed, documents generated)
- Daily activity chart (with a table view toggle and hover tooltips)
- Usage-by-user table: one row per (user, environment, report date) with that day's metrics and last-activity timestamp — not a rolled-up total
- Usage-by-interface table: independently filterable by interface, showing test cases created/executed per interface

All filtering — date range, user, environment, interface — happens server-side via SQL, driven by query params; nothing is filtered client-side except the pre-existing environment search box and table pagination, which only ever operate on data already scoped by the backend.

The dashboard talks to token-protected endpoints under `/dashboard/*` (`login`, `summary`, `daily`, `users`, `artifacts`, `user-emails`, `environments`, `interfaces`). Sessions last 12 hours.

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
  src/components/       Stat tiles, filters, SVG trend chart, users table, interface breakdown table
  nginx.conf            Serves the SPA, proxies /api/* to the backend
docker-compose.yml      database + api + frontend
Dockerfile              API image (python:3.11-slim + uvicorn), runs `alembic upgrade head` before serving
```
