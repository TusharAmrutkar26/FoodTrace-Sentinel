# FoodTrace Sentinel

**Trace Every Batch. Detect Every Gap. Recall with Precision.**

FoodTrace Sentinel is a student prototype for food batch traceability. The backend records organizations, products, batches, append-only supply-chain events, and explicit batch genealogy. The frontend supports batch management and displays each batch's event history and genealogy traces.

## Project structure

```text
frontend/src/components/        Batch registration, detail, event, and genealogy views
frontend/src/lib/api.ts         Typed API client for the FastAPI endpoints
frontend/src/types/             API request and response types
frontend/src/                   React dashboard, styles, and UI/API tests
frontend/                       React, TypeScript, and Vite frontend
backend/app/api/v1/              Versioned organization, product, batch, event, and genealogy routes
backend/app/core/                Application and database configuration
backend/app/db/                  SQLAlchemy metadata, engine, and request sessions
backend/app/models/              Organization, product, batch, event, and genealogy tables
backend/app/schemas/             Pydantic request and response validation
backend/app/services/            Batch, event, and genealogy operations and database rules
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

## Frontend setup and run

Open another PowerShell terminal from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally <http://localhost:5173>). The development server proxies `/api/v1` and `/health` to `http://127.0.0.1:8000` by default. To configure it, copy `.env.example` to `.env` only if you do not already have a local `.env` file. Leave `VITE_API_BASE_URL` empty to use the proxy, or set it to an API origin such as `http://127.0.0.1:8000` for direct requests. `VITE_API_PROXY_TARGET` changes the development proxy destination.

The dashboard loads batches, products, and organizations from the API. Batch search and paging use the batch list endpoint; the registration form sends the selected product and organization IDs from API responses. Batch quantities remain decimal strings so their precision is preserved. Batch details load the event history, immediate parent/child edges, and upstream/downstream traces from their APIs. Events can be recorded from the detail view. The interface does not store records in browser storage.

## Database and data rules

- SQLAlchemy models define `organizations`, `products`, `batches`, `batch_events`, and `batch_genealogy`; Alembic applies schema changes.
- SQLite foreign-key enforcement is enabled on every database connection. Request-scoped SQLAlchemy sessions are closed after each request and rolled back on errors.
- Batch codes are required, normalized to uppercase, unique without regard to case, and cannot be changed. Batch records have no hard-delete API.
- Quantities must be finite positive decimal strings, for example `"100.000"`. They are stored as text-backed Python `Decimal` values to preserve exact digits in SQLite.
- Supported unit codes are `kg`, `g`, `mg`, `t`, `l`, `ml`, and `each`. Values in different units are never combined or converted.
- List endpoints accept `limit` from 1 to 100 and `offset` from 0 to 10,000. Batch search checks the code, product name, and origin location.
- Events are append-only records with UTC timestamps. Event types are `harvested`, `produced`, `received`, `quality_checked`, `dispatched`, `delivered`, `stored`, and `processed`. An event may reference an existing organization and may include a location and notes.
- Genealogy links are explicit parent-to-child edges. Link creation rejects missing batches, self-links, duplicate pairs, and cycles. It never infers a relationship from batch codes.
- A genealogy `source_quantity` is an amount taken from its parent and must use the parent's unit. Recorded split allocations from one parent cannot exceed that batch's quantity. Inputs from separate parents remain separate; the system does not convert or total different units, and it does not assume transformation input/output differences indicate contamination or fraud.

## API

All batch-management routes use `/api/v1`. Resource creation requires an existing related record before a batch can reference it.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Existing process health response. |
| `POST`, `GET` | `/api/v1/organizations` | Create and list supply-chain organizations. |
| `POST`, `GET` | `/api/v1/products` | Create and list product names. |
| `POST`, `GET` | `/api/v1/batches` | Create batches and list/search with pagination. |
| `GET`, `PATCH` | `/api/v1/batches/{batch_code}` | Retrieve a batch or update its permitted fields. |
| `POST`, `GET` | `/api/v1/batches/{batch_code}/events` | Record and list chronological batch events. |
| `POST` | `/api/v1/genealogy` | Create an explicit parent/child relationship using batch IDs. |
| `GET` | `/api/v1/batches/{batch_code}/genealogy` | Retrieve immediate parents and children. |
| `GET` | `/api/v1/batches/{batch_code}/trace?direction=upstream\|downstream` | Traverse explicit genealogy edges to sources or affected batches. |

`POST /api/v1/batches` accepts `batch_code`, `product_id`, `origin_organization_id`, `origin_location`, decimal-string `quantity`, and a supported `unit`. Updates can change the product, originating organization, origin location, quantity, or unit. A batch code is immutable. `POST /api/v1/batches/{batch_code}/events` accepts an event type and optional UTC timestamp, organization ID, location, and notes; when time is omitted, the API records the current UTC time. `POST /api/v1/genealogy` accepts `parent_batch_id`, `child_batch_id`, `relationship_type`, and an optional `source_quantity`/`source_unit` pair. Event or genealogy payload errors return `422`, missing referenced records return `404`, and duplicate or cyclic genealogy links return `409`.

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
python -m pytest
```

The API tests use a fresh in-memory SQLite database and apply all Alembic migrations. They cover batch management, exact quantities, event creation and UTC ordering, genealogy creation and traversal, invalid references, duplicate links, cycle prevention, source-unit/split quantity checks, and SQLite foreign-key enforcement. The test database is separate from `backend/foodtrace.db`.

Run frontend tests and build from the `frontend` directory:

```powershell
npm test
npm run build
```

Frontend tests cover batch create and edit, event recording and history rendering, genealogy rendering, and API request/error handling.

## Phase scope

The current frontend supports batch listing, search, paging, registration, details, permitted edits, event history, event recording, and genealogy traces. It does not add QR codes, evidence, TraceTrust validation, recall simulation, report generation, or authentication. The API is an unauthenticated development foundation and should be connected to authentication before being used by multiple real users.

The existing Git repository and `origin` remote are preserved. No Git reinitialization, commit, or push is part of this setup.
