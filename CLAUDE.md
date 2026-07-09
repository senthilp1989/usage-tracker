# Usage Tracker

Standalone usage-analytics service for Test Ease. Test Ease POSTs each user's running daily totals (test cases created/executed, documents generated) to the API on a fixed interval, not per-action; each report upserts a row in Postgres, visualized by a custom React dashboard (which replaced the original Grafana setup).

## Tech stack

- **Backend**: Python 3.11, FastAPI + Uvicorn, SQLAlchemy 2, Pydantic v2. Two auth schemes: shared `X-API-Key` header for ingestion (`app/auth.py:verify_api_key`), and HMAC-signed 12h session tokens for dashboard endpoints (login with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` from env; signing key is derived from `api_key + dashboard_password`, so rotating either invalidates sessions).
- **Database**: PostgreSQL 15. Single table `usage_reports` (one row per user per day, upserted: stack_id, user_email, report_date, test_cases_created, test_cases_executed, documents_generated, reported_at). All stats are aggregated at query time. Schema via `Base.metadata.create_all()` at startup — **no Alembic/migrations**.
- **Frontend**: React 18 + TypeScript + Vite in `frontend/`, no chart library — hand-rolled SVG line chart following the dataviz skill specs (validated palette, crosshair tooltip, chart/table toggle, light+dark via `prefers-color-scheme`). Served by nginx, which proxies `/api/*` → `api:8000` (prefix stripped). Vite dev server proxies the same way.
- **Infra**: Docker Compose — `database` (internal), `api` (`${API_PUBLISH_PORT:-8000}`), `frontend` (`${FRONTEND_PUBLISH_PORT:-3005}`).

## Layout

```
app/                    FastAPI application package
  main.py               Entrypoint: CORS (allow-all), /health, create_all
  config.py             Settings: DATABASE_URL, API_KEY, DASHBOARD_USERNAME/PASSWORD
  database.py           Engine, SessionLocal, get_db
  models.py             UsageReport (only table)
  schemas.py            Pydantic models
  auth.py               API-key check + dashboard token create/verify (HMAC, stdlib only)
  routers/reports.py    POST /reports (upsert) + GET /reports — ingestion (X-API-Key)
  routers/dashboard.py  /dashboard/login + summary|daily|users|user-emails (Bearer token)
frontend/               React dashboard (Vite); src/components has StatTile, Filters,
                        DailyTrend (SVG chart + table toggle), UsersTable
  nginx.conf            SPA fallback + /api proxy
docker-compose.yml      database + api + frontend
.env.example            DB_PASSWORD, API_KEY, ports, dashboard credentials
```

## Running / verifying

`docker compose up --build` with `.env` (API_KEY and DASHBOARD_PASSWORD required). Dashboard at :3005, API docs at :8000/docs. Frontend checks: `cd frontend && npm run build` (tsc + vite). Backend has no tests; verified manually via curl (`POST /reports` with X-API-Key, `/dashboard/login` → Bearer token → `/dashboard/summary?from=...&to=...`).

## Conventions & gotchas

- The three tracked metrics (`test_cases_created`, `test_cases_executed`, `documents_generated`) are columns on `UsageReport`, mirrored in `frontend/src/types.ts` (`METRICS`). Adding a metric means touching `models.py`, `schemas.py`, `dashboard.py` (`_totals()`), and the frontend types.
- Chart colors are the dataviz reference palette (CSS custom properties in `frontend/src/styles.css`); light-mode aqua/yellow are sub-3:1 contrast by design — the chart's table view is the required relief, don't remove it.
- **No migrations**: model changes won't alter an existing Postgres volume; `create_all` only creates missing tables.
- Dashboard queries hit the API (unlike the old Grafana, which queried Postgres directly). Reports are keyed on `report_date` (a plain `Date`, not a timestamp) — day bucketing is exact, no timezone conversion needed.
- A formatter hook runs on file writes in this repo (Prettier-style).
- No rate limiting, single shared ingestion key, CORS wide open — internal-tool posture.

## History

- The service originally ingested one event per user action via `POST /events` into an append-only `usage_events` table, with `/reports` as a legacy daily-totals upsert API. This was inverted: `/events` and `usage_events` were removed, and `/reports` (now the only ingestion path) is what the dashboard reads from — Test Ease reports running daily totals on a fixed interval rather than firing a call per action.
