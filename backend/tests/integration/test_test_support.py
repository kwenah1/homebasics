from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import get_db
from app.main import create_app
from app.models import Category, Product


def test_reset_restores_seed_data(client, db):
    # Dirty the database the way a previous E2E test might.
    pan = db.scalar(select(Product).where(Product.sku == "KIT-001"))
    pan.price_cents, pan.stock_qty = 1, 0
    db.add(Category(name="Garden", slug="garden"))
    db.flush()

    response = client.post("/api/v1/test/reset")

    assert response.status_code == 200
    assert response.json() == {
        "reset": True,
        "seeded": {"tax_rates": 51, "users": 3, "categories": 6, "products": 61},
    }
    db.expire_all()
    pan = db.scalar(select(Product).where(Product.sku == "KIT-001"))
    assert (pan.price_cents, pan.stock_qty) == (2499, 40)
    assert db.scalar(select(func.count()).select_from(Category)) == 6
    assert db.scalar(select(Category).where(Category.slug == "garden")) is None


def test_reset_endpoint_absent_when_disabled(db, test_settings):
    app = create_app(test_settings.model_copy(update={"enable_test_endpoints": False}))
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        assert c.post("/api/v1/test/reset").status_code == 404
        assert "/api/v1/test/reset" not in c.get("/api/v1/openapi.json").json()["paths"]


def test_reset_endpoint_absent_in_prod(db, test_settings):
    prod = test_settings.model_copy(update={"environment": "prod"})  # bypasses validators
    app = create_app(prod)
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        assert c.post("/api/v1/test/reset").status_code == 404
