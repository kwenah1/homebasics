# Deployment

The API runs on **Fly.io** (Docker, free allowance, sleeps when idle and wakes in about a
second) and the web app on **Vercel** (free, global CDN). The database is the Neon project
that already exists.

Vercel proxies `/api/*` to the Fly app, so the browser only ever talks to one origin: the
httpOnly refresh cookie keeps working and there is no CORS to configure.

```
browser ──► homebasics.vercel.app ──► /api/* ──► homebasics-api.fly.dev ──► Neon
                 (static app)                         (FastAPI + worker)
```

## One-time setup

You run these; they need your own accounts and can't be automated from here.

### 1. API on Fly.io

```bash
# install flyctl, then sign in (opens a browser)
fly auth login

# from the repo root - reads backend/fly.toml, does NOT deploy yet
fly launch --no-deploy --copy-config --config backend/fly.toml --name homebasics-api
```

Set the secrets (these never go in the repo). Use the Neon **pooled** connection string:

```bash
fly secrets set \
  DATABASE_URL='postgresql://neondb_owner:...@ep-...-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require' \
  JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  WEB_BASE_URL='https://homebasics.vercel.app' \
  CORS_ORIGINS='https://homebasics.vercel.app' \
  --config backend/fly.toml
```

`ENVIRONMENT=prod` is already in `fly.toml`, and prod refuses to start if any of the above is
missing or still points at localhost - a failed release is better than a quietly broken one.

```bash
fly deploy --config backend/fly.toml   # migrates, seeds if empty, then starts
fly logs --config backend/fly.toml     # watch the first boot
curl https://homebasics-api.fly.dev/api/v1/health
```

Using a different app name? Change `app` in `backend/fly.toml` **and** the rewrite host in
`frontend/vercel.json` (a test checks the rewrite is present and not localhost).

### 2. Web app on Vercel

```bash
cd frontend
npx vercel login
npx vercel link        # creates .vercel/project.json - keep it out of git
npx vercel --prod      # first deploy
```

Vercel reads `frontend/vercel.json` for the build, the `/api` proxy and the security headers.
No environment variables are needed: the app calls its own origin.

### 3. Automatic deploys

Add these in GitHub (Settings → Secrets and variables → Actions):

| Kind | Name | Where it comes from |
|---|---|---|
| Secret | `FLY_API_TOKEN` | `fly tokens create deploy` |
| Secret | `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| Secret | `VERCEL_ORG_ID` | `frontend/.vercel/project.json` → `orgId` |
| Secret | `VERCEL_PROJECT_ID` | `frontend/.vercel/project.json` → `projectId` |
| Variable | `PROD_WEB_URL` | `https://homebasics.vercel.app` |

`deploy.yml` then runs after CI passes on main: API, then web app, then the smoke tests
against the live site. `uptime.yml` runs the same smoke suite every 30 minutes. Until the
secrets exist both workflows no-op with a notice, so nothing goes red.

## Optional extras

| Want | Set | Effect |
|---|---|---|
| Rate limits shared across instances | `REDIS_URL` (Upstash free tier) | The limiter uses Redis instead of process memory - needed as soon as there is more than one machine |
| Real emails | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | The worker delivers the outbox; without them, messages just queue up in the table |
| Error tracking | `SENTRY_DSN` (and add `sentry-sdk`) | Exceptions are reported |

## How it runs

- **Migrations** run once per release (`release_command`), never from a booting machine, so
  rolling instances can't race on the schema. Seeding only fills an empty database.
- **The worker** (`WORKER_ENABLED=true`) runs the expiry sweep and outbox delivery every 60
  seconds inside the API process. Requests also sweep, so a sleeping machine stays correct.
- **Sleeping:** Fly suspends the machine when idle. The first request after a quiet spell
  takes about a second, which is why the smoke tests allow a generous timeout.

## Checking a deploy

```bash
curl -s https://homebasics-api.fly.dev/api/v1/health | jq
cd e2e && BASE_URL=https://homebasics.vercel.app npm run test:deployed
```

The smoke suite is read-only (it browses, checks headers, and confirms `/api/v1/test/*` is
**not** exposed), so it is safe to run against production as often as you like.

## Rolling back

```bash
fly releases --config backend/fly.toml
fly deploy --image <previous-image> --config backend/fly.toml
npx vercel rollback <deployment-url>   # from frontend/
```

A rollback does **not** undo a migration. Our migrations are additive (new tables and
nullable columns), so the previous release keeps working against the newer schema; if that
ever stops being true, write the downgrade before deploying.
