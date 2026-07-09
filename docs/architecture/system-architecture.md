# Usage Tracker — System Architecture

## 1. What this project does

Usage Tracker is a standalone usage-analytics service for **Test Ease** (an external product). Test Ease periodically POSTs each user's running daily totals — test cases created, test cases executed, documents generated — to the ingestion API; each report is upserted as one PostgreSQL row per user per day. An internal React dashboard authenticates with username/password, obtains a signed session token, and displays aggregated stats (KPI tiles, daily trend chart, per-user table) computed at query time. Everything runs as three Docker Compose services on one bridge network.

## 2. Components

| Component                                      | Name                                            | Tech stack                                                                                                                                | Entry point                                                 |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Frontend SPA                                   | `frontend` (container `usage-tracker-frontend`) | React 18, TypeScript, Vite; hand-rolled SVG chart, no chart/UI libraries                                                                  | `frontend/src/main.tsx` (app shell: `frontend/src/App.tsx`) |
| Web server / reverse proxy                     | nginx (inside the `frontend` container)         | nginx (SPA fallback + `/api/*` reverse proxy, prefix stripped)                                                                            | `frontend/nginx.conf`                                       |
| Backend API                                    | `api` (container `usage-tracker-api`)           | Python 3.11, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic v2                                                                                  | `app/main.py` (`uvicorn app.main:app`)                      |
| Auth (embedded in API, not a separate service) | `app/auth.py`                                   | Python stdlib `hmac`/`hashlib`: X-API-Key check; HMAC-signed 12h dashboard session tokens (key = SHA-256 of `api_key:dashboard_password`) | `app/auth.py`                                               |
| Database                                       | `database` (container `usage-tracker-db`)       | PostgreSQL 15; single table `usage_reports`; schema via `Base.metadata.create_all()` at startup — no migrations                           | `docker-compose.yml` (model: `app/models.py`)               |

There are **no** background workers, message queues, caches, sidecars, or standalone gateways. Auth is in-process in the API.

## 3. External dependencies

| Dependency    | Type                                      | Role                                                                           |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| **Test Ease** | External product (not owned by this repo) | Sole ingestion client: POSTs running daily totals per user on a fixed interval |

No third-party APIs, SaaS tools, LLM providers, or legacy systems. The only other externals are build-time (Docker base images `python:3.11-slim`, `postgres:15`, npm/PyPI packages).

## 4. Connections

| #             | From → To                                                   | Protocol                                                      | Auth                                                                                                                                                                        | Purpose                                                                                         |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| C1            | Test Ease → API (`:8000`, `POST /reports`, `GET /reports`)  | REST (HTTP/JSON)                                              | API key: shared `X-API-Key` header, constant-time compared to `API_KEY` env                                                                                                 | Ingest/read per-user daily usage totals (upsert keyed on user_email + report_date)              |
| C2            | User's browser → nginx (`:3005`)                            | HTTP (static assets)                                          | None (login gate is client-side; auth enforced at the API)                                                                                                                  | Serve the React SPA with SPA fallback routing                                                   |
| C3            | Browser SPA → nginx `/api/*` → API                          | REST (HTTP/JSON), nginx `proxy_pass` strips the `/api` prefix | `POST /dashboard/login`: username/password in JSON body → returns token. All other `/dashboard/*`: `Authorization: Bearer <HMAC token>`, 12h expiry, stored in localStorage | Dashboard login and aggregated stats (`/dashboard/summary`, `/daily`, `/users`, `/user-emails`) |
| C4            | API → PostgreSQL (`database:5432`)                          | Direct SQL over TCP (SQLAlchemy 2 ORM, psycopg2 driver)       | Postgres password auth (`usage_tracker` / `DB_PASSWORD` in `DATABASE_URL`)                                                                                                  | All reads/writes to `usage_reports`; `create_all` at startup                                    |
| C5 (dev only) | Vite dev server (`:5173`) `/api/*` → API (`localhost:8000`) | REST (HTTP/JSON), proxy with `/api` prefix rewrite            | Same as C3                                                                                                                                                                  | Local development mirror of the nginx proxy (`frontend/vite.config.ts`)                         |

Notes: Postgres is **not** published to the host (internal Docker network only, unlike the old Grafana setup which queried it directly). API CORS is allow-all. `GET /health` on the API is unauthenticated.

## 5. Representative request flow — dashboard user views the summary stats

1. **Browser** loads `http://host:3005`; **nginx** serves the built SPA (`index.html` + assets).
2. React app (`App.tsx`) finds no token in localStorage → renders `Login.tsx`; user submits credentials.
3. `api.ts` → `POST /api/dashboard/login` to **nginx**, which strips `/api` and proxies to **API** `POST /dashboard/login`.
4. `routers/dashboard.py:login` constant-time-compares credentials against `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`, then `auth.py:create_dashboard_token` mints an HMAC-signed token (expiry-only payload, 12h TTL). Token returned; SPA stores it in localStorage and renders `Dashboard.tsx`.
5. Dashboard fetches `GET /api/dashboard/summary?from=…&to=…` (plus `/daily`, `/users`, `/user-emails`) with `Authorization: Bearer <token>` → nginx proxies to the API.
6. FastAPI dependency `auth.py:verify_dashboard_token` recomputes the HMAC and checks expiry.
7. `routers/dashboard.py:summary` builds a SQLAlchemy aggregate (`COUNT(DISTINCT user_email)` + `SUM` of the three metric columns, filtered by date range/user) and executes it against **PostgreSQL** `usage_reports` over the internal Docker network.
8. Rows are shaped into Pydantic models (`schemas.py:StatsSummary`), serialized to JSON, returned through nginx to the browser; React renders the KPI `StatTile`s and the `DailyTrend` SVG chart.

(Ingestion counterpart: Test Ease → `POST /reports` with `X-API-Key` → `routers/reports.py:upsert_report` → SELECT by user+date, then INSERT or UPDATE → commit → row echoed back as JSON.)

## 6. Open questions / unclear areas

- **Stray `path/to/venv/` directory** at the repo root (untracked Python 3.14 venv, likely a copy-pasted command) — presumably deletable, unconfirmed.
- The `/reports` upsert is read-then-insert rather than `ON CONFLICT`, so concurrent posts for the same user+day can race the unique constraint.
- `stack_id` is ingested and stored but never surfaced in any dashboard endpoint — future multi-stack filtering, or vestigial?
- Dashboard tokens carry no user identity (payload is just an expiry) — single shared admin identity; fine for an internal tool, but no audit trail.
- No migrations (`create_all` only), no automated tests, no CI; Python versions drift (Docker 3.11 vs local venvs 3.10/3.14) and `requirements.txt` is unpinned.
- `GET /reports` is unpaginated; unbounded as data grows.
- Naming leftover from the removed per-event ingestion path: `UserStats.last_event_at` (fed by `MAX(reported_at)`).
