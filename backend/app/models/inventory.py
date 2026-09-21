from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import InventoryReason, db_enum


class InventoryMovement(Base):
    """ADM-02 / ORD-01: every stock change is an append-only ledger row."""

    __tablename__ = "inventory_movements"
    __table_args__ = (CheckConstraint("delta <> 0", name="delta_non_zero"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True, nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[InventoryReason] = mapped_column(db_enum(InventoryReason), nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
