# Production installation

The production layout is intentionally split:

- source: `/opt/helpinrus` (updated from GitHub `main`);
- stable static path: `/var/www/helpinrus` (a symlink after the first guarded
  release);
- immutable static releases: `/var/www/helpinrus-releases/<commit>-<time>-<pid>`;
- secret environment: `/etc/helpinrus/auth.env` (`0640`, never committed);
- SQLite state: `/var/lib/helpinrus/auth.sqlite3` (`0700` directory);
- API: `127.0.0.1:8787`, exposed only as same-origin `/api/auth/` by Nginx.

## First installation

After the backend files are merged into GitHub and pulled into
`/opt/helpinrus`, run once as root:

```sh
cd /opt/helpinrus
./ops/install-auth-backend.sh
```

The installer is idempotent. It creates an unprivileged `helpinrus` service
account, generates a random `APP_SECRET` if the environment file does not yet
exist, installs the systemd/Nginx configuration, validates Nginx before reload,
and installs a stable Git-to-production launcher. It never overwrites an
existing `/etc/helpinrus/auth.env`. An upgrade restarts the auth service even if
it was already enabled. If installation fails or is interrupted, the previous
Nginx site, auth snippet, systemd units, launcher, and service state are restored
before Nginx is validated and reloaded again.

The Nginx patch is fail-closed: it selects the TLS virtual host whose literal
`root` is `/var/www/helpinrus`; if that is unavailable, it falls back to
`server_name 201.51.4.212`. More than one equally valid match is an error instead
of a reason to modify an arbitrary TLS virtual host. Custom installations can
pass `--root` and one or more `--server-name` options directly to
`ops/patch_nginx.py`.

The regular Git deploy updates the pinned worker and application source, but it
does not overwrite installed files under `/etc/systemd/system`, `/etc/nginx`, or
`/usr/local/sbin`. Re-run `install-auth-backend.sh` after a committed change to
the service units, Nginx snippet/patcher, or stable launcher.

## SMTP is a deliberate second step

No SMTP password is assumed or committed. Until SMTP is configured, health
returns `"email":"not_configured"`, and signup/reset requests return
`503 {"error":"email_not_configured"}` before account lookup. The service sends
verification and reset mail synchronously. A rejected signup message returns
the same generic `202` as an accepted message and does not leave its new token
active. A reset request also keeps the same generic `202` response for existing
and unknown accounts, including an account-specific delivery failure. This
prevents email-address enumeration; the internal log omits the recipient and
token, the failed new token is removed, and an older active reset link remains
valid. Installation does not require SMTP so initial configuration can be
completed in two stages; production readiness does require the explicit
`smtp-check` and end-to-end mail test below.

Set these values in `/etc/helpinrus/auth.env` using a transactional email
provider and a verified sender with SPF/DKIM:

```text
SMTP_HOST=smtp.provider.example
SMTP_PORT=587
SMTP_MODE=starttls
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_FROM="Помогай <no-reply@example.com>"
```

Then restart and verify without exposing secrets:

```sh
systemctl restart helpinrus-auth
systemctl is-active helpinrus-auth
sudo -u helpinrus /bin/sh -c 'set -a; . /etc/helpinrus/auth.env; set +a; cd /opt/helpinrus; python3 -m server.manage smtp-check'
curl --fail --silent https://201.51.4.212/api/auth/health
```

`smtp-check` connects, negotiates TLS, authenticates, and runs SMTP `NOOP`; it
sends no message and returns nonzero when SMTP is unavailable. Logs and command
output do not include SMTP credentials, recipients, or bearer tokens.

An end-to-end release is not complete until a test account confirms its email,
receives a reset email, uses the one-time link, signs in with the new password,
and fails to sign in with the old password.

## Repeatable Git-to-production releases

`/usr/local/sbin/deploy-helpinrus` is a stable launcher. It fetches `main`, pins
the exact fetched commit, refuses to overwrite tracked local changes, checks out
that commit detached, and then invokes the `ops/deploy-helpinrus` worker from the
pinned commit itself. The worker runs frontend, backend, and operations tests,
builds the 12-file static bundle, executes `smtp-check` through a one-shot
systemd unit with the production `EnvironmentFile`, restarts the API, and waits
for local health before any static cutover. Local health probes have bounded
connect and total timeouts, so a wedged socket cannot stall a release forever.

Each bundle is prepared completely in a temporary directory under
`/var/www/helpinrus-releases`, receives its `.deployed-commit`, ownership, and
readability checks, and is validated for a non-empty `index.html` before it is
renamed to an immutable release directory. The final cutover replaces the
`/var/www/helpinrus` symlink atomically, so Nginx never observes a partially
populated new bundle. The marker/readability checks run again through the public
compatibility path after the switch; a failure restores the prior link.

### One-time migration of the existing public directory

Production currently has a physical `/var/www/helpinrus` directory. On the
first successful guarded release, after tests, SMTP, and API health have all
passed, the deploy worker:

1. renames that directory intact to
   `/var/www/helpinrus-releases/legacy-<UTC time>-<pid>` on the same filesystem;
2. creates `/var/www/helpinrus` as a symlink to that preserved legacy release;
3. atomically switches the symlink to the newly prepared release.

Replacing the original non-empty directory with its first compatibility
symlink inherently takes two filesystem renames rather than one. The worker
pre-creates the link, briefly ignores `INT`/`TERM` only between those renames,
and explicitly restores the directory if the second rename fails. A machine
crash or `SIGKILL` in that tiny one-time window can still require recreating
`/var/www/helpinrus` as a symlink to the preserved `legacy-*` directory. Later
release switches are single atomic symlink replacements.

The compatibility path used by the existing Nginx `root` therefore remains
`/var/www/helpinrus`. If the final verification fails, the symlink is atomically
returned to the previous release. The source checkout and API are then restored
to the previously deployed commit by the launcher. Orphaned failed release
directories are retained for inspection and can be pruned later; never delete
the directory currently returned by `readlink -f /var/www/helpinrus`.

Both launcher and worker handle `ERR`, `INT`, and `TERM`. The worker marks the
symlink transaction before the atomic rename, closing the signal window between
the rename and rollback bookkeeping. The static symlink is restored by the
worker, while the launcher restores the prior Git commit and restarts the prior
API. A failed SMTP probe blocks cutover even when environment variables merely
make health report `"email":"configured"`.

Useful checks:

```sh
systemctl status --no-pager helpinrus-auth
journalctl -u helpinrus-auth --since today --no-pager
ss -ltnp | grep 8787
nginx -t
curl --fail --silent --connect-timeout 2 --max-time 5 \
  http://127.0.0.1:8787/api/auth/health
readlink -f /var/www/helpinrus
cat /var/www/helpinrus/.deployed-commit
systemctl start helpinrus-auth-smtp-check.service
```

Back up the SQLite database with the online backup API (or stop the service
briefly before copying it), and keep `auth.sqlite3`, `auth.sqlite3-wal`, the
environment file, and backup encryption keys outside Git and the web root.
