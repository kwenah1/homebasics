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

## Cart (Milestone 4)

The backend cart is also checked by a **Hypothesis stateful test**
(`backend/tests/integration/test_cart_stateful.py`): random sequences of add / set quantity /
remove / merge / clear run against the real API, and after every step the API must match a
small in-memory model. Any failing sequence is shrunk to the shortest reproduction.

| Req | Description | Tests | Layers | Status |
|---|---|---|---|---|
| CRT-01 / 01a | 1-10 per line, and never more than stock; refused (not trimmed); client can't set a price | `tests/unit/test_cart_rules.py::test_line_limit`, `tests/integration/test_cart.py::TestAdd`, `TestUpdateRemove`, stateful test, DB check `ck_cart_items_quantity_range`, `guestCart.test.ts::addToGuestLines`, `ProductDetailPage.test.tsx`, `e2e/tests/cart.spec.ts` (11th unit, stock 1) | U I F E | Covered |
| CRT-02 / 02a | Guest cart: validated storage, cross-tab sync; merge at sign-in (sum, cap, skip, report, clear, no double count) | `test_cart_rules.py::test_merged_quantity*`, `test_cart.py::TestMerge`, `TestPreview`, `guestCart.test.ts`, `CartPage.test.tsx` (merge suite incl. failure + retry), `cart.spec.ts` (merge, second tab, tampered storage), `api/cart.spec.ts` | U I F E A | Covered |
| CRT-03 / 03a | Price when added recorded (guests: price seen, across sign-in); rises/drops flagged; acknowledge; totals use today's price | `test_cart.py::TestPriceChanges`, `test_price_the_guest_saw_survives_sign_in`, `CartPage.test.tsx`, `e2e/tests/isolated/cart-changes.spec.ts` | I F E | Covered |
| CRT-04 / 04a | No reservation: lines re-validated; flagged lines excluded from subtotal; checkout blocked | `test_cart_rules.py::test_line_issue`, `test_cart.py::TestNoReservation`, `CartPage.test.tsx`, `isolated/cart-changes.spec.ts` | U I F E | Covered |
| CRT-05 | Free-shipping estimate at the $49.99/$50.00 boundary | `test_cart_rules.py::test_amount_to_free_shipping`, `test_cart.py::TestFreeShippingEstimate`, `CartPage.test.tsx`, `cart.spec.ts` | U I F E | Covered |
| CRT-06 | Concurrent requests serialised (row lock) | `e2e/tests/api/cart.spec.ts::concurrent adds...` (6 parallel adds -> five 200s, one 409, qty 10) | A | Covered |
## Checkout & orders (Milestone 5)

| Req | Description | Tests | Layers | Status |
|---|---|---|---|---|
| CHK-01 / 01a / 02 / 05 / 05a | Calculation order; tax by ship-to state, once, half-up, never on shipping; integer cents | `tests/unit/test_pricing.py` (worked examples, half-up cases, once-per-order, property test incl. the DB identity), `tests/integration/test_checkout.py::TestQuote`, DB check `ck_orders_total_adds_up`, `Checkout.test.tsx`, `e2e/tests/checkout.spec.ts` (TX $0.82 on $9.98; OR 0%) | U I F E | Covered |
| CHK-03 | Standard free at >= $50 after discount, else $5.99; express $14.99 | `test_pricing.py::test_shipping_boundaries`, `test_free_shipping_uses_the_discounted_subtotal`, `TestQuote::test_free_shipping_boundary`, `checkout.spec.ts` ($49.90 vs over $50, express) | U I E | Covered |
| CHK-04 / 04a | Stock re-checked under lock at placement; per-line refusal; last unit sold once | `TestPlaceOrder::test_stock_changed_since_adding_lists_every_problem_line`, `Checkout.test.tsx`, `e2e/tests/isolated/checkout-state.spec.ts::two shoppers race for the last unit` | I F E | Covered |
| CHK-06 | Order snapshots price, name, SKU, address | `TestPlaceOrder::test_snapshot_survives_later_price_and_address_changes` | I | Covered |
| CHK-07 / 07a | Mock gateway: 3 test cards, others refused, Luhn, expiry, last4 only, 402 decline stays payable | `tests/unit/test_payments_and_states.py`, `TestPay`, `card.test.ts`, `PayAndOrders.test.tsx`, `checkout.spec.ts` (decline -> insufficient -> success), `api/checkout.spec.ts` (PAN never in any response, 402) | U I F E A | Covered |
| CHK-08 / 08a | Idempotent place-order and pay; key reuse with a different body refused; client keeps/renews keys correctly | `TestPlaceOrder::test_idempotent_replay...`, `TestPay::test_replay_never_charges_twice`, `card.test.ts::shouldKeepKey`, `Checkout.test.tsx` (network retry same key, 409 new key), `api/checkout.spec.ts` (3 simultaneous calls -> 1 order / 1 payment) | U I F A | Covered |
| CHK-09 | Expected total required; changed total refused | `TestPlaceOrder::test_total_changed_since_the_quote`, `Checkout.test.tsx`, `isolated/checkout-state.spec.ts::price changed after the quote` | I F E | Covered |
| ORD-01 / 01a | Stock taken at placement, returned on cancel/expiry; 30-min window; sweep before stock reads | `TestExpiry` (frozen clock, 29:59 vs 30:00), `TestCancel`, `isolated/checkout-state.spec.ts` (unpaid order expires, item back on sale; pay after window) | I E | Covered |
| ORD-02 / 02a | State machine: exact allowed (from, to, who) set; 409 otherwise | `test_payments_and_states.py::TestStateMachine::test_every_combination` (all 192 cases), `TestLifecycleAndHistory`, `TestCancel::test_cancel_until_shipped`, `checkout.spec.ts::shipped orders can no longer be cancelled` | U I E | Covered |
| ORD-03 | Every transition audited (from, to, who, note) | `TestLifecycleAndHistory::test_full_happy_path_is_audited`, `PayAndOrders.test.tsx` | I F | Covered |
## Admin (Milestone 6)

| Req | Description | Tests | Layers | Status |
|---|---|---|---|---|
| ADM-01 / 01a | Product create / edit / archive; unique SKU and name; slug, SKU and stock not editable; archived hidden from store but kept on orders | `tests/integration/test_admin.py::TestProducts`, `test_catalog.py` (archived excluded), `Admin.test.tsx`, `e2e/tests/admin.spec.ts` (create -> on sale, archive/unarchive, duplicate SKU, price change flags carts) | I F E | Covered |
| ADM-01b | Categories: create, rename (slug stable), delete only when empty | `test_admin.py::TestCategories`, `admin.spec.ts::categories` | I E | Covered |
| ADM-02 / 02a | Stock adjustments with reasons and sign rules; never below 0; ledger with actor; **sum(ledger) == stock for every product** | `test_admin.py::TestStock`, `test_ledger_reconciles_for_every_product_after_orders`, `Admin.test.tsx`, `admin.spec.ts::restock, damage and the ledger` | I F E | Covered |
| ADM-03 / 03a | Order list/search/detail; fulfil, cancel (restock + refund), refund delivered; system statuses refused; customer sees staff notes | `test_admin.py::TestOrders`, `test_checkout.py::TestLifecycleAndHistory`, `Admin.test.tsx`, `admin.spec.ts::orders` | I F E | Covered |
| ADM-04 / 04a | Every admin route: anonymous 401, customer 403, admin allowed - enumerated from the OpenAPI spec; UI staff-only guard; demotion takes effect immediately | `test_admin.py::test_anonymous_gets_401` / `test_customer_gets_403` / `test_admin_is_let_through` (17 routes each), `test_me.py::TestRoleGuard`, `Admin.test.tsx`, `admin.spec.ts::access` | I F E | Covered |
## Later milestones

| Req | Description | Tests | Status |
|---|---|---|---|

## Non-functional

| Req | Tests | Status |
|---|---|---|
| NFR-OPS | `test_health.py`, `test_schema.py::test_migrations_match_models`, `e2e/tests/api/health.spec.ts` | Covered |
| NFR-SEC | Security headers + CORS (`test_health.py`), prod guards (`test_config.py`), JWT attacks: alg=none, tampering, wrong type (`test_clock_and_tokens.py`, `test_auth_sessions.py`), mass assignment (`test_auth_register.py`, `api/auth.spec.ts`), IDOR (`test_addresses.py`, `api/auth.spec.ts`), open redirect (`validation.test.ts`, `auth.spec.ts`), httpOnly cookie (`auth.spec.ts`), uniform error shape (`api/auth.spec.ts`) | Covered |
| NFR-SEC-01 | Auth rate limits: 11th login is 429 + Retry-After, sliding window, blocked attempts don't count, rules independent, every limited route, off outside prod, can't be disabled in prod (`test_rate_limit.py`) | Covered |
| NFR-SEC-02 | Out-of-range ids/pages, NUL bytes in body/query/path, undecodable body - all 422 (`test_input_hardening.py`); fuzzed across every operation (`test_contract.py`) | Covered |
| NFR-SEC-03 | `pip-audit` + `npm audit` steps in `ci.yml`; ZAP API + baseline scans in `nightly.yml` | Covered (CI) |
| NFR-QUAL-01 | Schemathesis over all 50 operations: no 500s, documented status codes only, content types and bodies match the spec (`test_contract.py`); derived 401/403/404/422 docs (`test_input_hardening.py::TestSpecDocumentsErrors`) | Covered |
| NFR-PERF-01 | `backend/perf/locustfile.py` - fails the nightly job over the p95 / failure budget | Covered (nightly) |
| NFR-TEST-01 | `scripts/bug_hunt.py`: 10 injected bugs, all caught (CI `bug-hunt` job); switch safety (`test_bug_injection.py`) | Covered |
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

## Defects found by the suites during Milestone 4

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 9 | E2E (isolated price-change test) | Clicking Add while the session was still being restored put the item in the **guest** cart; it merged into the account on a later page load | Add is disabled until the session is known; the cart refuses to guess: `ProductDetailPage.test.tsx::Add waits until the session is known` |
| 10 | Same E2E test | A price change before sign-in went unflagged: merged lines recorded today's price, not the one the guest saw (CRT-03) | Merge records `price_cents_seen` for new lines (notice only, never charged): `test_cart.py::test_price_the_guest_saw_survives_sign_in` |
| 11 | Frontend unit test | Test-design defect: the fake `GET /cart` always returned an empty cart, so the refetch after a merge "lost" the items | Stateful fake API: `frontend/src/test/cartFixtures.ts::accountCartServer` |

## Defects found by the suites during Milestone 5

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 12 | **E2E last-unit race** (isolated, API) | **Oversell:** two shoppers could both buy the last unit. `SELECT ... FOR UPDATE` waited for the other checkout's lock, but SQLAlchemy returned the product objects already cached in the session (loaded with the cart) *without refreshing them*, so stale stock passed the check and an absolute value was written. | `populate_existing=True` on every locking query, and stock changes are now relative SQL (`stock_qty = stock_qty - n`) so `CHECK (stock_qty >= 0)` catches any future stale read: `isolated/checkout-state.spec.ts::two shoppers race...` (was 2/6, now 10/10) |
| 13 | Integration test | Expired orders' stock stayed invisible until someone checked out; the next shopper couldn't even add the item | Sweep runs before catalog, cart and checkout requests: `TestExpiry::test_expired_stock_is_available_to_the_next_shopper`, `isolated/checkout-state.spec.ts` (item back on sale) |
| 14 | E2E guest checkout | Checkout quoted the cart *before* the sign-in merge finished (empty cart) and never re-quoted | Quote waits for the cart and is keyed on its contents: `Checkout.test.tsx::waits for the sign-in cart merge before quoting` |
| 15 | Frontend unit test | After paying, the "already paid" redirect fired first and dropped the "Thank you" confirmation | `justPaid` redirect with `?paid=1`: `PayAndOrders.test.tsx::pays and lands on the confirmed order` |
| 16 | Integration test (test design) | "Valid 1 second before the deadline" tests were flaky: real DB latency was added on top of `travel()` | `frozen_clock` fixture; applied to every boundary test (M2 ones too) |
| 17 | E2E (test design) | Test moved an order to "processing" before the pay click had finished | Wait for "Paid" before calling the API: `checkout.spec.ts::shipped orders can no longer be cancelled` |
| 18 | E2E (isolated, intermittent) | **Shoppers signed out at random:** navigating while a silent refresh was in flight lost the rotated cookie; the next page replayed the old token and theft detection revoked the session | 30-second reuse grace for *just-rotated* tokens of a still-alive family (a logout, a password change or a real theft still revokes): `test_auth_sessions.py::test_rotated_token_reused_within_grace_is_a_benign_race`, `test_grace_never_survives_a_password_change`, `test_logged_out_token_gets_no_grace` |
| 19 | E2E (isolated, intermittent) | Test-only reset deadlocked with a request still in flight from the previous test's page | Reset retries on deadlock/lock timeout (it is all-or-nothing) |
| 20 | E2E (isolated, 1 run in 4) | Expiry sweep used `SKIP LOCKED`: a request skipped the order another sweep was expiring and read stock before that commit, showing "Out of stock" for an item back on sale | Sweep waits for the lock (Postgres re-checks the row and skips it; the next read sees the restock): `isolated/checkout-state.spec.ts::unpaid order expires...` |

## Defects found by the suites during Milestone 6

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 21 | Integration test | Lowercase SKUs were rejected instead of uppercased: Pydantic checks `pattern` *before* `to_upper` | Case-insensitive pattern; `to_upper` normalises: `test_admin.py::test_sku_is_uppercased` |
| 22 | E2E (test design) | Admin tests that created products and categories in parallel broke the catalog tests' global counts (60 products / 10 per category / 6 categories) | Catalog-changing admin tests moved to the serial `isolated` project; parallel order test asserts its own ledger row, not a shared total |
| 23 | E2E (test infrastructure) | One failed run left stray data, because Playwright **skips dependent projects** after a failure, so the isolated project's cleanup never ran; every later run started dirty | `setup` project resets the DB at the *start* of every run; all projects depend on it |
| 24 | E2E | The New-product form could be submitted before its category list loaded, sending no category | Save disabled until categories load: `isolated/admin-catalog.spec.ts::duplicate SKU...` |

## Defects found by the suites during Milestone 7

| # | Found by | Defect | Fix + regression test |
|---|---|---|---|
| 25 | Contract test (Schemathesis) | An id above 2^31-1 in a path, query or body (e.g. `/me/addresses/3796841830`) reached Postgres as an `integer` and failed "out of range" - a 500 | Ids bounded to the column range (`schemas/types.py`), 422: `test_input_hardening.py::test_out_of_range_*` |
| 26 | Contract test | A huge `page` on the admin and order lists became an OFFSET psycopg couldn't send - a 500 | `page <= 10 000` like the catalog: `test_out_of_range_numbers_are_422_not_500` |
| 27 | Contract test | A NUL byte in any text input (names, search, slugs) - Postgres text can't hold one - a 500 | Rejected at the edge for every body, query and path string: `test_nul_bytes_are_422_not_500`, `test_nul_in_a_path_is_422` |
| 28 | Contract test | A body that isn't valid UTF-8 got an undocumented 400 in FastAPI's shape | `422 invalid_body` in our shape: `test_unreadable_body_is_422` |
| 29 | Contract test | The spec listed only success + 422 (in FastAPI's `{"detail": [...]}` shape we never send): no 401/403/404/409 anywhere, so clients couldn't know them | Derived from each route's dependencies + route-specific codes, all with `ErrorResponse`: `TestSpecDocumentsErrors` |
| 30 | Contract test (test design) | Fuzzing the test-support clock endpoint moved time forward mid-run and expired the admin's token - 78 false failures | Contract app built without test endpoints (they're not part of the contract) |
