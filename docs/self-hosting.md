# Self-hosting

## Quick start

From a checkout, run `docker compose up`, then open http://localhost:3000 and register. The first real account becomes admin, including when the demo user has been seeded. Docker Compose v2 is the only host requirement. `init` creates missing secrets, applies migrations, imports the bundled taxonomy, and optionally seeds the demo before web and worker start. It needs no network downloads at boot or managed services.

Configure your own AI provider in Settings (or an instance provider in Admin); no fallback API key is supplied. Manual editing works without a provider. See [architecture](architecture.md) and [adding a provider](adding-a-provider.md).

## Configuration

All overrides are optional and documented in [.env.example](../.env.example). Copy it to `.env` only when changing defaults. `APP_URL` must be the public URL used by users, emails, and auth callbacks; `PATHWISE_PORT` changes the host's published web port. Put a TLS reverse proxy in front for a public deployment. Postgres has no published host port. Changing `POSTGRES_PASSWORD` after initialization does not change the existing database password.

The `pathwise-secrets` volume stores generated `APP_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` unless supplied in the environment. Provider keys are encrypted with AES-256-GCM and never returned to the client. Back up secrets with the database.

## Email

For a transactional SMTP provider, set these optional values in `.env` using the provider's actual host, credentials, and verified sender:

```dotenv
APP_URL=https://career.example.org
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=Pathwise <coach@example.org>
```

Authenticated SMTP on port 587 requires STARTTLS; port 465 uses implicit TLS. Leaving `SMTP_HOST` unset disables email: check-ins work in-app, and an operator can reset passwords through the CLI. Restart/recreate services after configuration changes with `docker compose up -d`.

## Local LLMs

With llama.cpp installed on the host, start an OpenAI-compatible server:

```bash
llama-server -hf ggml-org/gemma-3-4b-it-GGUF --jinja -c 8192 --host 0.0.0.0 --port 8080
```

In Settings, choose **OpenAI-compatible**, base URL `http://host.docker.internal:8080/v1`, a model name accepted by your server (an arbitrary name works when the server ignores it), and context window **8192**. Main and fast may be the same model; embeddings are optional. Save and test the provider. Degraded is acceptable when basic completion and streaming pass: JSON has a validated repair fallback and chat can work without tools. The capability test determines which path is used; unsupported configs cannot activate.

Compose maps `host.docker.internal` to the host gateway for web and worker. Admins can configure private endpoints by default. For non-admins to configure a host/private server, set `CUSTOM_ENDPOINTS=all` and `ALLOW_PRIVATE_ENDPOINTS=true`; otherwise private addresses are rejected. `CUSTOM_ENDPOINTS=off` disables custom endpoints.

From a dev checkout, the manual smoke uses an isolated Testcontainers database (Docker required), capability probe, and onboarding pass:

```bash
LOCAL_LLM_BASE_URL=http://localhost:8080/v1 LOCAL_LLM_MODEL=local-model pnpm smoke:local
```

Use a URL reachable from the process running the harness. `LOCAL_LLM_API_KEY` is optional for authenticated endpoints. These `LOCAL_LLM_*` variables are developer-only, not compose settings. An Ollama-compatible server was also verified with `http://host.docker.internal:11434/v1` and model `qwen3.5:4b-mlx`; use the model name actually installed on your server.

## Demo persona

Seed during initialization:

```bash
SEED_DEMO=true docker compose up
```

Or seed a running instance and obtain a password:

```bash
docker compose exec worker pathwise seed demo
docker compose exec worker pathwise admin reset-password demo@pathwise.local
```

Sign in as `demo@pathwise.local`. The demo account is disposable; it is a normal user with a profile, stories, conversation, and plan, not the bootstrap admin. CLI seeding prints a new password once to the operator's terminal. Init logs only the email and reset command, never the password. Re-seeding an existing complete demo is a no-op. An email collision with an incomplete/non-demo account is refused without deleting data. Use `seed demo --email another@example.org` for a separate demo account.

## Backups and restore

Back up all three volumes: the Postgres database, `pathwise-files`, and `pathwise-secrets`. Losing `pathwise-secrets` makes stored API keys undecryptable; users must re-enter keys. Volume names are `<project>_pathwise-*`; a clone in `Pathwise/` defaults to project `pathwise`. Check `docker volume ls` and substitute your project prefix if different. Keep backups private: they contain user data and encryption keys.

For a consistent backup, stop web and worker while copying the files/secrets and taking the dump (`docker compose stop web worker`), then restart them after backup (`docker compose start web worker`). The following commands use the default project name; restore replaces the backed-up database contents. Restore files/secrets into empty volumes, or remove newer files separately before restoring, so deleted uploads do not remain.

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U pathwise -d pathwise -Fc > backups/pathwise-db.dump
docker run --rm -v pathwise_pathwise-files:/data -v "$PWD/backups":/backup alpine tar czf /backup/pathwise-files.tgz -C /data .
docker run --rm -v pathwise_pathwise-secrets:/data -v "$PWD/backups":/backup alpine tar czf /backup/pathwise-secrets.tgz -C /data .
# Restore
docker compose down && docker compose up -d postgres
docker compose exec -T postgres pg_restore -U pathwise -d pathwise --clean --if-exists < backups/pathwise-db.dump
docker run --rm -v pathwise_pathwise-files:/data -v "$PWD/backups":/backup alpine sh -c "cd /data && tar xzf /backup/pathwise-files.tgz"
docker run --rm -v pathwise_pathwise-secrets:/data -v "$PWD/backups":/backup alpine sh -c "cd /data && tar xzf /backup/pathwise-secrets.tgz"
docker compose up -d
```

Wait for `docker compose exec postgres pg_isready -U pathwise -d pathwise` to succeed after starting Postgres before running `pg_restore`. Include any environment-supplied secrets in your own protected backup procedure; the volume cannot back up environment variables.

## Upgrades

Back up first, then run `git pull && docker compose up -d --build`. Init applies migrations before web and worker start. Review release/spec changes when upgrading; the database and file volumes persist.

## Encryption-key rotation

Run:

```bash
docker compose exec worker pathwise admin rotate-encryption-key
docker compose restart web worker
```

[rotate.ts](../packages/core/src/crypto/rotate.ts) uses `/var/lib/pathwise/secrets/APP_ENCRYPTION_KEY` and the adjacent `.next` and `.previous` files:

1. Verify all stored provider keys can be decrypted with the available keyring before writing anything.
2. Reuse an existing `APP_ENCRYPTION_KEY.next` from an interrupted run, or write a new 32-byte key there (0600). Durable writes use a `.tmp` file, fsync, and rename.
3. Lock encrypted provider rows and re-encrypt them with the next key in one database transaction.
4. Durably write the old current key to `APP_ENCRYPTION_KEY.previous`.
5. Rename `.next` over `APP_ENCRYPTION_KEY` and fsync the secrets directory. The current key file always exists.
6. Restart web and worker to make the new current key their encryption key. [loadKeyring](../packages/core/src/crypto/keyring.ts) reads current, `.next`, and `.previous` on every decryption call, so running processes can decrypt during rotation. Re-running completes an interrupted rotation.

The command refuses rotation when `APP_ENCRYPTION_KEY` is set in the environment because that value overrides the volume. Move the existing value to the current key file with mode 0600, remove the environment override, restart, then rotate. Keep the rotation files in secret backups; do not delete them while processes may still use an older key.

## Admin CLI

Run commands as `docker compose exec worker pathwise <command>`. Current usage from [cli.ts](../apps/worker/src/cli.ts):

```text
Usage: pathwise <command>

Commands:
  admin reset-password <email>   Set a new random password for a user
  admin rotate-encryption-key      Re-encrypt stored API keys with a new key
  checkin start <email>          Open this week's check-in for a user now
  seed demo [--email <email>]       Load the demo persona (prints its password once)
  healthcheck                    Exit 0 if the worker heartbeat is fresh
```

`checkin start` opens this week's check-in now; repeated runs for the same week do not create another. `healthcheck` exits 0 for a fresh worker heartbeat and 1 otherwise. Passwords print only to the operator's stdout. Admin's job queue page shows counts and dead letters; Retry redrives a job and Discard deletes its dead letter. Counts may be cached up to a minute.

## Tracing and logs

Tracing is disabled unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. For a local Jaeger collector:

```bash
docker run -d --name jaeger -p 4318:4318 -p 16686:16686 jaegertracing/jaeger:2
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318` in `.env` and recreate services with `docker compose up -d`. Pathwise appends `/v1/traces`; use the collector base URL. Open http://localhost:16686 for the UI and services `pathwise-web` / `pathwise-worker`. A tracing startup failure warns and leaves the app running.

Default traces contain timings and token counts, not prompts, replies, document text, or tool input/output. Provider/tool exception details and stack traces are sanitized in the telemetry copy to avoid content leaks. `LOG_CONTENT=true` enables content recording for development, including those errors; use it only with data you intend to record. Logs are structured and content-free by default. Follow them with `docker compose logs -f web worker`.

See [memory and data rights](memory-model.md) for export and deletion scope.
