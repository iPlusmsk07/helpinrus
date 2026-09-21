from __future__ import annotations

import http.cookies
import json
import logging
from dataclasses import dataclass
from http import HTTPStatus
from typing import Dict, List, Mapping, Optional, Tuple
from urllib.parse import urlsplit

from .config import Settings
from .database import Database
from .service import (
    RESET_ACCEPTED,
    SIGNUP_ACCEPTED,
    AuthenticationService,
    RateLimitExceeded,
)


LOGGER = logging.getLogger("helpinrus.api")


@dataclass(frozen=True)
class Response:
    status: int
    payload: Optional[Dict[str, object]] = None
    headers: Tuple[Tuple[str, str], ...] = ()


class AuthApplication:
    def __init__(
        self,
        settings: Settings,
        database: Database,
        mailer,
    ) -> None:
        self.settings = settings
        self.database = database
        self.mailer = mailer
        self.service = AuthenticationService(settings, database, mailer)
        self.allowed_origins = frozenset(settings.allowed_origins)

    def dispatch(
        self,
        method: str,
        raw_path: str,
        headers: Mapping[str, str],
        body: bytes,
        client_ip: str,
    ) -> Response:
        path = urlsplit(raw_path).path.rstrip("/") or "/"
        if len(body) > self.settings.request_body_limit:
            return self.error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request_too_large"
            )
        if method == "GET" and path == "/api/auth/health":
            return self._health()
        if method == "GET" and path == "/api/auth/session":
            return self._session(headers)

        known_post_paths = {
            "/api/auth/signup",
            "/api/auth/signup/confirm",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/password-reset/request",
            "/api/auth/password-reset/confirm",
        }
        if path in known_post_paths and method != "POST":
            return self.error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")
        if method != "POST" or path not in known_post_paths:
            return self.error(HTTPStatus.NOT_FOUND, "not_found")
        if headers.get("Origin", "") not in self.allowed_origins:
            return self.error(HTTPStatus.FORBIDDEN, "invalid_origin")

        if path == "/api/auth/logout":
            data = self._json(body, headers, allow_empty=True)
        else:
            data = self._json(body, headers)
        if isinstance(data, Response):
            return data

        try:
            if path == "/api/auth/signup":
                return self._signup(data, client_ip)
            if path == "/api/auth/signup/confirm":
                return self._confirm_signup(data, client_ip)
            if path == "/api/auth/login":
                return self._login(data, client_ip)
            if path == "/api/auth/logout":
                return self._logout(headers)
            if path == "/api/auth/password-reset/request":
                return self._request_password_reset(data, client_ip)
            return self._confirm_password_reset(data, client_ip)
        except RateLimitExceeded as exc:
            return self.error(
                HTTPStatus.TOO_MANY_REQUESTS,
                "rate_limit_exceeded",
                headers=(("Retry-After", str(exc.retry_after)),),
            )
        except ValueError as exc:
            error = str(exc)
            if error not in {
                "invalid_email",
                "invalid_password",
                "email_already_registered",
            }:
                LOGGER.warning("Rejected invalid authentication request")
                error = "invalid_request"
            status = (
                HTTPStatus.CONFLICT
                if error == "email_already_registered"
                else HTTPStatus.BAD_REQUEST
            )
            return self.error(status, error)

    def _health(self) -> Response:
        try:
            healthy = self.database.healthcheck()
        except Exception:
            LOGGER.exception("Database healthcheck failed")
            healthy = False
        if not healthy:
            return Response(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"status": "unavailable", "database": "error"},
            )
        return Response(
            HTTPStatus.OK,
            {
                "status": "ok",
                "database": "ok",
                "email": "configured" if self.mailer.enabled else "not_configured",
            },
        )

    def _session(self, headers: Mapping[str, str]) -> Response:
        token = self._session_token(headers)
        user = self.service.session(token) if token else None
        return Response(HTTPStatus.OK, {"user": user})

    def _signup(self, data: Dict[str, object], client_ip: str) -> Response:
        if not self.mailer.enabled:
            return self.error(
                HTTPStatus.SERVICE_UNAVAILABLE, "email_not_configured"
            )
        self.service.signup(
            data.get("email"), client_ip
        )
        return Response(HTTPStatus.ACCEPTED, SIGNUP_ACCEPTED)

    def _confirm_signup(
        self, data: Dict[str, object], client_ip: str
    ) -> Response:
        result = self.service.confirm_signup(
            data.get("token"), data.get("password"), client_ip
        )
        if result is None:
            return self.error(
                HTTPStatus.BAD_REQUEST, "invalid_or_expired_token"
            )
        user, token, expires_at = result
        return Response(
            HTTPStatus.CREATED,
            {"user": user},
            (("Set-Cookie", self._session_cookie(token, expires_at)),),
        )

    def _login(self, data: Dict[str, object], client_ip: str) -> Response:
        result = self.service.login(
            data.get("email"), data.get("password"), client_ip
        )
        if result is None:
            return self.error(HTTPStatus.UNAUTHORIZED, "invalid_credentials")
        user, token, expires_at = result
        return Response(
            HTTPStatus.OK,
            {"user": user},
            (("Set-Cookie", self._session_cookie(token, expires_at)),),
        )

    def _logout(self, headers: Mapping[str, str]) -> Response:
        token = self._session_token(headers)
        if token:
            self.service.logout(token)
        return Response(
            HTTPStatus.NO_CONTENT,
            None,
            (("Set-Cookie", self._expired_session_cookie()),),
        )

    def _request_password_reset(
        self, data: Dict[str, object], client_ip: str
    ) -> Response:
        if not self.mailer.enabled:
            return self.error(
                HTTPStatus.SERVICE_UNAVAILABLE, "email_not_configured"
            )
        self.service.request_password_reset(data.get("email"), client_ip)
        return Response(HTTPStatus.ACCEPTED, RESET_ACCEPTED)

    def _confirm_password_reset(
        self, data: Dict[str, object], client_ip: str
    ) -> Response:
        changed = self.service.confirm_password_reset(
            data.get("token"), data.get("password"), client_ip
        )
        if not changed:
            return self.error(
                HTTPStatus.BAD_REQUEST, "invalid_or_expired_token"
            )
        return Response(
            HTTPStatus.OK,
            {"message": "password_updated"},
            (("Set-Cookie", self._expired_session_cookie()),),
        )

    def _json(
        self,
        body: bytes,
        headers: Mapping[str, str],
        allow_empty: bool = False,
    ):
        content_type = headers.get("Content-Type", "").split(";", 1)[0].strip()
        if content_type != "application/json":
            return self.error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "json_content_type_required"
            )
        if not body and allow_empty:
            return {}
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self.error(HTTPStatus.BAD_REQUEST, "invalid_json")
        if not isinstance(value, dict):
            return self.error(HTTPStatus.BAD_REQUEST, "invalid_json")
        return value

    def _session_token(self, headers: Mapping[str, str]) -> str:
        raw = headers.get("Cookie", "")
        if not raw or len(raw) > 4096:
            return ""
        try:
            cookies = http.cookies.SimpleCookie()
            cookies.load(raw)
            morsel = cookies.get(self.settings.session_cookie_name)
            return "" if morsel is None else morsel.value
        except http.cookies.CookieError:
            return ""

    def _session_cookie(self, token: str, expires_at: int) -> str:
        max_age = max(1, expires_at - int(self.database.now()))
        parts = [
            f"{self.settings.session_cookie_name}={token}",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            f"Max-Age={max_age}",
        ]
        if self.settings.secure_cookie:
            parts.append("Secure")
        return "; ".join(parts)

    def _expired_session_cookie(self) -> str:
        parts = [
            f"{self.settings.session_cookie_name}=",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            "Max-Age=0",
        ]
        if self.settings.secure_cookie:
            parts.append("Secure")
        return "; ".join(parts)

    @staticmethod
    def error(
        status: int,
        name: str,
        headers: Tuple[Tuple[str, str], ...] = (),
    ) -> Response:
        return Response(status, {"error": name}, headers)
