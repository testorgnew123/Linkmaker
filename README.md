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

### Neon Dashboard

Manage your database at [https://console.neon.tech](https://console.neon.tech)

## API Endpoints

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register. Body: `{ email, password }` |
| POST | `/api/auth/login` | No | Login. Body: `{ email, password }` |
| POST | `/api/auth/logout` | No | Clear auth cookie |
| GET | `/api/auth/me` | Yes | Get current user |

### Profiles

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/profiles` | Yes | Create profile. Body: `{ business_name, tagline, bio, ... }` |
| GET | `/api/profiles/:slug` | No | Get profile by slug (public) |
| PUT | `/api/profiles/:slug` | Yes | Update profile (owner only) |
| DELETE | `/api/profiles/:slug` | Yes | Delete profile (owner only) |
| GET | `/api/profiles/:slug/qr` | No | Get QR code PNG for profile |
| POST | `/api/profiles/:slug/logo` | Yes | Upload logo (multipart, field: `logo`) |

### Response Format

Success:
```json
{ "data": { ... } }
```

Error:
```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

## Migrations

```bash
# Run all migrations
npm run migrate

# Seed Desire Realty test profile
npm run seed
# Login: admin@desirerealty.co.za / password123
# Profile: /p/desire-realty
```

## Project Structure

```
netlify/functions/    Serverless API endpoints (.mjs)
lib/                  Shared utilities (db, auth, validation, cloudinary)
migrations/           SQL migration files
scripts/              CLI scripts (migrate, seed)
public/               Static files served by Netlify
  editor.html         Split-screen profile editor
  p/index.html        Public profile renderer
```

## Netlify Deploy

1. Connect your GitHub repo to Netlify
2. Set environment variables in Netlify dashboard
3. Deploy — Netlify auto-detects `netlify.toml` config
4. Every push triggers a new deploy
