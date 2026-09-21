# Requirements Traceability Matrix

Each requirement ID from [BRD.md](BRD.md) maps to the automated tests that verify it.
Status: **Covered** (tests pass) · **Partial** (some aspects tested) · **Planned** (milestone).

| Req | Description | Tests | Status |
|---|---|---|---|
| ACC-01 | Email unique, case-insensitive | `backend/tests/integration/test_schema.py::test_email_unique_ignoring_case` | Partial (DB level) |
| ACC-02 | Password hashing | `backend/tests/unit/test_security.py` | Partial (hashing only) |
| ACC-03..06 | Auth, lockout, addresses, reset | - | Planned M2 |
| CAT-01..04 | Catalog, search, filter, detail | - | Planned M3 |
| CAT-05 | Stock threshold messaging | `backend/tests/unit/test_seed_data.py::test_boundary_values_present_for_stock_rules` | Partial (test data) |
| CRT-01 | Quantity 1-10 | DB check `ck_cart_items_quantity_range` | Planned M4 |
| CRT-02..04 | Cart merge, price change, no reserve | - | Planned M4 |
| CHK-01..02 | Calculation order, tax | `test_seed_data.py::test_tax_table_covers_50_states_plus_dc` | Partial (data) |
| CHK-03 | Free shipping >= $50 | `test_seed_data.py::test_boundary_values_present_for_free_shipping`, `frontend/src/__tests__/routing.test.tsx` (copy) | Partial |
| CHK-05 | Integer cents, totals add up | `test_schema.py::test_order_total_must_add_up` | Partial (DB level) |
| CHK-04, 06..08 | Stock re-check, snapshot, mock pay, idempotency | - | Planned M5 |
| ORD-01..03 | State machine, restock, audit | `test_schema.py::test_valid_order_is_accepted_with_pending_status` | Partial |
| ADM-01 | Archived products hidden | `test_schema.py::test_seeded_archived_product_exists` | Partial (data) |
| ADM-02..04 | Inventory, order admin, RBAC | - | Planned M6 |
| NFR-OPS | Health, request ID, migrations in sync | `test_health.py`, `test_schema.py::test_migrations_match_models`, `e2e/tests/api/health.spec.ts` | Covered |
| NFR-SEC | Security headers, CORS allow-list, prod guards | `test_health.py::test_security_headers`, `test_cors_*`, `tests/unit/test_config.py::TestProdGuards` | Partial |
| NFR-A11Y | WCAG 2.1 AA | `e2e/tests/a11y.spec.ts` | Covered (current pages) |
| NFR-TEST | Reset endpoint, test IDs, never in prod | `test_test_support.py`, `e2e/tests/api/health.spec.ts`, `e2e/tests/smoke.spec.ts` | Covered |
