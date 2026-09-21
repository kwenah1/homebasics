# Requirements Traceability Matrix

Each requirement ID from [BRD.md](BRD.md) maps to the automated tests that verify it.
Status: **Covered** (tests pass) · **Partial** (some aspects tested) · **Planned** (milestone).

Layers: **U** = backend unit, **I** = backend integration (real Postgres), **F** = frontend
(Vitest + MSW), **E** = Playwright E2E (UI), **A** = Playwright API, **X** = axe accessibility.

## Accounts (Milestone 2)

| Req | Description | Tests | Layers | Status |
|---|---|---|---|---|
| ACC-01 | Register; email unique, case-insensitive; normalized | `backend/tests/integration/test_auth_register.py`, `test_schema.py::test_email_unique_ignoring_case`, `frontend/src/__tests__/RegisterPage.test.tsx`, `e2e/tests/auth.spec.ts` (registration) | I F E | Covered |
| ACC-02 / 02a | Password policy (8-64, letter + number, 72-byte cap), bcrypt | `backend/tests/unit/test_password_policy.py` (incl. property-based), `test_security.py`, `frontend/src/__tests__/validation.test.ts` (parity table), `RegisterPage.test.tsx` | U I F E | Covered |
| ACC-03 / 03a | JWT access (15 min) + rotating refresh cookie (7 days), logout, reuse detection | `tests/unit/test_clock_and_tokens.py`, `tests/integration/test_auth_sessions.py`, `frontend/src/__tests__/client.test.ts`, `e2e/tests/auth.spec.ts` (sign in/out, httpOnly), `e2e/tests/api/auth.spec.ts`, `e2e/tests/isolated/time-travel.spec.ts` | U I F E A | Covered |
| ACC-04 / 04a / 04b | 5-failure lockout, 15 min, Retry-After; no enumeration | `tests/integration/test_auth_login.py::TestLockout`, `LoginPage.test.tsx`, `e2e/tests/auth.spec.ts` (lockout), `time-travel.spec.ts` (lock lifts) | I F E | Covered |
| ACC-05 / 05a / 05b | Profile edit, password change, address book (max 5, one default, IDOR) | `tests/integration/test_me.py`, `test_addresses.py` (incl. DB partial unique index), `AccountPage.test.tsx`, `e2e/tests/account.spec.ts`, `e2e/tests/api/auth.spec.ts` (IDOR) | I F E A | Covered |
| ACC-06 / 06a | Reset link: emailed, single use, 30 min, signs out, unlocks | `tests/integration/test_password_reset.py`, `ResetPasswordPage.test.tsx`, `e2e/tests/auth.spec.ts` (reset), `time-travel.spec.ts` (expiry) | I F E | Covered |
| ADM-04 | Admin-only guard; 403 for customers; demotion immediate | `tests/integration/test_me.py::TestRoleGuard` | I | Partial (no admin endpoints yet - M6) |

## Later milestones

| Req | Description | Tests | Status |
|---|---|---|---|
| CAT-01..04 | Catalog, search, filter, detail | - | Planned M3 |
| CAT-05 | Stock threshold messaging | `tests/unit/test_seed_data.py::test_boundary_values_present_for_stock_rules` | Partial (test data) |
| CRT-01 | Quantity 1-10 | DB check `ck_cart_items_quantity_range` | Planned M4 |
| CRT-02..04 | Cart merge, price change, no reserve | - | Planned M4 |
| CHK-01..02 | Calculation order, tax | `test_seed_data.py::test_tax_table_covers_50_states_plus_dc`, `test_meta.py` | Partial (data) |
| CHK-03 | Free shipping >= $50 | `test_seed_data.py::test_boundary_values_present_for_free_shipping`, `routing.test.tsx` (copy) | Partial |
| CHK-05 | Integer cents, totals add up | `test_schema.py::test_order_total_must_add_up` | Partial (DB level) |
| CHK-04, 06..08 | Stock re-check, snapshot, mock pay, idempotency | - | Planned M5 |
| ORD-01..03 | State machine, restock, audit | `test_schema.py::test_valid_order_is_accepted_with_pending_status` | Partial |
| ADM-01 | Archived products hidden | `test_schema.py::test_seeded_archived_product_exists` | Partial (data) |
| ADM-02..03 | Inventory, order admin | - | Planned M6 |

## Non-functional

| Req | Tests | Status |
|---|---|---|
| NFR-OPS | `test_health.py`, `test_schema.py::test_migrations_match_models`, `e2e/tests/api/health.spec.ts` | Covered |
| NFR-SEC | Security headers + CORS (`test_health.py`), prod guards (`test_config.py`), JWT attacks: alg=none, tampering, wrong type (`test_clock_and_tokens.py`, `test_auth_sessions.py`), mass assignment (`test_auth_register.py`, `api/auth.spec.ts`), IDOR (`test_addresses.py`, `api/auth.spec.ts`), open redirect (`validation.test.ts`, `auth.spec.ts`), httpOnly cookie (`auth.spec.ts`), uniform error shape (`api/auth.spec.ts`) | Partial - rate limiting in M7 |
| NFR-A11Y | `e2e/tests/a11y.spec.ts` - all public pages, a form in its error state, the account page | Covered (current pages) |
| NFR-TEST | Reset + clock + email outbox endpoints (`test_test_support.py`, `e2e/tests/isolated/*`), never in prod (`test_test_support.py`, `test_config.py`) | Covered |

## Defects found by the suites during Milestone 2

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 1 | Integration test | Password change couldn't tell which session to keep (the refresh cookie is path-scoped and never reaches `/me/password`), so it signed out the current device too | Endpoint now re-issues a session: `test_me.py::test_this_device_stays_signed_in_but_others_are_signed_out` |
| 2 | E2E (parallel run) | 500s on register/address: `POST /test/reset` in the parallel `api` project truncated tables mid-request (test-design defect) | Moved to the serial `isolated` project that runs last |
| 3 | E2E time travel | Tokens minted while the test clock was ahead were rejected (`iat` checked against the real clock) | `verify_iat`/`verify_nbf` off, time judged by `clock.now()`: `test_clock_and_tokens.py::test_token_minted_while_clock_is_ahead_is_valid` |
| 4 | Integration test | Test harness: `cookies.set()` created a duplicate cookie instead of replacing it | `tests/helpers.py::use_refresh` sets it on the server's cookie domain |
