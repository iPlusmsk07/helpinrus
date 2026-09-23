from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

from server.app import AuthApplication
from server.config import Settings
from server.database import Database
from server.mailer import DisabledMailer, MailDeliveryError, SMTPMailer
from server.manage import reserve_user, smtp_check
from server.service import RESET_ACCEPTED


class RecordingMailer:
    enabled = True

    def __init__(self) -> None:
        self.messages = []
        self.fail_signup = False
        self.fail_reset = False

    def send_signup_verification(self, email: str, token: str) -> None:
        if self.fail_signup:
            raise MailDeliveryError("email_delivery_failed")
        self.messages.append(("signup", email, token))

    def send_password_reset(self, email: str, token: str) -> None:
        if self.fail_reset:
            raise MailDeliveryError("email_delivery_failed")
        self.messages.append(("reset", email, token))

    def check_connection(self) -> bool:
        return True

    def close(self) -> None:
        return None


class APITestCase(unittest.TestCase):
    origin = "http://helpinrus.test"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.clock = 1_800_000_000
        self.settings = Settings(
            database_path=Path(self.temporary.name) / "auth.sqlite3",
            public_origin=self.origin,
            allowed_origins=(self.origin,),
            app_secret=b"test-secret-that-is-at-least-32-bytes-long",
            bind_host="127.0.0.1",
            bind_port=0,
            secure_cookie=False,
            session_cookie_name="pomogay_session",
            session_ttl_seconds=3600,
            signup_ttl_seconds=900,
            reset_ttl_seconds=600,
            scrypt_n=1 << 10,
            scrypt_r=8,
            scrypt_p=1,
        )
        self.database = Database(
            self.settings.database_path, now=lambda: self.clock
        )
        self.mailer = RecordingMailer()
        self.application = AuthApplication(
            self.settings, self.database, self.mailer
        )

    def tearDown(self) -> None:
        self.mailer.close()
        self.temporary.cleanup()

    def request(
        self,
        method: str,
        path: str,
        payload=None,
        cookie: str = "",
        origin: str = None,
    ):
        body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        headers = {}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        if origin is not None:
            headers["Origin"] = origin
        response = self.application.dispatch(
            method,
            path,
            headers,
            body,
            "127.0.0.2",
        )
        return response.status, dict(response.headers), response.payload

    @staticmethod
    def cookie_value(headers) -> str:
        return headers["Set-Cookie"].split(";", 1)[0]

    def signup(self, email="person@example.com"):
        return self.request(
            "POST",
            "/api/auth/signup",
            {"email": email},
            origin=self.origin,
        )

    def create_account(self, email="person@example.com", password="StrongPass9"):
        status, headers, data = self.signup(email)
        self.assertEqual(
            (status, headers, data),
            (202, {}, {"message": "verification_sent"}),
        )
        kind, delivered_email, token = self.mailer.messages[-1]
        self.assertEqual((kind, delivered_email), ("signup", email.casefold()))
        return self.request(
            "POST",
            "/api/auth/signup/confirm",
            {"token": token, "password": password},
            origin=self.origin,
        )

    def test_health_and_security_headers(self) -> None:
        status, _, data = self.request("GET", "/api/auth/health")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["email"], "configured")

    def test_posts_require_exact_allowed_origin(self) -> None:
        payload = {"email": "person@example.com"}
        status, _, data = self.request("POST", "/api/auth/signup", payload)
        self.assertEqual((status, data), (403, {"error": "invalid_origin"}))
        status, _, data = self.request(
            "POST", "/api/auth/signup", payload, origin="https://evil.example"
        )
        self.assertEqual((status, data), (403, {"error": "invalid_origin"}))

    def test_signup_session_and_logout(self) -> None:
        status, headers, data = self.signup()
        self.assertEqual((status, data), (202, {"message": "verification_sent"}))
        self.assertNotIn("Set-Cookie", headers)
        kind, email, token = self.mailer.messages[-1]
        self.assertEqual((kind, email), ("signup", "person@example.com"))
        with sqlite3.connect(self.settings.database_path) as connection:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                0,
            )
            pending = connection.execute(
                "SELECT token_hash, active FROM pending_signup_tokens"
            ).fetchone()
        self.assertIsInstance(pending[0], bytes)
        self.assertNotEqual(pending[0], token.encode("utf-8"))
        self.assertEqual(pending[1], 1)
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/login",
                {"email": "person@example.com", "password": "StrongPass9"},
                origin=self.origin,
            )[0],
            401,
        )

        status, headers, data = self.request(
            "POST",
            "/api/auth/signup/confirm",
            {"token": token, "password": "StrongPass9"},
            origin=self.origin,
        )
        self.assertEqual(status, 201)
        self.assertEqual(data["user"]["email"], "person@example.com")
        set_cookie = headers["Set-Cookie"]
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("SameSite=Lax", set_cookie)
        self.assertNotIn("Secure", set_cookie)
        cookie = self.cookie_value(headers)
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/signup/confirm",
                {"token": token, "password": "StrongPass9"},
                origin=self.origin,
            )[:1],
            (400,),
        )

        status, _, data = self.request(
            "GET", "/api/auth/session", cookie=cookie
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["email"], "person@example.com")

        status, headers, data = self.request(
            "POST", "/api/auth/logout", {}, cookie=cookie, origin=self.origin
        )
        self.assertEqual(status, 204)
        self.assertIsNone(data)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        status, _, data = self.request(
            "GET", "/api/auth/session", cookie=cookie
        )
        self.assertEqual(data, {"user": None})

    def test_duplicate_signup_and_login_errors_are_safe(self) -> None:
        self.assertEqual(self.create_account()[0], 201)
        status, _, data = self.signup()
        self.assertEqual((status, data), (202, {"message": "verification_sent"}))
        self.assertEqual(len(self.mailer.messages), 1)

        status, _, data = self.request(
            "POST",
            "/api/auth/login",
            {"email": "person@example.com", "password": "WrongPass8"},
            origin=self.origin,
        )
        self.assertEqual((status, data), (401, {"error": "invalid_credentials"}))
        status, _, data = self.request(
            "POST",
            "/api/auth/login",
            {"email": "missing@example.com", "password": "WrongPass8"},
            origin=self.origin,
        )
        self.assertEqual((status, data), (401, {"error": "invalid_credentials"}))
        status, headers, data = self.request(
            "POST",
            "/api/auth/login",
            {"email": "person@example.com", "password": "StrongPass9"},
            origin=self.origin,
        )
        self.assertEqual(status, 200)
        self.assertIn("Set-Cookie", headers)
        self.assertEqual(data["user"]["email"], "person@example.com")

    def test_signup_requires_mail_and_failed_resend_preserves_active_token(self) -> None:
        disabled = AuthApplication(self.settings, self.database, DisabledMailer())
        response = disabled.dispatch(
            "POST",
            "/api/auth/signup",
            {"Origin": self.origin, "Content-Type": "application/json"},
            json.dumps({"email": "person@example.com"}).encode("utf-8"),
            "127.0.0.2",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(response.payload, {"error": "email_not_configured"})
        with sqlite3.connect(self.settings.database_path) as connection:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM rate_limits").fetchone()[0],
                0,
            )

        self.assertEqual(self.signup()[0], 202)
        original_token = self.mailer.messages[-1][2]
        self.mailer.fail_signup = True
        status, _, data = self.signup()
        self.assertEqual((status, data), (202, {"message": "verification_sent"}))
        with sqlite3.connect(self.settings.database_path) as connection:
            pending = connection.execute(
                "SELECT COUNT(*), SUM(active) FROM pending_signup_tokens"
            ).fetchone()
        self.assertEqual(pending, (1, 1))
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/signup/confirm",
                {"token": original_token, "password": "StrongPass9"},
                origin=self.origin,
            )[0],
            201,
        )

    def test_expired_signup_token_is_rejected(self) -> None:
        self.assertEqual(self.signup()[0], 202)
        token = self.mailer.messages[-1][2]
        self.clock += self.settings.signup_ttl_seconds + 1
        status, _, data = self.request(
            "POST",
            "/api/auth/signup/confirm",
            {"token": token, "password": "StrongPass9"},
            origin=self.origin,
        )
        self.assertEqual(
            (status, data), (400, {"error": "invalid_or_expired_token"})
        )

    def test_password_reset_is_generic_single_use_and_revokes_sessions(self) -> None:
        status, signup_headers, _ = self.create_account()
        self.assertEqual(status, 201)
        original_cookie = self.cookie_value(signup_headers)
        self.mailer.messages.clear()

        status, _, missing_body = self.request(
            "POST",
            "/api/auth/password-reset/request",
            {"email": "missing@example.com"},
            origin=self.origin,
        )
        self.assertEqual(status, 202)
        self.assertEqual(self.mailer.messages, [])
        status, _, existing_body = self.request(
            "POST",
            "/api/auth/password-reset/request",
            {"email": "PERSON@example.com"},
            origin=self.origin,
        )
        self.assertEqual(status, 202)
        self.assertEqual(existing_body, missing_body)
        self.assertEqual(len(self.mailer.messages), 1)
        kind, email, token = self.mailer.messages[0]
        self.assertEqual((kind, email), ("reset", "person@example.com"))

        with sqlite3.connect(self.settings.database_path) as connection:
            stored = connection.execute(
                "SELECT token_hash FROM password_reset_tokens"
            ).fetchone()[0]
        self.assertIsInstance(stored, bytes)
        self.assertNotEqual(stored, token.encode("utf-8"))

        status, _, data = self.request(
            "POST",
            "/api/auth/password-reset/confirm",
            {"token": token, "password": "NewSecure8"},
            origin=self.origin,
        )
        self.assertEqual((status, data), (200, {"message": "password_updated"}))
        status, _, data = self.request(
            "GET", "/api/auth/session", cookie=original_cookie
        )
        self.assertEqual(data, {"user": None})

        status, _, data = self.request(
            "POST",
            "/api/auth/password-reset/confirm",
            {"token": token, "password": "AnotherSecure9"},
            origin=self.origin,
        )
        self.assertEqual(
            (status, data), (400, {"error": "invalid_or_expired_token"})
        )
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/login",
                {"email": "person@example.com", "password": "StrongPass9"},
                origin=self.origin,
            )[0],
            401,
        )
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/login",
                {"email": "person@example.com", "password": "NewSecure8"},
                origin=self.origin,
            )[0],
            200,
        )

    def test_password_reset_reports_unconfigured_email_before_lookup_or_rate(self) -> None:
        application = AuthApplication(
            self.settings, self.database, DisabledMailer()
        )
        response = application.dispatch(
            "POST",
            "/api/auth/password-reset/request",
            {"Origin": self.origin, "Content-Type": "application/json"},
            json.dumps({"email": "missing@example.com"}).encode("utf-8"),
            "127.0.0.2",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(response.payload, {"error": "email_not_configured"})
        with sqlite3.connect(self.settings.database_path) as connection:
            rate_rows = connection.execute(
                "SELECT COUNT(*) FROM rate_limits"
            ).fetchone()[0]
        self.assertEqual(rate_rows, 0)

    def test_reset_delivery_failure_keeps_previous_active_token(self) -> None:
        self.create_account()
        self.mailer.messages.clear()
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/password-reset/request",
                {"email": "person@example.com"},
                origin=self.origin,
            )[0],
            202,
        )
        original_token = self.mailer.messages[-1][2]
        self.mailer.fail_reset = True
        status, _, data = self.request(
            "POST",
            "/api/auth/password-reset/request",
            {"email": "person@example.com"},
            origin=self.origin,
        )
        self.assertEqual(status, 202)
        self.assertEqual(data, RESET_ACCEPTED)
        with sqlite3.connect(self.settings.database_path) as connection:
            tokens = connection.execute(
                "SELECT COUNT(*), SUM(active) FROM password_reset_tokens "
                "WHERE used_at IS NULL"
            ).fetchone()
        self.assertEqual(tokens, (1, 1))
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/password-reset/confirm",
                {"token": original_token, "password": "NewSecure8"},
                origin=self.origin,
            )[0],
            200,
        )

    def test_expired_reset_token_is_rejected(self) -> None:
        self.create_account()
        self.mailer.messages.clear()
        self.request(
            "POST",
            "/api/auth/password-reset/request",
            {"email": "person@example.com"},
            origin=self.origin,
        )
        token = self.mailer.messages[0][2]
        self.clock += self.settings.reset_ttl_seconds + 1
        status, _, data = self.request(
            "POST",
            "/api/auth/password-reset/confirm",
            {"token": token, "password": "NewSecure8"},
            origin=self.origin,
        )
        self.assertEqual(
            (status, data), (400, {"error": "invalid_or_expired_token"})
        )

    def test_reset_request_rate_limit(self) -> None:
        self.create_account()
        self.mailer.messages.clear()
        for _ in range(3):
            status, _, _ = self.request(
                "POST",
                "/api/auth/password-reset/request",
                {"email": "person@example.com"},
                origin=self.origin,
            )
            self.assertEqual(status, 202)
        status, headers, data = self.request(
            "POST",
            "/api/auth/password-reset/request",
            {"email": "person@example.com"},
            origin=self.origin,
        )
        self.assertEqual((status, data), (429, {"error": "rate_limit_exceeded"}))
        self.assertGreater(int(headers["Retry-After"]), 0)

    def test_reserved_legacy_email_can_prove_ownership_and_set_password(self) -> None:
        with redirect_stdout(StringIO()):
            self.assertEqual(
                reserve_user(
                    self.settings,
                    self.database,
                    "legacy@example.com",
                    "f017b2f3-c886-4dc5-a0f9-7df4ce291a8d",
                ),
                0,
            )
        with sqlite3.connect(self.settings.database_path) as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT email_verified_at FROM users WHERE email = ?",
                    ("legacy@example.com",),
                ).fetchone()[0]
            )

        status, _, _ = self.request(
            "POST",
            "/api/auth/password-reset/request",
            {"email": "legacy@example.com"},
            origin=self.origin,
        )
        self.assertEqual(status, 202)
        kind, email, token = self.mailer.messages[-1]
        self.assertEqual((kind, email), ("reset", "legacy@example.com"))

        status, _, data = self.request(
            "POST",
            "/api/auth/password-reset/confirm",
            {"token": token, "password": "RecoveredPass9"},
            origin=self.origin,
        )
        self.assertEqual((status, data), (200, {"message": "password_updated"}))
        self.assertEqual(
            self.request(
                "POST",
                "/api/auth/login",
                {"email": "legacy@example.com", "password": "RecoveredPass9"},
                origin=self.origin,
            )[0],
            200,
        )
        with sqlite3.connect(self.settings.database_path) as connection:
            self.assertIsNotNone(
                connection.execute(
                    "SELECT email_verified_at FROM users WHERE email = ?",
                    ("legacy@example.com",),
                ).fetchone()[0]
            )

    def test_rejects_bad_json_content_type_and_large_body(self) -> None:
        response = self.application.dispatch(
            "POST",
            "/api/auth/login",
            {"Origin": self.origin, "Content-Type": "text/plain"},
            b"{}",
            "127.0.0.2",
        )
        self.assertEqual(response.status, 415)

        response = self.application.dispatch(
            "POST",
            "/api/auth/login",
            {"Origin": self.origin, "Content-Type": "application/json"},
            b"x" * (self.settings.request_body_limit + 1),
            "127.0.0.2",
        )
        self.assertEqual(response.status, 413)


class SettingsTestCase(unittest.TestCase):
    def test_production_can_start_before_smtp_is_configured(self) -> None:
        settings = Settings.from_env(
            {
                "HELPINRUS_ENV": "production",
                "APP_SECRET": "x" * 32,
                "PUBLIC_ORIGIN": "https://201.51.4.212",
            }
        )
        self.assertFalse(settings.smtp_configured)
        self.assertEqual(settings.bind_port, 8787)
        self.assertTrue(settings.secure_cookie)

    def test_plain_smtp_is_rejected_in_production(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unencrypted SMTP"):
            Settings.from_env(
                {
                    "HELPINRUS_ENV": "production",
                    "APP_SECRET": "x" * 32,
                    "PUBLIC_ORIGIN": "https://201.51.4.212",
                    "SMTP_MODE": "plain",
                }
            )

    def test_partial_smtp_credentials_are_rejected(self) -> None:
        for partial in (
            {"SMTP_USERNAME": "mailer@example.test"},
            {"SMTP_PASSWORD": "secret-without-a-username"},
        ):
            with self.subTest(partial=tuple(partial)):
                with self.assertRaisesRegex(
                    ValueError,
                    "SMTP_USERNAME and SMTP_PASSWORD",
                ):
                    Settings.from_env(
                        {
                            "HELPINRUS_ENV": "production",
                            "PUBLIC_ORIGIN": "https://201.51.4.212",
                            "ALLOWED_ORIGINS": "https://201.51.4.212",
                            "APP_SECRET": "x" * 32,
                            "SMTP_HOST": "smtp.example.test",
                            "SMTP_FROM": "no-reply@example.test",
                            **partial,
                        }
                    )

    def test_mailer_builds_fragment_links_synchronously(self) -> None:
        settings = Settings(
            database_path=Path("/tmp/not-used.sqlite3"),
            public_origin="https://helpinrus.test",
            allowed_origins=("https://helpinrus.test",),
            app_secret=b"test-secret-that-is-at-least-32-bytes-long",
            smtp_host="smtp.example.test",
            smtp_from="no-reply@example.test",
        )
        mailer = SMTPMailer(settings)
        delivered = []
        mailer._deliver = delivered.append
        mailer.send_signup_verification("person@example.test", "signup-token")
        mailer.send_password_reset("person@example.test", "reset-token")
        self.assertIn(
            "/#auth=verify&token=signup-token", delivered[0].get_content()
        )
        self.assertIn(
            "/#auth=reset&token=reset-token", delivered[1].get_content()
        )

    def test_smtp_check_is_nonzero_when_mail_is_not_configured(self) -> None:
        settings = Settings(
            database_path=Path("/tmp/not-used.sqlite3"),
            public_origin="https://helpinrus.test",
            allowed_origins=("https://helpinrus.test",),
            app_secret=b"test-secret-that-is-at-least-32-bytes-long",
        )
        with redirect_stderr(StringIO()):
            self.assertEqual(smtp_check(settings), 4)


class MigrationTestCase(unittest.TestCase):
    def test_legacy_users_remain_unverified_and_reset_tokens_remain_active(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "legacy.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.executescript(
                    """
                    CREATE TABLE users (
                        id TEXT PRIMARY KEY,
                        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                        password_salt BLOB NOT NULL,
                        password_hash BLOB NOT NULL,
                        scrypt_n INTEGER NOT NULL,
                        scrypt_r INTEGER NOT NULL,
                        scrypt_p INTEGER NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE password_reset_tokens (
                        token_hash BLOB PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id),
                        created_at INTEGER NOT NULL,
                        expires_at INTEGER NOT NULL,
                        used_at INTEGER
                    );
                    """
                )
                connection.execute(
                    "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        "legacy-user",
                        "legacy@example.com",
                        b"salt",
                        b"hash",
                        1024,
                        8,
                        1,
                        100,
                        100,
                    ),
                )
                connection.execute(
                    "INSERT INTO password_reset_tokens VALUES (?, ?, ?, ?, NULL)",
                    (b"token", "legacy-user", 100, 9999999999),
                )

            Database(path)
            with sqlite3.connect(path) as connection:
                user = connection.execute(
                    "SELECT email_verified_at FROM users WHERE id = 'legacy-user'"
                ).fetchone()
                reset = connection.execute(
                    "SELECT active FROM password_reset_tokens"
                ).fetchone()
            self.assertEqual(user, (None,))
            self.assertEqual(reset, (1,))


if __name__ == "__main__":
    unittest.main()
