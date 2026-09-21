"""ACC-02 password policy - boundary values and equivalence classes."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.security import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    hash_password,
    password_problems,
    verify_password,
)


@pytest.mark.parametrize(
    "password",
    [
        "abcdefg1",  # exactly 8 (min boundary)
        "A" * 63 + "1",  # exactly 64 (max boundary)
        "Sparkle123",
        "pässwörd1",  # non-ASCII allowed (it still has ASCII letters p, s, w, r, d)
        "1234567a",
        "with spaces 1",
    ],
)
def test_valid_passwords(password):
    assert password_problems(password) == []


@pytest.mark.parametrize(
    ("password", "problem"),
    [
        ("abcdef1", "at least 8 characters"),  # 7 - just below min
        ("", "at least 8 characters"),
        ("A" * 64 + "1", "at most 64 characters"),  # 65 - just above max
        ("abcdefgh", "at least one number"),
        ("12345678", "at least one letter"),
        ("!!!!!!!!", "at least one letter"),
    ],
)
def test_invalid_passwords(password, problem):
    assert problem in password_problems(password)


def test_all_problems_reported_at_once():
    assert password_problems("!!") == [
        "at least 8 characters",
        "at least one letter",
        "at least one number",
    ]


def test_multibyte_password_over_bcrypt_limit_rejected():
    """40 chars but 80 UTF-8 bytes: bcrypt would truncate it, so the policy refuses it."""
    password = "é" * 39 + "1"
    assert len(password) <= PASSWORD_MAX
    assert "at most 64 characters" in password_problems(password)


def test_only_ascii_letters_satisfy_letter_rule():
    assert "at least one letter" in password_problems("ééééééé1")


def test_verify_rejects_overlong_input_without_error():
    assert verify_password("a1" * 50, hash_password("Sparkle123")) is False


@given(st.text(min_size=PASSWORD_MIN, max_size=PASSWORD_MAX, alphabet="abcXYZ0123456789!@# "))
def test_property_policy_matches_definition(password):
    """Property-based: problems list is empty iff it has an ASCII letter and a digit."""
    has_letter = any(c.isascii() and c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    assert (password_problems(password) == []) == (has_letter and has_digit)
