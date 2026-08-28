# Техническая карта проекта «Помогай»

## Основные точки

- Production: https://helpinrus.netlify.app
- GitHub: https://github.com/iPlusmsk07/helpinrus
- Supabase project ref: `llnjgyehxsogjmwegnyf`
- Production branch: `main`
- Зафиксированная исходная версия: `f89c0fe7d0f940edbecbb36232d4bb5c78f9a728`
- Baseline tag: `baseline-pre-implementation-2026-08-24`
- Ветка аудита: `audit/security-reliability-2026-08-27`

## Архитектура

- Статический HTML/CSS/JavaScript без frontend-фреймворка.
- Supabase JS подключается как закреплённый UMD-скрипт с SRI.
- Supabase используется для Auth, PostgREST, PostgreSQL/RLS и планируемого Realtime.
- PWA состоит из manifest и Service Worker.
- Capacitor `7.6.8` подготовлен для web-синхронизации; нативные проекты пока не добавлены.
- Netlify собирает каталог `www` скриптом `scripts/prepare-www.mjs`.

## Публичная сборка

В production publish directory разрешены только:

1. `index.html`
2. `styles.css`
3. `app.js`
4. `native-bundle.js`
5. `config.js`
6. `manifest.webmanifest`
7. `sw.js`
8. `apple-touch-icon.png`
9. `icon-192.png`
10. `icon-512.png`

SQL, документы, тесты, lockfile, package metadata и внутренние инструкции не публикуются.

## Зависимости

- `@supabase/supabase-js`: `2.112.4` в браузере, SRI закреплён.
- `@capacitor/core`: `7.6.8`
- `@capacitor/android`: `7.6.8`
- `@capacitor/ios`: `7.6.8`
- `@capacitor/cli`: `7.6.8`
- `@capacitor/app`: `7.1.2`
- Package manager: `pnpm 11.19.0`
- Node.js: минимум `20`

Lockfile обязателен. Install scripts при аудиторской установке не запускались.

## Таблицы Supabase

- `profiles`
- `services`
- `tasks`
- `responses`
- `conversations`
- `messages`
- `favorites`
- `reports`
- `subscriptions`

На 28 августа 2026 года анонимный запрос количества строк показал `0` во всех таблицах.

## Классификация данных

### Публичные

- Supabase URL и anon/publishable key;
- публичные карточки услуг и безопасные поля профиля;
- статические изображения и интерфейс.

### Внутренние, но не секретные

- SQL-схемы и RLS-политики;
- отчёты аудита, тесты, workflow;
- package metadata и lockfile.

Они хранятся в репозитории, но не публикуются как файлы сайта.

### Секретные

- пароль базы;
- `service_role` key;
- access/refresh tokens;
- personal access tokens GitHub/Netlify/Supabase;
- recovery codes;
- незашифрованные дампы и персональные документы.

Секретные данные не должны появляться в Git, Deploy Preview, документах, снимках экрана и сообщениях.

## Команды проверки

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm audit --prod --audit-level low
pnpm exec cap sync
```

## Границы текущей версии

Не реализованы защищённые серверные процессы для KYC, профессиональной проверки, поддержки, жалоб, восстановления пароля, платежей, подписок и администрирования. Демо-карточки и бонусы не подтверждают реальных пользователей и не имеют денежной ценности.
