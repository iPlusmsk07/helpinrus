from __future__ import annotations

import json
import logging
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from typing import Mapping

from .app import AuthApplication, Response


LOGGER = logging.getLogger("helpinrus.http")


class AuthHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def __init__(self, server_address, handler_class, application) -> None:
        super().__init__(server_address, handler_class)
        self.application = application


class AuthRequestHandler(BaseHTTPRequestHandler):
    server_version = "Helpinrus"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(20)

    def version_string(self) -> str:
        return "Helpinrus"

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_OPTIONS(self) -> None:
        self._write(
            Response(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {"error": "method_not_allowed"},
            )
        )

    def _dispatch(self, method: str) -> None:
        length_header = self.headers.get("Content-Length", "0")
        try:
            length = int(length_header)
        except ValueError:
            self._write(
                Response(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            )
            return
        limit = self.server.application.settings.request_body_limit
        if length < 0 or length > limit:
            self._write(
                Response(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"error": "request_too_large"},
                )
            )
            return
        body = self.rfile.read(length) if length else b""
        try:
            response = self.server.application.dispatch(
                method,
                self.path,
                self.headers,
                body,
                self._client_ip(),
            )
        except Exception:
            LOGGER.exception("Unhandled authentication API error")
            response = Response(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "internal_error"},
            )
        self._write(response)

    def _client_ip(self) -> str:
        peer = self.client_address[0]
        try:
            trusted_proxy = ip_address(peer).is_loopback
        except ValueError:
            trusted_proxy = False
        forwarded = self.headers.get("X-Real-IP", "") if trusted_proxy else ""
        candidate = forwarded.strip() or peer
        try:
            return str(ip_address(candidate))
        except ValueError:
            return peer

    def _write(self, response: Response) -> None:
        payload = (
            b""
            if response.payload is None
            else json.dumps(
                response.payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        self.send_response(int(response.status))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'none'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if payload:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        for name, value in response.headers:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if payload and self.command != "HEAD":
            self.wfile.write(payload)

    def log_message(self, format_string: str, *args) -> None:
        LOGGER.info(
            "%s %s %s",
            self.client_address[0],
            self.command,
            self.path.split("?", 1)[0],
        )


def build_server(application: AuthApplication) -> AuthHTTPServer:
    settings = application.settings
    return AuthHTTPServer(
        (settings.bind_host, settings.bind_port),
        AuthRequestHandler,
        application,
    )
