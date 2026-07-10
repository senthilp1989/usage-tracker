# Usage Tracker

A standalone service for tracking per-user product usage in Test Ease. Test Ease periodically reports each user's running daily totals (test cases created, test cases executed, documents generated); the backend upserts each report into PostgreSQL, and a custom React dashboard visualizes the captured data.

## Architecture

```
Test Ease ──POST /reports──▶ FastAPI api ──▶ PostgreSQL (usage_reports)
            (X-API-Key)          ▲
                                 │ /api/* (Bearer token)
                    React dashboard (nginx)
```

- **Backend** — FastAPI + SQLAlchemy. Ingestion is authenticated with a shared `X-API-Key`; dashboard endpoints use a signed session token obtained via username/password login.
- **Database** — PostgreSQL 15. `usage_reports` holds one row per user per environment per day (`stack_id`, `user_email`, `environment_id`, `report_date`, `test_cases_created`, `test_cases_executed`, `documents_generated`), unique on (`user_email`, `report_date`, `environment_id`); each incoming report overwrites that row with the latest totals. KPI tiles and the daily chart are aggregated at query time; the per-user table shows individual report rows.
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

Test Ease reports each user's running daily totals on a fixed interval (not per-action). Requires the `X-API-Key` header. The body can be a single report object or a JSON array of them (batch).

```bash
curl -X POST http://localhost:8000/reports \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stack_id": "stack-eu-1",
    "user_email": "jane@example.com",
    "environment_id": "prod",
    "report_date": "2026-07-08",
    "test_cases_created": 3,
    "test_cases_executed": 5,
    "documents_generated": 1
  }'
```

```bash
# Batch: an array upserts each item; response shape (object vs array) mirrors the request
curl -X POST http://localhost:8000/reports \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    { "stack_id": "stack-eu-1", "user_email": "jane@example.com", "environment_id": "prod", "report_date": "2026-07-08", "test_cases_created": 3, "test_cases_executed": 5, "documents_generated": 1 },
    { "stack_id": "stack-eu-1", "user_email": "jane@example.com", "environment_id": "staging", "report_date": "2026-07-08", "test_cases_created": 1, "test_cases_executed": 1, "documents_generated": 0 }
  ]'
```

- Each report is an **upsert** keyed on `user_email` + `report_date` + `environment_id` — send the day's running total so far for that environment, not a delta; the new values replace the previous row for that (user, day, environment).
- `GET /reports` lists all rows (requires `X-API-Key`).

## Dashboard

Sign in at the frontend port. The dashboard shows, scoped by a date-range preset (today / 7 / 30 / 90 days / custom) and optional user and environment filters:

- KPI tiles: users reporting, and totals for each metric (test cases created/executed, documents generated)
- Daily activity chart (with a table view toggle and hover tooltips)
- Usage-by-user table: one row per (user, environment, report date) with that report's metrics and last-activity timestamp — not a rolled-up total

The dashboard talks to token-protected endpoints under `/dashboard/*` (`login`, `summary`, `daily`, `users`, `user-emails`, `environment-ids`). Sessions last 12 hours.

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

Tables are created automatically at startup; there is no migration tool yet, so schema changes require recreating the database (or adding Alembic).

## Project structure

```
app/                    FastAPI application
  main.py               App entrypoint, CORS, /health
  config.py             Env-based settings
  database.py           SQLAlchemy engine/session
  models.py             UsageReport (one row per user per environment per day, upserted)
  schemas.py            Request/response models
  auth.py               X-API-Key check + dashboard session tokens (HMAC)
  routers/
    reports.py          POST /reports (upsert) + GET /reports — ingestion
    dashboard.py        Login + aggregated stats for the frontend
frontend/               React + TypeScript dashboard (Vite)
  src/components/       Stat tiles, filters, SVG trend chart, users table
  nginx.conf            Serves the SPA, proxies /api/* to the backend
docker-compose.yml      database + api + frontend
Dockerfile              API image (python:3.11-slim + uvicorn)
```
