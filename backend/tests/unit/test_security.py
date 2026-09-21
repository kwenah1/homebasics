from app.core.security import hash_password, verify_password


def test_hash_is_not_plaintext_and_verifies():
    hashed = hash_password("Customer123")
    assert hashed != "Customer123"
    assert hashed.startswith("$2")
    assert verify_password("Customer123", hashed)


def test_wrong_password_fails():
    assert not verify_password("customer123", hash_password("Customer123"))


def test_same_password_hashes_differently():
    assert hash_password("Customer123") != hash_password("Customer123")
