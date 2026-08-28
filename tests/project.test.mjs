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
    'icon-192.png',
    'icon-512.png',
    'index.html',
    'manifest.webmanifest',
    'native-bundle.js',
    'specialist-portraits-v1.png',
    'styles.css',
    'sw.js'
  ]);
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

test('browser dependency is version-pinned and integrity-protected', async () => {
  const html = await read('index.html');
  assert.match(html, /@supabase\/supabase-js@2\.112\.4\/dist\/umd\/supabase\.js/);
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(html, /crossorigin="anonymous"/);
  assert.doesNotMatch(html, /@supabase\/supabase-js@2["/]/);
});

test('map dependency is stable, pinned and integrity-protected', async () => {
  const html = await read('index.html');
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(html, /sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY=/);
  assert.match(html, /sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo=/);
});

test('service worker never caches cross-origin API responses', async () => {
  const worker = await read('sw.js');
  assert.match(worker, /url\.origin!==self\.location\.origin/);
  assert.match(worker, /response\.type==='basic'/);
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
  assert.match(app, /Полное ФИО/);
  assert.match(app, /Не менее 12 символов/);
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

test('public Supabase key is an anon key for the expected project', async () => {
  const config = await read('config.js');
  const match = config.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/);
  assert.ok(match, 'SUPABASE_ANON_KEY is missing');
  const parts = match[1].split('.');
  assert.equal(parts.length, 3);
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.role, 'anon');
  assert.equal(payload.ref, 'llnjgyehxsogjmwegnyf');
});

test('Netlify config includes core security headers', async () => {
  const config = await read('netlify.toml');
  assert.match(config, /publish = "www"/);
  for (const header of [
    'Content-Security-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options'
  ]) {
    assert.match(config, new RegExp(header));
  }
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
