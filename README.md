# Anchor ERP

The back-office system for Anchor's branch network: branch cash
ledgers and daily closings, bank deposits, salaries and payouts, house
rent and utility billing, company expenses, KYC verification, and the
financial reporting on top of all of it.

It is a single Next.js app. The pages are the frontend, the route
handlers in `app/api/` are the backend, and Prisma is the only thing
that talks to the Postgres database. Nothing in the browser touches
the database directly — if you are adding a feature, it gets an API
route.

## Getting started

You need Node 20+ and a Postgres database (Neon works well; a local
Postgres is fine for development).

```bash
npm ci
cp .env.example .env.local   # fill in DATABASE_URL and SESSION_SECRET
npx prisma generate
npm run dev
```

The schema lives in `prisma/schema.prisma`. If you need a database
from scratch, `prisma/clone_schema_reference.sql` is a plain-SQL
snapshot of the same schema.

## Folder map

```
app/
  admin/          Admin panel pages (users, salaries, expenses, KYC…)
  api/            Every backend endpoint, grouped by domain
  context/        React context: AuthContext (identity via /api/auth/me)
  dashboard/      Employee / partner / branch-manager pages
  kyc/            KYC submission flow
  reset-password/, verify-2fa/
  page.tsx        Login + registration
  layout.tsx      Root layout, fonts, sidebar shell
components/       Shared UI: sidebar, notification dropdown, modals,
                  stats card, deposit slip viewer
lib/
  db.ts           The Prisma client singleton — import { prisma } from here
  money.ts        Integer-poisha money helpers. Always use these.
  dhaka-time.ts   Asia/Dhaka date helpers. "Today" is a Dhaka concept here.
  expense-streams.ts  The expense classifier (branch / company / ledger-head)
  bundles.ts      Cash denomination bundles for daily closing
  otp-hash.ts, security-answer.ts, two-factor-cookie.ts
                  OTP + security-question digests and the 2FA cookie
  email-service.ts    Transactional email (Resend)
  pdf-generator.ts, excel-generator.ts, server-pdf-voucher.ts
  files-client.ts Browser-side upload helper (posts to /api/files)
  hooks/          Client hooks
  server/         Server-only modules — see below
prisma/           schema.prisma + a reference SQL snapshot
public/           Icons, logos, service worker (sw.js)
scripts/          copy-static.js (postbuild step for the standalone server)
server.js         Production server for the standalone build
```

`lib/server/` is where the sensitive plumbing lives:

- `auth.ts` — the one caller resolver. Every API route gets its
  caller (and branch scope) from here; routes never trust ids from
  the request body.
- `session.ts` — the `erp_session` cookie: HMAC-signed, 7 days.
- `passwords.ts` — bcrypt hashing. Accounts carried over from the
  previous system keep a legacy hash that is verified once and then
  transparently rehashed to the native scheme on first login.
- `ledger-sync.ts` — keeps the branch cash ledger in step with
  deposits and expenses, inside the caller's transaction. If you
  touch deposit or expense writes, read this first.
- `summary.ts` — the branch accounts summary, computed in code.
- `storage.ts` — file storage behind one interface, plus the bucket
  privacy map. KYC documents are owner-or-admin only.
- `respond.ts` — `toPlain()`: run Prisma results through it before
  returning JSON (Decimals and Dates).
- `attach.ts` — manual relation loading for list endpoints.

## Rules worth knowing before you change things

**Money is integer poisha.** Floats caused real damage here once.
Convert at the edges with `lib/money.ts` (`toPoisha` / `toTaka`) and
keep everything else in poisha. Totals are recomputed on the server;
never trust a total the client sends.

**Dates are Dhaka dates.** The business day is Asia/Dhaka, including
the 00:00–05:59 stretch where UTC disagrees. Use `lib/dhaka-time.ts`
instead of `new Date()` arithmetic, and use half-open month windows
(`>= start, < next start`) — the last day of the month counts.

**Expenses come in three streams** and the classification lives in
`lib/expense-streams.ts`: branch expenses (spent from branch cash),
company expenses (from the company profile — one-off opening/setup
costs are flagged `expense_kind = 'setup'`), and ledger-head expenses
(rent, bills, salary heads). A salary paid from branch cash appears
once, via `salary_payments`; the matching branch-cash row is a copy
and is excluded from totals on purpose.

**Auth is fail-closed.** No session, a banned account, or an
unapproved verification status means no data. When in doubt, look at
how an existing route in the same area resolves its caller and copy
that pattern.

**Lists don't trust the client.** Pagination bounds and branch
scoping are enforced server-side in the route, not in the page.

## Working on the UI

The theme is light, defined once in `app/globals.css` (CSS variables
mapped into Tailwind via `@theme`). Gold `#d4af37` is the brand
accent — for fills; use `#8a6d1f` when gold is text on white. Pages
should stay usable at 375–390 px wide: tables with a minimum width
belong inside an `overflow-x-auto` wrapper, and grids collapse to one
column on small screens.

## Deploying

See `DEPLOYMENT.md`. In short: set the env vars, `prisma generate`,
apply migrations, `npm run build`, `npm start`.

## A note on history

This codebase replaced an older system with a different backend. The
migration kept every account (same ids, same passwords), every taka
of history, and every screen — only the plumbing changed. Comments
that mention "the legacy system" refer to that predecessor. One known
data quirk came across deliberately, flagged rather than hidden: the
SOTIBARI branch ledger and its approved deposits disagree by
৳11,627. That difference is visible in reconciliation; do not
"fix" it by adjusting numbers.
