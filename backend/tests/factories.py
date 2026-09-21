"""factory_boy factories. The session is attached per test by the make_user fixture."""

import factory
from factory.alchemy import SQLAlchemyModelFactory

from app.core.security import hash_password
from app.models import Address, User, UserRole

DEFAULT_PASSWORD = "Sparkle123"


class UserFactory(SQLAlchemyModelFactory):
    class Meta:
        model = User
        sqlalchemy_session_persistence = "flush"

    class Params:
        password = DEFAULT_PASSWORD

    email = factory.Sequence(lambda n: f"user{n}@factory.test")
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    role = UserRole.CUSTOMER
    password_hash = factory.LazyAttribute(lambda o: hash_password(o.password))


class AddressFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Address
        sqlalchemy_session_persistence = "flush"

    label = "Home"
    recipient_name = factory.Faker("name")
    line1 = factory.Faker("street_address")
    city = "Austin"
    state = "TX"
    postal_code = "78701"
    is_default = False
