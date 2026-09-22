# HomeBasics - Business Requirements (v1.0, approved 2026-09-21)

Everyday household-goods store (kitchen, cleaning, bath, laundry, storage, paper goods),
built as a realistic system-under-test for SDET practice across every testing layer.

## Decisions (approved)

| Topic | Decision |
|---|---|
| E2E language | Playwright + **TypeScript** |
| Payments | **Mock gateway** (deterministic test cards); Stripe test mode in Phase 3 |
| Database | **Neon Postgres** for dev (`neondb`) and tests (`homebasics_test`); Postgres 17 service in CI |
| Location | `C:\Users\kwena\Projects\Claude_Work_Project\HomeBasics` |
| Business rules | As written below |

## 1. Scope

| Phase | Includes |
|---|---|
| MVP | Catalog, search/filter, cart, accounts, checkout (mock pay), order history, basic admin |
| Phase 2 | Coupons, reviews, wishlist, returns/refunds, order emails, low-stock alerts |
| Phase 3 | Stripe test mode, recommendations, admin dashboard, deployment |
| Out | Real payments, multi-vendor, international shipping, multi-currency |

## 2. Roles

- **Guest** - browse, search, cart. Must log in/register to check out.
- **Customer** - + checkout, order history, cancel, reviews, wishlist, profile/addresses.
- **Admin** - product/category CRUD, inventory, order status, refunds, coupons.

## 3. Functional requirements

### Accounts (ACC)
- **ACC-01** Register with email, password, first/last name. Email unique, case-insensitive.
- **ACC-02** Password >= 8 chars with >= 1 letter and >= 1 number; stored bcrypt-hashed.
- **ACC-03** JWT login/logout: 15-min access token, 7-day refresh token.
- **ACC-04** 5 failed logins lock the account for 15 minutes.
- **ACC-05** Profile edit; up to 5 saved addresses, one default.
- **ACC-06** Password reset via emailed token, valid 30 minutes.

#### Account rules clarified during Milestone 2
- **ACC-02a** Passwords are at most 64 characters (and at most 72 UTF-8 bytes, bcrypt's limit).
  "Letter" means an ASCII letter A-Z/a-z.
- **ACC-03a** The access token is kept in memory only. The refresh token is an opaque value in an
  `httpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth`, and it rotates on every use.
  Replaying an already-rotated refresh token revokes that whole login "family" (theft
  detection).
- **ACC-03b** A just-rotated refresh token presented again within 30 s (the navigation aborted the
  response, or two tabs refreshed together) gets a new token in the same family instead of
  triggering theft detection. This applies only while the family is alive: a logout, a password change or
  reset, or a detected theft still ends the session. After 30 s, reuse revokes the family.
- **ACC-04a** Failures 1-4 return 401 `invalid_credentials`. The **5th** failure returns 423
  `account_locked` with `Retry-After`. While locked, even the correct password gets 423. When the lock
  expires the counter restarts at 0, and a successful login also resets it.
- **ACC-04b** No account enumeration: unknown email and wrong password give an identical 401
  (and take the same bcrypt time); forgot-password always answers 202.
- **ACC-05a** Only names are editable on the profile; unknown fields such as `email` or `role` are rejected
  with 422 (no mass assignment). The first address is automatically the default. Deleting the
  default promotes the oldest remaining address. Another user's address returns 404.
- **ACC-05b** Changing the password signs out every session and issues this device a fresh one.
- **ACC-06a** Using a reset link also invalidates the user's other outstanding links, signs out
  every session, and clears any lockout.

### Catalog (CAT)
- **CAT-01** Paginated product list (20/page), filter by category.
- **CAT-02** Keyword search over name + description.
- **CAT-03** Filter by price range and in-stock only; sort by price, newest, rating.
- **CAT-04** Product detail: images, price, stock status, reviews.
- **CAT-05** Stock <= 5 shows "Only X left"; stock 0 shows "Out of stock" and disables Add.

#### Catalog rules clarified during Milestone 3
- **CAT-01a** Page size defaults to 20 (1-50 allowed). A page past the end returns an empty list
  with the real `total`, not an error. Every sort ends with a unique tie-breaker (id), so
  walking all pages returns each product exactly once.
- **CAT-02a** Keywords are split on whitespace (max 8) and **all** must appear, case-insensitively,
  somewhere in name + description. `%`, `_` and `\` are literal characters, not wildcards.
- **CAT-03a** Prices are filtered in cents with **inclusive** bounds; min > max is a 422. Sorts:
  name, price ↑, price ↓, newest, rating. Rating sorts unrated products last, then by more
  reviews. Unknown query parameters are rejected with 422.
- **CAT-05a** The API never exposes exact stock for well-stocked items: `stock_status` is
  `in_stock` / `low_stock` / `out_of_stock`, and `stock_left` is a number only when 1-5.
  `max_order_qty` = min(10, stock).
- **CAT-06** Ratings (`rating_avg`, `rating_count`) are stored on products so rating sort works
  now. Seed values are deterministic; Phase 2 reviews (REV) will maintain them.
- **CAT-07** The storefront URL holds the list state (`?q=&min=&max=&in_stock=1&sort=&page=`,
  prices in dollars), so every view can be shared, reloaded and reached with Back. Malformed
  values are ignored rather than breaking the page.

### Cart (CRT)
- **CRT-01** Add/update/remove. Quantity per line 1-10 and never above available stock.
- **CRT-02** Guest cart in localStorage; merges into account cart on login (quantities summed,
  then capped by CRT-01).
- **CRT-03** Cart always shows current price; notice shown if price changed since adding.
- **CRT-04** Adding to cart does not reserve stock.

#### Cart rules clarified during Milestone 4
- **CRT-01a** Adding more than a line allows (the smaller of 10 and current stock) is **refused** with
  409 `quantity_limit` plus `max_quantity` and `in_cart`. The cart never silently trims. Setting a
  quantity above stock returns 409 `insufficient_stock` with `available`. Clients can never
  send a price.
- **CRT-02a** Guest cart (browser storage) holds at most 50 lines and is validated and repaired on every
  read. Merge: duplicate lines are summed, then capped. A merge never *reduces* a line the account
  already had. Archived, unknown and out-of-stock items are skipped. The response reports every
  `capped` and `skipped` line. The browser clears its copy only after a successful merge, so a
  failure loses nothing and a retry can't double-count.
- **CRT-03a** Each line records the price at the time it was added (for guests, the price they
  saw, including across sign-in). The cart shows rises and drops; "OK, got it" accepts them.
  Totals always use today's price.
- **CRT-04a** No stock is held. Every cart read re-checks each line and flags it `unavailable`,
  `out_of_stock` or `insufficient_stock` (with `available`). Flagged lines are left out of the subtotal,
  and checkout (M5) is blocked while any flag remains.
- **CRT-05** The cart shows a free-shipping estimate: the amount still needed to reach $50.00
  (CHK-03). Checkout makes the final decision.
- **CRT-06** Concurrent cart requests for the same shopper are applied one at a time
  (per-user row lock). Double clicks or two tabs can never exceed the limits or cause errors.

### Checkout & pricing (CHK)
- **CHK-01** Calculation order: subtotal -> discount -> tax -> shipping -> total.
- **CHK-02** Tax = flat rate per ship-to state (table), applied to discounted subtotal, never to
  shipping. TX = 8.25%.
- **CHK-03** Standard shipping free when discounted subtotal >= $50.00, else $5.99.
  Express always $14.99.
- **CHK-04** Stock re-validated at order placement; reject with per-line messages if short.
- **CHK-05** Money stored as integer cents; tax rounded once, half-up.
- **CHK-06** Orders snapshot product name, SKU and unit price at placement.
- **CHK-07** Mock gateway: `4242 4242 4242 4242` succeeds; `4000 0000 0000 0002` declined;
  `4000 0000 0000 9995` insufficient funds.
- **CHK-08** Payments carry an idempotency key; a double-submit never double-charges.

#### Checkout rules clarified during Milestone 5
- **CHK-01a** Checkout ships to a saved address (address book, ACC-05). The tax rate is the ship-to
  state's rate. The quote endpoint prices the account cart without changing anything.
- **CHK-05a** Tax = round-half-up(discounted subtotal × rate), computed **once on the order**
  (not per line). Example: 3 × $0.10 at 5% is $0.02, not $0.03.
- **CHK-04a** Place order locks the products **in product-id order** (so there are no deadlocks)
  and re-checks every line. It returns 409 `cart_has_issues` listing *each* problem line (`issue`,
  `requested`, `available`).
- **CHK-08a** `POST /checkout/place-order` and `POST /orders/{no}/pay` require an
  `Idempotency-Key` header (8-48 chars, scoped per shopper). Repeating a key returns the original
  outcome (header `Idempotent-Replayed: true`) and never acts twice. Reusing a key with a different
  request returns 422 `idempotency_key_reused`. Clients keep the key when they got no answer or a 5xx,
  and make a new one after a definitive 4xx.
- **CHK-09** Place order requires the `expected_total_cents` the shopper saw. If the total changed
  (a price or stock change), it returns 409 `total_changed` and places nothing, so a shopper is never
  charged a total they didn't see.
- **CHK-07a** The mock gateway refuses all non-test cards (`test_cards_only`). It checks Luhn and
  expiry (valid through the end of the month, judged by the app clock). Only the last 4 digits are
  stored or returned. A decline returns HTTP 402, the order stays payable, and a retry uses a new key.
- **ORD-01a** Expiry is enforced by a sweep that runs before every catalog, cart, checkout and
  order request (plus `/test/expire-orders`), so stock from abandoned orders is visible again
  right away. A production deployment would also schedule it.
- **ORD-02a** Who may move an order: customer = cancel (before shipped); system = paid,
  expired; admin = processing, shipped, delivered, refunded, cancel. Cancelling a paid order
  records a `refunded` payment.

### Orders (ORD)

```
PENDING_PAYMENT --pay--> PAID --> PROCESSING --> SHIPPED --> DELIVERED
      | 30-min timeout (restock)   |                           |
      v                            v                           v
   EXPIRED          CANCELLED (customer, before SHIPPED)   REFUNDED (admin)
```

- **ORD-01** Stock decremented at placement; restored on EXPIRED or CANCELLED.
- **ORD-02** Illegal transitions (skipping or going backwards) return 409 Conflict.
- **ORD-03** Every transition is logged with actor and timestamp.

### Phase 2 rules
- **CPN** Coupons: percent or fixed; min spend, expiry, total and per-user usage limits;
  one per order; total never below $0.
- **REV** Only customers with a DELIVERED order of the product may review; one per
  product per user; rating 1-5.
- **RET** Returns within 30 days of delivery; refund to original payment.

### Admin (ADM)
- **ADM-01** Product/category CRUD; archive (hidden from store, kept on orders).
- **ADM-02** Stock adjustments recorded with a reason code.
- **ADM-03** Order list with filters; advance status.
- **ADM-04** Role-based guards on all admin endpoints; customers get 403.

#### Admin rules clarified during Milestone 6
- **ADM-01a** Products are never hard-deleted, because orders refer to them; they are archived instead. SKUs
  (letters, numbers and one dash, stored uppercase) and names are unique. The URL slug is set
  from the name once and **never changes**, so links keep working after a rename. The price is from
  $0.01 to $10,000. SKU and stock cannot be edited on the product form.
- **ADM-01b** Categories can be renamed (the slug stays the same) and deleted only when they hold no
  products (409 `category_not_empty`). Names are unique regardless of case.
- **ADM-02a** Stock changes only through adjustments with a reason: `restock` (must add), `damaged`
  (must remove), or `adjustment` (either). Stock never goes below 0 (409). Every change, including
  orders, cancellations and expiries, writes a ledger row with who made it and which order it belongs to.
  **Invariant:** the sum of a product's ledger rows always equals its stock.
- **ADM-03a** Admins may move orders to processing, shipped and delivered, cancel them before they ship (stock
  goes back and a paid order is refunded), and refund delivered orders (the goods are not restocked;
  returns come in Phase 2). They cannot set system statuses (paid, expired). An optional note goes
  into the order history, which the customer can see.
- **ADM-04a** One guard covers the whole `/api/v1/admin` router. Tests read the routes from the
  OpenAPI spec and check anonymous (401), customer (403) and admin access for every one, so new
  routes can't be left unprotected.
## 4. Non-functional requirements

- **NFR-PERF** p95 < 300 ms for product list/search at 50 concurrent users.
- **NFR-SEC** OWASP Top 10: rate-limited auth, Pydantic validation everywhere, CORS allow-list,
  security headers, secrets only in environment/.env.
- **NFR-A11Y** WCAG 2.1 AA, enforced by axe in E2E.
- **NFR-OPS** Alembic migrations; request ID on every request/response; structured logs.
- **NFR-TEST** Testability hooks:
  - `data-testid` on interactive elements
  - `/api/v1/test/reset` (+ seed) when `ENABLE_TEST_ENDPOINTS=true`; impossible in prod
  - OpenAPI spec at `/api/v1/openapi.json` for contract tests
  - Controllable clock for time-based rules (expiry, lockout, coupons)
  - Optional bug-injection flags to prove the suites catch regressions

Clarifications (M7):

- **NFR-SEC-01** Per-client (IP) sliding-window limits on auth: login 10/min, register 5/10 min,
  forgot-password 5/15 min, reset-password 10/15 min, refresh 30/min. Over the limit: `429
  rate_limited` with `Retry-After`. Blocked attempts don't extend the window. On automatically in
  prod and can't be switched off there; off by default in dev/test (the E2E suite signs in hundreds
  of times from one address), where tests switch it on. In-memory, so one process only - several
  instances would need a shared store (Redis); recorded as a known limit.
- **NFR-SEC-02** No input can cause a 500: ids are bounded to the database's integer range, page
  numbers to 10 000, and NUL bytes are rejected in every string (body, query and path) - all 422.
  A body that can't be decoded is `422 invalid_body`.
- **NFR-SEC-03** Known-vulnerability audits (`pip-audit`, `npm audit --omit=dev`, high and above)
  fail CI. A nightly OWASP ZAP scan covers the API (from its OpenAPI spec) and the web app.
- **NFR-QUAL-01** The OpenAPI spec is the contract. Every route documents the errors it can return
  (401 if it needs a session, 403 if admin-only, 404 for path lookups, 422 for input, plus its own
  business codes), all with the one error shape. Schemathesis fuzzes every operation and fails on
  a 500, an undocumented status or a body that doesn't match its schema.
- **NFR-PERF-01** Locust (Python, like the rest of the backend) replaces k6: 50 users browsing,
  filtering and searching for 2 minutes; p95 under 300 ms per endpoint and under 1% failures, or the
  nightly job fails. Warm-up requests are reported but not held to the budget.
- **NFR-TEST-01** Bug injection: `BUG_INJECTION=name,...` switches on known, realistic defects
  (catalogue in `app/core/bug_catalog.py`, each tied to the rule it breaks). `scripts/bug_hunt.py`
  switches each on in turn and fails if the tests stay green; CI runs it on every PR. Unknown names
  are rejected at startup, and prod refuses any.

## 5. Architecture

React 19 + TypeScript + Vite + React Router + TanStack Query + Tailwind 4
-> `/api/v1` (Vite dev proxy) -> FastAPI (routers -> services -> repositories)
-> SQLAlchemy 2 -> PostgreSQL. Pricing, tax, shipping and the order state machine live in
pure-function service modules so they can be unit/property-tested without a database.

## 6. Data model

`users`, `addresses`, `categories`, `products`, `product_images`, `inventory_movements`,
`carts`, `cart_items`, `orders`, `order_items`, `payments`, `order_status_history`, `tax_rates`.
Phase 2 adds `coupons`, `coupon_redemptions`, `reviews`, `wishlist_items`, `returns`.

## 7. API outline (`/api/v1`)

- `auth/register | login | refresh | logout | forgot-password | reset-password`
- `products`, `products/{id}`, `categories`
- `cart`, `cart/items`, `cart/merge`
- `checkout/quote`, `checkout/place-order`, `payments/{order_id}`
- `orders`, `orders/{id}`, `orders/{id}/cancel`
- `admin/products`, `admin/inventory`, `admin/orders/{id}/status`, `admin/orders/{id}/refund`

## 8. Test strategy

| Layer | Tools | Focus |
|---|---|---|
| Unit (BE) | pytest, hypothesis | Pricing/tax/shipping/state machine, property-based invariants |
| Integration (BE) | pytest, httpx TestClient, real Postgres, factory_boy | Endpoints, DB constraints, auth guards, concurrency |
| Contract | Schemathesis | Fuzz every endpoint from the OpenAPI spec |
| Unit/component (FE) | Vitest, Testing Library, MSW | Components, forms, API states |
| E2E | Playwright (TS), Page Object Model, fixtures | Critical journeys, desktop + mobile |
| Accessibility | @axe-core/playwright | WCAG 2.1 AA per page |
| Performance | Locust | Catalog browsing and search, p95 budget (nightly) |
| Security | OWASP ZAP (API + web, nightly), Bandit (ruff `S`), pip-audit, npm audit | |
| Test effectiveness | Bug injection + `scripts/bug_hunt.py` | Every known bug must turn the suite red |
| Reporting | JUnit XML, Playwright HTML, coverage (target 90% services) | |

Traceability: see [traceability.md](traceability.md).

## 9. Milestones

1. Foundation - repo, CI, DB + migrations, seed data, test harness **(done)**
2. Accounts & auth **(done)** - rate limiting on auth endpoints added in M7 (NFR-SEC-01)
3. Catalog & search **(done)** - performance budget (NFR-PERF) measured with Locust in M7
4. Cart & guest-merge **(done)**
5. Checkout, pricing, mock payments, order state machine **(done)**
6. Admin **(done)** - test-only product/order shortcuts retired
7. Test hardening - contract, perf, security, bug-injection mode **(done)**
8. Phase 2 features
