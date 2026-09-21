"""catalog ratings and search index

Revision ID: a646495bbdbc
Revises: 4323f6abee26
Create Date: 2026-09-21 13:57:53.011369

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a646495bbdbc'
down_revision: Union[str, Sequence[str], None] = '4323f6abee26'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Hand edits: the extension, the server default (existing rows) and the CHECK
    # constraints are not produced by autogenerate.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.add_column('products', sa.Column('rating_avg', sa.Numeric(precision=2, scale=1), nullable=True))
    op.add_column('products', sa.Column('rating_count', sa.Integer(), server_default='0', nullable=False))
    op.create_check_constraint(
        op.f('ck_products_rating_count_non_negative'), 'products', 'rating_count >= 0'
    )
    op.create_check_constraint(
        op.f('ck_products_rating_consistent'),
        'products',
        "(rating_count = 0 AND rating_avg IS NULL) OR "
        "(rating_count > 0 AND rating_avg BETWEEN 1 AND 5)",
    )
    op.create_index('ix_products_search_trgm', 'products', [sa.literal_column("(name || ' ' || description) gin_trgm_ops")], unique=False, postgresql_using='gin')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_products_search_trgm', table_name='products', postgresql_using='gin')
    op.drop_constraint(op.f('ck_products_rating_consistent'), 'products', type_='check')
    op.drop_constraint(op.f('ck_products_rating_count_non_negative'), 'products', type_='check')
    op.drop_column('products', 'rating_count')
    op.drop_column('products', 'rating_avg')
    # ### end Alembic commands ###
