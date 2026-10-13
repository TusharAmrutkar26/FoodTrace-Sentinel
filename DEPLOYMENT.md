# FoodTrace Sentinel deployment guide

FoodTrace Sentinel is not deployed by this repository. A hosted release still needs a selected provider, HTTPS domain, persistent database storage, and an operator-managed environment. Do not upload local `.env` files or use the development SQLite file as a hosted database.

## Supported release shape

Use one HTTPS site origin where possible. Serve the Vite `dist/` assets and reverse-proxy `/api/v1/*` and `/health` to FastAPI on that same site. This keeps the HTTP-only session cookie under the current `SameSite=Lax` policy. A separate API origin must be HTTPS and same-site with the frontend, be listed exactly in `FRONTEND_ORIGINS`, and be supplied as `VITE_API_BASE_URL` at frontend build time. Cross-site cookie hosting is not supported by the current cookie policy.

Configure the static host to fall back to `index.html` for application routes, including `/trace/<opaque-id>`, so a QR trace URL still opens after a browser refresh. Route `/api/v1/*` and `/health` to FastAPI, not to the SPA fallback.

## Environment configuration

Set deployment values through the host's environment or secret settings. The values below are placeholders, not a working production configuration:

```text
APP_ENV=production
DATABASE_URL=sqlite:////var/lib/foodtrace/foodtrace.db
FRONTEND_ORIGINS=https://trace.example.com
PUBLIC_TRACE_BASE_URL=https://trace.example.com
AUTH_COOKIE_SECURE=true
```

Production startup rejects non-HTTPS frontend origins, insecure session cookies, a relative or in-memory SQLite path, and a missing, non-HTTPS, or IP-based public QR origin. Use a stable domain for `PUBLIC_TRACE_BASE_URL`. QR identities stay unchanged when the origin changes, but already printed QR labels still contain their encoded origin; keep that origin reachable or redirect it to the stable domain. Local LAN addresses are only for demos.

`VITE_API_BASE_URL` is a build-time frontend setting. Leave it empty when the host serves the UI and proxies API routes on the same origin. Otherwise set it to the HTTPS API origin and configure the exact frontend origin in `FRONTEND_ORIGINS`.

## Database and migrations

SQLite is the configured and tested database. Relative development URLs such as `sqlite:///./foodtrace.db` resolve from the `backend/` directory, independent of the server's working directory. Production SQLite requires an absolute path on a durable mounted volume. Do not use an ephemeral filesystem or horizontally scale multiple instances against a local SQLite file. The current requirements do not include a PostgreSQL driver; a different database requires adding its driver and validating migrations on an isolated database first. Do not point that work at the local project database.

Before a schema update, inspect the target and revisions from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic heads
```

Stop the API and make a consistent backup before a reviewed migration:

```powershell
$backup = "foodtrace-backup-$(Get-Date -Format yyyyMMdd-HHmmss).db"
.\.venv\Scripts\python.exe -c "from app.core.config import DATABASE_URL; from sqlalchemy.engine import make_url; import sqlite3; source=sqlite3.connect(make_url(DATABASE_URL).database); destination=sqlite3.connect('$backup'); source.backup(destination); destination.close(); source.close()"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

The current source migration head is `20261013_0006`. The application does not run migrations or demo seeding at startup. For rollback, stop the app and restore a verified backup; do not assume downgrade migrations restore data.

## Build and start

Build from `frontend/` after setting build-time environment values:

```powershell
node .\node_modules\typescript\bin\tsc -b
node .\node_modules\vite\bin\vite.js build --configLoader native
```

Publish `frontend/dist/`. Start FastAPI from `backend/` using the platform's port:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

In production, `APP_ENV=production` disables FastAPI debug mode, requires secure cookies and HTTPS origins, and validates QR URL configuration. Keep the API private behind the HTTPS reverse proxy where practical. `GET /health` reports only process health.

## First administrator and smoke checks

After confirming the database and migration state, create the first platform administrator interactively:

```powershell
.\.venv\Scripts\python.exe -m app.scripts.bootstrap_admin --email admin@example.com
```

The command prompts for the password and stores only its hash. Run it once for the first admin; existing installations should use the invitation workflow. Public self-registration creates only an unassigned `viewer`. It cannot create an administrator or access private organization records before authorization.

Verify a release using `/health`, valid and invalid login, logout/session revocation, a protected-route authorization check, public registration on a disposable database, and anonymous public QR tracing. Do not create smoke-test accounts in the production database. Public trace pages omit private event notes and internal database IDs; a QR code is a link to a system record, not proof of physical-product authenticity.

## Local development and port issues

Clean defaults are FastAPI port `8000` and Vite port `5173`. If FastAPI uses another port, set `VITE_API_PROXY_TARGET=http://127.0.0.1:<backend-port>` in `frontend/.env.local` and restart Vite. For LAN QR testing, set `PUBLIC_TRACE_BASE_URL` to the laptop's reachable LAN host and Vite port, and include that exact origin in `FRONTEND_ORIGINS`. The Vite server binds to `0.0.0.0` and uses a strict configured port. Do not terminate a port owner until its PID and executable are confirmed. This workspace may have ignored local overrides such as backend `8001` and frontend `5176`; do not copy those local values into shared examples.

Before public launch, configure edge rate limits for login, registration, and invitation endpoints. Also provision TLS, persistent storage, backups, monitoring, and provider-specific SPA/reverse-proxy rules. No hosted deployment or provider-specific configuration has been performed or verified in this pass.
