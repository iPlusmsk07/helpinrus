from __future__ import annotations

import threading
import logging
from typing import Dict, Optional, Tuple

from .config import Settings
from .database import Database, DuplicateEmailError
from .mailer import MailDeliveryError
from .security import (
    hash_password,
    normalize_email,
    opaque_token,
    rate_key_digest,
    token_digest,
    validate_password,
    verify_password,
)


LOGGER = logging.getLogger("helpinrus.auth")


RESET_ACCEPTED = {
    "message": "Если аккаунт существует, ссылка для восстановления будет отправлена."
}
SIGNUP_ACCEPTED = {"message": "verification_sent"}


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate_limit_exceeded")
        self.retry_after = retry_after


class AuthenticationService:
    def __init__(self, settings: Settings, database: Database, mailer) -> None:
        self.settings = settings
        self.database = database
        self.mailer = mailer
        self._password_slots = threading.BoundedSemaphore(value=2)
        # This record is checked for unknown emails so login timing does not reveal
        # whether an account exists.
        with self._password_slots:
            self._dummy_password = hash_password(
                "Not-A-Real-Password-4f1c", settings, salt=b"\x00" * 16
            )

    def _rate(
        self,
        bucket: str,
        value: str,
        limit: int,
        window_seconds: int,
    ) -> None:
        allowed, retry_after = self.database.allow_rate(
            bucket,
            rate_key_digest(value, self.settings.app_secret),
            limit,
            window_seconds,
        )
        if not allowed:
            raise RateLimitExceeded(retry_after)

    def _new_session(self, user_id: str) -> Tuple[str, int]:
        token = opaque_token()
        digest = token_digest(token, "session", self.settings.app_secret)
        expires_at = self.database.create_session(
            user_id, digest, self.settings.session_ttl_seconds
        )
        return token, expires_at

    def signup(self, email_value: object, client_ip: str) -> None:
        self._rate("signup-ip", client_ip, 10, 60 * 60)
        email = normalize_email(email_value)
        self._rate("signup-email", email, 5, 24 * 60 * 60)
        if self.database.user_by_email(email) is not None:
            # Keep the public response identical for registered and new email
            # addresses. No token is issued for an existing account.
            return
        token = opaque_token()
        digest = token_digest(token, "signup-verification", self.settings.app_secret)
        try:
            self.database.stage_signup(
                email,
                digest,
                self.settings.signup_ttl_seconds,
            )
        except DuplicateEmailError:
            return
        try:
            self.mailer.send_signup_verification(email, token)
        except MailDeliveryError:
            self.database.delete_staged_signup(digest)
            # Registered and unregistered email addresses must produce the
            # same public response even while the provider rejects delivery.
            LOGGER.warning("Signup verification delivery was not accepted")
            return
        try:
            activated = self.database.activate_signup(email, digest)
        except DuplicateEmailError:
            return
        if not activated:
            raise RuntimeError("Unable to activate delivered signup token")

    def confirm_signup(
        self,
        token_value: object,
        password_value: object,
        client_ip: str,
    ) -> Optional[Tuple[Dict[str, object], str, int]]:
        self._rate("signup-confirm-ip", client_ip, 20, 60 * 60)
        token = str(token_value or "")
        if len(token) < 32 or len(token) > 256:
            return None
        password = validate_password(password_value)
        with self._password_slots:
            record = hash_password(password, self.settings)
        session_token = opaque_token()
        result = self.database.consume_signup(
            token_digest(token, "signup-verification", self.settings.app_secret),
            record,
            token_digest(session_token, "session", self.settings.app_secret),
            self.settings.session_ttl_seconds,
        )
        if result is None:
            return None
        user, expires_at = result
        return self.public_user(user), session_token, expires_at

    def login(
        self, email_value: object, password_value: object, client_ip: str
    ) -> Optional[Tuple[Dict[str, object], str, int]]:
        self._rate("login-ip", client_ip, 30, 15 * 60)
        email = normalize_email(email_value)
        self._rate("login-email", email, 10, 15 * 60)
        password = str(password_value or "")[:256]
        row = self.database.user_by_email(email)
        if row is not None and row["email_verified_at"] is None:
            row = None
        if row is None:
            record = self._dummy_password
        else:
            record = type(self._dummy_password)(
                salt=row["password_salt"],
                digest=row["password_hash"],
                n=row["scrypt_n"],
                r=row["scrypt_r"],
                p=row["scrypt_p"],
            )
        with self._password_slots:
            matches = verify_password(
                password,
                self.settings,
                record.salt,
                record.digest,
                record.n,
                record.r,
                record.p,
            )
        if row is None or not matches:
            return None
        token, expires_at = self._new_session(row["id"])
        return self.public_user(row), token, expires_at

    def session(self, token: str) -> Optional[Dict[str, object]]:
        if not token or len(token) > 256:
            return None
        row = self.database.user_for_session(
            token_digest(token, "session", self.settings.app_secret)
        )
        return None if row is None else self.public_user(row)

    def logout(self, token: str) -> None:
        if token and len(token) <= 256:
            self.database.delete_session(
                token_digest(token, "session", self.settings.app_secret)
            )

    def request_password_reset(self, email_value: object, client_ip: str) -> None:
        self._rate("reset-request-ip", client_ip, 10, 60 * 60)
        email = normalize_email(email_value)
        self._rate("reset-request-email", email, 3, 60 * 60)
        user = self.database.user_by_email(email)
        if user is None:
            return
        token = opaque_token()
        digest = token_digest(token, "password-reset", self.settings.app_secret)
        self.database.stage_password_reset(
            user["id"], digest, self.settings.reset_ttl_seconds
        )
        try:
            self.mailer.send_password_reset(email, token)
        except MailDeliveryError:
            self.database.delete_staged_password_reset(digest)
            # Do not turn a provider outage into an account-existence oracle.
            # The mailer already records a recipient/token-free internal error.
            LOGGER.warning("Password-reset delivery was not accepted")
            return
        if not self.database.activate_password_reset(user["id"], digest):
            raise RuntimeError("Unable to activate delivered password-reset token")

    def confirm_password_reset(
        self, token_value: object, password_value: object, client_ip: str
    ) -> bool:
        self._rate("reset-confirm-ip", client_ip, 15, 60 * 60)
        token = str(token_value or "")
        if len(token) < 32 or len(token) > 256:
            return False
        password = validate_password(password_value)
        with self._password_slots:
            record = hash_password(password, self.settings)
        return self.database.consume_password_reset(
            token_digest(token, "password-reset", self.settings.app_secret),
            record,
        )

    @staticmethod
    def public_user(row) -> Dict[str, object]:
        return {
            "id": row["id"],
            "email": row["email"],
            "created_at": row["created_at"],
        }
