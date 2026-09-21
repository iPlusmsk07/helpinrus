from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlencode

from .config import Settings


LOGGER = logging.getLogger("helpinrus.mailer")


class MailDeliveryError(Exception):
    """The configured SMTP provider did not accept the message."""


class DisabledMailer:
    enabled = False

    def send_signup_verification(self, email: str, token: str) -> None:
        raise MailDeliveryError("email_not_configured")

    def send_password_reset(self, email: str, token: str) -> None:
        raise MailDeliveryError("email_not_configured")

    def check_connection(self) -> bool:
        return False

    def close(self) -> None:
        return None


class SMTPMailer:
    enabled = True

    def __init__(self, settings: Settings) -> None:
        if not settings.smtp_configured:
            raise ValueError("SMTP_HOST and SMTP_FROM are required")
        self.settings = settings

    def _connect(self):
        context = ssl.create_default_context()
        if self.settings.smtp_mode == "ssl":
            client = smtplib.SMTP_SSL(
                self.settings.smtp_host,
                self.settings.smtp_port,
                timeout=self.settings.smtp_timeout_seconds,
                context=context,
            )
        else:
            client = smtplib.SMTP(
                self.settings.smtp_host,
                self.settings.smtp_port,
                timeout=self.settings.smtp_timeout_seconds,
            )
        try:
            code, response = client.ehlo()
            if code >= 400:
                raise smtplib.SMTPResponseException(code, response)
            if self.settings.smtp_mode == "starttls":
                client.starttls(context=context)
                code, response = client.ehlo()
                if code >= 400:
                    raise smtplib.SMTPResponseException(code, response)
            if self.settings.smtp_username:
                client.login(
                    self.settings.smtp_username,
                    self.settings.smtp_password,
                )
            return client
        except Exception:
            try:
                client.close()
            finally:
                raise

    def _deliver(self, message: EmailMessage) -> None:
        client = None
        try:
            client = self._connect()
            refused = client.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
        except Exception as exc:
            # Some SMTP exceptions embed the recipient. Log only the exception
            # class, never the address, message body, link, or bearer token.
            LOGGER.error("SMTP delivery failed (%s)", type(exc).__name__)
            raise MailDeliveryError("email_delivery_failed") from None
        finally:
            # Once DATA received a success response, provider acceptance is
            # authoritative. A subsequent QUIT/connection-close failure must
            # not turn an accepted link into an inactive one.
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass

    def check_connection(self) -> bool:
        try:
            with self._connect() as client:
                code, _ = client.noop()
                if code >= 400:
                    raise smtplib.SMTPResponseException(code, b"NOOP rejected")
            return True
        except Exception as exc:
            LOGGER.error("SMTP connection check failed (%s)", type(exc).__name__)
            return False

    def send_signup_verification(self, email: str, token: str) -> None:
        query = urlencode({"auth": "verify", "token": token})
        verification_url = f"{self.settings.public_origin}/#{query}"
        message = EmailMessage()
        message["Subject"] = "Подтвердите email в Помогай"
        message["From"] = self.settings.smtp_from
        message["To"] = email
        message.set_content(
            "Подтвердите email для завершения регистрации в Помогай.\n\n"
            f"Откройте ссылку: {verification_url}\n\n"
            f"Ссылка действует {self.settings.signup_ttl_seconds // 60} минут "
            "и может быть использована только один раз. Если вы не "
            "регистрировались, ничего не предпринимайте."
        )
        self._deliver(message)

    def send_password_reset(self, email: str, token: str) -> None:
        query = urlencode({"auth": "reset", "token": token})
        reset_url = f"{self.settings.public_origin}/#{query}"
        message = EmailMessage()
        message["Subject"] = "Восстановление пароля Помогай"
        message["From"] = self.settings.smtp_from
        message["To"] = email
        message.set_content(
            "Вы запросили восстановление пароля в Помогай.\n\n"
            f"Откройте ссылку: {reset_url}\n\n"
            f"Ссылка действует {self.settings.reset_ttl_seconds // 60} минут "
            "и может быть использована только один раз. Если вы не делали "
            "этот запрос, ничего не предпринимайте."
        )
        self._deliver(message)

    def close(self) -> None:
        return None


def mailer_from_settings(settings: Settings):
    if not settings.smtp_configured:
        return DisabledMailer()
    return SMTPMailer(settings)
