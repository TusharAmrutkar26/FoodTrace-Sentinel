# FoodTrace Sentinel

**Trace Every Batch. Detect Every Gap. Recall with Precision.**

FoodTrace Sentinel is a student prototype for food batch traceability. The backend records organizations, products, batches, append-only supply-chain events, explicit batch genealogy, and opaque public trace identities, with read-only TraceTrust checks, supply-chain activity reports, and targeted recall candidate simulations over recorded data. The frontend supports batch management, public mobile trace pages opened from batch QR codes, TraceTrust findings, weekly activity reports, and recall simulation for human review.

## Project structure

```text
frontend/src/components/        Batch, event, genealogy, QR, public trace, TraceTrust, catalog, report, and recall views
frontend/src/lib/api.ts         Typed API client for the FastAPI endpoints
frontend/src/types/             API request and response types
frontend/src/                   React dashboard, styles, and UI/API tests
frontend/                       React, TypeScript, and Vite frontend
backend/app/api/v1/              Versioned organization, product, batch, QR, public trace, event, genealogy, report, and recall routes
backend/app/core/                Application and database configuration
backend/app/db/                  SQLAlchemy metadata, engine, and request sessions
backend/app/models/              Organization, product, batch, event, genealogy, and QR identity tables
backend/app/schemas/             Pydantic request and response validation
backend/app/services/            Batch, event, genealogy, QR, TraceTrust, report aggregation, and recall traversal
backend/alembic/                 Database migration environment and revisions
backend/tests/                   API and SQLite behavior tests
```

The frontend and FastAPI API run as separate development servers. The dashboard reads and writes records through the versioned FastAPI API; page refreshes fetch saved data from SQLite through the API.

## Prerequisites

- Node.js 22.12 or newer and npm
- Python 3.10 or newer
- Git

## Backend setup and run

Open a PowerShell terminal from the repository root:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The default database is `backend/foodtrace.db`. The example `DATABASE_URL=sqlite:///./foodtrace.db` is relative to the `backend` directory. The API does not create tables automatically; apply migrations before starting it for batch operations.

If the API reports `no such table` for an organization, product, or batch, apply the pending migration from `backend` with `python -m alembic upgrade head`. This creates missing tables and preserves existing rows; it does not reset the database.

Check the health route:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Interactive API documentation is at <http://127.0.0.1:8000/docs>.

Each batch receives a random, stable 32-character trace identity. The Alembic migration fills identities for batches already in the database; new batches get an identity as part of creation. The QR code encodes a public frontend URL and this opaque identity, not batch details or event notes. Set `PUBLIC_TRACE_BASE_URL` in `backend/.env` to the frontend origin QR scanners can reach. There is no loopback fallback: if the setting is missing or points to `localhost`, a loopback address, or a wildcard address, the QR endpoints return `503` with a configuration diagnostic instead of creating a phone-unusable QR URL.

## Frontend setup and run

Open another PowerShell terminal from the repository root:

```powershell
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

For QR scanning on the same Wi-Fi network, configure one shared origin in `backend/.env`, for example:

```dotenv
PUBLIC_TRACE_BASE_URL=http://<your-laptop-lan-ip>:5176
```

Replace `<your-laptop-lan-ip>` with the laptop's current Wi-Fi IPv4 address (find it with `ipconfig`) before saving; do not commit that personal address. Add the matching frontend origin to `FRONTEND_ORIGINS` in `backend/.env`. The Vite configuration reads this value from `backend/.env`, binds to `0.0.0.0`, and uses its port. It sets `strictPort`, so Vite exits with a clear port-in-use error instead of silently choosing a different port than the QR encodes. If port `5176` is occupied, choose another free port in `PUBLIC_TRACE_BASE_URL` and restart both servers. Do not replace an existing `backend/.env`; add or update these settings and preserve its existing `DATABASE_URL` and other configuration. The backend and Vite development proxy continue to use `http://127.0.0.1:8000` on the laptop. Keep `VITE_API_BASE_URL` empty so the phone loads API data through Vite's `/api/v1` proxy; `VITE_API_PROXY_TARGET` changes the proxy destination if needed. The frontend's existing `.env` can remain as it is.

After saving the setting, restart the backend from `backend` (using the same Python environment and database configuration as before):

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Then start/restart the frontend from `frontend`:

```powershell
npm run dev -- --host 0.0.0.0
```

Open `http://<your-laptop-lan-ip>:5176/` on the phone, or scan a batch QR, replacing the placeholder with the same current Wi-Fi IPv4 address configured above. Verify Vite reports the configured port. The QR metadata and SVG endpoints both use the same configured origin. If Windows Firewall blocks access, add a narrowly scoped rule for the chosen Vite port and private local subnet (run PowerShell as Administrator only if Windows requests it):

```powershell
New-NetFirewallRule -DisplayName "FoodTrace Sentinel Vite 5176" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5176 -RemoteAddress LocalSubnet -Profile Private
```

Remove that development rule when it is no longer needed:

```powershell
Remove-NetFirewallRule -DisplayName "FoodTrace Sentinel Vite 5176"
```

For another port, replace `5176` in both commands with the port configured in `PUBLIC_TRACE_BASE_URL`. Do not disable Windows Firewall. Phone and laptop must be on the same reachable Wi-Fi network; guest Wi-Fi client isolation or other network rules can still block devices from communicating. For deployment, use the stable HTTPS origin for the public frontend. A production static host must serve the application shell for `/trace/{trace_id}` deep links.

The dashboard loads batches, products, and organizations from the API. Batch search and paging use the batch list endpoint; the registration form sends the selected product and organization IDs from API responses. Batch quantities remain decimal strings so their precision is preserved. Batch details load event history, immediate parent/child edges, and upstream/downstream traces from their APIs, and show a scannable QR image. After batch creation, its detail view opens so the new QR can be reviewed. The public `/trace/{trace_id}` page displays recorded batch and product details, origin, event history, direct relationships, and upstream/downstream batches. It reloads data from the API and does not use browser storage.

## Database and data rules

- SQLAlchemy models define `organizations`, `products`, `batches`, `batch_events`, `batch_genealogy`, and `batch_trace_identities`; Alembic applies schema changes. The identity table is additive and its migration backfills existing batches without rewriting their records.
- Recall incident management adds `recall_incidents`, `recall_candidate_snapshots`, `recall_reviews`, `recall_follow_up_actions`, and `recall_incident_history` in a new additive migration. Existing batch and trace identity records are not rewritten.
- SQLite foreign-key enforcement is enabled on every database connection. Request-scoped SQLAlchemy sessions are closed after each request and rolled back on errors.
- Batch codes are required, normalized to uppercase, unique without regard to case, and cannot be changed. Batch records have no hard-delete API.
- Quantities must be finite positive decimal strings, for example `"100.000"`. They are stored as text-backed Python `Decimal` values to preserve exact digits in SQLite.
- Supported unit codes are `kg`, `g`, `mg`, `t`, `l`, `ml`, and `each`. Values in different units are never combined or converted.
- List endpoints accept `limit` from 1 to 100 and `offset` from 0 to 10,000. Batch search checks the code, product name, and origin location.
- Events are append-only records with UTC timestamps. Event types are `harvested`, `produced`, `received`, `quality_checked`, `dispatched`, `delivered`, `stored`, and `processed`. An event may reference an existing organization and may include a location and notes.
- Genealogy links are explicit parent-to-child edges. Link creation rejects missing batches, self-links, duplicate pairs, and cycles. It never infers a relationship from batch codes.
- A genealogy `source_quantity` is an amount taken from its parent, not an output quantity, and must use the parent's unit. A transformation may produce a child in a different unit; no conversion is implied. Recorded split allocations from one parent cannot exceed that batch's quantity. Inputs from separate parents remain separate; the system does not convert or total different units, and it does not assume transformation input/output differences indicate contamination or fraud.

## API

All batch-management routes use `/api/v1`. Resource creation requires an existing related record before a batch can reference it.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Existing process health response. |
| `POST`, `GET` | `/api/v1/organizations` | Create and list supply-chain organizations. |
| `POST`, `GET` | `/api/v1/products` | Create and list product names. |
| `POST`, `GET` | `/api/v1/batches` | Create batches and list/search with pagination. |
| `GET`, `PATCH` | `/api/v1/batches/{batch_code}` | Retrieve a batch or update its permitted fields. |
| `GET` | `/api/v1/batches/{batch_code}/qr` | Return the stable opaque trace ID and canonical public URL. |
| `GET` | `/api/v1/batches/{batch_code}/qr.svg` | Generate an SVG QR code for the canonical public URL. |
| `GET` | `/api/v1/public-traces/{trace_id}` | Return the public-safe batch, events, relationships, and upstream/downstream trace. Unknown IDs return `404`. |
| `POST`, `GET` | `/api/v1/batches/{batch_code}/events` | Record and list chronological batch events. |
| `POST` | `/api/v1/genealogy` | Create an explicit parent/child relationship using batch IDs. |
| `GET` | `/api/v1/batches/{batch_code}/genealogy` | Retrieve immediate parents and children. |
| `GET` | `/api/v1/batches/{batch_code}/trace?direction=upstream\|downstream` | Traverse explicit genealogy edges to sources or affected batches. |
| `GET` | `/api/v1/trust/findings` | Compute filtered, explainable TraceTrust findings from recorded batches and genealogy. |
| `GET` | `/api/v1/reports/supply-chain` | Return read-only, date-filtered supply-chain activity aggregates. |
| `POST` | `/api/v1/recalls/simulate` | Return a read-only, human-review candidate scope from recorded genealogy. |
| `POST`, `GET` | `/api/v1/recall-incidents` | Create an incident for an existing root batch and list incidents with pagination/status filter. |
| `GET` | `/api/v1/recall-incidents/{reference_id}` | Read incident details, saved candidate snapshots, review decisions, follow-up actions, and history. |
| `GET` | `/api/v1/recall-incidents/{reference_id}/history` | Read the chronological incident history. |
| `POST` | `/api/v1/recall-incidents/{reference_id}/snapshots` | Explicitly run the existing simulator and save its full result as a candidate-scope snapshot. |
| `POST` | `/api/v1/recall-incidents/{reference_id}/reviews` | Append a human review decision and update the current incident status. |
| `POST`, `PATCH` | `/api/v1/recall-incidents/{reference_id}/actions` and `.../actions/{action_id}` | Add and update follow-up actions; completion is timestamped. |

`POST /api/v1/batches` accepts `batch_code`, `product_id`, `origin_organization_id`, `origin_location`, decimal-string `quantity`, and a supported `unit`. Updates can change the product, originating organization, origin location, quantity, or unit. A batch code is immutable. `POST /api/v1/batches/{batch_code}/events` accepts an event type and optional UTC timestamp, organization ID, location, and notes; when time is omitted, the API records the current UTC time. `POST /api/v1/genealogy` accepts `parent_batch_id`, `child_batch_id`, `relationship_type`, and an optional `source_quantity`/`source_unit` pair. Event or genealogy payload errors return `422`, missing referenced records return `404`, and duplicate or cyclic genealogy links return `409`.

The public trace response omits event notes, event organization details, participant types, and internal numeric database IDs. It includes the origin organization name and location to describe recorded origin. QR codes are lookup links to system records; they do not prove a physical product or package is authentic. Only put information in batch and event records that is appropriate for public display.

## TraceTrust checks

TraceTrust is a read-only analysis of the current batch and genealogy records. `GET /api/v1/trust/findings` accepts optional `severity` (`low`, `medium`, `high`), `check_type`, `batch_code`, and `status` (`detected`, `incomplete`) filters plus `limit` (1–100) and `offset` (0–10000). The response contains paginated `items`, `total`, and severity/incomplete `counts`. Each finding has a deterministic `finding_id`, related batch codes, rule-based severity and status, an explanation, the recorded evidence used, and a suggested review action. Counts reflect the filtered result set before pagination. Findings are recomputed; there is no review history or persisted status.

Checks cover malformed or non-positive stored quantities, unsupported units, recorded relationship input quantities that are invalid or inconsistent with their parent, split allocations that exceed a parent quantity, cycles in explicit genealogy, and comparable process loss above a threshold. High severity is used for stored quantity/unit and genealogy inconsistencies; medium severity is used for process loss above the configured threshold; low severity plus `incomplete` is used when the recorded operation cannot be compared safely. Process loss is calculated as `(input − output) / input × 100` only for a single recorded split/transformation input with an explicit positive source quantity and matching input, parent, and output units. The comparison uses exact decimal values; the displayed percentage is rounded to two decimal places. The current schema cannot prove that the recorded genealogy is a complete operation record, so this is completeness within the currently recorded graph. Merge/multi-input quantities are never summed, and no unit conversion is performed.

The process-loss threshold defaults to **20 percent** and can be set with `TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT` in the backend environment to a decimal from 0 through 100. For example, add `TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT=15` to `backend/.env`; restart FastAPI for the setting to take effect. The example environment file lists the default. A discrepancy is a prompt to review source records, not proof of contamination, adulteration, theft, fraud, or physical product authenticity.

Example response excerpt:

```json
{
  "items": [{
    "finding_id": "tt-0123456789abcdef0123",
    "check_type": "process_loss",
    "severity": "medium",
    "status": "detected",
    "title": "Recorded process loss exceeds the configured threshold",
    "explanation": "The recorded input/output difference is 30.00% in kg; the configured review threshold is 20%.",
    "batch_codes": ["SOURCE-1", "OUTPUT-1"],
    "evidence": [{"label": "Recorded input", "value": "100.000 kg"}],
    "recommended_action": "Review the operation records, measurement basis, and documented process yield."
  }],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "counts": {"high": 0, "medium": 1, "low": 0, "incomplete": 0}
}
```

The existing event and batch schemas do not record which event types or genealogy links are required for each workflow, and do not mark an operation's complete set of inputs. TraceTrust therefore does not flag a batch merely for having no events, parents, or children, and cannot assert that an unrecorded event/link is missing. Findings use batch codes and quantity/relationship values; they do not include internal row IDs or private event notes. No migration is needed for this read-only phase.

## Supply-chain intelligence reports

The Reports section in the frontend calls `GET /api/v1/reports/supply-chain`. With no query parameters, it reports the most recent seven fully completed UTC calendar days. To choose a period, provide both inclusive dates, for example `GET /api/v1/reports/supply-chain?start_date=2026-10-01&end_date=2026-10-07`. A lone date or a start date after the end date returns `422`. Each selected calendar day is interpreted from `00:00 UTC` through the next midnight (exclusive).

The endpoint uses database records and returns aggregate metrics only. `batches_created` is filtered by `batches.created_at`; event counts and distinct batches with event activity use `batch_events.occurred_at`; genealogy counts use `batch_genealogy.created_at`, which means when the link was saved, not necessarily when its physical operation occurred. All event types and genealogy relationship types are included, including genuine zero counts. The endpoint does not include detailed event rows.

Quantity totals are explicitly unavailable. Events contain no quantity, and summing batch snapshots or genealogy edge inputs could count the same food multiple times or imply that recorded input is production/output. The report does not infer quantities from event notes, convert units, or treat missing quantities as zero. Period-specific TraceTrust findings are also unavailable because TraceTrust is recomputed against current records and findings have no persisted finding timestamp/history. The response includes reasons, warnings, and metric definitions so unavailable data is distinct from a measured zero.

Use the page's **Export CSV** action to download the currently generated aggregate report. It includes the selected dates, generated time, metric names, units, availability labels, definitions, and warnings; it does not contain detailed event rows. This feature is read-only and requires no migration or database changes.

## Targeted recall simulator

The Recall simulator section calls `POST /api/v1/recalls/simulate` with a real `root_batch_code` and an optional `max_depth` from 1 to 50 (default 25). For example:

```json
{"root_batch_code":"MNG-201","max_depth":25}
```

The response contains the selected root, unique related batch records, upstream and downstream paths, recorded genealogy relationship values, event history, associated current TraceTrust findings, warnings, and traversal-completeness flags. Traversal follows only explicit parent-to-child links, is cycle-safe, sorts output deterministically, and reports when its depth or result-size limits are reached. The server caps each result at 500 batches, 2,000 relationship rows, 5,000 event rows, and 1,000 TraceTrust findings.

This is a read-only candidate list for human assessment. Relationship and event records are not independently verified. The simulator does not infer missing links, calculate or sum affected quantities, convert units, change batch status, send notifications, or declare contamination or an official recall. It requires no migration or database changes. Use **Export CSV** to export the actual response evidence and warnings.

## Recall incident management

The **Recall incidents** workspace section creates a persistent incident for an existing root batch. New incidents have a stable `RC-` reference and start in `pending_review`; creation does not run a simulation or mark an incident approved. The user must run the existing `POST /api/v1/recalls/simulate` flow, review its candidate scope and evidence, and explicitly choose **Save candidate snapshot**. Snapshot capture calls the same existing traversal service and stores its complete response as evidence, including the traversal-completeness flags and warnings.

Review decisions are appended to review history. The supported decisions are `requires_investigation`, `approved_for_next_step`, and `rejected`; the incident status is set to the latest recorded decision. `approved_for_next_step` means only that a user entered that workflow decision. It is not an official recall declaration, proof of contamination, fraud, or physical product identity. Follow-up actions support `open`, `in_progress`, `completed`, and `cancelled`, optional assignee/due date, completion notes, and evidence-reference strings. Evidence references are identifiers/links only; this phase does not upload or verify documents. No supplier/customer notifications are sent.

Recall incident creation, snapshots, reviews, and follow-up actions require an authenticated session and role. New creator and reviewer actions are attributed to the signed-in account; the account holder's real-world identity and email ownership are not independently verified. Historical free-text names and assignee labels remain unverified. A review records a workflow decision only; it does not establish contamination, fraud, or physical product identity.

Migration `20261011_0004` is forward-only; its downgrade is intentionally blocked so saved incident/review history cannot be removed accidentally. Phase 12 adds `20261011_0005_auth_access_control`; it is also forward-only and has not been applied to the configured project database as part of this development work. Use an isolated test database to validate it before applying it to any configured database.

## Product and organization catalogs

The frontend has separate **Products** and **Organizations** sections in the workspace navigation. Both read and write through the existing `/api/v1/products` and `/api/v1/organizations` endpoints. Product search uses the product name because the current product model has no product-code field. Organization records support a name and an optional participant type; the backend accepts participant types as free text, and the form offers common values plus a custom value.

Catalog records are add-only in this phase. The current API has no safe rename workflow or history snapshots; changing a product or organization name would also change how already-linked batches and public trace pages display that record. Catalog names are not unique in the current database/API, so existing duplicate rows are retained. The demo seed command matches names case-insensitively and reuses the lowest-ID match without modifying any matching row.

## Fictional demo data

Run the command from `backend` after activating the project virtual environment and applying migrations:

```powershell
python -m alembic upgrade head
python -m app.scripts.seed_demo_data
```

The command uses the configured `DATABASE_URL`. It is idempotent: it reuses matching products and organizations, reuses batches by case-insensitive batch code, and only creates missing records. It does not delete rows, alter existing product/organization/batch details, rewrite trace IDs, add or replace events, or replace genealogy links. A genealogy edge is only added if it is valid against the referenced existing batch quantities and graph; otherwise it is counted as skipped.

The fictional catalog includes Mango, Tomato, Rice, Wheat, Milk, and Onion, plus Mango Farm, Green Valley Farms, Sunrise Agro, Shree Farms, Fresh Dairy Co., and Maharashtra Agro. The sample batches include `MNG-201`, `TOM-201`, `RIC-201`, `WHT-201`, `MLK-201`, and `ONI-201`; `MNG-202` and `MNG-203` are mango packing lots connected to `MNG-201` by explicit split links. The mango split quantities use kilograms and total less than the source batch quantity. No safety incidents or quality outcomes are fabricated. All records are fictional examples and are created using the existing batch service, which generates trace identities for newly created batches.

The command prints added and reused counts for products, organizations, batches, and genealogy links. Run it only against the configured development database you intend to seed; tests use isolated in-memory databases.

## Migrations

Run from the `backend` directory after activating the virtual environment:

```powershell
python -m alembic upgrade head
```

When the schema changes, create a new revision, review it, then apply it:

```powershell
python -m alembic revision --autogenerate -m "describe schema change"
python -m alembic upgrade head
```

Migration files live in `backend/alembic/versions/`. Keep them with the project so each environment can apply the same schema history.

## Tests

Run from the `backend` directory:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The API tests use fresh in-memory SQLite databases and apply Alembic migrations. They cover authentication, Argon2 password hashes, invite expiry and single-use acceptance, session validation and revocation, CSRF, explicit CORS origins, role checks, organization isolation, verified recall actors, and migration preservation alongside the existing batch, genealogy, QR, reporting, TraceTrust, simulator, and incident tests. Migration compatibility tests begin at revision `20261011_0004` in a separate in-memory database, seed representative prior records, then verify the new migration preserves them. Tests do not modify `backend/foodtrace.db`.

Run frontend tests and build from the `frontend` directory:

```powershell
node .\node_modules\vitest\vitest.mjs run --configLoader native --pool=threads --maxWorkers=1 --reporter=dot
node .\node_modules\typescript\bin\tsc -b
node .\node_modules\vite\bin\vite.js build --configLoader native
```

Frontend tests cover batch create and edit, QR rendering, public trace details/events/genealogy, unknown trace and API failure states, event recording and history rendering, genealogy rendering, TraceTrust findings/filters/detail/error states, report rendering/date filters/CSV export, recall batch selection/traversal evidence/error states/CSV export, authentication, invitation acceptance links, logout errors, and API request/error handling.

## Phase scope

The private workspace requires an authenticated user. `/health` and opaque-ID public trace pages remain available without login. Existing product rows are retained with no organization owner and remain available as legacy shared catalog entries; newly created products belong to their organization (platform-created products are shared). Batch, event, genealogy, TraceTrust, report, simulator, QR metadata, and incident routes enforce the session's role and organization scope. Public trace responses remain privacy-filtered. Creator/reviewer names from old incidents remain unverified; new identity attribution uses the authenticated account, while assignee names remain entered labels. The QR is not proof of physical authenticity, and an incident decision does not prove an official recall or contamination.

## Phase 12 authentication and access control

The account workflow is invite-only. Passwords use Argon2id hashes. Login creates a revocable server-side session and an HTTP-only cookie; browser requests include the session cookie and a CSRF token for state changes. Registration accepts a random, expiring, single-use token issued by an authorized administrator. Only the token hash is stored. The invitation dialog displays the generated token once and provides a frontend link that carries it in the URL fragment; fragments are not sent with HTTP requests. No invitation email, OTP, or identity verification provider is configured.

The roles are `platform_admin`, `org_admin`, `operator`, `reviewer`, and `viewer`. Platform administrators can access records across organizations and may have no organization assigned. Organization members must be linked to an existing organization. The server enforces permissions and returns 404 for cross-organization record lookups. Legacy products with no organization owner remain shared so existing batches continue to resolve; review their visibility before using sensitive product names.

Configure `FRONTEND_ORIGINS` in `backend/.env` as a comma-separated list of exact browser origins (scheme, host, optional port; no path and no wildcard). For local Vite this commonly includes `http://localhost:5173` and `http://127.0.0.1:5173`; add the actual LAN origin when opening the frontend from another device. Production origins must use HTTPS. Set `AUTH_COOKIE_SECURE=true` when serving over HTTPS; development defaults to a non-secure cookie for local HTTP.

For local API requests, leave `VITE_API_BASE_URL` empty so requests use the Vite proxy. Set `VITE_API_PROXY_TARGET` in `frontend/.env.local` to the backend origin that is actually running. For example, if FastAPI runs on port 8001, use `VITE_API_PROXY_TARGET=http://127.0.0.1:8001`. Vite reads this value when it starts. If the configured frontend port is already occupied, reuse the running frontend; to reload changed config, stop it with Ctrl+C in its original terminal, then run `npm run dev` again from `frontend`.

After reviewing migration `20261011_0005`, back up the database according to your normal operations and apply reviewed migrations from `backend` with `python -m alembic upgrade head`. The migration preserves existing rows, leaves old product ownership unset, and adds nullable verified-user links to historical recall records. It is forward-only.

Create the first platform administrator through the interactive local bootstrap script after migrations and after confirming the intended `DATABASE_URL`:

```powershell
.\.venv\Scripts\python.exe -m app.scripts.bootstrap_admin --email admin@example.com
```

The script prompts for a new password twice, stores only its Argon2id hash, and refuses to create another platform administrator. An optional existing organization can be attached with `--organization-id 12`; platform administrators retain global scope. Do not expose this command as a web endpoint.

Sign in at the frontend. A platform or organization administrator can create an invitation from **Invite a user**. Select the organization and role, then securely share the displayed one-time token or the generated `/register#invite=...` link. The recipient sets a password on that page. The app does not send email; protect the token as a credential until it is accepted or expires.

Opening `/register` without a fragment shows a message explaining that an administrator must issue an invitation. The invitation token is generated only by the authenticated `POST /api/v1/auth/invitations` endpoint; it is not emailed or available to an unauthenticated visitor. The dialog offers copy buttons for the one-time token and the registration link. A link uses the current browser origin, so open the app from the correct LAN/public address before creating a link for another device.

The existing Git repository and `origin` remote are preserved. No Git reinitialization, commit, or push is part of this setup.
