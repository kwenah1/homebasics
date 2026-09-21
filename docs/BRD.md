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

### Catalog (CAT)
- **CAT-01** Paginated product list (20/page), filter by category.
- **CAT-02** Keyword search over name + description.
- **CAT-03** Filter by price range and in-stock only; sort by price, newest, rating.
- **CAT-04** Product detail: images, price, stock status, reviews.
- **CAT-05** Stock <= 5 shows "Only X left"; stock 0 shows "Out of stock" and disables Add.

### Cart (CRT)
- **CRT-01** Add/update/remove. Quantity per line 1-10 and never above available stock.
- **CRT-02** Guest cart in localStorage; merges into account cart on login (quantities summed,
  then capped by CRT-01).
- **CRT-03** Cart always shows current price; notice shown if price changed since adding.
- **CRT-04** Adding to cart does not reserve stock.

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
| Performance | k6 | Catalog, search, checkout load |
| Security | OWASP ZAP baseline, Bandit (ruff `S`), pip-audit, npm audit | |
| Reporting | JUnit XML, Playwright HTML, coverage (target 90% services) | |

Traceability: see [traceability.md](traceability.md).

## 9. Milestones

1. Foundation - repo, CI, DB + migrations, seed data, test harness **(done)**
2. Accounts & auth
3. Catalog & search
4. Cart & guest-merge
5. Checkout, pricing, mock payments, order state machine
6. Admin
7. Test hardening - contract, perf, security, bug-injection mode
8. Phase 2 features
