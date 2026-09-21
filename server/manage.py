from __future__ import annotations

import argparse
import getpass
import uuid
import sys

from .config import Settings
from .database import Database, DuplicateEmailError
from .mailer import mailer_from_settings
from .security import hash_password, normalize_email, opaque_token, validate_password


def migrate(database: Database) -> int:
    if not database.healthcheck():
        print("Database healthcheck failed", file=sys.stderr)
        return 1
    print("Authentication database is initialized.")
    return 0


def create_user(settings: Settings, database: Database, email_value: str) -> int:
    try:
        email = normalize_email(email_value)
    except ValueError:
        print("Invalid email address.", file=sys.stderr)
        return 2
    first = getpass.getpass("Password: ")
    second = getpass.getpass("Repeat password: ")
    if first != second:
        print("Passwords do not match.", file=sys.stderr)
        return 2
    try:
        password = validate_password(first)
    except ValueError:
        print(
            "Password must contain 8-256 characters, a letter and a digit.",
            file=sys.stderr,
        )
        return 2
    record = hash_password(password, settings)
    try:
        user = database.create_user(email, record)
    except DuplicateEmailError:
        print("A user with this email already exists.", file=sys.stderr)
        return 3
    print(f"Created user {user['id']} ({user['email']}).")
    return 0


def reserve_user(
    settings: Settings,
    database: Database,
    email_value: str,
    user_id_value: str | None,
) -> int:
    """Reserve an imported email until its owner completes password recovery."""
    try:
        email = normalize_email(email_value)
    except ValueError:
        print("Invalid email address.", file=sys.stderr)
        return 2
    user_id = None
    if user_id_value:
        try:
            user_id = str(uuid.UUID(user_id_value))
        except ValueError:
            print("User id must be a valid UUID.", file=sys.stderr)
            return 2
    # No operator or log ever learns a usable password. The row stays blocked
    # from login until email ownership is proven by the reset flow.
    record = hash_password(f"{opaque_token()}A1", settings)
    try:
        user = database.create_user(
            email,
            record,
            user_id=user_id,
            verified=False,
        )
    except DuplicateEmailError:
        print("A user with this email already exists.", file=sys.stderr)
        return 3
    print(
        f"Reserved user {user['id']} ({user['email']}); "
        "the owner must use password recovery."
    )
    return 0


def smtp_check(settings: Settings) -> int:
    mailer = mailer_from_settings(settings)
    try:
        if not mailer.enabled:
            print("SMTP is not configured.", file=sys.stderr)
            return 4
        if not mailer.check_connection():
            print("SMTP connection/authentication check failed.", file=sys.stderr)
            return 5
        print("SMTP connection/authentication check succeeded.")
        return 0
    finally:
        mailer.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Admin utilities for the Helpinrus auth database"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("migrate", help="Initialize or upgrade the database")
    subparsers.add_parser(
        "smtp-check",
        help="Check SMTP connection, TLS, and authentication without sending mail",
    )
    create = subparsers.add_parser(
        "create-user", help="Create one user with an interactively entered password"
    )
    create.add_argument("--email", required=True)
    reserve = subparsers.add_parser(
        "reserve-user",
        help="Reserve an imported email; ownership is proven through password recovery",
    )
    reserve.add_argument("--email", required=True)
    reserve.add_argument("--id")
    args = parser.parse_args()

    settings = Settings.from_env()
    if args.command == "smtp-check":
        return smtp_check(settings)
    database = Database(settings.database_path)
    if args.command == "migrate":
        return migrate(database)
    if args.command == "reserve-user":
        return reserve_user(settings, database, args.email, args.id)
    return create_user(settings, database, args.email)


if __name__ == "__main__":
    raise SystemExit(main())
