"""Create the first platform administrator interactively after migrations."""

import argparse
from getpass import getpass

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.organization import Organization
from app.models.user import User
from app.schemas.auth import normalize_email
from app.services.authentication import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--organization-id",
        type=int,
        help="Optional existing organization for administrative contact context; platform admins retain global access.",
    )
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    email = normalize_email(args.email)
    password = getpass("New admin password (12 to 128 characters): ")
    confirmation = getpass("Confirm password: ")
    if not 12 <= len(password) <= 128:
        raise SystemExit("Password must be between 12 and 128 characters.")
    if password != confirmation:
        raise SystemExit("Passwords did not match.")

    with SessionLocal.begin() as session:
        organization = session.get(Organization, args.organization_id) if args.organization_id else None
        if args.organization_id and organization is None:
            raise SystemExit("The organization does not exist. Apply reviewed migrations and choose an existing organization.")
        if session.scalar(select(User.id).where(User.role == "platform_admin")) is not None:
            raise SystemExit("A platform administrator already exists; use an invitation from an existing administrator.")
        if session.scalar(select(User.id).where(User.email == email)) is not None:
            raise SystemExit("A user with this email already exists.")
        session.add(
            User(
                email=email,
                password_hash=hash_password(password),
                organization_id=organization.id if organization is not None else None,
                role="platform_admin",
            )
        )
    organization_label = f" for {organization.name}" if organization is not None else " with platform-wide access"
    print(f"Created the first platform administrator{organization_label}. No password was printed or stored in plaintext.")


if __name__ == "__main__":
    main()
