"""Shared input types.

Found by the contract test: an id above 2^31-1 in a path (e.g. /me/addresses/3796841830)
reached Postgres as an int4 parameter, failed with "integer out of range" and came back as a
500. Every id that enters the API is now bounded to the column's range, so it's a 422.
"""

from typing import Annotated

from fastapi import Path, Query
from pydantic import Field

INT4_MAX = 2_147_483_647  # our primary keys are Postgres `integer`

DbId = Annotated[int, Field(ge=1, le=INT4_MAX)]
PathId = Annotated[int, Path(ge=1, le=INT4_MAX)]
QueryId = Annotated[int | None, Query(ge=1, le=INT4_MAX)]
