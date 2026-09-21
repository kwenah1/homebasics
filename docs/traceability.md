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

## Catalog (Milestone 3)

Backend catalog tests compare every response with an independent **test oracle**
(`backend/tests/catalog_oracle.py`) computed from the seed data. Hypothesis generates 40 random
filter/sort/page combinations per run and each must match the oracle exactly.

| Req | Description | Tests | Layers | Status |
|---|---|---|---|---|
| CAT-01 / 01a | Browse, category filter, 20/page, stable non-overlapping pages | `tests/integration/test_catalog.py::TestBrowse`, `test_any_query_matches_the_oracle`, `tests/unit/test_catalog_rules.py::test_page_count`, `ProductListPage.test.tsx` (pagination), `e2e/tests/catalog.spec.ts` (browse), `e2e/tests/api/catalog.spec.ts` (walk every page x 5 sorts) | U I F E A | Covered |
| CAT-02 / 02a | Keyword search: all terms, name + description, literal wildcards, injection-safe | `test_catalog.py::TestSearch`, `test_catalog_rules.py` (terms, escaping), `ProductListPage.test.tsx` (header search), `catalog.spec.ts` (search, UI == API) | U I F E | Covered |
| CAT-03 / 03a | Price range (inclusive), in-stock, 5 sorts, strict params | `test_catalog.py::TestFilters`, `TestSort`, oracle property test, `catalogParams.test.ts`, `catalog.spec.ts` (filter & sort) | I F E | Covered |
| CAT-04 | Product detail, archived/unknown 404 | `test_catalog.py::TestDetail`, `ProductDetailPage.test.tsx`, `catalog.spec.ts` (detail) | I F E | Covered |
| CAT-05 / 05a | 0 = out of stock (Add disabled), 1-5 = "Only X left", 6+ = hidden count; qty cap min(10, stock) | `test_catalog_rules.py::test_stock_status_boundaries`, `test_max_order_qty_caps_at_ten_and_stock`, `test_catalog.py::TestStockFields`, `ProductDetailPage.test.tsx`, `catalog.spec.ts` (boundary products 0/1/5/6/150), `api/catalog.spec.ts` | U I F E A | Covered |
| CAT-06 | Rating sort, unrated last | `test_catalog.py::TestSort`, DB check `ck_products_rating_consistent` | I | Covered |
| CAT-07 | List state in URL: reload, Back, deep links, sanitised | `catalogParams.test.ts`, `catalog.spec.ts::page, sort and filters survive reload and Back` | F E | Covered |
| ADM-01 | Archived products hidden from list, detail and category counts | `test_catalog.py` (archived tests), `TestCategories` | I | Covered (storefront side) |

## Later milestones

| Req | Description | Tests | Status |
|---|---|---|---|
| CRT-01 | Quantity 1-10 | DB check `ck_cart_items_quantity_range` | Planned M4 |
| CRT-02..04 | Cart merge, price change, no reserve | - | Planned M4 |
| CHK-01..02 | Calculation order, tax | `test_seed_data.py::test_tax_table_covers_50_states_plus_dc`, `test_meta.py` | Partial (data) |
| CHK-03 | Free shipping >= $50 | `test_seed_data.py::test_boundary_values_present_for_free_shipping`, `routing.test.tsx` (copy) | Partial |
| CHK-05 | Integer cents, totals add up | `test_schema.py::test_order_total_must_add_up` | Partial (DB level) |
| CHK-04, 06..08 | Stock re-check, snapshot, mock pay, idempotency | - | Planned M5 |
| ORD-01..03 | State machine, restock, audit | `test_schema.py::test_valid_order_is_accepted_with_pending_status` | Partial |
| ADM-02..03 | Inventory, order admin | - | Planned M6 |

## Non-functional

| Req | Tests | Status |
|---|---|---|
| NFR-OPS | `test_health.py`, `test_schema.py::test_migrations_match_models`, `e2e/tests/api/health.spec.ts` | Covered |
| NFR-SEC | Security headers + CORS (`test_health.py`), prod guards (`test_config.py`), JWT attacks: alg=none, tampering, wrong type (`test_clock_and_tokens.py`, `test_auth_sessions.py`), mass assignment (`test_auth_register.py`, `api/auth.spec.ts`), IDOR (`test_addresses.py`, `api/auth.spec.ts`), open redirect (`validation.test.ts`, `auth.spec.ts`), httpOnly cookie (`auth.spec.ts`), uniform error shape (`api/auth.spec.ts`) | Partial - rate limiting in M7 |
| NFR-A11Y | `e2e/tests/a11y.spec.ts` - all public pages incl. filtered/empty results and product detail, a form in its error state, the account page | Covered (current pages) |
| NFR-TEST | Reset + clock + email outbox endpoints (`test_test_support.py`, `e2e/tests/isolated/*`), never in prod (`test_test_support.py`, `test_config.py`) | Covered |

## Defects found by the suites during Milestone 2

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 1 | Integration test | Password change couldn't tell which session to keep (the refresh cookie is path-scoped and never reaches `/me/password`), so it signed out the current device too | Endpoint now re-issues a session: `test_me.py::test_this_device_stays_signed_in_but_others_are_signed_out` |
| 2 | E2E (parallel run) | 500s on register/address: `POST /test/reset` in the parallel `api` project truncated tables mid-request (test-design defect) | Moved to the serial `isolated` project that runs last |
| 3 | E2E time travel | Tokens minted while the test clock was ahead were rejected (`iat` checked against the real clock) | `verify_iat`/`verify_nbf` off, time judged by `clock.now()`: `test_clock_and_tokens.py::test_token_minted_while_clock_is_ahead_is_valid` |
| 4 | Integration test | Test harness: `cookies.set()` created a duplicate cookie instead of replacing it | `tests/helpers.py::use_refresh` sets it on the server's cookie domain |

## Defects found by the suites during Milestone 3

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 5 | Manual browser check (not unit tests: they disable retries) | Archived/unknown product took ~7 s to show "not found": React Query retried the 404 three times with backoff | Never retry 4xx, max 2 retries otherwise: `frontend/src/__tests__/queryClient.test.ts`, `e2e/tests/catalog.spec.ts::archived product shows 404 quickly` (2 s budget) |
| 6 | E2E | Test design: waiting for "results visible" after a search read the *previous* results (race) | Page object waits for the matching API response: `e2e/pages/CatalogPages.ts::afterFetch` |
| 7 | Integration test | Test expectation, not app: a literal `%` search correctly matches the two descriptions containing "%" | Test corrected: `test_catalog.py::test_percent_sign_matches_literally` |
| 8 | CI (Postgres 17 container) | Name sort followed the server locale: Neon (C.UTF-8) and CI (en_US.utf8, which ignores spaces and punctuation) returned different orders | `ORDER BY lower(name) COLLATE "C"`: `test_catalog.py::test_name_sort_is_locale_independent` (builds a glibc-like ICU collation to prove the data is locale-sensitive) |
