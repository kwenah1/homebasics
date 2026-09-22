"""NFR-PERF load test: catalog browsing and search must keep p95 under 300 ms.

Against a local API (seeded):
    locust -f perf/locustfile.py --host http://localhost:8010 --headless -u 50 -r 10 -t 2m

The run fails (exit code 1) if any tracked endpoint's p95 is over budget or more than 1% of
requests fail - so it can gate a nightly CI job, not just print a report.
Read-only on purpose: it never buys anything, so it's safe against any seeded database.
"""

import random

from locust import HttpUser, between, events, task

P95_BUDGET_MS = 300
MAX_FAIL_RATIO = 0.01
SEARCH_TERMS = ["towel", "soap", "sponge", "glass", "mug", "candle", "spray", "brush"]
SORTS = ["name", "price_asc", "price_desc", "newest", "rating"]
SETUP = "[setup]"  # warm-up requests while users start: reported, but not held to the budget


class Shopper(HttpUser):
    wait_time = between(0.5, 2)
    slugs: list[str] = []
    categories: list[str] = []

    def on_start(self) -> None:
        if not Shopper.categories:
            Shopper.categories = [
                c["slug"] for c in self.client.get("/api/v1/categories", name=SETUP).json()
            ]
        if not Shopper.slugs:
            page = self.client.get("/api/v1/products", params={"page_size": 48}, name=SETUP)
            page = page.json()
            Shopper.slugs = [p["slug"] for p in page["items"]]

    @task(4)
    def browse(self) -> None:
        params = {"sort": random.choice(SORTS), "page": random.randint(1, 3)}
        if Shopper.categories and random.random() < 0.6:
            params["category"] = random.choice(Shopper.categories)
        self.client.get("/api/v1/products", params=params, name="/products")

    @task(3)
    def search(self) -> None:
        self.client.get(
            "/api/v1/products", params={"q": random.choice(SEARCH_TERMS)}, name="/products?q"
        )

    @task(2)
    def product(self) -> None:
        if Shopper.slugs:
            self.client.get(
                f"/api/v1/products/{random.choice(Shopper.slugs)}", name="/products/:slug"
            )

    @task(1)
    def categories_list(self) -> None:
        self.client.get("/api/v1/categories")


@events.quitting.add_listener
def enforce_budget(environment, **_kwargs) -> None:
    stats = environment.stats
    problems = []
    for entry in stats.entries.values():
        p95 = entry.get_response_time_percentile(0.95)
        if entry.name != SETUP and entry.num_requests and p95 > P95_BUDGET_MS:
            problems.append(f"{entry.name}: p95 {p95:.0f} ms > {P95_BUDGET_MS} ms")
    if stats.total.fail_ratio > MAX_FAIL_RATIO:
        problems.append(f"failure ratio {stats.total.fail_ratio:.2%} > {MAX_FAIL_RATIO:.0%}")
    for problem in problems:
        print(f"PERF BUDGET: {problem}")
    if problems:
        environment.process_exit_code = 1
