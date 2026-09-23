from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from typing import Optional

from .config import Settings


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@dataclass(frozen=True)
class PasswordRecord:
    salt: bytes
    digest: bytes
    n: int
    r: int
    p: int


def normalize_email(value: object) -> str:
    email = str(value or "").strip().casefold()
    if not email or len(email) > 254 or not EMAIL_RE.fullmatch(email):
        raise ValueError("invalid_email")
    local, domain = email.rsplit("@", 1)
    if len(local) > 64 or not domain:
        raise ValueError("invalid_email")
    return email


def validate_password(value: object) -> str:
    password = str(value or "")
    if len(password) < 8 or len(password) > 256:
        raise ValueError("invalid_password")
    if not any(character.isalpha() for character in password):
        raise ValueError("invalid_password")
    if not any(character.isdigit() for character in password):
        raise ValueError("invalid_password")
    return password


def _password_material(password: str, secret: bytes) -> bytes:
    # A server-side pepper makes a database-only password dump insufficient.
    return hmac.new(secret, password.encode("utf-8"), hashlib.sha256).digest()


def hash_password(
    password: str, settings: Settings, salt: Optional[bytes] = None
) -> PasswordRecord:
    actual_salt = secrets.token_bytes(16) if salt is None else salt
    max_memory = max(64 * 1024 * 1024, 256 * settings.scrypt_n * settings.scrypt_r)
    digest = hashlib.scrypt(
        _password_material(password, settings.app_secret),
        salt=actual_salt,
        n=settings.scrypt_n,
        r=settings.scrypt_r,
        p=settings.scrypt_p,
        dklen=32,
        maxmem=max_memory,
    )
    return PasswordRecord(
        salt=actual_salt,
        digest=digest,
        n=settings.scrypt_n,
        r=settings.scrypt_r,
        p=settings.scrypt_p,
    )


def verify_password(
    password: str,
    settings: Settings,
    salt: bytes,
    expected_digest: bytes,
    n: int,
    r: int,
    p: int,
) -> bool:
    max_memory = max(64 * 1024 * 1024, 256 * n * r)
    actual = hashlib.scrypt(
        _password_material(password, settings.app_secret),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=len(expected_digest),
        maxmem=max_memory,
    )
    return hmac.compare_digest(actual, expected_digest)


def opaque_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str, purpose: str, secret: bytes) -> bytes:
    return hmac.new(
        secret,
        f"{purpose}\0{token}".encode("utf-8"),
        hashlib.sha256,
    ).digest()


def rate_key_digest(value: str, secret: bytes) -> bytes:
    return hmac.new(
        secret,
        f"rate-limit\0{value}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
