# Usage Tracker

Standalone usage-analytics service for Test Ease. Test Ease POSTs one event per tracked user action (test case created/executed, document generated) to the API; events are stored append-only in Postgres and visualized by a custom React dashboard (which replaced the original Grafana setup).

## Tech stack

- **Backend**: Python 3.11, FastAPI + Uvicorn, SQLAlchemy 2, Pydantic v2. Two auth schemes: shared `X-API-Key` header for ingestion (`app/auth.py:verify_api_key`), and HMAC-signed 12h session tokens for dashboard endpoints (login with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` from env; signing key is derived from `api_key + dashboard_password`, so rotating either invalidates sessions).
- **Database**: PostgreSQL 15. Main table `usage_events` (append-only: stack_id, user_email, event_type, occurred_at, created_at); all stats are aggregated at query time. Legacy `usage_reports` table (one row per user/day, upserted) still exists for the deprecated `/reports` API. Schema via `Base.metadata.create_all()` at startup — **no Alembic/migrations**.
- **Frontend**: React 18 + TypeScript + Vite in `frontend/`, no chart library — hand-rolled SVG line chart following the dataviz skill specs (validated palette, crosshair tooltip, chart/table toggle, light+dark via `prefers-color-scheme`). Served by nginx, which proxies `/api/*` → `api:8000` (prefix stripped). Vite dev server proxies the same way.
- **Infra**: Docker Compose — `database` (internal), `api` (`${API_PUBLISH_PORT:-8000}`), `frontend` (`${FRONTEND_PUBLISH_PORT:-3005}`).

## Layout

```
app/                    FastAPI application package
  main.py               Entrypoint: CORS (allow-all), /health, create_all
  config.py             Settings: DATABASE_URL, API_KEY, DASHBOARD_USERNAME/PASSWORD
  database.py           Engine, SessionLocal, get_db
  models.py             UsageEvent (primary) + UsageReport (legacy)
  schemas.py            Pydantic models; EventType literal lives here
  auth.py               API-key check + dashboard token create/verify (HMAC, stdlib only)
  routers/events.py     POST /events — ingestion (X-API-Key)
  routers/dashboard.py  /dashboard/login + summary|daily|users|user-emails (Bearer token)
  routers/reports.py    Legacy GET/POST /reports (deprecated, kept for old deployments)
frontend/               React dashboard (Vite); src/components has StatTile, Filters,
                        DailyTrend (SVG chart + table toggle), UsersTable
  nginx.conf            SPA fallback + /api proxy
docker-compose.yml      database + api + frontend
.env.example            DB_PASSWORD, API_KEY, ports, dashboard credentials
```

## Running / verifying

`docker compose up --build` with `.env` (API_KEY and DASHBOARD_PASSWORD required). Dashboard at :3005, API docs at :8000/docs. Frontend checks: `cd frontend && npm run build` (tsc + vite). Backend has no tests; verified manually via curl (`POST /events` with X-API-Key, `/dashboard/login` → Bearer token → `/dashboard/summary?from=...&to=...`).

## Conventions & gotchas

- Event types are a closed set (`test_case_created`, `test_case_executed`, `document_generated`) defined in `app/schemas.py` (`EventType`) and mirrored in `frontend/src/types.ts` (`METRICS`). Adding a type means touching both, plus `dashboard.py:EVENT_TYPES`.
- Chart colors are the dataviz reference palette (CSS custom properties in `frontend/src/styles.css`); light-mode aqua/yellow are sub-3:1 contrast by design — the chart's table view is the required relief, don't remove it.
- **No migrations**: model changes won't alter an existing Postgres volume; `create_all` only creates missing tables.
- Dashboard queries hit the API (unlike the old Grafana, which queried Postgres directly). `occurred_at` is client-suppliable; day bucketing uses `func.date()` (server timezone, effectively UTC).
- A formatter hook runs on file writes in this repo (Prettier-style).
- No rate limiting, single shared ingestion key, CORS wide open — internal-tool posture.

## Open questions

- The legacy `/reports` API + `usage_reports` table: remove once all Test Ease deployments send events.
- Per-event ingestion is one HTTP call per action; if volume grows, consider a batch endpoint (`POST /events/batch`) and/or a daily rollup table.
- Old usage_reports data is not backfilled into usage_events — historical numbers before the cutover only exist in the legacy table.
