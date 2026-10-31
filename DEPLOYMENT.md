# Deployment

Anchor ERP runs as a standard Next.js app with Prisma on Postgres.
There is no separate backend service to deploy — the API routes in
`app/api/` are the backend, and they are the only code that talks to
the database.

## What you need

- Node.js 20 or newer
- A Postgres database (Neon in production, any local Postgres in dev)
- The environment variables from `.env.example`:
  - `DATABASE_URL` — Postgres connection string
  - `SESSION_SECRET` — long random string, signs the session cookie
  - `RESEND_API_KEY` — email sending (optional in dev)
  - `NEXT_PUBLIC_APP_URL` — public URL of the app, used in email links
  - `STORAGE_ROOT` — where uploaded files live on disk

## First deploy

```bash
npm ci
npx prisma generate
npx prisma migrate deploy   # or apply prisma/clone_schema_reference.sql by hand
npm run build
npm start
```

`npm start` runs `server.js`, a small custom server around the
standalone Next.js output (`output: 'standalone'` in
`next.config.mjs`). A `Dockerfile` is included if you prefer a
container.

## Notes

- Sessions are stateless HMAC cookies (`erp_session`), so the app
  scales horizontally without sticky sessions or a session store.
- Uploaded files are served through `/api/files/...`, which checks
  the caller's session and the bucket privacy rules in
  `lib/server/storage.ts`. Point `STORAGE_ROOT` at persistent disk.
- Never commit a real `.env.local`. Production secrets live in the
  host's environment settings only.
