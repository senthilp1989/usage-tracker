# TestEase Usage Tracker

Standalone usage-analytics service for Test Ease. Test Ease POSTs **raw, ungrouped event rows** — one per test case creation, one per test case execution (with its terminal-or-not `status`), one per generated document — to `POST /events` on a fixed interval, batched since its own last checkpoint. No aggregation happens on ingestion: every row is a plain insert into one of three event tables, and the dashboard computes totals and interface breakdowns by grouping those tables at query time. A custom React dashboard (which replaced an earlier Grafana setup) reads these aggregates through the API.

An earlier design (`usage_reports`, one row per user/environment/day, upserted with running totals) is **frozen but not removed** — its table, model, and `GET`/`POST /reports` routes still exist and its historical rows are preserved, but nothing reads from or writes to it as of this ingestion switch. The dashboard is 100% backed by the three new raw tables now.

## Tech stack

- **Backend** (`app/`): Python 3.11, FastAPI + Uvicorn, SQLAlchemy 2, Pydantic v2 (+ pydantic-settings, email-validator). Two auth schemes in `app/auth.py`: shared `X-API-Key` header for ingestion, and HMAC-signed 12h Bearer session tokens for dashboard endpoints (login with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`; signing key is SHA-256 of `api_key:dashboard_password`, so rotating either invalidates all sessions). Stdlib crypto only — no JWT library.
- **Database**: PostgreSQL 15. Three raw event tables (`models.py`): `test_case_created_events` (+ `test_case_name`), `test_case_executed_events` (+ `test_case_name`, `status`), `document_generated_events` — each with `user_email, environment, interface_name, created_at, reported_at`, unique on those (plus `test_case_name` where present) as a de-dupe backstop, **not** the primary correctness mechanism (Test Ease's own checkpoint is). There is **no `package_name` column** — package association is never populated by the source system (only exists via a live SAP API call the source tool deliberately doesn't make), so rather than store an always-`'unknown-package'` field, it was dropped entirely; see git history if you're tempted to re-add it, there's a real reason it's gone. `created_at`/`reported_at` are **naive datetimes already shifted to IST** — Test Ease converts once before sending (fixed +5:30, no DST), and the DB server default for `reported_at` uses `now() AT TIME ZONE 'Asia/Kolkata'` for the same reason: no timezone math anywhere downstream, which matters once these tables have many rows. Plus the frozen `usage_reports` table (unchanged, tz-aware `reported_at`, not part of the new pipeline). Schema is managed by **Alembic** (`alembic/`); the API container runs `alembic upgrade head` on startup (Dockerfile) — `main.py` no longer calls `create_all()`.
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite, react/react-dom are the only runtime deps — the daily chart is a hand-rolled SVG (`DailyTrend.tsx`, per dataviz skill specs: validated palette, crosshair tooltip, chart/table toggle). Light/dark theme defaults to OS preference but is user-toggleable (`theme.ts` sets `data-theme` + persists to localStorage). Served by nginx, which proxies `/api/*` → `api:8000` with the prefix stripped; Vite dev server proxies the same way.
- **Infra**: Docker Compose — `database` (internal-only), `api` (`${API_PUBLISH_PORT:-8000}`), `frontend` (`${FRONTEND_PUBLISH_PORT:-3005}`). All config via `.env` (see `.env.example`); compose fails fast if `API_KEY` or `DASHBOARD_PASSWORD` is unset.

## Layout

```
app/                    FastAPI package
  main.py               Entrypoint: CORS (allow-all), /health
  config.py             Settings: DATABASE_URL, API_KEY, DASHBOARD_USERNAME/PASSWORD
  database.py           Engine, SessionLocal, get_db
  models.py             TestCaseCreatedEvent / TestCaseExecutedEvent / DocumentGeneratedEvent
                         (raw, one row per event) + frozen UsageReport (old archive)
  schemas.py            Pydantic request/response models
  auth.py               API-key check + dashboard token create/verify
  routers/events.py     POST /events (per-row validation, insert, ON CONFLICT DO NOTHING) — ingestion (X-API-Key)
  routers/reports.py    Frozen: POST/GET /reports still work but nothing calls POST anymore
  routers/dashboard.py  /dashboard/login + summary|daily|users|artifacts|user-emails|environments|interfaces (Bearer)
alembic/                Migrations: env.py (pulls DATABASE_URL from app.config), versions/
alembic.ini             Alembic config (no hardcoded sqlalchemy.url)
frontend/               React dashboard; src/components: StatTile, Filters,
                        DailyTrend (SVG chart + table toggle), UsersTable, ArtifactsPanel
                        (interface breakdown, own filter), ThemeToggle
  nginx.conf            SPA fallback + /api proxy
Dockerfile              API image (python:3.11-slim); CMD runs `alembic upgrade head` then uvicorn
docker-compose.yml      database + api + frontend
README.md               Full architecture, curl examples, env-var table, dev setup
```

## Running / verifying

`docker compose up --build` with `.env`. Dashboard at :3005, OpenAPI docs at :8000/docs. Local dev: uvicorn + `docker compose up -d database` (see README), `cd frontend && npm run dev`. Frontend check: `npm run build` (tsc + vite). **No automated tests anywhere, no CI** — verify manually via curl (`POST /events` with X-API-Key; `/dashboard/login` → Bearer → `/dashboard/summary?from=...&to=...`).

## Conventions & gotchas

- **Ingestion is append-only, not upsert.** Each row is a plain insert; `ON CONFLICT DO NOTHING` on the natural key (`user_email, environment, interface_name[, test_case_name], created_at`) only guards against Test Ease resending a window it already sent (e.g. after losing its checkpoint state file) — it is not how normal dedup happens. Normal dedup is Test Ease never re-querying past its own checkpoint.
- **`routers/events.py` validates each row individually, not the batch as a whole.** `payload: Dict[str, Any]` (not a typed `UsageEventsIn` body) is validated item-by-item via `schema.model_validate(item)` in a try/except; a bad row is skipped and reported in the response's `rejected` list (`event_type`, `index`, `reason`), everything else still inserts. This exists because checkpoints only advance on a successful send — an all-or-nothing 422 on one bad row would've permanently blocked every retry. Confirmed in practice: `EmailStr` rejects `.local`-TLD addresses (email-validator treats them as reserved/special-use), and the local `DISABLE_AUTH=true` dev bypass in the source tool attributes every row to a mock user — that combination is exactly what surfaced this.
- **`user_email` on the event schemas stays `EmailStr`** (same as `UsageReportIn`) — deliberately kept strict rather than loosened to `str`, since per-row rejection above already contains the blast radius of a bad value to that one row.
- **All three event tables use IST-naive timestamps, always.** Never add a `field_serializer`/`.astimezone()` call for `created_at` or `reported_at` on the new schemas — that per-row conversion at read time is exactly what storing pre-shifted IST was meant to eliminate at scale. (The frozen `UsageReportOut`/`UserStats.last_event_at` `astimezone(IST)` calls that predate this are tied to the old tz-aware `usage_reports` archive only — don't copy that pattern onto the new tables.)
- **`dashboard.py` queries three tables and merges in Python.** `_scoped()` does all filtering (date range as a half-open timestamp bound — not `func.date(col) BETWEEN`, so the plain index on `created_at` stays usable — plus user/environment, and on `/artifacts`, interface) as SQL `WHERE` clauses. The per-day (`/daily`) and per-user (`/users`) dict-merging that follows is just reshaping three already-filtered, already-aggregated result sets into one row per key — there is no additional filtering logic client-side or in that merge step.
- `status` is still collected on `test_case_executed_events` (ingestion payload and DB column untouched), but the dashboard no longer surfaces pass/fail counts, a pass-rate KPI, or the per-row `status` column anywhere — `/dashboard/summary|daily|users` only return a plain `test_cases_executed` count now (no `FILTER (WHERE status = ...)`), and `/dashboard/executed-events` omits `status` from the response. If pass/fail reporting comes back, it needs to be re-added to `schemas.py`/`routers/dashboard.py`/`Dashboard.tsx`/`ExecutedEventsTable.tsx` — none of that plumbing exists anymore.
- The pre-existing environment fuzzy-search box and `UsersTable`/`ArtifactsPanel` client-side pagination were deliberately **left as client-side** during this rearchitecture — they only ever operate on data the backend already scoped by date/user/environment, and were explicitly out of scope ("only the new work" needs to be backend-filtered).
- `/dashboard/artifacts` is the interface breakdown (`test_cases_created`/`test_cases_executed` only — no documents, no pass/fail, no package dimension) sourced from `test_case_created_events` + `test_case_executed_events`, filterable by `interface_name` in addition to the usual date/user/environment. `/dashboard/interfaces` is a distinct-value list for the frontend dropdown, same pattern as `/dashboard/user-emails`/`/dashboard/environments` (all three now `UNION` across the relevant event tables, since there's no single source table anymore). There is no `/dashboard/packages` — see the package-removal note above.
- `/dashboard/users` returns one row per (user_email, environment, report_date) — a rollup of three tables' matching rows for that key, not a per-report listing anymore (there's no single "report" row to list). `last_event_at` is `MAX(reported_at)` across whichever of the three tables contributed to that key.
- Chart colors are the dataviz reference palette (CSS custom properties in `frontend/src/styles.css`); light-mode aqua/yellow are sub-3:1 contrast by design — the chart's table view is the required relief, don't remove it.
- A Prettier-style formatter hook runs on file writes in this repo.
- Internal-tool security posture: CORS wide open, single shared ingestion key, no rate limiting, no per-user dashboard identity (token payload is just an expiry timestamp).
- Schema changes go through Alembic now: edit `models.py`, then add a revision under `alembic/versions/` (hand-written or `alembic revision --autogenerate`, review either way). A database that predates Alembic (schema built via the old `create_all()`) must be `alembic stamp`ed at the matching baseline revision before `upgrade head` — otherwise it'll try to `CREATE TABLE` on a table that already exists.

## Docs & comments worth knowing

- `README.md` is current and thorough (architecture diagram, config table, curl examples, dev instructions) — keep it in sync with API changes.
- `models.py` docstrings explain the append-only/de-dupe semantics of the new event tables and the frozen archive status of `UsageReport`.
- History: the service originally ingested per-action events via `POST /events` into a `usage_events` table; that was removed (commit `6cdea00`) in favor of the pre-aggregated `/reports` daily-totals design — which has now itself been superseded by a return to raw per-event ingestion (this time as three typed tables, not one generic `usage_events`). `/reports` is frozen, not removed, this time — it stays queryable as a historical archive rather than being deleted outright.
- Migration `0005` dropped `package_name` from all three event tables and added `test_case_name` to the two test-case tables, changing the unique-constraint natural key on all three — written against empty tables (all data had just been truncated for testing when this shipped), so it doesn't attempt to backfill/migrate any pre-existing `package_name` values.

## Open questions / unclear areas

- **Stray `path/to/venv/` directory** at the repo root (a Python 3.14 venv, likely from copy-pasting `python -m venv path/to/venv`). Untracked and not gitignored — probably safe to delete, but confirm.
- Python version drift: Docker uses 3.11, local `.venv` is 3.10, the stray venv is 3.14; `requirements.txt` is fully unpinned.
- `GET /reports` (frozen archive) and `GET /events`-adjacent endpoints return all rows unpaginated — fine at current scale (bounded, ~2000 rows total per the last known volume estimate), unbounded long-term.
- A still-`RUNNING`/`QUEUED` execution older than Test Ease's 30-minute settle window gets reported with that non-terminal status and is never corrected later — ingestion is insert-only, not upsert. Accepted tradeoff, not a bug.
