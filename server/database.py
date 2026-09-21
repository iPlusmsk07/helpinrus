from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple

from .security import PasswordRecord


class DuplicateEmailError(Exception):
    pass


class Database:
    def __init__(
        self,
        path: Path,
        now: Callable[[], float] = time.time,
    ) -> None:
        self.path = Path(path)
        self.now = now
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = FULL")
        return connection

    def _initialize(self) -> None:
        schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
        with self._connect() as connection:
            connection.executescript(schema)
            # Additive migrations for databases created by the pre-verification
            # service. Legacy users deliberately remain unverified; an operator
            # must explicitly recreate/migrate them after proving ownership.
            user_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(users)")
            }
            if "email_verified_at" not in user_columns:
                connection.execute(
                    "ALTER TABLE users ADD COLUMN email_verified_at INTEGER"
                )
            reset_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(password_reset_tokens)"
                )
            }
            if "active" not in reset_columns:
                # Previously-issued tokens were already deliverable, so retain
                # their active status during this one-time schema migration.
                connection.execute(
                    "ALTER TABLE password_reset_tokens "
                    "ADD COLUMN active INTEGER NOT NULL DEFAULT 1"
                )
            legacy_pending = connection.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'table' AND name = 'pending_signups'"
            ).fetchone()
            if legacy_pending is not None:
                # Legacy rows contain a password chosen before email ownership
                # was proven. They must never be confirmable after this upgrade.
                connection.execute("DELETE FROM pending_signups")

    def healthcheck(self) -> bool:
        with self._connect() as connection:
            return connection.execute("SELECT 1").fetchone()[0] == 1

    def create_user(
        self,
        email: str,
        password: PasswordRecord,
        *,
        user_id: Optional[str] = None,
        verified: bool = True,
    ) -> Dict[str, object]:
        created_at = int(self.now())
        actual_user_id = user_id or str(uuid.uuid4())
        verified_at = created_at if verified else None
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO users (
                        id, email, password_salt, password_hash,
                        scrypt_n, scrypt_r, scrypt_p, created_at, updated_at,
                        email_verified_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        actual_user_id,
                        email,
                        password.salt,
                        password.digest,
                        password.n,
                        password.r,
                        password.p,
                        created_at,
                        created_at,
                        verified_at,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            if "users.email" in str(exc):
                raise DuplicateEmailError from exc
            raise
        return {"id": actual_user_id, "email": email, "created_at": created_at}

    def stage_signup(
        self,
        email: str,
        token_hash: bytes,
        ttl_seconds: int,
    ) -> int:
        now = int(self.now())
        expires_at = now + ttl_seconds
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute(
                "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone():
                connection.rollback()
                raise DuplicateEmailError
            connection.execute(
                """
                INSERT INTO pending_signup_tokens (
                    token_hash, email, created_at, expires_at, active
                ) VALUES (?, ?, ?, ?, 1)
                """,
                (
                    token_hash,
                    email,
                    now,
                    expires_at,
                ),
            )
            connection.execute(
                "DELETE FROM pending_signup_tokens WHERE expires_at <= ?", (now,)
            )
            connection.commit()
            return expires_at
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def activate_signup(self, email: str, token_hash: bytes) -> bool:
        now = int(self.now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute(
                "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone():
                connection.execute(
                    "DELETE FROM pending_signup_tokens WHERE token_hash = ?",
                    (token_hash,),
                )
                connection.commit()
                raise DuplicateEmailError
            row = connection.execute(
                """
                SELECT rowid AS delivery_order FROM pending_signup_tokens
                WHERE token_hash = ? AND email = ? COLLATE NOCASE
                    AND active = 1 AND expires_at > ?
                """,
                (token_hash, email, now),
            ).fetchone()
            if row is None:
                connection.rollback()
                return False
            # Revoke only tokens inserted before this request. A newer
            # concurrent send remains usable until its own outcome is known.
            connection.execute(
                "DELETE FROM pending_signup_tokens "
                "WHERE email = ? COLLATE NOCASE AND active = 1 AND rowid < ?",
                (email, row["delivery_order"]),
            )
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def delete_staged_signup(self, token_hash: bytes) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM pending_signup_tokens "
                "WHERE token_hash = ?",
                (token_hash,),
            )

    def consume_signup(
        self,
        token_hash: bytes,
        password: PasswordRecord,
        session_hash: bytes,
        session_ttl_seconds: int,
    ) -> Optional[Tuple[Dict[str, object], int]]:
        now = int(self.now())
        expires_at = now + session_ttl_seconds
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT * FROM pending_signup_tokens
                WHERE token_hash = ? AND active = 1 AND expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            if row is None:
                connection.rollback()
                return None
            if connection.execute(
                "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE",
                (row["email"],),
            ).fetchone():
                connection.execute(
                    "DELETE FROM pending_signup_tokens "
                    "WHERE email = ? COLLATE NOCASE",
                    (row["email"],),
                )
                connection.commit()
                return None

            user_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO users (
                    id, email, password_salt, password_hash,
                    scrypt_n, scrypt_r, scrypt_p, created_at, updated_at,
                    email_verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    row["email"],
                    password.salt,
                    password.digest,
                    password.n,
                    password.r,
                    password.p,
                    now,
                    now,
                    now,
                ),
            )
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) "
                "VALUES (?, ?, ?, ?)",
                (session_hash, user_id, now, expires_at),
            )
            connection.execute(
                "DELETE FROM pending_signup_tokens WHERE email = ? COLLATE NOCASE",
                (row["email"],),
            )
            connection.commit()
            return (
                {"id": user_id, "email": row["email"], "created_at": now},
                expires_at,
            )
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def user_by_email(self, email: str) -> Optional[sqlite3.Row]:
        with self._connect() as connection:
            return connection.execute(
                "SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone()

    def create_session(
        self, user_id: str, token_hash: bytes, ttl_seconds: int
    ) -> int:
        now = int(self.now())
        expires_at = now + ttl_seconds
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) "
                "VALUES (?, ?, ?, ?)",
                (token_hash, user_id, now, expires_at),
            )
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        return expires_at

    def user_for_session(self, token_hash: bytes) -> Optional[sqlite3.Row]:
        now = int(self.now())
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.id, users.email, users.created_at, sessions.expires_at
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                    AND users.email_verified_at IS NOT NULL
                """,
                (token_hash, now),
            ).fetchone()
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            return row

    def delete_session(self, token_hash: bytes) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?", (token_hash,)
            )

    def stage_password_reset(
        self, user_id: str, token_hash: bytes, ttl_seconds: int
    ) -> int:
        now = int(self.now())
        expires_at = now + ttl_seconds
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO password_reset_tokens
                    (token_hash, user_id, created_at, expires_at, used_at, active)
                VALUES (?, ?, ?, ?, NULL, 1)
                """,
                (token_hash, user_id, now, expires_at),
            )
            connection.execute(
                "DELETE FROM password_reset_tokens "
                "WHERE expires_at <= ? OR used_at IS NOT NULL",
                (now - 24 * 60 * 60,),
            )
        return expires_at

    def activate_password_reset(self, user_id: str, token_hash: bytes) -> bool:
        now = int(self.now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT rowid AS delivery_order FROM password_reset_tokens
                WHERE token_hash = ? AND user_id = ? AND active = 1
                    AND used_at IS NULL AND expires_at > ?
                """,
                (token_hash, user_id, now),
            ).fetchone()
            if row is None:
                connection.rollback()
                return False
            connection.execute(
                """
                UPDATE password_reset_tokens
                SET used_at = ?
                WHERE user_id = ? AND rowid < ?
                    AND active = 1 AND used_at IS NULL
                """,
                (now, user_id, row["delivery_order"]),
            ).rowcount
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def delete_staged_password_reset(self, token_hash: bytes) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM password_reset_tokens "
                "WHERE token_hash = ?",
                (token_hash,),
            )

    def consume_password_reset(
        self, token_hash: bytes, password: PasswordRecord
    ) -> bool:
        now = int(self.now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT user_id
                FROM password_reset_tokens
                WHERE token_hash = ? AND active = 1
                    AND used_at IS NULL AND expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            if row is None:
                connection.rollback()
                return False
            user_id = row["user_id"]
            changed = connection.execute(
                """
                UPDATE password_reset_tokens
                SET used_at = ?
                WHERE token_hash = ? AND used_at IS NULL
                """,
                (now, token_hash),
            ).rowcount
            if changed != 1:
                connection.rollback()
                return False
            connection.execute(
                """
                UPDATE users
                SET password_salt = ?, password_hash = ?,
                    scrypt_n = ?, scrypt_r = ?, scrypt_p = ?, updated_at = ?,
                    email_verified_at = COALESCE(email_verified_at, ?)
                WHERE id = ?
                """,
                (
                    password.salt,
                    password.digest,
                    password.n,
                    password.r,
                    password.p,
                    now,
                    now,
                    user_id,
                ),
            )
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            connection.execute(
                "UPDATE password_reset_tokens SET used_at = ? "
                "WHERE user_id = ? AND used_at IS NULL",
                (now, user_id),
            )
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def allow_rate(
        self,
        bucket: str,
        key_hash: bytes,
        limit: int,
        window_seconds: int,
    ) -> Tuple[bool, int]:
        now = int(self.now())
        window_start = now - (now % window_seconds)
        retry_after = max(1, window_start + window_seconds - now)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT window_start, request_count FROM rate_limits "
                "WHERE bucket = ? AND key_hash = ?",
                (bucket, key_hash),
            ).fetchone()
            if row is None or row["window_start"] != window_start:
                connection.execute(
                    """
                    INSERT INTO rate_limits
                        (bucket, key_hash, window_start, request_count)
                    VALUES (?, ?, ?, 1)
                    ON CONFLICT(bucket, key_hash) DO UPDATE SET
                        window_start = excluded.window_start,
                        request_count = 1
                    """,
                    (bucket, key_hash, window_start),
                )
                allowed = True
            elif row["request_count"] >= limit:
                allowed = False
            else:
                connection.execute(
                    "UPDATE rate_limits SET request_count = request_count + 1 "
                    "WHERE bucket = ? AND key_hash = ?",
                    (bucket, key_hash),
                )
                allowed = True
            connection.execute(
                "DELETE FROM rate_limits WHERE window_start < ?",
                (window_start - 24 * 60 * 60,),
            )
            connection.commit()
            return allowed, retry_after
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
