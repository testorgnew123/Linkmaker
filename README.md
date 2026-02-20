# QR Profile Platform

Multi-tenant SaaS where businesses get a custom digital profile page served via QR code. Edit branding, social links, and content cards through a split-screen editor. The QR code points to a clean public profile page.

## Stack

- **Backend**: Node.js + Express, deployed as Netlify Functions
- **Database**: Neon PostgreSQL via `@neondatabase/serverless`
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Auth**: JWT in httpOnly cookies
- **Storage**: Cloudinary (logo uploads)
- **QR**: `qrcode` npm package
- **Deploy**: Netlify

## Local Development

### Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) PostgreSQL database
- A [Cloudinary](https://cloudinary.com) account
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`npm i -g netlify-cli`)

### Setup

```bash
# Install dependencies
npm install

# Copy env template and fill in your values
cp .env.example .env

# Run migrations against Neon
npm run migrate

# Seed test data (optional)
npm run seed

# Start local dev server
netlify dev
```

### Environment Variables

Set these in `.env` locally and in **Netlify > Site settings > Environment variables** for production:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon connection string. Must end with `?sslmode=require` |
| `JWT_SECRET` | Random string for signing JWTs |
| `CLOUDINARY_URL` | Cloudinary connection URL |
| `URL` | Your site's public URL (e.g. `https://your-site.netlify.app`) |
| `ADMIN_PASSWORD` | Password for the seeded admin account. Only read by `scripts/seed.mjs` |
| `ALLOW_ADMIN_DELETE` | Set to `"true"` to allow deleting/demoting admin accounts via the admin API (default: blocked) |

### Neon Dashboard

Manage your database at [https://console.neon.tech](https://console.neon.tech)

## User Onboarding Flow

1. User registers or logs in → lands on `/onboarding.html`
2. User picks a unique handle (live availability check, 400 ms debounce)
3. Handle is claimed → user is redirected to `/editor.html?slug=<handle>`
4. If the user already has a profile they are redirected straight to the editor on load

### Handle Rules

- 3–30 characters, lowercase letters, digits, and hyphens only (`^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`)
- No consecutive hyphens (`--`)
- Cannot use reserved words: `about`, `admin`, `api`, `app`, `assets`, `auth`, `blog`, `dashboard`, `favicon`, `help`, `images`, `login`, `logout`, `mail`, `me`, `p`, `privacy`, `public`, `register`, `settings`, `signup`, `static`, `support`, `terms`, `www`

## Card Limit

Each profile may hold up to **5 content cards** by default. Admins can raise the per-profile limit via the admin portal. The editor shows a live counter (green → amber → red) and disables the Add button once the limit is reached.

## API Endpoints

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register. Body: `{ email, password }` |
| POST | `/api/auth/login` | No | Login. Body: `{ email, password }` |
| POST | `/api/auth/logout` | No | Clear auth cookie |
| GET | `/api/auth/me` | Yes | Returns `{ id, email, created_at, impersonatedBy }` |

### Handles

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/handles/check?handle=xxx` | No | Check availability. Returns `{ available, reason? }` (rate-limited: 20 req/min per IP) |
| POST | `/api/handles/claim` | Yes | Claim handle and create profile. Body: `{ handle }` |
| GET | `/api/handles/mine` | Yes | Returns `{ slug }` for the current user's profile, or `{ slug: null }` |

### Profiles

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/profiles/:slug` | No | Get profile by slug (public). Includes `card_limit` |
| PUT | `/api/profiles/:slug` | Yes | Update profile (owner only). Enforces `card_limit` |
| DELETE | `/api/profiles/:slug` | Yes | Delete profile (owner only) |
| GET | `/api/profiles/:slug/qr` | No | Get QR code PNG for profile |
| POST | `/api/profiles/:slug/logo` | Yes | Upload logo (multipart, field: `logo`) |

### Admin

All admin routes require a JWT belonging to a user with `role = 'admin'`. Impersonated sessions cannot access admin routes.

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stats` | Dashboard stats + 30-day signups chart data |
| GET | `/api/admin/users` | List users. Query: `?search=&page=&limit=` |
| GET | `/api/admin/users/:userId` | User detail with their profiles |
| PUT | `/api/admin/users/:userId` | Update role or suspension. Body: `{ role?, is_suspended?, suspended_reason? }` |
| DELETE | `/api/admin/users/:userId` | Delete user (requires `ALLOW_ADMIN_DELETE=true` for admin accounts) |
| POST | `/api/admin/users/:userId/impersonate` | Issue an impersonation JWT and redirect info |
| POST | `/api/admin/impersonate/exit` | Restore admin session (callable from impersonated session) |
| GET | `/api/admin/profiles` | List all profiles. Query: `?search=&page=&limit=` |
| PUT | `/api/admin/profiles/:slug/limit` | Override card limit. Body: `{ card_limit }` |
| DELETE | `/api/admin/profiles/:slug` | Delete any profile |
| GET | `/api/admin/audit` | Paginated audit log. Query: `?page=&limit=` |

### Response Format

Success:
```json
{ "data": { ... } }
```

Error:
```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

## Admin Portal

### First-time setup

```bash
# Set a strong password in your .env, then seed the admin account:
ADMIN_PASSWORD=your-secure-password npm run seed

# Login at:
# Local:       http://localhost:8888/admin/login.html
# Production:  https://your-site.netlify.app/admin/login.html
# Email: admin@qrprofile.com
```

The admin account is **only created via the seed script** — no first-user-becomes-admin logic exists.

### Admin features

- **Dashboard** — total users / profiles / cards, 30-day signup bar chart, recent profiles table
- **Users** — searchable/paginated table; right-side drawer with account details, per-profile card-limit override, suspend/unsuspend, role change, delete
- **Profiles** — searchable/paginated table; view public profile, delete
- **Impersonation** — "Login as User" in the user drawer opens the editor as that user; a red banner persists until "Exit Impersonation" is clicked. All impersonations are recorded in the audit log
- **Audit Log** — paginated record of every admin action (role change, suspension, impersonation, delete)

## Migrations

```bash
# Run all migrations
npm run migrate

# Seed test data
npm run seed
# Test user login: admin@desirerealty.co.za / password123
# Test profile:    /p/desire-realty
# Admin login:     admin@qrprofile.com / <value of ADMIN_PASSWORD>
```

Migration files (run in order):

| File | Description |
|---|---|
| `001_init.sql` | Users + profiles tables |
| `002_*.sql` | Logo URL column |
| `003_add_roles_and_limits.sql` | role, suspension, card_limit, audit_log |

## Project Structure

```
netlify/functions/    Serverless API endpoints (.mjs)
  auth.mjs            Register / login / logout / me
  profile.mjs         Public profile CRUD
  handles.mjs         Handle check / claim / mine
  admin.mjs           Admin API (stats, users, profiles, audit, impersonation)
lib/                  Shared utilities
  db.js               Neon connection helper
  auth.js             JWT helpers, requireAuth, requireAdmin
  validate.js         Email, slug, handle validators
  reserved-handles.js Reserved handle list
migrations/           SQL migration files (run via npm run migrate)
scripts/              CLI scripts (migrate.mjs, seed.mjs)
public/               Static files served by Netlify
  index.html          Landing / login page
  onboarding.html     Handle claim flow (post-signup)
  editor.html         Split-screen profile editor
  p/index.html        Public profile renderer
  admin/
    login.html        Admin login
    index.html        Admin SPA (dashboard, users, profiles, audit)
```

## Netlify Deploy

1. Connect your GitHub repo to Netlify
2. Set environment variables in Netlify dashboard
3. Deploy — Netlify auto-detects `netlify.toml` config
4. Every push triggers a new deploy
