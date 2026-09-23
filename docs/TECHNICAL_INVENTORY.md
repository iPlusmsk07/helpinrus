# Техническая карта проекта «Помогай»

## Единственный путь в production

- исходный код: `https://github.com/iPlusmsk07/helpinrus`;
- production-ветка: `main`;
- production: `https://201.51.4.212`;
- checkout на сервере: `/opt/helpinrus`;
- публичный путь: `/var/www/helpinrus`;
- неизменяемые релизы: `/var/www/helpinrus-releases`.

Изменения проходят Pull Request и обязательную GitHub Actions-проверку. После
merge серверный deploy получает точный commit из `main`, запускает тесты,
собирает `www` и атомарно переключает публичный симлинк. Ручное копирование
файлов в web root не является поддерживаемым способом публикации.

## Архитектура

- статический HTML/CSS/JavaScript и PWA;
- собственный same-origin API аккаунтов: `/api/auth/`;
- Python-сервис `helpinrus-auth` слушает только `127.0.0.1:8787`;
- Nginx проксирует только путь `/api/auth/`;
- данные аккаунтов хранятся в SQLite на production-сервере;
- подтверждение email и восстановление пароля отправляются через SMTP;
- карта загружается с Яндекс Карт.

Профили, публикации и чаты ещё не перенесены на серверный backend и не должны
имитировать успешную запись. Платежи, KYC и загрузка документов не подключены.

## Секреты и данные

- `/etc/helpinrus/auth.env`: `APP_SECRET` и SMTP-настройки, права `0640`;
- `/var/lib/helpinrus/auth.sqlite3`: база аккаунтов, вне Git и web root;
- GitHub, SMTP и SSH-ключи никогда не добавляются в репозиторий;
- каталог `www` содержит только 12 разрешённых публичных файлов.

Подробная установка, проверка SMTP, атомарный deploy и rollback описаны в
[`../ops/README.md`](../ops/README.md). Действия при инциденте и резервирование
описаны в [`INCIDENT_AND_BACKUP_RUNBOOK_RU.md`](INCIDENT_AND_BACKUP_RUNBOOK_RU.md).

## Локальные проверки

```text
pnpm test
pnpm build
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s server/tests -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/tests -v
```
