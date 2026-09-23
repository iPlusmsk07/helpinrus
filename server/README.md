# Helpinrus authentication API

This directory contains a dependency-free Python authentication service for the
same origin as the static Helpinrus frontend. It replaces account operations
that previously depended on a hosted backend; it does not expose the SQLite
database or session tokens to the browser.

## API contract

All responses are JSON except successful logout (`204`). All `POST` requests
must have `Content-Type: application/json` and an `Origin` exactly listed in
`ALLOWED_ORIGINS`. Browser requests must use `credentials: "same-origin"`.

| Method | Path | Request | Success |
| --- | --- | --- | --- |
| `GET` | `/api/auth/health` | — | `200 {"status":"ok","database":"ok","email":"configured|not_configured"}` |
| `GET` | `/api/auth/session` | — | `200 {"user":null}` or `200 {"user":{...}}` |
| `POST` | `/api/auth/signup` | `{"email"}` | generic `202 {"message":"verification_sent"}`; no user, password, or session yet |
| `POST` | `/api/auth/signup/confirm` | `{"token","password"}` | `201 {"user":{...}}` and session cookie |
| `POST` | `/api/auth/login` | `{"email","password"}` | `200 {"user":{...}}` and session cookie |
| `POST` | `/api/auth/logout` | `{}` | `204` and expired session cookie |
| `POST` | `/api/auth/password-reset/request` | `{"email"}` | generic `202` when SMTP is configured; otherwise `503 email_not_configured` |
| `POST` | `/api/auth/password-reset/confirm` | `{"token","password"}` | `200 {"message":"password_updated"}` |

When SMTP is not configured, signup and reset requests return
`503 {"error":"email_not_configured"}` before any account lookup or rate-limit
write, so the UI cannot falsely claim that mail is available. SMTP delivery is
synchronous. Once SMTP is configured, signup and reset requests deliberately
return the same generic `202` for existing, unknown, accepted, and rejected
recipient addresses; provider failures are logged without addresses or bearer
tokens. This prevents account enumeration. Release preflight separately blocks
production cutover when the provider cannot establish TLS/authentication.

Signup emails link to `/#auth=verify&token=<opaque-token>`. Until that token is
confirmed, only the normalized email and keyed token digest are held in
`pending_signup_tokens`; no password, user row, or session exists. The user
chooses a password only after opening the link. Confirmation consumes the token
and atomically creates the verified user and initial session. Re-requesting
signup replaces the previously delivered link only after the new message was
accepted. A registered email receives the same generic `202` and no message.

Reset emails link to `/#auth=reset&token=<opaque-token>`. Both verification and
reset links use fragments to keep bearer tokens out of Nginx access logs and
referrer headers; the frontend must remove the fragment with
`history.replaceState` before making other requests. A newly staged reset token
does not revoke the prior active token unless SMTP accepts the new message. On
delivery failure, only the staged token is deleted. An invalid, expired, or
already-used token returns
`400 {"error":"invalid_or_expired_token"}`. A successful reset revokes every
existing session for that account.

Common errors are `invalid_email`, `invalid_password`, `email_not_configured`,
`invalid_credentials`, `invalid_origin`, and
`rate_limit_exceeded`. A `429` response includes `Retry-After`.

## Security properties

- Passwords are scrypt hashes with a unique random salt and a server-side
  pepper (`APP_SECRET`). Neither passwords nor the pepper are stored in SQLite.
- Session, verification, and reset tokens are generated with the OS CSPRNG.
  Only keyed HMAC digests are stored. Verification/reset tokens expire and are
  single-use.
- Sessions use an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie.
- Persistent per-IP and per-email rate limits are stored using keyed digests,
  not raw IP addresses or email addresses.
- State-changing calls require an exact allowlisted origin. Nginx overwrites
  `X-Real-IP`, so clients cannot choose their rate-limit identity.
- The database lives under `/var/lib/helpinrus`, outside the web root.

The service supports verified email/password accounts. Existing accounts from
another identity store do not appear automatically. An operator may reserve an
imported email with `reserve-user`; the generated placeholder cannot sign in.
The owner must receive a one-time reset link, choose a new password, and thereby
verify the email before the account becomes usable. A database created by the
older unverified service follows the same ownership-verified recovery path.

## Local checks

The macOS system Python in this workspace lacks OpenSSL scrypt support. Use the
bundled runtime locally; Ubuntu's production Python supports `hashlib.scrypt`.

```sh
/Users/macbook/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 \
  -m unittest discover -s server/tests -v
/Users/macbook/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 \
  -m compileall -q server ops/patch_nginx.py
bash -n ops/install-auth-backend.sh ops/deploy-helpinrus
```

To start a development instance, provide an explicit secret and HTTP origin:

```sh
HELPINRUS_ENV=development \
APP_SECRET='replace-with-at-least-32-random-bytes' \
PUBLIC_ORIGIN=http://127.0.0.1:8787 \
ALLOWED_ORIGINS=http://127.0.0.1:8787 \
DATABASE_PATH=/tmp/helpinrus-auth.sqlite3 \
COOKIE_SECURE=false \
SESSION_COOKIE_NAME=pomogay_session \
python3 -m server.main
```

For production administration, load `/etc/helpinrus/auth.env` without printing
it and use an interactive password prompt:

```sh
set -a
. /etc/helpinrus/auth.env
set +a
cd /opt/helpinrus
python3 -m server.manage migrate
python3 -m server.manage smtp-check
python3 -m server.manage create-user --email person@example.com
python3 -m server.manage reserve-user --email imported@example.com
```

`smtp-check` establishes SMTP/TLS/authentication and sends no message. The
interactive `create-user` command creates an already verified administrative
user. `reserve-user` creates an unverified imported account whose owner must use
password recovery; an optional `--id <uuid>` preserves a legacy UUID. No command
prints or accepts a verification/reset token. Do not pass passwords on the
command line.
