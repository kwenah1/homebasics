"""Known, deliberate defects that can be switched on to prove the test suite catches them
(hand-picked mutation testing). Enabled with BUG_INJECTION=name1,name2 - never in prod.

Each entry is a realistic mistake a developer could make, mapped to the business rule it
breaks. `scripts/bug_hunt.py` turns them on one at a time and checks the suite goes red.
"""

KNOWN_BUGS: dict[str, str] = {
    "free_shipping_off_by_one": "CHK-03: standard shipping only free ABOVE $50.00 (> not >=)",
    "tax_rounds_per_line": "CHK-05: tax rounded on each line instead of once per order",
    "tax_on_shipping": "CHK-02: tax charged on shipping too",
    "cart_allows_eleven": "CRT-01: a cart line may hold 11",
    "low_stock_threshold_off_by_one": "CAT-05: 5 left shows as plain 'in stock'",
    "search_wildcards_unescaped": "CAT-02: '%' and '_' act as SQL wildcards",
    "archived_products_listed": "ADM-01: archived products appear in the storefront list",
    "lockout_after_six": "ACC-04: account locks on the 6th failure instead of the 5th",
    "stock_not_restored_on_cancel": "ORD-01: cancelling an order doesn't return its stock",
    "idempotency_ignored": "CHK-08: place-order ignores the Idempotency-Key",
}
