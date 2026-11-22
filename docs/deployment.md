# Deployment

Sprixy is a single container (API + web UI + MCP endpoint) with a SQLite database and files on one volume.
No GPU is needed: all AI work runs at your providers; image processing runs on CPU.

## Docker Compose

```bash
cp .env.example .env
# set SPRIXY_MASTER_KEY=$(openssl rand -base64 32)
docker compose up -d --build
```

The app listens on port **3210**. Data lives in the `sprixy-data` volume (`/data` in the container):
`sprixy.db` (SQLite, WAL), `files/` (assets, sources, datasets, editor documents).

## Coolify

1. **New resource → Docker Compose** (or **Dockerfile**) and point it at this repository.
2. Environment variables:
   - `SPRIXY_MASTER_KEY` — required, 32 random bytes in base64 (`openssl rand -base64 32`). Store it in your password
     manager: without it, stored provider keys cannot be decrypted.
   - `SPRIXY_SECURE_COOKIES=true` (Coolify serves HTTPS).
   - `SPRIXY_ALLOW_SIGNUP=false` unless you want other people to create accounts.
3. **Ports exposes**: `3210`. Attach your domain.
4. **Persistent storage**: the compose file declares the `/data` volume; with a Dockerfile resource add a volume
   mounted at `/data`.
5. Health check: `GET /api/health` (already defined in the image).

The first visitor creates the admin account — do it right after the first deployment.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `SPRIXY_MASTER_KEY` | — | AES-256 key (base64/hex, 32 bytes) for provider keys. If unset, a key is generated in the data dir (dev only). |
| `SPRIXY_ALLOW_SIGNUP` | `false` | Allow sign-ups after the first admin account. |
| `SPRIXY_SECURE_COOKIES` | `false` | Mark the session cookie `Secure` (enable behind HTTPS). |
| `SPRIXY_DATA_DIR` | `/data` (image) / `./data` | Database and files. |
| `PORT` / `HOST` | `3210` / `0.0.0.0` | Listen address. |
| `SPRIXY_PUBLIC_URL` | — | Public URL (informational). |
| `FFMPEG_PATH` | `/usr/bin/ffmpeg` (image) | ffmpeg used to extract animation frames. |
| `SPRIXY_MAX_UPLOAD_MB` | `50` | Max upload size per file. |
| `SPRIXY_SESSION_DAYS` | `30` | Session lifetime. |
| `SPRIXY_POLL_INTERVAL_MS` | `1500` | fal queue polling interval. |
| `SPRIXY_JOB_TIMEOUT_MS` | `1800000` | Hard timeout per job. |
| `LOG_LEVEL` | `info` | Fastify/pino log level. |

## Reverse proxy

Any proxy works (Traefik in Coolify, Caddy, nginx). Allow request bodies of ~50 MB (uploads, editor saves) and keep
the default timeouts: long jobs are asynchronous and polled, no request stays open for long.

## Backups

Back up the `/data` volume (stop the container or use `sqlite3 sprixy.db ".backup backup.db"` for a hot copy) and keep
`SPRIXY_MASTER_KEY` alongside.

## Upgrades

Pull, rebuild, restart. Database migrations run automatically at boot. Interrupted fal jobs resume; other in-flight
jobs are marked as interrupted (nothing is billed twice by Sprixy).
