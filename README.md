# HomeBasics

An everyday household-goods store built as a **system under test** for SDET practice:
Python/FastAPI business logic, React/TypeScript storefront, PostgreSQL, and a test suite
at every layer (unit → integration → contract → E2E → a11y → perf → security).

- Requirements: [docs/BRD.md](docs/BRD.md)
- Requirement → test mapping: [docs/traceability.md](docs/traceability.md)

## Layout

```
backend/    FastAPI app (app/), Alembic migrations, pytest suites (tests/unit, tests/integration)
frontend/   React + Vite storefront, Vitest + Testing Library + MSW tests (src/__tests__)
e2e/        Playwright (TypeScript): Page Objects, fixtures, UI/API/a11y specs
perf/       k6 load scripts (Milestone 7)
docs/       BRD and traceability matrix
.github/    CI: backend, frontend, then E2E against a Postgres service
```

## First-time setup (Windows / PowerShell)

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
copy .env.example .env        # then set DATABASE_URL and TEST_DATABASE_URL
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.seed.run
```

```bash
cd frontend && npm install
cd ../e2e && npm install && npx playwright install chromium
```

## Run it

| What | Command (from its folder) | URL |
|---|---|---|
| API | `.venv\Scripts\python -m uvicorn app.main:app --port 8010 --reload` | http://localhost:8010/api/v1/docs |
| Web | `npm run dev` | http://localhost:5173 |

> Port 8010 because Splunk owns 8000 on this machine.

## Test it

| Suite | Command |
|---|---|
| Backend all (unit + integration) | `backend> .venv\Scripts\pytest --cov` |
| Backend unit only (no DB) | `backend> .venv\Scripts\pytest -m unit` |
| Backend lint/format | `backend> .venv\Scripts\ruff check . ; .venv\Scripts\ruff format --check .` |
| Frontend unit | `frontend> npm test` (coverage: `npm run test:coverage`) |
| Frontend lint/types | `frontend> npm run lint ; npm run typecheck` |
| E2E everything | `e2e> npm test` (starts API + web automatically if not running) |
| E2E smoke / API only | `e2e> npm run test:smoke` / `npm run test:api` |
| E2E global-state tests only | `e2e> npx playwright test --project=isolated --no-deps` |
| E2E interactive | `e2e> npm run test:ui` |
| Contract (Schemathesis, every operation) | `backend> .venv\Scripts\pytest tests/integration/test_contract.py` |
| Bug hunt (each injected bug must fail the tests) | `backend> .venv\Scripts\python scripts/bug_hunt.py` |
| Load test (API running, seeded) | `backend> .venv\Scripts\locust -f perf/locustfile.py --host http://localhost:8010 --headless -u 50 -r 10 -t 2m` |
| Dependency audit | `backend> .venv\Scripts\pip-audit -r requirements.txt` / `frontend> npm audit --omit=dev` |

`locust` isn't in `requirements-dev.txt` (it's heavy and only the nightly job needs it):
`pip install locust`. The nightly workflow (`.github/workflows/nightly.yml`) runs the load
test against a local Postgres - judge p95 there, not against Neon over the internet - plus
OWASP ZAP scans of the API and the web app.

### Bug injection

`BUG_INJECTION=tax_on_shipping,cart_allows_eleven` switches on deliberate, realistic defects
(listed with the rule each breaks in `backend/app/core/bug_catalog.py`) - handy for practising
exploratory testing, or for checking a new test really fails when the rule breaks. Unknown names
stop the app at startup; prod refuses any. Auth rate limiting is off outside prod unless
`RATE_LIMIT_ENABLED=true`.

### E2E projects

| Project | What | Runs |
|---|---|---|
| `api` | HTTP contract tests straight against FastAPI | parallel |
| `chromium` | UI journeys, a11y | parallel |
| `mobile` | `@mobile`-tagged journeys on a Pixel 7 viewport | parallel |
| `isolated` | Tests that change **global** state: server clock, full DB reset | after all others, 1 worker |

UI tests never share accounts: the `user` / `signedInUser` fixtures register a fresh customer
per test, so parallel workers can't collide.

### Test-support endpoints (`ENABLE_TEST_ENDPOINTS=true`, impossible in prod)

| Endpoint | Use |
|---|---|
| `POST /api/v1/test/reset` | Wipe and reload seed data, reset the clock |
| `GET /api/v1/test/emails?to=…` | Read the email outbox (e.g. password-reset links) |
| `GET/POST /api/v1/test/clock` | `{"advance_seconds": 901}`, `{"freeze": true}`, `{"reset": true}` |

### Test data

The reset loads deterministic seed data: 51 tax rates, 6 categories, 60 active + 1 archived
product, and these users:

| Email | Password | Role |
|---|---|---|
| admin@homebasics.test | Admin12345 | admin |
| customer@homebasics.test | Customer123 | customer |
| shopper2@homebasics.test | Shopper123 | customer |

Seed products deliberately sit on rule boundaries (stock 0/1/5/6, prices $49.99/$50.00) -
see `backend/app/seed/data.py`.

⚠️ Backend integration tests **drop and rebuild** the schema in `TEST_DATABASE_URL`.
Never point it at a database you care about.
