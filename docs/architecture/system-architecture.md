# TestEase Usage Tracker — System Architecture

## 1. What this project does

TestEase Usage Tracker is a standalone usage-analytics service for **Test Ease** (an external product). Test Ease periodically POSTs **raw, ungrouped events** — one row per test case created, per test case executed, per document generated, per test-case document generated — to the ingestion API, batched since its own checkpoint; each row is a plain insert into one of four PostgreSQL event tables, with no aggregation on ingestion. An internal React dashboard authenticates with username/password, obtains a signed session token, and displays totals, rankings and breakdowns all computed at query time by grouping those tables. Everything runs as three Docker Compose services on one bridge network.

An earlier design ingested pre-aggregated daily totals via `POST /reports` into a `usage_reports` table; that endpoint, its model and the table are gone (dropped in migration `0009`). Nothing in the current system reads or writes daily totals.

## 2. Components

| Component                                      | Name                                            | Tech stack                                                                                                                                | Entry point                                                 |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Frontend SPA                                   | `frontend` (container `usage-tracker-frontend`) | React 18, TypeScript, Vite; hand-rolled SVG chart, no chart/UI libraries                                                                  | `frontend/src/main.tsx` (app shell: `frontend/src/App.tsx`) |
| Web server / reverse proxy                     | nginx (inside the `frontend` container)         | nginx (SPA fallback + `/api/*` reverse proxy, prefix stripped)                                                                            | `frontend/nginx.conf`                                       |
| Backend API                                    | `api` (container `usage-tracker-api`)           | Python 3.11, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic v2                                                                                  | `app/main.py` (`uvicorn app.main:app`)                      |
| Auth (embedded in API, not a separate service) | `app/auth.py`                                   | Python stdlib `hmac`/`hashlib`: X-API-Key check; HMAC-signed 12h dashboard session tokens (key = SHA-256 of `api_key:dashboard_password`) | `app/auth.py`                                               |
| Database                                       | `database` (container `usage-tracker-db`)       | PostgreSQL 15; four raw event tables; schema via **Alembic** — the API container runs `alembic upgrade head` before uvicorn starts        | `docker-compose.yml` (model: `app/models.py`)               |

There are **no** background workers, message queues, caches, sidecars, or standalone gateways. Auth is in-process in the API.

## 3. External dependencies

| Dependency    | Type                                      | Role                                                                           |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| **Test Ease** | External product (not owned by this repo) | Sole ingestion client: POSTs raw per-action events on a fixed interval, batched since its own checkpoint |

No third-party APIs, SaaS tools, LLM providers, or legacy systems. The only other externals are build-time (Docker base images `python:3.11-slim`, `postgres:15`, npm/PyPI packages).

## 4. Connections

| #             | From → To                                                   | Protocol                                                      | Auth                                                                                                                                                                        | Purpose                                                                                         |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| C1            | Test Ease → API (`:8000`, `POST /events`)                   | REST (HTTP/JSON)                                              | API key: shared `X-API-Key` header, constant-time compared to `API_KEY` env                                                                                                 | Ingest raw per-action events (plain inserts; `ON CONFLICT DO NOTHING` on each type's natural key as a resend backstop) |
| C2            | User's browser → nginx (`:3005`)                            | HTTP (static assets)                                          | None (login gate is client-side; auth enforced at the API)                                                                                                                  | Serve the React SPA with SPA fallback routing                                                   |
| C3            | Browser SPA → nginx `/api/*` → API                          | REST (HTTP/JSON), nginx `proxy_pass` strips the `/api` prefix | `POST /dashboard/login`: username/password in JSON body → returns token. All other `/dashboard/*`: `Authorization: Bearer <HMAC token>`, 12h expiry, stored in localStorage | Dashboard login, aggregates (`/summary`, `/daily`, `/users`, `/artifacts` + their `/export` twins), filter option lists (`/user-emails`, `/environments`, `/interfaces`) and the drawer's per-event detail endpoints |
| C4            | API → PostgreSQL (`database:5432`)                          | Direct SQL over TCP (SQLAlchemy 2 ORM, psycopg2 driver)       | Postgres password auth (`usage_tracker` / `DB_PASSWORD` in `DATABASE_URL`)                                                                                                  | All reads/writes to the four event tables; `alembic upgrade head` at container start            |
| C5 (dev only) | Vite dev server (`:5173`) `/api/*` → API (`localhost:8000`) | REST (HTTP/JSON), proxy with `/api` prefix rewrite            | Same as C3                                                                                                                                                                  | Local development mirror of the nginx proxy (`frontend/vite.config.ts`)                         |

Notes: Postgres is **not** published to the host (internal Docker network only, unlike the old Grafana setup which queried it directly). API CORS is allow-all. `GET /health` on the API is unauthenticated.

## 5. Representative request flow — dashboard user views the summary stats

1. **Browser** loads `http://host:3005`; **nginx** serves the built SPA (`index.html` + assets).
2. React app (`App.tsx`) finds no token in localStorage → renders `Login.tsx`; user submits credentials.
3. `api.ts` → `POST /api/dashboard/login` to **nginx**, which strips `/api` and proxies to **API** `POST /dashboard/login`.
4. `routers/dashboard.py:login` constant-time-compares credentials against `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`, then `auth.py:create_dashboard_token` mints an HMAC-signed token (expiry-only payload, 12h TTL). Token returned; SPA stores it in localStorage and renders `Dashboard.tsx`.
5. `Dashboard.tsx` fetches `GET /api/dashboard/summary?from=…&to=…` (plus `/daily`, `/users/export`, `/artifacts/export` and the filter option lists) with `Authorization: Bearer <token>` → nginx proxies to the API.
6. FastAPI dependency `auth.py:verify_dashboard_token` recomputes the HMAC and checks expiry.
7. `routers/dashboard.py:summary` runs one scoped `COUNT` per event table plus a distinct-user count, each filtered by `_scoped()` (half-open timestamp range on `created_at`, plus user/environment/search) against **PostgreSQL** over the internal Docker network — there are no stored totals to sum.
8. Counts are shaped into Pydantic models (`schemas.py:StatsSummary`), serialized to JSON, returned through nginx to the browser; React renders the `KpiTile`s and the `ActivityChart` SVG columns.

(Ingestion counterpart: Test Ease → `POST /events` with `X-API-Key` → `routers/events.py:ingest_events` → each row validated individually, bad rows collected into `rejected` → one bulk insert per event type with `ON CONFLICT DO NOTHING` → commit → per-type accepted counts plus `rejected` returned as JSON.)

## 6. Open questions / unclear areas

- **Stray `path/to/venv/` directory** at the repo root (untracked Python 3.14 venv, likely a copy-pasted command) — presumably deletable, unconfirmed.
- Dashboard tokens carry no user identity (payload is just an expiry) — single shared admin identity; fine for an internal tool, but no audit trail.
- No automated tests and no CI; Python versions drift (Docker 3.11 vs local venvs 3.10/3.14) and `requirements.txt` is unpinned.
- The `/export` endpoints are unpaginated by design (the dashboard filters/sorts client-side off the full scoped set); fine at current volume, unbounded long-term.
- A migration failure blocks startup — the API container's command is `alembic upgrade head && uvicorn …`, so a bad revision means no API at all rather than a stale schema.
- Ingestion is insert-only, so a non-terminal execution `status` reported at send time is never corrected later. Accepted tradeoff.
