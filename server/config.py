from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Tuple
from urllib.parse import urlsplit


def _positive_int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _boolean(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


def _origin(value: str, name: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{name} must be an absolute http(s) origin")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f"{name} must contain only scheme and host")
    if parsed.path not in {"", "/"}:
        raise ValueError(f"{name} must not contain a path")
    return f"{parsed.scheme}://{parsed.netloc}"


@dataclass(frozen=True)
class Settings:
    database_path: Path
    public_origin: str
    allowed_origins: Tuple[str, ...]
    app_secret: bytes
    bind_host: str = "127.0.0.1"
    bind_port: int = 8787
    secure_cookie: bool = True
    session_cookie_name: str = "__Host-pomogay_session"
    session_ttl_seconds: int = 30 * 24 * 60 * 60
    signup_ttl_seconds: int = 24 * 60 * 60
    reset_ttl_seconds: int = 30 * 60
    scrypt_n: int = 1 << 15
    scrypt_r: int = 8
    scrypt_p: int = 1
    request_body_limit: int = 16 * 1024
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_mode: str = "starttls"
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_timeout_seconds: int = 15

    def __post_init__(self) -> None:
        if len(self.app_secret) < 32:
            raise ValueError("APP_SECRET must be at least 32 bytes")
        if not self.allowed_origins:
            raise ValueError("At least one allowed origin is required")
        if self.scrypt_n < 2 or self.scrypt_n & (self.scrypt_n - 1):
            raise ValueError("SCRYPT_N must be a power of two")
        if self.scrypt_r <= 0 or self.scrypt_p <= 0:
            raise ValueError("SCRYPT_R and SCRYPT_P must be positive")
        if self.smtp_mode not in {"starttls", "ssl", "plain"}:
            raise ValueError("SMTP_MODE must be starttls, ssl, or plain")
        if bool(self.smtp_username) != bool(self.smtp_password):
            raise ValueError(
                "SMTP_USERNAME and SMTP_PASSWORD must be configured together"
            )
        if self.secure_cookie and not self.session_cookie_name.startswith("__Host-"):
            raise ValueError("Secure production cookie must use the __Host- prefix")
        if not self.secure_cookie and self.session_cookie_name.startswith("__Host-"):
            raise ValueError("__Host- cookies require COOKIE_SECURE=true")

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        values = os.environ if env is None else env
        environment = values.get("HELPINRUS_ENV", "production").strip().lower()
        public_origin = _origin(
            values.get("PUBLIC_ORIGIN", "https://201.51.4.212"),
            "PUBLIC_ORIGIN",
        )
        allowed_raw = values.get("ALLOWED_ORIGINS", public_origin)
        allowed_origins = tuple(
            dict.fromkeys(
                _origin(item, "ALLOWED_ORIGINS")
                for item in allowed_raw.split(",")
                if item.strip()
            )
        )
        secret = values.get("APP_SECRET", "").encode("utf-8")
        if not secret:
            raise ValueError("APP_SECRET is required")

        secure_cookie = _boolean(
            values, "COOKIE_SECURE", environment != "development"
        )
        cookie_name = values.get(
            "SESSION_COOKIE_NAME",
            "__Host-pomogay_session" if secure_cookie else "pomogay_session",
        ).strip()

        settings = cls(
            database_path=Path(
                values.get("DATABASE_PATH", "/var/lib/helpinrus/auth.sqlite3")
            ),
            public_origin=public_origin,
            allowed_origins=allowed_origins,
            app_secret=secret,
            bind_host=values.get("BIND_HOST", "127.0.0.1"),
            bind_port=_positive_int(values, "BIND_PORT", 8787),
            secure_cookie=secure_cookie,
            session_cookie_name=cookie_name,
            session_ttl_seconds=_positive_int(
                values, "SESSION_TTL_SECONDS", 30 * 24 * 60 * 60
            ),
            signup_ttl_seconds=_positive_int(
                values, "SIGNUP_TTL_SECONDS", 24 * 60 * 60
            ),
            reset_ttl_seconds=_positive_int(
                values, "RESET_TTL_SECONDS", 30 * 60
            ),
            scrypt_n=_positive_int(values, "SCRYPT_N", 1 << 15),
            scrypt_r=_positive_int(values, "SCRYPT_R", 8),
            scrypt_p=_positive_int(values, "SCRYPT_P", 1),
            request_body_limit=_positive_int(
                values, "REQUEST_BODY_LIMIT", 16 * 1024
            ),
            smtp_host=values.get("SMTP_HOST", "").strip(),
            smtp_port=_positive_int(values, "SMTP_PORT", 587),
            smtp_mode=values.get("SMTP_MODE", "starttls").strip().lower(),
            smtp_username=values.get("SMTP_USERNAME", ""),
            smtp_password=values.get("SMTP_PASSWORD", ""),
            smtp_from=values.get("SMTP_FROM", "").strip(),
            smtp_timeout_seconds=_positive_int(
                values, "SMTP_TIMEOUT_SECONDS", 15
            ),
        )
        if environment == "production":
            if not settings.secure_cookie:
                raise ValueError("COOKIE_SECURE must remain true in production")
            if settings.public_origin.startswith("http://"):
                raise ValueError("PUBLIC_ORIGIN must use HTTPS in production")
            if settings.smtp_mode == "plain":
                raise ValueError("Unencrypted SMTP is not allowed in production")
        return settings
