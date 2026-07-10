# iVolve Usage Tracker

Standalone usage-analytics service for Test Ease. Test Ease POSTs each user's **running daily totals** (test cases created/executed, documents generated) to `POST /reports` on a fixed interval — not per-action. `POST /reports` accepts either a single report object or a JSON array of them. Each report upserts one Postgres row per user per environment per day; a custom React dashboard (which replaced an earlier Grafana setup) reads aggregated and per-report stats through the API.

## Tech stack

- **Backend** (`app/`): Python 3.11, FastAPI + Uvicorn, SQLAlchemy 2, Pydantic v2 (+ pydantic-settings, email-validator). Two auth schemes in `app/auth.py`: shared `X-API-Key` header for ingestion, and HMAC-signed 12h Bearer session tokens for dashboard endpoints (login with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`; signing key is SHA-256 of `api_key:dashboard_password`, so rotating either invalidates all sessions). Stdlib crypto only — no JWT library.
- **Database**: PostgreSQL 15. Single table `usage_reports` (`models.py`): user_email, environment, report_date (plain `Date` — exact day bucketing, no TZ math), the three metric columns, reported_at; unique on (user_email, report_date, environment) — a user can report from multiple environments on the same day, each gets its own row. KPI/daily aggregates are summed at query time; the users table returns per-report rows (see gotchas). Schema is managed by **Alembic** (`alembic/`); the API container runs `alembic upgrade head` on startup (Dockerfile) — `main.py` no longer calls `create_all()`.
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite, react/react-dom are the only runtime deps — the daily chart is a hand-rolled SVG (`DailyTrend.tsx`, per dataviz skill specs: validated palette, crosshair tooltip, chart/table toggle). Light/dark theme defaults to OS preference but is user-toggleable (`theme.ts` sets `data-theme` + persists to localStorage). Served by nginx, which proxies `/api/*` → `api:8000` with the prefix stripped; Vite dev server proxies the same way.
- **Infra**: Docker Compose — `database` (internal-only), `api` (`${API_PUBLISH_PORT:-8000}`), `frontend` (`${FRONTEND_PUBLISH_PORT:-3005}`). All config via `.env` (see `.env.example`); compose fails fast if `API_KEY` or `DASHBOARD_PASSWORD` is unset.

## Layout

```
app/                    FastAPI package
  main.py               Entrypoint: CORS (allow-all), /health
  config.py             Settings: DATABASE_URL, API_KEY, DASHBOARD_USERNAME/PASSWORD
  database.py           Engine, SessionLocal, get_db
  models.py             UsageReport (the only table)
  schemas.py            Pydantic request/response models
  auth.py               API-key check + dashboard token create/verify
  routers/reports.py    POST /reports (upsert, single or array) + GET /reports — ingestion (X-API-Key)
  routers/dashboard.py  /dashboard/login + summary|daily|users|user-emails|environments (Bearer)
alembic/                Migrations: env.py (pulls DATABASE_URL from app.config), versions/
alembic.ini             Alembic config (no hardcoded sqlalchemy.url)
frontend/               React dashboard; src/components: StatTile, Filters,
                        DailyTrend (SVG chart + table toggle), UsersTable, ThemeToggle
  nginx.conf            SPA fallback + /api proxy
Dockerfile              API image (python:3.11-slim); CMD runs `alembic upgrade head` then uvicorn
docker-compose.yml      database + api + frontend
README.md               Full architecture, curl examples, env-var table, dev setup
```

## Running / verifying

`docker compose up --build` with `.env`. Dashboard at :3005, OpenAPI docs at :8000/docs. Local dev: uvicorn + `docker compose up -d database` (see README), `cd frontend && npm run dev`. Frontend check: `npm run build` (tsc + vite). **No automated tests anywhere, no CI** — verify manually via curl (`POST /reports` with X-API-Key; `/dashboard/login` → Bearer → `/dashboard/summary?from=...&to=...`).

## Conventions & gotchas

- The three metrics are columns, not rows: adding a metric touches `models.py`, `schemas.py`, `dashboard.py` (`_totals()`), and `frontend/src/types.ts` (`METRICS`).
- Chart colors are the dataviz reference palette (CSS custom properties in `frontend/src/styles.css`); light-mode aqua/yellow are sub-3:1 contrast by design — the chart's table view is the required relief, don't remove it.
- Reports are running totals, not deltas — the upsert **replaces** the row for that (user, day, environment).
- `/dashboard/users` returns one row per (user_email, environment, report_date), not a summed total per user — it's a filtered listing of individual reports, not a rollup like `/dashboard/summary` and `/dashboard/daily` are. Filterable by `environment` (and `user_email` for summary/daily) via query params; `/dashboard/environments` lists distinct values for the frontend dropdown, same pattern as `/dashboard/user-emails`.
- `POST /reports` batch (array) upserts loop with `db.flush()` (not `autoflush`, which is off — see `database.py`) after each item, so two items in the same batch sharing a (user_email, report_date, environment) key update in place instead of colliding with the unique constraint.
- A Prettier-style formatter hook runs on file writes in this repo.
- Internal-tool security posture: CORS wide open, single shared ingestion key, no rate limiting, no per-user dashboard identity (token payload is just an expiry timestamp).
- Schema changes go through Alembic now: edit `models.py`, then add a revision under `alembic/versions/` (hand-written or `alembic revision --autogenerate`, review either way). A database that predates Alembic (schema built via the old `create_all()`) must be `alembic stamp`ed at the matching baseline revision before `upgrade head` — otherwise it'll try to `CREATE TABLE` on a table that already exists.

## Docs & comments worth knowing

- `README.md` is current and thorough (architecture diagram, config table, curl examples, dev instructions) — keep it in sync with API changes.
- `models.py` docstring explains the upsert/staleness semantics of `reported_at`.
- History: the service originally ingested per-action events via `POST /events` into a `usage_events` table; that was removed (commit `6cdea00`) and `/reports` is now the only ingestion path. Naming leftovers remain, e.g. `UserStats.last_event_at`.

## Open questions / unclear areas

- **Stray `path/to/venv/` directory** at the repo root (a Python 3.14 venv, likely from copy-pasting `python -m venv path/to/venv`). Untracked and not gitignored — probably safe to delete, but confirm.
- Python version drift: Docker uses 3.11, local `.venv` is 3.10, the stray venv is 3.14; `requirements.txt` is fully unpinned.
- The `/reports` upsert is read-then-insert (not `ON CONFLICT`), so concurrent posts for the same user+day+environment can race against the unique constraint.
- `GET /reports` returns all rows unpaginated — fine at current scale, unbounded long-term.
