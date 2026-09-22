from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import get_settings
from app.core import clock
from app.core.errors import AppError
from app.core.tokens import ALGORITHM, create_access_token, decode_access_token


class TestClock:
    def test_tracks_real_time_by_default(self):
        assert abs((clock.now() - datetime.now(UTC)).total_seconds()) < 1

    def test_advance_moves_forward(self):
        before = clock.now()
        clock.advance(timedelta(minutes=15))
        assert clock.now() - before >= timedelta(minutes=15)

    def test_freeze_stops_time_and_advance_still_works(self):
        frozen = clock.freeze(datetime(2030, 1, 1, tzinfo=UTC))
        assert clock.now() == frozen
        clock.advance(timedelta(seconds=30))
        assert clock.now() == datetime(2030, 1, 1, 0, 0, 30, tzinfo=UTC)

    def test_reset_returns_to_real_time(self):
        clock.advance(timedelta(days=3))
        clock.reset()
        assert clock.state()["offset_seconds"] == 0
        assert clock.state()["frozen"] is False


class TestAccessTokens:
    def test_round_trip(self):
        token, lifetime = create_access_token(42, "customer")
        claims = decode_access_token(token)
        assert (claims.user_id, claims.role) == (42, "customer")
        assert lifetime == 15 * 60

    def test_valid_one_second_before_expiry(self, frozen_clock):
        token, _ = create_access_token(1, "customer")
        clock.advance(timedelta(minutes=15) - timedelta(seconds=1))
        assert decode_access_token(token).user_id == 1

    def test_expired_at_fifteen_minutes(self, frozen_clock):
        token, _ = create_access_token(1, "customer")
        clock.advance(timedelta(minutes=15))
        with pytest.raises(AppError) as exc:
            decode_access_token(token)
        assert exc.value.code == "token_expired"

    def test_token_minted_while_clock_is_ahead_is_valid(self):
        """Regression (found by E2E): pyjwt rejected iat 'in the future' vs the real clock."""
        clock.advance(timedelta(minutes=16))
        token, _ = create_access_token(7, "customer")
        assert decode_access_token(token).user_id == 7

    @pytest.mark.parametrize(
        "token",
        [
            "not-a-jwt",
            "",
            jwt.encode(
                {"sub": "1", "type": "access", "exp": 9999999999},
                "a-different-secret-that-is-long-enough-00",
            ),
        ],
        ids=["garbage", "empty", "wrong-signature"],
    )
    def test_invalid_tokens(self, token):
        with pytest.raises(AppError) as exc:
            decode_access_token(token)
        assert exc.value.code == "invalid_token"

    def test_refresh_type_token_not_accepted_as_access(self):
        token = jwt.encode(
            {"sub": "1", "type": "refresh", "exp": 9999999999},
            get_settings().jwt_secret,
            algorithm=ALGORITHM,
        )
        with pytest.raises(AppError, match="Invalid access token"):
            decode_access_token(token)

    def test_alg_none_rejected(self):
        """Classic JWT attack: unsigned token with alg=none."""
        token = jwt.encode({"sub": "1", "type": "access", "exp": 9999999999}, "", algorithm=None)
        with pytest.raises(AppError):
            decode_access_token(token)
