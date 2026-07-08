# Usage Tracker

A standalone service for tracking per-user product usage in Test Ease. Test Ease calls the API whenever a user performs a tracked action (creates a test case, executes a test case, generates a document); the backend validates and persists each event to PostgreSQL, and a custom React dashboard visualizes the captured data.

## Architecture

```
Test Ease ──POST /events──▶ FastAPI api ──▶ PostgreSQL (usage_events)
            (X-API-Key)          ▲
                                 │ /api/* (Bearer token)
                    React dashboard (nginx)
```

- **Backend** — FastAPI + SQLAlchemy. Ingestion is authenticated with a shared `X-API-Key`; dashboard endpoints use a signed session token obtained via username/password login.
- **Database** — PostgreSQL 15. `usage_events` is append-only: one row per tracked action (`stack_id`, `user_email`, `event_type`, `occurred_at`). All dashboard numbers are aggregated at query time.
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

Send one request per tracked action. Requires the `X-API-Key` header.

```bash
curl -X POST http://localhost:8000/events \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stack_id": "stack-eu-1",
    "user_email": "jane@example.com",
    "event_type": "test_case_created"
  }'
```

- `event_type` is one of `test_case_created`, `test_case_executed`, `document_generated`.
- `occurred_at` (ISO 8601 timestamp) is optional and defaults to the time the event is received — include it if events are queued/batched client-side.
- Events are immutable; there is no update or delete.

The legacy `GET/POST /reports` daily-totals endpoints still exist for older Test Ease deployments but are deprecated; new integrations should use `/events`.

## Dashboard

Sign in at the frontend port. The dashboard shows, scoped by a date-range preset (today / 7 / 30 / 90 days / custom) and an optional user filter:

- KPI tiles: users reporting, and totals for each event type
- Daily activity chart (with a table view toggle and hover tooltips)
- Per-user totals table with last-activity timestamps

The dashboard talks to token-protected endpoints under `/dashboard/*` (`login`, `summary`, `daily`, `users`, `user-emails`). Sessions last 12 hours.

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
  models.py             UsageEvent (append-only) + legacy UsageReport
  schemas.py            Request/response models
  auth.py               X-API-Key check + dashboard session tokens (HMAC)
  routers/
    events.py           POST /events — ingestion
    dashboard.py        Login + aggregated stats for the frontend
    reports.py          Legacy daily-totals upsert API (deprecated)
frontend/               React + TypeScript dashboard (Vite)
  src/components/       Stat tiles, filters, SVG trend chart, users table
  nginx.conf            Serves the SPA, proxies /api/* to the backend
docker-compose.yml      database + api + frontend
Dockerfile              API image (python:3.11-slim + uvicorn)
```
