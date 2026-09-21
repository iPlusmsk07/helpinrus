from __future__ import annotations

import logging
import signal
import threading

from .app import AuthApplication
from .config import Settings
from .database import Database
from .http_server import build_server
from .mailer import mailer_from_settings


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    settings = Settings.from_env()
    database = Database(settings.database_path)
    mailer = mailer_from_settings(settings)
    application = AuthApplication(settings, database, mailer)
    server = build_server(application)

    def request_shutdown(signum, frame) -> None:
        del signum, frame
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        mailer.close()


if __name__ == "__main__":
    main()
