# QR Profile Platform

## Stack
- Runtime: Node.js ES Modules (type: "module")
- Backend: Express + serverless-http wrapped as Netlify Functions
- Database: Neon PostgreSQL via @neondatabase/serverless (NOT pg)
- Frontend: Vanilla HTML/CSS/JS, no build step
- Deploy: Netlify (functions in netlify/functions/, static in public/)
- Auth: JWT in httpOnly cookies via jsonwebtoken
- Storage: Cloudinary for logo uploads

## Critical Rules
- Always use neon() tagged template queries — never Pool, never pg
- DATABASE_URL must end with ?sslmode=require
- API responses: always { data } or { error, code }
- Never trust owner_id from client — read from JWT only
- All slugs: ^[a-z0-9-]{3,50}$ enforced at DB + API level
- No app.listen() — export handler = serverless(app)

## Neon Connection Pattern
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT * FROM profiles WHERE slug = ${slug}`;


## Admin Query Pattern
Admin endpoints JOIN users + profiles. Always use:
SELECT p.*, u.email as owner_email
FROM profiles p
JOIN users u ON u.id = p.owner_id
Never expose password_hash — always SELECT explicit columns.
Role is double-checked from DB on every admin request, not just JWT.

## Admin Rules
- Admin account exists only via seed script — no API path to become admin
- Role is always re-checked from DB on every admin request, never trusted from JWT alone
- Impersonation: JWT carries impersonatedBy field — impersonated sessions 
  cannot access /api/admin/* and cannot impersonate further
- Every admin destructive action must be written to audit_log table
- Never delete or demote another admin via API unless ALLOW_ADMIN_DELETE=true in env

## Audit Log Pattern
Always insert to audit_log after any admin action:
await sql`INSERT INTO audit_log (admin_id, action, target_id, metadata)
          VALUES (${adminId}, ${action}, ${targetId}, ${JSON.stringify(meta)})`


## Card System
Cards are stored as JSONB array in profiles.cards.
Each card: { id, type, title, ...typeSpecificFields }
Card types: link, map, website, whatsapp, google, cta, text, video,
            image, image_grid, audio, pdf, countdown, rss_feed,
            contact_form, email_capture, poll, faq, testimonial,
            product, booking, tip_jar, instagram_post, tweet,
            tiktok_post, spotify
Never add columns for individual card types — always JSONB.

## Theme System
Themes: 25 total. One special light theme: arctic (invert text colors).
Check state.theme === 'arctic' to apply light mode overrides.

## Interactive Cards Backend
poll_votes table handles poll state server-side.
Contact forms: nodemailer via SMTP — validate recipient is profile owner.