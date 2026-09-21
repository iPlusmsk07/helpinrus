import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(join(root, file), 'utf8');

async function collectTextFiles(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'www') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(path));
    else if (/\.(?:js|mjs|json|html|css|sql|toml|txt|md|ya?ml)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test('production bundle contains only approved public files', async () => {
  execFileSync(process.execPath, [join(root, 'scripts/prepare-www.mjs')], { cwd: root });
  const files = (await readdir(join(root, 'www'))).sort();
  assert.deepEqual(files, [
    'app.js',
    'apple-touch-icon.png',
    'config.js',
    'home-hero-v2.jpg',
    'icon-192.png',
    'icon-512.png',
    'index.html',
    'manifest.webmanifest',
    'native-bundle.js',
    'specialist-portraits-v1.png',
    'styles.css',
    'sw.js'
  ]);
  assert.doesNotMatch(await read('styles.css'), /home-hero-v2\.jpg/);
  for (const privateFile of [
    'package.json',
    'supabase-schema.sql',
    'supabase-auth-migration.sql',
    'supabase-security-hardening.sql',
    'supabase-product-experience.sql',
    'README_УСТАНОВКА.txt'
  ]) {
    assert.ok(!files.includes(privateFile));
  }
});

test('frontend has no third-party authentication runtime', async () => {
  const html = await read('index.html');
  const config = await read('config.js');
  assert.doesNotMatch(html, /supabase|cdn\.jsdelivr\.net/i);
  assert.doesNotMatch(config, /SUPABASE|eyJ[A-Za-z0-9_-]+\./);
  assert.match(config, /API_BASE:\s*''/);
});

test('maps use Yandex and do not load Leaflet', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  assert.doesNotMatch(html, /leaflet/i);
  assert.doesNotMatch(app, /openstreetmap|window\.L|L\.map/i);
  assert.match(app, /api-maps\.yandex\.ru\/2\.1/);
  assert.match(app, /static-maps\.yandex\.ru\/1\.x/);
  assert.match(app, /controls:\['zoomControl'\]/);
  assert.doesNotMatch(app, /controls:\[[^\]]*(?:trafficControl|rulerControl)/);
  assert.match(app, /map-location-button/);
  assert.match(app, /map-zoom-stack/);
  assert.doesNotMatch(app, /button \"Пробки\"|trafficControl|rulerControl/);
  assert.match(app, /pm2rdm/);
  assert.match(app, /class="map-user-marker"/);
  assert.match(app, /class="map-person-marker"/);
  assert.match(app, /openService\(\$\{arg\(item\.id\)\}\)/);
  assert.match(app, /Нажмите на карту, чтобы отметить нужное место/);
  assert.doesNotMatch(app, /preset:'islands#greenIcon'/);
  assert.match(app, /preset:'islands#redIcon'/);
  assert.match(app, /classList\.add\('draggable-map'\)/);
  assert.match(app, /onpointerdown/);
  assert.match(app, /onpointermove/);
  assert.match(app, /onpointerup/);
});

test('navigation, modals, favorites and native pickers match the polished interaction', async () => {
  const app = await read('app.js');
  const styles = await read('styles.css');
  assert.match(app, /const searchIcon=/);
  assert.match(app, /const homeIcon='<svg class="nav-icon nav-home-icon"/);
  assert.match(app, /const plusIcon='<svg class="nav-icon plus-icon"/);
  assert.doesNotMatch(app, /\['home','⌂'/);
  assert.match(app, /<span class="intent-icon">\$\{plusIcon\}<\/span>/);
  assert.doesNotMatch(app, /helping-hand-icon/);
  assert.match(styles, /\.desktop-nav button span\{[^}]*font-size:28px/);
  assert.match(styles, /\.nav-icon\{width:28px;height:28px/);
  assert.match(styles, /\.intent-icon \.nav-icon\{width:31px;height:31px/);
  assert.doesNotMatch(app, /modal-handle/);
  assert.doesNotMatch(styles, /\.modal-handle/);
  assert.match(styles, /\.favorite-button\.active\{color:#e21d3d/);
  assert.match(app, /\$\{favorite\?'♥':'♡'\}/);
  assert.match(app, /function openWheelPicker\(kind\)/);
  assert.doesNotMatch(app, /Object\.assign\(window,\{[^}]*openNativePicker/);
  assert.match(app, /Object\.assign\(window,\{[^}]*openWheelPicker[^}]*confirmWheelPicker/);
  assert.match(app, /День \/ Месяц \/ Год/);
  assert.match(app, /24-часовой формат/);
  assert.match(app, /Array\.from\(\{length:24\}/);
  assert.match(app, /function bindWheelLists\(\)/);
  assert.match(app, /addEventListener\('scroll'/);
  assert.match(styles, /\.wheel-picker/);
});

test('home and catalog follow the requested two-screen flow', async () => {
  const app = await read('app.js');
  const styles = await read('styles.css');
  const homeBody = app.slice(app.indexOf('function home(){'), app.indexOf('function homeMapPanel'));
  const catalogBody = app.slice(app.indexOf('function catalog(){'), app.indexOf('function activeSubcategoryBar'));
  assert.match(styles, /\.home-hero\{[^}]*background:var\(--brand\)/);
  assert.match(styles, /--intent-green:#13795b/);
  assert.match(styles, /\.intent-card\.find,\.intent-card\.offer\{background:var\(--intent-green\)\}/);
  assert.doesNotMatch(homeBody, /homeMapPanel|homeMap/);
  assert.match(homeBody, /<h2>Категории<\/h2>/);
  assert.match(homeBody, /visible\.map\(categoryCard\)/);
  assert.doesNotMatch(homeBody, /Популярные категории|Все категории|Специалисты рядом/);
  assert.match(app, /categoryTone/);
  assert.match(app, /category\.subs\.push\('Другое'\)/);
  assert.match(app, /showOtherSearch\(id\)/);
  assert.match(app, /state\.query=state\.otherKeywords/);
  assert.match(app, /function selectIntent[^\n]+state\.view='list'/);
  assert.match(app, /function showAllSpecialists[^\n]+state\.view='list'/);
  assert.match(app, /function go[^\n]+render\(\);scrollPageTop\(\)/);
  assert.doesNotMatch(catalogBody, /Поиск рядом|category-scroll|activeSubcategoryBar/);
  assert.match(catalogBody, /catalog-actions/);
  assert.match(app, /minRating/);
  assert.match(app, /Рейтинг специалиста/);
  assert.doesNotMatch(app, /Только с подтверждённой личностью/);
  assert.match(app, /Выберите направление внутри основной категории/);
  assert.match(app, /Войдите, чтобы общаться и помогать/);
  assert.match(app, /Задачи и предложения помощи связаны с профилями только реальных пользователей/);
  assert.match(app, /Вход и регистрация/);
  assert.doesNotMatch(app, /и найти человека по ФИО/);
});

test('site-wide search, creation and profile changes are present', async () => {
  const app = await read('app.js');
  const styles = await read('styles.css');
  assert.match(app, /title:'Аналитика'/);
  assert.match(app, /title:'Работа'/);
  assert.match(app, /Выберите основную категорию, а затем конкретное направление/);
  assert.match(app, /toggleHomeCategories/);
  assert.match(app, /recommendedServices\(\)\.slice\(0,6\)/);
  assert.match(app, /Специалист или категория/);
  assert.match(app, /submitSearchOnEnter\(event\)/);
  assert.match(app, /step="0\.1"/);
  assert.match(app, /Ключевые слова для направления «Другое»/);
  assert.match(app, /showAllMapResults/);
  assert.match(app, /Подходящие специалисты/);
  assert.doesNotMatch(app, /class="online-dot"/);
  assert.match(app, /distanceEnabled/);
  assert.match(app, /Опишите, в чём заключается проблема/);
  assert.match(app, /Где и когда нужно решить проблему\?/);
  assert.match(app, /placeholder="Место проблемы"/);
  assert.match(app, /value="00:00"/);
  assert.match(app, /Сколько готовы заплатить за помощь/);
  assert.match(app, /Найти человека по ФИО или специальности/);
  assert.match(app, /<h2>Данные профиля<\/h2>/);
  assert.match(app, /Мои объявления/);
  assert.match(app, /Мои избранные/);
  assert.match(app, /Продвинуть себя и своё объявление/);
  assert.match(app, /profileSection\('Основные'/);
  assert.match(styles, /--green:#8f1d46/);
  assert.match(styles, /\.home-specialist-grid/);
  assert.match(styles, /h1,h2\{font-size:36px\}/);
  assert.match(styles, /\.section-heading h2\{color:var\(--ink\);font-size:36px\}/);
  assert.match(styles, /\.section-heading p\{margin-top:4px;font-size:24px\}/);
  assert.match(styles, /\.category-card b\{font-size:20px\}/);
  assert.match(styles, /\.category-card small\{[^}]*font-size:15px/);
  assert.match(styles, /\.category-card \.category-mark\{font-size:15px\}/);
  assert.match(styles, /\.specialist-grid \.specialist-card\{width:70%;justify-self:center\}/);
  assert.match(styles, /\.map-results \.specialist-card\{width:70%;justify-self:center\}/);
  assert.match(styles, /\.home-specialist-grid \.specialist-photo\{aspect-ratio:16\/11\}/);
  assert.match(styles, /\.map-results \.specialist-photo\{aspect-ratio:16\/11\}/);
  assert.match(styles, /\.specialist-photo \.portrait\{background-size:200% auto/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*\.specialist-photo \.portrait\{background-size:auto 200%\}/);
  assert.match(styles, /\.segmented button,\.view-switch button\{[^}]*font-size:1\.2rem/);
  assert.match(styles, /\.filter-button\{[^}]*background:var\(--brand\);color:#fff[^}]*font-size:1\.2rem/);
  assert.match(styles, /\.filter-button:hover\{[^}]*color:#fff/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*\.specialist-grid \.specialist-card,\.map-results \.specialist-card\{width:100%\}/);
  assert.match(styles, /\.desktop-nav button small\{font-size:28px/);
  assert.match(app, /emptyState\('Ничего не найден','Измените категорию, расстояние или поисковый запрос\.'\)/);
  assert.doesNotMatch(app, /<div class="empty-state"><span>/);
  const profileBody = app.slice(app.indexOf('function profile(){'), app.indexOf('function profileSection'));
  assert.ok(profileBody.indexOf('Сбросить пароль') < profileBody.indexOf('Конфиденциальность'));
});

test('requested home, navigation and authentication UI is present', async () => {
  const app = await read('app.js');
  const styles = await read('styles.css');
  assert.doesNotMatch(app, /Помощь рядом и онлайн|12 направлений|Профили с понятной специализацией|Новая публикация|Личные сообщения/);
  assert.match(app, /Выбрать подходящего специалиста/);
  assert.match(app, /Яндекс/);
  assert.match(app, /Госуслуги/);
  assert.match(app, /Мои избранные/);
  assert.match(app, /localFavoritesKey/);
  assert.match(app, /function localFavoritesStorageKey\(userId\)/);
  assert.match(app, /function arg\(value\)\{return escapeHtml\(JSON\.stringify\(value\)\)\}/);
  assert.match(app, /function requireSession\(\)\{if\(state\.session\)return true/);
  assert.match(app, /async function toggleFavorite\(id\)\{if\(!requireSession\(\)\)return/);
  assert.match(app, /function contactService\(ownerId\)\{if\(!requireSession\(\)\)return/);
  assert.match(app, /async function startDirectChat\(otherUser\)\{if\(!requireSession\(\)\|\|!sb\)return legacyDataUnavailable\(\)/);
  assert.match(app, /async function openConversation\(id\)\{if\(!requireSession\(\)\|\|!sb\)return legacyDataUnavailable\(\)/);
  assert.match(app, /async function sendMessage\(event\)\{event\.preventDefault\(\);if\(!requireSession\(\)\|\|!sb\)return legacyDataUnavailable\(\)/);
  assert.doesNotMatch(app, /state\.favorites=loadLocalFavorites\(\)/);
  assert.match(app, /saveLocalFavorites\(\)/);
  assert.match(styles, /\.desktop-nav/);
  assert.match(app, /class="nav-icon nav-chat-icon"/);
  assert.doesNotMatch(app, /class="top-actions"/);
  assert.doesNotMatch(app, /class="top-avatar"/);
  assert.match(styles, /\.topbar\{[^}]*justify-content:flex-start/);
  assert.match(app, /Телефон или почта/);
  assert.doesNotMatch(app, /Запомнить пароль|name="remember"|class="remember-password"/);
  assert.match(app, /Нет аккаунта в Помогай\?/);
  assert.match(app, /credentialsForIdentity/);
  assert.doesNotMatch(app, /Шаг 1 из 2|Шаг 2 из 2/);
  assert.match(app, /8 или более символов/);
  assert.match(app, /Используйте буквы и цифры/);
  assert.doesNotMatch(app, /Хотя бы одна/);
  assert.match(app, /passwordIsValid/);
  assert.match(app, /function passwordField/);
  assert.match(app, /name="password" type="password"\$\{validation\}/);
  assert.equal((app.match(/passwordField\(\{id:'/g)||[]).length,3);
  assert.match(app, /id:'loginPassword'/);
  assert.match(app, /id:'signupPassword',autocomplete:'new-password',validate:true/);
  assert.match(app, /id:'newPassword',label:'Новый пароль'/);
  assert.match(app, /class="password-toggle" type="button"/);
  assert.match(app, /aria-pressed="false"/);
  assert.match(app, /function togglePasswordVisibility\(button\)/);
  assert.match(app, /input\.type=show\?'text':'password'/);
  assert.match(app, /Object\.assign\(window,\{[^}]*togglePasswordVisibility/);
  assert.match(styles, /\.password-field\{display:grid/);
  assert.match(styles, /\.password-toggle\{width:54px;height:100%/);
  assert.match(app, /Зарегистрироваться через Яндекс/);
  assert.match(app, /Зарегистрироваться через Госуслуги/);
  assert.match(app, /Введите email в формате name@example\.com или номер телефона с кодом страны/);
  assert.match(app, /Регистрация по телефону пока не поддерживается/);
  assert.match(app, /function requestSignupEmail\(event\)/);
  assert.match(app, /apiRequest\('\/api\/auth\/signup',\{method:'POST',body:\{email:details\.credential\}\}\)/);
  assert.match(app, /friendlySignupError/);
  assert.match(app, /Не удалось создать аккаунт или отправить код/);
  assert.match(app, /Signup request[^\n]+friendlySignupError\(error,details\.method\)/);
  assert.doesNotMatch(app, /Подтвердите email/);
  assert.doesNotMatch(app, /Мы отправили ссылку/);
  assert.match(app, /function showSignupEmailSent\(email\)/);
  assert.match(app, /apiRequest\('\/api\/auth\/signup\/confirm'/);
  assert.match(app, /body:\{token,password\}/);
  assert.doesNotMatch(app, /apiRequest\('\/api\/auth\/signup',\{method:'POST',body:\{email,password\}/);
  assert.match(app, /email_not_configured/);
  assert.match(app, /email_delivery_failed/);
  assert.match(app, /Введите email — отправим безопасную одноразовую ссылку/);
  assert.match(app, /apiRequest\('\/api\/auth\/password-reset\/request'/);
  assert.match(app, /apiRequest\('\/api\/auth\/password-reset\/confirm'/);
  assert.match(app, /showPasswordResetEmailSent/);
  assert.doesNotMatch(app, /resetPasswordForEmail|signInWithOtp|verifyPasswordResetCode/);
  assert.match(app, /new URLSearchParams\(parsed\.hash\.replace\(\/\^#\/,''\)\)/);
  assert.match(app, /type=hash\.get\('auth'\),token=hash\.get\('token'\)/);
  assert.doesNotMatch(app, /parsed\.searchParams\.get\('token'\)|for\(const params of\[hash,parsed\.searchParams\]\)/);
  assert.match(app, /history\.replaceState\(\{\},document\.title,`\$\{parsed\.pathname\}\$\{parsed\.search\}`\)/);
  assert.match(app, /function hasAuthCallbackParams/);
  assert.match(app, /function authCallbackFromUrl/);
  assert.match(app, /if\(hasAuthCallbackParams\(\)\)/);
  assert.match(app, /showNewPassword\(callback\.token\)/);
  assert.match(app, /showSignupPassword\(callback\.token\)/);
  assert.match(app, /Сервис аккаунтов временно недоступен\. Попробуйте позже\./);
  assert.match(app, /apiRequest\('\/api\/auth\/session'/);
  assert.match(app, /apiRequest\('\/api\/auth\/login'/);
  assert.match(app, /apiRequest\('\/api\/auth\/signup'/);
  assert.match(app, /apiRequest\('\/api\/auth\/logout'/);
  assert.match(app, /contentType!=='application\/json'/);
  assert.match(app, /failure\.code='invalid_api_response'/);
  assert.doesNotMatch(app, /sb\.auth\./);
});

test('service worker never caches cross-origin API responses', async () => {
  const worker = await read('sw.js');
  assert.match(worker, /url\.origin!==self\.location\.origin/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /response\.type==='basic'/);
});

test('release assets bypass stale browser caches on the IP production site', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  const worker = await read('sw.js');
  assert.match(html, /styles\.css\?v=20260919-2/);
  assert.match(html, /app\.js\?v=20260919-2/);
  assert.match(app, /sw\.js\?v=20260919-2/);
  assert.match(app, /updateViaCache:'none'/);
  assert.match(worker, /pomogay-ip-cache-refresh-17/);
});

test('client does not persist profile, tasks, messages or trust state', async () => {
  const app = await read('app.js');
  for (const key of ['pm_user', 'pm_tasks', 'pm_messages', 'pm_trust_score']) {
    assert.doesNotMatch(app, new RegExp(`setItem\\(['"]${key}`));
  }
  assert.doesNotMatch(app, /identity_verified\s*=\s*true/);
  assert.doesNotMatch(app, /legal_verified\s*=\s*true/);
  assert.match(app, /Untrusted auth callback URL/);
  assert.match(app, /clearPrivateSessionState/);
  assert.match(app, /Проверка документов пока не подключена/);
  assert.match(app, /Канал поддержки пока не подключён/);
  assert.match(app, /Отправка жалоб пока не подключена/);
  assert.match(app, /реальные деньги не списываются/);
  assert.match(app, /<span>ФИО \$\{locked/);
  assert.doesNotMatch(app, /<span>Полное ФИО<\/span>/);
  assert.match(app, /Пароль должен содержать минимум 8 символов, буквы и цифры/);
  assert.match(app, /Укажите полное ФИО/);
  assert.match(app, /Завершите профиль: укажите полное ФИО и дату рождения/);
  assert.match(app, /Восстановление пароля/);
  assert.match(app, /max="500"/);
  assert.match(app, /start_direct_conversation/);
  assert.doesNotMatch(app, /\bprompt\(/);
  assert.doesNotMatch(app, /setTimeout\(\(\)=>\{state\.messages/);
  assert.doesNotMatch(app, /const row=\{[^}]*role:/);
  assert.doesNotMatch(app, /\.update\(\{name:registeredName,updated_at:/);
});

test('Supabase profile privileges cannot be self-assigned', async () => {
  const authMigration = await read('supabase-auth-migration.sql');
  const hardening = await read('supabase-security-hardening.sql');
  const productExperience = await read('supabase-product-experience.sql');
  assert.doesNotMatch(authMigration, /raw_user_meta_data->>'role'/);
  assert.match(authMigration, /'customer'/);
  assert.match(hardening, /revoke all on table public\.profiles/);
  assert.match(hardening, /grant update \(name, city, avatar_url\)/);
  assert.doesNotMatch(hardening, /grant update \([^)]*verified/);
  assert.doesNotMatch(hardening, /grant update \([^)]*role/);
  assert.match(hardening, /grant insert \(task_id, helper_id, price, message\)/);
  assert.doesNotMatch(hardening, /grant insert \([^)]*status[^)]*\) on table public\.responses/);
  assert.match(hardening, /and status = 'pending'/);
  assert.match(authMigration, /file_size_limit, allowed_mime_types/);
  assert.match(authMigration, /5242880/);
  assert.match(productExperience, /create table if not exists public\.profile_private/);
  assert.match(productExperience, /profile private self read/);
  assert.match(productExperience, /protect_verified_identity/);
  assert.match(productExperience, /start_direct_conversation/);
  assert.match(productExperience, /revoke all on table public\.profile_private/);
});

test('public config contains no authentication secret', async () => {
  const config = await read('config.js');
  assert.doesNotMatch(config, /SUPABASE|SERVICE_ROLE|PASSWORD|SECRET|eyJ[A-Za-z0-9_-]+\./);
  assert.match(config, /API_BASE:\s*''/);
});

test('production Nginx proxies auth only to the local backend', async () => {
  const snippet = await read('ops/nginx-helpinrus-auth-api.conf');
  const installer = await read('ops/install-auth-backend.sh');
  assert.match(snippet, /location \^~ \/api\/auth\//);
  assert.match(snippet, /proxy_pass http:\/\/127\.0\.0\.1:8787/);
  assert.match(snippet, /client_max_body_size 16k/);
  assert.match(snippet, /proxy_set_header X-Forwarded-Proto \$scheme/);
  assert.match(snippet, /proxy_connect_timeout 3s/);
  assert.match(snippet, /proxy_read_timeout 120s/);
  assert.match(installer, /nginx -t/);
  assert.match(installer, /systemctl reload nginx/);
  assert.match(installer, /patch_nginx\.py/);
});

test('GitHub checks run with read-only permissions and a pinned action', async () => {
  const workflow = await read('.github/workflows/security-and-quality.yml');
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /permissions:\s*write-all/);
});

test('repository contains no obvious private-key or service-role material', async () => {
  const textFiles = await collectTextFiles();
  const content = (await Promise.all(textFiles.map(file => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(content, /\bservice_role\b\s*[:=]/i);
  assert.doesNotMatch(content, /\bsb_secret_[A-Za-z0-9_-]+/);
});
