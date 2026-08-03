ПОМОГАЙ — версия с Supabase

1. В Supabase открой SQL Editor.
2. Вставь содержимое файла supabase-auth-migration.sql и нажми Run.
   Ожидаемый результат: Success. No rows returned.
3. В GitHub удали старые файлы сайта или загрузи новые с заменой.
4. Загрузи ВСЕ файлы из этой папки в корень репозитория helpinrus.
5. Netlify автоматически создаст новый deploy.
6. В Supabase открой Authentication → URL Configuration:
   Site URL: https://helpinrus.netlify.app
   Redirect URLs: https://helpinrus.netlify.app/**
7. Для быстрого теста регистрации можно временно отключить подтверждение email:
   Authentication → Providers → Email → Confirm email = OFF.

Важно: config.js содержит только публичный publishable key. service_role сюда добавлять нельзя.
